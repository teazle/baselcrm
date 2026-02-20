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

  const dialog = page
    .locator('[role="dialog"]:has-text("Search Member"), mat-dialog-container:has-text("Search Member")')
    .first();

  await page.locator('input[placeholder*="Membership" i]').first().fill('S7137124G');

  const dateInput = page.locator('input[placeholder*="Date of Visit" i]').first();
  await dateInput.click();
  await dateInput.fill('11/2/2026');
  await dateInput.dispatchEvent('input').catch(() => {});
  await dateInput.dispatchEvent('change').catch(() => {});

  await page.locator('button:has-text("Search Others")').first().click();

  for (let i = 1; i <= 8; i++) {
    await page.waitForTimeout(10000);
    const dialogText = await dialog.innerText().catch(() => '');
    const showingMatch = String(dialogText).match(/Showing\s+\d+\s*-\s*\d+\s*of\s*\d+\s*records/i);
    const rowCb = await dialog
      .locator('tbody tr td input[type="checkbox"]:not([disabled])')
      .count()
      .catch(() => 0);
    const masked = await dialog.locator('text=/[STFGM]\\*{3,}\\d{3}[A-Z]/i').count().catch(() => 0);
    const rows = await dialog.locator('tbody tr').count().catch(() => 0);

    console.log(
      JSON.stringify({
        tSec: i * 10,
        showing: showingMatch ? showingMatch[0] : null,
        rowCb,
        masked,
        rows,
      })
    );
  }

  await page.screenshot({ path: 'screenshots/alliance-search-s713-11-2-probe.png', fullPage: true });
} catch (error) {
  console.error('ERR', error?.message || String(error));
  await page
    .screenshot({ path: 'screenshots/alliance-search-s713-11-2-probe-error.png', fullPage: true })
    .catch(() => {});
} finally {
  await bm.close();
}
