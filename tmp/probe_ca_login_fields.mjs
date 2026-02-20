import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';

dotenv.config();

const url = process.env.CLINIC_ASSIST_URL || 'https://clinicassist.sg:1080/';
const runs = Number(process.argv[2] || 1);

async function snapshot(page, tag) {
  const inputs = await page.evaluate(() => {
    const rows = [];
    for (const el of Array.from(document.querySelectorAll('input, button, select, textarea'))) {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      rows.push({
        tag: el.tagName,
        type: el.type || null,
        id: el.id || null,
        name: el.name || null,
        placeholder: el.getAttribute('placeholder') || null,
        value: el.value || null,
        text: (el.textContent || '').trim() || null,
        disabled: !!el.disabled,
        visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
      });
    }
    return rows;
  });
  return { tag, url: page.url(), inputs };
}

const bm = new BrowserManager();
try {
  const page = await bm.newPage();
  const out = [];
  for (let i = 0; i < runs; i++) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    out.push(await snapshot(page, `run-${i+1}-initial`));

    const user = page.locator('input[placeholder="Enter Username"], input[name="txtLoginID"], input[id="txtLoginID"], input[placeholder*="Username" i]').first();
    if (await user.count().catch(() => 0)) {
      await user.fill(process.env.CLINIC_ASSIST_USERNAME || '').catch(() => {});
      await page.waitForTimeout(600);
      out.push(await snapshot(page, `run-${i+1}-after-user-fill`));
    }

    await page.screenshot({ path: `/Users/vincent/Baselrpacrm/tmp/probe_ca_login_fields_run${i+1}.png`, fullPage: true }).catch(() => {});
  }

  const fs = await import('node:fs/promises');
  await fs.writeFile('/Users/vincent/Baselrpacrm/tmp/probe_ca_login_fields.json', JSON.stringify(out, null, 2));
  console.log('wrote /Users/vincent/Baselrpacrm/tmp/probe_ca_login_fields.json');
} finally {
  await bm.close();
}
