#!/usr/bin/env node

/**
 * Targeted end-to-end test for a date that has BOTH MHC and Singlife/Aviva patients.
 *
 * This script:
 * 1. Downloads Clinic Assist Queue Report for a date
 * 2. Picks 1 MHC patient + 1 Singlife/Aviva patient (with PCNO)
 * 3. Extracts NRIC + charge type + diagnosis + MC from Clinic Assist
 * 4. Fills the claim forms in MHC Asia:
 *    - MHC patient (may require switching to AIA Clinic)
 *    - Singlife/Aviva patient (forces switching system to Singlife)
 * 5. Leaves both browser tabs open for review (DO NOT SUBMIT)
 *
 * Usage:
 *   node src/examples/test-mhc-and-singlife-date.js 2026-01-30
 */

import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { MHCAsiaAutomation } from '../automations/mhc-asia.js';
import { logger } from '../utils/logger.js';
import { normalizePcno, normalizePatientNameForSearch } from '../utils/patient-normalize.js';

dotenv.config();

async function extractVisitFormState(page) {
  return await page
    .evaluate(() => {
      const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (!style) return false;
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return true;
      };
      const fieldValue = (el) => {
        if (!el) return null;
        const tag = (el.tagName || '').toLowerCase();
        if (tag === 'select') {
          const opt = el.selectedOptions && el.selectedOptions[0];
          return norm((opt && opt.textContent) || el.value || '');
        }
        if (tag === 'textarea') return norm(el.value || el.textContent || '');
        return norm(el.value || '');
      };

      // Many of these pages are tables-within-tables. The outer layout row often contains
      // both the left label table and the right "Special Remarks" textarea, which caused
      // naive "match on row textContent" to return the remarks value for everything.
      //
      // To avoid that: find the *label cell* (inner table), then read the closest field
      // within the same inner row.
      const valueByLabel = (labelRe) => {
        const labelNodes = Array.from(document.querySelectorAll('td, th, label, span, div')).filter((n) => {
          if (!n) return false;
          const t = norm(n.textContent);
          if (!t) return false;
          // Avoid grabbing big containers.
          if (t.length > 40) return false;
          return labelRe.test(t);
        });

        const fieldCandidatesInRow = (row) =>
          Array.from(row.querySelectorAll('input, select, textarea')).filter((el) => {
            if (!isVisible(el)) return false;
            const tag = (el.tagName || '').toLowerCase();
            if (tag === 'input') {
              const type = (el.getAttribute('type') || 'text').toLowerCase();
              if (type === 'hidden' || type === 'button' || type === 'submit' || type === 'image') return false;
            }
            return true;
          });

        const center = (el) => {
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        };

        for (const labelEl of labelNodes) {
          const row = labelEl.closest('tr');
          if (!row) continue;
          const fields = fieldCandidatesInRow(row);
          if (!fields.length) continue;

          // Pick the closest field to the label by screen distance.
          const lc = center(labelEl);
          let best = fields[0];
          let bestD = Infinity;
          for (const f of fields) {
            const fc = center(f);
            const dx = fc.x - lc.x;
            const dy = fc.y - lc.y;
            const d = dx * dx + dy * dy;
            if (d < bestD) {
              bestD = d;
              best = f;
            }
          }
          return fieldValue(best);
        }
        return null;
      };

      const valueBySelector = (selector) => {
        const els = Array.from(document.querySelectorAll(selector));
        for (const el of els) {
          if (!isVisible(el)) continue;
          const tag = (el.tagName || '').toLowerCase();
          if (tag === 'input') {
            const type = (el.getAttribute('type') || 'text').toLowerCase();
            if (type === 'hidden' || type === 'button' || type === 'submit' || type === 'image') continue;
          }
          const v = fieldValue(el);
          if (v !== null) return v;
        }
        return null;
      };

      const valueByBestGuess = (selector, labelRe) => {
        // Prefer stable name/id-based selectors; fallback to label-based when needed.
        const v = selector ? valueBySelector(selector) : null;
        if (v !== null && v !== '') return v;
        return labelRe ? valueByLabel(labelRe) : v;
      };

      const firstTableInputAfterHeader = (headerRe, stopRe) => {
        const cells = Array.from(document.querySelectorAll('th, td')).filter((c) => headerRe.test(norm(c.textContent)));
        for (const cell of cells) {
          const table = cell.closest('table');
          const headerRow = cell.closest('tr');
          if (!table || !headerRow) continue;
          const rows = Array.from(table.querySelectorAll('tr')).filter((r) => r.closest('table') === table);
          const idx = rows.indexOf(headerRow);
          if (idx < 0) continue;
          for (let i = idx + 1; i < rows.length; i++) {
            const rt = norm(rows[i].textContent);
            if (stopRe && stopRe.test(rt)) break;
            const inputs = Array.from(rows[i].querySelectorAll('input[type="text"], input:not([type]), textarea')).filter(
              (x) => isVisible(x)
            );
            if (!inputs.length) continue;
            inputs.sort((a, b) => (b.getBoundingClientRect().width || 0) - (a.getBoundingClientRect().width || 0));
            return norm(inputs[0].value || '');
          }
        }
        return null;
      };

      const state = {
        url: location.href,
        visitDate: valueByBestGuess('input[name*="visitdate" i], input[id*="visitdate" i]', /\bVisit\s*Date\b/i),
        chargeType: valueByBestGuess('select[name*="charge" i], select[id*="charge" i]', /\bCharge\s*Type\b/i),
        mcDay: valueByBestGuess(
          'input[name*="mc" i][name*="day" i], input[id*="mc" i][id*="day" i]',
          /\bMC\s*Day\b/i
        ),
        mcStartDate: valueByBestGuess(
          'input[name*="mc" i][name*="start" i], input[id*="mc" i][id*="start" i]',
          /\bMC\s*Start\s*Date\b/i
        ),
        consultFee: valueByBestGuess(
          'input[name*="consult" i], input[id*="consult" i]',
          /\bConsultation\s*Fee\b/i
        ),
        specialRemarks: (() => {
          // Prefer the textarea in the "Special Remarks" area.
          const rows = Array.from(document.querySelectorAll('tr'));
          for (const row of rows) {
            const txt = norm(row.textContent);
            if (!/\bSpecial\s*Remarks\b/i.test(txt)) continue;
            const ta = row.querySelector('textarea');
            if (ta && isVisible(ta)) return norm(ta.value || ta.textContent || '');
          }
          return null;
        })(),
        firstDrug: firstTableInputAfterHeader(/Drug\s*Name/i, /Total\s+Drug\s+Fee/i),
        firstProcedure: firstTableInputAfterHeader(/Procedure\s*Name/i, /Total\s+Proc\s+Fee/i),
      };
      return state;
    })
    .catch(() => null);
}

