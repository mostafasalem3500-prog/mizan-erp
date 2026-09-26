import Decimal from "decimal.js";
import type { Request, Response, NextFunction, RequestHandler } from "express";

// ─── errors ────────────────────────────────────────────────────────────────
export class AppError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: any) {
    super(message);
  }
}
export const bad = (msg: string, details?: any) => new AppError(400, msg, "BAD_REQUEST", details);
export const forbidden = (msg = "ليست لديك صلاحية لهذا الإجراء") => new AppError(403, msg, "FORBIDDEN");
export const notFound = (msg = "السجل غير موجود") => new AppError(404, msg, "NOT_FOUND");
export const conflict = (msg: string) => new AppError(409, msg, "CONFLICT");

// ─── money ─────────────────────────────────────────────────────────────────
Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });
export const D = (v: any) => new Decimal(v === null || v === undefined || v === "" ? 0 : v);
/** round half-up to 2 decimals (halalas) */
export const r2 = (v: any): number => D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
export const r3 = (v: any): number => D(v).toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toNumber();
export const r4 = (v: any): number => D(v).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();
export const sum = (arr: any[], f: (x: any) => any = (x) => x): number =>
  arr.reduce((a, x) => a.plus(D(f(x))), D(0)).toDecimalPlaces(2).toNumber();
export const num = (v: any, def = 0): number => {
  if (v === null || v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw bad(`قيمة رقمية غير صحيحة: ${v}`);
  return n;
};
export const money2 = (v: any) => r2(v).toFixed(2);

// ─── tax codes ─────────────────────────────────────────────────────────────
/** Sales: S standard 15%, Z zero-rated domestic, X export (zero), E exempt, O out of scope.
 *  Purchases: S standard, IM import VAT paid at customs, RC reverse charge, Z, E, O. */
export const TAX_CODES: Record<string, { rate: number; ar: string; zatca: string }> = {
  S: { rate: 15, ar: "خاضع 15%", zatca: "S" },
  Z: { rate: 0, ar: "نسبة صفرية", zatca: "Z" },
  X: { rate: 0, ar: "صادرات (صفري)", zatca: "Z" },
  E: { rate: 0, ar: "معفى", zatca: "E" },
  O: { rate: 0, ar: "خارج النطاق", zatca: "O" },
  IM: { rate: 15, ar: "استيراد - ضريبة مدفوعة بالجمارك", zatca: "S" },
  RC: { rate: 15, ar: "استيراد - احتساب عكسي", zatca: "S" },
};
export function taxRate(code: string): number {
  const t = TAX_CODES[code];
  if (!t) throw bad(`رمز ضريبي غير معروف: ${code}`);
  return t.rate;
}

/** Compute a document line. When pricesIncludeVat the unit price is gross. */
export function calcLine(qty: number, unitPrice: number, discountPct: number, code: string, pricesIncludeVat = false) {
  const rate = code === "RC" ? 0 : taxRate(code); // reverse charge: supplier invoice carries no VAT
  const gross = D(qty).times(unitPrice).times(D(1).minus(D(discountPct).div(100)));
  const before = D(qty).times(unitPrice);
  let net: number, vat: number;
  if (pricesIncludeVat && rate > 0) {
    const total = r2(gross);
    net = r2(D(total).div(D(1).plus(D(rate).div(100))));
    vat = r2(D(total).minus(net));
  } else {
    net = r2(gross);
    vat = r2(D(net).times(rate).div(100));
  }
  const discount = pricesIncludeVat && rate > 0
    ? r2(D(r2(before)).minus(r2(gross)).div(D(1).plus(D(rate).div(100))))
    : r2(D(before).minus(gross));
  return { net, vat, total: r2(D(net).plus(vat)), discount, rate: code === "RC" ? 15 : rate };
}

// ─── dates ─────────────────────────────────────────────────────────────────
export const today = () => {
  const d = new Date(Date.now() + 3 * 3600 * 1000); // Asia/Riyadh
  return d.toISOString().slice(0, 10);
};
export const isDate = (s: any) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const addDays = (s: string, n: number) => {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const addMonths = (s: string, n: number) => {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
export const monthEnd = (s: string) => {
  const d = new Date(s.slice(0, 7) + "-01T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
};
export const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

// ─── http ──────────────────────────────────────────────────────────────────
export const h =
  (fn: (req: Request, res: Response) => Promise<any>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res)
      .then((out) => {
        if (!res.headersSent) res.json(out ?? { ok: true });
      })
      .catch(next);
  };

export function req<T = any>(body: any, field: string, label?: string): T {
  const v = body?.[field];
  if (v === undefined || v === null || v === "") throw bad(`الحقل مطلوب: ${label || field}`);
  return v;
}

export function paging(q: any) {
  const limit = Math.min(Math.max(parseInt(q.limit || "50", 10) || 50, 1), 1000);
  const offset = Math.max(parseInt(q.offset || "0", 10) || 0, 0);
  return { limit, offset };
}
