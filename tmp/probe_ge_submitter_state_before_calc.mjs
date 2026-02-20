import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';
import { GENtucSubmitter } from '../src/core/ge-submitter.js';

const visit = {
  id: 'probe-ge-state',
  visit_date: process.env.GE_PROBE_VISIT_DATE || '2026-02-13',
  nric: process.env.GE_PROBE_NRIC || 'T0801699I',
  diagnosis_description: process.env.GE_PROBE_DIAGNOSIS || 'Lower back pain',
  diagnosis_code: process.env.GE_PROBE_DIAGNOSIS_CODE || '',
  treatment_detail: process.env.GE_PROBE_REMARKS || 'SPECIALIST CONSULTATION x1',
  total_amount: Number(process.env.GE_PROBE_FEE || 38),
  extraction_metadata: {
    chargeType: process.env.GE_PROBE_CHARGE_TYPE || 'follow',
    mcDays: Number(process.env.GE_PROBE_MC_DAYS || 0),
    referringProviderEntity: process.env.GE_REFERRING_GP_CLINIC || 'SINGAPORE SPORTS',
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

const inspect = async p =>
  p.evaluate(() => {
    const get = sel => {
      const el = document.querySelector(sel);
      return el ? String(el.value || '').trim() : '';
    };
    return {
      msg:
        document.querySelector('#ctl00_MainContent_uc_MakeClaim_lblMessage')?.textContent
          ?.replace(/\s+/g, ' ')
          .trim() || '',
      mcDay: get('#ctl00_MainContent_uc_MakeClaim_ddlMcDay'),
      mcDays: get('#ctl00_MainContent_uc_MakeClaim_txtMcDays'),
      mcReason: get('#ctl00_MainContent_uc_MakeClaim_ddlMcReasons'),
      mcReasonText: get('#ctl00_MainContent_uc_MakeClaim_txtmcreasons'),
      refValue: get('#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic'),
      refType: get('#ctl00_MainContent_uc_MakeClaim_hfReferenceClinicType'),
      oldRefType: get('#ctl00_MainContent_uc_MakeClaim_hfOldReferenceClinicType'),
      clinicId: get('#ctl00_MainContent_uc_MakeClaim_hfClinicID'),
      parentClinicId: get('input[id$="hfParentClinicID"]'),
      dxCode: get('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosisCode'),
      dxText: get('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosis'),
      dxCodeHidden: get('#ctl00_MainContent_uc_MakeClaim_hfPrimaryDiagnosisCode'),
      dxId: get('#ctl00_MainContent_uc_MakeClaim_hfPrimaryDiagnosisID'),
      acuteArray: get('#ctl00_MainContent_uc_MakeClaim_hfAcute1Array'),
      feeType: get('#ctl00_MainContent_uc_MakeClaim_ddlFeeType'),
      feeAmount: get('#ctl00_MainContent_uc_MakeClaim_txtFeeAmount'),
      buttons: Array.from(document.querySelectorAll('input[type="submit"],input[type="button"],button')).map(el => ({
        id: el.id || '',
        value: el.value || (el.textContent || '').trim(),
        visible: !!(el.offsetParent || el.getClientRects().length),
      })),
    };
  });

try {
  await alliance.login();
  await alliance.navigateToMedicalTreatmentClaim();
  const found = await alliance.searchMemberByNric(visit.nric, visit.visit_date);
  if (!found?.found) throw new Error('not_found');
  try {
    await alliance.selectMemberAndAdd();
  } catch (error) {
    const code = error?.allianceError?.code || null;
    if (code !== 'ge_popup_redirect') throw error;
  }

  const popup = alliance.lastGePopupPage;
  if (!popup) throw new Error('popup_missing');
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  await popup.bringToFront().catch(() => {});
  await popup.waitForTimeout(600);

  const diagnosisResult = await submitter._setDiagnosisViaPopup(
    popup,
    visit,
    visit.diagnosis_description,
    visit.diagnosis_code || ''
  );

  const feeType = submitter._deriveFeeType(visit);
  const feeLabels =
    feeType === 'consultationfee'
      ? ['consultationfee', 'First Consultation Fee', 'First Consultation']
      : ['followup_consultationfee', 'follow_up_consultationfee', 'Follow-up Consultation', 'Follow Up', 'Follow-up'];

  const diagnosisState = diagnosisResult?.diagnosisState || {};
  const selectedDiagnosisOption = diagnosisResult?.selectedOption || {};
  const diagnosisOptionForReapply = {
    code:
      diagnosisState?.primaryCode ||
      diagnosisState?.primaryCodeHidden ||
      selectedDiagnosisOption?.code ||
      visit.diagnosis_code ||
      null,
    text: diagnosisState?.primaryText || selectedDiagnosisOption?.text || visit.diagnosis_description || null,
  };

  const mcDays = String(Number(visit.extraction_metadata.mcDays || 0));
  const mcReason = submitter._deriveMcReason(visit);

  await submitter._setSelectValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_ddlMcDay', [mcDays]);
  await submitter._setInputValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_txtMcDays', mcDays);
  await submitter._setSelectValueNoPostback(
    popup,
    '#ctl00_MainContent_uc_MakeClaim_ddlMcReasons',
    [mcReason, 'Pain - Severe', 'Pain-unspecified'],
    '#ctl00_MainContent_uc_MakeClaim_txtmcreasons'
  );

  await submitter._forcePrimaryDiagnosisState(popup, diagnosisOptionForReapply, visit.diagnosis_code || '');
  const feeTypeState = await submitter._selectFeeTypeWithFallback(popup, feeLabels);
  await submitter._forcePrimaryDiagnosisState(popup, diagnosisOptionForReapply, visit.diagnosis_code || '');
  await submitter._setInputValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_txtFeeAmount', String(visit.total_amount));
  await submitter._setInputValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_txtClaimRemarks', visit.treatment_detail);
  const referralOk = await submitter._ensureReferralClinic(popup, visit);
  await submitter._ensureCalculateButtonReady(popup);

  console.log('[probe] feeTypeState', JSON.stringify(feeTypeState, null, 2));
  console.log('[probe] referralOk', referralOk);
  console.log('[probe] before-calc', JSON.stringify(await inspect(popup), null, 2));

  await submitter._clickCalculateClaim(popup, 'probe-state');
  console.log('[probe] after-calc', JSON.stringify(await inspect(popup), null, 2));
  await popup.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-probe-submitter-state.png', fullPage: true }).catch(() => {});
} catch (error) {
  console.error('[probe] fatal', error?.stack || String(error));
} finally {
  await bm.close().catch(() => {});
}
