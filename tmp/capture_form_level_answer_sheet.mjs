import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { BrowserManager } from '../src/utils/browser.js';
import { MHCAsiaAutomation } from '../src/automations/mhc-asia.js';

dotenv.config();

const submittedTruthCsv = '/Users/vincent/Baselrpacrm/tmp/view_submitted_claim_truth_2026-02-02_2026-02-07.csv';
const draftTruthCsv = '/Users/vincent/Baselrpacrm/tmp/edit_draft_truth_2026-02-02_2026-02-07.csv';
const outJson = '/Users/vincent/Baselrpacrm/tmp/form_level_answer_sheet_snapshots_2026-02-02_2026-02-07.json';
const outMd = '/Users/vincent/Baselrpacrm/tmp/form_level_answer_sheet_summary_2026-02-02_2026-02-07.md';
const outDir = '/Users/vincent/Baselrpacrm/screenshots/form-level-check-2026-02-02_2026-02-07';

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  const parseLine = (line) => {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          q = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        q = true;
      } else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  };

  const headers = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = parseLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = vals[i] ?? '';
    });
    return row;
  });
}

function portalContextFromPayType(payType) {
  const t = String(payType || '').toUpperCase();
  if (t.includes('AVIVA') || t.includes('SINGLIFE')) return 'singlife';
  if (t.includes('AIA') || t.includes('AIACLIENT')) return 'aia';
  return 'mhc';
}

function byContextThenRef(a, b) {
  if (a.context < b.context) return -1;
  if (a.context > b.context) return 1;
  return String(a.reference || '').localeCompare(String(b.reference || ''));
}

async function clickFirstVisible(page, selectors) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count().catch(() => 0)) > 0) {
      const visible = await loc.isVisible().catch(() => true);
      if (!visible) continue;
      await loc.click({ timeout: 10000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(900);
      return true;
    }
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
      'text=/Edit\\s*\/\\s*Draft\\s+Visits/i',
      'a[href*="DraftList"]',
    ]);
    if (!ok) throw new Error('Could not open Edit/Draft Visits');
    return;
  }

  throw new Error(`Unknown list type: ${type}`);
}

async function enterContext(page, mhc, context) {
  if (context === 'mhc') {
    await mhc.ensureAtMhcHome();
    return;
  }
  if (context === 'singlife') {
    await mhc.ensureAtMhcHome();
    const switched = await mhc.switchToSinglifeIfNeeded({ force: true }).catch(() => false);
    if (!switched) throw new Error('Failed to switch to Singlife');
    return;
  }
  if (context === 'aia') {
    await mhc.ensureAtMhcHome();
    const switched = await mhc._switchSystemTo(/aia\s*clinic/i, 'AIA Clinic').catch(() => false);
    if (!switched) throw new Error('Failed to switch to AIA');
    return;
  }
  throw new Error(`Unknown context ${context}`);
}

async function searchByVisitNo(page, visitNo) {
  const keySel = page.locator('select[name="key"]').first();
  if ((await keySel.count().catch(() => 0)) > 0) {
    await keySel.selectOption('visitNo').catch(async () => {
      await keySel.selectOption({ label: /visit\s*no/i }).catch(() => {});
    });
  }

  const keyTypeSel = page.locator('select[name="keyType"]').first();
  if ((await keyTypeSel.count().catch(() => 0)) > 0) {
    await keyTypeSel.selectOption('E').catch(async () => {
      await keyTypeSel.selectOption({ label: /equals\s*to/i }).catch(() => {});
    });
  }

  const keyValue = page.locator('input[name="keyValue"]').first();
  if ((await keyValue.count().catch(() => 0)) > 0) {
    await keyValue.fill(String(visitNo || ''), { timeout: 8000 }).catch(async () => {
      await keyValue.click({ timeout: 3000 }).catch(() => {});
      await page.keyboard.press('Control+A').catch(() => {});
      await page.keyboard.type(String(visitNo || '')).catch(() => {});
    });
  }

  const search = page.locator('input[name="SearchAction"]').first();
  if ((await search.count().catch(() => 0)) > 0) {
    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(() => {}),
      search.click({ timeout: 10000 }).catch(() => {}),
    ]);
  } else {
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
  }

  await page.waitForTimeout(800);
}

