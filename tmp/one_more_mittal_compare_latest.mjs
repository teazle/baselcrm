import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { BrowserManager } from '../src/utils/browser.js';
import { MHCAsiaAutomation } from '../src/automations/mhc-asia.js';

dotenv.config();

const TARGET = {
  visitId: '31b5a688-9104-4507-bd7a-347a9f9ce866',
  patientName: 'MITTAL SACHIN KUMAR',
  nric: 'M4539893L',
  visitDate: '02/02/2026',
  submittedRef: 'EV16085124',
};

const outDir = '/Users/vincent/Baselrpacrm/screenshots/one-more-mittal/latest';
const draftSnapshotPath = '/Users/vincent/Baselrpacrm/tmp/one_more_mittal_draft_snapshot_latest.json';
const submittedSnapshotPath = '/Users/vincent/Baselrpacrm/tmp/one_more_mittal_submitted_snapshot_latest.json';
const diffPath = '/Users/vincent/Baselrpacrm/tmp/one_more_mittal_field_diff_latest.json';
const reportPath = '/Users/vincent/Baselrpacrm/tmp/one_more_mittal_reconciliation_latest.md';

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(s) {
  return clean(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function clickFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    if ((await loc.count().catch(() => 0)) === 0) continue;
    const visible = await loc.isVisible().catch(() => true);
    if (!visible) continue;
    await loc.click({ timeout: 10000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(800);
    return true;
  }
  return false;
}

async function openList(page, type) {
  if (type === 'submitted') {
    const ok = await clickFirstVisible(page, [
      'a:has-text("View Submitted Visits")',
      'button:has-text("View Submitted Visits")',
      'text=/View\\s+Submitted\\s+Visits/i',
      'a[href*="EmpVisitList"]',
    ]);
    if (!ok) throw new Error('Could not open View Submitted Visits');
    return;
  }

  if (type === 'draft') {
    const ok = await clickFirstVisible(page, [
      'a:has-text("Edit/Draft Visits")',
      'button:has-text("Edit/Draft Visits")',
      'text=/Edit\\s*\\/\\s*Draft\\s+Visits/i',
      'a[href*="DraftList"]',
    ]);
    if (!ok) throw new Error('Could not open Edit/Draft Visits');
    return;
  }

  throw new Error(`Unknown list type: ${type}`);
}

async function searchList(page, { keyPattern, value }) {
  await page.evaluate(
    ({ keyPattern, value }) => {
      const pickOption = (sel, matcher) => {
        if (!sel) return false;
        const opts = Array.from(sel.options || []);
        const hit = opts.find(matcher);
        if (!hit) return false;
        sel.value = hit.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      };

      const keySel = document.querySelector('select[name="key"]');
      pickOption(
        keySel,
        (opt) => new RegExp(keyPattern, 'i').test(String(opt.textContent || '')) || new RegExp(keyPattern, 'i').test(String(opt.value || ''))
      );

      const typeSel = document.querySelector('select[name="keyType"]');
      pickOption(typeSel, (opt) => /equals/i.test(String(opt.textContent || '')) || String(opt.value || '') === 'E');

      const input = document.querySelector('input[name="keyValue"]');
      if (input) {
        input.value = String(value || '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    },
    { keyPattern, value }
  );

  const searchBtn = page.locator('input[name="SearchAction"], button:has-text("Search")').first();
  if ((await searchBtn.count().catch(() => 0)) > 0) {
    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(() => {}),
      searchBtn.click({ timeout: 10000 }).catch(() => {}),
    ]);
  } else {
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
  }
  await page.waitForTimeout(900);
}

async function findDraftRefByNricAndDate(page, nric, visitDate) {
  return page.evaluate(
    ({ nric, visitDate }) => {
      const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const rows = [];
      for (const tr of Array.from(document.querySelectorAll('table tr'))) {
        const cells = Array.from(tr.querySelectorAll('th,td')).map((td) => clean(td.textContent));
        if (cells.length < 5) continue;
        if (!/^\d{2}\/\d{2}\/\d{4}$/.test(cells[0])) continue;
        if (!/^EV/i.test(cells[1] || '')) continue;
        if (!/^[A-Z]\d{7}[A-Z]$/i.test(cells[3] || '')) continue;
        const links = Array.from(tr.querySelectorAll('a')).map((a) => ({ text: clean(a.textContent), href: a.getAttribute('href') || '' }));
        rows.push({
          visitDate: cells[0] || '',
          reference: cells[1] || '',
          nric: (cells[3] || '').toUpperCase(),
          patientName: cells[4] || '',
          links,
        });
      }

      const normNric = String(nric || '').toUpperCase().trim();
      const normDate = String(visitDate || '').trim();
      const exact = rows.find((r) => r.nric === normNric && r.visitDate === normDate);
      const fallback = rows.find((r) => r.nric === normNric);
      return {
        selected: exact || fallback || null,
        rows,
      };
    },
    { nric, visitDate }
  );
}

async function openVisitFromList(page, reference) {
  const exact = page.locator('a', { hasText: reference }).first();
  if ((await exact.count().catch(() => 0)) > 0) {
    await exact.click({ timeout: 10000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1000);
    return true;
  }

  const fuzzy = page.locator(`a[href*="${reference}"]`).first();
  if ((await fuzzy.count().catch(() => 0)) > 0) {
    await fuzzy.click({ timeout: 10000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1000);
    return true;
  }

  return false;
}

async function extractSnapshot(page) {
  const frameResults = [];
  const frames = page.frames();

  for (const frame of frames) {
    const data = await frame
      .evaluate(() => {
        const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

        const fields = Array.from(document.querySelectorAll('input,select,textarea'))
          .map((el) => {
            const tag = el.tagName.toLowerCase();
            const type = (el.getAttribute('type') || '').toLowerCase();
            const name = el.getAttribute('name') || '';
            const id = el.id || '';

            let value = '';
            if (tag === 'select') {
              const opt = el.options?.[el.selectedIndex];
              value = opt ? `${opt.value}|${clean(opt.textContent)}` : '';
            } else if (type === 'checkbox' || type === 'radio') {
              value = el.checked ? (el.value || 'checked') : '';
            } else {
              value = el.value || '';
            }

            let label = '';
            if (id) {
              const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
              if (l) label = clean(l.textContent);
            }
            if (!label) {
              const tr = el.closest('tr');
              if (tr) {
                const cells = Array.from(tr.querySelectorAll('td,th'));
                if (cells.length > 1) {
                  const candidate = clean(cells[0].textContent);
                  const current = el.closest('td,th');
                  if (candidate && current !== cells[0]) label = candidate;
                }
              }
            }
            if (!label) label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';

            const key = name || id || label;
            return {
              key: clean(key),
              label: clean(label),
              name: clean(name),
              id: clean(id),
              tag,
              type,
              value: clean(value),
            };
          })
          .filter((f) => f.key || f.value)
          .filter((f) => !(f.type === 'hidden' && !f.value));

        return {
          url: location.href,
          title: document.title,
          fields: fields.slice(0, 700),
        };
      })
      .catch(() => null);

    if (data) {
      frameResults.push({ frameUrl: frame.url(), ...data });
    }
  }

  const main = frameResults.find((f) => f.frameUrl === page.url()) || frameResults[0] || null;
  return {
    pageUrl: page.url(),
    title: await page.title().catch(() => ''),
    frameCount: frames.length,
    main,
    allFrames: frameResults,
  };
}

function snapshotToMap(snapshot) {
  const fields = snapshot?.main?.fields || [];
  const map = {};

  for (const f of fields) {
    const key = normalizeKey(f.name || f.id || f.label || f.key);
    if (!key) continue;
    const value = clean(f.value);
    if (!(key in map)) {
      map[key] = value;
      continue;
    }
    if (!map[key] && value) {
      map[key] = value;
      continue;
    }
    if (map[key] !== value && value && !map[key].includes(value)) {
      map[key] = `${map[key]} | ${value}`;
    }
  }

  return map;
}

function compareMaps(submittedMap, draftMap) {
  const allKeys = Array.from(new Set([...Object.keys(submittedMap), ...Object.keys(draftMap)])).sort();
  const diffs = [];

  for (const key of allKeys) {
    const submitted = clean(submittedMap[key] || '');
    const draft = clean(draftMap[key] || '');

    let category = 'match';
    if (submitted && !draft) category = 'missing_in_draft';
    else if (!submitted && draft) category = 'missing_in_submitted';
    else if (submitted !== draft) category = 'mismatch';

    diffs.push({ key, submitted, draft, category });
  }

  const summary = {
    totalKeys: diffs.length,
    match: diffs.filter((d) => d.category === 'match').length,
    mismatch: diffs.filter((d) => d.category === 'mismatch').length,
    missing_in_draft: diffs.filter((d) => d.category === 'missing_in_draft').length,
    missing_in_submitted: diffs.filter((d) => d.category === 'missing_in_submitted').length,
  };

  return { diffs, summary };
}

function pickHighSignal(diffs) {
  const keys = [
    'visitdateasstring',
    'consultfee',
    'diagnosispridesc',
    'diagnosispriid',
    'diagnosispriidtemp',
    'waiverofreferral',
    'drug_drugname',
    'drug_quantity',
    'drug_unitprice',
    'drug_amount',
    'totalfee',
    'totalclaim',
    'mcday',
  ];

  const byKey = new Map(diffs.map((d) => [d.key, d]));
  return keys.map((k) => byKey.get(k)).filter(Boolean);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const browser = new BrowserManager();
  await browser.init();
  const page = await browser.newPage();
  const mhc = new MHCAsiaAutomation(page);

  const context = {
    generatedAt: new Date().toISOString(),
    target: TARGET,
    draftRef: null,
    submittedRef: TARGET.submittedRef,
    draftOpened: false,
    submittedOpened: false,
    draftDateMatched: false,
  };

  let draftSnapshot = null;
  let submittedSnapshot = null;

  try {
    await mhc.login();

    // Capture draft side
    await mhc.ensureAtMhcHome();
    await openList(page, 'draft');
    await searchList(page, { keyPattern: 'nric', value: TARGET.nric });

    const draftList = await findDraftRefByNricAndDate(page, TARGET.nric, TARGET.visitDate);
    context.draftRef = draftList?.selected?.reference || null;
    context.draftDateMatched = draftList?.selected?.visitDate === TARGET.visitDate;

    if (context.draftRef) {
      context.draftOpened = await openVisitFromList(page, context.draftRef);
      if (context.draftOpened) {
        draftSnapshot = await extractSnapshot(page);
      }
    }

    const draftShot = path.join(outDir, 'draft.png');
    await page.screenshot({ path: draftShot, fullPage: true }).catch(() => {});
    context.draftScreenshot = draftShot;

    // Capture submitted side
    await mhc.ensureAtMhcHome();
    await openList(page, 'submitted');
    await searchList(page, { keyPattern: 'visit\\s*no', value: TARGET.submittedRef });

    context.submittedOpened = await openVisitFromList(page, TARGET.submittedRef);
    if (context.submittedOpened) {
      submittedSnapshot = await extractSnapshot(page);
    }

    const submittedShot = path.join(outDir, 'submitted.png');
    await page.screenshot({ path: submittedShot, fullPage: true }).catch(() => {});
    context.submittedScreenshot = submittedShot;
  } finally {
    await browser.close().catch(() => {});
  }

  fs.writeFileSync(draftSnapshotPath, JSON.stringify({ ...context, snapshot: draftSnapshot }, null, 2));
  fs.writeFileSync(submittedSnapshotPath, JSON.stringify({ ...context, snapshot: submittedSnapshot }, null, 2));

  const submittedMap = snapshotToMap(submittedSnapshot);
  const draftMap = snapshotToMap(draftSnapshot);
  const { diffs, summary } = compareMaps(submittedMap, draftMap);
  const highSignal = pickHighSignal(diffs);

  const criticalMismatches = highSignal.filter((d) => d.category !== 'match');

  const verdictPass =
    context.draftOpened &&
    context.submittedOpened &&
    context.draftDateMatched &&
    criticalMismatches.length === 0;

  const diffPayload = {
    generatedAt: new Date().toISOString(),
    target: TARGET,
    context,
    summary,
    highSignal,
    criticalMismatches,
    verdict: verdictPass ? 'PASS' : 'FAIL',
    diffs,
  };

  fs.writeFileSync(diffPath, JSON.stringify(diffPayload, null, 2));

  const lines = [];
  lines.push('# One-More MITTAL Reconciliation (Latest)');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Scope');
  lines.push(`- Visit ID: ${TARGET.visitId}`);
  lines.push(`- Patient: ${TARGET.patientName}`);
  lines.push(`- NRIC: ${TARGET.nric}`);
  lines.push(`- CRM Visit Date: ${TARGET.visitDate}`);
  lines.push(`- Submitted Ref: ${TARGET.submittedRef}`);
  lines.push(`- Draft Ref: ${context.draftRef || '(not found)'}`);
  lines.push('');
  lines.push('## Checks');
  lines.push(`- Draft opened: ${context.draftOpened ? 'yes' : 'no'}`);
  lines.push(`- Submitted opened: ${context.submittedOpened ? 'yes' : 'no'}`);
  lines.push(`- Draft date matched (${TARGET.visitDate}): ${context.draftDateMatched ? 'yes' : 'no'}`);
  lines.push(`- Critical mismatches: ${criticalMismatches.length}`);
  lines.push(`- Verdict: **${verdictPass ? 'PASS' : 'FAIL'}**`);
  lines.push('');
  lines.push('## Summary');
  lines.push(`- Total keys: ${summary.totalKeys}`);
  lines.push(`- Match: ${summary.match}`);
  lines.push(`- Mismatch: ${summary.mismatch}`);
  lines.push(`- Missing in draft: ${summary.missing_in_draft}`);
  lines.push(`- Missing in submitted: ${summary.missing_in_submitted}`);
  lines.push('');
  lines.push('## High-Signal Fields');
  lines.push('|Key|Submitted|Draft|Category|');
  lines.push('|---|---|---|---|');
  for (const d of highSignal) {
    lines.push(`|${d.key}|${String(d.submitted || '').replace(/\|/g, '/')}|${String(d.draft || '').replace(/\|/g, '/')}|${d.category}|`);
  }
  lines.push('');
  if (criticalMismatches.length) {
    lines.push('## Critical Mismatches');
    lines.push('|Key|Submitted|Draft|Category|');
    lines.push('|---|---|---|---|');
    for (const d of criticalMismatches) {
      lines.push(`|${d.key}|${String(d.submitted || '').replace(/\|/g, '/')}|${String(d.draft || '').replace(/\|/g, '/')}|${d.category}|`);
    }
    lines.push('');
  }
  lines.push('## Artifacts');
  lines.push(`- Draft snapshot JSON: ${draftSnapshotPath}`);
  lines.push(`- Submitted snapshot JSON: ${submittedSnapshotPath}`);
  lines.push(`- Field diff JSON: ${diffPath}`);
  lines.push(`- Draft screenshot: ${context.draftScreenshot || ''}`);
  lines.push(`- Submitted screenshot: ${context.submittedScreenshot || ''}`);

  fs.writeFileSync(reportPath, `${lines.join('\n')}\n`);

  console.log(`Wrote ${draftSnapshotPath}`);
  console.log(`Wrote ${submittedSnapshotPath}`);
  console.log(`Wrote ${diffPath}`);
  console.log(`Wrote ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
