import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/**
 * Find Excel download button in the Queue Report page
 * This script will inspect all buttons/links to find the correct Excel export button
 */
async function findExcelButton() {
  const browserManager = new BrowserManager();
  
  try {
    await browserManager.init();
    const page = await browserManager.newPage();

    logger.info('=== Finding Excel Download Button ===');
    
    const clinicAssist = new ClinicAssistAutomation(page);
    
    // Login and navigate
    await clinicAssist.login();
    await clinicAssist.navigateToReports();
    await clinicAssist.navigateToQueueListReport();
    await clinicAssist.searchQueueListByDate('2025-12-27');
    await page.waitForTimeout(10000); // Wait for report to load
    
    logger.info('\n=== Inspecting Main Page ===');
    
    // Find all buttons/links on main page
    const mainPageButtons = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [onclick]'));
      return buttons
        .filter(btn => {
          const rect = btn.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map(btn => ({
          text: (btn.textContent || btn.value || btn.innerText || '').trim(),
          tag: btn.tagName.toLowerCase(),
          id: btn.id || '',
          className: btn.className || '',
          href: btn.href || '',
          onclick: btn.getAttribute('onclick') || '',
          type: btn.type || '',
          location: 'main_page'
        }));
    });
    
    logger.info(`Found ${mainPageButtons.length} buttons/links on main page`);
    mainPageButtons.forEach((btn, idx) => {
      if (btn.text.toLowerCase().includes('excel') || btn.text.toLowerCase().includes('export') || 
          btn.text.toLowerCase().includes('download') || btn.text.toLowerCase().includes('xls')) {
        logger.info(`  [${idx + 1}] EXCEL-RELATED: ${btn.text} (${btn.tag}, id: ${btn.id}, onclick: ${btn.onclick.substring(0, 100)})`);
      }
    });
    
    // Check outer iframe
    logger.info('\n=== Inspecting Outer Iframe (ReportViewer) ===');
    try {
      const outerFrame = page.frameLocator('iframe[src*="ReportViewer"], iframe[src*="queueListing"]');
      const outerButtons = await outerFrame.locator('button, a, input[type="button"], [onclick]').all();
      
      logger.info(`Found ${outerButtons.length} buttons/links in outer iframe`);
      for (let idx = 0; idx < outerButtons.length; idx++) {
        try {
          const btn = outerButtons[idx];
          const text = await btn.textContent().catch(() => '');
          const id = await btn.getAttribute('id').catch(() => '');
          const className = await btn.getAttribute('class').catch(() => '');
          const href = await btn.getAttribute('href').catch(() => '');
          const onclick = await btn.getAttribute('onclick').catch(() => '');
          const tag = await btn.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
          
          const lowerText = text.toLowerCase();
          if (lowerText.includes('excel') || lowerText.includes('export') || 
              lowerText.includes('download') || lowerText.includes('xls') ||
              href.includes('.xlsx') || href.includes('.xls') ||
              onclick.toLowerCase().includes('excel') || onclick.toLowerCase().includes('export')) {
            logger.info(`  [${idx + 1}] EXCEL-RELATED: "${text}" (${tag}, id: ${id}, className: ${className})`);
            logger.info(`      href: ${href.substring(0, 200)}`);
            logger.info(`      onclick: ${onclick.substring(0, 200)}`);
          }
        } catch (e) {
          // Skip this button
        }
      }
    } catch (e) {
      logger.warn(`Error inspecting outer iframe: ${e.message}`);
    }
    
    // Check nested iframe (the actual report viewer)
    logger.info('\n=== Inspecting Nested Iframe (Report Content) ===');
    try {
      const outerFrame = page.frameLocator('iframe[src*="ReportViewer"], iframe[src*="queueListing"]');
      const nestedFrame = outerFrame.frameLocator('iframe').first();
      
      await nestedFrame.locator('body').waitFor({ timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(3000);
      
      const nestedButtons = await nestedFrame.locator('button, a, input[type="button"], [onclick], select, input[type="radio"]').all();
      
      logger.info(`Found ${nestedButtons.length} interactive elements in nested iframe`);
      for (let idx = 0; idx < nestedButtons.length; idx++) {
        try {
          const btn = nestedButtons[idx];
          const text = await btn.textContent().catch(() => '');
          const id = await btn.getAttribute('id').catch(() => '');
          const className = await btn.getAttribute('class').catch(() => '');
          const href = await btn.getAttribute('href').catch(() => '');
          const onclick = await btn.getAttribute('onclick').catch(() => '');
          const tag = await btn.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
          const type = await btn.getAttribute('type').catch(() => '');
          const value = await btn.getAttribute('value').catch(() => '');
          
          const lowerText = (text || value || '').toLowerCase();
          const lowerOnclick = (onclick || '').toLowerCase();
          const lowerHref = (href || '').toLowerCase();
          
          if (lowerText.includes('excel') || lowerText.includes('export') || 
              lowerText.includes('download') || lowerText.includes('xls') ||
              lowerText.includes('format') ||
              lowerHref.includes('.xlsx') || lowerHref.includes('.xls') ||
              lowerOnclick.includes('excel') || lowerOnclick.includes('export') ||
              lowerOnclick.includes('xls') || lowerOnclick.includes('format')) {
            logger.info(`  [${idx + 1}] POTENTIAL EXPORT: "${text || value}" (${tag}, type: ${type}, id: ${id})`);
            logger.info(`      className: ${className}`);
            logger.info(`      href: ${href.substring(0, 200)}`);
            logger.info(`      onclick: ${onclick.substring(0, 300)}`);
            
            // If it's a select/radio, get options
            if (tag === 'select') {
              const options = await btn.locator('option').allTextContents().catch(() => []);
              logger.info(`      Options: ${options.join(', ')}`);
            } else if (tag === 'input' && type === 'radio') {
              const name = await btn.getAttribute('name').catch(() => '');
              const checked = await btn.isChecked().catch(() => false);
              logger.info(`      name: ${name}, checked: ${checked}`);
            }
          }
        } catch (e) {
          // Skip this element
        }
      }
    } catch (e) {
      logger.warn(`Error inspecting nested iframe: ${e.message}`);
    }
    
    // Take screenshot
    await page.screenshot({ path: 'screenshots/find-excel-button.png', fullPage: true });
    logger.info('\nScreenshot saved to: screenshots/find-excel-button.png');
    
    logger.info('\n=== Keeping browser open for 120 seconds for manual inspection ===');
    await new Promise(resolve => setTimeout(resolve, 120000));
    
  } catch (error) {
    logger.error('Failed:', error);
    throw error;
  } finally {
    await browserManager.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  findExcelButton().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { findExcelButton };
