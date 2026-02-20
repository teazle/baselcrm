import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

const bm = new BrowserManager(); await bm.init();
const page = await bm.newPage(); const auto = new AllianceMedinetAutomation(page); const pop=[]; page.context().on('page',p=>pop.push(p));
const nric = process.env.GE_PROBE_NRIC || 'T0801699I';
const date = process.env.GE_PROBE_VISIT_DATE || '2026-02-13';
const fmt = s => { const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m?`${m[3]}-${m[2]}-${m[1]}`:s; };

const state = async p => p.evaluate(() => ({
  msg: document.querySelector('#ctl00_MainContent_uc_MakeClaim_lblMessage')?.textContent?.replace(/\s+/g,' ').trim() || '',
  primaryText: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosis')?.value || '',
  primaryCode: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosisCode')?.value || '',
  primaryId: document.querySelector('#ctl00_MainContent_uc_MakeClaim_hfPrimaryDiagnosisID')?.value || '',
  primaryCodeHidden: document.querySelector('#ctl00_MainContent_uc_MakeClaim_hfPrimaryDiagnosisCode')?.value || '',
  feeType: document.querySelector('#ctl00_MainContent_uc_MakeClaim_ddlFeeType')?.value || '',
  buttons: Array.from(document.querySelectorAll('input[type="submit"],input[type="button"],button')).map(el=>({id:el.id||'',value:el.value||'',visible:!!(el.offsetParent||el.getClientRects().length)})),
}));

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const found = await auto.searchMemberByNric(nric,date);
  if(!found?.found) throw new Error('not found');
  try { await auto.selectMemberAndAdd(); } catch {}
  await page.waitForTimeout(1800);
  const p = pop[pop.length-1]; if(!p) throw new Error('no popup');
  await p.waitForLoadState('domcontentloaded').catch(()=>{});
  await p.bringToFront().catch(()=>{});

  await p.fill('#ctl00_MainContent_uc_MakeClaim_txtVisitDate', fmt(date)).catch(()=>{});
  await p.selectOption('#ctl00_MainContent_uc_MakeClaim_ddlMcDay', { value: '0' }).catch(()=>{});
  await p.fill('#ctl00_MainContent_uc_MakeClaim_txtMcDays', '0').catch(()=>{});
  await p.selectOption('#ctl00_MainContent_uc_MakeClaim_ddlMcReasons', { label: 'Pain - Severe' }).catch(()=>{});

  await p.evaluate(()=>{ const a=[...document.querySelectorAll('a')].find(x=>(x.getAttribute('title')||'').toLowerCase().includes('primary diagnosis')); if(a) a.click(); });
  await p.waitForTimeout(900);
  const frame = await (await p.waitForSelector('#TB_iframeContent',{timeout:8000})).contentFrame();
  await frame.fill('#ctl00_PopupPageContent_txtSearchContent','pain').catch(()=>{});
  await frame.click('#ctl00_PopupPageContent_btnSearch').catch(()=>{});
  await p.waitForTimeout(900);
  const row = await frame.$('tr:has(a[href*="lbtnPrimaryDiagnosis"]:text("Pain, not elsewhere classified"))');
  if (row) {
    const code = await row.$eval('td:nth-child(1)', el => (el.textContent||'').trim()).catch(()=> 'R52');
    const link = await row.$('a[href*="lbtnPrimaryDiagnosis"]');
    if (link) await link.click().catch(async()=>link.click({force:true}));
    await p.waitForTimeout(1400);
    await p.evaluate((codeVal) => {
      const codeInput = document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosisCode');
      const hidden = document.querySelector('#ctl00_MainContent_uc_MakeClaim_hfPrimaryDiagnosisCode');
      if (codeInput) {
        codeInput.value = codeVal;
        codeInput.dispatchEvent(new Event('input', { bubbles: true }));
        codeInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (hidden) hidden.value = codeVal;
    }, code);
  }

  console.log('[probe] after dx+code', JSON.stringify(await state(p), null, 2));

  await p.selectOption('#ctl00_MainContent_uc_MakeClaim_ddlFeeType', { value: 'consultationfee' }).catch(()=>{});
  await p.waitForLoadState('domcontentloaded').catch(()=>{});
  await p.waitForTimeout(1200);
  await p.fill('#ctl00_MainContent_uc_MakeClaim_txtFeeAmount', '38.00').catch(()=>{});
  await p.waitForTimeout(800);

  console.log('[probe] after fee', JSON.stringify(await state(p), null, 2));
  await p.screenshot({path:'/Users/vincent/Baselrpacrm/screenshots/ge-popup-after-manual-code.png', fullPage:true}).catch(()=>{});
} catch (e) {
  console.error('[probe] fatal', e?.stack || String(e));
} finally {
  await bm.close().catch(()=>{});
}
