import { chromium } from 'playwright';
import { logger } from '../utils/logger.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';

async function inspectDatePicker() {
  logger.info('=== Inspecting Date Picker ===');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    const ca = new ClinicAssistAutomation(page);
    
    // Login
    logger.info('Logging in...');
    await ca.login();
    await page.waitForTimeout(2000);
    
    // Navigate to Reports
    logger.info('Navigating to Reports...');
    await ca.navigateToReports();
    await page.waitForTimeout(3000);
    
    // Navigate to Queue Report
    logger.info('Navigating to Queue Report...');
    await ca.navigateToQueueListReport();
    await page.waitForTimeout(3000);
    
    logger.info('=== INSPECTING DATE INPUT ===');
    
    // Get all date-related inputs
    const dateInputs = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="date"]'));
      return inputs
        .map(input => {
          const name = input.name || '';
          const id = input.id || '';
          const value = input.value || '';
          const placeholder = input.placeholder || '';
          const className = input.className || '';
          const parent = input.closest('tr, div, td, fieldset');
          const parentText = parent ? (parent.textContent || '').trim().substring(0, 100) : '';
          
          return {
            name,
            id,
            value,
            placeholder,
            className,
            parentText,
            isDateRelated: name.toLowerCase().includes('date') || id.toLowerCase().includes('date') || placeholder.toLowerCase().includes('date'),
          };
        })
        .filter(inp => inp.isDateRelated || inp.parentText.toLowerCase().includes('date'));
    });
    
    console.log('\n=== FOUND DATE INPUTS ===');
    console.log(JSON.stringify(dateInputs, null, 2));
    logger.info('Found date inputs:', JSON.stringify(dateInputs, null, 2));
    
    // Find the date input
    const dateInput = page.locator('input[name*="date" i], input[id*="date" i]').first();
    
    if (await dateInput.count() > 0) {
      logger.info('Date input found, inspecting...');
      
      // Get detailed info about the date input
      const inputInfo = await page.evaluate((selector) => {
        const input = document.querySelector(selector);
        if (!input) return null;
        
        // Get all attributes
        const attrs = {};
        for (const attr of input.attributes) {
          attrs[attr.name] = attr.value;
        }
        
        // Check for calendar/datepicker libraries
        const hasDatePicker = input.hasAttribute('data-datepicker') || 
                              input.classList.contains('datepicker') ||
                              input.classList.contains('calendar') ||
                              input.getAttribute('data-toggle') === 'datepicker' ||
                              input.getAttribute('data-provide') === 'datepicker';
        
        // Check parent elements for date picker containers
        let parent = input.parentElement;
        const parentClasses = [];
        while (parent && parentClasses.length < 5) {
          parentClasses.push({
            tag: parent.tagName,
            class: parent.className,
            id: parent.id,
          });
          parent = parent.parentElement;
        }
        
        return {
          attributes: attrs,
          hasDatePicker,
          parentClasses,
          currentValue: input.value,
          type: input.type,
        };
      }, 'input[name*="date" i], input[id*="date" i]').catch(() => null);
      
      console.log('\n=== DATE INPUT DETAILED INFO ===');
      console.log(JSON.stringify(inputInfo, null, 2));
      logger.info('Date input detailed info:', JSON.stringify(inputInfo, null, 2));
      
      // Click the date input to see if calendar appears
      logger.info('Clicking date input to open calendar...');
      await dateInput.click();
      await page.waitForTimeout(2000);
      
      // Check for calendar elements
      const calendarInfo = await page.evaluate(() => {
        // Look for common calendar/datepicker elements
        const calendars = Array.from(document.querySelectorAll('.calendar, .datepicker, [class*="picker"], [class*="Calendar"], [id*="calendar"], [id*="datepicker"], .ui-datepicker, [class*="DatePicker"]'));
        
        return calendars.map(cal => ({
          tag: cal.tagName,
          id: cal.id || '',
          className: cal.className || '',
          text: (cal.textContent || '').substring(0, 200),
          visible: cal.offsetParent !== null,
          position: {
            x: cal.getBoundingClientRect().x,
            y: cal.getBoundingClientRect().y,
            width: cal.getBoundingClientRect().width,
            height: cal.getBoundingClientRect().height,
          },
        }));
      });
      
      console.log('\n=== CALENDAR ELEMENTS FOUND ===');
      console.log(JSON.stringify(calendarInfo, null, 2));
      logger.info('Calendar elements found after click:', JSON.stringify(calendarInfo, null, 2));
      
      // Try to fill a date
      logger.info('Attempting to fill date: 27/12/2025');
      await dateInput.fill('27/12/2025');
      await page.waitForTimeout(1000);
      
      const valueAfterFill = await dateInput.inputValue();
      logger.info('Date value after fill:', valueAfterFill);
      
      // Trigger events
      await dateInput.press('Tab');
      await page.waitForTimeout(500);
      
      const valueAfterTab = await dateInput.inputValue();
      logger.info('Date value after Tab:', valueAfterTab);
      
      // Try triggering JavaScript events
      await page.evaluate((selector) => {
        const input = document.querySelector(selector);
        if (input) {
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('blur', { bubbles: true }));
        }
      }, 'input[name*="date" i], input[id*="date" i]');
      
      await page.waitForTimeout(500);
      const valueAfterEvents = await dateInput.inputValue();
      logger.info('Date value after JavaScript events:', valueAfterEvents);
      
      // Check form state
      const formState = await page.evaluate(() => {
        const form = document.querySelector('form');
        if (!form) return null;
        
        const formData = new FormData(form);
        const data = {};
        for (const [key, value] of formData.entries()) {
          data[key] = value;
        }
        
        return {
          action: form.action,
          method: form.method,
          data,
        };
      });
      
      logger.info('Form state:', JSON.stringify(formState, null, 2));
      
      // Take screenshot
      await page.screenshot({ path: 'screenshots/date-picker-inspection.png', fullPage: true });
      logger.info('Screenshot saved: screenshots/date-picker-inspection.png');
    } else {
      logger.info('No date input found!');
    }
    
    logger.info('Keeping browser open for 60 seconds for manual inspection...');
    await page.waitForTimeout(60000);
    
  } catch (error) {
    logger.error('Error inspecting date picker:', error);
    await page.screenshot({ path: 'screenshots/date-picker-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

inspectDatePicker().catch(console.error);
