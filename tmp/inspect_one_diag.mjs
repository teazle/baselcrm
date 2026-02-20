import dotenv from 'dotenv';
import { createSupabaseClient } from '../src/utils/supabase-client.js';

dotenv.config();
const supabase = createSupabaseClient();
const id = 'c3c483d2-83d4-46be-936e-77767dd568b3';
const { data, error } = await supabase
  .from('visits')
  .select('id,patient_name,visit_date,diagnosis_description,extraction_metadata')
  .eq('id', id)
  .single();
if (error) {
  console.error(error.message);
  process.exit(1);
}
console.log(JSON.stringify({
  id: data.id,
  patient_name: data.patient_name,
  visit_date: data.visit_date,
  diagnosis_description: data.diagnosis_description,
  diagnosisCanonical: data.extraction_metadata?.diagnosisCanonical || null,
  diagnosisResolution: data.extraction_metadata?.diagnosisResolution || null,
  diagnosisCandidates: data.extraction_metadata?.diagnosisCandidates || [],
  diagnosisAttempts: data.extraction_metadata?.diagnosisAttempts || [],
}, null, 2));
