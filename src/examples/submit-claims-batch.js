import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClaimSubmitter } from '../core/claim-submitter.js';
import { createSupabaseClient } from '../utils/supabase-client.js';
import { logger } from '../utils/logger.js';
import { registerRunExitHandler, markRunFinalized } from '../utils/run-exit-handler.js';

dotenv.config();

/**
 * Batch submit claims to portals
 * 
 * Usage:
 *   node src/examples/submit-claims-batch.js
 *   node src/examples/submit-claims-batch.js --visit-ids id1,id2,id3
 *   node src/examples/submit-claims-batch.js --pay-type MHC
 *   node src/examples/submit-claims-batch.js --save-as-draft
 */
async function submitClaimsBatch() {
  const args = process.argv.slice(2);
  const visitIdsArg = args.find(arg => arg.startsWith('--visit-ids='))?.split('=')[1] || 
                     (args.includes('--visit-ids') && args[args.indexOf('--visit-ids') + 1]);
  const payTypeArg = args.find(arg => arg.startsWith('--pay-type='))?.split('=')[1] || 
                    (args.includes('--pay-type') && args[args.indexOf('--pay-type') + 1]);
  const saveAsDraft = args.includes('--save-as-draft');

  const visitIds = visitIdsArg ? visitIdsArg.split(',').filter(Boolean) : undefined;
  const payType = payTypeArg || null;

  logger.info('=== Batch Claim Submission ===');
  logger.info(`Visit IDs: ${visitIds ? visitIds.join(', ') : 'All pending'}`);
  logger.info(`Pay Type: ${payType || 'All'}`);
  logger.info(`Save as Draft: ${saveAsDraft}`);

  const supabase = createSupabaseClient();
  if (!supabase) {
    logger.error('Supabase client not available. Check environment variables.');
    process.exit(1);
  }

  const runMetadata = { visitIds, payType, saveAsDraft, trigger: 'manual' };
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
  let errorCount = 0;
  let notStartedCount = 0;

  try {
    // Get visits to submit (either specific IDs or all pending)
    const visits = await submitter.getPendingClaims(payType, visitIds);

    totalRecords = visits.length;
    logger.info(`Found ${totalRecords} visit(s) to process`);

    await updateRun(supabase, runId, { total_records: totalRecords });

    for (let i = 0; i < visits.length; i++) {
      const visit = visits[i];
      logger.info(`[${i + 1}/${visits.length}] Processing: ${visit.patient_name} (${visit.pay_type})`);

      try {
        const result = await submitter.submitClaim(visit);
        
        if (result.success) {
          if (result.savedAsDraft) {
            draftCount++;
          } else {
            submittedCount++;
          }
        } else if (result.reason === 'not_implemented') {
          notStartedCount++;
          logger.warn(`Portal not implemented for pay type: ${visit.pay_type}`);
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
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    logger.info('\n=== Submission Summary ===');
    logger.info(`Total: ${totalRecords}`);
    logger.info(`Submitted: ${submittedCount}`);
    logger.info(`Drafts: ${draftCount}`);
    logger.info(`Errors: ${errorCount}`);
    logger.info(`Not Started (unsupported): ${notStartedCount}`);

    await updateRun(supabase, runId, {
      status: 'completed',
      finished_at: new Date().toISOString(),
      total_records: totalRecords,
      completed_count: submittedCount + draftCount,
      failed_count: errorCount,
      metadata: { ...runMetadata, submittedCount, draftCount, errorCount, notStartedCount },
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
    await browserManager.close();
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
    const { error } = await supabase
      .from('rpa_extraction_runs')
      .update(updates)
      .eq('id', runId);
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
