import 'dotenv/config';
import fs from 'fs/promises';
import { BrowserManager } from '../utils/browser.js';
import { PORTALS } from '../config/portals.js';

// Login, fill HAN + 19/09/1971, click SEARCH, wait for results,
// then dump the full DOM of the main page AND every iframe on the page.
// Goal: figure out how the results table is actually rendered and what
// selector pattern points to a clickable row / policy number.

const SURNAME = 'HAN';
const DOB_AMOS = '19/09/1971';

async function main() {
  const bm = new BrowserManager();
  await bm.init();
  const page = await bm.newPage();

  const loginUrl = PORTALS.ALLIANZ?.url || 'https://my.allianzworldwidecare.com/sol/login.do';
  const username = PORTALS.ALLIANZ?.username || process.env.ALLIANZ_PORTAL_USERNAME;
  const password = PORTALS.ALLIANZ?.password || process.env.ALLIANZ_PORTAL_PASSWORD;

  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.locator('input[name="userName"], input[name*="user" i]').first().fill(username);
  await page.locator('input[name="password"], input[type="password"]').first().fill(password);
  await page
    .locator('input[type="submit"][value*="LOGIN" i], a[href*="weoButtonHrefUid"]')
    .first()
    .click({ timeout: 5000 });
  await page.waitForTimeout(3500);

  if (!page.url().includes('login.do')) {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  await page.waitForTimeout(1000);

  // Fill + blur
  await page.locator('input[name="surname"]').first().fill(SURNAME);
  const dobLoc = page.locator('input[name="dob"]').first();
  await dobLoc.click();
  await dobLoc.fill(DOB_AMOS);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);

  // Kick search by evaluating the javascript: href (sidesteps Playwright's
  // navigation-wait heuristics that sometimes hang on AMOS's post-POST render)
  await page
    .evaluate(() => {
      const a = globalThis.document.querySelector('a#Searchbutton_A');
      if (a && typeof a.click === 'function') a.click();
    })
    .catch(e => console.log('[TRACE] search click error:', e?.message));

  // Poll until URL changes OR the instruction-only search form is replaced
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(750).catch(() => null);
    const u = page.url();
    const body = await page
      .evaluate(() => String(globalThis.document?.body?.innerText || '').slice(0, 200))
      .catch(() => '');
    if (
      u.includes('/forms/tpa/search.do') ||
      /Search Results|No Records Found|No matching/i.test(body)
    )
      break;
  }
  await page.waitForTimeout(2000);
  console.log('[TRACE] post-search URL:', page.url());

  await fs.mkdir('output/playwright', { recursive: true });

  // Main frame HTML
  const mainHtml = await page.content();
  await fs.writeFile('output/playwright/allianz-results-main.html', mainHtml);
  console.log('[TRACE] wrote main frame HTML:', mainHtml.length, 'bytes');

  // Enumerate frames
  const frames = page.frames();
  console.log('[TRACE] frame count:', frames.length);
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const url = f.url();
    let html = '';
    try {
      html = await f.content();
    } catch (e) {
      html = `[content() failed: ${e?.message}]`;
    }
    console.log(`[TRACE] frame[${i}] url=${url} html=${html.length}b`);
    await fs.writeFile(
      `output/playwright/allianz-results-frame-${i}.html`,
      `<!-- url: ${url} -->\n${html}`
    );
  }

  // Snapshot table rows via the best candidate frame
  const candidates = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const info = await f
      .evaluate(() => {
        const rows = Array.from(globalThis.document?.querySelectorAll?.('tr') || []);
        const hits = rows
          .filter(r => /P0\d{8}/i.test(r.textContent || ''))
          .map(r => {
            const cells = Array.from(r.querySelectorAll('td')).map(td =>
              (td.innerText || td.textContent || '').trim()
            );
            const firstA = r.querySelector('a');
            return {
              cells,
              onclick: r.getAttribute('onclick') || null,
              cursor: globalThis.getComputedStyle?.(r)?.cursor || null,
              firstA: firstA
                ? {
                    text: (firstA.innerText || firstA.textContent || '').trim(),
                    href: firstA.getAttribute('href'),
                    onclick: firstA.getAttribute('onclick'),
                    id: firstA.id,
                    className: firstA.className,
                  }
                : null,
            };
          });
        // Also dump the header to understand columns
        const headerRow = rows.find(r =>
          /status.*policy no.*first name.*surname.*date of birth/i.test(r.textContent || '')
        );
        const header = headerRow
          ? Array.from(headerRow.querySelectorAll('th, td')).map(c =>
              (c.innerText || c.textContent || '').trim()
            )
          : null;
        return { rowCount: rows.length, hits, header };
      })
      .catch(e => ({ error: String(e?.message || e) }));
    candidates.push({ frameIdx: i, url: f.url(), ...info });
  }
  console.log('[TRACE] row scan:', JSON.stringify(candidates, null, 2));
  await fs.writeFile(
    'output/playwright/allianz-results-rows.json',
    JSON.stringify(candidates, null, 2)
  );

  await page
    .screenshot({ path: 'screenshots/allianz-results-dump.png', fullPage: true })
    .catch(() => {});
  await bm.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
