/**
 * Enhanced MHC Asia Form Filling Module
 * Comprehensive form filling with better field detection and error handling
 */

import { logger } from '../utils/logger.js';

/**
 * Enhanced form filling methods for MHC Asia
 * This extends the existing MHCAsiaAutomation class
 */
export class MHCAsiaFormFilling {
  constructor(mhcAsiaAutomation) {
    this.mhc = mhcAsiaAutomation;
    this.page = mhcAsiaAutomation.page;
  }

  /**
   * Comprehensive form filling method
   * Fills all claim form fields from Clinic Assist data
   * @param {Object} claimData - Complete claim data from Clinic Assist
   */
  async fillCompleteClaimForm(claimData) {
    try {
      this.mhc._logStep('Fill complete claim form', { 
        patientName: claimData.patientName,
        nric: claimData.nric 
      });

      // Wait for form to be ready
      await this.page.waitForSelector('form, table, input, select', { timeout: 10000 });
      await this.page.waitForTimeout(2000);

      // Take initial screenshot
      await this.page.screenshot({ 
        path: 'screenshots/mhc-form-before-filling.png', 
        fullPage: true 
      });

      const filledFields = {
        visitType: false,
        mcDays: false,
        diagnosis: false,
        consultationFee: false,
        services: false,
        drugs: false,
      };

      // 1. Fill Visit Type / Charge Type
      if (claimData.visitType) {
        filledFields.visitType = await this.fillVisitType(claimData.visitType);
      }

      // 2. Fill MC Days
      if (claimData.mcDays !== undefined && claimData.mcDays !== null) {
        filledFields.mcDays = await this.fillMcDays(claimData.mcDays);
      }

      // 3. Fill Diagnosis
      if (claimData.diagnosisText) {
        filledFields.diagnosis = await this.fillDiagnosis(claimData.diagnosisText);
      }

      // 4. Fill Consultation Fee Max
      if (claimData.consultationMax) {
        filledFields.consultationFee = await this.fillConsultationFeeMax(claimData.consultationMax);
      }

      // 5. Fill Services/Procedures
      if (claimData.items && claimData.items.length > 0) {
        const services = claimData.items.filter(item => 
          /(xray|x-ray|scan|ultrasound|procedure|physio|ecg|injection|dressing|suturing|vaccine|consultation)/i.test(item.name || item)
        );
        if (services.length > 0) {
          filledFields.services = await this.fillServices(services);
        }
      }

      // 6. Fill Drugs/Medicines
      if (claimData.items && claimData.items.length > 0) {
        const drugs = claimData.items.filter(item => 
          !/(xray|x-ray|scan|ultrasound|procedure|physio|ecg|injection|dressing|suturing|vaccine|consultation)/i.test(item.name || item)
        );
        if (drugs.length > 0) {
          filledFields.drugs = await this.fillDrugs(drugs);
        }
      }

      // Take final screenshot
      await this.page.screenshot({ 
        path: 'screenshots/mhc-form-after-filling.png', 
        fullPage: true 
      });

      logger.info('Form filling summary:', filledFields);
      this.mhc._logStep('Form filling complete', filledFields);

      return filledFields;
    } catch (error) {
      logger.error('Failed to fill claim form:', error);
      await this.page.screenshot({ 
        path: 'screenshots/mhc-form-filling-error.png', 
        fullPage: true 
      });
      throw error;
    }
  }

