import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { BatchExtraction } from '../core/batch-extraction.js';
import { createSupabaseClient } from '../utils/supabase-client.js';
import { logger } from '../utils/logger.js';
import { registerRunExitHandler, markRunFinalized } from '../utils/run-exit-handler.js';

dotenv.config();

/**
 * Extract queue list data for a date range
 * Processes dates from start to end, skipping dates that already have data
 * 
 * Usage:
 *   node src/examples/extract-date-range.js
 *   node src/examples/extract-date-range.js 2025-12-27 2026-01-12
 */
async function extractDateRange() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const startDateStr = args[0] || '2025-12-27'; // Default: Dec 27, 2025
  const endDateStr = args[1] || new Date().toISOString().split('T')[0]; // Default: today

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

  // Query existing dates from database
  const supabase = createSupabaseClient();
  if (!supabase) {
    logger.error('Supabase client not available. Check environment variables.');
    process.exit(1);
  }

  const runMetadata = { startDate: startDateStr, endDate: endDateStr, trigger: 'manual' };
  const runId = await startRun(supabase, runMetadata);
  if (runId) {
    const updateRunBound = (id, updates) => updateRun(supabase, id, updates);
    registerRunExitHandler(supabase, runId, updateRunBound);
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
    await updateRun(supabase, runId, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      error_message: queryError.message,
    });
    process.exit(1);
  }

  // Extract unique dates
  const existingDates = new Set(
    (existingDatesData || [])
      .map(row => row.visit_date)
      .filter(Boolean)
  );

  logger.info(`Found ${existingDates.size} dates with existing data in range`);

  // Generate date array
  const datesToProcess = [];
  const currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    if (!existingDates.has(dateStr)) {
      datesToProcess.push(dateStr);
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  if (datesToProcess.length === 0) {
    logger.info('All dates in range already have data. Nothing to process.');
    await updateRun(supabase, runId, {
      status: 'completed',
      finished_at: new Date().toISOString(),
      metadata: { ...runMetadata, reason: 'no_dates' },
    });
    markRunFinalized();
    process.exit(0);
  }

  logger.info(`Processing ${datesToProcess.length} dates: ${datesToProcess[0]} to ${datesToProcess[datesToProcess.length - 1]}`);

  const browserManager = new BrowserManager();
  const batchExtractor = new BatchExtraction(await browserManager.newPage());

  let totalRecords = 0;
  let completedCount = 0;
  let failedCount = 0;

  const results = {
    total: datesToProcess.length,
    success: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  try {
    // Initialize browser and login once (reuse session)
    logger.info('Initializing browser and logging in...');
    await batchExtractor.clinicAssist.login();

    // Process each date
    for (let i = 0; i < datesToProcess.length; i++) {
      const date = datesToProcess[i];
      logger.info(`\n[${i + 1}/${datesToProcess.length}] Processing date: ${date}`);

      try {
        // Extract data for this date (we already track run in extract-date-range; skip per-date runs)
        const items = await batchExtractor.extractFromReportsQueueList(date, { skipRunLogging: true });

        if (!items || items.length === 0) {
          logger.warn(`No items extracted for ${date}`);
          results.skipped++;
          continue;
        }

        logger.info(`Extracted ${items.length} items for ${date}`);

        // Prepare items for saving
        const extractedItems = items.map(item => ({
          ...item,
          extracted: true,
          extractedAt: new Date().toISOString(),
          claimDetails: item.claimDetails || null,
        }));

        // Save to CRM with the correct visit date
        const savedCount = await batchExtractor.saveToCRM(extractedItems, date);

        totalRecords += items.length;
        completedCount += savedCount;
        failedCount += Math.max(items.length - savedCount, 0);
        await updateRun(supabase, runId, {
          total_records: totalRecords,
          completed_count: completedCount,
          failed_count: failedCount,
        });

        if (savedCount > 0) {
          logger.info(`✅ Successfully saved ${savedCount}/${items.length} items for ${date}`);
          results.success++;
        } else {
          logger.warn(`⚠️ No items saved for ${date} (extracted ${items.length})`);
          results.failed++;
          results.errors.push({ date, error: 'No items saved' });
        }

        // Small delay between dates to avoid overwhelming the system
        if (i < datesToProcess.length - 1) {
          await batchExtractor.clinicAssist.page.waitForTimeout(2000);
        }

      } catch (error) {
        logger.error(`❌ Error processing ${date}:`, error.message);
        results.failed++;
        results.errors.push({ date, error: error.message });
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

    if (results.failed > 0) {
      await updateRun(supabase, runId, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        total_records: totalRecords,
        completed_count: completedCount,
        failed_count: failedCount,
        metadata: { ...runMetadata, skippedCount: results.skipped },
        error_message: 'One or more dates failed',
      });
      markRunFinalized();
      process.exit(1);
    }

    await updateRun(supabase, runId, {
      status: 'completed',
      finished_at: new Date().toISOString(),
      total_records: totalRecords,
      completed_count: completedCount,
      failed_count: failedCount,
      metadata: { ...runMetadata, skippedCount: results.skipped },
    });
    markRunFinalized();

  } catch (error) {
    logger.error('Fatal error during extraction:', error);
    await updateRun(supabase, runId, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      total_records: totalRecords,
      completed_count: completedCount,
      failed_count: failedCount,
      metadata: { ...runMetadata, skippedCount: results.skipped },
      error_message: error.message || String(error),
    });
    markRunFinalized();
    process.exit(1);
  } finally {
    await browserManager.close();
  }
}

async function startRun(supabase, metadata) {
  try {
    const { data, error } = await supabase
      .from('rpa_extraction_runs')
      .insert({
        run_type: 'queue_list',
        status: 'running',
        started_at: new Date().toISOString(),
        metadata,
      })
      .select('id')
      .single();
    if (error) {
      logger.error('[DATE-RANGE] Failed to create run record', { error: error.message });
      return null;
    }
    return data?.id ?? null;
  } catch (error) {
    logger.error('[DATE-RANGE] Error creating run record', { error: error.message });
    return null;
  }
}

async function updateRun(supabase, runId, updates) {
  if (!supabase || !runId) return;
  try {
    const { error } = await supabase
      .from('rpa_extraction_runs')
      .update(updates)
      .eq('id', runId);
    if (error) {
      logger.error('[DATE-RANGE] Failed to update run record', { error: error.message });
    }
  } catch (error) {
    logger.error('[DATE-RANGE] Error updating run record', { error: error.message });
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
