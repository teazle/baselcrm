import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';
import { GENtucSubmitter } from '../src/core/ge-submitter.js';

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);
const submitter = new GENtucSubmitter(auto, null);
const popups = [];
page.context().on('page', p => popups.push(p));

const nric = process.env.GE_PROBE_NRIC || 'T0801699I';
const date = process.env.GE_PROBE_VISIT_DATE || '2026-02-13';
const visit = {
  visit_date: date,
  nric,
  diagnosis_description: 'Lower back pain',
  treatment_detail: 'SPECIALIST CONSULTATION x1',
  total_amount: 38,
  extraction_metadata: { mcDays: 0, chargeType: 'follow' },
};

const getState = async p =>
  p.evaluate(() => ({
    msg: document.querySelector('#ctl00_MainContent_uc_MakeClaim_lblMessage')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    refValue: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic')?.value || '',
    mcDay: document.querySelector('#ctl00_MainContent_uc_MakeClaim_ddlMcDay')?.value || '',
    mcReason: document.querySelector('#ctl00_MainContent_uc_MakeClaim_ddlMcReasons')?.value || '',
    feeType: document.querySelector('#ctl00_MainContent_uc_MakeClaim_ddlFeeType')?.value || '',
    feeAmount: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtFeeAmount')?.value || '',
    diagnosisCode: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosisCode')?.value || '',
    diagnosisText: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosis')?.value || '',
    refType: document.querySelector('#ctl00_MainContent_uc_MakeClaim_hfReferenceClinicType')?.value || '',
    oldRefType: document.querySelector('#ctl00_MainContent_uc_MakeClaim_hfOldReferenceClinicType')?.value || '',
    clinicId: document.querySelector('#ctl00_MainContent_uc_MakeClaim_hfClinicID')?.value || '',
  }));

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const found = await auto.searchMemberByNric(nric, date);
  if (!found?.found) throw new Error('member_not_found');
  try { await auto.selectMemberAndAdd(); } catch {}

  const popup = popups[popups.length - 1];
  if (!popup) throw new Error('popup_missing');
  await popup.waitForLoadState('domcontentloaded').catch(() => {});

  popup.on('request', req => {
    if (req.method() !== 'POST') return;
    const url = req.url();
    if (!/MakePanelClaim\.aspx/i.test(url)) return;
    const data = req.postData() || '';
    const parts = Object.fromEntries(
      data
        .split('&')
        .map(x => x.split('=').map(decodeURIComponent))
        .filter(a => a.length === 2)
    );
    const picked = {};
    for (const [k, v] of Object.entries(parts)) {
      if (/Ref|Clinic|diagnosis|Mc|Fee|EVENTTARGET|EVENTARGUMENT/i.test(k)) picked[k] = v;
    }
    console.log('[probe] POST payload fields', JSON.stringify(picked, null, 2));
  });

  await submitter._setDiagnosisViaPopup(popup, visit, 'Lower back pain', '');
  await submitter._setSelectValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_ddlMcDay', ['0']);
  await submitter._setInputValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_txtMcDays', '0');
  await submitter._setSelectValueNoPostback(
    popup,
    '#ctl00_MainContent_uc_MakeClaim_ddlMcReasons',
    ['Backache', 'Pain - Severe'],
    '#ctl00_MainContent_uc_MakeClaim_txtmcreasons'
  );
  await submitter._setSelectValueNoPostback(
    popup,
    '#ctl00_MainContent_uc_MakeClaim_ddlFeeType',
    ['followup_consultationfee', 'Follow-up Consultation', 'Follow Up']
  );
  await submitter._setInputValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_txtFeeAmount', '38.00');
  await submitter._setInputValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_txtClaimRemarks', 'SPECIALIST CONSULTATION x1');
  await submitter._setInputValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic', 'SINGAPORE SPORTS');

  console.log('[probe] before calc', JSON.stringify(await getState(popup), null, 2));

  const calc = popup
    .locator(
      '#ctl00_MainContent_uc_MakeClaim_btncalculateclaim, input[value*=\"Calculate Claim\" i], button:has-text(\"Calculate Claim\")'
    )
    .first();
  const calcCount = await calc.count().catch(() => 0);
  if (!calcCount) {
    const buttons = await popup
      .evaluate(() =>
        Array.from(document.querySelectorAll('input[type=\"submit\"],input[type=\"button\"],button')).map(el => ({
          id: el.id || '',
          name: el.name || '',
          value: el.value || el.textContent || '',
        }))
      )
      .catch(() => []);
    console.log('[probe] no calc button', JSON.stringify(buttons, null, 2));
    throw new Error('calc_button_missing');
  }
  await calc.click({ timeout: 8000 }).catch(async () => calc.click({ timeout: 8000, force: true }));
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  await popup.waitForTimeout(1400);

  console.log('[probe] after calc', JSON.stringify(await getState(popup), null, 2));
  await popup.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-probe-calc-payload.png', fullPage: true }).catch(() => {});
} catch (error) {
  console.error('[probe] fatal', error?.stack || String(error));
} finally {
  await bm.close().catch(() => {});
}
