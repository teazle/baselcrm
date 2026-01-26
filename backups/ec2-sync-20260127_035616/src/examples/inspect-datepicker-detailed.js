import { chromium } from 'playwright';
import { logger } from '../utils/logger.js';
import { PORTALS } from '../config/portals.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';

async function inspectDatepickerDetailed() {
  logger.info('=== Detailed Datepicker Inspection ===');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    const ca = new ClinicAssistAutomation(page);
    
    // Login
    logger.info('Step 1: Logging in...');
    await ca.login();
    await page.waitForTimeout(2000);
    
    // Navigate to Queue Report
    logger.info('Step 2: Navigating to Queue Report...');
    await ca.navigateToReports();
    await page.waitForTimeout(2000);
    
    const navigated = await ca.navigateToQueueListReport();
    if (!navigated) {
      logger.error('Failed to navigate to Queue Report');
      return;
    }
    
    await page.waitForTimeout(2000);
    
    // Find the date input
    logger.info('Step 3: Finding date input field...');
    const dateInputLocator = page.locator('input[name*="date" i]').first();
    
    if (await dateInputLocator.count() === 0) {
      logger.error('Date input not found!');
      await page.screenshot({ path: 'screenshots/datepicker-no-input.png', fullPage: true });
      return;
    }
    
    const inputSelector = await dateInputLocator.evaluate((el) => {
      return {
        id: el.id || null,
        name: el.name || null,
        className: el.className || null,
        value: el.value || null,
        selector: el.id ? `#${el.id}` : el.name ? `input[name="${el.name}"]` : null
      };
    });
    
    logger.info('Date input found:', inputSelector);
    
    // Inspect what datepicker library is available
    logger.info('Step 4: Checking datepicker library availability...');
    const datepickerInfo = await page.evaluate(() => {
      const info = {
        jQuery: typeof jQuery !== 'undefined',
        jQueryDatepicker: false,
        bootstrapDatepicker: false,
        inputElement: null
      };
      
      if (info.jQuery) {
        const input = document.querySelector('input[name*="date" i]');
        if (input) {
          info.inputElement = {
            id: input.id,
            name: input.name,
            className: input.className,
            value: input.value
          };
          
          try {
            const $input = jQuery(input);
            info.jQueryDatepicker = typeof $input.datepicker === 'function';
            
            if (info.jQueryDatepicker) {
              const datepickerData = $input.data('datepicker') || $input.data('datePicker');
              info.bootstrapDatepicker = !!datepickerData;
              info.datepickerConfig = datepickerData ? {
                format: datepickerData.format || 'unknown',
                language: datepickerData.language || 'default',
                autoclose: datepickerData.autoclose !== undefined ? datepickerData.autoclose : 'unknown',
                todayHighlight: datepickerData.todayHighlight || false
              } : null;
            }
          } catch (e) {
            info.jQueryError = e.message;
          }
        }
      }
      
      return info;
    });
    
    logger.info('Datepicker library info:', JSON.stringify(datepickerInfo, null, 2));
    
    // Click the date input to open calendar
    logger.info('Step 5: Clicking date input to open calendar...');
    await dateInputLocator.click();
    await page.waitForTimeout(3000); // Wait for calendar to appear
    
    // Inspect the calendar structure
    logger.info('Step 6: Inspecting calendar structure...');
    const calendarStructure = await page.evaluate(() => {
      const datepicker = document.querySelector('.datepicker, [class*="datepicker"]');
      if (!datepicker) return { found: false };
      
      const structure = {
        found: true,
        className: datepicker.className,
        id: datepicker.id,
        visible: datepicker.offsetParent !== null,
        boundingRect: datepicker.getBoundingClientRect(),
        activeView: null,
        views: {},
        navigation: {},
        days: []
      };
      
      // Check which view is active
      const daysView = datepicker.querySelector('.datepicker-days:not(.hide)');
      const monthsView = datepicker.querySelector('.datepicker-months:not(.hide)');
      const yearsView = datepicker.querySelector('.datepicker-years:not(.hide)');
      
      if (daysView) {
        structure.activeView = 'days';
        structure.views.days = {
          visible: true,
          className: daysView.className,
          currentMonth: daysView.querySelector('.datepicker-switch')?.textContent || null
        };
        
        // Get all day cells
        const dayCells = daysView.querySelectorAll('td.day, .day');
        structure.views.days.dayCells = Array.from(dayCells).slice(0, 10).map(cell => ({
          text: cell.textContent.trim(),
          className: cell.className,
          disabled: cell.classList.contains('disabled'),
          old: cell.classList.contains('old'),
          new: cell.classList.contains('new'),
          today: cell.classList.contains('today')
        }));
      }
      
      if (monthsView) {
        structure.views.months = {
          visible: !monthsView.classList.contains('hide'),
          className: monthsView.className,
          monthCells: Array.from(monthsView.querySelectorAll('span, .month')).slice(0, 6).map(cell => ({
            text: cell.textContent.trim(),
            className: cell.className,
            dataMonth: cell.getAttribute('data-month')
          }))
        };
      }
      
      if (yearsView) {
        structure.views.years = {
          visible: !yearsView.classList.contains('hide'),
          className: yearsView.className,
          yearCells: Array.from(yearsView.querySelectorAll('span, .year')).slice(0, 10).map(cell => ({
            text: cell.textContent.trim(),
            className: cell.className,
            disabled: cell.classList.contains('disabled')
          }))
        };
      }
      
      // Navigation elements
      const switchEl = datepicker.querySelector('.datepicker-switch');
      if (switchEl) {
        structure.navigation.switch = {
          text: switchEl.textContent.trim(),
          className: switchEl.className
        };
      }
      
      const prevBtn = datepicker.querySelector('.prev, [class*="prev"]');
      const nextBtn = datepicker.querySelector('.next, [class*="next"]');
      
      if (prevBtn) {
        structure.navigation.prev = {
          text: prevBtn.textContent.trim(),
          className: prevBtn.className,
          title: prevBtn.getAttribute('title')
        };
      }
      
      if (nextBtn) {
        structure.navigation.next = {
          text: nextBtn.textContent.trim(),
          className: nextBtn.className,
          title: nextBtn.getAttribute('title')
        };
      }
      
      return structure;
    });
    
    logger.info('Calendar structure:', JSON.stringify(calendarStructure, null, 2));
    
    // Test jQuery datepicker API with different date formats
    logger.info('Step 7: Testing jQuery datepicker API with different formats...');
    const apiTests = await page.evaluate((inputSelector) => {
      const input = document.querySelector(inputSelector.selector || 'input[name*="date" i]');
      if (!input) return { error: 'Input not found' };
      
      const tests = {
        originalValue: input.value,
        jQueryAvailable: typeof jQuery !== 'undefined',
        datepickerAvailable: false,
        testResults: []
      };
      
      if (tests.jQueryAvailable) {
        try {
          const $input = jQuery(input);
          tests.datepickerAvailable = typeof $input.datepicker === 'function';
          
          if (tests.datepickerAvailable) {
            // Test format: DD/MM/YYYY
            try {
              $input.datepicker('setDate', '27/12/2025');
              tests.testResults.push({
                format: 'DD/MM/YYYY string',
                success: true,
                value: input.value,
                error: null
              });
            } catch (e) {
              tests.testResults.push({
                format: 'DD/MM/YYYY string',
                success: false,
                value: input.value,
                error: e.message
              });
            }
            
            // Reset and test with Date object
            input.value = '';
            try {
              const dateObj = new Date(2025, 11, 27); // Month is 0-indexed
              $input.datepicker('setDate', dateObj);
              tests.testResults.push({
                format: 'Date object (2025, 11, 27)',
                success: true,
                value: input.value,
                error: null
              });
            } catch (e) {
              tests.testResults.push({
                format: 'Date object',
                success: false,
                value: input.value,
                error: e.message
              });
            }
            
            // Reset and test with MM/DD/YYYY format
            input.value = '';
            try {
              $input.datepicker('setDate', '12/27/2025');
              tests.testResults.push({
                format: 'MM/DD/YYYY string',
                success: true,
                value: input.value,
                error: null
              });
            } catch (e) {
              tests.testResults.push({
                format: 'MM/DD/YYYY string',
                success: false,
                value: input.value,
                error: e.message
              });
            }
          }
        } catch (e) {
          tests.error = e.message;
        }
      }
      
      return tests;
    }, inputSelector);
    
    logger.info('API test results:', JSON.stringify(apiTests, null, 2));
    
    // Test Playwright fill() method
    logger.info('Step 8: Testing Playwright fill() method...');
    await dateInputLocator.clear();
    await dateInputLocator.fill('27/12/2025');
    await page.waitForTimeout(1000);
    
    const fillTestResult = await dateInputLocator.inputValue();
    logger.info('After fill("27/12/2025"), input value:', fillTestResult);
    
    // Trigger events manually and see what happens
    logger.info('Step 9: Testing event triggering...');
    const eventTest = await page.evaluate((inputSelector) => {
      const input = document.querySelector(inputSelector.selector || 'input[name*="date" i]');
      if (!input) return { error: 'Input not found' };
      
      const events = [];
      const originalValue = input.value;
      
      // Listen for events
      ['input', 'change', 'blur', 'focus'].forEach(eventType => {
        input.addEventListener(eventType, (e) => {
          events.push({
            type: eventType,
            value: input.value,
            timestamp: Date.now()
          });
        }, { once: true });
      });
      
      // Trigger events
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
      
      return {
        originalValue,
        finalValue: input.value,
        eventsTriggered: events
      };
    }, inputSelector);
    
    logger.info('Event test result:', JSON.stringify(eventTest, null, 2));
    
    // Take screenshots
    await page.screenshot({ path: 'screenshots/datepicker-calendar-open.png', fullPage: true });
    logger.info('Screenshot saved: screenshots/datepicker-calendar-open.png');
    
    logger.info('=== Inspection Complete ===');
    logger.info('Keeping browser open for 60 seconds for manual inspection...');
    logger.info('Check the console logs above for detailed information.');
    logger.info('You can also manually test in the browser console:');
    logger.info('  - jQuery("input[name*=\'date\']").datepicker("setDate", "27/12/2025")');
    logger.info('  - jQuery("input[name*=\'date\']").datepicker("setDate", new Date(2025, 11, 27))');
    
    await page.waitForTimeout(60000);
    
  } catch (error) {
    logger.error('Inspection error:', error);
    await page.screenshot({ path: 'screenshots/datepicker-inspection-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

inspectDatepickerDetailed().catch(console.error);
