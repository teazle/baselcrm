import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { MHCAsiaAutomation } from '../src/automations/mhc-asia.js';

dotenv.config();

function clean(s){return String(s||'').replace(/\s+/g,' ').trim();}

async function dumpLinks(page,label){
  const data = await page.evaluate(() => {
    const clean = s => String(s||'').replace(/\s+/g,' ').trim();
    return Array.from(document.querySelectorAll('a,button,input[type="button"],input[type="submit"]')).map(el=>({
      text: clean(el.textContent || el.value || el.getAttribute('aria-label') || ''),
      href: el.getAttribute && el.getAttribute('href') || '',
    })).filter(x=>x.text || x.href);
  });
  const draftish = data.filter(x => /draft|edit\/?draft|submitted|visit/i.test(`${x.text} ${x.href}`)).slice(0,120);
  console.log(JSON.stringify({label,url:page.url(),title:await page.title().catch(()=>''),draftish},null,2));
}

const browser = new BrowserManager();
await browser.init();
const page = await browser.newPage();
const mhc = new MHCAsiaAutomation(page);

try {
  await mhc.login();
  await mhc.ensureAtMhcHome();
  await dumpLinks(page,'mhc-home');

  await mhc.switchToSinglifeIfNeeded({force:true}).catch(()=>false);
  await page.waitForTimeout(1200);
  await dumpLinks(page,'singlife-home');

  await mhc.ensureAtMhcHome();
  await mhc._switchSystemTo(/aia\s*clinic/i,'AIA Clinic').catch(()=>false);
  await page.waitForTimeout(1200);
  await dumpLinks(page,'aia-home');
} finally {
  await browser.close();
}
