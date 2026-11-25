/**
 * 3.50.0 — Rentals (التأجير): equipment, vehicles, property and units let out to customers.
 *
 *  • Assets for rent with hourly / daily / weekly / monthly rates, a usual deposit, a meter (km or hours), what they
 *    cost (for the return on them) and maintenance windows that block bookings.
 *  • Contracts: draft → reserved → active (delivered) → returned → closed, or cancelled. No double booking: an asset
 *    reserved or out on rent, or under maintenance, cannot be booked for overlapping days. The price picks the cheapest
 *    mix of month / week / day rates automatically (or a fixed unit), with a discount.
 *  • Billing up front for the whole period, or month by month (an hourly scheduler raises the due months); extensions
 *    are billed; on return: unbilled days, late days and damage or extra charges go on a final invoice.
 *  • Deposits are a liability, not income: received Dr cash / Cr «تأمينات مستلمة من المستأجرين»; at the end applied to
 *    the contract's unpaid invoices (Dr deposits / Cr customer) and the rest refunded. The deposits account always
 *    equals the deposits held on the contracts.
 */
import { Db } from "../db/pool";
import { AppError, bad, conflict, num, r2, isDate, today, addDays, addMonths } from "../lib/core";
import { post, assertOpenDate, nextNumber } from "../accounting/engine";
import { saveDraft, postInvoice, applySettlement } from "./invoices";
import { ensureNear } from "./manufacturing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uid = (x: any) => (UUID.test(String(x || "")) ? String(x) : null);
const n = (x: any) => Number(x || 0);
const iso = (d: any) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);
const txt = (x: any, max = 300) => (x === undefined || x === null || String(x).trim() === "" ? null : String(x).trim().slice(0, max));
export const ASSET_KINDS = ["EQUIPMENT", "VEHICLE", "PROPERTY", "UNIT", "OTHER"];
const UNITS = ["AUTO", "HOUR", "DAY", "WEEK", "MONTH"];
const UNIT_AR: Record<string, string> = { HOUR: "ساعة", DAY: "يوم", WEEK: "أسبوع", MONTH: "شهر" };
const OPEN = ["RESERVED", "ACTIVE"];
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1; // inclusive

export async function rentalAccounts(t: Db, C: string) {
  return {
    revenue: await ensureNear(t, C, "RENTAL_REVENUE", "SERVICE_REVENUE", "إيرادات التأجير", "Rental Income", 10),
    deposits: await ensureNear(t, C, "RENTAL_DEPOSITS", "SALARIES_PAYABLE", "تأمينات مستلمة من المستأجرين", "Rental Deposits Held", 30),
  };
}

// ───────────────────────── pricing ─────────────────────────
/** Price of one asset for a span: a fixed unit, or the cheapest mix of month / week / day rates («AUTO»). */
export function priceOf(a: any, unit: string, from: string, to: string, hours?: number) {
  const d = days(from, to);
  const R: Record<string, number> = { HOUR: n(a.rateHour), DAY: n(a.rateDay), WEEK: n(a.rateWeek), MONTH: n(a.rateMonth) };
  if (unit === "HOUR") { const h = num(hours); if (!(h > 0)) throw bad(`اكتب عدد الساعات لـ«${a.name}»`); if (!R.HOUR) throw bad(`لا سعر بالساعة لـ«${a.name}»`); return { days: d, amount: r2(h * R.HOUR), parts: [{ unit: "HOUR", qty: h, rate: R.HOUR }] }; }
  if (unit !== "AUTO") {
    const size = unit === "MONTH" ? 30 : unit === "WEEK" ? 7 : 1;
    if (!R[unit]) throw bad(`لا سعر لكل ${UNIT_AR[unit]} لـ«${a.name}»`);
    const q = Math.ceil(d / size);
    return { days: d, amount: r2(q * R[unit]), parts: [{ unit, qty: q, rate: R[unit] }] };
  }
  // cheapest mix: months, then weeks, then days — or rounding up a unit when that is cheaper
  type P = { amount: number; parts: { unit: string; qty: number; rate: number }[] };
  const best = (rest: number, units: string[]): P | null => {
    if (rest <= 0) return { amount: 0, parts: [] };
    const [u, ...more] = units; if (!u) return null;
    const size = u === "MONTH" ? 30 : u === "WEEK" ? 7 : 1, rate = R[u];
    const opts: P[] = [];
    if (rate > 0) {
      const full = Math.floor(rest / size);
      const tail = best(rest - full * size, more);
      if (tail) opts.push({ amount: full * rate + tail.amount, parts: [...(full ? [{ unit: u, qty: full, rate }] : []), ...tail.parts] });
      opts.push({ amount: Math.ceil(rest / size) * rate, parts: [{ unit: u, qty: Math.ceil(rest / size), rate }] });
    }
    const skip = best(rest, more); if (skip) opts.push(skip);
    return opts.sort((x, y) => x.amount - y.amount)[0] || null;
  };
  const p = best(d, ["MONTH", "WEEK", "DAY"]);
  if (!p) throw bad(`لا أسعار يومية أو أسبوعية أو شهرية لـ«${a.name}»`);
  return { days: d, amount: r2(p.amount), parts: p.parts };
}
const partsText = (parts: any[]) => parts.map((p) => `${p.qty} ${UNIT_AR[p.unit]} × ${p.rate}`).join(" + ");

