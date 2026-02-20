import dotenv from 'dotenv';
import fs from 'node:fs';
import { BrowserManager } from '../src/utils/browser.js';
import { MHCAsiaAutomation } from '../src/automations/mhc-asia.js';

dotenv.config();

const outPath = '/Users/vincent/Baselrpacrm/tmp/probe_mittal_diag_button_on_reused_draft.json';
const nric = 'M4539893L';
const visitDate = '02/02/2026';

const browser = new BrowserManager();
await browser.init();
const page = await browser.newPage();
const mhc = new MHCAsiaAutomation(page);

try {
  await mhc.ensureAtMhcHome();
  mhc.setupDialogHandler();
  const existing = await mhc.openExistingDraftVisit({ nric, visitDate, patientName: 'MITTAL SACHIN KUMAR' });
  if (!existing?.found) throw new Error('existing draft not found');

  await mhc.waitForVisitFormReady({ timeout: 10000 });
  await page.waitForTimeout(800);

  const dump = await page.evaluate(() => {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (!style) return false;
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return !!r && r.width > 0 && r.height > 0;
    };

    const rows = Array.from(document.querySelectorAll('tr'));
    const diagnosisRows = rows
      .map((row, idx) => ({ row, idx, text: norm(row.textContent || '') }))
      .filter((r) => /diagnosis\s*(pri|primary|sec|secondary)/i.test(r.text));

    const rowDump = diagnosisRows.map(({ row, idx, text }) => {
      const controls = Array.from(row.querySelectorAll('input,button,select,a,textarea')).map((el, cidx) => ({
        cidx,
        tag: el.tagName.toLowerCase(),
        type: (el.getAttribute('type') || '').toLowerCase(),
        name: el.getAttribute('name') || '',
        id: el.id || '',
        value: el.getAttribute('value') || '',
        text: norm(el.textContent || ''),
        onclick: (el.getAttribute('onclick') || '').slice(0, 120),
        className: (el.getAttribute('class') || '').slice(0, 120),
        visible: isVisible(el),
      }));
      return { idx, text, controls };
    });

    const allMish = Array.from(document.querySelectorAll('input,button,a'))
      .map((el, idx) => {
        const valueLike = norm(el.getAttribute('value') || el.textContent || el.getAttribute('aria-label') || '');
        if (!/^m$/i.test(valueLike)) return null;
        const rowText = norm(el.closest('tr')?.textContent || '');
        return {
          idx,
          tag: el.tagName.toLowerCase(),
          type: (el.getAttribute('type') || '').toLowerCase(),
          name: el.getAttribute('name') || '',
          id: el.id || '',
          value: el.getAttribute('value') || '',
          text: norm(el.textContent || ''),
          rowText,
          visible: isVisible(el),
          selectorHint: `${el.tagName.toLowerCase()}[name="${el.getAttribute('name') || ''}"][value="${el.getAttribute('value') || ''}"]`,
        };
      })
      .filter(Boolean);

    return {
      url: location.href,
      title: document.title,
      diagnosisRows: rowDump,
      mLikeControls: allMish,
    };
  });

  fs.writeFileSync(outPath, JSON.stringify(dump, null, 2));
  console.log(outPath);
} finally {
  await browser.close().catch(() => {});
}
