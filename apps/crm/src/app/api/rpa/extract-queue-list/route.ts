import { spawn } from "child_process";
import path from "path";
import { NextResponse } from "next/server";
import { getTodaySingapore } from "@/lib/utils/date";

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
  const date =
    typeof body?.date === "string" ? body.date : getTodaySingapore();
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return NextResponse.json(
      { error: "Invalid date. Use YYYY-MM-DD." },
      { status: 400 },
    );
  }

  try {
    const pid = spawnExtraction([
      "src/examples/extract-date-range.js",
      date,
      date,
    ]);
    return NextResponse.json({
      ok: true,
      pid,
      message: `Queue list extraction started for ${date}.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: String((error as Error).message ?? error) },
      { status: 500 },
    );
  }
}