// ───────────────────────── assets ─────────────────────────
const shapeAsset = (a: any) => ({ id: a.id, code: a.code, name: a.name, kind: a.kind, category: a.category, identifier: a.identifier, rateHour: n(a.rateHour), rateDay: n(a.rateDay), rateWeek: n(a.rateWeek), rateMonth: n(a.rateMonth), deposit: n(a.deposit), meter: a.meter === null ? null : n(a.meter), meterUnit: a.meterUnit, costValue: n(a.costValue), costCenterId: a.costCenterId, maintenance: a.maintenance, isActive: a.isActive, notes: a.notes, isDemo: a.isDemo });
export async function saveAsset(t: Db, C: string, b: any, id?: string, opts: { isDemo?: boolean } = {}) {
  const name = txt(b.name, 120); if (!name) throw bad("اسم الأصل مطلوب");
  const kind = ASSET_KINDS.includes(b.kind) ? b.kind : "EQUIPMENT";
  const rates = { rateHour: num(b.rateHour), rateDay: num(b.rateDay), rateWeek: num(b.rateWeek), rateMonth: num(b.rateMonth), deposit: num(b.deposit), costValue: num(b.costValue) };
  if (Object.values(rates).some((x) => x < 0)) throw bad("الأسعار والمبالغ لا تكون سالبة");
  if (!(rates.rateHour || rates.rateDay || rates.rateWeek || rates.rateMonth)) throw bad("اكتب سعر تأجير واحداً على الأقل (ساعة، يوم، أسبوع أو شهر)");
  const cc = uid(b.costCenterId) ? (await t.one(`SELECT id FROM cost_centers WHERE id=$1 AND company_id=$2`, [b.costCenterId, C], "مركز التكلفة غير موجود")).id : null;
  let code = txt(b.code, 20);
  if (!code && !id) { const c = await t.one(`SELECT COUNT(*)::int c FROM rental_assets WHERE company_id=$1`, [C]); code = `RA-${String(c.c + 1).padStart(3, "0")}`; }
  if (code && await t.maybe(`SELECT 1 FROM rental_assets WHERE company_id=$1 AND code=$2 AND id <> COALESCE($3::uuid,'00000000-0000-0000-0000-000000000000')`, [C, code, uid(id)])) throw conflict(`الرمز ${code} مستخدم لأصل آخر`);
  const row: any = { name, kind, category: txt(b.category, 60), identifier: txt(b.identifier, 60), ...rates, meter: b.meter === undefined || b.meter === "" || b.meter === null ? null : num(b.meter), meterUnit: txt(b.meterUnit, 20), costCenterId: cc, notes: txt(b.notes, 500), isActive: b.isActive === undefined ? true : !!b.isActive, maintenance: !!b.maintenance, ...(code ? { code } : {}) };
  if (id) { const r = await t.update("rental_assets", { id: uid(id), companyId: C }, row); if (!r) throw new AppError(404, "الأصل غير موجود"); return shapeAsset(r); }
  return shapeAsset(await t.insert("rental_assets", { companyId: C, ...row, isDemo: !!opts.isDemo }));
}
export async function listAssets(t: Db, C: string) {
  const td = today();
  const [assets, cts, mnt] = await Promise.all([
    t.rows(`SELECT * FROM rental_assets WHERE company_id=$1 ORDER BY is_active DESC, code`, [C]),
    t.rows(`SELECT c.id, c.number, c.status, c.start_date, c.end_date, c.lines, p.name partner FROM rental_contracts c JOIN partners p ON p.id=c.partner_id WHERE c.company_id=$1 AND c.status IN ('RESERVED','ACTIVE')`, [C]),
    t.rows(`SELECT * FROM rental_maintenance WHERE company_id=$1 AND to_date >= $2 ORDER BY from_date`, [C, td]),
  ]);
  return assets.map((a: any) => {
    const mine = cts.filter((c: any) => (c.lines || []).some((l: any) => l.assetId === a.id));
    const out = mine.find((c: any) => c.status === "ACTIVE");
    const next = mine.filter((c: any) => c.status === "RESERVED").sort((x: any, y: any) => String(iso(x.startDate)).localeCompare(String(iso(y.startDate))))[0];
    const mw = mnt.filter((m: any) => m.assetId === a.id);
    const inMaint = a.maintenance || mw.some((m: any) => iso(m.fromDate)! <= td && iso(m.toDate)! >= td);
    return { ...shapeAsset(a), status: !a.isActive ? "RETIRED" : out ? "RENTED" : inMaint ? "MAINTENANCE" : "AVAILABLE",
      current: out ? { id: out.id, number: out.number, partner: out.partner, endDate: iso(out.endDate), overdue: iso(out.endDate)! < td } : null,
      nextBooking: next ? { id: next.id, number: next.number, partner: next.partner, startDate: iso(next.startDate), endDate: iso(next.endDate) } : null,
      maintenanceWindows: mw.map((m: any) => ({ id: m.id, fromDate: iso(m.fromDate), toDate: iso(m.toDate), description: m.description, cost: n(m.cost) })) };
  });
}
export async function addMaintenance(t: Db, C: string, assetId: string, b: any, opts: { isDemo?: boolean } = {}) {
  const a = await t.one(`SELECT id, name FROM rental_assets WHERE id=$1 AND company_id=$2`, [uid(assetId), C], "الأصل غير موجود");
  const from = isDate(b.fromDate) ? String(b.fromDate) : today(), to = isDate(b.toDate) ? String(b.toDate) : from;
  if (to < from) throw bad("نهاية الصيانة قبل بدايتها");
  const clash = await conflicts(t, C, [a.id], from, to);
  if (clash.length) throw conflict(`الأصل «${a.name}» محجوز أو مؤجر في هذه الأيام (${clash.map((x: any) => x.number).join("، ")})`);
  return t.insert("rental_maintenance", { companyId: C, assetId: a.id, fromDate: from, toDate: to, description: txt(b.description, 300), cost: num(b.cost), isDemo: !!opts.isDemo });
}
export async function deleteMaintenance(t: Db, C: string, id: string) { await t.exec(`DELETE FROM rental_maintenance WHERE id=$1 AND company_id=$2`, [uid(id), C]); return { ok: true }; }

/** Bookings (reserved or out) and maintenance that overlap the days asked for, for these assets. */
export async function conflicts(t: Db, C: string, assetIds: string[], from: string, to: string, exceptId?: string | null) {
  const td = today();
  const rows = await t.rows(`SELECT id, number, status, start_date, end_date, lines FROM rental_contracts WHERE company_id=$1 AND status IN ('RESERVED','ACTIVE') AND id <> COALESCE($2::uuid,'00000000-0000-0000-0000-000000000000')`, [C, uid(exceptId)]);
  const out: any[] = [];
  for (const c of rows) {
    const end = c.status === "ACTIVE" && iso(c.endDate)! < td ? td : iso(c.endDate)!; // still out after its end date: busy until returned
    if (!(iso(c.startDate)! <= to && end >= from)) continue;
    const hit = (c.lines || []).filter((l: any) => assetIds.includes(l.assetId)).map((l: any) => l.name);
    if (hit.length) out.push({ kind: "CONTRACT", id: c.id, number: c.number, status: c.status, from: iso(c.startDate), to: end, assets: hit });
  }
  const m = await t.rows(`SELECT m.*, a.name FROM rental_maintenance m JOIN rental_assets a ON a.id=m.asset_id WHERE m.company_id=$1 AND m.asset_id = ANY($2) AND m.from_date <= $4 AND m.to_date >= $3`, [C, assetIds, from, to]);
  for (const x of m) out.push({ kind: "MAINTENANCE", id: x.id, number: "صيانة", from: iso(x.fromDate), to: iso(x.toDate), assets: [x.name] });
  const flagged = await t.rows(`SELECT name FROM rental_assets WHERE company_id=$1 AND id = ANY($2) AND (maintenance OR NOT is_active)`, [C, assetIds]);
  for (const x of flagged) out.push({ kind: "MAINTENANCE", id: null, number: "خارج الخدمة", from, to, assets: [x.name] });
  return out;
}

