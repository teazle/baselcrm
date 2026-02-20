import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { ClinicAssistAutomation } from '../src/automations/clinic-assist.js';

dotenv.config();
const browser = new BrowserManager();
const page = await browser.newPage();
const ca = new ClinicAssistAutomation(page);

try {
  await ca.login();
  await ca.navigateToPatientPage();
  await ca.searchPatientByNumber('78160');
  await ca.openPatientFromSearchResultsByNumber('78160');
  await page.waitForTimeout(1000);
  await ca.navigateToTXHistory().catch(() => {});
  await page.waitForTimeout(1000);

  await page.locator('a[href="#tabPastNotes"]').first().click({timeout:5000}).catch(()=>{});
  await page.waitForTimeout(1200);

  const info = await page.evaluate(() => {
    const root = document.querySelector('#tabPastNotes');
    const activeLi = document.querySelector('#Pat-tab-li-PastNotes');
    const text = (root?.innerText || '').replace(/\s+/g,' ').trim();
    const body = (document.body?.innerText || '').replace(/\s+/g,' ').trim();
    const hit = [];
    for (const kw of ['03/02/2026','2026-02-03','heel','foot','pain','diagnosis','append']) {
      const idx = text.toLowerCase().indexOf(kw.toLowerCase());
      hit.push({kw, inTab: idx >= 0, tabSnippet: idx>=0 ? text.slice(Math.max(0,idx-80), idx+220) : null});
    }
    return {
      url: location.href,
      liClass: activeLi?.className || null,
      tabVisible: !!root && getComputedStyle(root).display !== 'none',
      tabTextLength: text.length,
      tabTextStart: text.slice(0,2000),
      bodyHasPastNotes: body.toLowerCase().includes('past notes'),
      hits: hit,
    };
  });

  console.log(JSON.stringify(info, null, 2));
} finally {
  await browser.close();
}
