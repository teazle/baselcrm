#!/usr/bin/env node

/**
 * Test MHC Asia form filling only (assumes we're already on the form page)
 * This helps test form filling without needing a full workflow
 */

import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { MHCAsiaAutomation } from '../automations/mhc-asia.js';
import { logger } from '../utils/logger.js';

dotenv.config();

async function testFormFilling() {
  const browserManager = new BrowserManager();
  let page = null;

  try {
    logger.info('=== Testing MHC Asia Form Filling ===\n');

    // Initialize browser
    const context = await browserManager.init();
    page = await context.newPage();

    const mhc = new MHCAsiaAutomation(page);

    // Step 1: Login
    logger.info('Step 1: Logging in...');
    await mhc.login();
    logger.info('✓ Login successful\n');

    // Step 2: Navigate to form (you'll need to adjust this based on actual flow)
    logger.info('Step 2: Navigating to claim form...');
    logger.info('(You may need to: search patient, add visit, etc.)\n');
    
    // For testing, we'll assume you manually navigate or use existing methods
    // await mhc.navigateToAIAProgramSearch();
    // await mhc.searchPatientByNRIC('S1234567A');
    // await mhc.addVisit('aiaclient');

    // Step 3: Test form filling with sample data
    logger.info('Step 3: Testing form filling with sample data...\n');

    const sampleClaimData = {
      visitType: 'New',
      mcDays: 3,
      diagnosisText: 'Upper respiratory tract infection',
      consultationMax: 150,
      items: [
        { name: 'Consultation', amount: 100, quantity: 1 },
        { name: 'Paracetamol 500mg', amount: 15, quantity: 10 },
        { name: 'Chest X-Ray', amount: 80, quantity: 1 },
      ],
    };

    // Test filling each field
    logger.info('Filling visit type...');
    await mhc.fillVisitTypeFromClinicAssist(sampleClaimData.visitType);

    logger.info('Filling MC days...');
    await mhc.fillMcDays(sampleClaimData.mcDays);

    logger.info('Filling diagnosis...');
    await mhc.fillDiagnosisFromText(sampleClaimData.diagnosisText);

    logger.info('Setting consultation fee max...');
    await mhc.setConsultationFeeMax(sampleClaimData.consultationMax);

    logger.info('Filling services and drugs...');
    const itemNames = sampleClaimData.items.map(item => item.name);
    await mhc.fillServicesAndDrugs(itemNames);

    // Take screenshot
    await page.screenshot({ 
      path: 'screenshots/mhc-form-filled-test.png', 
      fullPage: true 
    });

    logger.info('\n✓ Form filling test complete!');
    logger.info('Check screenshot: screenshots/mhc-form-filled-test.png');

  } catch (error) {
    logger.error('Form filling test failed:', error);
    if (page) {
      await page.screenshot({ 
        path: 'screenshots/mhc-form-filling-error.png', 
        fullPage: true 
      });
    }
    throw error;
  } finally {
    if (page) {
      await page.close();
    }
    await browserManager.close();
  }
}

// Run test
testFormFilling().catch((error) => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});
