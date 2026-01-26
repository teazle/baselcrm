import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { BatchExtraction } from '../core/batch-extraction.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/**
 * Batch extraction: Extract all queue items from today and save to CRM
 */
async function batchExtract() {
  const browserManager = new BrowserManager();
  
  try {
    await browserManager.init();
    const page = await browserManager.newPage();

    logger.info('=== Starting Batch Extraction ===');
    
    const branchName = process.env.BATCH_BRANCH || '__FIRST__';
    const deptName = process.env.BATCH_DEPT || 'Reception';

    logger.info('Parameters:', { branchName, deptName });

    const batchExtractor = new BatchExtraction(page);
    const result = await batchExtractor.extractAllQueueItemsToday(branchName, deptName);

    logger.info('=== Batch Extraction Completed ===');
    logger.info('Result:', result);

    // Keep browser open for review
    const keepOpenMs = process.env.BATCH_KEEP_OPEN_MS ? Number(process.env.BATCH_KEEP_OPEN_MS) : 60000;
    if (keepOpenMs > 0) {
      logger.info(`Keeping browser open for ${keepOpenMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, keepOpenMs));
    }
  } catch (error) {
    logger.error('Batch extraction failed:', error);
    throw error;
  } finally {
    await browserManager.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  batchExtract().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { batchExtract };

