import React, { useState } from "react";
import * as XLSX from "xlsx";
import { api, Modal, Field, Input, useAction, useToast, exportExcel } from "../lib";

type Spec = { key: string; labels: string[]; required?: boolean; example: any };

const PRODUCT_SPEC: Spec[] = [
  { key: "sku", labels: ["الرمز", "رمز الصنف", "sku", "code"], example: "P-0001" },
  { key: "name", labels: ["الاسم", "اسم الصنف", "الصنف", "name"], required: true, example: "أرز بسمتي 5 كجم" },
  { key: "nameEn", labels: ["الاسم بالإنجليزية", "name_en", "nameen", "english"], example: "Basmati Rice 5kg" },
  { key: "barcode", labels: ["الباركود", "barcode"], example: "6281234567890" },
  { key: "category", labels: ["التصنيف", "الفئة", "category"], example: "مواد غذائية" },
  { key: "type", labels: ["النوع", "type"], example: "STOCK" },
  { key: "unit", labels: ["الوحدة", "unit"], example: "كيس" },
  { key: "salePrice", labels: ["سعر البيع", "سعر بيع", "sale_price", "saleprice", "price"], example: 58 },
  { key: "purchasePrice", labels: ["سعر الشراء", "التكلفة", "purchase_price", "purchaseprice", "cost"], example: 42 },
  { key: "taxCode", labels: ["الضريبة", "رمز الضريبة", "tax", "taxcode", "tax_code"], example: "S" },
  { key: "reorderLevel", labels: ["حد الطلب", "حد إعادة الطلب", "reorder", "reorder_level"], example: 20 },
  { key: "openingQty", labels: ["الرصيد الافتتاحي", "كمية افتتاحية", "opening", "opening_qty", "qty"], example: 100 },
];
const PARTNER_SPEC: Spec[] = [
  { key: "code", labels: ["الكود", "code"], example: "C-0001" },
  { key: "name", labels: ["الاسم", "name"], required: true, example: "شركة النخبة للمقاولات" },
  { key: "nameEn", labels: ["الاسم بالإنجليزية", "name_en", "english"], example: "Elite Contracting" },
  { key: "kind", labels: ["النوع", "kind", "type"], example: "منشأة" },
  { key: "vatNumber", labels: ["الرقم الضريبي", "vat", "vat_number", "vatnumber"], example: "310123456700003" },
  { key: "crNumber", labels: ["السجل التجاري", "cr", "cr_number"], example: "1010012345" },
  { key: "phone", labels: ["الجوال", "الهاتف", "phone", "mobile"], example: "0551234567" },
  { key: "email", labels: ["البريد", "email"], example: "info@example.com" },
  { key: "street", labels: ["الشارع", "street"], example: "شارع الملك فهد" },
  { key: "buildingNo", labels: ["رقم المبنى", "building", "building_no"], example: "7845" },
  { key: "district", labels: ["الحي", "district"], example: "العزيزية" },
  { key: "city", labels: ["المدينة", "city"], example: "مكة المكرمة" },
  { key: "postalCode", labels: ["الرمز البريدي", "postal", "postal_code", "zip"], example: "24243" },
  { key: "creditLimit", labels: ["حد الائتمان", "credit_limit", "creditlimit"], example: 50000 },
  { key: "paymentTerms", labels: ["أيام السداد", "شروط السداد", "payment_terms", "terms"], example: 30 },
];

const norm = (s: any) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function mapRows(sheetRows: any[][], spec: Spec[]) {
  const header = sheetRows[0] || [];
  const cols: (string | null)[] = header.map((h: any) => { const n = norm(h); const f = spec.find((s) => s.labels.some((l) => norm(l) === n)); return f ? f.key : null; });
  const rows = sheetRows.slice(1).filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== "")).map((r) => { const o: any = {}; cols.forEach((k, i) => { if (k && r[i] !== undefined && r[i] !== null && String(r[i]).trim() !== "") o[k] = r[i]; }); return o; });
  return { cols, rows, unmapped: header.filter((_: any, i: number) => !cols[i]) };
}

