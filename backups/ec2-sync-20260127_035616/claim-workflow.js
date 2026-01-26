import { logger } from '../utils/logger.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { MHCAsiaAutomation } from '../automations/mhc-asia.js';
import { StepLogger } from '../utils/step-logger.js';
import { CRMSaver } from '../utils/crm-saver.js';

/**
 * Complete claim workflow orchestrator
 * Handles the full flow from Clinic Assist to MHC Asia
 */
export class ClaimWorkflow {
  constructor(clinicAssistPage, mhcAsiaPage) {
    this.clinicAssist = new ClinicAssistAutomation(clinicAssistPage);
    this.mhcAsia = new MHCAsiaAutomation(mhcAsiaPage);
    this.steps = new StepLogger({ total: 22, prefix: 'WF' });
    this.crmSaver = new CRMSaver();
  }

  /**
   * Execute complete claim workflow
   * @param {Object} workflowParams - Workflow parameters
   * @param {string} workflowParams.branchName - Branch name in Clinic Assist
   * @param {string} workflowParams.deptName - Department name in Clinic Assist
   * @param {string} workflowParams.patientIdentifier - Patient name or identifier
   * @param {string} workflowParams.cardNumber - Insurance card number (optional)
   * @param {string} workflowParams.verificationCode - 2FA code if needed (optional)
   * @param {number} workflowParams.consultationMax - Maximum consultation amount (optional)
   * @returns {Object} Workflow result
   */
  async executeWorkflow(workflowParams) {
    const {
      branchName,
      deptName,
      patientIdentifier,
      cardNumber = null,
      verificationCode = null,
      consultationMax = null,
      saveDraft = null,
    } = workflowParams;

    try {
      logger.info('=== Starting Claim Workflow ===');
      logger.info(`Patient: ${patientIdentifier}, Branch: ${branchName}, Dept: ${deptName}`);

      // Step 1: Login to Clinic Assist
      this.steps.step(1, 'Login to Clinic Assist');
      await this.clinicAssist.login();
      
      // Step 2: Navigate to Queue (Branch > Dept > Queue)
      this.steps.step(2, 'Clinic Assist: navigate to Queue', { branchName, deptName });
      await this.clinicAssist.navigateToQueue(branchName, deptName);
      
      // Step 3: Extract patient NRIC from queue
      this.steps.step(3, 'Clinic Assist: extract patient from Queue', { patientIdentifier });
      const patientInfo = await this.clinicAssist.extractPatientFromQueue(patientIdentifier);
      if (!patientInfo.nric) {
        throw new Error('Could not extract patient NRIC');
      }
      this.steps.step(3, 'Clinic Assist: patient extracted', {
        nric: patientInfo.nric,
        patientName: patientInfo.patientName,
        visitType: patientInfo.visitType,
      });

      // Use extracted patient name for downstream selection if we auto-picked
      const effectivePatientName =
        patientIdentifier === '__AUTO_MHC_AIA__'
          ? patientInfo.patientName || patientIdentifier
          : patientIdentifier;
      
      // Step 4: Open the visit record and extract the 5 key claim fields we need for TPA submission
      this.steps.step(4, 'Clinic Assist: open visit + extract claim details');
      await this.clinicAssist.openQueuedPatientForExtraction(patientIdentifier || '__AUTO_MHC_AIA__');
      const clinicClaimDetails = await this.clinicAssist.extractClaimDetailsFromCurrentVisit();
      this.steps.step(4, 'Clinic Assist: extracted claim details', {
        mcDays: clinicClaimDetails.mcDays,
        diagnosisSample: (clinicClaimDetails.diagnosisText || '').slice(0, 80),
        itemsCount: (clinicClaimDetails.items || []).length,
      });

      // Step 5: Extract charge type and special remarks (legacy; will be replaced as we refine CA selectors)
      this.steps.step(5, 'Clinic Assist: extract charge type + remarks (legacy)');
      const chargeAndRemarks = await this.clinicAssist.extractChargeTypeAndRemarks(patientIdentifier);
      
      // Step 6: Extract medicine names (legacy; will be replaced by clinicClaimDetails.items as we refine)
      this.steps.step(6, 'Clinic Assist: extract medicines (legacy)');
      const medicineNames = await this.clinicAssist.extractMedicineNames();
      
      // Step 6b: Save extracted data to CRM (marked as from Clinic Assist)
      this.steps.step(7, 'CRM: save extracted claim data from Clinic Assist');
      const crmSaveResult = await this.crmSaver.saveClaimExtraction({
        patientNric: patientInfo.nric,
        patientName: patientInfo.patientName || effectivePatientName,
        claimDetails: {
          ...clinicClaimDetails,
          visitType: patientInfo.visitType,
        },
        sourcePortal: 'Clinic Assist',
        targetPortal: 'MHC Asia',
        extractionMetadata: {
          sources: clinicClaimDetails.sources || {},
          extractedAt: new Date().toISOString(),
          branchName,
          deptName,
          patientIdentifier,
        },
      });
      if (crmSaveResult.success) {
        logger.info('[CRM] Saved extraction to: ' + crmSaveResult.filepath);
        await this.crmSaver.saveExtractionSummary({
          patientNric: patientInfo.nric,
          patientName: patientInfo.patientName || effectivePatientName,
          claimDetails: clinicClaimDetails,
        });
      } else {
        logger.warn('[CRM] Failed to save extraction, continuing workflow', crmSaveResult.error);
      }
      
      // Step 7: Login to MHC Asia
      this.steps.step(8, 'Login to MHC Asia');
      await this.mhcAsia.login();
      
      // Step 8: Handle 2FA if required
      this.steps.step(9, 'MHC: handle 2FA (if required)');
      await this.mhcAsia.handle2FA(verificationCode);
      
      // Step 9: Navigate to Normal Visit > Search Other Programs
      // Prefer the AIA program search path you described; fall back to generic search if not found
      this.steps.step(10, 'MHC: navigate to Normal Visit > AIA Program search');
      await this.mhcAsia.navigateToAIAProgramSearch();
      
      // Step 10: Search patient by NRIC and determine portal
      this.steps.step(11, 'MHC: search patient by NRIC', { nric: patientInfo.nric });
      const searchResult = await this.mhcAsia.searchPatientByNRIC(patientInfo.nric);
      if (!searchResult.found || !searchResult.portal) {
        throw new Error(`Patient not found or portal not determined for NRIC: ${patientInfo.nric}`);
      }
      this.steps.step(11, 'MHC: search result', searchResult);

      // Step 10b: Click into the patient in results if required by portal flow
      this.steps.step(12, 'MHC: open patient from search results');
      const opened = await this.mhcAsia.openPatientFromSearchResults(patientInfo.nric).catch(() => false);
      if (!opened) {
        throw new Error(`Could not open patient from search results for NRIC: ${patientInfo.nric}`);
      }
      
      // Step 11: Add visit for the portal
      this.steps.step(13, 'MHC: add visit', { portal: searchResult.portal });
      await this.mhcAsia.addVisit(searchResult.portal);
      
      // Step 12: Select card and patient
      this.steps.step(14, 'MHC: select card + patient', { cardNumber: cardNumber || null, patient: effectivePatientName });
      if (cardNumber) {
        await this.mhcAsia.selectCardAndPatient(cardNumber, effectivePatientName);
      } else {
        // Try to select patient without card
        await this.mhcAsia.selectCardAndPatient('', effectivePatientName);
      }
      
      // Step 13: Fill visit type (New / Follow Up) -> maps into MHC "Charge Type" for now
      this.steps.step(15, 'MHC: set visit type / charge type', { visitType: patientInfo.visitType });
      await this.mhcAsia.fillVisitTypeFromClinicAssist(patientInfo.visitType);

      // Step 14: MC days (always 0 per user requirement)
      this.steps.step(16, 'MHC: set MC days', { mcDays: 0 });
      await this.mhcAsia.fillMcDays(0);

      // Step 15: Diagnosis (best-effort selection from diagnosis text / doctor notes)
      this.steps.step(17, 'MHC: set diagnosis (best-effort)', {
        diagnosisSample: (clinicClaimDetails.diagnosisText || '').slice(0, 80),
      });
      await this.mhcAsia.fillDiagnosisFromText(clinicClaimDetails.diagnosisText);

      // Step 16: Claim amount - maximize consultation fee if provided; else set to a safe high default
      this.steps.step(18, 'MHC: set consultation fee max', {
        amount: consultationMax || Number(process.env.MHC_CONSULTATION_FEE_MAX || '9999'),
      });
      await this.mhcAsia.setConsultationFeeMax(
        consultationMax || Number(process.env.MHC_CONSULTATION_FEE_MAX || '9999')
      );

      // Step 17: Services / drugs
      this.steps.step(19, 'MHC: fill services/drugs');
      const mergedItems = [
        ...(clinicClaimDetails.items || []),
        ...(medicineNames || []),
      ].filter(Boolean);
      if (mergedItems.length > 0) {
        await this.mhcAsia.fillServicesAndDrugs(mergedItems);
      }

      // Step 18: Optional: legacy charge type and remarks (kept for now)
      this.steps.step(20, 'MHC: legacy charge type (if present)');
      if (chargeAndRemarks.chargeType) {
        await this.mhcAsia.fillChargeType(chargeAndRemarks.chargeType);
      }
      
      // Step 19: Process special remarks (AI context understanding)
      this.steps.step(21, 'MHC: process remarks + waiver (legacy)');
      const processedRemarks = await this.mhcAsia.processSpecialRemarks(chargeAndRemarks.specialRemarks);
      
      // Step 20: Fill diagnosis category and check waiver
      await this.mhcAsia.fillDiagnosisAndWaiver(processedRemarks);
      
      // Step 21: Save as draft (optional; default off so we just stop after filling for review)
      this.steps.step(22, 'MHC: save as draft (optional)', { enabled: !!(saveDraft || process.env.WORKFLOW_SAVE_DRAFT) });
      const shouldSaveDraft =
        saveDraft === true ||
        saveDraft === 'true' ||
        saveDraft === '1' ||
        process.env.WORKFLOW_SAVE_DRAFT === 'true' ||
        process.env.WORKFLOW_SAVE_DRAFT === '1';

      const saved = shouldSaveDraft ? await this.mhcAsia.saveAsDraft() : false;
      
      if (!saved) {
        if (shouldSaveDraft) logger.warn('Could not save as draft, but workflow completed');
        else logger.info('Draft save skipped - form filled and ready for review');
      }
      
      // Take final screenshot of filled form
      await this.mhcAsiaPage.screenshot({ 
        path: 'screenshots/mhc-form-filled-final.png', 
        fullPage: true 
      }).catch(() => {});
      logger.info('Final form screenshot saved: screenshots/mhc-form-filled-final.png');
      
      const result = {
        success: true,
        patientInfo,
        clinicClaimDetails,
        chargeAndRemarks,
        processedRemarks,
        medicineNames,
        portal: searchResult.portal,
        savedAsDraft: saved,
        crmSaveResult: crmSaveResult.success ? { filepath: crmSaveResult.filepath } : null,
      };
      
      logger.info('=== Claim Workflow Completed Successfully ===');
      return result;
      
    } catch (error) {
      logger.error('Claim workflow failed:', error);
      throw error;
    }
  }
}

