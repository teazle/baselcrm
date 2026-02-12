import { spawn } from "child_process";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function repoRoot() {
  return path.resolve(process.cwd(), "..", "..");
}

function spawnSubmission(args: string[]) {
  const child = spawn(process.execPath, args, {
    cwd: repoRoot(),
    env: { ...process.env },
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return child.pid;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const visitIds = Array.isArray(body?.visitIds) ? body.visitIds : undefined;
  const payType = typeof body?.payType === "string" ? body.payType : undefined;
  const from = typeof body?.from === "string" ? body.from : undefined;
  const to = typeof body?.to === "string" ? body.to : undefined;
  const portalOnly = Boolean(body?.portalOnly);
  const saveAsDraft = Boolean(body?.saveAsDraft);
  const leaveOpen = Boolean(body?.leaveOpen);

  try {
    // For now, we'll create a simple batch submission script
    // In the future, this could call ClaimSubmitter directly
    const args = ["src/examples/submit-claims-batch.js"];
    if (visitIds && visitIds.length > 0) {
      args.push("--visit-ids", visitIds.join(","));
    }
    if (payType) {
      args.push("--pay-type", payType);
    }
    if (from) {
      args.push("--from", from);
    }
    if (to) {
      args.push("--to", to);
    }
    if (portalOnly) {
      args.push("--portal-only");
    }
    if (saveAsDraft) {
      args.push("--save-as-draft");
    }
    if (leaveOpen) {
      args.push("--leave-open");
    }
    if (
      (!visitIds || visitIds.length === 0) &&
      !payType &&
      !from &&
      !to &&
      !portalOnly
    ) {
      // The CLI now blocks unscoped runs unless explicit.
      args.push("--all-pending");
    }

    const pid = spawnSubmission(args);
    return NextResponse.json({
      ok: true,
      pid,
      message: saveAsDraft
        ? "Claim submission started (saving as draft)."
        : leaveOpen
          ? "Claim fill started (browser left open)."
          : "Claim fill started.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: String((error as Error).message ?? error) },
      { status: 500 },
    );
  }
}
