import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';
import { GENtucSubmitter } from '../src/core/ge-submitter.js';

const visit = {
  visit_date: process.env.GE_PROBE_VISIT_DATE || '2026-02-13',
  nric: process.env.GE_PROBE_NRIC || 'T0801699I',
  diagnosis_description: process.env.GE_PROBE_DIAGNOSIS || 'Lower back pain',
  diagnosis_code: process.env.GE_PROBE_DIAGNOSIS_CODE || '',
  extraction_metadata: { mcDays: 0, chargeType: 'follow' },
};

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const alliance = new AllianceMedinetAutomation(page);
const submitter = new GENtucSubmitter(alliance, null);

const state = async popup =>
  popup.evaluate(() => ({
    mcDay: document.querySelector('#ctl00_MainContent_uc_MakeClaim_ddlMcDay')?.value || '',
    mcDayText: document.querySelector('#ctl00_MainContent_uc_MakeClaim_ddlMcDay')?.selectedOptions?.[0]?.textContent?.trim() || '',
    mcDays: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtMcDays')?.value || '',
    mcReason: document.querySelector('#ctl00_MainContent_uc_MakeClaim_ddlMcReasons')?.value || '',
    mcReasonText: document.querySelector('#ctl00_MainContent_uc_MakeClaim_ddlMcReasons')?.selectedOptions?.[0]?.textContent?.trim() || '',
    txtMcReasons: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtmcreasons')?.value || '',
    feeType: document.querySelector('#ctl00_MainContent_uc_MakeClaim_ddlFeeType')?.value || '',
    feeTypeText: document.querySelector('#ctl00_MainContent_uc_MakeClaim_ddlFeeType')?.selectedOptions?.[0]?.textContent?.trim() || '',
    feeAmount: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtFeeAmount')?.value || '',
    remarks: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtClaimRemarks')?.value || '',
    diagnosisCode: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosisCode')?.value || '',
    diagnosisText: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosis')?.value || '',
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

  await submitter._setDiagnosisViaPopup(popup, visit, visit.diagnosis_description, visit.diagnosis_code);
  console.log('[probe] after diagnosis', JSON.stringify(await state(popup), null, 2));

  const r1 = await submitter._setSelectValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_ddlMcDay', ['0', '0.0']);
  const r2 = await submitter._setInputValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_txtMcDays', '0');
  const r3 = await submitter._setSelectValueNoPostback(
    popup,
    '#ctl00_MainContent_uc_MakeClaim_ddlMcReasons',
    ['Backache', 'Pain - Severe'],
    '#ctl00_MainContent_uc_MakeClaim_txtmcreasons'
  );
  const r4 = await submitter._setSelectValueNoPostback(
    popup,
    '#ctl00_MainContent_uc_MakeClaim_ddlFeeType',
    ['followup_consultationfee', 'Follow-up Consultation']
  );
  const r5 = await submitter._setInputValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_txtFeeAmount', '38.00');
  const r6 = await submitter._setInputValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_txtClaimRemarks', 'SPECIALIST CONSULTATION x1');

  console.log('[probe] setter flags', { r1, r2, r3, r4, r5, r6 });
  console.log('[probe] after set no postback', JSON.stringify(await state(popup), null, 2));

  await popup.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-probe-no-postback-setters.png', fullPage: true }).catch(() => {});
} catch (error) {
  console.error('[probe] fatal', error?.stack || String(error));
} finally {
  await bm.close().catch(() => {});
}
