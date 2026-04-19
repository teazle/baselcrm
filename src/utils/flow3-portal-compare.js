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

async function readIxchangeLatestClaim(page, state) {
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

async function readFullertonLatestClaim(page, expectedNric = '') {
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
        if (!chosenTable) return null;

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
    return { ok: true, source: 'fullerton_claims_history_latest', baseline };
  } catch (error) {
    return { ok: false, reason: String(error?.message || error || 'claims_history_open_failed') };
  } finally {
    if (claimPage) {
      await claimPage.close().catch(() => null);
    }
  }
}

export async function comparePortalLatestClaim({ portalTarget, page, visit, state }) {
  const target = String(portalTarget || '').toUpperCase();
  const expected = buildExpectedFromVisit(visit);
  const nric = String(state?.nric || visit?.nric || visit?.extraction_metadata?.nric || '').trim();

  if (target === 'IXCHANGE') {
    const baselineRes = await readIxchangeLatestClaim(page, state);
    if (!baselineRes?.ok) {
      return {
        baselineSource: null,
        state: 'unavailable',
        matchedFields: [],
        mismatchedFields: [],
        unavailableReason: baselineRes?.reason || 'ixchange_baseline_unavailable',
      };
    }
    return buildComparisonPayload(expected, baselineRes.baseline, baselineRes.source);
  }

  if (target === 'FULLERTON') {
    const baselineRes = await readFullertonLatestClaim(page, nric);
    if (!baselineRes?.ok) {
      return {
        baselineSource: null,
        state: 'unavailable',
        matchedFields: [],
        mismatchedFields: [],
        unavailableReason: baselineRes?.reason || 'fullerton_baseline_unavailable',
      };
    }
    return buildComparisonPayload(expected, baselineRes.baseline, baselineRes.source);
  }

  return {
    baselineSource: null,
    state: 'unavailable',
    matchedFields: [],
    mismatchedFields: [],
    unavailableReason: 'unsupported_portal_for_comparison',
  };
}
