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

const listFields = async p =>
  p.evaluate(() => {
    const hidden = Array.from(document.querySelectorAll('input[type="hidden"]')).map(el => ({
      id: el.id || '',
      name: el.name || '',
      value: String(el.value || '').trim(),
    }));
    const refs = hidden.filter(h => /ref|clinic|parent|network|benefit/i.test(`${h.id} ${h.name}`));
    return {
      refs,
      msg: document.querySelector('#ctl00_MainContent_uc_MakeClaim_lblMessage')?.textContent?.replace(/\s+/g,' ').trim() || '',
      refText: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic')?.value || '',
    };
  });

try {
  await alliance.login();
  await alliance.navigateToMedicalTreatmentClaim();
  const found = await alliance.searchMemberByNric(visit.nric, visit.visit_date);
  if (!found?.found) throw new Error('not_found');
  try { await alliance.selectMemberAndAdd(); } catch (error) { if ((error?.allianceError?.code||'') !== 'ge_popup_redirect') throw error; }
  const popup = alliance.lastGePopupPage;
  if (!popup) throw new Error('popup_missing');
  await popup.waitForLoadState('domcontentloaded').catch(()=>{});

  const diagnosisResult = await submitter._setDiagnosisViaPopup(popup, visit, visit.diagnosis_description, visit.diagnosis_code);
  const selectedDiagnosisOption = diagnosisResult?.selectedOption || {};
  await submitter._forcePrimaryDiagnosisState(popup, {
    code: selectedDiagnosisOption?.code || 'R52',
    text: selectedDiagnosisOption?.text || 'Pain, not elsewhere classified',
  }, 'R52');
  await submitter._setSelectValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_ddlMcDay', ['0']);
  await submitter._setInputValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_txtMcDays', '0');
  await submitter._setSelectValueNoPostback(
    popup,
    '#ctl00_MainContent_uc_MakeClaim_ddlMcReasons',
    ['Backache', 'Pain - Severe', 'Pain-unspecified'],
    '#ctl00_MainContent_uc_MakeClaim_txtmcreasons'
  );
  await submitter._selectFeeTypeWithFallback(popup, ['followup_consultationfee','Follow-up Consultation','Follow Up']);
  await submitter._forcePrimaryDiagnosisState(popup, {
    code: selectedDiagnosisOption?.code || 'R52',
    text: selectedDiagnosisOption?.text || 'Pain, not elsewhere classified',
  }, 'R52');
  await submitter._setInputValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_txtFeeAmount', '38.00');
  await submitter._setInputValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_txtClaimRemarks', 'SPECIALIST CONSULTATION x1');
  await submitter._ensureReferralClinic(popup, visit);

  console.log('[probe] before-calc refs', JSON.stringify(await listFields(popup), null, 2));
  await submitter._clickCalculateClaim(popup, 'hidden-check');
  console.log('[probe] after-calc refs', JSON.stringify(await listFields(popup), null, 2));
  await popup.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-probe-hidden-ref-fields.png', fullPage: true }).catch(()=>{});
} catch (error) {
  console.error('[probe] fatal', error?.stack || String(error));
} finally {
  await bm.close().catch(()=>{});
}
