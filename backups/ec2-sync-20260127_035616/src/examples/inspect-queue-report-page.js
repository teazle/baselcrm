import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/**
 * Inspect Queue Report page and find all buttons, links, iframes, and export options
 */
async function inspectQueueReportPage() {
  const browserManager = new BrowserManager();
  
  try {
    await browserManager.init();
    const page = await browserManager.newPage();

    logger.info('=== Inspecting Queue Report Page ===');
    
    const clinicAssist = new ClinicAssistAutomation(page);
    
    // Login
    logger.info('Step 1: Logging in...');
    await clinicAssist.login();
    
    // Navigate to Reports
    logger.info('Step 2: Navigating to Reports...');
    await clinicAssist.navigateToReports();
    await page.waitForTimeout(2000);
    
    // Navigate to Queue Report
    logger.info('Step 3: Navigating to Queue Report...');
    await clinicAssist.navigateToQueueListReport();
    await page.waitForTimeout(2000);
    
    // Select date 27 December 2025
    logger.info('Step 4: Selecting date 27/12/2025...');
    const dateStr = '2025-12-27';
    await clinicAssist.searchQueueListByDate(dateStr);
    
    // Wait for report to load
    logger.info('Step 5: Waiting for report to load...');
    await page.waitForTimeout(10000);
    
    // Take screenshot
    await page.screenshot({ path: 'screenshots/queue-report-inspection.png', fullPage: true });
    logger.info('Screenshot saved: screenshots/queue-report-inspection.png');
    
    // Inspect page structure
    logger.info('\n=== PAGE INSPECTION ===\n');
    
    const inspection = await page.evaluate(() => {
      const results = {
        url: window.location.href,
        title: document.title,
        iframes: [],
        buttons: [],
        links: [],
        inputs: [],
        tables: [],
        exportRelated: [],
      };
      
      // Check all iframes
      const iframes = Array.from(document.querySelectorAll('iframe, embed, object'));
      results.iframes = iframes.map(iframe => {
        const rect = iframe.getBoundingClientRect();
        return {
          tag: iframe.tagName.toLowerCase(),
          src: iframe.src || iframe.data || iframe.getAttribute('src') || '',
          id: iframe.id || '',
          className: iframe.className || '',
          visible: rect.width > 0 && rect.height > 0,
          dimensions: { width: rect.width, height: rect.height },
        };
      });
      
      // Check all buttons
      const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'));
      results.buttons = buttons.map(btn => {
        const rect = btn.getBoundingClientRect();
        const text = (btn.textContent || btn.value || btn.innerText || '').trim();
        const onclick = btn.getAttribute('onclick') || '';
        return {
          tag: btn.tagName.toLowerCase(),
          type: btn.type || '',
          text: text.substring(0, 100),
          id: btn.id || '',
          className: btn.className || '',
          onclick: onclick.substring(0, 200),
          visible: rect.width > 0 && rect.height > 0,
          position: { x: rect.left, y: rect.top },
        };
      }).filter(btn => btn.visible);
      
      // Check all links
      const links = Array.from(document.querySelectorAll('a'));
      results.links = links.map(link => {
        const rect = link.getBoundingClientRect();
        const text = (link.textContent || link.innerText || '').trim();
        const onclick = link.getAttribute('onclick') || '';
        return {
          text: text.substring(0, 100),
          href: link.href || '',
          id: link.id || '',
          className: link.className || '',
          onclick: onclick.substring(0, 200),
          visible: rect.width > 0 && rect.height > 0,
          position: { x: rect.left, y: rect.top },
        };
      }).filter(link => link.visible);
      
      // Check all input fields
      const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="date"], input:not([type])'));
      results.inputs = inputs.map(input => {
        const rect = input.getBoundingClientRect();
        return {
          type: input.type || 'text',
          name: input.name || '',
          id: input.id || '',
          value: input.value || '',
          placeholder: input.placeholder || '',
          visible: rect.width > 0 && rect.height > 0,
        };
      }).filter(input => input.visible);
      
      // Check all tables
      const tables = Array.from(document.querySelectorAll('table'));
      results.tables = tables.map((table, idx) => {
        const rows = table.querySelectorAll('tr');
        const cells = table.querySelectorAll('td, th');
        const text = table.textContent || '';
        return {
          index: idx,
          rowCount: rows.length,
          cellCount: cells.length,
          hasData: text.length > 100,
          preview: text.substring(0, 200),
        };
      });
      
      // Find export-related elements
      const allElements = Array.from(document.querySelectorAll('*'));
      results.exportRelated = allElements
        .filter(el => {
          const text = (el.textContent || el.value || el.innerText || el.alt || el.title || '').toLowerCase();
          const onclick = (el.getAttribute('onclick') || '').toLowerCase();
          const id = (el.id || '').toLowerCase();
          const className = (el.className || '').toLowerCase();
          const href = (el.href || '').toLowerCase();
          
          return text.includes('excel') || text.includes('pdf') || text.includes('export') ||
                 text.includes('print') || text.includes('download') ||
                 onclick.includes('excel') || onclick.includes('pdf') || onclick.includes('export') ||
                 onclick.includes('print') || onclick.includes('download') ||
                 id.includes('excel') || id.includes('pdf') || id.includes('export') ||
                 className.includes('excel') || className.includes('pdf') || className.includes('export') ||
                 href.includes('.xls') || href.includes('.pdf');
        })
        .slice(0, 20)
        .map(el => {
          const rect = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || el.value || el.innerText || el.alt || el.title || '').trim().substring(0, 100),
            id: el.id || '',
            className: el.className || '',
            onclick: (el.getAttribute('onclick') || '').substring(0, 200),
            href: el.href || '',
            visible: rect.width > 0 && rect.height > 0,
            position: { x: rect.left, y: rect.top },
          };
        });
      
      return results;
    });
    
    // Log results
    logger.info('URL:', inspection.url);
    logger.info('Title:', inspection.title);
    
    logger.info('\n--- IFRAMES ---');
    inspection.iframes.forEach((iframe, idx) => {
      logger.info(`[${idx + 1}] ${iframe.tag} - src: ${iframe.src.substring(0, 100)}`);
      logger.info(`    ID: ${iframe.id || '(none)'}, Visible: ${iframe.visible}`);
      logger.info(`    Dimensions: ${iframe.dimensions.width}x${iframe.dimensions.height}`);
    });
    
    logger.info('\n--- BUTTONS ---');
    inspection.buttons.forEach((btn, idx) => {
      logger.info(`[${idx + 1}] ${btn.tag} - "${btn.text}"`);
      logger.info(`    ID: ${btn.id || '(none)'}, Type: ${btn.type}`);
      if (btn.onclick) logger.info(`    onclick: ${btn.onclick.substring(0, 100)}`);
    });
    
    logger.info('\n--- LINKS ---');
    inspection.links.slice(0, 20).forEach((link, idx) => {
      if (link.text) {
        logger.info(`[${idx + 1}] "${link.text}"`);
        logger.info(`    href: ${link.href.substring(0, 100)}`);
        if (link.onclick) logger.info(`    onclick: ${link.onclick.substring(0, 100)}`);
      }
    });
    
    logger.info('\n--- EXPORT-RELATED ELEMENTS ---');
    if (inspection.exportRelated.length > 0) {
      inspection.exportRelated.forEach((el, idx) => {
        logger.info(`[${idx + 1}] ${el.tag.toUpperCase()} - "${el.text}"`);
        logger.info(`    ID: ${el.id || '(none)'}, Visible: ${el.visible}`);
        if (el.onclick) logger.info(`    onclick: ${el.onclick}`);
        if (el.href) logger.info(`    href: ${el.href}`);
      });
    } else {
      logger.info('No export-related elements found on main page');
    }
    
    logger.info('\n--- TABLES ---');
    inspection.tables.forEach((table, idx) => {
      logger.info(`[${idx + 1}] ${table.rowCount} rows, ${table.cellCount} cells, Has data: ${table.hasData}`);
      if (table.hasData) {
        logger.info(`    Preview: ${table.preview.substring(0, 150)}...`);
      }
    });
    
    // Try to access iframe content if present
    if (inspection.iframes.length > 0) {
      logger.info('\n--- ATTEMPTING TO ACCESS IFRAME CONTENT ---');
      const iframeResults = await page.evaluate(() => {
        const iframe = document.querySelector('iframe[src*="ReportViewer"], iframe[src*="queueListing"]');
        if (!iframe) return null;
        
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iframeDoc) {
            const buttons = Array.from(iframeDoc.querySelectorAll('button, a, input[type="button"]'));
            return {
              accessible: true,
              buttons: buttons.map(btn => ({
                text: (btn.textContent || btn.value || btn.innerText || '').trim(),
                id: btn.id || '',
                onclick: btn.getAttribute('onclick') || '',
              })),
            };
          }
        } catch (e) {
          return {
            accessible: false,
            error: e.message,
          };
        }
        return null;
      });
      
      if (iframeResults) {
        if (iframeResults.accessible) {
          logger.info('✅ Iframe is accessible!');
          logger.info('Buttons in iframe:', iframeResults.buttons);
        } else {
          logger.info('❌ Iframe is cross-origin, cannot access:', iframeResults.error);
        }
      }
    }
    
    logger.info('\n✅ Inspection complete! Check screenshots/queue-report-inspection.png');
    logger.info('Keeping browser open for 30 seconds for manual review...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    
  } catch (error) {
    logger.error('Inspection failed:', error);
    throw error;
  } finally {
    await browserManager.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  inspectQueueReportPage().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { inspectQueueReportPage };

