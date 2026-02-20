import 'dotenv/config';
import fs from 'fs';
import { BrowserManager } from '../src/utils/browser.js';
import { BatchExtraction } from '../src/core/batch-extraction.js';

const dates = ['2026-02-02', '2026-02-03', '2026-02-07'];
const outPath = '/Users/vincent/Baselrpacrm/tmp/refresh_queue_dates_result.json';

const browser = new BrowserManager();
const page = await browser.newPage();
const batch = new BatchExtraction(page);

const summary = [];

try {
  await batch.clinicAssist.login();

  for (const date of dates) {
    const extracted = await batch.extractFromReportsQueueList(date);
    const saved = await batch.saveToCRM(extracted, date);

    summary.push({
      date,
      extractedCount: Array.isArray(extracted) ? extracted.length : 0,
      savedCount: saved,
    });
  }

  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), summary }, null, 2));
  console.log(JSON.stringify({ outPath, summary }, null, 2));
} finally {
  await browser.close();
}
