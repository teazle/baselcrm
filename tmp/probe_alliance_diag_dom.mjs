import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

dotenv.config();

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const search = await auto.searchMemberByNric('S7137124G', '2026-02-12');
  if (!search?.found) throw new Error('member not found');
  await auto.selectMemberAndAdd();

  await page.locator('button:has-text("Add Diagnosis")').first().click();
  const dialog = page
    .locator('[role="dialog"]:has-text("Search Diagnosis"), mat-dialog-container:has-text("Search Diagnosis")')
    .first();
  await dialog.waitFor({ state: 'visible', timeout: 10000 });
  await dialog.locator('input[placeholder*="Diagnosis Name" i]').first().fill('fever');
  await dialog.locator('button:has-text("Search")').first().click();
  await page.waitForTimeout(1500);

  const counts = await dialog.evaluate(root => {
    const count = sel => root.querySelectorAll(sel).length;
    return {
      inputCheckbox: count('tbody tr td input[type="checkbox"]'),
      inputCheckboxEnabled: count('tbody tr td input[type="checkbox"]:not([disabled])'),
      matCheckbox: count('tbody tr td mat-checkbox'),
      roleCheckbox: count('tbody tr td [role="checkbox"]'),
      mdcCheckbox: count('tbody tr td .mdc-checkbox'),
      trCount: count('tbody tr'),
      anyRowsRole: count('[role="row"]'),
      anyCheckboxRole: count('[role="checkbox"]'),
    };
  });
  console.log(JSON.stringify(counts, null, 2));

  const rowHtml = await dialog.evaluate(root => {
    const row = root.querySelector('tbody tr') || root.querySelector('[role="row"]');
    return row ? row.outerHTML.slice(0, 800) : null;
  });
  console.log('ROW:', rowHtml || 'none');

  await page.screenshot({ path: 'screenshots/alliance-diagnosis-dom-probe.png', fullPage: true }).catch(() => {});
} catch (error) {
  console.error(error?.message || String(error));
} finally {
  await bm.close();
}
