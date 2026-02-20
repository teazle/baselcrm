import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';
import { GENtucSubmitter } from '../src/core/ge-submitter.js';

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);
const submitter = new GENtucSubmitter(auto, null);

const visit = {
  visit_date: process.env.GE_PROBE_VISIT_DATE || '2026-02-13',
  nric: process.env.GE_PROBE_NRIC || 'T0801699I',
  diagnosis_description: 'Lower back pain',
  treatment_detail: 'SPECIALIST CONSULTATION x1',
  total_amount: 38,
  extraction_metadata: { chargeType: 'follow', mcDays: 0 },
};

const state = async p =>
  p.evaluate(() => ({
    msg: (document.querySelector('#ctl00_MainContent_uc_MakeClaim_lblMessage')?.textContent || '').replace(/\s+/g, ' ').trim(),
    refValue: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic')?.value || '',
    refType: document.querySelector('#ctl00_MainContent_uc_MakeClaim_hfReferenceClinicType')?.value || '',
    oldRefType: document.querySelector('#ctl00_MainContent_uc_MakeClaim_hfOldReferenceClinicType')?.value || '',
    feeType: document.querySelector('#ctl00_MainContent_uc_MakeClaim_ddlFeeType')?.value || '',
    dxCode: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosisCode')?.value || '',
    dxText: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosis')?.value || '',
    calcExists: !!document.querySelector('#ctl00_MainContent_uc_MakeClaim_btncalculateclaim'),
  }));

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const found = await auto.searchMemberByNric(visit.nric, visit.visit_date);
  if (!found?.found) throw new Error('not_found');
  try { await auto.selectMemberAndAdd(); } catch (error) { if ((error?.allianceError?.code || '') !== 'ge_popup_redirect') throw error; }
  const p = auto.lastGePopupPage;
  if (!p) throw new Error('popup_missing');
  await p.waitForLoadState('domcontentloaded').catch(() => {});

  const dx = await submitter._setDiagnosisViaPopup(p, visit, 'Lower back pain', '');
  const opt = dx?.selectedOption || { code: 'R52', text: 'Pain, not elsewhere classified' };
  await submitter._forcePrimaryDiagnosisState(p, opt, 'R52');

  await submitter._setSelectValueNoPostback(p, '#ctl00_MainContent_uc_MakeClaim_ddlMcDay', ['0']);
  await submitter._setInputValueNoPostback(p, '#ctl00_MainContent_uc_MakeClaim_txtMcDays', '0');
  await submitter._setSelectValueNoPostback(p, '#ctl00_MainContent_uc_MakeClaim_ddlMcReasons', ['Backache'], '#ctl00_MainContent_uc_MakeClaim_txtmcreasons');
  await submitter._selectFeeTypeWithFallback(p, ['followup_consultationfee', 'Follow-up Consultation', 'Follow Up']);
  await submitter._setInputValueNoPostback(p, '#ctl00_MainContent_uc_MakeClaim_txtFeeAmount', '38.00');
  await submitter._setInputValueNoPostback(p, '#ctl00_MainContent_uc_MakeClaim_txtClaimRemarks', 'SPECIALIST CONSULTATION x1');

  const suggestion = await p.evaluate(async () => {
    const mk = (prefix) => new Promise((resolve) => {
      try {
        const payload = {
          prefixText: prefix,
          count: '1',
          contextKey: 'CLINICSEARCH',
          ClinicID: '',
          insurer: '',
        };
        $.ajax({
          url: '../../../Services/AutoCompletionService.asmx/SuggestPanelGPClinics',
          data: JSON.stringify(payload),
          dataType: 'json',
          type: 'POST',
          contentType: 'application/json; charset=utf-8',
          success: data => {
            const first = Array.isArray(data?.d) && data.d.length ? String(data.d[0]) : '';
            if (!first) return resolve(null);
            const [label, val] = first.split('|');
            resolve({ label: (label || '').trim(), val: (val || '').trim() });
          },
          error: () => resolve(null),
          failure: () => resolve(null),
        });
      } catch {
        resolve(null);
      }
    });
    return mk('SINGAPORE SPORTS');
  });

  const refLabel = suggestion?.label || 'SINGAPORE SPORTS & ORTHOPAEDIC CLINIC PTE LTD';
  await submitter._setInputValueNoPostback(p, '#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic', refLabel);
  await p.evaluate(() => {
    const set = (sel, v) => {
      const el = document.querySelector(sel);
      if (el) el.value = v;
    };
    set('#ctl00_MainContent_uc_MakeClaim_hfReferenceClinicType', 'Clinic');
    set('#ctl00_MainContent_uc_MakeClaim_hfOldReferenceClinicType', 'Clinic');
    const yes = document.querySelector('#ctl00_MainContent_uc_MakeClaim_chkHasReferringGPClinicYes');
    if (yes) yes.checked = true;
  }).catch(() => {});

  await p.waitForTimeout(500);
  console.log('[probe] before-calc', JSON.stringify(await state(p), null, 2));

  const calc = p.locator('#ctl00_MainContent_uc_MakeClaim_btncalculateclaim').first();
  await calc.click({ timeout: 8000 }).catch(async () => calc.click({ force: true, timeout: 8000 }));
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  await p.waitForTimeout(1500);

  console.log('[probe] after-calc', JSON.stringify(await state(p), null, 2));
  await p.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-probe-referral-exact-label.png', fullPage: true }).catch(() => {});
} catch (e) {
  console.error('[probe] fatal', e?.stack || String(e));
} finally {
  await bm.close().catch(() => {});
}