// ───────────────────────── contracts ─────────────────────────
async function buildLines(t: Db, C: string, raw: any[], from: string, to: string, discountPct: number) {
  if (!Array.isArray(raw) || !raw.length) throw bad("اختر أصلاً واحداً على الأقل");
  if (raw.length > 50) throw bad("حتى 50 أصلاً في العقد");
  const ids = raw.map((l) => uid(l.assetId)).filter(Boolean) as string[];
  if (new Set(ids).size !== ids.length) throw bad("أصل مكرر في العقد");
  const assets = new Map((await t.rows(`SELECT * FROM rental_assets WHERE company_id=$1 AND id = ANY($2)`, [C, ids])).map((a: any) => [a.id, a]));
  return raw.map((l: any) => {
    const a: any = assets.get(String(l.assetId)); if (!a) throw bad("أحد الأصول غير موجود");
    const unit = UNITS.includes(l.unit) ? l.unit : "AUTO";
    const p = priceOf(a, unit, from, to, l.hours);
    const gross = r2(p.amount);
    return { assetId: a.id, code: a.code, name: a.name, identifier: a.identifier, unit, hours: unit === "HOUR" ? num(l.hours) : null, parts: p.parts, days: p.days, gross, amount: r2(gross * (1 - discountPct / 100)), meterOut: l.meterOut ?? null, meterIn: null, condition: txt(l.condition, 200) };
  });
}
export async function quote(t: Db, C: string, b: any) {
  const from = isDate(b.startDate) ? String(b.startDate) : today(), to = isDate(b.endDate) ? String(b.endDate) : from;
  if (to < from) throw bad("نهاية الإيجار قبل بدايته");
  const disc = Math.max(0, Math.min(90, num(b.discountPct)));
  const lines = await buildLines(t, C, b.lines, from, to, disc);
  const clash = await conflicts(t, C, lines.map((l) => l.assetId), from, to, b.exceptId);
  const assets = await t.rows(`SELECT id, deposit FROM rental_assets WHERE company_id=$1 AND id = ANY($2)`, [C, lines.map((l) => l.assetId)]);
  return { from, to, days: days(from, to), lines, subtotal: r2(lines.reduce((x, l) => x + l.amount, 0)), deposit: r2(assets.reduce((x: number, a: any) => x + n(a.deposit), 0)), conflicts: clash };
}
const assertFree = async (t: Db, C: string, ct: any, from: string, to: string) => {
  const clash = await conflicts(t, C, (ct.lines || []).map((l: any) => l.assetId), from, to, ct.id);
  if (clash.length) throw conflict(`تعارض حجز: ${clash.map((c: any) => `${c.assets.join("، ")} — ${c.number} (${c.from} إلى ${c.to})`).join(" · ")}`);
};

export async function createContract(t: Db, C: string, user: string, b: any, opts: { isDemo?: boolean } = {}) {
  const partner = await t.one(`SELECT id FROM partners WHERE id=$1 AND company_id=$2`, [uid(b.partnerId), C], "اختر المستأجر (العميل)");
  const from = isDate(b.startDate) ? String(b.startDate) : today(), to = isDate(b.endDate) ? String(b.endDate) : from;
  if (to < from) throw bad("نهاية الإيجار قبل بدايته");
  const discountPct = Math.max(0, Math.min(90, num(b.discountPct)));
  const lines = await buildLines(t, C, b.lines, from, to, discountPct);
  const billing = b.billing === "MONTHLY" ? "MONTHLY" : "UPFRONT";
  const assets = await t.rows(`SELECT deposit FROM rental_assets WHERE company_id=$1 AND id = ANY($2)`, [C, lines.map((l) => l.assetId)]);
  const deposit = b.deposit === undefined || b.deposit === null || b.deposit === "" ? r2(assets.reduce((x: number, a: any) => x + n(a.deposit), 0)) : r2(num(b.deposit));
  if (deposit < 0) throw bad("التأمين لا يكون سالباً");
  const number = await nextNumber(t, C, "RNT", from);
  const ct = await t.insert("rental_contracts", { companyId: C, number, partnerId: partner.id, status: "DRAFT", startDate: from, endDate: to, billing, lines, taxCode: ["S", "Z", "E", "O"].includes(b.taxCode) ? b.taxCode : "S", discountPct, deposit,
    lateFeeDay: b.lateFeeDay === undefined || b.lateFeeDay === null || b.lateFeeDay === "" ? null : num(b.lateFeeDay), costCenterId: uid(b.costCenterId), notes: txt(b.notes, 1000), terms: txt(b.terms, 3000), createdBy: user, isDemo: !!opts.isDemo });
  if (b.reserve) { await assertFree(t, C, ct, from, to); await t.exec(`UPDATE rental_contracts SET status='RESERVED' WHERE id=$1`, [ct.id]); }
  return ct;
}
async function lockCt(t: Db, C: string, id: string) {
  const c = await t.one(`SELECT * FROM rental_contracts WHERE id=$1 AND company_id=$2 FOR UPDATE`, [uid(id), C], "عقد الإيجار غير موجود");
  c.startDate = iso(c.startDate); c.endDate = iso(c.endDate); c.invoicedTo = iso(c.invoicedTo); c.deliveredDate = iso(c.deliveredDate); c.returnedDate = iso(c.returnedDate); c.nextBillDate = iso(c.nextBillDate);
  return c;
}
const move = (t: Db, C: string, ct: any, kind: string, date: string, user: string, x: any = {}) => t.insert("rental_moves", { companyId: C, contractId: ct.id, kind, date, createdBy: user, isDemo: !!ct.isDemo, ...x });

