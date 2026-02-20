import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';
import { GENtucSubmitter } from '../src/core/ge-submitter.js';

const visit = {
  id: 'probe-ge-fields',
  pay_type: 'ALLIANC',
  patient_name: 'WOO CHERN SEE',
  visit_date: process.env.GE_PROBE_VISIT_DATE || '2026-02-13',
  nric: process.env.GE_PROBE_NRIC || 'T0801699I',
  diagnosis_description: process.env.GE_PROBE_DIAGNOSIS || 'Lower back pain',
  diagnosis_code: process.env.GE_PROBE_DIAGNOSIS_CODE || '',
  treatment_detail: process.env.GE_PROBE_REMARKS || 'SPECIALIST CONSULTATION x1',
  total_amount: Number(process.env.GE_PROBE_FEE || 38),
  extraction_metadata: {
    chargeType: process.env.GE_PROBE_CHARGE_TYPE || 'follow',
    mcDays: Number(process.env.GE_PROBE_MC_DAYS || 0),
    diagnosisCanonical: {
      description_canonical: process.env.GE_PROBE_DIAGNOSIS || 'Lower back pain',
      code_normalized: process.env.GE_PROBE_DIAGNOSIS_CODE || '',
    },
  },
};

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const alliance = new AllianceMedinetAutomation(page);
const submitter = new GENtucSubmitter(alliance, null);

const getState = async popup =>
  popup.evaluate(() => ({
    mcDay: document.querySelector('#ctl00_MainContent_uc_MakeClaim_ddlMcDay')?.value || '',
    mcDays: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtMcDays')?.value || '',
    mcReason: document.querySelector('#ctl00_MainContent_uc_MakeClaim_ddlMcReasons')?.value || '',
    feeType: document.querySelector('#ctl00_MainContent_uc_MakeClaim_ddlFeeType')?.value || '',
    feeAmount: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtFeeAmount')?.value || '',
    diagnosisCode: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosisCode')?.value || '',
    diagnosisText: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosis')?.value || '',
    diagnosisId: document.querySelector('#ctl00_MainContent_uc_MakeClaim_hfPrimaryDiagnosisID')?.value || '',
    acuteArray: document.querySelector('#ctl00_MainContent_uc_MakeClaim_hfAcute1Array')?.value || '',
  }));

try {
  await alliance.login();
  await alliance.navigateToMedicalTreatmentClaim();
  const found = await alliance.searchMemberByNric(visit.nric, visit.visit_date);
  if (!found?.found) throw new Error('not_found');
  try { await alliance.selectMemberAndAdd(); } catch {}

  const popup = alliance.lastGePopupPage;
  if (!popup) throw new Error('no_popup');
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  await popup.bringToFront().catch(() => {});
  await popup.waitForTimeout(700);

  const diagnosisResult = await submitter._setDiagnosisViaPopup(
    popup,
    visit,
    visit.diagnosis_description,
    visit.diagnosis_code
  );
  console.log('[probe] diagnosisResult', JSON.stringify(diagnosisResult, null, 2));

  const s0 = await getState(popup);
  console.log('[probe] state after diagnosis', JSON.stringify(s0, null, 2));

  const ok1 = await submitter._fillInput(popup, '#ctl00_MainContent_uc_MakeClaim_txtVisitDate', '13-02-2026');
  const ok2 = await submitter._selectByValueOrLabel(popup, '#ctl00_MainContent_uc_MakeClaim_ddlMcDay', ['0', '0.0']);
  const ok3 = await submitter._fillInput(popup, '#ctl00_MainContent_uc_MakeClaim_txtMcDays', '0');
  const ok4 = await submitter._selectByValueOrLabel(popup, '#ctl00_MainContent_uc_MakeClaim_ddlMcReasons', ['Backache', 'Pain - Severe']);
  const ok5 = await submitter._selectByValueOrLabel(popup, '#ctl00_MainContent_uc_MakeClaim_ddlFeeType', ['followup_consultationfee', 'consultationfee', 'Follow-up Consultation']);
  const ok6 = await submitter._fillInput(popup, '#ctl00_MainContent_uc_MakeClaim_txtFeeAmount', '38.00');
  const ok7 = await submitter._fillInput(popup, '#ctl00_MainContent_uc_MakeClaim_txtClaimRemarks', 'SPECIALIST CONSULTATION x1');

  await popup.waitForTimeout(1000);
  const s1 = await getState(popup);
  console.log('[probe] setter results', { ok1, ok2, ok3, ok4, ok5, ok6, ok7 });
  console.log('[probe] state after field fills', JSON.stringify(s1, null, 2));

  await popup.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-probe-set-fields-with-submitter.png', fullPage: true }).catch(() => {});
} catch (error) {
  console.error('[probe] fatal', error?.stack || String(error));
} finally {
  await bm.close().catch(() => {});
}
