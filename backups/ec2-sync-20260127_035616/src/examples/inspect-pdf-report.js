import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/**
 * Navigate to the Queue Report page and keep browser open for inspection
 */
async function inspectPDFReport() {
  const browserManager = new BrowserManager();
  
  try {
    await browserManager.init();
    const page = await browserManager.newPage();

    logger.info('=== Inspecting PDF Report ===');
    
    const clinicAssist = new ClinicAssistAutomation(page);
    
    // Step 1: Login
    logger.info('Step 1: Logging in to Clinic Assist...');
    await clinicAssist.login();
    
    // Step 2: Navigate to Reports → Queue List
    logger.info('Step 2: Navigating to Reports → Queue List...');
    await clinicAssist.navigateToReports();
    await clinicAssist.navigateToQueueListReport();
    
    // Step 3: Set date to 27 December 2025
    logger.info('Step 3: Setting date to 27/12/2025...');
    await clinicAssist.searchQueueListByDate('2025-12-27');
    
    // Step 4: Wait for report to load
    logger.info('Step 4: Waiting for report to load...');
    await page.waitForTimeout(10000);
    
    // Take a screenshot
    await page.screenshot({ path: 'screenshots/queue-report-inspection.png', fullPage: true });
    
    logger.info('=== Inspection Ready ===');
    logger.info('Browser will stay open for 300 seconds for manual inspection...');
    logger.info('Screenshot saved to: screenshots/queue-report-inspection.png');
    
    // Keep browser open for inspection
    await new Promise(resolve => setTimeout(resolve, 300000));
    
  } catch (error) {
    logger.error('Inspection failed:', error);
    throw error;
  } finally {
    await browserManager.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  inspectPDFReport().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { inspectPDFReport };
