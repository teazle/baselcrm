import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { VisitDetailsExtractor } from '../core/visit-details-extractor.js';
import { createSupabaseClient } from '../utils/supabase-client.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/**
 * Demo script to show visit details extraction in a visible browser
 * Processes all available visits so you can watch the full automation
 * 
 * Usage:
 *   node src/examples/demo-visit-details-extraction.js
 *   node src/examples/demo-visit-details-extraction.js 5  (limit to 5 visits)
 */
async function demoVisitDetailsExtraction() {
  const args = process.argv.slice(2);
  const maxVisits = args[0] ? parseInt(args[0], 10) : null; // Optional limit
  
  logger.info('=== Visit Details Extraction Demo (Headed Browser) ===');
  logger.info('This will open a visible browser window to show the automation');
  if (maxVisits) {
    logger.info(`Processing up to ${maxVisits} visits for demonstration...\n`);
  } else {
    logger.info('Processing all available visits to show full automation...\n');
  }

  // Initialize Supabase client
  const supabase = createSupabaseClient();
  if (!supabase) {
    logger.error('Supabase client not available. Check environment variables.');
    process.exit(1);
  }

  // Query for visits missing diagnosis
  logger.info('Querying database for visits missing diagnosis...');
  
  const batchSize = maxVisits || 100; // Process all available or up to limit
  
  const { data: allVisits, error: queryError } = await supabase
    .from('visits')
    .select('id, patient_name, visit_date, visit_record_no, nric, extraction_metadata')
    .eq('source', 'Clinic Assist')
    .is('diagnosis_description', null)
    .not('patient_name', 'is', null)
    .order('visit_date', { ascending: false })
    .limit(batchSize);

  if (queryError) {
    logger.error('Failed to query visits:', queryError.message);
    process.exit(1);
  }

  if (!allVisits || allVisits.length === 0) {
    logger.info('No visits found that need diagnosis extraction.');
    logger.info('All visits may already have diagnosis, or no visits exist in database.');
    process.exit(0);
  }

  // Filter out completed visits
  const visitsToProcess = allVisits.filter(visit => {
    const metadata = visit.extraction_metadata || {};
    const status = metadata.detailsExtractionStatus;
    return status !== 'completed';
  });

  if (visitsToProcess.length === 0) {
    logger.info('No visits to process. All visits are already completed.');
    process.exit(0);
  }

  logger.info(`Found ${visitsToProcess.length} visit(s) to process for demo`);
  if (visitsToProcess.length <= 10) {
    logger.info('Visits to process:');
    visitsToProcess.forEach((visit, i) => {
      logger.info(`  ${i + 1}. ${visit.patient_name} (${visit.visit_date})`);
    });
  } else {
    logger.info('First 5 visits:');
    visitsToProcess.slice(0, 5).forEach((visit, i) => {
      logger.info(`  ${i + 1}. ${visit.patient_name} (${visit.visit_date})`);
    });
    logger.info(`  ... and ${visitsToProcess.length - 5} more`);
  }
  logger.info('');

  // Create browser manager and force headed mode for demo
  const browserManager = new BrowserManager();
  
  // Temporarily override headless setting for demo
  // Save original value and set to false (headed mode)
  const { BROWSER_CONFIG } = await import('../config/portals.js');
  const originalHeadless = BROWSER_CONFIG.headless;
  BROWSER_CONFIG.headless = false; // Force visible browser for demo

  try {
    const page = await browserManager.newPage();
    const extractor = new VisitDetailsExtractor(page, supabase);
    
    // Login once (browser session reuse)
    logger.info('Opening browser and logging in to Clinic Assist...');
    logger.info('Watch the browser window to see the automation in action!\n');
    await extractor.clinicAssist.login();

    // Process visits
    logger.info(`Starting extraction for ${visitsToProcess.length} visit(s)...\n`);
    logger.info('Watch the browser window to see the full automation:');
    logger.info('  For each visit, you will see:');
    logger.info('    1. Navigate to Patient Page');
    logger.info('    2. Search for patient by name');
    logger.info('    3. Open patient record from search results');
    logger.info('    4. Navigate to TX History (Treatment History)');
    logger.info('    5. Open Diagnosis Tab');
    logger.info('    6. Extract diagnosis');
    logger.info('    7. Update database with extracted data\n');
    
    const startTime = Date.now();
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < visitsToProcess.length; i++) {
      const visit = visitsToProcess[i];
      logger.info(`\n${'='.repeat(60)}`);
      logger.info(`Processing Visit ${i + 1}/${visitsToProcess.length}`);
      logger.info(`Patient: ${visit.patient_name}`);
      logger.info(`Visit Date: ${visit.visit_date}`);
      logger.info(`Visit Record No: ${visit.visit_record_no || 'N/A'}`);
      logger.info(`${'='.repeat(60)}\n`);

      const result = await extractor.extractForVisit(visit);

      if (result.success) {
        successCount++;
        logger.info(`\n✅ Successfully extracted details for visit ${i + 1}:`);
        logger.info(`   Patient: ${visit.patient_name}`);
        logger.info(`   Diagnosis: ${result.diagnosis?.substring(0, 200)}${result.diagnosis?.length > 200 ? '...' : ''}`);
        if (result.treatmentDetail) {
          logger.info(`   Treatment Detail: ${result.treatmentDetail.substring(0, 100)}${result.treatmentDetail.length > 100 ? '...' : ''}`);
        }
      } else {
        failCount++;
        logger.error(`\n❌ Failed to extract details for visit ${i + 1}:`);
        logger.error(`   Patient: ${visit.patient_name}`);
        logger.error(`   Error: ${result.error}`);
      }

      // Progress update every 5 visits
      if ((i + 1) % 5 === 0 || i === visitsToProcess.length - 1) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const avgTime = (elapsed / (i + 1)).toFixed(1);
        logger.info(`\n[Progress] ${i + 1}/${visitsToProcess.length} visits processed`);
        logger.info(`[Progress] Success: ${successCount}, Failed: ${failCount}`);
        logger.info(`[Progress] Time elapsed: ${elapsed}s, Avg: ${avgTime}s per visit\n`);
      }

      // Small delay between visits
      if (i < visitsToProcess.length - 1) {
        await page.waitForTimeout(1000); // Reduced delay for faster demo
      }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`\n${'='.repeat(60)}`);
    logger.info('=== Demo Complete ===');
    logger.info(`${'='.repeat(60)}`);
    logger.info(`Total visits processed: ${visitsToProcess.length}`);
    logger.info(`✅ Successfully extracted: ${successCount}`);
    logger.info(`❌ Failed: ${failCount}`);
    logger.info(`Total time: ${totalTime}s`);
    logger.info(`Average time per visit: ${(totalTime / visitsToProcess.length).toFixed(1)}s`);
    logger.info(`\nKeeping browser open for 30 seconds so you can inspect the results...`);
    logger.info('Press Ctrl+C to close the browser immediately\n');

    // Keep browser open for inspection
    await page.waitForTimeout(30000);

  } catch (error) {
    logger.error('Error during demo:', error);
    logger.info('Keeping browser open for 30 seconds for debugging...');
    await page.waitForTimeout(30000);
  } finally {
    // Restore original headless setting
    BROWSER_CONFIG.headless = originalHeadless;
    await browserManager.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demoVisitDetailsExtraction().catch(error => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });
}

export { demoVisitDetailsExtraction };
