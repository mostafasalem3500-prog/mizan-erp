/**
 * Invoice print templates: a set of ready designs in every paper size (A4, A5, 80mm and 58mm rolls), each one a
 * base style plus options the establishment can change (colour, what is shown, the texts). The chosen defaults and
 * the establishment's own templates are stored in companies.invoice_template and travel with every invoice.
 */
export type TplSize = "A4" | "A5" | "T80" | "T58";
export type TplStyle = "classic" | "modern" | "bold" | "minimal" | "elegant" | "letterhead";
export type TplOpts = {
  size: TplSize; style: TplStyle; accent: string; font: "S" | "M" | "L"; english: boolean;
  logo: boolean; logoSize: number; logoPos: "start" | "center" | "end";
  companyAddress: boolean; companyContact: boolean; companyCr: boolean;
  customerAddress: boolean; customerContact: boolean;
  colSku: boolean; colUnit: boolean; colDiscount: boolean; colTax: boolean; striped: boolean; borders: "full" | "rows" | "none";
  words: boolean; paid: boolean; notes: boolean; terms: boolean; footer: boolean; bank: boolean; signatures: boolean; watermark: boolean;
  title: string; headerNote: string; footerText: string; termsText: string; bankText: string; sign1: string; sign2: string; thanks: string;
  unitPrice: boolean; cashier: boolean; topMargin: number;
};
export type Tpl = { id: string; name: string; builtin?: boolean; note?: string; opts: TplOpts };
export type TplConfig = { defaults: { doc?: string; pos?: string }; items: Tpl[] };

const BASE: TplOpts = {
  size: "A4", style: "classic", accent: "#0f766e", font: "M", english: false,
  logo: true, logoSize: 60, logoPos: "start", companyAddress: true, companyContact: true, companyCr: true, customerAddress: true, customerContact: true,
  colSku: true, colUnit: true, colDiscount: true, colTax: true, striped: false, borders: "full",
  words: true, paid: true, notes: true, terms: true, footer: true, bank: false, signatures: false, watermark: true,
  title: "", headerNote: "", footerText: "", termsText: "", bankText: "", sign1: "المستلم", sign2: "المحاسب", thanks: "شكراً لتعاملكم معنا",
  unitPrice: true, cashier: true, topMargin: 0,
};
const T = (id: string, name: string, note: string, o: Partial<TplOpts>): Tpl => ({ id, name, note, builtin: true, opts: { ...BASE, ...o } });
export const PRESETS: Tpl[] = [
  T("a4-classic", "كلاسيكي", "A4 · الترويسة والجدول بحدود كاملة", {}),
  T("a4-modern", "عصري", "A4 · شريط ملوّن وجدول مخطط", { style: "modern", striped: true, borders: "rows", accent: "#1d4ed8" }),
  T("a4-bold", "داكن", "A4 · ترويسة داكنة قوية", { style: "bold", striped: true, borders: "rows", accent: "#111827" }),
  T("a4-minimal", "بسيط", "A4 · خطوط خفيفة بلا ألوان", { style: "minimal", borders: "rows", accent: "#374151", colSku: false }),
  T("a4-elegant", "أنيق", "A4 · إطار وشعار في الوسط", { style: "elegant", logoPos: "center", borders: "rows", accent: "#7c2d12", signatures: true }),
  T("a4-bilingual", "عربي / English", "A4 · العناوين باللغتين", { style: "modern", english: true, striped: true, borders: "rows", accent: "#0f766e" }),
  T("a4-compact", "مكثّف", "A4 · خط صغير لفواتير السطور الكثيرة", { font: "S", colSku: false, words: false, borders: "rows" }),
  T("a4-letterhead", "ورق مروّس", "A4 · بلا ترويسة: يُطبع على ورق المنشأة", { style: "letterhead", logo: false, topMargin: 40, footer: false }),
  T("a4-contract", "مع توقيعات وبنك", "A4 · بيانات التحويل وخانتا التوقيع", { style: "classic", bank: true, signatures: true, accent: "#0e7490" }),
  T("a5-classic", "A5 كلاسيكي", "نصف ورقة · للمحلات والتسليم", { size: "A5", font: "S", colSku: false, logoSize: 44 }),
  T("a5-modern", "A5 عصري", "نصف ورقة · شريط ملوّن", { size: "A5", font: "S", style: "modern", striped: true, borders: "rows", colSku: false, logoSize: 44, accent: "#1d4ed8" }),
  T("t80-standard", "حراري 80مم", "إيصال نقطة البيع", { size: "T80", font: "M", thanks: "شكراً لتسوقكم معنا", logoSize: 40 }),
  T("t80-detailed", "حراري 80مم مفصّل", "السعر والضريبة لكل سطر", { size: "T80", font: "M", colTax: true, colSku: true, customerContact: true, thanks: "شكراً لتسوقكم معنا", logoSize: 40 }),
  T("t80-large", "حراري 80مم خط كبير", "أوضح للقراءة", { size: "T80", font: "L", unitPrice: false, thanks: "شكراً لتسوقكم معنا", logoSize: 40 }),
  T("t58-compact", "حراري 58مم", "للطابعات الصغيرة والمحمولة", { size: "T58", font: "S", companyAddress: false, unitPrice: false, thanks: "شكراً لتسوقكم معنا", logoSize: 30 }),
];
export const SIZE_AR: Record<TplSize, string> = { A4: "A4", A5: "A5", T80: "حراري 80مم", T58: "حراري 58مم" };
export const STYLE_AR: Record<TplStyle, string> = { classic: "كلاسيكي", modern: "عصري", bold: "داكن", minimal: "بسيط", elegant: "أنيق", letterhead: "ورق مروّس" };
export const isRoll = (s: TplSize) => s === "T80" || s === "T58";

