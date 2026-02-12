#!/usr/bin/env node

import dotenv from 'dotenv';
import { createSupabaseClient } from '../utils/supabase-client.js';
import { logger } from '../utils/logger.js';

dotenv.config();

function parseArg(name) {
  const args = process.argv.slice(2);
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.split('=')[1] || null;
  const idx = args.indexOf(name);
  if (idx >= 0) return args[idx + 1] || null;
  return null;
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function containsAny(haystack, patterns) {
  const s = String(haystack || '').toLowerCase();
  return patterns.some((p) => s.includes(p));
}

async function main() {
  const fromDate = parseArg('--from');
  const toDate = parseArg('--to');
  const portalOnly = !process.argv.includes('--all-pay-types');

  if (!isIsoDate(fromDate) || !isIsoDate(toDate)) {
    console.error('Usage: node src/examples/validate-extraction-range.js --from YYYY-MM-DD --to YYYY-MM-DD [--all-pay-types]');
    process.exit(2);
  }

  const supabase = createSupabaseClient();
  if (!supabase) {
    logger.error('Supabase client not available. Check environment variables.');
    process.exit(1);
  }

  const portalPayTypes = ['MHC', 'FULLERT', 'IHP', 'ALL', 'ALLIANZ', 'AIA', 'GE', 'AIACLIENT', 'AVIVA', 'SINGLIFE'];

  let q = supabase
    .from('visits')
    .select(
      'id,patient_name,visit_date,pay_type,nric,diagnosis_description,treatment_detail,submission_status,extraction_metadata'
    )
    .eq('source', 'Clinic Assist')
    .gte('visit_date', fromDate)
    .lte('visit_date', toDate)
    .order('visit_date', { ascending: true })
    .limit(2000);

  if (portalOnly) q = q.in('pay_type', portalPayTypes);

  const { data, error } = await q;
  if (error) {
    logger.error('Failed to query visits', { error: error.message });
    process.exit(1);
  }

  const rows = Array.isArray(data) ? data : [];
  const statusCounts = new Map();

  const suspiciousDiagPatterns = [
    'breg',
    'wrap',
    'brace',
    'splint',
    'cast',
    'physio',
    'x-ray',
    'xray',
    'ultrasound',
    'mri',
    'ct',
    'tape',
    'crutch',
    'orthosis',
  ];

  const issues = {
    missingNric: [],
    missingDiagnosis: [],
    suspiciousDiagnosis: [],
    missingMeds: [],
    junkMeds: [],
    notCompleted: [],
  };
  const diagnosisMissingReasonCounts = new Map();
  const diagnosisSourceCounts = new Map();
  const nricExtractionStatusCounts = new Map();

  for (const r of rows) {
    const m = r.extraction_metadata || {};
    const detailsStatus = m.detailsExtractionStatus || null;
    statusCounts.set(detailsStatus || 'pending', (statusCounts.get(detailsStatus || 'pending') || 0) + 1);
    diagnosisSourceCounts.set(m?.detailsExtractionSources?.diagnosisSource || 'unknown', (diagnosisSourceCounts.get(m?.detailsExtractionSources?.diagnosisSource || 'unknown') || 0) + 1);
    nricExtractionStatusCounts.set(m?.detailsExtractionSources?.nricExtractionStatus || 'unknown', (nricExtractionStatusCounts.get(m?.detailsExtractionSources?.nricExtractionStatus || 'unknown') || 0) + 1);

    if (detailsStatus !== 'completed') {
      issues.notCompleted.push({ id: r.id, patient_name: r.patient_name, visit_date: r.visit_date, pay_type: r.pay_type, status: detailsStatus });
    }

    const nric = (r.nric || '').toString().trim();
    if (!nric) {
      issues.missingNric.push({ id: r.id, patient_name: r.patient_name, visit_date: r.visit_date, pay_type: r.pay_type });
    }

    const diagText = (r.diagnosis_description || '').toString().trim();
    const diagCode = (m.diagnosisCode || '').toString().trim();
    if (!diagText || diagText.toLowerCase() === 'missing diagnosis') {
      const missReason = m?.detailsExtractionSources?.diagnosisMissingReason || 'unspecified';
      diagnosisMissingReasonCounts.set(missReason, (diagnosisMissingReasonCounts.get(missReason) || 0) + 1);
      issues.missingDiagnosis.push({ id: r.id, patient_name: r.patient_name, visit_date: r.visit_date, pay_type: r.pay_type, diagnosisCode: diagCode || null });
    } else if (containsAny(diagText, suspiciousDiagPatterns)) {
      issues.suspiciousDiagnosis.push({ id: r.id, patient_name: r.patient_name, visit_date: r.visit_date, pay_type: r.pay_type, diagnosis: diagText, diagnosisCode: diagCode || null });
    }

    const meds = Array.isArray(m.medicines) ? m.medicines : [];
    const medsCount = meds.filter((x) => (x?.name || '').toString().trim()).length;
    const treatCount = (r.treatment_detail || '')
      .toString()
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean).length;
    if (Math.max(medsCount, treatCount) === 0) {
      issues.missingMeds.push({ id: r.id, patient_name: r.patient_name, visit_date: r.visit_date, pay_type: r.pay_type });
    }

    const junkCandidates = meds
      .map((x) => String(x?.name || '').trim())
      .filter(Boolean)
      .filter((name) => {
        const lower = name.toLowerCase();
        if (lower === 'medicine') return true;
        if (lower.startsWith('unfit for ')) return true;
        if (lower.startsWith('take ') || lower.startsWith('apply ') || lower.startsWith('use ')) return true;
        if (/(tab\/s|tablet|capsule|cap\/s)\b/i.test(name) && /(daily|once|twice|bd|tds|after\s+food|before\s+food)\b/i.test(name)) return true;
        if (/^to be taken\b/i.test(lower) || /\bto be taken\b/i.test(lower)) return true;
        return false;
      });
    if (junkCandidates.length) {
      issues.junkMeds.push({
        id: r.id,
        patient_name: r.patient_name,
        visit_date: r.visit_date,
        pay_type: r.pay_type,
        junk: junkCandidates.slice(0, 5),
      });
    }
  }

  const countsObj = Object.fromEntries([...statusCounts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  const diagnosisReasonObj = Object.fromEntries([...diagnosisMissingReasonCounts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  const diagnosisSourceObj = Object.fromEntries([...diagnosisSourceCounts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  const nricStatusObj = Object.fromEntries([...nricExtractionStatusCounts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

  logger.info('=== Validation Report ===');
  logger.info(`Date range: ${fromDate} -> ${toDate}`);
  logger.info(`Portal-only: ${portalOnly}`);
  logger.info(`Rows: ${rows.length}`);
  logger.info('Details extraction status counts:', countsObj);
  logger.info('Diagnosis source counts:', diagnosisSourceObj);
  logger.info('NRIC extraction status counts:', nricStatusObj);
  logger.info('Missing diagnosis reason counts:', diagnosisReasonObj);

  logger.info('Issue counts:', {
    missingNric: issues.missingNric.length,
    missingDiagnosis: issues.missingDiagnosis.length,
    suspiciousDiagnosis: issues.suspiciousDiagnosis.length,
    missingMeds: issues.missingMeds.length,
    junkMeds: issues.junkMeds.length,
    notCompleted: issues.notCompleted.length,
  });

  const sample = (arr) => arr.slice(0, 10);
  logger.info('Sample missing NRIC:', sample(issues.missingNric));
  logger.info('Sample missing diagnosis:', sample(issues.missingDiagnosis));
  logger.info('Sample suspicious diagnosis:', sample(issues.suspiciousDiagnosis));
  logger.info('Sample missing meds:', sample(issues.missingMeds));
  logger.info('Sample junk meds:', sample(issues.junkMeds));
  logger.info('Sample not completed:', sample(issues.notCompleted));

  // Exit non-zero if any not-completed (hard gate before Flow 3 save-draft) or suspicious diagnosis exists.
  const hardFail = issues.notCompleted.length > 0 || issues.suspiciousDiagnosis.length > 0;
  process.exit(hardFail ? 2 : 0);
}

main().catch((e) => {
  logger.error('Fatal error in validation script', { error: e?.message || String(e) });
  process.exit(1);
});
