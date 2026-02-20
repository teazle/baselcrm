import fs from 'fs';

const runTargetsCsv = '/Users/vincent/Baselrpacrm/tmp/phasec_run_targets_2026-02-02_2026-02-07.csv';
const draftTruthCsv = '/Users/vincent/Baselrpacrm/tmp/edit_draft_truth_2026-02-02_2026-02-07.csv';
const submittedTruthCsv = '/Users/vincent/Baselrpacrm/tmp/view_submitted_claim_truth_2026-02-02_2026-02-07.csv';
const formLevelJson = '/Users/vincent/Baselrpacrm/tmp/form_level_answer_sheet_snapshots_2026-02-02_2026-02-07.json';

const correctedReconMd = '/Users/vincent/Baselrpacrm/tmp/phasec_reconciliation_corrected_2026-02-02_2026-02-07.md';
const compareMd = '/Users/vincent/Baselrpacrm/tmp/phasec_draft_vs_answer_sheet_2026-02-02_2026-02-07.md';

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

const toBool = (v) => ['yes', 'true', '1'].includes(String(v || '').trim().toLowerCase());

const runs = parseCsv(fs.readFileSync(runTargetsCsv, 'utf8'));
const drafts = parseCsv(fs.readFileSync(draftTruthCsv, 'utf8'));
const submitted = parseCsv(fs.readFileSync(submittedTruthCsv, 'utf8'));
const formLevel = JSON.parse(fs.readFileSync(formLevelJson, 'utf8'));

const draftById = new Map(drafts.map((r) => [r.visit_id, r]));
const submittedById = new Map(submitted.map((r) => [r.visit_id, r]));
const compareById = new Map((formLevel.compareRows || []).map((r) => [r.visit_id, r]));
const acceptedExceptionNrics = new Set(['M4427511W']);

let crmDraftCount = 0;
let crmDraftFound = 0;
let crmDraftMissing = 0;
let portalDraftButCrmNotDraft = 0;
let crmErrorCount = 0;
let defects = 0;
let adminSubmittedFound = 0;

const detailRows = [];

for (const run of runs) {
  const crm = String(run.crm_status || '').toLowerCase() || 'null';
  const d = draftById.get(run.visit_id) || {};
  const s = submittedById.get(run.visit_id) || {};

  const draftFound = toBool(d.draft_found);
  const adminFound = toBool(s.portal_found);
  const isAcceptedException = acceptedExceptionNrics.has(String(run.nric || '').trim().toUpperCase());
  if (adminFound) adminSubmittedFound++;

  let issue = '';
  if (crm === 'draft') {
    crmDraftCount++;
    if (draftFound) crmDraftFound++;
    else {
      crmDraftMissing++;
      issue = 'CRM draft missing in portal Edit/Draft';
      defects++;
    }
  } else if (crm === 'error') {
    crmErrorCount++;
    if (!isAcceptedException) {
      issue = 'CRM error: save-draft failed';
      defects++;
      if (adminFound && !draftFound) {
        issue = 'CRM error: save-draft failed while admin submitted claim exists';
      }
    } else {
      issue = 'Accepted exception: member not found';
    }
  } else if (draftFound) {
    portalDraftButCrmNotDraft++;
    issue = 'Portal Edit/Draft has draft but CRM status is not draft';
    defects++;
  } else if (!isAcceptedException && adminFound) {
    issue = 'Admin submitted claim exists but no CRM draft';
    defects++;
  } else if (isAcceptedException) {
    issue = 'Accepted exception: member not found';
  }

  detailRows.push({
    order: run.order,
    visitId: run.visit_id,
    patient: run.patient_name,
    nric: run.nric,
    visitDate: run.visit_date,
    payType: run.pay_type,
    crmStatus: run.crm_status || 'null',
    draftFound: d.draft_found || '',
    draftRef: d.draft_reference || '',
    adminFound: s.portal_found || '',
    adminRef: s.portal_reference || '',
    issue,
  });
}

const verdict = defects > 0 ? 'Needs fix' : 'Aligned';

