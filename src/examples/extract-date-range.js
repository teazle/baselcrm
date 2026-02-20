import 'dotenv/config';
import { BrowserManager } from '../utils/browser.js';
import { BatchExtraction } from '../core/batch-extraction.js';
import { createSupabaseClient } from '../utils/supabase-client.js';
import { logger } from '../utils/logger.js';
import { resolveFlow3PortalTarget } from '../../apps/crm/src/lib/rpa/portals.shared.js';
import { portalTargetToLabel, writeRunSummaryReport } from '../utils/run-summary-report.js';

/**
 * Extract queue list data for a date range
 * Processes dates from start to end, skipping dates that already have data
 *
 * Usage:
 *   node src/examples/extract-date-range.js
 *   node src/examples/extract-date-range.js 2025-12-27 2026-01-12
 *   node src/examples/extract-date-range.js 2026-02-13 2026-02-13 --force
 */
async function extractDateRange() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const positionalArgs = args.filter(arg => !arg.startsWith('--'));
  const startDateStr = positionalArgs[0] || '2025-12-27'; // Default: Dec 27, 2025
  const endDateStr = positionalArgs[1] || new Date().toISOString().split('T')[0]; // Default: today

  // Validate date format (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(startDateStr) || !dateRegex.test(endDateStr)) {
    logger.error('Invalid date format. Use YYYY-MM-DD format (e.g., 2025-12-27)');
    process.exit(1);
  }

  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    logger.error('Invalid dates provided');
    process.exit(1);
  }

  if (startDate > endDate) {
    logger.error('Start date must be before or equal to end date');
    process.exit(1);
  }

  logger.info('=== Date Range Extraction ===');
  logger.info(`Date range: ${startDateStr} to ${endDateStr}`);
  logger.info(`Force replay existing dates: ${force}`);
  const reportRows = [];

  // Query existing dates from database
  const supabase = createSupabaseClient();
  if (!supabase) {
    logger.error('Supabase client not available. Check environment variables.');
    process.exit(1);
  }

  logger.info('Querying existing visit dates from database...');
  const { data: existingDatesData, error: queryError } = await supabase
    .from('visits')
    .select('visit_date')
    .eq('source', 'Clinic Assist')
    .gte('visit_date', startDateStr)
    .lte('visit_date', endDateStr);

  if (queryError) {
    logger.error('Failed to query existing dates:', queryError.message);
    process.exit(1);
  }

  // Extract unique dates
  const existingDates = new Set(
    (existingDatesData || []).map(row => row.visit_date).filter(Boolean)
  );

  logger.info(`Found ${existingDates.size} dates with existing data in range`);

  // Generate date array
  const datesToProcess = [];
  const currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    if (force || !existingDates.has(dateStr)) {
      datesToProcess.push(dateStr);
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  if (datesToProcess.length === 0) {
    logger.info('All dates in range already have data. Nothing to process.');
    const totals = {
      total_dates: 0,
      successful_dates: 0,
      failed_dates: 0,
      skipped_dates: 0,
      extracted_rows: 0,
      saved_rows: 0,
    };
    const report = await writeRunSummaryReport({
      flowName: 'Flow 1 Queue Extraction',
      filePrefix: 'flow1',
      scope: {
        from: startDateStr,
        to: endDateStr,
        date: null,
        payType: 'All',
        portalTargets: 'N/A',
        visitIds: 'N/A',
      },
      totals,
      rows: [
        {
          date: `${startDateStr}..${endDateStr}`,
          patientName: '-',
          nric: '-',
          payType: '-',
          portal: '-',
          status: 'no_dates_to_process',
          diagnosisStatus: '-',
          notes: 'All dates already exist in DB for this range',
        },
      ],
    });
    logger.info(`Flow 1 summary report: ${report.mdPath}`);
    process.exit(0);
  }

  logger.info(
    `Processing ${datesToProcess.length} dates: ${datesToProcess[0]} to ${datesToProcess[datesToProcess.length - 1]}`
  );

  const browserManager = new BrowserManager();
  const batchExtractor = new BatchExtraction(await browserManager.newPage());
  let reportTotals = {
    total_dates: datesToProcess.length,
    successful_dates: 0,
    failed_dates: 0,
    skipped_dates: 0,
    extracted_rows: 0,
    saved_rows: 0,
  };

  try {
    // Initialize browser and login once (reuse session)
    logger.info('Initializing browser and logging in...');
    await batchExtractor.clinicAssist.login();

    const results = {
      total: datesToProcess.length,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };

    // Process each date
    for (let i = 0; i < datesToProcess.length; i++) {
      const date = datesToProcess[i];
      logger.info(`\n[${i + 1}/${datesToProcess.length}] Processing date: ${date}`);

      try {
        // Extract data for this date
        const items = await batchExtractor.extractFromReportsQueueList(date);

        if (!items || items.length === 0) {
          logger.warn(`No items extracted for ${date}`);
          results.skipped++;
          reportRows.push({
            date,
            patientName: '-',
            nric: '-',
            payType: '-',
            portal: '-',
            status: 'no_data',
            diagnosisStatus: '-',
            notes: 'No queue-list rows extracted',
          });
          continue;
        }

        logger.info(`Extracted ${items.length} items for ${date}`);
        reportTotals.extracted_rows += items.length;

        // Prepare items for saving
        const extractedItems = items.map(item => ({
          ...item,
          extracted: true,
          extractedAt: new Date().toISOString(),
          claimDetails: item.claimDetails || null,
        }));

        // Save to CRM with the correct visit date
        const saveResult = await batchExtractor.saveToCRM(extractedItems, date, {
          withDetails: true,
        });
        const savedCount =
          typeof saveResult === 'number' ? saveResult : Number(saveResult?.savedCount || 0);
        const detailRows = Array.isArray(saveResult?.details) ? saveResult.details : [];
        reportTotals.saved_rows += savedCount;

        if (savedCount > 0) {
          logger.info(`✅ Successfully saved ${savedCount}/${items.length} items for ${date}`);
          results.success++;
        } else {
          logger.warn(`⚠️ No items saved for ${date} (extracted ${items.length})`);
          results.failed++;
          results.errors.push({ date, error: 'No items saved' });
        }

        if (detailRows.length > 0) {
          for (const item of detailRows) {
            const route = resolveFlow3PortalTarget(item.payType, item.patientName, null);
            reportRows.push({
              date: item.visitDate || date,
              patientName: item.patientName || '-',
              nric: item.nric || '-',
              payType: item.payType || '-',
              portal: portalTargetToLabel(route || item.payType || 'Unknown'),
              status: item.status || 'unknown',
              diagnosisStatus: '-',
              notes: item.message || '',
            });
          }
        } else {
          for (const item of extractedItems) {
            const route = resolveFlow3PortalTarget(item.payType, item.patientName, null);
            reportRows.push({
              date,
              patientName: item.patientName || '-',
              nric: item.nric || '-',
              payType: item.payType || '-',
              portal: portalTargetToLabel(route || item.payType || 'Unknown'),
              status: savedCount > 0 ? 'save_attempted' : 'save_failed',
              diagnosisStatus: '-',
              notes: '',
            });
          }
        }

        // Small delay between dates to avoid overwhelming the system
        if (i < datesToProcess.length - 1) {
          await batchExtractor.clinicAssist.page.waitForTimeout(2000);
        }
      } catch (error) {
        logger.error(`❌ Error processing ${date}:`, error.message);
        results.failed++;
        results.errors.push({ date, error: error.message });
        reportRows.push({
          date,
          patientName: '-',
          nric: '-',
          payType: '-',
          portal: '-',
          status: 'date_failed',
          diagnosisStatus: '-',
          notes: error.message,
        });
        // Continue with next date instead of stopping
      }
    }

    // Summary report
    logger.info('\n=== Extraction Summary ===');
    logger.info(`Total dates processed: ${results.total}`);
    logger.info(`Successful: ${results.success}`);
    logger.info(`Failed: ${results.failed}`);
    logger.info(`Skipped (no data): ${results.skipped}`);

    if (results.errors.length > 0) {
      logger.info('\nErrors:');
      results.errors.forEach(({ date, error }) => {
        logger.info(`  ${date}: ${error}`);
      });
    }
    reportTotals = {
      total_dates: results.total,
      successful_dates: results.success,
      failed_dates: results.failed,
      skipped_dates: results.skipped,
      extracted_rows: reportTotals.extracted_rows,
      saved_rows: reportTotals.saved_rows,
    };
    const report = await writeRunSummaryReport({
      flowName: 'Flow 1 Queue Extraction',
      filePrefix: 'flow1',
      scope: {
        from: startDateStr,
        to: endDateStr,
        date: null,
        payType: 'All',
        portalTargets: 'N/A',
        visitIds: 'N/A',
      },
      totals: reportTotals,
      rows: reportRows,
    });
    logger.info(`Flow 1 summary report: ${report.mdPath}`);

    if (results.failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    logger.error('Fatal error during extraction:', error);
    const report = await writeRunSummaryReport({
      flowName: 'Flow 1 Queue Extraction',
      filePrefix: 'flow1',
      scope: {
        from: startDateStr,
        to: endDateStr,
        date: null,
        payType: 'All',
        portalTargets: 'N/A',
        visitIds: 'N/A',
      },
      totals: reportTotals,
      rows: [
        ...reportRows,
        {
          date: `${startDateStr}..${endDateStr}`,
          patientName: '-',
          nric: '-',
          payType: '-',
          portal: '-',
          status: 'fatal_error',
          diagnosisStatus: '-',
          notes: error?.message || String(error),
        },
      ],
    });
    logger.info(`Flow 1 summary report: ${report.mdPath}`);
    process.exit(1);
  } finally {
    await browserManager.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  extractDateRange().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { extractDateRange };
