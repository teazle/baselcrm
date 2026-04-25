'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DataTable, RowLink } from '@/components/ui/DataTable';
import { supabaseBrowser } from '@/lib/supabase/browser';
import {
  formatDateDDMMYYYY,
  formatDateTimeDDMMYYYY,
  formatDateSingapore,
  getTodaySingapore,
  parseDateSingapore,
} from '@/lib/utils/date';
import { cn } from '@/lib/cn';
import {
  classifyVisitForRpa,
  deriveFlow3UiStatus,
  type Flow3UiStatus,
  getFlow3PortalTargets,
  getPortalScopeOrFilter,
  matchesFlow3PortalTargets,
} from '@/lib/rpa/portals';
import FlowHeader from './FlowHeader';
import RunSummaryPanel from './RunSummaryPanel';

type VisitRow = {
  id: string;
  patient_name: string | null;
  visit_date: string | null;
  pay_type: string | null;
  nric: string | null;
  submission_status: string | null;
  submitted_at: string | null;
  submission_metadata: {
    mode?: string;
    success?: boolean;
    portal?: string;
    portalService?: string;
    savedAsDraft?: boolean;
    drafted_at?: string;
    processedAt?: string;
    blocked_reason?: string;
    sessionState?: string | null;
    evidence?: string | null;
    mismatchCategories?: string[] | null;
    submittedTruthSnapshot?: { source?: string | null } | null;
    comparison?: {
      state?: string;
      unavailableReason?: string;
      flow2VsSubmittedTruth?: { state?: string | null } | null;
      botVsSubmittedTruth?: { state?: string | null } | null;
    } | null;
    [key: string]: unknown;
  } | null;
  extraction_metadata: {
    nric?: string | null;
    claimCandidateStatus?: string | null;
    claimCandidateReasons?: string[] | null;
    flow3PortalRoute?: string | null;
  } | null;
};

type FilterKey =
  | 'all'
  | 'candidate_pending'
  | 'manual_review'
  | 'shadow_fill_ready'
  | 'truth_unavailable'
  | 'truth_captured'
  | 'drift_mismatch'
  | 'otp_blocked'
  | 'captcha_blocked'
  | 'portal_read_only'
  | 'draft'
  | 'submitted'
  | 'error';

const filters: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'candidate_pending', label: 'Candidate pending' },
  { key: 'manual_review', label: 'Manual review' },
  { key: 'shadow_fill_ready', label: 'Shadow fill ready' },
  { key: 'truth_unavailable', label: 'Truth unavailable' },
  { key: 'truth_captured', label: 'Truth captured' },
  { key: 'drift_mismatch', label: 'Drift mismatch' },
  { key: 'otp_blocked', label: 'OTP blocked' },
  { key: 'captcha_blocked', label: 'CAPTCHA blocked' },
  { key: 'portal_read_only', label: 'Portal read-only' },
  { key: 'draft', label: 'Draft' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'error', label: 'Error' },
];

const portalTargetOptions: Array<{ key: string; label: string }> = [
  { key: 'MHC', label: 'MHC / AIA / AVIVA / SINGLIFE / MHCAXA' },
  { key: 'ALLIANCE_MEDINET', label: 'Alliance Medinet' },
  { key: 'ALLIANZ', label: 'Allianz Worldwide Care' },
  { key: 'FULLERTON', label: 'Fullerton' },
  { key: 'IHP', label: 'IHP' },
  { key: 'IXCHANGE', label: 'IXCHANGE (PARKWAY / ALL)' },
  { key: 'GE_NTUC', label: 'GE / NTUC IM' },
];

function shiftSingaporeDate(dateString: string, days: number): string {
  const d = parseDateSingapore(dateString);
  d.setDate(d.getDate() + days);
  return formatDateSingapore(d);
}

