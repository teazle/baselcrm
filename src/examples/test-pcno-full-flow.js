import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { BatchExtraction } from '../core/batch-extraction.js';
import { VisitDetailsExtractor } from '../core/visit-details-extractor.js';
import { createSupabaseClient } from '../utils/supabase-client.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/**
 * Full end-to-end test of PCNO-based extraction:
 * 1. Extract queue list for a date (gets PCNO from Excel)
 * 2. Extract visit details using PCNO for patient search
 */
async function testPcnoFullFlow() {
  const targetDate = '2026-01-14'; // Date to test with
  
  logger.info('=== Full PCNO Flow Test ===');
  logger.info(`Target Date: ${targetDate}\n`);

  const supabase = createSupabaseClient();
  const browserManager = new BrowserManager();
  const page = await browserManager.newPage();

  try {
    // Step 1: Extract queue list (this will get PCNO from Excel)
    logger.info('Step 1: Extracting queue list from Clinic Assist Reports...');
    logger.info('This will extract PCNO (patient numbers) from the Excel report.\n');
    
    const batchExtraction = new BatchExtraction(page);
    await batchExtraction.clinicAssist.login();
    
    // Navigate to Reports and extract queue list
    await batchExtraction.clinicAssist.navigateToReports();
    await page.waitForTimeout(2000);
    
    const items = await batchExtraction.extractFromReportsQueueList(targetDate);
    
    logger.info(`\n✅ Extracted ${items.length} items from queue list`);
    
    // Count how many have PCNO
    const withPcno = items.filter(item => item.pcno && /^\d{4,5}$/.test(String(item.pcno).trim()));
    logger.info(`   Items with PCNO: ${withPcno.length}`);
    
    if (withPcno.length === 0) {
      logger.warn('⚠️  No items have PCNO. Cannot test PCNO-based search.');
      logger.warn('   The extraction will fall back to patient name search.');
    } else {
      logger.info(`   Sample PCNOs: ${withPcno.slice(0, 5).map(i => i.pcno).join(', ')}\n`);
    }
    
    // Step 2: Save to CRM (this saves PCNO in extraction_metadata)
    logger.info('Step 2: Saving extracted data to CRM (with PCNO)...');
    const savedCount = await batchExtraction.saveToCRM(items, targetDate);
    logger.info(`✅ Saved ${savedCount} visits to CRM\n`);
    
    // Step 3: Get visits that need diagnosis extraction
    logger.info('Step 3: Testing visit details extraction using PCNO...');
    
    const { data: visitsToProcess } = await supabase
      .from('visits')
      .select('*')
      .eq('source', 'Clinic Assist')
      .eq('visit_date', targetDate)
      .is('extraction_metadata->detailsExtractionStatus', null)
      .limit(3); // Test with first 3 visits
    
    if (!visitsToProcess || visitsToProcess.length === 0) {
      logger.info('No visits need diagnosis extraction. Using existing visits...');
      const { data: existingVisits } = await supabase
        .from('visits')
        .select('*')
        .eq('source', 'Clinic Assist')
        .eq('visit_date', targetDate)
        .limit(3);
      
      if (existingVisits && existingVisits.length > 0) {
        visitsToProcess = existingVisits;
      } else {
        logger.error('No visits found for testing');
        return;
      }
    }
    
    logger.info(`Processing ${visitsToProcess.length} visit(s) for diagnosis extraction...\n`);
    
    // Step 4: Extract visit details (should use PCNO if available)
    const visitExtractor = new VisitDetailsExtractor(page, supabase);
    
    let pcnoUsed = 0;
    let nameUsed = 0;
    
    for (let i = 0; i < visitsToProcess.length; i++) {
      const visit = visitsToProcess[i];
      const pcno = visit.extraction_metadata?.pcno;
      const hasPcno = pcno && /^\d{4,5}$/.test(String(pcno).trim());
      
      logger.info(`${'='.repeat(70)}`);
      logger.info(`Visit ${i + 1}/${visitsToProcess.length}: ${visit.patient_name}`);
      logger.info(`  PCNO: ${pcno || 'NOT SET'}`);
      logger.info(`  Will use: ${hasPcno ? 'PCNO search' : 'Name search (fallback)'}`);
      logger.info(`${'='.repeat(70)}\n`);
      
      const result = await visitExtractor.extractForVisit(visit);
      
      if (result.success) {
        logger.info(`✅ Successfully extracted diagnosis`);
        if (hasPcno) {
          pcnoUsed++;
          logger.info(`   ✅ Used PCNO-based search`);
        } else {
          nameUsed++;
          logger.info(`   ℹ️  Used name-based search (PCNO not available)`);
        }
      } else {
        logger.error(`❌ Failed: ${result.error}`);
      }
      
      // Small delay between visits
      if (i < visitsToProcess.length - 1) {
        await page.waitForTimeout(2000);
      }
    }
    
    // Summary
    logger.info(`\n${'='.repeat(70)}`);
    logger.info('=== Test Summary ===');
    logger.info(`${'='.repeat(70)}`);
    logger.info(`Total visits processed: ${visitsToProcess.length}`);
    logger.info(`✅ PCNO-based searches: ${pcnoUsed}`);
    logger.info(`ℹ️  Name-based searches (fallback): ${nameUsed}`);
    logger.info(`${'='.repeat(70)}`);
    
  } catch (error) {
    logger.error('Fatal error during test:', error);
    throw error;
  } finally {
    await browserManager.close();
  }
}

testPcnoFullFlow().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