export async function reserve(t: Db, C: string, user: string, id: string) {
  const ct = await lockCt(t, C, id);
  if (ct.status !== "DRAFT") throw conflict("العقد ليس مسودة");
  await assertFree(t, C, ct, ct.startDate, ct.endDate);
  await t.exec(`UPDATE rental_contracts SET status='RESERVED', updated_at=now() WHERE id=$1`, [ct.id]);
  return { ok: true };
}

/** Invoices one span of the contract: a line per asset at its price for those days, less the contract discount. */
async function billSpan(t: Db, company: any, user: string, ct: any, from: string, to: string, date: string, extra: { description: string; amount: number }[] = [], label?: string) {
  const C = company.id;
  const A = await rentalAccounts(t, C);
  const assets = new Map((await t.rows(`SELECT * FROM rental_assets WHERE company_id=$1 AND id = ANY($2)`, [C, (ct.lines || []).map((l: any) => l.assetId)])).map((a: any) => [a.id, a]));
  const per: any[] = [];
  const lines: any[] = [];
  if (to >= from) for (const l of ct.lines) {
    const a: any = assets.get(l.assetId); if (!a) continue;
    const p = l.unit === "HOUR" ? { amount: r2(n(l.hours) * n(a.rateHour)), parts: [{ unit: "HOUR", qty: n(l.hours), rate: n(a.rateHour) }] } : priceOf(a, l.unit, from, to);
    if (!(p.amount > 0)) continue;
    lines.push({ accountId: A.revenue, description: `تأجير «${a.name}»${a.identifier ? ` (${a.identifier})` : ""} من ${from} إلى ${to} — ${partsText(p.parts)}`, qty: 1, unitPrice: p.amount, discountPct: n(ct.discountPct), taxCode: ct.taxCode });
    per.push({ assetId: a.id, amount: r2(p.amount * (1 - n(ct.discountPct) / 100)) });
  }
  for (const x of extra) if (n(x.amount) > 0) { lines.push({ accountId: A.revenue, description: x.description, qty: 1, unitPrice: r2(n(x.amount)), taxCode: ct.taxCode }); }
  if (!lines.length) return null;
  const d = await saveDraft(t, company, user, { direction: "SALE", kind: "INVOICE", date, partnerId: ct.partnerId, costCenterId: ct.costCenterId || null, notes: `${label || "عقد إيجار"} ${ct.number}`, isDemo: !!ct.isDemo, lines } as any);
  await postInvoice(t, company, d.id, user);
  const inv = await t.one(`SELECT i.id, i.number, i.total, (SELECT COALESCE(SUM(l.net_amount),0) FROM invoice_lines l WHERE l.invoice_id=i.id) net FROM invoices i WHERE i.id=$1`, [d.id]);
  await move(t, C, ct, "INVOICE", date, user, { amount: n(inv.net), periodFrom: to >= from ? from : null, periodTo: to >= from ? to : null, invoiceId: inv.id, detail: { assets: per, extra }, notes: `فاتورة ${inv.number}` });
  return inv;
}

export async function deliver(t: Db, company: any, user: string, id: string, b: any = {}) {
  const C = company.id;
  const ct = await lockCt(t, C, id);
  if (!["DRAFT", "RESERVED"].includes(ct.status)) throw conflict("العقد سُلّم من قبل أو أُغلق");
  const date = isDate(b.date) ? String(b.date) : ct.startDate; await assertOpenDate(t, C, date);
  await assertFree(t, C, ct, ct.startDate, ct.endDate);
  const meters = Array.isArray(b.lines) ? b.lines : [];
  ct.lines = ct.lines.map((l: any) => { const g = meters.find((x: any) => x.assetId === l.assetId); return { ...l, meterOut: g?.meterOut !== undefined && g?.meterOut !== "" ? num(g.meterOut) : l.meterOut, condition: txt(g?.condition, 200) || l.condition }; });
  for (const l of ct.lines) if (l.meterOut !== null && l.meterOut !== undefined) await t.exec(`UPDATE rental_assets SET meter=$2 WHERE id=$1`, [l.assetId, l.meterOut]);
  await t.update("rental_contracts", { id: ct.id }, { status: "ACTIVE", deliveredDate: date, lines: ct.lines, updatedAt: new Date() });
  await move(t, C, ct, "DELIVER", date, user, { detail: { lines: ct.lines.map((l: any) => ({ assetId: l.assetId, meterOut: l.meterOut, condition: l.condition })) } });
  if (ct.billing === "UPFRONT") {
    await billSpan(t, company, user, ct, ct.startDate, ct.endDate, date);
    await t.update("rental_contracts", { id: ct.id }, { invoicedTo: ct.endDate, nextBillDate: null });
  } else {
    const to = [addDays(addMonths(ct.startDate, 1), -1), ct.endDate].sort()[0];
    await billSpan(t, company, user, ct, ct.startDate, to, date);
    await t.update("rental_contracts", { id: ct.id }, { invoicedTo: to, nextBillDate: to < ct.endDate ? addDays(to, 1) : null });
  }
  return getContract(t, C, ct.id);
}

/** Month-by-month contracts: invoice every month that has started (up to the given day). */
export async function billDue(t: Db, company: any, user: string, upTo = today(), onlyId?: string) {
  const C = company.id;
  const due = await t.rows(`SELECT id FROM rental_contracts WHERE company_id=$1 AND status='ACTIVE' AND billing='MONTHLY' AND next_bill_date IS NOT NULL AND next_bill_date <= $2 ${onlyId ? "AND id=$3" : ""}`, onlyId ? [C, upTo, onlyId] : [C, upTo]);
  let count = 0;
  for (const r of due) {
    const ct = await lockCt(t, C, r.id);
    for (let i = 0; i < 36 && ct.nextBillDate && ct.nextBillDate <= upTo && ct.invoicedTo < ct.endDate; i++) {
      const from = ct.nextBillDate; const to = [addDays(addMonths(from, 1), -1), ct.endDate].sort()[0];
      await assertOpenDate(t, C, from);
      await billSpan(t, company, user, ct, from, to, from);
      ct.invoicedTo = to; ct.nextBillDate = to < ct.endDate ? addDays(to, 1) : null; count++;
    }
    await t.update("rental_contracts", { id: ct.id }, { invoicedTo: ct.invoicedTo, nextBillDate: ct.nextBillDate, updatedAt: new Date() });
  }
  return { invoices: count };
}
export async function companiesWithDueRentals(t: Db) {
  return (await t.rows(`SELECT DISTINCT r.company_id FROM rental_contracts r JOIN companies c ON c.id=r.company_id WHERE r.status='ACTIVE' AND r.billing='MONTHLY' AND r.next_bill_date <= $1 AND c.status='ACTIVE'`, [today()])).map((r: any) => r.companyId);
}

