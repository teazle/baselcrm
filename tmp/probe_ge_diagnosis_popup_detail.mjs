import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

dotenv.config();

const visit = {
  nric: process.env.GE_PROBE_NRIC || 'T0801699I',
  visit_date: process.env.GE_PROBE_VISIT_DATE || '2026-02-13',
};

const isoToDdMmYyyy = iso => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}-${m[2]}-${m[1]}`;
};

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);
const popupPages = [];
page.context().on('page', popup => popupPages.push(popup));

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const search = await auto.searchMemberByNric(visit.nric, visit.visit_date);
  console.log('[probe] search', search);
  if (!search?.found) throw new Error('member_not_found');
  try {
    await auto.selectMemberAndAdd();
  } catch (e) {
    console.log('[probe] add redirect msg', e?.message || String(e));
  }

  await page.waitForTimeout(1800);
  const popup = popupPages[popupPages.length - 1];
  if (!popup) throw new Error('no_popup');
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  await popup.bringToFront().catch(() => {});
  await popup.waitForTimeout(800);

  const safe = async (fn) => { try { return await fn(); } catch { return null; } };

  // Minimal required base fill
  await popup.locator('#ctl00_MainContent_uc_MakeClaim_txtVisitDate').first().fill(isoToDdMmYyyy(visit.visit_date)).catch(() => {});
  await popup.locator('#ctl00_MainContent_uc_MakeClaim_ddlMcDay').first().selectOption({ value: '0' }).catch(() => {});
  await popup.locator('#ctl00_MainContent_uc_MakeClaim_ddlMcReasons').first().selectOption({ label: 'Backache' }).catch(() => {});
  await popup.locator('#ctl00_MainContent_uc_MakeClaim_ddlFeeType').first().selectOption({ value: 'followup_consultationfee' }).catch(() => {});
  await popup.locator('#ctl00_MainContent_uc_MakeClaim_txtFeeAmount').first().fill('38.00').catch(() => {});

  const openDiagnosis = async () => {
    const opened = await popup.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a')).find(el => (el.getAttribute('title') || '').toLowerCase().includes('primary diagnosis'));
      if (!a) return false;
      a.click();
      return true;
    }).catch(() => false);
    return opened;
  };

  await openDiagnosis();
  await popup.waitForTimeout(1200);

  const frame = popup.frameLocator('#TB_iframeContent');
  await frame.locator('body').first().waitFor({ timeout: 8000 }).catch(() => {});

  const beforeLinks = await safe(async () => {
    const loc = frame.locator('a[href*="lbtnPrimaryDiagnosis"]');
    const count = await loc.count();
    const rows = [];
    for (let i = 0; i < Math.min(count, 12); i++) {
      const link = loc.nth(i);
      rows.push({
        i,
        text: String(await link.innerText().catch(() => '')).trim(),
        href: await link.getAttribute('href').catch(() => ''),
        onclick: await link.getAttribute('onclick').catch(() => ''),
      });
    }
    return { count, rows };
  });
  console.log('[probe] before links', JSON.stringify(beforeLinks, null, 2));

  // Search by text "back"
  await frame.locator('#ctl00_PopupPageContent_txtSearchContent').first().fill('back').catch(() => {});
  await frame.locator('#ctl00_PopupPageContent_btnSearch').first().click({ timeout: 5000 }).catch(() => {});
  await popup.waitForTimeout(1200);

  const afterSearchLinks = await safe(async () => {
    const loc = frame.locator('a[href*="lbtnPrimaryDiagnosis"]');
    const count = await loc.count();
    const rows = [];
    for (let i = 0; i < Math.min(count, 15); i++) {
      const link = loc.nth(i);
      rows.push({
        i,
        text: String(await link.innerText().catch(() => '')).trim(),
        href: await link.getAttribute('href').catch(() => ''),
      });
    }
    return { count, rows };
  });
  console.log('[probe] after search links', JSON.stringify(afterSearchLinks, null, 2));

  let clicked = null;
  const candidates = ['Lower back pain', 'Back pain', 'Backache'];
  for (const cand of candidates) {
    const link = frame.locator('a[href*="lbtnPrimaryDiagnosis"]').filter({ hasText: new RegExp(cand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first();
    if ((await link.count().catch(() => 0)) > 0) {
      await link.click({ timeout: 5000 }).catch(async () => link.click({ force: true }));
      clicked = cand;
      break;
    }
  }
  if (!clicked) {
    const first = frame.locator('a[href*="lbtnPrimaryDiagnosis"]').first();
    if ((await first.count().catch(() => 0)) > 0) {
      clicked = String(await first.innerText().catch(() => '')).trim() || 'first';
      await first.click({ timeout: 5000 }).catch(async () => first.click({ force: true }));
    }
  }
  console.log('[probe] clicked', clicked);

  await popup.waitForTimeout(1800);
  // Wait for thickbox to close if it closes.
  await popup.waitForSelector('#TB_iframeContent', { state: 'detached', timeout: 5000 }).catch(() => {});

  const state = await popup.evaluate(() => ({
    msg: document.querySelector('#ctl00_MainContent_uc_MakeClaim_lblMessage')?.textContent?.replace(/\s+/g, ' ').trim() || null,
    primaryCode: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosisCode')?.value || '',
    primaryText: document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosis')?.value || '',
    primaryId: document.querySelector('#ctl00_MainContent_uc_MakeClaim_hfPrimaryDiagnosisID')?.value || '',
    feeType: document.querySelector('#ctl00_MainContent_uc_MakeClaim_ddlFeeType')?.value || '',
    mcReason: document.querySelector('#ctl00_MainContent_uc_MakeClaim_ddlMcReasons')?.value || '',
    buttons: Array.from(document.querySelectorAll('input[type="submit"],input[type="button"],button')).map(el => ({
      id: el.id || null,
      value: el.value || null,
      text: (el.textContent || '').trim() || null,
      visible: !!(el.offsetParent || el.getClientRects().length),
    })),
  }));

  console.log('[probe] final state', JSON.stringify(state, null, 2));

  await popup.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-popup-dx-probe-final.png', fullPage: true }).catch(() => {});

} catch (e) {
  console.error('[probe] fatal', e?.stack || String(e));
  await page.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-popup-dx-probe-fatal.png', fullPage: true }).catch(() => {});
} finally {
  await bm.close().catch(() => {});
}
