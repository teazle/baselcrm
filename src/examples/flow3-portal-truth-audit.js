#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { BrowserManager } from '../utils/browser.js';
import { createSupabaseClient } from '../utils/supabase-client.js';
import { logger } from '../utils/logger.js';
import { MHCAsiaAutomation } from '../automations/mhc-asia.js';
import {
  comparePortalTruthSnapshots,
  writeFlow3TruthArtifacts,
} from '../utils/flow3-truth-compare.js';
import { resolveFlow3PortalTarget } from '../../apps/crm/src/lib/rpa/portals.shared.js';

function usage() {
  console.log(`
Audit Flow 3 submitted-claim detail truth for MHC/AIA

Usage:
  node src/examples/flow3-portal-truth-audit.js --from 2026-02-02 --to 2026-02-07
  node src/examples/flow3-portal-truth-audit.js --visit-ids id1,id2,id3

Options:
  --from <YYYY-MM-DD>      Start date
  --to <YYYY-MM-DD>        End date
  --visit-ids <csv>        Specific visit IDs
  --limit <n>              Max rows to audit (default 25)
  --dry-run                Capture and report only, do not persist back to DB
  --leave-open             Keep browser open
  --help, -h               Show this help
`);
}

function parseArgs(argv) {
  const out = {
    from: null,
    to: null,
    visitIds: null,
    limit: 25,
    dryRun: false,
    leaveOpen: false,
    help: false,
  };
  const read = i => {
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${argv[i]}`);
    return next;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--leave-open') out.leaveOpen = true;
    else if (arg.startsWith('--from=')) out.from = arg.split('=')[1] || null;
    else if (arg === '--from') {
      out.from = read(i);
      i += 1;
    } else if (arg.startsWith('--to=')) out.to = arg.split('=')[1] || null;
    else if (arg === '--to') {
      out.to = read(i);
      i += 1;
    } else if (arg.startsWith('--visit-ids=')) {
      out.visitIds = arg.split('=')[1]?.split(',').filter(Boolean) || null;
    } else if (arg === '--visit-ids') {
      out.visitIds = read(i).split(',').filter(Boolean);
      i += 1;
    } else if (arg.startsWith('--limit=')) {
      out.limit = Number.parseInt(arg.split('=')[1] || '25', 10);
    } else if (arg === '--limit') {
      out.limit = Number.parseInt(read(i), 10);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (out.from && !dateRe.test(out.from)) throw new Error(`Invalid --from date: ${out.from}`);
  if (out.to && !dateRe.test(out.to)) throw new Error(`Invalid --to date: ${out.to}`);
  if (!out.visitIds && !out.from && !out.to) {
    throw new Error('Provide --visit-ids or a --from/--to range');
  }
  if (!Number.isFinite(out.limit) || out.limit <= 0) out.limit = 25;
  return out;
}

function nowStamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function contextHintForVisit(visit) {
  const payType = String(visit?.pay_type || '').toUpperCase();
  const metadata = visit?.submission_metadata || {};
  const truthContext = String(
    metadata?.submittedTruthCapture?.context || metadata?.truthCapture?.context || ''
  )
    .trim()
    .toLowerCase();
  if (truthContext === 'aia' || truthContext === 'mhc' || truthContext === 'singlife')
    return truthContext;
  if (/AIA|AIACLIENT/i.test(payType) || metadata?.routingOverride === 'AIA_CLINIC_DIALOG')
    return 'aia';
  if (/AVIVA|SINGLIFE/i.test(payType)) return 'singlife';
  return 'mhc';
}

function pickNric(visit) {
  return (
    visit?.nric ||
    visit?.extraction_metadata?.nric ||
    visit?.extraction_metadata?.fin ||
    visit?.extraction_metadata?.idNumber ||
    visit?.submission_metadata?.draftVerification?.row?.patientNric ||
    ''
  );
}

function buildReportMarkdown({ generatedAt, scope, rows }) {
  const lines = [];
  lines.push('# Flow 3 Submitted Truth Audit');
  lines.push('');
  lines.push(`Generated: ${generatedAt}`);
  lines.push(`Date Range: ${scope.from || '-'} to ${scope.to || '-'}`);
  lines.push(`Visit IDs: ${scope.visitIds || '-'}`);
  lines.push(`Dry Run: ${String(scope.dryRun)}`);
  lines.push('');
  lines.push(
    '| visit_id | patient_name | visit_date | context | submitted_truth | flow2_vs_submitted | bot_vs_submitted | diagnosis_drift | flow2_diag | bot_diag | submitted_diag | mismatch_categories | notes |'
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of rows) {
    lines.push(
      `| ${row.visitId} | ${String(row.patientName || '').replace(/\|/g, '/')} | ${row.visitDate || ''} | ${row.context || ''} | ${row.submittedTruth || ''} | ${row.flow2VsSubmittedTruth || ''} | ${row.botVsSubmittedTruth || ''} | ${row.diagnosisDrift || ''} | ${String(row.flow2Diagnosis || '').replace(/\|/g, '/')} | ${String(row.botDiagnosis || '').replace(/\|/g, '/')} | ${String(row.submittedDiagnosis || '').replace(/\|/g, '/')} | ${String(row.mismatchCategories || '').replace(/\|/g, '/')} | ${String(row.notes || '').replace(/\|/g, '/')} |`
    );
  }
  return `${lines.join('\n')}\n`;
}

function formatDiagnosisLabel(code, text) {
  const codeText = String(code || '').trim();
  const descText = String(text || '').trim();
  if (codeText && descText) return `${codeText} - ${descText}`;
  return codeText || descText || '';
}

function buildDiagnosisAuditFields(comparison = null, submittedTruthCapture = null) {
  const diagnosisDrift = comparison?.diagnosisDrift || null;
  return {
    diagnosisDrift: diagnosisDrift?.classification || null,
    flow2Diagnosis: formatDiagnosisLabel(
      diagnosisDrift?.flow2DiagnosisCode,
      diagnosisDrift?.flow2Diagnosis
    ),
    botDiagnosis: formatDiagnosisLabel(
      diagnosisDrift?.botDiagnosisCode,
      diagnosisDrift?.botDiagnosis
    ),
    submittedDiagnosis: formatDiagnosisLabel(
      diagnosisDrift?.submittedDiagnosisCode ||
        submittedTruthCapture?.snapshot?.diagnosisCode ||
        null,
      diagnosisDrift?.submittedDiagnosis || submittedTruthCapture?.snapshot?.diagnosisText || null
    ),
  };
}

async function writeAuditReport(payload) {
  const baseDir = path.resolve(process.cwd(), 'output', 'run-reports');
  await fs.mkdir(baseDir, { recursive: true });
  const base = `flow3_submitted_truth_audit_${nowStamp()}`;
  const jsonPath = path.join(baseDir, `${base}.json`);
  const mdPath = path.join(baseDir, `${base}.md`);
  await fs.writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.writeFile(mdPath, buildReportMarkdown(payload), 'utf8');
  return { jsonPath, mdPath };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    logger.error(error.message);
    usage();
    process.exit(2);
  }
  if (args.help) {
    usage();
    return;
  }

  const supabase = createSupabaseClient();
  if (!supabase) {
    logger.error('Supabase client not available. Check environment variables.');
    process.exit(1);
  }

  let query = supabase
    .from('visits')
    .select(
      'id,patient_name,visit_date,pay_type,nric,total_amount,diagnosis_description,extraction_metadata,submission_status,submission_metadata'
    )
    .eq('source', 'Clinic Assist')
    .order('visit_date', { ascending: true });

  if (args.from) query = query.gte('visit_date', args.from);
  if (args.to) query = query.lte('visit_date', args.to);
  if (Array.isArray(args.visitIds) && args.visitIds.length > 0)
    query = query.in('id', args.visitIds);

  const { data, error } = await query.limit(Math.max(args.limit * 4, args.limit));
  if (error) {
    logger.error('Failed to query visits for audit', { error: error.message });
    process.exit(1);
  }

  const rows = (data || [])
    .filter(
      visit =>
        resolveFlow3PortalTarget(
          visit?.pay_type,
          visit?.patient_name,
          visit?.extraction_metadata || null
        ) === 'MHC'
    )
    .filter(visit => {
      const md = visit?.submission_metadata || {};
      return Boolean(
        visit?.submission_status === 'submitted' ||
        md?.submittedTruthSnapshot ||
        md?.submittedTruthCapture ||
        md?.botSnapshot ||
        md?.draftVerification ||
        md?.draftReference
      );
    })
    .slice(0, args.limit);

  logger.info(`[TRUTH AUDIT] Auditing ${rows.length} MHC/AIA visit(s) against submitted detail`);

  const browserManager = new BrowserManager();
  const page = await browserManager.newPage();
  const mhc = new MHCAsiaAutomation(page);
  let portalBlockedReason = null;
  try {
    await mhc.ensureAtMhcHome();
  } catch (error) {
    if (error?.portalBlocked === true) {
      portalBlockedReason = String(
        error?.code || error?.submissionMetadata?.reason || 'portal_blocked'
      );
      logger.warn('[TRUTH AUDIT] Portal blocked before audit start', {
        reason: portalBlockedReason,
      });
    } else {
      throw error;
    }
  }

  const reportRows = [];
  for (const visit of rows) {
    const nric = pickNric(visit);
    const contextHint = contextHintForVisit(visit);
    const allowCrossContext = contextHint !== 'mhc';
    const expectedVisitNo =
      String(
        visit?.submission_metadata?.draftReference ||
          visit?.submission_metadata?.draftVerification?.row?.visitNo ||
          ''
      )
        .trim()
        .toUpperCase() || null;

    if (!nric) {
      reportRows.push({
        visitId: visit.id,
        patientName: visit.patient_name || '',
        visitDate: visit.visit_date || '',
        context: contextHint,
        submittedTruth: 'skipped',
        flow2VsSubmittedTruth: '-',
        botVsSubmittedTruth: '-',
        diagnosisDrift: '-',
        flow2Diagnosis: '',
        botDiagnosis: '',
        submittedDiagnosis: '',
        mismatchCategories: '',
        notes: 'missing_nric',
      });
      continue;
    }

    if (portalBlockedReason) {
      const blockedComparison = comparePortalTruthSnapshots({
        portalTarget: 'MHC',
        visit,
        botSnapshot: visit?.submission_metadata?.botSnapshot || null,
        submittedTruthSnapshot: null,
        diagnosisMatch:
          visit?.submission_metadata?.diagnosisMatch ||
          visit?.extraction_metadata?.diagnosisMatch ||
          null,
      });
      if (!args.dryRun) {
        const nextMetadata = {
          ...(visit?.submission_metadata || {}),
          comparison: blockedComparison,
          mismatchCategories: blockedComparison?.mismatchCategories || [],
          sessionState: 'captcha_blocked',
          blocked_reason: portalBlockedReason,
        };
        await supabase
          .from('visits')
          .update({
            submission_metadata: nextMetadata,
          })
          .eq('id', visit.id);
      }
      reportRows.push({
        visitId: visit.id,
        patientName: visit.patient_name || '',
        visitDate: visit.visit_date || '',
        context: contextHint,
        submittedTruth: 'blocked',
        flow2VsSubmittedTruth: blockedComparison?.flow2VsSubmittedTruth?.state || 'unavailable',
        botVsSubmittedTruth: blockedComparison?.botVsSubmittedTruth?.state || 'unavailable',
        ...buildDiagnosisAuditFields(blockedComparison, null),
        mismatchCategories: (blockedComparison?.mismatchCategories || []).join(','),
        notes: portalBlockedReason,
      });
      continue;
    }

    logger.info('[TRUTH AUDIT] Capturing portal truth', {
      visitId: visit.id,
      patientName: visit.patient_name,
      contextHint,
      expectedVisitNo,
    });

    let submittedTruthCapture;
    try {
      submittedTruthCapture = await mhc.captureSubmittedTruthSnapshot({
        visit,
        nric,
        visitDate: visit.visit_date || null,
        patientName: visit.patient_name || '',
        contextHint,
        allowCrossContext,
        expectedVisitNo,
      });
    } catch (error) {
      if (error?.portalBlocked === true) {
        portalBlockedReason = String(
          error?.code || error?.submissionMetadata?.reason || 'portal_blocked'
        );
        const blockedComparison = comparePortalTruthSnapshots({
          portalTarget: 'MHC',
          visit,
          botSnapshot: visit?.submission_metadata?.botSnapshot || null,
          submittedTruthSnapshot: null,
          diagnosisMatch:
            visit?.submission_metadata?.diagnosisMatch ||
            visit?.extraction_metadata?.diagnosisMatch ||
            null,
        });
        if (!args.dryRun) {
          const nextMetadata = {
            ...(visit?.submission_metadata || {}),
            comparison: blockedComparison,
            mismatchCategories: blockedComparison?.mismatchCategories || [],
            sessionState: 'captcha_blocked',
            blocked_reason: portalBlockedReason,
          };
          await supabase
            .from('visits')
            .update({
              submission_metadata: nextMetadata,
            })
            .eq('id', visit.id);
        }
        reportRows.push({
          visitId: visit.id,
          patientName: visit.patient_name || '',
          visitDate: visit.visit_date || '',
          context: contextHint,
          submittedTruth: 'blocked',
          flow2VsSubmittedTruth: blockedComparison?.flow2VsSubmittedTruth?.state || 'unavailable',
          botVsSubmittedTruth: blockedComparison?.botVsSubmittedTruth?.state || 'unavailable',
          ...buildDiagnosisAuditFields(blockedComparison, null),
          mismatchCategories: (blockedComparison?.mismatchCategories || []).join(','),
          notes: portalBlockedReason,
        });
        continue;
      }
      throw error;
    }

    const comparison = comparePortalTruthSnapshots({
      portalTarget: 'MHC',
      visit,
      botSnapshot: visit?.submission_metadata?.botSnapshot || null,
      submittedTruthSnapshot: submittedTruthCapture?.snapshot || null,
      diagnosisMatch:
        visit?.submission_metadata?.diagnosisMatch ||
        visit?.extraction_metadata?.diagnosisMatch ||
        null,
    });

    if (!submittedTruthCapture?.found) {
      if (!args.dryRun) {
        const nextMetadata = {
          ...(visit?.submission_metadata || {}),
          submittedTruthCapture: {
            found: false,
            reason: submittedTruthCapture?.reason || 'submitted_truth_unavailable',
            attempts: submittedTruthCapture?.attempts || [],
            auditedAt: new Date().toISOString(),
          },
          comparison,
          mismatchCategories: comparison?.mismatchCategories || [],
          blocked_reason: null,
          sessionState: 'healthy',
        };
        await supabase
          .from('visits')
          .update({
            submission_metadata: nextMetadata,
          })
          .eq('id', visit.id);
      }
      reportRows.push({
        visitId: visit.id,
        patientName: visit.patient_name || '',
        visitDate: visit.visit_date || '',
        context: contextHint,
        submittedTruth: 'unavailable',
        flow2VsSubmittedTruth: comparison?.flow2VsSubmittedTruth?.state || 'unavailable',
        botVsSubmittedTruth: comparison?.botVsSubmittedTruth?.state || 'unavailable',
        ...buildDiagnosisAuditFields(comparison, submittedTruthCapture),
        mismatchCategories: (comparison?.mismatchCategories || []).join(','),
        notes: submittedTruthCapture?.reason || 'submitted_truth_unavailable',
      });
      continue;
    }

    const comparisonArtifacts = await writeFlow3TruthArtifacts({
      visit,
      portalTarget: 'MHC',
      expectedSnapshot: comparison.expectedSnapshot || null,
      botSnapshot: visit?.submission_metadata?.botSnapshot || null,
      submittedTruthSnapshot: submittedTruthCapture.snapshot || null,
      comparison,
      extra: {
        audit: true,
        contextHint,
      },
    }).catch(() => null);

    if (!args.dryRun) {
      const nextMetadata = {
        ...(visit?.submission_metadata || {}),
        submittedTruthSnapshot: submittedTruthCapture.snapshot || null,
        submittedTruthCapture: {
          found: true,
          reason: null,
          context: submittedTruthCapture?.context || null,
          row: submittedTruthCapture?.row || null,
          attempts: submittedTruthCapture?.attempts || [],
          auditedAt: new Date().toISOString(),
        },
        comparison,
        mismatchCategories: comparison?.mismatchCategories || [],
        blocked_reason: null,
        sessionState: 'healthy',
        evidenceArtifacts: {
          ...(visit?.submission_metadata?.evidenceArtifacts || {}),
          submittedTruthSnapshot: submittedTruthCapture?.snapshot?.artifacts || null,
          comparison: comparisonArtifacts || null,
        },
      };
      const { error: updateError } = await supabase
        .from('visits')
        .update({
          submission_metadata: nextMetadata,
        })
        .eq('id', visit.id);
      if (updateError) {
        logger.warn('[TRUTH AUDIT] Failed to persist portal truth audit', {
          visitId: visit.id,
          error: updateError.message,
        });
      }
    }

    reportRows.push({
      visitId: visit.id,
      patientName: visit.patient_name || '',
      visitDate: visit.visit_date || '',
      context: submittedTruthCapture?.context || contextHint,
      submittedTruth: 'captured',
      flow2VsSubmittedTruth: comparison?.flow2VsSubmittedTruth?.state || 'unavailable',
      botVsSubmittedTruth: comparison?.botVsSubmittedTruth?.state || 'unavailable',
      ...buildDiagnosisAuditFields(comparison, submittedTruthCapture),
      mismatchCategories: (comparison?.mismatchCategories || []).join(','),
      notes: submittedTruthCapture?.snapshot?.artifacts?.json || comparisonArtifacts?.json || '',
    });
  }

  const reportPayload = {
    generatedAt: new Date().toISOString(),
    scope: {
      from: args.from,
      to: args.to,
      visitIds: args.visitIds?.join(',') || null,
      dryRun: args.dryRun,
    },
    rows: reportRows,
  };
  const reportPaths = await writeAuditReport(reportPayload);
  logger.info('[TRUTH AUDIT] Report written', reportPaths);

  if (!args.leaveOpen) {
    await browserManager.close();
  }
}

main().catch(error => {
  logger.error('Flow 3 submitted truth audit failed', {
    error: error?.message || String(error),
  });
  process.exit(1);
});
