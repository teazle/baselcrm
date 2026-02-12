import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClaimSubmitter } from '../core/claim-submitter.js';
import { createSupabaseClient } from '../utils/supabase-client.js';
import { logger } from '../utils/logger.js';
import { registerRunExitHandler, markRunFinalized } from '../utils/run-exit-handler.js';

dotenv.config();

function printUsage() {
  console.log(`
Batch submit claims to portals

Usage:
  node src/examples/submit-claims-batch.js --from 2026-02-02 --to 2026-02-07 --portal-only
  node src/examples/submit-claims-batch.js --visit-ids id1,id2,id3
  node src/examples/submit-claims-batch.js --pay-type MHC
  node src/examples/submit-claims-batch.js --save-as-draft --from 2026-02-02 --to 2026-02-07 --portal-only
  node src/examples/submit-claims-batch.js --all-pending

Options:
  --visit-ids <csv>      Specific visit IDs (comma separated)
  --pay-type <value>     Filter by pay type
  --from <YYYY-MM-DD>    Start date filter
  --to <YYYY-MM-DD>      End date filter
  --portal-only          Only rows in portal scope (MHC/AIA/AVIVA/SINGLIFE + Allianz Medinet tags)
  --save-as-draft        Click "Save as Draft" after fill
  --leave-open           Keep browser open for manual verification
  --all-pending          Explicitly allow unscoped run across all pending rows
  --help, -h             Show this help
`);
}

