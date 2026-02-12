import dotenv from 'dotenv';
import fs from 'fs';
import { BrowserManager } from '../src/utils/browser.js';
import { MHCAsiaAutomation } from '../src/automations/mhc-asia.js';

dotenv.config();

const outPath = '/Users/vincent/Baselrpacrm/tmp/view_submitted_structure_2026-02-02_2026-02-07.json';

async function clickViewSubmitted(page) {
  const selectors = [
    'a:has-text("View Submitted Visits")',
    'button:has-text("View Submitted Visits")',
    'text=/View\\s+Submitted\\s+Visits/i',
    'a[href*="VisitList"]',
  ];

  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count().catch(() => 0)) > 0) {
      await loc.click({ timeout: 10000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(1200);
      return true;
    }
  }
  return false;
}

async function snapshotStructure(page) {
  return await page.evaluate(() => {
    const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const forms = Array.from(document.querySelectorAll('form')).map((f, i) => ({
      index: i,
      id: f.id || null,
      name: f.getAttribute('name') || null,
      action: f.getAttribute('action') || null,
      method: f.getAttribute('method') || null,
      inputCount: f.querySelectorAll('input,select,textarea').length,
      buttonCount: f.querySelectorAll('button,input[type="submit"],input[type="button"],a').length,
    }));

    const inputs = Array.from(document.querySelectorAll('input,select,textarea')).slice(0, 200).map((el, i) => ({
      index: i,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || null,
      id: el.id || null,
      name: el.getAttribute('name') || null,
      value: (el.getAttribute('value') || '').slice(0, 80),
      placeholder: el.getAttribute('placeholder') || null,
      ariaLabel: el.getAttribute('aria-label') || null,
      title: el.getAttribute('title') || null,
      className: (el.className || '').toString().slice(0, 120),
    }));

    const buttons = Array.from(document.querySelectorAll('button,input[type="submit"],input[type="button"],a')).slice(0, 300).map((el, i) => ({
      index: i,
      tag: el.tagName.toLowerCase(),
      text: text(el).slice(0, 120),
      id: el.id || null,
      name: el.getAttribute('name') || null,
      href: el.getAttribute('href') || null,
      onclick: el.getAttribute('onclick') || null,
      value: el.getAttribute('value') || null,
      className: (el.className || '').toString().slice(0, 120),
    })).filter((b) => b.text || b.value || b.href || b.onclick);

    const tables = Array.from(document.querySelectorAll('table')).slice(0, 25).map((t, idx) => {
      const headers = Array.from(t.querySelectorAll('th')).map((h) => text(h)).filter(Boolean);
      const rows = Array.from(t.querySelectorAll('tr')).slice(0, 12).map((tr) => {
        const cells = Array.from(tr.querySelectorAll('th,td')).map((c) => text(c)).filter(Boolean);
        return cells.slice(0, 15);
      }).filter((r) => r.length > 0);
      return {
        index: idx,
        id: t.id || null,
        className: (t.className || '').toString().slice(0, 120),
        headers: headers.slice(0, 25),
        rowCount: t.querySelectorAll('tr').length,
        rows,
      };
    });

    return {
      url: location.href,
      title: document.title,
      bodyTextSample: text(document.body).slice(0, 2500),
      forms,
      inputs,
      buttons,
      tables,
    };
  });
}

async function gotoContext(page, mhc, kind) {
  await mhc.ensureAtMhcHome();

  if (kind === 'aia') {
    await mhc._switchSystemTo(/aia\s*clinic/i, 'AIA Clinic').catch(() => false);
  } else if (kind === 'singlife') {
    await mhc.switchToSinglifeIfNeeded({ force: true }).catch(() => false);
  }

  const ok = await clickViewSubmitted(page);
  return { ok, url: page.url() };
}

async function main() {
  const browser = new BrowserManager();
  await browser.init();
  const page = await browser.newPage();
  const mhc = new MHCAsiaAutomation(page);

  const result = { generatedAt: new Date().toISOString(), contexts: {} };

  try {
    await mhc.login();

    for (const kind of ['mhc', 'aia', 'singlife']) {
      const nav = await gotoContext(page, mhc, kind);
      const structure = await snapshotStructure(page);
      result.contexts[kind] = { nav, structure };
      await page.screenshot({ path: `/Users/vincent/Baselrpacrm/screenshots/view-submitted-structure-${kind}.png`, fullPage: true }).catch(() => {});
    }

    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`Saved ${outPath}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