const md = [];
md.push('# Phase C Reconciliation (Corrected Semantics, 2026-02-02 to 2026-02-07)');
md.push('');
md.push(`Generated: ${new Date().toISOString()}`);
md.push('');
md.push('## Validation Semantics');
md.push('- Draft save integrity uses portal `Edit/Draft Visits`.');
md.push('- `View Submitted Claim` is admin answer-sheet reference only.');
md.push('');
md.push('## Summary');
md.push(`- CRM draft rows: ${crmDraftCount}`);
md.push(`- CRM draft found in Edit/Draft: ${crmDraftFound}`);
md.push(`- CRM draft missing in Edit/Draft: ${crmDraftMissing}`);
md.push(`- Edit/Draft found but CRM not draft: ${portalDraftButCrmNotDraft}`);
md.push(`- CRM error rows: ${crmErrorCount}`);
md.push(`- Admin submitted found (reference): ${adminSubmittedFound}`);
md.push(`- Defects: ${defects}`);
md.push(`- Final verdict: **${verdict}**`);
md.push('');
md.push('## Per-Visit');
md.push('|#|Visit ID|Patient|NRIC|Date|Pay Type|CRM Status|Draft Found|Draft Ref|Admin Submitted Found|Admin Ref|Issue|');
md.push('|-:|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of detailRows) {
  md.push(`|${r.order}|${r.visitId}|${String(r.patient || '').replace(/\|/g, '/')}|${r.nric}|${r.visitDate}|${r.payType}|${r.crmStatus}|${r.draftFound}|${r.draftRef}|${r.adminFound}|${r.adminRef}|${String(r.issue || '').replace(/\|/g, '/')}|`);
}
fs.writeFileSync(correctedReconMd, `${md.join('\n')}\n`);

const comp = [];
let comparable = 0;
let missingDraft = 0;
for (const run of runs) {
  const c = compareById.get(run.visit_id);
  if (!c) continue;
  const row = {
    order: run.order,
    visitId: run.visit_id,
    patient: run.patient_name,
    nric: run.nric,
    visitDate: run.visit_date,
    crmStatus: run.crm_status || 'null',
    draftRef: c.draft_ref || '',
    submittedRef: c.submitted_ref || '',
    comparable: c.comparable ? 'yes' : 'no',
    notes: c.signal_notes || '',
  };
  if (c.comparable) comparable++;
  else if ((c.submitted_opened || c.adminFound) && !c.draft_opened) missingDraft++;
  comp.push(row);
}

const md2 = [];
md2.push('# Draft vs Admin Answer Sheet (Form-Level)');
md2.push('');
md2.push(`Generated: ${new Date().toISOString()}`);
md2.push('');
md2.push('## Summary');
md2.push(`- Submitted forms opened: ${(formLevel.submittedCaptures || []).filter((x) => x.opened).length}`);
md2.push(`- Draft forms opened: ${(formLevel.draftCaptures || []).filter((x) => x.opened).length}`);
md2.push(`- Comparable (both sides opened): ${comparable}`);
md2.push(`- Submitted available but draft missing: ${missingDraft}`);
md2.push('');
md2.push('## Per-Visit');
md2.push('|#|Visit ID|Patient|NRIC|Date|CRM Status|Draft Ref|Submitted Ref|Comparable|Notes|');
md2.push('|-:|---|---|---|---|---|---|---|---|---|');
for (const r of comp.sort((a, b) => Number(a.order) - Number(b.order))) {
  md2.push(`|${r.order}|${r.visitId}|${String(r.patient || '').replace(/\|/g, '/')}|${r.nric}|${r.visitDate}|${r.crmStatus}|${r.draftRef}|${r.submittedRef}|${r.comparable}|${String(r.notes || '').replace(/\|/g, '/')}|`);
}

md2.push('');
md2.push('## Artifacts');
md2.push(`- Form snapshot JSON: \`${formLevelJson}\``);
md2.push(`- Submitted screenshots: \`${'/Users/vincent/Baselrpacrm/screenshots/form-level-check-2026-02-02_2026-02-07/submitted'}\``);
md2.push(`- Draft screenshots: \`${'/Users/vincent/Baselrpacrm/screenshots/form-level-check-2026-02-02_2026-02-07/draft'}\``);

fs.writeFileSync(compareMd, `${md2.join('\n')}\n`);

console.log(`Wrote corrected reconciliation: ${correctedReconMd}`);
console.log(`Wrote form-level answer-sheet report: ${compareMd}`);
console.log(`Defects: ${defects}`);