export async function extend(t: Db, company: any, user: string, id: string, b: any) {
  const C = company.id;
  const ct = await lockCt(t, C, id);
  if (!OPEN.includes(ct.status) && ct.status !== "DRAFT") throw conflict("لا يُمدد إلا عقد مفتوح");
  const end = isDate(b.endDate) ? String(b.endDate) : null; if (!end || end <= ct.endDate) throw bad("اختر نهاية بعد النهاية الحالية");
  if (ct.status !== "DRAFT") await assertFree(t, C, ct, addDays(ct.endDate, 1), end);
  const old = ct.endDate;
  await t.update("rental_contracts", { id: ct.id }, { endDate: end, updatedAt: new Date(), ...(ct.status === "ACTIVE" && ct.billing === "MONTHLY" && !ct.nextBillDate ? { nextBillDate: addDays(old, 1) } : {}) });
  await move(t, C, ct, "EXTEND", today(), user, { periodFrom: addDays(old, 1), periodTo: end, notes: `تمديد من ${old} إلى ${end}` });
  if (ct.status === "ACTIVE" && ct.billing === "UPFRONT") {
    const date = isDate(b.date) ? String(b.date) : today(); await assertOpenDate(t, C, date);
    await billSpan(t, company, user, { ...ct, endDate: end }, addDays(old, 1), end, date, [], "تمديد عقد إيجار");
    await t.update("rental_contracts", { id: ct.id }, { invoicedTo: end });
  }
  return getContract(t, C, ct.id);
}

export async function returnContract(t: Db, company: any, user: string, id: string, b: any = {}) {
  const C = company.id;
  const ct = await lockCt(t, C, id);
  if (ct.status !== "ACTIVE") throw conflict("العقد ليس مسلّماً");
  const date = isDate(b.date) ? String(b.date) : today(); await assertOpenDate(t, C, date);
  if (date < ct.deliveredDate!) throw bad("تاريخ الإرجاع قبل التسليم");
  const meters = Array.isArray(b.lines) ? b.lines : [];
  const assets = new Map((await t.rows(`SELECT * FROM rental_assets WHERE company_id=$1 AND id = ANY($2)`, [C, ct.lines.map((l: any) => l.assetId)])).map((a: any) => [a.id, a]));
  ct.lines = ct.lines.map((l: any) => {
    const g = meters.find((x: any) => x.assetId === l.assetId);
    const meterIn = g?.meterIn !== undefined && g?.meterIn !== "" && g?.meterIn !== null ? num(g.meterIn) : null;
    if (meterIn !== null && l.meterOut !== null && l.meterOut !== undefined && meterIn < n(l.meterOut)) throw bad(`قراءة العداد عند الإرجاع لـ«${l.name}» أقل من قراءة التسليم`);
    return { ...l, meterIn, returnCondition: txt(g?.condition, 200) };
  });
  for (const l of ct.lines) if (l.meterIn !== null) await t.exec(`UPDATE rental_assets SET meter=$2 WHERE id=$1`, [l.assetId, l.meterIn]);
  // what is still to bill: unbilled days (month by month), late days, and damages / extras
  const extra: { description: string; amount: number }[] = [];
  const lateDays = Math.max(0, days(ct.endDate, date) - 1);
  if (lateDays > 0 && b.waiveLate !== true) {
    const perDay = ct.lateFeeDay !== null && ct.lateFeeDay !== undefined ? n(ct.lateFeeDay) : ct.lines.reduce((x: number, l: any) => { const a: any = assets.get(l.assetId); return x + (n(a?.rateDay) || n(a?.rateWeek) / 7 || n(a?.rateMonth) / 30); }, 0);
    if (perDay > 0) extra.push({ description: `غرامة تأخير ${lateDays} يوم بعد ${ct.endDate} (${r2(perDay)} لليوم)`, amount: r2(lateDays * perDay) });
  }
  for (const x of Array.isArray(b.charges) ? b.charges : []) { const amt = r2(num(x.amount)); const d = txt(x.description, 200); if (amt > 0 && d) extra.push({ description: d, amount: amt }); }
  const fromUnbilled = ct.invoicedTo ? addDays(ct.invoicedTo, 1) : ct.startDate;
  const toUnbilled = [date, ct.endDate].sort()[0];
  const inv = await billSpan(t, company, user, ct, fromUnbilled, toUnbilled, date, extra, "فاتورة إرجاع — عقد إيجار");
  await t.update("rental_contracts", { id: ct.id }, { status: "RETURNED", returnedDate: date, lines: ct.lines, charges: extra, invoicedTo: [toUnbilled, ct.invoicedTo || ct.startDate].sort().pop(), nextBillDate: null, updatedAt: new Date() });
  await move(t, C, ct, "RETURN", date, user, { detail: { lines: ct.lines.map((l: any) => ({ assetId: l.assetId, meterOut: l.meterOut, meterIn: l.meterIn, used: l.meterIn !== null && l.meterOut !== null ? r2(l.meterIn - n(l.meterOut)) : null, condition: l.returnCondition })), lateDays, charges: extra }, notes: inv ? `فاتورة ${inv.number}` : null, invoiceId: inv?.id || null });
  return getContract(t, C, ct.id);
}

