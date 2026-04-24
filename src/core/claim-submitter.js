import { logger } from '../utils/logger.js';
import { MHCAsiaAutomation } from '../automations/mhc-asia.js';
import { AllianceMedinetAutomation } from '../automations/alliance-medinet.js';
import { resolveDiagnosisAgainstPortalOptions } from '../automations/clinic-assist.js';
import { AllianceMedinetSubmitter } from './alliance-medinet-submitter.js';
import { AllianzSubmitter } from './allianz-submitter.js';
import { FullertonSubmitter } from './fullerton-submitter.js';
import { IHPSubmitter } from './ihp-submitter.js';
import { IXChangeSubmitter } from './ixchange-submitter.js';
import { GENtucSubmitter } from './ge-submitter.js';
import { StepLogger } from '../utils/step-logger.js';
import { createSupabaseClient } from '../utils/supabase-client.js';
import { decryptPortalSecret } from '../utils/portal-credentials-crypto.js';
import {
  buildFillVerificationFromSnapshots,
  comparePortalTruthSnapshots,
  writeFlow3TruthArtifacts,
} from '../utils/flow3-truth-compare.js';
import {
  classifyVisitForRpa,
  getPortalScopeOrFilter,
  isFlow2EligibleVisit,
  matchesFlow3PortalTargets,
  resolveFlow3PortalTarget,
} from '../../apps/crm/src/lib/rpa/portals.shared.js';

// Common body-part → ICD-10 code mappings for the diagnosis fallback ladder.
const BODY_PART_ICD_MAP = {
  knee: { code: 'M25.56', text: 'Knee pain' },
  back: { code: 'M54.5', text: 'Low back pain' },
  'low back': { code: 'M54.5', text: 'Low back pain' },
  'lower back': { code: 'M54.5', text: 'Low back pain' },
  'upper back': { code: 'M54.6', text: 'Upper back pain' },
  shoulder: { code: 'M25.51', text: 'Shoulder pain' },
  neck: { code: 'M54.2', text: 'Neck pain' },
  ankle: { code: 'M25.57', text: 'Ankle pain' },
  wrist: { code: 'M25.53', text: 'Wrist pain' },
  hip: { code: 'M25.55', text: 'Hip pain' },
  elbow: { code: 'M25.52', text: 'Elbow pain' },
  foot: { code: 'M79.67', text: 'Foot pain' },
  hand: { code: 'M79.64', text: 'Hand pain' },
  chest: { code: 'R07.9', text: 'Chest pain' },
  head: { code: 'R51', text: 'Headache' },
  throat: { code: 'J02.9', text: 'Sore throat' },
  abdomen: { code: 'R10.9', text: 'Abdominal pain' },
  eye: { code: 'H57.1', text: 'Eye pain' },
  ear: { code: 'H92.0', text: 'Ear pain' },
};

// Common condition → ICD-10 code mappings when no body-part is available.
const CONDITION_ICD_MAP = {
  sprain: { code: 'T14.3', text: 'Sprain, unspecified' },
  strain: { code: 'T14.3', text: 'Strain, unspecified' },
  fracture: { code: 'T14.8', text: 'Fracture, unspecified' },
  pain: { code: 'R52', text: 'Pain, unspecified' },
  fever: { code: 'R50.9', text: 'Fever' },
  cough: { code: 'R05', text: 'Cough' },
  infection: { code: 'B99', text: 'Infection, unspecified' },
  allergy: { code: 'T78.4', text: 'Allergy, unspecified' },
  diarrhea: { code: 'R19.7', text: 'Diarrhea' },
  headache: { code: 'R51', text: 'Headache' },
  migraine: { code: 'G43.9', text: 'Migraine' },
};

const BODY_CONDITION_ICD_MAP = {
  'knee:sprain': { code: 'S83.9', text: 'Sprain of the knee' },
  'knee:strain': { code: 'S83.9', text: 'Sprain and strain of knee' },
  'ankle:sprain': { code: 'S93.4', text: 'Sprain and strain of ankle' },
  'ankle:strain': { code: 'S93.4', text: 'Sprain and strain of ankle' },
  'wrist:sprain': { code: 'S63.5', text: 'Sprain and strain of wrist' },
  'wrist:strain': { code: 'S63.5', text: 'Sprain and strain of wrist' },
  'back:pain': { code: 'M54.5', text: 'Low back pain' },
  'low back:pain': { code: 'M54.5', text: 'Low back pain' },
  'lower back:pain': { code: 'M54.5', text: 'Low back pain' },
  'neck:pain': { code: 'M54.2', text: 'Neck pain' },
  'shoulder:pain': { code: 'M25.51', text: 'Shoulder pain' },
  'hip:pain': { code: 'M25.55', text: 'Hip pain' },
};

function detectFallbackBodyPart(text) {
  const raw = String(text || '').toLowerCase();
  const patterns = [
    ['low back', /\blow(?:er)?\s+back\b|\blumbar\b|\bloin\b/],
    ['back', /\bback\b/],
    ['knee', /\bknee\b|\bpatella\b/],
    ['ankle', /\bankle\b/],
    ['wrist', /\bwrist\b/],
    ['shoulder', /\bshoulder\b/],
    ['neck', /\bneck\b/],
    ['hip', /\bhip\b|\bglut(?:e|s|eal)?\b|\bbuttock\b/],
    ['elbow', /\belbow\b/],
    ['foot', /\bfoot\b|\bfeet\b|\btoe\b/],
    ['hand', /\bhand\b|\bfinger\b/],
    ['chest', /\bchest\b/],
    ['head', /\bheadache\b|\bhead\b/],
    ['throat', /\bthroat\b|\bpharyng/i],
    ['abdomen', /\babdom(?:en|inal)\b|\bstomach\b|\bepigastr/i],
    ['eye', /\beye\b/],
    ['ear', /\bear\b/],
  ];
  return patterns.find(([, pattern]) => pattern.test(raw))?.[0] || '';
}

function detectFallbackCondition(text) {
  const raw = String(text || '').toLowerCase();
  const patterns = [
    ['sprain', /\bsprain(?:ed)?\b/],
    ['strain', /\bstrain(?:ed)?\b/],
    ['fracture', /\bfracture\b|\bfx\b/],
    ['fever', /\bfever\b|\bpyrexia\b/],
    ['cough', /\bcough\b/],
    ['headache', /\bheadache\b/],
    ['migraine', /\bmigraine\b/],
    ['diarrhea', /\bdiarrh(?:ea|oea)\b/],
    ['allergy', /\ballerg/i],
    ['infection', /\binfect/i],
    ['pain', /\bpain\b|\bache\b|\bsore\b/],
  ];
  return patterns.find(([, pattern]) => pattern.test(raw))?.[0] || '';
}

function inferDiagnosisFallbackFromText(text, codeHint = '') {
  const bodyPart = detectFallbackBodyPart(text);
  const condition = detectFallbackCondition(text);
  const rawCode = String(codeHint || '')
    .trim()
    .toUpperCase();
  const code = rawCode === 'R05' && condition !== 'cough' ? '' : rawCode;
  if (bodyPart && condition) {
    const combo = BODY_CONDITION_ICD_MAP[`${bodyPart}:${condition}`];
    if (combo) return { ...combo, code: code || combo.code, source: 'text_body_condition' };
  }
  if (bodyPart && BODY_PART_ICD_MAP[bodyPart]) {
    const mapping = BODY_PART_ICD_MAP[bodyPart];
    return { ...mapping, code: code || mapping.code, source: 'text_body_part' };
  }
  if (condition && CONDITION_ICD_MAP[condition]) {
    const mapping = CONDITION_ICD_MAP[condition];
    return { ...mapping, code: code || mapping.code, source: 'text_condition' };
  }
  return null;
}

/**
 * Build a tiered diagnosis fallback, preferring canonical/extracted data over generic "Cough".
 * Returns { code, text, source } where source describes which tier was used.
 */
function buildDiagnosisFallbackLadder(diagnosisCanonical, diagnosisDesc, diagnosisCode) {
  const envCode = String(process.env.MHC_GENERIC_FALLBACK_CODE || '')
    .trim()
    .toUpperCase();
  const envText = String(
    process.env.MHC_GENERIC_FALLBACK_DIAGNOSIS || process.env.MHC_GENERIC_DRAFT_DIAGNOSIS || ''
  ).trim();
  const lastResortCode = envCode || 'R05';
  const lastResortText = envText || 'Cough';

  // Tier 1: canonical description from Flow 2 enrichment
  const canonicalDesc = String(diagnosisCanonical?.description_canonical || '').trim();
  const canonicalCode = String(diagnosisCanonical?.code_normalized || '')
    .trim()
    .toUpperCase();
  if (canonicalDesc && !/^missing\s+diagnosis$/i.test(canonicalDesc)) {
    const inferred = inferDiagnosisFallbackFromText(canonicalDesc, canonicalCode || diagnosisCode);
    if (inferred) return inferred;
    return {
      code: canonicalCode || diagnosisCode || lastResortCode,
      text: canonicalDesc,
      source: 'canonical_description',
    };
  }

  // Tier 2: body-part + condition inference from canonical metadata
  const bodyPart = String(diagnosisCanonical?.body_part || '')
    .trim()
    .toLowerCase();
  const condition = String(diagnosisCanonical?.condition || '')
    .trim()
    .toLowerCase();
  if (bodyPart && condition) {
    const mapping = BODY_CONDITION_ICD_MAP[`${bodyPart}:${condition}`];
    if (mapping) {
      return {
        code: canonicalCode || mapping.code,
        text: mapping.text,
        source: 'body_condition_inference',
      };
    }
  }
  if (bodyPart && BODY_PART_ICD_MAP[bodyPart]) {
    const mapping = BODY_PART_ICD_MAP[bodyPart];
    // If we have a condition too, combine them (e.g. "Knee sprain" instead of "Knee pain")
    const combinedText =
      condition && condition !== 'pain'
        ? `${bodyPart.charAt(0).toUpperCase() + bodyPart.slice(1)} ${condition}`
        : mapping.text;
    return {
      code: canonicalCode || mapping.code,
      text: combinedText,
      source: 'body_part_inference',
    };
  }
  if (condition && CONDITION_ICD_MAP[condition]) {
    const mapping = CONDITION_ICD_MAP[condition];
    return {
      code: canonicalCode || mapping.code,
      text: mapping.text,
      source: 'condition_inference',
    };
  }

  // Tier 3: raw extracted diagnosis text from Flow 2 (even if it didn't resolve against portal options)
  const rawDesc = String(diagnosisDesc || '').trim();
  if (rawDesc && !/^missing\s+diagnosis$/i.test(rawDesc) && rawDesc.length >= 3) {
    const inferred = inferDiagnosisFallbackFromText(rawDesc, diagnosisCode || canonicalCode);
    if (inferred) return inferred;
    return {
      code: diagnosisCode || canonicalCode || lastResortCode,
      text: rawDesc,
      source: 'raw_extraction',
    };
  }

  // Tier 4: last resort — generic Cough / R05
  return {
    code: lastResortCode,
    text: lastResortText,
    source: 'generic_last_resort',
  };
}

