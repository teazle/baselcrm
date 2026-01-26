import { chromium } from 'playwright';
import { logger } from '../utils/logger.js';
import { PORTALS } from '../config/portals.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';

async function testQueueReportPDF() {
  logger.info('=== Testing Queue Report PDF Export ===');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    const ca = new ClinicAssistAutomation(page);
    
    // Login
    logger.info('Logging in...');
    await ca.login();
    await page.waitForTimeout(2000);
    
    // Navigate to Reports - use the automation method
    logger.info('Navigating to Reports...');
    const reportsNav = page.locator('a:has-text("Reports")').first();
    if (await reportsNav.count() > 0) {
      await reportsNav.click();
      await page.waitForTimeout(3000);
      logger.info('Clicked Reports navigation');
      
      // Wait for Reports menu to load
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);
    } else {
      // Try using the automation method
      await ca.navigateToReports();
      await page.waitForTimeout(3000);
    }
    
    // Navigate to Queue Report - use the automation method which handles navigation properly
    logger.info('Navigating to Queue Report...');
    const navigated = await ca.navigateToQueueListReport();
    if (!navigated) {
      logger.info('Navigation via automation failed, trying direct navigation...');
      await page.goto('https://clinicassist.sg:1080/QueueLog/QueueReport', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
    }
    
    // Verify we're on the Queue Report page
    const currentUrl = page.url();
    logger.info('Current URL:', currentUrl);
    if (!currentUrl.includes('QueueReport') && !currentUrl.includes('ErrorPage')) {
      logger.info('Not on Queue Report page, attempting navigation again...');
      // Try finding and clicking the link via evaluate
      await page.evaluate(() => {
        const link = document.querySelector('a[id="60017"]') || 
                     document.querySelector('a.cls_Reports_Daily_Queue_Report') ||
                     Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('Queue Report'));
        if (link) {
          link.click();
        }
      });
      await page.waitForTimeout(3000);
    }
    
    // Fill date - try a few dates to find one with data
    // Try today first, then yesterday, then a few days ago
    const datesToTry = [];
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      datesToTry.push({
        str: `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`,
        iso: date.toISOString().split('T')[0]
      });
    }
    
    logger.info(`Trying dates: ${datesToTry.map(d => d.str).join(', ')}`);
    
    let dateStr = datesToTry[0].str; // Start with today
    logger.info(`Filling date: ${dateStr}`);
    
    const dateInput = page.locator('input[name*="date" i]').first();
    if (await dateInput.count() > 0) {
      await dateInput.fill(dateStr);
      logger.info('Date filled');
    }
    
    await page.waitForTimeout(1000);
    
    // Click Generate
    logger.info('Clicking Generate...');
    const generateBtn = page.locator('input[type="button"][value*="Generate" i]').first();
    if (await generateBtn.count() > 0) {
      await generateBtn.click();
      logger.info('Generate clicked');
    }
    
    // Wait for report to load
    logger.info('Waiting for report to load...');
    await page.waitForTimeout(10000);
    
    // Check if we got results or need to try a different date
    const hasResults = await page.evaluate(() => {
      // Check for tables with data, PDF viewer, or report content
      const tables = document.querySelectorAll('table');
      let hasData = false;
      tables.forEach(table => {
        const rows = table.querySelectorAll('tr');
        if (rows.length > 1) hasData = true; // More than just header
      });
      
      const hasPDFViewer = !!document.querySelector('iframe[src*="pdf"], embed[type*="pdf"], object[data*="pdf"]');
      const hasJqGrid = !!document.querySelector('#queueLogGrid');
      const jqGridRows = document.querySelectorAll('#queueLogGrid tr.jqgrow').length;
      
      return hasData || hasPDFViewer || (hasJqGrid && jqGridRows > 0);
    });
    
    if (!hasResults) {
      logger.info('No results found for today, trying yesterday...');
      const dateInput2 = page.locator('input[name*="date" i]').first();
      if (await dateInput2.count() > 0) {
        dateStr = datesToTry[1].str;
        await dateInput2.fill(dateStr);
        logger.info(`Filled date: ${dateStr}`);
        const generateBtn2 = page.locator('input[type="button"][value*="Generate" i]').first();
        if (await generateBtn2.count() > 0) {
          await generateBtn2.click();
          await page.waitForTimeout(10000);
        }
      }
    }
    
    // Take screenshot
    await page.screenshot({ path: 'screenshots/queue-report-after-generate.png', fullPage: true });
    logger.info('Screenshot saved: screenshots/queue-report-after-generate.png');
    
    // Scroll to bottom
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/queue-report-scrolled.png', fullPage: true });
    
    // Get ALL buttons/links on page for comprehensive inspection
    const allButtons = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [onclick]'));
      return elements
        .filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map(el => ({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || el.value || el.innerText || el.alt || el.title || '').trim().substring(0, 50),
          id: el.id || '',
          className: (el.className || '').substring(0, 50),
          onclick: (el.getAttribute('onclick') || '').substring(0, 150),
          href: el.href || '',
        }));
    });
    
    logger.info(`Found ${allButtons.length} total buttons/links:`, allButtons);
    
    // Get all buttons/links on page - specifically export-related
    const allElements = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('*'));
      return elements
        .filter(el => {
          const tag = el.tagName.toLowerCase();
          if (!['button', 'a', 'input', 'img', 'span', 'div'].includes(tag)) return false;
          
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          
          const text = (el.textContent || el.value || el.innerText || el.alt || el.title || '').toLowerCase();
          const onclick = (el.getAttribute('onclick') || '').toLowerCase();
          const href = (el.href || '').toLowerCase();
          const className = (el.className || '').toLowerCase();
          const id = (el.id || '').toLowerCase();
          
          // Look for export-related keywords including Print
          return text.includes('excel') || text.includes('pdf') || text.includes('export') ||
                 text.includes('download') || text.includes('xls') || text.includes('print') ||
                 onclick.includes('excel') || onclick.includes('pdf') || onclick.includes('export') ||
                 onclick.includes('download') || onclick.includes('print') ||
                 onclick.includes('q_log_print') || onclick.includes('exportimport') ||
                 href.includes('.xls') || href.includes('.pdf') ||
                 className.includes('excel') || className.includes('pdf') || className.includes('export') ||
                 className.includes('print') ||
                 id.includes('excel') || id.includes('pdf') || id.includes('export') ||
                 id.includes('print');
        })
        .map(el => ({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || el.value || el.innerText || el.alt || el.title || '').trim().substring(0, 100),
          id: el.id || '',
          className: (el.className || '').substring(0, 100),
          onclick: (el.getAttribute('onclick') || '').substring(0, 200),
          href: el.href || '',
          visible: true,
        }));
    });
    
    logger.info(`Found ${allElements.length} potential export elements:`, allElements);
    
    // Check for Print/Export functions in window object
    const windowFunctions = await page.evaluate(() => {
      const funcs = [];
      for (const key in window) {
        if (typeof window[key] === 'function') {
          const keyLower = key.toLowerCase();
          if (keyLower.includes('print') || keyLower.includes('export') || 
              keyLower.includes('excel') || keyLower.includes('pdf')) {
            funcs.push(key);
          }
        }
      }
      return funcs;
    });
    
    logger.info('Window functions with export/print keywords:', windowFunctions);
    
    // Check for iframes
    const iframes = await page.evaluate(() => {
      const frames = Array.from(document.querySelectorAll('iframe, embed, object'));
      return frames.map(f => ({
        tag: f.tagName.toLowerCase(),
        src: f.src || f.data || '',
        type: f.type || '',
      }));
    });
    
    logger.info(`Found ${iframes.length} iframes/embeds:`, iframes);
    
    // Check page HTML for export-related strings
    const htmlContent = await page.content();
    const exportMatches = htmlContent.match(/(excel|pdf|export|download|xls|print).{0,50}/gi);
    logger.info(`Found ${exportMatches?.length || 0} export-related strings in HTML`);
    if (exportMatches && exportMatches.length > 0) {
      logger.info('Sample matches:', exportMatches.slice(0, 20));
    }
    
    // Try to find and click Print button if it exists (might generate PDF)
    const printButtons = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, a, input[type="button"], [onclick]'));
      return buttons
        .filter(btn => {
          const text = (btn.textContent || btn.value || btn.innerText || '').toLowerCase();
          const onclick = (btn.getAttribute('onclick') || '').toLowerCase();
          return text.includes('print') || onclick.includes('print');
        })
        .map(btn => ({
          text: (btn.textContent || btn.value || btn.innerText || '').trim(),
          id: btn.id || '',
          className: (btn.className || '').substring(0, 50),
          onclick: (btn.getAttribute('onclick') || '').substring(0, 200),
        }));
    });
    
    logger.info(`Found ${printButtons.length} Print buttons:`, printButtons);
    
    if (printButtons.length > 0) {
      logger.info('Attempting to click first Print button...');
      try {
        const printBtn = page.locator(`button:has-text("${printButtons[0].text}"), input[value*="${printButtons[0].text}"]`).first();
        if (await printBtn.count() > 0) {
          await printBtn.click();
          await page.waitForTimeout(3000);
          await page.screenshot({ path: 'screenshots/queue-report-after-print.png', fullPage: true });
          logger.info('Clicked Print button, screenshot saved');
        }
      } catch (e) {
        logger.info('Could not click Print button:', e.message);
      }
    }
    
    // Try calling JavaScript functions directly if they exist
    logger.info('Checking for JavaScript export functions...');
    const jsFunctions = await page.evaluate(() => {
      const funcs = {};
      
      // Check for Q_Log_Print function (seen in HTML)
      if (typeof window.Q_Log_Print === 'function') {
        funcs.Q_Log_Print = 'function';
      }
      
      // Check for ExportImport functions
      if (typeof window.ExportImport === 'function') {
        funcs.ExportImport = 'function';
      }
      
      // Check if there's a function that can be called with 'Q_Log_Print' parameter
      // Sometimes these are called via a helper function
      try {
        // Look for common print/export patterns
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          const content = script.textContent || '';
          if (content.includes('Q_Log_Print') || content.includes('ExportImport')) {
            funcs.foundInScript = true;
            // Try to extract function names
            const printMatch = content.match(/(?:function\s+)?(\w*[Pp]rint\w*)\s*\(/);
            if (printMatch) funcs.printFunction = printMatch[1];
            const exportMatch = content.match(/(?:function\s+)?(\w*[Ee]xport\w*)\s*\(/);
            if (exportMatch) funcs.exportFunction = exportMatch[1];
          }
        }
      } catch (e) {
        // Ignore errors
      }
      
      return funcs;
    });
    
    logger.info('JavaScript functions found:', jsFunctions);
    
    // Try to find buttons or links that call these functions
    const functionButtons = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, a, input[type="button"], [onclick]'));
      return buttons
        .filter(btn => {
          const onclick = (btn.getAttribute('onclick') || '').toLowerCase();
          return onclick.includes('q_log_print') || 
                 onclick.includes('exportimport') ||
                 onclick.includes('print') ||
                 onclick.includes('export');
        })
        .map(btn => ({
          text: (btn.textContent || btn.value || btn.innerText || '').trim(),
          onclick: btn.getAttribute('onclick'),
          id: btn.id || '',
          className: (btn.className || '').substring(0, 50),
        }));
    });
    
    logger.info(`Found ${functionButtons.length} buttons with export/print onclick handlers:`, functionButtons);
    
    // Try clicking these function buttons
    if (functionButtons.length > 0) {
      logger.info('Attempting to click function button...');
      try {
        // Try to find and click by onclick content
        const clicked = await page.evaluate((onclick) => {
          const buttons = Array.from(document.querySelectorAll('[onclick]'));
          const btn = buttons.find(b => (b.getAttribute('onclick') || '').toLowerCase().includes(onclick));
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        }, functionButtons[0].onclick.toLowerCase());
        
        if (clicked) {
          await page.waitForTimeout(3000);
          await page.screenshot({ path: 'screenshots/queue-report-after-function-click.png', fullPage: true });
          logger.info('Clicked function button, screenshot saved');
        }
      } catch (e) {
        logger.info('Could not click function button:', e.message);
      }
    }
    
    logger.info('Test complete. Check screenshots for visual inspection.');
    logger.info('Keeping browser open for 30 seconds for manual inspection...');
    await page.waitForTimeout(30000);
    
  } catch (error) {
    logger.error('Error testing queue report:', error);
    await page.screenshot({ path: 'screenshots/queue-report-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

testQueueReportPDF().catch(console.error);
