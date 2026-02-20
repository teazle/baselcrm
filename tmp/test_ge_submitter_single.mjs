import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';
import { GENtucSubmitter } from '../src/core/ge-submitter.js';

const visit = {
  id: 'probe-ge-t0801699i',
  pay_type: 'ALLIANC',
  patient_name: 'WOO CHERN SEE',
  visit_date: process.env.GE_PROBE_VISIT_DATE || '2026-02-13',
  nric: process.env.GE_PROBE_NRIC || 'T0801699I',
  diagnosis_description: process.env.GE_PROBE_DIAGNOSIS || 'Lower back pain',
  diagnosis_code: process.env.GE_PROBE_DIAGNOSIS_CODE || '',
  treatment_detail: process.env.GE_PROBE_REMARKS || 'SPECIALIST CONSULTATION x1',
  total_amount: Number(process.env.GE_PROBE_FEE || 38),
  extraction_metadata: {
    chargeType: process.env.GE_PROBE_CHARGE_TYPE || 'follow',
    mcDays: Number(process.env.GE_PROBE_MC_DAYS || 0),
    referringProviderEntity: process.env.GE_REFERRING_GP_CLINIC || 'SINGAPORE SPORTS',
    diagnosisCanonical: {
      description_canonical: process.env.GE_PROBE_DIAGNOSIS || 'Lower back pain',
      code_normalized: process.env.GE_PROBE_DIAGNOSIS_CODE || '',
    },
  },
};

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const alliance = new AllianceMedinetAutomation(page);
const submitter = new GENtucSubmitter(alliance, null);

try {
  const result = await submitter.submit(visit, null);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error('[probe] fatal', error?.stack || String(error));
} finally {
  await bm.close().catch(() => {});
}
