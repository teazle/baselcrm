import fs from 'node:fs';
import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { MHCAsiaAutomation } from '../src/automations/mhc-asia.js';

dotenv.config();

const outPath = '/Users/vincent/Baselrpacrm/tmp/probe_mittal_diagnosis_popup_controls.json';
const nric = 'M4539893L';
const visitDate = '02/02/2026';

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
  await popup.waitForTimeout(800);

  const dump = await popup.evaluate(() => {
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (!style) return false;
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return !!rect && rect.width > 0 && rect.height > 0;
    };

    const textInputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])')).map((el, idx) => ({
      idx,
      tag: el.tagName.toLowerCase(),
      type: (el.getAttribute('type') || '').toLowerCase(),
      name: el.getAttribute('name') || '',
      id: el.id || '',
      value: el.getAttribute('value') || el.value || '',
      placeholder: el.getAttribute('placeholder') || '',
      className: el.className || '',
      visible: isVisible(el),
      disabled: !!el.disabled,
      readOnly: !!el.readOnly,
      rowText: clean(el.closest('tr')?.textContent || '').slice(0, 220),
      formId: el.form?.id || '',
      formAction: el.form?.getAttribute('action') || '',
    }));

    const radios = Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]')).map((el, idx) => ({
      idx,
      type: (el.getAttribute('type') || '').toLowerCase(),
      name: el.getAttribute('name') || '',
      id: el.id || '',
      value: el.getAttribute('value') || el.value || '',
      checked: !!el.checked,
      visible: isVisible(el),
      rowText: clean(el.closest('tr')?.textContent || '').slice(0, 220),
    }));

    const actions = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a')).map((el, idx) => ({
      idx,
      tag: el.tagName.toLowerCase(),
      type: (el.getAttribute('type') || '').toLowerCase(),
      name: el.getAttribute('name') || '',
      id: el.id || '',
      value: clean(el.getAttribute('value') || ''),
      text: clean(el.textContent || ''),
      href: el.getAttribute('href') || '',
      onclick: clean(el.getAttribute('onclick') || '').slice(0, 220),
      visible: isVisible(el),
      rowText: clean(el.closest('tr')?.textContent || '').slice(0, 220),
    }));

    const rows = Array.from(document.querySelectorAll('table tr')).map((tr, idx) => ({
      idx,
      text: clean(tr.textContent || '').slice(0, 220),
    })).filter(r => r.text);

    return {
      url: location.href,
      title: document.title,
      forms: Array.from(document.forms || []).map((f, idx) => ({
        idx,
        id: f.id || '',
        name: f.name || '',
        action: f.getAttribute('action') || '',
        method: f.getAttribute('method') || '',
      })),
      textInputs,
      radios,
      actions: actions.slice(0, 200),
      rows: rows.slice(0, 120),
      bodySample: clean(document.body?.innerText || '').slice(0, 3000),
    };
  });

  fs.writeFileSync(outPath, JSON.stringify(dump, null, 2));
  console.log(outPath);
} finally {
  await browser.close().catch(() => {});
}
