import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

const visit = { nric: process.env.GE_PROBE_NRIC || 'T0801699I', visit_date: process.env.GE_PROBE_VISIT_DATE || '2026-02-13' };

const bm = new BrowserManager(); await bm.init();
const page = await bm.newPage(); const auto = new AllianceMedinetAutomation(page); const pop=[]; page.context().on('page',p=>pop.push(p));

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const s = await auto.searchMemberByNric(visit.nric, visit.visit_date);
  if(!s?.found) throw new Error('not found');
  try { await auto.selectMemberAndAdd(); } catch {}
  await page.waitForTimeout(1800);
  const p = pop[pop.length-1]; if(!p) throw new Error('no popup');
  await p.waitForLoadState('domcontentloaded').catch(()=>{});
  await p.bringToFront().catch(()=>{});

  await p.evaluate(()=>{
    const a=Array.from(document.querySelectorAll('a')).find(el=>(el.getAttribute('title')||'').toLowerCase().includes('primary diagnosis'));
    if(a) a.click();
  });
  await p.waitForTimeout(900);

  const frame = await (await p.waitForSelector('#TB_iframeContent',{timeout:8000})).contentFrame();
  if(!frame) throw new Error('no frame');

  const terms = ['lower back pain','back pain','backache','low back pain','lumbago','pain'];
  for (const term of terms) {
    await frame.fill('#ctl00_PopupPageContent_txtSearchContent', term).catch(()=>{});
    await frame.click('#ctl00_PopupPageContent_btnSearch').catch(()=>{});
    await p.waitForTimeout(900);
    const rows = await frame.evaluate(() => {
      const out = [];
      const trs = Array.from(document.querySelectorAll('table tr'));
      for (const tr of trs) {
        const link = tr.querySelector('a[href*="lbtnPrimaryDiagnosis"]');
        if (!link) continue;
        const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.textContent || '').replace(/\s+/g, ' ').trim());
        out.push({
          text: (link.textContent || '').replace(/\s+/g, ' ').trim(),
          href: link.getAttribute('href') || '',
          cols: tds,
        });
      }
      return out.slice(0, 20);
    });
    console.log('\nTERM=', term, 'COUNT=', rows.length);
    for (const r of rows.slice(0, 10)) {
      console.log(JSON.stringify(r));
    }
  }
} catch (e) {
  console.error('[probe] fatal', e?.stack || String(e));
} finally {
  await bm.close().catch(()=>{});
}
