#!/usr/bin/env node

/**
 * Batch Singlife (Aviva) Form Filling - Process all Singlife/Aviva patients for a specific date
 *
 * This script:
 * 1. Downloads queue listing from Clinic Assist for the specified date
 * 2. Parses all Singlife/Aviva patients from the Excel
 * 3. For each patient:
 *    - Gets NRIC from Clinic Assist patient record
 *    - Gets charge type, diagnosis, MC days/start date from TX History
 *    - Fills the Singlife claim form (same as MHC form fields) and computes claim
 * 4. Leaves the browser open for manual review (DO NOT SUBMIT)
 *
 * Usage:
 *   node batch-singlife-form-filling.js 2026-01-23
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { BrowserManager } from '../utils/browser.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { MHCAsiaAutomation } from '../automations/mhc-asia.js';
import { logger } from '../utils/logger.js';
import { normalizePcno, normalizePatientNameForSearch } from '../utils/patient-normalize.js';

dotenv.config();

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
    if (!fs.existsSync(excelPath)) {
      logger.error(`Excel file not found: ${excelPath}`);
      return [];
    }

    const workbook = XLSX.readFile(excelPath);
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });

    // These match the original report structure used in other scripts.
    const EXCEL_COLUMNS = {
      PCNO: 2,
      NAME: 3,
      CONTRACT: 29,
      TOTAL: 31,
    };

    for (let i = 11; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < 5) continue;

      const pcno = row[EXCEL_COLUMNS.PCNO];
      const name = row[EXCEL_COLUMNS.NAME];
      const contract = row[EXCEL_COLUMNS.CONTRACT];

      const pcnoNorm = normalizePcno(pcno);
      if (!pcnoNorm || !name) continue;

      const contractStr = String(contract || '').toUpperCase();
      if (contractStr.includes('AVIVA') || contractStr.includes('SINGLIFE')) {
        patients.push({
          pcno: pcnoNorm,
          name: normalizePatientNameForSearch(String(name)) || String(name).trim(),
          nric: null,
          contract: contract,
          total: row[EXCEL_COLUMNS.TOTAL] || 0,
          portal: 'SINGLIFE',
        });
      }
    }
    return patients;
  } catch (error) {
    logger.error('Error parsing Excel:', error.message);
    return [];
  }
}

async function batchSinglifeFormFilling(targetDate) {
  const browserManager = new BrowserManager();
  let clinicAssistPage = null;
  let mhcPage = null;

  const results = {
    date: targetDate,
    totalPatients: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    patients: [],
  };

  const startTime = Date.now();

  try {
    const visitDateForMHC = formatDateForMHC(targetDate);
    const excelPath = path.join(process.cwd(), 'downloads', 'queueListing.xls');

    logger.info('\n' + '='.repeat(70));
    logger.info('  BATCH SINGLIFE (AVIVA) FORM FILLING');
    logger.info('='.repeat(70));
    logger.info(`\n📅 Target Date: ${targetDate} (${visitDateForMHC})`);
    logger.info(`📄 Excel File: ${excelPath}\n`);

    logger.info('┌─────────────────────────────────────────────────────────────┐');
    logger.info('│ STEP 1: Initialize Browser and Login to Clinic Assist      │');
    logger.info('└─────────────────────────────────────────────────────────────┘\n');

    await browserManager.init();
    const allPages = browserManager.context.pages();
    clinicAssistPage = allPages.length > 0 ? allPages[0] : await browserManager.newPage();

    const clinicAssist = new ClinicAssistAutomation(clinicAssistPage);

    logger.info('   🔐 Logging into Clinic Assist...');
    await clinicAssist.login();
    logger.info('   ✅ Clinic Assist login successful\n');

    logger.info('┌─────────────────────────────────────────────────────────────┐');
    logger.info('│ STEP 2: Download Queue Listing for Target Date             │');
    logger.info('└─────────────────────────────────────────────────────────────┘\n');

    logger.info(`   📅 Downloading queue listing for ${targetDate}...`);
    await clinicAssist.navigateToPatientPage();
    await clinicAssistPage.waitForTimeout(1000);

    try {
      const navigated = await clinicAssist.navigateToReports();
      if (!navigated) throw new Error('Could not navigate to Reports section');
      await clinicAssistPage.waitForTimeout(2000);

      const queueListOpened = await clinicAssist.navigateToQueueListReport();
      if (!queueListOpened) {
        logger.warn('   ⚠️  Could not find Queue Report link, trying direct navigation from Reports context...');
        const directNav = await clinicAssist.navigateDirectlyToQueueReport();
        if (!directNav) throw new Error('Direct navigation to Queue Report failed');
      }

      await clinicAssistPage.waitForTimeout(2000);
      await clinicAssist.searchQueueListByDate(targetDate);
      await clinicAssistPage.waitForTimeout(3000);
    } catch (e) {
      logger.warn(`   ⚠️  Could not navigate to Queue Report via UI: ${e.message}`);
    }

    logger.info('   📥 Extracting queue list data...');
    let queueItems = [];
    try {
      queueItems = await clinicAssist.extractQueueListResults();
    } catch (e) {
      logger.warn(`   ⚠️  Could not extract queue list: ${e.message}`);
    }

    // Prefer extracted queue items (more robust than hard-coded Excel columns), fallback to parsing Excel.
    let singlifePatients = [];
    if (queueItems && queueItems.length > 0) {
      singlifePatients = queueItems
        .filter((item) => {
          const contract = String(item.contract || item.payType || '').toUpperCase();
          return contract.includes('AVIVA') || contract.includes('SINGLIFE');
        })
        .map((item) => ({
          pcno: item.pcno || item.patientNumber,
          name: item.name || item.patientName,
          nric: item.nric || null,
          contract: item.contract || item.payType,
          total: item.total || item.amount || 0,
          portal: 'SINGLIFE',
        }));
    }

    if (singlifePatients.length === 0) {
      singlifePatients = parseQueueReportExcel(excelPath);
    }
    results.totalPatients = singlifePatients.length;

    if (singlifePatients.length === 0) {
      logger.warn('No Singlife/Aviva patients found for the target date');
      return results;
    }

    logger.info(`   ✅ Found ${singlifePatients.length} Singlife/Aviva patient(s):`);
    singlifePatients.forEach((p, i) => {
      logger.info(`      ${i + 1}. ${p.pcno} - ${p.name} (${p.contract})`);
    });
    logger.info('');

    logger.info('┌─────────────────────────────────────────────────────────────┐');
    logger.info('│ STEP 3: Login to MHC Asia                                  │');
    logger.info('└─────────────────────────────────────────────────────────────┘\n');

    mhcPage = await browserManager.newPage();
    const mhcAsia = new MHCAsiaAutomation(mhcPage);
    mhcAsia.setupDialogHandler();

    logger.info('   🔐 Logging into MHC Asia...');
    await mhcAsia.login();
    logger.info('   ✅ MHC Asia login successful\n');

    logger.info('┌─────────────────────────────────────────────────────────────┐');
    logger.info('│ STEP 4: Process Each Patient                               │');
    logger.info('└─────────────────────────────────────────────────────────────┘\n');

    for (let i = 0; i < singlifePatients.length; i++) {
      const patient = singlifePatients[i];
      const patientStartTime = Date.now();

      logger.info(`\n${'─'.repeat(60)}`);
      logger.info(`Processing Patient ${i + 1}/${singlifePatients.length}: ${patient.name}`);
      logger.info(`   PCNO: ${patient.pcno}`);
      logger.info(`   Contract: ${patient.contract}`);
      logger.info(`${'─'.repeat(60)}\n`);

      const patientResult = {
        pcno: patient.pcno,
        name: patient.name,
        nric: patient.nric,
        status: 'pending',
        error: null,
        timeTaken: 0,
      };

      try {
        logger.info('   📋 Getting patient data from Clinic Assist...');
        await clinicAssist.navigateToPatientPage();
        await clinicAssist.searchPatientByNumber(patient.pcno);
        await clinicAssist.openPatientFromSearchResultsByNumber(patient.pcno);

        const nric = await clinicAssist.getPatientNRIC();
        patientResult.nric = nric;
        logger.info(`      NRIC from Clinic Assist: ${nric}`);
        if (!nric) throw new Error('Could not get patient NRIC');

        logger.info('   📊 Getting charge type and diagnosis from TX History...');
        const chargeTypeAndDiagnosis = await clinicAssist.getChargeTypeAndDiagnosis(targetDate);

        const chargeTypeLabel = chargeTypeAndDiagnosis.chargeType === 'first' ? 'First Consult' : 'Follow Up';
        const diagnosisInfo = chargeTypeAndDiagnosis.diagnosis
          ? `${chargeTypeAndDiagnosis.diagnosis.code || ''} ${chargeTypeAndDiagnosis.diagnosis.description || ''}`.trim()
          : 'Not found';
        const mcDays = chargeTypeAndDiagnosis.mcDays || 0;
        const mcStartDate = chargeTypeAndDiagnosis.mcStartDate || visitDateForMHC;

        logger.info(`      Charge Type: ${chargeTypeLabel}`);
        logger.info(`      Diagnosis: ${diagnosisInfo}`);
        logger.info(`      MC Days: ${mcDays}`);

        logger.info('   🔍 Searching patient in MHC Asia...');
        await mhcAsia.navigateToNormalVisit();
        const searchResult = await mhcAsia.searchPatientByNRIC(nric);
        if (!searchResult.found) throw new Error('Patient not found in MHC Asia');

        logger.info(`      Found in portal: ${searchResult.portal}`);
        await mhcAsia.openPatientFromSearchResults(nric);

        // Force Singlife flow even if portal detection is ambiguous.
        await mhcAsia.addVisit(searchResult.portal || 'singlife', nric);

        logger.info('   ✏️  Filling form fields...');
        await mhcAsia.fillVisitDate(visitDateForMHC);

        if (chargeTypeAndDiagnosis.chargeType === 'first') await mhcAsia.setChargeTypeNewVisit();
        else await mhcAsia.setChargeTypeFollowUp();

        await mhcAsia.fillConsultationFee(99999);

        if (mcDays > 0) {
          await mhcAsia.fillMcDays(mcDays);
          await mhcAsia.fillMcStartDate(mcStartDate);
        }

        if (chargeTypeAndDiagnosis.diagnosis?.description) {
          await mhcAsia.selectDiagnosis(chargeTypeAndDiagnosis.diagnosis.description || chargeTypeAndDiagnosis.diagnosis.code);
        }

        logger.info('   🧮 Computing claim...');
        await mhcAsia.computeClaim();

        patientResult.status = 'success';
        results.successful++;
        logger.info(`   ✅ Patient ${patient.name} processed successfully!`);
      } catch (error) {
        patientResult.status = 'failed';
        patientResult.error = error.message;
        results.failed++;
        logger.error(`   ❌ Failed to process patient ${patient.name}: ${error.message}`);
        await mhcPage.screenshot({ path: `screenshots/error-singlife-${patient.pcno}.png` }).catch(() => {});
      }

      patientResult.timeTaken = Date.now() - patientStartTime;
      results.patients.push(patientResult);
      logger.info(`   ⏱️  Time taken: ${(patientResult.timeTaken / 1000).toFixed(1)}s`);
    }

    const totalTime = Date.now() - startTime;

    logger.info('\n' + '='.repeat(70));
    logger.info('  BATCH PROCESSING COMPLETE');
    logger.info('='.repeat(70));
    logger.info(`\n📊 Summary:`);
    logger.info(`   Total Patients: ${results.totalPatients}`);
    logger.info(`   Successful: ${results.successful}`);
    logger.info(`   Failed: ${results.failed}`);
    logger.info(`   Skipped: ${results.skipped}`);
    logger.info(`   Total Time: ${(totalTime / 1000).toFixed(1)}s`);
    logger.info(`   Average per Patient: ${(totalTime / results.totalPatients / 1000).toFixed(1)}s`);

    const resultsPath = path.join(process.cwd(), 'logs', `batch-results-singlife-${targetDate}.json`);
    fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    logger.info(`\n📄 Results saved to: ${resultsPath}`);

    return results;
  } finally {
    logger.info('\n>>> Browser left open for review <<<');
    logger.info('>>> Press Ctrl+C to close <<<\n');
    await new Promise(() => {});
  }
}

const args = process.argv.slice(2);
let targetDate = args[0];

if (!targetDate) {
  const today = new Date();
  targetDate = today.toISOString().split('T')[0];
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
  console.error('Invalid date format. Use YYYY-MM-DD (e.g., 2026-01-23)');
  process.exit(1);
}

batchSinglifeFormFilling(targetDate);
