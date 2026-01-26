#!/usr/bin/env node

/**
 * Test form filling for patient 78025 from January 15, 2026
 * Navigates to the correct date and finds the patient
 */

import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClaimWorkflow } from '../core/claim-workflow.js';
import { logger } from '../utils/logger.js';

dotenv.config();

async function testPatient78025Jan15() {
  const browserManager = new BrowserManager();
  
  try {
    logger.info('=== Testing Patient 78025 (Jan 15, 2026) Form Filling ===\n');
    
    // Set DISPLAY for VNC if available
    if (!process.env.DISPLAY) {
      process.env.DISPLAY = ':1';
      logger.info(`Set DISPLAY=${process.env.DISPLAY} for VNC`);
    }
    
    // Initialize browser
    await browserManager.init();
    
    // Create pages
    const clinicAssistPage = await browserManager.newPage();
    const mhcAsiaPage = await browserManager.newIsolatedPage();
    
    // Create workflow instance
    const workflow = new ClaimWorkflow(clinicAssistPage, mhcAsiaPage);
    
    // Step 1: Login to Clinic Assist and navigate to queue
    logger.info('Step 1: Logging into Clinic Assist...');
    const { ClinicAssistAutomation } = await import('../automations/clinic-assist.js');
    const clinicAssist = new ClinicAssistAutomation(clinicAssistPage);
    await clinicAssist.login();
    logger.info('✓ Login successful\n');
    
    // Step 2: Navigate to Queue
    logger.info('Step 2: Navigating to Queue...');
    await clinicAssist.navigateToQueue('__FIRST__', 'Reception');
    logger.info('✓ Navigated to Queue\n');
    
    // Step 3: Set date filter to January 15, 2026
    logger.info('Step 3: Setting date filter to January 15, 2026...');
    await clinicAssistPage.waitForTimeout(2000);
    
    // Try to find and set date filter
    const dateSet = await clinicAssistPage.evaluate(() => {
      // Look for date input fields
      const dateInputs = Array.from(document.querySelectorAll('input[type="date"], input[name*="date" i], input[id*="date" i]'));
      for (const input of dateInputs) {
        try {
          // Set date to 2026-01-15
          input.value = '2026-01-15';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        } catch (e) {
          continue;
        }
      }
      
      // Try text inputs with date pickers
      const textDateInputs = Array.from(document.querySelectorAll('input[type="text"]'));
      for (const input of textDateInputs) {
        const placeholder = (input.placeholder || '').toLowerCase();
        const name = (input.name || '').toLowerCase();
        const id = (input.id || '').toLowerCase();
        if (placeholder.includes('date') || name.includes('date') || id.includes('date')) {
          try {
            // Try different date formats
            input.value = '15/01/2026';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          } catch (e) {
            continue;
          }
        }
      }
      
      return false;
    });
    
    if (dateSet) {
      logger.info('✓ Date filter set to Jan 15, 2026');
      await clinicAssistPage.waitForTimeout(2000);
      
      // Try to trigger search/filter
      const searchTriggered = await clinicAssistPage.evaluate(() => {
        // Look for search/filter buttons
        const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'));
        for (const btn of buttons) {
          const text = (btn.textContent || btn.value || '').toLowerCase();
          if (text.includes('search') || text.includes('filter') || text.includes('go') || text.includes('apply')) {
            try {
              btn.click();
              return true;
            } catch (e) {
              continue;
            }
          }
        }
        return false;
      });
      
      if (searchTriggered) {
        logger.info('✓ Search/filter triggered');
        await clinicAssistPage.waitForTimeout(3000);
      }
    } else {
      logger.warn('Could not set date filter - will search in current queue');
    }
    
    await clinicAssistPage.screenshot({ 
      path: 'screenshots/clinic-assist-queue-jan15.png', 
      fullPage: true 
    });
    
    // Step 4: Now try to find patient 78025
    logger.info('\nStep 4: Searching for patient 78025 in queue...');
    
    // Workflow parameters
    const workflowParams = {
      branchName: process.env.WORKFLOW_BRANCH || '__FIRST__',
      deptName: process.env.WORKFLOW_DEPT || 'Reception',
      patientIdentifier: '78025', // Patient number
      cardNumber: process.env.WORKFLOW_CARD || null,
      verificationCode: process.env.WORKFLOW_2FA_CODE || null,
      consultationMax: process.env.WORKFLOW_CONSULT_MAX
        ? Number(process.env.WORKFLOW_CONSULT_MAX)
        : null,
      saveDraft: false, // DO NOT save draft - just fill and stop
    };
    
    logger.info('=== Starting Workflow for Patient 78025 (Jan 15, 2026) ===');
    logger.info('Parameters:', workflowParams);
    logger.info('NOTE: Will FILL FORM and STOP (will NOT save draft)\n');
    
    // Execute workflow (it will try to find patient 78025)
    const result = await workflow.executeWorkflow(workflowParams);
    
    logger.info('\n=== Workflow Result ===');
    logger.info(JSON.stringify(result, null, 2));
    
    // Take final screenshots
    logger.info('\n=== Taking Final Screenshots ===');
    await mhcAsiaPage.screenshot({ 
      path: 'screenshots/mhc-form-filled-78025-jan15.png', 
      fullPage: true 
    });
    logger.info('✓ Screenshot saved: screenshots/mhc-form-filled-78025-jan15.png');
    
    // Keep browser open for review (30 minutes)
    logger.info('\n=== Browser will stay open for 30 minutes ===');
    logger.info('You can now review the filled form in the browser');
    logger.info('Press Ctrl+C to close when done\n');
    
    await new Promise(resolve => setTimeout(resolve, 1800000));
    
  } catch (error) {
    logger.error('Test failed:', error);
    
    // Take error screenshots
    try {
      const pages = await browserManager.getAllPages();
      for (let i = 0; i < pages.length; i++) {
        await pages[i].screenshot({ 
          path: `screenshots/error-page-${i}-78025-jan15.png`, 
          fullPage: true 
        });
      }
      logger.info('Error screenshots saved');
    } catch (e) {
      logger.warn('Could not take error screenshots:', e.message);
    }
    
    // Keep browser open on error
    logger.warn('\n=== Keeping browser open due to error ===');
    logger.warn('Review the browser to see what went wrong');
    logger.warn('Press Ctrl+C to close\n');
    
    await new Promise((resolve) => setTimeout(resolve, 1800000));
  } finally {
    logger.info('Closing browser...');
    await browserManager.close();
  }
}

testPatient78025Jan15().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
