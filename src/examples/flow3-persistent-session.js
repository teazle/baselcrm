import 'dotenv/config';
import fs from 'fs/promises';
import readline from 'node:readline';
import { BrowserManager } from '../utils/browser.js';
import { FullertonSubmitter } from '../core/fullerton-submitter.js';
import { IXChangeSubmitter } from '../core/ixchange-submitter.js';

process.env.HEADLESS = 'false';
process.env.WORKFLOW_SAVE_DRAFT = '0';
process.env.OTP_GMAIL_TIMEOUT_MS = process.env.OTP_GMAIL_TIMEOUT_MS || '120000';
process.env.OTP_MANUAL_TIMEOUT_MS = '900000';
process.env.PLAYWRIGHT_USER_DATA_DIR =
  process.env.PLAYWRIGHT_USER_DATA_DIR || `${process.cwd()}/.playwright-browser-data-flow3`;

const VISITS = {
  FULLERTON: {
    id: 'persistent-fullerton',
    patient_name: 'PERSISTENT FULLERTON',
    pay_type: 'FULLERT',
    visit_date: '2026-02-13',
    nric: 'S9377992D',
    diagnosis_description: 'Back pain',
    total_amount: 45,
    extraction_metadata: { nric: 'S9377992D' },
  },
  IXCHANGE: {
    id: 'persistent-ixchange',
    patient_name: 'WANG YIXIN',
    pay_type: 'ALL',
    visit_date: '2026-02-16',
    nric: 'M4355390Q',
    diagnosis_description: 'Cervical disc disorder unspecified',
    total_amount: 25,
    extraction_metadata: { nric: 'M4355390Q' },
  },
};

const MAIN_URLS = {
  FULLERTON: 'https://doctor.fhn3.com/app_index',
  IXCHANGE: 'https://spos.o2ixchange.com/login',
};
const IXCHANGE_SEARCH_URL = 'https://spos.o2ixchange.com/spos/search-patient';
const IXCHANGE_PROGRAM_TYPES = ['Corporate', 'Shield', 'Individual', 'AIA'];

function nowSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function writeResult(result) {
  await fs.mkdir('output/playwright', { recursive: true });
  const outPath = `output/playwright/persistent-session-${nowSlug()}.json`;
  await fs.writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
  return outPath;
}

async function safeGoto(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1200);
    return true;
  } catch {
    return false;
  }
}

async function ixchangeEnsureSearchPage(page) {
  const current = String(page.url() || '');
  if (!/\/spos\/search-patient/i.test(current)) {
    await safeGoto(page, IXCHANGE_SEARCH_URL);
  }
  await page.waitForTimeout(600);
}

async function ixchangeReadProgramType(page) {
  return page
    .evaluate(() => {
      const norm = v =>
        String(v || '')
          .replace(/\s+/g, ' ')
          .trim();
      const all = Array.from(globalThis.document?.querySelectorAll?.('*') || []);
      const label = all.find(node => /program type/i.test(norm(node.textContent)));
      if (!label) return '';
      const scope = label.closest('div')?.parentElement || label.parentElement || label;
      const valueNode =
        scope.querySelector('[class*="singleValue"]') ||
        scope.querySelector('[class*="valueContainer"]') ||
        scope.querySelector('[role="combobox"]');
      return norm(valueNode?.textContent || '');
    })
    .catch(() => '');
}