async function openVisitFromList(page, visitNo) {
  const exact = page.locator('a', { hasText: visitNo }).first();
  if ((await exact.count().catch(() => 0)) > 0) {
    await exact.click({ timeout: 10000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1000);
    return true;
  }

  const fuzzy = page.locator(`a[href*="${visitNo}"]`).first();
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
    const data = await frame.evaluate(() => {
      const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

      const fields = Array.from(document.querySelectorAll('input,select,textarea')).map((el) => {
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
        return { key: clean(key), label: clean(label), name: clean(name), id: clean(id), tag, type, value: clean(value) };
      })
      .filter((f) => f.key || f.value)
      .filter((f) => !(f.type === 'hidden' && !f.value));

      const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,b,strong,th'))
        .map((n) => clean(n.textContent))
        .filter(Boolean)
        .slice(0, 60);

      return {
        url: location.href,
        title: document.title,
        headings,
        fields: fields.slice(0, 500),
      };
    }).catch(() => null);

    if (data) {
      frameResults.push({
        frameUrl: frame.url(),
        ...data,
      });
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

async function captureListOfEntries(page, mhc, entries, type) {
  const out = [];
  let currentContext = null;

  for (const entry of entries.sort(byContextThenRef)) {
    if (currentContext !== entry.context) {
      await enterContext(page, mhc, entry.context);
      currentContext = entry.context;
    }

    await openList(page, type);
    await searchByVisitNo(page, entry.reference);

    const opened = await openVisitFromList(page, entry.reference);
    const outPath = path.join(outDir, type, entry.context, `${entry.visit_id}_${entry.reference}.png`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    if (!opened) {
      await page.screenshot({ path: outPath, fullPage: true }).catch(() => {});
      out.push({
        ...entry,
        opened: false,
        screenshot: outPath,
        snapshot: null,
      });
      console.log(`[form-check] ${type} ${entry.visit_id} ${entry.reference} => OPEN_FAIL`);
      continue;
    }

    const snapshot = await extractSnapshot(page);
    await page.screenshot({ path: outPath, fullPage: true }).catch(() => {});

    out.push({
      ...entry,
      opened: true,
      screenshot: outPath,
      snapshot,
    });

    console.log(`[form-check] ${type} ${entry.visit_id} ${entry.reference} => OPENED`);
  }

  return out;
}

function summarizeComparison(submittedCaptures, draftCaptures) {
  const draftByVisitId = new Map(draftCaptures.map((d) => [d.visit_id, d]));
  const rows = [];

  for (const s of submittedCaptures) {
    const d = draftByVisitId.get(s.visit_id);
    const row = {
      visit_id: s.visit_id,
      patient_name: s.patient_name,
      nric: s.nric,
      visit_date: s.visit_date,
      pay_type: s.pay_type,
      submitted_ref: s.reference,
      draft_ref: d?.reference || '',
      submitted_opened: s.opened,
      draft_opened: Boolean(d?.opened),
      comparable: false,
      signal_notes: '',
    };

    if (!s.opened || !d?.opened) {
      row.signal_notes = !d?.opened
        ? 'No draft form available for direct form-level compare'
        : 'Could not open one side';
      rows.push(row);
      continue;
    }

    row.comparable = true;

    const findFieldValue = (cap, re) => {
      const fields = cap?.snapshot?.main?.fields || [];
      for (const f of fields) {
        const key = `${f.key} ${f.label} ${f.name} ${f.id}`.toLowerCase();
        if (re.test(key) && f.value) return f.value;
      }
      return '';
    };

    const dFee = findFieldValue(d, /total\s*fee|consultation\s*fee|amt|amount/);
    const sFee = findFieldValue(s, /total\s*fee|consultation\s*fee|amt|amount/);
    const dMc = findFieldValue(d, /mc\s*day|medical\s*leave/);
    const sMc = findFieldValue(s, /mc\s*day|medical\s*leave/);

    row.signal_notes = `signal_fields(draft/submitted): fee=${dFee || '-'} / ${sFee || '-'}, mc=${dMc || '-'} / ${sMc || '-'}`;
    rows.push(row);
  }

  return rows;
}

async function main() {
  const submittedRows = parseCsv(fs.readFileSync(submittedTruthCsv, 'utf8'));
  const draftRows = parseCsv(fs.readFileSync(draftTruthCsv, 'utf8'));

  const submittedEntries = submittedRows
    .filter((r) => ['yes', 'true'].includes(String(r.portal_found || '').toLowerCase()))
    .filter((r) => r.portal_reference)
    .map((r) => ({
      visit_id: r.visit_id,
      patient_name: r.patient_name,
      nric: r.nric,
      visit_date: r.visit_date,
      pay_type: r.pay_type,
      context: portalContextFromPayType(r.pay_type),
      reference: r.portal_reference,
      source: 'submitted',
    }));

  const draftEntries = draftRows
    .filter((r) => ['yes', 'true'].includes(String(r.draft_found || '').toLowerCase()))
    .filter((r) => r.draft_reference)
    .map((r) => ({
      visit_id: r.visit_id,
      patient_name: r.patient_name,
      nric: r.nric,
      visit_date: r.visit_date,
      pay_type: r.pay_type,
      context: portalContextFromPayType(r.pay_type),
      reference: r.draft_reference,
      source: 'draft',
    }));

  fs.mkdirSync(outDir, { recursive: true });

  const browser = new BrowserManager();
  await browser.init();
  const page = await browser.newPage();
  const mhc = new MHCAsiaAutomation(page);

  let submittedCaptures = [];
  let draftCaptures = [];

  try {
    await mhc.login();

    submittedCaptures = await captureListOfEntries(page, mhc, submittedEntries, 'submitted');
    draftCaptures = await captureListOfEntries(page, mhc, draftEntries, 'draft');
  } finally {
    await browser.close().catch(() => {});
  }

  const compareRows = summarizeComparison(submittedCaptures, draftCaptures);

  const payload = {
    generatedAt: new Date().toISOString(),
    submittedCount: submittedEntries.length,
    draftCount: draftEntries.length,
    submittedCaptures,
    draftCaptures,
    compareRows,
  };

  fs.writeFileSync(outJson, JSON.stringify(payload, null, 2));

  const md = [];
  md.push('# Form-Level Answer Sheet Check (2026-02-02 to 2026-02-07)');
  md.push('');
  md.push(`Generated: ${new Date().toISOString()}`);
  md.push('');
  md.push('## Coverage');
  md.push(`- Submitted references captured: ${submittedCaptures.filter((x) => x.opened).length}/${submittedCaptures.length}`);
  md.push(`- Draft references captured: ${draftCaptures.filter((x) => x.opened).length}/${draftCaptures.length}`);
  md.push('');
  md.push('## Submitted Forms');
  md.push('|Visit ID|Patient|NRIC|Submitted Ref|Opened|Screenshot|');
  md.push('|---|---|---|---|---|---|');
  for (const s of submittedCaptures) {
    md.push(`|${s.visit_id}|${String(s.patient_name || '').replace(/\|/g, '/')}|${s.nric}|${s.reference}|${s.opened ? 'yes' : 'no'}|${s.screenshot}|`);
  }
  md.push('');
  md.push('## Draft Forms');
  md.push('|Visit ID|Patient|NRIC|Draft Ref|Opened|Screenshot|');
  md.push('|---|---|---|---|---|---|');
  for (const d of draftCaptures) {
    md.push(`|${d.visit_id}|${String(d.patient_name || '').replace(/\|/g, '/')}|${d.nric}|${d.reference}|${d.opened ? 'yes' : 'no'}|${d.screenshot}|`);
  }
  md.push('');
  md.push('## Comparable Rows (Draft vs Submitted)');
  md.push('|Visit ID|Patient|NRIC|Draft Ref|Submitted Ref|Comparable|Notes|');
  md.push('|---|---|---|---|---|---|---|');
  for (const r of compareRows) {
    md.push(`|${r.visit_id}|${String(r.patient_name || '').replace(/\|/g, '/')}|${r.nric}|${r.draft_ref}|${r.submitted_ref}|${r.comparable ? 'yes' : 'no'}|${String(r.signal_notes || '').replace(/\|/g, '/')}|`);
  }

  fs.writeFileSync(outMd, `${md.join('\n')}\n`);

  console.log(`Wrote snapshots JSON: ${outJson}`);
  console.log(`Wrote summary MD: ${outMd}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
