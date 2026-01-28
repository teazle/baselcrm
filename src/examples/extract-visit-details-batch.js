import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { VisitDetailsExtractor } from '../core/visit-details-extractor.js';
import { createSupabaseClient } from '../utils/supabase-client.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/**
 * Extract visit details (diagnosis and services/drugs) for visits missing diagnosis
 * Supports resume capability and progress tracking
 * 
 * Usage:
 *   node src/examples/extract-visit-details-batch.js
 *   node src/examples/extract-visit-details-batch.js --retry-failed
 */
async function extractVisitDetailsBatch() {
  const args = process.argv.slice(2);
  const retryFailed = args.includes('--retry-failed');

  logger.info('=== Visit Details Extraction Batch ===');
  if (retryFailed) {
    logger.info('Mode: Retry failed visits');
  }

  // Initialize Supabase client
  const supabase = createSupabaseClient();
  if (!supabase) {
    logger.error('Supabase client not available. Check environment variables.');
    process.exit(1);
  }

  // Query for visits missing diagnosis
  logger.info('Querying database for visits missing diagnosis...');
  
  const batchSize = parseInt(process.env.VISIT_DETAILS_BATCH_SIZE || '100', 10);
  const maxRetries = parseInt(process.env.VISIT_DETAILS_MAX_RETRIES || '3', 10);

  // Build query: visits missing diagnosis, with status filtering for resume
  // Filter to specific date if specified via --date argument
  // Filter to only portal-related pay types (MHC, FULLERT, IHP, ALL, ALLIANZ, AIA, GE)
  const dateArg = args.find(arg => arg.startsWith('--date='));
  const targetDate = dateArg ? dateArg.split('=')[1] : null;
  const payTypeArg = args.find(arg => arg.startsWith('--pay-type='));
  const targetPayType = payTypeArg ? payTypeArg.split('=')[1].toUpperCase() : null;
  const allPayTypes = args.includes('--all-pay-types');
  
  // Known portal pay types that require form submission
  const portalPayTypes = ['MHC', 'FULLERT', 'IHP', 'ALL', 'ALLIANZ', 'AIA', 'GE', 'AIACLIENT'];
  
  let query = supabase
    .from('visits')
    .select('id, patient_name, visit_date, visit_record_no, nric, pay_type, extraction_metadata')
    .eq('source', 'Clinic Assist')
    .is('diagnosis_description', null)
    .not('patient_name', 'is', null);
  
  if (targetDate) {
    query = query.eq('visit_date', targetDate);
    logger.info(`Filtering to date: ${targetDate}`);
  }
  
  // Filter by specific pay type, or only portal pay types by default
  if (targetPayType) {
    query = query.eq('pay_type', targetPayType);
    logger.info(`Filtering to pay type: ${targetPayType}`);
  } else if (!allPayTypes) {
    // Default: only process visits with portal-related pay types
    query = query.in('pay_type', portalPayTypes);
    logger.info(`Filtering to portal pay types: ${portalPayTypes.join(', ')}`);
  }
  
  query = query.order('visit_date', { ascending: false }).limit(batchSize);

  // Execute query and filter in JavaScript (PostgREST JSONB filtering can be complex)
  const { data: allVisits, error: queryError } = await query;

  if (queryError) {
    logger.error('Failed to query visits:', queryError.message);
    process.exit(1);
  }

  if (!allVisits || allVisits.length === 0) {
    logger.info('No visits found that need diagnosis extraction.');
    process.exit(0);
  }

  // Filter visits by status for resume capability
  const visitsToProcess = allVisits.filter(visit => {
    const metadata = visit.extraction_metadata || {};
    const status = metadata.detailsExtractionStatus;
    const attempts = metadata.detailsExtractionAttempts || 0;

    // Skip completed visits
    if (status === 'completed') {
      return false;
    }

    // If retry-failed mode, only process failed visits
    if (retryFailed && status !== 'failed') {
      return false;
    }

    // Skip failed visits that exceeded max retries (unless retry-failed mode)
    if (status === 'failed' && attempts >= maxRetries && !retryFailed) {
      return false;
    }

    // Process: null, pending, in_progress (treat as pending for resume), or failed (with retries left)
    return true;
  });

  if (visitsToProcess.length === 0) {
    logger.info('No visits to process. All visits are either completed or exceeded retry limit.');
    process.exit(0);
  }

  logger.info(`Found ${allVisits.length} visits missing diagnosis`);
  logger.info(`Processing ${visitsToProcess.length} visits (${allVisits.length - visitsToProcess.length} skipped)`);

  // Initialize browser and extractor
  const browserManager = new BrowserManager();
  const page = await browserManager.newPage();
  const extractor = new VisitDetailsExtractor(page, supabase);

  try {
    // Login once (browser session reuse)
    logger.info('Initializing browser and logging in to Clinic Assist...');
    await extractor.clinicAssist.login();

    // Track progress
    const progress = {
      total: visitsToProcess.length,
      completed: 0,
      failed: 0,
      skipped: 0,
      startTime: Date.now(),
    };

    // Process visits in batch
    logger.info(`\nStarting batch extraction for ${visitsToProcess.length} visits...`);
    logger.info(`Max retries: ${maxRetries}, Batch size: ${batchSize}`);

    const results = await extractor.extractBatch(visitsToProcess, { maxRetries });

    progress.completed = results.completed;
    progress.failed = results.failed;
    progress.skipped = results.skipped;

    // Calculate statistics
    const elapsed = (Date.now() - progress.startTime) / 1000; // seconds
    const successRate = progress.total > 0 
      ? ((progress.completed / progress.total) * 100).toFixed(1) 
      : 0;
    const avgTimePerVisit = progress.completed > 0 
      ? (elapsed / progress.completed).toFixed(1) 
      : 0;

    // Summary report
    logger.info('\n=== Extraction Summary ===');
    logger.info(`Total visits processed: ${progress.total}`);
    logger.info(`✅ Completed: ${progress.completed}`);
    logger.info(`❌ Failed: ${progress.failed}`);
    logger.info(`⏭️  Skipped: ${progress.skipped}`);
    logger.info(`Success rate: ${successRate}%`);
    logger.info(`Time elapsed: ${elapsed.toFixed(1)}s`);
    if (avgTimePerVisit > 0) {
      logger.info(`Average time per visit: ${avgTimePerVisit}s`);
    }

    // Log failed visits for reference
    if (results.failed > 0) {
      const failedVisits = results.details.filter(r => !r.success);
      logger.info(`\nFailed visits (${failedVisits.length}):`);
      failedVisits.slice(0, 10).forEach(result => {
        const visit = visitsToProcess.find(v => v.id === result.visitId);
        logger.info(`  - Visit ${result.visitId}: ${visit?.patient_name || 'Unknown'} (${visit?.visit_date || 'Unknown'}) - ${result.error || 'Unknown error'}`);
      });
      if (failedVisits.length > 10) {
        logger.info(`  ... and ${failedVisits.length - 10} more`);
      }
    }

    // Exit with appropriate code
    if (progress.failed > 0 && progress.completed === 0) {
      // All failed
      process.exit(1);
    } else if (progress.failed > 0) {
      // Some failed, but some succeeded
      process.exit(0); // Still successful run (partial success)
    }

  } catch (error) {
    logger.error('Fatal error during batch extraction:', error);
    process.exit(1);
  } finally {
    await browserManager.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  extractVisitDetailsBatch().catch(error => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });
}

export { extractVisitDetailsBatch };
