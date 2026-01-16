import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/**
 * Find and inspect the output format selector
 */
async function findFormatSelector() {
  const browserManager = new BrowserManager();
  
  try {
    await browserManager.init();
    const page = await browserManager.newPage();

    logger.info('=== Finding Format Selector ===');
    
    const clinicAssist = new ClinicAssistAutomation(page);
    
    // Login and navigate
    await clinicAssist.login();
    await clinicAssist.navigateToReports();
    await clinicAssist.navigateToQueueListReport();
    await clinicAssist.searchQueueListByDate('2025-12-27');
    await page.waitForTimeout(8000);
    
    // Find format selector in nested iframe
    logger.info('Inspecting nested iframe for format selector...');
    
    const selectorInfo = await page.evaluate(() => {
      const results = {
        selectors: [],
        dropdowns: [],
        buttons: [],
        radios: [],
        text: ''
      };
      
      // Find the nested iframe
      const iframes = Array.from(document.querySelectorAll('iframe'));
      const reportIframe = iframes.find(f => 
        (f.src || '').toLowerCase().includes('reportviewer')
      );
      
      if (reportIframe && reportIframe.contentDocument) {
        const iframeDoc = reportIframe.contentDocument;
        const nestedIframes = Array.from(iframeDoc.querySelectorAll('iframe'));
        
        if (nestedIframes.length > 0 && nestedIframes[0].contentDocument) {
          const nestedDoc = nestedIframes[0].contentDocument;
          const nestedBody = nestedDoc.body;
          
          results.text = nestedBody.innerText || nestedBody.textContent || '';
          
          // Find all select elements
          const selects = Array.from(nestedDoc.querySelectorAll('select'));
          results.dropdowns = selects.map((sel, idx) => ({
            index: idx,
            id: sel.id || '',
            name: sel.name || '',
            className: sel.className || '',
            options: Array.from(sel.options).map(opt => ({
              value: opt.value || '',
              text: opt.text || '',
              selected: opt.selected
            })),
            selectedIndex: sel.selectedIndex,
            selectedValue: sel.value || ''
          }));
          
          // Find all buttons
          const buttons = Array.from(nestedDoc.querySelectorAll('button, input[type="button"], input[type="submit"], a[onclick]'));
          results.buttons = buttons
            .filter(btn => {
              const rect = btn.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            })
            .map(btn => ({
              text: btn.textContent || btn.value || btn.innerText || '',
              id: btn.id || '',
              name: btn.name || '',
              className: btn.className || '',
              type: btn.type || '',
              tag: btn.tagName.toLowerCase(),
              onclick: btn.getAttribute('onclick') || ''
            }));
          
          // Find radio buttons
          const radios = Array.from(nestedDoc.querySelectorAll('input[type="radio"]'));
          results.radios = radios.map(radio => ({
            id: radio.id || '',
            name: radio.name || '',
            value: radio.value || '',
            checked: radio.checked,
            className: radio.className || ''
          }));
          
          // Find all elements with "format" in id/name/class
          const formatElements = Array.from(nestedDoc.querySelectorAll('*')).filter(el => {
            const id = (el.id || '').toLowerCase();
            const name = (el.name || '').toLowerCase();
            const className = (el.className || '').toLowerCase();
            const text = (el.textContent || '').toLowerCase();
            return id.includes('format') || name.includes('format') || 
                   className.includes('format') || text.includes('format');
          });
          
          results.selectors = formatElements.map(el => ({
            tag: el.tagName.toLowerCase(),
            id: el.id || '',
            name: el.name || '',
            className: el.className || '',
            text: el.textContent?.trim().substring(0, 100) || ''
          }));
        }
      }
      
      return results;
    });
    
    logger.info('\n=== Format Selector Results ===');
    
    if (selectorInfo.dropdowns.length > 0) {
      logger.info(`\nFound ${selectorInfo.dropdowns.length} dropdown(s):`);
      selectorInfo.dropdowns.forEach((dd, idx) => {
        logger.info(`  [${idx + 1}] ID: ${dd.id}, Name: ${dd.name}`);
        logger.info(`      Options: ${dd.options.map(o => `${o.text} (${o.value})`).join(', ')}`);
        logger.info(`      Selected: ${dd.selectedValue}`);
      });
    }
    
    if (selectorInfo.radios.length > 0) {
      logger.info(`\nFound ${selectorInfo.radios.length} radio button(s):`);
      const grouped = selectorInfo.radios.reduce((acc, radio) => {
        const key = radio.name || 'unnamed';
        if (!acc[key]) acc[key] = [];
        acc[key].push(radio);
        return acc;
      }, {});
      
      Object.entries(grouped).forEach(([name, radios]) => {
        logger.info(`  Group: ${name}`);
        radios.forEach(radio => {
          logger.info(`    - ${radio.value} (checked: ${radio.checked})`);
        });
      });
    }
    
    if (selectorInfo.buttons.length > 0) {
      logger.info(`\nFound ${selectorInfo.buttons.length} button(s):`);
      selectorInfo.buttons.slice(0, 10).forEach((btn, idx) => {
        logger.info(`  [${idx + 1}] ${btn.text} (${btn.tag}, id: ${btn.id})`);
      });
    }
    
    if (selectorInfo.selectors.length > 0) {
      logger.info(`\nFound ${selectorInfo.selectors.length} element(s) with "format" keyword:`);
      selectorInfo.selectors.slice(0, 10).forEach((sel, idx) => {
        logger.info(`  [${idx + 1}] ${sel.tag}: ${sel.id || sel.name || sel.className} - ${sel.text.substring(0, 50)}`);
      });
    }
    
    logger.info(`\nText content preview: ${selectorInfo.text.substring(0, 300)}`);
    
    // Save to file
    const fs = await import('fs');
    fs.writeFileSync('data/format-selector-results.json', JSON.stringify(selectorInfo, null, 2));
    logger.info('\n=== Results saved to data/format-selector-results.json ===');
    
    // Take screenshot
    await page.screenshot({ path: 'screenshots/format-selector-inspection.png', fullPage: true });
    logger.info('Screenshot saved to: screenshots/format-selector-inspection.png');
    
    logger.info('\n=== Keeping browser open for 60 seconds ===');
    await new Promise(resolve => setTimeout(resolve, 60000));
    
  } catch (error) {
    logger.error('Inspection failed:', error);
    throw error;
  } finally {
    await browserManager.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  findFormatSelector().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { findFormatSelector };
