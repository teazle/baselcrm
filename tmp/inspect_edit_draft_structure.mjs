import dotenv from 'dotenv';
import fs from 'fs';
import { BrowserManager } from '../src/utils/browser.js';
import { MHCAsiaAutomation } from '../src/automations/mhc-asia.js';

dotenv.config();

const outPath = '/Users/vincent/Baselrpacrm/tmp/edit_draft_structure_2026-02-02_2026-02-07.json';

async function clickFirst(page, selectors) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count().catch(() => 0)) > 0) {
      const visible = await loc.isVisible().catch(() => true);
      if (!visible) continue;
      await loc.click({ timeout: 10000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(1000);
      return true;
    }
  }
  return false;
}

async function openEditDraft(page) {
  const ok = await clickFirst(page, [
    'a:has-text("Edit/Draft Visits")',
    'button:has-text("Edit/Draft Visits")',
    'text=/Edit\\s*\/\\s*Draft\\s+Visits/i',
    'a[href*="DraftList"]',
  ]);
  if (!ok) throw new Error('Could not open Edit/Draft Visits');
}

async function capture(page) {
  return await page.evaluate(() => {
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const inputs = Array.from(document.querySelectorAll('input,select,textarea')).map((el, i) => ({
      i,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || null,
      name: el.getAttribute('name') || null,
      id: el.id || null,
      value: el.getAttribute('value') || '',
    }));
    const links = Array.from(document.querySelectorAll('a')).map((a, i) => ({
      i,
      text: clean(a.textContent),
      href: a.getAttribute('href') || '',
    })).filter((x) => x.text || x.href);
    const tables = Array.from(document.querySelectorAll('table')).map((t, idx) => {
      const rows = Array.from(t.querySelectorAll('tr')).slice(0, 12).map((tr) =>
        Array.from(tr.querySelectorAll('th,td')).map((c) => clean(c.textContent)).filter(Boolean)
      ).filter((r) => r.length > 0);
      return { idx, rowCount: t.querySelectorAll('tr').length, rows };
    });
    return { url: location.href, title: document.title, inputs, links, tables, body: clean(document.body.textContent).slice(0, 2500) };
  });
}

async function main() {
  const browser = new BrowserManager();
  await browser.init();
  const page = await browser.newPage();
  const mhc = new MHCAsiaAutomation(page);
  const out = { generatedAt: new Date().toISOString(), contexts: {} };

  try {
    await mhc.login();

    await mhc.ensureAtMhcHome();
    await openEditDraft(page);
    out.contexts.mhc = await capture(page);
    await page.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/edit-draft-structure-mhc.png', fullPage: true }).catch(() => {});

    await mhc.ensureAtMhcHome();
    await mhc.switchToSinglifeIfNeeded({ force: true }).catch(() => false);
    await openEditDraft(page);
    out.contexts.singlife = await capture(page);
    await page.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/edit-draft-structure-singlife.png', fullPage: true }).catch(() => {});

    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    console.log(`Saved ${outPath}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
