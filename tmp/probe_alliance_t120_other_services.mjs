import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

const nric = 'T1204303H';
const date = '14/2/2026';

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const dialog = page.locator('[role="dialog"]').filter({ hasText: /Search\s*Member/i }).first();
  await dialog.waitFor({ state: 'visible', timeout: 15000 });

  const otherBtn = page.locator('button:has-text("Other Services")').first();
  if (await otherBtn.isVisible().catch(() => false)) {
    await otherBtn.click({ timeout: 8000 }).catch(async()=> otherBtn.click({ timeout: 8000, force: true }));
    await page.waitForTimeout(1200);
  }

  await dialog.locator('input[placeholder*="Membership" i]').first().fill(nric);
  await dialog.locator('input[placeholder*="Date of Visit" i]').first().fill(date);
  await page.keyboard.press('Escape').catch(()=>{});
  await page.waitForTimeout(150);
  await dialog.locator('button:has-text("Search Others")').first().click({ timeout: 8000 });
  await page.waitForTimeout(6000);

  const row = dialog.locator('.mat-mdc-row, .mat-row, .cdk-row').first();
  const rowText = await row.innerText().catch(()=> '');
  const cb = row.locator('input[type="checkbox"]:not([disabled])').first();
  const cbVisible = await cb.isVisible().catch(() => false);
  if (cbVisible) await cb.click({ timeout: 5000 }).catch(async()=> cb.click({ timeout: 5000, force: true }));
  await page.waitForTimeout(300);
  const add = dialog.locator('button:has-text("Add")').first();
  const addEnabled = await add.isEnabled().catch(()=>false);
  if (addEnabled) await add.click({ timeout: 8000 }).catch(async()=> add.click({ timeout: 8000, force: true }));

  await page.waitForTimeout(6000);
  const claimInfo = await page.locator('text=/Claim\s+Information/i').first().isVisible().catch(() => false);
  const claimSummary = await page.locator('text=/Claim\s+Summary/i').first().isVisible().catch(() => false);
  const hasSearchDialog = await dialog.isVisible().catch(() => false);
  await page.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/probe-t120-other-services.png', fullPage: true });

  console.log(JSON.stringify({ rowText, cbVisible, addEnabled, claimInfo, claimSummary, hasSearchDialog, url: page.url() }, null, 2));
} catch (e) {
  console.error(e?.stack || String(e));
} finally {
  await bm.close().catch(()=>{});
}