/**
 * Claim Submitter: Routes claims to appropriate portals based on pay type
 */
export class ClaimSubmitter {
  constructor(mhcAsiaPage) {
    this.mhcAsia = new MHCAsiaAutomation(mhcAsiaPage);
    this.allianceMedinet = new AllianceMedinetAutomation(mhcAsiaPage);
    this.steps = new StepLogger({ total: 10, prefix: 'SUBMIT' });
    this.allianceMedinetSubmitter = new AllianceMedinetSubmitter(this.allianceMedinet, this.steps);
    this.allianzSubmitter = new AllianzSubmitter(mhcAsiaPage, this.steps);
    this.fullertonSubmitter = new FullertonSubmitter(mhcAsiaPage, this.steps);
    this.ihpSubmitter = new IHPSubmitter(mhcAsiaPage, this.steps);
    this.ixchangeSubmitter = new IXChangeSubmitter(mhcAsiaPage, this.steps);
    this.geSubmitter = new GENtucSubmitter(this.allianceMedinet, this.steps);
    this.supabase = createSupabaseClient();
    this.mhcAsiaLoggedIn = false;
    this.portalCredentialCache = null;
  }

  async _loadPortalCredentials() {
    if (this.portalCredentialCache) return this.portalCredentialCache;
    if (!this.supabase) {
      this.portalCredentialCache = {};
      return this.portalCredentialCache;
    }
    try {
      const { data, error } = await this.supabase
        .from('rpa_portal_credentials')
        .select(
          'portal_target,portal_url,username,password,username_encrypted,password_encrypted,is_active'
        );
      if (error) {
        logger.warn('[SUBMIT] Unable to load rpa_portal_credentials; falling back to env config', {
          error: error.message,
        });
        this.portalCredentialCache = {};
        return this.portalCredentialCache;
      }
      const map = {};
      for (const row of data || []) {
        const key = String(row?.portal_target || '')
          .trim()
          .toUpperCase();
        if (!key || row?.is_active === false) continue;
        const encodedUsername =
          String(row?.username_encrypted || '').trim() ||
          String(row?.username || '').trim() ||
          null;
        const encodedPassword =
          String(row?.password_encrypted || '').trim() ||
          String(row?.password || '').trim() ||
          null;

        let username = null;
        let password = null;
        try {
          username = decryptPortalSecret(encodedUsername);
        } catch (error) {
          logger.warn('[SUBMIT] Failed to decode portal username, ignoring stored username', {
            portalTarget: key,
            error: error?.message || String(error),
          });
        }
        try {
          password = decryptPortalSecret(encodedPassword);
        } catch (error) {
          logger.warn('[SUBMIT] Failed to decode portal password, ignoring stored password', {
            portalTarget: key,
            error: error?.message || String(error),
          });
        }
        map[key] = {
          url: String(row?.portal_url || '').trim() || null,
          username: username ? String(username).trim() : null,
          password: password ? String(password).trim() : null,
        };
      }
      this.portalCredentialCache = map;
      return map;
    } catch (error) {
      logger.warn('[SUBMIT] Failed to query portal credentials; falling back to env config', {
        error: error?.message || String(error),
      });
      this.portalCredentialCache = {};
      return this.portalCredentialCache;
    }
  }

  async _getPortalCredential(target) {
    const key = String(target || '')
      .trim()
      .toUpperCase();
    if (!key) return null;
    const map = await this._loadPortalCredentials();
    return map[key] || null;
  }

  async _applyRuntimeCredential(target, portalConfig) {
    if (!portalConfig || typeof portalConfig !== 'object') return null;
    const credential = await this._getPortalCredential(target);
    if (!credential) return null;
    if (credential.url) portalConfig.url = credential.url;
    if (credential.username) portalConfig.username = credential.username;
    if (credential.password) portalConfig.password = credential.password;
    return credential;
  }

  _getRequestedMode() {
    const raw = String(process.env.FLOW3_MODE || '')
      .trim()
      .toLowerCase();
    if (raw === 'draft' || raw === 'submit' || raw === 'fill_evidence') return raw;
    if (process.env.WORKFLOW_SAVE_DRAFT === '1') return 'draft';
    if (process.env.ALLOW_LIVE_SUBMIT === '1') return 'submit';
    return 'fill_evidence';
  }

  _getDraftValidatedTargets() {
    const raw = String(process.env.FLOW3_DRAFT_VALIDATED_TARGETS || 'MHC,ALLIANCE_MEDINET')
      .split(',')
      .map(value =>
        String(value || '')
          .trim()
          .toUpperCase()
      )
      .filter(Boolean);
    return new Set(raw);
  }

  _getPortalTimeoutMs(route) {
    const normalizedRoute = String(route || 'DEFAULT')
      .trim()
      .toUpperCase();
    const specific = Number(process.env[`FLOW3_${normalizedRoute}_TIMEOUT_MS`] || 0);
    if (Number.isFinite(specific) && specific > 0) return specific;
    const configuredDefault = Number(process.env.FLOW3_PORTAL_TIMEOUT_MS || 0);
    if (Number.isFinite(configuredDefault) && configuredDefault > 0) return configuredDefault;
    const defaults = {
      IHP: 90000,
      IXCHANGE: 120000,
      FULLERTON: 120000,
      ALLIANZ: 240000,
      ALLIANCE_MEDINET: 180000,
      GE_NTUC: 180000,
    };
    return defaults[normalizedRoute] || 180000;
  }

  _buildPortalTimeoutError(route, timeoutMs, visit) {
    const portalService = String(route || 'UNKNOWN')
      .trim()
      .toUpperCase();
    const error = new Error(`${portalService} portal timed out after ${timeoutMs}ms`);
    error.submissionMetadata = {
      success: false,
      reason: 'portal_timeout',
      blocked_reason: 'portal_timeout',
      detailReason: 'portal_timeout',
      sessionState: 'timeout',
      portalService,
      error: error.message,
      visitId: visit?.id || null,
      timeoutMs,
    };
    return error;
  }

  _normalizePortalResult(result, visit, route) {
    const requestedMode = this._getRequestedMode();
    const portalResult = result && typeof result === 'object' ? result : {};
    return {
      mode: requestedMode,
      success: portalResult.success === true,
      portal: portalResult.portal || route || visit?.pay_type || null,
      portalService: portalResult.portalService || route || null,
      savedAsDraft: portalResult.savedAsDraft === true,
      submitted: portalResult.submitted === true,
      reason: portalResult.reason || null,
      blocked_reason:
        portalResult.blocked_reason ||
        (portalResult.success === false ? portalResult.reason || null : null),
      detailReason: portalResult.detailReason || null,
      error: portalResult.error || null,
      fillVerification: portalResult.fillVerification || null,
      comparison: portalResult.comparison || null,
      evidence: portalResult.evidence || null,
      sessionState: portalResult.sessionState || null,
      processedAt: new Date().toISOString(),
      ...portalResult,
    };
  }

  _mergeSubmissionMetadata(existingMetadata, patchMetadata) {
    const existing =
      existingMetadata && typeof existingMetadata === 'object' ? existingMetadata : {};
    const patch = patchMetadata && typeof patchMetadata === 'object' ? patchMetadata : {};

    return {
      ...existing,
      ...patch,
      botSnapshot: patch.botSnapshot ?? existing.botSnapshot ?? null,
      draftVerification: patch.draftVerification ?? existing.draftVerification ?? null,
      fillVerification: patch.fillVerification ?? existing.fillVerification ?? null,
      comparison: patch.comparison ?? existing.comparison ?? null,
      mismatchCategories: patch.mismatchCategories ?? existing.mismatchCategories ?? [],
      evidence: patch.evidence ?? existing.evidence ?? null,
      sessionState: patch.sessionState ?? existing.sessionState ?? null,
      blocked_reason: patch.blocked_reason ?? existing.blocked_reason ?? null,
      submittedTruthSnapshot:
        patch.submittedTruthSnapshot ?? existing.submittedTruthSnapshot ?? null,
      submittedTruthCapture: patch.submittedTruthCapture ?? existing.submittedTruthCapture ?? null,
      evidenceArtifacts: {
        ...(existing.evidenceArtifacts && typeof existing.evidenceArtifacts === 'object'
          ? existing.evidenceArtifacts
          : {}),
        ...(patch.evidenceArtifacts && typeof patch.evidenceArtifacts === 'object'
          ? patch.evidenceArtifacts
          : {}),
      },
    };
  }

  /**
   * Get pending claims from CRM that need to be submitted
   */
  async getPendingClaims(payType = null, visitIds = null, opts = {}) {
    if (!this.supabase) {
      logger.warn('[SUBMIT] Supabase not configured; cannot fetch pending claims');
      return [];
    }

    const { from = null, to = null, portalOnly = false, portalTargets = null } = opts || {};
    const explicitVisitIds = Array.isArray(visitIds) && visitIds.length > 0;
    const requestedMode = this._getRequestedMode();
    const allowSubmittedShadowFill = explicitVisitIds && requestedMode === 'fill_evidence';

    let query = this.supabase.from('visits').select('*').eq('source', 'Clinic Assist');
    if (!allowSubmittedShadowFill) {
      query = query.is('submitted_at', null); // Not yet submitted
    }

    if (payType) {
      query = query.eq('pay_type', payType);
    }

    if (from && /^\d{4}-\d{2}-\d{2}$/.test(String(from))) {
      query = query.gte('visit_date', from);
    }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(String(to))) {
      query = query.lte('visit_date', to);
    }

    // Convenience filter for verification runs: only rows that look like portal-tagged patients.
    if (portalOnly && !payType) {
      query = query.or(getPortalScopeOrFilter());
    }

    if (Array.isArray(visitIds) && visitIds.length > 0) {
      query = query.in('id', visitIds);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('[SUBMIT] Failed to fetch pending claims', { error: error.message });
      return [];
    }

    let rows = data || [];
    rows = rows.filter(visit => {
      if (!allowSubmittedShadowFill && !isFlow2EligibleVisit(visit?.extraction_metadata || null)) {
        return false;
      }
      const candidate = classifyVisitForRpa(
        visit?.pay_type || null,
        visit?.patient_name || null,
        visit?.nric || null,
        visit?.extraction_metadata || null,
        visit?.submission_status || null
      );
      const alreadySubmittedOnly =
        candidate.status === 'not_claim_candidate' &&
        Array.isArray(candidate.reasons) &&
        candidate.reasons.length === 1 &&
        candidate.reasons[0] === 'already_submitted';
      if (candidate.status === 'not_claim_candidate') {
        if (!(allowSubmittedShadowFill && alreadySubmittedOnly && candidate.portalTarget)) {
          return false;
        }
      }
      if (candidate.status === 'manual_review' && !candidate.portalTarget) return false;
      if (!explicitVisitIds) {
        const mode = String(visit?.submission_metadata?.mode || '')
          .trim()
          .toLowerCase();
        const success = visit?.submission_metadata?.success === true;
        if (mode === 'fill_evidence' && success && !visit?.submission_status) {
          return false;
        }
      }
      return true;
    });
    if (Array.isArray(portalTargets) && portalTargets.length > 0) {
      rows = rows.filter(visit =>
        matchesFlow3PortalTargets(
          visit?.pay_type || null,
          visit?.patient_name || null,
          portalTargets,
          visit?.extraction_metadata || null
        )
      );
    }

