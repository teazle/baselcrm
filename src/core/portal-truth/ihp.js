function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toIsoTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function buildSessionAttempts(result = {}, portalUrl = null) {
  return [
    {
      stage: 'login',
      outcome: result.login_state || result.sessionState || 'unknown',
      loginState: result.login_state || null,
      sessionState: result.sessionState || null,
      portalUrl: portalUrl || null,
      evidence: result.evidence || null,
    },
    {
      stage: 'otp',
      outcome: result.otp_state || 'not_required',
      otpState: result.otp_state || null,
      otpStatus: result?.otp?.status || null,
      otpMatchedBy: result?.otp?.matchedBy || null,
      otpReceivedAt: result?.otp?.receivedAt || null,
      otpTriggeredAt: toIsoTimestamp(result?.otp_triggered_at),
      portalUrl: portalUrl || null,
    },
    {
      stage: 'search',
      outcome: result.search_state || 'unknown',
      searchState: result.search_state || null,
      searchAttempts: Array.isArray(result.search_attempts) ? result.search_attempts : [],
    },
    {
      stage: 'form',
      outcome: result.form_state || 'unknown',
      formState: result.form_state || null,
      fillVerification: result.fillVerification || null,
      requiredFieldGate: result.requiredFieldGate || null,
      comparison: result.comparison || null,
    },
  ];
}

export function buildIhpSubmittedTruthCapture({
  visit = null,
  result = {},
  portalUrl = null,
  auditedAt = null,
} = {}) {
  const resolvedPortalUrl = normalizeText(portalUrl || result?.portalUrl || '') || null;
  const sessionAttempts = buildSessionAttempts(result, resolvedPortalUrl);
  const otpAttempts = sessionAttempts.filter(item => item.stage === 'otp');

  return {
    found: false,
    reason: 'submitted_detail_extractor_unavailable_for_ihp',
    context: 'ihp',
    route: 'IHP',
    row: null,
    snapshot: null,
    submittedTruthSnapshot: null,
    portalTarget: 'IHP',
    portalName: 'IHP eClaim',
    portalUrl: resolvedPortalUrl,
    visitId: visit?.id || null,
    attempts: sessionAttempts,
    sessionAttempts,
    otpAttempts,
    loginState: result.login_state || null,
    otpState: result.otp_state || null,
    searchState: result.search_state || null,
    formState: result.form_state || null,
    sessionState: result.sessionState || null,
    fillVerification: result.fillVerification || null,
    comparison: result.comparison || null,
    evidence: result.evidence || null,
    evidenceArtifacts: result.evidenceArtifacts || null,
    auditedAt: auditedAt || new Date().toISOString(),
  };
}
