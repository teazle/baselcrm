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
    const raw = String(process.env.FLOW3_MODE || '').trim().toLowerCase();
    if (raw === 'draft' || raw === 'submit' || raw === 'fill_evidence') return raw;
    if (process.env.WORKFLOW_SAVE_DRAFT === '1') return 'draft';
    if (process.env.ALLOW_LIVE_SUBMIT === '1') return 'submit';
    return 'fill_evidence';
  }

  _getDraftValidatedTargets() {
    const raw = String(process.env.FLOW3_DRAFT_VALIDATED_TARGETS || 'MHC,ALLIANCE_MEDINET')
      .split(',')
      .map(value => String(value || '').trim().toUpperCase())
      .filter(Boolean);
    return new Set(raw);
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
      submittedTruthCapture:
        patch.submittedTruthCapture ?? existing.submittedTruthCapture ?? null,
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

    let query = this.supabase
      .from('visits')
      .select('*')
      .eq('source', 'Clinic Assist')
      .is('submitted_at', null); // Not yet submitted

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
      if (!isFlow2EligibleVisit(visit?.extraction_metadata || null)) return false;
      const candidate = classifyVisitForRpa(
        visit?.pay_type || null,
        visit?.patient_name || null,
        visit?.nric || null,
        visit?.extraction_metadata || null,
        visit?.submission_status || null
      );
      if (candidate.status === 'not_claim_candidate') return false;
      if (candidate.status === 'manual_review' && !candidate.portalTarget) return false;
      if (!explicitVisitIds) {
        const mode = String(visit?.submission_metadata?.mode || '').trim().toLowerCase();
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

    const isVerificationOnly = requestedMode === 'fill_evidence';
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
        return this._normalizePortalResult({
          success: false,
          reason: 'skipped_by_config',
          blocked_reason: 'skipped_by_config',
          detailReason: 'ihp_temporarily_skipped',
          portal: 'IHP eClaim',
          portalService: 'IHP',
          submitted: false,
          savedAsDraft: false,
          error: 'IHP route skipped by FLOW3_SKIP_IHP=1',
        }, visit, route);
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
            { success: false, reason: 'unknown_pay_type', blocked_reason: 'portal_unknown', payType: payTypeRaw || null },
            visit,
            route
          );
      }

      result = this._normalizePortalResult(result, visit, route);

      // Persist submission status only when we actually did a portal action that should advance the workflow.
      // Today we only support "Save as Draft" (and we intentionally avoid auto-submit).
      // For fill-only verification runs (no draft), do NOT mark the record as submitted.
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
            reason:
              failureMetadata?.reason ||
              'portal_runtime_error',
            blocked_reason:
              failureMetadata?.blocked_reason ||
              failureMetadata?.reason ||
              'portal_runtime_error',
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
    const allowGenericDiagnosisFallback = process.env.FLOW2_ENABLE_GENERIC_DIAG_FALLBACK !== '0';
    const saveDraftMode = process.env.WORKFLOW_SAVE_DRAFT !== '0';
    const allowMissingDiagnosisDraftFallback =
      saveDraftMode && process.env.MHC_ALLOW_MISSING_DIAG_DRAFT_FALLBACK !== '0';
    const genericDraftDiagnosisText =
      String(process.env.MHC_GENERIC_DRAFT_DIAGNOSIS || 'General medical condition').trim() ||
      'General medical condition';
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
      diagnosisResolutionStatus: diagnosisResolution?.status || null,
      diagnosisCanonical: diagnosisCanonical?.description_canonical?.slice?.(0, 80) || null,
      allowMissingDiagnosisDraftFallback,
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
      if ((flow2Resolved && flow2DateGatePassed) || flow2FallbackLowConfidence) return;
      if (allowMissingDiagnosisDraftFallback && flow2Missing) {
        diagnosisFallbackMode = {
          mode: 'generic_draft_missing_diagnosis',
          stage,
          text: genericDraftDiagnosisText,
          flow2Status: flow2DiagnosisStatus || null,
          reason: diagnosisResolution?.reason_if_unresolved || null,
        };
        logger.warn(
          '[SUBMIT] Flow 2 diagnosis unresolved; using draft-only generic diagnosis fallback',
          {
            visitId: visit.id,
            nric: nric || null,
            payType: payTypeRaw || null,
            flow2Status: flow2DiagnosisStatus || null,
            diagnosis: diagnosisDesc || null,
            genericDraftDiagnosisText,
          }
        );
        return;
      }
      const allowGenericDraftFallback = allowGenericDiagnosisFallback && saveDraftMode;
      if (allowGenericDraftFallback) {
        diagnosisFallbackMode = {
          mode: flow2Missing
            ? 'generic_draft_missing_diagnosis'
            : 'generic_draft_unresolved_diagnosis',
          stage,
          text: genericDraftDiagnosisText,
          flow2Status: flow2DiagnosisStatus || null,
          reason: diagnosisResolution?.reason_if_unresolved || 'flow2_unresolved',
          dateGatePassed: flow2DateGatePassed,
        };
        logger.warn(
          '[SUBMIT] Flow 2 diagnosis unresolved; using draft-only generic diagnosis fallback',
          {
            visitId: visit.id,
            nric: nric || null,
            payType: payTypeRaw || null,
            flow2Status: flow2DiagnosisStatus || null,
            diagnosis: diagnosisDesc || null,
            genericDraftDiagnosisText,
            dateGatePassed: flow2DateGatePassed,
          }
        );
        return;
      }

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

    const diagnosisPrefetch = await this.mhcAsia
      .prefetchDiagnosisOptions({
        diagnosisHint: {
          code: diagnosisCanonical?.code_normalized || diagnosisCode || null,
          description: diagnosisCanonical?.description_canonical || diagnosisDesc || null,
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
      diagnosis: {
        code: diagnosisCanonical?.code_normalized || diagnosisCode || null,
        description: diagnosisCanonical?.description_canonical || diagnosisDesc || null,
        side: diagnosisCanonical?.side || null,
        body_part: diagnosisCanonical?.body_part || null,
        condition: diagnosisCanonical?.condition || null,
      },
      portalOptions: portalDiagnosisOptions,
      minScore: Number.isFinite(diagnosisMinScore) ? diagnosisMinScore : 90,
      codeMode: 'secondary',
    });

    const diagnosisResolutionWithPortal = {
      ...(diagnosisResolution || {}),
      portal_option_verified: !diagnosisFallbackMode && diagnosisMatch?.blocked === false,
      draft_generic_fallback_used: !!diagnosisFallbackMode,
      draft_generic_fallback_reason: diagnosisFallbackMode?.reason || null,
    };
    await this._mergeVisitExtractionMetadataPatch(visit.id, {
      portalDiagnosisOptions,
      diagnosisMatch,
      diagnosisResolution: diagnosisResolutionWithPortal,
    });

    if (!diagnosisMatch || diagnosisMatch.blocked !== false) {
      const flow2FallbackLowConfidence =
        allowGenericDiagnosisFallback && diagnosisResolution?.status === 'fallback_low_confidence';
      if (saveDraftMode && (flow2FallbackLowConfidence || diagnosisFallbackMode)) {
        logger.warn('[SUBMIT] Draft-mode diagnosis bypass enabled', {
          visitId: visit.id,
          nric: nric || null,
          diagnosis: diagnosisDesc || null,
          diagnosisCode: diagnosisCode || null,
          diagnosisMatch: diagnosisMatch || null,
          diagnosisFallbackMode: diagnosisFallbackMode || null,
        });
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

    // Fill diagnosis (matched option first; draft-only missing diagnosis falls back to generic free text).
    if (diagnosisFallbackMode) {
      const ok = await this.mhcAsia
        .fillDiagnosisPrimary(
          { code: null, description: diagnosisFallbackMode.text || genericDraftDiagnosisText },
          { allowTextFallback: true }
        )
        .catch(() => false);
      if (!ok) {
        const err = new Error(
          `diagnosis_mapping_failed: unable to apply generic draft diagnosis fallback (visitId=${visit.id}, nric=${nric})`
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
      if (saveDraftMode && flow2FallbackLowConfidence) return;
      if (saveDraftMode && diagnosisFallbackMode && domResolved) return;
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
      .filter(m => m.name && !isJunkItem(m.name))
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
        .filter(Boolean);
      if (lines.length) {
        const saveDraftMode = process.env.WORKFLOW_SAVE_DRAFT !== '0';
        const skipProceduresForDraft = process.env.MHC_SKIP_PROCEDURES_FOR_DRAFT !== '0';
        const skipProcedures = saveDraftMode && skipProceduresForDraft;
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
    return this.allianzSubmitter.submit(visit, runtimeCredential);
  }

  async submitToFullerton(visit) {
    const runtimeCredential = await this._getPortalCredential('FULLERTON');
    return this.fullertonSubmitter.submit(visit, runtimeCredential);
  }

  async submitToIHP(visit) {
    const runtimeCredential = await this._getPortalCredential('IHP');
    return this.ihpSubmitter.submit(visit, runtimeCredential);
  }

  async submitToIXChange(visit) {
    const runtimeCredential = await this._getPortalCredential('IXCHANGE');
    return this.ixchangeSubmitter.submit(visit, runtimeCredential);
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
