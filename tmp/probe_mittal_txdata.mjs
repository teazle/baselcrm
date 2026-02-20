import fs from 'node:fs';
import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { ClinicAssistAutomation } from '../src/automations/clinic-assist.js';

dotenv.config();

const outPath = '/Users/vincent/Baselrpacrm/tmp/probe_mittal_txdata.json';
const visitDate = '2026-02-02';
const patientNo = '78145';

const browser = new BrowserManager();
await browser.init();
const page = await browser.newPage();
const ca = new ClinicAssistAutomation(page);

try {
  await ca.login();
  await ca.navigateToPatientPage();
  await ca.searchPatientByNumber(patientNo);
  await ca.page.waitForTimeout(1500);
  await ca.openPatientFromSearchResultsByNumber(patientNo);
  await ca.page.waitForTimeout(1500);

  const txData = await ca.getChargeTypeAndDiagnosis(visitDate);
  fs.writeFileSync(outPath, `${JSON.stringify(txData, null, 2)}\n`, 'utf8');
  console.log(outPath);
} finally {
  await browser.close().catch(() => {});
}
