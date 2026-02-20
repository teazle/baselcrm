import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

const outputDir = path.resolve('output/playwright');
fs.mkdirSync(outputDir, { recursive: true });

const nric = String(process.argv[2] || '').trim();
const visitDate = String(process.argv[3] || '').trim();

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await context.newPage();
const auto = new AllianceMedinetAutomation(page);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const out = (name) => path.join(outputDir, `alliance-search-claims-${stamp}-${name}.png`);

try {
  await auto.login();
  await auto._clickFirstVisible(
    [
      'a:has-text("Search Panel Claims")',
      'button:has-text("Search Panel Claims")',
      '[role="menuitem"]:has-text("Search Panel Claims")',
      'text=Search Panel Claims',
    ],
    'Search Panel Claims menu'
  );
  await page.waitForTimeout(1800);
  await page.screenshot({ path: out('page'), fullPage: true });

  const metadata = await page.evaluate(() => {
    const pick = (sel) => Array.from(document.querySelectorAll(sel));
    const labels = pick('label')
      .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 60);
    const inputs = pick('input, select, textarea')
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        name: el.getAttribute('name') || null,
        placeholder: el.getAttribute('placeholder') || null,
        ariaLabel: el.getAttribute('aria-label') || null,
        value: (el.value || '').slice(0, 60),
      }))
      .slice(0, 100);
    const buttons = pick('button, [role="button"], input[type="button"], input[type="submit"]')
      .map(el => {
        const txt = (el.textContent || el.getAttribute('value') || '').replace(/\s+/g, ' ').trim();
        return txt;
      })
      .filter(Boolean)
      .slice(0, 80);
    const body = (document.body?.innerText || '').slice(0, 3500);
    return {
      url: location.href,
      title: document.title,
      labels,
      inputs,
      buttons,
      body,
    };
  });

  let searchAttempt = null;
  if (nric) {
    const candidates = [
      'input[name*="member" i]',
      'input[id*="member" i]',
      'input[placeholder*="Member UIN" i]',
      'input[placeholder*="Membership ID" i]',
      'input[aria-label*="Member UIN" i]',
      'input[aria-label*="Membership ID" i]',
    ];
    for (const selector of candidates) {
      const field = page.locator(selector).first();
      const count = await field.count().catch(() => 0);
      if (!count) continue;
      const visible = await field.isVisible().catch(() => false);
      if (!visible) continue;
      await field.fill(nric).catch(() => {});
      searchAttempt = { filledSelector: selector };
      break;
    }

    if (visitDate) {
      const dateCandidates = [
        'input[name*="date" i]',
        'input[id*="date" i]',
        'input[placeholder*="Date" i]',
        'input[aria-label*="Date" i]',
      ];
      for (const selector of dateCandidates) {
        const field = page.locator(selector).first();
        const count = await field.count().catch(() => 0);
        if (!count) continue;
        const visible = await field.isVisible().catch(() => false);
        if (!visible) continue;
        await field.fill(visitDate).catch(() => {});
        searchAttempt = { ...(searchAttempt || {}), dateSelector: selector };
        break;
      }
    }

    await auto
      ._clickFirstVisible(
        [
          'button:has-text("Search")',
          'button:has-text("Search Others")',
          'button:has-text("Apply")',
        ],
        'Search on Search Panel Claims'
      )
      .catch(() => false);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: out('after-search'), fullPage: true });
  }

  const tablePreview = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table tr, .mat-mdc-row, .mdc-data-table__row'))
      .map(r => (r.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return rows.slice(0, 20);
  });

  const outputPath = path.join(outputDir, `alliance-search-claims-${stamp}.json`);
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        ok: true,
        searchAttempt,
        screenshots: {
          page: out('page'),
          afterSearch: nric ? out('after-search') : null,
        },
        metadata,
        tablePreview,
      },
      null,
      2
    )
  );

  console.log(JSON.stringify({ ok: true, outputPath }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
