#!/usr/bin/env node

/**
 * Targeted regression test:
 * - Login to MHC Asia
 * - Search NRIC (LI MEIQIN): S8176620G
 * - Switch to AIA Clinic if prompted
 * - Navigate to Employee Visit form
 * - Try to fill MC Day dropdown/input
 *
 * This script does NOT submit anything.
 */

import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { MHCAsiaAutomation } from '../automations/mhc-asia.js';
import { logger } from '../utils/logger.js';

dotenv.config();

async function run() {
  const browserManager = new BrowserManager();
  let page = null;

  const nric = 'S8176620G';
  const visitDate = '23/01/2026';
  const mcDays = 1;

  try {
    logger.info('=== Test: MHC MC Day (LI MEIQIN) ===');
    await browserManager.init();
    page = await browserManager.newPage();

    const mhc = new MHCAsiaAutomation(page);
    mhc.setupDialogHandler();

    await mhc.login();
    await mhc.navigateToNormalVisit();

    const searchResult = await mhc.searchPatientByNRIC(nric);
    if (!searchResult?.found) throw new Error('Patient not found in MHC search');

    await mhc.openPatientFromSearchResults(nric);
    await mhc.addVisit(searchResult.portal, nric);

    await mhc.fillVisitDate(visitDate);

    const ok = await mhc.fillMcDays(mcDays);
    logger.info(`fillMcDays(${mcDays}) => ${ok}`);

    await page.screenshot({ path: 'screenshots/test-mhc-mcday-li-meiqin.png', fullPage: true });
    logger.info('Screenshot saved: screenshots/test-mhc-mcday-li-meiqin.png');
  } finally {
    try {
      if (page) await page.close();
    } catch {
      // ignore
    }
    await browserManager.close().catch(() => {});
  }
}

run().catch((err) => {
  logger.error('Test failed:', err);
  process.exit(1);
});

