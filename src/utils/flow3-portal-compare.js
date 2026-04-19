function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDate(value) {
  const raw = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return '';
  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy)
    return `${dmy[3]}-${String(Number(dmy[2])).padStart(2, '0')}-${String(Number(dmy[1])).padStart(2, '0')}`;
  const ymd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd)
    return `${ymd[1]}-${String(Number(ymd[2])).padStart(2, '0')}-${String(Number(ymd[3])).padStart(2, '0')}`;
  return normalizeText(raw);
}

function normalizeAmount(value) {
  const raw = String(value || '')
    .replace(/,/g, '')
    .trim();
  if (!raw) return '';
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) return '';
  const num = Number(match[0]);
  if (!Number.isFinite(num)) return '';
  return num.toFixed(2);
}

function compareField(field, expected, actual) {
  const key = String(field || '');
  if (!expected || !actual) return false;
  if (key === 'visitDate') return normalizeDate(expected) === normalizeDate(actual);
  if (key === 'amount') {
    const e = normalizeAmount(expected);
    const a = normalizeAmount(actual);
    return !!e && !!a && Number(e) === Number(a);
  }
  const e = normalizeText(expected);
  const a = normalizeText(actual);
  if (!e || !a) return false;
  return a.includes(e) || e.includes(a);
}

function buildExpectedFromVisit(visit) {
  const md = visit?.extraction_metadata || {};
  return {
    visitDate: String(visit?.visit_date || ''),
    diagnosis: String(
      visit?.diagnosis_description ||
        visit?.diagnosis_desc ||
        md?.diagnosisCanonical?.description_canonical ||
        md?.diagnosis?.description ||
        ''
    ),
    amount: String(
      visit?.total_amount ??
        visit?.totalAmount ??
        visit?.consultation_fee ??
        visit?.consultationFee ??
        visit?.charge_amount ??
        md?.consultationAmount ??
        ''
    ),
    provider: String(md?.providerName || md?.provider_name || md?.doctor || ''),
  };
}

function buildComparisonPayload(expected, baseline, baselineSource) {
  const fields = ['visitDate', 'diagnosis', 'amount', 'provider'];
  const matchedFields = [];
  const mismatchedFields = [];

  for (const field of fields) {
    const exp = String(expected?.[field] || '').trim();
    const act = String(baseline?.[field] || '').trim();
    if (!exp || !act) continue;
    if (compareField(field, exp, act)) {
      matchedFields.push(field);
    } else {
      mismatchedFields.push({
        field,
        expected: exp,
        actual: act,
      });
    }
  }

  if (matchedFields.length === 0 && mismatchedFields.length === 0) {
    return {
      baselineSource,
      state: 'unavailable',
      matchedFields: [],
      mismatchedFields: [],
      unavailableReason: 'no_comparable_fields',
    };
  }
  if (mismatchedFields.length === 0) {
    return {
      baselineSource,
      state: 'match',
      matchedFields,
      mismatchedFields: [],
      unavailableReason: null,
    };
  }
  if (matchedFields.length > 0) {
    return {
      baselineSource,
      state: 'partial',
      matchedFields,
      mismatchedFields,
      unavailableReason: null,
    };
  }
  return {
    baselineSource,
    state: 'mismatch',
    matchedFields: [],
    mismatchedFields,
    unavailableReason: null,
  };
}

function parseIxchangeClaimSnippet(snippet) {
  const text = String(snippet || '');
  if (!text) return null;
  const pick = re => {
    const m = text.match(re);
    return m?.[1] ? String(m[1]).trim() : '';
  };
  const visitDate = pick(/"visitDate"\s*:\s*"([^"]+)"/i);
  const diagnosis = pick(/"diagnosis(?:Description|Text|)"\s*:\s*"([^"]+)"/i);
  const amount =
    pick(/"consultFee"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i) ||
    pick(/"invoiceAmount"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i) ||
    pick(/"retailClaimAmount"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);
  const provider =
    pick(/"doctorName"\s*:\s*"([^"]+)"/i) ||
    pick(/"providerName"\s*:\s*"([^"]+)"/i) ||
    pick(/"serviceProviderName"\s*:\s*"([^"]+)"/i);
  if (!visitDate && !diagnosis && !amount && !provider) return null;
  return {
    visitDate,
    diagnosis,
    amount,
    provider,
  };
}

