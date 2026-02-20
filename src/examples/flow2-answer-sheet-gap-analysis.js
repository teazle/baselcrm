import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createSupabaseClient } from '../utils/supabase-client.js';
import { logger } from '../utils/logger.js';

const DEFAULT_SUBMITTED_TRUTH =
  '/Users/vincent/Baselrpacrm/tmp/view_submitted_claim_truth_2026-02-02_2026-02-07.csv';
const DEFAULT_DRAFT_TRUTH =
  '/Users/vincent/Baselrpacrm/tmp/edit_draft_truth_2026-02-02_2026-02-07.csv';
const DEFAULT_OUT_JSON =
  '/Users/vincent/Baselrpacrm/tmp/flow2_answer_sheet_gap_analysis_2026-02-02_2026-02-07.json';
const DEFAULT_OUT_MD =
  '/Users/vincent/Baselrpacrm/tmp/flow2_answer_sheet_gap_analysis_2026-02-02_2026-02-07.md';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const n = argv[i + 1];
    if (a === '--submitted-truth' && n) {
      out.submittedTruth = n;
      i++;
    } else if (a === '--draft-truth' && n) {
      out.draftTruth = n;
      i++;
    } else if (a === '--out-json' && n) {
      out.outJson = n;
      i++;
    } else if (a === '--out-md' && n) {
      out.outMd = n;
      i++;
    }
  }
  return out;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  const parseLine = line => {
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
  return lines.slice(1).map(line => {
    const vals = parseLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = vals[i] ?? '';
    });
    return row;
  });
}

