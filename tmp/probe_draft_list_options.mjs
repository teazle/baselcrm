import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { MHCAsiaAutomation } from '../src/automations/mhc-asia.js';

dotenv.config();

async function clickFirstVisible(page, selectors) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count().catch(() => 0)) > 0) {
      if (!(await loc.isVisible().catch(() => true))) continue;
      await loc.click({ timeout: 10000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(1000);
      return true;
    }
  }
  return false;
}

async function openDraft(page) {
  const ok = await clickFirstVisible(page, [
    'a:has-text("Edit/Draft Visits")',
    'button:has-text("Edit/Draft Visits")',
    'text=/Edit\\s*\/\\s*Draft\\s+Visits/i',
    'a[href*="DraftList"]',
  ]);
  if (!ok) throw new Error('cannot open draft list');
}

async function enterContext(mhc, page, ctx) {
  await mhc.ensureAtMhcHome();
  if (ctx === 'singlife') {
    await mhc.switchToSinglifeIfNeeded({ force: true });
  } else if (ctx === 'aia') {
    const ok = await mhc._switchSystemTo(/aia\s*clinic/i, 'AIA Clinic').catch(() => false);
    if (!ok) throw new Error('switch to AIA failed');
  }
  await openDraft(page);
}

async function dump(page) {
  return await page.evaluate(() => {
    const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
    const keySelect = document.querySelector('select[name="key"]');
    const keyTypeSelect = document.querySelector('select[name="keyType"]');
    const options = keySelect ? Array.from(keySelect.options).map(o => ({ value: o.value, text: clean(o.textContent), selected: o.selected })) : [];
    const keyTypeOptions = keyTypeSelect ? Array.from(keyTypeSelect.options).map(o => ({ value: o.value, text: clean(o.textContent), selected: o.selected })) : [];
    const rows = [];
    for (const tr of Array.from(document.querySelectorAll('table tr'))) {
      const cells = Array.from(tr.querySelectorAll('th,td')).map(c => clean(c.textContent));
      if (cells.length < 2) continue;
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(cells[0]) && /^EV/i.test(cells[1])) rows.push(cells);
    }
    return {
      url: location.href,
      title: document.title,
      keyOptions: options,
      keyTypeOptions,
      rowCount: rows.length,
      rowSample: rows.slice(0, 5),
      searchInputExists: !!document.querySelector('input[name="keyValue"]'),
      searchBtnExists: !!document.querySelector('input[name="SearchAction"]'),
    };
  });
}

async function search(page, keyValue, nric) {
  const keySel = page.locator('select[name="key"]').first();
  if ((await keySel.count().catch(() => 0)) > 0) {
    await keySel.selectOption(keyValue).catch(() => {});
  }
  const typeSel = page.locator('select[name="keyType"]').first();
  if ((await typeSel.count().catch(() => 0)) > 0) {
    await typeSel.selectOption('E').catch(() => {});
  }
  const input = page.locator('input[name="keyValue"]').first();
  await input.fill(nric).catch(() => {});
  const btn = page.locator('input[name="SearchAction"]').first();
  if ((await btn.count().catch(() => 0)) > 0) {
    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(() => {}),
      btn.click({ timeout: 10000 }).catch(() => {}),
    ]);
  }
  await page.waitForTimeout(1000);
}

const browser = new BrowserManager();
await browser.init();
const page = await browser.newPage();
const mhc = new MHCAsiaAutomation(page);

const targetNric = process.argv[2] || 'S8481103C';

try {
  await mhc.login();
  for (const ctx of ['mhc', 'aia', 'singlife']) {
    await enterContext(mhc, page, ctx);
    const before = await dump(page);

    const afterByPatientNric = { skipped: true };
    if (before.keyOptions.some(o => o.value === 'patientNric')) {
      await search(page, 'patientNric', targetNric);
      Object.assign(afterByPatientNric, await dump(page), { skipped: false });
      await enterContext(mhc, page, ctx);
    }

    const afterByVisitNo = { skipped: true };
    if (before.keyOptions.some(o => o.value === 'visitNo')) {
      await search(page, 'visitNo', targetNric);
      Object.assign(afterByVisitNo, await dump(page), { skipped: false });
      await enterContext(mhc, page, ctx);
    }

    console.log(JSON.stringify({ context: ctx, before, afterByPatientNric, afterByVisitNo }, null, 2));
  }
} finally {
  await browser.close();
}