async function ixchangeSetProgramType(page, value) {
  const target = String(value || '').trim();
  if (!target) return { ok: false, reason: 'empty' };

  const controlSelectors = [
    'xpath=//*[contains(normalize-space(.), "Program Type")]/following::*[@role="combobox"][1]',
    'xpath=//*[contains(normalize-space(.), "Program Type")]/following::*[contains(@class, "control")][1]',
    'xpath=//*[contains(normalize-space(.), "Program Type")]/following::input[contains(@id, "react-select")][1]',
    'input[id*="react-select"][id*="-input"]',
  ];

  for (const selector of controlSelectors) {
    const found = await page
      .locator(selector)
      .first()
      .count()
      .catch(() => 0);
    if (!found) continue;
    await page
      .locator(selector)
      .first()
      .click({ force: true, timeout: 1200 })
      .catch(() => {});
    break;
  }

  // Clear current value when clear-icon exists.
  const clearSel = page.locator('[aria-label*="Clear value" i]').first();
  if ((await clearSel.count().catch(() => 0)) > 0) {
    await clearSel.click({ force: true, timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(150);
  }

  const input = page.locator('input[id*="react-select"][id*="-input"]').first();
  if ((await input.count().catch(() => 0)) > 0) {
    await input.click({ force: true, timeout: 1200 }).catch(() => {});
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.type(target, { delay: 20 }).catch(() => {});
    await page.keyboard.press('Enter').catch(() => {});
  } else {
    // Fallback when the react input is hidden from locator queries.
    await page.keyboard.type(target, { delay: 20 }).catch(() => {});
    await page.keyboard.press('Enter').catch(() => {});
  }

  await page.waitForTimeout(450);
  const current = await ixchangeReadProgramType(page);
  return { ok: current.toLowerCase().includes(target.toLowerCase()), current };
}

async function ixchangeSearch(page, identifier) {
  const id = String(identifier || '').trim();
  if (!id) return { ok: false, reason: 'empty_identifier' };

  await ixchangeEnsureSearchPage(page);

  const input = page.locator('input#patientId').first();
  if ((await input.count().catch(() => 0)) === 0) {
    return { ok: false, reason: 'patient_id_input_missing' };
  }
  await input.click({ force: true }).catch(() => {});
  await input.fill(id).catch(() => {});

  const retrieveBtn = page
    .locator('button:has-text("Retrieve"), button#filter-apply-button')
    .first();
  if ((await retrieveBtn.count().catch(() => 0)) > 0) {
    await retrieveBtn.click({ force: true }).catch(() => {});
  } else {
    await page.keyboard.press('Enter').catch(() => {});
  }
  await page.waitForTimeout(1800);

  const result = await page
    .evaluate(() => {
      const norm = v =>
        String(v || '')
          .replace(/\s+/g, ' ')
          .trim();
      const body = norm(globalThis.document?.body?.innerText || '').toLowerCase();
      const noResult =
        body.includes('no patient records found') ||
        body.includes('please collect cash') ||
        body.includes('no record') ||
        body.includes('not found');
      const rows = Array.from(globalThis.document?.querySelectorAll?.('table tbody tr') || []).map(
        row => norm(row.textContent || '')
      );
      return {
        noResult,
        rows: rows.filter(Boolean).slice(0, 10),
      };
    })
    .catch(() => ({ noResult: false, rows: [] }));

  return { ok: true, ...result };
}

async function main() {
  const browser = new BrowserManager();
  await browser.init();

  const fullertonPage = await browser.newPage();
  const ixchangePage = await browser.newPage();
  const fullerton = new FullertonSubmitter(fullertonPage);
  const ixchange = new IXChangeSubmitter(ixchangePage);

  let busy = false;

  async function runOne(target) {
    const startedAt = Date.now();
    const submitter = target === 'FULLERTON' ? fullerton : ixchange;
    const result = await submitter.submit(VISITS[target], null);
    const payload = {
      generatedAt: new Date().toISOString(),
      target,
      elapsedMs: Date.now() - startedAt,
      result,
    };
    const outPath = await writeResult(payload);
    console.log(`[RESULT] ${target} -> ${outPath}`);
    return payload;
  }

  async function runAll() {
    const startedAt = Date.now();
    const fullertonResult = await runOne('FULLERTON');
    const ixchangeResult = await runOne('IXCHANGE');
    const payload = {
      generatedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      results: [fullertonResult, ixchangeResult],
    };
    const outPath = await writeResult(payload);
    console.log(`[RESULT] ALL -> ${outPath}`);
  }

  async function resetOne(target) {
    const page = target === 'FULLERTON' ? fullertonPage : ixchangePage;
    const ok = await safeGoto(page, MAIN_URLS[target]);
    console.log(`[RESET] ${target} -> ${ok ? 'ok' : 'failed'} (${MAIN_URLS[target]})`);
  }

  async function showStatus() {
    const fullertonUrl = fullertonPage.url();
    const ixchangeUrl = ixchangePage.url();
    console.log(`[STATUS] FULLERTON: ${fullertonUrl || '(blank)'}`);
    console.log(`[STATUS] IXCHANGE: ${ixchangeUrl || '(blank)'}`);
  }

  async function probeIxchange(rawIdentifier = '') {
    const identifier = String(rawIdentifier || VISITS.IXCHANGE.nric || '').trim();
    if (!identifier) {
      console.log('[PROBE IXCHANGE] Missing identifier');
      return;
    }
    const attempts = [];
    await ixchangeEnsureSearchPage(ixchangePage);
    const initialProgram = await ixchangeReadProgramType(ixchangePage);
    const orderedPrograms = [
      ...new Set([initialProgram, ...IXCHANGE_PROGRAM_TYPES].filter(Boolean)),
    ];

    for (const program of orderedPrograms) {
      const setRes = await ixchangeSetProgramType(ixchangePage, program);
      const searchRes = await ixchangeSearch(ixchangePage, identifier);
      const shot = `screenshots/ixchange-probe-${nowSlug()}-${program.replace(/[^a-z0-9]+/gi, '_')}.png`;
      await ixchangePage.screenshot({ path: shot, fullPage: true }).catch(() => {});
      attempts.push({
        program,
        setResult: setRes,
        search: searchRes,
        screenshot: shot,
      });
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      probe: 'ixchange-search',
      identifier,
      initialProgram,
      attempts,
    };
    const outPath = await writeResult(payload);
    console.log(`[PROBE IXCHANGE] -> ${outPath}`);
  }

  async function handleCommand(raw) {
    const originalLine = String(raw || '').trim();
    const line = originalLine.toLowerCase();
    if (!line) return;
    if (busy) {
      console.log('[BUSY] wait for current command to complete');
      return;
    }
    busy = true;
    try {
      if (line === 'run all') await runAll();
      else if (line === 'run fullerton') await runOne('FULLERTON');
      else if (line === 'run ixchange') await runOne('IXCHANGE');
      else if (line === 'reset all') {
        await resetOne('FULLERTON');
        await resetOne('IXCHANGE');
      } else if (line === 'reset fullerton') await resetOne('FULLERTON');
      else if (line === 'reset ixchange') await resetOne('IXCHANGE');
      else if (line.startsWith('probe ixchange')) {
        const parts = originalLine.split(/\s+/);
        const identifier = parts.length >= 3 ? parts.slice(2).join(' ') : VISITS.IXCHANGE.nric;
        await probeIxchange(identifier);
      } else if (line === 'status') await showStatus();
      else if (line === 'help') {
        console.log(
          'Commands: run all | run fullerton | run ixchange | probe ixchange [identifier] | reset all | reset fullerton | reset ixchange | status | exit'
        );
      } else if (line === 'exit') {
        await browser.close().catch(() => {});
        console.log('Session closed');
        process.exit(0);
      } else {
        console.log('Unknown command. Type: help');
      }
    } catch (error) {
      console.error(`[ERROR] ${error?.message || String(error)}`);
    } finally {
      busy = false;
    }
  }

  await safeGoto(fullertonPage, 'https://doctor.fhn3.com/app_index');
  await safeGoto(ixchangePage, 'https://spos.o2ixchange.com/login');

  console.log('Persistent session ready.');
  console.log(
    'Commands: run all | run fullerton | run ixchange | probe ixchange [identifier] | reset all | reset fullerton | reset ixchange | status | exit'
  );

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('line', line => {
    handleCommand(line);
  });
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
