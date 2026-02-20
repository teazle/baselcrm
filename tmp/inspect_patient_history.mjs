import dotenv from 'dotenv';
import { createSupabaseClient } from '../src/utils/supabase-client.js';

dotenv.config();
const supabase = createSupabaseClient();
const nric = 'S8570522I';
const { data, error } = await supabase
  .from('visits')
  .select('id,visit_date,pay_type,diagnosis_description,total_amount,extraction_metadata')
  .eq('nric', nric)
  .order('visit_date', { ascending: false })
  .limit(50);
if (error) {
  console.error(error.message);
  process.exit(1);
}
console.log(JSON.stringify(data, null, 2));
