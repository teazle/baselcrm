import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { BatchExtraction } from '../src/core/batch-extraction.js';

const browser = new BrowserManager();
const page = await browser.newPage();
const batch = new BatchExtraction(page);

try {
  await batch.clinicAssist.login();
  const date = '2026-02-13';
  const extracted = await batch.extractFromReportsQueueList(date);
  const saved = await batch.saveToCRM(extracted, date);
  const focus = (extracted || []).filter(r => String(r?.pcno || '') === '78227');
  console.log(JSON.stringify({ date, extracted: extracted?.length || 0, saved, focus }, null, 2));
} catch (e) {
  console.error('ERR', e?.message || String(e));
  process.exitCode = 1;
} finally {
  await browser.close();
}
