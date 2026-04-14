"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/cn";
import { formatDateTimeDDMMYYYY } from "@/lib/utils/date";
import { classifyVisitForRpa } from "@/lib/rpa/portals";

type VisitRow = {
  id: string;
  pay_type: string | null;
  nric: string | null;
  diagnosis_description: string | null;
  treatment_detail: string | null;
  submission_status: string | null;
  submitted_at: string | null;
  submission_metadata: {
    mode?: string | null;
    blocked_reason?: string | null;
    sessionState?: string | null;
    evidence?: string | null;
    submittedTruthSnapshot?: { source?: string | null } | null;
    mismatchCategories?: string[] | null;
    comparison?: {
      state?: string | null;
      flow2VsSubmittedTruth?: { state?: string | null } | null;
      botVsSubmittedTruth?: { state?: string | null } | null;
    } | null;
    [key: string]: unknown;
  } | null;
  extraction_metadata: {
    medicines?: Array<{ name?: string | null; quantity?: number | null }> | null;
    detailsExtractionStatus?: string | null;
    detailsExtractedAt?: string | null;
    detailsExtractionLastAttempt?: string | null;
    pcno?: string | null;
    claimCandidateReasons?: string[] | null;
    flow3PortalRoute?: string | null;
    chargeType?: string | null;
    mcDays?: number | null;
    mcStartDate?: string | null;
    diagnosisCode?: string | null;
    diagnosisResolution?: { status?: string | null } | null;
    diagnosisEvidence?: {
      sourceTab?: string | null;
      sourceDate?: string | null;
      confidence?: number | null;
      rejectionReason?: string | null;
      artifactPaths?: {
        json?: string | null;
        screenshot?: string | null;
      } | null;
    } | null;
    [key: string]: unknown;
  } | null;
  updated_at: string | null;
};

function K({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-2 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className="col-span-2 break-words">{value}</div>
    </div>
  );
}

