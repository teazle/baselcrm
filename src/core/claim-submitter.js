import { logger } from '../utils/logger.js';
import { MHCAsiaAutomation } from '../automations/mhc-asia.js';
import { StepLogger } from '../utils/step-logger.js';
import { createSupabaseClient } from '../utils/supabase-client.js';

/**
 * Claim Submitter: Routes claims to appropriate portals based on pay type
 */
export class ClaimSubmitter {
  constructor(mhcAsiaPage) {
    this.mhcAsia = new MHCAsiaAutomation(mhcAsiaPage);
    this.steps = new StepLogger({ total: 10, prefix: 'SUBMIT' });
    this.supabase = createSupabaseClient();
    this.mhcAsiaLoggedIn = false;
  }

  /**
   * Get pending claims from CRM that need to be submitted
   */
  async getPendingClaims(payType = null, visitIds = null, opts = {}) {
    if (!this.supabase) {
      logger.warn('[SUBMIT] Supabase not configured; cannot fetch pending claims');
      return [];
    }

    const { from = null, to = null, portalOnly = false } = opts || {};

    let query = this.supabase
      .from('visits')
      .select('*')
      .eq('source', 'Clinic Assist')
      .not('pay_type', 'is', null)
      .neq('pay_type', '')
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
      query = query.or(
        [
          'pay_type.ilike.%MHC%',
          'pay_type.ilike.%AIA%',
          'pay_type.ilike.%AIACLIENT%',
          'pay_type.ilike.%AVIVA%',
          'pay_type.ilike.%SINGLIFE%',
        ].join(',')
      );
    }

    if (Array.isArray(visitIds) && visitIds.length > 0) {
      query = query.in('id', visitIds);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('[SUBMIT] Failed to fetch pending claims', { error: error.message });
      return [];
    }

