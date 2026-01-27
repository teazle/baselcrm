import { BrowserManager } from '../utils/browser.js';
import { MHCAsiaAutomation } from '../automations/mhc-asia.js';
import { logger } from '../utils/logger.js';
import 'dotenv/config';

/**
 * Investigate MHC Asia form structure
 */
async function investigateMHCForm() {
  const browserManager = new BrowserManager();
  let page = null;

  try {
    logger.info('🔍 Investigating MHC Asia Form Structure...\n');

    // Initialize browser
    await browserManager.init({
      headless: false,
      useVPN: false,
    });

    page = await browserManager.newPage();
    const mhcAsia = new MHCAsiaAutomation(page);

    // Login
    logger.info('📝 Logging in to MHC Asia...');
    await mhcAsia.login();
    logger.info('✅ Logged in\n');

    // Navigate to Normal Visit
    logger.info('📝 Navigating to Normal Visit...');
    await mhcAsia.navigateToNormalVisit();
    await page.waitForTimeout(2000);
    logger.info('✅ At Normal Visit page\n');

    // Take screenshot of the program selection page
    await page.screenshot({ path: 'screenshots/programs-page.png', fullPage: true });
    logger.info('📸 Screenshot: programs-page.png\n');

    // Extract all visible buttons/links on the page
    logger.info('🔍 Finding all program buttons...\n');
    const programs = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('a, button, [role="button"], div[onclick]'));
      return buttons
        .map((el) => ({
          tag: el.tagName,
          text: el.textContent?.trim().substring(0, 100),
          href: el.getAttribute('href'),
          onclick: el.getAttribute('onclick'),
          className: el.className,
        }))
        .filter((item) => item.text && item.text.length > 0);
    });

    logger.info('Found program options:');
    programs.forEach((prog, idx) => {
      logger.info(`  ${idx + 1}. ${prog.tag}: "${prog.text}"`);
      if (prog.href) logger.info(`     href: ${prog.href}`);
    });
    logger.info('');

    // Search for NRIC to see patient search page
    logger.info('📝 Testing patient search with NRIC: S8635560D...');
    const searchResult = await mhcAsia.searchPatientByNRIC('S8635560D');
    logger.info(`✅ Search result: ${JSON.stringify(searchResult, null, 2)}\n`);

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/search-results.png', fullPage: true });
    logger.info('📸 Screenshot: search-results.png\n');

    // Try to open the patient and add visit
    logger.info('📝 Opening patient record...');
    await mhcAsia.openPatientRecord(searchResult);
    await page.waitForTimeout(2000);
    logger.info('✅ Patient record opened\n');

    logger.info('📝 Adding visit...');
    await mhcAsia.clickAddVisit();
    await page.waitForTimeout(2000);
    logger.info('✅ Visit form opened\n');

    await page.screenshot({ path: 'screenshots/visit-form.png', fullPage: true });
    logger.info('📸 Screenshot: visit-form.png\n');

    // Investigate form fields
    logger.info('🔍 Analyzing form fields...\n');
    const formFields = await page.evaluate(() => {
      const fields = [];

      // Find all rows in the form
      const rows = Array.from(document.querySelectorAll('tr, .form-row, .form-group'));
      rows.forEach((row) => {
        const label = row.querySelector('label, th, td:first-child')?.textContent?.trim();
        const inputs = Array.from(row.querySelectorAll('input, select, textarea'));

        inputs.forEach((input) => {
          fields.push({
            label: label || 'No label',
            tag: input.tagName,
            type: input.type,
            name: input.name,
            id: input.id,
            placeholder: input.placeholder,
          });
        });
      });

      return fields;
    });

    logger.info('Form fields found:');
    formFields.forEach((field, idx) => {
      logger.info(`  ${idx + 1}. Label: "${field.label}"`);
      logger.info(`     Tag: ${field.tag}, Type: ${field.type}, Name: ${field.name || 'N/A'}, ID: ${field.id || 'N/A'}`);
    });
    logger.info('');

    // Look specifically for MC fields
    logger.info('🔍 Looking for MC-related fields...\n');
    const mcFields = await page.evaluate(() => {
      const allElements = Array.from(document.querySelectorAll('*'));
      const mcRelated = allElements.filter(
        (el) =>
          el.textContent?.includes('MC') ||
          el.textContent?.includes('Medical Certificate') ||
          el.name?.toLowerCase().includes('mc') ||
          el.id?.toLowerCase().includes('mc')
      );

      return mcRelated.slice(0, 20).map((el) => ({
        tag: el.tagName,
        text: el.textContent?.trim().substring(0, 80),
        name: el.name,
        id: el.id,
        type: el.type,
      }));
    });

    logger.info('MC-related elements:');
    mcFields.forEach((field, idx) => {
      logger.info(`  ${idx + 1}. ${field.tag}: "${field.text}"`);
      if (field.name) logger.info(`     name: ${field.name}`);
      if (field.id) logger.info(`     id: ${field.id}`);
    });
    logger.info('');

    // Look for diagnosis dropdown options
    logger.info('🔍 Checking diagnosis dropdown...\n');
    const diagnosisInfo = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select'));
      const diagnosisSelect = selects.find(
        (s) => s.name?.toLowerCase().includes('diagnosis') || s.id?.toLowerCase().includes('diagnosis')
      );

      if (!diagnosisSelect) return { found: false };

      const options = Array.from(diagnosisSelect.options).map((opt) => ({
        value: opt.value,
        text: opt.textContent?.trim(),
      }));

      return {
        found: true,
        name: diagnosisSelect.name,
        id: diagnosisSelect.id,
        optionsCount: options.length,
        sampleOptions: options.slice(0, 10),
      };
    });

    if (diagnosisInfo.found) {
      logger.info('Diagnosis dropdown found:');
      logger.info(`  Name: ${diagnosisInfo.name}, ID: ${diagnosisInfo.id}`);
      logger.info(`  Total options: ${diagnosisInfo.optionsCount}`);
      logger.info('  Sample options:');
      diagnosisInfo.sampleOptions.forEach((opt, idx) => {
        logger.info(`    ${idx + 1}. ${opt.value}: ${opt.text}`);
      });
    } else {
      logger.info('❌ Diagnosis dropdown not found');
    }
    logger.info('');

    logger.info('✅ Investigation complete!');
    logger.info('📁 Check screenshots folder for visual reference');
    logger.info('🔍 Form is still open in browser - check VNC for manual inspection');
    logger.info('Press Ctrl+C when done');

    // Keep browser open
    await new Promise(() => {});
  } catch (error) {
    logger.error('Investigation failed:', error);
    throw error;
  }
}

investigateMHCForm().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
