import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);
const popups = [];
page.context().on('page', p => popups.push(p));

const nric = process.env.GE_PROBE_NRIC || 'T0801699I';
const date = process.env.GE_PROBE_VISIT_DATE || '2026-02-13';
const fmt = s => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
};

const state = async p =>
  p.evaluate(() => {
    const get = sel => {
      const el = document.querySelector(sel);
      return el ? String(el.value || '').trim() : '';
    };
    const msg =
      document.querySelector('#ctl00_MainContent_uc_MakeClaim_lblMessage')?.textContent?.replace(/\s+/g, ' ').trim() ||
      '';
    const hasSave = Array.from(document.querySelectorAll('input[type="submit"],input[type="button"],button')).some(el => {
      const blob = `${el.id || ''} ${el.value || ''} ${el.textContent || ''}`.toLowerCase();
      return blob.includes('save') && !blob.includes('reload') && !blob.includes('calculate');
    });
    return {
      msg,
      hasSave,
      refValue: get('#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic'),
      refType: get('#ctl00_MainContent_uc_MakeClaim_hfReferenceClinicType'),
      oldRefType: get('#ctl00_MainContent_uc_MakeClaim_hfOldReferenceClinicType'),
      clinicId: get('#ctl00_MainContent_uc_MakeClaim_hfClinicID'),
      parentClinicId: get('input[id$="hfParentClinicID"]'),
      mcReason: get('#ctl00_MainContent_uc_MakeClaim_ddlMcReasons'),
      feeType: get('#ctl00_MainContent_uc_MakeClaim_ddlFeeType'),
      feeAmount: get('#ctl00_MainContent_uc_MakeClaim_txtFeeAmount'),
      dxCode: get('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosisCode'),
      dxText: get('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosis'),
      acute1Array: get('#ctl00_MainContent_uc_MakeClaim_hfAcute1Array'),
    };
  });

const setReferral = async (p, patch = {}) => {
  await p
    .evaluate(fields => {
      const set = (sel, val) => {
        const el = document.querySelector(sel);
        if (!el) return;
        el.value = String(val ?? '');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      for (const [sel, val] of Object.entries(fields || {})) set(sel, val);
    }, patch)
    .catch(() => {});
};

const clickCalculate = async p => {
  const calc = p.locator('#ctl00_MainContent_uc_MakeClaim_btncalculateclaim').first();
  if ((await calc.count().catch(() => 0)) === 0) return false;
  await calc.click({ timeout: 6000 }).catch(async () => calc.click({ timeout: 6000, force: true }));
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  await p.waitForTimeout(1000);
  return true;
};

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const found = await auto.searchMemberByNric(nric, date);
  if (!found?.found) throw new Error('member_not_found');
  try {
    await auto.selectMemberAndAdd();
  } catch {}

  const p = popups[popups.length - 1];
  if (!p) throw new Error('ge_popup_missing');
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  await p.bringToFront().catch(() => {});
  await p.waitForTimeout(1000);

  await p.fill('#ctl00_MainContent_uc_MakeClaim_txtVisitDate', fmt(date)).catch(() => {});
  await p.selectOption('#ctl00_MainContent_uc_MakeClaim_ddlMcDay', { value: '0' }).catch(() => {});
  await p.fill('#ctl00_MainContent_uc_MakeClaim_txtMcDays', '0').catch(() => {});
  await p.selectOption('#ctl00_MainContent_uc_MakeClaim_ddlMcReasons', { label: 'Backache' }).catch(() => {});

  await p.evaluate(() => {
    const link = Array.from(document.querySelectorAll('a')).find(a =>
      (a.getAttribute('title') || '').toLowerCase().includes('primary diagnosis')
    );
    if (link) link.click();
  });
  await p.waitForTimeout(900);

  const frame = await (await p.waitForSelector('#TB_iframeContent', { timeout: 8000 })).contentFrame();
  await frame.fill('#ctl00_PopupPageContent_txtSearchContent', 'pain').catch(() => {});
  await frame.click('#ctl00_PopupPageContent_btnSearch').catch(() => {});
  await p.waitForTimeout(900);
  const row = await frame.$('tr:has(a[href*="lbtnPrimaryDiagnosis"]:text("Pain, not elsewhere classified"))');
  let code = 'R52';
  let text = 'Pain, not elsewhere classified';
  if (row) {
    code = await row.$eval('td:nth-child(1)', el => (el.textContent || '').trim()).catch(() => code);
    text = await row.$eval('a[href*="lbtnPrimaryDiagnosis"]', el => (el.textContent || '').trim()).catch(() => text);
    const link = await row.$('a[href*="lbtnPrimaryDiagnosis"]');
    if (link) await link.click().catch(async () => link.click({ force: true }));
  }
  await p.waitForTimeout(1200);

  await p.evaluate(({ code, text }) => {
    const set = (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.value = String(val || '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosisCode', code);
    set('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosis', text);
    set('#ctl00_MainContent_uc_MakeClaim_hfPrimaryDiagnosisCode', code);
    set('#ctl00_MainContent_uc_MakeClaim_hfAcute1Array', JSON.stringify([{ label: text, val: code }]));
  }, { code, text });

  await p.selectOption('#ctl00_MainContent_uc_MakeClaim_ddlFeeType', { value: 'followup_consultationfee' }).catch(() => {});
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  await p.waitForTimeout(600);
  await p.fill('#ctl00_MainContent_uc_MakeClaim_txtFeeAmount', '38.00').catch(() => {});
  await p.fill('#ctl00_MainContent_uc_MakeClaim_txtClaimRemarks', 'SPECIALIST CONSULTATION x1').catch(() => {});
  await p.waitForTimeout(500);

  const baseline = await state(p);
  console.log('[probe] baseline', JSON.stringify(baseline, null, 2));

  const scenarios = [
    {
      name: 'keep_as_is',
      patch: {},
    },
    {
      name: 'set_ref_type_clinic',
      patch: {
        '#ctl00_MainContent_uc_MakeClaim_hfReferenceClinicType': 'Clinic',
        '#ctl00_MainContent_uc_MakeClaim_hfOldReferenceClinicType': 'Clinic',
      },
    },
    {
      name: 'set_ref_type_and_parent',
      patch: {
        '#ctl00_MainContent_uc_MakeClaim_hfReferenceClinicType': 'Clinic',
        '#ctl00_MainContent_uc_MakeClaim_hfOldReferenceClinicType': 'Clinic',
        'input[id$="hfParentClinicID"]': baseline.clinicId || '',
      },
    },
    {
      name: 'set_full_name_ref',
      patch: {
        '#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic': 'SINGAPORE SPORTS & ORTHOPAEDIC CLINIC PTE LTD',
        '#ctl00_MainContent_uc_MakeClaim_hfReferenceClinicType': 'Clinic',
        '#ctl00_MainContent_uc_MakeClaim_hfOldReferenceClinicType': 'Clinic',
        'input[id$="hfParentClinicID"]': baseline.clinicId || '',
      },
    },
  ];

  const results = [];
  for (const s of scenarios) {
    await setReferral(p, s.patch);
    await p.waitForTimeout(250);
    const clicked = await clickCalculate(p);
    const after = await state(p);
    results.push({ name: s.name, clicked, after });
  }

  console.log('[probe] scenario_results', JSON.stringify(results, null, 2));
  await p.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-probe-referral-combos.png', fullPage: true }).catch(() => {});
} catch (error) {
  console.error('[probe] fatal', error?.stack || String(error));
} finally {
  await bm.close().catch(() => {});
}
