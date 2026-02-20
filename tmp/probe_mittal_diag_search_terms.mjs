import fs from 'node:fs';
import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { MHCAsiaAutomation } from '../src/automations/mhc-asia.js';

dotenv.config();

const outPath = '/Users/vincent/Baselrpacrm/tmp/probe_mittal_diag_search_terms.json';
const nric = 'M4539893L';
const visitDate = '02/02/2026';
const terms = ['M25.51', 'M2551', 'M25', 'shoulder', 'right shoulder', 'pain in right shoulder', 'acj'];

const browser = new BrowserManager();
await browser.init();
const page = await browser.newPage();
const mhc = new MHCAsiaAutomation(page);

try {
  await mhc.ensureAtMhcHome();
  mhc.setupDialogHandler();

  const search = await mhc.searchPatientByNRIC({ nric, visitDate });
  if (!search?.found) throw new Error(`Patient not found: ${nric}`);
  const opened = await mhc.openPatientFromSearchResults(nric);
  if (!opened) throw new Error('Failed to open patient');

  await mhc.waitForVisitFormReady({ timeout: 8000 });
  await mhc.fillVisitDate(visitDate).catch(() => {});
  await mhc.fillChargeType('new').catch(() => {});
  await mhc.setWaiverOfReferral(true).catch(() => {});
  await mhc.fillConsultationFee(99999).catch(() => {});
  await mhc.fillMcDays(0).catch(() => {});

  const popupPromise = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
  const selectors = [
    '#visit_form > table > tbody > tr:nth-child(2) > td > table > tbody > tr:nth-child(14) > td:nth-child(2) > input',
    'tr:has-text("Diagnosis Pri") input[value="M"]',
    'tr:has-text("Diagnosis Pri") input[type="button"][value="M"]',
    'input[value="M"]:near(text="Diagnosis Pri", 200)',
    'input[type="submit"][value="M"]',
    'input[type="button"][value="M"]',
  ];
  let clicked = false;
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count().catch(() => 0)) > 0) {
      await loc.click().catch(() => {});
      clicked = true;
      break;
    }
  }
  if (!clicked) throw new Error('Could not click diagnosis M button');

  const popup = await popupPromise;
  if (!popup) throw new Error('Diagnosis popup did not open');

  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  await popup.waitForTimeout(600);

  const results = [];

  for (const term of terms) {
    const input = popup.locator('input[name="keyValue"]').first();
    await input.fill('').catch(() => {});
    await input.fill(term).catch(async () => {
      await input.click();
      await input.type(term);
    });

    const searchBtn = popup.locator('input[name="SearchAction"][type="submit"]').first();
    await Promise.all([
      popup.waitForLoadState('domcontentloaded').catch(() => {}),
      searchBtn.click().catch(() => input.press('Enter').catch(() => {})),
    ]);
    await popup.waitForTimeout(700);

    const snapshot = await popup.evaluate(() => {
      const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const rows = Array.from(document.querySelectorAll('table tr'))
        .map((tr, idx) => ({ idx, text: clean(tr.textContent || '') }))
        .filter((r) => r.text)
        .slice(0, 25);
      const body = clean(document.body?.innerText || '');
      return {
        url: location.href,
        bodySample: body.slice(0, 700),
        rows,
      };
    });

    const hasShoulder = /shoulder/i.test(JSON.stringify(snapshot.rows));
    const hasM25 = /m25/i.test(JSON.stringify(snapshot.rows));
    const firstDataRows = snapshot.rows.filter((r) => /[A-Z0-9]/.test(r.text)).slice(0, 8);

    results.push({
      term,
      url: snapshot.url,
      hasShoulder,
      hasM25,
      firstDataRows,
      bodySample: snapshot.bodySample,
    });
  }

  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  console.log(outPath);
} finally {
  await browser.close().catch(() => {});
}
