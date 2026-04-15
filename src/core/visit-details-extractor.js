import { logger } from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import { registerRunExitHandler, markRunFinalized } from '../utils/run-exit-handler.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { normalizePatientNameForSearch } from '../utils/patient-normalize.js';

const NON_PORTABLE_DIAGNOSIS_RE =
  /(?:\blab(?:oratory)?\b|\btest\b|\bscreen(?:ing)?\b|\bpanel\b|\bconsult(?:ation)?\b|\bprocedure\b|\btherapy\b)/i;
const GENERIC_DIAGNOSIS_RE =
  /(?:\billness\b|\bunspecified\b|\bunsp\b|\bother\b|\bregion\b|\bjoint\b|\bsite\b|\bpart\b|\bsymptom\b|\bproblem\b)/i;
const BODY_PART_DIAGNOSIS_RE =
  /\b(shoulder|knee|ankle|wrist|elbow|hip|back|neck|foot|heel|hand|finger|toe|leg|arm|thigh|calf|forearm|spine|lumbar|loin|cervical|thoracic|rib|chest|abdomen|stomach|head|eye|ear|nose|throat|acl|mcl|lcl|pcl|meniscus|patella|ligament)\b/i;
const CONDITION_DIAGNOSIS_RE =
  /\b(pain|ache|sprain|strain|fracture|dislocation|tear|rupture|injury|trauma|infection|inflammation|arthritis|laceration|wound|swelling|instability|laxity|bursitis|tendinitis|tendinopathy|contusion|capsulitis|impingement)\b/i;

