import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { VisitDetailsExtractor } from '../core/visit-details-extractor.js';
import { createSupabaseClient } from '../utils/supabase-client.js';
import { logger } from '../utils/logger.js';
import {
  getPortalPayTypes,
  getPortalScopeOrFilter,
  resolveFlow3PortalTarget,
} from '../../apps/crm/src/lib/rpa/portals.shared.js';
import { portalTargetToLabel, writeRunSummaryReport } from '../utils/run-summary-report.js';

dotenv.config();

/**
 * Extract visit details (diagnosis, medicines, MC, charge type) for visits that have not been enhanced yet
 * Supports resume capability and progress tracking
 *
 * Usage:
 *   node src/examples/extract-visit-details-batch.js
 *   node src/examples/extract-visit-details-batch.js --retry-failed
 *   node src/examples/extract-visit-details-batch.js --visit-ids id1,id2,id3 --force
 *   node src/examples/extract-visit-details-batch.js --from 2026-02-02 --to 2026-02-07 --force
 */
async function extractVisitDetailsBatch() {
  const args = process.argv.slice(2);
  const getArgValue = name => {
    const prefixed = `${name}=`;
    const fromEquals = args.find(arg => arg.startsWith(prefixed));
    if (fromEquals) {
      return fromEquals.slice(prefixed.length);
    }
    const idx = args.indexOf(name);
    if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) {
      return args[idx + 1];
    }
    return null;
  };
  const retryFailed = args.includes('--retry-failed');
  const force = args.includes('--force');
  const visitIdsArg = getArgValue('--visit-ids');
  const visitIds = visitIdsArg
    ? visitIdsArg
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : null;

  logger.info('=== Visit Details Extraction Batch ===');
  if (retryFailed) {
    logger.info('Mode: Retry failed visits');
  }
  if (force) {
    logger.info('Mode: Force re-extract (includes completed visits)');
  }

  // Initialize Supabase client
  const supabase = createSupabaseClient();
  if (!supabase) {
    logger.error('Supabase client not available. Check environment variables.');
    process.exit(1);
  }

  // Query for visits to enhance (Flow 2). We key off extraction_metadata.detailsExtractionStatus
  // instead of diagnosis_description, because Flow 1 may already populate diagnosis_description
  // from the queue/visit notes, but Flow 2 is still required for diagnosis code, medicines, MC, etc.
  logger.info('Querying database for visits needing enhancement...');

  const batchSize = parseInt(process.env.VISIT_DETAILS_BATCH_SIZE || '100', 10);
  const maxRetries = parseInt(process.env.VISIT_DETAILS_MAX_RETRIES || '3', 10);

  // Build query: visits for enhancement, with status filtering for resume
  // Filter to specific date if specified via --date argument
  // Filter to portal-related pay types/tags from shared routing config.
  const targetDate = getArgValue('--date');
  const fromDate = getArgValue('--from');
  const toDate = getArgValue('--to');
  const targetPayType = getArgValue('--pay-type')?.toUpperCase() || null;
  const allPayTypes = args.includes('--all-pay-types');
  const reportRows = [];
  let reportTotals = {
    total_candidates: 0,
    to_process: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    skipped_precheck: 0,
  };

  const buildPortalLabel = visit => {
    const target = resolveFlow3PortalTarget(
      visit?.pay_type || null,
      visit?.patient_name || null,
      visit?.extraction_metadata || null
    );
    return portalTargetToLabel(target || visit?.pay_type || 'Unknown');
  };

  const buildDiagnosisStatus = (visit, result = null) => {
    const resultStatus = String(result?.diagnosisResolution?.status || '').trim();
    const metaStatus = String(visit?.extraction_metadata?.diagnosisResolution?.status || '').trim();
    const status = resultStatus || metaStatus;
    if (status) return status;
    const diagnosis = String(result?.diagnosis || visit?.diagnosis_description || '').trim();
    if (!diagnosis || /^missing diagnosis$/i.test(diagnosis)) return 'missing';
    return '-';
  };

  // Known portal pay types that require form submission.
  const portalPayTypes = getPortalPayTypes();
  const reportScope = {
    from: fromDate || null,
    to: toDate || null,
    date: targetDate || null,
    payType: targetPayType || (allPayTypes ? 'All' : 'Portal scope'),
    portalTargets: allPayTypes ? 'All' : portalPayTypes.join(','),
    visitIds: visitIds?.join(',') || null,
  };

  let query = supabase
    .from('visits')
    .select('id, patient_name, visit_date, visit_record_no, nric, pay_type, extraction_metadata')
    .eq('source', 'Clinic Assist')
    .not('patient_name', 'is', null);

  if (visitIds?.length) {
    query = query.in('id', visitIds);
    logger.info(`Filtering to visit IDs: ${visitIds.join(', ')}`);
  }

  if (targetDate) {
    query = query.eq('visit_date', targetDate);
    logger.info(`Filtering to date: ${targetDate}`);
  } else if (fromDate || toDate) {
    if (fromDate) {
      query = query.gte('visit_date', fromDate);
      logger.info(`Filtering from date: ${fromDate}`);
    }
    if (toDate) {
      query = query.lte('visit_date', toDate);
      logger.info(`Filtering to date: ${toDate}`);
    }
  }

  // Filter by specific pay type, or only portal pay types by default
  if (targetPayType) {
    query = query.eq('pay_type', targetPayType);
    logger.info(`Filtering to pay type: ${targetPayType}`);
  } else if (!allPayTypes) {
    // Default: only process portal-scoped visits (pay_type and alliance tag-aware patient name fallback).
    query = query.or(getPortalScopeOrFilter());
    logger.info(
      `Filtering to portal scope: ${portalPayTypes.join(', ')} + Allianz tags in patient name`
    );
  }

  query = query.order('visit_date', { ascending: false }).limit(batchSize);

  // Execute query and filter in JavaScript (PostgREST JSONB filtering can be complex)
  const { data: allVisits, error: queryError } = await query;

  if (queryError) {
    logger.error('Failed to query visits:', queryError.message);
    reportRows.push({
      date: targetDate || `${fromDate || '-'}..${toDate || '-'}`,
      patientName: '-',
      nric: '-',
      payType: targetPayType || '-',
      portal: '-',
      status: 'query_error',
      diagnosisStatus: '-',
      notes: queryError.message,
    });
    const report = await writeRunSummaryReport({
      flowName: 'Flow 2 Visit Details Extraction',
      filePrefix: 'flow2',
      scope: reportScope,
      totals: reportTotals,
      rows: reportRows,
    });
    logger.info(`Flow 2 summary report: ${report.mdPath}`);
    process.exit(1);
  }

  if (!allVisits || allVisits.length === 0) {
    logger.info('No visits found that need enhancement.');
    const report = await writeRunSummaryReport({
      flowName: 'Flow 2 Visit Details Extraction',
      filePrefix: 'flow2',
      scope: reportScope,
      totals: reportTotals,
      rows: [
        {
          date: targetDate || `${fromDate || '-'}..${toDate || '-'}`,
          patientName: '-',
          nric: '-',
          payType: '-',
          portal: '-',
          status: 'no_records',
          diagnosisStatus: '-',
          notes: 'No visits found for selected scope',
        },
      ],
    });
    logger.info(`Flow 2 summary report: ${report.mdPath}`);
    process.exit(0);
  }

  // Filter visits by status for resume capability
  const visitsToProcess = allVisits.filter(visit => {
    const metadata = visit.extraction_metadata || {};
    const status = metadata.detailsExtractionStatus;
    const attempts = metadata.detailsExtractionAttempts || 0;

    // Skip completed visits
    if (!force && status === 'completed') {
      return false;
    }

    // If retry-failed mode, only process failed visits
    if (retryFailed && status !== 'failed') {
      return false;
    }

    // Skip failed visits that exceeded max retries (unless retry-failed mode)
    if (!force && status === 'failed' && attempts >= maxRetries && !retryFailed) {
      return false;
    }

    // Process: null, pending, in_progress (treat as pending for resume), or failed (with retries left)
    return true;
  });
  const visitsToProcessIds = new Set(visitsToProcess.map(v => v.id));
  const precheckSkippedVisits = allVisits.filter(v => !visitsToProcessIds.has(v.id));
  reportTotals.total_candidates = allVisits.length;
  reportTotals.to_process = visitsToProcess.length;
  reportTotals.skipped_precheck = precheckSkippedVisits.length;
  for (const visit of precheckSkippedVisits) {
    const metadata = visit.extraction_metadata || {};
    const detailsStatus = String(metadata.detailsExtractionStatus || '').trim();
    const attempts = Number(metadata.detailsExtractionAttempts || 0);
    let reason = 'precheck_skip';
    if (!force && detailsStatus === 'completed') {
      reason = 'already_completed';
    } else if (!force && detailsStatus === 'failed' && attempts >= maxRetries) {
      reason = 'retry_limit_exceeded';
    }
    reportRows.push({
      date: visit.visit_date || '-',
      patientName: visit.patient_name || '-',
      nric: visit.nric || '-',
      payType: visit.pay_type || '-',
      portal: buildPortalLabel(visit),
      status: 'skipped',
      diagnosisStatus: buildDiagnosisStatus(visit),
      notes: `${reason}${attempts ? ` (attempts=${attempts})` : ''}`,
    });
  }

  if (visitsToProcess.length === 0) {
    logger.info('No visits to process. All visits are either completed or exceeded retry limit.');
    const report = await writeRunSummaryReport({
      flowName: 'Flow 2 Visit Details Extraction',
      filePrefix: 'flow2',
      scope: reportScope,
      totals: reportTotals,
      rows: reportRows,
    });
    logger.info(`Flow 2 summary report: ${report.mdPath}`);
    process.exit(0);
  }

  logger.info(`Found ${allVisits.length} candidate visit(s)`);
  logger.info(
    `Processing ${visitsToProcess.length} visits (${allVisits.length - visitsToProcess.length} skipped)`
  );

  // Initialize browser and extractor
  const browserManager = new BrowserManager();
  const page = await browserManager.newPage();
  const extractor = new VisitDetailsExtractor(page, supabase);

  try {
    // Login once (browser session reuse)
    logger.info('Initializing browser and logging in to Clinic Assist...');
    await extractor.clinicAssist.login();

    // Track progress
    const progress = {
      total: visitsToProcess.length,
      completed: 0,
      failed: 0,
      skipped: 0,
      startTime: Date.now(),
    };

    // Process visits in batch
    logger.info(`\nStarting batch extraction for ${visitsToProcess.length} visits...`);
    logger.info(`Max retries: ${maxRetries}, Batch size: ${batchSize}`);

    const results = await extractor.extractBatch(visitsToProcess, { maxRetries, force });

    progress.completed = results.completed;
    progress.failed = results.failed;
    progress.skipped = results.skipped;

    // Calculate statistics
    const elapsed = (Date.now() - progress.startTime) / 1000; // seconds
    const successRate =
      progress.total > 0 ? ((progress.completed / progress.total) * 100).toFixed(1) : 0;
    const avgTimePerVisit = progress.completed > 0 ? (elapsed / progress.completed).toFixed(1) : 0;

    // Summary report
    logger.info('\n=== Extraction Summary ===');
    logger.info(`Total visits processed: ${progress.total}`);
    logger.info(`✅ Completed: ${progress.completed}`);
    logger.info(`❌ Failed: ${progress.failed}`);
    logger.info(`⏭️  Skipped: ${progress.skipped}`);
    logger.info(`Success rate: ${successRate}%`);
    logger.info(`Time elapsed: ${elapsed.toFixed(1)}s`);
    if (avgTimePerVisit > 0) {
      logger.info(`Average time per visit: ${avgTimePerVisit}s`);
    }

    // Log failed visits for reference
    if (results.failed > 0) {
      const failedVisits = results.details.filter(r => !r.success);
      logger.info(`\nFailed visits (${failedVisits.length}):`);
      failedVisits.slice(0, 10).forEach(result => {
        const visit = visitsToProcess.find(v => v.id === result.visitId);
        logger.info(
          `  - Visit ${result.visitId}: ${visit?.patient_name || 'Unknown'} (${visit?.visit_date || 'Unknown'}) - ${result.error || 'Unknown error'}`
        );
      });
      if (failedVisits.length > 10) {
        logger.info(`  ... and ${failedVisits.length - 10} more`);
      }
    }

    const resultByVisitId = new Map(
      (results.details || []).map(item => [item.visitId, item])
    );
    for (const visit of visitsToProcess) {
      const item = resultByVisitId.get(visit.id);
      if (!item) {
        reportRows.push({
          date: visit.visit_date || '-',
          patientName: visit.patient_name || '-',
          nric: visit.nric || '-',
          payType: visit.pay_type || '-',
          portal: buildPortalLabel(visit),
          status: 'skipped',
          diagnosisStatus: buildDiagnosisStatus(visit),
          notes: 'Extractor skipped this visit',
        });
        continue;
      }
      reportRows.push({
        date: visit.visit_date || '-',
        patientName: visit.patient_name || '-',
        nric: visit.nric || '-',
        payType: visit.pay_type || '-',
        portal: buildPortalLabel(visit),
        status: item.success ? 'completed' : 'error',
        diagnosisStatus: buildDiagnosisStatus(visit, item),
        notes: item.success
          ? `chargeType=${item.chargeType || '-'}; mcDays=${item.mcDays ?? '-'}`
          : item.error || 'Unknown extraction error',
      });
    }
    reportTotals.completed = progress.completed;
    reportTotals.failed = progress.failed;
    reportTotals.skipped = progress.skipped;
    const report = await writeRunSummaryReport({
      flowName: 'Flow 2 Visit Details Extraction',
      filePrefix: 'flow2',
      scope: reportScope,
      totals: reportTotals,
      rows: reportRows,
    });
    logger.info(`Flow 2 summary report: ${report.mdPath}`);

    // Exit with appropriate code
    if (progress.failed > 0 && progress.completed === 0) {
      // All failed
      process.exit(1);
    } else if (progress.failed > 0) {
      // Some failed, but some succeeded
      process.exit(0); // Still successful run (partial success)
    }
  } catch (error) {
    logger.error('Fatal error during batch extraction:', error);
    reportRows.push({
      date: targetDate || `${fromDate || '-'}..${toDate || '-'}`,
      patientName: '-',
      nric: '-',
      payType: targetPayType || '-',
      portal: '-',
      status: 'fatal_error',
      diagnosisStatus: '-',
      notes: error?.message || String(error),
    });
    const report = await writeRunSummaryReport({
      flowName: 'Flow 2 Visit Details Extraction',
      filePrefix: 'flow2',
      scope: reportScope,
      totals: reportTotals,
      rows: reportRows,
    });
    logger.info(`Flow 2 summary report: ${report.mdPath}`);
    process.exit(1);
  } finally {
    await browserManager.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  extractVisitDetailsBatch().catch(error => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });
}

export { extractVisitDetailsBatch };
