import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { MHCAsiaAutomation } from '../src/automations/mhc-asia.js';

dotenv.config();

const browser = new BrowserManager();
await browser.init();
const page = await browser.newPage();
const mhc = new MHCAsiaAutomation(page);

function clean(s){return String(s||'').replace(/\s+/g,' ').trim();}

try {
  await mhc.login();
  await mhc.ensureAtMhcHome();
  const ok = await mhc._switchSystemTo(/aia\s*clinic/i,'AIA Clinic').catch(()=>false);
  console.log('switchOK',ok,'url',page.url());
  const data = await page.evaluate(() => {
    const clean = s => String(s||'').replace(/\s+/g,' ').trim();
    const links = Array.from(document.querySelectorAll('a,button,input[type="button"],input[type="submit"]')).map(el=>({
      text: clean(el.textContent || el.value || el.getAttribute('aria-label') || ''),
      href: el.getAttribute && el.getAttribute('href') || '',
    })).filter(x=>x.text || x.href);
    return { title: document.title, links };
  });
  const pick = data.links.filter(x => /draft|edit\/?draft|submitted|visit/i.test(`${x.text} ${x.href}`));
  console.log(JSON.stringify({url:page.url(),title:data.title,count:pick.length,sample:pick.slice(0,80)},null,2));
} finally {
  await browser.close();
}