const HEX = /^#[0-9a-fA-F]{6}$/;
const str = (v: any, n: number) => String(v ?? "").slice(0, n);
/** Keeps a stored template within what the page can draw (anything unknown falls back to the base design). */
export function cleanOpts(o: any): TplOpts {
  const x = { ...BASE, ...(o || {}) };
  const bool = (k: keyof TplOpts) => ((x as any)[k] = !!(x as any)[k]);
  (["english", "logo", "companyAddress", "companyContact", "companyCr", "customerAddress", "customerContact", "colSku", "colUnit", "colDiscount", "colTax", "striped", "words", "paid", "notes", "terms", "footer", "bank", "signatures", "watermark", "unitPrice", "cashier"] as (keyof TplOpts)[]).forEach(bool);
  return { ...x,
    size: (["A4", "A5", "T80", "T58"] as TplSize[]).includes(x.size) ? x.size : "A4", style: (Object.keys(STYLE_AR) as TplStyle[]).includes(x.style) ? x.style : "classic",
    accent: HEX.test(x.accent) ? x.accent : BASE.accent, font: ["S", "M", "L"].includes(x.font) ? x.font : "M", logoPos: ["start", "center", "end"].includes(x.logoPos) ? x.logoPos : "start",
    borders: ["full", "rows", "none"].includes(x.borders) ? x.borders : "full", logoSize: Math.min(140, Math.max(20, Math.round(Number(x.logoSize) || 60))), topMargin: Math.min(90, Math.max(0, Math.round(Number(x.topMargin) || 0))),
    title: str(x.title, 60), headerNote: str(x.headerNote, 200), footerText: str(x.footerText, 400), termsText: str(x.termsText, 800), bankText: str(x.bankText, 400), sign1: str(x.sign1, 40), sign2: str(x.sign2, 40), thanks: str(x.thanks, 80) };
}
export function cleanConfig(c: any): TplConfig {
  const items: Tpl[] = Array.isArray(c?.items) ? c.items.slice(0, 30).map((t: any, i: number) => ({ id: /^[a-z0-9-]{3,40}$/.test(t?.id || "") && !PRESETS.some((p) => p.id === t.id) ? t.id : `my-${i + 1}`, name: str(t?.name, 50) || `قالبي ${i + 1}`, opts: cleanOpts(t?.opts) })) : [];
  const all = [...PRESETS, ...items]; const ok = (id: any, roll: boolean) => (all.some((t) => t.id === id && isRoll(t.opts.size) === roll) ? id : undefined);
  return { defaults: { doc: ok(c?.defaults?.doc, false), pos: ok(c?.defaults?.pos, true) }, items };
}
export const allTemplates = (c: any): Tpl[] => [...PRESETS, ...cleanConfig(c).items];
/** The template to print with: the one asked for, else the establishment's default for this use, else the classic. */
export function resolveTpl(c: any, use: "doc" | "pos", id?: string | null): Tpl {
  const cfg = cleanConfig(c), all = [...PRESETS, ...cfg.items];
  return all.find((t) => t.id === id) || all.find((t) => t.id === cfg.defaults[use]) || PRESETS.find((t) => t.id === (use === "pos" ? "t80-standard" : "a4-classic"))!;
}
/** Arabic label, with the English one beside it on bilingual templates. */
const EN: Record<string, string> = {
  "الرقم": "No.", "التاريخ": "Date", "الاستحقاق": "Due date", "العميل": "Customer", "المورد": "Supplier", "البيان": "Description", "الكمية": "Qty", "سعر الوحدة": "Unit price", "خصم": "Disc.",
  "المبلغ قبل الضريبة": "Amount excl. tax", "الضريبة": "Tax", "الإجمالي": "Total", "الإجمالي قبل الخصم": "Subtotal", "الخصم": "Discount", "الإجمالي الخاضع للضريبة": "Taxable amount",
  "ضريبة القيمة المضافة": "VAT", "الإجمالي شامل الضريبة": "Total incl. tax", "المسدد": "Paid", "المتبقي": "Balance due", "الرقم الضريبي": "VAT No.", "السجل التجاري": "C.R.", "ملاحظات": "Notes",
  "فاتورة ضريبية": "Tax Invoice", "فاتورة ضريبية مبسطة": "Simplified Tax Invoice", "عرض سعر": "Quotation", "إشعار دائن": "Credit Note", "إشعار مدين": "Debit Note", "الوحدة": "Unit", "الرمز": "Code", "بيانات التحويل البنكي": "Bank details",
};
export const lbl = (o: TplOpts, ar: string) => (o.english && EN[ar] ? `${ar} / ${EN[ar]}` : ar);
export const enOf = (ar: string) => EN[ar] || "";