  /**
   * Fill visit type / charge type
   */
  async fillVisitType(visitType) {
    try {
      const visitTypeLower = (visitType || '').toString().toLowerCase();
      let targetValue = null;

      if (visitTypeLower.includes('new')) {
        targetValue = /new/i;
      } else if (visitTypeLower.includes('follow')) {
        targetValue = /follow/i;
      }

      if (!targetValue) return false;

      const selectors = [
        'select[name*="charge" i]',
        'select[id*="charge" i]',
        'select[name*="visit" i]',
        'select[id*="visit" i]',
        'tr:has-text("Charge Type") select',
        'tr:has-text("Visit Type") select',
      ];

      for (const selector of selectors) {
        try {
          const select = this.page.locator(selector).first();
          if (await select.count() === 0) continue;

          const options = await select.locator('option').evaluateAll((opts) =>
            opts.map((o) => ({ value: o.value, label: (o.textContent || '').trim() }))
          );

          const match = options.find((o) => targetValue.test(o.label) || targetValue.test(o.value));
          if (match) {
            await select.selectOption({ value: match.value });
            await this.page.waitForTimeout(500);
            logger.info(`Visit type filled: ${match.label}`);
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      return false;
    } catch (error) {
      logger.warn('Could not fill visit type:', error.message);
      return false;
    }
  }

  /**
   * Fill MC days
   */
  async fillMcDays(mcDays) {
    try {
      const days = Number.isFinite(Number(mcDays)) ? Number(mcDays) : 0;

      const selectors = [
        'tr:has-text("MC Day") select',
        'tr:has-text("MC Day") input',
        'input[name*="mc" i]',
        'select[name*="mc" i]',
        'input[id*="mc" i]',
        'select[id*="mc" i]',
      ];

      for (const selector of selectors) {
        try {
          const field = this.page.locator(selector).first();
          if (await field.count() === 0) continue;

          const tagName = await field.evaluate((el) => el.tagName);
          if (tagName === 'SELECT') {
            const options = await field.locator('option').evaluateAll((opts) =>
              opts.map((o) => ({ value: o.value, label: (o.textContent || '').trim() }))
            );
            const match = options.find((o) => o.label === String(days) || o.value === String(days));
            if (match) {
              await field.selectOption({ value: match.value });
              logger.info(`MC days selected: ${days}`);
              return true;
            }
          } else {
            await field.fill(String(days));
            logger.info(`MC days filled: ${days}`);
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      return false;
    } catch (error) {
      logger.warn('Could not fill MC days:', error.message);
      return false;
    }
  }

  /**
   * Fill diagnosis with improved matching
   */
  async fillDiagnosis(diagnosisText) {
    try {
      if (!diagnosisText) return false;

      // Extract key words from diagnosis
      const words = diagnosisText
        .split(/\s+/)
        .map((w) => w.replace(/[^\w]/g, ''))
        .filter((w) => w.length >= 4)
        .slice(0, 3);

      const searchRegex = words.length ? new RegExp(words.join('|'), 'i') : new RegExp(diagnosisText.slice(0, 10), 'i');

      const selectors = [
        'tr:has-text("Diagnosis Pri") select',
        'tr:has-text("Diagnosis Primary") select',
        'tr:has-text("Diagnosis") select',
        'select[name*="diagnosis" i]',
        'select[id*="diagnosis" i]',
      ];

      for (const selector of selectors) {
        try {
          const select = this.page.locator(selector).first();
          if (await select.count() === 0) continue;

          const options = await select.locator('option').evaluateAll((opts) =>
            opts.map((o) => ({ value: o.value, label: (o.textContent || '').trim() }))
          );

          const match = options.find((o) => searchRegex.test(o.label) || searchRegex.test(o.value));
          if (match) {
            await select.selectOption({ value: match.value });
            await this.page.waitForTimeout(500);
            logger.info(`Diagnosis selected: ${match.label}`);
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      return false;
    } catch (error) {
      logger.warn('Could not fill diagnosis:', error.message);
      return false;
    }
  }

  /**
   * Fill consultation fee max
   */
  async fillConsultationFeeMax(maxAmount) {
    try {
      const max = Number.isFinite(Number(maxAmount)) ? Number(maxAmount) : 9999;

      const selectors = [
        'tr:has-text("Consultation Fee") input',
        'input[name*="consultation" i]',
        'input[id*="consultation" i]',
        'input[name*="fee" i]',
        'input[type="number"]',
      ];

      for (const selector of selectors) {
        try {
          const field = this.page.locator(selector).first();
          if (await field.count() === 0) continue;

          await field.fill(String(max));
          await this.page.waitForTimeout(500);
          logger.info(`Consultation fee max filled: ${max}`);
          return true;
        } catch (e) {
          continue;
        }
      }

      return false;
    } catch (error) {
      logger.warn('Could not fill consultation fee:', error.message);
      return false;
    }
  }

  /**
   * Fill services/procedures
   */
  async fillServices(services) {
    try {
      if (!services || services.length === 0) return false;

      const serviceNames = services.map(s => typeof s === 'string' ? s : (s.name || s.description || '')).filter(Boolean);

      // Use existing method or create new one
      const result = await this.mhc._fillTextInputsInTableSection(
        /Procedure Name/i,
        /Total Proc Fee/i,
        serviceNames
      );

      logger.info(`Services filled: ${result.filled || 0} items`);
      return (result.filled || 0) > 0;
    } catch (error) {
      logger.warn('Could not fill services:', error.message);
      return false;
    }
  }

  /**
   * Fill drugs/medicines
   */
  async fillDrugs(drugs) {
    try {
      if (!drugs || drugs.length === 0) return false;

      const drugNames = drugs.map(d => typeof d === 'string' ? d : (d.name || d.description || '')).filter(Boolean);

      // Use existing method
      const result = await this.mhc._fillTextInputsInTableSection(
        /Drug Name/i,
        /Total Drug Fee/i,
        drugNames
      );

      logger.info(`Drugs filled: ${result.filled || 0} items`);
      return (result.filled || 0) > 0;
    } catch (error) {
      logger.warn('Could not fill drugs:', error.message);
      return false;
    }
  }
}