function verifyState(label, state, expectations) {
  const failures = [];
  const checkEq = (k, expected) => {
    const actual = (state?.[k] ?? '').toString().trim();
    if (actual !== expected) failures.push(`${k} expected="${expected}" actual="${actual}"`);
  };
  const checkIn = (k, allowed) => {
    const actual = (state?.[k] ?? '').toString().trim();
    if (!allowed.includes(actual)) failures.push(`${k} expected one of ${JSON.stringify(allowed)} actual="${actual}"`);
  };
  const checkHas = (k, substr) => {
    const actual = (state?.[k] ?? '').toString();
    if (!actual.toLowerCase().includes(String(substr).toLowerCase()))
      failures.push(`${k} expected to include "${substr}" actual="${actual.trim()}"`);
  };

  if (expectations.visitDate) checkEq('visitDate', expectations.visitDate);
  if (expectations.mcDayAllowed) checkIn('mcDay', expectations.mcDayAllowed);
  if (expectations.mcStartDateAllowed) checkIn('mcStartDate', expectations.mcStartDateAllowed);
  if (expectations.mcStartDateEq) checkEq('mcStartDate', expectations.mcStartDateEq);
  if (expectations.remarksHas) checkHas('specialRemarks', expectations.remarksHas);
  if (expectations.procedureHas) checkHas('firstProcedure', expectations.procedureHas);

  if (failures.length) {
    logger.error(`[VERIFY] ${label}: FAIL`, { failures, state });
    return false;
  }
  logger.info(`[VERIFY] ${label}: PASS`, { state });
  return true;
}

function formatDateForMHC(dateStr) {
  if (!dateStr) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  return dateStr;
}

function normContract(it) {
  return String(it?.contract || it?.payType || '').toUpperCase();
}