// Preserved for potential future re-enablement; currently bypassed because
// it reads the bot's freshly-created blank claim instead of admin's filed
// one. See comment in comparePortalLatestClaim.
 
async function _readIxchangeLatestClaim(page, state) {
  const visitId =
    state?.form_navigation?.visitId ||
    String(page.url() || '').match(/\/spos\/claim\/edit\/(\d+)/i)?.[1] ||
    null;

  if (!visitId) {
    return { ok: false, reason: 'missing_visit_id' };
  }

  const apiResult = await page
    .evaluate(async id => {
      try {
        const endpoint = `https://www.parkwaydigihealth.com/o2/api/claim-payment/claim/${id}`;
        const res = await globalThis.fetch(endpoint, { credentials: 'include' });
        if (!res.ok) return { ok: false, reason: `http_${res.status}` };
        const json = await res.json();
        return { ok: true, json };
      } catch (error) {
        return { ok: false, reason: String(error?.message || error || 'fetch_failed') };
      }
    }, String(visitId))
    .catch(() => ({ ok: false, reason: 'evaluate_failed' }));

  if (!apiResult?.ok || !apiResult?.json) {
    const logEntries = Array.isArray(state?.form_navigation?.inPageNetworkLog)
      ? state.form_navigation.inPageNetworkLog
      : [];
    const claimLog = [...logEntries]
      .reverse()
      .find(
        entry =>
          /\/claim-payment\/claim\//i.test(String(entry?.url || '')) && entry?.responseSnippet
      );
    const fallback = parseIxchangeClaimSnippet(claimLog?.responseSnippet || '');
    if (fallback) {
      return {
        ok: true,
        source: 'ixchange_claim_api_snippet_fallback',
        baseline: fallback,
      };
    }
    return { ok: false, reason: apiResult?.reason || 'api_unavailable' };
  }

  const header = apiResult.json?.claimHeader || {};
  const diagnosisItems = Array.isArray(header?.claimDiagnosisList)
    ? header.claimDiagnosisList
    : Array.isArray(apiResult.json?.claimDiagnosisList)
      ? apiResult.json.claimDiagnosisList
      : [];
  const diagnosisText = diagnosisItems
    .map(item => item?.description || item?.diagnosisDescription || item?.diagnosis || '')
    .filter(Boolean)
    .join('; ');

  return {
    ok: true,
    source: `ixchange_claim_api:${visitId}`,
    baseline: {
      visitDate: header?.visitDate || '',
      diagnosis: diagnosisText,
      amount:
        header?.consultFee ||
        header?.invoiceAmount ||
        header?.retailClaimAmount ||
        header?.bookedAmountByBenefitCurrency ||
        '',
      provider:
        header?.doctorName ||
        header?.providerName ||
        header?.serviceProviderName ||
        header?.createdBy ||
        '',
    },
  };
}

// Preserved for potential future re-enablement; currently bypassed because
// the search-form on /visit_list could not be reliably navigated.
 