export function ImportModal({ kind, role, onClose }: { kind: "products" | "partners"; role?: "CUSTOMER" | "SUPPLIER"; onClose: (done?: boolean) => void }) {
  const spec = kind === "products" ? PRODUCT_SPEC : PARTNER_SPEC;
  const [parsed, setParsed] = useState<{ cols: (string | null)[]; rows: any[]; unmapped: any[] } | null>(null);
  const [result, setResult] = useState<any>(null);
  const { run, busy } = useAction();
  const toast = useToast();
  const title = kind === "products" ? "استيراد الأصناف من Excel" : role === "SUPPLIER" ? "استيراد الموردين من Excel" : "استيراد العملاء من Excel";
  const onFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const m = mapRows(rows, spec);
    if (!m.cols.some((c) => c === "name")) return toast("لم يُعثر على عمود الاسم — استخدم القالب المرفق", "err");
    setParsed(m); setResult(null);
  };
  const template = () => exportExcel([Object.fromEntries(spec.map((s) => [s.labels[0], s.example]))], `قالب ${kind === "products" ? "الأصناف" : role === "SUPPLIER" ? "الموردين" : "العملاء"}`);
  return (
    <Modal wide title={title} onClose={() => onClose(!!result)} footer={<><button className="btn" onClick={template}>⬇ تنزيل القالب</button><div className="grow" /><button className="btn" onClick={() => onClose(!!result)}>إغلاق</button><button className="btn primary" disabled={!parsed || busy} onClick={() => run(async () => { const r = await api(`/import/${kind}`, { body: { rows: parsed!.rows, role } }); setResult(r); toast(`تم: ${r.created} جديد، ${r.updated} محدّث${r.errors.length ? `، ${r.errors.length} خطأ` : ""}`, r.errors.length ? "err" : "ok"); })}>استيراد {parsed ? `(${parsed.rows.length} صف)` : ""}</button></>}>
      <div className="alert info small">الصف الأول عناوين الأعمدة بالعربية أو الإنجليزية (كما في القالب). الصفوف التي لها نفس {kind === "products" ? "الرمز" : "الكود/الاسم"} تُحدَّث بدل تكرارها. {kind === "products" && "عمود «الرصيد الافتتاحي» يُنشئ قيد أرصدة افتتاحية للمخزون بسعر الشراء."}</div>
      <label className="dropzone mt" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}>
        اسحب ملف Excel هنا أو اضغط للاختيار (.xlsx / .csv)
        <input type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </label>
      {parsed && (
        <div className="mt">
          <div className="row small muted">أعمدة معروفة: {parsed.cols.filter(Boolean).length} · غير معروفة (تُهمل): {parsed.unmapped.map(String).join("، ") || "—"}</div>
          <div className="table-wrap mt" style={{ maxHeight: 300 }}><table className="tbl compact"><thead><tr>{spec.filter((s) => parsed.cols.includes(s.key)).map((s) => <th key={s.key}>{s.labels[0]}</th>)}</tr></thead>
            <tbody>{parsed.rows.slice(0, 50).map((r, i) => <tr key={i}>{spec.filter((s) => parsed.cols.includes(s.key)).map((s) => <td key={s.key}>{String(r[s.key] ?? "")}</td>)}</tr>)}</tbody></table></div>
          {parsed.rows.length > 50 && <div className="small muted">… و{parsed.rows.length - 50} صفاً آخر</div>}
        </div>
      )}
      {result && <div className={"alert mt " + (result.errors.length ? "warn" : "ok")}>تم إنشاء {result.created} وتحديث {result.updated}.{result.errors.length > 0 && <ul style={{ margin: "6px 0 0", paddingInlineStart: 18 }}>{result.errors.slice(0, 30).map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>}</div>}
    </Modal>
  );
}
