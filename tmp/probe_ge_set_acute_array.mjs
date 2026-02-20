import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

const bm=new BrowserManager(); await bm.init();
const page=await bm.newPage(); const auto=new AllianceMedinetAutomation(page); const pop=[]; page.context().on('page',p=>pop.push(p));
const nric=process.env.GE_PROBE_NRIC||'T0801699I'; const date=process.env.GE_PROBE_VISIT_DATE||'2026-02-13';
const fmt=s=>{const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m?`${m[3]}-${m[2]}-${m[1]}`:s;};
const get=async p=>p.evaluate(()=>({
 msg:document.querySelector('#ctl00_MainContent_uc_MakeClaim_lblMessage')?.textContent?.replace(/\s+/g,' ').trim()||'',
 code:document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosisCode')?.value||'',
 text:document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosis')?.value||'',
 id:document.querySelector('#ctl00_MainContent_uc_MakeClaim_hfPrimaryDiagnosisID')?.value||'',
 arr:document.querySelector('#ctl00_MainContent_uc_MakeClaim_hfAcute1Array')?.value||'',
 feeType:document.querySelector('#ctl00_MainContent_uc_MakeClaim_ddlFeeType')?.value||'',
 row:document.querySelector('#ctl00_MainContent_uc_MakeClaim_trCalculateButton')?.innerText?.replace(/\s+/g,' ').trim()||'',
 buttons:Array.from(document.querySelectorAll('input[type="submit"],input[type="button"],button')).map(el=>({id:el.id||'',v:el.value||'',vis:!!(el.offsetParent||el.getClientRects().length)})),
}));

try{
 await auto.login(); await auto.navigateToMedicalTreatmentClaim(); const f=await auto.searchMemberByNric(nric,date); if(!f?.found) throw new Error('not found');
 try{await auto.selectMemberAndAdd();}catch{}
 await page.waitForTimeout(1600);
 const p=pop[pop.length-1]; if(!p) throw new Error('no popup');
 await p.waitForLoadState('domcontentloaded').catch(()=>{});
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
 let code='R52', text='Pain, not elsewhere classified';
 if(row){ code=await row.$eval('td:nth-child(1)',el=>(el.textContent||'').trim()).catch(()=>code); text=await row.$eval('a[href*="lbtnPrimaryDiagnosis"]',el=>(el.textContent||'').trim()).catch(()=>text); const link=await row.$('a[href*="lbtnPrimaryDiagnosis"]'); if(link) await link.click().catch(async()=>link.click({force:true})); }
 await p.waitForTimeout(1300);
 await p.evaluate(({code,text})=>{
  const set=(sel,val)=>{const el=document.querySelector(sel); if(el){el.value=val; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));}}
  set('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosisCode', code);
  set('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosis', text);
  set('#ctl00_MainContent_uc_MakeClaim_hfPrimaryDiagnosisCode', code);
  set('#ctl00_MainContent_uc_MakeClaim_hfAcute1Array', JSON.stringify([{label:text,val:code}]));
 }, {code,text});
 await p.waitForTimeout(400);
 console.log('[probe] after-set', JSON.stringify(await get(p),null,2));

 await p.selectOption('#ctl00_MainContent_uc_MakeClaim_ddlFeeType',{value:'consultationfee'}).catch(()=>{});
 await p.waitForLoadState('domcontentloaded').catch(()=>{});
 await p.waitForTimeout(1000);
 await p.fill('#ctl00_MainContent_uc_MakeClaim_txtFeeAmount','38.00').catch(()=>{});
 await p.waitForTimeout(500);
 console.log('[probe] after-fee', JSON.stringify(await get(p),null,2));
 await p.screenshot({path:'/Users/vincent/Baselrpacrm/screenshots/ge-popup-set-acute-array.png',fullPage:true}).catch(()=>{});
}catch(e){ console.error('[probe] fatal', e?.stack||String(e)); }
finally{ await bm.close().catch(()=>{}); }
