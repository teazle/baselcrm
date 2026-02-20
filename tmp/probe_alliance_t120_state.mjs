import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

const nric = 'T1204303H';
const visitDate = process.argv[2] || '2026-02-14';

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);
const out = { nric, visitDate, pre: {}, post: {}, result: null, error: null };

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const found = await auto.searchMemberByNric(nric, visitDate);
  out.found = found;

  const dialog = page.locator('[role="dialog"]').filter({ hasText: /Search\s*Member/i }).first();
  await dialog.waitFor({ state: 'visible', timeout: 10000 });

  out.pre.url = page.url();
  out.pre.textSample = (await dialog.innerText().catch(() => '')).slice(0, 1200);
  out.pre.rowDivs = await dialog.locator('.mat-mdc-row, .mat-row, .cdk-row').count().catch(() => -1);
  out.pre.rowTrs = await dialog.locator('tbody tr').count().catch(() => -1);
  out.pre.allCheckboxes = await dialog.locator('input[type="checkbox"]').count().catch(() => -1);
  out.pre.enabledCheckboxes = await dialog.locator('input[type="checkbox"]:not([disabled])').count().catch(() => -1);
  out.pre.addVisible = await dialog.locator('button:has-text("Add")').first().isVisible().catch(() => false);
  out.pre.addEnabled = await dialog.locator('button:has-text("Add")').first().isEnabled().catch(() => false);
  out.pre.noCoverage = await dialog.locator('text=/no\s+coverage\s+on\s+this\s+visit\s+date/i').count().catch(() => 0);
  out.pre.zeroRecords = await dialog.locator('text=/0\s*-\s*0\s*of\s*0\s*records/i').count().catch(() => 0);

  await page.screenshot({ path: `/Users/vincent/Baselrpacrm/screenshots/probe-t120-pre-${visitDate}.png`, fullPage: true });

  try {
    await auto.selectMemberAndAdd();
    out.result = 'selectMemberAndAdd_success';
  } catch (e) {
    out.result = 'selectMemberAndAdd_error';
    out.error = e?.message || String(e);
    out.allianceError = e?.allianceError || null;
  }

  out.post.url = page.url();
  out.post.hasClaimInfo = await page.locator('text=/Claim\s+Information/i').first().isVisible().catch(() => false);
  out.post.hasSearchMemberDialog = await page.locator('[role="dialog"]').filter({ hasText: /Search\s*Member/i }).first().isVisible().catch(() => false);
  await page.screenshot({ path: `/Users/vincent/Baselrpacrm/screenshots/probe-t120-post-${visitDate}.png`, fullPage: true });

  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error(e?.stack || String(e));
} finally {
  await bm.close().catch(() => {});
}
