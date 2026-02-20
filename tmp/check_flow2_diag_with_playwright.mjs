import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { createSupabaseClient } from '../src/utils/supabase-client.js';
import { ClinicAssistAutomation } from '../src/automations/clinic-assist.js';

dotenv.config();

const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.findIndex((a) => a === `--${name}`);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return null;
};

const visitId = getArg('visit-id');
if (!visitId) {
  console.error('Usage: node tmp/check_flow2_diag_with_playwright.mjs --visit-id <uuid> [--headed]');
  process.exit(1);
}

const headed = args.includes('--headed');
const outputDir = path.resolve('output/playwright');
fs.mkdirSync(outputDir, { recursive: true });

const supabase = createSupabaseClient();
const { data: visit, error: visitError } = await supabase
  .from('visits')
  .select('id, patient_name, visit_date, nric, pay_type, diagnosis_description, extraction_metadata')
  .eq('id', visitId)
  .single();

if (visitError || !visit) {
  console.error('Visit lookup failed:', visitError?.message || 'not found');
  process.exit(1);
}

const pcno = String(visit?.extraction_metadata?.pcno || '').trim();
if (!pcno) {
  console.error(`Visit ${visitId} has no extraction_metadata.pcno; cannot open reliably.`);
  process.exit(1);
}

const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 100 : 0 });
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await context.newPage();
const ca = new ClinicAssistAutomation(page);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const baseName = `flow2-diag-${visit.visit_date}-${pcno}-${stamp}`;
const screenshot = (name) => path.join(outputDir, `${baseName}-${name}.png`);
const withTimeout = async (label, fn, ms = 45000) => {
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

try {
  await ca.login();
  await ca.navigateToPatientPage();
  let openedPatient = false;
  try {
    await ca.searchPatientByNumber(pcno);
    await ca.openPatientFromSearchResultsByNumber(pcno);
    openedPatient = true;
  } catch (numberError) {
    const nameFallback = String(visit.patient_name || '').trim();
    if (!nameFallback) throw numberError;
    await ca.searchPatientByName(nameFallback);
    await ca.openPatientFromSearchResults(nameFallback);
    openedPatient = true;
  }
  if (!openedPatient) {
    throw new Error(`Unable to open patient for visit ${visit.id}`);
  }
  await page.waitForTimeout(1200);

  await page.screenshot({ path: screenshot('patient-biodata'), fullPage: true });

  await ca.navigateToTXHistory();
  await ca.openDiagnosisTab();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: screenshot('tx-diagnosis-tab'), fullPage: true });

  const diagnosisForDate = await withTimeout('extractDiagnosisForDate', () =>
    ca.extractDiagnosisForDate(visit.visit_date)
  );
  const latestDiagnosis = await withTimeout('extractLatestDiagnosis', () => ca.extractLatestDiagnosis());
  const rawDiagnosis = await withTimeout('extractDiagnosisFromTXHistory', () =>
    ca.extractDiagnosisFromTXHistory()
  );
  const allTabDiagnosis = await withTimeout(
    'extractDiagnosisFromAllTab',
    () => ca.extractDiagnosisFromAllTab(visit.visit_date),
    120000
  );
  const visitTabDiagnosis = await withTimeout(
    'extractDiagnosisFromVisitTab',
    () => ca.extractDiagnosisFromVisitTab(visit.visit_date),
    60000
  );
  const pastNotesDiagnosis = await withTimeout(
    'extractDiagnosisFromPastNotes',
    () => ca.extractDiagnosisFromPastNotes(visit.visit_date),
    90000
  );
  const pastNotesIntent = await withTimeout(
    'extractDiagnosisIntentFromPastNotes',
    () =>
    ca.extractDiagnosisIntentFromPastNotes(
      visit.visit_date,
      diagnosisForDate?.description || latestDiagnosis?.description || ''
    ),
    120000
  );

  await ca.openPastNotesTab().catch(() => false);
  await ca.expandPastNotesEntries(visit.visit_date).catch(() => 0);
  await page.waitForTimeout(800);
  await page.screenshot({ path: screenshot('tx-past-notes'), fullPage: true });

  const report = {
    visit: {
      id: visit.id,
      patient_name: visit.patient_name,
      visit_date: visit.visit_date,
      nric: visit.nric,
      pay_type: visit.pay_type,
      pcno,
    },
    flow2_saved: {
      diagnosis_description: visit.diagnosis_description,
      diagnosis_code: visit?.extraction_metadata?.diagnosisCode || null,
      diagnosis_resolution: visit?.extraction_metadata?.diagnosisResolution || null,
      diagnosis_canonical: visit?.extraction_metadata?.diagnosisCanonical || null,
    },
    browser_extract: {
      diagnosisForDate,
      latestDiagnosis,
      rawDiagnosis,
      allTabDiagnosis,
      visitTabDiagnosis,
      pastNotesDiagnosis,
      pastNotesIntent,
    },
    artifacts: {
      patientBiodata: screenshot('patient-biodata'),
      diagnosisTab: screenshot('tx-diagnosis-tab'),
      pastNotes: screenshot('tx-past-notes'),
    },
  };

  const outJson = path.join(outputDir, `${baseName}.json`);
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, output: outJson, report }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
