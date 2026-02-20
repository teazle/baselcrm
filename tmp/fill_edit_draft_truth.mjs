import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { BrowserManager } from '../src/utils/browser.js';
import { MHCAsiaAutomation } from '../src/automations/mhc-asia.js';

dotenv.config();

const runTargetsCsvPath = '/Users/vincent/Baselrpacrm/tmp/phasec_run_targets_2026-02-02_2026-02-07.csv';
const outCsvPath = '/Users/vincent/Baselrpacrm/tmp/edit_draft_truth_2026-02-02_2026-02-07.csv';
const outJsonPath = '/Users/vincent/Baselrpacrm/tmp/edit_draft_truth_results_2026-02-02_2026-02-07.json';
const evidenceBaseDir = '/Users/vincent/Baselrpacrm/screenshots/edit-draft-2026-02-02_2026-02-07';

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
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = vals[i] ?? '';
    });
    return obj;
  });

  return { headers, rows };
}

function escapeCsvCell(value) {
  const s = String(value ?? '');
  if (!/[",\n]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

function stringifyCsv(headers, rows) {
  const out = [headers.join(',')];
  for (const row of rows) {
    out.push(headers.map((h) => escapeCsvCell(row[h] ?? '')).join(','));
  }
  return `${out.join('\n')}\n`;
}

function toDmy(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function normalizeName(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/^(MHC|AVIVA|SINGLIFE|AIA|AIACLIENT)\s*[-:|]+\s*/i, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumber(s) {
  const v = String(s || '').replace(/[^0-9.-]/g, '');
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function portalContextFromPayType(payType) {
  const t = String(payType || '').toUpperCase();
  if (t.includes('AVIVA') || t.includes('SINGLIFE')) return 'singlife';
  if (t.includes('AIA') || t.includes('AIACLIENT')) return 'aia';
  return 'mhc';
}

async function clickFirstVisible(page, selectors) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count().catch(() => 0)) > 0) {
      const visible = await loc.isVisible().catch(() => true);
      if (!visible) continue;
      await loc.click({ timeout: 10000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(900);
      return true;
    }
  }
  return false;
}

async function openEditDraft(page) {
  const ok = await clickFirstVisible(page, [
    'a:has-text("Edit/Draft Visits")',
    'button:has-text("Edit/Draft Visits")',
    'text=/Edit\\s*\/\\s*Draft\\s+Visits/i',
    'a[href*="DraftList"]',
  ]);
  if (!ok) throw new Error('Could not open Edit/Draft Visits page');
}

async function enterContext(kind, page, mhc) {
  if (kind === 'mhc') {
    await mhc.ensureAtMhcHome();
    await openEditDraft(page);
    return;
  }

  if (kind === 'singlife') {
    await mhc.ensureAtMhcHome();
    const switched = await mhc.switchToSinglifeIfNeeded({ force: true }).catch(() => false);
    if (!switched) throw new Error('Failed to switch to Singlife context');
    await openEditDraft(page);
    return;
  }

  if (kind === 'aia') {
    await mhc.ensureAtMhcHome();
    const switched = await mhc._switchSystemTo(/aia\s*clinic/i, 'AIA Clinic').catch(() => false);
    if (!switched) throw new Error('Failed to switch to AIA context');
    await openEditDraft(page);
    return;
  }

  throw new Error(`Unknown context ${kind}`);
}

async function runSearch(page, nric) {
  const keySel = page.locator('select[name="key"]').first();
  if ((await keySel.count().catch(() => 0)) > 0) {
    await keySel.selectOption('patientNric').catch(async () => {
      await keySel.selectOption({ label: /nric/i }).catch(() => {});
    });
  }

  const keyTypeSel = page.locator('select[name="keyType"]').first();
  if ((await keyTypeSel.count().catch(() => 0)) > 0) {
    await keyTypeSel.selectOption('E').catch(async () => {
      await keyTypeSel.selectOption({ label: /equals\s*to/i }).catch(() => {});
    });
  }

  const keyValue = page.locator('input[name="keyValue"]').first();
  if ((await keyValue.count().catch(() => 0)) > 0) {
    await keyValue.fill(String(nric || ''), { timeout: 8000 }).catch(async () => {
      await keyValue.click({ timeout: 3000 }).catch(() => {});
      await page.keyboard.press('Control+A').catch(() => {});
      await page.keyboard.type(String(nric || '')).catch(() => {});
    });
  }

  const search = page.locator('input[name="SearchAction"]').first();
  if ((await search.count().catch(() => 0)) > 0) {
    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(() => {}),
      search.click({ timeout: 10000 }).catch(() => {}),
    ]);
  } else {
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
  }

  await page.waitForTimeout(900);
}

async function extractRows(page) {
  return await page.evaluate(() => {
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const rows = [];

    for (const tr of Array.from(document.querySelectorAll('table tr'))) {
      const cells = Array.from(tr.querySelectorAll('th,td')).map((c) => clean(c.textContent));
      if (cells.length < 5) continue;
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(cells[0])) continue;
      if (!/^EV/i.test(cells[1])) continue;
      if (!/^[A-Z]\d{7}[A-Z]$/i.test(cells[3] || '')) continue;

      rows.push({
        visitDate: cells[0] || '',
        visitNo: cells[1] || '',
        type: cells[2] || '',
        patientNric: cells[3] || '',
        patientName: cells[4] || '',
        totalFee: cells[5] || '',
        totalClaim: cells[6] || '',
        mcDays: cells[7] || '',
        remarks: cells[8] || '',
        raw: cells,
      });
    }

    return { rows, url: location.href, title: document.title };
  });
}

function pickMatch(rows, target) {
  const targetDate = toDmy(target.visit_date);
  const targetNric = String(target.nric || '').toUpperCase().trim();
  const targetName = normalizeName(target.patient_name);

  const byNric = rows.filter(
    (r) => String(r.patientNric || '').toUpperCase().trim() === targetNric
  );
  if (!byNric.length) return null;

  const byDate = byNric.filter((r) => String(r.visitDate || '') === targetDate);
  const candidates = byDate.length ? byDate : byNric;

  const byName = candidates.find((r) => {
    const n = normalizeName(r.patientName);
    return n && (n.includes(targetName) || targetName.includes(n));
  });

  return byName || candidates[0];
}

async function main() {
  const { rows: runRows } = parseCsv(fs.readFileSync(runTargetsCsvPath, 'utf8'));

  const outHeaders = [
    'visit_id',
    'patient_name',
    'nric',
    'visit_date',
    'pay_type',
    'crm_status',
    'draft_found',
    'draft_status',
    'draft_reference',
    'draft_total_fee',
    'draft_total_claim',
    'draft_mc_days',
    'evidence_path',
    'notes',
  ];

  fs.mkdirSync(evidenceBaseDir, { recursive: true });

  const browser = new BrowserManager();
  await browser.init();
  const page = await browser.newPage();
  const mhc = new MHCAsiaAutomation(page);

  const outRows = [];
  const detailRows = [];
  let currentContext = null;

  try {
    await mhc.login();

    for (const run of runRows) {
      const context = portalContextFromPayType(run.pay_type);
      const contextDir = path.join(evidenceBaseDir, context);
      fs.mkdirSync(contextDir, { recursive: true });

      if (currentContext !== context) {
        await enterContext(context, page, mhc);
        currentContext = context;
      }

      await runSearch(page, run.nric);
      const extracted = await extractRows(page);
      const match = pickMatch(extracted.rows, run);
      const found = Boolean(match);

      const evidencePath = path.join(contextDir, `${run.visit_id}.png`);
      await page.screenshot({ path: evidencePath, fullPage: true }).catch(() => {});

      const draftStatus = found
        ? `draft:${match.type || 'Visit'}`
        : 'not_found_in_edit_draft';

      const notes = `auto-check:${context}; result_rows=${extracted.rows.length}; url=${extracted.url}`;

      outRows.push({
        visit_id: run.visit_id,
        patient_name: run.patient_name,
        nric: run.nric,
        visit_date: run.visit_date,
        pay_type: run.pay_type,
        crm_status: run.crm_status || '',
        draft_found: found ? 'yes' : 'no',
        draft_status: draftStatus,
        draft_reference: found ? (match.visitNo || '') : '',
        draft_total_fee: found ? (match.totalFee || '') : '',
        draft_total_claim: found ? (match.totalClaim || '') : '',
        draft_mc_days: found ? (match.mcDays || '') : '',
        evidence_path: evidencePath,
        notes,
      });

      detailRows.push({
        visit_id: run.visit_id,
        context,
        found,
        matched_row: match,
        rows_seen: extracted.rows,
        page_url: extracted.url,
      });

      console.log(`[draft-check] ${run.visit_id} ${run.nric} ${context} => ${found ? 'FOUND' : 'NOT_FOUND'}`);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  fs.writeFileSync(outCsvPath, stringifyCsv(outHeaders, outRows));
  fs.writeFileSync(
    outJsonPath,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      runTargets: runTargetsCsvPath,
      details: detailRows,
      stats: {
        found: outRows.filter((r) => r.draft_found === 'yes').length,
        notFound: outRows.filter((r) => r.draft_found === 'no').length,
      },
    }, null, 2)
  );

  const foundCount = outRows.filter((r) => r.draft_found === 'yes').length;
  console.log(`Updated: ${outCsvPath}`);
  console.log(`Detail JSON: ${outJsonPath}`);
  console.log(`Found ${foundCount}/${outRows.length} in Edit/Draft`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
