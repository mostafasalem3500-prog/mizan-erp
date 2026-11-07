/**
 * Customer/supplier data rules for the Saudi tax invoice (ZATCA e-invoicing, both phases).
 * A standard (B2B) tax invoice needs the buyer's VAT number — or, for a buyer not registered for VAT, another
 * identification (CR, national ID, iqama…) — and the full national address. Formats follow the ZATCA business rules
 * (BR-KSA-63 national address, BR-KSA-67 postal code, BR-KSA-14 buyer ID schemes, BR-KSA-40 VAT number).
 */
import { IS_EG, validTaxId } from "./country";

export const ID_TYPES: Record<string, { ar: string; pattern?: RegExp; hint?: string }> = {
  CRN: { ar: "السجل التجاري", pattern: /^\d{10}$/, hint: "10 أرقام" },
  "700": { ar: "الرقم الموحد (700)", pattern: /^7\d{9}$/, hint: "10 أرقام يبدأ بـ 7" },
  MOM: { ar: "ترخيص وزارة الشؤون البلدية" },
  MLS: { ar: "ترخيص وزارة الموارد البشرية" },
  SAG: { ar: "ترخيص وزارة الاستثمار" },
  NAT: { ar: "الهوية الوطنية", pattern: /^1\d{9}$/, hint: "10 أرقام يبدأ بـ 1" },
  IQA: { ar: "الإقامة", pattern: /^2\d{9}$/, hint: "10 أرقام يبدأ بـ 2" },
  GCC: { ar: "هوية خليجية" },
  PAS: { ar: "جواز السفر" },
  OTH: { ar: "أخرى" },
};
export const REGIONS = ["الرياض", "مكة المكرمة", "المدينة المنورة", "القصيم", "المنطقة الشرقية", "عسير", "تبوك", "حائل", "الحدود الشمالية", "جازان", "نجران", "الباحة", "الجوف"];

const digits = (v: any) => String(v ?? "").replace(/[\s-]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
const has = (v: any) => String(v ?? "").trim() !== "";

/** Saudi numbers: mobile 05xxxxxxxx / +9665xxxxxxxx, landline 01x…, unified 9200/800; foreign numbers in international form. */
export function validPhone(v: any) {
  const d = digits(v).replace(/^\+/, "00");
  return /^05\d{8}$/.test(d) || /^(00)?9665\d{8}$/.test(d) || /^5\d{8}$/.test(d) || /^01\d{7}$/.test(d) || /^(00)?9661\d{7}$/.test(d)
    || /^9200\d{5}$/.test(d) || /^800\d{7}$/.test(d) || (/^00\d{8,15}$/.test(d) && !/^00966/.test(d));
}
export const normPhone = (v: any) => (has(v) ? digits(v) : null);
const validEmail = (v: any) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || "").trim());

/** The ID value: CR number for CRN, the id_number column otherwise. */
export const buyerId = (p: any) => (!p?.idType || p.idType === "CRN" ? p?.crNumber : p?.idNumber) || null;

export type PartnerCheck = { errors: string[]; missing: string[]; taxReady: boolean; standardReady: boolean };

/**
 * errors = invalid formats (always enforced); missing = what a standard tax invoice still needs.
 * taxReady: the partner can receive a standard tax invoice; individuals only need a name for a simplified invoice.
 */
export function checkPartner(p: any): PartnerCheck {
  const errors: string[] = [], missing: string[] = [];
  if (IS_EG) return { errors, missing, taxReady: true, standardReady: true };
  const local = !p.country || String(p.country).toUpperCase() === "SA";
  if (has(p.vatNumber) && !validTaxId(digits(p.vatNumber))) errors.push("الرقم الضريبي يجب أن يكون 15 رقماً يبدأ وينتهي بـ 3");
  const t = p.idType || "CRN";
  if (!ID_TYPES[t]) errors.push("نوع هوية المشتري غير صحيح");
  const idv = buyerId(p);
  if (has(idv) && ID_TYPES[t]?.pattern && !ID_TYPES[t].pattern!.test(digits(idv))) errors.push(`${ID_TYPES[t].ar}: ${ID_TYPES[t].hint}`);
  if (has(p.crNumber) && t !== "CRN" && !/^\d{10}$/.test(digits(p.crNumber))) errors.push("السجل التجاري 10 أرقام");
  if (local) {
    if (has(p.buildingNo) && !/^\d{4}$/.test(digits(p.buildingNo))) errors.push("رقم المبنى 4 أرقام (العنوان الوطني)");
    if (has(p.additionalNo) && !/^\d{4}$/.test(digits(p.additionalNo))) errors.push("الرقم الإضافي 4 أرقام (العنوان الوطني)");
    if (has(p.postalCode) && !/^\d{5}$/.test(digits(p.postalCode))) errors.push("الرمز البريدي 5 أرقام");
  }
  if (has(p.phone) && !validPhone(p.phone)) errors.push("رقم الجوال غير صحيح — مثال 05XXXXXXXX");
  if (has(p.phone2) && !validPhone(p.phone2)) errors.push("رقم الهاتف الثاني غير صحيح");
  if (has(p.email) && !validEmail(p.email)) errors.push("البريد الإلكتروني غير صحيح");
  if (!local && !has(p.country)) errors.push("حدد الدولة");

  // what a standard (B2B) tax invoice needs
  if (!has(p.vatNumber) && !has(idv)) missing.push("الرقم الضريبي (أو هوية المشتري إن لم يكن مسجلاً في الضريبة)");
  if (!has(p.vatNumber) && has(idv) && !has(p.vatExemptReason) && p.kind === "COMPANY") missing.push("سبب عدم التسجيل في الضريبة");
  for (const [k, ar] of [["street", "اسم الشارع"], ["buildingNo", "رقم المبنى"], ["district", "الحي"], ["city", "المدينة"], ["postalCode", "الرمز البريدي"]] as const) if (!has(p[k])) missing.push(ar);
  if (!has(p.phone)) missing.push("رقم الجوال");
  const standardReady = !errors.length && !missing.length;
  const taxReady = p.kind === "INDIVIDUAL" ? !errors.length && has(p.name) : standardReady;
  return { errors, missing, taxReady, standardReady };
}

/** Saving a customer through the program: formats always; a company customer must be complete for a standard tax invoice. */
export function enforcePartner(p: any, opts: { strict: boolean }) {
  const c = checkPartner(p);
  if (c.errors.length) return c.errors.join(" — ");
  if (opts.strict && p.isCustomer && p.kind !== "INDIVIDUAL" && c.missing.length) return `بيانات الفاتورة الضريبية غير مكتملة للعميل (منشأة): ${c.missing.join("، ")}`;
  if (opts.strict && p.isCustomer && p.kind === "INDIVIDUAL" && !has(p.phone)) return "رقم الجوال مطلوب للعميل";
  return null;
}
