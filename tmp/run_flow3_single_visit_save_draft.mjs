import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { ClaimSubmitter } from '../src/core/claim-submitter.js';
import { createSupabaseClient } from '../src/utils/supabase-client.js';

const visitId = process.argv[2];
if (!visitId) {
  console.error('Usage: node tmp/run_flow3_single_visit_save_draft.mjs <visit-id>');
  process.exit(2);
}

process.env.WORKFLOW_SAVE_DRAFT = '1';
process.env.ALLOW_LIVE_SUBMIT = process.env.ALLOW_LIVE_SUBMIT || '0';

const supabase = createSupabaseClient();
const { data: visit, error } = await supabase
  .from('visits')
  .select('*')
  .eq('id', visitId)
  .single();

if (error || !visit) {
  console.error(`Visit not found: ${visitId}`, error?.message || '');
  process.exit(1);
}

const browser = new BrowserManager();
const page = await browser.newPage();
const submitter = new ClaimSubmitter(page);

try {
  const result = await submitter.submitClaim(visit);
  console.log(JSON.stringify({ visitId, result }, null, 2));
} finally {
  await browser.close();
}
