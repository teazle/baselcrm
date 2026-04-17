import 'dotenv/config';
import fs from 'fs/promises';
import { BrowserManager } from '../utils/browser.js';
import { PORTALS } from '../config/portals.js';

// Navigate to AMOS Email_us tab (after login) and dump full DOM + inputs,
// to determine whether it's a structured claim-submission form.
async function main() {
  const bm = new BrowserManager();
  await bm.init();
  const page = await bm.newPage();

  const loginUrl = PORTALS.ALLIANZ?.url || 'https://my.allianzworldwidecare.com/sol/login.do';
  const username = PORTALS.ALLIANZ?.username || process.env.ALLIANZ_PORTAL_USERNAME;
  const password = PORTALS.ALLIANZ?.password || process.env.ALLIANZ_PORTAL_PASSWORD;

  // Clear persisted cookies to force fresh login (avoids session ambiguity)
  await page.context().clearCookies();
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Wait for login form OR home menu to appear
  await page
    .waitForSelector('input#userName, #_WEOMENUITEM_tpaSearchMenu', { timeout: 15000 })
    .catch(() => null);
  const loginNeeded = await page
    .locator('input#userName')
    .count()
    .catch(() => 0);
  console.log('[TRACE] loginNeeded:', loginNeeded);
  if (loginNeeded > 0) {
    console.log('[TRACE] login form visible, submitting credentials');
    await page.locator('input#userName').first().fill(username, { timeout: 5000 });
    await page.locator('input[name="password"]').first().fill(password, { timeout: 5000 });
    await page.locator('a[href*="weoButtonHrefUid"]').first().click({ timeout: 5000 });
    await page.waitForTimeout(4000);
    await page.waitForSelector('#_WEOMENUITEM_tpaSearchMenu', { timeout: 20000 }).catch(() => null);
  }
  const postLoginBody = await page
    .evaluate(() => String(globalThis.document?.body?.innerText || '').slice(0, 200))
    .catch(() => '');
  console.log('[TRACE] post-login body:', postLoginBody);

  // Click the Email_us anchor directly — it calls weoMenuHref() internally.
  const clickResult = await page
    .evaluate(() => {
      // Try calling weoMenuHref directly (what the <a> href does)
      if (typeof globalThis.weoMenuHref === 'function') {
        try {
          globalThis.weoMenuHref('_WEOMENUITEM_tpaEmail');
          return { clicked: 'via weoMenuHref()' };
        } catch (e) {
          return { err_weoMenuHref: String(e?.message || e) };
        }
      }
      const a = globalThis.document.querySelector('#_WEOMENUITEM_tpaEmail_A');
      if (!a) return { err: '_WEOMENUITEM_tpaEmail_A not found' };
      try {
        a.click();
        return { clicked: 'via a.click()' };
      } catch (e) {
        return { err: String(e?.message || e) };
      }
    })
    .catch(e => ({ err: String(e?.message || e) }));
  console.log('[TRACE] Email_us click result:', JSON.stringify(clickResult));

  // Poll for URL or body change
  const deadline = Date.now() + 30000;
  let iters = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    iters += 1;
    const url = page.url();
    const body = await page
      .evaluate(() => String(globalThis.document?.body?.innerText || '').slice(0, 300))
      .catch(() => '');
    if (iters === 1 || iters % 3 === 0)
      console.log(`[TRACE] iter=${iters} url=${url} body=${body.slice(0, 120)}`);
    if (/claim|diagnosis|treatment|invoice|receipt/i.test(body)) {
      console.log('[TRACE] claim-form keyword found in body');
      break;
    }
  }

  // Dump full state
  const url = page.url();
  const body = await page
    .evaluate(() => String(globalThis.document?.body?.innerText || '').slice(0, 5000))
    .catch(() => '');
  const formInfo = await page
    .evaluate(() => {
      const inputs = Array.from(
        globalThis.document.querySelectorAll('input, textarea, select, button, a')
      );
      return inputs
        .map(el => ({
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          name: el.name || null,
          type: el.type || null,
          placeholder: el.placeholder || null,
          value: el.value || null,
          text: (el.innerText || el.textContent || '').trim().slice(0, 80),
          href: el.getAttribute ? el.getAttribute('href') : null,
          onclick: el.getAttribute ? (el.getAttribute('onclick') || '').slice(0, 120) : null,
        }))
        .filter(r => r.name || r.id || r.text || r.href || r.onclick);
    })
    .catch(e => ({ err: String(e?.message || e) }));
  console.log('[TRACE] final url:', url);
  console.log('[TRACE] final body:', body.slice(0, 1500));
  console.log('[TRACE] form elements:', JSON.stringify(formInfo, null, 2).slice(0, 8000));

  const html = await page.content();
  await fs.mkdir('output/playwright', { recursive: true });
  const stamp = Date.now();
  await fs.writeFile(`output/playwright/allianz-emailus-${stamp}.html`, html);
  await page
    .screenshot({ path: `screenshots/allianz-emailus-${stamp}.png`, fullPage: true })
    .catch(() => {});
  console.log(
    `[TRACE] wrote output/playwright/allianz-emailus-${stamp}.html (${html.length} bytes)`
  );

  await bm.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
