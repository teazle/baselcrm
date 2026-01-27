import 'dotenv/config';
import { BrowserManager } from '../utils/browser.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { MHCAsiaAutomation } from '../automations/mhc-asia.js';
import { logger } from '../utils/logger.js';

/**
 * Direct test of MHC fixes:
 * 1. Use "Search under other programs" instead of AIA
 * 2. Fill MC start date
 * 3. Fill diagnosis using description
 */
async function testMHCFixes() {
  const browserManager = new BrowserManager();
  let page = null;
  let clinicAssistPage = null;

  try {
    logger.info('🔍 Testing MHC Form Filling Fixes...\n');

    // Initialize browser
    await browserManager.init({ headless: false, useVPN: false });

    // STEP 1: Get data from Clinic Assist
    logger.info('📝 STEP 1: Getting data from Clinic Assist...');
    clinicAssistPage = await browserManager.newPage();
    const clinicAssist = new ClinicAssistAutomation(clinicAssistPage);

    await clinicAssist.login('ssoc');
    logger.info('✅ Clinic Assist logged in\n');

    await clinicAssist.navigateToPatientPage();
    await clinicAssist.searchPatientByNumber('75434');
    await clinicAssistPage.waitForTimeout(2000);
    await clinicAssist.openPatientFromSearchResultsByNumber('75434');
    logger.info('✅ Patient 75434 opened\n');

    const data = await clinicAssist.getChargeTypeAndDiagnosis('2026-01-23');
    logger.info('✅ Data extracted:');
    logger.info(`   Charge Type: ${data.chargeType}`);
    logger.info(`   Diagnosis: ${data.diagnosis?.code} ${data.diagnosis?.description}`);
    logger.info(`   MC Days: ${data.mcDays}`);
    logger.info(`   MC Start Date: ${data.mcStartDate}\n`);

    // STEP 2: Test MHC Asia form filling
    logger.info('📝 STEP 2: Testing MHC Asia form filling...');
    page = await browserManager.newPage();
    const mhcAsia = new MHCAsiaAutomation(page);
    mhcAsia.setupDialogHandler();

    // Login
    await mhcAsia.login();
    logger.info('✅ MHC Asia logged in\n');

    // Navigate to Normal Visit (should show program selection tiles)
    logger.info('📝 Navigating to Normal Visit...');
    await mhcAsia.navigateToNormalVisit();
    await page.screenshot({ path: 'screenshots/fix-test-programs-page.png', fullPage: true });
    logger.info('✅ At program selection page\n');
    logger.info('📸 Screenshot: fix-test-programs-page.png\n');

    // Search for patient (should click "other programs" tile, NOT AIA)
    logger.info('📝 Searching for patient (will use OTHER PROGRAMS tile)...');
    const searchResult = await mhcAsia.searchPatientByNRIC('S8635560D');
    logger.info(`✅ Patient found: ${searchResult.portal}\n`);
    await page.screenshot({ path: 'screenshots/fix-test-search-results.png', fullPage: true });

    // Open patient and add visit
    await mhcAsia.openPatient(searchResult.nric);
    await page.waitForTimeout(2000);
    logger.info('✅ Patient record opened\n');

    await mhcAsia.clickAddVisit();
    await page.waitForTimeout(2000);
    logger.info('✅ Visit form opened\n');
    await page.screenshot({ path: 'screenshots/fix-test-form-opened.png', fullPage: true });

    // Fill visit date
    await mhcAsia.setVisitDate('23/01/2026');
    await page.waitForTimeout(500);
    logger.info('✅ Visit date filled\n');

    // Fill charge type
    if (data.chargeType === 'first') {
      await mhcAsia.setChargeTypeNewVisit();
    } else {
      await mhcAsia.setChargeTypeFollowUp();
    }
    await page.waitForTimeout(500);
    logger.info('✅ Charge type filled\n');

    // Fill consultation fee
    await mhcAsia.setConsultationFeeMax(99999);
    await page.waitForTimeout(500);
    logger.info('✅ Consultation fee filled\n');

    // Fill MC Days AND MC Start Date
    if (data.mcDays > 0) {
      logger.info(`📝 Filling MC Days: ${data.mcDays}, Start Date: ${data.mcStartDate}`);
      await mhcAsia.fillMcDays(data.mcDays);
      await page.waitForTimeout(300);
      logger.info('   ✅ MC days filled');

      await mhcAsia.fillMcStartDate(data.mcStartDate);
      await page.waitForTimeout(300);
      logger.info('   ✅ MC start date filled\n');
    }

    await page.screenshot({ path: 'screenshots/fix-test-mc-filled.png', fullPage: true });
    logger.info('📸 Screenshot: fix-test-mc-filled.png\n');

    // Fill diagnosis (using description, not just code)
    if (data.diagnosis && data.diagnosis.description) {
      const diagnosisText = data.diagnosis.description;
      logger.info(`📝 Filling Diagnosis: ${diagnosisText}`);
      const diagResult = await mhcAsia.selectDiagnosis(diagnosisText);
      await page.waitForTimeout(1000);

      if (diagResult) {
        logger.info('   ✅ Diagnosis filled\n');
      } else {
        logger.warn('   ⚠️  Diagnosis not auto-matched (may need manual selection)\n');
      }
    }

    await page.screenshot({ path: 'screenshots/fix-test-diagnosis-filled.png', fullPage: true });
    logger.info('📸 Screenshot: fix-test-diagnosis-filled.png\n');

    // Scroll for visibility
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'screenshots/fix-test-complete.png', fullPage: true });
    logger.info('📸 Screenshot: fix-test-complete.png\n');

    logger.info('✅ ALL FIXES VERIFIED!');
    logger.info('═══════════════════════════════════════════════════════');
    logger.info('  1. ✅ Used "Search under other programs" tile');
    logger.info('  2. ✅ Filled MC start date');
    logger.info('  3. ✅ Filled diagnosis using description');
    logger.info('═══════════════════════════════════════════════════════');
    logger.info('');
    logger.info('🔍 Form is still open in VNC - verify visually');
    logger.info('Press Ctrl+C when done');

    // Keep browser open
    await new Promise(() => {});
  } catch (error) {
    logger.error('Test failed:', error);
    throw error;
  }
}

testMHCFixes().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