/** A made-up invoice for previews in the gallery and the editor. */
export function sampleDoc(company: any, vatRate: number, _cur?: string): any {
  const L = [["خدمة تركيب وصيانة", "SRV-01", 2, "ساعة", 350, 0], ["طابعة ليزر مكتبية", "PRN-220", 1, "حبة", 1450, 5], ["ورق تصوير A4 — كرتون", "PPR-A4", 4, "كرتون", 95, 0]] as [string, string, number, string, number, number][];
  const lines = L.map(([description, sku, qty, unit, unitPrice, discountPct], i) => { const net = Math.round(qty * unitPrice * (1 - discountPct / 100) * 100) / 100, vat = Math.round(net * vatRate) / 100; return { id: `s${i}`, description, sku, qty, unit, unitPrice, discountPct, netAmount: net, vatAmount: vat, total: net + vat }; });
  const subtotal = L.reduce((a, l) => a + l[2] * l[4], 0), taxable = lines.reduce((a, l) => a + l.netAmount, 0), vatTotal = lines.reduce((a, l) => a + l.vatAmount, 0);
  return { id: "sample", direction: "SALE", kind: "INVOICE", invoiceType: "STANDARD", status: "POSTED", number: "INV-2026-00125", date: new Date().toISOString().slice(0, 10), issuedAt: new Date().toISOString(), dueDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    partnerName: "شركة الأفق للتجارة", partner: { street: "طريق الملك فهد", district: "العليا", city: "الرياض", postalCode: "12211", vatNumber: "310000000000003", crNumber: "1010000000", phone: "0110000000" },
    lines, subtotal, discountTotal: subtotal - taxable, taxable, vatTotal, total: taxable + vatTotal, amountPaid: 1000, notes: "التسليم خلال ثلاثة أيام عمل.", createdBy: "أحمد", tenders: [{ method: "CASH", amount: 1000 }], exchangeRate: 1,
    company: { ...(company || {}), nameAr: company?.nameAr || "منشأتك التجارية", vatNumber: company?.vatNumber || "300000000000003" } };
}