    return rows;
  }

  async _mergeVisitExtractionMetadataPatch(visitId, patch = {}) {
    if (!this.supabase || !visitId || !patch || typeof patch !== 'object') return;
    try {
      const { data: current, error: fetchError } = await this.supabase
        .from('visits')
        .select('extraction_metadata')
        .eq('id', visitId)
        .single();
      if (fetchError) {
        logger.warn('[SUBMIT] Failed to read current extraction_metadata for patch', {
          visitId,
          error: fetchError.message,
        });
        return;
      }
      const currentMetadata =
        current && current.extraction_metadata && typeof current.extraction_metadata === 'object'
          ? current.extraction_metadata
          : {};
      const nextMetadata = {
        ...currentMetadata,
        ...patch,
      };
      if (patch.diagnosis && typeof patch.diagnosis === 'object') {
        nextMetadata.diagnosis = {
          ...(currentMetadata.diagnosis && typeof currentMetadata.diagnosis === 'object'
            ? currentMetadata.diagnosis
            : {}),
          ...patch.diagnosis,
        };
      }
      const { error: updateError } = await this.supabase
        .from('visits')
        .update({ extraction_metadata: nextMetadata })
        .eq('id', visitId);
      if (updateError) {
        logger.warn('[SUBMIT] Failed to patch extraction_metadata', {
          visitId,
          error: updateError.message,
        });
      }
    } catch (error) {
      logger.warn('[SUBMIT] Unexpected extraction_metadata patch failure', {
        visitId,
        error: error?.message || String(error),
      });
    }
  }

  /**
   * Submit a claim to the appropriate portal based on pay type
   */
  async submitClaim(visit) {
    const payTypeRaw = String(visit.pay_type || '').toUpperCase();
    const requestedMode = this._getRequestedMode();

    this.steps.step(1, `Submitting claim for ${visit.patient_name}`, {
      payType: payTypeRaw || null,
      visitId: visit.id,
      mode: requestedMode,
    });

    const allowLiveSubmit =
      requestedMode === 'submit' && process.env.FLOW3_ENABLE_SUBMIT_MODE === '1';
    const shouldPersistErrors = true;

    try {
      let result = null;

      // Route to appropriate portal service. Flow logic for each portal is isolated by submit method.
      const route = resolveFlow3PortalTarget(
        visit.pay_type,
        visit.patient_name,
        visit.extraction_metadata || null
      );
      if (requestedMode === 'submit' && !allowLiveSubmit) {
        return this._normalizePortalResult(
          {
            success: false,
            reason: 'live_submit_disabled',
            blocked_reason: 'live_submit_disabled',
            error: 'Live submit is disabled for Flow 3. Use fill_evidence or draft.',
          },
          visit,
          route
        );
      }
      if (requestedMode === 'draft' && route && !this._getDraftValidatedTargets().has(route)) {
        return this._normalizePortalResult(
          {
            success: false,
            reason: 'draft_not_allowed',
            blocked_reason: 'portal_contract_unvalidated',
            error: `Draft mode is not enabled for ${route} yet`,
          },
          visit,
          route
        );
      }
      if (route === 'IHP' && process.env.FLOW3_SKIP_IHP === '1') {
        return this._normalizePortalResult(
          {
            success: false,
            reason: 'skipped_by_config',
            blocked_reason: 'skipped_by_config',
            detailReason: 'ihp_temporarily_skipped',
            portal: 'IHP eClaim',
            portalService: 'IHP',
            submitted: false,
            savedAsDraft: false,
            error: 'IHP route skipped by FLOW3_SKIP_IHP=1',
          },
          visit,
          route
        );
      }
      switch (route) {
        case 'MHC':
          result = await this.submitToMHCAsia(visit);
          break;
        case 'ALLIANCE_MEDINET':
          result = await this.submitToAllianceMedinet(visit);
          break;
        case 'ALLIANZ':
          result = await this.submitToAllianz(visit);
          break;
        case 'FULLERTON':
          result = await this.submitToFullerton(visit);
          break;
        case 'IHP':
          result = await this.submitToIHP(visit);
          break;
        case 'IXCHANGE':
          result = await this.submitToIXChange(visit);
          break;
        case 'GE_NTUC':
          result = await this.submitToGENtuc(visit);
          break;
        // Backward-compatible route aliases.
        case 'GE':
          result = await this.submitToGENtuc(visit);
          break;
        case 'FULLERT':
          result = await this.submitToFullerton(visit);
          break;
        case 'ALLIMED':
        case 'ALL':
          result = await this.submitToIXChange(visit);
          break;
        default:
          logger.warn(`[SUBMIT] Unknown pay type: ${payTypeRaw}. Skipping submission.`);
          return this._normalizePortalResult(
            {
              success: false,
              reason: 'unknown_pay_type',
              blocked_reason: 'portal_unknown',
              payType: payTypeRaw || null,
            },
            visit,
            route
          );
      }

      result = this._normalizePortalResult(result, visit, route);

      // Persist submission status only when we actually did a portal action that should advance the workflow.
      // Today we only support "Save as Draft" (and we intentionally avoid auto-submit).
      // For fill-only verification runs (no draft), do NOT mark the record as submitted.
      if (!result?.success && this.supabase && requestedMode === 'fill_evidence') {
        const mergedFailureMetadata = this._mergeSubmissionMetadata(
          visit?.submission_metadata || null,
          result
        );
        await this.supabase
          .from('visits')
          .update({
            submission_status: null,
            submission_portal: result?.portal || route || payTypeRaw || null,
            submission_error: result?.error || result?.reason || null,
            submission_metadata: mergedFailureMetadata,
          })
          .eq('id', visit.id);
      }

      if (result?.success && this.supabase) {
        if (result.submitted && !allowLiveSubmit) {
          logger.error('[SUBMIT] Live submit result blocked by policy (draft-only mode)', {
            visitId: visit.id,
            payType: payTypeRaw || null,
          });
          result = {
            ...result,
            success: false,
            submitted: false,
            blocked_reason: 'live_submit_disabled',
            error: 'Live submit blocked (draft-only mode)',
          };
        }
        if (result?.diagnosisPortalMatch) {
          await this._mergeVisitExtractionMetadataPatch(visit.id, {
            diagnosis_portal_match: result.diagnosisPortalMatch,
            diagnosis: { portal_match: result.diagnosisPortalMatch },
          });
        }

        const shouldPersist =
          Boolean(result.savedAsDraft) ||
          (allowLiveSubmit && Boolean(result.submitted)) ||
          (requestedMode === 'fill_evidence' && Boolean(result.success));
        const submissionStatus = result.savedAsDraft
          ? 'draft'
          : allowLiveSubmit && result.submitted
            ? 'submitted'
            : null;
        const mergedSubmissionMetadata = this._mergeSubmissionMetadata(
          visit?.submission_metadata || null,
          result
        );
        if (shouldPersist && submissionStatus) {
          await this.supabase
            .from('visits')
            .update({
              submitted_at: new Date().toISOString(),
              submission_status: submissionStatus,
              submission_portal: result?.portal || route || payTypeRaw || null,
              submission_error: null,
              submission_metadata: mergedSubmissionMetadata,
            })
            .eq('id', visit.id);
        } else if (shouldPersist && requestedMode === 'fill_evidence') {
          await this.supabase
            .from('visits')
            .update({
              submission_status: null,
              submission_portal: result?.portal || route || payTypeRaw || null,
              submission_error: null,
              submission_metadata: mergedSubmissionMetadata,
            })
            .eq('id', visit.id);
        } else {
          logger.info('[SUBMIT] Fill-only run; not updating submission_status/submitted_at', {
            visitId: visit.id,
            payType: payTypeRaw || null,
            savedAsDraft: Boolean(result.savedAsDraft),
          });
        }
      }

      return result;
    } catch (error) {
      logger.error(`[SUBMIT] Error submitting claim for ${visit.patient_name}`, {
        error: error.message,
      });

      const failureMetadata =
        error && typeof error === 'object' && error.submissionMetadata
          ? error.submissionMetadata
          : null;

      // Update visit with error status only when this run intends to advance workflow state.
      // For fill-only verification, keep the DB clean and rely on run logs/screenshots instead.
      if (this.supabase && shouldPersistErrors) {
        const failureResult = this._normalizePortalResult(
          {
            success: false,
            reason: failureMetadata?.reason || 'portal_runtime_error',
            blocked_reason:
              failureMetadata?.blocked_reason || failureMetadata?.reason || 'portal_runtime_error',
            error: error.message,
            ...(failureMetadata && typeof failureMetadata === 'object' ? failureMetadata : {}),
          },
          visit,
          resolveFlow3PortalTarget(
            visit.pay_type,
            visit.patient_name,
            visit.extraction_metadata || null
          )
        );
        const mergedFailureMetadata = this._mergeSubmissionMetadata(
          visit?.submission_metadata || null,
          failureResult
        );
        const errorUpdate = {
          submission_status: 'error',
          submission_error: error.message,
          submission_metadata: mergedFailureMetadata,
        };
        await this.supabase.from('visits').update(errorUpdate).eq('id', visit.id);
      } else {
        logger.info('[SUBMIT] Verification run: not persisting submission_status=error', {
          visitId: visit.id,
          payType: payTypeRaw || null,
          error: error.message,
        });
      }

      return failureMetadata
        ? this._normalizePortalResult(
            failureMetadata,
            visit,
            resolveFlow3PortalTarget(
              visit.pay_type,
              visit.patient_name,
              visit.extraction_metadata || null
            )
          )
        : this._normalizePortalResult(
            {
              success: false,
              reason: 'portal_runtime_error',
              blocked_reason: 'portal_runtime_error',
              error: error.message,
            },
            visit,
            resolveFlow3PortalTarget(
              visit.pay_type,
              visit.patient_name,
              visit.extraction_metadata || null
            )
          );
    }
  }

  /**
   * Submit to MHC Asia portal
   * Uses data from extraction_metadata populated by Flow 2 (VisitDetailsExtractor):
   * - nric: Patient NRIC
   * - chargeType: 'first' or 'follow'
   * - mcDays: Number of MC days
   * - mcStartDate: MC start date in DD/MM/YYYY format
   * - diagnosisCode: ICD diagnosis code
   */
  async submitToMHCAsia(visit) {
    this.steps.step(2, 'Submitting to MHC Asia');
    await this._applyRuntimeCredential('MHC', this.mhcAsia?.config);

    const metadata = visit.extraction_metadata || {};
    const payTypeRaw = String(visit.pay_type || '').toUpperCase();
    const forceSinglife = payTypeRaw.includes('AVIVA') || payTypeRaw.includes('SINGLIFE');
    let routingOverride = null;

    const stripLeadingTag = value => {
      const s = String(value || '').trim();
      if (!s) return '';
      // Search must NOT include the tag prefix (clinic requirement).
      return s
        .replace(
          /^(MHC|MHCAXA|AVIVA|SINGLIFE|AIA|AIACLIENT|FULLERT|ALLIANZ|ALLIANCE|ALL|IHP|GE|NTUC_IM|PARKWAY)\\s*[-:]+\\s*/i,
          ''
        )
        .trim();
    };

    // NRIC/FIN/Member ID is mandatory for MHC/AIA/Singlife.
    const nric = this._pickNricForVisit(visit, metadata);
    const fullName = stripLeadingTag(visit.patient_name);
    if (!nric) {
      throw new Error(
        'NRIC not found in visit record - MHC/AIA/Singlife requires NRIC/FIN/Member ID (run Flow 2 / fix Flow 1 data)'
      );
    }

    // Get extracted data from Flow 2
    const chargeType = metadata.chargeType || 'follow';
    const mcDays = metadata.mcDays || 0;
    const mcStartDate = metadata.mcStartDate || null;
    const diagnosisDesc = String(visit.diagnosis_description || '').trim();
    const diagnosisMissingText = !diagnosisDesc || /^missing diagnosis$/i.test(diagnosisDesc);
    const diagnosisCode = metadata.diagnosisCode || null;
    const diagnosisCanonical = metadata.diagnosisCanonical || null;
    const diagnosisResolution = metadata.diagnosisResolution || null;
    const requestedMode = this._getRequestedMode();
    const allowGenericDiagnosisFallback = process.env.FLOW2_ENABLE_GENERIC_DIAG_FALLBACK !== '0';
    const saveDraftMode = requestedMode === 'draft';
    const allowMissingDiagnosisDraftFallback =
      saveDraftMode && process.env.MHC_ALLOW_MISSING_DIAG_DRAFT_FALLBACK !== '0';
    const allowNonSubmitDiagnosisFallback =
      requestedMode !== 'submit' && process.env.MHC_ALLOW_NON_SUBMIT_DIAG_FALLBACK !== '0';
    // Diagnosis fallback ladder: try increasingly generic options before landing on Cough.
    // 1. Canonical description (e.g. "Low back pain", "Knee sprain")
    // 2. Body-part + condition inference (e.g. knee + pain → "Knee pain" / M79.5)
    // 3. Raw extracted text (even if unresolved, it's better than Cough)
    // 4. Last resort: generic Cough / R05
    const fallbackLadder = buildDiagnosisFallbackLadder(
      diagnosisCanonical,
      diagnosisDesc,
      diagnosisCode
    );
    const genericFallbackDiagnosisCode = fallbackLadder.code;
    const genericFallbackDiagnosisText = fallbackLadder.text;
    let diagnosisMatch = metadata.diagnosisMatch || null;
    let portalDiagnosisOptions = Array.isArray(metadata.portalDiagnosisOptions)
      ? metadata.portalDiagnosisOptions
      : [];
    let diagnosisFallbackMode = null;

    logger.info('[SUBMIT] MHC form data:', {
      nric: nric || null,
      patientName: fullName || null,
      chargeType,
      mcDays,
      mcStartDate,
      diagnosis: diagnosisDesc?.substring(0, 50),
      requestedMode,
      diagnosisResolutionStatus: diagnosisResolution?.status || null,
      diagnosisCanonical: diagnosisCanonical?.description_canonical?.slice?.(0, 80) || null,
      allowMissingDiagnosisDraftFallback,
      allowNonSubmitDiagnosisFallback,
      forceSinglife,
    });

    // Ensure we're on MHC home and authenticated (single entry point per patient).
    await this.mhcAsia.ensureAtMhcHome();
    this.mhcAsiaLoggedIn = true;

    // Setup dialog handler for auto-accepting prompts (consultation fee max)
    this.mhcAsia.setupDialogHandler();

    // Fill visit date
    const visitDateFormatted = this._formatDateForMHC(visit.visit_date);
    const visitDateForSearch =
      visitDateFormatted && /^\d{2}\/\d{2}\/\d{4}$/.test(visitDateFormatted)
        ? visitDateFormatted
        : null;
    const preferReuseExistingDraft =
      process.env.WORKFLOW_SAVE_DRAFT !== '0' && process.env.MHC_REUSE_EXISTING_DRAFT !== '0';
    const preferredReuseContext = /AIA/i.test(payTypeRaw) ? 'aia' : 'mhc';
    if (forceSinglife) {
      // Singlife/Aviva: MHC -> Switch System -> Singlife PCP -> Add Normal Visit -> search by NRIC.
      // This path lands directly on the visit form (no separate addVisit step).
      // Do an explicit system switch here as a fast-path; navigateToSinglifeNormalVisitAndSearch()
      // also defends against being in the wrong system.
      await this.mhcAsia.switchToSinglifeIfNeeded({ force: true }).catch(() => false);
      const ok = await this.mhcAsia.navigateToSinglifeNormalVisitAndSearch(
        nric,
        visitDateForSearch
      );
      if (!ok) {
        throw new Error(
          `Failed to open Singlife visit form for NRIC ${nric} (see screenshots/mhc-asia-singlife-*.png)`
        );
      }
    } else {
      let routedToAia = false;
      let alreadyOnVisitForm = false;
      if (preferReuseExistingDraft && nric) {
        const existingDraft = await this.mhcAsia
          .openExistingDraftVisit({
            nric,
            visitDate: visitDateForSearch,
            patientName: fullName,
            contextHint: preferredReuseContext,
            allowCrossContext: preferredReuseContext === 'aia',
          })
          .catch(() => null);
        if (existingDraft?.found) {
          alreadyOnVisitForm = true;
          logger.info('[SUBMIT] Reusing existing draft before fill', {
            nric,
            visitNo: existingDraft?.row?.visitNo || null,
            visitDate: existingDraft?.row?.visitDate || null,
            context: existingDraft?.context || preferredReuseContext,
          });
        }
      }

      if (!alreadyOnVisitForm) {
        // MHC/AIA: Normal Visit search inside MHC portal.
        const searchResult = await this.mhcAsia.searchPatientByNRIC({
          nric: nric || null,
          visitDate: visitDateForSearch,
        });

        // Some members trigger a portal alert: "Please submit this claim under www.aiaclinic.com".
        // If that dialog appears, route immediately to AIA Clinic and skip MHC patient opening.
        if (this.mhcAsia.needsAIAClinicSwitch && nric) {
          routingOverride = 'AIA_CLINIC_DIALOG';
          logger.info('[SUBMIT] Routing override: AIA Clinic required by portal dialog', {
            nric: nric,
            msg: this.mhcAsia.lastDialogMessage || null,
          });
          await this.mhcAsia.switchToAIAClinicIfNeeded();
          let reusedAiaDraft = false;
          if (preferReuseExistingDraft && nric) {
            const existingAiaDraft = await this.mhcAsia
              .openExistingDraftVisit({
                nric,
                visitDate: visitDateForSearch,
                patientName: fullName,
                contextHint: 'aia',
                allowCrossContext: false,
              })
              .catch(() => null);
            if (existingAiaDraft?.found) {
              reusedAiaDraft = true;
              alreadyOnVisitForm = true;
              logger.info('[SUBMIT] Reusing existing AIA draft after routing override', {
                nric,
                visitNo: existingAiaDraft?.row?.visitNo || null,
                visitDate: existingAiaDraft?.row?.visitDate || null,
              });
            }
          }
          if (!reusedAiaDraft) {
            const ok = await this.mhcAsia.navigateToAIAVisitAndSearch(nric, {
              visitDate: visitDateForSearch,
            });
            if (!ok) {
              throw new Error(
                `Failed to open AIA visit form for NRIC ${nric} (see screenshots/mhc-asia-aia-*.png)`
              );
            }
          }
          routedToAia = true;
        } else if (searchResult?.memberNotFound) {
          return {
            success: false,
            reason: 'not_found',
            error: `Member not found in MHC Asia: ${nric}`,
          };
        } else if (!searchResult || !searchResult.found) {
          // Some members trigger a portal alert: "Please submit this claim under www.aiaclinic.com".
          // In that case, we must switch system and continue the AIA Clinic flow even if no
          // patient row is shown on the MHC search results table.
          throw new Error(`Patient not found in MHC Asia: ${nric}`);
        } else {
          const opened = await this.mhcAsia.openPatientFromSearchResults(nric, {
            preferredContext:
              /AIA|AIACLIENT/i.test(payTypeRaw) || routingOverride === 'AIA_CLINIC_DIALOG'
                ? 'aia'
                : forceSinglife
                  ? 'singlife'
                  : 'mhc',
          });
          alreadyOnVisitForm = opened === true;
          if (this.mhcAsia.needsAIAClinicSwitch && nric) {
            routingOverride = 'AIA_CLINIC_DIALOG';
            logger.info(
              '[SUBMIT] Routing override: AIA Clinic required by portal dialog (after patient click)',
              {
                nric: nric,
                msg: this.mhcAsia.lastDialogMessage || null,
              }
            );
            await this.mhcAsia.switchToAIAClinicIfNeeded();
            let reusedAiaDraft = false;
            if (preferReuseExistingDraft && nric) {
              const existingAiaDraft = await this.mhcAsia
                .openExistingDraftVisit({
                  nric,
                  visitDate: visitDateForSearch,
                  patientName: fullName,
                  contextHint: 'aia',
                  allowCrossContext: false,
                })
                .catch(() => null);
              if (existingAiaDraft?.found) {
                reusedAiaDraft = true;
                alreadyOnVisitForm = true;
                logger.info('[SUBMIT] Reusing existing AIA draft after routing override', {
                  nric,
                  visitNo: existingAiaDraft?.row?.visitNo || null,
                  visitDate: existingAiaDraft?.row?.visitDate || null,
                });
              }
            }
            if (!reusedAiaDraft) {
              const ok = await this.mhcAsia.navigateToAIAVisitAndSearch(nric, {
                visitDate: visitDateForSearch,
              });
              if (!ok) {
                throw new Error(
                  `Failed to open AIA visit form for NRIC ${nric} (see screenshots/mhc-asia-aia-*.png)`
                );
              }
            }
            routedToAia = true;
          } else if (!opened) {
            if (searchResult?.memberNotFound) {
              return {
                success: false,
                reason: 'not_found',
                error: `Member not found in MHC Asia: ${nric}`,
              };
            }
            throw new Error(`Could not open patient from search results: ${nric}`);
          }
        }
      }

      // If the portal explicitly instructs a different system (e.g. "submit under aiaclinic.com"),
      // follow the portal instruction. This is more reliable than tags when data is inconsistent.
      // We still keep pay_type unchanged; the override is tracked in the run/result metadata.
      routingOverride =
        routingOverride || (this.mhcAsia.needsAIAClinicSwitch ? 'AIA_CLINIC_DIALOG' : null);
      if (routingOverride && !nric) {
        const msg = this.mhcAsia.lastDialogMessage || 'AIA Clinic instruction dialog detected';
        throw new Error(
          `Portal requires AIA Clinic but NRIC is missing (pay_type=${payTypeRaw}): ${msg}`
        );
      }

      // IMPORTANT: Do not route/switch system based on page-text heuristics (searchResult.portal).
      // We route portals based on pay_type; for MHC/AIA (non-Singlife) we stay in the base MHC portal.
      // addVisit() is only a guard in case the click lands on a page that still requires an "Add Visit" action.
      // If we detected the AIA Clinic instruction dialog, override to the AIA flow (Switch System -> AIA Clinic).
      // If we already routed via AIA Clinic in the search step, don't run addVisit again.
      if (
        !routingOverride &&
        !routedToAia &&
        !(typeof alreadyOnVisitForm !== 'undefined' && alreadyOnVisitForm)
      ) {
        await this.mhcAsia.addVisit('mhc', nric || null);
        await this.mhcAsia.page.waitForTimeout(500);
      }
    }

    // Ensure the active page is frontmost before filling (prevents UI/log mismatch).
    await this.mhcAsia.page.bringToFront().catch(() => {});
    await this.mhcAsia.enablePageScroll().catch(() => {});
    const ready = await this.mhcAsia.waitForVisitFormReady().catch(() => false);
    if (!ready) {
      throw new Error('Visit form not ready; aborting to avoid filling the wrong page');
    }

    // Ensure Visit Date is set on the final form.
    // For Singlife/Aviva (pcpcare), the visit date is set on the pre-search page and propagated into the form.
    // Re-filling on the final form can clear/deserialize the backing value and trigger "Visit date invalid!".
    if (visitDateForSearch && !forceSinglife) await this.mhcAsia.fillVisitDate(visitDateForSearch);

    // Set charge type (First Consult vs Follow Up)
    if (chargeType === 'first') {
      // Prefer the newer robust filler (row/options scan) before legacy selectors.
      const ok = await this.mhcAsia.fillChargeType('new').catch(() => false);
      if (!ok) await this.mhcAsia.setChargeTypeNewVisit().catch(() => {});
      const waiverSet = await this.mhcAsia.setWaiverOfReferral(true).catch(() => false);
      if (!waiverSet) {
        const referralRequiredHint = await this.mhcAsia.page
          .evaluate(() => {
            const t = String(globalThis.document?.body?.innerText || '');
            return /referring\s+clinic\s+is\s+required|referral\s+letter\s+is\s+required|waiver\s+of\s+referral/i.test(
              t
            );
          })
          .catch(() => false);
        if (referralRequiredHint) {
          const waiverState = this.mhcAsia.getLastWaiverReferralState?.() || null;
          const err = new Error(
            `referral_waiver_unset: unable to satisfy referral requirement before save (visitId=${visit.id}, nric=${nric})`
          );
          err.submissionMetadata = {
            success: false,
            portal: 'MHC Asia',
            savedAsDraft: false,
            reason: 'referral_waiver_unset',
            visitId: visit.id,
            nric: nric || null,
            payType: payTypeRaw || null,
            chargeType,
            waiverState,
          };
          throw err;
        }
      }
    } else {
      const ok = await this.mhcAsia.fillChargeType('follow up').catch(() => false);
      if (!ok) await this.mhcAsia.setChargeTypeFollowUp().catch(() => {});
    }
    await this.mhcAsia.page.waitForTimeout(200);

    // Set consultation fee (99999 triggers max amount dialog which auto-accepts)
    await this.mhcAsia.fillConsultationFee(99999);
    await this.mhcAsia.page.waitForTimeout(500);

    // Fill MC if applicable
    // Always set MC Day (even 0) to avoid portals defaulting to "?" and triggering validations.
    await this.mhcAsia.fillMcDays(mcDays ?? 0).catch(() => {});
    if (mcStartDate) {
      await this.mhcAsia.fillMcStartDate(mcStartDate).catch(() => {});
    }

    const buildGenericDiagnosisFallbackMode = ({
      stage = 'pre_fill',
      flow2Status = null,
      reason = null,
      variant = 'unresolved_diagnosis',
      dateGatePassed = null,
    } = {}) => ({
      mode: `${requestedMode === 'draft' ? 'generic_draft' : 'generic_fill_evidence'}_${variant}`,
      stage,
      requestedMode,
      code: genericFallbackDiagnosisCode || null,
      text: genericFallbackDiagnosisText,
      fallbackSource: fallbackLadder.source,
      diagnosisHint: {
        code: genericFallbackDiagnosisCode || null,
        description: genericFallbackDiagnosisText,
        side: diagnosisCanonical?.side || null,
        body_part: diagnosisCanonical?.body_part || null,
        condition: diagnosisCanonical?.condition || null,
      },
      flow2Status: flow2Status || null,
      reason: reason || 'flow2_unresolved',
      dateGatePassed,
      portalStrategy: 'prefer_option_then_text_fallback',
    });

    const assertFlow2DiagnosisReadyOrThrow = (stage = 'pre_fill') => {
      const flow2DiagnosisStatus = diagnosisResolution?.status || null;
      const flow2Resolved = flow2DiagnosisStatus === 'resolved';
      const flow2Missing =
        flow2DiagnosisStatus === 'missing' ||
        flow2DiagnosisStatus === 'missing_in_source' ||
        flow2DiagnosisStatus === 'found_but_invalid' ||
        (!flow2DiagnosisStatus && diagnosisMissingText) ||
        diagnosisMissingText;
      const flow2FallbackLowConfidence =
        allowGenericDiagnosisFallback && flow2DiagnosisStatus === 'fallback_low_confidence';
      const flow2DatePolicy = String(diagnosisResolution?.date_policy || '').trim() || null;
      const flow2DateOk = diagnosisResolution?.date_ok === true;
      const fallbackAgeDaysRaw = diagnosisResolution?.fallback_age_days;
      const fallbackAgeDays = Number.isFinite(Number(fallbackAgeDaysRaw))
        ? Number(fallbackAgeDaysRaw)
        : null;
      const fallbackWithinLimit = fallbackAgeDays === null || fallbackAgeDays <= 30;
      const flow2DateGatePassed = flow2DateOk && fallbackWithinLimit;
      if (flow2Resolved && flow2DateGatePassed) return;
      const useGenericPortalFallback =
        allowNonSubmitDiagnosisFallback &&
        (flow2Missing || flow2FallbackLowConfidence || !flow2Resolved || !flow2DateGatePassed);
      if (useGenericPortalFallback || (allowMissingDiagnosisDraftFallback && flow2Missing)) {
        diagnosisFallbackMode = buildGenericDiagnosisFallbackMode({
          stage,
          flow2Status: flow2DiagnosisStatus || null,
          reason: diagnosisResolution?.reason_if_unresolved || null,
          variant: flow2Missing
            ? 'missing_diagnosis'
            : flow2FallbackLowConfidence
              ? 'low_confidence_diagnosis'
              : 'unresolved_diagnosis',
          dateGatePassed: flow2DateGatePassed,
        });
        logger.warn(
          '[SUBMIT] Flow 2 diagnosis unresolved; using tiered portal diagnosis fallback',
          {
            visitId: visit.id,
            nric: nric || null,
            payType: payTypeRaw || null,
            requestedMode,
            flow2Status: flow2DiagnosisStatus || null,
            diagnosis: diagnosisDesc || null,
            fallbackCode: genericFallbackDiagnosisCode,
            fallbackText: genericFallbackDiagnosisText,
            fallbackSource: fallbackLadder.source,
            dateGatePassed: flow2DateGatePassed,
          }
        );
        return;
      }
      if (flow2FallbackLowConfidence) return;

      const diagMeta = {
        stage,
        visitId: visit.id,
        nric: nric || null,
        payType: payTypeRaw || null,
        rawDiagnosis: {
          code: diagnosisCode || null,
          description: diagnosisDesc || null,
        },
        canonicalDiagnosis: diagnosisCanonical || null,
        flow2DiagnosisResolution: diagnosisResolution || null,
        flow2DatePolicy,
        flow2DateOk,
        flow2FallbackLowConfidence,
        fallbackAgeDays,
        fallbackAgeLimitDays: 30,
        flow2DateGatePassed,
        reason: 'diagnosis_mapping_failed',
      };
      logger.error('[SUBMIT] Flow 2 diagnosis gate failed before fill', diagMeta);
      const err = new Error(
        `diagnosis_mapping_failed: unresolved Flow 2 diagnosis before form fill (visitId=${visit.id}, nric=${nric})`
      );
      err.submissionMetadata = {
        success: false,
        portal: 'MHC Asia',
        savedAsDraft: false,
        reason: 'diagnosis_mapping_failed',
        ...diagMeta,
      };
      throw err;
    };
    await assertFlow2DiagnosisReadyOrThrow();

    const portalContextHint = forceSinglife
      ? 'singlife'
      : this.mhcAsia.isAiaClinicSystem || routingOverride === 'AIA_CLINIC_DIALOG'
        ? 'aia'
        : 'mhc';

    const diagnosisPortalHint = diagnosisFallbackMode?.diagnosisHint || {
      code: diagnosisCanonical?.code_normalized || diagnosisCode || null,
      description: diagnosisCanonical?.description_canonical || diagnosisDesc || null,
      side: diagnosisCanonical?.side || null,
      body_part: diagnosisCanonical?.body_part || null,
      condition: diagnosisCanonical?.condition || null,
    };

    const diagnosisPrefetch = await this.mhcAsia
      .prefetchDiagnosisOptions({
        diagnosisHint: {
          code: diagnosisPortalHint.code || null,
          description: diagnosisPortalHint.description || null,
        },
        contextHint: portalContextHint,
        nric,
        visitDate: visit.visit_date || null,
      })
      .catch(() => null);
    portalDiagnosisOptions = Array.isArray(diagnosisPrefetch?.options)
      ? diagnosisPrefetch.options
      : [];

    const diagnosisMinScore = Number(process.env.DIAGNOSIS_MATCH_MIN_SCORE || 90);
    diagnosisMatch = resolveDiagnosisAgainstPortalOptions({
      diagnosis: diagnosisPortalHint,
      portalOptions: portalDiagnosisOptions,
      minScore: Number.isFinite(diagnosisMinScore) ? diagnosisMinScore : 90,
      codeMode: 'secondary',
    });

    const diagnosisResolutionWithPortal = {
      ...(diagnosisResolution || {}),
      portal_option_verified: diagnosisMatch?.blocked === false,
      portal_generic_fallback_used: !!diagnosisFallbackMode,
      portal_generic_fallback_mode: diagnosisFallbackMode?.mode || null,
      portal_generic_fallback_reason: diagnosisFallbackMode?.reason || null,
      draft_generic_fallback_used: saveDraftMode && !!diagnosisFallbackMode,
      draft_generic_fallback_reason: saveDraftMode ? diagnosisFallbackMode?.reason || null : null,
    };
    await this._mergeVisitExtractionMetadataPatch(visit.id, {
      portalDiagnosisOptions,
      diagnosisMatch,
      diagnosisResolution: diagnosisResolutionWithPortal,
    });

    if (!diagnosisMatch || diagnosisMatch.blocked !== false) {
      const flow2FallbackLowConfidence =
        allowGenericDiagnosisFallback && diagnosisResolution?.status === 'fallback_low_confidence';
      // When Flow 2 resolved the diagnosis but the portal ICD match is blocked
      // (e.g. ambiguous_close_candidates), in non-submit mode we can still attempt
      // to fill via M-button search using the canonical description.
      const flow2ResolvedButPortalBlocked =
        requestedMode !== 'submit' &&
        diagnosisResolution?.status === 'resolved' &&
        diagnosisMatch?.blocked === true &&
        diagnosisDesc;
      if (
        requestedMode !== 'submit' &&
        (flow2FallbackLowConfidence || diagnosisFallbackMode || flow2ResolvedButPortalBlocked)
      ) {
        if (flow2ResolvedButPortalBlocked && !diagnosisFallbackMode) {
          // Set up a fallback mode that will use M-button search with the original diagnosis text
          diagnosisFallbackMode = buildGenericDiagnosisFallbackMode({
            stage: 'portal_match_blocked',
            flow2Status: diagnosisResolution?.status,
            reason: diagnosisMatch?.blocked_reason || 'portal_match_blocked',
            variant: 'unresolved_diagnosis',
            dateGatePassed: true,
          });
          logger.warn(
            '[SUBMIT] Flow 2 resolved but portal match blocked; using M-button fallback',
            {
              visitId: visit.id,
              nric: nric || null,
              diagnosis: diagnosisDesc,
              blockedReason: diagnosisMatch?.blocked_reason,
              canonicalCondition: diagnosisCanonical?.condition,
              canonicalBodyPart: diagnosisCanonical?.body_part,
            }
          );
        } else {
          logger.warn('[SUBMIT] Non-submit diagnosis bypass enabled', {
            visitId: visit.id,
            nric: nric || null,
            requestedMode,
            diagnosis: diagnosisDesc || null,
            diagnosisCode: diagnosisCode || null,
            diagnosisMatch: diagnosisMatch || null,
            diagnosisFallbackMode: diagnosisFallbackMode || null,
          });
        }
      } else {
        const err = new Error(
          `diagnosis_mapping_failed: no safe portal diagnosis option match (visitId=${visit.id}, nric=${nric})`
        );
        err.submissionMetadata = {
          success: false,
          portal: 'MHC Asia',
          savedAsDraft: false,
          reason: 'diagnosis_mapping_failed',
          visitId: visit.id,
          nric: nric || null,
          payType: payTypeRaw || null,
          portalContextHint,
          rawDiagnosis: {
            code: diagnosisCode || null,
            description: diagnosisDesc || null,
          },
          canonicalDiagnosis: diagnosisCanonical || null,
          flow2DiagnosisResolution: diagnosisResolution || null,
          diagnosisMatch: diagnosisMatch || null,
          portalDiagnosisOptionsCount: portalDiagnosisOptions.length,
        };
        throw err;
      }
    }

    // Fill diagnosis. Non-submit fallback prefers a matched portal option, then falls back to text entry.
    // When Flow 2 has no diagnosis (missing_in_source) and the portal already has a valid
    // diagnosis (admin-entered), preserve it instead of overwriting with a generic fallback.
    let portalDiagnosisPreserved = false;
    if (
      diagnosisFallbackMode &&
      diagnosisResolution?.status === 'missing_in_source' &&
      requestedMode !== 'submit'
    ) {
      const existingDiag = await this.mhcAsia
        .getDiagnosisResolutionState({ waitMs: 300 })
        .catch(() => null);
      if (existingDiag?.resolved && existingDiag?.diagnosisPriDesc) {
        logger.info('[SUBMIT] Preserving portal existing diagnosis (admin-entered)', {
          visitId: visit.id,
          nric: nric || null,
          existingDiagnosis: existingDiag.diagnosisPriDesc,
          wouldHaveFilled: genericFallbackDiagnosisText,
          fallbackSource: fallbackLadder.source,
        });
        portalDiagnosisPreserved = true;
        diagnosisFallbackMode.portalPreserved = true;
        diagnosisFallbackMode.portalExistingDiagnosis = existingDiag.diagnosisPriDesc;
      }
    }
    if (diagnosisFallbackMode && !portalDiagnosisPreserved) {
      const fallbackDiagnosis = {
        code: diagnosisMatch?.selected_code || diagnosisFallbackMode.code || null,
        description:
          diagnosisMatch?.selected_text ||
          diagnosisFallbackMode.text ||
          genericFallbackDiagnosisText,
        value: diagnosisMatch?.selected_value || null,
      };
      // When the source genuinely had no diagnosis at all, suppress the
      // modal's "first ICD row wins" picker — without this guard we have
      // observed the picker latch onto a leftover row from the previous
      // patient (e.g. visit 3fb132fc was filed as "S83.411A - Sprain of
      // the knee" against an admin truth of "Cough"). A failure here
      // surfaces as `diagnosis_mapping_failed`, which is the right
      // outcome for an unfileable visit.
      const isGenuineMissing =
        diagnosisResolution?.status === 'missing_in_source' &&
        !diagnosisMatch?.selected_code &&
        !diagnosisMatch?.selected_text;
      let ok = false;
      if (diagnosisMatch?.blocked === false) {
        ok = await this.mhcAsia.selectDiagnosis(fallbackDiagnosis).catch(() => false);
      }
      if (!ok) {
        ok = await this.mhcAsia
          .fillDiagnosisPrimary(fallbackDiagnosis, {
            allowTextFallback: true,
            disableGenericRowPick: isGenuineMissing,
          })
          .catch(() => false);
      }
      if (!ok) {
        const err = new Error(
          `diagnosis_mapping_failed: unable to apply generic portal diagnosis fallback (visitId=${visit.id}, nric=${nric})`
        );
        err.submissionMetadata = {
          success: false,
          portal: 'MHC Asia',
          savedAsDraft: false,
          reason: 'diagnosis_mapping_failed',
          visitId: visit.id,
          nric: nric || null,
          payType: payTypeRaw || null,
          diagnosisFallbackMode,
        };
        throw err;
      }
    } else if (diagnosisDesc && !diagnosisMissingText && diagnosisMatch?.blocked === false) {
      const diagObj = {
        code: diagnosisMatch?.selected_code || diagnosisCanonical?.code_normalized || diagnosisCode,
        description:
          diagnosisMatch?.selected_text ||
          diagnosisCanonical?.description_canonical ||
          diagnosisDesc,
        value: diagnosisMatch?.selected_value || null,
      };
      let ok = await this.mhcAsia.selectDiagnosis(diagObj).catch(() => false);
      if (!ok) {
        ok = await this.mhcAsia
          .fillDiagnosisPrimary(diagObj, { allowTextFallback: false })
          .catch(() => false);
      }
      if (!ok) {
        const err = new Error(
          `diagnosis_mapping_failed: unable to select matched diagnosis option on portal (visitId=${visit.id}, nric=${nric})`
        );
        err.submissionMetadata = {
          success: false,
          portal: 'MHC Asia',
          savedAsDraft: false,
          reason: 'diagnosis_mapping_failed',
          visitId: visit.id,
          nric: nric || null,
          payType: payTypeRaw || null,
          diagnosisMatch: diagnosisMatch || null,
        };
        throw err;
      }
    }

    const assertDiagnosisResolvedOrThrow = async (stage = 'pre_save') => {
      const domDiagnosisState = await this.mhcAsia
        .getDiagnosisResolutionState({ waitMs: 300 })
        .catch(() => null);
      const flow2DiagnosisStatus = diagnosisResolution?.status || null;
      const flow2Resolved = flow2DiagnosisStatus === 'resolved';
      const flow2FallbackLowConfidence =
        allowGenericDiagnosisFallback && flow2DiagnosisStatus === 'fallback_low_confidence';
      const flow2DatePolicy = String(diagnosisResolution?.date_policy || '').trim() || null;
      const flow2DateOk = diagnosisResolution?.date_ok === true;
      const fallbackAgeDaysRaw = diagnosisResolution?.fallback_age_days;
      const fallbackAgeDays = Number.isFinite(Number(fallbackAgeDaysRaw))
        ? Number(fallbackAgeDaysRaw)
        : null;
      const fallbackWithinLimit = fallbackAgeDays === null || fallbackAgeDays <= 30;
      const flow2DateGatePassed = flow2DateOk && fallbackWithinLimit;
      const domResolved = !!domDiagnosisState?.resolved;
      const diagnosisMatchOk = diagnosisMatch?.blocked === false;
      if (
        requestedMode !== 'submit' &&
        flow2FallbackLowConfidence &&
        diagnosisFallbackMode &&
        domResolved
      )
        return;
      if (requestedMode !== 'submit' && diagnosisFallbackMode && domResolved) return;
      if (
        ((flow2Resolved && flow2DateGatePassed) || flow2FallbackLowConfidence) &&
        domResolved &&
        diagnosisMatchOk
      ) {
        return;
      }

      const diagnosisSelection = this.mhcAsia.getLastDiagnosisSelectionState?.() || null;
      const diagMeta = {
        stage,
        visitId: visit.id,
        nric: nric || null,
        payType: payTypeRaw || null,
        rawDiagnosis: {
          code: diagnosisCode || null,
          description: diagnosisDesc || null,
        },
        canonicalDiagnosis: diagnosisCanonical || null,
        flow2DiagnosisResolution: diagnosisResolution || null,
        flow2DatePolicy,
        flow2DateOk,
        flow2FallbackLowConfidence,
        fallbackAgeDays,
        fallbackAgeLimitDays: 30,
        flow2DateGatePassed,
        domDiagnosisState: domDiagnosisState || null,
        diagnosisMatch: diagnosisMatch || null,
        portalDiagnosisOptionsCount: portalDiagnosisOptions.length,
        diagnosisSelection: diagnosisSelection || null,
        attemptedSelectors: diagnosisSelection?.attemptedSelectors || null,
        lastPortalDialogMessage: this.mhcAsia.lastDialogMessage || null,
        diagnosisFallbackMode: diagnosisFallbackMode || null,
        reason: 'diagnosis_mapping_failed',
      };
      logger.error('[SUBMIT] Diagnosis gate failed', diagMeta);
      const err = new Error(
        `diagnosis_mapping_failed: unresolved primary diagnosis before save (visitId=${visit.id}, nric=${nric})`
      );
      err.submissionMetadata = {
        success: false,
        portal: 'MHC Asia',
        savedAsDraft: false,
        reason: 'diagnosis_mapping_failed',
        ...diagMeta,
      };
      throw err;
    };
    await assertDiagnosisResolvedOrThrow('post_diagnosis');

    // Fill services/drugs from Flow 2 if we have them.
    const meds = Array.isArray(metadata.medicines) ? metadata.medicines : null;
    const isJunkItem = name => {
      const n = String(name || '').trim();
      if (!n) return true;
      const lower = n.toLowerCase();
      if (lower === 'medicine') return true;
      if (lower.startsWith('unfit for ')) return true;
      if (lower.startsWith('take ') || lower.startsWith('apply ') || lower.startsWith('use '))
        return true;
      if (
        /(tab\/s|tablet|capsule|cap\/s)\b/i.test(n) &&
        /(daily|once|twice|bd|tds|after\s+food|before\s+food)\b/i.test(n)
      )
        return true;
      if (/^to be taken\b/i.test(lower) || /\bto be taken\b/i.test(lower)) return true;
      return false;
    };
    // Filter items that are actually diagnoses, consultations, or procedures — not drugs
    const isDiagnosisOrProcedure = name => {
      const lower = String(name || '')
        .trim()
        .toLowerCase();
      if (!lower) return false;
      // Consultation / procedure / radiology / brace items
      if (
        /\bconsultation\b|\bconsult\b|\bphysiotherapy\b|\bradiology\b|\bx-ray\b|\bmri\b|\bultrasound\b|\bbrace\b/i.test(
          lower
        )
      )
        return true;
      // Check against diagnosis text — diagnosis contamination in medicines list.
      // Compare against BOTH the resolved portal diagnosis AND the original Flow 2
      // diagnosis_description, because they can differ (e.g. fallback resolution).
      const diagTexts = [
        String(diagnosisCanonical?.description_canonical || '')
          .trim()
          .toLowerCase(),
        String(diagnosisDesc || '')
          .trim()
          .toLowerCase(),
        String(visit?.diagnosis_description || '')
          .trim()
          .toLowerCase(),
      ].filter(t => t.length >= 5);
      const nameTokens = lower
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 3);
      if (nameTokens.length >= 2) {
        for (const diagText of diagTexts) {
          const diagTokens = diagText
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length >= 3);
          if (diagTokens.length >= 2) {
            const diagSet = new Set(diagTokens);
            const overlap = nameTokens.filter(t => diagSet.has(t)).length;
            if (overlap / Math.max(nameTokens.length, diagTokens.length) >= 0.5) return true;
          }
        }
      }
      // Catch common medical condition patterns that are clearly not drugs
      if (
        /\b(?:deficiency|tear|rupture|fracture|dislocation|subluxation|contusion|laceration)\b/i.test(
          lower
        ) &&
        !/\b(?:mg|ml|mcg|tab|cap|cream|gel|ointment|syrup|drops)\b/i.test(lower)
      )
        return true;
      return false;
    };
    const seenItems = new Set();
    const normalizeQty = value => {
      if (value === null || value === undefined) return null;
      const s = String(value).trim();
      if (!s) return null;
      const m = s.match(/\d+(?:\.\d+)?/);
      return m ? m[0] : s;
    };
    const normalizeMoney = value => {
      if (value === null || value === undefined) return null;
      const s = String(value).replace(/,/g, '').trim();
      if (!s) return null;
      const m = s.match(/-?\d+(?:\.\d+)?/);
      if (!m) return null;
      const n = Number.parseFloat(m[0]);
      if (!Number.isFinite(n)) return null;
      return String(Number(n.toFixed(4)));
    };
    const items = (meds && meds.length ? meds : [])
      .map(m => {
        if (typeof m === 'string') return { name: m, quantity: null };
        const name = m?.name || m?.description || '';
        const quantityRaw = m?.quantity ?? m?.qty ?? m?.qtyValue ?? m?.qtyText ?? null;
        const quantity = normalizeQty(quantityRaw);
        const unit = m?.unit ?? m?.uom ?? m?.unitCode ?? null;
        const unitPrice = normalizeMoney(m?.unitPrice ?? m?.unit_price ?? m?.price ?? null);
        const amount = normalizeMoney(m?.amount ?? m?.lineAmount ?? m?.total ?? null);
        return { name, quantity, unit, unitPrice, amount };
      })
      .map(m => ({
        ...m,
        name: String(m?.name || '')
          .trim()
          .replace(/\s+/g, ' '),
      }))
      .filter(m => m.name && !isJunkItem(m.name) && !isDiagnosisOrProcedure(m.name))
      .filter(m => {
        const key = m.name.toUpperCase();
        if (!key) return false;
        if (seenItems.has(key)) return false;
        seenItems.add(key);
        return true;
      });
    if (items.length) {
      const qtyCount = items.filter(
        m => m.quantity !== null && m.quantity !== undefined && m.quantity !== ''
      ).length;
      const saveDraftMode = process.env.WORKFLOW_SAVE_DRAFT !== '0';
      const skipProceduresForDraft = process.env.MHC_SKIP_PROCEDURES_FOR_DRAFT !== '0';
      const isAiaFlow = this.mhcAsia.isAiaClinicSystem || routingOverride === 'AIA_CLINIC_DIALOG';
      // Draft-mode reliability: procedure rows frequently require master-code selections and
      // can hard-block save. Skip procedure fill for all MHC-family draft runs by default.
      const skipProcedures = saveDraftMode && skipProceduresForDraft;
      logger.info('[SUBMIT] Medicines summary', {
        count: items.length,
        qtyCount,
        skipProcedures,
        isAiaFlow,
        sample: items.slice(0, 5).map(m => ({
          name: m.name,
          quantity: m.quantity,
          unitPrice: m.unitPrice,
          amount: m.amount,
        })),
      });
      await this.mhcAsia.fillServicesAndDrugs(items, { skipProcedures }).catch(() => {});
    } else if (visit.treatment_detail) {
      const lines = String(visit.treatment_detail)
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean)
        .filter(line => !isJunkItem(line) && !isDiagnosisOrProcedure(line));
      if (lines.length) {
        const saveDraftMode = process.env.WORKFLOW_SAVE_DRAFT !== '0';
        const skipProceduresForDraft = process.env.MHC_SKIP_PROCEDURES_FOR_DRAFT !== '0';
        const skipProcedures = saveDraftMode && skipProceduresForDraft;
        logger.info('[SUBMIT] treatment_detail fallback items (filtered)', {
          visitId: visit.id,
          original: String(visit.treatment_detail).split(/\r?\n/).filter(Boolean).length,
          filtered: lines.length,
          sample: lines.slice(0, 5),
        });
        await this.mhcAsia.fillServicesAndDrugs(lines, { skipProcedures }).catch(() => {});
      }
    }

    // Help manual verification: ensure the page is scrollable and nudge to top.
    await this.mhcAsia.enablePageScroll().catch(() => {});

    // Evidence screenshot for verification (Flow 3 "fill-only" runs rely on this).
    await this.mhcAsia.page
      .screenshot({ path: `screenshots/mhc-asia-final-form-${visit.id}.png`, fullPage: true })
      .catch(() => {});
    await this.mhcAsia.page.bringToFront().catch(() => {});
    await this.mhcAsia.page
      .evaluate(() => {
        if (typeof globalThis.focus === 'function') globalThis.focus();
      })
      .catch(() => {});

    const botSnapshot = await this.mhcAsia
      .captureCurrentVisitFormSnapshot({
        visit,
        phase: 'bot_fill',
        portalTarget: 'MHC',
        includeScreenshot: true,
      })
      .catch(error => ({
        source: 'mhc_bot_fill',
        error: error?.message || String(error),
        artifacts: {
          json: null,
          screenshot: null,
        },
      }));

    // Save as draft (safety - don't auto-submit)
    const saveDraft = process.env.WORKFLOW_SAVE_DRAFT !== '0';
    let draftVerification = null;
    let draftSavedAccepted = false;
    const submittedTruthSnapshot = visit?.submission_metadata?.submittedTruthSnapshot || null;
    const submittedTruthCapture = visit?.submission_metadata?.submittedTruthCapture || null;
    if (saveDraft) {
      await assertDiagnosisResolvedOrThrow('pre_save');

      const ok = await this.mhcAsia.saveAsDraft();
      if (!ok) {
        const saveDraftResult = this.mhcAsia.getLastSaveDraftResult?.() || null;
        const reason = String(saveDraftResult?.reason || 'save_draft_failed');
        const isDuplicateVisit = reason === 'duplicate_visit_same_day';
        const err = new Error(
          isDuplicateVisit
            ? `Failed to save as draft (duplicate_visit_same_day): portal already has a same-day visit for this patient`
            : `Failed to save as draft (${reason}) (see screenshots/mhc-asia-save-draft-not-found.png and screenshots/mhc-asia-before-save-draft.png)`
        );
        err.submissionMetadata = {
          success: false,
          portal: 'MHC Asia',
          savedAsDraft: false,
          reason,
          visitId: visit.id,
          nric: nric || null,
          payType: payTypeRaw || null,
          chargeType,
          saveDraftResult,
          lastPortalDialogMessage: this.mhcAsia.lastDialogMessage || null,
        };
        throw err;
      }
      draftSavedAccepted = true;

      const verificationContext = forceSinglife
        ? 'singlife'
        : this.mhcAsia.isAiaClinicSystem || routingOverride === 'AIA_CLINIC_DIALOG'
          ? 'aia'
          : 'mhc';
      const allowCrossContext = verificationContext !== 'mhc';

      draftVerification = await this.mhcAsia.verifyDraftSavedInPortal({
        nric,
        visitDate: visit.visit_date || visitDateForSearch || null,
        patientName: fullName,
        contextHint: verificationContext,
        allowCrossContext,
      });

      if (!draftVerification?.found) {
        const saveDraftResult = this.mhcAsia.getLastSaveDraftResult?.() || null;
        const flow2FallbackLowConfidence =
          allowGenericDiagnosisFallback &&
          diagnosisResolution?.status === 'fallback_low_confidence';
        const allowUnverifiedDraftAcceptance =
          saveDraftResult?.success === true && saveDraftMode && flow2FallbackLowConfidence;
        if (allowUnverifiedDraftAcceptance) {
          logger.warn('[SUBMIT] Accepting unverified draft save for fallback_low_confidence case', {
            visitId: visit.id,
            nric: nric || null,
            contextHint: verificationContext,
            verification: draftVerification || null,
            saveDraftResult,
          });
          draftVerification = {
            ...(draftVerification || {}),
            found: false,
            accepted: true,
            unverified: true,
            reason: 'save_clicked_unverified_listing',
          };
        } else {
          draftSavedAccepted = false;
          logger.error('[SUBMIT] Save-as-draft click did not produce a verifiable draft entry', {
            visitId: visit.id,
            nric: nric || null,
            contextHint: verificationContext,
            verification: draftVerification || null,
          });
          throw new Error(
            `Draft not found in Edit/Draft after save click (nric=${nric}, context=${verificationContext})`
          );
        }
      }
    }

    const comparison = comparePortalTruthSnapshots({
      portalTarget: 'MHC',
      visit,
      botSnapshot,
      submittedTruthSnapshot,
      diagnosisMatch,
    });
    const fillVerification = buildFillVerificationFromSnapshots({
      expectedSnapshot: comparison.expectedSnapshot || null,
      botSnapshot,
    });
    const truthArtifacts = await writeFlow3TruthArtifacts({
      visit,
      portalTarget: 'MHC',
      expectedSnapshot: comparison.expectedSnapshot || null,
      botSnapshot,
      submittedTruthSnapshot,
      comparison,
      extra: {
        draftVerification: draftVerification || null,
        diagnosisMatch: diagnosisMatch || null,
        diagnosisResolution: diagnosisResolutionWithPortal || null,
        routingOverride: routingOverride || null,
      },
    }).catch(() => null);

    const evidenceSummary = [
      botSnapshot?.artifacts?.json ? 'bot_snapshot' : null,
      submittedTruthSnapshot?.artifacts?.json ? 'submitted_truth_snapshot' : null,
      truthArtifacts?.json ? 'comparison_artifact' : null,
    ]
      .filter(Boolean)
      .join(',');

    return {
      success: true,
      portal: 'MHC Asia',
      savedAsDraft: Boolean(saveDraft && draftSavedAccepted),
      persisted: saveDraft,
      routingOverride,
      draftVerification: draftVerification || null,
      draftReference: draftVerification?.row?.visitNo || null,
      chargeType,
      mcDays,
      botSnapshot: botSnapshot || null,
      submittedTruthSnapshot,
      submittedTruthCapture,
      fillVerification,
      comparison,
      mismatchCategories: comparison?.mismatchCategories || [],
      evidence: evidenceSummary || null,
      evidenceArtifacts: {
        botSnapshot: botSnapshot?.artifacts || null,
        submittedTruthSnapshot: submittedTruthSnapshot?.artifacts || null,
        comparison: truthArtifacts || null,
      },
      sessionState: 'healthy',
      diagnosisResolution: diagnosisResolutionWithPortal || null,
      diagnosisMatch: diagnosisMatch || null,
      diagnosisFallbackMode: diagnosisFallbackMode || null,
      portalDiagnosisOptionsCount: portalDiagnosisOptions.length,
      hasDiagnosis: !!((diagnosisDesc && !diagnosisMissingText) || diagnosisFallbackMode),
    };
  }

  _normalizeNricLike(value) {
    const raw = String(value || '')
      .trim()
      .toUpperCase();
    if (!raw) return '';
    const match = raw.match(/[STFGM]\d{7}[A-Z]/);
    if (match) return match[0];
    return raw.replace(/[\s\/\-]+/g, '');
  }

  _pickNricForVisit(visit, metadata = null) {
    const md = metadata || visit?.extraction_metadata || {};
    const candidates = [
      visit?.nric,
      visit?.patient_no,
      visit?.patient_number,
      visit?.patientId,
      md?.nric,
      md?.fin,
      md?.finNumber,
      md?.idNumber,
      md?.idNo,
      md?.patientId,
      md?.patient_id,
      md?.memberId,
      md?.member_id,
      md?.ic,
      md?.icNumber,
      visit?.patient_id,
      visit?.member_id,
    ].filter(Boolean);
    for (const cand of candidates) {
      const cleaned = this._normalizeNricLike(cand);
      if (/^[STFGM]\d{7}[A-Z]$/i.test(cleaned)) return cleaned;
    }
    for (const value of Object.values(md || {})) {
      if (typeof value !== 'string') continue;
      const cleaned = this._normalizeNricLike(value);
      if (/^[STFGM]\d{7}[A-Z]$/i.test(cleaned)) return cleaned;
    }
    for (const value of Object.values(visit || {})) {
      if (typeof value !== 'string') continue;
      const cleaned = this._normalizeNricLike(value);
      if (/^[STFGM]\d{7}[A-Z]$/i.test(cleaned)) return cleaned;
    }
    return '';
  }

  /**
   * Pick a normalized DOB (YYYY-MM-DD) for a visit. Looks at direct visit fields and
   * extraction_metadata.flow1 (where Flow 1 ClinicAssist extraction stores DOB).
   * Returns '' when no DOB is available.
   */
  _pickDobForVisit(visit, metadata = null) {
    const md = metadata || visit?.extraction_metadata || {};
    const candidates = [
      visit?.dob,
      visit?.date_of_birth,
      visit?.patient_dob,
      md?.dob,
      md?.date_of_birth,
      md?.flow1?.dob,
      md?.flow2?.dob,
    ].filter(Boolean);
    for (const cand of candidates) {
      const s = String(cand).trim();
      // Already-ISO YYYY-MM-DD wins immediately.
      const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (iso) {
        const yyyy = parseInt(iso[1], 10);
        const mm = parseInt(iso[2], 10);
        const dd = parseInt(iso[3], 10);
        if (yyyy >= 1900 && yyyy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
          return `${iso[1]}-${iso[2]}-${iso[3]}`;
        }
      }
    }
    return '';
  }

  async submitToAllianceMedinet(visit) {
    await this._applyRuntimeCredential('ALLIANCE_MEDINET', this.allianceMedinet?.config);
    try {
      return await this.allianceMedinetSubmitter.submit(visit);
    } catch (error) {
      const message = String(error?.message || '');
      const reason = String(error?.submissionMetadata?.reason || '')
        .trim()
        .toLowerCase();
      const allianceCode = error?.allianceError?.code || null;
      const allianceNetwork = String(error?.allianceError?.networkCode || '')
        .toUpperCase()
        .trim();
      const suggestedPortal = String(error?.allianceError?.suggestedPortal || '')
        .toUpperCase()
        .trim();
      const metadataHint = String(
        visit?.extraction_metadata?.allianceNetwork ||
          visit?.extraction_metadata?.flow3PortalHint ||
          ''
      )
        .toUpperCase()
        .trim();
      const looksLikeGePortalRuntime =
        metadataHint.includes('GE') &&
        /cannot\s+read\s+properties\s+of\s+undefined\s*\(reading\s*'res'\)/i.test(message);
      const isGeNetworkMismatch =
        reason === 'portal_route_mismatch_ge' ||
        suggestedPortal === 'GE_NTUC' ||
        allianceNetwork === 'GE' ||
        allianceCode === 'ge_popup_redirect' ||
        /tagged\s+under\s+GE\s+network/i.test(message) ||
        /redirected this member to GE portal popup/i.test(message);
      if (!isGeNetworkMismatch && !looksLikeGePortalRuntime) throw error;

      logger.warn(
        '[SUBMIT] Alliance Medinet indicates GE-network route; rerouting to GE/NTUC service',
        {
          visitId: visit?.id || null,
          payType: visit?.pay_type || null,
        }
      );

      await this._mergeVisitExtractionMetadataPatch(visit?.id, {
        allianceNetwork: 'GE',
        flow3PortalHint: 'GE_NTUC',
        allianceRerouteReason: 'network_ge_from_alliance_medinet',
        allianceRerouteAt: new Date().toISOString(),
      });

      const reroutedVisit = {
        ...visit,
        extraction_metadata: {
          ...(visit?.extraction_metadata || {}),
          allianceNetwork: 'GE',
          flow3PortalHint: 'GE_NTUC',
        },
      };
      return this.submitToGENtuc(reroutedVisit);
    }
  }

  /**
   * Format date for MHC portal (DD/MM/YYYY)
   * @private
   */
  _formatDateForMHC(dateStr) {
    if (!dateStr) return null;
    // Already in DD/MM/YYYY format
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;
    // Convert from YYYY-MM-DD
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
    return dateStr;
  }

  async submitToAllianz(visit) {
    const runtimeCredential = await this._getPortalCredential('ALLIANZ');
    // Allianz AMOS portal requires DOB to enable the SEARCH button. We attach
    // a normalized visit.dob (YYYY-MM-DD) sourced from extraction_metadata.flow1.dob
    // so the submitter's searchAttemptBuilder can fill the DOB field.
    const dob = this._pickDobForVisit(visit);
    const enrichedVisit = dob ? { ...visit, dob } : visit;
    return this._withIsolatedContext(AllianzSubmitter, enrichedVisit, runtimeCredential);
  }

  /**
   * Create an isolated browser context for portal submissions to prevent
   * session/cookie cross-contamination between portals sharing the same page.
   */
  async _withIsolatedContext(SubmitterClass, visit, runtimeCredential) {
    const mainPage = this.mhcAsia.page;
    const browser = mainPage.context().browser();
    let isolatedContext = null;
    let isolatedPage = null;
    const route =
      runtimeCredential?.portal_target ||
      runtimeCredential?.portalTarget ||
      SubmitterClass?.name?.replace(/Submitter$/, '') ||
      'UNKNOWN';
    const timeoutMs = this._getPortalTimeoutMs(route);
    let timeoutHandle = null;
    try {
      isolatedContext = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        ignoreHTTPSErrors: true,
      });
      isolatedPage = await isolatedContext.newPage();
      const isolatedSubmitter = new SubmitterClass(isolatedPage, this.steps);
      const operation = isolatedSubmitter.submit(visit, runtimeCredential);
      operation.catch(() => null);
      const timeout = new Promise((_, reject) => {
        timeoutHandle = globalThis.setTimeout(() => {
          reject(this._buildPortalTimeoutError(route, timeoutMs, visit));
        }, timeoutMs);
      });
      const result = await Promise.race([operation, timeout]);
      return result;
    } finally {
      if (timeoutHandle) globalThis.clearTimeout(timeoutHandle);
      if (isolatedPage) await isolatedPage.close().catch(() => {});
      if (isolatedContext) await isolatedContext.close().catch(() => {});
    }
  }

  async submitToFullerton(visit) {
    const runtimeCredential = await this._getPortalCredential('FULLERTON');
    return this._withIsolatedContext(FullertonSubmitter, visit, runtimeCredential);
  }

  async submitToIHP(visit) {
    const runtimeCredential = await this._getPortalCredential('IHP');
    return this._withIsolatedContext(IHPSubmitter, visit, runtimeCredential);
  }

  async submitToIXChange(visit) {
    const runtimeCredential = await this._getPortalCredential('IXCHANGE');
    return this._withIsolatedContext(IXChangeSubmitter, visit, runtimeCredential);
  }

  async submitToGENtuc(visit) {
    const runtimeCredential = await this._getPortalCredential('GE_NTUC');
    return this.geSubmitter.submit(visit, runtimeCredential);
  }

  /**
   * Submit all pending claims for a specific pay type
   */
  async submitAllPendingClaims(payType = null) {
    this.steps.step(1, 'Fetching pending claims', { payType });
    const pendingClaims = await this.getPendingClaims(payType);

    this.steps.step(2, `Found ${pendingClaims.length} pending claims`);

    const results = [];
    for (let i = 0; i < pendingClaims.length; i++) {
      const claim = pendingClaims[i];
      this.steps.step(3, `Submitting claim ${i + 1}/${pendingClaims.length}`, {
        patientName: claim.patient_name,
        payType: claim.pay_type,
      });

      const result = await this.submitClaim(claim);
      results.push({ claim, result });

      // Small delay between submissions
      await new Promise(resolve => globalThis.setTimeout(resolve, 2000));
    }

    const successCount = results.filter(r => r.result.success).length;
    this.steps.step(4, `Submitted ${successCount}/${pendingClaims.length} claims successfully`);

    return {
      success: true,
      total: pendingClaims.length,
      successful: successCount,
      failed: pendingClaims.length - successCount,
      results,
    };
  }
}