async function _readFullertonLatestClaim(page, expectedNric = '') {
  const claimsHistoryHref = await page
    .evaluate(() => {
      const anchors = Array.from(globalThis.document?.querySelectorAll?.('a') || []);
      for (const anchor of anchors) {
        const text = String(anchor.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
        const href = String(anchor.getAttribute?.('href') || '');
        if (!href) continue;
        if (text.includes('claims history') || /claim_history|claims/i.test(href)) {
          return href;
        }
      }
      return '';
    })
    .catch(() => '');

  if (!claimsHistoryHref) return { ok: false, reason: 'claims_history_nav_missing' };
  let claimPage = null;
  try {
    claimPage = await page.context().newPage();
    const absoluteHref = new URL(claimsHistoryHref, page.url()).toString();
    await claimPage.goto(absoluteHref, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await claimPage.waitForTimeout(1500);

    // Discovered from cmp-form-diag: Fullerton lands on /visit_list which is a
    // search-criteria page with an EMPTY results table until you submit a
    // search. Headers exist (Visit Date / Patient Name / National ID No. /
    // ...) but no data rows. We must fill From/To Date + (optional) NRIC and
    // click Search to populate. The actual input names are discovered by
    // fuzzy attribute matching so this works without the live portal in hand.
    const searchExecuted = await claimPage
      .evaluate(nricToken => {
        const norm = v =>
          String(v || '')
            .replace(/\s+/g, ' ')
            .trim();
        const matchInput = predicate => {
          const all = Array.from(globalThis.document?.querySelectorAll?.('input, select') || []);
          return all.find(el => {
            if (el.type === 'hidden') return false;
            const haystack = `${el.name || ''} ${el.id || ''} ${el.placeholder || ''} ${
              el.getAttribute('aria-label') || ''
            }`.toLowerCase();
            return predicate(haystack);
          });
        };
        const fromInput = matchInput(s => /from.*date|date.*from|fromdate/i.test(s));
        const toInput = matchInput(s => /to.*date|date.*to|todate/i.test(s));
        const nricInput = matchInput(s =>
          /(national.*id|id.*no|nric|patient.*id|identity)/i.test(s)
        );
        // Set wide date range covering past 60 days.
        const today = new Date();
        const past = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000);
        const dmy = d =>
          `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(
            2,
            '0'
          )}/${d.getFullYear()}`;
        const fillField = (el, val) => {
          if (!el) return false;
          el.focus();
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        };
        const filledFrom = fillField(fromInput, dmy(past));
        const filledTo = fillField(toInput, dmy(today));
        const nricStr = String(nricToken || '').trim();
        const filledNric = nricStr ? fillField(nricInput, nricStr) : false;
        // Click Search button: prefer one whose text/value mentions "search".
        const buttons = Array.from(
          globalThis.document?.querySelectorAll?.(
            'button, input[type=submit], input[type=button]'
          ) || []
        );
        const searchBtn = buttons.find(b => {
          const t = norm(b.textContent || b.value || '').toLowerCase();
          return /search/i.test(t);
        });
        if (searchBtn) searchBtn.click();
        return {
          filledFrom,
          filledTo,
          filledNric,
          clickedSearch: Boolean(searchBtn),
          fromName: fromInput?.name || fromInput?.id || null,
          toName: toInput?.name || toInput?.id || null,
        };
      }, expectedNric)
      .catch(e => ({ error: String(e?.message || e || 'search_eval_failed') }));

    // Search-form fill is best-effort; unsuccessful execution is logged inline
    // via the parse fallback's reason rather than as a separate noisy entry.
    if (!searchExecuted?.clickedSearch) {
      console.log(
        `[FULLERTON][cmp-search-skipped] ${JSON.stringify(searchExecuted).slice(0, 200)}`
      );
    }
    // Allow the search to round-trip and the results table to render.
    await claimPage.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => null);
    await claimPage.waitForTimeout(1500);
    const baseline = await claimPage
      .evaluate(nricToken => {
        const norm = value =>
          String(value || '')
            .replace(/\s+/g, ' ')
            .trim();
        const amountLike = value => {
          const m = norm(value)
            .replace(/,/g, '')
            .match(/\d+(?:\.\d{1,2})?/);
          return m ? m[0] : '';
        };
        const isDateLike = value =>
          /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/.test(norm(value)) ||
          /\b\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\b/.test(norm(value));

        // Strategy: locate the table whose THEAD (or first all-<th> row) exposes
        // a "Diagnosis" column header, then index columns by header text. This
        // is robust against header rows leaking into <tbody>, narrow filter rows
        // (From Date / To Date), and varying header labels like "National ID
        // No." vs "NRIC" — none of which a content-based blacklist could cover.
        const tables = Array.from(globalThis.document?.querySelectorAll?.('table') || []);
        let chosenTable = null;
        let headerCells = [];
        for (const table of tables) {
          // Prefer <thead><tr><th>; fall back to first row whose cells are ALL <th>.
          let ths = Array.from(table.querySelectorAll('thead tr th'));
          if (!ths.length) {
            const firstRow = table.querySelector('tr');
            if (firstRow) {
              const cells = Array.from(firstRow.children);
              if (cells.length && cells.every(c => c.tagName === 'TH')) ths = cells;
            }
          }
          if (!ths.length) continue;
          const labels = ths.map(th => norm(th.textContent || '').toLowerCase());
          if (labels.some(l => /diagnos/i.test(l))) {
            chosenTable = table;
            headerCells = labels;
            break;
          }
        }
        // Fallback when no <thead> / th-row exposes Diagnosis: collect every
        // <th> label anywhere on the page and use THAT as the exclusion set
        // for diagnosis-cell picking. Covers portals whose headers are inside
        // <tbody> or rendered without semantic <thead>.
        if (!chosenTable) {
          const pageHeaderLabels = new Set();
          const allThs = Array.from(globalThis.document?.querySelectorAll?.('th') || []);
          for (const th of allThs) {
            const t = norm(th.textContent || '').toLowerCase();
            if (t) pageHeaderLabels.add(t);
          }
          // Also harvest header-looking text from any cell with role="columnheader"
          const rc = Array.from(
            globalThis.document?.querySelectorAll?.('[role="columnheader"]') || []
          );
          for (const c of rc) {
            const t = norm(c.textContent || '').toLowerCase();
            if (t) pageHeaderLabels.add(t);
          }

          // Find any <table> containing rows with date-like cells AND cells whose
          // text isn't in the header-label set — that's the data table.
          const allTables = Array.from(globalThis.document?.querySelectorAll?.('table') || []);
          const candidates = [];
          for (const table of allTables) {
            const rows = Array.from(table.querySelectorAll('tr'));
            for (const row of rows) {
              const tds = Array.from(row.querySelectorAll('td'));
              if (!tds.length) continue;
              const cells = tds.map(td => norm(td.textContent || ''));
              if (!cells.some(isDateLike)) continue;
              candidates.push(cells);
            }
          }
          if (!candidates.length) {
            return { __debug: 'no_table_with_diagnosis_header_and_no_date_rows_anywhere' };
          }
          const normalizedNric = norm(nricToken).toUpperCase();
          let chosen = candidates[0];
          if (normalizedNric) {
            const hit = candidates.find(cells =>
              cells.some(c => c.toUpperCase().includes(normalizedNric))
            );
            if (hit) chosen = hit;
          }
          const dateCell = chosen.find(isDateLike) || '';
          const amountCell =
            [...chosen]
              .reverse()
              .map(amountLike)
              .find(v => v && (v.includes('.') || Number(v) >= 10)) || '';
          const diagnosisCell =
            chosen.find(cell => {
              if (!cell) return false;
              const low = cell.toLowerCase();
              if (pageHeaderLabels.has(low)) return false;
              if (isDateLike(cell)) return false;
              if (/^[STFGM]\d{7}[A-Z]$/i.test(cell)) return false;
              if (/^\d+(?:\.\d{1,2})?$/.test(cell.replace(/,/g, ''))) return false;
              if (/^(select|edit|view|delete|details)$/i.test(cell)) return false;
              // Don't pick very short fragments (<=3 chars) — usually S/No or row-index.
              if (cell.length <= 3) return false;
              return true;
            }) || '';
          return {
            visitDate: dateCell,
            diagnosis: diagnosisCell,
            amount: amountCell || '',
            provider: '',
            __debug: `fallback_page_headers:[${[...pageHeaderLabels].slice(0, 12).join('|')}]`,
          };
        }

        const colIdx = predicate => headerCells.findIndex(predicate);
        const diagnosisIdx = colIdx(l => /diagnos/i.test(l));
        const dateIdx = colIdx(
          l => /visit\s*date/i.test(l) || (/date/i.test(l) && !/(from|to|reg|created)/i.test(l))
        );
        const amountIdx = colIdx(l => /amount|fee|total/i.test(l));
        const nricIdx = colIdx(l => /nric|national\s*id|id\s*no/i.test(l));

        // Collect all data rows: <tbody> rows whose cell count matches header
        // length AND that contain at least one date-like cell (filters out
        // sub-header rows with "From Date" / "To Date" filter inputs).
        const tbodyRows = Array.from(chosenTable.querySelectorAll('tbody tr'));
        const dataRows = tbodyRows
          .map(row => {
            const tds = Array.from(row.querySelectorAll('td'));
            if (!tds.length) return null;
            const cells = tds.map(td => norm(td.textContent || ''));
            if (cells.length !== headerCells.length) return null;
            // Reject if every non-empty cell exactly equals its header label
            // (a header row leaked into tbody).
            const looksLikeHeader = cells.every((c, i) => !c || c.toLowerCase() === headerCells[i]);
            if (looksLikeHeader) return null;
            // Require at least one date-like cell — real claim rows always have one.
            if (!cells.some(isDateLike)) return null;
            return cells;
          })
          .filter(Boolean);

        if (!dataRows.length) return null;

        const normalizedNric = norm(nricToken).toUpperCase();
        let chosen = dataRows[0];
        if (normalizedNric) {
          const byNric = dataRows.find(cells => {
            if (nricIdx >= 0) return cells[nricIdx]?.toUpperCase().includes(normalizedNric);
            return cells.some(c => c.toUpperCase().includes(normalizedNric));
          });
          if (byNric) chosen = byNric;
        }

        const dateCell =
          (dateIdx >= 0 && isDateLike(chosen[dateIdx]) ? chosen[dateIdx] : '') ||
          chosen.find(isDateLike) ||
          '';
        const diagnosisCell = diagnosisIdx >= 0 ? chosen[diagnosisIdx] : '';
        const amountCell =
          amountIdx >= 0
            ? amountLike(chosen[amountIdx])
            : [...chosen]
                .reverse()
                .map(amountLike)
                .find(v => v && (v.includes('.') || Number(v) >= 10)) || '';

        return {
          visitDate: dateCell,
          diagnosis: diagnosisCell,
          amount: amountCell || '',
          provider: '',
        };
      }, expectedNric)
      .catch(() => null);
    if (!baseline) return { ok: false, reason: 'claims_history_parse_failed' };
    if (baseline && !baseline.diagnosis && !baseline.visitDate && !baseline.amount) {
      return {
        ok: false,
        reason: `claims_history_parse_empty:${String(baseline.__debug || '').slice(0, 160)}`,
      };
    }
    if (baseline?.__debug) delete baseline.__debug;
    return { ok: true, source: 'fullerton_claims_history_latest', baseline };
  } catch (error) {
    return { ok: false, reason: String(error?.message || error || 'claims_history_open_failed') };
  } finally {
    if (claimPage) {
      await claimPage.close().catch(() => null);
    }
  }
}

