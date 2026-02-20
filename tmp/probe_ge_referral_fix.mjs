import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

const bm=new BrowserManager(); await bm.init();
const page=await bm.newPage(); const auto=new AllianceMedinetAutomation(page); const pop=[]; page.context().on('page',p=>pop.push(p));
const nric=process.env.GE_PROBE_NRIC||'T0801699I'; const date=process.env.GE_PROBE_VISIT_DATE||'2026-02-13'; const ref=process.env.GE_REFERRING_GP_CLINIC||'SINGAPORE SPORTS';
const fmt=s=>{const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m?`${m[3]}-${m[2]}-${m[1]}`:s;};
const get=async p=>p.evaluate(()=>({
 msg:document.querySelector('#ctl00_MainContent_uc_MakeClaim_lblMessage')?.textContent?.replace(/\s+/g,' ').trim()||'',
 refTxt:document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic')?.value||'',
 hfParent:(document.querySelector('input[id$="hfParentClinicID"]')||{}).value||'',
 feeType:document.querySelector('#ctl00_MainContent_uc_MakeClaim_ddlFeeType')?.value||'',
 btns:Array.from(document.querySelectorAll('input[type="submit"],input[type="button"],button')).map(el=>({id:el.id||'',v:el.value||'',vis:!!(el.offsetParent||el.getClientRects().length)})),
}));

try{
 await auto.login(); await auto.navigateToMedicalTreatmentClaim(); const f=await auto.searchMemberByNric(nric,date); if(!f?.found) throw new Error('not found');
 try{await auto.selectMemberAndAdd();}catch{}
 await page.waitForTimeout(1400);
 const p=pop[pop.length-1]; if(!p) throw new Error('no popup');
 await p.waitForLoadState('domcontentloaded').catch(()=>{});

 // Setup as valid to show calculate
 await p.fill('#ctl00_MainContent_uc_MakeClaim_txtVisitDate',fmt(date)).catch(()=>{});
 await p.selectOption('#ctl00_MainContent_uc_MakeClaim_ddlMcDay',{value:'0'}).catch(()=>{});
 await p.fill('#ctl00_MainContent_uc_MakeClaim_txtMcDays','0').catch(()=>{});
 await p.selectOption('#ctl00_MainContent_uc_MakeClaim_ddlMcReasons',{label:'Pain - Severe'}).catch(()=>{});
 await p.evaluate(()=>{ const a=[...document.querySelectorAll('a')].find(x=>(x.getAttribute('title')||'').toLowerCase().includes('primary diagnosis')); if(a) a.click(); });
 await p.waitForTimeout(900);
 const frame=await (await p.waitForSelector('#TB_iframeContent',{timeout:8000})).contentFrame();
 await frame.fill('#ctl00_PopupPageContent_txtSearchContent','pain').catch(()=>{});
 await frame.click('#ctl00_PopupPageContent_btnSearch').catch(()=>{});
 await p.waitForTimeout(900);
 const row=await frame.$('tr:has(a[href*="lbtnPrimaryDiagnosis"]:text("Pain, not elsewhere classified"))');
 if(row){ const link=await row.$('a[href*="lbtnPrimaryDiagnosis"]'); if(link) await link.click().catch(async()=>link.click({force:true})); }
 await p.waitForTimeout(1300);
 await p.evaluate(()=>{
  const set=(sel,val)=>{const el=document.querySelector(sel); if(el){el.value=val; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));}}
  set('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosisCode', 'R52');
  set('#ctl00_MainContent_uc_MakeClaim_hfPrimaryDiagnosisCode', 'R52');
  set('#ctl00_MainContent_uc_MakeClaim_hfAcute1Array', JSON.stringify([{label:'Pain, not elsewhere classified',val:'R52'}]));
 });
 await p.selectOption('#ctl00_MainContent_uc_MakeClaim_ddlFeeType',{value:'consultationfee'}).catch(()=>{});
 await p.waitForLoadState('domcontentloaded').catch(()=>{});
 await p.waitForTimeout(1000);
 await p.fill('#ctl00_MainContent_uc_MakeClaim_txtFeeAmount','38.00').catch(()=>{});

 const clickCalc = async () => {
  const calc=p.locator('#ctl00_MainContent_uc_MakeClaim_btncalculateclaim,input[value*="Calculate Claim" i]').first();
  if((await calc.count().catch(()=>0))===0) return false;
  await calc.click({timeout:7000}).catch(async()=>calc.click({force:true}));
  await p.waitForLoadState('domcontentloaded').catch(()=>{});
  await p.waitForTimeout(1000);
  return true;
 };

 await clickCalc();
 console.log('[probe] after calc1', JSON.stringify(await get(p),null,2));

 // fill referral
 const refInput=p.locator('#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic').first();
 if((await refInput.count().catch(()=>0))>0){
   await refInput.fill(ref).catch(()=>{});
   await p.waitForTimeout(900);
   const opt=p.locator('ul.ui-autocomplete li, .ui-menu-item').first();
   if((await opt.count().catch(()=>0))>0){
     await opt.click({timeout:4000}).catch(async()=>opt.click({force:true}));
   }
   await p.keyboard.press('Tab').catch(()=>{});
   await p.waitForTimeout(900);
 }
 await p.evaluate(()=>{
   const hf=document.querySelector('input[id$="hfParentClinicID"]');
   const clinic=document.querySelector('#ctl00_MainContent_uc_MakeClaim_hfClinicID');
   if(hf && !hf.value && clinic && clinic.value){ hf.value=clinic.value; }
 }).catch(()=>{});

 console.log('[probe] after referral fill', JSON.stringify(await get(p),null,2));
 await clickCalc();
 console.log('[probe] after calc2', JSON.stringify(await get(p),null,2));
 await p.screenshot({path:'/Users/vincent/Baselrpacrm/screenshots/ge-popup-referral-fix-probe.png',fullPage:true}).catch(()=>{});
}catch(e){ console.error('[probe] fatal', e?.stack||String(e)); }
finally{ await bm.close().catch(()=>{}); }
