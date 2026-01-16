import { logger } from './logger.js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * Saves extracted claim data to CRM storage
 * Currently saves to JSON files, can be migrated to Supabase later
 */
export class CRMSaver {
  constructor({ dataDir = './data/extractions' } = {}) {
    this.dataDir = dataDir;
  }

  /**
   * Save extracted claim data from Clinic Assist
   * @param {Object} data - Extracted claim data
   * @param {string} data.patientNric - Patient NRIC
   * @param {string} data.patientName - Patient name
   * @param {Object} data.claimDetails - Claim details from Clinic Assist
   * @param {string} data.sourcePortal - Source portal (e.g., 'Clinic Assist')
   * @param {string} data.targetPortal - Target portal (e.g., 'MHC Asia')
   * @param {Object} data.extractionMetadata - Metadata about extraction (sources, timestamps, etc.)
   */
  async saveClaimExtraction(data) {
    try {
      // Ensure data directory exists
      if (!existsSync(this.dataDir)) {
        await mkdir(this.dataDir, { recursive: true });
        logger.info(`[CRM] Created data directory: ${this.dataDir}`);
      }

      const timestamp = new Date().toISOString();
      const filename = `claim-extraction-${timestamp.replace(/[:.]/g, '-')}.json`;
      const filepath = join(this.dataDir, filename);

      const record = {
        id: `extraction-${Date.now()}`,
        source: 'Clinic Assist', // Explicitly mark as from Clinic Assist
        target: data.targetPortal || 'MHC Asia',
        extractedAt: timestamp,
        patient: {
          nric: data.patientNric || null,
          name: data.patientName || null,
        },
        claimDetails: {
          mcDays: data.claimDetails?.mcDays ?? 0,
          diagnosisText: data.claimDetails?.diagnosisText || null,
          notesText: data.claimDetails?.notesText || null,
          visitType: data.claimDetails?.visitType || null,
          referralClinic: data.claimDetails?.referralClinic || null,
          servicesAndDrugs: data.claimDetails?.items || [],
        },
        extractionMetadata: {
          sources: data.extractionMetadata?.sources || {},
          extractionMethod: 'automated',
          portal: 'Clinic Assist',
          ...(data.extractionMetadata || {}),
        },
        status: 'extracted',
        notes: `Extracted from Clinic Assist and prepared for ${data.targetPortal || 'MHC Asia'}`,
      };

      await writeFile(filepath, JSON.stringify(record, null, 2), 'utf-8');

      logger.info(`[CRM] Saved claim extraction to: ${filepath}`, {
        patientNric: data.patientNric,
        mcDays: record.claimDetails.mcDays,
        diagnosisLength: record.claimDetails.diagnosisText?.length || 0,
        itemsCount: record.claimDetails.servicesAndDrugs.length,
      });

      return {
        success: true,
        filepath,
        record,
      };
    } catch (error) {
      logger.error('[CRM] Failed to save claim extraction', { error: error.message, stack: error.stack });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Save a summary of the extraction for quick reference
   */
  async saveExtractionSummary(data) {
    try {
      const summaryFile = join(this.dataDir, 'extractions-summary.jsonl');
      const timestamp = new Date().toISOString();

      const summary = {
        timestamp,
        source: 'Clinic Assist',
        patientNric: data.patientNric || null,
        patientName: data.patientName || null,
        mcDays: data.claimDetails?.mcDays ?? 0,
        hasDiagnosis: !!data.claimDetails?.diagnosisText,
        itemsCount: data.claimDetails?.items?.length || 0,
        visitType: data.claimDetails?.visitType || null,
      };

      const line = JSON.stringify(summary) + '\n';
      await writeFile(summaryFile, line, { flag: 'a' });

      logger.info('[CRM] Updated extraction summary', summary);
      return { success: true };
    } catch (error) {
      logger.error('[CRM] Failed to save extraction summary', { error: error.message });
      return { success: false, error: error.message };
    }
  }
}