// Build a baseline (admin-truth) from fillVerification.priorValue captured by
// portal-generic-submitter._fillAndVerify just before the bot wrote each
// field. This is the universal, portal-agnostic source of truth: whatever
// was in the field when the bot arrived IS what the admin had filed.
const MONTH_TO_NUM = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function tryParseDateLoose(raw) {
  // Accept additional human-readable formats Fullerton/MHC display:
  //   "19 Apr 2026", "19-Apr-2026", "Apr 19 2026", "Apr 19, 2026"
  const v = String(raw || '').trim();
  if (!v) return '';
  // First try the strict normaliser (handles d/m/yyyy and yyyy-m-d)
  const strict = normalizeDate(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(strict)) return strict;
  // "19 Apr 2026" / "19-Apr-2026"
  let m = v.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s-]+(\d{4})$/);
  if (m) {
    const mon = MONTH_TO_NUM[m[2].slice(0, 3).toLowerCase()];
    if (mon)
      return `${m[3]}-${String(mon).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
  }
  // "Apr 19 2026" / "Apr 19, 2026"
  m = v.match(/^([A-Za-z]{3,9})[\s-]+(\d{1,2}),?[\s-]+(\d{4})$/);
  if (m) {
    const mon = MONTH_TO_NUM[m[1].slice(0, 3).toLowerCase()];
    if (mon)
      return `${m[3]}-${String(mon).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
  }
  return '';
}

