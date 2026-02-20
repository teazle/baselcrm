import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { ClinicAssistAutomation } from '../src/automations/clinic-assist.js';

dotenv.config();

const browser = new BrowserManager();
const page = await browser.newPage();
const ca = new ClinicAssistAutomation(page);

function snippet(text, kw) {
  const i = text.toLowerCase().indexOf(kw.toLowerCase());
  return i >= 0 ? text.slice(Math.max(0, i - 160), i + 260) : null;
}

try {
  await ca.login();
  await ca.navigateToPatientPage();
  await ca.searchPatientByNumber('78160');
  await ca.openPatientFromSearchResultsByNumber('78160');
  await page.waitForTimeout(1200);
  await ca.navigateToTXHistory();
  await ca.openPastNotesTab();
  await ca.expandPastNotesEntries('2026-02-03');
  await page.waitForTimeout(1200);

  const before = await page.evaluate(() => {
    const txt = (document.querySelector('#tabPastNotes')?.innerText || '').replace(/\s+/g, ' ').trim();
    return { len: txt.length, text: txt.slice(0, 4000) };
  });

  // Click first visible row/cell in the past case note grid.
  await page.evaluate(() => {
    const selectors = [
      '#pastCaseNoteGrid tr.jqgrow:first-child',
      '#pastCaseNoteGrid tr[role="row"]:not(.ui-jqgrid-labels):first-child',
      '#pastCaseNoteGrid td[aria-describedby$="_CaseNote"]:first-child',
      '#pastCaseNoteGrid td[aria-describedby$="_Description"]:first-child',
      '#pastCaseNoteGrid tr:first-child td:first-child'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        break;
      }
    }
  });

  await page.waitForTimeout(1800);

  const after = await page.evaluate(() => {
    const pane = document.querySelector('#tabPastNotes');
    const txt = (pane?.innerText || document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const modalTexts = Array.from(document.querySelectorAll('.modal.show,.modal.in,[role="dialog"]'))
      .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 5);
    return {
      url: location.href,
      paneLen: txt.length,
      paneText: txt.slice(0, 6000),
      modalTexts,
      hasHiddenText: /foot|heel|left|right|pain|diagnosis|m79/i.test(txt),
    };
  });

  const t = after.paneText || '';
  const kw = ['foot', 'heel', 'left', 'right', 'pain', 'diagnosis', 'm79', 'management', 'complaint'];
  const snippets = Object.fromEntries(kw.map((k) => [k, snippet(t, k)]));

  console.log(JSON.stringify({ before: { len: before.len }, after: { paneLen: after.paneLen, hasHiddenText: after.hasHiddenText }, snippets, modalTexts: after.modalTexts }, null, 2));
} finally {
  await browser.close();
}
