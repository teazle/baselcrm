import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/**
 * Deep inspection of PDF report to understand structure and extraction methods
 */
async function inspectPDFDeep() {
  const browserManager = new BrowserManager();
  
  try {
    await browserManager.init();
    const page = await browserManager.newPage();

    logger.info('=== Deep PDF Inspection ===');
    
    const clinicAssist = new ClinicAssistAutomation(page);
    
    // Step 1: Login
    logger.info('Step 1: Logging in...');
    await clinicAssist.login();
    
    // Step 2: Navigate to Reports → Queue List
    logger.info('Step 2: Navigating to Queue List report...');
    await clinicAssist.navigateToReports();
    await clinicAssist.navigateToQueueListReport();
    
    // Step 3: Set date
    logger.info('Step 3: Setting date to 27/12/2025...');
    await clinicAssist.searchQueueListByDate('2025-12-27');
    
    // Step 4: Wait for report to load
    logger.info('Step 4: Waiting for report to load...');
    await page.waitForTimeout(8000);
    
    // Step 5: Deep inspection
    logger.info('Step 5: Performing deep inspection...');
    
    const inspection = await page.evaluate(() => {
      const results = {
        iframes: [],
        pdfViewers: [],
        exportButtons: [],
        textContent: null,
        structure: {}
      };
      
      // Find all iframes
      const iframes = Array.from(document.querySelectorAll('iframe'));
      results.iframes = iframes.map(iframe => ({
        src: iframe.src || '',
        name: iframe.name || '',
        id: iframe.id || '',
        className: iframe.className || '',
        width: iframe.width || '',
        height: iframe.height || '',
        title: iframe.title || ''
      }));
      
      // Check for PDF.js viewer
      const pdfJsIndicators = [
        document.querySelector('[id*="pdfjs"], [class*="pdfjs"], [id*="viewer"], [class*="viewer"]'),
        document.querySelector('embed[type="application/pdf"]'),
        document.querySelector('object[type="application/pdf"]'),
        ...Array.from(document.querySelectorAll('*')).filter(el => {
          const id = (el.id || '').toLowerCase();
          const className = (el.className || '').toLowerCase();
          return id.includes('pdf') || className.includes('pdf') || id.includes('viewer') || className.includes('viewer');
        }).slice(0, 5)
      ].filter(Boolean);
      
      results.pdfViewers = pdfJsIndicators.map(el => ({
        tag: el.tagName,
        id: el.id || '',
        className: el.className || '',
        type: el.type || '',
        src: el.src || ''
      }));
      
      // Try to access iframe content
      if (iframes.length > 0) {
        try {
          const reportIframe = iframes.find(f => 
            (f.src || '').toLowerCase().includes('reportviewer') || 
            (f.src || '').toLowerCase().includes('queuelisting') ||
            (f.src || '').toLowerCase().includes('report')
          ) || iframes[0];
          
          if (reportIframe && reportIframe.contentDocument) {
            const iframeDoc = reportIframe.contentDocument;
            const iframeBody = iframeDoc.body;
            
            results.structure.iframeDocument = {
              title: iframeDoc.title || '',
              url: iframeDoc.URL || '',
              readyState: iframeDoc.readyState || ''
            };
            
            // Check for nested iframe
            const nestedIframes = Array.from(iframeDoc.querySelectorAll('iframe'));
            results.structure.nestedIframes = nestedIframes.map(f => ({
              src: f.src || '',
              id: f.id || '',
              className: f.className || ''
            }));
            
            // Try to get text content from iframe
            if (iframeBody) {
              results.textContent = {
                bodyText: iframeBody.innerText || iframeBody.textContent || '',
                bodyHTML: iframeBody.innerHTML.substring(0, 5000) || '',
                textLength: (iframeBody.innerText || iframeBody.textContent || '').length
              };
              
              // Check for tables in iframe
              const tables = Array.from(iframeDoc.querySelectorAll('table'));
              results.structure.tables = tables.map((table, idx) => {
                const rows = Array.from(table.querySelectorAll('tr'));
                return {
                  index: idx,
                  rowCount: rows.length,
                  firstRowCells: rows[0] ? Array.from(rows[0].querySelectorAll('td, th')).map(c => c.textContent?.trim() || '').slice(0, 10) : [],
                  sampleText: table.textContent?.substring(0, 200) || ''
                };
              });
              
              // Check for PDF.js viewer in iframe
              const pdfViewer = iframeDoc.querySelector('[id*="viewer"], [class*="viewer"], canvas, embed[type="application/pdf"]');
              if (pdfViewer) {
                results.structure.pdfViewerFound = true;
                results.structure.pdfViewerElement = {
                  tag: pdfViewer.tagName,
                  id: pdfViewer.id || '',
                  className: pdfViewer.className || ''
                };
              }
              
              // Look for export/download buttons
              const buttons = Array.from(iframeDoc.querySelectorAll('button, a, input[type="button"]'));
              results.exportButtons = buttons
                .filter(btn => {
                  const text = (btn.textContent || btn.value || btn.innerText || '').toLowerCase();
                  const href = (btn.href || '').toLowerCase();
                  return text.includes('export') || text.includes('excel') || text.includes('download') || 
                         text.includes('pdf') || text.includes('csv') || href.includes('.xlsx') || href.includes('.csv');
                })
                .map(btn => ({
                  text: btn.textContent || btn.value || btn.innerText || '',
                  tag: btn.tagName,
                  id: btn.id || '',
                  className: btn.className || '',
                  href: btn.href || '',
                  onclick: btn.getAttribute('onclick') || ''
                }));
            }
            
            // Try nested iframe
            if (nestedIframes.length > 0) {
              try {
                const nestedIframe = nestedIframes[0];
                if (nestedIframe.contentDocument) {
                  const nestedDoc = nestedIframe.contentDocument;
                  const nestedBody = nestedDoc.body;
                  
                  results.structure.nestedIframeDocument = {
                    title: nestedDoc.title || '',
                    url: nestedDoc.URL || ''
                  };
                  
                  if (nestedBody) {
                    results.structure.nestedTextContent = {
                      text: nestedBody.innerText || nestedBody.textContent || '',
                      textLength: (nestedBody.innerText || nestedBody.textContent || '').length,
                      html: nestedBody.innerHTML.substring(0, 3000) || ''
                    };
                    
                    // Check for tables in nested iframe
                    const nestedTables = Array.from(nestedDoc.querySelectorAll('table'));
                    results.structure.nestedTables = nestedTables.map((table, idx) => {
                      const rows = Array.from(table.querySelectorAll('tr'));
                      return {
                        index: idx,
                        rowCount: rows.length,
                        firstRowCells: rows[0] ? Array.from(rows[0].querySelectorAll('td, th')).map(c => c.textContent?.trim() || '').slice(0, 10) : [],
                        sampleText: table.textContent?.substring(0, 300) || ''
                      };
                    });
                  }
                }
              } catch (e) {
                results.structure.nestedIframeError = e.message;
              }
            }
          }
        } catch (e) {
          results.structure.iframeAccessError = e.message;
        }
      }
      
      return results;
    });
    
    logger.info('\n=== Inspection Results ===');
    logger.info(`Iframes found: ${inspection.iframes.length}`);
    inspection.iframes.forEach((iframe, idx) => {
      logger.info(`  [${idx + 1}] ${iframe.src.substring(0, 100)}`);
    });
    
    logger.info(`\nPDF viewer indicators: ${inspection.pdfViewers.length}`);
    
    if (inspection.structure.iframeDocument) {
      logger.info(`\nIframe document: ${inspection.structure.iframeDocument.title || 'No title'}`);
      logger.info(`  URL: ${inspection.structure.iframeDocument.url}`);
      
      if (inspection.structure.nestedIframes) {
        logger.info(`  Nested iframes: ${inspection.structure.nestedIframes.length}`);
      }
      
      if (inspection.textContent) {
        logger.info(`  Text content length: ${inspection.textContent.textLength} chars`);
        logger.info(`  Text preview: ${inspection.textContent.bodyText.substring(0, 200)}`);
      }
      
      if (inspection.structure.tables) {
        logger.info(`  Tables found: ${inspection.structure.tables.length}`);
        inspection.structure.tables.forEach((table, idx) => {
          logger.info(`    Table ${idx + 1}: ${table.rowCount} rows`);
          if (table.firstRowCells.length > 0) {
            logger.info(`      Headers: ${table.firstRowCells.join(' | ')}`);
          }
        });
      }
      
      if (inspection.structure.nestedTextContent) {
        logger.info(`\n  Nested iframe text: ${inspection.structure.nestedTextContent.textLength} chars`);
        logger.info(`  Nested preview: ${inspection.structure.nestedTextContent.text.substring(0, 300)}`);
        
        if (inspection.structure.nestedTables) {
          logger.info(`  Nested tables: ${inspection.structure.nestedTables.length}`);
          inspection.structure.nestedTables.forEach((table, idx) => {
            logger.info(`    Nested Table ${idx + 1}: ${table.rowCount} rows`);
          });
        }
      }
      
      if (inspection.structure.pdfViewerFound) {
        logger.info(`\n  PDF viewer element found!`);
        logger.info(`    Tag: ${inspection.structure.pdfViewerElement.tag}`);
        logger.info(`    ID: ${inspection.structure.pdfViewerElement.id}`);
      }
      
      if (inspection.exportButtons.length > 0) {
        logger.info(`\n  Export buttons found: ${inspection.exportButtons.length}`);
        inspection.exportButtons.forEach((btn, idx) => {
          logger.info(`    [${idx + 1}] ${btn.text} (${btn.tag})`);
        });
      }
    }
    
    if (inspection.structure.iframeAccessError) {
      logger.warn(`\nIframe access error: ${inspection.structure.iframeAccessError}`);
    }
    
    // Save detailed results to file
    const fs = await import('fs');
    fs.writeFileSync('data/pdf-inspection-results.json', JSON.stringify(inspection, null, 2));
    logger.info('\n=== Detailed results saved to data/pdf-inspection-results.json ===');
    
    // Take screenshot
    await page.screenshot({ path: 'screenshots/pdf-deep-inspection.png', fullPage: true });
    logger.info('Screenshot saved to: screenshots/pdf-deep-inspection.png');
    
    logger.info('\n=== Inspection Complete ===');
    logger.info('Browser will stay open for 120 seconds for manual review...');
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
  inspectPDFDeep().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { inspectPDFDeep };
