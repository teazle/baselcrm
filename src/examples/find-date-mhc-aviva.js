#!/usr/bin/env node

/**
 * Find a Clinic Assist Queue Report date that contains BOTH:
 * - MHC patients
 * - Aviva/Singlife patients
 *
 * Scans a date range (inclusive) and stops at the first match.
 *
 * Usage:
 *   node src/examples/find-date-mhc-aviva.js 2026-01-24 2026-02-08
 */

import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { logger } from '../utils/logger.js';
import { normalizePcno, normalizePatientNameForSearch } from '../utils/patient-normalize.js';

dotenv.config();

function parseArgDate(s) {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  // Use UTC midnight to avoid local timezone drift.
  return new Date(`${s}T00:00:00Z`);
}

function fmt(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d, n) {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function classify(items) {
  const norm = (v) => String(v || '').toUpperCase();
  const mhc = [];
  const aviva = [];

  for (const it of items || []) {
    const contract = norm(it.contract || it.payType || it.portal || '');
    const rawName = it.name || it.patientName || '';
    const name = normalizePatientNameForSearch(rawName) || rawName;
    const pcno = normalizePcno(it.pcno || it.patientNumber || '');
    if (!pcno) continue;

    if (contract.includes('MHC')) mhc.push({ pcno, name, contract });
    if (contract.includes('AVIVA') || contract.includes('SINGLIFE')) aviva.push({ pcno, name, contract });
  }

  return { mhc, aviva };
}

async function main() {
  const args = process.argv.slice(2);
  const start = parseArgDate(args[0]) || parseArgDate('2026-01-24');
  const end = parseArgDate(args[1]) || parseArgDate('2026-02-08');

  if (!start || !end) {
    console.error('Invalid date args. Use YYYY-MM-DD YYYY-MM-DD');
    process.exit(1);
  }

  console.log(`Scanning Clinic Assist Queue Report from ${fmt(start)} to ${fmt(end)} for MHC + Aviva/Singlife...`);

  const browserManager = new BrowserManager();
  await browserManager.init();
  const page = await browserManager.newPage();
  const ca = new ClinicAssistAutomation(page);

  await ca.login();

  // Reduce noise: suppress verbose step-by-step info logs during scanning.
  // Errors/warnings still show.
  logger.level = 'warn';

  let d = start;
  while (d.getTime() <= end.getTime()) {
    const dateStr = fmt(d);
    try {
      console.log(`\n[SCAN] ${dateStr}`);

      // Navigate to Queue Report fresh each iteration to avoid stale reportviewer state.
      await ca.navigateToPatientPage();
      await page.waitForTimeout(500);

      const nav = await ca.navigateToReports();
      if (!nav) throw new Error('navigateToReports failed');
      await page.waitForTimeout(1200);

      const opened = await ca.navigateToQueueListReport();
      if (!opened) {
        const directNav = await ca.navigateDirectlyToQueueReport();
        if (!directNav) throw new Error('navigateToQueueListReport and direct fallback failed');
      }

      await page.waitForTimeout(1200);
      await ca.searchQueueListByDate(dateStr);
      await page.waitForTimeout(1200);

      const items = await ca.extractQueueListResults();
      const { mhc, aviva } = classify(items);

      console.log(`[SCAN] ${dateStr} => items=${items.length} mhc=${mhc.length} aviva/singlife=${aviva.length}`);

      if (mhc.length > 0 && aviva.length > 0) {
        console.log(`\nFOUND date with both MHC + Aviva/Singlife: ${dateStr}`);
        console.log(`MHC sample: ${mhc.slice(0, 5).map((x) => `${x.pcno} ${x.name}`).join(' | ')}`);
        console.log(`Aviva/Singlife sample: ${aviva.slice(0, 5).map((x) => `${x.pcno} ${x.name}`).join(' | ')}`);

        console.log('\n>>> Browser left open for review <<<');
        console.log('>>> Press Ctrl+C to close <<<\n');
        await new Promise(() => {});
      }
    } catch (e) {
      console.log(`[SCAN] ${dateStr} failed: ${e.message}`);
      await page.screenshot({ path: `screenshots/scan-error-${dateStr}.png`, fullPage: true }).catch(() => {});
    }

    d = addDays(d, 1);
  }

  console.log('\nNo date found in the scanned range.');
  await browserManager.close().catch(() => {});
}

main().catch((err) => {
  logger.error('Unhandled error:', err);
  process.exit(1);
});
