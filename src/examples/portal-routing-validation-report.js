import 'dotenv/config';
import { createSupabaseClient } from '../utils/supabase-client.js';
import { writeRunSummaryReport, portalTargetToLabel } from '../utils/run-summary-report.js';
import { describePortalRouting } from '../../apps/crm/src/lib/rpa/portals.shared.js';

function parseArgs(argv) {
  const opts = { from: null, to: null, limit: null };
  const readValue = index => {
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${argv[index]}`);
    return next;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--from') {
      opts.from = readValue(i);
      i += 1;
      continue;
    }
    if (arg.startsWith('--from=')) {
      opts.from = arg.slice('--from='.length);
      continue;
    }
    if (arg === '--to') {
      opts.to = readValue(i);
      i += 1;
      continue;
    }
    if (arg.startsWith('--to=')) {
      opts.to = arg.slice('--to='.length);
      continue;
    }
    if (arg === '--limit') {
      opts.limit = Number.parseInt(readValue(i), 10);
      i += 1;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      opts.limit = Number.parseInt(arg.slice('--limit='.length), 10);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (opts.from && !dateRe.test(opts.from)) throw new Error(`Invalid --from: ${opts.from}`);
  if (opts.to && !dateRe.test(opts.to)) throw new Error(`Invalid --to: ${opts.to}`);
  if (opts.limit !== null && (!Number.isInteger(opts.limit) || opts.limit <= 0)) {
    throw new Error(`Invalid --limit: ${opts.limit}`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const supabase = createSupabaseClient();
  if (!supabase) throw new Error('Supabase client not available');

  let query = supabase
    .from('visits')
    .select('pay_type,patient_name,extraction_metadata')
    .eq('source', 'Clinic Assist')
    .order('pay_type', { ascending: true });
  if (opts.from) query = query.gte('visit_date', opts.from);
  if (opts.to) query = query.lte('visit_date', opts.to);
  if (opts.limit) query = query.limit(opts.limit);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch visits: ${error.message}`);

  const byPayType = new Map();
  for (const visit of data || []) {
    const key = String(visit?.pay_type || '').trim() || '(blank)';
    if (!byPayType.has(key)) byPayType.set(key, visit);
  }

  const rows = [...byPayType.entries()].map(([payType, sample]) => {
    const routing = describePortalRouting(
      payType,
      sample?.patient_name || null,
      sample?.extraction_metadata || null
    );
    return {
      date: '-',
      patientName: '-',
      nric: '-',
      payType,
      portal: routing.portalTarget ? portalTargetToLabel(routing.portalTarget) : '-',
      portalTarget: routing.portalTarget || '-',
      routingSource: routing.portalRoutingSource || routing.source || '-',
      routingTag: routing.portalTag || '-',
      routingReason: routing.reason || 'portal_unknown',
      status: routing.portalTarget ? 'mapped' : 'blocked',
      diagnosisStatus: '-',
      fillVerification: '-',
      comparison: '-',
      botSnapshot: '-',
      submittedTruth: '-',
      flow2VsSubmittedTruth: '-',
      botVsSubmittedTruth: '-',
      blockedReason: routing.portalTarget ? '-' : routing.reason || 'portal_unknown',
      evidence: '-',
      notes: routing.reason || '-',
    };
  });

  const mapped = rows.filter(row => row.status === 'mapped').length;
  const blocked = rows.length - mapped;
  const report = await writeRunSummaryReport({
    flowName: 'Portal Routing Validation',
    filePrefix: 'portal_routing_validation',
    scope: {
      from: opts.from || null,
      to: opts.to || null,
      payType: 'All distinct Clinic Assist pay_type values',
      limit: opts.limit || null,
    },
    totals: {
      distinctPayTypes: rows.length,
      mapped,
      blocked,
    },
    rows,
  });

  console.log(JSON.stringify({ ...report, distinctPayTypes: rows.length, mapped, blocked }));
}

main().catch(error => {
  console.error(error?.message || String(error));
  process.exit(1);
});
