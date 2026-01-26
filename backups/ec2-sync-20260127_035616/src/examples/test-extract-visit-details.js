import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { createSupabaseClient } from '../utils/supabase-client.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/**
 * Test script to extract diagnosis and services/drugs from Clinic Assist visit records
 * 
 * This script:
 * 1. Logs into Clinic Assist
 * 2. Navigates to Queue page
 * 3. Finds a patient by name
 * 4. Opens the visit record
 * 5. Extracts diagnosis and services/drugs
 * 6. Shows what was extracted
 * 
 * Usage:
 *   node src/examples/test-extract-visit-details.js [patient_name]
 */
async function testExtractVisitDetails() {
  const patientName = process.argv[2] || null;

  logger.info('=== Test Visit Details Extraction ===');

  // Get a sample visit from database
  const supabase = createSupabaseClient();
  if (!supabase) {
    logger.error('Supabase client not available');
    process.exit(1);
  }

  logger.info('Fetching visit from database...');
  let query = supabase
    .from('visits')
    .select('id, patient_name, visit_record_no, visit_date, nric')
    .eq('source', 'Clinic Assist')
    .limit(1);

  if (patientName) {
    query = query.ilike('patient_name', `%${patientName}%`);
  }

  const { data: visits, error } = await query;

  if (error) {
    logger.error('Database error:', error);
    process.exit(1);
  }

  if (!visits || visits.length === 0) {
    logger.warn('No visits found in database. Using manual test mode...');
    logger.info('You can provide a patient name as argument: node src/examples/test-extract-visit-details.js "Patient Name"');
    
    // If no database data, we can still test the extraction on a manually specified patient
    if (!patientName) {
      logger.error('No patient name provided and no database data available');
      process.exit(1);
    }
  }

  const visit = visits?.[0] || { patient_name: patientName, visit_date: new Date().toISOString().split('T')[0] };
  const targetPatientName = visit.patient_name || patientName;
  
  logger.info(`\n=== Test Configuration ===`);
  logger.info(`Patient Name: ${targetPatientName}`);
  logger.info(`Visit Date: ${visit.visit_date || 'N/A'}`);
  logger.info(`Visit Record No: ${visit.visit_record_no || 'N/A'}`);
  logger.info(`NRIC: ${visit.nric || 'N/A'}`);

  const browserManager = new BrowserManager();
  const page = await browserManager.newPage();
  const clinicAssist = new ClinicAssistAutomation(page);

  try {
    // Step 1: Login to Clinic Assist
    logger.info('\n=== Step 1: Login to Clinic Assist ===');
    await clinicAssist.login();
    await page.waitForTimeout(2000);

    // Step 2: Navigate to Queue
    // Note: We need branch and dept, but we don't have that in extracted data
    // For testing, we'll try to navigate to queue and see what happens
    // In production, we'd need to either:
    //   a) Store branch/dept in database
    //   b) Use a default branch/dept
    //   c) Navigate to queue list report first, then navigate to queue page
    
    logger.info('\n=== Step 2: Navigate to Queue ===');
    logger.warn('Note: We need branch and dept to navigate to queue.');
    logger.warn('For this test, we will try to use Reports -> Queue List approach.');
    
    // Alternative: Use Reports -> Queue List to see patients, then navigate from there
    // But actually, to open a visit record, we need the actual Queue page, not Queue List Report
    
    logger.info('\n=== Step 3: Navigate to Reports -> Queue List (for inspection) ===');
    const navigated = await clinicAssist.navigateToReports();
    if (navigated) {
      await page.waitForTimeout(2000);
      const queueListOpened = await clinicAssist.navigateToQueueListReport();
      if (queueListOpened) {
        logger.info('Queue List Report opened');
        await page.screenshot({ path: 'screenshots/test-queue-list-report.png', fullPage: true });
      }
    }

    logger.info('\n=== Step 4: Manual Inspection ===');
    logger.info('The browser is now open for you to manually inspect:');
    logger.info('1. Navigate to Queue page (Reception -> Queue)');
    logger.info(`2. Find patient: ${targetPatientName}`);
    logger.info('3. Click to open the visit record');
    logger.info('4. Check where Diagnosis and Services/Drugs are located');
    logger.info('\nBrowser will stay open for 2 minutes...');
    logger.info('Press Ctrl+C to close early\n');
    
    await page.waitForTimeout(120000); // 2 minutes

    // Step 5: If we were on a visit record, we could extract:
    // logger.info('\n=== Step 5: Extract Diagnosis and Services/Drugs ===');
    // const claimDetails = await clinicAssist.extractClaimDetailsFromCurrentVisit();
    // logger.info('\n=== Extracted Data ===');
    // logger.info(`Diagnosis: ${claimDetails.diagnosisText || 'Not found'}`);
    // logger.info(`Services/Drugs: ${JSON.stringify(claimDetails.items || [], null, 2)}`);
    // logger.info(`MC Days: ${claimDetails.mcDays}`);
    // logger.info(`Sources: ${JSON.stringify(claimDetails.sources, null, 2)}`);

  } catch (error) {
    logger.error('Error during extraction test:', error);
    await page.screenshot({ path: 'screenshots/test-extraction-error.png', fullPage: true });
  } finally {
    await browserManager.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testExtractVisitDetails().catch(error => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });
}

export { testExtractVisitDetails };
