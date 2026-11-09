/**
 * Customer loyalty points. Earned on posted sales to a named customer, reversed on returns, redeemed at the POS.
 * A redemption is booked as a discount on the sale (it lowers revenue and output VAT — the ZATCA treatment of a seller's
 * own loyalty points), so no separate journal is needed; the ledger keeps every movement per customer.
 */
import { Db } from "../db/pool";
import { bad, r2, D, num, today, addDays } from "../lib/core";

export type LoyaltySettings = { enabled: boolean; earnRate: number; pointValue: number; minRedeem: number; maxRedeemPct: number; expiryMonths: number; walkInExcluded: true };
export const LOYALTY_DEFAULTS: LoyaltySettings = { enabled: false, earnRate: 1, pointValue: 0.05, minRedeem: 100, maxRedeemPct: 50, expiryMonths: 12, walkInExcluded: true };

export function loyaltySettings(company: any): LoyaltySettings {
  return { ...LOYALTY_DEFAULTS, ...(company?.loyalty || {}) };
}

export async function saveLoyaltySettings(t: Db, companyId: string, b: any) {
  const s: LoyaltySettings = {
    enabled: !!b.enabled,
    earnRate: Math.max(0, Math.min(100, num(b.earnRate ?? LOYALTY_DEFAULTS.earnRate))),
    pointValue: Math.max(0, Math.min(100, num(b.pointValue ?? LOYALTY_DEFAULTS.pointValue))),
    minRedeem: Math.max(0, Math.round(num(b.minRedeem ?? LOYALTY_DEFAULTS.minRedeem))),
    maxRedeemPct: Math.max(1, Math.min(100, num(b.maxRedeemPct ?? LOYALTY_DEFAULTS.maxRedeemPct))),
    expiryMonths: Math.max(0, Math.min(120, Math.round(num(b.expiryMonths ?? LOYALTY_DEFAULTS.expiryMonths)))),
    walkInExcluded: true,
  };
  if (s.enabled && (s.earnRate <= 0 || s.pointValue <= 0)) throw bad("حدد نقاط الكسب لكل ريال وقيمة النقطة");
  await t.exec(`UPDATE companies SET loyalty=$2 WHERE id=$1`, [companyId, JSON.stringify(s)]);
  return s;
}

/** Earned points past their expiry that were not used are written off (oldest points are used first). */
async function expire(t: Db, companyId: string, partnerId: string) {
  const r = await t.one(
    `SELECT COALESCE(SUM(points) FILTER (WHERE kind='EARN' AND expires_at < CURRENT_DATE),0) expired_earned,
            COALESCE(-SUM(points) FILTER (WHERE points < 0),0) used
       FROM loyalty_ledger WHERE company_id=$1 AND partner_id=$2`, [companyId, partnerId]);
  const lapse = r2(D(r.expiredEarned).minus(r.used));
  if (lapse > 0) await t.insert("loyalty_ledger", { companyId, partnerId, kind: "EXPIRE", points: -lapse, note: "انتهاء صلاحية نقاط" });
}

export async function pointsBalance(t: Db, companyId: string, partnerId: string) {
  await expire(t, companyId, partnerId);
  const r = await t.one(`SELECT COALESCE(SUM(points),0) bal FROM loyalty_ledger WHERE company_id=$1 AND partner_id=$2`, [companyId, partnerId]);
  return r2(r.bal);
}

export async function customerLoyalty(t: Db, company: any, partnerId: string) {
  const s = loyaltySettings(company);
  const balance = await pointsBalance(t, company.id, partnerId);
  const ledger = await t.rows(`SELECT l.*, i.number FROM loyalty_ledger l LEFT JOIN invoices i ON i.id=l.invoice_id WHERE l.company_id=$1 AND l.partner_id=$2 ORDER BY l.created_at DESC LIMIT 200`, [company.id, partnerId]);
  const soon = await t.one(`SELECT COALESCE(SUM(points),0) p, MIN(expires_at) d FROM loyalty_ledger WHERE company_id=$1 AND partner_id=$2 AND kind='EARN' AND expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE + 30`, [company.id, partnerId]);
  return { settings: s, balance, value: r2(balance * s.pointValue), canRedeem: s.enabled && balance >= s.minRedeem, expiringSoon: Math.min(balance, r2(soon.p)), expiringOn: soon.d, ledger };
}

