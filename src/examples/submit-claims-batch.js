import 'dotenv/config';
import { BrowserManager } from '../utils/browser.js';
import { ClaimSubmitter } from '../core/claim-submitter.js';
import { createSupabaseClient } from '../utils/supabase-client.js';
import { logger } from '../utils/logger.js';
import { registerRunExitHandler, markRunFinalized } from '../utils/run-exit-handler.js';
import {
  getFlow3PortalTargets,
  normalizeFlow3PortalTarget,
  resolveFlow3PortalTarget,
} from '../../apps/crm/src/lib/rpa/portals.shared.js';
import { portalTargetToLabel, writeRunSummaryReport } from '../utils/run-summary-report.js';

function printUsage() {
  console.log(`
Batch submit claims to portals

Usage:
  node src/examples/submit-claims-batch.js --from 2026-02-02 --to 2026-02-07 --portal-only
  node src/examples/submit-claims-batch.js --visit-ids id1,id2,id3
  node src/examples/submit-claims-batch.js --pay-type MHC
  node src/examples/submit-claims-batch.js --portal-targets MHC,ALLIANCE_MEDINET --from 2026-02-02 --to 2026-02-07
  node src/examples/submit-claims-batch.js --mode draft --from 2026-02-02 --to 2026-02-07 --portal-only
  node src/examples/submit-claims-batch.js --all-pending

Options:
  --visit-ids <csv>      Specific visit IDs (comma separated)
  --pay-type <value>     Filter by pay type
  --portal-targets <csv> Restrict Flow 3 submit service routes (MHC,ALLIANCE_MEDINET,ALLIANZ,FULLERTON,IHP,IXCHANGE,GE_NTUC)
  --mode <value>         One of: fill_evidence, draft, submit
  --from <YYYY-MM-DD>    Start date filter
  --to <YYYY-MM-DD>      End date filter
  --portal-only          Only rows in portal scope (MHC/AIA/AVIVA/SINGLIFE + Allianz Medinet tags)
  --save-as-draft        Deprecated alias for --mode draft
  --leave-open           Keep browser open for manual verification
  --all-pending          Explicitly allow unscoped run across all pending rows
  --help, -h             Show this help
`);
}

