import fs from 'node:fs';
import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { ClinicAssistAutomation } from '../src/automations/clinic-assist.js';

dotenv.config();

const outPath = '/Users/vincent/Baselrpacrm/tmp/probe_mittal_visit_tab_diag.json';
const patientNo = '78145';
const visitDate = '2026-02-02';

const browser = new BrowserManager();
await browser.init();
const page = await browser.newPage();
const ca = new ClinicAssistAutomation(page);

try {
  await ca.login();
  await ca.navigateToPatientPage();
  await ca.searchPatientByNumber(patientNo);
  await ca.page.waitForTimeout(1200);
  await ca.openPatientFromSearchResultsByNumber(patientNo);
  await ca.page.waitForTimeout(1200);

  await ca.navigateToTXHistory();
  await ca.openVisitTab().catch(() => false);
  const diag = await ca.extractDiagnosisFromVisitTab(visitDate);
  const txt = await ca.page.evaluate(() => String(document.body?.innerText || '').slice(0, 12000));
  fs.writeFileSync(outPath, JSON.stringify({ diag, bodySample: txt }, null, 2));
  console.log(outPath);
} finally {
  await browser.close().catch(() => {});
}
