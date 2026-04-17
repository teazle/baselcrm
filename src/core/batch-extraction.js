import { logger } from '../utils/logger.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { StepLogger } from '../utils/step-logger.js';
import { createSupabaseClient } from '../utils/supabase-client.js';
import {
  validateNRIC,
  validateClaimDetails,
  logValidationResults,
} from '../utils/extraction-validator.js';
import { classifyVisitForRpa } from '../../apps/crm/src/lib/rpa/portals.shared.js';

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
        const getCellValue = async ariaDesc => {
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

          const qno =
            (
              await cells
                .nth(0)
                .textContent()
                .catch(() => '')
            )?.trim() || null;
          const status =
            (
              await cells
                .nth(1)
                .textContent()
                .catch(() => '')
            )?.trim() || null;
          const patientName =
            (
              await cells
                .nth(3)
                .textContent()
                .catch(() => '')
            )?.trim() || null;
          const nric =
            (
              await cells
                .nth(5)
                .textContent()
                .catch(() => '')
            )?.trim() || null;
          const payType =
            (
              await cells
                .nth(13)
                .textContent()
                .catch(() => '')
            )?.trim() || null;
          const visitType =
            (
              await cells
                .nth(14)
                .textContent()
                .catch(() => '')
            )?.trim() || null;
          const fee =
            (
              await cells
                .nth(8)
                .textContent()
                .catch(() => '')
            )?.trim() || null;

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
        await this.clinicAssist.navigateToQueue(
          process.env.BATCH_BRANCH || '__FIRST__',
          process.env.BATCH_DEPT || 'Reception'
        );
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
        const nricCell = this.clinicAssist.page
          .locator(`td[aria-describedby$="_NRIC"]`)
          .filter({ hasText: queueItem.nric })
          .first();
        if ((await nricCell.count().catch(() => 0)) > 0) {
          row = nricCell.locator('..').first(); // Get parent row
        }

        // If still not found, try contains match
        if (!row || (await row.count().catch(() => 0)) === 0) {
          row = this.clinicAssist.page
            .locator(`tr.jqgrow:has(td[aria-describedby$="_NRIC"]:has-text("${queueItem.nric}"))`)
            .first();
        }
      }

      // Fallback: search by patient name
      if ((!row || (await row.count().catch(() => 0)) === 0) && queueItem.patientName) {
        row = this.clinicAssist.page
          .locator(
            `tr.jqgrow:has(td[aria-describedby$="_PatientName"]:has-text("${queueItem.patientName}"))`
          )
          .first();
      }

      if (!row || (await row.count().catch(() => 0)) === 0) {
        logger.warn(`[BATCH] Could not find row for ${queueItem.patientName || queueItem.nric}`, {
          rowIndex: queueItem.rowIndex,
          nric: queueItem.nric,
          patientName: queueItem.patientName,
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
        logger.warn(
          `[BATCH] Could not open visit record for ${queueItem.patientName || queueItem.nric}`
        );
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
      const validatedNric = nricValidation.isValid
        ? nricValidation.cleaned
        : nric || queueItem.nric;

      if (!nricValidation.isValid && (nric || queueItem.nric)) {
        logger.warn(`[BATCH] Invalid NRIC format for ${queueItem.patientName}`, {
          original: nric || queueItem.nric,
          reason: nricValidation.reason,
        });
      }

      // Extract patient DOB (best-effort). Required by Allianz AMOS portal
      // (Surname + DOB search); useful for several other TPAs that may need DOB.
      // We extract once during Flow 1 and persist to extraction_metadata.flow1.dob
      // so downstream submitters can read it without re-opening ClinicAssist.
      let dobInfo = null;
      try {
        dobInfo = await this.clinicAssist.extractPatientDobFromPatientInfo();
      } catch (e) {
        logger.warn(`[BATCH] DOB extraction threw for ${queueItem.patientName}`, {
          error: e?.message || String(e),
        });
      }
      if (dobInfo?.iso) {
        logger.info(`[BATCH] DOB extracted for ${queueItem.patientName}`, {
          iso: dobInfo.iso,
          source: dobInfo.source,
        });
      } else if (dobInfo?.raw) {
        logger.warn(`[BATCH] DOB found but could not normalize for ${queueItem.patientName}`, {
          raw: dobInfo.raw,
          source: dobInfo.source,
        });
      } else {
        logger.info(`[BATCH] DOB not found for ${queueItem.patientName}`);
      }

      // Validate claim details (already done in extractClaimDetailsFromCurrentVisit, but log again for batch context)
      if (claimDetails) {
        const validationResult = validateClaimDetails(claimDetails);
        logValidationResults(validationResult, queueItem.patientName || validatedNric);
      }

      return {
        ...queueItem,
        nric: validatedNric,
        dob: dobInfo?.iso || null,
        dobRaw: dobInfo?.raw || null,
        dobSource: dobInfo?.source || null,
        claimDetails,
        extracted: true,
        extractedAt: new Date().toISOString(),
        validation: {
          nricValid: nricValidation.isValid,
          nricValidationReason: nricValidation.reason,
          dobFound: Boolean(dobInfo?.iso),
        },
      };
    } catch (error) {
      logger.error(`[BATCH] Error extracting data for ${queueItem.patientName || queueItem.nric}`, {
        error: error.message,
      });
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
    const runMetadata = {
      date: targetDate,
      trigger: skipRunLogging ? 'extract-date-range' : 'manual',
    };
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
        logger.warn(
          '[REPORTS] Could not find QueueReport link, trying direct navigation from Reports context'
        );
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
        logger.warn(
          '[REPORTS] Could not search queue list by date; will try to extract whatever is shown'
        );
      }

      // Extract patient data (Excel export preferred, then grid/iframe)
      await this.clinicAssist.page.waitForTimeout(searchResult ? 3000 : 1000);
      const items = await this.clinicAssist.extractQueueListResults();

      if (items.length === 0) {
        logger.info(
          `[REPORTS] Queue list report returned 0 items for ${targetDate} (report may be empty for this date)`
        );
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

  _toFeeNumber(value) {
    if (value === null || value === undefined) return null;
    const parsed = parseFloat(String(value).replace(/[^0-9.]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  _mergeExtractionMetadata(existingMetadata = null, patch = {}) {
    const current =
      existingMetadata && typeof existingMetadata === 'object' ? existingMetadata : {};
    const next = {
      ...current,
      ...patch,
    };
    const nextFlow1 =
      patch.flow1 && typeof patch.flow1 === 'object'
        ? {
            ...(current.flow1 && typeof current.flow1 === 'object' ? current.flow1 : {}),
            ...patch.flow1,
          }
        : current.flow1;
    if (nextFlow1 && typeof nextFlow1 === 'object') {
      next.flow1 = nextFlow1;
    }
    const nextSources =
      patch.sources && typeof patch.sources === 'object'
        ? {
            ...(current.sources && typeof current.sources === 'object' ? current.sources : {}),
            ...patch.sources,
          }
        : current.sources;
    if (nextSources && typeof nextSources === 'object') {
      next.sources = nextSources;
    }
    return next;
  }

  /**
   * Queue Listing can split one logical visit into two adjacent rows:
   * - Row A: has CONTRACT/payType but 0 fee
   * - Row B: has fee but blank CONTRACT/payType
   * Normalize this so the tagged row carries the fee and the orphan row is dropped.
   */
  _normalizeQueueListingRows(items) {
    if (!Array.isArray(items) || items.length === 0) return items;

    const normalized = items.map(item => ({ ...item }));
    const consumedIndexes = new Set();

    const isLikelyQueueListingRow = item =>
      String(item?.source || '').includes('reports_queue_list');

    for (let i = 0; i < normalized.length; i++) {
      if (consumedIndexes.has(i)) continue;
      const base = normalized[i];
      if (!isLikelyQueueListingRow(base)) continue;
      if (!base?.payType) continue;

      const baseFee = this._toFeeNumber(base.fee);
      if (baseFee !== null && baseFee > 0) continue;

      const baseRowIndex = Number(base.rawRowIndex);
      const baseInv = Number(base.invNo);

      let matchIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let j = i + 1; j < normalized.length; j++) {
        if (consumedIndexes.has(j)) continue;
        const candidate = normalized[j];
        if (!isLikelyQueueListingRow(candidate)) continue;
        if (candidate?.payType) continue;
        if ((candidate?.pcno || null) !== (base?.pcno || null)) continue;
        if ((candidate?.patientName || '').trim() !== (base?.patientName || '').trim()) continue;
        if ((candidate?.spCode || null) !== (base?.spCode || null)) continue;

        const candidateFee = this._toFeeNumber(candidate.fee);
        if (candidateFee === null || candidateFee <= 0) continue;

        const candidateRowIndex = Number(candidate.rawRowIndex);
        const rowDistance =
          Number.isFinite(baseRowIndex) && Number.isFinite(candidateRowIndex)
            ? Math.abs(candidateRowIndex - baseRowIndex)
            : 999;

        const candidateInv = Number(candidate.invNo);
        const invDistance =
          Number.isFinite(baseInv) && Number.isFinite(candidateInv)
            ? Math.abs(candidateInv - baseInv)
            : 0;

        const closeByRows = rowDistance <= 3;
        const nearbyInvoicePair =
          Number.isFinite(invDistance) && invDistance <= 2 && rowDistance <= 20;
        if (!closeByRows && !nearbyInvoicePair) continue;

        if (rowDistance < bestDistance) {
          bestDistance = rowDistance;
          matchIndex = j;
        }
      }

      if (matchIndex >= 0) {
        const donor = normalized[matchIndex];
        base.fee = donor.fee;
        base.mergedFeeFromInvNo = donor.invNo || null;
        consumedIndexes.add(matchIndex);
      }
    }

    const out = normalized.filter((_, idx) => !consumedIndexes.has(idx));
    if (consumedIndexes.size > 0) {
      logger.info('[BATCH] Normalized split queue-listing rows', {
        originalCount: items.length,
        normalizedCount: out.length,
        mergedRows: consumedIndexes.size,
      });
    }
    return out;
  }

  /**
   * Save extracted items to CRM (Supabase)
   * @param {Array} items - Array of extracted visit items
   * @param {string} visitDate - Optional visit date in YYYY-MM-DD format. Defaults to today if not provided.
   * @param {Object} options - Optional behavior flags
   * @param {boolean} options.withDetails - Return per-item save details
   */
  async saveToCRM(items, visitDate = null, options = {}) {
    const itemsToSave = this._normalizeQueueListingRows(items);
    const withDetails = !!options?.withDetails;
    const saveDetails = [];

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
      await writeFile(
        filepath,
        JSON.stringify({ items: itemsToSave, extractedAt: new Date().toISOString() }, null, 2)
      );

      logger.info(`[BATCH] Saved ${itemsToSave.length} items to ${filepath}`);
      if (withDetails) {
        return {
          savedCount: itemsToSave.length,
          total: itemsToSave.length,
          details: itemsToSave.map(item => ({
            status: 'saved_to_json',
            visitId: null,
            message: null,
            patientName: item?.patientName || null,
            nric: item?.nric || null,
            payType: item?.payType || null,
            visitDate: visitDate || null,
            visitRecordNo: item?.invNo || item?.qno || null,
          })),
        };
      }
      return itemsToSave.length;
    }

    // Get system user_id for automated extractions
    // Use environment variable or default to admin user found in system
    const systemUserId =
      process.env.SUPABASE_SYSTEM_USER_ID || 'c80a40d9-18f5-4364-8987-e9dd0178d00c';

    let savedCount = 0;
    // Use provided visitDate, or default to today
    const targetDate = visitDate || new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    for (const item of itemsToSave) {
      try {
        // Parse fee amount - prefer extracted claimAmount, fallback to queue fee
        const feeAmount =
          item.claimDetails?.claimAmount ||
          (item.fee ? parseFloat(item.fee.replace(/[^0-9.]/g, '')) : null);

        // Extract PCNO for deduplication
        const pcno = item.pcno || null;
        // Prefer invoice/visit record number for deduplication (PCNO can repeat on the same day).
        const visitRecordNo = item.invNo || item.qno || null;

        let existingRecord = null;
        let existingMetadata = {};
        let existingSubmissionStatus = null;
        let existingSubmittedAt = null;
        let _existingVisitId = null;

        // Deduplication:
        // Use visit_record_no + visit_date when possible (invoice/record number is unique per visit/claim).
        // Do NOT dedupe solely by PCNO because a patient can have multiple visits/invoices on the same day.
        if (visitRecordNo) {
          const { data: existingByRecordNo } = await this.supabase
            .from('visits')
            .select('id, extraction_metadata, submission_status, submitted_at')
            .eq('visit_date', targetDate)
            .eq('visit_record_no', visitRecordNo)
            .limit(1)
            .maybeSingle();

          if (existingByRecordNo) {
            existingRecord = existingByRecordNo;
            logger.info(
              `[BATCH] Found existing record for record_no ${visitRecordNo} on ${targetDate}, will update instead of insert`
            );
          }
        } else if (pcno) {
          // Last resort: if we have no record number, try to avoid duplicates by PCNO + time_arrived.
          const { data: existingData } = await this.supabase
            .from('visits')
            .select('id, extraction_metadata, time_arrived, submission_status, submitted_at')
            .eq('visit_date', targetDate)
            .not('extraction_metadata', 'is', null)
            .limit(200);

          const matching = (existingData || []).find(v => {
            const md = v.extraction_metadata;
            if (!md || typeof md !== 'object') return false;
            const samePcno = md.pcno === pcno || String(md.pcno) === String(pcno);
            const sameTime = (v.time_arrived || null) === (item.inTime || null);
            return samePcno && sameTime;
          });

          if (matching) {
            existingRecord = matching;
            logger.info(
              `[BATCH] Found existing record for PCNO ${pcno} at ${item.inTime || 'n/a'} on ${targetDate}, will update instead of insert`
            );
          }
        }

        existingMetadata =
          existingRecord?.extraction_metadata &&
          typeof existingRecord.extraction_metadata === 'object'
            ? existingRecord.extraction_metadata
            : {};
        existingSubmissionStatus = existingRecord?.submission_status || null;
        existingSubmittedAt = existingRecord?.submitted_at || null;
        _existingVisitId = existingRecord?.id || null;

        const candidate = classifyVisitForRpa(
          item.payType || null,
          item.patientName || null,
          item.nric || null,
          existingMetadata,
          existingSubmissionStatus
        );
        const claimCandidateReasons = [
          ...new Set(
            [
              ...(Array.isArray(candidate.reasons) ? candidate.reasons : []),
              existingRecord ? 'duplicate_visit' : null,
              existingSubmittedAt ? 'already_submitted' : null,
            ].filter(Boolean)
          ),
        ];

        const mergedExtractionMetadata = this._mergeExtractionMetadata(existingMetadata, {
          extracted: item.extracted,
          extractedAt: item.extractedAt || new Date().toISOString(),
          sources: item.claimDetails?.sources || {},
          pcno: pcno,
          spCode: item.spCode || existingMetadata?.spCode || null,
          claimCandidateStatus: candidate.status,
          claimCandidateReasons,
          claimCandidateEvaluatedAt: new Date().toISOString(),
          flow3PortalRoute: candidate.portalTarget || existingMetadata?.flow3PortalRoute || null,
          flow1: {
            lastIngestedAt: new Date().toISOString(),
            source: item.source || existingMetadata?.flow1?.source || null,
            payType: item.payType || existingMetadata?.flow1?.payType || null,
            rowIndex: item.rowIndex ?? existingMetadata?.flow1?.rowIndex ?? null,
            dedupeDisposition: existingRecord ? 'updated_existing' : 'inserted_new',
            visitRecordNo: visitRecordNo || existingMetadata?.flow1?.visitRecordNo || null,
            // DOB is required by Allianz AMOS portal (Surname + DOB search) and
            // useful for several other TPAs. Stored in metadata to avoid a schema change.
            dob: item.dob || existingMetadata?.flow1?.dob || null,
            dobRaw: item.dobRaw || existingMetadata?.flow1?.dobRaw || null,
            dobSource: item.dobSource || existingMetadata?.flow1?.dobSource || null,
          },
        });

        // Prepare visit data
        const visitData = {
          user_id: systemUserId, // Required field
          visit_date: targetDate,
          time_arrived: item.inTime || null,
          time_left: item.outTime || null,
          patient_name: item.patientName || null,
          visit_record_no: visitRecordNo,
          total_amount: feeAmount,
          amount_outstanding: feeAmount,

          // Metadata
          source: 'Clinic Assist',
          extraction_metadata: mergedExtractionMetadata,
        };

        // Preserve existing classification/identity data if queue row does not provide it.
        if (item.payType) visitData.pay_type = item.payType;
        if (item.visitType) visitData.visit_type = item.visitType;
        if (item.nric) visitData.nric = item.nric;

        // Only update detailed clinical fields when we actually extracted claim details.
        // Queue-listing refresh rows intentionally do not carry diagnosis/MC detail.
        if (item.claimDetails) {
          visitData.diagnosis_description = item.claimDetails?.diagnosisText || null;
          visitData.symptoms = item.claimDetails?.notesText || null;
          visitData.treatment_detail = item.claimDetails?.items?.join('\n') || null;
          visitData.mc_required = (item.claimDetails?.mcDays || 0) > 0;
          visitData.mc_start_date = (item.claimDetails?.mcDays || 0) > 0 ? targetDate : null;
          visitData.mc_end_date = (item.claimDetails?.mcDays || 0) > 0 ? targetDate : null;
        }

        let data = null;
        let error = null;

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
          const insertResult = await this.supabase.from('visits').insert(visitData).select();

          data = insertResult.data;
          error = insertResult.error;

          // If insert fails due to duplicate (unique constraint on visit_record_no), try update
          if (error && error.code === '23505') {
            // Unique violation
            const { data: updateData, error: updateError } = await this.supabase
              .from('visits')
              .update(visitData)
              .eq('visit_record_no', visitRecordNo)
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
          logger.error(`[BATCH] Failed to save visit for ${item.patientName}`, {
            error: error.message,
          });
          if (withDetails) {
            saveDetails.push({
              status: 'error',
              visitId: null,
              message: error.message,
              patientName: item?.patientName || null,
              nric: item?.nric || null,
              payType: item?.payType || null,
              visitDate: targetDate,
              visitRecordNo: visitRecordNo || null,
            });
          }
        } else {
          savedCount++;
          const savedVisitId = data?.[0]?.id || null;
          logger.info(`[BATCH] Saved visit for ${item.patientName}`, { visitId: savedVisitId });
          if (withDetails) {
            saveDetails.push({
              status: 'saved',
              visitId: savedVisitId,
              message: null,
              patientName: item?.patientName || null,
              nric: item?.nric || null,
              payType: item?.payType || null,
              visitDate: targetDate,
              visitRecordNo: visitRecordNo || null,
            });
          }
        }
      } catch (error) {
        logger.error(`[BATCH] Error saving ${item.patientName}`, { error: error.message });
        if (withDetails) {
          const visitRecordNo = item?.invNo || item?.qno || null;
          saveDetails.push({
            status: 'error',
            visitId: null,
            message: error.message,
            patientName: item?.patientName || null,
            nric: item?.nric || null,
            payType: item?.payType || null,
            visitDate: targetDate,
            visitRecordNo,
          });
        }
      }
    }

    this.steps.step(6, `Saved ${savedCount}/${itemsToSave.length} items to CRM`);
    if (withDetails) {
      return {
        savedCount,
        total: itemsToSave.length,
        details: saveDetails,
      };
    }
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
