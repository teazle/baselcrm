#!/usr/bin/env node

/**
 * Test MHC Asia form filling for patient 75434 (NRIC: S8635560D)
 * Complete end-to-end test: Extract from Clinic Assist → Fill MHC form → Stop before save
 */

import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { MHCAsiaAutomation } from '../automations/mhc-asia.js';
import { logger } from '../utils/logger.js';

dotenv.config();

async function testMHCFormFilling() {
  const browserManager = new BrowserManager();
  
  try {
    logger.info('=== Testing MHC Form Filling: Patient 75434 ===\n');
    
    // Patient details
    const patientNumber = '75434';
    const nric = 'S8635560D';
    const visitDate = '2026-01-23'; // Visit date for this patient
    
    // Initialize browser
    await browserManager.init();
    const clinicAssistPage = await browserManager.newPage();
    
    // CRITICAL: Block external protocol handlers at JavaScript level
    // This runs BEFORE any page scripts, intercepting calls that would trigger OS dialogs
    await clinicAssistPage.addInitScript(() => {
      // Store original functions
      const originalWindowOpen = window.open;
      const originalCreateElement = document.createElement.bind(document);
      
      // Override window.open to block non-http protocols
      window.open = function(url, ...args) {
        if (url && typeof url === 'string') {
          const lowerUrl = url.toLowerCase();
          if (!lowerUrl.startsWith('http://') && 
              !lowerUrl.startsWith('https://') && 
              !lowerUrl.startsWith('about:') &&
              !lowerUrl.startsWith('javascript:')) {
            console.log('[BLOCKED] External protocol via window.open:', url.substring(0, 50));
            return null;
          }
        }
        return originalWindowOpen.call(window, url, ...args);
      };
      
      // Override createElement to intercept iframe/object creation with external protocols
      document.createElement = function(tagName, ...args) {
        const el = originalCreateElement(tagName, ...args);
        if (tagName.toLowerCase() === 'iframe' || tagName.toLowerCase() === 'object') {
          const originalSetAttribute = el.setAttribute.bind(el);
          el.setAttribute = function(name, value) {
            if ((name === 'src' || name === 'data') && value && typeof value === 'string') {
              const lowerValue = value.toLowerCase();
              if (!lowerValue.startsWith('http://') && 
                  !lowerValue.startsWith('https://') && 
                  !lowerValue.startsWith('about:') &&
                  !lowerValue.startsWith('data:') &&
                  !lowerValue.startsWith('blob:') &&
                  !lowerValue.startsWith('javascript:')) {
                console.log('[BLOCKED] External protocol via', tagName, name + ':', value.substring(0, 50));
                return;
              }
            }
            return originalSetAttribute(name, value);
          };
        }
        return el;
      };
      
      // Block location assignments to external protocols
      const locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
      if (locationDescriptor && locationDescriptor.set) {
        const originalLocationSet = locationDescriptor.set;
        Object.defineProperty(window, 'location', {
          ...locationDescriptor,
          set: function(value) {
            if (value && typeof value === 'string') {
              const lowerValue = value.toLowerCase();
              if (!lowerValue.startsWith('http://') && 
                  !lowerValue.startsWith('https://') && 
                  !lowerValue.startsWith('about:') &&
                  !lowerValue.startsWith('/')) {
                console.log('[BLOCKED] External protocol via location assignment:', value.substring(0, 50));
                return;
              }
            }
            return originalLocationSet.call(this, value);
          }
        });
      }
    });
    
    // Handle JavaScript dialogs automatically
    clinicAssistPage.on('dialog', async dialog => {
      logger.info(`Dialog detected: ${dialog.type()} - ${dialog.message()}`);
      await dialog.dismiss().catch(() => {});
    });
    
    // ============================================
    // PART 1: Extract Data from Clinic Assist
    // ============================================
    
    logger.info('PART 1: Extracting data from Clinic Assist\n');
    
    // Step 1: Login to Clinic Assist
    logger.info('Step 1: Logging into Clinic Assist...');
    const clinicAssist = new ClinicAssistAutomation(clinicAssistPage);
    await clinicAssist.login();
    logger.info('✓ Login successful\n');
    
    // Step 2: Navigate to Patient Page (no waiting)
    logger.info('Step 2: Navigating to Patient Page...');
    await clinicAssist.navigateToPatientPage();
    logger.info('✓ Navigated to Patient Page\n');
    
    // Step 3: Search for patient (try by number first, then by NRIC)
    logger.info(`Step 3: Searching for patient ${patientNumber}...`);
    
    try {
      await clinicAssist.searchPatientByNumber(patientNumber);
      logger.info('✓ Patient search completed\n');
      
      // Step 4: Open patient record
      logger.info('Step 4: Opening patient record...');
      await clinicAssist.openPatientFromSearchResultsByNumber(patientNumber);
      logger.info('✓ Patient record opened\n');
    } catch (error) {
      logger.warn(`⚠ Patient not found by number ${patientNumber}, trying by NRIC...`);
      
      // Fallback: Search by NRIC
      await clinicAssist.searchPatientByNumber(nric);
      logger.info('✓ Patient search by NRIC completed\n');
      
      // Open first result (should be the patient)
      logger.info('Step 4: Opening patient record...');
      const firstResult = clinicAssistPage.locator('table tr:has(td) a').first();
      await firstResult.click();
      await clinicAssistPage.waitForLoadState('domcontentloaded').catch(() => {});
      await clinicAssistPage.waitForTimeout(2000);
      logger.info('✓ Patient record opened\n');
    }
    
    // Step 5: Extract NRIC
    logger.info('Step 5: Extracting patient NRIC...');
    const extractedNric = await clinicAssist.extractPatientNricFromPatientInfo();
    logger.info(`✓ NRIC extracted: ${extractedNric || nric}\n`);
    
    // Use provided NRIC if extraction fails
    const finalNric = extractedNric || nric;
    
    // Step 6: Navigate to TX History
    logger.info('Step 6: Navigating to TX History...');
    await clinicAssist.navigateToTXHistory();
    logger.info('✓ Navigated to TX History\n');
    
    // Step 7: Extract diagnosis for the visit date
    logger.info(`Step 7: Extracting diagnosis for date ${visitDate}...`);
    await clinicAssist.openDiagnosisTab();
    const diagnosis = await clinicAssist.extractDiagnosisForDate(visitDate);
    
    if (!diagnosis || !diagnosis.description) {
      logger.warn('⚠ No diagnosis found for visit date, using generic diagnosis');
      diagnosis.description = 'General medical consultation';
      diagnosis.code = 'Z00.0';
    }
    
    logger.info(`✓ Diagnosis: ${diagnosis?.description || 'General medical consultation'}\n`);
    
    // Step 8: Extract medicines for today's visit
    logger.info(`Step 8: Extracting medicines for date ${visitDate}...`);
    const medicines = await clinicAssist.extractMedicinesFromTXHistory(visitDate);
    logger.info(`✓ Extracted ${medicines.length} medicine(s):`);
    medicines.forEach((med, index) => {
      logger.info(`  ${index + 1}. ${med.name} (Qty: ${med.quantity})`);
    });
    logger.info('');
    
    // Step 9: Extract claim details
    logger.info('Step 9: Extracting claim details...');
    const claimDetails = await clinicAssist.extractClaimDetailsFromCurrentVisit();
    logger.info(`✓ Claim amount: $${claimDetails.claimAmount || '0'}\n`);
    
    // ============================================
    // PART 2: Fill MHC Asia Form
    // ============================================
    
    logger.info('PART 2: Filling MHC Asia claim form\n');
    
    // Create MHC Asia page now (not at the start)
    logger.info('Creating new browser page for MHC Asia...');
    const mhcAsiaPage = await browserManager.newPage();
    logger.info('✓ MHC Asia page created\n');
    
    // Step 10: Login to MHC Asia
    logger.info('Step 10: Logging into MHC Asia...');
    const mhcAsia = new MHCAsiaAutomation(mhcAsiaPage);
    await mhcAsia.login();
    logger.info('✓ MHC Asia login successful\n');
    
    // Step 11: Navigate to patient search
    logger.info('Step 11: Navigating to patient search...');
    await mhcAsia.navigateToAIAProgramSearch();
    logger.info('✓ Navigated to patient search\n');
    
    // Step 12: Search patient by NRIC
    logger.info(`Step 12: Searching patient by NRIC: ${finalNric}...`);
    const searchResult = await mhcAsia.searchPatientByNRIC(finalNric);
    logger.info(`✓ Patient found - Portal: ${searchResult.portal}\n`);
    
    // Step 13: Open patient
    logger.info('Step 13: Opening patient from search results...');
    await mhcAsia.openPatientFromSearchResults(finalNric);
    logger.info('✓ Patient opened\n');
    
    // Step 14: Add visit
    logger.info(`Step 14: Adding visit for portal: ${searchResult.portal}...`);
    await mhcAsia.addVisit(searchResult.portal);
    logger.info('✓ Visit added - Form opened\n');
    
    await mhcAsiaPage.waitForTimeout(2000);
    
    // ============================================
    // PART 3: Fill Form Fields
    // ============================================
    
    logger.info('PART 3: Filling form fields\n');
    
    // Format visit date as DD/MM/YYYY
    const visitDateFormatted = new Date().toLocaleDateString('en-GB');
    
    // Fill basic fields
    logger.info('Step 15: Filling basic fields...');
    await mhcAsia.fillVisitDate(visitDateFormatted);
    logger.info(`  ✓ Visit date: ${visitDateFormatted}`);
    
    await mhcAsia.fillChargeType('Follow Up');
    logger.info('  ✓ Charge type: Follow Up');
    
    await mhcAsia.fillMcDays(0);
    logger.info('  ✓ MC days: 0');
    
    if (claimDetails.claimAmount) {
      await mhcAsia.fillConsultationFee(claimDetails.claimAmount);
      logger.info(`  ✓ Consultation fee: $${claimDetails.claimAmount}`);
    }
    logger.info('');
    
    // Fill diagnosis
    if (diagnosis?.description) {
      logger.info('Step 16: Filling diagnosis via M button search...');
      await mhcAsia.fillDiagnosisPrimary(diagnosis.description);
      logger.info(`  ✓ Diagnosis filled: ${diagnosis.description.substring(0, 50)}...\n`);
    } else {
      logger.warn('⚠ No diagnosis to fill\n');
    }
    
    // Fill medicines
    if (medicines.length > 0) {
      logger.info(`Step 17: Filling ${medicines.length} medicine(s) via M button search...`);
      
      for (let i = 0; i < medicines.length; i++) {
        const medicine = medicines[i];
        const rowIndex = i + 1;
        
        // Click "More Drug" for additional rows (skip for first row)
        if (i > 0) {
          await mhcAsia.clickMoreDrug();
          await mhcAsiaPage.waitForTimeout(1000);
        }
        
        // Fill drug item
        logger.info(`  ${rowIndex}. Filling ${medicine.name.substring(0, 40)}...`);
        await mhcAsia.fillDrugItem(medicine, rowIndex);
        logger.info(`     ✓ Drug filled (Qty: ${medicine.quantity})`);
        
        await mhcAsiaPage.waitForTimeout(1000);
      }
      logger.info('');
    } else {
      logger.warn('⚠ No medicines to fill\n');
    }
    
    // Compute claim
    logger.info('Step 18: Computing claim totals...');
    await mhcAsia.computeClaim();
    await mhcAsiaPage.waitForTimeout(2000);
    logger.info('✓ Claim computed\n');
    
    // Take final screenshot
    await mhcAsiaPage.screenshot({ 
      path: 'screenshots/mhc-form-filled-75434.png', 
      fullPage: true 
    });
    logger.info('📸 Screenshot saved: mhc-form-filled-75434.png\n');
    
    // ============================================
    // DONE - Keep browser open for review
    // ============================================
    
    logger.info('✅ Form filling complete!\n');
    logger.info('============================================');
    logger.info('Form filled successfully - Ready for review');
    logger.info('============================================\n');
    logger.info('IMPORTANT: Stopping BEFORE "Save As Draft"');
    logger.info('Please review the form manually in the browser\n');
    logger.info('Extracted data summary:');
    logger.info(`  - Patient: ${patientNumber} (NRIC: ${finalNric})`);
    logger.info(`  - Diagnosis: ${diagnosis?.description?.substring(0, 60) || 'N/A'}`);
    logger.info(`  - Medicines: ${medicines.length} item(s)`);
    logger.info(`  - Consultation fee: $${claimDetails.claimAmount || '0'}`);
    logger.info('');
    logger.info('Browser will stay open for 30 minutes for manual review');
    logger.info('Press Ctrl+C to close when done\n');
    
    await new Promise(resolve => setTimeout(resolve, 1800000)); // 30 minutes
    
  } catch (error) {
    logger.error('Test failed:', error);
    
    // Take error screenshots
    try {
      const pages = await browserManager.getAllPages();
      for (let i = 0; i < pages.length; i++) {
        await pages[i].screenshot({ 
          path: `screenshots/error-page-${i}-75434.png`, 
          fullPage: true 
        });
      }
      logger.info('Error screenshots saved');
    } catch (e) {
      logger.warn('Could not take error screenshots');
    }
    
    logger.info('\nKeeping browser open for debugging...');
    logger.info('Press Ctrl+C to close\n');
    
    await new Promise(resolve => setTimeout(resolve, 1800000));
  } finally {
    logger.info('Closing browser...');
    await browserManager.close();
  }
}

testMHCFormFilling().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
