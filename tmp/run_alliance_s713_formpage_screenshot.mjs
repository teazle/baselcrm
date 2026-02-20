import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

dotenv.config();

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);

const visit = {
  id: 'manual-s7137124g-form-page',
  visit_date: '2026-02-12',
  nric: 'S7137124G',
  diagnosis_description: 'Fever',
  treatment_detail: 'Medication and rest',
  total_amount: 38.0,
  extraction_metadata: {
    chargeType: 'follow',
    mcDays: 0,
  },
};

try {
  process.env.WORKFLOW_SAVE_DRAFT = '1';

  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();

  const search = await auto.searchMemberByNric(visit.nric, visit.visit_date);
  if (!search?.found) {
    await page.screenshot({ path: 'screenshots/alliance-s713-form-page-not-found.png', fullPage: true });
    throw new Error(`Member not found: ${visit.nric}`);
  }

  await auto.selectMemberAndAdd();
  await auto.fillClaimForm(visit, 'Yip Man Hing Kevin');

  // Stay on the form page (no Calculate, no Save).
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'screenshots/alliance-s713-form-page-before-calculate.png', fullPage: true });

  console.log(
    JSON.stringify(
      {
        ok: true,
        screenshot: 'screenshots/alliance-s713-form-page-before-calculate.png',
        clickedCalculate: false,
        clickedSave: false,
      },
      null,
      2
    )
  );
} catch (error) {
  await page.screenshot({ path: 'screenshots/alliance-s713-form-page-error.png', fullPage: true }).catch(() => {});
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error), lastAction: auto.lastAction }, null, 2));
  process.exitCode = 1;
} finally {
  await bm.close();
}
