/**
 * Salla donation store (associations edition): a charity's Salla store sells "donation products" (سلة غذائية،
 * كفالة يتيم، تبرع عام…). In DONATIONS mode an order is not a sale: it becomes donation receipts — one per
 * project / source — paid into the e-store clearing account, with the donor kept in the donors register.
 *   Dr حساب تسوية المتاجر الإلكترونية      Cr تبرعات (عامة / مقيدة للمشروع / زكاة / كفالات…)
 * A cancelled or refunded order cancels its receipts (reversing entries). Idempotent on the order id.
 */
import { db, tx, Db } from "../db/pool";
import { bad, num, r2, today, isDate } from "../lib/core";
import { createReceipt, cancelReceipt, savePerson, SOURCE_AR } from "./charity";

const CANCEL = ["canceled", "cancelled", "refunded", "restored", "restoring"];
// not paid yet (bank transfer awaiting review, unpaid link): recorded later when the status moves on
const UNPAID = ["payment_pending", "pending_payment", "under_review", "awaiting_payment", "unpaid"];
const amt = (v: any): number => (v === null || v === undefined ? 0 : typeof v === "object" ? amt(v.amount ?? v.value ?? 0) : num(v));
const slug = (o: any) => String(o?.status?.slug || o?.status?.customized?.slug || o?.status || "").toLowerCase();
const ref = (o: any) => String(o?.reference_id || o?.id || "");
const odate = (o: any) => { const d = String(o?.date?.date || o?.created_at || o?.date || "").slice(0, 10); return isDate(d) ? d : today(); };
const ACTOR = "متجر التبرعات (سلة)";

export function donationMap(m: any) {
  const o = m && typeof m === "object" ? m : {};
  return {
    defaultSource: SOURCE_AR[o.defaultSource] && o.defaultSource !== "REFUND" ? o.defaultSource : "CASH_DONATION",
    defaultProjectId: o.defaultProjectId || null,
    rules: (Array.isArray(o.rules) ? o.rules : []).filter((r: any) => r && String(r.match || "").trim()).slice(0, 200).map((r: any) => ({ match: String(r.match).trim().slice(0, 120), projectId: r.projectId || null, source: SOURCE_AR[r.source] && r.source !== "REFUND" ? r.source : null })),
  };
}

/** Which project / source an order line goes to: first rule whose text equals the SKU or appears in the product name. */
export function classify(map: ReturnType<typeof donationMap>, item: any) {
  // a rule matches the SKU exactly or as a prefix (FOOD → FOOD-1, FOOD-2), or appears in the product name; case-insensitive
  const sku = String(item?.sku || "").trim().toLowerCase(), name = String(item?.name || "").toLowerCase();
  const r = map.rules.find((x) => { const m = String(x.match || "").trim().toLowerCase(); return !!m && ((sku && (sku === m || sku.startsWith(m + "-") || sku.startsWith(m + "_"))) || name.includes(m)); });
  return { projectId: r?.projectId ?? map.defaultProjectId, source: r?.source || map.defaultSource, rule: r?.match || null };
}

async function donor(t: Db, companyId: string, c: any) {
  const name = [c?.first_name, c?.last_name].filter(Boolean).join(" ").trim() || c?.name || "متبرع عبر المتجر";
  const phone = c?.mobile ? "0" + String(c.mobile).replace(/\D/g, "").replace(/^(966|0)/, "") : null;
  const email = c?.email || null;
  const found = (phone || email) ? await t.maybe(`SELECT * FROM partners WHERE company_id=$1 AND is_donor AND ((phone IS NOT NULL AND phone=$2) OR (email IS NOT NULL AND lower(email)=lower($3))) LIMIT 1`, [companyId, phone, email]) : null;
  if (found) return found;
  return savePerson(t, companyId, "DONOR", { name, phone, email, city: c?.city || null, donorType: "INDIVIDUAL" });
}

