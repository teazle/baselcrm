import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { logger } from '../utils/logger.js';
import { safeExit } from '../utils/safe-exit.js';

dotenv.config();

/**
 * Test script to verify safe-exit functionality
 * This simulates a process that should clean up browsers properly
 */
async function testSafeExit() {
  const browserManager = new BrowserManager();
  
  try {
    logger.info('=== Testing Safe Exit ===');
    logger.info('Initializing browser...');
    
    await browserManager.init();
    const page = await browserManager.newPage();
    
    logger.info('Browser initialized. Navigating to test page...');
    await page.goto('https://example.com');
    
    logger.info('Page loaded. Waiting 2 seconds...');
    await page.waitForTimeout(2000);
    
    logger.info('Test completed successfully. Exiting with safeExit(0)...');
    
    // This should trigger cleanup
    await safeExit(0);
    
  } catch (error) {
    logger.error('Test failed:', error);
    await safeExit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testSafeExit().catch(async (error) => {
    console.error('Fatal error:', error);
    await safeExit(1);
  });
}

export { testSafeExit };
