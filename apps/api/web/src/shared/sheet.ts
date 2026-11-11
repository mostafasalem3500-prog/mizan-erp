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

export type SheetMeta = { company?: string; taxId?: string; taxLabel?: string };
let META: SheetMeta = {};
/** Who the exports belong to — set once after sign-in, printed on top of every sheet. */
export const setSheetMeta = (m: SheetMeta) => { META = m || {}; };
export const sheetMeta = () => META;

const TEXT_COL = /رقم|رمز|كود|حساب|باركود|جوال|هاتف|موبايل|ضريبي|سجل|مرجع|هوية|بريدي|المبنى|آيبان|ايبان|sku|code|iban|^#$|^م$/i;
const NO_SUM = /سعر|نسبة|نسبه|%|٪|معدل|هامش|متوسط|رصيد|سنة|شهر|يوم|أيام|ايام|عمر|تكلفة الوحدة|العدد المتبقي|الحد/;
const TOTAL_LABEL = /^(الإجمالي|الاجمالي|المجموع|الإجمالي العام|إجمالي)/;
const isNumStr = (v: any) => typeof v === "string" && v.length < 16 && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v.trim());
const isDateStr = (v: any) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Array of objects → a finished .xlsx report: establishment and report title on top, styled header with filters, number
 * and date formats, a totals row for amount columns, right-to-left, and print settings (A4, fit to width, repeated
 * header, page numbers). `sub` is an optional line under the title (period, branch, filters).
 */
export async function writeSheet(rows: any[], fileName: string, sheet = "Sheet1", opts: { title?: string; sub?: string; totals?: boolean } = {}) {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Mizan ERP"; wb.created = new Date();
  const title = opts.title || fileName;
  const keys: string[] = [];
  for (const r of rows) for (const k of Object.keys(r || {})) if (!keys.includes(k)) keys.push(k);
  if (!keys.length) keys.push("لا توجد بيانات");
  const HEAD = 5; // rows 1-3: establishment / title / details, row 4 blank, row 5 column headers
  const ws = wb.addWorksheet(sheet.replace(/[\[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet1", {
    views: [{ rightToLeft: true, state: "frozen", ySplit: HEAD, showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: keys.length > 6 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${HEAD}:${HEAD}`, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 } },
    headerFooter: { oddFooter: `&L&8Mizan ERP&C&8صفحة &P من &N&R&8${title}` },
  });
  // value normalisation per column
  const textCol = keys.map((k) => TEXT_COL.test(k));
  const val = (v: any, c: number) => {
    if (v === null || v === undefined || v === "") return null;
    if (v instanceof Date) return v;
    if (typeof v === "boolean") return v ? "نعم" : "لا";
    if (!textCol[c] && isNumStr(v)) return Number(v);
    if (typeof v === "object") return String(v);
    return v;
  };
  const data = rows.map((r) => keys.map((k, c) => val(r?.[k], c)));
  const numeric = keys.map((_, c) => !textCol[c] && data.some((r) => typeof r[c] === "number") && data.every((r) => r[c] === null || typeof r[c] === "number"));
  const decimals = keys.map((_, c) => numeric[c] && data.some((r) => typeof r[c] === "number" && !Number.isInteger(r[c])));
  const last = keys.length;
  const span = (n: number) => { if (last > 1) ws.mergeCells(n, 1, n, last); return ws.getCell(n, 1); };
  const stamp = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 16).replace("T", " الساعة "); // an Arabic word between the two numbers keeps their order in right-to-left text
  let c1 = span(1); c1.value = META.company || "ميزان ERP"; c1.font = { bold: true, size: 14, color: { argb: "FF0F5C55" } };
  c1 = span(2); c1.value = title; c1.font = { bold: true, size: 12 };
  c1 = span(3); c1.value = [opts.sub, META.taxId ? `${META.taxLabel || "الرقم الضريبي"}: ${META.taxId}` : "", `تاريخ الاستخراج: ${stamp}`, `${rows.length} سجل`].filter(Boolean).join("   ·   "); c1.font = { size: 9, color: { argb: "FF64748B" } };
  for (const n of [1, 2, 3]) ws.getCell(n, 1).alignment = { horizontal: "right", vertical: "middle", readingOrder: "rtl" };
  ws.getRow(1).height = 22;
  const thin = { style: "thin" as const, color: { argb: "FFD5DEDD" } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };
  const hr = ws.getRow(HEAD); hr.height = 20;
  keys.forEach((k, c) => { const cell = hr.getCell(c + 1); cell.value = k; cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true, readingOrder: "rtl" }; cell.border = border; });
  data.forEach((r, i) => {
    const row = ws.getRow(HEAD + 1 + i);
    const totalRow = typeof r[0] === "string" && TOTAL_LABEL.test(r[0]);
    r.forEach((v, c) => {
      const cell = row.getCell(c + 1);
      cell.value = v; cell.border = border;
      if (typeof v === "number") { cell.numFmt = decimals[c] ? "#,##0.00;[Red]-#,##0.00" : "#,##0;[Red]-#,##0"; cell.alignment = { horizontal: "left" }; }
      else cell.alignment = { horizontal: isDateStr(v) ? "center" : "right", vertical: "top", wrapText: typeof v === "string" && v.length > 60, readingOrder: "rtl" };
      if (i % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6FAF9" } };
      if (totalRow) { cell.font = { bold: true }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F4F2" } }; }
    });
  });
  // totals: amount columns only (never prices, rates, running balances or codes), and not when the report already has its own total line
  const hasOwnTotal = data.some((r) => r.some((v) => typeof v === "string" && TOTAL_LABEL.test(v)));
  const sumCols = keys.map((k, c) => numeric[c] && !NO_SUM.test(k));
  if (opts.totals !== false && data.length > 1 && !hasOwnTotal && sumCols.some(Boolean)) {
    const n = HEAD + 1 + data.length; const row = ws.getRow(n);
    const labelCol = Math.max(0, sumCols.indexOf(true) - 1);
    keys.forEach((_, c) => {
      const cell = row.getCell(c + 1); cell.border = { ...border, top: { style: "medium", color: { argb: "FF0F766E" } } }; cell.font = { bold: true }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F4F2" } };
      if (sumCols[c]) { const L = ws.getColumn(c + 1).letter; cell.value = { formula: `SUBTOTAL(109,${L}${HEAD + 1}:${L}${n - 1})`, result: data.reduce((a, r) => a + (typeof r[c] === "number" ? r[c] : 0), 0) } as any; cell.numFmt = decimals[c] ? "#,##0.00;[Red]-#,##0.00" : "#,##0;[Red]-#,##0"; cell.alignment = { horizontal: "left" }; }
      else if (c === labelCol && !sumCols[c]) { cell.value = "الإجمالي"; cell.alignment = { horizontal: "right", readingOrder: "rtl" }; }
    });
  }
  if (data.length) ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: HEAD + data.length, column: last } };
  keys.forEach((k, c) => { ws.getColumn(c + 1).width = Math.min(55, Math.max(10, String(k).length + 4, ...data.slice(0, 800).map((r) => (typeof r[c] === "number" ? r[c].toFixed(decimals[c] ? 2 : 0).length + 4 : String(r[c] ?? "").length + 2)))); });
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${fileName.replace(/[\\/:*?"<>|]+/g, "-")}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
