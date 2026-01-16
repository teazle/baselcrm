import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/**
 * Find and interact with the output format selector to export as Excel
 */
async function interactFormatSelector() {
  const browserManager = new BrowserManager();
  
  try {
    await browserManager.init();
    const page = await browserManager.newPage();

    logger.info('=== Interacting with Format Selector ===');
    
    const clinicAssist = new ClinicAssistAutomation(page);
    
    // Login and navigate
    await clinicAssist.login();
    await clinicAssist.navigateToReports();
    await clinicAssist.navigateToQueueListReport();
    await clinicAssist.searchQueueListByDate('2025-12-27');
    await page.waitForTimeout(8000);
    
    // Use frameLocator to access nested iframe
    logger.info('Accessing nested iframe to find format selector...');
    
    const outerFrame = page.frameLocator('iframe[src*="ReportViewer"], iframe[src*="queueListing"]');
    const nestedFrame = outerFrame.frameLocator('iframe').first();
    
    // Try to find format selector elements
    logger.info('Looking for format selector elements...');
    
    // Wait for nested iframe to be available
    try {
      await nestedFrame.locator('body').waitFor({ timeout: 10000 });
    } catch (e) {
      logger.warn('Nested iframe not accessible yet, waiting longer...');
      await page.waitForTimeout(5000);
    }
    
    // Get all select elements
    const selectCount = await nestedFrame.locator('select').count();
    logger.info(`Found ${selectCount} select element(s)`);
    
    if (selectCount > 0) {
      // Get first select and check its options
      const firstSelect = nestedFrame.locator('select').first();
      const options = await firstSelect.locator('option').allTextContents();
      logger.info(`Select options: ${options.join(', ')}`);
      
      // Try to select Excel option
      const excelOption = options.find(opt => opt.toLowerCase().includes('excel') || opt.toLowerCase().includes('xls'));
      if (excelOption) {
        logger.info(`Found Excel option: ${excelOption}`);
        await firstSelect.selectOption({ label: excelOption });
        await page.waitForTimeout(2000);
      }
    }
    
    // Look for radio buttons
    const radioCount = await nestedFrame.locator('input[type="radio"]').count();
    logger.info(`Found ${radioCount} radio button(s)`);
    
    if (radioCount > 0) {
      // Get radio buttons
      const radios = await nestedFrame.locator('input[type="radio"]').all();
      for (const radio of radios) {
        const value = await radio.getAttribute('value');
        const checked = await radio.isChecked();
        logger.info(`Radio: value=${value}, checked=${checked}`);
        
        if (value && (value.toLowerCase().includes('excel') || value.toLowerCase().includes('xls'))) {
          logger.info(`Selecting Excel radio: ${value}`);
          await radio.check();
          await page.waitForTimeout(2000);
        }
      }
    }
    
    // Look for buttons to submit/apply the format selection
    const buttonCount = await nestedFrame.locator('button, input[type="button"], input[type="submit"]').count();
    logger.info(`Found ${buttonCount} button(s)`);
    
    // Try to find and click submit/apply button
    const submitButtons = ['Submit', 'Apply', 'Generate', 'Export', 'View', 'Show', 'OK'];
    for (const btnText of submitButtons) {
      try {
        const btn = nestedFrame.locator(`button:has-text("${btnText}"), input[value*="${btnText}" i]`).first();
        if (await btn.count() > 0) {
          logger.info(`Found button: ${btnText}, clicking...`);
          await btn.click();
          await page.waitForTimeout(3000);
          break;
        }
      } catch (e) {
        // Continue to next button
      }
    }
    
    // Set up download listener for Excel file
    logger.info('Setting up download listener...');
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
    
    // Look for Excel export/download links/buttons
    const excelButtons = await nestedFrame.locator('a, button').filter({ hasText: /excel|download|export/i }).all();
    logger.info(`Found ${excelButtons.length} Excel-related link(s)/button(s)`);
    
    for (const btn of excelButtons) {
      try {
        const text = await btn.textContent();
        logger.info(`Clicking Excel export: ${text}`);
        await btn.click();
        await page.waitForTimeout(2000);
        
        // Check if download started
        const download = await downloadPromise;
        if (download) {
          logger.info(`Download started: ${download.suggestedFilename()}`);
          const path = await download.path();
          logger.info(`File saved to: ${path}`);
          break;
        }
      } catch (e) {
        logger.warn(`Error clicking Excel button: ${e.message}`);
      }
    }
    
    // Take screenshot after interaction
    await page.screenshot({ path: 'screenshots/format-selector-interaction.png', fullPage: true });
    logger.info('Screenshot saved to: screenshots/format-selector-interaction.png');
    
    // Extract current text content to see what changed
    const bodyText = await nestedFrame.locator('body').textContent().catch(() => '');
    logger.info(`\nCurrent nested iframe text (first 500 chars):`);
    logger.info(bodyText.substring(0, 500));
    
    logger.info('\n=== Keeping browser open for 120 seconds ===');
    await new Promise(resolve => setTimeout(resolve, 120000));
    
  } catch (error) {
    logger.error('Interaction failed:', error);
    await page.screenshot({ path: 'screenshots/format-selector-error.png', fullPage: true });
    throw error;
  } finally {
    await browserManager.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  interactFormatSelector().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { interactFormatSelector };