function parseCliArgs(argv) {
  const opts = {
    visitIds: undefined,
    payType: null,
    from: null,
    to: null,
    portalOnly: false,
    saveAsDraft: false,
    leaveOpen: process.env.BROWSER_LEAVE_OPEN === '1',
    allPending: false,
    help: false,
  };

  const readValue = i => {
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for ${argv[i]}`);
    }
    return next;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    if (arg === '--portal-only') {
      opts.portalOnly = true;
      continue;
    }
    if (arg === '--save-as-draft') {
      opts.saveAsDraft = true;
      continue;
    }
    if (arg === '--leave-open') {
      opts.leaveOpen = true;
      continue;
    }
    if (arg === '--all-pending') {
      opts.allPending = true;
      continue;
    }
    if (arg.startsWith('--visit-ids=')) {
      opts.visitIds = arg.split('=')[1]?.split(',').filter(Boolean) || undefined;
      continue;
    }
    if (arg === '--visit-ids') {
      opts.visitIds = readValue(i).split(',').filter(Boolean);
      i++;
      continue;
    }
    if (arg.startsWith('--pay-type=')) {
      opts.payType = arg.split('=')[1] || null;
      continue;
    }
    if (arg === '--pay-type') {
      opts.payType = readValue(i);
      i++;
      continue;
    }
    if (arg.startsWith('--from=')) {
      opts.from = arg.split('=')[1] || null;
      continue;
    }
    if (arg === '--from') {
      opts.from = readValue(i);
      i++;
      continue;
    }
    if (arg.startsWith('--to=')) {
      opts.to = arg.split('=')[1] || null;
      continue;
    }
    if (arg === '--to') {
      opts.to = readValue(i);
      i++;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (opts.from && !dateRe.test(opts.from)) {
    throw new Error(`Invalid --from date format: ${opts.from} (expected YYYY-MM-DD)`);
  }
  if (opts.to && !dateRe.test(opts.to)) {
    throw new Error(`Invalid --to date format: ${opts.to} (expected YYYY-MM-DD)`);
  }

  return opts;
}

/**
 * Batch submit claims to portals
 *
 * Usage:
 *   node src/examples/submit-claims-batch.js
 *   node src/examples/submit-claims-batch.js --visit-ids id1,id2,id3
 *   node src/examples/submit-claims-batch.js --pay-type MHC
 *   node src/examples/submit-claims-batch.js --from 2026-02-02 --to 2026-02-07 --portal-only
 *   node src/examples/submit-claims-batch.js --save-as-draft
 */
async function submitClaimsBatch() {
  let parsed;
  try {
    parsed = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    logger.error(error.message);
    printUsage();
    process.exit(2);
  }

  if (parsed.help) {
    printUsage();
    return;
  }

  const { visitIds, payType, from, to, portalOnly, saveAsDraft, leaveOpen, allPending } = parsed;

  const hasScope = Boolean(
    (Array.isArray(visitIds) && visitIds.length > 0) || payType || from || to || portalOnly
  );
  if (!hasScope && !allPending) {
    logger.error(
      'Refusing unscoped batch run. Add --from/--to and/or --portal-only, or pass --all-pending explicitly.'
    );
    printUsage();
    process.exit(2);
  }

  logger.info('=== Batch Claim Submission ===');
  logger.info(
    `Visit IDs: ${visitIds ? visitIds.join(', ') : allPending ? 'All pending (explicit)' : 'Scoped query'}`
  );
  logger.info(`Pay Type: ${payType || 'All'}`);
  logger.info(`Date Range: ${from || '-'} to ${to || '-'}`);
  logger.info(`Portal Only: ${portalOnly}`);
  logger.info(`Save as Draft: ${saveAsDraft}`);
  logger.info(`Leave Browser Open: ${leaveOpen}`);

  const supabase = createSupabaseClient();
  if (!supabase) {
    logger.error('Supabase client not available. Check environment variables.');
    process.exit(1);
  }

  const runMetadata = { visitIds, payType, from, to, portalOnly, saveAsDraft, trigger: 'manual' };
  const runId = await startRun(supabase, runMetadata);
  if (runId) {
    const updateRunBound = (id, updates) => updateRun(supabase, id, updates);
    registerRunExitHandler(supabase, runId, updateRunBound);
  }

  const browserManager = new BrowserManager();
  const mhcAsiaPage = await browserManager.newPage();
  const submitter = new ClaimSubmitter(mhcAsiaPage);

  // Set environment variable for draft saving
  if (saveAsDraft) {
    process.env.WORKFLOW_SAVE_DRAFT = '1';
  } else {
    process.env.WORKFLOW_SAVE_DRAFT = '0';
  }

  let totalRecords = 0;
  let submittedCount = 0;
  let draftCount = 0;
  let filledOnlyCount = 0;
  let errorCount = 0;
  let notStartedCount = 0;

  try {
    // Get visits to submit (either specific IDs or all pending)
    const visits = await submitter.getPendingClaims(payType, visitIds, { from, to, portalOnly });

    totalRecords = visits.length;
    logger.info(`Found ${totalRecords} visit(s) to process`);

    await updateRun(supabase, runId, { total_records: totalRecords });

    for (let i = 0; i < visits.length; i++) {
      const visit = visits[i];
      logger.info(
        `[${i + 1}/${visits.length}] Processing: ${visit.patient_name} (${visit.pay_type})`
      );

      try {
        const result = await submitter.submitClaim(visit);

        if (result.success) {
          if (result.savedAsDraft) {
            draftCount++;
          } else if (result.submitted) {
            submittedCount++;
          } else {
            // Fill-only verification run (no draft/submission).
            filledOnlyCount++;
          }
        } else if (result.reason === 'not_found') {
          notStartedCount++;
          logger.warn(`Member not found in portal: ${visit.patient_name} (${visit.pay_type})`);
        } else if (result.reason === 'not_implemented' || result.reason === 'unknown_pay_type') {
          notStartedCount++;
          if (result.reason === 'unknown_pay_type') {
            logger.warn(`Unsupported/unknown pay type: ${visit.pay_type}`);
          } else {
            logger.warn(`Portal not implemented for pay type: ${visit.pay_type}`);
          }
        } else {
          errorCount++;
          logger.error(`Failed to submit: ${result.error || result.reason}`);
        }
      } catch (error) {
        errorCount++;
        logger.error(`Error submitting claim: ${error.message}`);
      }

      await updateRun(supabase, runId, {
        completed_count: submittedCount + draftCount,
        failed_count: errorCount,
      });

      // Small delay between submissions
      await new Promise(resolve => globalThis.setTimeout(resolve, 2000));
    }

    logger.info('\n=== Submission Summary ===');
    logger.info(`Total: ${totalRecords}`);
    logger.info(`Submitted: ${submittedCount}`);
    logger.info(`Drafts: ${draftCount}`);
    logger.info(`Filled only (no DB update): ${filledOnlyCount}`);
    logger.info(`Errors: ${errorCount}`);
    logger.info(`Not Started (unsupported): ${notStartedCount}`);

    await updateRun(supabase, runId, {
      status: 'completed',
      finished_at: new Date().toISOString(),
      total_records: totalRecords,
      completed_count: submittedCount + draftCount + filledOnlyCount,
      failed_count: errorCount,
      metadata: {
        ...runMetadata,
        submittedCount,
        draftCount,
        filledOnlyCount,
        errorCount,
        notStartedCount,
      },
    });
    markRunFinalized();
  } catch (error) {
    logger.error('Fatal error during submission:', error);
    await updateRun(supabase, runId, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      total_records: totalRecords,
      completed_count: submittedCount + draftCount,
      failed_count: errorCount,
      error_message: error.message || String(error),
    });
    markRunFinalized();
    process.exit(1);
  } finally {
    if (leaveOpen) {
      logger.info('Leaving browser open for manual verification. Press Ctrl+C to exit.');
      // Keep the Node process alive so the Playwright browser stays open.
      // (The run was already finalized above; this is strictly for human inspection.)
      await new Promise(() => {});
    } else {
      await browserManager.close();
    }
  }
}

async function startRun(supabase, metadata) {
  try {
    const { data, error } = await supabase
      .from('rpa_extraction_runs')
      .insert({
        run_type: 'claim_submission',
        status: 'running',
        started_at: new Date().toISOString(),
        metadata,
      })
      .select('id')
      .single();
    if (error) {
      logger.error('[SUBMIT-BATCH] Failed to create run record', { error: error.message });
      return null;
    }
    return data?.id ?? null;
  } catch (error) {
    logger.error('[SUBMIT-BATCH] Error creating run record', { error: error.message });
    return null;
  }
}

async function updateRun(supabase, runId, updates) {
  if (!supabase || !runId) return;
  try {
    const { error } = await supabase.from('rpa_extraction_runs').update(updates).eq('id', runId);
    if (error) {
      logger.error('[SUBMIT-BATCH] Failed to update run record', { error: error.message });
    }
  } catch (error) {
    logger.error('[SUBMIT-BATCH] Error updating run record', { error: error.message });
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  submitClaimsBatch().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { submitClaimsBatch };
