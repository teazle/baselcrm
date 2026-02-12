import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { BrowserManager } from '../src/utils/browser.js';
import { MHCAsiaAutomation } from '../src/automations/mhc-asia.js';

dotenv.config();

const truthCsvPath = '/Users/vincent/Baselrpacrm/tmp/view_submitted_claim_truth_2026-02-02_2026-02-07.csv';
const evidenceBaseDir = '/Users/vincent/Baselrpacrm/screenshots/view-submitted-2026-02-02_2026-02-07';
const resultJsonPath = '/Users/vincent/Baselrpacrm/tmp/view_submitted_claim_truth_results_2026-02-02_2026-02-07.json';

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
    .replace(/^(MHC|AVIVA|SINGLIFE|AIA|AIACLIENT)\s*[-:|]+\s*/i, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

async function openViewSubmitted(page) {
  const ok = await clickFirstVisible(page, [
    'a:has-text("View Submitted Visits")',
    'button:has-text("View Submitted Visits")',
    'text=/View\\s+Submitted\\s+Visits/i',
    'a[href*="EmpVisitList"]',
  ]);
  if (!ok) throw new Error('Could not open View Submitted Visits page');
}

async function enterPortalContext(kind, page, mhc) {
  if (kind === 'mhc') {
    await mhc.ensureAtMhcHome();
    await openViewSubmitted(page);
    return;
  }

  if (kind === 'singlife') {
    await mhc.ensureAtMhcHome();
    const switched = await mhc.switchToSinglifeIfNeeded({ force: true }).catch(() => false);
    if (!switched) throw new Error('Failed to switch to Singlife context');
    await openViewSubmitted(page);
    return;
  }

  if (kind === 'aia') {
    await mhc.ensureAtMhcHome();
    const switched = await mhc._switchSystemTo(/aia\s*clinic/i, 'AIA Clinic').catch(() => false);
    if (!switched) throw new Error('Failed to switch to AIA Clinic context');
    await openViewSubmitted(page);
    return;
  }

  throw new Error(`Unknown portal context: ${kind}`);
}

async function runSearch(page, row) {
  const dmy = toDmy(row.visit_date);
  const [day, month, year] = dmy.split('/');

  const fillByName = async (name, value) => {
    const loc = page.locator(`input[name="${name}"]`).first();
    if ((await loc.count().catch(() => 0)) > 0) {
      await loc.fill(String(value || ''), { timeout: 8000 }).catch(async () => {
        await loc.click({ timeout: 3000 }).catch(() => {});
        await page.keyboard.press('Control+A').catch(() => {});
        await page.keyboard.type(String(value || '')).catch(() => {});
      });
    }
  };

  await fillByName('fromDateDay', day || '');
  await fillByName('fromDateMonth', month || '');
  await fillByName('fromDateYear', year || '');
  await fillByName('toDateDay', day || '');
  await fillByName('toDateMonth', month || '');
  await fillByName('toDateYear', year || '');

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

  await fillByName('keyValue', row.nric || '');

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
        raw: cells,
      });
    }

    const pageText = clean(document.body?.textContent || '').slice(0, 4000);
    return { rows, pageText, url: location.href, title: document.title };
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

function mergeNotes(oldNotes, extra) {
  const a = String(oldNotes || '').trim();
  const b = String(extra || '').trim();
  if (!a) return b;
  if (!b) return a;
  if (a.includes(b)) return a;
  return `${a}; ${b}`;
}

async function main() {
  const csvText = fs.readFileSync(truthCsvPath, 'utf8');
  const { headers, rows } = parseCsv(csvText);
  if (!headers.length) throw new Error(`No headers in ${truthCsvPath}`);

  fs.mkdirSync(evidenceBaseDir, { recursive: true });

  const browserManager = new BrowserManager();
  await browserManager.init();
  const page = await browserManager.newPage();
  const mhc = new MHCAsiaAutomation(page);

  const runDetails = [];
  let currentContext = null;

  try {
    await mhc.login();

    for (const row of rows) {
      const context = portalContextFromPayType(row.pay_type);
      const contextDir = path.join(evidenceBaseDir, context);
      fs.mkdirSync(contextDir, { recursive: true });

      if (currentContext !== context) {
        await enterPortalContext(context, page, mhc);
        currentContext = context;
      }

      await runSearch(page, row);
      const extracted = await extractResultRows(page);
      const match = pickMatch(extracted.rows, row.visit_date, row.patient_name);

      const found = Boolean(match);
      const evidencePath = path.join(contextDir, `${row.visit_id}.png`);
      await page.screenshot({ path: evidencePath, fullPage: true }).catch(() => {});

      row.portal_found = found ? 'yes' : 'no';
      row.portal_status = found ? (match.type ? `submitted:${match.type}` : 'submitted') : 'not_found_in_view_submitted';
      row.portal_reference = found ? (match.visitNo || '') : '';
      row.evidence_path = evidencePath;

      const detailNote = `auto-check:${context}; result_rows=${extracted.rows.length}; url=${extracted.url}`;
      row.notes = mergeNotes(row.notes, detailNote);

      if (String(row.nric || '').toUpperCase() === 'M4427511W' && !found) {
        row.notes = mergeNotes(
          row.notes,
          'Accepted exception confirmed: member not found in View Submitted Claim'
        );
      }

      runDetails.push({
        visit_id: row.visit_id,
        context,
        found,
        matched_row: match,
        rows_seen: extracted.rows,
        page_url: extracted.url,
      });

      console.log(`[truth-check] ${row.visit_id} ${row.nric} ${context} => ${found ? 'FOUND' : 'NOT_FOUND'}`);
    }
  } finally {
    await browserManager.close().catch(() => {});
  }

  fs.writeFileSync(truthCsvPath, stringifyCsv(headers, rows));
  fs.writeFileSync(resultJsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), details: runDetails }, null, 2));

  const counts = rows.reduce(
    (acc, r) => {
      const pf = String(r.portal_found || '').toLowerCase();
      if (pf === 'yes' || pf === 'true') acc.found += 1;
      else if (pf === 'no' || pf === 'false') acc.not_found += 1;
      else acc.unknown += 1;
      return acc;
    },
    { found: 0, not_found: 0, unknown: 0 }
  );

  console.log(`Updated truth sheet: ${truthCsvPath}`);
  console.log(`Evidence dir: ${evidenceBaseDir}`);
  console.log(`Detail JSON: ${resultJsonPath}`);
  console.log(`Counts => found=${counts.found}, not_found=${counts.not_found}, unknown=${counts.unknown}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
