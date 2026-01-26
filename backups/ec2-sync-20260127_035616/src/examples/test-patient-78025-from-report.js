#!/usr/bin/env node

/**
 * Test form filling for patient 78025 from January 15, 2026
 * Uses Queue Report to find the patient from that date
 */

import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClaimWorkflow } from '../core/claim-workflow.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { MHCAsiaAutomation } from '../automations/mhc-asia.js';
import { logger } from '../utils/logger.js';

dotenv.config();

async function testPatient78025FromReport() {
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
    
    // Step 1: Login to Clinic Assist
    logger.info('Step 1: Logging into Clinic Assist...');
    const clinicAssist = new ClinicAssistAutomation(clinicAssistPage);
    await clinicAssist.login();
    logger.info('✓ Login successful\n');
    
    // Step 2: Navigate directly to Patient Search
    // (Simplified approach - Queue Report navigation is unreliable)
    logger.info('Step 2: Navigating to Patient Page...');
    await clinicAssist.navigateToPatientPage();
    logger.info('✓ Navigated to Patient Page\n');
    
    // Step 3: Search for patient 78025
    logger.info('Step 3: Searching for patient 78025...');
    const patientNumber = '78025';
    await clinicAssist.searchPatientByNumber(patientNumber);
    logger.info('✓ Patient search completed\n');
    
    // Step 4: Open patient from search results
    logger.info('Step 4: Opening patient record...');
    await clinicAssist.openPatientFromSearchResultsByNumber(patientNumber);
    logger.info('✓ Patient record opened\n');
    
    // Step 5: Extract patient data directly (patient is already open)
    logger.info('Step 5: Extracting patient NRIC from patient record...');
    const nric = await clinicAssist.extractPatientNricFromPatientInfo();
    logger.info(`✓ NRIC extracted: ${nric}\n`);
    
    if (!nric) {
      throw new Error('Could not extract NRIC from patient record');
    }
    
    // Step 6: Navigate to TX History and extract diagnosis
    logger.info('Step 6: Extracting diagnosis from TX History...');
    await clinicAssist.navigateToTXHistory();
    await clinicAssist.openDiagnosisTab();
    const diagnosis = await clinicAssist.extractDiagnosisFromTXHistory();
    logger.info(`✓ Diagnosis extracted: ${diagnosis?.description || 'Not found'}\n`);
    
    // Step 7: Extract claim details from current visit
    logger.info('Step 7: Extracting claim details...');
    const claimDetails = await clinicAssist.extractClaimDetailsFromCurrentVisit();
    logger.info(`✓ Claim details extracted: ${claimDetails.items?.length || 0} items\n`);
    
    // Step 8: Login to MHC Asia
    logger.info('Step 8: Logging into MHC Asia...');
    const mhcAsia = new MHCAsiaAutomation(mhcAsiaPage);
    await mhcAsia.login();
    logger.info('✓ MHC Asia login successful\n');
    
    // Step 9: Navigate to AIA Program search
    logger.info('Step 9: Navigating to AIA Program search...');
    await mhcAsia.navigateToAIAProgramSearch();
    logger.info('✓ Navigated to AIA Program search\n');
    
    // Step 10: Search patient by NRIC
    logger.info(`Step 10: Searching patient by NRIC: ${nric}...`);
    const searchResult = await mhcAsia.searchPatientByNRIC(nric);
    logger.info(`✓ Search result: portal=${searchResult.portal}\n`);
    
    // Step 11: Open patient from search results
    logger.info('Step 11: Opening patient from search results...');
    await mhcAsia.openPatientFromSearchResults(nric);
    logger.info('✓ Patient opened\n');
    
    // Step 12: Add visit
    logger.info(`Step 12: Adding visit for portal: ${searchResult.portal}...`);
    await mhcAsia.addVisit(searchResult.portal);
    logger.info('✓ Visit added\n');
    
    // Step 13: Fill form fields
    logger.info('Step 13: Filling form fields...\n');
    
    // Fill visit type
    await mhcAsia.fillVisitTypeFromClinicAssist('New');
    logger.info('  ✓ Visit type filled');
    
    // Fill MC days
    await mhcAsia.fillMcDays(claimDetails.mcDays || 0);
    logger.info('  ✓ MC days filled');
    
    // Fill diagnosis
    if (diagnosis?.description || claimDetails.diagnosisText) {
      await mhcAsia.fillDiagnosisFromText(diagnosis?.description || claimDetails.diagnosisText);
      logger.info('  ✓ Diagnosis filled');
    }
    
    // Set consultation fee max
    await mhcAsia.setConsultationFeeMax(9999);
    logger.info('  ✓ Consultation fee max set');
    
    // Fill services and drugs
    if (claimDetails.items && claimDetails.items.length > 0) {
      await mhcAsia.fillServicesAndDrugs(claimDetails.items);
      logger.info(`  ✓ Services/drugs filled (${claimDetails.items.length} items)`);
    }
    
    logger.info('\n✓ Form filling complete!\n');
    
    // Take final screenshot
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

testPatient78025FromReport().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
