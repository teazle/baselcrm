#!/usr/bin/env node

/**
 * Flow 3 Portal Admin-Submission Audit (Option B)
 *
 * Walks the MHC + AIA "Claims History / Submitted Visits" listing for a date
 * range, scrapes every admin-submitted claim, and cross-references each one
 * against our `visits` table to answer:
 *
 *   - Phase 1 hit?   Did we ingest a visit for this patient + visit_date?
 *   - Phase 2 match? Does our extracted total_amount match what the admin
 *                    submitted? (Diagnosis comparison requires --deep.)
 *
 * The companion harness `flow3-portal-truth-audit.js` goes the OTHER direction
 * (DB → portal); this one is portal → DB, the only way to surface Phase-1
 * misses (visits the admin submitted that we never imported).
 *
 * NOTE: the AIA listing columns are:
 *   Visit Date | Visit No | Type | Patient Name | Total Fee | Total Claim | MC Days
 * There is NO NRIC column on the listing, so cross-reference uses
 * patient_name + visit_date (NRIC enrichment requires --deep).
 *
 * Usage:
 *   node src/examples/flow3-portal-admin-audit.js --from 2026-04-01 --to 2026-04-19
 *   node src/examples/flow3-portal-admin-audit.js --from 2026-04-14 --to 2026-04-14 --deep
 *
 * Read-only: never writes back to the DB.
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { BrowserManager } from '../utils/browser.js';
import { createSupabaseClient } from '../utils/supabase-client.js';
import { logger } from '../utils/logger.js';
import { MHCAsiaAutomation } from '../automations/mhc-asia.js';

function usage() {
  console.log(`
Audit admin-submitted claims on MHC/AIA portal vs our Phase 1/Phase 2 records

Usage:
  node src/examples/flow3-portal-admin-audit.js --from 2026-04-01 --to 2026-04-19
  node src/examples/flow3-portal-admin-audit.js --from 2026-04-14 --to 2026-04-14 --deep --limit 5

Options:
  --from <YYYY-MM-DD>   Start date (inclusive)
  --to   <YYYY-MM-DD>   End date (inclusive)
  --contexts <list>     Comma-separated, default "mhc,aia"
  --limit <n>           Max admin rows to deep-capture (default 0 = no deep)
  --deep                Open each admin row to capture diagnosis/MC/etc
  --leave-open          Keep browser open
  --help, -h            Show this help
`);
}

function parseArgs(argv) {
  const out = {
    from: null,
    to: null,
    contexts: ['mhc', 'aia'],
    limit: 0,
    deep: false,
    leaveOpen: false,
    help: false,
  };
  const read = i => {
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${argv[i]}`);
    return next;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--deep') out.deep = true;
    else if (arg === '--leave-open') out.leaveOpen = true;
    else if (arg === '--from') {
      out.from = read(i);
      i += 1;
    } else if (arg.startsWith('--from=')) out.from = arg.split('=')[1] || null;
    else if (arg === '--to') {
      out.to = read(i);
      i += 1;
    } else if (arg.startsWith('--to=')) out.to = arg.split('=')[1] || null;
    else if (arg === '--contexts') {
      out.contexts = read(i)
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
      i += 1;
    } else if (arg === '--limit') {
      out.limit = Number.parseInt(read(i), 10);
      i += 1;
    } else if (arg.startsWith('--limit=')) {
      out.limit = Number.parseInt(arg.split('=')[1] || '0', 10);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!out.from || !dateRe.test(out.from)) throw new Error(`--from required (YYYY-MM-DD)`);
  if (!out.to || !dateRe.test(out.to)) throw new Error(`--to required (YYYY-MM-DD)`);
  if (out.from > out.to) throw new Error(`--from must be <= --to`);
  if (!Number.isFinite(out.limit) || out.limit < 0) out.limit = 0;
  if (!out.contexts.length) out.contexts = ['mhc', 'aia'];
  return out;
}

function nowStamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function normalizeMoney(v) {
  if (v === null || v === undefined || v === '') return null;
  const cleaned = String(v).replace(/[^\d.\-]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function moneyClose(a, b, tolerance = 0.5) {
  if (a === null || b === null) return null;
  return Math.abs(a - b) <= tolerance;
}

function normalizeName(v) {
  return String(v || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameOverlap(a, b) {
  const A = new Set(normalizeName(a).split(' ').filter(Boolean));
  const B = new Set(normalizeName(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let hits = 0;
  for (const t of A) if (B.has(t)) hits += 1;
  return hits / Math.max(A.size, B.size);
}

function mhcDateToIso(s) {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function isoToParts(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { year: m[1], month: m[2], day: m[3] };
}

/**
 * Set the listing's from/to date filter and click Search.
 * The portal uses text inputs named fromDateDay/Month/Year + toDateDay/Month/Year.
 */