const depositHeld = (ct: any) => r2(n(ct.depositReceived) - n(ct.depositApplied) - n(ct.depositRefunded));
async function cashAccount(t: Db, C: string, id: any) {
  const a = await t.one(`SELECT id, code, name_ar, is_cash_bank FROM accounts WHERE id=$1 AND company_id=$2`, [uid(id), C], "اختر الصندوق أو البنك");
  if (!a.isCashBank) throw bad("الحساب يجب أن يكون صندوقاً أو بنكاً");
  return a;
}
export async function receiveDeposit(t: Db, C: string, user: string, id: string, b: any) {
  const ct = await lockCt(t, C, id);
  if (["CLOSED", "CANCELLED"].includes(ct.status)) throw conflict("العقد مغلق");
  const amount = r2(num(b.amount)); if (!(amount > 0)) throw bad("مبلغ التأمين يجب أن يكون أكبر من صفر");
  const date = isDate(b.date) ? String(b.date) : today(); await assertOpenDate(t, C, date);
  const cash = await cashAccount(t, C, b.accountId);
  const A = await rentalAccounts(t, C);
  const e = await post(t, C, { date, type: "RECEIPT", sourceType: "RENTAL", sourceId: ct.id, reference: ct.number, memo: `تأمين مستلم — عقد إيجار ${ct.number}`, isDemo: !!ct.isDemo, createdBy: user, lines: [{ account: cash.id, debit: amount, partnerId: ct.partnerId }, { account: A.deposits, credit: amount, partnerId: ct.partnerId }] });
  await t.exec(`UPDATE rental_contracts SET deposit_received=deposit_received+$2, updated_at=now() WHERE id=$1`, [ct.id, amount]);
  await move(t, C, ct, "DEPOSIT_IN", date, user, { amount, entryId: e!.id, notes: `إلى ${cash.nameAr}` });
  return getContract(t, C, ct.id);
}
/** End of the contract: the deposit pays its unpaid invoices first, the rest goes back to the customer. */
export async function settleDeposit(t: Db, C: string, user: string, id: string, b: any = {}) {
  const ct = await lockCt(t, C, id);
  if (["CLOSED", "CANCELLED"].includes(ct.status)) throw conflict("العقد مغلق");
  const date = isDate(b.date) ? String(b.date) : today(); await assertOpenDate(t, C, date);
  const A = await rentalAccounts(t, C);
  let held = depositHeld(ct); let applied = 0, refunded = 0;
  if (b.apply !== false && held > 0) {
    const open = await t.rows(`SELECT i.id, i.number, i.total - i.amount_paid due FROM rental_moves m JOIN invoices i ON i.id=m.invoice_id WHERE m.contract_id=$1 AND m.kind='INVOICE' AND i.status='POSTED' AND i.total - i.amount_paid > 0.004 ORDER BY i.date, i.number`, [ct.id]);
    for (const inv of open) {
      const amt = r2(Math.min(held, n(inv.due))); if (amt <= 0) break;
      const e = await post(t, C, { date, type: "RECEIPT", sourceType: "RENTAL", sourceId: ct.id, reference: ct.number, memo: `خصم من التأمين لفاتورة ${inv.number} — عقد ${ct.number}`, isDemo: !!ct.isDemo, createdBy: user, lines: [{ account: A.deposits, debit: amt, partnerId: ct.partnerId }, { key: "AR", credit: amt, partnerId: ct.partnerId }] });
      await applySettlement(t, inv.id, amt);
      await move(t, C, ct, "DEPOSIT_APPLY", date, user, { amount: amt, entryId: e!.id, invoiceId: inv.id, notes: `لفاتورة ${inv.number}` });
      held = r2(held - amt); applied = r2(applied + amt);
    }
  }
  if (held > 0 && b.refund !== false) {
    const cash = await cashAccount(t, C, b.accountId);
    const e = await post(t, C, { date, type: "PAYMENT", sourceType: "RENTAL", sourceId: ct.id, reference: ct.number, memo: `رد التأمين — عقد إيجار ${ct.number}`, isDemo: !!ct.isDemo, createdBy: user, lines: [{ account: A.deposits, debit: held, partnerId: ct.partnerId }, { account: cash.id, credit: held, partnerId: ct.partnerId }] });
    await move(t, C, ct, "DEPOSIT_OUT", date, user, { amount: held, entryId: e!.id, notes: `من ${cash.nameAr}` });
    refunded = held; held = 0;
  }
  const closing = held <= 0.004 && ct.status === "RETURNED";
  await t.exec(`UPDATE rental_contracts SET deposit_applied=deposit_applied+$2, deposit_refunded=deposit_refunded+$3, status=CASE WHEN $4 THEN 'CLOSED' ELSE status END, updated_at=now() WHERE id=$1`, [ct.id, applied, refunded, closing]);
  return getContract(t, C, ct.id);
}
export async function cancelContract(t: Db, C: string, user: string, id: string, b: any = {}) {
  const ct = await lockCt(t, C, id);
  if (!["DRAFT", "RESERVED"].includes(ct.status)) throw conflict("لا يُلغى إلا عقد لم يُسلَّم بعد");
  if (depositHeld(ct) > 0.004) throw conflict("ردّ التأمين أولاً («تسوية التأمين») ثم ألغِ العقد");
  await t.exec(`UPDATE rental_contracts SET status='CANCELLED', notes=COALESCE(notes,'') || $2, updated_at=now() WHERE id=$1`, [ct.id, b.reason ? ` — أُلغي: ${txt(b.reason, 200)}` : ""]);
  await move(t, C, ct, "CANCEL", today(), user, { notes: txt(b.reason, 200) });
  return getContract(t, C, ct.id);
}

