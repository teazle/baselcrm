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

const getState = async p =>
  p.evaluate(() => {
    const msg = document.querySelector('#ctl00_MainContent_uc_MakeClaim_lblMessage')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const claimCode = document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtClaimCode')?.value || '';
    const save = Array.from(document.querySelectorAll('input[type="submit"],input[type="button"],button')).find(el => {
      const blob = `${el.id || ''} ${el.value || ''} ${el.textContent || ''}`.toLowerCase();
      return blob.includes('save') && !blob.includes('reload') && !blob.includes('calculate');
    });
    return {
      url: location.href,
      title: document.title,
      msg,
      claimCode,
      saveLabel: save ? (save.value || save.textContent || save.id || '').trim() : '',
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

  const result = await submitter.submit({ ...visit, id: 'probe-ge-save-warning' }, null);
  console.log('[probe] submit-result', JSON.stringify(result, null, 2));
  console.log('[probe] state-after-submit', JSON.stringify(await getState(popup), null, 2));

  const saveBtn = await submitter._detectSaveButton(popup);
  if (saveBtn?.locator) {
    await saveBtn.locator.click({ timeout: 8000 }).catch(async () => saveBtn.locator.click({ timeout: 8000, force: true }));
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    await popup.waitForTimeout(1200);
    console.log('[probe] state-after-manual-save', JSON.stringify(await getState(popup), null, 2));
  }

  await popup.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-probe-save-with-warning.png', fullPage: true }).catch(()=>{});
} catch (error) {
  console.error('[probe] fatal', error?.stack || String(error));
} finally {
  await bm.close().catch(()=>{});
}
