import fs from 'node:fs';
import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { ClinicAssistAutomation } from '../src/automations/clinic-assist.js';

dotenv.config();

const outPath = '/Users/vincent/Baselrpacrm/tmp/probe_mittal_past_notes.json';
const patientNo = '78145';

const browser = new BrowserManager();
await browser.init();
const page = await browser.newPage();
const ca = new ClinicAssistAutomation(page);

try {
  await ca.login();
  const navOk = await ca.navigateToPatientPage();
  if (!navOk) throw new Error('navigateToPatientPage failed');

  await ca.searchPatientByNumber(patientNo);
  await ca.page.waitForTimeout(1500);
  await ca.openPatientFromSearchResultsByNumber(patientNo);
  await ca.page.waitForTimeout(1500);

  await ca.navigateToTXHistory();
  await ca.openPastNotesTab();
  await ca.page.waitForTimeout(2000);

  const dump = await ca.page.evaluate(() => {
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const text = clean(document.body?.innerText || '');
    const lines = text
      .split(/\n+/)
      .map((l) => clean(l))
      .filter(Boolean);

    const keyPattern = /(shoulder|shldr|pain|right|left|\brt\b|\blt\b|\br\b|\bl\b|m25\.5|m25\.51|m25\.511|diagnosis|note)/i;
    const interestingLines = lines.filter((l) => keyPattern.test(l)).slice(0, 600);

    const tables = Array.from(document.querySelectorAll('table')).slice(0, 40).map((table, tableIdx) => {
      const rows = Array.from(table.querySelectorAll('tr')).slice(0, 200).map((tr, rowIdx) => {
        const cells = Array.from(tr.querySelectorAll('th,td')).map((td) => clean(td.textContent || ''));
        return { rowIdx, cells, text: clean(tr.textContent || '') };
      });
      return {
        tableIdx,
        rowCount: rows.length,
        headerSample: rows.slice(0, 2),
        interestingRows: rows.filter((r) => keyPattern.test(r.text)).slice(0, 80),
      };
    });

    return {
      url: location.href,
      title: document.title,
      bodyTextSample: text.slice(0, 12000),
      interestingLines,
      tables,
    };
  });

  fs.writeFileSync(outPath, `${JSON.stringify(dump, null, 2)}\n`, 'utf8');
  console.log(outPath);
} finally {
  await browser.close().catch(() => {});
}
