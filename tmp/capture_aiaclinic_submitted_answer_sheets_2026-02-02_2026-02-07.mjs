import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { BrowserManager } from '../src/utils/browser.js';
import { MHCAsiaAutomation } from '../src/automations/mhc-asia.js';

dotenv.config();

const truthCsvPath = '/Users/vincent/Baselrpacrm/tmp/view_submitted_claim_truth_2026-02-02_2026-02-07.csv';
const targetCsvPath = '/Users/vincent/Baselrpacrm/tmp/answer_sheet_capture_aiaclinic_targets_2026-02-02_2026-02-07.csv';
const snapshotsJsonPath = '/Users/vincent/Baselrpacrm/tmp/form_level_answer_sheet_snapshots_2026-02-02_2026-02-07.json';
const resultJsonPath = '/Users/vincent/Baselrpacrm/tmp/answer_sheet_capture_aiaclinic_results_2026-02-02_2026-02-07.json';
const evidenceDir = '/Users/vincent/Baselrpacrm/screenshots/answer-sheet-aiaclinic-2026-02-02_2026-02-07';

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines.length) return { headers: [], rows: [] };

  const parseLine = (line) => {
    const out = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuote = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const vals = parseLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = vals[i] ?? '';
    });
    return row;
  });

  return { headers, rows };
}

function escapeCsvCell(value) {
  const s = String(value ?? '');
  if (!/[",\n]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

function stringifyCsv(headers, rows) {
  const lines = [];
  lines.push(headers.join(','));
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvCell(row[h] ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function toDmy(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function normalizeName(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeNotes(oldNotes, extra) {
  const a = String(oldNotes || '').trim();
  const b = String(extra || '').trim();
  if (!a) return b;
  if (!b) return a;
  if (a.includes(b)) return a;
  return `${a}; ${b}`;
}

async function clickFirstVisible(page, selectors) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count().catch(() => 0)) > 0) {
      const visible = await loc.isVisible().catch(() => true);
      if (!visible) continue;
      await loc.click({ timeout: 10000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(800);
      return true;
    }
  }
  return false;
}

async function openViewSubmitted(page) {
  const ok = await clickFirstVisible(page, [
    'a:has-text("View Submitted Visits")',
    'button:has-text("View Submitted Visits")',
    'text=/View\\s+Submitted\\s+Visits/i',
    'a[href*="EmpVisitList"]',
  ]);
  if (!ok) throw new Error('Could not open View Submitted Visits page in AIA context');
}

async function ensureAiaContext(page, mhc) {
  await mhc.ensureAtMhcHome();
  const switched = await mhc._switchSystemTo(/aia\s*clinic/i, 'AIA Clinic').catch(() => false);
  if (!switched) throw new Error('Failed to switch to AIA Clinic context');
  await openViewSubmitted(page);
}

async function fillByName(page, name, value) {
  const loc = page.locator(`input[name="${name}"]`).first();
  if ((await loc.count().catch(() => 0)) > 0) {
    await loc.fill(String(value || ''), { timeout: 8000 }).catch(async () => {
      await loc.click({ timeout: 3000 }).catch(() => {});
      await page.keyboard.press('Control+A').catch(() => {});
      await page.keyboard.type(String(value || '')).catch(() => {});
    });
  }
}

async function runSubmittedSearch(page, row) {
  const dmy = toDmy(row.visit_date);
  const [day, month, year] = dmy.split('/');

  await fillByName(page, 'fromDateDay', day || '');
  await fillByName(page, 'fromDateMonth', month || '');
  await fillByName(page, 'fromDateYear', year || '');
  await fillByName(page, 'toDateDay', day || '');
  await fillByName(page, 'toDateMonth', month || '');
  await fillByName(page, 'toDateYear', year || '');

  const keySel = page.locator('select[name="key"]').first();
  if ((await keySel.count().catch(() => 0)) > 0) {
    await keySel.selectOption('patientNric').catch(async () => {
      await keySel.selectOption({ label: /Patient\s*Nric/i }).catch(() => {});
    });
  }

  const keyTypeSel = page.locator('select[name="keyType"]').first();
  if ((await keyTypeSel.count().catch(() => 0)) > 0) {
    await keyTypeSel.selectOption('E').catch(async () => {
      await keyTypeSel.selectOption({ label: /equals\s*to/i }).catch(() => {});
    });
  }

  await fillByName(page, 'keyValue', row.nric || '');

  const searchBtn = page.locator('input[name="SearchAction"]').first();
  if ((await searchBtn.count().catch(() => 0)) > 0) {
    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(() => {}),
      searchBtn.click({ timeout: 10000 }).catch(() => {}),
    ]);
  } else {
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
  }

  await page.waitForTimeout(900);
}

async function extractResultRows(page) {
  return await page.evaluate(() => {
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const rows = [];

    for (const tr of Array.from(document.querySelectorAll('table tr'))) {
      const cells = Array.from(tr.querySelectorAll('th,td')).map((c) => clean(c.textContent));
      if (cells.length < 4) continue;
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(cells[0])) continue;
      if (!/^EV/i.test(cells[1])) continue;

      rows.push({
        visitDate: cells[0] || '',
        visitNo: cells[1] || '',
        type: cells[2] || '',
        patientName: cells[3] || '',
        totalFee: cells[4] || '',
        totalClaim: cells[5] || '',
        mcDays: cells[6] || '',
      });
    }

    return {
      rows,
      url: location.href,
      title: document.title,
    };
  });
}

function pickMatch(rows, targetDateIso, targetPatientName) {
  const targetDate = toDmy(targetDateIso);
  const targetName = normalizeName(targetPatientName);
  const dateMatches = rows.filter((r) => r.visitDate === targetDate);
  if (!dateMatches.length) return null;

  if (!targetName) return dateMatches[0];

  const byName = dateMatches.find((r) => {
    const candidate = normalizeName(r.patientName);
    return candidate.includes(targetName) || targetName.includes(candidate);
  });

  return byName || dateMatches[0];
}

async function openVisitByReference(page, reference) {
  const link = page.locator('a', { hasText: reference }).first();
  if ((await link.count().catch(() => 0)) > 0) {
    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(() => {}),
      link.click({ timeout: 10000 }).catch(() => {}),
    ]);
    await page.waitForTimeout(1000);
    return true;
  }

  const hrefLink = page.locator(`a[href*="${reference}"]`).first();
  if ((await hrefLink.count().catch(() => 0)) > 0) {
    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(() => {}),
      hrefLink.click({ timeout: 10000 }).catch(() => {}),
    ]);
    await page.waitForTimeout(1000);
    return true;
  }

  return false;
}

