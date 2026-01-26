import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { BatchExtraction } from '../core/batch-extraction.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/**
 * Demo extraction: Extract 1 patient from Clinic Assist queue
 */
async function demoExtract() {
  const browserManager = new BrowserManager();
  
  try {
    await browserManager.init();
    const page = await browserManager.newPage();

    logger.info('=== Starting Demo Extraction (1 patient) ===');
    
    const branchName = process.env.BATCH_BRANCH || '__FIRST__';
    const deptName = process.env.BATCH_DEPT || 'Reception';

    logger.info('Parameters:', { branchName, deptName });

    const batchExtractor = new BatchExtraction(page);
    
    // Step 1: Login and navigate to queue
    logger.info('Step 1: Logging in to Clinic Assist...');
    await batchExtractor.clinicAssist.login();
    
    logger.info('Step 2: Navigating to queue...');
    await batchExtractor.clinicAssist.navigateToQueue(branchName, deptName);
    
    // Step 2: Get all queue items
    logger.info('Step 3: Getting queue items...');
    const queueItems = await batchExtractor.getAllQueueItems();
    
    logger.info(`Found ${queueItems.length} queue items`);
    
    if (queueItems.length === 0) {
      logger.warn('No queue items found in queue. Trying fallback: Reports → Queue List...');
      
      // Fallback: Try to get patient from reports/queue list
      const reportsItems = await batchExtractor.extractFromReportsQueueList();
      
      if (reportsItems && reportsItems.length > 0) {
        logger.info(`Found ${reportsItems.length} items from reports queue list`);
        queueItems.push(...reportsItems);
      } else {
        logger.error('No items found in queue or reports. Exiting.');
        return;
      }
    }
    
    // Step 3: Extract only the first item
    const firstItem = queueItems[0];
    logger.info('Step 4: Extracting first patient:', {
      patientName: firstItem.patientName,
      nric: firstItem.nric,
      payType: firstItem.payType,
      visitType: firstItem.visitType,
      qno: firstItem.qno
    });
    
    const extracted = await batchExtractor.extractQueueItemData(firstItem);
    
    if (extracted.extracted) {
      logger.info('=== Extraction Successful ===');
      logger.info('Extracted Data:', {
        patientName: extracted.patientName,
        nric: extracted.nric,
        claimDetails: {
          mcDays: extracted.claimDetails?.mcDays,
          diagnosis: extracted.claimDetails?.diagnosisText?.substring(0, 100) + '...',
          itemsCount: extracted.claimDetails?.items?.length || 0,
          claimAmount: extracted.claimDetails?.claimAmount,
          referralClinic: extracted.claimDetails?.referralClinic
        }
      });
      
      // Pretty print the full extracted data
      console.log('\n=== Full Extracted Data ===');
      console.log(JSON.stringify(extracted, null, 2));
      
      // Save to CRM
      logger.info('Step 5: Saving to CRM...');
      const saved = await batchExtractor.saveToCRM([extracted]);
      logger.info(`Saved ${saved} item(s) to CRM`);
      
      if (saved > 0) {
        logger.info('✅ Demo extraction completed and saved to CRM!');
      }
    } else {
      logger.error('Extraction failed:', {
        reason: extracted.reason,
        error: extracted.error
      });
    }

    // Keep browser open for review (60 seconds default)
    const keepOpenMs = process.env.DEMO_KEEP_OPEN_MS ? Number(process.env.DEMO_KEEP_OPEN_MS) : 60000;
    if (keepOpenMs > 0) {
      logger.info(`Keeping browser open for ${keepOpenMs}ms for review...`);
      await new Promise(resolve => setTimeout(resolve, keepOpenMs));
    }
  } catch (error) {
    logger.error('Demo extraction failed:', error);
    throw error;
  } finally {
    await browserManager.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demoExtract().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { demoExtract };

