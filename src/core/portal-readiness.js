export const FLOW3_READINESS_STATES = {
  PRODUCTION_SHADOW_READY: 'production_shadow_ready',
  TRUTH_AUDIT_READY: 'truth_audit_ready',
  DRAFT_READY: 'draft_ready',
  BLOCKED: 'blocked',
};

export const FLOW3_UI_STATUSES = {
  CANDIDATE_PENDING: 'candidate_pending',
  MANUAL_REVIEW: 'manual_review',
  SHADOW_FILL_READY: 'shadow_fill_ready',
  TRUTH_UNAVAILABLE: 'truth_unavailable',
  TRUTH_CAPTURED: 'truth_captured',
  DRIFT_MISMATCH: 'drift_mismatch',
  OTP_BLOCKED: 'otp_blocked',
  CAPTCHA_BLOCKED: 'captcha_blocked',
  PORTAL_READ_ONLY: 'portal_read_only',
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  ERROR: 'error',
};

function lower(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function hasRealMismatches(comparison) {
  if (!comparison || typeof comparison !== 'object') return false;
  const categories = Array.isArray(comparison.mismatchCategories)
    ? comparison.mismatchCategories
    : [];
  return categories.some(category => {
    const key = lower(category);
    return key && key !== 'submitted_truth_unavailable';
  });
}

export function deriveFlow3Readiness({ submissionStatus = null, metadata = null } = {}) {
  const md = metadata && typeof metadata === 'object' ? metadata : {};
  const status = lower(submissionStatus);
  const sessionState = lower(md.sessionState);
  const blockedReason = lower(md.blocked_reason || md.blockedReason || md.reason);
  const comparison = md.comparison && typeof md.comparison === 'object' ? md.comparison : null;

  if (status === 'submitted') {
    return { state: FLOW3_READINESS_STATES.DRAFT_READY, uiStatus: FLOW3_UI_STATUSES.SUBMITTED };
  }
  if (status === 'draft') {
    return { state: FLOW3_READINESS_STATES.DRAFT_READY, uiStatus: FLOW3_UI_STATUSES.DRAFT };
  }
  if (sessionState === 'captcha_blocked' || blockedReason.includes('captcha')) {
    return { state: FLOW3_READINESS_STATES.BLOCKED, uiStatus: FLOW3_UI_STATUSES.CAPTCHA_BLOCKED };
  }
  if (sessionState === 'otp_blocked' || blockedReason.includes('otp')) {
    return { state: FLOW3_READINESS_STATES.BLOCKED, uiStatus: FLOW3_UI_STATUSES.OTP_BLOCKED };
  }
  if (blockedReason.includes('read_only') || blockedReason.includes('no_claim_form')) {
    return { state: FLOW3_READINESS_STATES.BLOCKED, uiStatus: FLOW3_UI_STATUSES.PORTAL_READ_ONLY };
  }
  if (status === 'error' || lower(md.success) === 'false') {
    return { state: FLOW3_READINESS_STATES.BLOCKED, uiStatus: FLOW3_UI_STATUSES.ERROR };
  }
  if (hasRealMismatches(comparison)) {
    return {
      state: FLOW3_READINESS_STATES.TRUTH_AUDIT_READY,
      uiStatus: FLOW3_UI_STATUSES.DRIFT_MISMATCH,
    };
  }
  if (md.submittedTruthSnapshot || md.submittedTruthCapture?.found === true) {
    return {
      state: FLOW3_READINESS_STATES.TRUTH_AUDIT_READY,
      uiStatus: FLOW3_UI_STATUSES.TRUTH_CAPTURED,
    };
  }
  if (
    md.submittedTruthCapture?.found === false ||
    blockedReason === 'submitted_truth_unavailable' ||
    comparison?.unavailableReason === 'submitted_truth_unavailable'
  ) {
    return {
      state: FLOW3_READINESS_STATES.PRODUCTION_SHADOW_READY,
      uiStatus: FLOW3_UI_STATUSES.TRUTH_UNAVAILABLE,
    };
  }
  if (lower(md.mode) === 'fill_evidence' && md.success === true && md.botSnapshot) {
    return {
      state: FLOW3_READINESS_STATES.PRODUCTION_SHADOW_READY,
      uiStatus: FLOW3_UI_STATUSES.SHADOW_FILL_READY,
    };
  }
  return { state: FLOW3_READINESS_STATES.BLOCKED, uiStatus: FLOW3_UI_STATUSES.CANDIDATE_PENDING };
}
