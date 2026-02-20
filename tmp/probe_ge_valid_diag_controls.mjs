import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

const visit = { nric: process.env.GE_PROBE_NRIC || 'T0801699I', visit_date: process.env.GE_PROBE_VISIT_DATE || '2026-02-13' };
const fmt = s => { const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m?`${m[3]}-${m[2]}-${m[1]}`:s; };

const bm = new BrowserManager(); await bm.init();
const page = await bm.newPage(); const auto = new AllianceMedinetAutomation(page); const pop=[]; page.context().on('page',p=>pop.push(p));

const dumpState = async p => p.evaluate(() => ({
  msg: document.querySelector('#ctl00_MainContent_uc_MakeClaim_lblMessage')?.textContent?.replace(/\s+/g,' ').trim() || '',
  primaryText: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosis')?.value || '',
  primaryCode: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosisCode')?.value || '',
  primaryId: document.querySelector('#ctl00_MainContent_uc_MakeClaim_hfPrimaryDiagnosisID')?.value || '',
  feeType: document.querySelector('#ctl00_MainContent_uc_MakeClaim_ddlFeeType')?.value || '',
  fee: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtFeeAmount')?.value || '',
  calcRowHtml: document.querySelector('#ctl00_MainContent_uc_MakeClaim_trCalculateButton')?.outerHTML || null,
  buttons: Array.from(document.querySelectorAll('input[type="submit"],input[type="button"],button')).map(el=>({id:el.id||'',name:el.name||'',value:el.value||'',text:(el.textContent||'').trim(),visible:!!(el.offsetParent||el.getClientRects().length)})),
}));

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const s=await auto.searchMemberByNric(visit.nric, visit.visit_date);
  if(!s?.found) throw new Error('not found');
  try { await auto.selectMemberAndAdd(); } catch {}
  await page.waitForTimeout(1800);
  const p = pop[pop.length-1]; if(!p) throw new Error('no popup');
  await p.waitForLoadState('domcontentloaded').catch(()=>{});
  await p.bringToFront().catch(()=>{});

  await p.locator('#ctl00_MainContent_uc_MakeClaim_txtVisitDate').fill(fmt(visit.visit_date)).catch(()=>{});
  await p.locator('#ctl00_MainContent_uc_MakeClaim_ddlMcDay').selectOption({value:'0'}).catch(()=>{});
  await p.locator('#ctl00_MainContent_uc_MakeClaim_txtMcDays').fill('0').catch(()=>{});
  await p.locator('#ctl00_MainContent_uc_MakeClaim_ddlMcReasons').selectOption({label:'Pain - Severe'}).catch(()=>{});

  await p.evaluate(()=>{
    const a=Array.from(document.querySelectorAll('a')).find(el=>(el.getAttribute('title')||'').toLowerCase().includes('primary diagnosis'));
    if(a) a.click();
  });
  await p.waitForTimeout(900);

  const frame = await (await p.waitForSelector('#TB_iframeContent',{timeout:8000})).contentFrame();
  await frame.fill('#ctl00_PopupPageContent_txtSearchContent','pain').catch(()=>{});
  await frame.click('#ctl00_PopupPageContent_btnSearch').catch(()=>{});
  await p.waitForTimeout(900);

  // Prefer explicit "Pain, not elsewhere classified" (R52)
  const target = await frame.$('a[href*="lbtnPrimaryDiagnosis"]:has-text("Pain, not elsewhere classified")');
  if (target) {
    await target.click().catch(async()=>target.click({force:true}));
  } else {
    const first = await frame.$('a[href*="lbtnPrimaryDiagnosis"]');
    if (first) await first.click().catch(async()=>first.click({force:true}));
  }
  await p.waitForTimeout(1600);

  console.log('[probe] after diagnosis', JSON.stringify(await dumpState(p), null, 2));

  for (const feeType of ['followup_consultationfee','consultationfee','no_consultation_fee']) {
    await p.selectOption('#ctl00_MainContent_uc_MakeClaim_ddlFeeType', { value: feeType }).catch(()=>{});
    await p.waitForLoadState('domcontentloaded').catch(()=>{});
    await p.waitForTimeout(1200);
    await p.fill('#ctl00_MainContent_uc_MakeClaim_txtFeeAmount', feeType === 'no_consultation_fee' ? '0.00' : '38.00').catch(()=>{});
    await p.waitForTimeout(600);
    console.log('[probe] after feeType', feeType, JSON.stringify(await dumpState(p), null, 2));
  }

  await p.screenshot({path:'/Users/vincent/Baselrpacrm/screenshots/ge-popup-valid-diag-controls.png', fullPage:true}).catch(()=>{});
} catch (e) {
  console.error('[probe] fatal', e?.stack || String(e));
} finally {
  await bm.close().catch(()=>{});
}
