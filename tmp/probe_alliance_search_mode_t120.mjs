import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

const nric = 'T1204303H';
const visitDate = '2026-02-14';

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const alliance = new AllianceMedinetAutomation(page);

const out = {
  nric,
  visitDate,
  found: null,
  beforeAddUrl: null,
  afterAddUrl: null,
  result: null,
  error: null,
};

try {
  await alliance.login();
  await alliance.navigateToMedicalTreatmentClaim();
  const found = await alliance.searchMemberByNric(nric, visitDate);
  out.found = found;

  const dialog = page.locator('[role="dialog"]').filter({ hasText: /Search\s*Member/i }).first();
  await dialog.waitFor({ state: 'visible', timeout: 10000 });

  const searchAia = dialog.locator('button:has-text("Search AIA Member")').first();
  if (await searchAia.count().catch(() => 0)) {
    await searchAia.click({ timeout: 10000 });
    await page.waitForTimeout(5000);
  }

  out.beforeAddUrl = page.url();
  await page.screenshot({
    path: '/Users/vincent/Baselrpacrm/screenshots/probe-alliance-t120-before-add.png',
    fullPage: true,
  });

  try {
    await alliance.selectMemberAndAdd();
    out.result = 'selectMemberAndAdd_success';
  } catch (e) {
    out.result = 'selectMemberAndAdd_error';
    out.error = e?.message || String(e);
    out.allianceCode = e?.allianceError?.code || null;
  }

  out.afterAddUrl = page.url();
  await page.screenshot({
    path: '/Users/vincent/Baselrpacrm/screenshots/probe-alliance-t120-after-add.png',
    fullPage: true,
  });
} catch (e) {
  out.result = 'fatal_error';
  out.error = e?.message || String(e);
} finally {
  console.log(JSON.stringify(out, null, 2));
  await bm.close().catch(() => {});
}
