#!/usr/bin/env node

/**
 * Test MHC Form Filling for Patient 75434 (Visit Date: 23 Jan 2026)
 * 
 * FULL FLOW RECORDING:
 * 1. Parse Excel file
 * 2. Login to MHC Asia
 * 3. Search for patient
 * 4. Open patient and add visit
 * 5. Fill all form fields
 * 6. Compute claim
 * 7. Leave browser open for review
 * 
 * DO NOT SUBMIT - leave for manual review
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { BrowserManager } from '../utils/browser.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { MHCAsiaAutomation } from '../automations/mhc-asia.js';
import { logger } from '../utils/logger.js';

dotenv.config();

// Excel column mapping
const EXCEL_COLUMNS = {
  PCNO: 2,
  NAME: 3,
  CONTRACT: 29,
  TOTAL: 31
};

function formatDateForMHC(dateStr) {
  if (!dateStr) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  return dateStr;
}

function parseQueueReportExcel(excelPath) {
  const patients = [];
  try {
    const workbook = XLSX.readFile(excelPath);
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
    
    for (let i = 11; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < 5) continue;
      
      const pcno = row[EXCEL_COLUMNS.PCNO];
      const name = row[EXCEL_COLUMNS.NAME];
      const contract = row[EXCEL_COLUMNS.CONTRACT];
      
      if (!pcno || !name) continue;
      
      const contractStr = String(contract || '').toUpperCase();
      // Only MHC patients for now - Alliance will be built in the future
      if (contractStr.includes('MHC')) {
        patients.push({
          pcno: String(pcno),
          name: String(name),
          contract: contract,
          total: row[EXCEL_COLUMNS.TOTAL] || 0,
          portal: 'MHC'
        });
      }
    }
    return patients;
  } catch (error) {
    logger.error('Error parsing Excel:', error.message);
    return [];
  }
}

async function testMHCFormFilling() {
  const browserManager = new BrowserManager();
  let page = null;
  const timings = {}; // Track timing for all steps
  const startTime = Date.now();
  
  try {
    // Patient details
    const patientNumber = '75434';
    const nric = 'S8635560D';
    const visitDate = '2026-01-23';
    const visitDateForMHC = formatDateForMHC(visitDate);
    const excelPath = path.join(process.cwd(), 'downloads', 'queueListing.xls');
    
    logger.info('\n' + '='.repeat(70));
    logger.info('  MHC FORM FILLING - FULL FLOW RECORDING');
    logger.info('='.repeat(70));
    logger.info(`\n📋 Patient Details:`);
    logger.info(`   Patient Number: ${patientNumber}`);
    logger.info(`   NRIC: ${nric}`);
    logger.info(`   Visit Date: ${visitDateForMHC}`);
    logger.info(`   Excel File: ${excelPath}\n`);
    
    // ============================================
    // STEP 1: Parse Excel File
    // ============================================
    logger.info('┌─────────────────────────────────────────────────────────────┐');
    logger.info('│ STEP 1: Parse Excel File for MHC Patients                  │');
    logger.info('└─────────────────────────────────────────────────────────────┘');
    logger.info('');
    
    if (!fs.existsSync(excelPath)) {
      throw new Error(`❌ Excel file not found: ${excelPath}`);
    }
    
    logger.info('   📄 Reading Excel file...');
    const mhcPatients = parseQueueReportExcel(excelPath);
    
    if (mhcPatients.length === 0) {
      throw new Error('❌ No MHC patients found in Excel file');
    }
    
    logger.info(`   ✅ Found ${mhcPatients.length} MHC patient(s)`);
    
    const testPatient = mhcPatients.find(p => p.pcno === patientNumber);
    if (!testPatient) {
      throw new Error(`❌ Patient ${patientNumber} not found in MHC patients list`);
    }
    
    logger.info(`   ✅ Target Patient: ${testPatient.name}`);
    logger.info(`   ✅ Contract: ${testPatient.contract}`);
    logger.info(`   ✅ Total Amount: $${testPatient.total}`);
    logger.info('');
    
    // ============================================
    // STEP 2: Get Data from Clinic Assist
    // ============================================
    logger.info('┌─────────────────────────────────────────────────────────────┐');
    logger.info('│ STEP 2: Get Charge Type and Diagnosis from Clinic Assist  │');
    logger.info('└─────────────────────────────────────────────────────────────┘');
    logger.info('');
    
    logger.info('   🌐 Initializing browser for Clinic Assist...');
    const stepStart = Date.now();
    await browserManager.init();
    
    // Close all extra tabs (Urban VPN, about:blank, etc.)
    const allPages = browserManager.context.pages();
    logger.info(`   📑 Found ${allPages.length} tabs, closing extras...`);
    for (const p of allPages) {
      const url = p.url();
      if (url.includes('urban-vpn') || url === 'about:blank' || url === 'chrome://extensions') {
        try {
          await p.close();
          logger.info(`   ✅ Closed extra tab: ${url}`);
        } catch (e) {
          logger.warn(`   ⚠️  Could not close tab: ${url}`);
        }
      }
    }
    
    const clinicAssistPage = await browserManager.newPage();
    timings['browser_init'] = Date.now() - stepStart;
    
    // Dialog handler is now set up in ClinicAssistAutomation constructor
    const clinicAssist = new ClinicAssistAutomation(clinicAssistPage);
    
    logger.info('   🔐 Logging into Clinic Assist...');
    const loginStart = Date.now();
    await clinicAssist.login();
    timings['clinic_assist_login'] = Date.now() - loginStart;
    logger.info(`   ✅ Clinic Assist login successful (${timings['clinic_assist_login']}ms)`);
    
    logger.info(`   👤 Searching for patient ${patientNumber}...`);
    await clinicAssist.navigateToPatientPage();
    await clinicAssistPage.waitForTimeout(2000);
    
    await clinicAssist.searchPatientByNumber(patientNumber);
    await clinicAssistPage.waitForTimeout(2000);
    
    logger.info('   📂 Opening patient record...');
    await clinicAssist.openPatientFromSearchResultsByNumber(patientNumber);
    await clinicAssistPage.waitForTimeout(3000);
    
    logger.info('   🔍 Checking TX History for charge type and diagnosis...');
    logger.info(`      Visit Date: ${visitDate}`);
    const chargeTypeAndDiagnosis = await clinicAssist.getChargeTypeAndDiagnosis(visitDate);
    
    const chargeTypeLabel = chargeTypeAndDiagnosis.chargeType === 'first' ? 'First Consult' : 'Follow Up';
    const diagnosisInfo = chargeTypeAndDiagnosis.diagnosis 
      ? `${chargeTypeAndDiagnosis.diagnosis.code || ''} ${chargeTypeAndDiagnosis.diagnosis.description || ''}`.trim()
      : 'Not found';
    
    // Extract MC days and MC start date from visit data
    const mcDays = chargeTypeAndDiagnosis.mcDays || 0;
    const mcStartDate = chargeTypeAndDiagnosis.mcStartDate || visitDateForMHC;
    
    logger.info(`   ✅ Charge Type: ${chargeTypeLabel}`);
    logger.info(`   ✅ Diagnosis: ${diagnosisInfo}`);
    logger.info(`   ✅ MC Days: ${mcDays}`);
    logger.info(`   ✅ MC Start Date: ${mcStartDate}`);
    logger.info('');
    
    // Take screenshot of Clinic Assist
    await clinicAssistPage.screenshot({ path: 'screenshots/00-clinic-assist-data.png', fullPage: true }).catch(() => {});
    
    // ============================================
    // STEP 3: Initialize Browser for MHC
    // ============================================
    logger.info('┌─────────────────────────────────────────────────────────────┐');
    logger.info('│ STEP 3: Initialize Browser for MHC                         │');
    logger.info('└─────────────────────────────────────────────────────────────┘');
    logger.info('');
    
    logger.info('   🌐 Creating new page for MHC Asia...');
    page = await browserManager.newPage();
    const mhcAsia = new MHCAsiaAutomation(page);
    
    // Setup dialog handler FIRST
    logger.info('   ⚙️  Setting up dialog handler for auto-accepting prompts...');
    mhcAsia.setupDialogHandler();
    logger.info('   ✅ Browser ready\n');
    
    // ============================================
    // STEP 4: Login to MHC Asia
    // ============================================
    logger.info('┌─────────────────────────────────────────────────────────────┐');
    logger.info('│ STEP 3: Login to MHC Asia Portal                           │');
    logger.info('└─────────────────────────────────────────────────────────────┘');
    logger.info('');
    
    logger.info('   🔐 Navigating to login page...');
    const mhcLoginStart = Date.now();
    await mhcAsia.login();
    timings['mhc_asia_login'] = Date.now() - mhcLoginStart;
    logger.info(`   ✅ Successfully logged in (${timings['mhc_asia_login']}ms)`);
    
    await page.screenshot({ path: 'screenshots/01-login-complete.png', fullPage: true }).catch(() => {});
    logger.info('   📸 Screenshot: 01-login-complete.png\n');
    
    // ============================================
    // STEP 4: Navigate to Patient Search
    // ============================================
    logger.info('┌─────────────────────────────────────────────────────────────┐');
    logger.info('│ STEP 4: Navigate to Patient Search                         │');
    logger.info('└─────────────────────────────────────────────────────────────┘');
    logger.info('');
    
    logger.info('   🔍 Navigating to patient search page through UI...');
    const navStart = Date.now();
    await mhcAsia.navigateToNormalVisit();
    timings['navigate_to_search'] = Date.now() - navStart;
    logger.info(`   ✅ At patient search page (${timings['navigate_to_search']}ms)`);
    
    await page.screenshot({ path: 'screenshots/02-search-page.png', fullPage: true }).catch(() => {});
    logger.info('   📸 Screenshot: 02-search-page.png\n');
    
    // ============================================
    // STEP 5: Search for Patient
    // ============================================
    logger.info('┌─────────────────────────────────────────────────────────────┐');
    logger.info('│ STEP 5: Search for Patient by NRIC                         │');
    logger.info('└─────────────────────────────────────────────────────────────┘');
    logger.info('');
    
    logger.info(`   🔎 Searching for NRIC: ${nric}...`);
    const searchResult = await mhcAsia.searchPatientByNRIC(nric);
    logger.info(`   ✅ Patient found!`);
    logger.info(`   ✅ Portal: ${searchResult.portal}`);
    
    await page.screenshot({ path: 'screenshots/03-search-results.png', fullPage: true }).catch(() => {});
    logger.info('   📸 Screenshot: 03-search-results.png\n');
    
    // ============================================
    // STEP 6: Open Patient and Add Visit
    // ============================================
    logger.info('┌─────────────────────────────────────────────────────────────┐');
    logger.info('│ STEP 6: Open Patient Record and Add Visit                  │');
    logger.info('└─────────────────────────────────────────────────────────────┘');
    logger.info('');
    
    logger.info('   👤 Opening patient record...');
    await mhcAsia.openPatientFromSearchResults(nric);
    logger.info('   ✅ Patient record opened');
    
    logger.info('   ➕ Adding new visit...');
    await mhcAsia.addVisit(searchResult.portal);
    await page.waitForTimeout(2000);
    logger.info('   ✅ Visit form opened');
    
    await page.screenshot({ path: 'screenshots/04-visit-form-opened.png', fullPage: true }).catch(() => {});
    logger.info('   📸 Screenshot: 04-visit-form-opened.png\n');
    
    // ============================================
    // STEP 7: Fill Form Fields
    // ============================================
    logger.info('┌─────────────────────────────────────────────────────────────┐');
    logger.info('│ STEP 7: Fill Form Fields                                   │');
    logger.info('└─────────────────────────────────────────────────────────────┘');
    logger.info('');
    
    // 7a. Visit Date
    logger.info('   📅 Filling Visit Date...');
    logger.info(`      Value: ${visitDateForMHC}`);
    await mhcAsia.fillVisitDate(visitDateForMHC);
    await page.waitForTimeout(500);
    logger.info('      ✅ Visit date filled');
    
    await page.screenshot({ path: 'screenshots/05-visit-date-filled.png', fullPage: true }).catch(() => {});
    logger.info('      📸 Screenshot: 05-visit-date-filled.png');
    logger.info('');
    
    // 7b. Charge Type (from Clinic Assist)
    logger.info('   🏷️  Setting Charge Type...');
    logger.info(`      Value: ${chargeTypeLabel} (from Clinic Assist TX History)`);
    if (chargeTypeAndDiagnosis.chargeType === 'first') {
      await mhcAsia.setChargeTypeNewVisit();
    } else {
      await mhcAsia.setChargeTypeFollowUp();
    }
    await page.waitForTimeout(500);
    logger.info(`      ✅ Charge type set to "${chargeTypeLabel}"`);
    
    await page.screenshot({ path: 'screenshots/06-charge-type-set.png', fullPage: true }).catch(() => {});
    logger.info('      📸 Screenshot: 06-charge-type-set.png');
    logger.info('');
    
    // 7c. Consultation Fee
    logger.info('   💰 Setting Consultation Fee...');
    logger.info('      Strategy: Enter 99999 to trigger max amount dialog');
    await mhcAsia.fillConsultationFee(99999);
    await page.waitForTimeout(2000); // Wait for dialog to appear and be accepted
    logger.info('      ✅ Consultation fee set (max amount accepted via dialog)');
    
    await page.screenshot({ path: 'screenshots/07-consultation-fee-set.png', fullPage: true }).catch(() => {});
    logger.info('      📸 Screenshot: 07-consultation-fee-set.png');
    logger.info('');
    
    // 7d. MC Days (from Clinic Assist)
    if (mcDays > 0) {
      logger.info('   🏥 Setting MC Days...');
      logger.info(`      Value: ${mcDays} day(s)`);
      await mhcAsia.fillMcDays(mcDays);
      await page.waitForTimeout(500);
      logger.info(`      ✅ MC days set to ${mcDays}`);
      
      await page.screenshot({ path: 'screenshots/07b-mc-days-set.png', fullPage: true }).catch(() => {});
      logger.info('      📸 Screenshot: 07b-mc-days-set.png');
      logger.info('');
    } else {
      logger.info('   ℹ️  No MC days for this visit');
      logger.info('');
    }
    
    // 7e. Diagnosis (from Clinic Assist)
    logger.info('   🩺 Selecting Diagnosis...');
    if (chargeTypeAndDiagnosis.diagnosis && chargeTypeAndDiagnosis.diagnosis.description) {
      const diagText = chargeTypeAndDiagnosis.diagnosis.description;
      logger.info(`      From Clinic Assist: ${diagText.substring(0, 80)}`);
      
      // Try to match diagnosis in MHC dropdown
      // Use the description text or code to search
      const searchTerm = chargeTypeAndDiagnosis.diagnosis.code 
        ? chargeTypeAndDiagnosis.diagnosis.code.replace(/[^A-Z0-9]/g, '')
        : diagText.split(/\s+/).find(w => w.length > 4) || diagText.substring(0, 20);
      
      logger.info(`      Searching MHC dropdown for: "${searchTerm}"`);
      const diagResult = await mhcAsia.selectDiagnosis(searchTerm);
      await page.waitForTimeout(1000);
      
      if (diagResult) {
        logger.info(`      ✅ Diagnosis selected from Clinic Assist data`);
      } else {
        logger.info('      ⚠️  Could not auto-match diagnosis, may need manual selection');
      }
    } else {
      logger.info('      ⚠️  No diagnosis found in Clinic Assist, skipping');
    }
    
    await page.screenshot({ path: 'screenshots/08-diagnosis-selected.png', fullPage: true }).catch(() => {});
    logger.info('      📸 Screenshot: 08-diagnosis-selected.png');
    logger.info('');
    
    // ============================================
    // STEP 8: Claim automatically computed (no manual click needed)
    // ============================================
    logger.info('┌─────────────────────────────────────────────────────────────┐');
    logger.info('│ STEP 8: Claim Auto-Computed                                │');
    logger.info('└─────────────────────────────────────────────────────────────┘');
    logger.info('');
    
    logger.info('   ✅ Claim automatically computed by system');
    await page.waitForTimeout(1000); // Brief wait for auto-calculation
    
    // Scroll down to see more of the page
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    }).catch(() => {});
    await page.waitForTimeout(500);
    
    await page.screenshot({ path: 'screenshots/09-claim-computed.png', fullPage: true }).catch(() => {});
    logger.info('   📸 Screenshot: 09-claim-computed.png\n');
    
    const totalTime = Date.now() - startTime;
    timings['total'] = totalTime;
    
    // ============================================
    // FINAL SUMMARY
    // ============================================
    logger.info('┌─────────────────────────────────────────────────────────────┐');
    logger.info('│ ✅ FORM FILLING COMPLETE - NOT SUBMITTED                   │');
    logger.info('└─────────────────────────────────────────────────────────────┘');
    logger.info('');
    logger.info('📊 Form Summary:');
    logger.info(`   Patient Name: ${testPatient.name}`);
    logger.info(`   Patient Number: ${patientNumber}`);
    logger.info(`   NRIC: ${nric}`);
    logger.info(`   Visit Date: ${visitDateForMHC}`);
    logger.info(`   Charge Type: ${chargeTypeLabel} (from Clinic Assist TX History)`);
    logger.info(`   Consultation Fee: Max allowed (via 99999 trigger)`);
    logger.info(`   Diagnosis: ${diagnosisInfo}`);
    logger.info('');
    logger.info('📸 Screenshots saved:');
    logger.info('   00-clinic-assist-data.png');
    logger.info('   01-login-complete.png');
    logger.info('   02-search-page.png');
    logger.info('   03-search-results.png');
    logger.info('   04-visit-form-opened.png');
    logger.info('   05-visit-date-filled.png');
    logger.info('   06-charge-type-set.png');
    logger.info('   07-consultation-fee-set.png');
    logger.info('   08-diagnosis-selected.png');
    logger.info('   09-claim-computed.png');
    logger.info('');
    logger.info('⏱️  Timing Breakdown:');
    logger.info(`   Browser Init: ${timings['browser_init'] || 0}ms`);
    logger.info(`   Clinic Assist Login: ${timings['clinic_assist_login'] || 0}ms`);
    logger.info(`   MHC Asia Login: ${timings['mhc_asia_login'] || 0}ms`);
    logger.info(`   Navigate to Search: ${timings['navigate_to_search'] || 0}ms`);
    logger.info(`   Total Time: ${timings['total'] || 0}ms (${(timings['total'] / 1000).toFixed(1)}s)`);
    logger.info('');
    logger.info('='.repeat(70));
    logger.info('>>> BROWSER IS OPEN FOR MANUAL REVIEW <<<');
    logger.info('>>> Connect to VNC to view the filled form <<<');
    logger.info('>>> Form is NOT submitted - ready for review <<<');
    logger.info('>>> Press Ctrl+C when done reviewing <<<');
    logger.info('='.repeat(70));
    logger.info('');
    
    // Keep browser open indefinitely
    await new Promise(() => {});
    
  } catch (error) {
    logger.error('\n' + '='.repeat(70));
    logger.error('❌ ERROR OCCURRED');
    logger.error('='.repeat(70));
    logger.error(`\nError Message: ${error.message}`);
    logger.error(`\nStack Trace:\n${error.stack}`);
    
    if (page) {
      await page.screenshot({ path: 'screenshots/ERROR-final-state.png', fullPage: true }).catch(() => {});
      logger.error('\n📸 Error screenshot saved: ERROR-final-state.png');
    }
    
    logger.info('\n>>> Browser open for debugging <<<');
    logger.info('>>> Press Ctrl+C to close <<<\n');
    
    await new Promise(() => {});
  }
}

testMHCFormFilling().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
