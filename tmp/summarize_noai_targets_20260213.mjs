import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import { createSupabaseClient } from '../src/utils/supabase-client.js';

dotenv.config();

const ids = [
  '6af6ea13-14d9-43c6-917e-d0ca5da4ab0f',
  '6eb5aa60-ee97-472b-a904-c4ccf2855b18',
  'c3c483d2-83d4-46be-936e-77767dd568b3',
  'dcbbe4e8-586c-45c4-905a-c76bacfcd860',
  '1e48b9cf-fe14-4c33-bbb3-f25c2b8e3bb7',
  '0a1695ab-8ea3-4fba-b5a5-ec47ea933e40',
  'a50239f6-9cd2-44a8-9bbf-4784e1dc51e1',
];

const supabase = createSupabaseClient();
const { data, error } = await supabase
  .from('visits')
  .select('id,patient_name,nric,visit_date,pay_type,submission_status,submitted_at,submission_error,submission_metadata,extraction_metadata')
  .in('id', ids)
  .order('visit_date', { ascending: true });

if (error) {
  console.error(error);
  process.exit(1);
}

const rows = (data || []).map((r) => {
  const ext = r.extraction_metadata || {};
  const res = ext.diagnosisResolution || {};
  const can = ext.diagnosisCanonical || {};
  const match = ext.diagnosisMatch || {};
  const portalOpts = Array.isArray(ext.portalDiagnosisOptions) ? ext.portalDiagnosisOptions.length : 0;
  return {
    id: r.id,
    patient_name: r.patient_name,
    nric: r.nric,
    visit_date: r.visit_date,
    pay_type: r.pay_type,
    submission_status: r.submission_status,
    submission_error: r.submission_error,
    submitted_at: r.submitted_at,
    diagnosis: {
      raw: ext.diagnosis,
      canonical: can.description_canonical || can.description_raw || null,
      code: can.code_normalized || can.code_raw || null,
      side: can.side || null,
      body_part: can.body_part || null,
      resolution_status: res.status || null,
      resolution_reason: res.reason_if_unresolved || null,
      date_ok: res.date_ok === true,
      source_date: can.source_date || null,
      source_age_days: can.source_age_days ?? null,
      portal_option_verified: res.portal_option_verified === true,
      diagnosis_match_blocked: match.blocked === true,
      diagnosis_match_reason: match.match_reason || null,
      diagnosis_match_score: match.match_score ?? null,
      portal_options_count: portalOpts,
    },
  };
});

const outJson = '/Users/vincent/Baselrpacrm/tmp/noai_target_status_after_flow2_flow3_2026-02-13.json';
await fs.writeFile(outJson, JSON.stringify(rows, null, 2));

const lines = [];
lines.push('# No-AI Target Status After Flow2 + Flow3 (2026-02-13)');
lines.push('');
lines.push('| visit_id | nric | visit_date | pay_type | diag_status | diag_reason | date_ok | submit_status | submit_error |');
lines.push('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  lines.push(`| ${r.id} | ${r.nric || ''} | ${r.visit_date || ''} | ${r.pay_type || ''} | ${r.diagnosis.resolution_status || ''} | ${String(r.diagnosis.resolution_reason || '').replace(/\|/g, '/')} | ${r.diagnosis.date_ok} | ${r.submission_status || ''} | ${String(r.submission_error || '').replace(/\|/g, '/')} |`);
}
const outMd = '/Users/vincent/Baselrpacrm/tmp/noai_target_status_after_flow2_flow3_2026-02-13.md';
await fs.writeFile(outMd, lines.join('\n'));
console.log(outJson);
console.log(outMd);