const shapeCt = (c: any, td: string) => {
  const lines = c.lines || [];
  const end = iso(c.endDate)!;
  return { id: c.id, number: c.number, status: c.status, partnerId: c.partnerId, partnerName: c.partnerName, partnerPhone: c.partnerPhone, startDate: iso(c.startDate), endDate: end, deliveredDate: iso(c.deliveredDate), returnedDate: iso(c.returnedDate), billing: c.billing,
    assets: lines.map((l: any) => l.name).join("، "), assetCount: lines.length, subtotal: r2(lines.reduce((x: number, l: any) => x + n(l.amount), 0)), deposit: n(c.deposit), depositHeld: depositHeld(c), depositReceived: n(c.depositReceived),
    invoicedTo: iso(c.invoicedTo), nextBillDate: iso(c.nextBillDate), overdue: c.status === "ACTIVE" && end < td, lateDays: c.status === "ACTIVE" && end < td ? days(end, td) - 1 : 0, dueToday: c.status === "ACTIVE" && end === td, startsSoon: c.status === "RESERVED" && iso(c.startDate)! <= addDays(td, 7), isDemo: c.isDemo };
};
export async function listContracts(t: Db, C: string, q: any = {}) {
  const where = ["c.company_id=$1"]; const p: any[] = [C];
  if (q.status === "OPEN") where.push(`c.status IN ('DRAFT','RESERVED','ACTIVE','RETURNED')`);
  else if (["DRAFT", "RESERVED", "ACTIVE", "RETURNED", "CLOSED", "CANCELLED"].includes(q.status)) { p.push(q.status); where.push(`c.status=$${p.length}`); }
  if (uid(q.assetId)) { p.push(JSON.stringify([{ assetId: q.assetId }])); where.push(`c.lines @> $${p.length}::jsonb`); }
  if (uid(q.partnerId)) { p.push(q.partnerId); where.push(`c.partner_id=$${p.length}`); }
  const rows = await t.rows(`SELECT c.*, pa.name partner_name, pa.phone partner_phone FROM rental_contracts c JOIN partners pa ON pa.id=c.partner_id WHERE ${where.join(" AND ")} ORDER BY CASE c.status WHEN 'ACTIVE' THEN 0 WHEN 'RESERVED' THEN 1 WHEN 'RETURNED' THEN 2 WHEN 'DRAFT' THEN 3 ELSE 4 END, c.end_date, c.number DESC LIMIT 500`, p);
  const td = today();
  return rows.map((c: any) => shapeCt(c, td));
}
export async function getContract(t: Db, C: string, id: string) {
  const c = await t.one(`SELECT c.*, pa.name partner_name, pa.phone partner_phone, cc.name cost_center_name FROM rental_contracts c JOIN partners pa ON pa.id=c.partner_id LEFT JOIN cost_centers cc ON cc.id=c.cost_center_id WHERE c.id=$1 AND c.company_id=$2`, [uid(id), C], "عقد الإيجار غير موجود");
  const moves = await t.rows(`SELECT m.*, i.number invoice_number, i.total invoice_total, i.amount_paid, e.number entry_number FROM rental_moves m LEFT JOIN invoices i ON i.id=m.invoice_id LEFT JOIN journal_entries e ON e.id=m.entry_id WHERE m.contract_id=$1 ORDER BY m.created_at`, [c.id]);
  const invoices = moves.filter((m: any) => m.kind === "INVOICE").map((m: any) => ({ id: m.invoiceId, number: m.invoiceNumber, date: iso(m.date), from: iso(m.periodFrom), to: iso(m.periodTo), net: n(m.amount), total: n(m.invoiceTotal), paid: n(m.amountPaid), due: r2(n(m.invoiceTotal) - n(m.amountPaid)) }));
  const td = today();
  return { ...shapeCt(c, td), lines: c.lines, taxCode: c.taxCode, discountPct: n(c.discountPct), lateFeeDay: c.lateFeeDay === null ? null : n(c.lateFeeDay), charges: c.charges || [], costCenterId: c.costCenterId, costCenterName: c.costCenterName, notes: c.notes, terms: c.terms, createdBy: c.createdBy, depositApplied: n(c.depositApplied), depositRefunded: n(c.depositRefunded),
    invoices, billed: r2(invoices.reduce((x, i) => x + i.total, 0)), due: r2(invoices.reduce((x, i) => x + i.due, 0)),
    moves: moves.map((m: any) => ({ id: m.id, kind: m.kind, date: iso(m.date), amount: n(m.amount), from: iso(m.periodFrom), to: iso(m.periodTo), detail: m.detail, notes: m.notes, entryId: m.entryId, entryNumber: m.entryNumber, invoiceId: m.invoiceId, invoiceNumber: m.invoiceNumber, createdBy: m.createdBy })) };
}

// ───────────────────────── calendar, dashboard, reports ─────────────────────────
export async function calendar(t: Db, C: string, q: any = {}) {
  const from = isDate(q.from) ? String(q.from) : today();
  const nd = Math.max(7, Math.min(62, Math.round(num(q.days) || 21)));
  const to = addDays(from, nd - 1);
  const td = today();
  const [assets, cts, mnt] = await Promise.all([
    t.rows(`SELECT id, code, name, kind, identifier, maintenance, is_active FROM rental_assets WHERE company_id=$1 AND is_active ORDER BY kind, code`, [C]),
    t.rows(`SELECT c.id, c.number, c.status, c.start_date, c.end_date, c.lines, p.name partner FROM rental_contracts c JOIN partners p ON p.id=c.partner_id WHERE c.company_id=$1 AND c.status IN ('RESERVED','ACTIVE','RETURNED','CLOSED') AND c.start_date <= $3 AND COALESCE(c.returned_date, GREATEST(c.end_date, CASE WHEN c.status='ACTIVE' THEN $4::date ELSE c.end_date END)) >= $2`, [C, from, to, td]),
    t.rows(`SELECT * FROM rental_maintenance WHERE company_id=$1 AND from_date <= $3 AND to_date >= $2`, [C, from, to]),
  ]);
  const dayList = Array.from({ length: nd }, (_, i) => addDays(from, i));
  const rows = assets.map((a: any) => {
    const cells = dayList.map((d) => {
      const m = mnt.find((x: any) => x.assetId === a.id && iso(x.fromDate)! <= d && iso(x.toDate)! >= d);
      if (m || a.maintenance) return { s: "M", label: m?.description || "صيانة" };
      for (const c of cts) {
        if (!(c.lines || []).some((l: any) => l.assetId === a.id)) continue;
        const end = c.status === "ACTIVE" && iso(c.endDate)! < td ? td : iso(c.endDate)!;
        if (iso(c.startDate)! <= d && end >= d) return { s: c.status === "RESERVED" ? "B" : c.status === "ACTIVE" ? (iso(c.endDate)! < d ? "L" : "R") : "D", id: c.id, label: `${c.number} — ${c.partner}` };
      }
      return { s: "" };
    });
    const busy = cells.filter((x) => ["R", "B", "L", "D"].includes(x.s)).length;
    return { id: a.id, code: a.code, name: a.name, kind: a.kind, identifier: a.identifier, cells, occupancyPct: r2((busy / nd) * 100) };
  });
  return { from, to, days: dayList, assets: rows };
}

