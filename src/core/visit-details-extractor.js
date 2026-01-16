import { logger } from '../utils/logger.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';

/**
 * Visit Details Extractor
 * Extracts diagnosis and services/drugs from Clinic Assist visit records
 */
export class VisitDetailsExtractor {
  constructor(page, supabase) {
    this.clinicAssist = new ClinicAssistAutomation(page);
    this.supabase = supabase;
    this.branchName = '__FIRST__'; // Auto-selects "ssoc pte ltd"
    this.deptName = 'Reception';
  }

  /**
   * Extract diagnosis and services/drugs for a single visit
   * Uses TX History → Diagnosis Tab approach
   * @param {Object} visit - Visit record from database
   * @returns {Object} Extraction result
   */
  async extractForVisit(visit) {
    try {
      // 1. Mark visit as 'in_progress'
      await this._updateExtractionStatus(visit.id, 'in_progress', null);

      // 2. Navigate to Patient Page
      logger.info(`[VisitDetails] Navigating to Patient Page for visit ${visit.id} (${visit.patient_name})`);
      const patientPageOpened = await this.clinicAssist.navigateToPatientPage();
      if (!patientPageOpened) {
        throw new Error('Failed to navigate to Patient Page');
      }

      // 3. Search for patient by name
      logger.info(`[VisitDetails] Searching for patient: ${visit.patient_name}`);
      await this.clinicAssist.searchPatientByName(visit.patient_name);

      // 4. Open patient from search results (opens biodata/info page)
      logger.info(`[VisitDetails] Opening patient record for: ${visit.patient_name}`);
      await this.clinicAssist.openPatientFromSearchResults(visit.patient_name);
      
      // Wait for biodata page to load
      await this.clinicAssist.page.waitForTimeout(2000);
      
      // 4b. Extract NRIC from biodata page (before navigating to TX History)
      // This is the best place to get NRIC as it's displayed on the patient biodata/info page
      logger.info(`[VisitDetails] Extracting NRIC from biodata page for: ${visit.patient_name}`);
      const extractedNric = await this.clinicAssist.extractPatientNricFromPatientInfo();
      if (extractedNric) {
        logger.info(`[VisitDetails] Found NRIC: ${extractedNric} for patient: ${visit.patient_name}`);
        // Update visit with NRIC immediately
        await this._updateVisitWithNRIC(visit.id, extractedNric);
      } else {
        logger.warn(`[VisitDetails] NRIC not found on biodata page for patient: ${visit.patient_name}`);
      }

      // 5. Navigate to TX History
      logger.info(`[VisitDetails] Navigating to TX History for visit ${visit.id}`);
      await this.clinicAssist.navigateToTXHistory();

      // 6. Open Diagnosis Tab
      logger.info(`[VisitDetails] Opening Diagnosis Tab for visit ${visit.id}`);
      await this.clinicAssist.openDiagnosisTab();

      // 7. Extract diagnosis code and description from TX History Diagnosis Tab
      logger.info(`[VisitDetails] Extracting diagnosis for visit ${visit.id}`);
      const diagnosisResult = await this.clinicAssist.extractDiagnosisFromTXHistory();

      // 8. Handle missing diagnosis - mark as "Missing diagnosis" if empty
      let finalDiagnosis = 'Missing diagnosis';
      let diagnosisCode = null;
      
      if (diagnosisResult) {
        // diagnosisResult is now an object: { code: string|null, description: string|null }
        if (diagnosisResult.description && diagnosisResult.description.trim()) {
          finalDiagnosis = diagnosisResult.description.trim();
        }
        if (diagnosisResult.code && diagnosisResult.code.trim()) {
          diagnosisCode = diagnosisResult.code.trim();
        }
      }

      // 9. Update database with extracted data and mark as 'completed'
      // Note: Treatment detail (services/drugs) extraction from TX History not yet implemented
      // For now, we only extract diagnosis
      const treatmentDetail = null; // TODO: Extract services/drugs from TX History if needed

      await this._updateVisitWithDetails(visit.id, finalDiagnosis, diagnosisCode, treatmentDetail, {
        source: 'tx_history_diagnosis_tab',
        extractionMethod: 'tx_history'
      });

      logger.info(`[VisitDetails] Successfully extracted details for visit ${visit.id}`, {
        diagnosis: finalDiagnosis.substring(0, 100)
      });

      return {
        success: true,
        visitId: visit.id,
        diagnosis: finalDiagnosis,
        diagnosisCode: diagnosisCode,
        treatmentDetail: treatmentDetail,
        sources: {
          source: 'tx_history_diagnosis_tab',
          extractionMethod: 'tx_history'
        },
      };
    } catch (error) {
      logger.error(`[VisitDetails] Failed to extract details for visit ${visit.id}`, { 
        error: error.message,
        patientName: visit.patient_name 
      });

      // Mark as failed with error
      await this._updateExtractionStatus(visit.id, 'failed', error.message);

      return {
        success: false,
        visitId: visit.id,
        error: error.message,
      };
    }
  }