function parseCliArgs(argv) {
  const opts = {
    visitIds: undefined,
    payType: null,
    portalTargets: undefined,
    mode: 'fill_evidence',
    from: null,
    to: null,
    portalOnly: false,
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
      opts.mode = 'draft';
      continue;
    }
    if (arg.startsWith('--mode=')) {
      opts.mode = arg.split('=')[1] || 'fill_evidence';
      continue;
    }
    if (arg === '--mode') {
      opts.mode = readValue(i);
      i++;
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
    if (arg.startsWith('--portal-targets=')) {
      opts.portalTargets = arg
        .split('=')[1]
        ?.split(',')
        .map(v =>
          String(v || '')
            .trim()
            .toUpperCase()
        )
        .filter(Boolean);
      continue;
    }
    if (arg === '--portal-targets') {
      opts.portalTargets = readValue(i)
        .split(',')
        .map(v =>
          String(v || '')
            .trim()
            .toUpperCase()
        )
        .filter(Boolean);
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

  const normalizedMode = String(opts.mode || 'fill_evidence')
    .trim()
    .toLowerCase();
  if (!['fill_evidence', 'draft', 'submit'].includes(normalizedMode)) {
    throw new Error(
      `Invalid --mode value: ${opts.mode} (expected fill_evidence, draft, or submit)`
    );
  }
  opts.mode = normalizedMode;

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
 *   node src/examples/submit-claims-batch.js --mode draft
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

  const { visitIds, payType, portalTargets, mode, from, to, portalOnly, leaveOpen, allPending } =
    parsed;
  const normalizedPortalTargets = Array.isArray(portalTargets)
    ? [...new Set(portalTargets.map(v => normalizeFlow3PortalTarget(v)).filter(Boolean))]
    : undefined;
  if (
    Array.isArray(portalTargets) &&
    portalTargets.length > 0 &&
    (!normalizedPortalTargets || normalizedPortalTargets.length === 0)
  ) {
    throw new Error(
      `Invalid --portal-targets value. Allowed: ${getFlow3PortalTargets().join(', ')}`
    );
  }
  const droppedPortalTargets = (portalTargets || []).filter(v => !normalizeFlow3PortalTarget(v));
  if (droppedPortalTargets.length > 0) {
    logger.warn(`Ignoring unknown portal targets: ${droppedPortalTargets.join(', ')}`);
  }

  const hasScope = Boolean(
    (Array.isArray(visitIds) && visitIds.length > 0) ||
    payType ||
    from ||
    to ||
    portalOnly ||
    (Array.isArray(normalizedPortalTargets) && normalizedPortalTargets.length > 0)
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
  logger.info(
    `Portal Targets: ${normalizedPortalTargets?.length ? normalizedPortalTargets.join(', ') : 'All routes'}`
  );
  logger.info(`Date Range: ${from || '-'} to ${to || '-'}`);
  logger.info(`Portal Only: ${portalOnly}`);
  logger.info(`Flow 3 Mode: ${mode}`);
  logger.info(`Leave Browser Open: ${leaveOpen}`);

  const supabase = createSupabaseClient();
  if (!supabase) {
    logger.error('Supabase client not available. Check environment variables.');
    process.exit(1);
  }

  const runMetadata = {
    visitIds,
    payType,
    portalTargets: normalizedPortalTargets,
    from,
    to,
    portalOnly,
    mode,
    trigger: 'manual',
  };
  const runId = await startRun(supabase, runMetadata);
  if (runId) {
    const updateRunBound = (id, updates) => updateRun(supabase, id, updates);
    registerRunExitHandler(supabase, runId, updateRunBound);
  }

  const browserManager = new BrowserManager();
  const mhcAsiaPage = await browserManager.newPage();
  const submitter = new ClaimSubmitter(mhcAsiaPage);

  process.env.FLOW3_MODE = mode;
  process.env.WORKFLOW_SAVE_DRAFT = mode === 'draft' ? '1' : '0';
  process.env.ALLOW_LIVE_SUBMIT = mode === 'submit' ? '1' : '0';

  let totalRecords = 0;
  let submittedCount = 0;
  let draftCount = 0;
  let filledOnlyCount = 0;
  let errorCount = 0;
  let notStartedCount = 0;
  const reportRows = [];
  const reportScope = {
    from: from || null,
    to: to || null,
    date: null,
    payType: payType || 'All',
    portalTargets:
      normalizedPortalTargets?.join(',') || (portalOnly ? 'Portal scope' : 'All routes'),
    visitIds: visitIds?.join(',') || null,
  };

  const buildDiagnosisStatus = (visit, result = null) => {
    const flow2Status = String(
      visit?.extraction_metadata?.diagnosisResolution?.status || ''
    ).trim();
    const portalMatch = result?.diagnosisPortalMatch || null;
    const fallbackMode = String(result?.diagnosisFallbackMode?.mode || '').trim();
    if (fallbackMode) {
      return flow2Status
        ? `${flow2Status}; portal_fallback:${fallbackMode}`
        : `portal_fallback:${fallbackMode}`;
    }
    if (portalMatch?.blocked === false) {
      return flow2Status ? `${flow2Status}; portal_matched` : 'portal_matched';
    }
    if (portalMatch?.blocked === true) {
      return flow2Status ? `${flow2Status}; portal_blocked` : 'portal_blocked';
    }
    if (flow2Status) return flow2Status;
    const reason = String(result?.reason || '').toLowerCase();
    if (reason.includes('diagnosis')) return reason;
    return '-';
  };

  const buildPortalLabel = (visit, result = null) => {
    const route = resolveFlow3PortalTarget(
      visit?.pay_type || null,
      visit?.patient_name || null,
      visit?.extraction_metadata || null
    );
    const hinted =
      normalizeFlow3PortalTarget(result?.portalService || result?.portal || null) ||
      normalizeFlow3PortalTarget(route || null) ||
      route ||
      result?.portalService ||
      result?.portal ||
      visit?.pay_type ||
      'Unknown';
    return portalTargetToLabel(hinted);
  };

  const isDeterministicPortalBlocked = result => {
    const blockedReason = String(result?.blocked_reason || result?.reason || '')
      .trim()
      .toLowerCase();
    return new Set([
      'portal_auth_failed',
      'portal_contract_unvalidated',
      'portal_credentials_missing',
      'portal_login_failed',
      'portal_otp_required',
      'portal_read_only_no_claim_form',
      'portal_search_failed',
      'portal_session_expired',
      'portal_session_conflict',
      'portal_timeout',
      'policy_verified_no_claim_form',
      'member_not_found',
      'not_found',
      'otp_required',
    ]).has(blockedReason);
  };

  const buildFlow3VerificationNotes = result => {
    if (!result || typeof result !== 'object') return '';
    const bits = [];

    const verification =
      result.fillVerification && typeof result.fillVerification === 'object'
        ? result.fillVerification
        : null;
    if (verification) {
      const summary = ['visitDate', 'diagnosis', 'fee']
        .map(field => `${field}:${String(verification?.[field]?.status || 'n/a')}`)
        .join(', ');
      bits.push(`verified=${summary}`);
      const failedRequired = Array.isArray(result?.requiredFieldGate?.failed)
        ? result.requiredFieldGate.failed
        : [];
      if (failedRequired.length > 0) {
        bits.push(`required_failed=${failedRequired.join('|')}`);
      }
    }

    const comparison =
      result.comparison && typeof result.comparison === 'object' ? result.comparison : null;
    if (comparison) {
      const state = String(comparison.state || 'unavailable');
      bits.push(`compare=${state}`);
      if (comparison.botVsSubmittedTruth?.state) {
        bits.push(`bot_vs_truth=${String(comparison.botVsSubmittedTruth.state)}`);
      }
      if (comparison.flow2VsSubmittedTruth?.state) {
        bits.push(`flow2_vs_truth=${String(comparison.flow2VsSubmittedTruth.state)}`);
      }
      const mismatched = Array.isArray(comparison.mismatchedFields)
        ? comparison.mismatchedFields
            .map(item => (typeof item === 'string' ? item : item?.field))
            .filter(Boolean)
        : [];
      if (mismatched.length > 0) {
        bits.push(`compare_mismatch=${mismatched.join('|')}`);
      } else if (comparison.unavailableReason) {
        bits.push(`compare_reason=${String(comparison.unavailableReason)}`);
      }
    }

    const mismatchCategories = Array.isArray(result.mismatchCategories)
      ? result.mismatchCategories.filter(Boolean)
      : [];
    if (mismatchCategories.length > 0) {
      bits.push(`mismatch_categories=${mismatchCategories.join('|')}`);
    }

    if (result.evidence) {
      bits.push(`evidence=${String(result.evidence)}`);
    }
    if (result.sessionState) {
      bits.push(`session=${String(result.sessionState)}`);
    }
    return bits.join(' ; ');
  };

  const buildFlow3StructuredSummary = result => {
    if (!result || typeof result !== 'object') {
      return {
        fillVerification: '-',
        comparison: '-',
        botSnapshot: '-',
        submittedTruth: '-',
        flow2VsSubmittedTruth: '-',
        botVsSubmittedTruth: '-',
        blockedReason: '-',
        evidence: '-',
      };
    }
    const verification =
      result.fillVerification && typeof result.fillVerification === 'object'
        ? result.fillVerification
        : null;
    const fillVerification = verification
      ? ['visitDate', 'diagnosis', 'fee']
          .map(field => `${field}:${String(verification?.[field]?.status || 'n/a')}`)
          .join(', ')
      : '-';

    const comparisonObject =
      result.comparison && typeof result.comparison === 'object' ? result.comparison : null;
    const comparison = comparisonObject
      ? (() => {
          const state = String(comparisonObject.state || 'unavailable');
          const mismatched = Array.isArray(comparisonObject.mismatchedFields)
            ? comparisonObject.mismatchedFields
                .map(item => (typeof item === 'string' ? item : item?.field))
                .filter(Boolean)
            : [];
          return mismatched.length > 0 ? `${state} (${mismatched.join('|')})` : state;
        })()
      : '-';
    const botSnapshot = result.botSnapshot ? 'captured' : '-';
    const submittedTruth =
      result.submittedTruthSnapshot || result.submittedTruthCapture?.found === true
        ? 'captured'
        : result.submittedTruthCapture?.found === false
          ? `unavailable:${String(result.submittedTruthCapture.reason || 'unknown')}`
          : '-';
    const flow2VsSubmittedTruth = comparisonObject?.flow2VsSubmittedTruth?.state || '-';
    const botVsSubmittedTruth = comparisonObject?.botVsSubmittedTruth?.state || '-';
    const blockedReason =
      result.blocked_reason ||
      result.blockedReason ||
      result.reason ||
      comparisonObject?.unavailableReason ||
      '-';
    const evidence = result.evidence ? String(result.evidence) : '-';
    const mismatchCategories =
      Array.isArray(result.mismatchCategories) && result.mismatchCategories.length
        ? result.mismatchCategories.join('|')
        : '-';

    return {
      fillVerification,
      comparison: mismatchCategories !== '-' ? `${comparison}; ${mismatchCategories}` : comparison,
      botSnapshot,
      submittedTruth,
      flow2VsSubmittedTruth,
      botVsSubmittedTruth,
      blockedReason: String(blockedReason || '-'),
      evidence,
    };
  };

  try {
    // Get visits to submit (either specific IDs or all pending)
    const visits = await submitter.getPendingClaims(payType, visitIds, {
      from,
      to,
      portalOnly,
      portalTargets: normalizedPortalTargets,
    });

    totalRecords = visits.length;
    logger.info(`Found ${totalRecords} visit(s) to process`);

    await updateRun(supabase, runId, { total_records: totalRecords });

    for (let i = 0; i < visits.length; i++) {
      const visit = visits[i];
      logger.info(
        `[${i + 1}/${visits.length}] Processing: ${visit.patient_name} (${visit.pay_type})`
      );

      let rowStatus = 'error';
      let rowNotes = '';
      let rowResult = null;
      try {
        const result = await submitter.submitClaim(visit);
        rowResult = result;

        if (result.success) {
          if (result.savedAsDraft) {
            draftCount++;
            rowStatus = 'draft';
            rowNotes = 'Draft saved in portal';
          } else if (result.submitted) {
            submittedCount++;
            rowStatus = 'submitted';
            rowNotes = 'Submitted in portal';
          } else {
            // Fill + evidence run (no draft/submission).
            filledOnlyCount++;
            rowStatus = 'filled_evidence';
            rowNotes = 'Fill + evidence mode (no save/submission)';
          }
          const verificationNotes = buildFlow3VerificationNotes(result);
          if (verificationNotes) {
            rowNotes = rowNotes ? `${rowNotes} ; ${verificationNotes}` : verificationNotes;
          }
        } else if (result.reason === 'not_found') {
          notStartedCount++;
          logger.warn(`Member not found in portal: ${visit.patient_name} (${visit.pay_type})`);
          rowStatus = 'not_found';
          rowNotes = result.error || result.reason || 'Member not found in portal';
        } else if (isDeterministicPortalBlocked(result)) {
          notStartedCount++;
          const blockedReason = result.blocked_reason || result.reason || 'portal_blocked';
          logger.warn(`Portal blocked before fill: ${blockedReason}`);
          rowStatus = 'not_started';
          rowNotes = result.error || blockedReason;
          const verificationNotes = buildFlow3VerificationNotes(result);
          if (verificationNotes) {
            rowNotes = rowNotes ? `${rowNotes} ; ${verificationNotes}` : verificationNotes;
          }
        } else if (result.reason === 'not_implemented' || result.reason === 'unknown_pay_type') {
          notStartedCount++;
          rowStatus = 'not_started';
          rowNotes = result.error || result.reason || 'Portal flow not implemented';
          if (result.reason === 'unknown_pay_type') {
            logger.warn(`Unsupported/unknown pay type: ${visit.pay_type}`);
          } else {
            const portalService = String(
              result.portalService || result.portal || result.route || 'unknown'
            ).toUpperCase();
            logger.warn(
              `Portal service not implemented: ${portalService} (pay type: ${visit.pay_type})`
            );
          }
        } else {
          errorCount++;
          logger.error(`Failed to submit: ${result.error || result.reason}`);
          rowStatus = 'error';
          rowNotes = result.error || result.reason || 'Submission failed';
          const verificationNotes = buildFlow3VerificationNotes(result);
          if (verificationNotes) {
            rowNotes = rowNotes ? `${rowNotes} ; ${verificationNotes}` : verificationNotes;
          }
        }
      } catch (error) {
        errorCount++;
        logger.error(`Error submitting claim: ${error.message}`);
        rowStatus = 'error';
        rowNotes = error.message;
      }

      reportRows.push({
        ...buildFlow3StructuredSummary(rowResult),
        date: visit.visit_date || '-',
        patientName: visit.patient_name || '-',
        nric: visit.nric || '-',
        payType: visit.pay_type || '-',
        portal: buildPortalLabel(visit, rowResult),
        status: rowStatus,
        diagnosisStatus: buildDiagnosisStatus(visit, rowResult),
        notes: rowNotes,
      });

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
    logger.info(`Filled + evidence: ${filledOnlyCount}`);
    logger.info(`Errors: ${errorCount}`);
    logger.info(`Not Started (unsupported): ${notStartedCount}`);

    const report = await writeRunSummaryReport({
      flowName: 'Flow 3 Claim Submission',
      filePrefix: 'flow3',
      scope: reportScope,
      totals: {
        total: totalRecords,
        submitted: submittedCount,
        drafts: draftCount,
        filled_evidence: filledOnlyCount,
        errors: errorCount,
        not_started: notStartedCount,
      },
      rows: reportRows.length
        ? reportRows
        : [
            {
              date: `${from || '-'}..${to || '-'}`,
              patientName: '-',
              nric: '-',
              payType: payType || '-',
              portal: '-',
              status: 'no_records',
              diagnosisStatus: '-',
              notes: 'No visits matched run scope',
            },
          ],
    });
    logger.info(`Flow 3 summary report: ${report.mdPath}`);

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
    reportRows.push({
      date: `${from || '-'}..${to || '-'}`,
      patientName: '-',
      nric: '-',
      payType: payType || '-',
      portal: '-',
      status: 'fatal_error',
      diagnosisStatus: '-',
      notes: error?.message || String(error),
    });
    const report = await writeRunSummaryReport({
      flowName: 'Flow 3 Claim Submission',
      filePrefix: 'flow3',
      scope: reportScope,
      totals: {
        total: totalRecords,
        submitted: submittedCount,
        drafts: draftCount,
        filled_evidence: filledOnlyCount,
        errors: errorCount,
        not_started: notStartedCount,
      },
      rows: reportRows,
    });
    logger.info(`Flow 3 summary report: ${report.mdPath}`);
    await updateRun(supabase, runId, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      total_records: totalRecords,
      completed_count: submittedCount + draftCount,
      failed_count: errorCount,
      error_message: error.message || String(error),
    });
    markRunFinalized();
    // Close browser before exiting to prevent orphaned Chromium processes on VPS
    await browserManager.close().catch(closeErr => {
      logger.warn('[BATCH] Failed to close browser on error path', { error: closeErr?.message });
    });
    process.exit(1);
  } finally {
    if (leaveOpen) {
      logger.info('Leaving browser open for manual verification. Press Ctrl+C to exit.');
      // Keep the Node process alive so the Playwright browser stays open.
      // (The run was already finalized above; this is strictly for human inspection.)
      await new Promise(() => {});
    } else {
      await browserManager.close().catch(() => {});
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
