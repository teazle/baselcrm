"use client";

export function downloadText(filename: string, text: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function toCsv(rows: Array<Record<string, unknown>>) {
  const headers = Array.from(
    rows.reduce((set, r) => {
      for (const k of Object.keys(r)) set.add(k);
      return set;
    }, new Set<string>()),
  );
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => esc((r as any)[h])).join(","));
  }
  return lines.join("\n");
}

export function printHtml(title: string, htmlBody: string) {
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) return;
  win.document.open();
  win.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 24px; color: #0f172a; }
      h1 { font-size: 18px; margin: 0 0 12px; }
      h2 { font-size: 13px; margin: 18px 0 8px; color: #334155; }
      .meta { font-size: 12px; color: #475569; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { border: 1px solid #e2e8f0; padding: 8px; text-align: left; vertical-align: top; }
      th { background: #f8fafc; }
      .note { font-size: 11px; color: #64748b; margin-top: 14px; }
      @media print { body { margin: 12mm; } }
    </style>
  </head>
  <body>
    ${htmlBody}
  </body>
</html>`);
  win.document.close();
  // Give the browser a tick to render before printing.
  setTimeout(() => {
    win.focus();
    win.print();
  }, 250);
}