async function applyDateRange(page, fromIso, toIso) {
  const f = isoToParts(fromIso);
  const t = isoToParts(toIso);
  if (!f || !t) return false;
  const result = await page.evaluate(
    ({ f, t }) => {
      const set = (name, v) => {
        const el = document.querySelector(`[name="${name}"]`);
        if (!el) return false;
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      };
      return {
        fromDay: set('fromDateDay', f.day),
        fromMonth: set('fromDateMonth', f.month),
        fromYear: set('fromDateYear', f.year),
        toDay: set('toDateDay', t.day),
        toMonth: set('toDateMonth', t.month),
        toYear: set('toDateYear', t.year),
      };
    },
    { f, t }
  );
  // Click Search / submit form
  const btn = page
    .locator(
      'input[name="SearchAction"], input[type="submit"], button:has-text("Search"), button:has-text("Retrieve"), input[value*="Search" i], input[value*="Retrieve" i]'
    )
    .first();
  if ((await btn.count().catch(() => 0)) > 0) {
    await btn.click({ timeout: 10000 }).catch(() => {});
  } else {
    await page.keyboard.press('Enter').catch(() => {});
  }
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(1200);
  return Object.values(result).every(Boolean);
}

/**
 * Row extractor that works for both MHC and AIA listings without depending
 * on a parseable header row. Detects data rows by shape:
 *   cell[A] = DD/MM/YYYY (visit date)
 *   cell[B] = EV\d+ or CL\d+ (visit no)
 *   cell[C] = "Visit" / "Xray" / etc (type)
 *   cell[D] = patient name (free text, all-caps usually)
 *   cell[E,F] = $money (total fee, total claim)
 *   cell[G] = numeric (mc days)
 * The cells immediately after a date cell are mapped positionally.
 */
