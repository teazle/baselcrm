import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { MHCAsiaAutomation } from '../src/automations/mhc-asia.js';

dotenv.config();

async function clickFirstVisible(page, sels){
  for (const s of sels){
    const loc=page.locator(s).first();
    if ((await loc.count().catch(()=>0))>0 && (await loc.isVisible().catch(()=>true))){
      await loc.click({timeout:10000}).catch(()=>{});
      await page.waitForLoadState('domcontentloaded').catch(()=>{});
      await page.waitForTimeout(800);
      return true;
    }
  }
  return false;
}

const browser=new BrowserManager();
await browser.init();
const page=await browser.newPage();
const mhc=new MHCAsiaAutomation(page);

try{
  await mhc.login();
  await mhc.ensureAtMhcHome();
  await clickFirstVisible(page,[
    'a:has-text("Edit/Draft Visits")',
    'button:has-text("Edit/Draft Visits")',
    'a[href*="DraftList"]'
  ]);

  await page.evaluate(() => {
    const pickOption = (sel, matcher) => {
      if (!sel) return false;
      const opts = Array.from(sel.options || []);
      const hit = opts.find(matcher);
      if (!hit) return false;
      sel.value = hit.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };

    const keySel = document.querySelector('select[name="key"]');
    pickOption(keySel, opt => /nric/i.test(String(opt.textContent || '')) || /nric/i.test(String(opt.value || '')));
    const typeSel = document.querySelector('select[name="keyType"]');
    pickOption(typeSel, opt => /equals/i.test(String(opt.textContent || '')) || String(opt.value || '') === 'E');
    const input = document.querySelector('input[name="keyValue"]');
    if (input) {
      input.value = 'M4539893L';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  const searchBtn = page.locator('input[name="SearchAction"], button:has-text("Search")').first();
  if ((await searchBtn.count().catch(()=>0))>0){
    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(()=>{}),
      searchBtn.click({timeout:10000}).catch(()=>{}),
    ]);
  }
  await page.waitForTimeout(1200);

  const data = await page.evaluate(() => {
    const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
    const tables = Array.from(document.querySelectorAll('table')).map((t, ti) => {
      const rows = Array.from(t.querySelectorAll('tr')).map((tr, ri) => {
        const cells = Array.from(tr.querySelectorAll('th,td')).map(c => clean(c.textContent));
        const links = Array.from(tr.querySelectorAll('a')).map(a => ({text: clean(a.textContent), href: a.getAttribute('href') || ''}));
        return {ri, cells, links};
      }).filter(r => r.cells.some(Boolean) || r.links.length);
      return {ti, rowCount: rows.length, rows: rows.slice(0, 40)};
    });
    const keySel = document.querySelector('select[name="key"]');
    const keyVal = keySel ? keySel.value : '';
    const input = document.querySelector('input[name="keyValue"]');
    const inputVal = input ? input.value : '';
    return {url: location.href, title: document.title, keyVal, inputVal, tables};
  });

  console.log(JSON.stringify(data,null,2));
} finally {
  await browser.close();
}