async function extractDiagnosisFromForm(page) {
  return await page.evaluate(() => {
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

    const readInputValue = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return '';
      const val = 'value' in el ? el.value : el.textContent;
      return clean(val || '');
    };

    const diagnosisPriId = readInputValue('input[name="diagnosisPriId"], input[id*="diagnosisPriId" i]');
    const diagnosisPriDesc = readInputValue(
      'input[name="diagnosisPriDesc"], input[id*="diagnosisPriDesc" i], input[name*="diagnosisPriDesc" i]'
    );

    const diagnosisPriIdTemp = (() => {
      const select = document.querySelector('select[name="diagnosisPriIdTemp"], select[id*="diagnosisPriIdTemp" i]');
      if (!select) return '';
      const opt = select.options?.[select.selectedIndex];
      return clean(opt ? opt.textContent : '');
    })();

    let diagnosisPriRowText = '';
    for (const tr of Array.from(document.querySelectorAll('tr'))) {
      const text = clean(tr.textContent || '');
      if (/diagnosis\s*pri/i.test(text) && text.length > 8 && text.length < 240) {
        diagnosisPriRowText = text;
        break;
      }
    }

    let diagnosisOther = '';
    for (const input of Array.from(document.querySelectorAll('input[type="text"],textarea'))) {
      const name = String(input.getAttribute('name') || '').toLowerCase();
      const id = String(input.getAttribute('id') || '').toLowerCase();
      if (name.includes('diagnosis') || id.includes('diagnosis')) {
        const v = clean(input.value || input.textContent || '');
        if (v && !/^(na|n\/a)$/i.test(v)) {
          diagnosisOther = v;
          if (!/diagnosispridesc|diagnosispriid/i.test(`${name} ${id}`)) break;
        }
      }
    }

    return {
      diagnosisPriId,
      diagnosisPriDesc,
      diagnosisPriIdTemp,
      diagnosisPriRowText,
      diagnosisOther,
      url: location.href,
      title: document.title,
    };
  });
}

function buildSnapshotWithDiagnosis(diag) {
  const value =
    String(diag?.diagnosisPriDesc || '').trim() ||
    String(diag?.diagnosisOther || '').trim() ||
    String(diag?.diagnosisPriIdTemp || '').trim() ||
    '';

  return {
    main: {
      fields: [
        {
          key: 'diagnosisPriDesc',
          name: 'diagnosisPriDesc',
          id: 'diagnosisPriDesc',
          label: 'Diagnosis Pri',
          value,
        },
      ],
    },
    frames: [],
  };
}

function loadSnapshotsJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      generatedAt: new Date().toISOString(),
      submittedCount: 0,
      draftCount: 0,
      submittedCaptures: [],
      draftCaptures: [],
      compareRows: [],
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    parsed.submittedCaptures = Array.isArray(parsed.submittedCaptures) ? parsed.submittedCaptures : [];
    parsed.draftCaptures = Array.isArray(parsed.draftCaptures) ? parsed.draftCaptures : [];
    parsed.compareRows = Array.isArray(parsed.compareRows) ? parsed.compareRows : [];
    return parsed;
  } catch {
    return {
      generatedAt: new Date().toISOString(),
      submittedCount: 0,
      draftCount: 0,
      submittedCaptures: [],
      draftCaptures: [],
      compareRows: [],
    };
  }
}

function upsertSubmittedCapture(existing, nextCapture) {
  const idx = existing.findIndex((x) => String(x.visit_id || '') === String(nextCapture.visit_id || ''));
  if (idx >= 0) existing[idx] = nextCapture;
  else existing.push(nextCapture);
}

async function main() {
  const truthParsed = parseCsv(fs.readFileSync(truthCsvPath, 'utf8'));
  const targetParsed = parseCsv(fs.readFileSync(targetCsvPath, 'utf8'));

  if (!truthParsed.headers.length) throw new Error(`No headers in ${truthCsvPath}`);
  if (!targetParsed.headers.length) throw new Error(`No headers in ${targetCsvPath}`);

  const truthRows = truthParsed.rows;
  const targetRows = targetParsed.rows;

  const truthByVisitId = new Map(truthRows.map((r) => [String(r.visit_id || ''), r]));
  const snapshots = loadSnapshotsJson(snapshotsJsonPath);

  fs.mkdirSync(evidenceDir, { recursive: true });

  const browser = new BrowserManager();
  await browser.init();
  const page = await browser.newPage();
  const mhc = new MHCAsiaAutomation(page);

  const runDetails = [];

  try {
    await mhc.login();
    await ensureAiaContext(page, mhc);

    for (const row of targetRows) {
      const visitId = String(row.visit_id || '').trim();
      const truthRow = truthByVisitId.get(visitId);
      const detail = {
        visit_id: visitId,
        nric: row.nric,
        visit_date: row.visit_date,
        found: false,
        opened: false,
        reference: '',
        diagnosis: '',
        errors: [],
      };

      try {
        await runSubmittedSearch(page, row);
        const extracted = await extractResultRows(page);
        const match = pickMatch(extracted.rows, row.visit_date, row.patient_name);

        const listShot = path.join(evidenceDir, `${visitId}_list.png`);
        await page.screenshot({ path: listShot, fullPage: true }).catch(() => {});

        if (!match) {
          row.status = 'NOT_FOUND_IN_AIA_SUBMITTED';
          row.submitted_reference = '';
          row.submitted_diag = '';
          row.evidence_path = listShot;
          row.notes = mergeNotes(row.notes, `aia-check:not_found; rows=${extracted.rows.length}; url=${extracted.url}`);

          if (truthRow) {
            truthRow.portal_found = 'no';
            truthRow.portal_status = 'not_found_in_view_submitted';
            truthRow.portal_reference = '';
            truthRow.evidence_path = listShot;
            truthRow.notes = mergeNotes(truthRow.notes, 'context_override:aia');
            truthRow.notes = mergeNotes(truthRow.notes, `aia-check:not_found; rows=${extracted.rows.length}`);
          }

          detail.errors.push('not_found_in_search_results');
          runDetails.push(detail);
          console.log(`[aia-answer-sheet] ${visitId} ${row.nric} => NOT_FOUND`);
          await openViewSubmitted(page);
          continue;
        }

        detail.found = true;
        detail.reference = match.visitNo;

        const opened = await openVisitByReference(page, match.visitNo);
        if (!opened) {
          row.status = 'FOUND_ROW_OPEN_FAILED';
          row.submitted_reference = match.visitNo || '';
          row.submitted_diag = '';
          row.evidence_path = listShot;
          row.notes = mergeNotes(row.notes, 'aia-check:row_found_but_open_failed');

          if (truthRow) {
            truthRow.portal_found = 'yes';
            truthRow.portal_status = match.type ? `submitted:${match.type}` : 'submitted';
            truthRow.portal_reference = match.visitNo || '';
            truthRow.evidence_path = listShot;
            truthRow.notes = mergeNotes(truthRow.notes, 'context_override:aia');
            truthRow.notes = mergeNotes(truthRow.notes, 'aia-check:row_found_but_open_failed');
          }

          detail.errors.push('row_open_failed');
          runDetails.push(detail);
          console.log(`[aia-answer-sheet] ${visitId} ${row.nric} => ROW_FOUND_OPEN_FAILED (${match.visitNo})`);
          await openViewSubmitted(page);
          continue;
        }

        detail.opened = true;
        const diag = await extractDiagnosisFromForm(page);
        const diagValue =
          String(diag?.diagnosisPriDesc || '').trim() ||
          String(diag?.diagnosisOther || '').trim() ||
          String(diag?.diagnosisPriIdTemp || '').trim() ||
          '';
        detail.diagnosis = diagValue;

        const formShot = path.join(evidenceDir, `${visitId}_${match.visitNo}_submitted.png`);
        await page.screenshot({ path: formShot, fullPage: true }).catch(() => {});

        row.status = 'CAPTURED';
        row.submitted_reference = match.visitNo || '';
        row.submitted_diag = diagValue;
        row.evidence_path = formShot;
        row.notes = mergeNotes(row.notes, `aia-check:captured; type=${match.type || ''}; date=${match.visitDate || ''}`);

        if (truthRow) {
          truthRow.portal_found = 'yes';
          truthRow.portal_status = match.type ? `submitted:${match.type}` : 'submitted';
          truthRow.portal_reference = match.visitNo || '';
          truthRow.evidence_path = formShot;
          truthRow.notes = mergeNotes(truthRow.notes, 'context_override:aia');
          truthRow.notes = mergeNotes(truthRow.notes, `aia-check:captured; diag=${diagValue || 'blank'}`);
        }

        const submittedCapture = {
          visit_id: visitId,
          patient_name: row.patient_name || truthRow?.patient_name || '',
          nric: row.nric || truthRow?.nric || '',
          visit_date: row.visit_date || truthRow?.visit_date || '',
          pay_type: truthRow?.pay_type || row.pay_type || 'MHC',
          context: 'aia',
          reference: match.visitNo || '',
          source: 'submitted',
          opened: true,
          screenshot: formShot,
          snapshot: buildSnapshotWithDiagnosis(diag),
          capture_error: null,
        };
        upsertSubmittedCapture(snapshots.submittedCaptures, submittedCapture);

        runDetails.push(detail);
        console.log(`[aia-answer-sheet] ${visitId} ${row.nric} => CAPTURED ${match.visitNo} diag="${diagValue || ''}"`);

        await openViewSubmitted(page);
      } catch (err) {
        const msg = err?.message || String(err);
        detail.errors.push(msg);
        runDetails.push(detail);
        row.status = 'ERROR';
        row.notes = mergeNotes(row.notes, `aia-check:error:${msg}`);
        console.log(`[aia-answer-sheet] ${visitId} ${row.nric} => ERROR ${msg}`);
        await openViewSubmitted(page).catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  snapshots.generatedAt = new Date().toISOString();
  snapshots.submittedCount = Array.isArray(snapshots.submittedCaptures) ? snapshots.submittedCaptures.length : 0;

  fs.writeFileSync(truthCsvPath, stringifyCsv(truthParsed.headers, truthRows));
  fs.writeFileSync(targetCsvPath, stringifyCsv(targetParsed.headers, targetRows));
  fs.writeFileSync(snapshotsJsonPath, `${JSON.stringify(snapshots, null, 2)}\n`, 'utf8');
  fs.writeFileSync(
    resultJsonPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), runDetails }, null, 2)}\n`,
    'utf8'
  );

  const captured = targetRows.filter((r) => String(r.status || '').toUpperCase() === 'CAPTURED').length;
  const missing = targetRows.filter((r) => String(r.status || '').toUpperCase().includes('NOT_FOUND')).length;
  const errors = targetRows.filter((r) => String(r.status || '').toUpperCase() === 'ERROR').length;

  console.log(`Updated: ${truthCsvPath}`);
  console.log(`Updated: ${targetCsvPath}`);
  console.log(`Updated: ${snapshotsJsonPath}`);
  console.log(`Result : ${resultJsonPath}`);
  console.log(`Summary => captured=${captured}, not_found=${missing}, errors=${errors}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
