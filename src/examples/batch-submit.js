import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClaimSubmitter } from '../core/claim-submitter.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/**
 * Batch submission: Submit all pending claims from CRM to appropriate portals
 */
async function batchSubmit() {
  const browserManager = new BrowserManager();
  
  try {
    await browserManager.init();
    const page = await browserManager.newPage();

  try {
    logger.info('=== Starting Batch Submission ===');
    
    const payType = process.env.SUBMIT_PAY_TYPE || null; // null = all pay types

    logger.info('Parameters:', { payType: payType || 'ALL' });

    const submitter = new ClaimSubmitter(page);
    const result = await submitter.submitAllPendingClaims(payType);

    logger.info('=== Batch Submission Completed ===');
    logger.info('Result:', {
      total: result.total,
      successful: result.successful,
      failed: result.failed,
    });

    // Keep browser open for review
    const keepOpenMs = process.env.SUBMIT_KEEP_OPEN_MS ? Number(process.env.SUBMIT_KEEP_OPEN_MS) : 60000;
    if (keepOpenMs > 0) {
      logger.info(`Keeping browser open for ${keepOpenMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, keepOpenMs));
    }
  } catch (error) {
    logger.error('Batch submission failed:', error);
    throw error;
  } finally {
    await browserManager.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  batchSubmit().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { batchSubmit };