function pickPatients(queueItems) {
  const hasValidPcno = (it) => !!normalizePcno(it?.pcno || it?.patientNumber);
  const hasValidName = (it) => {
    const raw = it?.patientNameClean || it?.name || it?.patientName || '';
    const clean = normalizePatientNameForSearch(raw);
    return !!(clean && clean.length >= 3);
  };

  const mhcCandidates = (queueItems || []).filter((it) => {
    if (!normContract(it).includes('MHC')) return false;
    return hasValidPcno(it) || hasValidName(it);
  });

  const singlifeCandidates = (queueItems || []).filter((it) => {
    const c = normContract(it);
    if (!(c.includes('SINGLIFE') || c.includes('AVIVA'))) return false;
    return hasValidPcno(it) || hasValidName(it);
  });
  return { mhcCandidates, singlifeCandidates };
}

async function getClinicAssistDataForCandidate(ca, page, { pcno, name }, dateStr) {
  const navOk = await ca.navigateToPatientPage();
  if (!navOk) {
    throw new Error('Clinic Assist: could not navigate to Patient Search page (UI navigation failed)');
  }
  if (pcno) {
    await ca.searchPatientByNumber(pcno);
    await ca.openPatientFromSearchResultsByNumber(pcno);
  } else if (name) {
    await ca.searchPatientByName(name);
    await ca.openPatientFromSearchResults(name);
  } else {
    throw new Error('No candidate identifier (pcno or name) provided');
  }

  const nric = await ca.getPatientNRIC();
  if (!nric) throw new Error(`Could not extract NRIC for candidate ${pcno ? `PCNO ${pcno}` : `name "${name}"`}`);

  const chargeTypeAndDiagnosis = await ca.getChargeTypeAndDiagnosis(dateStr);
  const visitDateForMHC = formatDateForMHC(dateStr);
  const mcDays = chargeTypeAndDiagnosis.mcDays || 0;
  const mcStartDate = chargeTypeAndDiagnosis.mcStartDate || visitDateForMHC;

  return { nric, chargeTypeAndDiagnosis, mcDays, mcStartDate };
}

async function fillForm(mhcAsia, { nric, chargeTypeAndDiagnosis, visitDateForMHC, mcDays, mcStartDate }, portalHint) {
  const forcedPortal = portalHint || 'unknown';

  // Singlife/Aviva patients: the portal UI is like the AIA Visit flow.
  // Switch system to Singlife, then open "Add Normal Visit" and search using the NRIC there.
  if (/singlife|aviva/i.test(String(forcedPortal))) {
    await mhcAsia.ensureAtMhcHome();
    await mhcAsia.switchToSinglifeIfNeeded({ force: true });
    // If switching bounced us to login, re-auth.
    const loginVisible = await mhcAsia.page
      .locator('input[type="password"], input[name="txtPassword"], input[name*="password" i]')
      .first()
      .isVisible()
      .catch(() => false);
    if (loginVisible) await mhcAsia.login();

    const ok = await mhcAsia.navigateToSinglifeNormalVisitAndSearch(nric, visitDateForMHC);
    if (!ok) throw new Error(`Singlife: could not open visit form for NRIC ${nric}`);
  } else {
    await mhcAsia.navigateToNormalVisit();
    const searchResult = await mhcAsia.searchPatientByNRIC(nric);
    if (!searchResult?.found) throw new Error(`Patient not found in MHC Asia search: ${nric}`);

    const opened = await mhcAsia.openPatientFromSearchResults(nric);
    if (!opened) throw new Error(`Could not open patient from MHC Asia search results: ${nric}`);

    // Force portal/system switch when needed.
    const portal = portalHint || searchResult.portal || 'unknown';
    await mhcAsia.addVisit(portal, nric);
  }

  await mhcAsia.fillVisitDate(visitDateForMHC);
  // Some portals prefill MC Start Date as M/D/YYYY (e.g. 9/2/2026) which triggers validation alerts.
  // Normalize early so later interactions don't get blocked.
  await mhcAsia.normalizeMcStartDateIfNeeded({ clear: mcDays <= 0 }).catch(() => {});

  if (chargeTypeAndDiagnosis.chargeType === 'first') await mhcAsia.setChargeTypeNewVisit();
  else await mhcAsia.setChargeTypeFollowUp();

  // Some first-consult flows require waiver-of-referral to avoid blocking alerts.
  if (chargeTypeAndDiagnosis.chargeType === 'first') {
    await mhcAsia.setWaiverOfReferral(true).catch(() => {});
  }

  await mhcAsia.fillConsultationFee(99999);

  // Only set MC fields when MC is actually present. For the no-MC case, many portals default to
  // a placeholder ("?") and attempting to force "0" can trigger validation alerts.
  if (mcDays > 0) {
    await mhcAsia.fillMcDays(mcDays).catch(() => {});
    await mhcAsia.fillMcStartDate(mcStartDate);
  }

  if (chargeTypeAndDiagnosis.diagnosis?.description) {
    // Pass the full object so the selector can try code first, then description.
    const ok = await mhcAsia.selectDiagnosis(chargeTypeAndDiagnosis.diagnosis).catch(() => false);
    if (!ok) {
      // Fallback: use the portal's "M" selector modal (best-effort).
      await mhcAsia.fillDiagnosisPrimary(chargeTypeAndDiagnosis.diagnosis).catch(() => {});
    }
  }

  // Fill medicine/drug names if extracted from Clinic Assist.
  // Note: Some portals require selecting from a modal; we try the simple table fill first.
  const meds = (chargeTypeAndDiagnosis.medicines || [])
    .map((m) => (typeof m === 'string' ? m : m?.name))
    .filter((x) => x && String(x).trim().length >= 2)
    .map((x) => String(x).trim())
    .filter((x) => !/^(use as instructed|take as instructed|take as directed|unfit for duty)$/i.test(x));
  if (meds.length) {
    const unique = Array.from(new Set(meds)).slice(0, 6);
    const ok = await mhcAsia.fillServicesAndDrugs(unique).catch(() => false);
    if (!ok) {
      // Fallback: fill drug/procedure rows directly in their tables (best-effort).
      const procedures = unique.filter((it) =>
        /(xray|x-ray|scan|ultrasound|procedure|physio|ecg|injection|dressing|suturing|vaccine)/i.test(it)
      );
      const drugs = unique.filter((it) => !procedures.includes(it));

      for (let i = 0; i < Math.min(3, drugs.length); i++) {
        const medName = drugs[i];
        if (i > 0) await mhcAsia.clickMoreDrug().catch(() => {});
        await mhcAsia.fillDrugItem({ name: medName, quantity: null }, i + 1).catch(() => {});
      }

      for (let i = 0; i < Math.min(2, procedures.length); i++) {
        const procName = procedures[i];
        if (i > 0) await mhcAsia.clickMoreProcedure?.().catch(() => {});
        await mhcAsia.fillProcedureItem?.({ name: procName }, i + 1).catch(() => {});
      }
    }
  }

  await mhcAsia.computeClaim();
}

