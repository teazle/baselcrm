import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

const visit = { nric: process.env.GE_PROBE_NRIC || 'T0801699I', visit_date: process.env.GE_PROBE_VISIT_DATE || '2026-02-13' };
const fmt = s => { const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m?`${m[3]}-${m[2]}-${m[1]}`:s; };

const bm = new BrowserManager(); await bm.init();
const page = await bm.newPage(); const auto = new AllianceMedinetAutomation(page); const pop=[]; page.context().on('page',p=>pop.push(p));

const getState = async p => p.evaluate(() => ({
  msg: document.querySelector('#ctl00_MainContent_uc_MakeClaim_lblMessage')?.textContent?.replace(/\s+/g,' ').trim() || '',
  primaryText: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosis')?.value || '',
  primaryCode: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosisCode')?.value || '',
  primaryId: document.querySelector('#ctl00_MainContent_uc_MakeClaim_hfPrimaryDiagnosisID')?.value || '',
  feeType: document.querySelector('#ctl00_MainContent_uc_MakeClaim_ddlFeeType')?.value || '',
  fee: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtFeeAmount')?.value || '',
  calcRowText: document.querySelector('#ctl00_MainContent_uc_MakeClaim_trCalculateButton')?.innerText?.replace(/\s+/g,' ').trim() || '',
  buttons: Array.from(document.querySelectorAll('input[type="submit"],input[type="button"],button')).map(el=>({id:el.id||'',name:el.name||'',value:el.value||'',text:(el.textContent||'').trim(),visible:!!(el.offsetParent||el.getClientRects().length)})),
}));

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const search = await auto.searchMemberByNric(visit.nric, visit.visit_date);
  if (!search?.found) throw new Error('not found');
  try { await auto.selectMemberAndAdd(); } catch {}
  await page.waitForTimeout(1800);
  const p = pop[pop.length - 1]; if (!p) throw new Error('no popup');
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  await p.bringToFront().catch(() => {});

  await p.locator('#ctl00_MainContent_uc_MakeClaim_txtVisitDate').fill(fmt(visit.visit_date)).catch(() => {});
  await p.locator('#ctl00_MainContent_uc_MakeClaim_ddlMcDay').selectOption({ value: '0' }).catch(() => {});
  await p.locator('#ctl00_MainContent_uc_MakeClaim_txtMcDays').fill('0').catch(() => {});
  await p.locator('#ctl00_MainContent_uc_MakeClaim_ddlMcReasons').selectOption({ label: 'Backache' }).catch(() => {});

  await p.evaluate(() => {
    const link = Array.from(document.querySelectorAll('a')).find(a => (a.getAttribute('title') || '').toLowerCase().includes('primary diagnosis'));
    if (link) link.click();
  }).catch(() => {});
  await p.waitForTimeout(1000);

  const frame = p.frameLocator('#TB_iframeContent');
  await frame.locator('#ctl00_PopupPageContent_txtSearchContent').first().fill('back').catch(() => {});
  await frame.locator('#ctl00_PopupPageContent_btnSearch').first().click().catch(() => {});
  await p.waitForTimeout(1200);

  const links = frame.locator('a[href*="lbtnPrimaryDiagnosis"]');
  const linkCount = await links.count().catch(() => 0);
  if (linkCount > 0) {
    await links.first().click({ timeout: 8000 }).catch(async () => links.first().click({ force: true }));
  }
  await p.waitForTimeout(1800);

  const stateAfterDx = await getState(p);
  console.log('[probe] stateAfterDx', JSON.stringify(stateAfterDx, null, 2));

  await p.locator('#ctl00_MainContent_uc_MakeClaim_ddlFeeType').selectOption({ value: 'followup_consultationfee' }).catch(() => {});
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  await p.waitForTimeout(1000);

  await p.locator('#ctl00_MainContent_uc_MakeClaim_txtFeeAmount').fill('38.00').catch(() => {});
  await p.waitForTimeout(600);

  const stateAfterFee = await getState(p);
  console.log('[probe] stateAfterFee', JSON.stringify(stateAfterFee, null, 2));

  await p.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-popup-after-dx-fee-probe.png', fullPage: true }).catch(() => {});
} catch (e) {
  console.error('[probe] fatal', e?.stack || String(e));
} finally {
  await bm.close().catch(() => {});
}