function isTodayDateString(value) {
  // Many portals auto-default the visit-date input to today's date on form
  // open. That value is NOT admin truth — it's a form default. Detect it so
  // the comparator can skip it instead of falsely reporting a mismatch.
  const norm = tryParseDateLoose(value);
  if (!norm) return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return norm === today;
}

function buildBaselineFromPriorValues(state) {
  const fv = state?.fillVerification || {};
  // pickStrict: priorValue ONLY. Use for amount, where readonly observed
  // values are typically portal-computed program rates / consultation caps
  // (e.g. Fullerton always shows 70.00, IXCHANGE shows the program rate)
  // and would falsely flag every visit as "amount mismatch" against admin.
  const pickStrict = entry => {
    if (!entry?.priorValue) return '';
    return String(entry.priorValue).trim();
  };
  // pickSoft: priorValue OR readonly/skipped observed. Use for fields where
  // the portal genuinely renders the admin-entered value as readonly (e.g.
  // visitDate locked after admin pick, diagnosis text reflected back).
  const pickSoft = entry => {
    if (!entry) return '';
    if (entry.priorValue) return String(entry.priorValue).trim();
    const status = String(entry.status || '');
    if ((status === 'readonly' || status === 'skipped') && entry.observed) {
      return String(entry.observed).trim();
    }
    return '';
  };
  const visitDateRaw = pickSoft(fv?.visitDate);
  // Suppress visitDate baseline when it matches today — that's the portal's
  // auto-populated default, not admin's claim date.
  const visitDate = isTodayDateString(visitDateRaw) ? '' : visitDateRaw;
  const baseline = {
    visitDate,
    diagnosis: pickSoft(fv?.diagnosis),
    amount: pickStrict(fv?.fee),
    provider: '',
  };
  const hasAny = Boolean(baseline.visitDate || baseline.diagnosis || baseline.amount);
  return { baseline, hasAny };
}

