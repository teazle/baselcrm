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
  extraction_metadata: {
    chargeType: 'follow',
  },
};

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const search = await auto.searchMemberByNric(visit.nric, visit.visit_date);
  console.log('search=', JSON.stringify(search));
  if (!search?.found) {
    await page.screenshot({ path: 'screenshots/alliance-s713-not-found.png', fullPage: true }).catch(() => {});
    process.exitCode = 2;
  } else {
    await auto.selectMemberAndAdd();
    await auto.fillClaimForm(visit, 'Yip Man Hing Kevin');
    const saved = await auto.saveAsDraft();
    await page.screenshot({ path: 'screenshots/alliance-s713-after-save-attempt.png', fullPage: true }).catch(() => {});
    console.log(JSON.stringify({ savedAsDraft: saved, lastAction: auto.lastAction }, null, 2));
  }
} catch (error) {
  console.error(
    JSON.stringify(
      {
        error: error?.message || String(error),
        lastAction: auto.lastAction,
        allianceError: error?.allianceError || null,
      },
      null,
      2
    )
  );
  await page.screenshot({ path: 'screenshots/alliance-s713-probe-error.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await bm.close();
}