    return data || [];
  }

  /**
   * Submit a claim to the appropriate portal based on pay type
   */
  async submitClaim(visit) {
    const payTypeRaw = String(visit.pay_type || '').toUpperCase();
    
    this.steps.step(1, `Submitting claim for ${visit.patient_name}`, { payType: payTypeRaw || null, visitId: visit.id });

    const isVerificationOnly = process.env.WORKFLOW_SAVE_DRAFT === '0';
    const allowLiveSubmit = process.env.ALLOW_LIVE_SUBMIT === '1';
    // By default we do NOT persist per-visit error states during verification (fill-only) runs.
    // Persisting errors is only useful once we're actively saving drafts/submitting.
    const shouldPersistErrors =
      process.env.WORKFLOW_PERSIST_ERRORS === '1' || !isVerificationOnly;

    try {
      let result = null;

      // Route to appropriate portal based on pay type
      // Note: AVIVA/SINGLIFE are handled via MHC Asia "Switch System" -> Singlife PCP (pcpcare) flow.
      if (/(^|[^A-Z])MHC([^A-Z]|$)/.test(payTypeRaw) || payTypeRaw.includes('AIA') || payTypeRaw.includes('AIACLIENT') || payTypeRaw.includes('AVIVA') || payTypeRaw.includes('SINGLIFE')) {
        result = await this.submitToMHCAsia(visit);
      } else if (payTypeRaw.includes('IHP')) {
        result = await this.submitToIHP(visit);
      } else if (payTypeRaw.includes('GE')) {
        result = await this.submitToGE(visit);
      } else if (payTypeRaw.includes('FULLERT')) {
        result = await this.submitToFullert(visit);
      } else if (payTypeRaw.includes('ALLIMED') || payTypeRaw === 'ALL') {
        result = await this.submitToAllimed(visit);
      } else {
        logger.warn(`[SUBMIT] Unknown pay type: ${payTypeRaw}. Skipping submission.`);
        return { success: false, reason: 'unknown_pay_type', payType: payTypeRaw || null };
      }

      // Persist submission status only when we actually did a portal action that should advance the workflow.
      // Today we only support "Save as Draft" (and we intentionally avoid auto-submit).
      // For fill-only verification runs (no draft), do NOT mark the record as submitted.
      if (result?.success && this.supabase) {
        if (result.submitted && !allowLiveSubmit) {
          logger.error('[SUBMIT] Live submit result blocked by policy (draft-only mode)', {
            visitId: visit.id,
            payType: payTypeRaw || null,
          });
          result = { ...result, success: false, submitted: false, error: 'Live submit blocked (draft-only mode)' };
        }
        const shouldPersist = Boolean(result.savedAsDraft) || (allowLiveSubmit && Boolean(result.submitted));
        const submissionStatus = result.savedAsDraft ? 'draft' : (allowLiveSubmit && result.submitted ? 'submitted' : null);
        if (shouldPersist && submissionStatus) {
          await this.supabase
            .from('visits')
            .update({
              submitted_at: new Date().toISOString(),
              submission_status: submissionStatus,
              submission_portal: payTypeRaw || null,
              submission_metadata: result,
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
      logger.error(`[SUBMIT] Error submitting claim for ${visit.patient_name}`, { error: error.message });
      
      // Update visit with error status only when this run intends to advance workflow state.
      // For fill-only verification, keep the DB clean and rely on run logs/screenshots instead.
      if (this.supabase && shouldPersistErrors) {
        await this.supabase
          .from('visits')
          .update({
            submission_status: 'error',
            submission_error: error.message,
          })
          .eq('id', visit.id);
      } else {
        logger.info('[SUBMIT] Verification run: not persisting submission_status=error', {
          visitId: visit.id,
          payType: payTypeRaw || null,
          error: error.message,
        });
      }

      return { success: false, error: error.message };
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

    const metadata = visit.extraction_metadata || {};
    const payTypeRaw = String(visit.pay_type || '').toUpperCase();
    const forceSinglife = payTypeRaw.includes('AVIVA') || payTypeRaw.includes('SINGLIFE');
    let routingOverride = null;

    const stripLeadingTag = (value) => {
      const s = String(value || '').trim();
      if (!s) return '';
      // Search must NOT include the tag prefix (clinic requirement).
      return s.replace(/^(MHC|AVIVA|SINGLIFE|AIA|AIACLIENT|FULLERT|ALLIANZ|ALL|IHP|GE)\\s*[-:]+\\s*/i, '').trim();
    };

    const normalizeNricLike = (value) => {
      const raw = String(value || '').trim().toUpperCase();
      if (!raw) return '';
      const match = raw.match(/[STFGM]\d{7}[A-Z]/);
      if (match) return match[0];
      return raw.replace(/[\s\/\-]+/g, '');
    };
    const pickNric = () => {
      const candidates = [
        visit.nric,
        visit.patient_no,
        visit.patient_number,
        visit.patientId,
        metadata.nric,
        metadata.fin,
        metadata.finNumber,
        metadata.idNumber,
        metadata.idNo,
        metadata.patientId,
        metadata.patient_id,
        metadata.memberId,
        metadata.member_id,
        metadata.ic,
        metadata.icNumber,
        visit.patient_id,
        visit.member_id,
      ].filter(Boolean);
      for (const cand of candidates) {
        const cleaned = normalizeNricLike(cand);
        if (/^[STFGM]\d{7}[A-Z]$/i.test(cleaned)) return cleaned;
      }
      for (const value of Object.values(metadata || {})) {
        if (typeof value !== 'string') continue;
        const cleaned = normalizeNricLike(value);
        if (/^[STFGM]\d{7}[A-Z]$/i.test(cleaned)) return cleaned;
      }
      for (const value of Object.values(visit || {})) {
        if (typeof value !== 'string') continue;
        const cleaned = normalizeNricLike(value);
        if (/^[STFGM]\d{7}[A-Z]$/i.test(cleaned)) return cleaned;
      }
      return '';
    };

    // NRIC/FIN/Member ID is mandatory for MHC/AIA/Singlife.
    const nric = pickNric();
    const fullName = stripLeadingTag(visit.patient_name);
    if (!nric) {
      throw new Error('NRIC not found in visit record - MHC/AIA/Singlife requires NRIC/FIN/Member ID (run Flow 2 / fix Flow 1 data)');
    }

    // Get extracted data from Flow 2
    const chargeType = metadata.chargeType || 'follow';
    const mcDays = metadata.mcDays || 0;
    const mcStartDate = metadata.mcStartDate || null;
    const diagnosisDesc = visit.diagnosis_description;
    const diagnosisCode = metadata.diagnosisCode || null;

    logger.info('[SUBMIT] MHC form data:', {
      nric: nric || null,
      patientName: fullName || null,
      chargeType,
      mcDays,
      mcStartDate,
      diagnosis: diagnosisDesc?.substring(0, 50),
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
      visitDateFormatted && /^\d{2}\/\d{2}\/\d{4}$/.test(visitDateFormatted) ? visitDateFormatted : null;
    if (forceSinglife) {
      // Singlife/Aviva: MHC -> Switch System -> Singlife PCP -> Add Normal Visit -> search by NRIC.
      // This path lands directly on the visit form (no separate addVisit step).
      // Do an explicit system switch here as a fast-path; navigateToSinglifeNormalVisitAndSearch()
      // also defends against being in the wrong system.
      await this.mhcAsia.switchToSinglifeIfNeeded({ force: true }).catch(() => false);
      const ok = await this.mhcAsia.navigateToSinglifeNormalVisitAndSearch(nric, visitDateForSearch);
      if (!ok) {
        throw new Error(`Failed to open Singlife visit form for NRIC ${nric} (see screenshots/mhc-asia-singlife-*.png)`);
      }
    } else {
      let routedToAia = false;
      let alreadyOnVisitForm = false;
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
        const ok = await this.mhcAsia.navigateToAIAVisitAndSearch(nric);
        if (!ok) {
          throw new Error(`Failed to open AIA visit form for NRIC ${nric} (see screenshots/mhc-asia-aia-*.png)`);
        }
        routedToAia = true;
      } else if (searchResult?.memberNotFound) {
        return { success: false, reason: 'not_found', error: `Member not found in MHC Asia: ${nric}` };
      } else if (!searchResult || !searchResult.found) {
        // Some members trigger a portal alert: "Please submit this claim under www.aiaclinic.com".
        // In that case, we must switch system and continue the AIA Clinic flow even if no
        // patient row is shown on the MHC search results table.
        throw new Error(`Patient not found in MHC Asia: ${nric}`);
      } else {
        const opened = await this.mhcAsia.openPatientFromSearchResults(nric);
        alreadyOnVisitForm = opened === true;
        if (this.mhcAsia.needsAIAClinicSwitch && nric) {
          routingOverride = 'AIA_CLINIC_DIALOG';
          logger.info('[SUBMIT] Routing override: AIA Clinic required by portal dialog (after patient click)', {
            nric: nric,
            msg: this.mhcAsia.lastDialogMessage || null,
          });
          await this.mhcAsia.switchToAIAClinicIfNeeded();
          const ok = await this.mhcAsia.navigateToAIAVisitAndSearch(nric);
          if (!ok) {
            throw new Error(`Failed to open AIA visit form for NRIC ${nric} (see screenshots/mhc-asia-aia-*.png)`);
          }
          routedToAia = true;
        } else if (!opened) {
          if (searchResult?.memberNotFound) {
            return { success: false, reason: 'not_found', error: `Member not found in MHC Asia: ${nric}` };
          }
          throw new Error(`Could not open patient from search results: ${nric}`);
        }
      }

      // If the portal explicitly instructs a different system (e.g. "submit under aiaclinic.com"),
      // follow the portal instruction. This is more reliable than tags when data is inconsistent.
      // We still keep pay_type unchanged; the override is tracked in the run/result metadata.
      routingOverride = routingOverride || (this.mhcAsia.needsAIAClinicSwitch ? 'AIA_CLINIC_DIALOG' : null);
      if (routingOverride && !nric) {
        const msg = this.mhcAsia.lastDialogMessage || 'AIA Clinic instruction dialog detected';
        throw new Error(`Portal requires AIA Clinic but NRIC is missing (pay_type=${payTypeRaw}): ${msg}`);
      }

      // IMPORTANT: Do not route/switch system based on page-text heuristics (searchResult.portal).
      // We route portals based on pay_type; for MHC/AIA (non-Singlife) we stay in the base MHC portal.
      // addVisit() is only a guard in case the click lands on a page that still requires an "Add Visit" action.
      // If we detected the AIA Clinic instruction dialog, override to the AIA flow (Switch System -> AIA Clinic).
      // If we already routed via AIA Clinic in the search step, don't run addVisit again.
      if (!routingOverride && !routedToAia && !(typeof alreadyOnVisitForm !== 'undefined' && alreadyOnVisitForm)) {
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
      await this.mhcAsia.setChargeTypeNewVisit();
      await this.mhcAsia.setWaiverOfReferral(true).catch(() => {});
    } else {
      await this.mhcAsia.setChargeTypeFollowUp();
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

    // Fill diagnosis if available
    if (diagnosisDesc && diagnosisDesc !== 'Missing diagnosis') {
      const diagObj = { code: diagnosisCode, description: diagnosisDesc };
      const ok = await this.mhcAsia.selectDiagnosis(diagObj).catch(() => false);
      if (!ok) await this.mhcAsia.fillDiagnosisPrimary(diagObj).catch(() => {});
    }

    // Fill services/drugs from Flow 2 if we have them.
    const meds = Array.isArray(metadata.medicines) ? metadata.medicines : null;
    const isJunkItem = (name) => {
      const n = String(name || '').trim();
      if (!n) return true;
      const lower = n.toLowerCase();
      if (lower === 'medicine') return true;
      if (lower.startsWith('unfit for ')) return true;
      if (lower.startsWith('take ') || lower.startsWith('apply ') || lower.startsWith('use ')) return true;
      if (/(tab\/s|tablet|capsule|cap\/s)\b/i.test(n) && /(daily|once|twice|bd|tds|after\s+food|before\s+food)\b/i.test(n)) return true;
      if (/^to be taken\b/i.test(lower) || /\bto be taken\b/i.test(lower)) return true;
      return false;
    };
    const seenItems = new Set();
    const normalizeQty = (value) => {
      if (value === null || value === undefined) return null;
      const s = String(value).trim();
      if (!s) return null;
      const m = s.match(/\d+(?:\.\d+)?/);
      return m ? m[0] : s;
    };
    const items = (meds && meds.length ? meds : [])
      .map((m) => {
        if (typeof m === 'string') return { name: m, quantity: null };
        const name = m?.name || m?.description || '';
        const quantityRaw =
          m?.quantity ?? m?.qty ?? m?.qtyValue ?? m?.qtyText ?? m?.amount ?? m?.amountText ?? null;
        const quantity = normalizeQty(quantityRaw);
        return { name, quantity };
      })
      .map((m) => ({ ...m, name: String(m?.name || '').trim().replace(/\s+/g, ' ') }))
      .filter((m) => m.name && !isJunkItem(m.name))
      .filter((m) => {
        const key = m.name.toUpperCase();
        if (!key) return false;
        if (seenItems.has(key)) return false;
        seenItems.add(key);
        return true;
      });
    if (items.length) {
      const qtyCount = items.filter(
        (m) => m.quantity !== null && m.quantity !== undefined && m.quantity !== ''
      ).length;
      const saveDraftMode = process.env.WORKFLOW_SAVE_DRAFT !== '0';
      const skipProceduresForDraft = process.env.MHC_SKIP_PROCEDURES_FOR_DRAFT !== '0';
      const isAiaFlow = this.mhcAsia.isAiaClinicSystem || routingOverride === 'AIA_CLINIC_DIALOG';
      const skipProcedures = saveDraftMode && skipProceduresForDraft && isAiaFlow;
      logger.info('[SUBMIT] Medicines summary', {
        count: items.length,
        qtyCount,
        skipProcedures,
        sample: items.slice(0, 5).map((m) => ({ name: m.name, quantity: m.quantity })),
      });
      await this.mhcAsia.fillServicesAndDrugs(items, { skipProcedures }).catch(() => {});
    } else if (visit.treatment_detail) {
      const lines = String(visit.treatment_detail)
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (lines.length) {
        const saveDraftMode = process.env.WORKFLOW_SAVE_DRAFT !== '0';
        const skipProceduresForDraft = process.env.MHC_SKIP_PROCEDURES_FOR_DRAFT !== '0';
        const isAiaFlow = this.mhcAsia.isAiaClinicSystem || routingOverride === 'AIA_CLINIC_DIALOG';
        const skipProcedures = saveDraftMode && skipProceduresForDraft && isAiaFlow;
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
    await this.mhcAsia.page.evaluate(() => window.focus()).catch(() => {});

    // Save as draft (safety - don't auto-submit)
    const saveDraft = process.env.WORKFLOW_SAVE_DRAFT !== '0';
    if (saveDraft) {
      const ok = await this.mhcAsia.saveAsDraft();
      if (!ok) {
        throw new Error('Failed to save as draft (see screenshots/mhc-asia-save-draft-not-found.png and screenshots/mhc-asia-before-save-draft.png)');
      }
    }

    return { 
      success: true, 
      portal: 'MHC Asia', 
      savedAsDraft: saveDraft,
      persisted: saveDraft,
      routingOverride,
      chargeType,
      mcDays,
      hasDiagnosis: !!(diagnosisDesc && diagnosisDesc !== 'Missing diagnosis')
    };
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

  /**
   * Submit to IHP portal (placeholder - implement when IHP automation is available)
   */
  async submitToIHP(visit) {
    this.steps.step(2, 'Submitting to IHP portal');
    logger.warn('[SUBMIT] IHP portal automation not yet implemented');
    return { success: false, reason: 'not_implemented', portal: 'IHP' };
  }

  /**
   * Submit to GE portal (placeholder)
   */
  async submitToGE(visit) {
    this.steps.step(2, 'Submitting to GE portal');
    logger.warn('[SUBMIT] GE portal automation not yet implemented');
    return { success: false, reason: 'not_implemented', portal: 'GE' };
  }

  /**
   * Submit to Fullert portal (placeholder)
   */
  async submitToFullert(visit) {
    this.steps.step(2, 'Submitting to Fullert portal');
    logger.warn('[SUBMIT] Fullert portal automation not yet implemented');
    return { success: false, reason: 'not_implemented', portal: 'Fullert' };
  }

  /**
   * Submit to Allimed portal (placeholder)
   */
  async submitToAllimed(visit) {
    this.steps.step(2, 'Submitting to Allimed portal');
    logger.warn('[SUBMIT] Allimed portal automation not yet implemented');
    return { success: false, reason: 'not_implemented', portal: 'Allimed' };
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
        payType: claim.pay_type 
      });

      const result = await this.submitClaim(claim);
      results.push({ claim, result });

      // Small delay between submissions
      await new Promise(resolve => setTimeout(resolve, 2000));
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
