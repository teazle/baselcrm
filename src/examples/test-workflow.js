import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClaimWorkflow } from '../core/claim-workflow.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/**
 * Test script for the complete claim workflow
 * 
 * IMPORTANT: This saves as DRAFT only, does NOT submit claims
 */
async function testWorkflow() {
  const browserManager = new BrowserManager();
  
  try {
    await browserManager.init();
    
    // Create two pages - one for Clinic Assist, one for MHC Asia
    const clinicAssistPage = await browserManager.newPage();
    // Clinic Assist can enforce single-tab behavior; keep MHC in an isolated context.
    const mhcAsiaPage = await browserManager.newIsolatedPage();
    
    // Create workflow instance
    const workflow = new ClaimWorkflow(clinicAssistPage, mhcAsiaPage);
    
    // Workflow parameters (prefer env vars so you don't edit code each run)
    // NOTE: patientIdentifier should match what appears in Clinic Assist Queue row text.
    const workflowParams = {
      branchName: process.env.WORKFLOW_BRANCH || '__FIRST__',
      // In Clinic Assist, you mentioned we use Reception as Rooms
      deptName: process.env.WORKFLOW_DEPT || 'Reception',
      patientIdentifier: process.env.WORKFLOW_PATIENT || 'John Doe',
      cardNumber: process.env.WORKFLOW_CARD || null,
      verificationCode: process.env.WORKFLOW_2FA_CODE || null,
      consultationMax: process.env.WORKFLOW_CONSULT_MAX
        ? Number(process.env.WORKFLOW_CONSULT_MAX)
        : null,
      // If set to 1/true, we click "Save As Draft" at the end. Otherwise we stop after filling and keep browser open.
      saveDraft: process.env.WORKFLOW_SAVE_DRAFT || null,
    };
    
    logger.info('=== Starting Test Workflow ===');
    logger.info('Parameters:', workflowParams);
    const shouldSaveDraft =
      workflowParams.saveDraft === true ||
      workflowParams.saveDraft === 'true' ||
      workflowParams.saveDraft === '1';
    logger.info(`NOTE: Will ${shouldSaveDraft ? 'SAVE AS DRAFT' : 'STOP AFTER FILLING'} (never submit)`);
    
    // Execute workflow
    const result = await workflow.executeWorkflow(workflowParams);
    
    logger.info('=== Workflow Result ===');
    logger.info(JSON.stringify(result, null, 2));
    
    // Keep browser open so you can review the filled draft
    // Default 120s; set WORKFLOW_KEEP_OPEN_MS=0 to skip waiting
    const keepOpenMs = process.env.WORKFLOW_KEEP_OPEN_MS
      ? Number(process.env.WORKFLOW_KEEP_OPEN_MS)
      : 120000;
    if (keepOpenMs > 0) {
      logger.info(`Keeping browser open for ${keepOpenMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, keepOpenMs));
    }
    
  } catch (error) {
    logger.error('Test workflow failed:', error);
    const keepOnError = process.env.WORKFLOW_KEEP_OPEN_ON_ERROR === 'true' || process.env.WORKFLOW_KEEP_OPEN_ON_ERROR === '1';
    if (keepOnError) {
      logger.warn('Keeping browser open due to WORKFLOW_KEEP_OPEN_ON_ERROR=true');
      await new Promise((resolve) => setTimeout(resolve, 600000));
    }
  } finally {
    await browserManager.close();
  }
}

testWorkflow().catch(console.error);

