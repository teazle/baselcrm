import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { MHCAsiaAutomation } from '../src/automations/mhc-asia.js';

dotenv.config();

const outPath = '/Users/vincent/Baselrpacrm/tmp/probe_mittal_diagnosis_popup.json';
const nric = 'M4539893L';
const visitDate = '02/02/2026';
const diagSearch = 'shoulder';

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
  const mBtn = page.locator('#visit_form input[value="M"]').first();
  await mBtn.click();
  const popup = await popupPromise;
  if (!popup) throw new Error('Diagnosis popup did not open');

  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  await popup.waitForTimeout(500);

  const input = popup.locator('input[type="text"], input[type="search"], input:not([type])').first();
  await input.fill(diagSearch).catch(async () => {
    await input.click();
    await input.type(diagSearch);
  });

  const searchBtn = popup
    .locator('button:has-text("Search"), button:has-text("Find"), input[type="submit"], input[type="button"][value*="Search" i]')
    .first();
  if ((await searchBtn.count().catch(() => 0)) > 0) {
    await searchBtn.click().catch(() => {});
  } else {
    await input.press('Enter').catch(() => {});
  }

  await popup.waitForTimeout(1200);

  const dump = await popup.evaluate(() => {
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const rows = Array.from(document.querySelectorAll('table tr')).map((tr, idx) => {
      const text = clean(tr.textContent || '');
      const links = Array.from(tr.querySelectorAll('a,button,input[type="button"],input[type="submit"]')).map((el) => ({
        tag: (el.tagName || '').toLowerCase(),
        text: clean(el.textContent || el.value || ''),
        href: el.getAttribute('href') || '',
        onclick: el.getAttribute('onclick') || '',
      }));
      return { idx, text, links };
    }).filter(r => r.text || r.links.length);

    return {
      url: location.href,
      title: document.title,
      rowCount: rows.length,
      sample: rows.slice(0, 80),
    };
  });

  const fs = await import('node:fs');
  fs.writeFileSync(outPath, JSON.stringify(dump, null, 2));
  console.log(outPath);
} finally {
  await browser.close().catch(() => {});
}
