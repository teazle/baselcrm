import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { BrowserManager } from '../src/utils/browser.js';
import { ClaimSubmitter } from '../src/core/claim-submitter.js';
import { createSupabaseClient } from '../src/utils/supabase-client.js';

const visitId = process.argv[2];
if (!visitId) {
  console.error('Usage: node tmp/verify_alliance_portal_draft_after_submit.mjs <visit-id>');
  process.exit(2);
}

process.env.WORKFLOW_SAVE_DRAFT = '1';
process.env.ALLOW_LIVE_SUBMIT = process.env.ALLOW_LIVE_SUBMIT || '0';

const outputDir = path.resolve('output/playwright');
fs.mkdirSync(outputDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const supabase = createSupabaseClient();
const { data: visit, error } = await supabase.from('visits').select('*').eq('id', visitId).single();
if (error || !visit) {
  console.error(`Visit not found: ${visitId}`, error?.message || '');
  process.exit(1);
}

const browser = new BrowserManager();
const page = await browser.newPage();
const submitter = new ClaimSubmitter(page);

const screenshotPath = (name) =>
  path.join(outputDir, `alliance-draft-verify-${visit.visit_date}-${visit.nric}-${stamp}-${name}.png`);

const clickFirstVisible = async (selectors) => {
  for (const selector of selectors) {
    const el = page.locator(selector).first();
    const count = await el.count().catch(() => 0);
    if (!count) continue;
    const visible = await el.isVisible().catch(() => false);
    if (!visible) continue;
    await el.click({ timeout: 5000 }).catch(async () => {
      await el.click({ timeout: 5000, force: true });
    });
    return selector;
  }
  return null;
};

const fillFirstVisible = async (selectors, value) => {
  for (const selector of selectors) {
    const el = page.locator(selector).first();
    const count = await el.count().catch(() => 0);
    if (!count) continue;
    const visible = await el.isVisible().catch(() => false);
    if (!visible) continue;
    await el.fill(String(value), { timeout: 5000 }).catch(() => {});
    return selector;
  }
  return null;
};

try {
  const result = await submitter.submitClaim(visit);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: screenshotPath('after-submit'), fullPage: true }).catch(() => {});

  let portalFound = false;
  let rows = [];
  let searchEvidence = null;

  if (result?.success && String(result?.portal || '').toLowerCase() === 'alliance medinet') {
    await clickFirstVisible([
      'a:has-text("Search Panel Claims")',
      'button:has-text("Search Panel Claims")',
      'div.sidebar li:has-text("Search Panel Claims")',
      'text=Search Panel Claims',
    ]);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: screenshotPath('search-page'), fullPage: true }).catch(() => {});

    const visitDate = (() => {
      const raw = String(visit.visit_date || '').trim();
      const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return raw;
      return `${Number(m[3])}/${Number(m[2])}/${m[1]}`;
    })();

    const filledNricSelector = await fillFirstVisible(
      [
        'input[placeholder*="Member UIN" i]',
        'input[placeholder*="Membership ID" i]',
        'input[name*="member" i]',
        'input[id*="member" i]',
      ],
      visit.nric || ''
    );

    const filledDateFromSelector = await fillFirstVisible(
      [
        'input[placeholder*="Visit Date From" i]',
        'input[aria-label*="Visit Date From" i]',
        'input[name*="visitDateFrom" i]',
        'input[id*="visitDateFrom" i]',
        'input[name*="dateFrom" i]',
        'input[id*="dateFrom" i]',
      ],
      visitDate || ''
    );
    const filledDateToSelector = await fillFirstVisible(
      [
        'input[placeholder*="Visit Date To" i]',
        'input[aria-label*="Visit Date To" i]',
        'input[name*="visitDateTo" i]',
        'input[id*="visitDateTo" i]',
        'input[name*="dateTo" i]',
        'input[id*="dateTo" i]',
      ],
      visitDate || ''
    );

    const filledNameSelector = await fillFirstVisible(
      [
        'input[placeholder*="Member Name" i]',
        'input[name*="memberName" i]',
        'input[id*="memberName" i]',
      ],
      String(visit.patient_name || '')
    );

    if (!filledDateFromSelector || !filledDateToSelector) {
      await fillFirstVisible(
        [
          'input[placeholder*="Date" i]',
          'input[aria-label*="Date" i]',
          'input[name*="date" i]',
          'input[id*="date" i]',
        ],
        visitDate || ''
      );
    }

    const clickedSearchSelector = await clickFirstVisible([
      'button:has-text("Search")',
      'button:has-text("Search Others")',
      'button:has-text("Apply")',
    ]);
    await page.waitForTimeout(1200);
    const spinner = page.locator('.mat-progress-spinner, mat-spinner, .mdc-circular-progress');
    for (let i = 0; i < 20; i++) {
      const visible = await spinner.first().isVisible().catch(() => false);
      if (!visible) break;
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(800);
    await page.screenshot({ path: screenshotPath('search-result'), fullPage: true }).catch(() => {});

    const tableData = await page.evaluate(() => {
      const body = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
      const rowTexts = Array.from(
        document.querySelectorAll('table tbody tr, .mat-mdc-row, .mat-row, .mdc-data-table__row')
      )
        .map(row => (row.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      return { body, rowTexts };
    });
    rows = tableData.rowTexts.slice(0, 30);
    const nameProbe = String(visit.patient_name || '').split(/\s+/).slice(0, 3).join(' ').toLowerCase();
    const bodyLower = String(tableData.body || '').toLowerCase();
    const rowBlobLower = rows.join(' ').toLowerCase();
    portalFound =
      (visit.nric && rowBlobLower.includes(String(visit.nric).slice(0, 6).toLowerCase())) ||
      (nameProbe && (bodyLower.includes(nameProbe) || rowBlobLower.includes(nameProbe)));

    searchEvidence = {
      filledNricSelector,
      filledDateFromSelector,
      filledDateToSelector,
      filledNameSelector,
      clickedSearchSelector,
      portalFound,
    };
  }

  console.log(
    JSON.stringify(
      {
        visitId,
        result,
        portalDraftCheck: {
          attempted: result?.success && String(result?.portal || '').toLowerCase() === 'alliance medinet',
          found: portalFound,
          searchEvidence,
          rows,
        },
        screenshots: {
          afterSubmit: screenshotPath('after-submit'),
          searchPage: screenshotPath('search-page'),
          searchResult: screenshotPath('search-result'),
        },
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
}
