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
    this.steps.step(1, 'Login to Clinic Assist');
    await this.clinicAssist.login();

    this.steps.step(2, 'Navigate to Queue', { branchName, deptName });
    await this.clinicAssist.navigateToQueue(branchName, deptName);

    this.steps.step(3, 'Get all queue items from today');
    const queueItems = await this.getAllQueueItems();

    this.steps.step(4, `Found ${queueItems.length} queue items; extracting data`);
    
    const extractedItems = [];
    for (let i = 0; i < queueItems.length; i++) {
      const item = queueItems[i];
      this.steps.step(4, `Extracting item ${i + 1}/${queueItems.length}`, { 
        patientName: item.patientName, 
        payType: item.payType 
      });

      try {
        const extracted = await this.extractQueueItemData(item);
        if (extracted) {
          extractedItems.push(extracted);
        }
      } catch (error) {
        logger.error(`[BATCH] Failed to extract item ${i + 1}`, { error: error.message, item });
        // Continue with next item
      }
    }

    this.steps.step(5, `Extracted ${extractedItems.length} items; saving to CRM`);
    const saved = await this.saveToCRM(extractedItems);

    return {
      success: true,
      totalItems: queueItems.length,
      extractedCount: extractedItems.length,
      savedCount: saved,
      items: extractedItems,
    };
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
   * Fallback: Extract patients from Reports → Queue List
   * This is used when the queue page is empty
   */
  async extractFromReportsQueueList(date = null) {
    try {
      this.steps.step(3, 'Attempting fallback: Reports → Queue List');
      const targetDate = date || new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
      logger.info(`[REPORTS] Extracting from queue list for date: ${targetDate}`);

      // Navigate to Reports first (while we're still logged in and on a valid page)
      const navigated = await this.clinicAssist.navigateToReports();
      if (!navigated) {
        logger.warn('[REPORTS] Could not navigate to Reports section');
        return [];
      }

      // Wait for Reports page to load
      await this.clinicAssist.page.waitForTimeout(2000);
      
      // Try to find and click QueueReport link from Reports page
      // OR navigate directly from Reports context
      const queueListOpened = await this.clinicAssist.navigateToQueueListReport();
      if (!queueListOpened) {
        logger.warn('[REPORTS] Could not find QueueReport link, trying direct navigation from Reports context');
        // Try direct navigation from Reports page (should maintain session)
        const directNav = await this.clinicAssist.navigateDirectlyToQueueReport();
        if (!directNav) {
          logger.warn('[REPORTS] Direct navigation also failed');
          return [];
        }
      }

      // Search for the target date (if date fields found)
      await this.clinicAssist.page.waitForTimeout(2000);
      const searchResult = await this.clinicAssist.searchQueueListByDate(targetDate);
      
      // Even if search didn't work, try to extract data (maybe data is already shown)
      if (!searchResult) {
        logger.warn('[REPORTS] Could not search queue list by date, but will try to extract existing data');
      }

      // Extract patient data from the results (wait a bit longer if search was executed)
      await this.clinicAssist.page.waitForTimeout(searchResult ? 3000 : 1000);
      const items = await this.clinicAssist.extractQueueListResults();
      
      logger.info(`[REPORTS] Extracted ${items.length} items from queue list`);
      return items || [];
    } catch (error) {
      logger.error('[REPORTS] Error extracting from reports queue list', { error: error.message });
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
          },
        };

        // Insert visit (upsert by visit_record_no if unique, otherwise just insert)
        // Since user_id is required, we need to handle it - try to get first user or use a system approach
        let { data, error } = await this.supabase
          .from('visits')
          .insert(visitData)
          .select();

        // If insert fails due to duplicate, try update
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
}

