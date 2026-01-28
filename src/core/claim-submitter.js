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
  async getPendingClaims(payType = null) {
    if (!this.supabase) {
      logger.warn('[SUBMIT] Supabase not configured; cannot fetch pending claims');
      return [];
    }

    let query = this.supabase
      .from('visits')
      .select('*')
      .eq('source', 'Clinic Assist')
      .is('submitted_at', null); // Not yet submitted

    if (payType) {
      query = query.eq('pay_type', payType);
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
    const payType = visit.pay_type?.toUpperCase();
    
    this.steps.step(1, `Submitting claim for ${visit.patient_name}`, { payType, visitId: visit.id });

    try {
      let result = null;

      // Route to appropriate portal based on pay type
      if (payType === 'MHC' || payType === 'AIA' || payType === 'AIACLIENT') {
        result = await this.submitToMHCAsia(visit);
      } else if (payType === 'IHP') {
        result = await this.submitToIHP(visit);
      } else if (payType === 'GE') {
        result = await this.submitToGE(visit);
      } else if (payType === 'FULLERT') {
        result = await this.submitToFullert(visit);
      } else if (payType === 'ALLIMED' || payType === 'ALL') {
        result = await this.submitToAllimed(visit);
      } else {
        logger.warn(`[SUBMIT] Unknown pay type: ${payType}. Skipping submission.`);
        return { success: false, reason: 'unknown_pay_type', payType };
      }

      // Update visit record with submission status
      if (result.success && this.supabase) {
        await this.supabase
          .from('visits')
          .update({
            submitted_at: new Date().toISOString(),
            submission_status: 'submitted',
            submission_portal: payType,
            submission_metadata: result,
          })
          .eq('id', visit.id);
      }

      return result;
    } catch (error) {
      logger.error(`[SUBMIT] Error submitting claim for ${visit.patient_name}`, { error: error.message });
      
      // Update visit with error status
      if (this.supabase) {
        await this.supabase
          .from('visits')
          .update({
            submission_status: 'error',
            submission_error: error.message,
          })
          .eq('id', visit.id);
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

    // Get NRIC (required)
    const nric = visit.nric || metadata.nric;
    if (!nric) {
      throw new Error('NRIC not found in visit record - run Flow 2 first');
    }

    // Get extracted data from Flow 2
    const chargeType = metadata.chargeType || 'follow';
    const mcDays = metadata.mcDays || 0;
    const mcStartDate = metadata.mcStartDate || null;
    const diagnosisDesc = visit.diagnosis_description;

    logger.info('[SUBMIT] MHC form data:', {
      nric,
      chargeType,
      mcDays,
      mcStartDate,
      diagnosis: diagnosisDesc?.substring(0, 50)
    });

    // Login to MHC Asia if not already logged in
    if (!this.mhcAsiaLoggedIn) {
      await this.mhcAsia.login();
      this.mhcAsiaLoggedIn = true;
    } else {
      // Reset state: go back to MHC homepage before each patient
      // This ensures we're not stuck in AIA Clinic mode from previous patient
      logger.info('[SUBMIT] Resetting MHC state - navigating to homepage');
      await this.mhcAsia.page.goto(this.mhcAsia.config.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.mhcAsia.page.waitForTimeout(1000);
      
      // Check if we need to re-login (session may have expired or navigating to homepage shows login)
      const loginFormVisible = await this.mhcAsia.page.locator('input[name="txtPassword"], input[type="password"]').first().isVisible().catch(() => false);
      if (loginFormVisible) {
        logger.info('[SUBMIT] Login form visible - re-logging in');
        await this.mhcAsia.login();
      }
    }

    // Setup dialog handler for auto-accepting prompts (consultation fee max)
    this.mhcAsia.setupDialogHandler();

    // Navigate to Normal Visit search (not AIA Program search)
    await this.mhcAsia.navigateToNormalVisit();

    // Search patient by NRIC
    const searchResult = await this.mhcAsia.searchPatientByNRIC(nric);
    if (!searchResult || !searchResult.found) {
      throw new Error(`Patient not found in MHC Asia: ${nric}`);
    }

    // Open patient from search results
    await this.mhcAsia.openPatientFromSearchResults(nric);

    // Add visit (pass NRIC for AIA Clinic flow after system switch)
    const portal = searchResult.portal || 'aiaclient';
    await this.mhcAsia.addVisit(portal, nric);
    await this.mhcAsia.page.waitForTimeout(500);

    // Fill visit date
    const visitDateFormatted = this._formatDateForMHC(visit.visit_date);
    if (visitDateFormatted) {
      await this.mhcAsia.fillVisitDate(visitDateFormatted);
    }

    // Set charge type (First Consult vs Follow Up)
    if (chargeType === 'first') {
      await this.mhcAsia.setChargeTypeNewVisit();
    } else {
      await this.mhcAsia.setChargeTypeFollowUp();
    }
    await this.mhcAsia.page.waitForTimeout(200);

    // Set consultation fee (99999 triggers max amount dialog which auto-accepts)
    await this.mhcAsia.fillConsultationFee(99999);
    await this.mhcAsia.page.waitForTimeout(500);

    // Fill MC if applicable
    if (mcDays > 0) {
      await this.mhcAsia.fillMcDays(mcDays);
      if (mcStartDate) {
        await this.mhcAsia.fillMcStartDate(mcStartDate);
      }
    }

    // Fill diagnosis if available
    if (diagnosisDesc && diagnosisDesc !== 'Missing diagnosis') {
      await this.mhcAsia.selectDiagnosis(diagnosisDesc);
    }

    // Save as draft (safety - don't auto-submit)
    const saveDraft = process.env.WORKFLOW_SAVE_DRAFT !== '0';
    if (saveDraft) {
      await this.mhcAsia.saveAsDraft();
    }

    return { 
      success: true, 
      portal: 'MHC Asia', 
      savedAsDraft: saveDraft,
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

