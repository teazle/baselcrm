import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/**
 * Deep inspection of nested iframe using page.evaluate to find format selector
 */
async function inspectNestedIframe() {
  const browserManager = new BrowserManager();
  
  try {
    await browserManager.init();
    const page = await browserManager.newPage();

    logger.info('=== Deep Inspection of Nested Iframe ===');
    
    const clinicAssist = new ClinicAssistAutomation(page);
    
    // Login and navigate
    await clinicAssist.login();
    await clinicAssist.navigateToReports();
    await clinicAssist.navigateToQueueListReport();
    await clinicAssist.searchQueueListByDate('2025-12-27');
    await page.waitForTimeout(10000);
    
    logger.info('Inspecting nested iframe using page.evaluate...');
    
    const inspection = await page.evaluate(() => {
      const results = {
        outerIframe: null,
        nestedIframe: null,
        formatElements: [],
        allElements: []
      };
      
      // Find outer iframe
      const iframes = Array.from(document.querySelectorAll('iframe'));
      const reportIframe = iframes.find(f => 
        (f.src || '').toLowerCase().includes('reportviewer')
      );
      
      if (reportIframe && reportIframe.contentDocument) {
        results.outerIframe = {
          src: reportIframe.src,
          url: reportIframe.contentDocument.URL || '',
          title: reportIframe.contentDocument.title || ''
        };
        
        // Find nested iframe
        const nestedIframes = Array.from(reportIframe.contentDocument.querySelectorAll('iframe'));
        if (nestedIframes.length > 0 && nestedIframes[0].contentDocument) {
          const nestedDoc = nestedIframes[0].contentDocument;
          results.nestedIframe = {
            src: nestedIframes[0].src || '',
            url: nestedDoc.URL || '',
            title: nestedDoc.title || ''
          };
          
          // Get ALL elements in nested iframe
          const allElements = Array.from(nestedDoc.querySelectorAll('*'));
          results.allElements = allElements
            .filter(el => {
              const tag = el.tagName.toLowerCase();
              const id = (el.id || '').toLowerCase();
              const className = (el.className || '').toLowerCase();
              const text = (el.textContent || '').toLowerCase();
              
              return tag === 'select' || tag === 'input' || tag === 'button' || tag === 'a' ||
                     id.includes('format') || id.includes('export') || id.includes('excel') ||
                     className.includes('format') || className.includes('export') ||
                     text.includes('format') || text.includes('excel') || text.includes('export');
            })
            .slice(0, 50)
            .map(el => {
              const tag = el.tagName.toLowerCase();
              const rect = el.getBoundingClientRect();
              return {
                tag: tag,
                id: el.id || '',
                className: el.className || '',
                name: el.name || '',
                type: el.type || '',
                value: el.value || '',
                text: (el.textContent || '').trim().substring(0, 100),
                visible: rect.width > 0 && rect.height > 0,
                href: el.href || '',
                onclick: el.getAttribute('onclick') || ''
              };
            });
          
          // Look specifically for format-related elements
          const formatSelects = Array.from(nestedDoc.querySelectorAll('select'));
          const formatRadios = Array.from(nestedDoc.querySelectorAll('input[type="radio"]'));
          const formatButtons = Array.from(nestedDoc.querySelectorAll('button, a, input[type="button"], input[type="submit"]'));
          
          results.formatElements = {
            selects: formatSelects.map(sel => ({
              id: sel.id || '',
              name: sel.name || '',
              className: sel.className || '',
              options: Array.from(sel.options).map(opt => ({
                value: opt.value || '',
                text: opt.text || '',
                selected: opt.selected
              })),
              selectedIndex: sel.selectedIndex
            })),
            radios: formatRadios.map(radio => ({
              id: radio.id || '',
              name: radio.name || '',
              value: radio.value || '',
              checked: radio.checked,
              className: radio.className || ''
            })),
            buttons: formatButtons
              .filter(btn => {
                const rect = btn.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              })
              .slice(0, 20)
              .map(btn => ({
                tag: btn.tagName.toLowerCase(),
                id: btn.id || '',
                className: btn.className || '',
                text: (btn.textContent || btn.value || '').trim(),
                href: btn.href || '',
                onclick: btn.getAttribute('onclick') || ''
              }))
          };
        }
      }
      
      return results;
    });
    
    logger.info('\n=== Inspection Results ===');
    
    if (inspection.outerIframe) {
      logger.info(`Outer iframe URL: ${inspection.outerIframe.url}`);
    }
    
    if (inspection.nestedIframe) {
      logger.info(`\nNested iframe URL: ${inspection.nestedIframe.url}`);
      logger.info(`Nested iframe title: ${inspection.nestedIframe.title}`);
      
      logger.info(`\nFormat Selects: ${inspection.formatElements.selects.length}`);
      inspection.formatElements.selects.forEach((sel, idx) => {
        logger.info(`  [${idx + 1}] ID: ${sel.id}, Name: ${sel.name}`);
        logger.info(`      Options: ${sel.options.map(o => `${o.text} (${o.value})${o.selected ? ' [SELECTED]' : ''}`).join(', ')}`);
      });
      
      logger.info(`\nFormat Radios: ${inspection.formatElements.radios.length}`);
      const radioGroups = inspection.formatElements.radios.reduce((acc, radio) => {
        const key = radio.name || 'unnamed';
        if (!acc[key]) acc[key] = [];
        acc[key].push(radio);
        return acc;
      }, {});
      Object.entries(radioGroups).forEach(([name, radios]) => {
        logger.info(`  Group: ${name}`);
        radios.forEach(radio => {
          logger.info(`    - ${radio.value} (checked: ${radio.checked}, id: ${radio.id})`);
        });
      });
      
      logger.info(`\nFormat Buttons: ${inspection.formatElements.buttons.length}`);
      inspection.formatElements.buttons.forEach((btn, idx) => {
        logger.info(`  [${idx + 1}] ${btn.text} (${btn.tag}, id: ${btn.id})`);
        if (btn.onclick) {
          logger.info(`      onclick: ${btn.onclick.substring(0, 150)}`);
        }
      });
      
      logger.info(`\nAll Format-Related Elements: ${inspection.allElements.length}`);
      inspection.allElements.forEach((el, idx) => {
        logger.info(`  [${idx + 1}] ${el.tag}: ${el.id || el.className || el.text.substring(0, 30)}`);
      });
    }
    
    // Save to file
    const fs = await import('fs');
    fs.writeFileSync('data/nested-iframe-inspection.json', JSON.stringify(inspection, null, 2));
    logger.info('\n=== Results saved to data/nested-iframe-inspection.json ===');
    
    await page.screenshot({ path: 'screenshots/nested-iframe-inspection.png', fullPage: true });
    logger.info('Screenshot saved to: screenshots/nested-iframe-inspection.png');
    
    logger.info('\n=== Keeping browser open for 120 seconds ===');
    await new Promise(resolve => setTimeout(resolve, 120000));
    
  } catch (error) {
    logger.error('Inspection failed:', error);
    throw error;
  } finally {
    await browserManager.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  inspectNestedIframe().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { inspectNestedIframe };