export async function dashboard(t: Db, C: string) {
  const td = today(), m0 = td.slice(0, 8) + "01";
  const assets = await listAssets(t, C);
  const cts = await listContracts(t, C, { status: "OPEN" });
  const [month, held, ledger] = await Promise.all([
    t.one(`SELECT COALESCE(SUM(amount) FILTER (WHERE kind='INVOICE'),0) billed, COUNT(*) FILTER (WHERE kind='DELIVER')::int delivered, COUNT(*) FILTER (WHERE kind='RETURN')::int returned FROM rental_moves WHERE company_id=$1 AND date >= $2`, [C, m0]),
    t.one(`SELECT COALESCE(SUM(deposit_received - deposit_applied - deposit_refunded),0) h FROM rental_contracts WHERE company_id=$1`, [C]),
    t.maybe(`SELECT COALESCE(SUM(l.credit-l.debit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND a.system_key='RENTAL_DEPOSITS' AND e.status='POSTED'`, [C]),
  ]);
  const active = assets.filter((a: any) => a.isActive);
  const rented = active.filter((a: any) => a.status === "RENTED").length;
  const due = await t.one(`SELECT COUNT(*)::int c FROM rental_contracts WHERE company_id=$1 AND status='ACTIVE' AND billing='MONTHLY' AND next_bill_date <= $2`, [C, td]);
  return {
    assets: { total: active.length, rented, available: active.filter((a: any) => a.status === "AVAILABLE").length, maintenance: active.filter((a: any) => a.status === "MAINTENANCE").length, utilizationPct: active.length ? r2((rented / active.length) * 100) : 0 },
    contracts: { active: cts.filter((c) => c.status === "ACTIVE").length, reserved: cts.filter((c) => c.status === "RESERVED").length, returned: cts.filter((c) => c.status === "RETURNED").length, draft: cts.filter((c) => c.status === "DRAFT").length },
    overdue: cts.filter((c) => c.overdue), dueToday: cts.filter((c) => c.dueToday), startingSoon: cts.filter((c) => c.startsSoon), toSettle: cts.filter((c) => c.status === "RETURNED"),
    billingDue: due.c, month: { from: m0, billed: r2(month.billed), delivered: month.delivered, returned: month.returned },
    deposits: { held: r2(held.h), ledger: r2(ledger?.b || 0), match: Math.abs(n(held.h) - n(ledger?.b || 0)) < 0.01 },
  };
}

export async function reports(t: Db, C: string, q: any = {}) {
  const to = isDate(q.to) ? String(q.to) : today(), from = isDate(q.from) ? String(q.from) : to.slice(0, 8) + "01";
  const span = days(from, to);
  const td = today();
  const [assets, cts, inv, mnt] = await Promise.all([
    t.rows(`SELECT * FROM rental_assets WHERE company_id=$1 ORDER BY code`, [C]),
    t.rows(`SELECT c.*, p.name partner FROM rental_contracts c JOIN partners p ON p.id=c.partner_id WHERE c.company_id=$1 AND c.status IN ('ACTIVE','RETURNED','CLOSED') AND c.delivered_date <= $3 AND COALESCE(c.returned_date, $4::date) >= $2`, [C, from, to, td]),
    t.rows(`SELECT m.detail, m.amount, c.partner_id, p.name partner FROM rental_moves m JOIN rental_contracts c ON c.id=m.contract_id JOIN partners p ON p.id=c.partner_id WHERE m.company_id=$1 AND m.kind='INVOICE' AND m.date BETWEEN $2 AND $3`, [C, from, to]),
    t.rows(`SELECT asset_id, SUM(cost) cost, SUM(LEAST(to_date,$3::date) - GREATEST(from_date,$2::date) + 1) d FROM rental_maintenance WHERE company_id=$1 AND from_date <= $3 AND to_date >= $2 GROUP BY asset_id`, [C, from, to]),
  ]);
  const rentedDays = new Map<string, number>(), revenue = new Map<string, number>(), extras = { total: 0 };
  for (const c of cts) {
    const a0 = [iso(c.deliveredDate)!, from].sort().pop()!, a1 = [iso(c.returnedDate) || td, to].sort()[0];
    if (a1 < a0) continue;
    const d = days(a0, a1);
    for (const l of c.lines || []) rentedDays.set(l.assetId, (rentedDays.get(l.assetId) || 0) + d);
  }
  const byCustomer = new Map<string, { name: string; amount: number }>();
  for (const m of inv) {
    for (const x of m.detail?.assets || []) revenue.set(x.assetId, (revenue.get(x.assetId) || 0) + n(x.amount));
    extras.total += (m.detail?.extra || []).reduce((s: number, x: any) => s + n(x.amount), 0);
    const g = byCustomer.get(m.partnerId) || { name: m.partner, amount: 0 }; g.amount += n(m.amount); byCustomer.set(m.partnerId, g);
  }
  const M = new Map(mnt.map((m: any) => [m.assetId, m]));
  const rows = assets.map((a: any) => {
    const rd = Math.min(span, rentedDays.get(a.id) || 0), rev = r2(revenue.get(a.id) || 0), mm: any = M.get(a.id);
    return { id: a.id, code: a.code, name: a.name, kind: a.kind, rentedDays: rd, days: span, utilizationPct: r2((rd / span) * 100), revenue: rev, perDay: rd ? r2(rev / rd) : 0, maintenanceDays: n(mm?.d), maintenanceCost: r2(n(mm?.cost)), costValue: n(a.costValue), returnPct: n(a.costValue) ? r2((rev / n(a.costValue)) * 100) : null };
  }).sort((x: any, y: any) => y.revenue - x.revenue);
  const total = r2(inv.reduce((s: number, m: any) => s + n(m.amount), 0));
  return { from, to, days: span, assets: rows, totals: { revenue: total, extras: r2(extras.total), utilizationPct: rows.length ? r2(rows.reduce((s, r) => s + r.utilizationPct, 0) / rows.length) : 0 }, customers: [...byCustomer.values()].map((x) => ({ ...x, amount: r2(x.amount) })).sort((x, y) => y.amount - x.amount) };
}

/** For the integrity checks: deposits held on the contracts against the deposits account (null when not in use). */
export async function depositCheck(t: Db, C: string) {
  const acc = await t.maybe(`SELECT id FROM accounts WHERE company_id=$1 AND system_key='RENTAL_DEPOSITS'`, [C]);
  if (!acc) return null;
  const [h, g] = await Promise.all([
    t.one(`SELECT COALESCE(SUM(deposit_received - deposit_applied - deposit_refunded),0) h FROM rental_contracts WHERE company_id=$1`, [C]),
    t.one(`SELECT COALESCE(SUM(l.credit-l.debit),0) b FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id=$1 AND e.status='POSTED'`, [acc.id]),
  ]);
  return { held: r2(h.h), ledger: r2(g.b) };
}
export async function rentalGuardOnReverse(t: Db, C: string, entryId: string) {
  const e = await t.maybe(`SELECT reference FROM journal_entries WHERE id=$1 AND company_id=$2 AND source_type='RENTAL'`, [uid(entryId), C]);
  if (e) throw conflict(`هذا قيد تأمين عقد الإيجار ${e.reference}: يُسوّى من شاشة العقد حتى يبقى رصيد التأمينات مطابقاً`);
}
