import { chromium } from 'playwright';
import { logger } from '../utils/logger.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';

async function findExportButtons() {
  logger.info('=== Finding Export Buttons on Queue Report ===');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    const ca = new ClinicAssistAutomation(page);
    
    // Login using the automation class
    logger.info('Logging in...');
    await ca.login();
    await page.waitForTimeout(2000);
    
    logger.info('Logged in, navigating to Reports...');
    
    // Navigate to Reports - try multiple methods
    let reportsNavSuccess = false;
    
    // Method 1: Try the automation method
    try {
      await ca.navigateToReports();
      await page.waitForTimeout(2000);
      reportsNavSuccess = true;
    } catch (e) {
      logger.info('Automation navigateToReports failed, trying manual...');
    }
    
    // Method 2: Try finding Reports link manually
    if (!reportsNavSuccess) {
      const reportsLinks = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        return links
          .filter(a => {
            const text = (a.textContent || '').toLowerCase().trim();
            const href = (a.href || '').toLowerCase();
            return text.includes('report') || href.includes('report');
          })
          .map(a => ({
            text: (a.textContent || '').trim(),
            href: a.href,
            id: a.id,
            className: a.className,
          }));
      });
      
      logger.info(`Found ${reportsLinks.length} report-related links:`, reportsLinks);
      
      // Try clicking the first one that says "Reports"
      const reportsLink = page.locator('a:has-text("Reports")').first();
      if (await reportsLink.count() > 0) {
        await reportsLink.click();
        await page.waitForTimeout(3000);
        reportsNavSuccess = true;
        logger.info('Clicked Reports link manually');
      }
    }
    
    if (!reportsNavSuccess) {
      logger.error('Could not navigate to Reports!');
      await page.screenshot({ path: 'screenshots/find-export-no-reports.png', fullPage: true });
      return;
    }
    
    // Navigate to Queue Report using automation method
    logger.info('Navigating to Queue Report...');
    await ca.navigateToQueueListReport();
    await page.waitForTimeout(3000);
    
    // Check if we're on Queue Report page
    const currentUrl = page.url();
    logger.info('Current URL:', currentUrl);
    
    if (!currentUrl.includes('QueueReport')) {
      logger.error('Not on Queue Report page!');
      await page.screenshot({ path: 'screenshots/find-export-current-page.png', fullPage: true });
      return;
    }
    
    // Fill date: Click on the date input field to open calendar, then select 27 December
    logger.info('Opening date picker to select 27 December 2025');
    
    // Find the date input field by its attributes (not by date value, since it changes)
    // Look for inputs near "Date" label or inputs with date-related attributes
    const dateInput = await page.evaluate(() => {
      // Find label with "Date" text
      const labels = Array.from(document.querySelectorAll('label, td, th, div, span'));
      let dateLabel = null;
      for (const label of labels) {
        const text = (label.textContent || label.innerText || '').trim().toLowerCase();
        if (text === 'date' || text.startsWith('date ')) {
          dateLabel = label;
          break;
        }
      }
      
      if (dateLabel) {
        // Find input near this label
        const parent = dateLabel.closest('tr, div, form, fieldset, table');
        if (parent) {
          const inputs = parent.querySelectorAll('input[type="text"], input:not([type="button"]):not([type="submit"]):not([type="hidden"])');
          if (inputs.length > 0) {
            return { selector: null, element: inputs[0] };
          }
        }
      }
      
      // Fallback: find first text input that might be date
      const textInputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type="button"]):not([type="submit"]):not([type="hidden"])'));
      for (const input of textInputs) {
        const name = (input.name || '').toLowerCase();
        const id = (input.id || '').toLowerCase();
        const placeholder = (input.placeholder || '').toLowerCase();
        if (name.includes('date') || id.includes('date') || placeholder.includes('date')) {
          return { selector: null, element: input };
        }
      }
      
      // Last fallback: first visible text input
      for (const input of textInputs) {
        const rect = input.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return { selector: null, element: input };
        }
      }
      
      return null;
    });
    
    if (dateInput && dateInput.element) {
      // Use evaluate to click the element
      await page.evaluate((element) => {
        element.focus();
        element.click();
      }, dateInput.element);
      await page.waitForTimeout(1500);
      logger.info('Clicked date input field to open calendar dropdown');
    } else {
      // Fallback: try locator approach
      const dateInputLocator = page.locator('input[name*="date" i], input[id*="date" i], input[type="date"]').first();
      if (await dateInputLocator.count() > 0) {
        await dateInputLocator.click();
        await page.waitForTimeout(1500);
        logger.info('Clicked date input field using locator');
      }
    }
    
    // Wait for calendar to appear
    await page.waitForTimeout(1000);
    
    // Look for the calendar dropdown/picker
    // Try to find day 27 in the calendar
    const day27 = page.locator('td:has-text("27"), a:has-text("27"), button:has-text("27"), [data-day="27"], .day:has-text("27"), .datepicker-day:has-text("27")').first();
      
      if (await day27.count() > 0) {
        logger.info('Found day 27 in calendar, clicking it');
        await day27.click();
        await page.waitForTimeout(1000);
      } else {
        logger.info('Day 27 not found, might need to navigate to December 2025');
        
        // Try to navigate month/year if calendar is showing different month
        // Look for month/year selectors or navigation buttons
        const monthSelect = page.locator('select[name*="month" i], select[id*="month" i], .month-select, [class*="month"] select').first();
        const yearSelect = page.locator('select[name*="year" i], select[id*="year" i], .year-select, [class*="year"] select').first();
        
        if (await yearSelect.count() > 0) {
          await yearSelect.selectOption({ label: '2025' });
          await page.waitForTimeout(500);
          logger.info('Selected year 2025');
        }
        
        if (await monthSelect.count() > 0) {
          await monthSelect.selectOption({ label: /December|Dec/i });
          await page.waitForTimeout(500);
          logger.info('Selected December');
        }
        
        // Try navigation buttons if dropdowns don't exist
        const prevButton = page.locator('button:has-text("Prev"), .prev, .previous, [aria-label*="Previous"], [title*="Previous"]').first();
        const nextButton = page.locator('button:has-text("Next"), .next, [aria-label*="Next"], [title*="Next"]').first();
        
        // Check what month/year is currently shown
        const currentMonth = await page.evaluate(() => {
          const cal = document.querySelector('.calendar, .datepicker, [class*="picker"], [class*="calendar"], [id*="datepicker"]');
          if (cal) {
            const text = cal.textContent || '';
            // Try to extract month/year
            const monthMatch = text.match(/(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
            const yearMatch = text.match(/202[0-9]/);
            return { month: monthMatch ? monthMatch[0] : null, year: yearMatch ? yearMatch[0] : null };
          }
          return null;
        });
        
        logger.info('Current calendar month/year:', currentMonth);
        
        // Navigate to December 2025 if needed
        if (currentMonth && currentMonth.month && currentMonth.year) {
          const currentMonthNum = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(currentMonth.month.toLowerCase().substring(0, 3));
          const targetMonthNum = 11; // December (0-based)
          const currentYear = parseInt(currentMonth.year);
          const targetYear = 2025;
          
          // Calculate how many months to navigate
          const monthsToMove = (targetYear - currentYear) * 12 + (targetMonthNum - currentMonthNum);
          
          if (monthsToMove > 0 && await nextButton.count() > 0) {
            for (let i = 0; i < monthsToMove; i++) {
              await nextButton.click();
              await page.waitForTimeout(300);
            }
            logger.info(`Navigated forward ${monthsToMove} months`);
          } else if (monthsToMove < 0 && await prevButton.count() > 0) {
            for (let i = 0; i < Math.abs(monthsToMove); i++) {
              await prevButton.click();
              await page.waitForTimeout(300);
            }
            logger.info(`Navigated backward ${Math.abs(monthsToMove)} months`);
          }
        }
        
        // Try clicking day 27 again after navigation
        await page.waitForTimeout(1000);
        const day27AfterNav = page.locator('td:has-text("27"), a:has-text("27"), button:has-text("27"), [data-day="27"], .day:has-text("27")').first();
        if (await day27AfterNav.count() > 0) {
          await day27AfterNav.click();
          await page.waitForTimeout(1000);
          logger.info('Clicked day 27 after navigation');
        }
      }
      
      // Close calendar if still open (click outside or press Escape)
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(500);
    }
    
    // Now click Generate button
    logger.info('Clicking Generate button...');
    const generateBtn = page.locator('input[type="button"][value*="Generate" i], button:has-text("Generate"), #btnOK').first();
    if (await generateBtn.count() > 0) {
      await generateBtn.click();
      logger.info('Generate clicked');
    }
    
    // Wait longer for report to load - PDF/Excel buttons might appear after report generates
    logger.info('Waiting for report to generate and export buttons to appear...');
    await page.waitForTimeout(15000); // Wait 15 seconds for report to fully load
    
    // Take screenshot
    await page.screenshot({ path: 'screenshots/find-export-after-generate.png', fullPage: true });
    logger.info('Screenshot saved');
    
    // Check for PDF viewer (iframe)
    const hasPDFViewer = await page.evaluate(() => {
      const iframes = Array.from(document.querySelectorAll('iframe, embed, object'));
      return iframes.some(f => {
        const src = (f.src || f.data || '').toLowerCase();
        return src.includes('.pdf') || src.includes('pdf');
      });
    });
    
    if (hasPDFViewer) {
      logger.info('PDF viewer detected! Report is shown as PDF.');
    }
    
    // Scroll to see all content
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/find-export-scrolled.png', fullPage: true });
    
    // Now find ALL buttons, links, and clickable elements
    logger.info('Finding all buttons and links...');
    const allElements = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [onclick], img[onclick]'));
      return elements
        .filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0; // Visible
        })
        .map(el => {
          const text = (el.textContent || el.value || el.innerText || el.alt || el.title || '').trim();
          const onclick = el.getAttribute('onclick') || '';
          const href = el.href || '';
          const id = el.id || '';
          const className = el.className || '';
          const tag = el.tagName.toLowerCase();
          
          // Get unique selector
          let selector = '';
          if (id) {
            selector = `#${id}`;
          } else if (className) {
            const firstClass = className.split(' ')[0];
            if (firstClass) selector = `.${firstClass}`;
          }
          if (!selector) {
            selector = tag;
            if (text) selector += `:has-text("${text.substring(0, 20)}")`;
          }
          
          return {
            tag,
            text: text.substring(0, 50),
            id,
            className: className.substring(0, 50),
            onclick: onclick.substring(0, 200),
            href: href.substring(0, 100),
            selector,
            visible: true,
          };
        });
    });
    
    logger.info(`Found ${allElements.length} visible buttons/links:`);
    allElements.forEach((el, idx) => {
      logger.info(`[${idx}] ${el.tag} - "${el.text}" - selector: ${el.selector} - onclick: ${el.onclick.substring(0, 50)}`);
    });
    
    // Find export-related elements
    const exportElements = allElements.filter(el => {
      const text = el.text.toLowerCase();
      const onclick = el.onclick.toLowerCase();
      const href = el.href.toLowerCase();
      return text.includes('excel') || text.includes('pdf') || text.includes('export') ||
             text.includes('print') || text.includes('download') || text.includes('xls') ||
             onclick.includes('excel') || onclick.includes('pdf') || onclick.includes('export') ||
             onclick.includes('print') || onclick.includes('download') ||
             onclick.includes('q_log_print') || onclick.includes('exportimport') ||
             href.includes('.xls') || href.includes('.pdf');
    });
    
    logger.info(`\n=== EXPORT-RELATED ELEMENTS (${exportElements.length}) ===`);
    exportElements.forEach((el, idx) => {
      logger.info(`\n[${idx}] ${el.tag.toUpperCase()}`);
      logger.info(`  Text: "${el.text}"`);
      logger.info(`  ID: ${el.id || '(none)'}`);
      logger.info(`  Class: ${el.className || '(none)'}`);
      logger.info(`  Selector: ${el.selector}`);
      logger.info(`  onclick: ${el.onclick}`);
      logger.info(`  href: ${el.href || '(none)'}`);
    });
    
    // Try to find elements by their position (often export buttons are near Generate button)
    logger.info('\n=== Elements near Generate button ===');
    const elementsNearGenerate = await page.evaluate(() => {
      const generateBtn = Array.from(document.querySelectorAll('input[type="button"], button')).find(
        btn => (btn.value || btn.textContent || '').toLowerCase().includes('generate')
      );
      
      if (!generateBtn) return [];
      
      const generateRect = generateBtn.getBoundingClientRect();
      const allElements = Array.from(document.querySelectorAll('button, a, input[type="button"], [onclick]'));
      
      return allElements
        .filter(el => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          
          // Check if element is near Generate button (within 500px)
          const distance = Math.sqrt(
            Math.pow(rect.left - generateRect.right, 2) + 
            Math.pow(rect.top - generateRect.top, 2)
          );
          
          return distance < 500 && el !== generateBtn;
        })
        .map(el => ({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || el.value || el.innerText || '').trim().substring(0, 50),
          id: el.id || '',
          className: (el.className || '').substring(0, 50),
          onclick: (el.getAttribute('onclick') || '').substring(0, 200),
          distance: Math.sqrt(
            Math.pow(el.getBoundingClientRect().left - generateRect.right, 2) + 
            Math.pow(el.getBoundingClientRect().top - generateRect.top, 2)
          ),
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 10);
    });
    
    logger.info(`Found ${elementsNearGenerate.length} elements near Generate button:`);
    elementsNearGenerate.forEach((el, idx) => {
      logger.info(`[${idx}] ${el.tag} - "${el.text}" - distance: ${Math.round(el.distance)}px - onclick: ${el.onclick.substring(0, 100)}`);
    });
    
    // Check ALL elements on the page for any that might have export functionality
    logger.info('\n=== Checking ALL elements for export keywords ===');
    const allPageElements = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      return all
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
                 onclick.includes('q_log_print') || onclick.includes('exportimport') ||
                 id.includes('excel') || id.includes('pdf') || id.includes('export') ||
                 id.includes('print') ||
                 className.includes('excel') || className.includes('pdf') || className.includes('export') ||
                 className.includes('print') ||
                 href.includes('.xls') || href.includes('.pdf');
        })
        .slice(0, 20)
        .map(el => ({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || el.value || el.innerText || el.alt || el.title || '').trim().substring(0, 50),
          id: el.id || '',
          className: (el.className || '').substring(0, 50),
          onclick: (el.getAttribute('onclick') || '').substring(0, 200),
          href: el.href || '',
        }));
    });
    
    logger.info(`Found ${allPageElements.length} elements with export keywords:`);
    allPageElements.forEach((el, idx) => {
      logger.info(`[${idx}] ${el.tag} - "${el.text}" - id: ${el.id || '(none)'} - onclick: ${el.onclick.substring(0, 100)}`);
    });
    
    // Check for iframes/content that might contain the report
    logger.info('\n=== Checking for iframes/embeds ===');
    const iframes = await page.evaluate(() => {
      const frames = Array.from(document.querySelectorAll('iframe, embed, object, [src*="pdf"], [data*="pdf"]'));
      return frames.map(f => ({
        tag: f.tagName.toLowerCase(),
        src: f.src || f.data || f.getAttribute('src') || f.getAttribute('data') || '',
        id: f.id || '',
        className: (f.className || '').substring(0, 50),
      }));
    });
    
    logger.info(`Found ${iframes.length} iframes/embeds:`);
    iframes.forEach((frame, idx) => {
      logger.info(`[${idx}] ${frame.tag} - src: ${frame.src.substring(0, 100)} - id: ${frame.id || '(none)'}`);
    });
    
    // Check inside the ReportViewer iframe for export buttons
    if (iframes.length > 0 && iframes[0].src.includes('ReportViewer')) {
      logger.info('\n=== Checking inside ReportViewer iframe for export buttons ===');
      
      try {
        // Get the iframe frame
        const iframeElement = page.locator('iframe[src*="ReportViewer"]').first();
        if (await iframeElement.count() > 0) {
          const frame = await iframeElement.contentFrame();
          
          if (frame) {
            // Wait for iframe to load
            await frame.waitForLoadState('networkidle').catch(() => {});
            await page.waitForTimeout(3000);
            
            // Find all buttons/links in the iframe
            const iframeButtons = await frame.evaluate(() => {
              const buttons = Array.from(document.querySelectorAll('button, a, input[type="button"], [onclick], img[onclick]'));
              return buttons
                .filter(btn => {
                  const rect = btn.getBoundingClientRect();
                  return rect.width > 0 && rect.height > 0;
                })
                .map(btn => {
                  const text = (btn.textContent || btn.value || btn.innerText || btn.alt || btn.title || '').trim();
                  const onclick = btn.getAttribute('onclick') || '';
                  const id = btn.id || '';
                  const className = (btn.className || '').substring(0, 50);
                  
                  return {
                    tag: btn.tagName.toLowerCase(),
                    text: text.substring(0, 50),
                    id: id || '',
                    className: className || '',
                    onclick: onclick.substring(0, 200),
                    visible: true,
                  };
                });
            });
            
            logger.info(`Found ${iframeButtons.length} buttons/links inside ReportViewer iframe:`);
            iframeButtons.forEach((btn, idx) => {
              logger.info(`[${idx}] ${btn.tag} - "${btn.text}" - id: ${btn.id || '(none)'} - onclick: ${btn.onclick.substring(0, 100)}`);
            });
            
            // Look for export-related buttons in iframe
            const iframeExportButtons = iframeButtons.filter(btn => {
              const text = btn.text.toLowerCase();
              const onclick = btn.onclick.toLowerCase();
              return text.includes('excel') || text.includes('pdf') || text.includes('export') ||
                     text.includes('print') || text.includes('download') ||
                     onclick.includes('excel') || onclick.includes('pdf') || onclick.includes('export') ||
                     onclick.includes('print') || onclick.includes('download');
            });
            
            logger.info(`\n=== EXPORT BUTTONS IN IFRAME (${iframeExportButtons.length}) ===`);
            iframeExportButtons.forEach((btn, idx) => {
              logger.info(`[${idx}] ${btn.tag.toUpperCase()} - "${btn.text}"`);
              logger.info(`  ID: ${btn.id || '(none)'}`);
              logger.info(`  Class: ${btn.className || '(none)'}`);
              logger.info(`  onclick: ${btn.onclick}`);
              logger.info(`  Selector: ${btn.id ? '#' + btn.id : btn.className ? '.' + btn.className.split(' ')[0] : 'text: "' + btn.text + '"'}`);
            });
          }
        }
      } catch (e) {
        logger.info('Could not access iframe content:', e.message);
        
        // If we can't access iframe, check elements around/near the iframe on the main page
        logger.info('\n=== Checking elements around iframe on main page ===');
        const elementsNearIframe = await page.evaluate(() => {
          const iframe = document.querySelector('iframe[src*="ReportViewer"]');
          if (!iframe) return [];
          
          const iframeRect = iframe.getBoundingClientRect();
          const allElements = Array.from(document.querySelectorAll('button, a, input[type="button"], [onclick], img, span[onclick], div[onclick]'));
          
          return allElements
            .filter(el => {
              const rect = el.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) return false;
              
              // Check if element is above, below, or near the iframe
              const isAbove = rect.bottom < iframeRect.top && Math.abs(rect.left - iframeRect.left) < 500;
              const isBelow = rect.top > iframeRect.bottom && Math.abs(rect.left - iframeRect.left) < 500;
              const isNear = Math.abs(rect.left - iframeRect.left) < 100 || Math.abs(rect.right - iframeRect.right) < 100;
              
              // Prioritize elements below the iframe (where toolbar buttons usually are)
              return (isBelow || isAbove || isNear) && el !== iframe;
            })
            .map(el => {
              const text = (el.textContent || el.value || el.innerText || el.alt || el.title || '').trim();
              const onclick = el.getAttribute('onclick') || '';
              const id = el.id || '';
              const className = (el.className || '').substring(0, 50);
              const tag = el.tagName.toLowerCase();
              
              // Calculate position relative to iframe
              const rect = el.getBoundingClientRect();
              const iframeRect = iframe.getBoundingClientRect();
              const position = rect.top < iframeRect.top ? 'above' : rect.bottom > iframeRect.bottom ? 'below' : 'near';
              
              return {
                tag,
                text: text.substring(0, 50),
                id: id || '',
                className: className || '',
                onclick: onclick.substring(0, 200),
                position,
              };
            })
            .sort((a, b) => {
              // Sort by position: below first, then above, then near
              const order = { below: 0, above: 1, near: 2 };
              return order[a.position] - order[b.position];
            })
            .slice(0, 30);
        });
        
        logger.info(`Found ${elementsNearIframe.length} elements near iframe:`);
        elementsNearIframe.forEach((el, idx) => {
          logger.info(`[${idx}] ${el.tag} - "${el.text}" - position: ${el.position} - id: ${el.id || '(none)'} - onclick: ${el.onclick.substring(0, 100)}`);
        });
        
        // Check for export buttons specifically
        const exportNearIframe = elementsNearIframe.filter(el => {
          const text = el.text.toLowerCase();
          const onclick = el.onclick.toLowerCase();
          return text.includes('excel') || text.includes('pdf') || text.includes('export') ||
                 text.includes('print') || text.includes('download') ||
                 onclick.includes('excel') || onclick.includes('pdf') || onclick.includes('export') ||
                 onclick.includes('print') || onclick.includes('download');
        });
        
        if (exportNearIframe.length > 0) {
          logger.info(`\n=== EXPORT BUTTONS NEAR IFRAME (${exportNearIframe.length}) ===`);
          exportNearIframe.forEach((btn, idx) => {
            logger.info(`[${idx}] ${btn.tag.toUpperCase()} - "${btn.text}"`);
            logger.info(`  ID: ${btn.id || '(none)'}`);
            logger.info(`  Class: ${btn.className || '(none)'}`);
            logger.info(`  Position: ${btn.position}`);
            logger.info(`  onclick: ${btn.onclick}`);
            logger.info(`  Selector: ${btn.id ? '#' + btn.id : btn.className ? '.' + btn.className.split(' ')[0] : 'text: "' + btn.text + '"'}`);
          });
        }
        
        // Try navigating directly to ReportViewer URL to see if export buttons are on that page
        if (iframes.length > 0 && iframes[0].src.includes('ReportViewer')) {
          logger.info('\n=== Trying to navigate directly to ReportViewer URL ===');
          const reportViewerUrl = iframes[0].src;
          logger.info('ReportViewer URL:', reportViewerUrl);
          
          try {
            await page.goto(reportViewerUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await page.waitForTimeout(5000);
            await page.screenshot({ path: 'screenshots/reportviewer-direct.png', fullPage: true });
            
            // Check for export buttons on the ReportViewer page
            const reportViewerButtons = await page.evaluate(() => {
              const buttons = Array.from(document.querySelectorAll('button, a, input[type="button"], [onclick], img[onclick]'));
              return buttons
                .filter(btn => {
                  const rect = btn.getBoundingClientRect();
                  return rect.width > 0 && rect.height > 0;
                })
                .map(btn => {
                  const text = (btn.textContent || btn.value || btn.innerText || btn.alt || btn.title || '').trim();
                  const onclick = btn.getAttribute('onclick') || '';
                  const id = btn.id || '';
                  const className = (btn.className || '').substring(0, 50);
                  const tag = btn.tagName.toLowerCase();
                  
                  return {
                    tag,
                    text: text.substring(0, 50),
                    id: id || '',
                    className: className || '',
                    onclick: onclick.substring(0, 200),
                  };
                });
            });
            
            logger.info(`Found ${reportViewerButtons.length} buttons on ReportViewer page:`);
            reportViewerButtons.forEach((btn, idx) => {
              logger.info(`[${idx}] ${btn.tag} - "${btn.text}" - id: ${btn.id || '(none)'} - onclick: ${btn.onclick.substring(0, 100)}`);
            });
            
            const exportOnReportViewer = reportViewerButtons.filter(btn => {
              const text = btn.text.toLowerCase();
              const onclick = btn.onclick.toLowerCase();
              return text.includes('excel') || text.includes('pdf') || text.includes('export') ||
                     text.includes('print') || text.includes('download') ||
                     onclick.includes('excel') || onclick.includes('pdf') || onclick.includes('export') ||
                     onclick.includes('print') || onclick.includes('download');
            });
            
            if (exportOnReportViewer.length > 0) {
              logger.info(`\n=== EXPORT BUTTONS ON REPORTVIEWER PAGE (${exportOnReportViewer.length}) ===`);
              exportOnReportViewer.forEach((btn, idx) => {
                logger.info(`[${idx}] ${btn.tag.toUpperCase()} - "${btn.text}"`);
                logger.info(`  ID: ${btn.id || '(none)'}`);
                logger.info(`  Class: ${btn.className || '(none)'}`);
                logger.info(`  onclick: ${btn.onclick}`);
                logger.info(`  Selector: ${btn.id ? '#' + btn.id : btn.className ? '.' + btn.className.split(' ')[0] : 'text: "' + btn.text + '"'}`);
              });
            }
          } catch (e) {
            logger.info('Could not navigate to ReportViewer URL:', e.message);
          }
        }
      }
    }
    
    logger.info('\n=== Keeping browser open for 60 seconds for manual inspection ===');
    logger.info('Check the screenshots and look for export buttons visually');
    await page.waitForTimeout(60000);
    
  } catch (error) {
    logger.error('Error:', error);
    await page.screenshot({ path: 'screenshots/find-export-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

findExportButtons().catch(console.error);
