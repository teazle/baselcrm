import 'dotenv/config';
import fs from 'fs/promises';
import { BrowserManager } from '../utils/browser.js';
import { PORTALS } from '../config/portals.js';

// Log in to AMOS, then try navigating directly to a battery of likely
// claim-submission URLs (TPA/claim patterns across WEO-framework portals).
// For each URL, capture status + title + whether the page contains any
// claim-form-like inputs (diagnosis, treatment date, claim amount).
const CANDIDATE_URLS = [
  '/sol/forms/tpa/claim.do',
  '/sol/forms/tpa/claim.jsp',
  '/sol/forms/tpa/claimSubmission.jsp',
  '/sol/forms/tpa/newClaim.jsp',
  '/sol/forms/tpa/submitClaim.jsp',
  '/sol/forms/tpa/claims.jsp',
  '/sol/forms/tpa/addClaim.jsp',
  '/sol/forms/tpa/outpatient.jsp',
  '/sol/claim.do',
  '/sol/claims.do',
  '/sol/newClaim.do',
  '/sol/submitClaim.do',
  '/sol/forms/claim.jsp',
  '/sol/forms/common/claim.jsp',
  '/sol/forms/tpa/memberDetails.jsp', // known-good, for control
  // Try the Menu1 hidden items
  '/sol/forms/tpa/tpa.jsp',
  '/sol/tpa.do?command=NEW_CLAIM',
  '/sol/tpa.do?command=SUBMIT_CLAIM',
  '/sol/tpa.do?command=CLAIM',
];

async function main() {
  const bm = new BrowserManager();
  await bm.init();
  const page = await bm.newPage();

  await page.context().clearCookies();
  const loginUrl = PORTALS.ALLIANZ?.url || 'https://my.allianzworldwidecare.com/sol/login.do';
  const username = PORTALS.ALLIANZ?.username || process.env.ALLIANZ_PORTAL_USERNAME;
  const password = PORTALS.ALLIANZ?.password || process.env.ALLIANZ_PORTAL_PASSWORD;

  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('input#userName', { timeout: 15000 });
  await page.locator('input#userName').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('a[href*="weoButtonHrefUid"]').first().click({ timeout: 5000 });
  await page.waitForTimeout(4500);
  await page.waitForSelector('#_WEOMENUITEM_tpaSearchMenu', { timeout: 20000 }).catch(() => null);
  console.log('[TRACE] logged in, URL:', page.url());

  const base = new URL(loginUrl).origin;
  const results = [];
  for (const path of CANDIDATE_URLS) {
    const url = `${base}${path}`;
    let resp;
    try {
      resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (e) {
      results.push({ path, err: e?.message || String(e) });
      continue;
    }
    await page.waitForTimeout(1500);
    const status = resp?.status() ?? null;
    const title = await page.title().catch(() => '');
    const body = await page
      .evaluate(() => String(document?.body?.innerText || '').slice(0, 500))
      .catch(() => '');
    const inputs = await page
      .evaluate(() => {
        const list = Array.from(document.querySelectorAll('input, textarea, select'));
        return list
          .map(el => ({
            tag: el.tagName.toLowerCase(),
            name: el.name || null,
            id: el.id || null,
            type: el.type || null,
            placeholder: el.placeholder || null,
          }))
          .filter(r => r.name || r.id);
      })
      .catch(() => []);
    const hasClaimHints =
      /diagnosis|treatment|claim amount|policy number|icd|invoice|receipt/i.test(
        body + JSON.stringify(inputs)
      );
    const isLoginPage = /please enter your username|online services login/i.test(body);
    const isErrorPage = /error/i.test(title) || /an error occurred|reference #/i.test(body);
    results.push({
      path,
      status,
      title,
      isLoginPage,
      isErrorPage,
      hasClaimHints,
      inputsCount: inputs.length,
      bodyHead: body.slice(0, 200),
      inputs: inputs.slice(0, 15),
    });
    console.log(
      `[TRACE] ${path} status=${status} title="${title}" login=${isLoginPage} err=${isErrorPage} claim=${hasClaimHints} inputs=${inputs.length}`
    );
  }

  await fs.mkdir('output/playwright', { recursive: true });
  const out = `output/playwright/allianz-claim-url-scan-${Date.now()}.json`;
  await fs.writeFile(out, JSON.stringify(results, null, 2));
  console.log('[TRACE] wrote', out);

  await bm.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
