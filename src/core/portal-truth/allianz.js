function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPolicyAttempt(state = {}) {
  const policyDetails = state.allianz_policy_details || null;
  const policyNumbers = Array.isArray(policyDetails?.policyNumbers)
    ? policyDetails.policyNumbers
    : [];

  return {
    step: 'policy_details',
    outcome: 'observed',
    url:
      normalizeText(state.claim_form_settled_url || state.claim_form_post_view_last_url || '') ||
      null,
    policyStatus: policyDetails?.policyStatus || null,
    policyMember: policyDetails?.policyMember || null,
    dob: policyDetails?.dob || null,
    policyNumbers,
    healthcarePlans: Array.isArray(policyDetails?.healthcarePlans)
      ? policyDetails.healthcarePlans
      : [],
    evidenceScreenshot: state.allianz_policy_evidence_screenshot || null,
  };
}

function buildNavigationAttempt(state = {}) {
  return {
    step: 'claim_form_probe',
    outcome: 'blocked',
    reason: 'portal_read_only_no_claim_form',
    detailReason: state.detailReason || 'allianz_portal_read_only',
    claimFormSupport: 'no_claim_form',
    navigation: state.claim_form_navigation || 'policy_verified_no_claim_form',
    click: state.claim_form_click || null,
    entryUrl: state.claim_form_entry_url || null,
    settledUrl: state.claim_form_settled_url || null,
    postViewUrl: state.claim_form_post_view_last_url || null,
    portalSubmissionMode: state.portal_submission_mode || 'policy_verification_only',
  };
}

export function buildAllianzSubmittedTruthCapture({
  state = {},
  visit = null,
  portalUrl = null,
  auditedAt = null,
} = {}) {
  const attempts = [];

  attempts.push({
    step: 'policy_search',
    outcome: state.allianz_search_blocked ? 'blocked' : 'completed',
    reason: state.allianz_search_blocked || null,
    nric: visit?.nric || visit?.patient_no || visit?.patient_number || null,
    portalUrl: portalUrl || null,
  });

  attempts.push(buildPolicyAttempt(state));
  attempts.push(buildNavigationAttempt(state));

  return {
    found: false,
    reason: 'submitted_detail_extractor_unavailable_for_allianz',
    context: 'allianz',
    row: null,
    snapshot: null,
    attempts,
    auditedAt: auditedAt || new Date().toISOString(),
    portalTarget: 'ALLIANZ',
    portalName: 'Allianz Worldwide Care',
    portalReadOnly: true,
    blocked_reason: 'portal_read_only_no_claim_form',
    detailReason: state.detailReason || 'allianz_portal_read_only',
    claimFormSupport: 'no_claim_form',
    policyDetails: state.allianz_policy_details || null,
  };
}

export function captureAllianzSubmittedTruthSnapshot(args = {}) {
  return buildAllianzSubmittedTruthCapture(args);
}
