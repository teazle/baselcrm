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
  await page.waitForTimeout(1200);
  await ca.navigateToTXHistory().catch(() => {});
  await page.waitForTimeout(1200);

  const data = await page.evaluate(() => {
    const isVisible = (el) => {
      const cs = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity || '1') > 0 && r.width > 0 && r.height > 0;
    };
    const candidates = [];
    const all = Array.from(document.querySelectorAll('*'));
    for (const el of all) {
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt) continue;
      if (!/past\s*notes|visit\s*notes|notes/i.test(txt)) continue;
      if (!['A','BUTTON','LI','SPAN','DIV'].includes(el.tagName)) continue;
      const r = el.getBoundingClientRect();
      candidates.push({
        tag: el.tagName,
        text: txt.slice(0, 120),
        id: el.id || null,
        class: el.className || null,
        role: el.getAttribute('role'),
        tabTarget: el.getAttribute('tabTarget'),
        href: el.getAttribute('href'),
        onclick: el.getAttribute('onclick'),
        cat: el.getAttribute('cat'),
        visible: isVisible(el),
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      });
    }
    return candidates.slice(0, 250);
  });

  console.log(JSON.stringify({ url: page.url(), count: data.length, candidates: data }, null, 2));
} finally {
  await browser.close();
}
