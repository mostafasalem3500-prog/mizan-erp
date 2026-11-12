/**
 * Restaurant / café layer of the point of sale. An order is opened on a table (or as take-away / delivery), items are
 * added over time and sent to the kitchen in rounds, and it turns into an ordinary POS sale only when it is paid —
 * so stock, the journal entry and the tax invoice all come from the same posSale used by every activity.
 */
import { Db } from "../db/pool";
import { bad, conflict, num, r2 } from "../lib/core";

export type PosMode = "RETAIL" | "RESTAURANT" | "CAFE";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEF_NOTES = ["بدون بصل", "بدون ثوم", "حار", "حار جداً", "بدون ملح", "إضافة جبن", "مشوي جيداً", "على جنب", "سفري"];
export function settingsOf(company: any) {
  const s = company.accounting?.pos || {};
  return { mode: (["RETAIL", "RESTAURANT", "CAFE"].includes(s.mode) ? s.mode : "RETAIL") as PosMode, quickNotes: Array.isArray(s.quickNotes) ? s.quickNotes.map(String).slice(0, 40) : DEF_NOTES, askGuests: s.askGuests !== false };
}
export async function saveSettings(t: Db, companyId: string, b: any) {
  const cur = (await t.one(`SELECT accounting FROM companies WHERE id=$1`, [companyId])).accounting?.pos || {};
  const next = { ...cur, ...(["RETAIL", "RESTAURANT", "CAFE"].includes(b.mode) ? { mode: b.mode } : {}), ...(Array.isArray(b.quickNotes) ? { quickNotes: b.quickNotes.map((x: any) => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 40) } : {}), ...(b.askGuests === undefined ? {} : { askGuests: !!b.askGuests }) };
  await t.exec(`UPDATE companies SET accounting = jsonb_set(COALESCE(accounting,'{}'::jsonb), '{pos}', $2::jsonb) WHERE id=$1`, [companyId, JSON.stringify(next)]);
  // a restaurant starts with one hall so the first screen is never empty
  if (next.mode === "RESTAURANT" && !(await t.maybe(`SELECT 1 FROM pos_floors WHERE company_id=$1 LIMIT 1`, [companyId]))) { const f = await t.insert("pos_floors", { companyId, name: "الصالة الرئيسية", sort: 1 }); for (let i = 1; i <= 8; i++) await t.insert("pos_tables", { companyId, floorId: f.id, name: `طاولة ${i}`, seats: 4, sort: i }); }
  return settingsOf({ accounting: { pos: next } });
}
const brief = (o: any) => ({ id: o.id, number: o.number, type: o.type, tableId: o.tableId, tableName: o.tableName, guests: o.guests, total: Number(o.total), items: (o.lines || []).reduce((a: number, l: any) => a + num(l.qty), 0), pending: (o.lines || []).some((l: any) => num(l.qty) !== num(l.sentQty)), waiter: o.waiter, customerName: o.customerName, customerPhone: o.customerPhone, address: o.address, openedAt: o.openedAt });
export async function overview(t: Db, company: any) {
  const C = company.id;
  const floors = await t.rows(`SELECT id, name, sort FROM pos_floors WHERE company_id=$1 ORDER BY sort, created_at`, [C]);
  const tables = await t.rows(`SELECT id, floor_id, name, seats, sort FROM pos_tables WHERE company_id=$1 AND is_active ORDER BY sort, created_at`, [C]);
  const orders = await t.rows(`SELECT * FROM pos_orders WHERE company_id=$1 AND status='OPEN' ORDER BY opened_at`, [C]);
  const byTable = new Map(orders.filter((o) => o.tableId).map((o) => [o.tableId, brief(o)]));
  return { settings: settingsOf(company), floors: floors.map((f) => ({ ...f, tables: tables.filter((x) => x.floorId === f.id).map((x) => ({ id: x.id, name: x.name, seats: x.seats, order: byTable.get(x.id) || null })) })), orders: orders.filter((o) => !o.tableId).map(brief),
    stats: { open: orders.length, busy: byTable.size, tables: tables.length, value: r2(orders.reduce((a, o) => a + Number(o.total), 0)) } };
}
export async function saveFloor(t: Db, C: string, b: any, id?: string) {
  const name = String(b.name || "").trim().slice(0, 40); if (!name) throw bad("اسم الصالة مطلوب");
  if (id) return t.update("pos_floors", { id, companyId: C }, { name, sort: b.sort === undefined ? undefined : Math.round(num(b.sort)) });
  const n = await t.one(`SELECT COALESCE(MAX(sort),0)+1 s FROM pos_floors WHERE company_id=$1`, [C]);
  return t.insert("pos_floors", { companyId: C, name, sort: n.s });
}
export async function deleteFloor(t: Db, C: string, id: string) {
  const busy = await t.maybe(`SELECT 1 FROM pos_orders o JOIN pos_tables x ON x.id=o.table_id WHERE x.floor_id=$1 AND o.company_id=$2 AND o.status='OPEN' LIMIT 1`, [id, C]);
  if (busy) throw conflict("في الصالة طاولات عليها طلبات مفتوحة");
  await t.exec(`DELETE FROM pos_floors WHERE id=$1 AND company_id=$2`, [id, C]);
}
/** One table, or a run of them: «طاولة 1 … طاولة 12». */
export async function addTables(t: Db, C: string, b: any) {
  const floor = await t.one(`SELECT id FROM pos_floors WHERE id=$1 AND company_id=$2`, [UUID.test(b.floorId || "") ? b.floorId : null, C], "الصالة غير موجودة");
  const count = Math.min(60, Math.max(1, Math.round(num(b.count) || 1))), seats = Math.min(40, Math.max(1, Math.round(num(b.seats) || 4))), prefix = String(b.prefix || "طاولة").trim().slice(0, 20);
  const total = await t.one(`SELECT COUNT(*)::int c, COALESCE(MAX(sort),0) s FROM pos_tables WHERE company_id=$1`, [C]);
  if (total.c + count > 300) throw bad("الحد 300 طاولة");
  const have = await t.one(`SELECT COUNT(*)::int c FROM pos_tables WHERE floor_id=$1`, [floor.id]);
  const out = [];
  for (let i = 1; i <= count; i++) out.push(await t.insert("pos_tables", { companyId: C, floorId: floor.id, name: b.name && count === 1 ? String(b.name).trim().slice(0, 30) : `${prefix} ${have.c + i}`, seats, sort: total.s + i }));
  return out;
}
export async function saveTable(t: Db, C: string, id: string, b: any) {
  return t.update("pos_tables", { id, companyId: C }, { name: b.name === undefined ? undefined : String(b.name).trim().slice(0, 30) || undefined, seats: b.seats === undefined ? undefined : Math.min(40, Math.max(1, Math.round(num(b.seats)))), floorId: UUID.test(b.floorId || "") ? b.floorId : undefined });
}
export async function deleteTable(t: Db, C: string, id: string) {
  if (await t.maybe(`SELECT 1 FROM pos_orders WHERE table_id=$1 AND company_id=$2 AND status='OPEN'`, [id, C])) throw conflict("على الطاولة طلب مفتوح");
  await t.exec(`DELETE FROM pos_tables WHERE id=$1 AND company_id=$2`, [id, C]);
}

