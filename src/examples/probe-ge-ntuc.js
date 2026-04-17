import 'dotenv/config';
import fs from 'fs/promises';
import { BrowserManager } from '../utils/browser.js';
import { AllianceMedinetAutomation } from '../automations/alliance-medinet.js';
import { GENtucSubmitter } from '../core/ge-submitter.js';
import { logger } from '../utils/logger.js';

// Probe GE / NTUC IM end-to-end. The flow goes:
//   1) Login to Alliance Medinet (the shared Alliance shell)
//   2) Search the member by NRIC
//   3) selectMemberAndAdd triggers a popup to GE/NTUC IM portal for matching members
//   4) GENtucSubmitter takes the popup and fills the claim form
//
// fill_evidence mode is implied because we never call save/submit; we let the
// submitter run until form fill, then capture the screenshot for inspection.
process.env.WORKFLOW_SAVE_DRAFT = '0';
process.env.OTP_GMAIL_TIMEOUT_MS = process.env.OTP_GMAIL_TIMEOUT_MS || '10000';
process.env.OTP_MANUAL_TIMEOUT_MS = process.env.OTP_MANUAL_TIMEOUT_MS || '10000';

function buildVisits() {
  return [
    {
      id: 'probe-ge-cheam',
      patient_name: 'CHEAM XI-QING JACQUELINE',
      pay_type: 'ALLIANC',
      visit_date: '2026-02-14',
      nric: 'T1204303H',
      diagnosis_description: 'Cough',
      total_amount: 35,
      extraction_metadata: {
        nric: 'T1204303H',
        flow3PortalHint: 'GE_NTUC',
      },
    },
    {
      id: 'probe-ge-huang',
      patient_name: 'HUANG MINGRONG, JOHN',
      pay_type: 'GE',
      visit_date: '2026-01-23',
      nric: 'S8132732G',
      diagnosis_description: 'Cough',
      total_amount: 35,
      extraction_metadata: {
        nric: 'S8132732G',
        flow3PortalHint: 'GE_NTUC',
      },
    },
  ];
}

async function main() {
  const browser = new BrowserManager();
  const results = [];

  try {
    await browser.init();
    const page = await browser.newPage();

    const allianceAutomation = new AllianceMedinetAutomation(page);
    const submitter = new GENtucSubmitter(allianceAutomation);

    for (const visit of buildVisits()) {
      logger.info(`[PROBE-GE] Submitting ${visit.patient_name}...`);
      const startedAt = Date.now();
      let result = null;
      let error = null;
      try {
        result = await submitter.submit(visit, null);
      } catch (err) {
        error = { message: err?.message || String(err), stack: err?.stack || null };
      }
      results.push({
        visitId: visit.id,
        nric: visit.nric,
        elapsedMs: Date.now() - startedAt,
        result,
        error,
      });
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const outPath = `output/playwright/probe-ge-ntuc-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}.json`;
  await fs.mkdir('output/playwright', { recursive: true });
  await fs.writeFile(
    outPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`
  );
  console.log(outPath);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
