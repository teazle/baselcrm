import fs from 'fs/promises';
import path from 'path';

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function clean(value, fallback = '-') {
  const s = String(value ?? '').trim();
  return s || fallback;
}

function escapeCell(value) {
  return clean(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function portalTargetToLabel(target) {
  const key = String(target || '').trim().toUpperCase();
  if (key === 'MHC') return 'MHC Asia';
  if (key === 'ALLIANCE_MEDINET') return 'Alliance Medinet';
  if (key === 'ALLIANZ') return 'Allianz';
  if (key === 'FULLERTON' || key === 'FULLERT') return 'Fullerton';
  if (key === 'IHP') return 'IHP';
  if (key === 'IXCHANGE' || key === 'ALL' || key === 'PARKWAY') return 'iXchange';
  if (key === 'GE_NTUC' || key === 'GE' || key === 'NTUC_IM' || key === 'NTUCIM') return 'GE/NTUC';
  return key || 'Unknown';
}

function toMarkdown({
  flowName,
  generatedAt,
  scope = {},
  totals = {},
  rows = [],
}) {
  const lines = [];
  lines.push(`# ${flowName} Run Summary`);
  lines.push('');
  lines.push(`Generated At: ${generatedAt}`);
  lines.push(`Date Range: ${clean(scope.from)} to ${clean(scope.to)}`);
  lines.push(`Date: ${clean(scope.date)}`);
  lines.push(`Pay Type: ${clean(scope.payType)}`);
  lines.push(`Portal Targets: ${clean(scope.portalTargets)}`);
  lines.push(`Visit IDs: ${clean(scope.visitIds)}`);
  lines.push('');
  lines.push('## Totals');
  for (const [k, v] of Object.entries(totals || {})) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push('');
  lines.push('## Records');
  lines.push('| Date | Patient Name | NRIC | Pay Type | TPA/Portal | Status | Diagnosis Status | Notes |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of rows) {
    lines.push(
      `| ${escapeCell(row.date)} | ${escapeCell(row.patientName)} | ${escapeCell(row.nric)} | ${escapeCell(row.payType)} | ${escapeCell(row.portal)} | ${escapeCell(row.status)} | ${escapeCell(row.diagnosisStatus)} | ${escapeCell(row.notes)} |`
    );
  }
  if (!rows.length) {
    lines.push('| - | - | - | - | - | no_records | - | No records for this run |');
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export async function writeRunSummaryReport({
  flowName,
  filePrefix,
  scope = {},
  totals = {},
  rows = [],
}) {
  const generatedAt = new Date().toISOString();
  const stamp = nowStamp();
  const baseDir = path.resolve(process.cwd(), 'output', 'run-reports');
  await fs.mkdir(baseDir, { recursive: true });

  const safePrefix = String(filePrefix || flowName || 'run')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const baseName = `${safePrefix}_${stamp}`;
  const mdPath = path.join(baseDir, `${baseName}.md`);
  const jsonPath = path.join(baseDir, `${baseName}.json`);

  const payload = {
    flowName,
    generatedAt,
    scope,
    totals,
    rows,
  };

  await fs.writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.writeFile(mdPath, toMarkdown(payload), 'utf8');

  return { mdPath, jsonPath };
}

