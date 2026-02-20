import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { MHCAsiaAutomation } from '../src/automations/mhc-asia.js';

dotenv.config();

const nric = 'T1208937B';
const visitDate = '06/02/2026';

const browser = new BrowserManager();
await browser.init();
const page = await browser.newPage();
const mhc = new MHCAsiaAutomation(page);

try {
  await mhc.login();
  await mhc.ensureAtMhcHome();
  const switched = await mhc._switchToPortalContext('aia');
  const navigated = switched ? await mhc.navigateToAIAVisitAndSearch(nric, { visitDate }) : false;

  let clicked = false;
  let popup = null;
  if (navigated) {
    await mhc.fillVisitDate(visitDate).catch(() => false);
    await mhc.fillChargeType('new').catch(() => false);

    const popupPromise = page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null);
    const mBtn = page
      .locator('input[name="SelectMasterDrug"], input[name*="SelectMasterDrug" i], tr:has-text("Drug Name") input[value="M" i]')
      .first();
    if ((await mBtn.count().catch(() => 0)) > 0) {
      clicked = await mBtn.click({ timeout: 5000 }).then(() => true).catch(() => false);
    }
    popup = await popupPromise;
  }

  const collect = async (targetPage) => {
    return targetPage.evaluate(() => {
      const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
      const anchors = Array.from(document.querySelectorAll('a')).map(a => ({
        text: clean(a.textContent),
        href: a.getAttribute('href') || '',
        onclick: a.getAttribute('onclick') || ''
      })).filter(a => a.text || a.href || a.onclick).slice(0, 200);
      const inputs = Array.from(document.querySelectorAll('input,select,button')).map(el => ({
        tag: el.tagName.toLowerCase(),
        type: (el.getAttribute('type') || '').toLowerCase(),
        name: el.getAttribute('name') || '',
        id: el.id || '',
        value: (el.getAttribute('value') || ''),
        text: clean(el.textContent || '')
      })).slice(0, 200);
      const rows = Array.from(document.querySelectorAll('table tr')).map(tr =>
        Array.from(tr.querySelectorAll('th,td')).map(td => clean(td.textContent))
      ).filter(r => r.some(Boolean)).slice(0, 120);
      return {
        url: location.href,
        title: document.title,
        bodySnippet: clean(document.body?.innerText || '').slice(0, 1800),
        anchors,
        inputs,
        rows,
      };
    });
  };

  const out = {
    switched,
    navigated,
    clicked,
    popupOpened: Boolean(popup),
    current: await collect(page),
  };

  if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    await popup.waitForTimeout(500).catch(() => {});
    out.popup = await collect(popup);
  }

  console.log(JSON.stringify(out, null, 2));
} finally {
  await browser.close();
}
