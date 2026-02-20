import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';
import { GENtucSubmitter } from '../src/core/ge-submitter.js';

const visit = {
  visit_date: process.env.GE_PROBE_VISIT_DATE || '2026-02-13',
  nric: process.env.GE_PROBE_NRIC || 'T0801699I',
  diagnosis_description: 'Lower back pain',
  diagnosis_code: '',
  treatment_detail: 'SPECIALIST CONSULTATION x1',
  total_amount: 38,
  extraction_metadata: { chargeType: 'follow', mcDays: 0, referringProviderEntity: 'SINGAPORE SPORTS' },
};

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const alliance = new AllianceMedinetAutomation(page);
const submitter = new GENtucSubmitter(alliance, null);

const inspect = async p => p.evaluate(() => {
  const get = sel => {
    const el = document.querySelector(sel);
    return el ? String(el.value || '').trim() : '';
  };
  const yes = document.querySelector('#ctl00_MainContent_uc_MakeClaim_chkHasReferringGPClinicYes');
  const no = document.querySelector('#ctl00_MainContent_uc_MakeClaim_chkHasReferringGPClinicNo');
  return {
    msg: document.querySelector('#ctl00_MainContent_uc_MakeClaim_lblMessage')?.textContent?.replace(/\s+/g,' ').trim() || '',
    yes: yes ? { checked: !!yes.checked, disabled: !!yes.disabled } : null,
    no: no ? { checked: !!no.checked, disabled: !!no.disabled } : null,
    refText: get('#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic'),
    feeType: get('#ctl00_MainContent_uc_MakeClaim_ddlFeeType'),
    dxCode: get('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosisCode'),
    dxText: get('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosis'),
    hasSave: Array.from(document.querySelectorAll('input[type="submit"],input[type="button"],button')).some(el => {
      const blob = `${el.id || ''} ${el.value || ''} ${el.textContent || ''}`.toLowerCase();
      return blob.includes('save') && !blob.includes('reload') && !blob.includes('calculate');
    }),
  };
});

const prepare = async popup => {
  const diagnosisResult = await submitter._setDiagnosisViaPopup(popup, visit, visit.diagnosis_description, visit.diagnosis_code);
  const selectedDiagnosisOption = diagnosisResult?.selectedOption || {};
  const choice = {
    code: selectedDiagnosisOption?.code || 'R52',
    text: selectedDiagnosisOption?.text || 'Pain, not elsewhere classified',
  };
  await submitter._setSelectValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_ddlMcDay', ['0']);
  await submitter._setInputValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_txtMcDays', '0');
  await submitter._setSelectValueNoPostback(
    popup,
    '#ctl00_MainContent_uc_MakeClaim_ddlMcReasons',
    ['Backache', 'Pain - Severe', 'Pain-unspecified'],
    '#ctl00_MainContent_uc_MakeClaim_txtmcreasons'
  );
  await submitter._forcePrimaryDiagnosisState(popup, choice, 'R52');
  await submitter._selectFeeTypeWithFallback(popup, ['followup_consultationfee', 'Follow-up Consultation', 'Follow Up']);
  await submitter._forcePrimaryDiagnosisState(popup, choice, 'R52');
  await submitter._setInputValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_txtFeeAmount', '38.00');
  await submitter._setInputValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_txtClaimRemarks', visit.treatment_detail);
  await submitter._setInputValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic', 'SINGAPORE SPORTS');
  await submitter._setReferralHiddenFields(popup);
  await submitter._ensureCalculateButtonReady(popup);
};

try {
  await alliance.login();
  await alliance.navigateToMedicalTreatmentClaim();
  const found = await alliance.searchMemberByNric(visit.nric, visit.visit_date);
  if (!found?.found) throw new Error('not_found');
  try { await alliance.selectMemberAndAdd(); } catch (error) { if ((error?.allianceError?.code||'') !== 'ge_popup_redirect') throw error; }
  const popup = alliance.lastGePopupPage;
  if (!popup) throw new Error('popup_missing');
  await popup.waitForLoadState('domcontentloaded').catch(()=>{});

  await prepare(popup);
  console.log('[probe] before yes/no', JSON.stringify(await inspect(popup), null, 2));

  await submitter._clickCalculateClaim(popup, 'default-yes');
  console.log('[probe] after default yes', JSON.stringify(await inspect(popup), null, 2));

  await popup.evaluate(() => {
    const yes = document.querySelector('#ctl00_MainContent_uc_MakeClaim_chkHasReferringGPClinicYes');
    const no = document.querySelector('#ctl00_MainContent_uc_MakeClaim_chkHasReferringGPClinicNo');
    if (yes && !yes.disabled) {
      yes.checked = false;
      yes.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (no && !no.disabled) {
      no.checked = true;
      no.dispatchEvent(new Event('change', { bubbles: true }));
      no.click();
    }
  }).catch(() => {});
  await popup.waitForLoadState('domcontentloaded').catch(()=>{});
  await popup.waitForTimeout(600);
  await submitter._setInputValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic', '');
  await submitter._setReferralHiddenFields(popup);
  await submitter._ensureCalculateButtonReady(popup);

  console.log('[probe] after set no', JSON.stringify(await inspect(popup), null, 2));
  await submitter._clickCalculateClaim(popup, 'set-no');
  console.log('[probe] after calc set no', JSON.stringify(await inspect(popup), null, 2));
  await popup.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-probe-referral-yes-no.png', fullPage: true }).catch(()=>{});
} catch (error) {
  console.error('[probe] fatal', error?.stack || String(error));
} finally {
  await bm.close().catch(()=>{});
}