async function extractAdminRowsByPattern(page) {
  return page.evaluate(() => {
    const clean = v =>
      String(v || '')
        .replace(/\s+/g, ' ')
        .trim();
    const isDate = s => /^\d{2}\/\d{2}\/\d{4}$/.test(s);
    const isVisitNo = s => /^(EV|CL)\d+$/i.test(s);
    const isMoney = s => /^\$?\d+(?:,\d{3})*(?:\.\d{2})?$/.test(s.replace(/\s+/g, ''));
    const isNumberLike = s => /^\d+(?:\.\d+)?$/.test(s.replace(/\s+/g, ''));
    const out = [];
    const seen = new Set();
    for (const tr of Array.from(document.querySelectorAll('tr'))) {
      const cells = Array.from(tr.querySelectorAll('th,td')).map(c => clean(c.textContent));
      if (cells.length < 5) continue;
      // Find the visit-date cell
      const dateIdx = cells.findIndex(isDate);
      if (dateIdx < 0) continue;
      // The next cell should be a visit-no
      if (dateIdx + 1 >= cells.length) continue;
      if (!isVisitNo(cells[dateIdx + 1])) continue;
      const visitDate = cells[dateIdx];
      const visitNo = cells[dateIdx + 1];
      // Skip duplicates (parent TRs that aggregate multiple inner rows)
      const key = `${visitDate}|${visitNo}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Type at dateIdx+2 (e.g. "Visit", "Xray")
      const type = cells[dateIdx + 2] || '';
      // Patient name at dateIdx+3 (free text, usually uppercase)
      const patientName = cells[dateIdx + 3] || '';
      // Money columns: scan the remaining cells
      const remaining = cells.slice(dateIdx + 4);
      const moneyCells = remaining.filter(isMoney);
      const totalFee = moneyCells[0] || '';
      const totalClaim = moneyCells[1] || moneyCells[0] || '';
      // MC days: first numeric cell after the money cells
      const lastMoneyIdx = remaining.findIndex(c => c === (moneyCells[1] || moneyCells[0] || ''));
      const afterMoney = lastMoneyIdx >= 0 ? remaining.slice(lastMoneyIdx + 1) : [];
      const mcDays = afterMoney.find(isNumberLike) || '';
      // Action element
      const action = tr.querySelector(
        'a[href], button, input[type="button"], input[type="submit"]'
      );
      const actionText = action ? clean(action.textContent || action.value || '') : '';
      const actionHref = action?.getAttribute?.('href') || '';
      out.push({
        visitDate,
        visitNo,
        type,
        patientName,
        totalFee,
        totalClaim,
        mcDays,
        remarks: '',
        actionText,
        actionHref,
      });
    }
    return { rows: out, url: location.href };
  });
}

async function findPhase1Visit(supabase, { isoDate, patientName, adminTotal = null }) {
  if (!isoDate) return { match: null, candidates: [], matchedBy: null };

  // Pull all visits for that date and match by patient name
  const { data, error } = await supabase
    .from('visits')
    .select(
      'id,patient_name,visit_date,pay_type,nric,total_amount,amount_outstanding,diagnosis_description,extraction_metadata,submission_metadata,source'
    )
    .eq('visit_date', isoDate)
    .limit(200);
  if (error) return { match: null, candidates: [], matchedBy: null };
  const candidates = data || [];
  if (!candidates.length) return { match: null, candidates: [], matchedBy: 'no_visits_on_date' };

  // Score by name overlap
  const scored = candidates
    .map(v => ({ v, score: nameOverlap(v.patient_name, patientName) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 0.25) {
    return { match: null, candidates, matchedBy: 'no_name_match' };
  }

  // Tie-break by admin amount when multiple candidates share the top name-overlap
  // score. Prevents (for example) PNG CHONG YU CAVAN being matched to his
  // CREDIT CARD $283.40 visit when the admin actually submitted the panel
  // $87.20 visit on the same date.
  const topScore = best.score;
  const ties = scored.filter(s => Math.abs(s.score - topScore) < 0.01);
  let chosen = best;
  let matchedBy = `name_overlap_${best.score.toFixed(2)}`;
  if (ties.length > 1 && Number.isFinite(Number(adminTotal))) {
    const target = Number(adminTotal);
    const ranked = ties
      .map(s => ({
        s,
        diff: Math.abs(Number(s.v.total_amount || 0) - target),
      }))
      .sort((a, b) => a.diff - b.diff);
    chosen = ranked[0].s;
    const amountClose = ranked[0].diff < 0.01;
    matchedBy = `name_overlap_${chosen.score.toFixed(2)}+amount_${amountClose ? 'exact' : `closest_${ranked[0].diff.toFixed(2)}`}`;
  } else if (best.score < 0.5) {
    matchedBy = `name_overlap_low_${best.score.toFixed(2)}`;
  }

  return { match: chosen.v, candidates, matchedBy };
}

function classifyPhase2(adminRow, visit, deepSnapshot = null) {
  const adminTotal = normalizeMoney(adminRow.totalClaim);
  const ourTotal = visit ? Number(visit.total_amount || 0) : null;
  const totalAgree = moneyClose(adminTotal, ourTotal);

  const ourDiag =
    visit?.diagnosis_description || visit?.extraction_metadata?.diagnosisCanonical || null;
  const adminDiag = deepSnapshot?.diagnosisText || deepSnapshot?.diagnosisCode || null;
  let diagAgree = null;
  if (ourDiag && adminDiag) {
    const a = String(ourDiag)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    const b = String(adminDiag)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    diagAgree = a === b || a.includes(b) || b.includes(a);
  }

  return { adminTotal, ourTotal, totalAgree, ourDiag, adminDiag, diagAgree };
}

function buildReportMarkdown({ generatedAt, scope, summary, rows }) {
  const L = [];
  L.push('# Flow 3 Portal Admin-Submission Audit (portal → DB)');
  L.push('');
  L.push(`Generated: ${generatedAt}`);
  L.push(`Date range: ${scope.from} → ${scope.to}`);
  L.push(`Contexts: ${scope.contexts.join(', ')}`);
  L.push(`Deep capture: ${scope.deep ? `yes (limit ${scope.limit || 'all'})` : 'no'}`);
  L.push('');
  L.push('## Summary');
  L.push('');
  L.push(`- Admin submissions discovered: **${summary.adminRows}**`);
  L.push(`  - MHC context: ${summary.byContext.mhc || 0}`);
  L.push(`  - AIA context: ${summary.byContext.aia || 0}`);
  L.push(`- Phase 1 hits (visit found in our DB): **${summary.phase1Hit}** / ${summary.adminRows}`);
  L.push(`- Phase 1 misses (admin submitted, visit absent): **${summary.phase1Miss}**`);
  L.push(
    `- Phase 2 total_amount agree: **${summary.totalAgree}** of ${summary.totalCheckable} checkable`
  );
  L.push(`- Phase 2 total_amount disagree: **${summary.totalDisagree}**`);
  if (scope.deep) {
    L.push(
      `- Phase 2 diagnosis agree: **${summary.diagAgree}** of ${summary.diagCheckable} checkable`
    );
    L.push(`- Phase 2 diagnosis disagree: **${summary.diagDisagree}**`);
  }
  L.push('');
  L.push('## Rows');
  L.push('');
  L.push(
    '| ctx | admin_visit_no | admin_date | type | admin_name | admin_total | mc | phase1 | matched_by | our_visit_id | our_pay_type | our_total | total_agree | our_diag | admin_diag | diag_agree | notes |'
  );
  L.push(
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  );
  for (const r of rows) {
    const cells = [
      r.context,
      r.adminVisitNo,
      r.adminVisitDate,
      r.adminType,
      r.adminPatientName,
      r.cmp.adminTotal != null ? r.cmp.adminTotal.toFixed(2) : '',
      r.adminMcDays || '',
      r.phase1Status,
      r.matchedBy || '',
      r.ourVisitId || '',
      r.ourPayType || '',
      r.cmp.ourTotal != null ? r.cmp.ourTotal.toFixed(2) : '',
      r.cmp.totalAgree === null ? '-' : r.cmp.totalAgree ? 'yes' : 'NO',
      String(r.cmp.ourDiag || '').slice(0, 40),
      String(r.cmp.adminDiag || '').slice(0, 40),
      r.cmp.diagAgree === null ? '-' : r.cmp.diagAgree ? 'yes' : 'NO',
      r.notes || '',
    ];
    L.push(`| ${cells.map(c => String(c).replace(/\|/g, '/')).join(' | ')} |`);
  }
  return `${L.join('\n')}\n`;
}

async function writeReport(payload) {
  const baseDir = path.resolve(process.cwd(), 'output', 'run-reports');
  await fs.mkdir(baseDir, { recursive: true });
  const base = `flow3_portal_admin_audit_${nowStamp()}`;
  const jsonPath = path.join(baseDir, `${base}.json`);
  const mdPath = path.join(baseDir, `${base}.md`);
  await fs.writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.writeFile(mdPath, buildReportMarkdown(payload), 'utf8');
  return { jsonPath, mdPath };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    logger.error(error.message);
    usage();
    process.exit(2);
  }
  if (args.help) {
    usage();
    return;
  }

  const supabase = createSupabaseClient();
  if (!supabase) {
    logger.error('Supabase client not available. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  const browserManager = new BrowserManager();
  const page = await browserManager.newPage();
  const mhc = new MHCAsiaAutomation(page);

  try {
    await mhc.ensureAtMhcHome();
  } catch (error) {
    if (error?.portalBlocked === true) {
      logger.error('[ADMIN AUDIT] Portal blocked at home', { reason: error?.code });
      process.exit(1);
    }
    throw error;
  }

  const allAdminRows = [];
  let deepCaptured = 0;

  // Helper: detect "kicked to login page" and recover with a fresh login.
  const recoverIfBumped = async ctx => {
    const url = page.url() || '';
    const title = await page.title().catch(() => '');
    const looksLikeLogin =
      /login/i.test(title) ||
      /\/login/i.test(url) ||
      /aiaclinic\.com\/?$/i.test(url) ||
      /mhcasia\.net\/?$/i.test(url);
    if (!looksLikeLogin) return true;
    logger.warn(`[ADMIN AUDIT] Bumped to login on ${ctx} (url=${url}); re-authenticating`);
    try {
      await mhc.login();
    } catch (error) {
      logger.error('[ADMIN AUDIT] Re-login failed', { error: error?.message });
      return false;
    }
    const reswitched = await mhc._switchToPortalContext(ctx).catch(() => false);
    if (!reswitched) return false;
    const reopened = await mhc._openClaimsHistoryPage().catch(() => false);
    return reopened;
  };

  for (const ctx of args.contexts) {
    logger.info(`[ADMIN AUDIT] Context: ${ctx}`);
    const switched = await mhc._switchToPortalContext(ctx).catch(() => false);
    if (!switched) {
      logger.warn(`[ADMIN AUDIT] Could not switch to context ${ctx}, skipping`);
      continue;
    }
    const opened = await mhc._openClaimsHistoryPage().catch(() => false);
    if (!opened) {
      logger.warn(`[ADMIN AUDIT] Could not open claims history for ${ctx}, skipping`);
      continue;
    }
    // Recover if the context switch bumped us to login
    const recovered = await recoverIfBumped(ctx);
    if (!recovered) {
      logger.warn(`[ADMIN AUDIT] Recovery failed for ${ctx}, skipping`);
      continue;
    }

    // The portal pre-fills the date range to the current month and renders
    // results immediately. Re-submitting the form with our keyValue="" tends
    // to return an empty result page (it interprets empty as a real filter).
    // Strategy: scrape the default-loaded view, then filter client-side by
    // ISO date. If the requested range falls outside the default month, log
    // a warning so the operator knows.
    await page.waitForTimeout(2500);
    let extracted = await extractAdminRowsByPattern(page);
    if (!extracted.rows.length) {
      const dbg = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        trCount: document.querySelectorAll('tr').length,
        sampleText: String(document.body?.innerText || '').slice(0, 800),
      }));
      logger.warn(`[ADMIN AUDIT] ${ctx} 0 rows on initial scrape — debug`, dbg);
    }
    logger.info(`[ADMIN AUDIT] ${ctx} initial scrape`, {
      rows: extracted.rows.length,
    });

    // Some listings paginate (15/page). Walk Next links.
    const seenUrls = new Set([extracted.url]);
    let pageGuard = 0;
    while (extracted.rows.length && pageGuard < 20) {
      for (const r of extracted.rows) {
        const isoDate = mhcDateToIso(r.visitDate);
        if (!isoDate) continue;
        if (isoDate < args.from || isoDate > args.to) continue;
        allAdminRows.push({ ...r, context: ctx, isoDate });
      }
      pageGuard += 1;
      // Find Next page link
      const nextLoc = page
        .locator('a:has-text("Next"), input[type="submit"][value="Next"], button:has-text("Next")')
        .first();
      const nextCount = await nextLoc.count().catch(() => 0);
      if (!nextCount) break;
      const href = await nextLoc.getAttribute('href').catch(() => null);
      await nextLoc.click({ timeout: 8000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(900);
      const nextUrl = page.url();
      if (seenUrls.has(nextUrl)) break;
      seenUrls.add(nextUrl);
      extracted = await extractAdminRowsByPattern(page);
      logger.info(`[ADMIN AUDIT] ${ctx} page ${pageGuard + 1}`, {
        rows: extracted.rows.length,
        href,
      });
      if (!extracted.rows.length) break;
    }
  }

  logger.info(`[ADMIN AUDIT] Total admin rows in range: ${allAdminRows.length}`);

  // Cross-reference each admin row against our DB
  const reportRows = [];
  let phase1Hit = 0;
  let phase1Miss = 0;
  let totalAgree = 0;
  let totalDisagree = 0;
  let totalCheckable = 0;
  let diagAgree = 0;
  let diagDisagree = 0;
  let diagCheckable = 0;
  const byContext = {};

  for (const adminRow of allAdminRows) {
    byContext[adminRow.context] = (byContext[adminRow.context] || 0) + 1;
    const lookup = await findPhase1Visit(supabase, {
      isoDate: adminRow.isoDate,
      patientName: adminRow.patientName,
      adminTotal: normalizeMoney(adminRow.totalClaim),
    });
    const visit = lookup.match || null;

    let deepSnapshot = null;
    if (visit && args.deep && (args.limit === 0 || deepCaptured < args.limit)) {
      try {
        const opened = await mhc.openSubmittedClaimDetail({
          nric: visit.nric || '',
          visitDate: adminRow.visitDate,
          patientName: adminRow.patientName,
          contextHint: adminRow.context,
          allowCrossContext: false,
          expectedVisitNo: adminRow.visitNo || null,
        });
        if (opened?.found) {
          deepSnapshot = await mhc.captureCurrentVisitFormSnapshot({
            visit,
            phase: 'admin_audit_deep',
            portalTarget: 'MHC',
            includeScreenshot: false,
          });
          deepCaptured += 1;
        }
        await mhc._switchToPortalContext(adminRow.context).catch(() => {});
        await mhc._openClaimsHistoryPage().catch(() => {});
        await applyDateRange(page, args.from, args.to).catch(() => {});
      } catch (error) {
        logger.warn('[ADMIN AUDIT] Deep capture failed', {
          adminVisitNo: adminRow.visitNo,
          error: error?.message,
        });
      }
    }

    const cmp = classifyPhase2(adminRow, visit, deepSnapshot);
    if (visit) phase1Hit += 1;
    else phase1Miss += 1;
    if (cmp.totalAgree !== null) {
      totalCheckable += 1;
      if (cmp.totalAgree) totalAgree += 1;
      else totalDisagree += 1;
    }
    if (cmp.diagAgree !== null) {
      diagCheckable += 1;
      if (cmp.diagAgree) diagAgree += 1;
      else diagDisagree += 1;
    }

    reportRows.push({
      context: adminRow.context,
      adminVisitNo: adminRow.visitNo,
      adminVisitDate: adminRow.visitDate,
      adminType: adminRow.type,
      adminPatientName: adminRow.patientName,
      adminStatus: 'submitted',
      adminTotal: adminRow.totalClaim,
      adminMcDays: adminRow.mcDays,
      phase1Status: visit ? 'HIT' : 'MISS',
      matchedBy: lookup.matchedBy,
      ourVisitId: visit?.id || null,
      ourPayType: visit?.pay_type || null,
      ourSource: visit?.source || null,
      ourPatientName: visit?.patient_name || null,
      cmp,
      notes: visit ? '' : 'no_phase1_visit_for_date_or_name',
    });
  }

  const summary = {
    adminRows: allAdminRows.length,
    byContext,
    phase1Hit,
    phase1Miss,
    totalAgree,
    totalDisagree,
    totalCheckable,
    diagAgree,
    diagDisagree,
    diagCheckable,
    deepCaptured,
  };

  const payload = {
    generatedAt: new Date().toISOString(),
    scope: {
      from: args.from,
      to: args.to,
      contexts: args.contexts,
      deep: args.deep,
      limit: args.limit,
    },
    summary,
    rows: reportRows,
  };

  const paths = await writeReport(payload);
  logger.info('[ADMIN AUDIT] Report written', paths);
  console.log('\n=== ADMIN AUDIT SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nReport: ${paths.mdPath}`);

  if (!args.leaveOpen) {
    await browserManager.close();
  }
}

main().catch(error => {
  logger.error('Flow 3 portal admin audit failed', {
    error: error?.message || String(error),
  });
  process.exit(1);
});