type Line = { key: string; productId: string; name: string; qty: number; unitPrice: number; discountPct: number; uomId: string | null; uomName: string | null; note: string; sentQty: number; readyQty: number };
function cleanLines(raw: any, prev: Line[] = []): Line[] {
  if (!Array.isArray(raw)) throw bad("سطور الطلب غير صحيحة");
  if (raw.length > 200) throw bad("حتى 200 سطر في الطلب");
  const was = new Map(prev.map((l) => [l.key, l]));
  return raw.filter((l) => UUID.test(l?.productId || "") && num(l.qty) > 0).map((l) => {
    const key = String(l.key || `${l.productId}:${l.uomId || ""}`).slice(0, 90), p = was.get(key);
    // what the kitchen already has is the server's knowledge, never the screen's
    return { key, productId: l.productId, name: String(l.name || "").slice(0, 120), qty: r2(num(l.qty)), unitPrice: r2(num(l.unitPrice)), discountPct: Math.min(100, Math.max(0, num(l.discountPct))), uomId: UUID.test(l.uomId || "") ? l.uomId : null, uomName: l.uomName ? String(l.uomName).slice(0, 30) : null, note: String(l.note || "").slice(0, 160), sentQty: p ? num(p.sentQty) : 0, readyQty: p ? num(p.readyQty) : 0 };
  });
}
const totalOf = (lines: Line[]) => r2(lines.reduce((a, l) => a + l.qty * l.unitPrice * (1 - l.discountPct / 100), 0));
const full = (o: any) => ({ ...brief(o), status: o.status, partnerId: o.partnerId, notes: o.notes, lines: o.lines || [] });

