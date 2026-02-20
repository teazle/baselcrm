import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

dotenv.config();

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);

const visit = {
  id: 'manual-s7137124g',
  visit_date: '2026-02-12',
  nric: 'S7137124G',
  diagnosis_description: 'Fever',
  treatment_detail: 'Medication and rest',
  total_amount: 38.0,
  extraction_metadata: { chargeType: 'follow', mcDays: 0 },
};

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const search = await auto.searchMemberByNric(visit.nric, visit.visit_date);
  if (!search?.found) throw new Error('member not found');
  await auto.selectMemberAndAdd();
  await auto.fillClaimForm(visit, 'Yip Man Hing Kevin');

  await page.locator('button:has-text("Calculate Claim")').first().click().catch(async () => {
    await page.locator('button:has-text("Calculate Claim")').first().click({ force: true });
  });
  await page.waitForTimeout(2000);

  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'))
      .map(el => (el.textContent || el.value || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  );
  console.log(JSON.stringify({ buttons }, null, 2));
  await page.screenshot({ path: 'screenshots/alliance-after-calculate-probe.png', fullPage: true }).catch(() => {});
} catch (error) {
  console.error(error?.message || String(error));
  await page.screenshot({ path: 'screenshots/alliance-after-calculate-probe-error.png', fullPage: true }).catch(() => {});
} finally {
  await bm.close();
}