  /**
   * Extract details for multiple visits in batch
   * @param {Array} visits - Array of visit records
   * @param {Object} options - Options
   * @param {number} options.maxRetries - Maximum retry attempts for failed visits
   * @returns {Object} Batch extraction results
   */
  async extractBatch(visits, options = {}) {
    const maxRetries = options.maxRetries || 3;
    const results = {
      total: visits.length,
      completed: 0,
      failed: 0,
      skipped: 0,
      details: [],
    };

    logger.info(`[VisitDetails] Starting batch extraction for ${visits.length} visits`);

    for (let i = 0; i < visits.length; i++) {
      const visit = visits[i];
      
      // Check if visit should be skipped (already completed or exceeded retries)
      const metadata = visit.extraction_metadata || {};
      const status = metadata.detailsExtractionStatus;
      const attempts = metadata.detailsExtractionAttempts || 0;

      if (status === 'completed') {
        logger.info(`[VisitDetails] Skipping visit ${visit.id} - already completed`);
        results.skipped++;
        continue;
      }

      if (status === 'failed' && attempts >= maxRetries) {
        logger.info(`[VisitDetails] Skipping visit ${visit.id} - exceeded max retries (${attempts}/${maxRetries})`);
        results.skipped++;
        continue;
      }

      // Extract details for this visit
      logger.info(`[VisitDetails] Processing visit ${i + 1}/${visits.length}: ${visit.patient_name} (${visit.visit_date})`);
      const result = await this.extractForVisit(visit);

      results.details.push(result);

      if (result.success) {
        results.completed++;
      } else {
        results.failed++;
      }

      // Small delay between visits to avoid overwhelming the system
      await this.clinicAssist.page.waitForTimeout(1000);
    }

    logger.info(`[VisitDetails] Batch extraction complete: ${results.completed} completed, ${results.failed} failed, ${results.skipped} skipped`);

    return results;
  }

  /**
   * Update extraction status in database
   * @private
   */
  async _updateExtractionStatus(visitId, status, errorMessage) {
    if (!this.supabase) {
      logger.warn('[VisitDetails] Supabase not available, skipping status update');
      return;
    }

    try {
      // Read current metadata
      const { data: currentVisit, error: fetchError } = await this.supabase
        .from('visits')
        .select('extraction_metadata')
        .eq('id', visitId)
        .single();

      if (fetchError) {
        logger.error(`[VisitDetails] Failed to fetch current visit metadata: ${fetchError.message}`);
        return;
      }

      const currentMetadata = currentVisit?.extraction_metadata || {};
      const currentAttempts = currentMetadata.detailsExtractionAttempts || 0;

      const updateData = {
        extraction_metadata: {
          ...currentMetadata,
          detailsExtractionStatus: status,
          detailsExtractionLastAttempt: new Date().toISOString(),
        },
      };

      if (status === 'failed') {
        updateData.extraction_metadata.detailsExtractionError = errorMessage || 'Unknown error';
        updateData.extraction_metadata.detailsExtractionAttempts = currentAttempts + 1;
      }

      const { error: updateError } = await this.supabase
        .from('visits')
        .update(updateData)
        .eq('id', visitId);

      if (updateError) {
        logger.error(`[VisitDetails] Failed to update extraction status: ${updateError.message}`);
      }
    } catch (error) {
      logger.error(`[VisitDetails] Error updating extraction status: ${error.message}`);
    }
  }

  /**
   * Update visit with extracted NRIC
   * @private
   */
  async _updateVisitWithNRIC(visitId, nric) {
    if (!this.supabase) {
      logger.warn('[VisitDetails] Supabase not available, skipping NRIC update');
      return;
    }

    try {
      const { error: updateError } = await this.supabase
        .from('visits')
        .update({ nric: nric })
        .eq('id', visitId);

      if (updateError) {
        logger.error(`[VisitDetails] Failed to update visit NRIC: ${updateError.message}`);
      } else {
        logger.info(`[VisitDetails] Updated visit ${visitId} with NRIC: ${nric}`);
      }
    } catch (error) {
      logger.error(`[VisitDetails] Error updating visit NRIC: ${error.message}`);
    }
  }

  /**
   * Update visit with extracted diagnosis and treatment details
   * @private
   */
  async _updateVisitWithDetails(visitId, diagnosisText, diagnosisCode, treatmentDetail, sources) {
    if (!this.supabase) {
      logger.warn('[VisitDetails] Supabase not available, skipping visit update');
      return;
    }

    try {
      // Read current metadata
      const { data: currentVisit, error: fetchError } = await this.supabase
        .from('visits')
        .select('extraction_metadata')
        .eq('id', visitId)
        .single();

      if (fetchError) {
        logger.error(`[VisitDetails] Failed to fetch current visit metadata: ${fetchError.message}`);
        return;
      }

      const currentMetadata = currentVisit?.extraction_metadata || {};

      // Store diagnosis code in extraction_metadata since there's no separate diagnosis_code field
      const updateData = {
        diagnosis_description: diagnosisText,
        treatment_detail: treatmentDetail,
        extraction_metadata: {
          ...currentMetadata,
          detailsExtractionStatus: 'completed',
          detailsExtractedAt: new Date().toISOString(),
          detailsExtractionSources: sources,
          diagnosisCode: diagnosisCode, // Store code in metadata
        },
      };

      const { error: updateError } = await this.supabase
        .from('visits')
        .update(updateData)
        .eq('id', visitId);

      if (updateError) {
        logger.error(`[VisitDetails] Failed to update visit details: ${updateError.message}`);
        throw updateError;
      }

      logger.info(`[VisitDetails] Updated visit ${visitId} with extracted details`);
    } catch (error) {
      logger.error(`[VisitDetails] Error updating visit details: ${error.message}`);
      throw error;
    }
  }
}
