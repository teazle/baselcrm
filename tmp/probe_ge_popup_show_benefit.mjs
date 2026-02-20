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
  if (!search?.found) throw new Error('member_not_found');
  try { await auto.selectMemberAndAdd(); } catch {}
  await page.waitForTimeout(2000);
  const popup = popupPages[popupPages.length - 1];
  if (!popup) throw new Error('no_popup');
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  await popup.bringToFront().catch(() => {});
  await popup.waitForTimeout(1000);

  const safeFill = async (selector, value) => {
    const loc = popup.locator(selector).first();
    const count = await loc.count().catch(() => 0);
    if (!count) return false;
    await loc.click({ timeout: 5000 }).catch(() => {});
    await loc.fill(String(value));
    return true;
  };

  const safeSelect = async (selector, labels = []) => {
    const loc = popup.locator(selector).first();
    const count = await loc.count().catch(() => 0);
    if (!count) return false;
    for (const label of labels) {
      try { await loc.selectOption({ label }); return true; } catch {}
      try { await loc.selectOption({ value: label }); return true; } catch {}
    }
    return false;
  };

  await safeFill('#ctl00_MainContent_uc_MakeClaim_txtVisitDate', isoToDdMmYyyy(visit.visit_date));
  await safeSelect('#ctl00_MainContent_uc_MakeClaim_ddlMcDay', ['0', '0.0']);
  await safeSelect('#ctl00_MainContent_uc_MakeClaim_ddlMcReasons', ['Fever', 'Flu', 'Pain-unspecified']);
  await safeFill('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosis', 'Fever');
  await safeFill('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosisCode', 'R50.9');
  await safeSelect('#ctl00_MainContent_uc_MakeClaim_ddlFeeType', ['followup_consultationfee', 'Follow-up Consultation', 'consultationfee']);
  await safeFill('#ctl00_MainContent_uc_MakeClaim_txtFeeAmount', '38.00');
  await safeFill('#ctl00_MainContent_uc_MakeClaim_txtClaimRemarks', 'Medication and rest');

  const showBtn = popup.locator('input[type="button"][value="Show Benefit"], button:has-text("Show Benefit")').first();
  if (await showBtn.count().catch(() => 0)) {
    await showBtn.click({ timeout: 5000 }).catch(async () => showBtn.click({ force: true }));
    await popup.waitForTimeout(1500);
    // Attempt to close thickbox/modal if opened.
    const closeCandidates = [
      'a#TB_closeWindowButton',
      'a.tb-close',
      'a#TB_closeAjaxWindow',
      '.tb-close a',
      '#TB_window .tb-close',
      'a:has-text("Close")',
      'button:has-text("Close")',
    ];
    for (const sel of closeCandidates) {
      const loc = popup.locator(sel).first();
      const cnt = await loc.count().catch(() => 0);
      if (!cnt) continue;
      await loc.click({ timeout: 3000 }).catch(() => {});
      await popup.waitForTimeout(1000);
    }
  }

  await popup.waitForTimeout(2000);
  const html = await popup.content();
  await import('fs').then(fs => fs.writeFileSync('/Users/vincent/Baselrpacrm/tmp/ge_popup_after_show_benefit.html', html));
  const buttons = await popup.evaluate(() => Array.from(document.querySelectorAll('button,input[type="button"],input[type="submit"],input[type="image"]')).map(el => ({
    id: el.id || null,
    name: el.name || null,
    type: el.type || null,
    value: el.value || null,
    text: (el.textContent || '').trim() || null,
    visible: !!(el.offsetParent || el.getClientRects().length),
    disabled: !!el.disabled,
  })));
  await import('fs').then(fs => fs.writeFileSync('/Users/vincent/Baselrpacrm/tmp/ge_popup_after_show_benefit_buttons.json', JSON.stringify(buttons, null, 2)));

  await popup.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-popup-after-show-benefit.png', fullPage: true }).catch(() => {});
} catch (e) {
  console.error('[probe] fatal', e?.stack || String(e));
  await page.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-popup-show-benefit-error.png', fullPage: true }).catch(() => {});
} finally {
  await bm.close().catch(() => {});
}
