#!/usr/bin/env node

import fs from 'fs';
import dotenv from 'dotenv';
import { createSupabaseClient } from '../utils/supabase-client.js';
import { logger } from '../utils/logger.js';

dotenv.config();

function parseArg(name) {
  const args = process.argv.slice(2);
  const withEq = args.find((a) => a.startsWith(`${name}=`));
  if (withEq) return withEq.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx >= 0) return args[idx + 1] || null;
  return null;
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeText(value) {
  return String(value || '')
    .replace(/^[A-Z]\d{2,3}(?:\.\d+)?\s*-\s*/i, '')
    .toLowerCase()
    .replace(/\bthe\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toDiagnosisTokens(value) {
  const stop = new Set(['the', 'and', 'for', 'with', 'without', 'part', 'parts', 'region']);
  return normalizeText(value)
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !stop.has(t));
}

function hasStrongTokenOverlap(a, b) {
  const aTokens = toDiagnosisTokens(a);
  const bTokens = toDiagnosisTokens(b);
  if (!aTokens.length || !bTokens.length) return false;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let inter = 0;
  for (const token of aSet) if (bSet.has(token)) inter++;
  const denom = Math.max(aSet.size, bSet.size);
  return denom > 0 ? inter / denom >= 0.7 : false;
}

function hasEquivalentBodyConditionClass(a, b) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return false;

  const hasKneeLeft = /\bknee\b/.test(left);
  const hasKneeRight = /\bknee\b/.test(right);
  const hasSprainLikeLeft = /\b(sprain|strain|injury)\b/.test(left);
  const hasSprainLikeRight = /\b(sprain|strain|injury)\b/.test(right);

  return hasKneeLeft && hasKneeRight && hasSprainLikeLeft && hasSprainLikeRight;
}

function extractDiagnosisPriDescFromSnapshot(snapshot) {
  const buckets = [];
  if (Array.isArray(snapshot?.main?.fields)) buckets.push(snapshot.main.fields);
  if (Array.isArray(snapshot?.frames)) {
    for (const frame of snapshot.frames) {
      if (Array.isArray(frame?.fields)) buckets.push(frame.fields);
      if (Array.isArray(frame?.main?.fields)) buckets.push(frame.main.fields);
    }
  }

  for (const fields of buckets) {
    for (const field of fields) {
      const key = String(field?.key || '').toLowerCase();
      const name = String(field?.name || '').toLowerCase();
      if (key === 'diagnosispridesc' || name === 'diagnosispridesc') {
        const value = String(field?.value || '').trim();
        if (value) return value;
      }
    }
  }
  return null;
}

