import { resolveFlow3PortalTarget } from '../../apps/crm/src/lib/rpa/portals.shared.js';
import { captureAllianzSubmittedTruthSnapshot } from './portal-truth/allianz.js';
import { extractFullertonSubmittedTruthCapture } from './portal-truth/fullerton.js';
import { buildIhpSubmittedTruthCapture } from './portal-truth/ihp.js';
import { buildIxchangeSubmittedTruthCaptureUnavailable } from './portal-truth/ixchange.js';

export const PORTAL_TRUTH_UNAVAILABLE_REASONS = {
  ALLIANCE_MEDINET: 'submitted_detail_extractor_unavailable_for_alliance_medinet',
  ALLIANZ: 'submitted_detail_extractor_unavailable_for_allianz',
  FULLERTON: 'submitted_detail_extractor_unavailable_for_fullerton',
  GE_NTUC: 'submitted_detail_extractor_unavailable_for_ge_ntuc',
  IHP: 'submitted_detail_extractor_unavailable_for_ihp',
  IXCHANGE: 'submitted_detail_extractor_unavailable_for_ixchange',
  MHC: 'submitted_truth_unavailable',
  UNKNOWN: 'submitted_detail_extractor_unavailable_for_unknown',
};

export const PORTAL_TRUTH_REQUIRED_FIELDS = [
  'patientName',
  'patientNric',
  'visitDate',
  'chargeType',
  'diagnosisText',
  'diagnosisCode',
  'mcDays',
  'mcStartDate',
  'consultationFee',
  'totalFee',
  'totalClaim',
  'lineItems',
  'remarks',
  'claimStatus',
];

export function resolveVisitPortalTarget(visit) {
  return (
    resolveFlow3PortalTarget(
      visit?.pay_type,
      visit?.patient_name,
      visit?.extraction_metadata || null
    ) || 'UNKNOWN'
  );
}

export function buildUnavailableSubmittedTruthCapture({
  visit,
  route,
  reason,
  attempts = [],
  context = null,
  extra = null,
} = {}) {
  const portalTarget = String(route || resolveVisitPortalTarget(visit) || 'UNKNOWN').toUpperCase();
  const unavailableReason =
    reason ||
    PORTAL_TRUTH_UNAVAILABLE_REASONS[portalTarget] ||
    PORTAL_TRUTH_UNAVAILABLE_REASONS.UNKNOWN;
  return {
    found: false,
    reason: unavailableReason,
    context: context || portalTarget.toLowerCase(),
    route: portalTarget,
    attempts: Array.isArray(attempts) ? attempts : [],
    auditedAt: new Date().toISOString(),
    ...(extra && typeof extra === 'object' ? extra : {}),
  };
}

export function buildGeNtucSubmittedTruthCapture({
  visit,
  mode = null,
  savedAsDraft = false,
  submitted = false,
  attempts = [],
  extra = null,
} = {}) {
  return buildUnavailableSubmittedTruthCapture({
    visit,
    route: 'GE_NTUC',
    reason: PORTAL_TRUTH_UNAVAILABLE_REASONS.GE_NTUC,
    context: 'ge_ntuc',
    attempts: [
      {
        stage: 'submitted_detail_extractor',
        status: 'unavailable',
        route: 'GE_NTUC',
        blocker: 'no_submitted_detail_view',
        mode: mode || null,
        savedAsDraft: Boolean(savedAsDraft),
        submitted: Boolean(submitted),
      },
      ...(Array.isArray(attempts) ? attempts : []),
    ],
    extra: {
      portal: 'GE_NTUC',
      mode: mode || null,
      savedAsDraft: Boolean(savedAsDraft),
      submitted: Boolean(submitted),
      normalized: true,
      ...(extra && typeof extra === 'object' ? extra : {}),
    },
  });
}

export function buildAllianceMedinetSubmittedTruthCapture({
  visit,
  attempts = [],
  context = 'alliance_medinet',
  extra = null,
} = {}) {
  return buildUnavailableSubmittedTruthCapture({
    visit,
    route: 'ALLIANCE_MEDINET',
    reason: PORTAL_TRUTH_UNAVAILABLE_REASONS.ALLIANCE_MEDINET,
    attempts,
    context,
    extra,
  });
}