export default function VisitRpaPanel({ visitId }: { visitId: string }) {
  const [row, setRow] = useState<VisitRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const supabase = supabaseBrowser();
      if (!supabase) {
        setError("Supabase is not configured.");
        setLoading(false);
        return;
      }

      const { data, error: qErr } = await supabase
        .from("visits")
        .select(
          "id,pay_type,nric,diagnosis_description,treatment_detail,submission_status,submitted_at,submission_metadata,extraction_metadata,updated_at",
        )
        .eq("id", visitId)
        .maybeSingle();

      if (cancelled) return;
      if (qErr) {
        setError(String(qErr.message ?? qErr));
        setRow(null);
        setLoading(false);
        return;
      }

      setRow((data ?? null) as VisitRow | null);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [visitId]);

  const meds = useMemo(() => {
    const list = row?.extraction_metadata?.medicines;
    if (!Array.isArray(list)) return [];
    return list
      .map((m) => ({
        name: String(m?.name ?? "").trim().replace(/\s+/g, " "),
        quantity:
          typeof m?.quantity === "number" && Number.isFinite(m.quantity) ? m.quantity : null,
      }))
      .filter((m) => m.name.length > 0);
  }, [row]);

  const treatmentLines = useMemo(() => {
    const text = String(row?.treatment_detail ?? "");
    return text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }, [row]);

  if (loading) {
    return (
      <Card className="p-6">
        <div className="text-sm text-muted-foreground">Loading RPA details…</div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <div className="text-sm text-red-700">{error}</div>
      </Card>
    );
  }

  if (!row) {
    return (
      <Card className="p-6">
        <div className="text-sm text-muted-foreground">Visit not found.</div>
      </Card>
    );
  }

  const md = row.extraction_metadata ?? {};
  const status = String(md.detailsExtractionStatus ?? "").trim() || null;
  const candidate = classifyVisitForRpa(
    row.pay_type,
    null,
    row.nric,
    md,
    row.submission_status,
  );
  const flow3Mode = String(row.submission_metadata?.mode || "").trim() || null;
  const flow3Evidence = row.submission_metadata?.evidence || null;
  const flow3BlockedReason = row.submission_metadata?.blocked_reason || null;
  const flow3Comparison = row.submission_metadata?.comparison || null;
  const flow3MismatchCategories = Array.isArray(row.submission_metadata?.mismatchCategories)
    ? row.submission_metadata?.mismatchCategories
    : [];
  const flow3TruthCaptured = Boolean(row.submission_metadata?.submittedTruthSnapshot);

  return (
    <Card className="p-0">
      <div className="px-6 py-5">
        <div className="text-xs font-medium text-muted-foreground">RPA</div>
        <div className="mt-1 text-lg font-semibold">Extracted Details</div>
        <div className="mt-2 text-sm text-muted-foreground">
          This is the data Flow 2 stores and Flow 3 uses to fill the portal forms.
        </div>
      </div>

      <div className="px-6 pb-6">
        <div className="rounded-2xl border border-border bg-muted/20 px-4 py-3">
          <K label="Pay type" value={row.pay_type ?? "--"} />
          <K
            label="NRIC"
            value={
              row.nric ? (
                <span className="font-mono text-xs">{row.nric}</span>
              ) : (
                <span className="text-red-700">Missing (Flow 3 may fail)</span>
              )
            }
          />
          <K label="PCNO" value={md.pcno ?? "--"} />
          <K label="Claim candidate" value={candidate.status} />
          <K
            label="Candidate reasons"
            value={Array.isArray(md.claimCandidateReasons) && md.claimCandidateReasons.length
              ? md.claimCandidateReasons.join(", ")
              : candidate.reasons.join(", ")}
          />
          <K label="Flow 3 route" value={md.flow3PortalRoute ?? "--"} />
          <K
            label="Extraction status"
            value={
              <span
                className={cn(
                  "inline-flex rounded-full border px-2.5 py-1 text-xs font-medium",
                  status === "completed"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : status === "failed"
                      ? "border-red-200 bg-red-50 text-red-700"
                      : status === "in_progress"
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-border bg-card text-muted-foreground",
                )}
              >
                {status ?? "pending"}
              </span>
            }
          />
          <K label="Extracted at" value={formatDateTimeDDMMYYYY(md.detailsExtractedAt ?? null) ?? "--"} />
          <K label="Last attempt" value={formatDateTimeDDMMYYYY(md.detailsExtractionLastAttempt ?? null) ?? "--"} />
          <K label="Charge type" value={md.chargeType ?? "--"} />
          <K
            label="MC"
            value={
              md.mcDays != null ? (
                <span>
                  {String(md.mcDays)}{" "}
                  {md.mcDays ? (
                    <span className="text-muted-foreground">
                      (Start: {md.mcStartDate ?? "--"})
                    </span>
                  ) : null}
                </span>
              ) : (
                "--"
              )
            }
          />
          <K label="Diagnosis code" value={md.diagnosisCode ?? "--"} />
          <K label="Diagnosis (text)" value={row.diagnosis_description ?? "--"} />
          <K label="Diagnosis resolution" value={md.diagnosisResolution?.status ?? "--"} />
          <K
            label="Diagnosis evidence"
            value={
              md.diagnosisEvidence ? (
                <div className="space-y-1 text-xs">
                  <div>Source: {md.diagnosisEvidence.sourceTab ?? "--"}</div>
                  <div>Source date: {md.diagnosisEvidence.sourceDate ?? "--"}</div>
                  <div>Confidence: {md.diagnosisEvidence.confidence ?? "--"}</div>
                  <div>Reason: {md.diagnosisEvidence.rejectionReason ?? "--"}</div>
                  <div>
                    Artifacts:{" "}
                    {md.diagnosisEvidence.artifactPaths?.json ||
                    md.diagnosisEvidence.artifactPaths?.screenshot
                      ? "saved"
                      : "none"}
                  </div>
                </div>
              ) : (
                "--"
              )
            }
          />
          <K
            label="Medicines"
            value={
              meds.length ? (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">
                    {meds.length} item(s)
                  </div>
                  <ul className="list-disc pl-4 text-sm">
                    {meds.slice(0, 10).map((m, idx) => (
                      <li key={`${m.name}-${idx}`}>
                        {m.name}
                        {m.quantity != null ? (
                          <span className="text-muted-foreground"> x{m.quantity}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {meds.length > 10 ? (
                    <div className="text-xs text-muted-foreground">
                      +{meds.length - 10} more
                    </div>
                  ) : null}
                </div>
              ) : (
                <span className="text-muted-foreground">--</span>
              )
            }
          />
          <K
            label="Treatment detail"
            value={
              treatmentLines.length ? (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">
                    {treatmentLines.length} line(s) from Clinic Assist
                  </div>
                  <div className="max-h-48 overflow-auto rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs">
                    {treatmentLines.slice(0, 50).join("\n")}
                    {treatmentLines.length > 50 ? "\n..." : ""}
                  </div>
                </div>
              ) : (
                <span className="text-muted-foreground">--</span>
              )
            }
          />
          <K label="Submission status" value={row.submission_status ?? "--"} />
          <K label="Flow 3 mode" value={flow3Mode ?? "--"} />
          <K label="Flow 3 blocked reason" value={flow3BlockedReason ?? "--"} />
          <K label="Flow 3 session" value={row.submission_metadata?.sessionState ?? "--"} />
          <K label="Flow 3 evidence" value={flow3Evidence ? "Captured" : "--"} />
          <K
            label="Submitted truth"
            value={flow3TruthCaptured ? row.submission_metadata?.submittedTruthSnapshot?.source ?? "Captured" : "--"}
          />
          <K
            label="Flow 3 compare"
            value={
              flow3Comparison ? (
                <div className="space-y-1 text-xs">
                  <div>Overall: {flow3Comparison.state ?? "--"}</div>
                  <div>Bot vs submitted: {flow3Comparison.botVsSubmittedTruth?.state ?? "--"}</div>
                  <div>Flow 2 vs submitted: {flow3Comparison.flow2VsSubmittedTruth?.state ?? "--"}</div>
                </div>
              ) : (
                "--"
              )
            }
          />
          <K
            label="Mismatch categories"
            value={flow3MismatchCategories.length ? flow3MismatchCategories.join(", ") : "--"}
          />
          <K label="Submitted at" value={formatDateTimeDDMMYYYY(row.submitted_at ?? null) ?? "--"} />
          <K label="Updated at" value={formatDateTimeDDMMYYYY(row.updated_at ?? null) ?? "--"} />
        </div>
      </div>
    </Card>
  );
}
