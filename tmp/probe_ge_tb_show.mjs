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

  const diagLink = popup.locator('a[title="Primary Diagnosis"]').first();
  const diagHref = await diagLink.getAttribute('href').catch(() => null);
  const hasTb = await popup.evaluate(() => typeof window.tb_show === 'function');
  console.log('[probe] tb_show', hasTb, 'href', diagHref);
  if (hasTb && diagHref) {
    await popup.evaluate((href) => window.tb_show('', href), diagHref);
    await popup.waitForTimeout(1500);
  }

  const iframeCount = await popup.locator('#TB_iframeContent').count().catch(() => 0);
  console.log('[probe] iframeCount', iframeCount);

  await popup.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-tb-show.png', fullPage: true }).catch(() => {});
} catch (e) {
  console.error('[probe] fatal', e?.stack || String(e));
  await page.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-tb-show-error.png', fullPage: true }).catch(() => {});
} finally {
  await bm.close().catch(() => {});
}
