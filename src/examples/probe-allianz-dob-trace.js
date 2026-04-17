import 'dotenv/config';
import fs from 'fs/promises';
import { BrowserManager } from '../utils/browser.js';
import { PORTALS } from '../config/portals.js';

// Focused diagnostic: log in to AMOS, fill Surname + DOB manually,
// and snapshot the dob input value + Searchbutton_TD class at each step.
// Goal: confirm whether .fill() fires AMOS's client-side validator
// that un-disables the SEARCH button.

const SURNAME = 'HAN';
const DOB_AMOS = '19/09/1971'; // DD/MM/YYYY

async function snapshot(page, label) {
  const snap = await page.evaluate(() => {
    const q = sel => globalThis.document.querySelector(sel);
    const surname = q('input[name="surname"], input#surname');
    const dob = q('input[name="dob"], input#dob');
    const srchTd = q('#Searchbutton_TD');
    const srchA = q('#Searchbutton_A');
    return {
      url: globalThis.location.href,
      surnameValue: surname?.value ?? null,
      dobValue: dob?.value ?? null,
      dobAttrs: dob
        ? {
            type: dob.type,
            readonly: dob.readOnly,
            disabled: dob.disabled,
            onblur: dob.getAttribute('onblur'),
            onchange: dob.getAttribute('onchange'),
            onkeyup: dob.getAttribute('onkeyup'),
            onkeydown: dob.getAttribute('onkeydown'),
            oninput: dob.getAttribute('oninput'),
          }
        : null,
      searchTdClass: srchTd?.className || null,
      searchADisabled: srchA ? /disabled/i.test(srchA.className || '') : null,
    };
  });
  console.log(`[TRACE ${label}]`, JSON.stringify(snap, null, 2));
  return snap;
}

async function main() {
  const bm = new BrowserManager();
  await bm.init();
  const page = await bm.newPage();
  const loginUrl = PORTALS.ALLIANZ?.url || 'https://my.allianzworldwidecare.com/sol/login.do';
  const username = PORTALS.ALLIANZ?.username || process.env.ALLIANZ_PORTAL_USERNAME;
  const password = PORTALS.ALLIANZ?.password || process.env.ALLIANZ_PORTAL_PASSWORD;
  console.log('[TRACE] logging in as', username);

  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.locator('input[name="userName"], input[name*="user" i]').first().fill(username);
  await page.locator('input[name="password"], input[type="password"]').first().fill(password);
  await page
    .locator('input[type="submit"][value*="LOGIN" i], a[href*="weoButtonHrefUid"]')
    .first()
    .click({ timeout: 5000 });
  await page.waitForTimeout(3500);

  // Make sure we're on the search page
  if (!page.url().includes('login.do')) {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  await page.waitForTimeout(1000);

  await snapshot(page, '00-landed');

  // Step 1: click surname, type
  const surnameLoc = page.locator('input[name="surname"], input#surname').first();
  await surnameLoc.click({ timeout: 3000 }).catch(() => {});
  await surnameLoc.fill(SURNAME, { timeout: 3000 }).catch(() => {});
  await snapshot(page, '01-surname-filled');

  // Step 2: click dob, fill via Playwright .fill()
  const dobLoc = page.locator('input[name="dob"], input#dob').first();
  await dobLoc.click({ timeout: 3000 }).catch(() => {});
  await dobLoc.fill(DOB_AMOS, { timeout: 3000 }).catch(() => {});
  await snapshot(page, '02-dob-filled-via-fill');

  // Step 3: blur the dob field
  await page.keyboard.press('Tab').catch(() => {});
  await page.waitForTimeout(500);
  await snapshot(page, '03-after-tab-blur');

  // Step 4: fire keyup + change + blur synthetically
  await dobLoc
    .evaluate(el => {
      el.dispatchEvent(new globalThis.Event('keyup', { bubbles: true }));
      el.dispatchEvent(new globalThis.Event('blur', { bubbles: true }));
      el.dispatchEvent(new globalThis.Event('change', { bubbles: true }));
    })
    .catch(() => {});
  await page.waitForTimeout(500);
  await snapshot(page, '04-after-synth-events');

  // Step 5: try pressing keys character-by-character (simulate human typing)
  await dobLoc.fill('', { timeout: 3000 }).catch(() => {});
  await dobLoc.click({ timeout: 3000 }).catch(() => {});
  for (const ch of DOB_AMOS) {
    await page.keyboard.type(ch, { delay: 40 });
  }
  await page.keyboard.press('Tab').catch(() => {});
  await page.waitForTimeout(800);
  await snapshot(page, '05-after-type-and-tab');

  // Save HTML for the dob field wrapper so we can inspect AMOS's validator
  const formHtml = await page.evaluate(() => {
    const dob = globalThis.document.querySelector('input[name="dob"], input#dob');
    if (!dob) return null;
    let ancestor = dob;
    for (let i = 0; i < 4 && ancestor.parentElement; i++) ancestor = ancestor.parentElement;
    return ancestor.outerHTML;
  });
  await fs.mkdir('output/playwright', { recursive: true });
  await fs.writeFile('output/playwright/allianz-dob-wrapper.html', String(formHtml || ''));
  console.log('[TRACE] wrote output/playwright/allianz-dob-wrapper.html');

  // Step 6: try to actually click Search and see what happens
  await page
    .locator('a#Searchbutton_A')
    .first()
    .click({ timeout: 3000, force: true })
    .catch(() => {});
  await page.waitForTimeout(2500);
  await snapshot(page, '06-after-search-click');

  await page
    .screenshot({ path: 'screenshots/allianz-dob-trace-final.png', fullPage: true })
    .catch(() => {});
  await bm.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
