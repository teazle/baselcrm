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
  await ca.navigateToTXHistory().catch(()=>{});
  await page.waitForTimeout(1000);
  await page.locator('a[href="#tabPastNotes"]').first().click({timeout:5000}).catch(()=>{});
  await page.waitForTimeout(1000);

  const data = await page.evaluate(() => {
    const root = document.querySelector('#tabPastNotes');
    const clickables = root ? Array.from(root.querySelectorAll('a,button,[role="tab"],li')) : [];
    const list = clickables.map((el) => {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName,
        text: t,
        id: el.id || null,
        class: el.className || null,
        href: el.getAttribute('href'),
        onclick: el.getAttribute('onclick'),
        role: el.getAttribute('role'),
        visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0,
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      };
    }).filter(x => x.text || x.href || x.onclick);

    const frames = Array.from(document.querySelectorAll('iframe')).map((f, i) => {
      const r = f.getBoundingClientRect();
      return {idx:i, id:f.id || null, name:f.name || null, src:f.getAttribute('src'), x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height)};
    });

    return {
      tabPastNotesClass: root?.className || null,
      tabPastNotesHtmlStart: (root?.innerHTML || '').slice(0, 2000),
      clickables: list,
      iframes: frames,
    };
  });

  console.log(JSON.stringify(data, null, 2));
} finally {
  await browser.close();
}
