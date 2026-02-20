import { logger } from '../utils/logger.js';
import { extractAllianceMedinetTag } from '../../apps/crm/src/lib/rpa/portals.shared.js';

/**
 * Dedicated submit service for Alliance Medinet claim-form flow.
 * Keeps Alliance claim logic isolated from MHC flow implementation.
 */
export class AllianceMedinetSubmitter {
  constructor(automation, steps = null) {
    this.automation = automation;
    this.steps = steps;
  }

  _normalizeNricLike(value) {
    const raw = String(value || '')
      .trim()
      .toUpperCase();
    if (!raw) return '';
    const match = raw.match(/[STFGM]\d{7}[A-Z]/);
    if (match) return match[0];
    return raw.replace(/[\s\/-]+/g, '');
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

  _mapDoctorFromSpCode(spCodeRaw) {
    const raw = String(spCodeRaw || '')
      .toUpperCase()
      .trim();
    const compact = raw.replace(/[^A-Z]/g, '');
    if (!compact) {
      return { doctorName: null, matchedCode: null, normalizedSpCode: raw || null };
    }

    const priority = [
      { code: 'ARU', doctorName: 'Palanisamy Arul Murugan' },
      { code: 'PAM', doctorName: 'Palanisamy Arul Murugan' },
      { code: 'KT', doctorName: 'Tan Guoping Kelvin' },
      { code: 'KY', doctorName: 'Yip Man Hing Kevin' },
      { code: 'MT', doctorName: 'Tung Yu Yee Mathew' },
    ];
    for (const entry of priority) {
      if (compact.includes(entry.code)) {
        return { doctorName: entry.doctorName, matchedCode: entry.code, normalizedSpCode: raw };
      }
    }
    return { doctorName: null, matchedCode: null, normalizedSpCode: raw };
  }

  _isRetryableAllianceError(error) {
    const code = error?.allianceError?.code || null;
    if (code && ['login_trace_error', 'search_trace_error', 'search_wait_interrupted'].includes(code)) {
      return true;
    }
    const message = String(error?.message || '').toLowerCase();
    return (
      message.includes('unexpected error occurred') ||
      message.includes('trace id') ||
      message.includes('target page, context or browser has been closed') ||
      message.includes("reading 'res'") ||
      message.includes('claim form did not render')
    );
  }

  async submit(visit) {
    if (this.steps?.step) {
      this.steps.step(2, 'Submitting to Alliance Medinet');
    }

    const metadata = visit.extraction_metadata || {};
    const matchedTag = extractAllianceMedinetTag(visit.pay_type, visit.patient_name);
    const spCode = metadata.spCode || metadata.sp_code || null;
    const doctor = this._mapDoctorFromSpCode(spCode);

    const failValidation = async (reason, message) => {
      const screenshotPath = `screenshots/alliance-medinet-fail-${visit?.id || 'unknown'}-${Date.now()}.png`;
      try {
        if (this.automation?.page) {
          await this.automation.page.screenshot({ path: screenshotPath, fullPage: true });
        }
      } catch {
        // Best-effort evidence capture.
      }

      const err = new Error(message);
      err.submissionMetadata = {
        portal: 'Alliance Medinet',
        matchedTag: matchedTag || null,
        spCode: doctor.normalizedSpCode || null,
        doctorCode: doctor.matchedCode || null,
        doctorName: doctor.doctorName || null,
        savedAsDraft: false,
        reason,
        error: message,
        screenshot: screenshotPath,
      };
      throw err;
    };

    const nric = this._pickNricForVisit(visit, metadata);
    if (!nric) {
      await failValidation(
        'missing_nric',
        'NRIC not found in visit record - Alliance Medinet requires Member UIN/Membership ID'
      );
    }

    if (!doctor.doctorName) {
      await failValidation(
        'unknown_sp_code',
        `Unable to map doctor from SP code "${spCode || ''}" (required for Alliance Medinet flow)`
      );
    }

    logger.info('[SUBMIT] Alliance form data:', {
      nric,
      matchedTag: matchedTag || null,
      spCode: doctor.normalizedSpCode || null,
      doctorName: doctor.doctorName,
    });

    const maxAttempts = Math.max(1, Number(process.env.ALLIANCE_SUBMIT_MAX_ATTEMPTS || 2));
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.automation.login();
        await this.automation.navigateToMedicalTreatmentClaim();

        const found = await this.automation.searchMemberByNric(nric, visit.visit_date || null);
        if (!found?.found) {
          const noCoverageOnVisitDate = Boolean(found?.noCoverageOnVisitDate);
          return {
            success: false,
            reason: 'not_found',
            error: noCoverageOnVisitDate
              ? `Member has no coverage on selected visit date in Alliance Medinet: ${nric}`
              : `Member not found in Alliance Medinet: ${nric}`,
            noCoverageOnVisitDate,
            attempt,
          };
        }

        await this.automation.selectMemberAndAdd();
        const fillResult = await this.automation.fillClaimForm(
          {
            ...visit,
            nric,
          },
          doctor.doctorName
        );

        const saveDraft = process.env.WORKFLOW_SAVE_DRAFT !== '0';
        if (saveDraft) {
          const ok = await this.automation.saveAsDraft();
          if (!ok) {
            throw new Error('Failed to save Alliance Medinet claim as draft');
          }
        }

        return {
          success: true,
          portal: 'Alliance Medinet',
          matchedTag: matchedTag || null,
          spCode: doctor.normalizedSpCode || null,
          doctorCode: doctor.matchedCode || null,
          doctorName: doctor.doctorName,
          savedAsDraft: saveDraft,
          persisted: saveDraft,
          submitted: false,
          attempt,
          diagnosisPortalMatch: fillResult?.diagnosisPortalMatch || null,
        };
      } catch (error) {
        const allianceCode = error?.allianceError?.code || null;
        const allianceNetwork = String(error?.allianceError?.networkCode || '')
          .toUpperCase()
          .trim();
        const retryable = this._isRetryableAllianceError(error);
        const traceId = error?.allianceError?.traceId || null;
        const lastAction = error?.allianceError?.lastAction || this.automation?.lastAction || null;
        const gePopupUrl = error?.allianceError?.gePopupUrl || null;
        const message = String(error?.message || '');
        const isGeRouteMismatch =
          allianceCode === 'ge_popup_redirect' ||
          allianceNetwork === 'GE' ||
          /tagged\s+under\s+GE\s+network/i.test(message);
        const canRetry = retryable && attempt < maxAttempts;

        logger.warn('[SUBMIT] Alliance visit attempt failed', {
          attempt,
          maxAttempts,
          retryable,
          canRetry,
          traceId,
          lastAction,
          error: error?.message || String(error),
        });

        if (!canRetry) {
          if (allianceCode === 'add_claim_form_runtime_error' && !isGeRouteMismatch) {
            // Known portal-side failure mode: member row exists but Add crashes in portal JS.
            // Treat as not-started so batch can continue while retaining evidence metadata.
            return {
              success: false,
              reason: 'not_found',
              error:
                'Alliance Medinet failed to open claim form after Add (portal runtime error for this member).',
              portal: 'Alliance Medinet',
              matchedTag: matchedTag || null,
              spCode: doctor.normalizedSpCode || null,
              doctorCode: doctor.matchedCode || null,
              doctorName: doctor.doctorName || null,
              savedAsDraft: false,
              submitted: false,
              attempt,
              maxAttempts,
              traceId,
              lastAction,
              allianceNetwork: allianceNetwork || null,
              blockedByPortalRuntime: true,
            };
          }

          const err = error instanceof Error ? error : new Error(String(error));
          err.submissionMetadata = {
            portal: 'Alliance Medinet',
            matchedTag: matchedTag || null,
            spCode: doctor.normalizedSpCode || null,
            doctorCode: doctor.matchedCode || null,
            doctorName: doctor.doctorName || null,
            savedAsDraft: false,
            reason: isGeRouteMismatch
              ? 'portal_route_mismatch_ge'
              : retryable
                ? 'portal_transient_error'
                : 'submission_failed',
            error: err.message,
            attempt,
            maxAttempts,
            traceId,
            lastAction,
            recommendedPortal: isGeRouteMismatch ? 'GE' : null,
            allianceNetwork: isGeRouteMismatch ? 'GE' : null,
            gePopupUrl: isGeRouteMismatch ? gePopupUrl : null,
          };
          throw err;
        }

        this.automation.loggedIn = false;
        await this.automation.page.waitForTimeout(1500).catch(() => {});
      }
    }
    throw new Error('Alliance Medinet submission failed after retries');
  }
}