/** Called by postInvoice for every posted sale document. */
export async function loyaltyOnPost(t: Db, company: any, invoiceId: string) {
  const s = loyaltySettings(company);
  if (!s.enabled) return;
  const inv = await t.one(`SELECT i.id, i.kind, i.direction, i.total, i.exchange_rate, i.partner_id, p.code FROM invoices i JOIN partners p ON p.id=i.partner_id WHERE i.id=$1`, [invoiceId]);
  if (inv.direction !== "SALE" || inv.code === "WALKIN") return;
  const base = r2(D(inv.total).times(inv.exchangeRate || 1));
  const pts = Math.floor(base * s.earnRate);
  if (pts <= 0) return;
  if (inv.kind === "INVOICE" || inv.kind === "DEBIT_NOTE") {
    await t.insert("loyalty_ledger", { companyId: company.id, partnerId: inv.partnerId, invoiceId, kind: "EARN", points: pts, amount: base, expiresAt: s.expiryMonths ? addDays(today(), s.expiryMonths * 30) : null, note: "نقاط مكتسبة من فاتورة" });
  } else if (inv.kind === "CREDIT_NOTE") {
    const bal = await pointsBalance(t, company.id, inv.partnerId);
    const back = Math.min(pts, Math.max(0, bal));
    if (back > 0) await t.insert("loyalty_ledger", { companyId: company.id, partnerId: inv.partnerId, invoiceId, kind: "REVERSE", points: -back, amount: base, note: "عكس نقاط مرتجع" });
  }
}

/** Validates a POS redemption; returns the SAR value to take off the ticket. */
export async function checkRedemption(t: Db, company: any, partner: any, points: number, ticketTotal: number) {
  const s = loyaltySettings(company);
  if (!s.enabled) throw bad("برنامج نقاط الولاء غير مفعّل");
  if (!partner || partner.code === "WALKIN") throw bad("استبدال النقاط يتطلب اختيار عميل مسجل");
  points = Math.floor(num(points));
  if (points < s.minRedeem) throw bad(`أقل عدد نقاط للاستبدال ${s.minRedeem}`);
  const bal = await pointsBalance(t, company.id, partner.id);
  if (points > bal) throw bad(`رصيد العميل ${bal} نقطة فقط`);
  const value = r2(points * s.pointValue);
  const cap = r2((ticketTotal * s.maxRedeemPct) / 100);
  if (value > cap + 0.001) throw bad(`قيمة النقاط (${value}) تتجاوز الحد المسموح ${s.maxRedeemPct}% من الفاتورة (${cap})`);
  return { points, value };
}

export async function recordRedemption(t: Db, companyId: string, partnerId: string, invoiceId: string, points: number, value: number, user: string) {
  await t.insert("loyalty_ledger", { companyId, partnerId, invoiceId, kind: "REDEEM", points: -points, amount: value, note: "استبدال نقاط في نقطة البيع", createdBy: user });
  await t.exec(`UPDATE invoices SET points_redeemed=$2, points_value=$3 WHERE id=$1`, [invoiceId, points, value]);
}

export async function adjustPoints(t: Db, company: any, partnerId: string, points: number, note: string, user: string) {
  points = r2(num(points));
  if (!points) throw bad("أدخل عدد النقاط (+ إضافة / − خصم)");
  if (!String(note || "").trim()) throw bad("سبب التعديل مطلوب");
  await t.one(`SELECT id FROM partners WHERE id=$1 AND company_id=$2`, [partnerId, company.id], "العميل غير موجود");
  if (points < 0 && -points > (await pointsBalance(t, company.id, partnerId))) throw bad("الخصم أكبر من رصيد النقاط");
  const s = loyaltySettings(company);
  return t.insert("loyalty_ledger", { companyId: company.id, partnerId, kind: "ADJUST", points, note: String(note).trim(), createdBy: user, expiresAt: points > 0 && s.expiryMonths ? addDays(today(), s.expiryMonths * 30) : null });
}

/** Program summary: members, points outstanding (a liability worth watching), top customers. */
export async function loyaltyOverview(t: Db, company: any) {
  const s = loyaltySettings(company);
  const tot = await t.one(
    `SELECT COALESCE(SUM(points) FILTER (WHERE kind='EARN'),0) earned, COALESCE(-SUM(points) FILTER (WHERE kind='REDEEM'),0) redeemed,
            COALESCE(SUM(amount) FILTER (WHERE kind='REDEEM'),0) redeemed_value, COALESCE(-SUM(points) FILTER (WHERE kind='EXPIRE'),0) expired,
            COALESCE(SUM(points),0) outstanding, COUNT(DISTINCT partner_id)::int members
       FROM loyalty_ledger WHERE company_id=$1`, [company.id]);
  const top = await t.rows(
    `SELECT p.id, p.name, p.phone, SUM(l.points) balance, SUM(l.points) FILTER (WHERE l.kind='EARN') earned, MAX(l.created_at) last_at
       FROM loyalty_ledger l JOIN partners p ON p.id=l.partner_id WHERE l.company_id=$1 GROUP BY p.id ORDER BY SUM(l.points) DESC LIMIT 100`, [company.id]);
  return { settings: s, ...tot, outstandingValue: r2(D(tot.outstanding).times(s.pointValue)), customers: top };
}
