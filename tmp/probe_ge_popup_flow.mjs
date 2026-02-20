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

page.context().on('page', popup => {
  popupPages.push(popup);
  console.log('[probe] popup opened', popup.url());
});

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const search = await auto.searchMemberByNric(visit.nric, visit.visit_date);
  console.log('[probe] search result', search);
  if (!search?.found) throw new Error('member_not_found');

  try {
    await auto.selectMemberAndAdd();
  } catch (e) {
    console.log('[probe] selectMemberAndAdd threw:', e?.message || String(e));
  }

  await page.waitForTimeout(2500);
  const popup = popupPages[popupPages.length - 1];
  if (!popup) throw new Error('no_popup_captured');

  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  await popup.bringToFront().catch(() => {});
  await popup.waitForTimeout(1500);

  console.log('[probe] popup url', popup.url());

  await popup.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-popup-before-fill.png', fullPage: true }).catch(() => {});

  const before = await popup.evaluate(() => {
    const get = sel => document.querySelector(sel);
    const calcRow = get('#ctl00_MainContent_uc_MakeClaim_trCalculateButton');
    const form = document.querySelector('form');
    const buttons = Array.from(document.querySelectorAll('button,input[type="button"],input[type="submit"],input[type="image"]')).map(el => ({
      tag: el.tagName,
      id: el.id || null,
      name: el.name || null,
      type: el.type || null,
      value: el.value || null,
      text: (el.textContent || '').trim() || null,
      visible: !!(el.offsetParent || el.getClientRects().length),
      style: window.getComputedStyle(el).cssText || null,
      cls: el.className || null,
    }));
    return {
      title: document.title,
      calcRowHtml: calcRow ? calcRow.outerHTML : null,
      formAction: form?.getAttribute('action') || null,
      formMethod: form?.getAttribute('method') || null,
      buttonCount: buttons.length,
      buttons,
    };
  });

  console.log('[probe] before summary', JSON.stringify({
    title: before.title,
    formAction: before.formAction,
    formMethod: before.formMethod,
    buttonCount: before.buttonCount,
    buttons: before.buttons.map(b => ({ id: b.id, name: b.name, type: b.type, value: b.value, text: b.text, visible: b.visible })),
  }, null, 2));

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
      try {
        await loc.selectOption({ label });
        return true;
      } catch {}
      try {
        await loc.selectOption({ value: label });
        return true;
      } catch {}
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

  await popup.waitForTimeout(1500);

  const afterFill = await popup.evaluate(() => {
    const getVal = sel => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return 'value' in el ? el.value : el.textContent;
    };
    const buttons = Array.from(document.querySelectorAll('button,input[type="button"],input[type="submit"],input[type="image"]')).map(el => ({
      tag: el.tagName,
      id: el.id || null,
      name: el.name || null,
      type: el.type || null,
      value: el.value || null,
      text: (el.textContent || '').trim() || null,
      visible: !!(el.offsetParent || el.getClientRects().length),
      disabled: !!el.disabled,
      title: el.getAttribute('title') || null,
      onclick: el.getAttribute('onclick') || null,
    }));

    const alerts = Array.from(document.querySelectorAll('.alert,.error,.validation-summary-errors,span[style*="color:red"],font[color="red"]'))
      .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 20);

    return {
      values: {
        visitDate: getVal('#ctl00_MainContent_uc_MakeClaim_txtVisitDate'),
        mcDay: getVal('#ctl00_MainContent_uc_MakeClaim_ddlMcDay'),
        mcReason: getVal('#ctl00_MainContent_uc_MakeClaim_ddlMcReasons'),
        diagnosisCode: getVal('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosisCode'),
        diagnosisDesc: getVal('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosis'),
        feeType: getVal('#ctl00_MainContent_uc_MakeClaim_ddlFeeType'),
        fee: getVal('#ctl00_MainContent_uc_MakeClaim_txtFeeAmount'),
      },
      buttons,
      alerts,
      calcRowHtml: document.querySelector('#ctl00_MainContent_uc_MakeClaim_trCalculateButton')?.outerHTML || null,
      formText: (document.body?.innerText || '').slice(0, 2400),
    };
  });

  console.log('[probe] after fill', JSON.stringify({
    values: afterFill.values,
    alerts: afterFill.alerts,
    buttons: afterFill.buttons.map(b => ({ id: b.id, name: b.name, type: b.type, value: b.value, text: b.text, visible: b.visible, disabled: b.disabled, onclick: b.onclick })),
  }, null, 2));

  const buttonCandidates = afterFill.buttons.filter(b => {
    const blob = `${b.id || ''} ${b.name || ''} ${b.value || ''} ${b.text || ''} ${b.onclick || ''}`.toLowerCase();
    if (blob.includes('cancel') || blob.includes('reload')) return false;
    return /save|draft|submit|calculate|claim|benefit|next|continue/.test(blob);
  });
  console.log('[probe] button candidates', JSON.stringify(buttonCandidates, null, 2));

  await popup.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-popup-after-fill.png', fullPage: true }).catch(() => {});

  // Dump full page HTML for implementation debugging.
  const html = await popup.content();
  await import('fs').then(fs => fs.writeFileSync('/Users/vincent/Baselrpacrm/tmp/ge_popup_after_fill.html', html));

  await import('fs').then(fs => fs.writeFileSync('/Users/vincent/Baselrpacrm/tmp/ge_popup_probe_result.json', JSON.stringify({ before, afterFill, buttonCandidates }, null, 2)));
  console.log('[probe] wrote /tmp/ge_popup_probe_result.json and /tmp/ge_popup_after_fill.html');
} catch (error) {
  console.error('[probe] fatal', error?.stack || String(error));
  await page.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-popup-probe-fatal-main.png', fullPage: true }).catch(() => {});
} finally {
  await bm.close().catch(() => {});
}