async function main(targetDate) {
  const browserManager = new BrowserManager();
  const runId = new Date().toISOString();
  const headless = process.env.HEADLESS === 'true';

  try {
    const visitDateForMHC = formatDateForMHC(targetDate);

    logger.info('\n' + '='.repeat(70));
    logger.info('  TEST: MHC + SINGLIFE/AVIVA (SAMPLE) FORM FILLING');
    logger.info('='.repeat(70));
    logger.info(`\nRUN_ID: ${runId}`);
    logger.info(`📅 Target Date: ${targetDate} (${visitDateForMHC})\n`);

    await browserManager.init();

    // Clinic Assist
    const caPage = (browserManager.context.pages()[0] || (await browserManager.newPage()));
    const ca = new ClinicAssistAutomation(caPage);

    logger.info('Logging into Clinic Assist...');
    await ca.login();

    logger.info('Downloading Queue Report and extracting items...');
    await ca.navigateToReports();
    await caPage.waitForTimeout(1200);
    const opened = await ca.navigateToQueueListReport();
    if (!opened) await ca.navigateDirectlyToQueueReport();
    await caPage.waitForTimeout(1200);
    await ca.searchQueueListByDate(targetDate);
    await caPage.waitForTimeout(1500);
    const queueItems = await ca.extractQueueListResults();

    const { mhcCandidates, singlifeCandidates } = pickPatients(queueItems);
    if (!mhcCandidates.length) throw new Error('No MHC patient found (with PCNO) for this date.');
    if (!singlifeCandidates.length) throw new Error('No Singlife/Aviva patient found (with PCNO) for this date.');

    const tryPickWorking = async (label, candidates) => {
      const maxTries = Math.min(12, candidates.length);
      let lastErr = null;
      for (let i = 0; i < maxTries; i++) {
        const it = candidates[i];
        const pcno = normalizePcno(it.pcno || it.patientNumber);
        const rawName = it.patientNameClean || it.name || it.patientName || '';
        const cleanName = normalizePatientNameForSearch(rawName);
        if (!pcno && !cleanName) continue;

        logger.info(
          `${label}: trying candidate ${i + 1}/${maxTries} ${pcno ? `PCNO=${pcno}` : `NAME="${cleanName}"`} contract="${it.contract || it.payType || ''}"`
        );
        try {
          const data = await getClinicAssistDataForCandidate(ca, caPage, { pcno, name: pcno ? null : cleanName }, targetDate);
          return { item: it, pcno, data, cleanName };
        } catch (e) {
          lastErr = e;
          logger.warn(`${label}: candidate ${(pcno ? `PCNO=${pcno}` : `NAME="${cleanName}"`)} failed: ${e.message}`);
          const tag = pcno ? pcno : `name-${(cleanName || 'unknown').replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}`;
          await caPage.screenshot({ path: `screenshots/test-pick-failed-${label.toLowerCase()}-${tag}.png`, fullPage: true }).catch(() => {});
        }
      }
      throw lastErr || new Error(`${label}: no working candidate found`);
    };

    logger.info('\nSelecting a working MHC patient (needs NRIC in Clinic Assist)...');
    const pickedMhc = await tryPickWorking('MHC', mhcCandidates);
    logger.info(`Selected MHC patient: PCNO=${pickedMhc.pcno} NRIC=${pickedMhc.data.nric}`);

    logger.info('\nSelecting a working Singlife/Aviva patient (needs NRIC in Clinic Assist)...');
    const pickedSinglife = await tryPickWorking('SINGLIFE', singlifeCandidates);
    logger.info(`Selected Singlife/Aviva patient: PCNO=${pickedSinglife.pcno} NRIC=${pickedSinglife.data.nric}`);

    // MHC Asia tabs (2 tabs so both forms remain open)
    logger.info('\nOpening MHC Asia (tab 1 for MHC)...');
    const mhcPage1 = await browserManager.newPage();
    const mhcAsia1 = new MHCAsiaAutomation(mhcPage1);
    mhcAsia1.setupDialogHandler();
    await mhcAsia1.login();

    await fillForm(mhcAsia1, { ...pickedMhc.data, visitDateForMHC }, null);
    await mhcPage1.screenshot({ path: 'screenshots/test-mhc-form-filled.png', fullPage: true }).catch(() => {});
    const mhcState = await extractVisitFormState(mhcPage1);
    verifyState('MHC/AIA', mhcState, {
      visitDate: visitDateForMHC,
      mcDayAllowed: ['?', '', '0'],
      mcStartDateAllowed: ['', '?', '0'],
      remarksHas: pickedMhc.data.chargeTypeAndDiagnosis?.diagnosis?.code || 'S63',
      procedureHas: 'x-ray',
    });

    logger.info('\nOpening MHC Asia (tab 2 for Singlife/Aviva)...');
    const mhcPage2 = await browserManager.newPage();
    const mhcAsia2 = new MHCAsiaAutomation(mhcPage2);
    mhcAsia2.setupDialogHandler();
    await mhcAsia2.login();

    // Force Singlife system switch for Aviva/Singlife patients.
    await fillForm(mhcAsia2, { ...pickedSinglife.data, visitDateForMHC }, 'singlife');
    await mhcPage2.screenshot({ path: 'screenshots/test-singlife-form-filled.png', fullPage: true }).catch(() => {});
    const singlifeState = await extractVisitFormState(mhcPage2);
    verifyState('Singlife/Aviva', singlifeState, {
      visitDate: visitDateForMHC,
      mcDayAllowed: ['1'],
      mcStartDateEq: visitDateForMHC,
      remarksHas: pickedSinglife.data.chargeTypeAndDiagnosis?.diagnosis?.code || 'S83',
      procedureHas: 'x-ray',
    });

    logger.info('\n>>> Browser left open for review <<<');
    logger.info('>>> Press Ctrl+C to close <<<\n');
    if (headless) {
      logger.info('HEADLESS=true: closing browser after fill');
      await browserManager.close().catch(() => {});
      return;
    }
    await new Promise(() => {});
  } finally {
    // Intentionally not closing to leave browser open.
  }
}

const args = process.argv.slice(2);
const targetDate = args[0] || new Date().toISOString().split('T')[0];
if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
  console.error('Invalid date format. Use YYYY-MM-DD (e.g., 2026-01-30)');
  process.exit(1);
}

main(targetDate).catch((err) => {
  logger.error('Test failed:', err);
  process.exit(1);
});
