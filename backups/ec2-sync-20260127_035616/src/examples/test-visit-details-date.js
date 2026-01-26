import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { VisitDetailsExtractor } from '../core/visit-details-extractor.js';
import { createSupabaseClient } from '../utils/supabase-client.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/**
 * Test script to extract visit details for a specific date
 * Shows automation in headed browser for visits from 2025-12-14
 * 
 * Usage:
 *   node src/examples/test-visit-details-date.js
 */
async function testVisitDetailsForDate() {
  // Get date from command line argument or use 2026-01-12 (date with visits)
  const args = process.argv.slice(2);
  const targetDate = args[0] || '2026-01-12'; // Default to January 12, 2026
  
  logger.info('=== Visit Details Extraction Test (Specific Date) ===');
  logger.info(`Target Date: ${targetDate}`);
  logger.info('Opening visible browser to show the automation...\n');

  // Initialize Supabase client
  const supabase = createSupabaseClient();
  if (!supabase) {
    logger.error('Supabase client not available. Check environment variables.');
    process.exit(1);
  }

  // Query for visits from the specific date
  logger.info(`Querying database for visits from ${targetDate}...`);
  
  const { data: allVisits, error: queryError } = await supabase
    .from('visits')
    .select('id, patient_name, visit_date, visit_record_no, nric, extraction_metadata')
    .eq('source', 'Clinic Assist')
    .eq('visit_date', targetDate)
    .not('patient_name', 'is', null)
    .order('patient_name', { ascending: true });

  if (queryError) {
    logger.error('Failed to query visits:', queryError.message);
    process.exit(1);
  }

  if (!allVisits || allVisits.length === 0) {
    logger.info(`No visits found for ${targetDate}.`);
    logger.info('Make sure visits exist in the database for this date.');
    process.exit(0);
  }

  // Filter visits missing diagnosis
  const visitsToProcess = allVisits.filter(visit => {
    const metadata = visit.extraction_metadata || {};
    const status = metadata.detailsExtractionStatus;
    // Process if no diagnosis or not completed
    return !visit.diagnosis_description && status !== 'completed';
  });

  if (visitsToProcess.length === 0) {
    logger.info(`Found ${allVisits.length} visit(s) for ${targetDate}, but all already have diagnosis.`);
    process.exit(0);
  }

  logger.info(`Found ${allVisits.length} total visit(s) for ${targetDate}`);
  logger.info(`${visitsToProcess.length} visit(s) need diagnosis extraction`);
  
  // Limit to first 5 visits for demo (or specify limit as second argument)
  const maxVisits = args[1] ? parseInt(args[1], 10) : 5;
  const limitedVisits = visitsToProcess.slice(0, maxVisits);
  
  if (visitsToProcess.length > maxVisits) {
    logger.info(`Processing first ${maxVisits} visits for demo (${visitsToProcess.length - maxVisits} remaining)`);
  }
  
  logger.info('\nVisits to process:');
  limitedVisits.forEach((visit, i) => {
    logger.info(`  ${i + 1}. ${visit.patient_name} (Visit Record: ${visit.visit_record_no || 'N/A'})`);
  });
  logger.info('');

  // Create browser manager and force headed mode
  const browserManager = new BrowserManager();
  const { BROWSER_CONFIG } = await import('../config/portals.js');
  const originalHeadless = BROWSER_CONFIG.headless;
  BROWSER_CONFIG.headless = false; // Force visible browser

  try {
    const page = await browserManager.newPage();
    const extractor = new VisitDetailsExtractor(page, supabase);
    
    // Login once
    logger.info('Opening browser and logging in to Clinic Assist...');
    logger.info('Watch the browser window to see the automation!\n');
    await extractor.clinicAssist.login();

    // Process visits
    logger.info(`Starting extraction for ${limitedVisits.length} visit(s) from ${targetDate}...\n`);
    logger.info('For each visit, you will see:');
    logger.info('  1. Navigate to Patient Page');
    logger.info('  2. Search for patient by name');
    logger.info('  3. Open patient record');
    logger.info('  4. Navigate to TX History');
    logger.info('  5. Open Diagnosis Tab');
    logger.info('  6. Extract diagnosis\n');

    const startTime = Date.now();
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < limitedVisits.length; i++) {
      const visit = limitedVisits[i];
      logger.info(`\n${'='.repeat(70)}`);
      logger.info(`Visit ${i + 1}/${limitedVisits.length}`);
      logger.info(`Patient: ${visit.patient_name}`);
      logger.info(`Visit Date: ${visit.visit_date}`);
      logger.info(`Visit Record No: ${visit.visit_record_no || 'N/A'}`);
      logger.info(`${'='.repeat(70)}\n`);

      const result = await extractor.extractForVisit(visit);

      if (result.success) {
        successCount++;
        logger.info(`\n✅ Successfully extracted:`);
        logger.info(`   Diagnosis: ${result.diagnosis?.substring(0, 200)}${result.diagnosis?.length > 200 ? '...' : ''}`);
      } else {
        failCount++;
        logger.error(`\n❌ Extraction failed:`);
        logger.error(`   Error: ${result.error}`);
      }

      // Small delay between visits
      if (i < limitedVisits.length - 1) {
        await page.waitForTimeout(2000);
      }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`\n${'='.repeat(70)}`);
    logger.info('=== Extraction Complete ===');
    logger.info(`${'='.repeat(70)}`);
    logger.info(`Date: ${targetDate}`);
    logger.info(`Total visits processed: ${limitedVisits.length}`);
    logger.info(`Total visits available: ${visitsToProcess.length}`);
    logger.info(`✅ Success: ${successCount}`);
    logger.info(`❌ Failed: ${failCount}`);
    logger.info(`Time taken: ${totalTime}s`);
    logger.info(`\nKeeping browser open for 30 seconds for inspection...`);
    logger.info('Press Ctrl+C to close immediately\n');

    await page.waitForTimeout(30000);

  } catch (error) {
    logger.error('Error during extraction:', error);
    logger.info('Keeping browser open for 30 seconds for debugging...');
    if (typeof page !== 'undefined') {
      await page.waitForTimeout(30000);
    }
  } finally {
    BROWSER_CONFIG.headless = originalHeadless;
    await browserManager.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testVisitDetailsForDate().catch(error => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });
}

export { testVisitDetailsForDate };
