import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReportPayload = {
  flowName?: string;
  generatedAt?: string;
  scope?: Record<string, unknown>;
  totals?: Record<string, unknown>;
  rows?: unknown[];
};

type ReportRow = {
  date: string;
  patientName: string;
  nric: string;
  payType: string;
  portal: string;
  status: string;
  diagnosisStatus: string;
  notes: string;
};

type ReportListItem = {
  baseName: string;
  flowPrefix: string;
  stamp: string;
  mdFile: string | null;
  mdUrl: string | null;
  flowName: string | null;
  generatedAt: string | null;
  scope: Record<string, unknown> | null;
  totals: Record<string, unknown> | null;
  rowCount: number;
  rows: ReportRow[];
};

function repoRoot() {
  return path.resolve(process.cwd(), "..", "..");
}

function reportsDir() {
  return path.join(repoRoot(), "output", "run-reports");
}

function isSafeFlowPrefix(value: string) {
  return /^[a-z0-9_-]+$/i.test(value);
}

function isSafeReportFileName(value: string) {
  return /^[a-z0-9_-]+_\d{8}_\d{6}\.(md|json)$/i.test(value);
}

function parseReportFileName(fileName: string) {
  const match = fileName.match(/^([a-z0-9_-]+)_(\d{8}_\d{6})\.(md|json)$/i);
  if (!match) return null;
  return {
    flowPrefix: match[1].toLowerCase(),
    stamp: match[2],
    ext: match[3].toLowerCase(),
  };
}

async function readReportList(flow?: string | null, limit = 10) {
  const dir = reportsDir();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return [];
    throw error;
  }

  const map = new Map<
    string,
    {
      flowPrefix: string;
      stamp: string;
      mdFile: string | null;
      jsonFile: string | null;
    }
  >();

  for (const name of entries) {
    const parsed = parseReportFileName(name);
    if (!parsed) continue;
    if (flow && parsed.flowPrefix !== flow) continue;
    const baseName = `${parsed.flowPrefix}_${parsed.stamp}`;
    if (!map.has(baseName)) {
      map.set(baseName, {
        flowPrefix: parsed.flowPrefix,
        stamp: parsed.stamp,
        mdFile: null,
        jsonFile: null,
      });
    }
    const item = map.get(baseName)!;
    if (parsed.ext === "md") item.mdFile = name;
    if (parsed.ext === "json") item.jsonFile = name;
  }

  const bases = Array.from(map.values()).sort((a, b) =>
    b.stamp.localeCompare(a.stamp)
  );
  const limited = bases.slice(0, Math.max(1, Math.min(limit, 50)));

  const out: ReportListItem[] = [];
  for (const item of limited) {
    const baseName = `${item.flowPrefix}_${item.stamp}`;
    let payload: ReportPayload | null = null;
    if (item.jsonFile) {
      try {
        const jsonPath = path.join(dir, item.jsonFile);
        const raw = await fs.readFile(jsonPath, "utf8");
        payload = JSON.parse(raw) as ReportPayload;
      } catch {
        payload = null;
      }
    }
    const rows =
      Array.isArray(payload?.rows) && payload?.rows
        ? payload.rows.map((row: unknown) => {
            const r = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
            return {
              date: String(r.date ?? "-"),
              patientName: String(r.patientName ?? "-"),
              nric: String(r.nric ?? "-"),
              payType: String(r.payType ?? "-"),
              portal: String(r.portal ?? "-"),
              status: String(r.status ?? "-"),
              diagnosisStatus: String(r.diagnosisStatus ?? "-"),
              notes: String(r.notes ?? ""),
            };
          })
        : [];
    out.push({
      baseName,
      flowPrefix: item.flowPrefix,
      stamp: item.stamp,
      mdFile: item.mdFile,
      mdUrl: item.mdFile
        ? `/api/rpa/run-reports?file=${encodeURIComponent(item.mdFile)}`
        : null,
      flowName: payload?.flowName || null,
      generatedAt: payload?.generatedAt || null,
      scope:
        payload?.scope && typeof payload.scope === "object" ? payload.scope : null,
      totals:
        payload?.totals && typeof payload.totals === "object"
          ? payload.totals
          : null,
      rowCount: rows.length,
      rows,
    });
  }

  return out;
}

async function readReportFile(fileName: string) {
  const safeName = path.basename(fileName);
  if (!isSafeReportFileName(safeName)) return null;
  const fullPath = path.join(reportsDir(), safeName);
  const resolved = path.resolve(fullPath);
  const baseDir = path.resolve(reportsDir());
  if (!resolved.startsWith(baseDir)) return null;
  const content = await fs.readFile(resolved);
  const isJson = safeName.toLowerCase().endsWith(".json");
  return {
    content,
    contentType: isJson
      ? "application/json; charset=utf-8"
      : "text/markdown; charset=utf-8",
    fileName: safeName,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const file = String(url.searchParams.get("file") || "").trim();
  const flow = String(url.searchParams.get("flow") || "")
    .trim()
    .toLowerCase();
  const limit = Number(url.searchParams.get("limit") || "10");

  try {
    if (file) {
      const reportFile = await readReportFile(file);
      if (!reportFile) {
        return NextResponse.json({ error: "Report file not found." }, { status: 404 });
      }
      return new NextResponse(reportFile.content, {
        status: 200,
        headers: {
          "Content-Type": reportFile.contentType,
          "Content-Disposition": `inline; filename="${reportFile.fileName}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    if (flow && !isSafeFlowPrefix(flow)) {
      return NextResponse.json({ error: "Invalid flow prefix." }, { status: 400 });
    }

    const items = await readReportList(flow || null, limit);
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    return NextResponse.json(
      { error: String((error as Error)?.message || error) },
      { status: 500 }
    );
  }
}
