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

const requests = [];
const responses = [];

const tapNetwork = p => {
  p.on('request', req => {
    const u = req.url();
    if (!/clinic|refer|auto|search|lookup|Get/i.test(u)) return;
    requests.push({ method: req.method(), url: u, post: req.postData() || '' });
  });
  p.on('response', async res => {
    const u = res.url();
    if (!/clinic|refer|auto|search|lookup|Get/i.test(u)) return;
    let body = '';
    try {
      body = await res.text();
    } catch {}
    responses.push({ status: res.status(), url: u, body: body.slice(0, 800) });
  });
};

try {
  await alliance.login();
  await alliance.navigateToMedicalTreatmentClaim();
  const found = await alliance.searchMemberByNric(visit.nric, visit.visit_date);
  if (!found?.found) throw new Error('not_found');
  try { await alliance.selectMemberAndAdd(); } catch (error) { if ((error?.allianceError?.code||'') !== 'ge_popup_redirect') throw error; }
  const popup = alliance.lastGePopupPage;
  if (!popup) throw new Error('popup_missing');
  tapNetwork(popup);
  await popup.waitForLoadState('domcontentloaded').catch(()=>{});

  const diagnosisResult = await submitter._setDiagnosisViaPopup(popup, visit, visit.diagnosis_description, visit.diagnosis_code);
  const selectedDiagnosisOption = diagnosisResult?.selectedOption || {};
  const choice = {
    code: selectedDiagnosisOption?.code || 'R52',
    text: selectedDiagnosisOption?.text || 'Pain, not elsewhere classified',
  };
  await submitter._setSelectValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_ddlMcDay', ['0']);
  await submitter._setInputValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_txtMcDays', '0');
  await submitter._setSelectValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_ddlMcReasons', ['Backache', 'Pain - Severe'], '#ctl00_MainContent_uc_MakeClaim_txtmcreasons');
  await submitter._forcePrimaryDiagnosisState(popup, choice, 'R52');
  await submitter._selectFeeTypeWithFallback(popup, ['followup_consultationfee', 'Follow-up Consultation', 'Follow Up']);
  await submitter._forcePrimaryDiagnosisState(popup, choice, 'R52');
  await submitter._setInputValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_txtFeeAmount', '38.00');

  const field = popup.locator('#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic').first();
  await field.click({ timeout: 5000 }).catch(() => {});
  await field.fill('').catch(() => {});
  await popup.waitForTimeout(300);
  await field.type('SINGAPORE SPORTS', { delay: 80 }).catch(() => {});
  await popup.waitForTimeout(1800);

  const sugg = await popup
    .evaluate(() =>
      Array.from(document.querySelectorAll('ul.ui-autocomplete li, .ui-menu-item, li[id^="ui-id-"]'))
        .map(el => ({
          text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
          display: getComputedStyle(el).display,
          visible: !!(el.offsetParent || el.getClientRects().length),
        }))
        .filter(x => x.text)
    )
    .catch(() => []);

  console.log('[probe] suggestion-items', JSON.stringify(sugg, null, 2));
  console.log('[probe] requests', JSON.stringify(requests, null, 2));
  console.log('[probe] responses', JSON.stringify(responses, null, 2));
  await popup.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-probe-referral-autocomplete.png', fullPage: true }).catch(() => {});
} catch (error) {
  console.error('[probe] fatal', error?.stack || String(error));
} finally {
  await bm.close().catch(() => {});
}
