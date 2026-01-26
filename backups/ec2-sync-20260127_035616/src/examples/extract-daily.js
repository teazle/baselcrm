import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { BatchExtraction } from '../core/batch-extraction.js';
import { createSupabaseClient } from '../utils/supabase-client.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/**
 * Daily automation script - extracts data for yesterday's date
 * Designed to be run via cron job
 * 
 * Exit codes:
 *   0 - Success (data extracted or already exists)
 *   1 - Failure (error during extraction)
 * 
 * Usage:
 *   node src/examples/extract-daily.js
 */
async function extractDaily() {
  // Calculate yesterday's date (to avoid processing incomplete current day data)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD format

  logger.info('=== Daily Extraction ===');
  logger.info(`Target date: ${yesterdayStr} (yesterday)`);

  // Check if data already exists for yesterday
  const supabase = createSupabaseClient();
  if (!supabase) {
    logger.error('Supabase client not available. Check environment variables.');
    process.exit(1);
  }

  const runMetadata = { date: yesterdayStr, trigger: 'cron' };
  const runId = await startRun(supabase, runMetadata);

  logger.info('Checking if data already exists for yesterday...');
  const { count, error: countError } = await supabase
    .from('visits')
    .select('*', { count: 'exact', head: true })
    .eq('source', 'Clinic Assist')
    .eq('visit_date', yesterdayStr);

  if (countError) {
    logger.error('Failed to check existing data:', countError.message);
    process.exit(1);
  }

  if (count > 0) {
    logger.info(`✅ Data already exists for ${yesterdayStr} (${count} visits). Skipping extraction.`);
    await updateRun(supabase, runId, {
      status: 'completed',
      finished_at: new Date().toISOString(),
      total_records: count,
      completed_count: count,
      failed_count: 0,
      metadata: { ...runMetadata, reason: 'already_exists' },
    });
    process.exit(0);
  }

  logger.info(`No data found for ${yesterdayStr}. Starting extraction...`);

  const browserManager = new BrowserManager();
  const batchExtractor = new BatchExtraction(await browserManager.newPage());

  try {
    // Login
    logger.info('Logging in to Clinic Assist...');
    await batchExtractor.clinicAssist.login();

    // Extract data for yesterday
    logger.info(`Extracting data for ${yesterdayStr}...`);
    const items = await batchExtractor.extractFromReportsQueueList(yesterdayStr, { skipRunLogging: true });

    if (!items || items.length === 0) {
      logger.warn(`No items extracted for ${yesterdayStr}`);
      await updateRun(supabase, runId, {
        status: 'completed',
        finished_at: new Date().toISOString(),
        total_records: 0,
        completed_count: 0,
        failed_count: 0,
        metadata: { ...runMetadata, reason: 'no_items' },
      });
      // This is not necessarily an error - there might genuinely be no visits
      // Exit with success code
      process.exit(0);
    }

    logger.info(`Extracted ${items.length} items for ${yesterdayStr}`);

    // Prepare items for saving
    const extractedItems = items.map(item => ({
      ...item,
      extracted: true,
      extractedAt: new Date().toISOString(),
      claimDetails: item.claimDetails || null,
    }));

    // Save to CRM
    logger.info('Saving items to CRM...');
    const savedCount = await batchExtractor.saveToCRM(extractedItems);

    if (savedCount > 0) {
      logger.info(`✅ Successfully saved ${savedCount}/${items.length} items for ${yesterdayStr}`);
      await updateRun(supabase, runId, {
        status: 'completed',
        finished_at: new Date().toISOString(),
        total_records: items.length,
        completed_count: savedCount,
        failed_count: Math.max(items.length - savedCount, 0),
        metadata: runMetadata,
      });
      process.exit(0);
    } else {
      logger.warn(`⚠️ No items saved for ${yesterdayStr} (extracted ${items.length})`);
      await updateRun(supabase, runId, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        total_records: items.length,
        completed_count: 0,
        failed_count: items.length,
        metadata: runMetadata,
        error_message: 'No items saved',
      });
      // This could indicate an error, but we'll exit with success to avoid false alarms
      // The warning log will be visible in cron logs
      process.exit(0);
    }

  } catch (error) {
    logger.error('Error during daily extraction:', error.message);
    logger.error('Stack trace:', error.stack);
    await updateRun(supabase, runId, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      metadata: runMetadata,
      error_message: error.message || String(error),
    });
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
      logger.error('[DAILY] Failed to create run record', { error: error.message });
      return null;
    }
    return data?.id ?? null;
  } catch (error) {
    logger.error('[DAILY] Error creating run record', { error: error.message });
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
      logger.error('[DAILY] Failed to update run record', { error: error.message });
    }
  } catch (error) {
    logger.error('[DAILY] Error updating run record', { error: error.message });
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  extractDaily().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { extractDaily };
