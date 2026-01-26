#!/usr/bin/env node

/**
 * Explore MHC Asia form structure to understand what fields need to be filled
 */

import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { MHCAsiaAutomation } from '../automations/mhc-asia.js';
import { logger } from '../utils/logger.js';

dotenv.config();

async function exploreMHCForm() {
  const browserManager = new BrowserManager();
  let page = null;

  try {
    logger.info('=== Exploring MHC Asia Form Structure ===\n');

    // Initialize browser
    const context = await browserManager.init();
    page = await context.newPage();

    const mhc = new MHCAsiaAutomation(page);

    // Step 1: Login
    logger.info('Step 1: Logging in...');
    await mhc.login();
    logger.info('✓ Login successful\n');

    // Step 2: Navigate to AIA Program search
    logger.info('Step 2: Navigating to AIA Program search...');
    await mhc.navigateToAIAProgramSearch();
    logger.info('✓ Navigated to AIA Program search\n');

    // Step 3: Search for a test patient (use a known NRIC or skip)
    logger.info('Step 3: Searching for patient...');
    logger.info('(Skipping patient search - you can add a test NRIC here)\n');

    // Step 4: If we're on a form page, explore it
    logger.info('Step 4: Exploring form structure...\n');

    // Wait for page to load
    await page.waitForTimeout(3000);

    // Take screenshot
    await page.screenshot({ path: 'screenshots/mhc-form-exploration.png', fullPage: true });
    logger.info('✓ Screenshot saved: screenshots/mhc-form-exploration.png\n');

    // Get all form fields
    const formData = await page.evaluate(() => {
      const data = {
        forms: [],
        inputs: [],
        selects: [],
        textareas: [],
        buttons: [],
        tables: [],
      };

      // Get all forms
      const forms = Array.from(document.querySelectorAll('form'));
      data.forms = forms.map((form, idx) => ({
        index: idx,
        id: form.id || null,
        name: form.name || null,
        action: form.action || null,
        method: form.method || null,
        fieldCount: form.querySelectorAll('input, select, textarea').length,
      }));

      // Get all inputs
      const inputs = Array.from(document.querySelectorAll('input'));
      data.inputs = inputs.map((input, idx) => ({
        index: idx,
        type: input.type || 'text',
        name: input.name || null,
        id: input.id || null,
        placeholder: input.placeholder || null,
        value: input.value || null,
        label: input.labels?.[0]?.textContent?.trim() || null,
        required: input.required || false,
        disabled: input.disabled || false,
        visible: input.offsetWidth > 0 && input.offsetHeight > 0,
      }));

      // Get all selects
      const selects = Array.from(document.querySelectorAll('select'));
      data.selects = selects.map((select, idx) => ({
        index: idx,
        name: select.name || null,
        id: select.id || null,
        label: select.labels?.[0]?.textContent?.trim() || null,
        options: Array.from(select.options).map(opt => ({
          value: opt.value,
          text: opt.text.trim(),
        })),
        visible: select.offsetWidth > 0 && select.offsetHeight > 0,
      }));

      // Get all textareas
      const textareas = Array.from(document.querySelectorAll('textarea'));
      data.textareas = textareas.map((textarea, idx) => ({
        index: idx,
        name: textarea.name || null,
        id: textarea.id || null,
        placeholder: textarea.placeholder || null,
        label: textarea.labels?.[0]?.textContent?.trim() || null,
        visible: textarea.offsetWidth > 0 && textarea.offsetHeight > 0,
      }));

      // Get all buttons
      const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'));
      data.buttons = buttons.map((btn, idx) => ({
        index: idx,
        type: btn.type || 'button',
        text: btn.textContent?.trim() || btn.value || null,
        name: btn.name || null,
        id: btn.id || null,
        onclick: btn.onclick ? 'has onclick' : null,
        visible: btn.offsetWidth > 0 && btn.offsetHeight > 0,
      }));

      // Get all tables (forms often use tables for layout)
      const tables = Array.from(document.querySelectorAll('table'));
      data.tables = tables.map((table, idx) => ({
        index: idx,
        rows: table.rows.length,
        headers: Array.from(table.querySelectorAll('th')).map(th => th.textContent?.trim()),
        hasFormElements: table.querySelectorAll('input, select, textarea').length > 0,
      }));

      return data;
    });

    // Save form structure to file
    const fs = await import('fs');
    fs.writeFileSync(
      'mhc-form-structure.json',
      JSON.stringify(formData, null, 2)
    );

    logger.info('=== Form Structure Analysis ===\n');
    logger.info(`Forms found: ${formData.forms.length}`);
    logger.info(`Input fields: ${formData.inputs.length}`);
    logger.info(`Select dropdowns: ${formData.selects.length}`);
    logger.info(`Textareas: ${formData.textareas.length}`);
    logger.info(`Buttons: ${formData.buttons.length}`);
    logger.info(`Tables: ${formData.tables.length}\n`);

    // Show key fields
    logger.info('=== Key Form Fields ===\n');

    // Show inputs
    if (formData.inputs.length > 0) {
      logger.info('Input Fields:');
      formData.inputs
        .filter(inp => inp.visible && (inp.name || inp.id))
        .slice(0, 20)
        .forEach(inp => {
          logger.info(`  - ${inp.name || inp.id} (type: ${inp.type}, label: ${inp.label || 'N/A'})`);
        });
      logger.info('');
    }

    // Show selects
    if (formData.selects.length > 0) {
      logger.info('Select Dropdowns:');
      formData.selects
        .filter(sel => sel.visible && (sel.name || sel.id))
        .slice(0, 10)
        .forEach(sel => {
          logger.info(`  - ${sel.name || sel.id} (${sel.options.length} options, label: ${sel.label || 'N/A'})`);
          if (sel.options.length > 0 && sel.options.length <= 5) {
            sel.options.forEach(opt => {
              logger.info(`    * ${opt.value}: ${opt.text}`);
            });
          }
        });
      logger.info('');
    }

    // Show buttons
    if (formData.buttons.length > 0) {
      logger.info('Buttons:');
      formData.buttons
        .filter(btn => btn.visible && btn.text)
        .forEach(btn => {
          logger.info(`  - "${btn.text}" (type: ${btn.type}, name: ${btn.name || 'N/A'})`);
        });
      logger.info('');
    }

    logger.info('✓ Form structure saved to: mhc-form-structure.json');
    logger.info('✓ Screenshot saved to: screenshots/mhc-form-exploration.png');
    logger.info('\n=== Exploration Complete ===');

  } catch (error) {
    logger.error('Exploration failed:', error);
    if (page) {
      await page.screenshot({ path: 'screenshots/mhc-form-exploration-error.png', fullPage: true });
    }
    throw error;
  } finally {
    if (page) {
      await page.close();
    }
    await browserManager.close();
  }
}

// Run exploration
exploreMHCForm().catch((error) => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});