function parseMoney(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const n = Number(raw.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseNumber(value) {
  const n = Number(String(value ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

function normalizeCode(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDiagFromNotes(notes) {
  const text = String(notes || '');
  const marker = text.toLowerCase().indexOf('diag=');
  if (marker < 0) return null;
  const raw = text.slice(marker + 5).trim();
  return raw || null;
}

function splitDiag(diag) {
  const text = String(diag || '').trim();
  if (!text) return { code: null, description: null };
  const m = text.match(/^([A-Za-z]\d[A-Za-z0-9.\s]*[A-Za-z0-9])\s*[-:]\s*(.+)$/);
  if (m) {
    return {
      code: m[1].trim(),
      description: m[2].trim(),
    };
  }

  const fallbackCode = text.match(/\b([A-Za-z]\d{1,3}(?:\.\d+)?[A-Za-z]?)\b/);
  return {
    code: fallbackCode ? fallbackCode[1].trim() : null,
    description: text,
  };
}

function textRoughMatch(a, b) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;

  const leftSet = new Set(left.split(' ').filter(Boolean));
  const rightSet = new Set(right.split(' ').filter(Boolean));
  let overlap = 0;
  for (const t of leftSet) {
    if (rightSet.has(t)) overlap++;
  }
  const denom = Math.max(leftSet.size, rightSet.size, 1);
  return overlap / denom >= 0.6;
}

function mapDoctorFromSpCode(spCodeRaw) {
  const compact = String(spCodeRaw || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (!compact) return null;

  const priority = [
    { code: 'ARU', doctor: 'Palanisamy Arul Murugan' },
    { code: 'PAM', doctor: 'Palanisamy Arul Murugan' },
    { code: 'KT', doctor: 'Tan Guoping Kelvin' },
    { code: 'KY', doctor: 'Yip Man Hing Kevin' },
    { code: 'MT', doctor: 'Tung Yu Yee Mathew' },
  ];

  for (const p of priority) {
    if (compact.includes(p.code)) return p.doctor;
  }
  return null;
}

function inferGstRate(totalAmount, medicines) {
  const total = Number(totalAmount);
  if (!Number.isFinite(total) || total <= 0) return null;
  const meds = Array.isArray(medicines) ? medicines : [];
  const base = meds.reduce((sum, m) => {
    const v = Number(m?.amount);
    return Number.isFinite(v) && v > 0 ? sum + v : sum;
  }, 0);
  if (!(base > 0) || total < base) return null;
  const rate = (total - base) / base;
  if (!Number.isFinite(rate) || rate < 0 || rate > 0.2) return null;
  return rate;
}

function deriveConsultationClaimAmount(visit, extractionMetadata) {
  const md = extractionMetadata || {};
  const medicines = Array.isArray(md.medicines) ? md.medicines : [];
  if (!medicines.length) return null;

  const consultation = medicines.find((m) =>
    /consultation/i.test(String(m?.name || ''))
  );
  if (!consultation) return null;

  const consultationBase = Number(consultation?.amount);
  if (!Number.isFinite(consultationBase) || consultationBase <= 0) return null;

  const inferredRate = inferGstRate(visit?.total_amount, medicines);
  const gstRate = inferredRate != null ? inferredRate : 0.09;
  return Number((consultationBase * (1 + gstRate)).toFixed(2));
}

function pickBestFeeComparison({ answerFee, visitTotal, consultationTotal }) {
  if (answerFee == null) {
    return {
      flow2AmountCompared: visitTotal,
      feeDiff: null,
      feeMatch: null,
      feeBasis: visitTotal != null ? 'visit_total' : null,
      candidateComparisons: [],
    };
  }

  const candidates = [
    { basis: 'visit_total', amount: visitTotal },
    { basis: 'consultation_component', amount: consultationTotal },
  ].filter((c) => c.amount != null && Number.isFinite(Number(c.amount)));

  if (!candidates.length) {
    return {
      flow2AmountCompared: null,
      feeDiff: null,
      feeMatch: null,
      feeBasis: null,
      candidateComparisons: [],
    };
  }

  const compared = candidates.map((c) => ({
    basis: c.basis,
    amount: Number(c.amount),
    diff: Number((Number(c.amount) - answerFee).toFixed(2)),
  }));
  compared.sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff));
  const best = compared[0];

  return {
    flow2AmountCompared: best.amount,
    feeDiff: best.diff,
    feeMatch: Math.abs(best.diff) <= 0.01,
    feeBasis: best.basis,
    candidateComparisons: compared,
  };
}

function buildTruth(submittedRows, draftRows) {
  const truthById = new Map();

  for (const row of submittedRows) {
    const id = String(row.visit_id || '').trim();
    if (!id) continue;
    const existing = truthById.get(id) || { visit_id: id };
    existing.patient_name = row.patient_name || existing.patient_name || null;
    existing.nric = row.nric || existing.nric || null;
    existing.visit_date = row.visit_date || existing.visit_date || null;
    existing.pay_type = row.pay_type || existing.pay_type || null;
    existing.answer_diagnosis_raw = extractDiagFromNotes(row.notes) || existing.answer_diagnosis_raw || null;
    existing.submitted_reference = row.portal_reference || existing.submitted_reference || null;
    truthById.set(id, existing);
  }

  for (const row of draftRows) {
    const id = String(row.visit_id || '').trim();
    if (!id) continue;
    const existing = truthById.get(id) || { visit_id: id };
    existing.patient_name = row.patient_name || existing.patient_name || null;
    existing.nric = row.nric || existing.nric || null;
    existing.visit_date = row.visit_date || existing.visit_date || null;
    existing.pay_type = row.pay_type || existing.pay_type || null;
    existing.answer_draft_total_fee = parseMoney(row.draft_total_fee);
    existing.answer_draft_mc_days = parseNumber(row.draft_mc_days);
    existing.draft_found = String(row.draft_found || '').toLowerCase() === 'yes';
    existing.draft_reference = row.draft_reference || null;
    truthById.set(id, existing);
  }

  for (const v of truthById.values()) {
    const split = splitDiag(v.answer_diagnosis_raw);
    v.answer_diagnosis_code = split.code;
    v.answer_diagnosis_desc = split.description;
  }

  return truthById;
}

function summarizeByReason(rows) {
  const counts = new Map();
  for (const r of rows) {
    const reason = r.primary_gap || 'none';
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

async function main() {
  const args = parseArgs(process.argv);
  const submittedTruthPath = args.submittedTruth || DEFAULT_SUBMITTED_TRUTH;
  const draftTruthPath = args.draftTruth || DEFAULT_DRAFT_TRUTH;
  const outJson = args.outJson || DEFAULT_OUT_JSON;
  const outMd = args.outMd || DEFAULT_OUT_MD;

  if (!fs.existsSync(submittedTruthPath)) {
    throw new Error(`Submitted truth CSV not found: ${submittedTruthPath}`);
  }
  if (!fs.existsSync(draftTruthPath)) {
    throw new Error(`Draft truth CSV not found: ${draftTruthPath}`);
  }

  const submittedRows = parseCsv(fs.readFileSync(submittedTruthPath, 'utf8'));
  const draftRows = parseCsv(fs.readFileSync(draftTruthPath, 'utf8'));
  const truthById = buildTruth(submittedRows, draftRows);

  const visitIds = [...truthById.keys()];
  if (!visitIds.length) {
    throw new Error('No visit_ids found in truth CSVs');
  }

  const supabase = createSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }

  const { data: visits, error } = await supabase
    .from('visits')
    .select(
      'id,patient_name,nric,visit_date,pay_type,total_amount,diagnosis_description,treatment_detail,extraction_metadata,submission_status,submission_metadata'
    )
    .in('id', visitIds);

  if (error) throw new Error(`Supabase query failed: ${error.message}`);

  const byId = new Map((visits || []).map(v => [v.id, v]));
  const rows = [];

  for (const visitId of visitIds) {
    const truth = truthById.get(visitId);
    const visit = byId.get(visitId);

    if (!visit) {
      rows.push({
        visit_id: visitId,
        patient_name: truth?.patient_name || null,
        nric: truth?.nric || null,
        visit_date: truth?.visit_date || null,
        pay_type: truth?.pay_type || null,
        found_in_db: false,
        primary_gap: 'missing_visit_record',
      });
      continue;
    }

    const md = visit.extraction_metadata || {};
    const flow2DiagDesc =
      md?.diagnosisCanonical?.description_canonical || visit.diagnosis_description || null;
    const flow2DiagCode = md?.diagnosisCanonical?.code_normalized || md?.diagnosisCode || null;
    const flow2DiagStatus = md?.diagnosisResolution?.status || null;
    const flow2ChargeType = md?.chargeType || null;
    const flow2McDays = Number.isFinite(Number(md?.mcDays)) ? Number(md?.mcDays) : null;
    const flow2TotalAmount = Number.isFinite(Number(visit.total_amount)) ? Number(visit.total_amount) : null;
    const flow2ConsultationAmount = deriveConsultationClaimAmount(visit, md);
    const flow2SpCode = md?.spCode || null;
    const flow2Doctor = mapDoctorFromSpCode(flow2SpCode);

    const answerDiagCode = truth?.answer_diagnosis_code || null;
    const answerDiagDesc = truth?.answer_diagnosis_desc || null;
    const answerDraftFee = truth?.answer_draft_total_fee ?? null;
    const answerDraftMcDays = truth?.answer_draft_mc_days ?? null;

    const diagCodeMatch =
      answerDiagCode && flow2DiagCode
        ? normalizeCode(answerDiagCode) === normalizeCode(flow2DiagCode)
        : null;
    const diagTextMatch =
      answerDiagDesc && flow2DiagDesc ? textRoughMatch(answerDiagDesc, flow2DiagDesc) : null;

    const feeComparison = pickBestFeeComparison({
      answerFee: answerDraftFee,
      visitTotal: flow2TotalAmount,
      consultationTotal: flow2ConsultationAmount,
    });
    const feeDiff = feeComparison.feeDiff;
    const feeMatch = feeComparison.feeMatch;

    const mcDiff =
      answerDraftMcDays != null && flow2McDays != null
        ? Number((flow2McDays - answerDraftMcDays).toFixed(2))
        : null;
    const mcMatch = mcDiff == null ? null : Math.abs(mcDiff) <= 0.01;

    const gaps = [];

    if (diagCodeMatch === false) gaps.push('diagnosis_code_mismatch');
    if (diagTextMatch === false) gaps.push('diagnosis_text_mismatch');
    if (feeMatch === false) gaps.push('total_amount_mismatch_vs_answer_draft');
    if (mcMatch === false) gaps.push('mc_days_mismatch_vs_answer_draft');
    if (!flow2DiagStatus || flow2DiagStatus !== 'resolved') gaps.push('flow2_diagnosis_not_resolved');
    if (flow2SpCode && !flow2Doctor) gaps.push('sp_code_unmapped');

    let primaryGap = 'none';
    if (gaps.includes('total_amount_mismatch_vs_answer_draft') && (flow2TotalAmount || 0) === 0) {
      primaryGap = 'flow1_claim_amount_not_extracted';
    } else if (gaps.includes('diagnosis_code_mismatch') || gaps.includes('diagnosis_text_mismatch')) {
      primaryGap = flow2DiagStatus === 'missing' ? 'flow2_missing_diagnosis' : 'flow2_wrong_diagnosis_mapping';
    } else if (gaps.includes('mc_days_mismatch_vs_answer_draft')) {
      primaryGap = 'flow2_mc_days_mismatch';
    } else if (gaps.includes('flow2_diagnosis_not_resolved')) {
      primaryGap = 'flow2_diagnosis_resolution_ambiguous';
    }

    rows.push({
      visit_id: visit.id,
      patient_name: visit.patient_name,
      nric: visit.nric,
      visit_date: visit.visit_date,
      pay_type: visit.pay_type,
      found_in_db: true,
      answer_diagnosis_code: answerDiagCode,
      answer_diagnosis_desc: answerDiagDesc,
      flow2_diagnosis_code: flow2DiagCode,
      flow2_diagnosis_desc: flow2DiagDesc,
      flow2_diagnosis_status: flow2DiagStatus,
      diagnosis_code_match: diagCodeMatch,
      diagnosis_text_match: diagTextMatch,
      answer_draft_total_fee: answerDraftFee,
      flow2_total_amount: flow2TotalAmount,
      flow2_consultation_amount: flow2ConsultationAmount,
      flow2_fee_compared_amount: feeComparison.flow2AmountCompared,
      flow2_fee_basis: feeComparison.feeBasis,
      flow2_fee_comparison_candidates: feeComparison.candidateComparisons,
      fee_match: feeMatch,
      fee_diff: feeDiff,
      answer_draft_mc_days: answerDraftMcDays,
      flow2_mc_days: flow2McDays,
      mc_days_match: mcMatch,
      mc_days_diff: mcDiff,
      flow2_charge_type: flow2ChargeType,
      flow2_sp_code: flow2SpCode,
      flow2_mapped_doctor: flow2Doctor,
      gap_flags: gaps,
      primary_gap: primaryGap,
    });
  }

  const summary = {
    generated_at: new Date().toISOString(),
    total_truth_visits: visitIds.length,
    found_in_db: rows.filter(r => r.found_in_db).length,
    missing_in_db: rows.filter(r => !r.found_in_db).length,
    diagnosis_code_mismatch: rows.filter(r => r.diagnosis_code_match === false).length,
    diagnosis_text_mismatch: rows.filter(r => r.diagnosis_text_match === false).length,
    fee_mismatch: rows.filter(r => r.fee_match === false).length,
    mc_days_mismatch: rows.filter(r => r.mc_days_match === false).length,
    flow2_diagnosis_not_resolved: rows.filter(r => (r.flow2_diagnosis_status || '') !== 'resolved').length,
    primary_gap_counts: summarizeByReason(rows),
  };

  const output = {
    summary,
    rows,
    inputs: {
      submitted_truth_csv: submittedTruthPath,
      draft_truth_csv: draftTruthPath,
    },
  };

  fs.writeFileSync(outJson, `${JSON.stringify(output, null, 2)}\n`);

  const md = [];
  md.push('# Flow 2 vs Answer Sheet Gap Analysis');
  md.push('');
  md.push(`- Generated at: ${summary.generated_at}`);
  md.push(`- Truth visits: ${summary.total_truth_visits}`);
  md.push(`- Found in DB: ${summary.found_in_db}`);
  md.push(`- Missing in DB: ${summary.missing_in_db}`);
  md.push(`- Diagnosis code mismatches: ${summary.diagnosis_code_mismatch}`);
  md.push(`- Diagnosis text mismatches: ${summary.diagnosis_text_mismatch}`);
  md.push(`- Fee mismatches: ${summary.fee_mismatch}`);
  md.push(`- MC day mismatches: ${summary.mc_days_mismatch}`);
  md.push(`- Flow 2 diagnosis not resolved: ${summary.flow2_diagnosis_not_resolved}`);
  md.push('');
  md.push('## Primary Gaps');
  md.push('');
  for (const item of summary.primary_gap_counts) {
    md.push(`- ${item.reason}: ${item.count}`);
  }
  md.push('');
  md.push('## Rows');
  md.push('');
  md.push('|visit_id|patient|date|pay_type|answer_diag|flow2_diag|diag_match|answer_fee|flow2_amount|fee_match|answer_mc|flow2_mc|mc_match|primary_gap|');
  md.push('|---|---|---|---|---|---|---|---:|---:|---|---:|---:|---|---|');

  for (const r of rows) {
    const answerDiag = [r.answer_diagnosis_code, r.answer_diagnosis_desc].filter(Boolean).join(' - ');
    const flow2Diag = [r.flow2_diagnosis_code, r.flow2_diagnosis_desc].filter(Boolean).join(' - ');
    const diagMatch =
      r.diagnosis_code_match === false || r.diagnosis_text_match === false
        ? 'no'
        : r.diagnosis_code_match === null && r.diagnosis_text_match === null
          ? ''
          : 'yes';

    md.push(
      `|${r.visit_id}|${String(r.patient_name || '').replace(/\|/g, '/')}|${r.visit_date || ''}|${r.pay_type || ''}|${String(answerDiag || '').replace(/\|/g, '/')}|${String(flow2Diag || '').replace(/\|/g, '/')}|${diagMatch}|${r.answer_draft_total_fee ?? ''}|${r.flow2_fee_compared_amount ?? r.flow2_total_amount ?? ''}|${
        r.fee_match === null ? '' : r.fee_match ? 'yes' : 'no'
      }|${r.answer_draft_mc_days ?? ''}|${r.flow2_mc_days ?? ''}|${
        r.mc_days_match === null ? '' : r.mc_days_match ? 'yes' : 'no'
      }|${r.primary_gap}|`
    );
  }

  fs.writeFileSync(outMd, `${md.join('\n')}\n`);

  logger.info('Flow2 answer-sheet gap report generated', {
    outJson,
    outMd,
    total: summary.total_truth_visits,
    primaryGapCounts: summary.primary_gap_counts,
  });
}

main().catch(error => {
  logger.error('Failed to run flow2-answer-sheet-gap-analysis', {
    error: error?.message || String(error),
  });
  process.exitCode = 1;
});