export async function openOrder(t: Db, company: any, user: string, b: any) {
  const C = company.id; const type = ["DINE_IN", "TAKEAWAY", "DELIVERY"].includes(b.type) ? b.type : b.tableId ? "DINE_IN" : "TAKEAWAY";
  let table: any = null;
  if (b.tableId) {
    table = await t.one(`SELECT id, name FROM pos_tables WHERE id=$1 AND company_id=$2 AND is_active FOR UPDATE`, [UUID.test(b.tableId) ? b.tableId : null, C], "الطاولة غير موجودة");
    const busy = await t.maybe(`SELECT * FROM pos_orders WHERE table_id=$1 AND status='OPEN'`, [table.id]);
    if (busy) return full(busy); // the table already has its order: open it instead of a second one
  }
  if (type === "DELIVERY" && !String(b.customerPhone || "").trim()) throw bad("رقم جوال العميل مطلوب لطلب التوصيل");
  const n = await t.one(`SELECT COALESCE(MAX(number),0)+1 n FROM pos_orders WHERE company_id=$1 AND opened_at::date = CURRENT_DATE`, [C]);
  const o = await t.insert("pos_orders", { companyId: C, number: n.n, type: table ? "DINE_IN" : type, tableId: table?.id || null, tableName: table?.name || null, guests: Math.min(99, Math.max(1, Math.round(num(b.guests) || 1))),
    partnerId: UUID.test(b.partnerId || "") ? b.partnerId : null, customerName: b.customerName ? String(b.customerName).slice(0, 80) : null, customerPhone: b.customerPhone ? String(b.customerPhone).slice(0, 20) : null, address: b.address ? String(b.address).slice(0, 200) : null, waiter: user, lines: JSON.stringify([]) });
  return full(o);
}
const locked = (t: Db, C: string, id: string) => t.one(`SELECT * FROM pos_orders WHERE id=$1 AND company_id=$2 FOR UPDATE`, [UUID.test(id) ? id : null, C], "الطلب غير موجود");
const mustOpen = (o: any) => { if (o.status !== "OPEN") throw conflict(o.status === "PAID" ? "الطلب مدفوع ومغلق" : "الطلب ملغى"); };
export async function getOrder(t: Db, C: string, id: string) { return full(await t.one(`SELECT * FROM pos_orders WHERE id=$1 AND company_id=$2`, [UUID.test(id) ? id : null, C], "الطلب غير موجود")); }
export async function saveOrder(t: Db, C: string, id: string, b: any) {
  const o = await locked(t, C, id); mustOpen(o);
  const lines = b.lines === undefined ? (o.lines as Line[]) : cleanLines(b.lines, o.lines);
  const u = await t.update("pos_orders", { id, companyId: C }, { lines: JSON.stringify(lines), total: totalOf(lines), guests: b.guests === undefined ? undefined : Math.min(99, Math.max(1, Math.round(num(b.guests) || 1))), partnerId: b.partnerId === undefined ? undefined : UUID.test(b.partnerId || "") ? b.partnerId : null,
    notes: b.notes === undefined ? undefined : String(b.notes || "").slice(0, 300), customerName: b.customerName === undefined ? undefined : String(b.customerName || "").slice(0, 80), customerPhone: b.customerPhone === undefined ? undefined : String(b.customerPhone || "").slice(0, 20), address: b.address === undefined ? undefined : String(b.address || "").slice(0, 200), updatedAt: new Date() });
  return full(u);
}
/** Sends what the kitchen has not seen yet and returns that round as a ticket (additions, and reductions as «إلغاء»). */
export async function sendToKitchen(t: Db, C: string, id: string, b: any) {
  let o = await locked(t, C, id); mustOpen(o);
  const before = new Map((o.lines as Line[]).map((l) => [l.key, l]));
  const lines = b?.lines === undefined ? (o.lines as Line[]) : cleanLines(b.lines, o.lines);
  const items: { name: string; qty: number; note: string; cancel?: boolean }[] = [];
  for (const l of lines) { const d = r2(l.qty - l.sentQty); if (d > 0) items.push({ name: l.name + (l.uomName ? ` (${l.uomName})` : ""), qty: d, note: l.note }); else if (d < 0) items.push({ name: l.name, qty: -d, note: "", cancel: true }); l.sentQty = l.qty; l.readyQty = Math.min(l.readyQty, l.qty); }
  for (const [k, l] of before) if (!lines.some((x) => x.key === k) && l.sentQty > 0) items.push({ name: l.name, qty: l.sentQty, note: "", cancel: true });
  o = await t.update("pos_orders", { id, companyId: C }, { lines: JSON.stringify(lines), total: totalOf(lines), updatedAt: new Date() });
  return { order: full(o), ticket: items.length ? { number: o.number, type: o.type, tableName: o.tableName, guests: o.guests, waiter: o.waiter, at: new Date().toISOString(), items, notes: o.notes } : null };
}
export async function moveOrder(t: Db, C: string, id: string, tableId: string) {
  const o = await locked(t, C, id); mustOpen(o);
  const table = await t.one(`SELECT id, name FROM pos_tables WHERE id=$1 AND company_id=$2 AND is_active FOR UPDATE`, [UUID.test(tableId) ? tableId : null, C], "الطاولة غير موجودة");
  const there = await t.maybe(`SELECT id, number FROM pos_orders WHERE table_id=$1 AND status='OPEN' AND id<>$2`, [table.id, id]);
  if (there) throw conflict(`«${table.name}» عليها الطلب رقم ${there.number} — ادمج الطلبين بدل النقل`);
  return full(await t.update("pos_orders", { id, companyId: C }, { tableId: table.id, tableName: table.name, type: "DINE_IN", updatedAt: new Date() }));
}
/** Everything on this order goes onto another open order; this one closes empty. */
export async function mergeOrder(t: Db, C: string, id: string, intoId: string) {
  if (id === intoId) throw bad("اختر طلباً آخر");
  const [a, b2] = [id, intoId].sort(); const first = await locked(t, C, a), second = await locked(t, C, b2); // one order for the locks, whatever the direction
  const from = first.id === id ? first : second, into = first.id === id ? second : first; mustOpen(from); mustOpen(into);
  const lines = [...(into.lines as Line[])];
  for (const l of from.lines as Line[]) { const x = lines.find((y) => y.key === l.key && y.note === l.note && y.unitPrice === l.unitPrice); if (x) { x.qty = r2(x.qty + l.qty); x.sentQty = r2(x.sentQty + l.sentQty); x.readyQty = r2(x.readyQty + l.readyQty); } else lines.push({ ...l, key: lines.some((y) => y.key === l.key) ? `${l.key}#${from.number}` : l.key }); }
  await t.update("pos_orders", { id: from.id, companyId: C }, { status: "CANCELLED", cancelReason: `دُمج في الطلب ${into.number}`, lines: JSON.stringify([]), total: 0, closedAt: new Date() });
  return full(await t.update("pos_orders", { id: into.id, companyId: C }, { lines: JSON.stringify(lines), total: totalOf(lines), guests: into.guests + from.guests, updatedAt: new Date() }));
}
export async function cancelOrder(t: Db, C: string, id: string, reason: string) {
  const o = await locked(t, C, id); mustOpen(o);
  const sent = (o.lines as Line[]).some((l) => l.sentQty > 0);
  if (sent && String(reason || "").trim().length < 3) throw bad("اكتب سبب الإلغاء: أُرسلت أصناف من هذا الطلب للمطبخ");
  return full(await t.update("pos_orders", { id, companyId: C }, { status: "CANCELLED", cancelReason: String(reason || "").slice(0, 200) || null, closedAt: new Date() }));
}
/** After the sale is posted: the paid lines leave the order; when nothing is left the order closes and the table is free. */
export async function settle(t: Db, C: string, orderId: string, invoice: any, paid?: { key: string; qty: number }[]) {
  const o = await locked(t, C, orderId);
  if (o.status !== "OPEN" || (o.invoiceIds || []).includes(invoice.id)) return null; // an offline sale replayed twice
  let lines = o.lines as Line[];
  if (Array.isArray(paid) && paid.length) { const m = new Map(paid.map((p) => [String(p.key), num(p.qty)])); lines = lines.map((l) => { const q = m.get(l.key); if (!q) return l; const left = r2(l.qty - q); return { ...l, qty: left, sentQty: Math.min(l.sentQty, left), readyQty: Math.min(l.readyQty, left) }; }).filter((l) => l.qty > 0); } else lines = [];
  const done = !lines.length;
  await t.exec(`UPDATE invoices SET pos_order_id=$2, table_name=$3, order_type=$4, order_no=$5 WHERE id=$1`, [invoice.id, o.id, o.tableName, o.type, o.number]);
  await t.update("pos_orders", { id: o.id, companyId: C }, { lines: JSON.stringify(lines), total: totalOf(lines), invoiceIds: JSON.stringify([...(o.invoiceIds || []), invoice.id]), status: done ? "PAID" : "OPEN", closedAt: done ? new Date() : null, updatedAt: new Date() });
  return { closed: done, tableName: o.tableName, type: o.type, number: o.number };
}
/** Kitchen screen: every round that was sent and is not marked ready yet, oldest first. */
export async function kitchen(t: Db, C: string) {
  const orders = await t.rows(`SELECT id, number, type, table_name, waiter, notes, lines, opened_at, updated_at FROM pos_orders WHERE company_id=$1 AND status='OPEN' ORDER BY updated_at`, [C]);
  return orders.map((o) => ({ id: o.id, number: o.number, type: o.type, tableName: o.tableName, waiter: o.waiter, notes: o.notes, since: o.updatedAt, items: (o.lines as Line[]).filter((l) => l.sentQty > l.readyQty).map((l) => ({ key: l.key, name: l.name + (l.uomName ? ` (${l.uomName})` : ""), qty: r2(l.sentQty - l.readyQty), note: l.note })) })).filter((o) => o.items.length);
}
export async function markReady(t: Db, C: string, id: string, keys?: string[]) {
  const o = await locked(t, C, id); mustOpen(o);
  const lines = (o.lines as Line[]).map((l) => (!keys?.length || keys.includes(l.key) ? { ...l, readyQty: l.sentQty } : l));
  await t.update("pos_orders", { id, companyId: C }, { lines: JSON.stringify(lines) });
  return { ok: true };
}
/** What the restaurant sold: by order type, by table, by hour — from the posted invoices of the period. */
export async function report(t: Db, C: string, from: string, to: string) {
  const base = `FROM invoices i WHERE i.company_id=$1 AND i.pos_order_id IS NOT NULL AND i.status='POSTED' AND i.kind='INVOICE' AND i.date BETWEEN $2 AND $3`;
  const byType = await t.rows(`SELECT COALESCE(order_type,'DINE_IN') type, COUNT(*)::int n, COALESCE(SUM(total),0) total ${base} GROUP BY 1 ORDER BY 3 DESC`, [C, from, to]);
  const byTable = await t.rows(`SELECT table_name name, COUNT(*)::int n, COALESCE(SUM(total),0) total ${base} AND table_name IS NOT NULL GROUP BY 1 ORDER BY 3 DESC LIMIT 40`, [C, from, to]);
  const byHour = await t.rows(`SELECT EXTRACT(HOUR FROM (i.issued_at AT TIME ZONE 'Asia/Riyadh'))::int h, COUNT(*)::int n, COALESCE(SUM(total),0) total ${base} GROUP BY 1 ORDER BY 1`, [C, from, to]);
  const cancelled = await t.one(`SELECT COUNT(*)::int n FROM pos_orders WHERE company_id=$1 AND status='CANCELLED' AND COALESCE(cancel_reason,'') NOT LIKE 'دُمج%' AND opened_at::date BETWEEN $2 AND $3`, [C, from, to]);
  const tot = byType.reduce((a, r) => ({ n: a.n + r.n, total: a.total + Number(r.total) }), { n: 0, total: 0 });
  return { from, to, orders: tot.n, total: r2(tot.total), average: tot.n ? r2(tot.total / tot.n) : 0, cancelled: cancelled.n, byType: byType.map((r) => ({ ...r, total: Number(r.total) })), byTable: byTable.map((r) => ({ ...r, total: Number(r.total) })), byHour: byHour.map((r) => ({ ...r, total: Number(r.total) })) };
}
