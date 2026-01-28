#!/usr/bin/env node

/**
 * Batch Test MHC Form Filling for Jan 23, 2026
 * 
 * Processes both MHC patients:
 * 1. PCNO 75434 - CHEW SIEW LING
 * 2. PCNO 7069 - LI MEIOH
 */

import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { MHCAsiaAutomation } from '../automations/mhc-asia.js';
import { logger } from '../utils/logger.js';

dotenv.config();

// MHC patients for Jan 23, 2026
const MHC_PATIENTS_JAN23 = [
  { pcno: '75434', name: 'CHEW SIEW LING', contract: 'MHC', total: 80 },
  { pcno: '7069', name: 'LI MEIOH', contract: 'MHC', total: 218 },
];

const VISIT_DATE = '2026-01-23';

function formatDateForMHC(dateStr) {
  if (!dateStr) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  return dateStr;
}

async function processPatient(patient, caPage, mhcPage, caAutomation, mhcAutomation, patientIndex, totalPatients) {
  const startTime = Date.now();
  
  logger.info('');
  logger.info('╔═══════════════════════════════════════════════════════════════════╗');
  logger.info(`║ PATIENT ${patientIndex}/${totalPatients}: ${patient.name} (${patient.pcno})`);
  logger.info('╚═══════════════════════════════════════════════════════════════════╝');
  logger.info('');
  
  try {
    // Reset Clinic Assist - click Reception button to ensure correct state
    logger.info('   🔄 Resetting Clinic Assist state...');
    try {
      // Try clicking Reception button to reset to reception room
      const receptionBtn = caPage.locator('button:has-text("Reception")').first();
      if (await receptionBtn.isVisible({ timeout: 2000 })) {
        await receptionBtn.click();
        await caPage.waitForTimeout(1500);
      }
    } catch (e) {
      // If not on home page, we're already in the right state
    }
    
    // Step 1: Get charge type and diagnosis from Clinic Assist
    logger.info('┌─────────────────────────────────────────────────────────────┐');
    logger.info('│ STEP 1: Get Charge Type and Diagnosis from Clinic Assist  │');
    logger.info('└─────────────────────────────────────────────────────────────┘');
    
    await caAutomation.navigateToPatientPage();
    await caAutomation.searchPatientByNumber(patient.pcno);
    await caAutomation.openPatientFromSearchResultsByNumber(patient.pcno);
    
    // Get NRIC
    const nric = await caAutomation.getPatientNRIC();
    logger.info(`   NRIC: ${nric}`);
    
    // Get charge type and diagnosis
    const txData = await caAutomation.getChargeTypeAndDiagnosis(VISIT_DATE);
    const chargeType = txData.chargeType || 'follow';
    const diagnosis = txData.diagnosis || '';
    const mcDays = txData.mcDays || 0;
    const mcStartDate = txData.mcStartDate || '';
    
    logger.info(`   Charge Type: ${chargeType}`);
    logger.info(`   Diagnosis: ${diagnosis}`);
    logger.info(`   MC Days: ${mcDays}, Start: ${mcStartDate}`);
    
    // Step 2: Fill MHC Form
    logger.info('');
    logger.info('┌─────────────────────────────────────────────────────────────┐');
    logger.info('│ STEP 2: Fill MHC Form                                       │');
    logger.info('└─────────────────────────────────────────────────────────────┘');
    
    // Setup dialog handler for auto-accepting prompts
    mhcAutomation.setupDialogHandler();
    
    // Navigate to Normal Visit search
    await mhcAutomation.navigateToNormalVisit();
    
    // Search for patient by NRIC
    const searchResult = await mhcAutomation.searchPatientByNRIC(nric);
    logger.info(`   Portal: ${searchResult.portal}`);
    
    // Open patient from search results
    await mhcAutomation.openPatientFromSearchResults(nric);
    
    // Add visit
    await mhcAutomation.addVisit(searchResult.portal);
    await mhcPage.waitForTimeout(500);
    
    // Fill visit form
    const visitDateFormatted = formatDateForMHC(VISIT_DATE);
    await mhcAutomation.fillVisitDate(visitDateFormatted);
    
    // Set charge type
    if (chargeType === 'first') {
      await mhcAutomation.setChargeTypeNewVisit();
    } else {
      await mhcAutomation.setChargeTypeFollowUp();
    }
    await mhcPage.waitForTimeout(200);
    
    // Set consultation fee (99999 triggers max amount dialog)
    await mhcAutomation.fillConsultationFee(99999);
    await mhcPage.waitForTimeout(500);
    
    // Fill MC if applicable
    if (mcDays > 0 && mcStartDate) {
      await mhcAutomation.fillMcDays(mcDays);
      await mhcAutomation.fillMcStartDate(mcStartDate);
    }
    
    // Fill diagnosis if available
    if (diagnosis && diagnosis.description) {
      await mhcAutomation.selectDiagnosis(diagnosis.description);
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info('');
    logger.info(`✅ PATIENT ${patientIndex}/${totalPatients} COMPLETE (${elapsed}s)`);
    logger.info(`   Name: ${patient.name}`);
    logger.info(`   PCNO: ${patient.pcno}`);
    logger.info(`   NRIC: ${nric}`);
    logger.info(`   Charge Type: ${chargeType}`);
    logger.info(`   Diagnosis: ${diagnosis}`);
    
    return { success: true, patient, elapsed, nric, chargeType, diagnosis };
    
  } catch (error) {
    logger.error(`❌ ERROR processing ${patient.name}: ${error.message}`);
    return { success: false, patient, error: error.message };
  }
}

async function runBatchTest() {
  logger.info('');
  logger.info('══════════════════════════════════════════════════════════════════════');
  logger.info('  MHC BATCH FORM FILLING - JAN 23, 2026');
  logger.info('══════════════════════════════════════════════════════════════════════');
  logger.info('');
  logger.info(`  Date: ${VISIT_DATE}`);
  logger.info(`  Patients: ${MHC_PATIENTS_JAN23.length}`);
  MHC_PATIENTS_JAN23.forEach((p, i) => {
    logger.info(`    ${i+1}. ${p.name} (${p.pcno}) - $${p.total}`);
  });
  logger.info('');
  
  const browserManager = new BrowserManager();
  const startTime = Date.now();
  
  try {
    // Create pages
    const caPage = await browserManager.newPage();
    const mhcPage = await browserManager.newPage();
    
    // Initialize automations
    const caAutomation = new ClinicAssistAutomation(caPage, 'ssoc');
    const mhcAutomation = new MHCAsiaAutomation(mhcPage);
    
    // Login to both systems
    logger.info('Logging into Clinic Assist...');
    await caAutomation.login();
    logger.info('✅ Clinic Assist login successful');
    
    logger.info('Logging into MHC Asia...');
    await mhcAutomation.login();
    logger.info('✅ MHC Asia login successful');
    
    // Process each patient
    const results = [];
    for (let i = 0; i < MHC_PATIENTS_JAN23.length; i++) {
      const patient = MHC_PATIENTS_JAN23[i];
      const result = await processPatient(
        patient, 
        caPage, 
        mhcPage, 
        caAutomation, 
        mhcAutomation,
        i + 1,
        MHC_PATIENTS_JAN23.length
      );
      results.push(result);
      
      // Wait between patients
      if (i < MHC_PATIENTS_JAN23.length - 1) {
        logger.info('');
        logger.info('--- Waiting 3s before next patient ---');
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    
    // Summary
    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    logger.info('');
    logger.info('══════════════════════════════════════════════════════════════════════');
    logger.info('  BATCH SUMMARY');
    logger.info('══════════════════════════════════════════════════════════════════════');
    logger.info(`  Total Time: ${totalElapsed}s`);
    logger.info(`  Successful: ${successful}/${MHC_PATIENTS_JAN23.length}`);
    logger.info(`  Failed: ${failed}/${MHC_PATIENTS_JAN23.length}`);
    logger.info('');
    
    results.forEach((r, i) => {
      if (r.success) {
        logger.info(`  ✅ ${i+1}. ${r.patient.name} - ${r.elapsed}s`);
      } else {
        logger.info(`  ❌ ${i+1}. ${r.patient.name} - ERROR: ${r.error}`);
      }
    });
    logger.info('');
    
  } catch (error) {
    logger.error('Fatal error:', error);
  } finally {
    await browserManager.close();
  }
}

runBatchTest().catch(console.error);