function looksReusableResolvedDiagnosis(description, diagnosisCanonical = null) {
  const text = String(description || '').trim();
  if (!text || /^missing diagnosis$/i.test(text)) return false;
  if (NON_PORTABLE_DIAGNOSIS_RE.test(text)) return false;

  const code = String(diagnosisCanonical?.code_normalized || diagnosisCanonical?.code_raw || '')
    .trim()
    .toUpperCase();
  if (!code || code === 'R69' || code === 'NA') return false;

  const hasCanonicalSpecificity = Boolean(
    diagnosisCanonical?.body_part && diagnosisCanonical?.condition
  );
  const hasTextSpecificity = BODY_PART_DIAGNOSIS_RE.test(text) && CONDITION_DIAGNOSIS_RE.test(text);
  const hasLaterality = /\b(left|right|lt|rt|bilateral)\b/i.test(text);
  const looksGeneric = GENERIC_DIAGNOSIS_RE.test(text);

  if (looksGeneric && !hasLaterality && !hasCanonicalSpecificity) return false;
  return hasCanonicalSpecificity || hasTextSpecificity;
}

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

  async _writeDiagnosisEvidenceArtifacts(visit, payload = {}) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeId = String(visit?.id || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
    const baseDir = path.resolve(process.cwd(), 'output', 'playwright');
    const screenshotPath = path.join(baseDir, `flow2-evidence-${safeId}-${stamp}.png`);
    const jsonPath = path.join(baseDir, `flow2-evidence-${safeId}-${stamp}.json`);

    await fs.mkdir(baseDir, { recursive: true });
    const artifacts = {
      screenshot: null,
      json: jsonPath,
    };

    try {
      await this.clinicAssist.page.screenshot({ path: screenshotPath, fullPage: true });
      artifacts.screenshot = screenshotPath;
    } catch (error) {
      logger.warn('[VisitDetails] Failed to capture evidence screenshot', {
        visitId: visit?.id || null,
        error: error?.message || String(error),
      });
    }

    await fs.writeFile(
      jsonPath,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          visit: {
            id: visit?.id || null,
            patient_name: visit?.patient_name || null,
            visit_date: visit?.visit_date || null,
            pay_type: visit?.pay_type || null,
            nric: visit?.nric || null,
          },
          evidence: payload,
          artifacts,
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    return artifacts;
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

      // 2. Get PCNO (patient number) from extraction_metadata or use name as fallback
      const pcno = visit.extraction_metadata?.pcno || null;
      const usePatientNumber = pcno && /^\d{4,5}$/.test(String(pcno).trim()); // 4-5 digit number
      const cleanName = normalizePatientNameForSearch(visit.patient_name);
      const queueFallbackIdentifier =
        (usePatientNumber ? String(pcno).trim() : null) ||
        cleanName ||
        visit.patient_name ||
        '__AUTO_MHC_AIA__';
      let patientContextOpened = false;
      let openContextError = null;

      // 3. Primary path: Patient Search page
      logger.info(
        `[VisitDetails] Navigating to Patient Page for visit ${visit.id} (${visit.patient_name})`
      );
      const patientPageOpened = await this.clinicAssist.navigateToPatientPage();
      if (!patientPageOpened) {
        openContextError = new Error('Failed to navigate to Patient Page');
      } else {
        try {
          if (usePatientNumber) {
            logger.info(
              `[VisitDetails] Searching for patient by number: ${pcno} (${visit.patient_name})`
            );
            await this.clinicAssist.searchPatientByNumber(String(pcno).trim());
            await this.clinicAssist.page.waitForTimeout(2000);
            logger.info(`[VisitDetails] Opening patient record by number: ${pcno}`);
            await this.clinicAssist.openPatientFromSearchResultsByNumber(String(pcno).trim());
          } else {
            logger.info(
              `[VisitDetails] PCNO not available, searching for patient by name: ${cleanName || visit.patient_name}`
            );
            await this.clinicAssist.searchPatientByName(cleanName || visit.patient_name);
            await this.clinicAssist.page.waitForTimeout(2000);
            logger.info(
              `[VisitDetails] Opening patient record for: ${cleanName || visit.patient_name}`
            );
            await this.clinicAssist.openPatientFromSearchResults(cleanName || visit.patient_name);
          }
          patientContextOpened = true;
        } catch (error) {
          openContextError = error;
          if (usePatientNumber) {
            logger.warn('[VisitDetails] PCNO search/open failed, trying patient name search', {
              visitId: visit.id,
              patientName: visit.patient_name,
              pcno: String(pcno).trim(),
              error: error?.message || String(error),
            });
            try {
              await this.clinicAssist.navigateToPatientPage();
              await this.clinicAssist.searchPatientByName(cleanName || visit.patient_name);
              await this.clinicAssist.page.waitForTimeout(2000);
              await this.clinicAssist.openPatientFromSearchResults(cleanName || visit.patient_name);
              patientContextOpened = true;
            } catch (nameError) {
              openContextError = nameError;
            }
          }
        }
      }

      // 4. Fallback path: open directly from Queue row by PCNO/name.
      // This recovers cases where PatientSearch does not return rows even though visit/patient exists.
      if (!patientContextOpened) {
        logger.warn('[VisitDetails] Patient search open failed, falling back to Queue open', {
          visitId: visit.id,
          patientName: visit.patient_name,
          pcno: usePatientNumber ? String(pcno).trim() : null,
          error: openContextError?.message || null,
        });
        const queueOpened = await this.clinicAssist
          .navigateToQueue(this.branchName, this.deptName)
          .catch(() => false);
        if (!queueOpened) {
          throw new Error(
            `Failed to open patient context: Patient Search and Queue fallback failed (${openContextError?.message || 'unknown'})`
          );
        }
        await this.clinicAssist.openQueuedPatientForExtraction(queueFallbackIdentifier);
        patientContextOpened = true;
      }

      // Wait for biodata page to load
      await this.clinicAssist.page.waitForTimeout(2000);

      // 4b. Extract NRIC from biodata page (before navigating to TX History)
      // This is the best place to get NRIC as it's displayed on the patient biodata/info page
      logger.info(`[VisitDetails] Extracting NRIC from biodata page for: ${visit.patient_name}`);
      const extractedNric = await this.clinicAssist.getPatientNRIC();
      const nricExtractionStatus = extractedNric ? 'found' : 'missing';
      if (extractedNric) {
        logger.info(
          `[VisitDetails] Found NRIC: ${extractedNric} for patient: ${visit.patient_name}`
        );
        // Update visit with NRIC immediately
        await this._updateVisitWithNRIC(visit.id, extractedNric);
      } else {
        logger.warn(
          `[VisitDetails] NRIC not found on biodata page for patient: ${visit.patient_name}`
        );
      }

      // 5. Get charge type, diagnosis, and MC data for the visit date
      // This single call extracts all the data needed for form filling:
      // - chargeType: 'first' or 'follow' (First Consult vs Follow Up)
      // - diagnosis: { code, description }
      // - mcDays: number of MC days
      // - mcStartDate: MC start date in DD/MM/YYYY format
      logger.info(
        `[VisitDetails] Extracting charge type, diagnosis, and MC data for visit ${visit.id} on ${visit.visit_date}`
      );
      const txData = await this.clinicAssist.getChargeTypeAndDiagnosis(visit.visit_date, {
        payType: visit.pay_type || null,
      });

      const chargeType = txData.chargeType || 'follow';
      const mcDays = txData.mcDays || 0;
      const mcStartDate = txData.mcStartDate || null;

      // Extract diagnosis from txData.
      // If Flow 2 does not find a diagnosis, we preserve any meaningful Flow 1 diagnosis in _updateVisitWithDetails.
      let finalDiagnosis = null;
      let diagnosisCode = null;

      if (txData.diagnosis) {
        if (txData.diagnosis.description && txData.diagnosis.description.trim()) {
          finalDiagnosis = txData.diagnosis.description.trim();
        }
        if (txData.diagnosis.code && txData.diagnosis.code.trim()) {
          diagnosisCode = txData.diagnosis.code.trim();
        }
      }

      logger.info(`[VisitDetails] Extracted data for visit ${visit.id}:`, {
        chargeType,
        diagnosis: (finalDiagnosis || 'Missing diagnosis').substring(0, 50),
        mcDays,
        mcStartDate,
      });

      const diagnosisEvidenceArtifacts = await this._writeDiagnosisEvidenceArtifacts(visit, {
        rawSourceFindings: Array.isArray(txData.diagnosisAttempts) ? txData.diagnosisAttempts : [],
        canonicalDiagnosis: txData.diagnosisCanonical || null,
        diagnosisResolution: txData.diagnosisResolution || null,
        diagnosisCandidates: txData.diagnosisCandidates || [],
        diagnosisSource: txData.diagnosisSource || null,
        diagnosisMissingReason: txData.diagnosisMissingReason || null,
      }).catch(error => {
        logger.warn('[VisitDetails] Failed to persist diagnosis evidence artifacts', {
          visitId: visit.id,
          error: error?.message || String(error),
        });
        return { screenshot: null, json: null };
      });

      // 6. Update database with all extracted data and mark as 'completed'
      // Store medicines/services extracted from TX History Medicine tab (Flow 2).
      // Keep it both as a newline string (treatment_detail) and a structured array in extraction_metadata.
      const medicines = (txData.medicines || [])
        .map(m => {
          if (!m) return null;
          if (typeof m === 'string') return { name: m, quantity: null };
          const name = (m.name || m.description || '').toString().trim();
          if (!name) return null;
          const quantity = m.quantity ?? null;
          const unit = m.unit ?? null;
          const unitPrice = m.unitPrice ?? m.unit_price ?? null;
          const amount = m.amount ?? m.total ?? null;
          return { name, quantity, unit, unitPrice, amount };
        })
        .filter(Boolean);
      const treatmentDetail = medicines.length
        ? medicines.map(m => (m.quantity ? `${m.name} x${m.quantity}` : m.name)).join('\n')
        : null;

      await this._updateVisitWithDetails(visit.id, finalDiagnosis, diagnosisCode, treatmentDetail, {
        source: 'tx_history_combined',
        extractionMethod: 'getChargeTypeAndDiagnosis',
        chargeType,
        mcDays,
        mcStartDate,
        medicines,
        diagnosisSource: txData.diagnosisSource || null,
        diagnosisMissingReason: txData.diagnosisMissingReason || null,
        diagnosisAttempts: txData.diagnosisAttempts || [],
        diagnosisCanonical: txData.diagnosisCanonical || null,
        diagnosisResolution: txData.diagnosisResolution || null,
        diagnosisCandidates: txData.diagnosisCandidates || [],
        diagnosisEvidence: {
          rawSourceFindings: txData.diagnosisAttempts || [],
          canonicalDiagnosis: txData.diagnosisCanonical || null,
          diagnosisResolution: txData.diagnosisResolution || null,
          diagnosisCandidates: txData.diagnosisCandidates || [],
          sourceTab: txData.diagnosisSource || null,
          sourceDate: txData.diagnosisCanonical?.source_date || null,
          confidence: txData.diagnosisResolution?.confidence ?? null,
          rejectionReason: txData.diagnosisResolution?.reason_if_unresolved || null,
          artifactPaths: diagnosisEvidenceArtifacts,
        },
        medicineFilterStats: txData.medicineFilterStats || null,
        nricExtractionStatus,
        existingSymptoms: visit.symptoms || null,
        existingTreatmentDetail: visit.treatment_detail || null,
      });

      logger.info(`[VisitDetails] Successfully extracted details for visit ${visit.id}`, {
        diagnosis: (finalDiagnosis || 'Missing diagnosis').substring(0, 100),
        chargeType,
        mcDays,
      });

      return {
        success: true,
        visitId: visit.id,
        diagnosis: finalDiagnosis || 'Missing diagnosis',
        diagnosisCode: diagnosisCode,
        chargeType: chargeType,
        mcDays: mcDays,
        mcStartDate: mcStartDate,
        treatmentDetail: treatmentDetail,
        diagnosisCanonical: txData.diagnosisCanonical || null,
        diagnosisResolution: txData.diagnosisResolution || null,
        sources: {
          source: 'tx_history_combined',
          extractionMethod: 'getChargeTypeAndDiagnosis',
        },
      };
    } catch (error) {
      logger.error(`[VisitDetails] Failed to extract details for visit ${visit.id}`, {
        error: error.message,
        patientName: visit.patient_name,
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
    const force = !!options.force;
    const results = {
      total: visits.length,
      completed: 0,
      failed: 0,
      skipped: 0,
      details: [],
    };

    const runMetadata = { maxRetries, trigger: 'automation' };
    const runId = await this._startRun('visit_details', runMetadata);
    await this._updateRun(runId, { total_records: visits.length });
    const updateRunBound = (id, updates) => this._updateRun(id, updates);
    registerRunExitHandler(this.supabase, runId, updateRunBound);

    try {
      logger.info(`[VisitDetails] Starting batch extraction for ${visits.length} visits`);

      for (let i = 0; i < visits.length; i++) {
        const visit = visits[i];

        // Check if visit should be skipped (already completed or exceeded retries)
        const metadata = visit.extraction_metadata || {};
        const status = metadata.detailsExtractionStatus;
        const attempts = metadata.detailsExtractionAttempts || 0;

        if (!force && status === 'completed') {
          logger.info(`[VisitDetails] Skipping visit ${visit.id} - already completed`);
          results.skipped++;
          continue;
        }

        if (!force && status === 'failed' && attempts >= maxRetries) {
          logger.info(
            `[VisitDetails] Skipping visit ${visit.id} - exceeded max retries (${attempts}/${maxRetries})`
          );
          results.skipped++;
          continue;
        }

        // Extract details for this visit
        logger.info(
          `[VisitDetails] Processing visit ${i + 1}/${visits.length}: ${visit.patient_name} (${visit.visit_date})`
        );
        const result = await this.extractForVisit(visit);

        results.details.push(result);

        if (result.success) {
          results.completed++;
        } else {
          results.failed++;
        }

        await this._updateRun(runId, {
          completed_count: results.completed,
          failed_count: results.failed,
        });

        // Small delay between visits to avoid overwhelming the system.
        // Guard against transient page replacement/closure between iterations.
        if (this.clinicAssist.page && !this.clinicAssist.page.isClosed()) {
          await this.clinicAssist.page.waitForTimeout(1000).catch(() => {});
        }
      }

      logger.info(
        `[VisitDetails] Batch extraction complete: ${results.completed} completed, ${results.failed} failed, ${results.skipped} skipped`
      );

      await this._updateRun(runId, {
        status: 'completed',
        finished_at: new Date().toISOString(),
        completed_count: results.completed,
        failed_count: results.failed,
        metadata: { ...runMetadata, skippedCount: results.skipped },
      });
      markRunFinalized();
      return results;
    } catch (error) {
      await this._updateRun(runId, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: error.message || String(error),
        metadata: { ...runMetadata, skippedCount: results.skipped },
      });
      markRunFinalized();
      throw error;
    }
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
        logger.error(
          `[VisitDetails] Failed to fetch current visit metadata: ${fetchError.message}`
        );
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
   * Update visit with extracted diagnosis, charge type, and MC data
   * @private
   * @param {string} visitId - Visit ID
   * @param {string} diagnosisText - Diagnosis description
   * @param {string} diagnosisCode - Diagnosis code (e.g., ICD code)
   * @param {string} treatmentDetail - Treatment/services detail
   * @param {Object} sources - Extraction metadata including chargeType, mcDays, mcStartDate
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
        .select('diagnosis_description, extraction_metadata')
        .eq('id', visitId)
        .single();

      if (fetchError) {
        logger.error(
          `[VisitDetails] Failed to fetch current visit metadata: ${fetchError.message}`
        );
        return;
      }

      const currentMetadata = currentVisit?.extraction_metadata || {};
      const existingDiagnosis = String(currentVisit?.diagnosis_description || '').trim();
      const hasExistingDiagnosis =
        existingDiagnosis.length > 0 && !/^missing diagnosis$/i.test(existingDiagnosis);
      const existingResolutionStatus = String(currentMetadata?.diagnosisResolution?.status || '')
        .trim()
        .toLowerCase();
      const existingDiagnosisLooksNonPortable = NON_PORTABLE_DIAGNOSIS_RE.test(existingDiagnosis);
      const existingDiagnosisLooksReusable = looksReusableResolvedDiagnosis(
        existingDiagnosis,
        currentMetadata?.diagnosisCanonical || null
      );
      const existingDiagnosisFallbackAllowed =
        hasExistingDiagnosis &&
        existingDiagnosisLooksReusable &&
        !existingDiagnosisLooksNonPortable &&
        (!existingResolutionStatus || existingResolutionStatus === 'resolved');
      const incomingDiagnosis = String(diagnosisText || '').trim();
      const hasIncomingDiagnosis =
        incomingDiagnosis.length > 0 && !/^missing diagnosis$/i.test(incomingDiagnosis);
      const incomingResolutionStatus = String(sources?.diagnosisResolution?.status || '')
        .trim()
        .toLowerCase();
      const incomingDiagnosisLooksNonPortable =
        /(?:\blab(?:oratory)?\b|\btest\b|\bscreen(?:ing)?\b|\bpanel\b|\bconsult(?:ation)?\b|\bprocedure\b|\btherapy\b)/i.test(
          incomingDiagnosis
        );
      const incomingDiagnosisUnresolved =
        !hasIncomingDiagnosis ||
        incomingResolutionStatus === 'missing' ||
        incomingResolutionStatus === 'missing_in_source' ||
        incomingResolutionStatus === 'found_but_invalid' ||
        incomingResolutionStatus === 'ambiguous' ||
        incomingResolutionStatus === 'unresolved' ||
        (incomingDiagnosisLooksNonPortable && incomingResolutionStatus !== 'resolved');
      const shouldUseIncomingDiagnosis = hasIncomingDiagnosis && !incomingDiagnosisUnresolved;
      const incomingCode = String(diagnosisCode || '').trim();
      const existingCode = String(currentMetadata?.diagnosisCode || '').trim();
      const usedExistingDiagnosisFallback =
        incomingDiagnosisUnresolved && existingDiagnosisFallbackAllowed;
      const genericFallback =
        incomingDiagnosisUnresolved && !usedExistingDiagnosisFallback
          ? this._resolveGenericDiagnosisFallback({
              diagnosisText,
              diagnosisCode,
              treatmentDetail,
              sources,
            })
          : null;
      const usedGenericDiagnosisFallback = !!genericFallback;

      let diagnosisToStore = shouldUseIncomingDiagnosis
        ? incomingDiagnosis
        : usedExistingDiagnosisFallback
          ? existingDiagnosis
          : 'Missing diagnosis';
      let diagnosisCodeToStore = shouldUseIncomingDiagnosis
        ? incomingCode || null
        : (usedExistingDiagnosisFallback ? existingCode : '') || null;
      if (usedGenericDiagnosisFallback) {
        diagnosisToStore = genericFallback.description;
        diagnosisCodeToStore = genericFallback.code;
      }

      // Extract charge type and MC data from sources (if provided by getChargeTypeAndDiagnosis)
      const chargeType = sources?.chargeType || null;
      const mcDays = sources?.mcDays || 0;
      const mcStartDate = sources?.mcStartDate || null;
      const medicines = Array.isArray(sources?.medicines) ? sources.medicines : null;
      let diagnosisCanonical = sources?.diagnosisCanonical || null;
      let diagnosisResolution = sources?.diagnosisResolution || null;
      const diagnosisCandidates = Array.isArray(sources?.diagnosisCandidates)
        ? sources.diagnosisCandidates
        : [];
      if (usedGenericDiagnosisFallback) {
        diagnosisCanonical = {
          ...(diagnosisCanonical || {}),
          side: null,
          code_raw: genericFallback.code,
          body_part: null,
          condition: null,
          source_date: null,
          code_normalized: genericFallback.code,
          description_raw: genericFallback.description,
          source_age_days: null,
          description_canonical: genericFallback.description,
          source_date_match_type: 'fallback',
        };
        diagnosisResolution = {
          ...(diagnosisResolution || {}),
          status: 'fallback_low_confidence',
          date_ok: true,
          confidence: 0,
          date_policy: 'fallback_generic',
          fallback_age_days: null,
          source_date_match_type: 'fallback',
          reason_if_unresolved: 'no_reliable_source_data',
          source_chain: Array.isArray(diagnosisResolution?.source_chain)
            ? diagnosisResolution.source_chain
            : [],
          fallback_code: genericFallback.code,
          fallback_description: genericFallback.description,
          fallback_reason: genericFallback.reason,
        };
      }

      const mergedDiagnosisEvidence =
        sources?.diagnosisEvidence && typeof sources.diagnosisEvidence === 'object'
          ? {
              ...(currentMetadata?.diagnosisEvidence &&
              typeof currentMetadata.diagnosisEvidence === 'object'
                ? currentMetadata.diagnosisEvidence
                : {}),
              ...sources.diagnosisEvidence,
              canonicalDiagnosis: diagnosisCanonical,
              diagnosisResolution,
              diagnosisCandidates,
              sourceDate:
                diagnosisCanonical?.source_date || sources?.diagnosisEvidence?.sourceDate || null,
              confidence: diagnosisResolution?.confidence ?? null,
              rejectionReason: diagnosisResolution?.reason_if_unresolved || null,
            }
          : currentMetadata?.diagnosisEvidence || null;

      // Store all extracted data in extraction_metadata for Flow 3 to use
      const updateData = {
        diagnosis_description: diagnosisToStore,
        treatment_detail: treatmentDetail,
        extraction_metadata: {
          ...currentMetadata,
          detailsExtractionStatus: 'completed',
          detailsExtractedAt: new Date().toISOString(),
          detailsExtractionSources: {
            ...sources,
            diagnosisIncomingStatus: incomingResolutionStatus || null,
            diagnosisIncomingUnresolved: incomingDiagnosisUnresolved,
            diagnosisFallbackFromExisting: usedExistingDiagnosisFallback,
            diagnosisGenericFallbackApplied: usedGenericDiagnosisFallback,
            diagnosisGenericFallback: genericFallback
              ? {
                  code: genericFallback.code,
                  description: genericFallback.description,
                  reason: genericFallback.reason,
                }
              : null,
          },
          diagnosisCode: diagnosisCodeToStore,
          diagnosisCanonical,
          diagnosisResolution,
          diagnosisCandidates,
          diagnosisEvidence: mergedDiagnosisEvidence,
          // These fields are used by Flow 3 (ClaimSubmitter) for form filling
          chargeType: chargeType, // 'first' or 'follow'
          mcDays: mcDays, // Number of MC days
          mcStartDate: mcStartDate, // MC start date in DD/MM/YYYY format
          medicines: medicines, // [{name, quantity, unit, unitPrice, amount}] from TX History Medicine tab (optional)
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

  _resolveGenericDiagnosisFallback({
    diagnosisText,
    diagnosisCode,
    treatmentDetail,
    sources,
  } = {}) {
    const enabled = process.env.FLOW2_ENABLE_GENERIC_DIAG_FALLBACK === '1';
    if (!enabled) return null;

    const respiratorySignal = [
      diagnosisText,
      diagnosisCode,
      treatmentDetail,
      sources?.diagnosisCanonical?.description_canonical,
      sources?.diagnosisCanonical?.description_raw,
    ]
      .flatMap(value => (Array.isArray(value) ? value : [value]))
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (
      !/\b(cough|urti|uri|upper respiratory|lower respiratory|pharyngitis|tonsillitis|bronch|sore throat)\b/i.test(
        respiratorySignal
      )
    ) {
      return null;
    }

    return {
      code: 'R05',
      description: 'Cough',
      reason: 'generic_fallback_cough',
    };
  }

  async _startRun(runType, metadata = {}) {
    if (!this.supabase) return null;
    try {
      const { data, error } = await this.supabase
        .from('rpa_extraction_runs')
        .insert({
          run_type: runType,
          status: 'running',
          started_at: new Date().toISOString(),
          metadata,
        })
        .select('id')
        .single();
      if (error) {
        logger.error('[VisitDetails] Failed to create run record', { error: error.message });
        return null;
      }
      return data?.id ?? null;
    } catch (error) {
      logger.error('[VisitDetails] Error creating run record', { error: error.message });
      return null;
    }
  }

  async _updateRun(runId, updates) {
    if (!this.supabase || !runId) return;
    try {
      const { error } = await this.supabase
        .from('rpa_extraction_runs')
        .update(updates)
        .eq('id', runId);
      if (error) {
        logger.error('[VisitDetails] Failed to update run record', { error: error.message });
      }
    } catch (error) {
      logger.error('[VisitDetails] Error updating run record', { error: error.message });
    }
  }
}
