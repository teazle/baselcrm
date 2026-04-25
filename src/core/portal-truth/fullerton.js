const FULLERTON_BASE_URL = 'https://doctor.fhn3.com/app_index';
const FULLERTON_PATIENT_LIST_URL = 'https://doctor.fhn3.com/patient_list';

export const FULLERTON_SUBMITTED_DETAIL_REASON =
  'submitted_detail_extractor_unavailable_for_fullerton';

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeIdentifier(value) {
  const raw = normalizeText(value).toUpperCase();
  if (!raw) return '';
  const nric = raw.match(/[STFGM]\d{7}[A-Z]/);
  if (nric) return nric[0];
  return raw.replace(/[^A-Z0-9]/g, '');
}

export function collectFullertonMatchCandidates(visit = null) {
  const md = visit?.extraction_metadata || {};
  const candidates = [
    visit?.nric,
    md?.nric,
    md?.fin,
    md?.idNumber,
    md?.patientId,
    md?.memberId,
    visit?.patient_no,
    visit?.patientId,
    visit?.member_id,
    visit?.memberId,
  ]
    .map(normalizeIdentifier)
    .filter(Boolean);
  return [...new Set(candidates)];
}

function probeFullertonPageState(pageProbe = null) {
  const probe = pageProbe && typeof pageProbe === 'object' ? pageProbe : {};
  return {
    url: normalizeText(probe.url || FULLERTON_BASE_URL) || FULLERTON_BASE_URL,
    title: normalizeText(probe.title || ''),
    bodySnippet: normalizeText(probe.bodySnippet || ''),
    claimsHistoryLinkVisible: probe.claimsHistoryLinkVisible === true,
    claimsHistoryLinkHref: normalizeText(probe.claimsHistoryLinkHref || ''),
    patientVerifyVisible: probe.patientVerifyVisible === true,
    visitRegisterVisible: probe.visitRegisterVisible === true,
    searchInputVisible: probe.searchInputVisible === true,
    searchButtonVisible: probe.searchButtonVisible === true,
  };
}

function buildFullertonSubmittedTruthAttempts({ visit, pageProbe, pageUrl }) {
  const candidates = collectFullertonMatchCandidates(visit);
  const probe = probeFullertonPageState({
    ...(pageProbe || {}),
    url: pageProbe?.url || pageUrl || FULLERTON_BASE_URL,
  });

  return [
    {
      kind: 'route_probe',
      matched: false,
      url: probe.url,
      selectors: ['a:has-text("Claims History")', 'a[href*="claim"]', 'a[href*="statement"]'],
      reason: 'submitted_detail_route_not_proven_from_code',
      observed: {
        title: probe.title || null,
        bodySnippet: probe.bodySnippet || null,
      },
    },
    {
      kind: 'session_probe',
      matched: probe.claimsHistoryLinkVisible,
      url: probe.url,
      selectors: ['a:has-text("Claims History")', 'a[href*="patient_list"]'],
      reason: probe.claimsHistoryLinkVisible
        ? 'claims_history_link_visible'
        : 'claims_history_link_not_visible',
      observed: {
        claimsHistoryLinkVisible: probe.claimsHistoryLinkVisible,
        claimsHistoryLinkHref: probe.claimsHistoryLinkHref || null,
        patientVerifyVisible: probe.patientVerifyVisible,
        visitRegisterVisible: probe.visitRegisterVisible,
        searchInputVisible: probe.searchInputVisible,
        searchButtonVisible: probe.searchButtonVisible,
      },
    },
    {
      kind: 'identifier_probe',
      matched: candidates.length > 0,
      url: FULLERTON_PATIENT_LIST_URL,
      selectors: ['input#idnVerify', 'input#visitDateTime', 'input#patientSearch_0'],
      reason: candidates.length > 0 ? 'match_candidates_collected' : 'no_match_candidates',
      identifiers: candidates,
    },
  ];
}

export function buildUnavailableFullertonSubmittedTruthCapture({
  visit = null,
  pageProbe = null,
  pageUrl = FULLERTON_BASE_URL,
  context = 'fullerton',
  portalTarget = 'FULLERTON',
  auditedAt = new Date().toISOString(),
} = {}) {
  const probe = probeFullertonPageState({
    ...(pageProbe || {}),
    url: pageProbe?.url || pageUrl || FULLERTON_BASE_URL,
  });
  const attempts = buildFullertonSubmittedTruthAttempts({
    visit,
    pageProbe: probe,
    pageUrl: probe.url,
  });

  return {
    found: false,
    reason: FULLERTON_SUBMITTED_DETAIL_REASON,
    detailReason: FULLERTON_SUBMITTED_DETAIL_REASON,
    context:
      String(context || 'fullerton')
        .trim()
        .toLowerCase() || 'fullerton',
    portalTarget:
      String(portalTarget || 'FULLERTON')
        .trim()
        .toUpperCase() || 'FULLERTON',
    portalUrl: probe.url,
    source: 'fullerton_submitted_detail',
    matchCandidates: collectFullertonMatchCandidates(visit),
    attempts,
    matchingAttempts: attempts.filter(attempt => attempt.matched),
    auditedAt,
    snapshot: null,
  };
}

async function probeFullertonSubmittedTruthPage(page) {
  return page
    .evaluate(() => {
      const norm = value =>
        String(value || '')
          .replace(/\s+/g, ' ')
          .trim();
      const linkSelectors = [
        'a:has-text("Claims History")',
        'a[href*="claim"]',
        'a[href*="statement"]',
      ];
      const selectors = {
        patientVerifyVisible: Boolean(globalThis.document?.querySelector?.('input#idnVerify')),
        visitRegisterVisible: Boolean(
          globalThis.document?.querySelector?.('input#visitRegister_0')
        ),
        searchInputVisible: Boolean(
          globalThis.document?.querySelector?.('input#idnVerify, input#visitDateTime')
        ),
        searchButtonVisible: Boolean(globalThis.document?.querySelector?.('input#patientSearch_0')),
      };
      const links = Array.from(
        globalThis.document?.querySelectorAll?.(
          'a, button, input[type="button"], input[type="submit"]'
        ) || []
      ).map(node => ({
        text: norm(node.textContent || node.value || ''),
        href: norm(node.getAttribute?.('href') || ''),
      }));
      const claimsHistoryLink = links.find(
        link =>
          /claims history/i.test(link.text) || /claims_history|patient_list|claim/i.test(link.href)
      );
      return {
        url: String(globalThis.location?.href || ''),
        title: norm(globalThis.document?.title || ''),
        bodySnippet: norm(globalThis.document?.body?.innerText || '').slice(0, 1200),
        claimsHistoryLinkVisible: Boolean(claimsHistoryLink),
        claimsHistoryLinkHref: claimsHistoryLink?.href || '',
        ...selectors,
        linkSelectors,
      };
    })
    .catch(() => null);
}

export async function extractFullertonSubmittedTruthCapture({
  page = null,
  visit = null,
  context = 'fullerton',
  portalTarget = 'FULLERTON',
  pageUrl = FULLERTON_BASE_URL,
  auditedAt = new Date().toISOString(),
} = {}) {
  const pageProbe = page ? await probeFullertonSubmittedTruthPage(page).catch(() => null) : null;
  const currentUrl =
    pageProbe?.url ||
    normalizeText(pageUrl || '') ||
    normalizeText(page?.url?.() || '') ||
    FULLERTON_BASE_URL;

  return buildUnavailableFullertonSubmittedTruthCapture({
    visit,
    pageProbe,
    pageUrl: currentUrl,
    context,
    portalTarget,
    auditedAt,
  });
}
