import { BrowserManager } from '../utils/browser.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { MHCAsiaAutomation } from '../automations/mhc-asia.js';
import { logger } from '../utils/logger.js';

/**
 * Main claim processor that orchestrates the automation workflow
 */
export class ClaimProcessor {
  constructor() {
    this.browserManager = new BrowserManager();
    this.automations = new Map();
  }

  /**
   * Initialize the claim processor
   */
  async init() {
    try {
      await this.browserManager.init();
      logger.info('Claim processor initialized');
    } catch (error) {
      logger.error('Failed to initialize claim processor:', error);
      throw error;
    }
  }

  /**
   * Get automation instance for a specific portal
   * @param {string} portalName - Name of the portal ('CLINIC_ASSIST' or 'MHC_ASIA')
   */
  async getAutomation(portalName) {
    if (this.automations.has(portalName)) {
      return this.automations.get(portalName);
    }

    const page = await this.browserManager.newPage();
    let automation;

    switch (portalName.toUpperCase()) {
      case 'CLINIC_ASSIST':
        automation = new ClinicAssistAutomation(page);
        break;
      case 'MHC_ASIA':
        automation = new MHCAsiaAutomation(page);
        break;
      default:
        throw new Error(`Unknown portal: ${portalName}`);
    }

    this.automations.set(portalName, automation);
    return automation;
  }

  /**
   * Process claims for a specific portal
   * @param {string} portalName - Name of the portal
   * @param {Array} claims - Array of claim data objects
   */
  async processClaimsForPortal(portalName, claims) {
    try {
      logger.info(`Processing ${claims.length} claims for ${portalName}...`);
      
      const automation = await this.getAutomation(portalName);
      
      // Login
      await automation.login();
      
      const results = [];
      
      // Process each claim
      for (const claim of claims) {
        try {
          const result = await automation.processClaim(claim);
          results.push({ success: true, claim, result });
          logger.info(`Claim processed successfully: ${claim.id || 'unknown'}`);
        } catch (error) {
          logger.error(`Failed to process claim ${claim.id || 'unknown'}:`, error);
          results.push({ success: false, claim, error: error.message });
        }
        
        // Small delay between claims
        await automation.page.waitForTimeout(1000);
      }
      
      // Logout
      await automation.logout();
      
      return results;
    } catch (error) {
      logger.error(`Failed to process claims for ${portalName}:`, error);
      throw error;
    }
  }

  /**
   * Process a single claim workflow using the new ClaimWorkflow
   * This is the main entry point for processing a claim from Clinic Assist to MHC Asia
   * @param {Object} workflowParams - Workflow parameters
   * @param {string} workflowParams.branchName - Branch name in Clinic Assist
   * @param {string} workflowParams.deptName - Department name in Clinic Assist
   * @param {string} workflowParams.patientIdentifier - Patient name or identifier
   * @param {string} workflowParams.cardNumber - Insurance card number (optional)
   * @param {string} workflowParams.verificationCode - 2FA code if needed (optional)
   * @param {number} workflowParams.consultationMax - Maximum consultation amount (optional)
   */
  async processClaimWorkflow(workflowParams) {
    try {
      logger.info('Starting claim workflow...');
      
      const { ClaimWorkflow } = await import('./claim-workflow.js');
      
      // Get automation pages
      const clinicAssist = await this.getAutomation('CLINIC_ASSIST');
      const mhcAsia = await this.getAutomation('MHC_ASIA');
      
      // Create workflow instance
      const workflow = new ClaimWorkflow(clinicAssist.page, mhcAsia.page);
      
      // Execute workflow
      const result = await workflow.executeWorkflow(workflowParams);
      
      logger.info('Claim workflow completed successfully');
      return result;
    } catch (error) {
      logger.error('Claim workflow failed:', error);
      throw error;
    }
  }

  /**
   * Close all browser instances
   */
  async close() {
    try {
      await this.browserManager.close();
      logger.info('Claim processor closed');
    } catch (error) {
      logger.error('Error closing claim processor:', error);
    }
  }
}

