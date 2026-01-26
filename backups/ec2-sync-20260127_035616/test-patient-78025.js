#!/usr/bin/env node

/**
 * Test form filling for patient 78025
 * Extracts data from Clinic Assist and fills MHC Asia form
 * Keeps browser open for review (does NOT save draft)
 */

import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClaimWorkflow } from '../core/claim-workflow.js';
import { logger } from '../utils/logger.js';

dotenv.config();

async function testPatient78025() {
  const browserManager = new BrowserManager();
  
  try {
    logger.info('=== Testing Patient 78025 Form Filling ===\n');
    
    // Initialize browser - use headed mode so user can see
    await browserManager.init();
    
    // Create two pages - one for Clinic Assist, one for MHC Asia
    const clinicAssistPage = await browserManager.newPage();
    const mhcAsiaPage = await browserManager.newIsolatedPage();
    
    // Create workflow instance
    const workflow = new ClaimWorkflow(clinicAssistPage, mhcAsiaPage);
    
    // Workflow parameters for patient 78025
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
    
    logger.info('=== Starting Workflow for Patient 78025 ===');
    logger.info('Parameters:', workflowParams);
    logger.info('NOTE: Will FILL FORM and STOP (will NOT save draft)\n');
    
    // Execute workflow
    const result = await workflow.executeWorkflow(workflowParams);
    
    logger.info('\n=== Workflow Result ===');
    logger.info(JSON.stringify(result, null, 2));
    
    // Take final screenshots
    logger.info('\n=== Taking Final Screenshots ===');
    await mhcAsiaPage.screenshot({ 
      path: 'screenshots/mhc-form-filled-78025.png', 
      fullPage: true 
    });
    logger.info('✓ Screenshot saved: screenshots/mhc-form-filled-78025.png');
    
    // Keep browser open for review (30 minutes)
    logger.info('\n=== Browser will stay open for 30 minutes ===');
    logger.info('You can now review the filled form in the browser');
    logger.info('Press Ctrl+C to close when done\n');
    
    // Keep open for 30 minutes (1800000ms)
    await new Promise(resolve => setTimeout(resolve, 1800000));
    
  } catch (error) {
    logger.error('Test failed:', error);
    
    // Take error screenshots
    try {
      const pages = await browserManager.getAllPages();
      for (let i = 0; i < pages.length; i++) {
        await pages[i].screenshot({ 
          path: `screenshots/error-page-${i}-78025.png`, 
          fullPage: true 
        });
      }
      logger.info('Error screenshots saved');
    } catch (e) {
      logger.warn('Could not take error screenshots:', e.message);
    }
    
    // Keep browser open on error so user can see what happened
    logger.warn('\n=== Keeping browser open due to error ===');
    logger.warn('Review the browser to see what went wrong');
    logger.warn('Press Ctrl+C to close\n');
    
    await new Promise((resolve) => setTimeout(resolve, 1800000));
  } finally {
    // Don't close browser automatically - let user close it
    logger.info('Closing browser...');
    await browserManager.close();
  }
}

testPatient78025().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
