import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { MHCAsiaAutomation } from '../src/automations/mhc-asia.js';

dotenv.config();

const TARGET_NRIC = 'M4539893L';

async function clickFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    if ((await loc.count().catch(() => 0)) === 0) continue;
    const vis = await loc.isVisible().catch(() => true);
    if (!vis) continue;
    await loc.click({ timeout: 10000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(800);
    return true;
  }
  return false;
}

const browser = new BrowserManager();
await browser.init();
const page = await browser.newPage();
const mhc = new MHCAsiaAutomation(page);

try {
  await mhc.login();
  await mhc.ensureAtMhcHome();

  const opened = await clickFirstVisible(page, [
    'a:has-text("Edit/Draft Visits")',
    'button:has-text("Edit/Draft Visits")',
    'text=/Edit\\s*\\/\\s*Draft\\s+Visits/i',
  ]);
  if (!opened) throw new Error('Could not open Edit/Draft Visits');

  await page.evaluate((nric) => {
    const pick = (sel, re) => {
      if (!sel) return false;
      const opts = Array.from(sel.options || []);
      const hit = opts.find((o) => re.test(String(o.textContent || '')) || re.test(String(o.value || '')));
      if (!hit) return false;
      sel.value = hit.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };

    pick(document.querySelector('select[name="key"]'), /nric/i);
    pick(document.querySelector('select[name="keyType"]'), /equals|^E$/i);

    const input = document.querySelector('input[name="keyValue"]');
    if (input) {
      input.value = nric;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, TARGET_NRIC);

  const sb = page.locator('input[name="SearchAction"], button:has-text("Search")').first();
  if ((await sb.count().catch(() => 0)) > 0) {
    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(() => {}),
      sb.click({ timeout: 10000 }).catch(() => {}),
    ]);
  }
  await page.waitForTimeout(1200);

  const rows = await page.evaluate(() => {
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const out = [];
    for (const tr of Array.from(document.querySelectorAll('table tr'))) {
      const tds = Array.from(tr.querySelectorAll('th, td'));
      if (tds.length < 7) continue;
      const vals = tds.map((td) => clean(td.textContent));
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(vals[0] || '')) continue;
      if (!/^EV/i.test(vals[1] || '')) continue;
      const nric = String(vals[3] || '').toUpperCase();
      if (!/^[A-Z]\d{7}[A-Z]$/.test(nric)) continue;
      out.push({
        visitDate: vals[0] || '',
        visitNo: vals[1] || '',
        type: vals[2] || '',
        nric,
        patientName: vals[4] || '',
        totalFee: vals[5] || '',
        totalClaim: vals[6] || '',
        remarks: vals[8] || '',
      });
    }
    return out;
  });

  console.log(JSON.stringify(rows, null, 2));
} finally {
  await browser.close().catch(() => {});
}
