import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);
const popups = [];
page.context().on('page', p => popups.push(p));

const nric = process.env.GE_PROBE_NRIC || 'T0801699I';
const date = process.env.GE_PROBE_VISIT_DATE || '2026-02-13';

const inspect = async p =>
  p.evaluate(() => {
    const get = sel => {
      const el = document.querySelector(sel);
      return el ? String(el.value || '').trim() : '';
    };
    const msg =
      document.querySelector('#ctl00_MainContent_uc_MakeClaim_lblMessage')?.textContent?.replace(/\s+/g, ' ').trim() ||
      '';
    const hiddenInteresting = Array.from(document.querySelectorAll('input[type="hidden"]'))
      .map(el => ({ id: el.id || '', name: el.name || '', value: String(el.value || '').trim() }))
      .filter(x => /ref|clinic|parent|diag/i.test(`${x.id} ${x.name}`));

    const suggestions = Array.from(document.querySelectorAll('ul.ui-autocomplete li, .ui-menu-item, li[id^="ui-id-"]'))
      .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    const buttons = Array.from(document.querySelectorAll('input[type="submit"],input[type="button"],button'))
      .map(el => ({ id: el.id || '', value: el.value || (el.textContent || '').trim(), visible: !!(el.offsetParent || el.getClientRects().length) }));

    return {
      msg,
      refValue: get('#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic'),
      refType: get('#ctl00_MainContent_uc_MakeClaim_hfReferenceClinicType'),
      oldRefType: get('#ctl00_MainContent_uc_MakeClaim_hfOldReferenceClinicType'),
      clinicId: get('#ctl00_MainContent_uc_MakeClaim_hfClinicID'),
      parentClinicId: get('input[id$="hfParentClinicID"]'),
      primaryCode: get('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosisCode'),
      primaryText: get('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosis'),
      suggestions,
      hiddenInteresting,
      buttons,
    };
  });

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const found = await auto.searchMemberByNric(nric, date);
  if (!found?.found) throw new Error('member_not_found');
  try {
    await auto.selectMemberAndAdd();
  } catch {}

  const p = popups[popups.length - 1];
  if (!p) throw new Error('ge_popup_missing');
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  await p.waitForTimeout(1200);

  console.log('[probe] initial', JSON.stringify(await inspect(p), null, 2));

  const refField = p.locator('#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic').first();
  await refField.click({ timeout: 5000 }).catch(() => {});
  await refField.fill('SINGAPORE SPORTS').catch(() => {});
  await p.waitForTimeout(1200);
  console.log('[probe] after-fill', JSON.stringify(await inspect(p), null, 2));

  const suggestion = p.locator('ul.ui-autocomplete li, .ui-menu-item, li[id^="ui-id-"]').first();
  if ((await suggestion.count().catch(() => 0)) > 0) {
    await suggestion.click({ timeout: 5000 }).catch(async () => {
      await suggestion.click({ timeout: 5000, force: true });
    });
    await p.waitForTimeout(800);
  } else {
    await p.keyboard.press('ArrowDown').catch(() => {});
    await p.keyboard.press('Enter').catch(() => {});
    await p.waitForTimeout(800);
  }

  await p.keyboard.press('Tab').catch(() => {});
  await p.waitForTimeout(1200);
  console.log('[probe] after-select', JSON.stringify(await inspect(p), null, 2));

  const calc = p.locator('#ctl00_MainContent_uc_MakeClaim_btncalculateclaim').first();
  if ((await calc.count().catch(() => 0)) > 0) {
    await calc.click({ timeout: 7000 }).catch(async () => {
      await calc.click({ timeout: 7000, force: true });
    });
    await p.waitForLoadState('domcontentloaded').catch(() => {});
    await p.waitForTimeout(1200);
  }

  console.log('[probe] after-calc', JSON.stringify(await inspect(p), null, 2));
  await p.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-probe-referral-state.png', fullPage: true }).catch(() => {});
} catch (error) {
  console.error('[probe] fatal', error?.stack || String(error));
} finally {
  await bm.close().catch(() => {});
}