export default function Flow3FillForms() {
  const [rows, setRows] = useState<VisitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [notice, setNotice] = useState<string | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [fromDate, setFromDate] = useState(() => shiftSingaporeDate(getTodaySingapore(), -6));
  const [toDate, setToDate] = useState(() => getTodaySingapore());
  const [portalOnly, setPortalOnly] = useState(true);
  const [selectedPortalTargets, setSelectedPortalTargets] = useState<string[]>(() =>
    getFlow3PortalTargets().map(v => String(v))
  );
  const [leaveBrowserOpen, setLeaveBrowserOpen] = useState(false);
  const [mode, setMode] = useState<'fill_evidence' | 'draft'>('fill_evidence');

  const getSubmissionStatus = useCallback((visit: VisitRow): Flow3UiStatus => {
    const candidate = classifyVisitForRpa(
      visit.pay_type,
      visit.patient_name,
      visit.nric || visit.extraction_metadata?.nric || null,
      visit.extraction_metadata,
      visit.submission_status
    );
    const derived = deriveFlow3UiStatus(visit.submission_status, visit.submission_metadata);
    if (derived !== 'candidate_pending') return derived;
    if (candidate.status === 'manual_review') return 'manual_review';
    return 'candidate_pending';
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);

      const supabase = supabaseBrowser();
      if (!supabase) {
        setError('Supabase is not configured.');
        setLoading(false);
        return;
      }

      let visitsQuery = supabase
        .from('visits')
        .select(
          'id,patient_name,visit_date,pay_type,nric,submission_status,submitted_at,submission_metadata,extraction_metadata'
        )
        .eq('source', 'Clinic Assist')
        .order('visit_date', { ascending: false })
        .limit(1000);
      if (fromDate) visitsQuery = visitsQuery.gte('visit_date', fromDate);
      if (toDate) visitsQuery = visitsQuery.lte('visit_date', toDate);
      if (portalOnly) visitsQuery = visitsQuery.or(getPortalScopeOrFilter());

      const [visitsRes] = await Promise.all([visitsQuery]);

      if (cancelled) return;
      if (visitsRes.error) {
        const errorMessage = String(visitsRes.error.message ?? visitsRes.error);
        if (
          errorMessage.includes('permission denied') ||
          errorMessage.includes('row-level security') ||
          errorMessage.includes('RLS')
        ) {
          setError(
            `Database permission error: ${errorMessage}. Check RLS policies for 'visits' table.`
          );
        } else {
          setError(errorMessage);
        }
        setRows([]);
        setLoading(false);
        return;
      }
      setRows((visitsRes.data ?? []) as VisitRow[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fromDate, portalOnly, toDate]);

  const handleSubmitClaims = async (
    visitIds?: string[],
    requestedMode: 'fill_evidence' | 'draft' = mode
  ) => {
    setSubmitBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/rpa/flow3/submit-claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitIds,
          mode: requestedMode,
          leaveOpen: leaveBrowserOpen,
          from: fromDate,
          to: toDate,
          portalOnly,
          portalTargets: selectedPortalTargets,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to start claim submission.');
      }
      setNotice(data?.message || 'Claim submission started.');
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err) {
      setNotice(String((err as Error).message ?? err));
    } finally {
      setSubmitBusy(false);
    }
  };

  const filtered = useMemo(() => {
    return rows.filter(row => {
      if (
        selectedPortalTargets.length > 0 &&
        !matchesFlow3PortalTargets(
          row.pay_type,
          row.patient_name,
          selectedPortalTargets,
          row.extraction_metadata
        )
      ) {
        return false;
      }
      const status = getSubmissionStatus(row);
      switch (filter) {
        case 'candidate_pending':
          return status === 'candidate_pending';
        case 'manual_review':
          return status === 'manual_review';
        case 'shadow_fill_ready':
          return status === 'shadow_fill_ready';
        case 'truth_unavailable':
          return status === 'truth_unavailable';
        case 'truth_captured':
          return status === 'truth_captured';
        case 'drift_mismatch':
          return status === 'drift_mismatch';
        case 'otp_blocked':
          return status === 'otp_blocked';
        case 'captcha_blocked':
          return status === 'captcha_blocked';
        case 'portal_read_only':
          return status === 'portal_read_only';
        case 'draft':
          return status === 'draft';
        case 'submitted':
          return status === 'submitted';
        case 'error':
          return status === 'error';
        default:
          return true;
      }
    });
  }, [filter, rows, selectedPortalTargets, getSubmissionStatus]);

  const metrics = useMemo(() => {
    const scopedRows = rows.filter(row =>
      matchesFlow3PortalTargets(
        row.pay_type,
        row.patient_name,
        selectedPortalTargets,
        row.extraction_metadata
      )
    );
    if (!scopedRows.length) {
      return {
        candidatePending: 0,
        manualReview: 0,
        filledEvidence: 0,
        draft: 0,
        submitted: 0,
        error: 0,
        total: 0,
      };
    }
    const candidatePending = scopedRows.filter(
      r => getSubmissionStatus(r) === 'candidate_pending'
    ).length;
    const manualReview = scopedRows.filter(r => getSubmissionStatus(r) === 'manual_review').length;
    const filledEvidence = scopedRows.filter(r =>
      ['shadow_fill_ready', 'truth_unavailable', 'truth_captured', 'drift_mismatch'].includes(
        getSubmissionStatus(r)
      )
    ).length;
    const draft = scopedRows.filter(r => getSubmissionStatus(r) === 'draft').length;
    const submitted = scopedRows.filter(r => getSubmissionStatus(r) === 'submitted').length;
    const error = scopedRows.filter(r => getSubmissionStatus(r) === 'error').length;
    return {
      candidatePending,
      manualReview,
      filledEvidence,
      draft,
      submitted,
      error,
      total: scopedRows.length,
    };
  }, [rows, selectedPortalTargets, getSubmissionStatus]);

  const flowStatus =
    metrics.error > 0
      ? { label: 'Needs attention', tone: 'danger' as const }
      : metrics.candidatePending > 0 || metrics.manualReview > 0
        ? { label: 'Pending', tone: 'warning' as const }
        : { label: 'Ready', tone: 'success' as const };

  const errorIds = useMemo(
    () =>
      rows
        .filter(r =>
          matchesFlow3PortalTargets(
            r.pay_type,
            r.patient_name,
            selectedPortalTargets,
            r.extraction_metadata
          )
        )
        .filter(r => getSubmissionStatus(r) === 'error')
        .map(r => r.id),
    [rows, selectedPortalTargets, getSubmissionStatus]
  );

  const getStatusLabel = (visit: VisitRow) => {
    const status = getSubmissionStatus(visit);
    if (status === 'candidate_pending') return 'Candidate pending';
    if (status === 'manual_review') return 'Manual review';
    if (status === 'shadow_fill_ready') return 'Shadow fill ready';
    if (status === 'truth_unavailable') return 'Truth unavailable';
    if (status === 'truth_captured') return 'Truth captured';
    if (status === 'drift_mismatch') return 'Drift mismatch';
    if (status === 'otp_blocked') return 'OTP blocked';
    if (status === 'captcha_blocked') return 'CAPTCHA blocked';
    if (status === 'portal_read_only') return 'Portal read-only';
    if (status === 'draft') return 'Draft';
    if (status === 'submitted') return 'Submitted';
    if (status === 'error') return 'Error';
    return 'Candidate pending';
  };

  return (
    <div className="space-y-6">
      <FlowHeader
        flow="3"
        title="Fill Claim Forms"
        description="Submit claim forms to respective portals (MHC, Alliance, Fullerton, etc.)."
        accentClassName="border-violet-200 bg-violet-50 text-violet-700"
        statusLabel={flowStatus.label}
        statusTone={flowStatus.tone}
      />

      <RunSummaryPanel flowPrefix="flow3" />

      <Card className="p-5">
        <div className="text-xs font-medium text-muted-foreground">Scope</div>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <div className="text-xs text-muted-foreground">From</div>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
            />
          </label>
          <label className="space-y-1">
            <div className="text-xs text-muted-foreground">To</div>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 pb-1 text-sm">
            <input
              type="checkbox"
              checked={portalOnly}
              onChange={e => setPortalOnly(e.target.checked)}
              className="h-4 w-4 rounded border border-border"
            />
            <span className="text-sm">Portal pay types only</span>
          </label>
        </div>
        <div className="mt-3 space-y-2">
          <div className="text-xs text-muted-foreground">Flow 3 submit service targets</div>
          <div className="flex flex-wrap gap-2">
            {portalTargetOptions.map(option => {
              const selected = selectedPortalTargets.includes(option.key);
              return (
                <button
                  key={option.key}
                  type="button"
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition',
                    selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-foreground hover:bg-muted'
                  )}
                  onClick={() =>
                    setSelectedPortalTargets(prev =>
                      prev.includes(option.key)
                        ? prev.filter(v => v !== option.key)
                        : [...prev, option.key]
                    )
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <div className="text-xs text-muted-foreground">
            Selected: {selectedPortalTargets.length > 0 ? selectedPortalTargets.join(', ') : 'none'}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="text-xs text-muted-foreground">Mode</div>
          <button
            type="button"
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition',
              mode === 'fill_evidence'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-foreground hover:bg-muted'
            )}
            onClick={() => setMode('fill_evidence')}
          >
            Fill + evidence
          </button>
          <button
            type="button"
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition',
              mode === 'draft'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-foreground hover:bg-muted'
            )}
            onClick={() => setMode('draft')}
          >
            Draft
          </button>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          Showing {portalOnly ? 'portal-tagged visits' : 'all visits'} between {fromDate} and{' '}
          {toDate}.
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-6">
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Total Claims</div>
          <div className="mt-2 text-2xl font-semibold">{metrics.total}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Candidate pending</div>
          <div className="mt-2 text-2xl font-semibold">{metrics.candidatePending}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Manual review</div>
          <div className="mt-2 text-2xl font-semibold">{metrics.manualReview}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Shadow/audit evidence</div>
          <div className="mt-2 text-2xl font-semibold">{metrics.filledEvidence}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Draft</div>
          <div className="mt-2 text-2xl font-semibold">{metrics.draft}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Submitted</div>
          <div className="mt-2 text-2xl font-semibold">{metrics.submitted}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Error</div>
          <div className="mt-2 text-2xl font-semibold">{metrics.error}</div>
        </Card>
      </div>

      <Card className="space-y-5">
        <div>
          <div className="text-xs font-medium text-muted-foreground">Manual Trigger</div>
          <div className="text-lg font-semibold">Submit Claims</div>
          <div className="mt-2 text-sm text-muted-foreground">
            Fill portal forms with evidence capture by default. Draft mode is available for
            validated routes only.
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="text-sm font-medium">Submit Claims</div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={leaveBrowserOpen}
              onChange={e => setLeaveBrowserOpen(e.target.checked)}
              className="h-4 w-4 rounded border border-border"
            />
            Leave browser open for manual review
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => handleSubmitClaims(undefined, mode)}
              disabled={submitBusy || selectedPortalTargets.length === 0}
            >
              {submitBusy
                ? 'Starting...'
                : mode === 'draft'
                  ? 'Run Draft Mode'
                  : 'Run Fill + Evidence'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleSubmitClaims(errorIds, 'draft')}
              disabled={submitBusy || errorIds.length === 0 || selectedPortalTargets.length === 0}
            >
              Retry Errors (draft) ({errorIds.length})
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleSubmitClaims(errorIds, 'fill_evidence')}
              disabled={submitBusy || errorIds.length === 0 || selectedPortalTargets.length === 0}
            >
              Retry Errors (fill + evidence) ({errorIds.length})
            </Button>
          </div>
        </div>

        {notice ? (
          <div className="rounded-2xl border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
            {notice}
          </div>
        ) : null}
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-muted-foreground">Claim Submission Status</div>
            <div className="text-lg font-semibold">All Portals</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {filters.map(tab => (
              <button
                key={tab.key}
                type="button"
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition',
                  filter === tab.key
                    ? 'border-transparent bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground hover:bg-muted'
                )}
                onClick={() => setFilter(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
            Loading...
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            {error}
          </div>
        ) : (
          <DataTable
            rows={filtered}
            rowKey={row => row.id}
            columns={[
              {
                header: 'Patient',
                cell: row => (
                  <RowLink href={`/crm/visits/${row.id}`}>{row.patient_name ?? '--'}</RowLink>
                ),
              },
              { header: 'Visit Date', cell: row => formatDateDDMMYYYY(row.visit_date) ?? '--' },
              {
                header: 'Portal',
                cell: row => {
                  const portalLabel =
                    row.submission_metadata?.portalService ||
                    row.extraction_metadata?.flow3PortalRoute ||
                    row.pay_type ||
                    '--';
                  return (
                    <span
                      className={cn(
                        'inline-flex rounded-full border px-2.5 py-1 text-xs font-medium',
                        'border-border bg-muted/50 text-foreground'
                      )}
                    >
                      {portalLabel}
                    </span>
                  );
                },
              },
              {
                header: 'NRIC',
                cell: row => {
                  const nric = row.nric || row.extraction_metadata?.nric;
                  if (!nric) return <span className="text-red-700">Missing</span>;
                  return <span className="font-mono text-xs">{nric}</span>;
                },
              },
              {
                header: 'Status',
                cell: row => {
                  const status = getSubmissionStatus(row);
                  const label = getStatusLabel(row);
                  return (
                    <span
                      className={cn(
                        'inline-flex rounded-full border px-2.5 py-1 text-xs font-medium',
                        status === 'submitted'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : status === 'shadow_fill_ready' ||
                              status === 'truth_unavailable' ||
                              status === 'truth_captured'
                            ? 'border-sky-200 bg-sky-50 text-sky-700'
                            : status === 'drift_mismatch'
                              ? 'border-orange-200 bg-orange-50 text-orange-700'
                              : status === 'draft'
                                ? 'border-blue-200 bg-blue-50 text-blue-700'
                                : status === 'otp_blocked' ||
                                    status === 'captcha_blocked' ||
                                    status === 'portal_read_only'
                                  ? 'border-red-200 bg-red-50 text-red-700'
                                  : status === 'manual_review'
                                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                                    : status === 'error'
                                      ? 'border-red-200 bg-red-50 text-red-700'
                                      : 'border-border bg-muted/50 text-muted-foreground'
                      )}
                    >
                      {label}
                    </span>
                  );
                },
              },
              {
                header: 'Processed At',
                cell: row => {
                  const status = getSubmissionStatus(row);
                  const draftedAt = row.submission_metadata?.drafted_at;
                  const processedAtMeta = row.submission_metadata?.processedAt;
                  const processedAt =
                    status === 'draft'
                      ? draftedAt || row.submitted_at || processedAtMeta
                      : row.submitted_at || processedAtMeta;
                  return formatDateTimeDDMMYYYY(processedAt) || '--';
                },
              },
              {
                header: 'Metadata',
                cell: row => {
                  const metadata = row.submission_metadata;
                  const candidate = classifyVisitForRpa(
                    row.pay_type,
                    row.patient_name,
                    row.nric || row.extraction_metadata?.nric || null,
                    row.extraction_metadata,
                    row.submission_status
                  );
                  if (!metadata) {
                    return (
                      <div className="text-xs space-y-1">
                        <div>Candidate: {candidate.status}</div>
                        <div className="text-muted-foreground">
                          {Array.isArray(candidate.reasons) && candidate.reasons.length
                            ? candidate.reasons.join(', ')
                            : '--'}
                        </div>
                      </div>
                    );
                  }
                  const portal = metadata.portal || metadata.portalService || '--';
                  const savedAsDraft = metadata.savedAsDraft;
                  return (
                    <div className="text-xs space-y-1">
                      <div>Portal: {portal}</div>
                      <div>Mode: {metadata.mode || '--'}</div>
                      {metadata.blocked_reason ? (
                        <div className="text-amber-700">
                          Blocked: {String(metadata.blocked_reason)}
                        </div>
                      ) : null}
                      {metadata.sessionState ? (
                        <div>Session: {String(metadata.sessionState)}</div>
                      ) : null}
                      {metadata.evidence ? <div>Evidence: captured</div> : null}
                      {metadata.comparison && typeof metadata.comparison === 'object' ? (
                        <div>
                          Compare: {String(metadata.comparison.state || '--')}
                          {metadata.comparison.botVsSubmittedTruth?.state
                            ? ` / bot=${String(metadata.comparison.botVsSubmittedTruth.state)}`
                            : ''}
                          {metadata.comparison.flow2VsSubmittedTruth?.state
                            ? ` / flow2=${String(metadata.comparison.flow2VsSubmittedTruth.state)}`
                            : ''}
                        </div>
                      ) : null}
                      {metadata.submittedTruthSnapshot ? (
                        <div>Submitted truth: captured</div>
                      ) : null}
                      {metadata.submittedTruthCapture &&
                      typeof metadata.submittedTruthCapture === 'object' &&
                      (metadata.submittedTruthCapture as { found?: unknown }).found === false ? (
                        <div className="text-amber-700">Submitted truth: unavailable</div>
                      ) : null}
                      {Array.isArray(metadata.mismatchCategories) &&
                      metadata.mismatchCategories.length ? (
                        <div className="text-amber-700">
                          Mismatch: {metadata.mismatchCategories.join(', ')}
                        </div>
                      ) : null}
                      {savedAsDraft && <div className="text-muted-foreground">Saved as draft</div>}
                    </div>
                  );
                },
              },
            ]}
            empty="No claims match the current filter."
          />
        )}
      </Card>
    </div>
  );
}
