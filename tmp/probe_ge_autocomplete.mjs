import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

dotenv.config();

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);
const popupPages = [];
page.context().on('page', popup => popupPages.push(popup));

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const search = await auto.searchMemberByNric('T0801699I', '2026-02-13');
  if (!search?.found) throw new Error('member_not_found');
  try { await auto.selectMemberAndAdd(); } catch {}
  await page.waitForTimeout(2000);
  const popup = popupPages[popupPages.length - 1];
  if (!popup) throw new Error('no_popup');
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  await popup.bringToFront().catch(() => {});
  await popup.waitForTimeout(1000);

  const diagInput = popup.locator('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosis').first();
  await diagInput.click({ timeout: 5000 }).catch(() => {});
  await diagInput.fill('fev').catch(() => {});
  await popup.waitForTimeout(1500);

  const items = await popup.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('ul,div,table')).filter(el => {
      const cls = (el.className || '').toString().toLowerCase();
      if (cls.includes('autocomplete') || cls.includes('ac_') || cls.includes('ac_results') || cls.includes('ui-autocomplete')) return true;
      return false;
    });
    const visible = candidates.filter(el => el.offsetParent || el.getClientRects().length);
    const texts = visible.map(el => (el.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    return { count: visible.length, texts: texts.slice(0, 20) };
  });

  console.log('[probe] autocomplete', JSON.stringify(items, null, 2));
  await popup.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-autocomplete.png', fullPage: true }).catch(() => {});
} catch (e) {
  console.error('[probe] fatal', e?.stack || String(e));
  await page.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-autocomplete-error.png', fullPage: true }).catch(() => {});
} finally {
  await bm.close().catch(() => {});
}
