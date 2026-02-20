import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { BatchExtraction } from '../src/core/batch-extraction.js';

const date = '2026-02-03';
const browser = new BrowserManager();
const page = await browser.newPage();
const batch = new BatchExtraction(page);

try {
  await batch.clinicAssist.login();
  const extracted = await batch.extractFromReportsQueueList(date);
  const saved = await batch.saveToCRM(extracted, date);
  console.log(JSON.stringify({ date, extractedCount: extracted?.length || 0, savedCount: saved }, null, 2));
} finally {
  await browser.close();
}
