import { logger } from '../utils/logger.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { StepLogger } from '../utils/step-logger.js';
import { createSupabaseClient } from '../utils/supabase-client.js';
import { validateNRIC, validateClaimDetails, logValidationResults } from '../utils/extraction-validator.js';

/**
 * Batch extraction: Extract all queue items from today and save to CRM
 */
export class BatchExtraction {
  constructor(clinicAssistPage) {
    this.clinicAssist = new ClinicAssistAutomation(clinicAssistPage);
    this.steps = new StepLogger({ total: 10, prefix: 'BATCH' });
    this.supabase = createSupabaseClient();
  }

  /**
   * Extract all queue items from today
   */
  async extractAllQueueItemsToday(branchName = '__FIRST__', deptName = 'Reception') {
    const runMetadata = { branchName, deptName, trigger: 'automation' };
    const runId = await this._startRun('queue_list', runMetadata);

    try {
      this.steps.step(1, 'Login to Clinic Assist');
      await this.clinicAssist.login();

      this.steps.step(2, 'Navigate to Queue', { branchName, deptName });
      await this.clinicAssist.navigateToQueue(branchName, deptName);

      this.steps.step(3, 'Get all queue items from today');
      const queueItems = await this.getAllQueueItems();
      await this._updateRun(runId, { total_records: queueItems.length });

      this.steps.step(4, `Found ${queueItems.length} queue items; extracting data`);

      const extractedItems = [];
      let successCount = 0;
      let failedCount = 0;
      for (let i = 0; i < queueItems.length; i++) {
        const item = queueItems[i];
        this.steps.step(4, `Extracting item ${i + 1}/${queueItems.length}`, {
          patientName: item.patientName,
          payType: item.payType,
        });

        try {
          const extracted = await this.extractQueueItemData(item);
          if (extracted) {
            extractedItems.push(extracted);
            if (extracted.extracted) successCount++;
            else failedCount++;
          } else {
            failedCount++;
          }
        } catch (error) {
          failedCount++;
          logger.error(`[BATCH] Failed to extract item ${i + 1}`, { error: error.message, item });
          // Continue with next item
        }

        await this._updateRun(runId, {
          completed_count: successCount,
          failed_count: failedCount,
        });
      }

      this.steps.step(5, `Extracted ${extractedItems.length} items; saving to CRM`);
      const saved = await this.saveToCRM(extractedItems);

      await this._updateRun(runId, {
        status: 'completed',
        finished_at: new Date().toISOString(),
        total_records: queueItems.length,
        completed_count: successCount,
        failed_count: failedCount,
        metadata: { ...runMetadata, extractedCount: successCount, savedCount: saved },
      });

      return {
        success: true,
        totalItems: queueItems.length,
        extractedCount: extractedItems.length,
        savedCount: saved,
        items: extractedItems,
      };
    } catch (error) {
      await this._updateRun(runId, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: error.message || String(error),
      });
      throw error;
    }
  }

  /**
   * Get all queue items from the current queue page
   */
  async getAllQueueItems() {
    const items = [];
    
    // Try jqGrid first
    const jqGrid = this.clinicAssist.page.locator('#queueLogGrid');
    if ((await jqGrid.count().catch(() => 0)) > 0) {
      const rows = jqGrid.locator('tr.jqgrow');
      const rowCount = await rows.count().catch(() => 0);
      
      for (let i = 0; i < rowCount; i++) {
        const row = rows.nth(i);
        const getCellValue = async (ariaDesc) => {
          const cell = row.locator(`td[aria-describedby$="${ariaDesc}"]`).first();
          const count = await cell.count().catch(() => 0);
          if (count === 0) return null;
          return (await cell.textContent().catch(() => ''))?.trim() || null;
        };

        const qno = await getCellValue('_QNo');
        const status = await getCellValue('_Status');
        const patientName = await getCellValue('_PatientName');
        const nric = await getCellValue('_NRIC');
        const payType = await getCellValue('_PayType');
        const visitType = await getCellValue('_VisitType');
        const fee = await getCellValue('_Fee');
        const inTime = await getCellValue('_In');
        const outTime = await getCellValue('_Out');

        if (patientName || nric) {
          items.push({
            qno,
            status,
            patientName,
            nric,
            payType,
            visitType,
            fee,
            inTime,
            outTime,
            rowIndex: i, // Store index for later reference
          });
        }
      }
    } else {
      // Fallback: try table structure
      const table = this.clinicAssist.page.locator('table:has(th:has-text("QNo"))').first();
      if ((await table.count().catch(() => 0)) > 0) {
        const rows = table.locator('tbody tr');
        const rowCount = await rows.count().catch(() => 0);
        
        for (let i = 0; i < rowCount; i++) {
          const row = rows.nth(i);
          const cells = row.locator('td');
          const cellCount = await cells.count().catch(() => 0);
          if (cellCount < 5) continue;

          const qno = (await cells.nth(0).textContent().catch(() => ''))?.trim() || null;
          const status = (await cells.nth(1).textContent().catch(() => ''))?.trim() || null;
          const patientName = (await cells.nth(3).textContent().catch(() => ''))?.trim() || null;
          const nric = (await cells.nth(5).textContent().catch(() => ''))?.trim() || null;
          const payType = (await cells.nth(13).textContent().catch(() => ''))?.trim() || null;
          const visitType = (await cells.nth(14).textContent().catch(() => ''))?.trim() || null;
          const fee = (await cells.nth(8).textContent().catch(() => ''))?.trim() || null;

          if (patientName || nric) {
            items.push({
              qno,
              status,
              patientName,
              nric,
              payType,
              visitType,
              fee,
              rowIndex: i,
            });
          }
        }
      }
    }

    return items;
  }

  /**
   * Extract detailed data from a single queue item
   */
  async extractQueueItemData(queueItem) {
    try {
      // Navigate back to queue if we're not there (unless we're in reports)
      const currentUrl = this.clinicAssist.page.url();
      const isFromReports = queueItem.source === 'reports_queue_list';
      
      if (!isFromReports && !currentUrl.includes('/Queue') && !currentUrl.includes('/QueueLog')) {
        this.steps.log('Navigating back to queue');
        await this.clinicAssist.navigateToQueue(process.env.BATCH_BRANCH || '__FIRST__', process.env.BATCH_DEPT || 'Reception');
        await this.clinicAssist.page.waitForTimeout(3000); // Wait longer for queue to load
      }

      // Wait for queue grid to be ready
      const jqGrid = this.clinicAssist.page.locator('#queueLogGrid');
      await jqGrid.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
      await this.clinicAssist.page.waitForTimeout(1000);

      // Find the row by NRIC (most reliable) or patient name
      // Use rowIndex if available, otherwise search by NRIC
      let row = null;
      
      if (queueItem.rowIndex !== undefined) {
        // Use row index if we have it (most reliable)
        if ((await jqGrid.count().catch(() => 0)) > 0) {
          const rows = jqGrid.locator('tr.jqgrow');
          const rowCount = await rows.count().catch(() => 0);
          if (queueItem.rowIndex < rowCount) {
            row = rows.nth(queueItem.rowIndex);
            const rowCountCheck = await row.count().catch(() => 0);
            if (rowCountCheck === 0) {
              row = null;
            }
          }
        }
      }
      
      // Fallback: search by NRIC (exact match)
      if (!row && queueItem.nric) {
        // Try exact text match first
        const nricCell = this.clinicAssist.page.locator(`td[aria-describedby$="_NRIC"]`).filter({ hasText: queueItem.nric }).first();
        if ((await nricCell.count().catch(() => 0)) > 0) {
          row = nricCell.locator('..').first(); // Get parent row
        }
        
        // If still not found, try contains match
        if (!row || (await row.count().catch(() => 0)) === 0) {
          row = this.clinicAssist.page.locator(`tr.jqgrow:has(td[aria-describedby$="_NRIC"]:has-text("${queueItem.nric}"))`).first();
        }
      }
      
      // Fallback: search by patient name
      if ((!row || (await row.count().catch(() => 0)) === 0) && queueItem.patientName) {
        row = this.clinicAssist.page.locator(`tr.jqgrow:has(td[aria-describedby$="_PatientName"]:has-text("${queueItem.patientName}"))`).first();
      }

      if (!row || (await row.count().catch(() => 0)) === 0) {
        logger.warn(`[BATCH] Could not find row for ${queueItem.patientName || queueItem.nric}`, { 
          rowIndex: queueItem.rowIndex,
          nric: queueItem.nric,
          patientName: queueItem.patientName 
        });
        // Return basic data we have from queue
        return {
          ...queueItem,
          extracted: false,
          reason: 'row_not_found',
        };
      }

      // Try to open visit record
      const opened = await this.clinicAssist._openVisitFromQueueRow(row);
      if (!opened) {
        logger.warn(`[BATCH] Could not open visit record for ${queueItem.patientName || queueItem.nric}`);
        // Return basic data we have from queue
        return {
          ...queueItem,
          extracted: false,
          reason: 'could_not_open_visit',
        };
      }

      // Extract claim details
      const claimDetails = await this.clinicAssist.extractClaimDetailsFromCurrentVisit();
      
      // Extract patient NRIC if not already available
      let nric = queueItem.nric;
      if (!nric) {
        nric = await this.clinicAssist.extractPatientNricFromPatientInfo();
      }

      // Validate NRIC
      const nricValidation = validateNRIC(nric || queueItem.nric);
      const validatedNric = nricValidation.isValid ? nricValidation.cleaned : (nric || queueItem.nric);
      
      if (!nricValidation.isValid && (nric || queueItem.nric)) {
        logger.warn(`[BATCH] Invalid NRIC format for ${queueItem.patientName}`, {
          original: nric || queueItem.nric,
          reason: nricValidation.reason,
        });
      }

      // Validate claim details (already done in extractClaimDetailsFromCurrentVisit, but log again for batch context)
      if (claimDetails) {
        const validationResult = validateClaimDetails(claimDetails);
        logValidationResults(validationResult, queueItem.patientName || validatedNric);
      }

      return {
        ...queueItem,
        nric: validatedNric,
        claimDetails,
        extracted: true,
        extractedAt: new Date().toISOString(),
        validation: {
          nricValid: nricValidation.isValid,
          nricValidationReason: nricValidation.reason,
        },
      };
    } catch (error) {
      logger.error(`[BATCH] Error extracting data for ${queueItem.patientName || queueItem.nric}`, { error: error.message });
      return {
        ...queueItem,
        extracted: false,
        error: error.message,
      };
    }
  }

  /**
   * Extract patients from Reports → Queue List (date-based).
   * Used by extract-date-range and extract-daily. We always navigate to the Queue List
   * report, search by date, then extract (Excel export or grid). The report may return
   * 0 items for that date; we still go there because we cannot know it's empty otherwise.
   *
   * @param {string|null} date - YYYY-MM-DD. Defaults to today.
   * @param {{ skipRunLogging?: boolean }} options - If skipRunLogging, do not create/update
   *   rpa_extraction_runs (caller already tracks the run, e.g. extract-date-range).
   */
  async extractFromReportsQueueList(date = null, options = {}) {
    const { skipRunLogging = false } = options;
    const targetDate = date || new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const runMetadata = { date: targetDate, trigger: skipRunLogging ? 'extract-date-range' : 'manual' };
    const runId = skipRunLogging ? null : await this._startRun('queue_list', runMetadata);

    try {
      this.steps.step(3, 'Reports → Queue List (date-based extraction)');
      logger.info(`[REPORTS] Navigating to Queue List report for date: ${targetDate}`);

      // Navigate to Reports first (while we're still logged in and on a valid page)
      const navigated = await this.clinicAssist.navigateToReports();
      if (!navigated) {
        logger.warn('[REPORTS] Could not navigate to Reports section');
        if (runId) {
          await this._updateRun(runId, {
            status: 'failed',
            finished_at: new Date().toISOString(),
            error_message: 'Could not navigate to Reports section',
          });
        }
        return [];
      }

      // Wait for Reports page to load
      await this.clinicAssist.page.waitForTimeout(2000);
      
      // Try to find and click QueueReport link from Reports page
      const queueListOpened = await this.clinicAssist.navigateToQueueListReport();
      if (!queueListOpened) {
        logger.warn('[REPORTS] Could not find QueueReport link, trying direct navigation from Reports context');
        const directNav = await this.clinicAssist.navigateDirectlyToQueueReport();
        if (!directNav) {
          logger.warn('[REPORTS] Direct navigation also failed');
          if (runId) {
            await this._updateRun(runId, {
              status: 'failed',
              finished_at: new Date().toISOString(),
              error_message: 'Could not navigate to Queue Report',
            });
          }
          return [];
        }
      }

      // Search for the target date (if date fields found)
      await this.clinicAssist.page.waitForTimeout(2000);
      const searchResult = await this.clinicAssist.searchQueueListByDate(targetDate);
      
      if (!searchResult) {
        logger.warn('[REPORTS] Could not search queue list by date; will try to extract whatever is shown');
      }

      // Extract patient data (Excel export preferred, then grid/iframe)
      await this.clinicAssist.page.waitForTimeout(searchResult ? 3000 : 1000);
      const items = await this.clinicAssist.extractQueueListResults();

      if (items.length === 0) {
        logger.info(`[REPORTS] Queue list report returned 0 items for ${targetDate} (report may be empty for this date)`);
      } else {
        logger.info(`[REPORTS] Extracted ${items.length} items from queue list for ${targetDate}`);
      }

      if (runId) {
        await this._updateRun(runId, {
          total_records: items.length,
          completed_count: items.length,
          failed_count: 0,
          status: 'completed',
          finished_at: new Date().toISOString(),
          metadata: { ...runMetadata, extractedCount: items.length },
        });
      }

      return items || [];
    } catch (error) {
      logger.error('[REPORTS] Error extracting from reports queue list', { error: error.message });
      if (runId) {
        await this._updateRun(runId, {
          status: 'failed',
          finished_at: new Date().toISOString(),
          error_message: error.message || String(error),
        });
      }
      return [];
    }
  }

  /**
   * Save extracted items to CRM (Supabase)
   * @param {Array} items - Array of extracted visit items
   * @param {string} visitDate - Optional visit date in YYYY-MM-DD format. Defaults to today if not provided.
   */
  async saveToCRM(items, visitDate = null) {
    if (!this.supabase) {
      logger.warn('[BATCH] Supabase not configured; saving to JSON file instead');
      // Fallback to JSON file
      const { writeFile, mkdir } = await import('fs/promises');
      const { join } = await import('path');
      const { existsSync } = await import('fs');
      
      const dataDir = './data/batch-extractions';
      if (!existsSync(dataDir)) {
        await mkdir(dataDir, { recursive: true });
      }
      
      const filename = `batch-extraction-${new Date().toISOString().replace(/:/g, '-')}.json`;
      const filepath = join(dataDir, filename);
      await writeFile(filepath, JSON.stringify({ items, extractedAt: new Date().toISOString() }, null, 2));
      
      logger.info(`[BATCH] Saved ${items.length} items to ${filepath}`);
      return items.length;
    }

    // Get system user_id for automated extractions
    // Use environment variable or default to admin user found in system
    const systemUserId = process.env.SUPABASE_SYSTEM_USER_ID || 'c80a40d9-18f5-4364-8987-e9dd0178d00c';

    let savedCount = 0;
    // Use provided visitDate, or default to today
    const targetDate = visitDate || new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    for (const item of items) {
      try {
        // Parse fee amount - prefer extracted claimAmount, fallback to queue fee
        const feeAmount = item.claimDetails?.claimAmount || 
                         (item.fee ? parseFloat(item.fee.replace(/[^0-9.]/g, '')) : null);

        // Extract PCNO for deduplication
        const pcno = item.pcno || null;

        // Prepare visit data
        const visitData = {
          user_id: systemUserId, // Required field
          visit_date: targetDate,
          time_arrived: item.inTime || null,
          time_left: item.outTime || null,
          patient_name: item.patientName || null,
          visit_record_no: item.qno || null,
          total_amount: feeAmount,
          amount_outstanding: feeAmount,
          
          // Claim details
          diagnosis_description: item.claimDetails?.diagnosisText || null,
          symptoms: item.claimDetails?.notesText || null,
          treatment_detail: item.claimDetails?.items?.join('\n') || null,
          
          // MC days
          mc_required: (item.claimDetails?.mcDays || 0) > 0,
          mc_start_date: (item.claimDetails?.mcDays || 0) > 0 ? targetDate : null,
          mc_end_date: (item.claimDetails?.mcDays || 0) > 0 ? targetDate : null,
          
          // Metadata
          source: 'Clinic Assist',
          pay_type: item.payType,
          visit_type: item.visitType,
          nric: item.nric,
          extraction_metadata: {
            extracted: item.extracted,
            extractedAt: item.extractedAt || new Date().toISOString(),
            sources: item.claimDetails?.sources || {},
            pcno: pcno, // Save PCNO (patient number) for future searches
          },
        };

        // Deduplication: Check for existing record by PCNO + visit_date
        // This prevents duplicate entries when the same patient appears multiple times in the queue
        let existingRecord = null;
        
        // Primary deduplication: by PCNO + visit_date (most reliable)
        if (pcno) {
          // Query for existing records with same visit_date and check PCNO in metadata
          const { data: existingData, error: queryError } = await this.supabase
            .from('visits')
            .select('id, extraction_metadata')
            .eq('visit_date', targetDate)
            .not('extraction_metadata', 'is', null)
            .limit(100); // Get multiple to filter in JS (PostgreSQL JSONB filtering can be tricky)
          
          if (!queryError && existingData) {
            // Filter in JavaScript to find matching PCNO
            const matching = existingData.find(v => {
              const metadata = v.extraction_metadata;
              if (!metadata || typeof metadata !== 'object') return false;
              return metadata.pcno === pcno || String(metadata.pcno) === String(pcno);
            });
            
            if (matching) {
              existingRecord = matching;
              logger.info(`[BATCH] Found existing record for PCNO ${pcno} on ${targetDate}, will update instead of insert`, {
                existingId: matching.id.substring(0, 8) + '...'
              });
            }
          }
        }
        
        // Fallback deduplication: by visit_record_no + visit_date (if PCNO not available)
        if (!existingRecord && item.qno) {
          const { data: existingByQno } = await this.supabase
            .from('visits')
            .select('id')
            .eq('visit_date', targetDate)
            .eq('visit_record_no', item.qno)
            .limit(1)
            .maybeSingle();
          
          if (existingByQno) {
            existingRecord = existingByQno;
            logger.info(`[BATCH] Found existing record for QNO ${item.qno} on ${targetDate}, will update instead of insert`);
          }
        }

        let { data, error } = null;

        if (existingRecord) {
          // Update existing record instead of inserting
          const { data: updateData, error: updateError } = await this.supabase
            .from('visits')
            .update(visitData)
            .eq('id', existingRecord.id)
            .select();
          
          if (updateError) {
            throw updateError;
          }
          data = updateData;
          error = null;
        } else {
          // Insert new visit
          const insertResult = await this.supabase
            .from('visits')
            .insert(visitData)
            .select();
          
          data = insertResult.data;
          error = insertResult.error;

          // If insert fails due to duplicate (unique constraint on visit_record_no), try update
          if (error && error.code === '23505') { // Unique violation
            const { data: updateData, error: updateError } = await this.supabase
              .from('visits')
              .update(visitData)
              .eq('visit_record_no', item.qno)
              .eq('visit_date', targetDate)
              .select();
            
            if (updateError) {
              throw updateError;
            }
            data = updateData;
            error = null;
          }
        }

        if (error) {
          logger.error(`[BATCH] Failed to save visit for ${item.patientName}`, { error: error.message });
        } else {
          savedCount++;
          logger.info(`[BATCH] Saved visit for ${item.patientName}`, { visitId: data?.[0]?.id });
        }
      } catch (error) {
        logger.error(`[BATCH] Error saving ${item.patientName}`, { error: error.message });
      }
    }

    this.steps.step(6, `Saved ${savedCount}/${items.length} items to CRM`);
    return savedCount;
  }

  async _startRun(runType, metadata = {}) {
    if (!this.supabase) return null;
    try {
      const { data, error } = await this.supabase
        .from('rpa_extraction_runs')
        .insert({
          run_type: runType,
          status: 'running',
          started_at: new Date().toISOString(),
          metadata,
        })
        .select('id')
        .single();
      if (error) {
        logger.error('[BATCH] Failed to create run record', { error: error.message });
        return null;
      }
      return data?.id ?? null;
    } catch (error) {
      logger.error('[BATCH] Error creating run record', { error: error.message });
      return null;
    }
  }

  async _updateRun(runId, updates) {
    if (!this.supabase || !runId) return;
    try {
      const { error } = await this.supabase
        .from('rpa_extraction_runs')
        .update(updates)
        .eq('id', runId);
      if (error) {
        logger.error('[BATCH] Failed to update run record', { error: error.message });
      }
    } catch (error) {
      logger.error('[BATCH] Error updating run record', { error: error.message });
    }
  }
}

