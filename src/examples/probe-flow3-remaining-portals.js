import 'dotenv/config';
import fs from 'fs/promises';
import { BrowserManager } from '../utils/browser.js';
import { AllianzSubmitter } from '../core/allianz-submitter.js';
import { FullertonSubmitter } from '../core/fullerton-submitter.js';
import { IHPSubmitter } from '../core/ihp-submitter.js';
import { IXChangeSubmitter } from '../core/ixchange-submitter.js';
import { logger } from '../utils/logger.js';

function buildProbeVisits() {
  return [
    {
      target: 'IHP',
      visit: {
        id: 'probe-ihp',
        patient_name: 'PROBE IHP PATIENT',
        pay_type: 'IHP',
        visit_date: '2026-02-13',
        nric: 'S2569642E',
        diagnosis_description: 'Upper respiratory tract infection',
        total_amount: 35,
        extraction_metadata: { nric: 'S2569642E' },
      },
    },
    {
      target: 'FULLERTON',
      visit: {
        id: 'probe-fullerton',
        patient_name: 'PROBE FULLERTON PATIENT',
        pay_type: 'FULLERT',
        visit_date: '2026-02-13',
        nric: 'S9377992D',
        diagnosis_description: 'Back pain',
        total_amount: 45,
        extraction_metadata: { nric: 'S9377992D' },
      },
    },
    {
      target: 'ALLIANZ',
      visit: {
        id: 'probe-allianz',
        patient_name: 'PROBE ALLIANZ PATIENT',
        pay_type: 'ALLIANZ',
        visit_date: '2026-02-13',
        nric: 'S1234567A',
        diagnosis_description: 'Cough',
        total_amount: 30,
        extraction_metadata: { nric: 'S1234567A' },
      },
    },
    {
      target: 'IXCHANGE',
      visit: {
        id: 'probe-ixchange',
        patient_name: 'WANG YIXIN',
        pay_type: 'ALL',
        visit_date: '2026-02-16',
        nric: 'M4355390Q',
        diagnosis_description: 'Cervical disc disorder unspecified',
        total_amount: 25,
        extraction_metadata: { nric: 'M4355390Q' },
      },
    },
  ];
}

function getSubmitter(target, page) {
  switch (target) {
    case 'IHP':
      return new IHPSubmitter(page);
    case 'FULLERTON':
      return new FullertonSubmitter(page);
    case 'ALLIANZ':
      return new AllianzSubmitter(page);
    case 'IXCHANGE':
      return new IXChangeSubmitter(page);
    default:
      throw new Error(`Unknown target: ${target}`);
  }
}

async function main() {
  // Keep probe runs short; we only need flow evidence, not manual waiting.
  process.env.OTP_GMAIL_TIMEOUT_MS = process.env.OTP_GMAIL_TIMEOUT_MS || '5000';
  process.env.OTP_MANUAL_TIMEOUT_MS = process.env.OTP_MANUAL_TIMEOUT_MS || '5000';
  process.env.WORKFLOW_SAVE_DRAFT = '0';

  const browser = new BrowserManager();
  const results = [];

  try {
    await browser.init();
    const page = await browser.newPage();
    for (const item of buildProbeVisits()) {
      const submitter = getSubmitter(item.target, page);
      logger.info(`[PROBE] Running ${item.target} probe...`);
      const startedAt = Date.now();
      const result = await submitter.submit(item.visit, null);
      results.push({
        target: item.target,
        elapsedMs: Date.now() - startedAt,
        result,
      });
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const outPath = `output/playwright/flow3-remaining-portals-probe-${new Date()
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