export async function comparePortalLatestClaim({ portalTarget, page, visit, state }) {
  const target = String(portalTarget || '').toUpperCase();
  const expected = buildExpectedFromVisit(visit);
  const nric = String(state?.nric || visit?.nric || visit?.extraction_metadata?.nric || '').trim();

  // Primary baseline: pre-fill values captured by _fillAndVerify. This is the
  // most reliable admin-truth signal because it reads the actual form fields
  // the bot operated on, not a separate (possibly stale or mis-navigated)
  // claims-history scrape. Works for any portal where the bot opens an
  // admin-created form (Fullerton patient_search → row click; MHC visit
  // detail; etc.). Does NOT work when the bot creates a fresh blank claim
  // (IXCHANGE current behaviour) — in that case priorValues are all empty.
  const { baseline: priorBaseline, hasAny: hasPriorAny } = buildBaselineFromPriorValues(state);
  if (hasPriorAny) {
    return buildComparisonPayload(
      expected,
      priorBaseline,
      `${target.toLowerCase()}_form_priorvalue`
    );
  }

  // No priorValue baseline available. Portal-specific scrapers
  // (readIxchangeLatestClaim / readFullertonLatestClaim) historically
  // produced misleading "actuals" in this case:
  //   - IXCHANGE: snippet fallback returns 0 for the bot's freshly-created
  //     blank claim (NOT admin's filed one)
  //   - FULLERTON: claims-history page is empty until search submitted; the
  //     search-form fix never identified the right inputs
  // Lying ("actual=0", "actual=From Date") is worse than "unavailable" — it
  // masks real bot-fill issues and triggers false alarms on dashboards.
  // Until those scrapers are reworked with verified portal access, return
  // unavailable instead. Suppress unused params to keep the API surface
  // stable for future fallback re-enablement.
  void page;
  void nric;
  return {
    baselineSource: null,
    state: 'unavailable',
    matchedFields: [],
    mismatchedFields: [],
    unavailableReason: 'no_admin_prefill_captured',
  };
}
