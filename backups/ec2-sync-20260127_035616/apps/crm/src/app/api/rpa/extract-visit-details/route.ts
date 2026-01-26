import { spawn } from "child_process";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function repoRoot() {
  return path.resolve(process.cwd(), "..", "..");
}

function spawnExtraction(args: string[]) {
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
  const retryFailed = Boolean(body?.retryFailed);

  try {
    const args = ["src/examples/extract-visit-details-batch.js"];
    if (retryFailed) args.push("--retry-failed");
    const pid = spawnExtraction(args);
    return NextResponse.json({
      ok: true,
      pid,
      message: retryFailed
        ? "Visit details retry started."
        : "Visit details extraction started.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: String((error as Error).message ?? error) },
      { status: 500 },
    );
  }
}