function toMarkdown(report) {
  const lines = [];
  lines.push('# Diagnosis Enrichment QA');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Range: ${report.range.from} to ${report.range.to}`);
  lines.push(`Rows checked: ${report.summary.total}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Matches: ${report.summary.matches}`);
  lines.push(`- Blocked before save: ${report.summary.blocked_before_save}`);
  lines.push(`- Mismatch should not save: ${report.summary.mismatch_should_not_save}`);
  lines.push(`- Missing answer sheet: ${report.summary.missing_answer_sheet}`);
  lines.push(`- Missing Flow 2 diagnosis: ${report.summary.missing_flow2}`);
  lines.push('');
  lines.push('## Non-Match Details');
  lines.push('');
  lines.push('| visit_id | patient_name | visit_date | flow2_status | date_match_type | date_ok | flow2_diag | submitted_diag | classification | reason |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of report.rows.filter((r) => r.classification !== 'match')) {
    lines.push(
      `| ${row.visit_id} | ${row.patient_name} | ${row.visit_date} | ${row.flow2_status || ''} | ${row.flow2_date_match_type || ''} | ${String(row.flow2_date_ok)} | ${(row.flow2_diag || '').replace(/\|/g, '\\|')} | ${(row.submitted_diag || '').replace(/\|/g, '\\|')} | ${row.classification} | ${row.mismatch_category || ''} |`
    );
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const from = parseArg('--from');
  const to = parseArg('--to');
  const answerSheetFile =
    parseArg('--answer-sheet-file') ||
    '/Users/vincent/Baselrpacrm/tmp/form_level_answer_sheet_snapshots_2026-02-02_2026-02-07.json';

  if (!isIsoDate(from) || !isIsoDate(to)) {
    console.error(
      'Usage: node src/examples/diagnosis-enrichment-qa.js --from YYYY-MM-DD --to YYYY-MM-DD [--answer-sheet-file /path/to/form_level_answer_sheet_snapshots.json]'
    );
    process.exit(2);
  }

  if (!fs.existsSync(answerSheetFile)) {
    logger.error('Answer-sheet snapshot file not found', { answerSheetFile });
    process.exit(1);
  }

  const rawAnswerSheet = JSON.parse(fs.readFileSync(answerSheetFile, 'utf8'));
  const submittedCaptures = Array.isArray(rawAnswerSheet?.submittedCaptures)
    ? rawAnswerSheet.submittedCaptures
    : [];

  const submittedByVisitId = new Map();
  const submittedByNricDate = new Map();
  for (const cap of submittedCaptures) {
    const visitId = String(cap?.visit_id || '').trim();
    const nric = String(cap?.nric || '').trim().toUpperCase();
    const visitDate = String(cap?.visit_date || '').trim();
    const diagnosisPriDesc = extractDiagnosisPriDescFromSnapshot(cap?.snapshot || {});
    const payload = {
      visit_id: visitId || null,
      nric: nric || null,
      visit_date: visitDate || null,
      diagnosisPriDesc: diagnosisPriDesc || null,
      reference: String(cap?.reference || '').trim() || null,
      context: String(cap?.context || '').trim() || null,
    };
    if (visitId) submittedByVisitId.set(visitId, payload);
    if (nric && visitDate) submittedByNricDate.set(`${nric}|${visitDate}`, payload);
  }

  const supabase = createSupabaseClient();
  if (!supabase) {
    logger.error('Supabase client not available. Check environment variables.');
    process.exit(1);
  }

  const mhcFlowPayTypes = ['MHC', 'AIA', 'AIACLIENT', 'AVIVA', 'SINGLIFE'];
  const { data, error } = await supabase
    .from('visits')
    .select('id,patient_name,nric,visit_date,pay_type,diagnosis_description,extraction_metadata')
    .eq('source', 'Clinic Assist')
    .in('pay_type', mhcFlowPayTypes)
    .gte('visit_date', from)
    .lte('visit_date', to)
    .order('visit_date', { ascending: true })
    .limit(3000);

  if (error) {
    logger.error('Failed to query visits', { error: error.message });
    process.exit(1);
  }

  const rows = Array.isArray(data) ? data : [];
  const comparisonRows = rows.map((visit) => {
    const md = visit.extraction_metadata || {};
    const flow2Status = String(md?.diagnosisResolution?.status || '').trim() || null;
    const flow2DatePolicy = String(md?.diagnosisResolution?.date_policy || '').trim() || null;
    const flow2DateOk = md?.diagnosisResolution?.date_ok === true;
    const flow2DateMatchType =
      String(md?.diagnosisCanonical?.source_date_match_type || md?.diagnosisResolution?.source_date_match_type || '').trim() ||
      null;
    const flow2SourceDate = String(md?.diagnosisCanonical?.source_date || '').trim() || null;
    const flow2SourceAgeDays = Number.isFinite(Number(md?.diagnosisCanonical?.source_age_days))
      ? Number(md?.diagnosisCanonical?.source_age_days)
      : null;
    const flow2Diag =
      String(md?.diagnosisCanonical?.description_canonical || '').trim() ||
      String(visit?.diagnosis_description || '').trim() ||
      null;
    const flow2DiagNorm = normalizeText(flow2Diag);
    const visitId = String(visit.id || '').trim();
    const nric = String(visit.nric || '').trim().toUpperCase();
    const visitDate = String(visit.visit_date || '').trim();

    const submitted =
      submittedByVisitId.get(visitId) || submittedByNricDate.get(`${nric}|${visitDate}`) || null;
    const submittedDiag = submitted?.diagnosisPriDesc || null;
    const submittedNorm = normalizeText(submittedDiag);

    const fallbackAgeDays = Number.isFinite(Number(md?.diagnosisResolution?.fallback_age_days))
      ? Number(md?.diagnosisResolution?.fallback_age_days)
      : null;
    const flow2Resolved =
      flow2Status === 'resolved' &&
      flow2DateOk &&
      (fallbackAgeDays === null || fallbackAgeDays <= 30);
    let classification = 'mismatch_should_not_save';
    let mismatchCategory = 'semantic_mismatch';
    const semanticMatch =
      !!flow2Diag &&
      !!submittedDiag &&
      (flow2DiagNorm === submittedNorm ||
        (flow2DiagNorm &&
          submittedNorm &&
          (flow2DiagNorm.includes(submittedNorm) || submittedNorm.includes(flow2DiagNorm))) ||
        hasStrongTokenOverlap(flow2Diag, submittedDiag) ||
        hasEquivalentBodyConditionClass(flow2Diag, submittedDiag));
    if (!submitted) {
      classification = 'blocked_before_save';
      mismatchCategory = 'missing_answer_sheet';
    } else if (!flow2Diag) {
      classification = 'blocked_before_save';
      mismatchCategory = 'missing_flow2';
    } else if (!flow2Resolved) {
      classification = 'blocked_before_save';
      mismatchCategory = flow2DateOk
        ? `flow2_status_${flow2Status || 'unknown'}`
        : 'date_policy_not_ok';
    } else if (semanticMatch) {
      classification = 'match';
      mismatchCategory = 'match';
    } else {
      classification = 'mismatch_should_not_save';
      mismatchCategory = 'semantic_mismatch';
    }

    return {
      visit_id: visitId,
      patient_name: visit.patient_name,
      nric: nric || null,
      visit_date: visitDate,
      pay_type: visit.pay_type,
      flow2_status: flow2Status,
      flow2_date_policy: flow2DatePolicy,
      flow2_date_ok: flow2DateOk,
      flow2_date_match_type: flow2DateMatchType,
      flow2_source_date: flow2SourceDate,
      flow2_source_age_days: flow2SourceAgeDays,
      flow2_diag: flow2Diag,
      submitted_diag: submittedDiag,
      submitted_reference: submitted?.reference || null,
      classification,
      mismatch_category: mismatchCategory,
    };
  });

  const summary = {
    total: comparisonRows.length,
    matches: comparisonRows.filter((r) => r.classification === 'match').length,
    blocked_before_save: comparisonRows.filter((r) => r.classification === 'blocked_before_save').length,
    mismatch_should_not_save: comparisonRows.filter((r) => r.classification === 'mismatch_should_not_save').length,
    missing_answer_sheet: comparisonRows.filter((r) => r.mismatch_category === 'missing_answer_sheet').length,
    missing_flow2: comparisonRows.filter((r) => r.mismatch_category === 'missing_flow2').length,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    range: { from, to },
    answerSheetFile,
    summary,
    rows: comparisonRows,
  };

  const base = `/Users/vincent/Baselrpacrm/tmp/diagnosis_enrichment_qa_${from}_${to}`;
  const jsonPath = `${base}.json`;
  const mdPath = `${base}.md`;
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdPath, toMarkdown(report), 'utf8');

  logger.info('Diagnosis enrichment QA report generated', {
    jsonPath,
    mdPath,
    summary,
  });
}

main().catch((error) => {
  logger.error('Fatal error in diagnosis enrichment QA script', {
    error: error?.message || String(error),
  });
  process.exit(1);
});