export async function handleDonationOrder(conn: any, o: any, opts: { sample?: boolean } = {}) {
  const ext = `salla:${o?.id ?? ref(o)}`;
  const existing = await db.rows(`SELECT id, number, status FROM charity_receipts WHERE company_id=$1 AND external_ref=$2`, [conn.companyId, ext]);
  if (CANCEL.includes(slug(o))) {
    const live = existing.filter((r: any) => r.status === "POSTED");
    if (!live.length) return { status: "IGNORED", message: existing.length ? "سندات الطلب ملغاة مسبقاً" : "طلب ملغى لم يُسجَّل" };
    await tx(async (t) => { for (const r of live) await cancelReceipt(t, conn.companyId, ACTOR, r.id, `${slug(o) === "refunded" ? "استرجاع" : "إلغاء"} طلب المتجر ${ref(o)}`); });
    return { status: "DONE", message: `أُلغيت ${live.length} سند تبرع للطلب ${ref(o)} وعُكست قيودها` };
  }
  if (existing.length) return { status: "IGNORED", message: `الطلب مسجل مسبقاً: ${existing.map((r: any) => r.number).join("، ")}` };
  if (UNPAID.includes(slug(o))) return { status: "IGNORED", message: `الطلب ${ref(o)} لم يُدفع بعد (${o?.status?.name || slug(o)}) — يُسجَّل عند تأكيد الدفع` };
  const items: any[] = Array.isArray(o?.items) ? o.items : [];
  if (!items.length) throw bad("الطلب لا يحتوي تبرعات");
  const map = donationMap(conn.donationMap);
  const acc = conn.depositAccountId || (await db.one(`SELECT id FROM accounts WHERE company_id=$1 AND system_key='ESTORE_CLEARING'`, [conn.companyId])).id;
  // group the lines by where the money goes
  const groups = new Map<string, { projectId: string | null; source: string; amount: number; names: string[] }>();
  for (const it of items) {
    const q = num(it.quantity) || 1;
    const total = amt(it?.amounts?.total) || r2(amt(it?.price) * q) || r2(amt(it?.amounts?.price_without_tax) * q);
    if (!(total > 0)) continue;
    const c = classify(map, it);
    const key = `${c.projectId || ""}|${c.source}`;
    const g = groups.get(key) || { projectId: c.projectId, source: c.source, amount: 0, names: [] as string[] };
    g.amount = r2(g.amount + total); g.names.push(`${it.name || it.sku || "تبرع"}${q > 1 ? ` × ${q}` : ""}`);
    groups.set(key, g);
  }
  if (!groups.size) throw bad("لا توجد مبالغ تبرع في الطلب");
  const out = await tx(async (t) => {
    const p = await donor(t, conn.companyId, o.customer);
    const made: any[] = [];
    for (const g of groups.values()) {
      const pr = g.projectId ? await t.maybe(`SELECT id, status FROM charity_projects WHERE id=$1 AND company_id=$2`, [g.projectId, conn.companyId]) : null;
      made.push(await createReceipt(t, conn.companyId, ACTOR, {
        date: odate(o), partnerId: p.id, payerName: p.name, payerPhone: p.phone, payerType: "INDIVIDUAL", source: g.source,
        projectId: pr && pr.status !== "CLOSED" ? pr.id : null, purpose: `تبرع عبر متجر سلة — ${g.names.join("، ")}`.slice(0, 300),
        amount: g.amount, method: "CARD", cashAccountId: acc, refNo: `سلة ${ref(o)}`, notes: o?.payment_method ? `الدفع: ${o.payment_method}` : null,
        externalRef: `salla:${o?.id ?? ref(o)}`, isDemo: !!opts.sample,
      }));
    }
    return made;
  });
  return { status: "DONE", message: `${out.length} سند تبرع (${out.map((r: any) => r.number).join("، ")}) بمبلغ ${r2(out.reduce((a: number, r: any) => a + num(r.amount), 0))} ريال` };
}

/** A sample donation order built from the store's rules — to see the whole flow before going live. */
export function sampleDonationOrder(map: ReturnType<typeof donationMap>) {
  const id = Math.floor(100000000 + Math.random() * 899999999);
  const picks = map.rules.length ? map.rules.slice(0, 2) : [{ match: "تبرع عام" }];
  const items = picks.map((r: any, i: number) => ({ id: id + i, name: `${r.match}`, sku: r.match, quantity: 1, amounts: { total: { amount: [100, 250][i] || 50 } } }));
  return { event: "order.created", data: { id, reference_id: 30000 + Math.floor(Math.random() * 9999), date: { date: `${today()} 10:00:00` }, status: { slug: "completed", name: "مكتمل" }, payment_method: "mada", customer: { first_name: "متبرع", last_name: "تجريبي", mobile: "500000099", mobile_code: "+966", email: "donor.test@example.com", city: "مكة المكرمة" }, items } };
}

export async function storeOverview(companyId: string) {
  const conn = await db.maybe(`SELECT * FROM salla_connections WHERE company_id=$1 AND platform='SALLA'`, [companyId]);
  const events = conn ? await db.rows(`SELECT id, event, reference, status, message, is_test, created_at FROM salla_events WHERE company_id=$1 AND platform='SALLA' ORDER BY created_at DESC LIMIT 30`, [companyId]) : [];
  const stats = await db.one(`SELECT COUNT(*)::int n, COALESCE(SUM(amount),0) total, COUNT(DISTINCT partner_id)::int donors FROM charity_receipts WHERE company_id=$1 AND status='POSTED' AND external_ref LIKE 'salla:%'`, [companyId]);
  return { connected: !!conn, connection: conn ? { token: conn.token, enabled: conn.enabled, mode: conn.mode, hasSecret: !!conn.secret, lastEventAt: conn.lastEventAt, depositAccountId: conn.depositAccountId } : null, map: donationMap(conn?.donationMap), events, stats: { receipts: stats.n, total: r2(num(stats.total)), donors: stats.donors } };
}
