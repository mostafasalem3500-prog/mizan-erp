/**
 * Spreadsheet I/O (replaces the unmaintained npm "xlsx" 0.18.5 which has open CVEs).
 * - .xlsx read/write via exceljs (lazy-loaded so it never weighs on the main bundle)
 * - .csv read via a small RFC-4180 parser (UTF-8 BOM, `,` `;` or tab delimiters)
 * - legacy binary .xls is rejected with a clear message
 * Cell values are normalised the way the old code expected: numbers stay numbers,
 * dates become "YYYY-MM-DD", formulas give their cached result, rich text gives plain text.
 */

const loadExcel = async () => {
  const m: any = await import("exceljs");
  return (m.default ?? m) as typeof import("exceljs");
};

function cellValue(v: any): any {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v || "formula" in v || "sharedFormula" in v) return cellValue(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t: any) => t.text).join("");
    if ("text" in v) return cellValue(v.text);
    if ("error" in v) return null;
    return String(v);
  }
  return v;
}

/** Parse CSV text into rows of cells. Numbers are converted when the whole cell is numeric. */
export function parseCsv(text: string): any[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const first = text.split(/\r?\n/, 1)[0] || "";
  const counts = [",", ";", "\t"].map((d) => [d, first.split(d).length] as const);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: any[][] = [];
  let row: any[] = [], cell = "", quoted = false, wasQuoted = false;
  const push = () => {
    const t = cell;
    row.push(!wasQuoted && t.trim() !== "" && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(t.trim()) ? Number(t.trim()) : t === "" ? null : t);
    cell = ""; wasQuoted = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"' && cell === "") { quoted = true; wasQuoted = true; }
    else if (c === delim) push();
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; push(); rows.push(row); row = []; }
    else cell += c;
  }
  if (cell !== "" || row.length) { push(); rows.push(row); }
  return rows;
}

/** Read the first sheet of an .xlsx or .csv file into an array of rows (header row included). */
export async function readSheet(file: File | { name: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<any[][]> {
  const name = (file.name || "").toLowerCase();
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 8));
  const isZip = head[0] === 0x50 && head[1] === 0x4b; // PK.. = xlsx
  const isOle = head[0] === 0xd0 && head[1] === 0xcf; // legacy .xls
  if (isOle || (name.endsWith(".xls") && !isZip)) throw new Error("صيغة Excel القديمة (.xls) غير مدعومة — افتح الملف واحفظه بصيغة .xlsx أو .csv ثم أعد المحاولة");
  if (!isZip) return parseCsv(new TextDecoder("utf-8").decode(buf));
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const out: any[][] = [];
  const width = ws.actualColumnCount || ws.columnCount || 0;
  ws.eachRow({ includeEmpty: true }, (r, n) => {
    const row: any[] = [];
    for (let c = 1; c <= Math.max(width, r.cellCount); c++) row.push(cellValue(r.getCell(c).value));
    out[n - 1] = row;
  });
  for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = [];
  return out;
}

/** Rows (array of arrays, first row = headers) → array of objects keyed by header text. */
export function rowsToObjects(aoa: any[][], defval: any = ""): any[] {
  const headers = (aoa[0] || []).map((h) => String(h ?? "").trim());
  return aoa.slice(1)
    .filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ""))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? defval]).filter(([h]) => h)));
}

/** Write an array of objects to a downloaded .xlsx (RTL sheet, bold header, auto widths). */
export async function writeSheet(rows: any[], fileName: string, sheet = "Sheet1") {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Mizan ERP";
  const ws = wb.addWorksheet(sheet.replace(/[\[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet1", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  const keys: string[] = [];
  for (const r of rows) for (const k of Object.keys(r || {})) if (!keys.includes(k)) keys.push(k);
  ws.columns = keys.map((k) => ({
    header: k, key: k,
    width: Math.min(60, Math.max(8, String(k).length + 2, ...rows.slice(0, 500).map((r) => String(r?.[k] ?? "").length + 2))),
  }));
  for (const r of rows) ws.addRow(Object.fromEntries(keys.map((k) => [k, r?.[k] instanceof Date ? r[k] : r?.[k] ?? null])));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF5" } };
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${fileName}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
