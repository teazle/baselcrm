#!/usr/bin/env node

/**
 * Debug MHC Form Selectors
 * This script logs the actual HTML structure to help debug selector issues
 */

import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { MHCAsiaAutomation } from '../automations/mhc-asia.js';
import { logger } from '../utils/logger.js';

dotenv.config();

async function debugMHCSelectors() {
  const browserManager = new BrowserManager();
  
  try {
    const nric = 'S8635560D';
    
    logger.info('=== Debug MHC Form Selectors ===\n');
    
    await browserManager.init();
    const page = await browserManager.newPage();
    const mhcAsia = new MHCAsiaAutomation(page);
    
    // Setup dialog handler
    page.on('dialog', async (dialog) => {
      logger.info(`\n>>> DIALOG: ${dialog.type()} - ${dialog.message()}`);
      await dialog.accept();
      logger.info('>>> DIALOG ACCEPTED\n');
    });
    
    // Login
    logger.info('Logging in...');
    await mhcAsia.login();
    
    // Navigate to search
    logger.info('Navigating to search...');
    await mhcAsia.navigateToAIAProgramSearch();
    
    // Search patient
    logger.info('Searching for patient...');
    const searchResult = await mhcAsia.searchPatientByNRIC(nric);
    
    // Open patient
    logger.info('Opening patient...');
    await mhcAsia.openPatientFromSearchResults(nric);
    await mhcAsia.addVisit(searchResult.portal);
    
    // Wait for form
    await page.waitForTimeout(3000);
    
    logger.info('\n=== DEBUGGING FORM ELEMENTS ===\n');
    
    // Debug Charge Type
    const chargeTypeInfo = await page.evaluate(() => {
      const selects = document.querySelectorAll('select');
      const results = [];
      selects.forEach((sel, i) => {
        const row = sel.closest('tr');
        const rowText = row ? row.textContent.substring(0, 100) : 'no row';
        const options = Array.from(sel.options).map(o => `${o.value}:${o.text}`).join(', ');
        results.push({
          index: i,
          name: sel.name,
          id: sel.id,
          rowText: rowText.replace(/\s+/g, ' ').trim(),
          options: options
        });
      });
      return results;
    });
    
    logger.info('SELECT elements found:');
    chargeTypeInfo.forEach(info => {
      logger.info(`  [${info.index}] name="${info.name}" id="${info.id}"`);
      logger.info(`      Row: ${info.rowText.substring(0, 80)}...`);
      logger.info(`      Options: ${info.options}`);
    });
    
    // Debug Consultation Fee
    logger.info('\n--- Consultation Fee ---');
    const consultFeeInfo = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="text"]');
      const results = [];
      inputs.forEach((input, i) => {
        const row = input.closest('tr');
        const rowText = row ? row.textContent : '';
        if (rowText.toLowerCase().includes('consult')) {
          results.push({
            index: i,
            name: input.name,
            id: input.id,
            value: input.value,
            rowText: rowText.replace(/\s+/g, ' ').trim().substring(0, 100)
          });
        }
      });
      return results;
    });
    
    logger.info('Consultation fee inputs:');
    consultFeeInfo.forEach(info => {
      logger.info(`  name="${info.name}" id="${info.id}" value="${info.value}"`);
      logger.info(`  Row: ${info.rowText}`);
    });
    
    // Debug M button
    logger.info('\n--- M Buttons (for Diagnosis) ---');
    const mButtonInfo = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[value="M"]');
      const results = [];
      inputs.forEach((input, i) => {
        const row = input.closest('tr');
        const rowText = row ? row.textContent : '';
        results.push({
          index: i,
          name: input.name,
          id: input.id,
          type: input.type,
          rowText: rowText.replace(/\s+/g, ' ').trim().substring(0, 100)
        });
      });
      return results;
    });
    
    logger.info('M buttons found:');
    mButtonInfo.forEach(info => {
      logger.info(`  [${info.index}] name="${info.name}" id="${info.id}" type="${info.type}"`);
      logger.info(`      Row: ${info.rowText}`);
    });
    
    // Try to interact
    logger.info('\n=== TRYING INTERACTIONS ===\n');
    
    // 1. Try changing consultation fee
    logger.info('1. Setting consultation fee to 99999...');
    const feeResult = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="text"]');
      for (const input of inputs) {
        const row = input.closest('tr');
        if (row && row.textContent.toLowerCase().includes('consultation fee')) {
          const oldValue = input.value;
          input.focus();
          input.value = '99999';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.blur();
          return { found: true, name: input.name, oldValue, newValue: input.value };
        }
      }
      return { found: false };
    });
    logger.info(`   Result: ${JSON.stringify(feeResult)}`);
    
    await page.waitForTimeout(2000);
    
    // 2. Try changing charge type
    logger.info('2. Setting charge type to New Visit...');
    const chargeResult = await page.evaluate(() => {
      const selects = document.querySelectorAll('select');
      for (const select of selects) {
        const row = select.closest('tr');
        if (row && row.textContent.toLowerCase().includes('charge type')) {
          for (const opt of select.options) {
            if (opt.text.toLowerCase().includes('new')) {
              select.value = opt.value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
              return { found: true, selectedValue: opt.value, selectedText: opt.text };
            }
          }
        }
      }
      return { found: false };
    });
    logger.info(`   Result: ${JSON.stringify(chargeResult)}`);
    
    // 3. Try clicking M button for diagnosis
    logger.info('3. Clicking M button for Diagnosis Pri...');
    const mClickResult = await page.evaluate(() => {
      const rows = document.querySelectorAll('tr');
      for (const row of rows) {
        if (row.textContent.includes('Diagnosis Pri')) {
          const mButton = row.querySelector('input[value="M"]');
          if (mButton) {
            mButton.click();
            return { found: true, clicked: true };
          }
        }
      }
      // Try exact selector
      const exactBtn = document.querySelector('#visit_form > table > tbody > tr:nth-child(2) > td > table > tbody > tr:nth-child(14) > td:nth-child(2) > input');
      if (exactBtn) {
        exactBtn.click();
        return { found: true, clicked: true, method: 'exact selector' };
      }
      return { found: false };
    });
    logger.info(`   Result: ${JSON.stringify(mClickResult)}`);
    
    await page.waitForTimeout(2000);
    
    // Take screenshot
    await page.screenshot({ path: 'screenshots/debug-mhc-after-interactions.png', fullPage: true });
    logger.info('\nScreenshot saved: screenshots/debug-mhc-after-interactions.png');
    
    logger.info('\n>>> BROWSER OPEN FOR REVIEW <<<\n');
    
    await new Promise(() => {});
    
  } catch (error) {
    logger.error('Error:', error.message);
    await new Promise(() => {});
  }
}

debugMHCSelectors();
