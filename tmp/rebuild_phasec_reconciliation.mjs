import fs from 'fs';

const runTargetsCsv = '/Users/vincent/Baselrpacrm/tmp/phasec_run_targets_2026-02-02_2026-02-07.csv';
const truthCsv = '/Users/vincent/Baselrpacrm/tmp/view_submitted_claim_truth_2026-02-02_2026-02-07.csv';
const reconMd = '/Users/vincent/Baselrpacrm/tmp/phasec_reconciliation_2026-02-02_2026-02-07.md';

const parseCsv = (text) => {
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
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = vals[i] ?? '';
    });
    return obj;
  });
};

const runs = parseCsv(fs.readFileSync(runTargetsCsv, 'utf8'));
const truth = parseCsv(fs.readFileSync(truthCsv, 'utf8'));
const truthById = new Map(truth.map((r) => [r.visit_id, r]));

let crmDraft = 0;
let checked = 0;
let pendingTruth = 0;
let mismatches = 0;
const detailRows = [];

for (const run of runs) {
  const t = truthById.get(run.visit_id) || {};
  const crm = run.crm_status || 'null';
  if (crm === 'draft') crmDraft++;

  const pf = String(t.portal_found || '').trim().toLowerCase();
  const isChecked = ['yes', 'no', 'true', 'false'].includes(pf);

  let mismatch = '';
  if (!isChecked) {
    pendingTruth++;
  } else {
    checked++;
    const portalFound = pf === 'yes' || pf === 'true';
    const acceptedException = run.nric === 'M4427511W' && !portalFound;

    if (portalFound && crm !== 'draft') mismatch = 'Portal has claim/draft but CRM is not draft';
    if (!portalFound && crm === 'draft' && !acceptedException) mismatch = 'CRM draft but portal not found';

    if (mismatch) mismatches++;
  }

  detailRows.push({
    order: run.order,
    id: run.visit_id,
    patient: run.patient_name,
    nric: run.nric,
    visitDate: run.visit_date,
    payType: run.pay_type,
    crm,
    portalFound: t.portal_found || '',
    portalStatus: t.portal_status || '',
    portalRef: t.portal_reference || '',
    mismatch,
    notes: t.notes || '',
  });
}

const verdict =
  pendingTruth > 0
    ? 'Needs fix (manual View Submitted Claim truth-check still pending)'
    : mismatches > 0
      ? 'Needs fix'
      : 'Aligned';

const md = [];
md.push('# Phase C Reconciliation (2026-02-02 to 2026-02-07)');
md.push('');
md.push(`Generated: ${new Date().toISOString()}`);
md.push('');
md.push('## Inputs');
md.push(`- Canonical run targets: \`${runTargetsCsv}\``);
md.push(`- Truth sheet: \`${truthCsv}\``);
md.push('');
md.push('## Summary Counts');
md.push(`- CRM draft (attempted set): ${crmDraft}`);
md.push(`- Portal truth rows checked: ${checked}`);
md.push(`- Portal truth pending: ${pendingTruth}`);
md.push(`- Mismatches: ${mismatches}`);
md.push(`- Final verdict: **${verdict}**`);
md.push('');
md.push('## Per-Visit Reconciliation');
md.push('|#|Visit ID|Patient|NRIC|Date|Pay Type|CRM Status|Portal Found|Portal Status|Portal Ref|Mismatch|Notes|');
md.push('|-:|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of detailRows) {
  md.push(`|${r.order}|${r.id}|${String(r.patient || '').replace(/\|/g, '/')}|${r.nric}|${r.visitDate}|${r.payType}|${r.crm}|${String(r.portalFound || '').replace(/\|/g, '/')}|${String(r.portalStatus || '').replace(/\|/g, '/')}|${String(r.portalRef || '').replace(/\|/g, '/')}|${String(r.mismatch || '').replace(/\|/g, '/')}|${String(r.notes || '').replace(/\|/g, '/')}|`);
}

fs.writeFileSync(reconMd, `${md.join('\n')}\n`);
console.log(`Wrote: ${reconMd}`);
console.log(`Verdict: ${verdict}`);
