import fs from 'fs';
import dotenv from 'dotenv';
import { createSupabaseClient } from '../src/utils/supabase-client.js';

dotenv.config();
const supabase = createSupabaseClient();
if (!supabase) {
  console.error('Supabase client unavailable');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync('tmp/flow2_answer_sheet_gap_analysis_2026-02-02_2026-02-07.json', 'utf8'));
const rows = Array.isArray(report?.rows) ? report.rows : [];
const targetRows = rows.filter((r) => String(r.primary_gap || '').startsWith('flow2_wrong_diagnosis_mapping'));
const visitIds = targetRows.map((r) => r.visit_id).filter(Boolean);

const { data, error } = await supabase
  .from('visits')
  .select('id,patient_name,nric,visit_date,pay_type,diagnosis_description,extraction_metadata')
  .in('id', visitIds);

if (error) {
  console.error('Query failed:', error.message);
  process.exit(1);
}

const byId = new Map((data || []).map((v) => [v.id, v]));

for (const row of targetRows) {
  const visit = byId.get(row.visit_id);
  if (!visit) continue;
  const md = visit.extraction_metadata || {};
  const canonical = md?.diagnosisCanonical || {};
  const resolution = md?.diagnosisResolution || {};
  const attempts = Array.isArray(md?.diagnosisAttempts) ? md.diagnosisAttempts : [];
  const candidates = Array.isArray(md?.diagnosisCandidates) ? md.diagnosisCandidates : [];

  const payload = {
    visit_id: visit.id,
    patient_name: visit.patient_name,
    nric: visit.nric,
    visit_date: visit.visit_date,
    pay_type: visit.pay_type,
    answer_diagnosis_code: row.answer_diagnosis_code,
    answer_diagnosis_desc: row.answer_diagnosis_desc,
    stored_diagnosis_desc: visit.diagnosis_description,
    canonical,
    resolution,
    attempts,
    candidates,
  };

  console.log(JSON.stringify(payload, null, 2));
  console.log('---');
}
