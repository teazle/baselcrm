import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

const visit = { nric: process.env.GE_PROBE_NRIC || 'T0801699I', visit_date: process.env.GE_PROBE_VISIT_DATE || '2026-02-13' };
const iso = s => { const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m?`${m[3]}-${m[2]}-${m[1]}`:s; };

const bm = new BrowserManager(); await bm.init();
const page = await bm.newPage(); const auto = new AllianceMedinetAutomation(page); const pop=[]; page.context().on('page',p=>pop.push(p));

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const search = await auto.searchMemberByNric(visit.nric, visit.visit_date);
  if(!search?.found) throw new Error('not found');
  try { await auto.selectMemberAndAdd(); } catch {}
  await page.waitForTimeout(1800);
  const p = pop[pop.length-1]; if(!p) throw new Error('no popup');
  await p.waitForLoadState('domcontentloaded').catch(()=>{});
  await p.bringToFront().catch(()=>{});
  await p.locator('#ctl00_MainContent_uc_MakeClaim_txtVisitDate').fill(iso(visit.visit_date)).catch(()=>{});
  await p.locator('#ctl00_MainContent_uc_MakeClaim_ddlMcDay').selectOption({value:'0'}).catch(()=>{});
  await p.locator('#ctl00_MainContent_uc_MakeClaim_ddlMcReasons').selectOption({label:'Backache'}).catch(()=>{});
  await p.waitForTimeout(300);
  await p.evaluate(()=>{
    const a = Array.from(document.querySelectorAll('a')).find(el => (el.getAttribute('title')||'').toLowerCase().includes('primary diagnosis'));
    if (a) a.click();
  });
  const frame = p.frameLocator('#TB_iframeContent');
  await frame.locator('#ctl00_PopupPageContent_txtSearchContent').fill('back pain').catch(()=>{});
  await frame.locator('#ctl00_PopupPageContent_btnSearch').click().catch(()=>{});
  await p.waitForTimeout(900);
  const first = frame.locator('a[href*="lbtnPrimaryDiagnosis"]').first();
  await first.click({timeout:5000}).catch(async()=>first.click({force:true}));
  await p.waitForTimeout(1500);

  const afterDx = await p.evaluate(()=>({
    msg: document.querySelector('#ctl00_MainContent_uc_MakeClaim_lblMessage')?.textContent?.replace(/\s+/g,' ').trim() || '',
    primaryId: document.querySelector('#ctl00_MainContent_uc_MakeClaim_hfPrimaryDiagnosisID')?.value || '',
    feeType: document.querySelector('#ctl00_MainContent_uc_MakeClaim_ddlFeeType')?.value || '',
    calcRow: document.querySelector('#ctl00_MainContent_uc_MakeClaim_trCalculateButton')?.innerText?.replace(/\s+/g,' ').trim() || '',
  }));
  console.log('[probe] afterDx', afterDx);

  // Re-apply fee type and fee after diagnosis reload.
  await p.locator('#ctl00_MainContent_uc_MakeClaim_ddlFeeType').selectOption({value:'followup_consultationfee'}).catch(()=>{});
  await p.waitForLoadState('domcontentloaded').catch(()=>{});
  await p.waitForTimeout(1200);
  await p.locator('#ctl00_MainContent_uc_MakeClaim_txtFeeAmount').fill('38.00').catch(()=>{});
  await p.waitForTimeout(600);

  const afterFee = await p.evaluate(()=>({
    msg: document.querySelector('#ctl00_MainContent_uc_MakeClaim_lblMessage')?.textContent?.replace(/\s+/g,' ').trim() || '',
    primaryText: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosis')?.value || '',
    primaryCode: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosisCode')?.value || '',
    primaryId: document.querySelector('#ctl00_MainContent_uc_MakeClaim_hfPrimaryDiagnosisID')?.value || '',
    feeType: document.querySelector('#ctl00_MainContent_uc_MakeClaim_ddlFeeType')?.value || '',
    fee: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtFeeAmount')?.value || '',
    calcRowHtml: document.querySelector('#ctl00_MainContent_uc_MakeClaim_trCalculateButton')?.outerHTML || null,
    buttons: Array.from(document.querySelectorAll('input[type="submit"],input[type="button"],button')).map(el=>({id:el.id||'',name:el.name||'',value:el.value||'',text:(el.textContent||'').trim(),visible:!!(el.offsetParent||el.getClientRects().length)})),
  }));
  console.log('[probe] afterFee', JSON.stringify(afterFee,null,2));

  await p.screenshot({path:'/Users/vincent/Baselrpacrm/screenshots/ge-popup-after-fee-probe.png', fullPage:true}).catch(()=>{});
} catch (e) {
  console.error('[probe] fatal', e?.stack || String(e));
} finally {
  await bm.close().catch(()=>{});
}
