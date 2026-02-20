import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);
const newPages = [];
page.context().on('page', p => newPages.push(p));

const nric = process.env.GE_PROBE_NRIC || 'T0801699I';
const date = process.env.GE_PROBE_VISIT_DATE || '2026-02-13';

const inspect = async p =>
  p.evaluate(() => {
    const allHidden = Array.from(document.querySelectorAll('input[type="hidden"]')).map(el => ({
      id: el.id || '',
      name: el.name || '',
      value: el.value || '',
    }));
    const ref = document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic');
    const yes = document.querySelector('#ctl00_MainContent_uc_MakeClaim_chkHasReferringGPClinicYes');
    const no = document.querySelector('#ctl00_MainContent_uc_MakeClaim_chkHasReferringGPClinicNo');
    const msg = document.querySelector('#ctl00_MainContent_uc_MakeClaim_lblMessage')?.textContent?.replace(/\s+/g, ' ').trim() || '';

    const interesting = allHidden.filter(x => /clinic|refer|parent|insurer|mcm|network/i.test(`${x.id} ${x.name}`));
    const autos = Array.from(document.querySelectorAll('ul.ui-autocomplete li, .ui-menu-item, li[id^="ui-id-"]')).map(el =>
      el.textContent?.replace(/\s+/g, ' ').trim()
    ).filter(Boolean);

    return {
      msg,
      refValue: ref?.value || '',
      yes: yes ? { checked: !!yes.checked, disabled: !!yes.disabled } : null,
      no: no ? { checked: !!no.checked, disabled: !!no.disabled } : null,
      interesting,
      autos,
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

  const p = newPages[newPages.length - 1];
  if (!p) throw new Error('ge_popup_missing');
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  await p.bringToFront().catch(() => {});
  await p.waitForTimeout(1000);

  console.log('[probe] initial', JSON.stringify(await inspect(p), null, 2));

  const ref = p.locator('#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic').first();
  await ref.click({ timeout: 5000 }).catch(() => {});
  await ref.fill('SINGAPORE SPORTS').catch(() => {});
  await p.waitForTimeout(1200);

  console.log('[probe] after fill', JSON.stringify(await inspect(p), null, 2));

  await p.keyboard.press('ArrowDown').catch(() => {});
  await p.keyboard.press('Enter').catch(() => {});
  await p.waitForTimeout(1200);

  console.log('[probe] after select', JSON.stringify(await inspect(p), null, 2));

  const calc = p.locator('#ctl00_MainContent_uc_MakeClaim_btncalculateclaim').first();
  if ((await calc.count().catch(() => 0)) > 0) {
    await calc.click({ timeout: 7000 }).catch(async () => calc.click({ timeout: 7000, force: true }));
    await p.waitForLoadState('domcontentloaded').catch(() => {});
    await p.waitForTimeout(1500);
  }

  console.log('[probe] after calc', JSON.stringify(await inspect(p), null, 2));
  await p.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-probe-referral-dom-live.png', fullPage: true }).catch(() => {});
} catch (error) {
  console.error('[probe] fatal', error?.stack || String(error));
} finally {
  await bm.close().catch(() => {});
}
