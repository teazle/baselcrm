import dotenv from 'dotenv';
import { createSupabaseClient } from '../src/utils/supabase-client.js';

dotenv.config();
const supabase = createSupabaseClient();
const id = '60e0c382-d6cb-4d35-a5b9-e17ce5b20c73';
const { data, error } = await supabase
  .from('visits')
  .select('*')
  .eq('id', id)
  .single();
if (error) {
  console.error(error.message);
  process.exit(1);
}
console.log(JSON.stringify(data, null, 2));