export function normalizeSubmittedTruthSnapshot(snapshot, { route, source = null } = {}) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const portalTarget = String(route || snapshot.portalService || '').toUpperCase() || null;
  const normalized = {};
  for (const field of PORTAL_TRUTH_REQUIRED_FIELDS) {
    normalized[field] = snapshot[field] ?? null;
  }
  return {
    ...snapshot,
    ...normalized,
    source: snapshot.source || source || 'submitted_detail',
    portalService: snapshot.portalService || portalTarget,
    capturedAt: snapshot.capturedAt || new Date().toISOString(),
  };
}

async function captureMhcSubmittedTruth({ mhc, visit, nric, contextHint, expectedVisitNo }) {
  if (!mhc || typeof mhc.captureSubmittedTruthSnapshot !== 'function') {
    return buildUnavailableSubmittedTruthCapture({
      visit,
      route: 'MHC',
      reason: 'submitted_detail_navigation_failed',
      attempts: [{ stage: 'mhc_automation_missing' }],
      context: contextHint || 'mhc',
    });
  }

  return mhc.captureSubmittedTruthSnapshot({
    visit,
    nric,
    visitDate: visit?.visit_date || null,
    patientName: visit?.patient_name || '',
    contextHint,
    allowCrossContext: contextHint !== 'mhc',
    expectedVisitNo,
  });
}

async function captureUnavailablePortalTruth({ visit, route }) {
  return buildUnavailableSubmittedTruthCapture({
    visit,
    route,
    attempts: [
      {
        stage: 'extractor_registry',
        status: 'not_implemented',
        route,
      },
    ],
  });
}

async function captureGeNtucPortalTruth({
  visit,
  mode = null,
  savedAsDraft = false,
  submitted = false,
}) {
  return buildGeNtucSubmittedTruthCapture({
    visit,
    mode,
    savedAsDraft,
    submitted,
    attempts: [
      {
        stage: 'extractor_registry',
        status: 'not_implemented',
        route: 'GE_NTUC',
        blocker: 'no_submitted_detail_view',
      },
    ],
  });
}

async function captureFullertonPortalTruth({ visit }) {
  return extractFullertonSubmittedTruthCapture({ visit });
}

async function captureIxchangePortalTruth({ visit }) {
  return buildIxchangeSubmittedTruthCaptureUnavailable({ visit });
}

async function captureIhpPortalTruth({ visit }) {
  return buildIhpSubmittedTruthCapture({ visit, result: {} });
}

async function captureAllianzPortalTruth({ visit }) {
  return captureAllianzSubmittedTruthSnapshot({ visit });
}

export function portalTruthExtractorRequiresMhc(route) {
  return String(route || '').toUpperCase() === 'MHC';
}

export async function capturePortalSubmittedTruth({
  route,
  visit,
  mhc = null,
  nric = '',
  contextHint = null,
  expectedVisitNo = null,
} = {}) {
  const portalTarget = String(route || resolveVisitPortalTarget(visit) || 'UNKNOWN').toUpperCase();
  if (portalTarget === 'MHC') {
    const capture = await captureMhcSubmittedTruth({
      mhc,
      visit,
      nric,
      contextHint: contextHint || 'mhc',
      expectedVisitNo,
    });
    if (capture?.snapshot) {
      return {
        ...capture,
        snapshot: normalizeSubmittedTruthSnapshot(capture.snapshot, {
          route: portalTarget,
          source: 'submitted_detail',
        }),
      };
    }
    return capture;
  }
  if (portalTarget === 'GE_NTUC') {
    return captureGeNtucPortalTruth({ visit });
  }
  if (portalTarget === 'FULLERTON') {
    return captureFullertonPortalTruth({ visit });
  }
  if (portalTarget === 'IXCHANGE') {
    return captureIxchangePortalTruth({ visit });
  }
  if (portalTarget === 'IHP') {
    return captureIhpPortalTruth({ visit });
  }
  if (portalTarget === 'ALLIANZ') {
    return captureAllianzPortalTruth({ visit });
  }
  if (portalTarget === 'ALLIANCE_MEDINET') {
    return buildAllianceMedinetSubmittedTruthCapture({
      visit,
      attempts: [
        {
          stage: 'extractor_registry',
          status: 'not_implemented',
          route: 'ALLIANCE_MEDINET',
        },
      ],
    });
  }
  return captureUnavailablePortalTruth({ visit, route: portalTarget });
}

export function listPortalTruthExtractorTargets() {
  return ['MHC', 'FULLERTON', 'IXCHANGE', 'IHP', 'ALLIANCE_MEDINET', 'GE_NTUC', 'ALLIANZ'];
}
