import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';
import { GENtucSubmitter } from '../src/core/ge-submitter.js';

dotenv.config();

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const alliance = new AllianceMedinetAutomation(page);
const submitter = new GENtucSubmitter(alliance);

const visit = {
  id: 'manual-ge-t0801699i',
  nric: 'T0801699I',
  visit_date: '2026-02-13',
  diagnosis_description: 'Fever',
  diagnosis_code: 'R50.9',
  treatment_detail: 'Medication and rest',
  total_amount: 38.0,
  extraction_metadata: { chargeType: 'follow', mcDays: 0 },
};

try {
  const result = await submitter.submit(visit, null);
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error(e?.stack || String(e));
} finally {
  await bm.close();
}
