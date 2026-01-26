import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { BatchExtraction } from '../core/batch-extraction.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/**
 * Test extraction from Reports → Queue List and save to CRM
 * Extracts data for 27 December 2025
 */
async function testReportsExtraction() {
  const browserManager = new BrowserManager();
  
  try {
    await browserManager.init();
    const page = await browserManager.newPage();

    logger.info('=== Starting Reports Queue List Extraction Test ===');
    
    const batchExtractor = new BatchExtraction(page);
    
    // Step 1: Login
    logger.info('Step 1: Logging in to Clinic Assist...');
    await batchExtractor.clinicAssist.login();
    
    // Step 2: Extract from Reports → Queue List for 27 December 2025
    const targetDate = '2025-12-27'; // 27 December 2025
    logger.info(`Step 2: Extracting from Reports → Queue List for date: ${targetDate}`);
    
    const items = await batchExtractor.extractFromReportsQueueList(targetDate);
    
    if (!items || items.length === 0) {
      logger.error('No items extracted from Queue List report');
      logger.info('Keeping browser open for 60 seconds for manual inspection...');
      await new Promise(resolve => setTimeout(resolve, 60000));
      return;
    }
    
    logger.info(`Found ${items.length} items from Queue List report`);
    
    // Display extracted items
    logger.info('\n=== Extracted Items ===');
    items.slice(0, 5).forEach((item, idx) => {
      logger.info(`[${idx + 1}] ${item.patientName || 'Unknown'} - ${item.nric || 'No NRIC'}`);
      logger.info(`    PayType: ${item.payType || 'N/A'}, VisitType: ${item.visitType || 'N/A'}`);
      logger.info(`    Fee: ${item.fee || 'N/A'}, Status: ${item.status || 'N/A'}`);
      logger.info(`    Source: ${item.source || 'N/A'}`);
    });
    
    // Prepare items for saving (add extracted flag)
    const extractedItems = items.map(item => ({
      ...item,
      extracted: true,
      extractedAt: new Date().toISOString(),
      // Since we're extracting from reports, we might not have full claim details
      // But we can still save the basic visit information
      claimDetails: item.claimDetails || null,
    }));
    
    // Step 3: Save to CRM
    logger.info('\nStep 3: Saving extracted items to CRM...');
    const savedCount = await batchExtractor.saveToCRM(extractedItems);
    
    logger.info(`\n=== Extraction Complete ===`);
    logger.info(`Total items extracted: ${items.length}`);
    logger.info(`Items saved to CRM: ${savedCount}`);
    
    if (savedCount > 0) {
      logger.info('✅ Successfully extracted and saved data to CRM!');
    } else {
      logger.warn('⚠️ No items were saved to CRM. Check logs for errors.');
    }
    
    // Keep browser open for review
    logger.info('\nKeeping browser open for 60 seconds for review...');
    await new Promise(resolve => setTimeout(resolve, 60000));
    
  } catch (error) {
    logger.error('Test extraction failed:', error);
    throw error;
  } finally {
    await browserManager.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testReportsExtraction().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { testReportsExtraction };

