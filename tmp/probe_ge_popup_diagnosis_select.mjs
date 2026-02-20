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
  await safeSelect('#ctl00_MainContent_uc_MakeClaim_ddlFeeType', ['followup_consultationfee', 'Follow-up Consultation', 'consultationfee']);
  await safeFill('#ctl00_MainContent_uc_MakeClaim_txtFeeAmount', '38.00');

  // Open primary diagnosis search popup (thickbox)
  const diagLink = popup.locator('a[title="Primary Diagnosis"], a[title*="Diagnosis" i]').first();
  if (await diagLink.count().catch(() => 0)) {
    await diagLink.click({ timeout: 5000 }).catch(async () => {
      await diagLink.click({ force: true });
    }).catch(async () => {
      await popup.evaluate(() => {
        const el = document.querySelector('a[title="Primary Diagnosis"]') || document.querySelector('a[title*="Diagnosis"]');
        if (el) el.click();
      });
    });
    await popup.waitForTimeout(1500);

    const iframe = popup.frameLocator('#TB_iframeContent');
    const iframeBody = iframe.locator('body').first();
    await iframeBody.waitFor({ timeout: 10000 }).catch(() => {});

    await popup.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-popup-dx-iframe.png', fullPage: true }).catch(() => {});

    // Try to search for fever in iframe
    const searchInput = iframe.locator('input[type="text"]').first();
    if (await searchInput.count().catch(() => 0)) {
      await searchInput.fill('fever').catch(() => {});
    }
    const searchBtn = iframe.locator('input[type="submit"],button:has-text("Search"),input[value="Search"]').first();
    if (await searchBtn.count().catch(() => 0)) {
      await searchBtn.click({ timeout: 5000 }).catch(() => {});
      await popup.waitForTimeout(1500);
    }

    // Select first row if any checkbox/radio
    const firstSelectable = iframe.locator('input[type="checkbox"],input[type="radio"]').first();
    if (await firstSelectable.count().catch(() => 0)) {
      await firstSelectable.check({ timeout: 5000 }).catch(async () => firstSelectable.click({ force: true }));
    }

    const selectBtn = iframe.locator('input[type="submit"],button:has-text("Select"),input[value="Select"],button:has-text("Add"),input[value="Add"]').first();
    if (await selectBtn.count().catch(() => 0)) {
      await selectBtn.click({ timeout: 5000 }).catch(() => {});
      await popup.waitForTimeout(1500);
    }

    // Close thickbox if it stays open
    const closeBtn = popup.locator('a#TB_closeWindowButton, a#TB_closeAjaxWindow, a.tb-close, .tb-close a').first();
    if (await closeBtn.count().catch(() => 0)) {
      await closeBtn.click({ timeout: 5000 }).catch(() => {});
    }
  }

  await popup.waitForTimeout(2000);
  const html = await popup.content();
  await import('fs').then(fs => fs.writeFileSync('/Users/vincent/Baselrpacrm/tmp/ge_popup_after_dx_select.html', html));
  const buttons = await popup.evaluate(() => Array.from(document.querySelectorAll('button,input[type="button"],input[type="submit"],input[type="image"]')).map(el => ({
    id: el.id || null,
    name: el.name || null,
    type: el.type || null,
    value: el.value || null,
    text: (el.textContent || '').trim() || null,
    visible: !!(el.offsetParent || el.getClientRects().length),
    disabled: !!el.disabled,
  })));
  await import('fs').then(fs => fs.writeFileSync('/Users/vincent/Baselrpacrm/tmp/ge_popup_after_dx_select_buttons.json', JSON.stringify(buttons, null, 2)));

  await popup.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-popup-after-dx-select.png', fullPage: true }).catch(() => {});
} catch (e) {
  console.error('[probe] fatal', e?.stack || String(e));
  await page.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-popup-dx-select-error.png', fullPage: true }).catch(() => {});
} finally {
  await bm.close().catch(() => {});
}
