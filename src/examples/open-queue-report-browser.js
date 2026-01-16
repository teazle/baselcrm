import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/**
 * Open Queue Report page in browser and keep it open for manual inspection
 */
async function openQueueReport() {
  const browserManager = new BrowserManager();
  
  try {
    await browserManager.init();
    const page = await browserManager.newPage();

    logger.info('=== Opening Queue Report for Browser Inspection ===');
    
    const clinicAssist = new ClinicAssistAutomation(page);
    
    // Login
    logger.info('Logging in...');
    await clinicAssist.login();
    
    // Navigate to Reports
    logger.info('Navigating to Reports...');
    await clinicAssist.navigateToReports();
    await page.waitForTimeout(2000);
    
    // Navigate to Queue Report
    logger.info('Navigating to Queue Report...');
    await clinicAssist.navigateToQueueListReport();
    await page.waitForTimeout(2000);
    
    // Select date 27 December 2025
    logger.info('Selecting date 27/12/2025...');
    const dateStr = '2025-12-27';
    await clinicAssist.searchQueueListByDate(dateStr);
    await page.waitForTimeout(5000);
    
    logger.info('✅ Queue Report page opened. Check the browser window.');
    logger.info('Browser will stay open for manual inspection...');
    
    // Keep browser open indefinitely (until manually closed)
    await new Promise(() => {}); // Never resolves
    
  } catch (error) {
    logger.error('Error:', error);
    throw error;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  openQueueReport().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { openQueueReport };

