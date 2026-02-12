#!/usr/bin/env node

import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { logger } from '../utils/logger.js';

dotenv.config();

function toDdMmYyyy(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

async function main() {
  const args = process.argv.slice(2);
  const patientNumber = args[0] || '38052'; // YIP CHOI YEAN
  const visitDateIso = args[1] || '2026-02-05';
  const visitDateDmy = toDdMmYyyy(visitDateIso);

  logger.info('=== Debug Diagnosis Tab ===');
  logger.info(`Patient Number: ${patientNumber}`);
  logger.info(`Visit Date (ISO): ${visitDateIso}`);
  logger.info(`Visit Date (DMY): ${visitDateDmy || '-'}`);

  const browserManager = new BrowserManager();
  await browserManager.init();
  const page = await browserManager.newPage();

  try {
    const ca = new ClinicAssistAutomation(page);
    await ca.login();
    await ca.navigateToPatientPage();
    await ca.searchPatientByNumber(patientNumber);
    await ca.openPatientFromSearchResultsByNumber(patientNumber);
    await page.waitForTimeout(1000);

    await ca.navigateToTXHistory();
    await ca.openDiagnosisTab();

    const screenshotPath = `screenshots/debug-diagnosis-${patientNumber}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    logger.info(`Saved screenshot: ${screenshotPath}`);

    const summarize = async (label) => {
      const debug = await page.evaluate(({ targetIso, targetDmy }) => {
      const roots = [{ name: 'main', doc: document }];
      for (const iframe of Array.from(document.querySelectorAll('iframe'))) {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (doc) roots.push({ name: 'iframe', doc });
        } catch {
          // ignore
        }
      }

      const summarizeRoot = (doc) => {
        const bodyText = (doc.body?.innerText || '').replace(/\s+/g, ' ').trim();
        const tables = doc.querySelectorAll('table').length;
        const trs = doc.querySelectorAll('tr').length;
        const roleRows = doc.querySelectorAll('[role="row"]').length;
        const dateHits = [];
        const needles = [targetIso, targetDmy].filter(Boolean);

        if (needles.length) {
          const candidates = Array.from(doc.querySelectorAll('table tr, [role=\"row\"], tbody tr, div, span'))
            .slice(0, 2000);
          for (const n of candidates) {
            const t = (n.textContent || '').trim();
            if (!t) continue;
            if (needles.some((needle) => t.includes(needle))) {
              dateHits.push(t.slice(0, 200));
              if (dateHits.length >= 10) break;
            }
          }
        }

        return {
          tables,
          trs,
          roleRows,
          bodyTextSample: bodyText.slice(0, 400),
          dateHits,
        };
      };

      const frames = Array.from(window.frames || []).map((f) => {
        try {
          return f.location?.href || null;
        } catch {
          return null;
        }
      });

      return {
        url: window.location.href,
        frames,
        roots: roots.map((r) => ({ name: r.name, ...summarizeRoot(r.doc) })),
      };
      }, { targetIso: visitDateIso, targetDmy: visitDateDmy });
      return { label, debug };
    };

    const diagSummary = await summarize('Diagnosis');
    logger.info(`${diagSummary.label} tab DOM summary:`, diagSummary.debug);

    // All tab
    await ca.openAllTab();
    const allShot = `screenshots/debug-all-${patientNumber}.png`;
    await page.screenshot({ path: allShot, fullPage: true });
    logger.info(`Saved screenshot: ${allShot}`);
    const allSummary = await summarize('All');
    logger.info(`${allSummary.label} tab DOM summary:`, allSummary.debug);

    // Visit tab
    await ca.openVisitTab();
    const visitShot = `screenshots/debug-visit-${patientNumber}.png`;
    await page.screenshot({ path: visitShot, fullPage: true });
    logger.info(`Saved screenshot: ${visitShot}`);
    const visitSummary = await summarize('Visit');
    logger.info(`${visitSummary.label} tab DOM summary:`, visitSummary.debug);

    // Try clicking a Visit row that matches the visit date (and MHC when present)
    if (visitDateDmy) {
      const clickedVisitRow = await page.evaluate(({ targetDmy }) => {
        const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
        const rows = Array.from(document.querySelectorAll('table tr, tbody tr'));
        const matches = rows.filter((r) => norm(r.textContent).includes(targetDmy));
        if (!matches.length) return { ok: false, reason: 'no-date-match' };

        // Prefer rows that mention MHC (company code) if present.
        const mhc = matches.find((r) => /\\bMHC\\b/i.test(norm(r.textContent)));
        const row = mhc || matches[0];
        const link = row.querySelector('a');
        try {
          (link || row).scrollIntoView({ block: 'center' });
          (link || row).click();
          return { ok: true, picked: norm(row.textContent).slice(0, 200) };
        } catch (e) {
          return { ok: false, reason: e?.message || 'click-failed', picked: norm(row.textContent).slice(0, 200) };
        }
      }, { targetDmy: visitDateDmy }).catch(() => ({ ok: false, reason: 'eval-failed' }));

      logger.info('Visit row click attempt:', clickedVisitRow);
      await page.waitForTimeout(2000);
      const afterClickUrl = page.url();
      const visitOpenedShot = `screenshots/debug-visit-opened-${patientNumber}.png`;
      await page.screenshot({ path: visitOpenedShot, fullPage: true });
      logger.info(`Saved screenshot: ${visitOpenedShot}`);
      logger.info(`URL after visit row click: ${afterClickUrl}`);
    }

    logger.info('Keeping browser open for 30s for manual inspection...');
    await page.waitForTimeout(30000);
  } finally {
    await browserManager.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
