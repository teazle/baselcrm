import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { MHCAsiaAutomation } from '../src/automations/mhc-asia.js';

dotenv.config();

const browser = new BrowserManager();
await browser.init();
const page = await browser.newPage();
const mhc = new MHCAsiaAutomation(page);

try {
  await mhc.login();
  await mhc.ensureAtMhcHome();
  const switched = await mhc._switchToPortalContext('aia');
  const opened = switched ? await mhc._openEditDraftVisits() : false;
  let searched = false;
  let extracted = { rows: [], url: page.url(), title: '' };
  if (opened) {
    searched = await mhc._searchDraftByNric('T1208937B');
    extracted = await mhc._extractDraftRows();
  }
  const raw = await page.evaluate(() => {
    const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
    const out = [];
    for (const tr of Array.from(document.querySelectorAll('table tr'))) {
      const cells = Array.from(tr.querySelectorAll('th,td')).map(td => clean(td.textContent));
      if (!cells.length) continue;
      if (!cells.some(Boolean)) continue;
      out.push(cells);
      if (out.length >= 20) break;
    }
    return {
      url: location.href,
      title: document.title,
      key: (document.querySelector('select[name="key"]') || {}).value || null,
      keyType: (document.querySelector('select[name="keyType"]') || {}).value || null,
      keyValue: (document.querySelector('input[name="keyValue"]') || {}).value || null,
      rows: out,
    };
  }).catch(() => null);

  console.log(JSON.stringify({ switched, opened, searched, extracted, raw }, null, 2));
} finally {
  await browser.close();
}
