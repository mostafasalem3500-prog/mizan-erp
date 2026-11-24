/**
 * 3.43.0
 *  • Set-off (SAP customer/vendor clearing, Odoo netting): a party that is both customer and supplier settles what it owes
 *    against what it is owed with one entry — Dr payables / Cr receivables — allocated to the open invoices of both sides.
 *  • Recipes (Foodics ingredients, Odoo kit): a non-stock item with a recipe consumes its ingredients from stock when it
 *    is sold, and its cost of sales is the cost of what was consumed.
 *  • Supplier bank details and the bank transfer file of an approved payment run (SAP payment medium, Dynamics export).
 */
import { Db } from "../db/pool";
import { bad, conflict, num, r2, r3, isDate, today } from "../lib/core";
import { nextNumber, post, reverse, assertOpenDate } from "../accounting/engine";
import { stockIn, stockOut } from "../accounting/stock";
import { applySettlement, saveDraft, postInvoice } from "./invoices";
import { BASE } from "./currency";
import { getRun } from "./paymentruns";
import { saveGroup } from "./modifiers";
import { openSession, posSale, closeSession } from "./pos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (d: any) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);

// ───────────────────────── set-off ─────────────────────────
const OPEN_SQL = (dir: "SALE" | "PURCHASE") => `
  SELECT i.id, i.number, i.date, COALESCE(i.due_date, i.date) due, i.total, i.amount_paid,
         ${dir === "PURCHASE" ? `COALESCE((SELECT SUM(l.amount) FROM payment_run_lines l JOIN payment_runs r ON r.id=l.run_id WHERE l.invoice_id=i.id AND r.status IN ('DRAFT','APPROVED')),0)` : "0"} held
    FROM invoices i
   WHERE i.company_id=$1 AND i.partner_id=$2 AND i.direction='${dir}' AND i.kind IN ('INVOICE','DEBIT_NOTE') AND i.status='POSTED'
     AND i.total - i.amount_paid > 0.005 AND COALESCE(i.currency,$3)=$3
   ORDER BY COALESCE(i.due_date, i.date), i.date, i.number`;

async function openOf(t: Db, C: string, partnerId: string, dir: "SALE" | "PURCHASE", lock = false) {
  const rows = await t.rows(OPEN_SQL(dir) + (lock ? " FOR UPDATE OF i" : ""), [C, partnerId, BASE]);
  return rows.map((r: any) => ({ id: r.id, number: r.number, date: iso(r.date), due: iso(r.due), open: r2(Number(r.total) - Number(r.amountPaid) - Number(r.held)) })).filter((r: any) => r.open > 0.005);
}

/** Parties that have open invoices on both sides, with the most that can be set off for each. */
export async function setoffCandidates(t: Db, C: string) {
  const rows = await t.rows(
    `SELECT p.id, p.name, p.code,
            COALESCE(SUM(i.total - i.amount_paid) FILTER (WHERE i.direction='SALE'),0) ar,
            COALESCE(SUM(i.total - i.amount_paid) FILTER (WHERE i.direction='PURCHASE'),0) ap
       FROM partners p JOIN invoices i ON i.partner_id=p.id AND i.company_id=p.company_id AND i.kind IN ('INVOICE','DEBIT_NOTE') AND i.status='POSTED' AND i.total - i.amount_paid > 0.005 AND COALESCE(i.currency,$2)=$2
      WHERE p.company_id=$1 GROUP BY p.id
     HAVING COALESCE(SUM(i.total - i.amount_paid) FILTER (WHERE i.direction='SALE'),0) > 0.005 AND COALESCE(SUM(i.total - i.amount_paid) FILTER (WHERE i.direction='PURCHASE'),0) > 0.005
      ORDER BY p.name`, [C, BASE]);
  const out: any[] = [];
  for (const r of rows) {
    const ar = await openOf(t, C, r.id, "SALE"), ap = await openOf(t, C, r.id, "PURCHASE");
    const a = r2(ar.reduce((s: number, x: any) => s + x.open, 0)), b = r2(ap.reduce((s: number, x: any) => s + x.open, 0));
    if (a > 0.005 && b > 0.005) out.push({ partnerId: r.id, name: r.name, code: r.code, receivable: a, payable: b, max: Math.min(a, b), net: r2(a - b), sales: ar, purchases: ap });
  }
  return { rows: out };
}

export async function listSetoffs(t: Db, C: string) {
  const rows = await t.rows(`SELECT s.*, p.name partner_name, e.number journal_number FROM partner_setoffs s JOIN partners p ON p.id=s.partner_id LEFT JOIN journal_entries e ON e.id=s.journal_id WHERE s.company_id=$1 ORDER BY s.date DESC, s.created_at DESC LIMIT 300`, [C]);
  return { rows: rows.map((r: any) => ({ ...r, date: iso(r.date), amount: Number(r.amount) })) };
}

/** FIFO by due date over the open invoices of one side. */
function allocate(open: any[], amount: number, side: "AR" | "AP") {
  let rest = amount; const out: any[] = [];
  for (const o of open) { if (rest <= 0.005) break; const a = r2(Math.min(o.open, rest)); out.push({ invoiceId: o.id, number: o.number, side, amount: a }); rest = r2(rest - a); }
  return out;
}

export async function setoffPreview(t: Db, C: string, b: any) {
  const partner = await t.one(`SELECT id, name FROM partners WHERE id=$1 AND company_id=$2`, [UUID.test(String(b.partnerId)) ? b.partnerId : null, C], "الطرف غير موجود");
  const ar = await openOf(t, C, partner.id, "SALE"), ap = await openOf(t, C, partner.id, "PURCHASE");
  const a = r2(ar.reduce((s: number, x: any) => s + x.open, 0)), p = r2(ap.reduce((s: number, x: any) => s + x.open, 0));
  const max = Math.min(a, p);
  const amount = b.amount === undefined || b.amount === null || b.amount === "" ? max : r2(num(b.amount));
  return { partner, receivable: a, payable: p, max, amount, allocations: [...allocate(ar, Math.min(amount, max), "AR"), ...allocate(ap, Math.min(amount, max), "AP")], after: { receivable: r2(a - Math.min(amount, max)), payable: r2(p - Math.min(amount, max)) } };
}

export async function createSetoff(t: Db, C: string, user: string, b: any, opts: { isDemo?: boolean } = {}) {
  const date = isDate(b.date) ? String(b.date) : today();
  const partner = await t.one(`SELECT id, name FROM partners WHERE id=$1 AND company_id=$2 FOR UPDATE`, [UUID.test(String(b.partnerId)) ? b.partnerId : null, C], "الطرف غير موجود");
  const ar = await openOf(t, C, partner.id, "SALE", true), ap = await openOf(t, C, partner.id, "PURCHASE", true);
  const a = r2(ar.reduce((s: number, x: any) => s + x.open, 0)), p = r2(ap.reduce((s: number, x: any) => s + x.open, 0));
  if (a <= 0.005 || p <= 0.005) throw bad(`لا مقاصة ممكنة: «${partner.name}» ليس له فواتير مفتوحة في الجانبين (عليه ${a.toFixed(2)}، له ${p.toFixed(2)})`);
  const max = Math.min(a, p);
  const amount = b.amount === undefined || b.amount === null || b.amount === "" ? max : r2(num(b.amount));
  if (!(amount > 0)) throw bad("مبلغ المقاصة يجب أن يكون أكبر من صفر");
  if (amount > max + 0.001) throw bad(`مبلغ المقاصة ${amount.toFixed(2)} يتجاوز الممكن ${max.toFixed(2)} (الأقل من: عليه ${a.toFixed(2)}، له ${p.toFixed(2)})`);
  const allocations = [...allocate(ar, amount, "AR"), ...allocate(ap, amount, "AP")];
  const number = await nextNumber(t, C, "SET", date);
  const memo = `مقاصة ${number} — ${partner.name}${b.memo ? ` — ${String(b.memo).slice(0, 200)}` : ""}`;
  const row = await t.insert("partner_setoffs", { companyId: C, number, date, partnerId: partner.id, amount, allocations: JSON.stringify(allocations), memo: b.memo ? String(b.memo).slice(0, 300) : null, createdBy: user, isDemo: !!opts.isDemo });
  const entry = await post(t, C, { date, type: "MANUAL", sourceType: "SETOFF", sourceId: row.id, reference: number, memo, createdBy: user, isDemo: !!opts.isDemo,
    lines: [{ key: "AP", debit: amount, partnerId: partner.id, description: memo }, { key: "AR", credit: amount, partnerId: partner.id, description: memo }] });
  for (const x of allocations) await applySettlement(t, x.invoiceId, x.amount);
  await t.exec(`UPDATE partner_setoffs SET journal_id=$2 WHERE id=$1`, [row.id, entry.id]);
  return { ...row, journalId: entry.id, journalNumber: entry.number, amount, allocations, partnerName: partner.name };
}

export async function cancelSetoff(t: Db, C: string, user: string, id: string) {
  const s = await t.one(`SELECT * FROM partner_setoffs WHERE id=$1 AND company_id=$2 FOR UPDATE`, [UUID.test(id) ? id : null, C], "المقاصة غير موجودة");
  if (s.status !== "POSTED") throw conflict("المقاصة ملغاة من قبل");
  for (const x of (s.allocations || []) as any[]) await applySettlement(t, x.invoiceId, -Number(x.amount));
  if (s.journalId) await reverse(t, C, s.journalId, today(), `إلغاء مقاصة ${s.number}`, user);
  await t.exec(`UPDATE partner_setoffs SET status='CANCELLED' WHERE id=$1`, [s.id]);
  return { id: s.id, number: s.number, status: "CANCELLED" };
}

/** A set-off entry is undone from the set-off screen (which also reopens the invoices), not from the journal. */
export async function setoffGuardOnReverse(t: Db, C: string, entryId: string) {
  const s = await t.maybe(`SELECT number FROM partner_setoffs WHERE company_id=$1 AND journal_id=$2 AND status='POSTED'`, [C, UUID.test(entryId) ? entryId : null]);
  if (s) throw conflict(`هذا قيد المقاصة ${s.number}: ألغِها من شاشة «مقاصة عميل/مورد» ليُعاد فتح فواتيرها`);
}

// ───────────────────────── recipes, preparations and production batches ─────────────────────────
/**
 * Three kinds of item meet here:
 *  • a raw material — a stock item bought from suppliers;
 *  • a preparation (تحضيرة) — a stock item made in the kitchen from a recipe: the recipe lists what goes into ONE BATCH
 *    and the batch yields `output` units (cooked shawarma: 12 kg of marinated meat in, 7.8 kg out);
 *  • a dish — a non-stock item sold to the guest, whose recipe is per ONE unit sold.
 * A preparation is costed one of two ways, chosen per preparation:
 *  • BATCH (الطبخة / التصنيع): a production batch takes the ingredients out of stock and puts the preparation in at
 *    their cost; sales then take the preparation from stock. Real yield shows in the unit cost.
 *  • DIRECT (الخصم المباشر): nothing is produced into stock; a sale is exploded through the preparation down to the
 *    raw materials by the standard yield and takes them directly.
 */
type Node = { id: string; name: string; type: string; output: number; method: string; lines: { componentId: string; qty: number; wastePct: number; used: number }[] };
type Info = { id: string; name: string; sku: string; unit: string; type: string; purchasePrice: number; avg: number | null; onHand: number; salePrice: number };

async function loadAll(t: Db, C: string) {
  const rows = await t.rows(`SELECT r.product_id, r.component_id, r.qty, r.waste_pct, p.name, p.type, COALESCE(h.output_qty,1) output, COALESCE(h.method,'DIRECT') method
     FROM product_recipes r JOIN products p ON p.id=r.product_id LEFT JOIN recipe_headers h ON h.product_id=r.product_id WHERE r.company_id=$1 ORDER BY r.sort`, [C]);
  const nodes = new Map<string, Node>();
  for (const r of rows) {
    const n: Node = nodes.get(r.productId) || { id: r.productId, name: r.name, type: r.type, output: r.type === "STOCK" ? Number(r.output) : 1, method: r.method, lines: [] };
    const w = Number(r.wastePct || 0); n.lines.push({ componentId: r.componentId, qty: Number(r.qty), wastePct: w, used: Number(r.qty) * (1 + w / 100) }); nodes.set(r.productId, n);
  }
  const ids = [...new Set([...nodes.keys(), ...rows.map((r: any) => r.componentId)])];
  const infos = new Map<string, Info>();
  if (ids.length) for (const x of await t.rows(`SELECT c.id, c.name, c.sku, c.unit, c.type, c.purchase_price, c.sale_price,
        (SELECT SUM(b.value)/NULLIF(SUM(b.qty),0) FROM stock_balances b WHERE b.company_id=$1 AND b.product_id=c.id AND b.qty > 0) avg,
        COALESCE((SELECT SUM(b.qty) FROM stock_balances b WHERE b.company_id=$1 AND b.product_id=c.id),0) on_hand FROM products c WHERE c.company_id=$1 AND c.id = ANY($2::uuid[])`, [C, ids]))
    infos.set(x.id, { id: x.id, name: x.name, sku: x.sku, unit: x.unit, type: x.type, purchasePrice: Number(x.purchasePrice || 0), avg: x.avg === null ? null : Number(x.avg), onHand: Number(x.onHand), salePrice: Number(x.salePrice || 0) });
  return { nodes, infos };
}
/** Sold or consumed through its recipe (a dish, or a preparation on the direct method) rather than taken from stock as itself. */
const exploded = (n?: Node) => !!n && (n.type !== "STOCK" || n.method === "DIRECT");
/** Standard cost of one unit from the recipe downwards. */
function stdCost(all: { nodes: Map<string, Node>; infos: Map<string, Info> }, id: string, depth = 0): number {
  const n = all.nodes.get(id), i = all.infos.get(id);
  if (!n || depth > 6) return i ? (i.avg ?? i.purchasePrice) : 0;
  return n.lines.reduce((a, l) => a + l.used * unitCost(all, l.componentId, depth + 1), 0) / n.output;
}
/** What one unit costs today: stock average for what is held in stock, the recipe for what is not. */
function unitCost(all: { nodes: Map<string, Node>; infos: Map<string, Info> }, id: string, depth = 0): number {
  const n = all.nodes.get(id), i = all.infos.get(id);
  if (n && (exploded(n) || !i || i.avg === null)) return stdCost(all, id, depth);
  return i ? (i.avg ?? i.purchasePrice) : 0;
}
/** Raw materials (and batch preparations held in stock) behind `qty` units of an item. */
function explode(all: { nodes: Map<string, Node>; infos: Map<string, Info> }, id: string, qty: number, acc = new Map<string, number>(), depth = 0) {
  const n = all.nodes.get(id);
  if (!n) { acc.set(id, (acc.get(id) || 0) + qty); return acc; }
  if (depth > 6) throw bad("الوصفة تدور على نفسها أو أعمق من ستة مستويات");
  for (const l of n.lines) {
    const need = (qty * l.used) / n.output;
    if (exploded(all.nodes.get(l.componentId)) ) explode(all, l.componentId, need, acc, depth + 1); else acc.set(l.componentId, (acc.get(l.componentId) || 0) + need);
  }
  return acc;
}

export async function getRecipe(t: Db, C: string, productId: string) {
  const prod = await t.one(`SELECT id, name, type, unit, sale_price FROM products WHERE id=$1 AND company_id=$2`, [UUID.test(productId) ? productId : null, C], "الصنف غير موجود");
  const all = await loadAll(t, C);
  const n = all.nodes.get(prod.id);
  const isPrep = prod.type === "STOCK";
  const lines = (n?.lines || []).map((l) => { const i = all.infos.get(l.componentId)!, cn = all.nodes.get(l.componentId), uc = unitCost(all, l.componentId);
    return { componentId: l.componentId, name: i.name, sku: i.sku, unit: i.unit, qty: l.qty, wastePct: l.wastePct, usedQty: Math.round(l.used * 10000) / 10000, unitCost: Math.round(uc * 10000) / 10000, cost: r2(l.used * uc), onHand: r3(i.onHand), kind: cn ? (cn.method === "BATCH" ? "PREP_BATCH" : "PREP_DIRECT") : "RAW" }; });
  const output = n ? n.output : 1;
  const batchCost = r2(lines.reduce((s: number, l: any) => s + l.usedQty * l.unitCost, 0));
  const cost = isPrep ? Math.round((batchCost / output) * 10000) / 10000 : batchCost;
  const price = Number(prod.salePrice || 0);
  const inputTotal = r3(lines.reduce((s: number, l: any) => s + l.qty, 0));
  let canMake: number | null = null;
  if (n) { const need = explode(all, prod.id, 1); canMake = Math.max(0, Math.floor(Math.min(...[...need.entries()].map(([id, q]) => (all.infos.get(id)?.onHand || 0) / q)))); }
  return { productId: prod.id, name: prod.name, type: prod.type, unit: prod.unit, isPrep, canHaveRecipe: true, lines, cost: isPrep ? cost : batchCost, batchCost, outputQty: output, inputTotal, yieldPct: isPrep && inputTotal > 0 ? r2((output / inputTotal) * 100) : null,
    method: isPrep ? (n?.method || "DIRECT") : null, onHand: isPrep ? r3(all.infos.get(prod.id)?.onHand || 0) : null, stockCost: isPrep ? all.infos.get(prod.id)?.avg ?? null : null,
    salePrice: price, margin: !isPrep && price > 0 ? r2(price - batchCost) : null, marginPct: !isPrep && price > 0 ? r2(((price - batchCost) / price) * 100) : null, canMake };
}

export async function saveRecipe(t: Db, C: string, productId: string, b: any) {
  const prod = await t.one(`SELECT id, name, type FROM products WHERE id=$1 AND company_id=$2 FOR UPDATE`, [UUID.test(productId) ? productId : null, C], "الصنف غير موجود");
  const lines: any[] = Array.isArray(b?.lines) ? b.lines : [];
  const isPrep = prod.type === "STOCK";
  if (lines.length > 60) throw bad("الوصفة لا تزيد عن 60 مكوناً");
  const seen = new Set<string>();
  for (const l of lines) {
    if (!UUID.test(String(l.componentId))) throw bad("اختر المكوّن");
    if (l.componentId === prod.id) throw bad("الصنف لا يكون مكوناً لنفسه");
    if (seen.has(l.componentId)) throw bad("المكوّن مكرر في الوصفة");
    seen.add(l.componentId);
    if (!(num(l.qty) > 0)) throw bad("كمية المكوّن يجب أن تكون أكبر من صفر");
    if (num(l.wastePct) < 0 || num(l.wastePct) > 90) throw bad("نسبة الهالك بين 0 و90%");
    const c = await t.maybe(`SELECT type, name FROM products WHERE id=$1 AND company_id=$2`, [l.componentId, C]);
    if (!c) throw bad("المكوّن غير موجود");
    if (c.type !== "STOCK") throw bad(`المكوّن «${c.name}» ليس صنفاً مخزنياً`);
  }
  // a recipe must not contain itself through its preparations
  const all = await loadAll(t, C);
  const reaches = (id: string, depth = 0): boolean => depth > 8 || id === prod.id || (all.nodes.get(id)?.lines || []).some((x) => reaches(x.componentId, depth + 1));
  for (const l of lines) if (reaches(l.componentId)) throw bad("الوصفة تدور على نفسها: أحد المكونات يحتوي هذا الصنف في وصفته");
  const output = isPrep ? Math.round(num(b.outputQty) * 10000) / 10000 : 1;
  const method = isPrep && b.method === "BATCH" ? "BATCH" : "DIRECT";
  if (isPrep && lines.length && !(output > 0)) throw bad("اكتب ناتج الوصفة: كم تعطي الطبخة الواحدة من هذا الصنف");
  if (isPrep && lines.length && method === "DIRECT") {
    const bal = await t.one(`SELECT COALESCE(SUM(qty),0) q FROM stock_balances WHERE company_id=$1 AND product_id=$2`, [C, prod.id]);
    if (Math.abs(Number(bal.q)) > 0.0005) throw bad(`للصنف رصيد في المخزون (${r3(Number(bal.q))}): طريقة الخصم المباشر تكون لتحضيرة لا تُخزَّن. استهلك الرصيد أو سوِّه بالجرد أولاً، أو اختر طريقة الطبخة`);
  }
  await t.exec(`DELETE FROM product_recipes WHERE product_id=$1 AND company_id=$2`, [prod.id, C]);
  await t.exec(`DELETE FROM recipe_headers WHERE product_id=$1`, [prod.id]);
  let i = 0;
  for (const l of lines) await t.exec(`INSERT INTO product_recipes (company_id, product_id, component_id, qty, sort, waste_pct) VALUES ($1,$2,$3,$4,$5,$6)`, [C, prod.id, l.componentId, Math.round(num(l.qty) * 10000) / 10000, i++, Math.round(num(l.wastePct) * 100) / 100]);
  if (isPrep && lines.length) await t.exec(`INSERT INTO recipe_headers (product_id, company_id, output_qty, method) VALUES ($1,$2,$3,$4)`, [prod.id, C, output, method]);
  return getRecipe(t, C, prod.id);
}

/** What a sale of each given product takes from stock through its recipe: productId → [{componentId, qty per unit sold, name, purchasePrice}] */
export async function recipesOf(t: Db, C: string, productIds: string[]) {
  const out = new Map<string, any[]>();
  if (!productIds.length) return out;
  const any = await t.maybe(`SELECT 1 FROM product_recipes WHERE company_id=$1 AND product_id = ANY($2::uuid[]) LIMIT 1`, [C, productIds]);
  if (!any) return out;
  const all = await loadAll(t, C);
  for (const id of new Set(productIds)) {
    if (!exploded(all.nodes.get(id))) continue;
    out.set(id, [...explode(all, id, 1).entries()].map(([cid, q]) => ({ componentId: cid, qty: q, name: all.infos.get(cid)?.name || "", purchasePrice: unitCost(all, cid) })));
  }
  return out;
}

/** Stock items an add-on option takes, exploded through direct-method preparations down to what is actually in the warehouse. */
export async function leavesOf(t: Db, C: string, items: { componentId: string; qty: number }[]) {
  if (!items.length) return [] as any[];
  const all = await loadAll(t, C);
  const acc = new Map<string, number>();
  for (const it of items) { if (exploded(all.nodes.get(it.componentId))) explode(all, it.componentId, it.qty, acc); else acc.set(it.componentId, (acc.get(it.componentId) || 0) + it.qty); }
  const ids = [...acc.keys()].filter((id) => !all.infos.has(id));
  const extra = ids.length ? await t.rows(`SELECT id, name, purchase_price FROM products WHERE company_id=$1 AND id = ANY($2::uuid[])`, [C, ids]) : [];
  const nm = new Map(extra.map((x: any) => [x.id, x]));
  return [...acc.entries()].map(([id, q]) => ({ componentId: id, qty: q, name: all.infos.get(id)?.name || (nm.get(id) as any)?.name || "", purchasePrice: all.infos.has(id) ? unitCost(all, id) : Number((nm.get(id) as any)?.purchasePrice || 0) }));
}

/**
 * Cost of a dish in each of its sizes and with each of its add-ons: a size multiplies the recipe (factor), an add-on
 * takes its own ingredient. Price = the dish price + the option's extra price.
 */
export async function variantCosts(t: Db, C: string, productId: string) {
  const r = await getRecipe(t, C, productId);
  const prod = await t.one(`SELECT category_id FROM products WHERE id=$1`, [productId]);
  const groups = await t.rows(`SELECT name, options FROM modifier_groups WHERE company_id=$1 AND is_active AND ($2 = ANY(product_ids) OR $3::uuid = ANY(category_ids)) ORDER BY sort, name`, [C, productId, prod.categoryId]);
  const all = await loadAll(t, C);
  const rows: any[] = [];
  for (const g of groups) for (const o of (g.options || []) as any[]) {
    if (o.active === false) continue;
    const f = Number(o.factor) > 0 ? Number(o.factor) : 1;
    let compCost = 0, compName: string | null = null;
    if (o.componentId) { const i = all.infos.get(o.componentId) || (await t.maybe(`SELECT name, purchase_price, (SELECT SUM(b.value)/NULLIF(SUM(b.qty),0) FROM stock_balances b WHERE b.product_id=p.id AND b.qty>0) avg FROM products p WHERE p.id=$1 AND p.company_id=$2`, [o.componentId, C])); if (i) { compName = i.name; compCost = Number(o.componentQty) * (all.infos.has(o.componentId) ? unitCost(all, o.componentId) : Number((i as any).avg ?? (i as any).purchasePrice ?? 0)); } }
    const isSize = f !== 1;
    const cost = isSize ? r2(r.batchCost * f + compCost) : r2(compCost);
    const price = isSize ? r2(r.salePrice + Number(o.price || 0)) : r2(Number(o.price || 0));
    rows.push({ group: g.name, option: o.name, kind: isSize ? "SIZE" : "ADDON", factor: f, component: compName, componentQty: o.componentId ? Number(o.componentQty) : null, extraPrice: Number(o.price || 0), cost, price, margin: r2(price - cost), marginPct: price > 0 ? r2(((price - cost) / price) * 100) : null, costPct: price > 0 ? r2((cost / price) * 100) : null });
  }
  return { productId, name: r.name, baseCost: r.batchCost, basePrice: r.salePrice, baseCostPct: r.salePrice > 0 ? r2((r.batchCost / r.salePrice) * 100) : null, rows };
}

/**
 * Food cost report: what each dish (and each size of it) sold for and what it took out of the warehouse, the food cost
 * percentage against a target, the trend by day, and where the ingredients went (sold, produced, wasted or adjusted).
 */
export async function foodCost(t: Db, C: string, q: { from?: string; to?: string }) {
  const to = isDate(q.to) ? String(q.to) : today(); const from = isDate(q.from) ? String(q.from) : to.slice(0, 8) + "01";
  const co = await t.one(`SELECT COALESCE((accounting->'pos'->>'foodCostTarget')::numeric, 30) target FROM companies WHERE id=$1`, [C]);
  const lines = await t.rows(
    `SELECT l.product_id id, p.name, COALESCE(c.name,'بلا تصنيف') category, l.description, i.kind,
            l.qty * COALESCE(l.factor,1) qty, l.net_amount * COALESCE(i.exchange_rate,1) net, l.qty * COALESCE(l.factor,1) * l.unit_cost cost, i.date, i.channel
       FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id JOIN products p ON p.id=l.product_id LEFT JOIN product_categories c ON c.id=p.category_id
      WHERE i.company_id=$1 AND i.direction='SALE' AND i.status='POSTED' AND i.kind IN ('INVOICE','CREDIT_NOTE') AND i.date BETWEEN $2 AND $3
        AND (EXISTS (SELECT 1 FROM product_recipes r WHERE r.product_id=l.product_id) OR l.modifiers IS NOT NULL)`, [C, from, to]);
  const dishes = new Map<string, any>(), days = new Map<string, any>(), cats = new Map<string, any>();
  let revenue = 0, cost = 0;
  for (const l of lines) {
    const sg = l.kind === "CREDIT_NOTE" ? -1 : 1, net = sg * Number(l.net), cst = l.kind === "INVOICE" ? Number(l.cost) : 0, qty = sg * Number(l.qty);
    const variant = String(l.description || "").startsWith(l.name) ? String(l.description).slice(l.name.length).replace(/^\s*\(|\)\s*$/g, "").trim() : "";
    const key = l.id + "|" + variant;
    const d = dishes.get(key) || { productId: l.id, name: l.name, variant, category: l.category, qty: 0, revenue: 0, cost: 0 }; d.qty += qty; d.revenue += net; d.cost += cst; dishes.set(key, d);
    const dk = iso(l.date); const dy = days.get(dk) || { date: dk, revenue: 0, cost: 0 }; dy.revenue += net; dy.cost += cst; days.set(dk, dy);
    const ck = cats.get(l.category) || { category: l.category, revenue: 0, cost: 0 }; ck.revenue += net; ck.cost += cst; cats.set(l.category, ck);
    revenue += net; cost += cst;
  }
  const pct = (c: number, r: number) => (r > 0 ? r2((c / r) * 100) : null);
  const fin = (x: any) => ({ ...x, qty: r3(x.qty ?? 0), revenue: r2(x.revenue), cost: r2(x.cost), profit: r2(x.revenue - x.cost), costPct: pct(x.cost, x.revenue), unitCost: x.qty > 0 ? r2(x.cost / x.qty) : null, unitPrice: x.qty > 0 ? r2(x.revenue / x.qty) : null });
  const dishRows = [...dishes.values()].map(fin).sort((a, b) => b.revenue - a.revenue);
  for (const d of dishRows) d.level = d.costPct === null ? "none" : d.costPct <= Number(co.target) ? "good" : d.costPct <= Number(co.target) + 8 ? "watch" : "high";
  // where the ingredients went, from the stock card
  const mv = await t.rows(
    `SELECT p.id, p.name, p.unit,
            -COALESCE(SUM(m.qty) FILTER (WHERE m.source_type IN ('SALE','POS')),0) sold_qty, -COALESCE(SUM(m.value) FILTER (WHERE m.source_type IN ('SALE','POS')),0) sold_val,
            -COALESCE(SUM(m.qty) FILTER (WHERE m.source_type='PRODUCTION' AND m.qty < 0),0) cooked_qty, -COALESCE(SUM(m.value) FILTER (WHERE m.source_type='PRODUCTION' AND m.qty < 0),0) cooked_val,
            COALESCE(SUM(m.qty) FILTER (WHERE m.source_type='PRODUCTION' AND m.qty > 0),0) made_qty,
            -COALESCE(SUM(m.qty) FILTER (WHERE m.source_type NOT IN ('SALE','POS','PRODUCTION','PRODUCTION_CANCEL','PURCHASE','PURCHASE_RETURN','SALE_RETURN','TRANSFER','OPENING') AND m.qty < 0),0) lost_qty,
            -COALESCE(SUM(m.value) FILTER (WHERE m.source_type NOT IN ('SALE','POS','PRODUCTION','PRODUCTION_CANCEL','PURCHASE','PURCHASE_RETURN','SALE_RETURN','TRANSFER','OPENING') AND m.qty < 0),0) lost_val,
            COALESCE(SUM(m.qty) FILTER (WHERE m.source_type='PURCHASE'),0) bought_qty, COALESCE(SUM(m.value) FILTER (WHERE m.source_type='PURCHASE'),0) bought_val,
            (SELECT COALESCE(SUM(b.qty),0) FROM stock_balances b WHERE b.product_id=p.id) on_hand
       FROM stock_moves m JOIN products p ON p.id=m.product_id
      WHERE m.company_id=$1 AND m.date BETWEEN $2 AND $3
        AND (p.id IN (SELECT component_id FROM product_recipes WHERE company_id=$1) OR p.id IN (SELECT product_id FROM product_recipes WHERE company_id=$1)
             OR EXISTS (SELECT 1 FROM modifier_groups g, jsonb_array_elements(g.options) o WHERE g.company_id=$1 AND o->>'componentId' = p.id::text))
      GROUP BY p.id ORDER BY 5 DESC`, [C, from, to]);
  // ::numeric text → number; signs: issues are stored negative in stock_moves
  const ingredients = mv.map((x: any) => ({ productId: x.id, name: x.name, unit: x.unit, soldQty: r3(Number(x.soldQty)), soldValue: r2(Number(x.soldVal)), cookedQty: r3(Number(x.cookedQty)), cookedValue: r2(Number(x.cookedVal)), madeQty: r3(Number(x.madeQty)), lostQty: r3(Number(x.lostQty)), lostValue: r2(Number(x.lostVal)), boughtQty: r3(Number(x.boughtQty)), boughtValue: r2(Number(x.boughtVal)), onHand: r3(Number(x.onHand)) }));
  const waste = r2(ingredients.reduce((s: number, x: any) => s + x.lostValue, 0));
  const batches = await t.one(`SELECT COUNT(*)::int n, COALESCE(SUM(expected_qty),0) exp, COALESCE(SUM(output_qty),0) out FROM prep_batches WHERE company_id=$1 AND status='POSTED' AND date BETWEEN $2 AND $3`, [C, from, to]);
  return { from, to, target: Number(co.target),
    totals: { revenue: r2(revenue), cost: r2(cost), profit: r2(revenue - cost), costPct: pct(cost, revenue), waste, wastePct: pct(waste, revenue), costWithWastePct: pct(cost + waste, revenue), dishes: dishRows.length, batches: batches.n, yieldVsStandardPct: Number(batches.exp) > 0 ? r2((Number(batches.out) / Number(batches.exp)) * 100) : null },
    dishes: dishRows, categories: [...cats.values()].map(fin).sort((a, b) => b.revenue - a.revenue), days: [...days.values()].map(fin).sort((a, b) => a.date.localeCompare(b.date)), ingredients };
}

/** Dishes (non-stock items with a recipe), with today's cost and margin. */
export async function recipeList(t: Db, C: string) {
  const ids = await t.rows(`SELECT DISTINCT r.product_id id FROM product_recipes r JOIN products p ON p.id=r.product_id WHERE r.company_id=$1 AND p.type <> 'STOCK'`, [C]);
  const rows: any[] = [];
  for (const x of ids) { const r = await getRecipe(t, C, x.id); rows.push({ productId: r.productId, name: r.name, components: r.lines.length, cost: r.cost, salePrice: r.salePrice, margin: r.margin, marginPct: r.marginPct, canMake: r.canMake }); }
  rows.sort((a, b) => a.name.localeCompare(b.name, "ar"));
  return { rows };
}

/** Preparations (stock items with a recipe). */
export async function prepList(t: Db, C: string) {
  const ids = await t.rows(`SELECT DISTINCT r.product_id id FROM product_recipes r JOIN products p ON p.id=r.product_id WHERE r.company_id=$1 AND p.type = 'STOCK'`, [C]);
  const rows: any[] = [];
  for (const x of ids) { const r = await getRecipe(t, C, x.id); rows.push({ productId: r.productId, name: r.name, unit: r.unit, method: r.method, components: r.lines.length, inputTotal: r.inputTotal, outputQty: r.outputQty, yieldPct: r.yieldPct, cost: r.cost, stockCost: r.stockCost, onHand: r.onHand, canMake: r.canMake }); }
  rows.sort((a, b) => a.name.localeCompare(b.name, "ar"));
  return { rows };
}

// ── production batches (الطبخات) ──
async function batchPlan(t: Db, C: string, b: any) {
  const all = await loadAll(t, C);
  const n = all.nodes.get(String(b.productId));
  if (!n || n.type !== "STOCK") throw bad("اختر تحضيرة لها وصفة (صنف مخزني بمكونات)");
  if (n.method !== "BATCH") throw bad(`«${n.name}» على طريقة الخصم المباشر: لا تُنتَج للمخزون. غيّر طريقتها إلى «الطبخة» من وصفتها إن أردت تصنيعها`);
  const inputStd = n.lines.reduce((s, l) => s + l.qty, 0);
  const factor = num(b.inputQty) > 0 ? num(b.inputQty) / inputStd : num(b.batches) > 0 ? num(b.batches) : 1;
  const expected = Math.round(n.output * factor * 10000) / 10000;
  const output = b.outputQty === undefined || b.outputQty === null || b.outputQty === "" ? expected : Math.round(num(b.outputQty) * 10000) / 10000;
  if (!(output > 0)) throw bad("الناتج الفعلي يجب أن يكون أكبر من صفر");
  const need = new Map<string, number>();
  for (const l of n.lines) { const q = l.used * factor; if (exploded(all.nodes.get(l.componentId))) explode(all, l.componentId, q, need); else need.set(l.componentId, (need.get(l.componentId) || 0) + q); }
  const lines = [...need.entries()].map(([id, q]) => { const i = all.infos.get(id)!; return { componentId: id, name: i.name, unit: i.unit, qty: r3(q), onHand: r3(i.onHand), unitCost: Math.round(unitCost(all, id) * 10000) / 10000, cost: r2(q * unitCost(all, id)), short: i.onHand + 1e-9 < q }; });
  const cost = r2(lines.reduce((s, l) => s + l.cost, 0));
  return { all, node: n, productId: n.id, name: n.name, unit: all.infos.get(n.id)?.unit, inputQty: r3(inputStd * factor), inputStd: r3(inputStd), factor, expectedQty: expected, outputQty: output, yieldPct: r2((output / (inputStd * factor)) * 100), standardYieldPct: r2((n.output / inputStd) * 100), lines, cost, unitCost: Math.round((cost / output) * 10000) / 10000, standardUnitCost: Math.round((cost / expected) * 10000) / 10000 };
}
export async function batchPreview(t: Db, C: string, b: any) { const { all, node, ...p } = await batchPlan(t, C, b); return p; }

export async function createBatch(t: Db, C: string, user: string, b: any, opts: { isDemo?: boolean } = {}) {
  const date = isDate(b.date) ? String(b.date) : today();
  await assertOpenDate(t, C, date);
  const plan = await batchPlan(t, C, b);
  const co = await t.one(`SELECT allow_negative_stock FROM companies WHERE id=$1`, [C]);
  const wh = UUID.test(String(b.warehouseId)) ? (await t.one(`SELECT id FROM warehouses WHERE id=$1 AND company_id=$2`, [b.warehouseId, C], "المستودع غير موجود")).id : (await t.one(`SELECT id FROM warehouses WHERE company_id=$1 ORDER BY is_default DESC, code LIMIT 1`, [C])).id;
  const number = await nextNumber(t, C, "PRD", date);
  const row = await t.insert("prep_batches", { companyId: C, number, date, productId: plan.productId, warehouseId: wh, inputQty: plan.inputQty, expectedQty: plan.expectedQty, outputQty: plan.outputQty, cost: 0, lines: "[]", notes: b.notes ? String(b.notes).slice(0, 300) : null, createdBy: user, isDemo: !!opts.isDemo });
  let cost = 0; const used: any[] = [];
  for (const l of plan.lines) {
    const c = await stockOut(t, C, { productId: l.componentId, warehouseId: wh, qty: l.qty, date, sourceType: "PRODUCTION", sourceId: row.id, reference: number, isDemo: !!opts.isDemo, allowNegative: !!co.allowNegativeStock, fallbackCost: l.unitCost, productName: l.name });
    cost = r2(cost + c); used.push({ componentId: l.componentId, name: l.name, unit: l.unit, qty: l.qty, cost: c });
  }
  // the preparation enters stock at exactly what left it: inventory value is unchanged, so no journal entry is needed
  await stockIn(t, C, { productId: plan.productId, warehouseId: wh, qty: plan.outputQty, date, sourceType: "PRODUCTION", sourceId: row.id, reference: number, isDemo: !!opts.isDemo, value: cost, lotNo: number });
  await t.exec(`UPDATE prep_batches SET cost=$2, lines=$3 WHERE id=$1`, [row.id, cost, JSON.stringify(used)]);
  return { ...row, cost, lines: used, name: plan.name, unit: plan.unit, expectedQty: plan.expectedQty, outputQty: plan.outputQty, yieldPct: plan.yieldPct, standardYieldPct: plan.standardYieldPct, unitCost: Math.round((cost / plan.outputQty) * 10000) / 10000 };
}

export async function listBatches(t: Db, C: string) {
  const rows = await t.rows(`SELECT b.*, p.name, p.unit FROM prep_batches b JOIN products p ON p.id=b.product_id WHERE b.company_id=$1 ORDER BY b.date DESC, b.created_at DESC LIMIT 300`, [C]);
  return { rows: rows.map((r: any) => ({ ...r, date: iso(r.date), inputQty: Number(r.inputQty), expectedQty: Number(r.expectedQty), outputQty: Number(r.outputQty), cost: Number(r.cost), unitCost: Math.round((Number(r.cost) / Number(r.outputQty)) * 10000) / 10000, yieldPct: r2((Number(r.outputQty) / Number(r.inputQty)) * 100), variance: r3(Number(r.outputQty) - Number(r.expectedQty)) })) };
}

export async function cancelBatch(t: Db, C: string, user: string, id: string) {
  const bt = await t.one(`SELECT b.*, p.name FROM prep_batches b JOIN products p ON p.id=b.product_id WHERE b.id=$1 AND b.company_id=$2 FOR UPDATE OF b`, [UUID.test(id) ? id : null, C], "الطبخة غير موجودة");
  if (bt.status !== "POSTED") throw conflict("الطبخة ملغاة من قبل");
  const date = today();
  await assertOpenDate(t, C, date);
  // the preparation must still be in stock; what it is worth now goes back to the ingredients in the batch's proportions
  const back = await stockOut(t, C, { productId: bt.productId, warehouseId: bt.warehouseId, qty: Number(bt.outputQty), date, sourceType: "PRODUCTION_CANCEL", sourceId: bt.id, reference: bt.number, isDemo: bt.isDemo, allowNegative: false, productName: bt.name });
  const ls: any[] = bt.lines || []; const total = ls.reduce((s, l) => s + Number(l.cost), 0); let rest = back;
  for (let i = 0; i < ls.length; i++) {
    const v = i === ls.length - 1 ? rest : r2(total > 0 ? (back * Number(ls[i].cost)) / total : back / ls.length); rest = r2(rest - v);
    await stockIn(t, C, { productId: ls[i].componentId, warehouseId: bt.warehouseId, qty: Number(ls[i].qty), date, sourceType: "PRODUCTION_CANCEL", sourceId: bt.id, reference: bt.number, isDemo: bt.isDemo, value: v, lotNo: "RETURN" });
  }
  await t.exec(`UPDATE prep_batches SET status='CANCELLED' WHERE id=$1`, [bt.id]);
  return { id: bt.id, number: bt.number, status: "CANCELLED" };
}

/**
 * Worked example for restaurants: a chicken shawarma from the raw materials to the sandwich, with both costing
 * methods side by side — the cooked meat on the batch method, the marinade and the garlic sauce on direct deduction.
 * Everything is flagged as sample data, so «حذف البيانات التجريبية» removes it.
 */
export async function seedShawarmaExample(t: Db, company: any, user: string, userId?: string) {
  const C = company.id;
  if (await t.maybe(`SELECT 1 FROM products WHERE company_id=$1 AND sku='EX-SW'`, [C])) throw conflict("مثال الشاورما محمَّل من قبل — تجده في تبويبي «الوصفات» و«التحضيرات»");
  const eg = BASE === "EGP";
  const sup = await t.insert("partners", { companyId: C, code: "EX-SUP", name: "مورد المطعم (مثال)", isSupplier: true, isCustomer: false, kind: "COMPANY", vatNumber: eg ? "200000001" : "300000000000003", street: "طريق الملك فهد", buildingNo: "1234", district: "العليا", city: eg ? "القاهرة" : "الرياض", postalCode: "12211", phone: "0501234567", isDemo: true });
  const mk = (sku: string, name: string, unit: string, price: number, type = "STOCK", sale = 0) => t.insert("products", { companyId: C, sku, name, type, unit, salePrice: sale, purchasePrice: price, taxCode: "S", isActive: true, isDemo: true });
  const chicken = await mk("EX-CK", "صدور دجاج (مثال)", "كجم", 20), spice = await mk("EX-SP", "بهارات شاورما (مثال)", "كجم", 40), yog = await mk("EX-YG", "زبادي (مثال)", "كجم", 8), oil = await mk("EX-OL", "زيت نباتي (مثال)", "كجم", 10);
  const garlic = await mk("EX-GR", "ثوم (مثال)", "كجم", 12), bread = await mk("EX-BD", "خبز صاج (مثال)", "حبة", 0.5), pickle = await mk("EX-PK", "مخلل (مثال)", "كجم", 6);
  const marin = await mk("EX-MR", "شاورما دجاج متبّلة — وصفة أولية (مثال)", "كجم", 0), cooked = await mk("EX-CKD", "شاورما دجاج مطبوخة — وصفة نهائية (مثال)", "كجم", 0), toum = await mk("EX-TM", "ثومية (مثال)", "كجم", 0);
  const sand = await mk("EX-SW", "ساندوتش شاورما دجاج (مثال)", "حبة", 0, "SERVICE", 15);
  const d = await saveDraft(t, company, user, { direction: "PURCHASE", kind: "INVOICE", date: today(), partnerId: sup.id, supplierRef: "EX-1001", isDemo: true,
    lines: [[chicken, 100, 20], [spice, 10, 40], [yog, 20, 8], [oil, 30, 10], [garlic, 10, 12], [bread, 500, 0.5], [pickle, 10, 6]].map(([p, q, pr]: any) => ({ productId: p.id, qty: q, unitPrice: pr, taxCode: "S" })) } as any);
  await postInvoice(t, company, d.id, user);
  await saveRecipe(t, C, marin.id, { outputQty: 12, method: "DIRECT", lines: [{ componentId: chicken.id, qty: 10 }, { componentId: spice.id, qty: 0.5 }, { componentId: yog.id, qty: 1 }, { componentId: oil.id, qty: 0.5 }] });
  await saveRecipe(t, C, cooked.id, { outputQty: 7.8, method: "BATCH", lines: [{ componentId: marin.id, qty: 12 }] });
  await saveRecipe(t, C, toum.id, { outputQty: 3, method: "DIRECT", lines: [{ componentId: garlic.id, qty: 1 }, { componentId: oil.id, qty: 2 }] });
  await saveRecipe(t, C, sand.id, { lines: [{ componentId: cooked.id, qty: 0.12 }, { componentId: toum.id, qty: 0.03 }, { componentId: bread.id, qty: 1 }, { componentId: pickle.id, qty: 0.02 }] });
  const batch = await createBatch(t, C, user, { productId: cooked.id, inputQty: 24, outputQty: 15, notes: "مثال: سيخ 24 كجم خرج منه 15 كجم بدل 15.6" }, { isDemo: true });
  // sizes and an add-on, so each size has its own cost: a double takes 1.6 × the recipe; extra garlic sauce takes 20 g of it
  const size = await saveGroup(t, C, { name: "حجم الساندوتش (مثال)", minSelect: 1, maxSelect: 1, productIds: [sand.id], options: [{ name: "عادي", price: 0 }, { name: "دبل", price: 6, factor: 1.6 }] });
  const extra = await saveGroup(t, C, { name: "إضافات الشاورما (مثال)", minSelect: 0, maxSelect: 2, productIds: [sand.id], options: [{ name: "ثومية إضافية", price: 1, componentId: toum.id, componentQty: 0.02 }, { name: "بدون مخلل", price: 0 }] });
  await t.exec(`UPDATE modifier_groups SET is_demo=true WHERE id = ANY($1::uuid[])`, [[size.id, extra.id]]);
  // a few till sales so the food-cost report has something to show
  if (userId) try {
    await t.savepoint(async () => {
      const u = { id: userId, name: user };
      const session = await openSession(t, C, u, 0);
      await t.exec(`UPDATE pos_sessions SET is_demo=true WHERE id=$1`, [session.id]);
      const O = (g: any, n: string) => g.options.find((o: any) => o.name === n).id;
      await posSale(t, company, u, { sessionId: session.id, isDemo: true, tenders: [{ method: "CASH", amount: null }], lines: [
        { productId: sand.id, qty: 30, unitPrice: 15, modifiers: [O(size, "عادي")] }, { productId: sand.id, qty: 12, unitPrice: 15, modifiers: [O(size, "دبل")] }, { productId: sand.id, qty: 8, unitPrice: 15, modifiers: [O(size, "عادي"), O(extra, "ثومية إضافية")] }] } as any);
      await closeSession(t, C, user, session.id, Number((await t.one(`SELECT cash_sales FROM pos_sessions WHERE id=$1`, [session.id])).cashSales), true);
    });
  } catch { /* the sample sales are optional (the user may have a till session open) */ }
  return { ok: true, sandwich: sand.id, cooked: cooked.id, batch: batch.number };
}

/**
 * Menu engineering (Kasavana & Smith): each dish is placed by how much it sells against how much each sale leaves.
 * Popular = its share of units is at least 70% of an equal share; profitable = its margin per unit is at least the
 * average margin per unit sold. Star (both), plowhorse (sells, thin margin), puzzle (good margin, sells little), dog (neither).
 */
export async function menuEngineering(t: Db, C: string, q: { days?: number }) {
  const days = Math.min(365, Math.max(7, Math.round(num(q.days) || 30)));
  const sold = await t.rows(
    `SELECT l.product_id id, SUM(l.qty * COALESCE(l.factor,1) * CASE WHEN i.kind='CREDIT_NOTE' THEN -1 ELSE 1 END) qty,
            SUM(l.net_amount * COALESCE(i.exchange_rate,1) * CASE WHEN i.kind='CREDIT_NOTE' THEN -1 ELSE 1 END) net,
            SUM(CASE WHEN i.kind='INVOICE' THEN l.qty * COALESCE(l.factor,1) * l.unit_cost ELSE 0 END) cost
       FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id
      WHERE i.company_id=$1 AND i.direction='SALE' AND i.status='POSTED' AND i.kind IN ('INVOICE','CREDIT_NOTE') AND i.date > CURRENT_DATE - $2::int
        AND l.product_id IN (SELECT product_id FROM product_recipes WHERE company_id=$1) GROUP BY l.product_id`, [C, days]);
  const by = new Map(sold.map((x: any) => [x.id, x]));
  const list = (await recipeList(t, C)).rows;
  const rows = list.map((r: any) => { const s: any = by.get(r.productId) || {}; const qty = r3(Number(s.qty || 0)), net = r2(Number(s.net || 0)), cost = r2(Number(s.cost || 0)); return { ...r, soldQty: qty, revenue: net, soldCost: cost, profit: r2(net - cost), unitMargin: qty > 0 ? r2((net - cost) / qty) : r.margin }; });
  const totalQty = rows.reduce((a: number, r: any) => a + Math.max(0, r.soldQty), 0), totalProfit = rows.reduce((a: number, r: any) => a + r.profit, 0);
  const popLine = rows.length ? (totalQty / rows.length) * 0.7 : 0, avgMargin = totalQty > 0 ? totalProfit / totalQty : 0;
  for (const r of rows) {
    const pop = totalQty > 0 && r.soldQty >= popLine - 1e-9 && r.soldQty > 0, prof = Number(r.unitMargin || 0) >= avgMargin - 1e-9;
    r.sharePct = totalQty > 0 ? r2((Math.max(0, r.soldQty) / totalQty) * 100) : 0;
    r.klass = totalQty <= 0 ? "NEW" : pop && prof ? "STAR" : pop ? "PLOWHORSE" : prof ? "PUZZLE" : "DOG";
    r.advice = r.klass === "STAR" ? "حافظ عليه: مكانه البارز في القائمة وجودته كما هي" : r.klass === "PLOWHORSE" ? "يُباع كثيراً بهامش ضعيف: ارفع السعر قليلاً أو خفّض تكلفة الوصفة" : r.klass === "PUZZLE" ? "هامشه جيد ويُباع قليلاً: روّج له أو غيّر مكانه واسمه في القائمة" : r.klass === "DOG" ? "لا يُباع ولا يربح: راجع وجوده في القائمة" : "لا مبيعات في الفترة بعد";
  }
  rows.sort((a: any, b: any) => b.profit - a.profit);
  return { days, rows, totals: { qty: r3(totalQty), profit: r2(totalProfit), avgMargin: r2(avgMargin), popularityLine: r3(popLine) }, counts: { STAR: rows.filter((r: any) => r.klass === "STAR").length, PLOWHORSE: rows.filter((r: any) => r.klass === "PLOWHORSE").length, PUZZLE: rows.filter((r: any) => r.klass === "PUZZLE").length, DOG: rows.filter((r: any) => r.klass === "DOG").length } };
}

// ───────────────────────── supplier bank details + bank file ─────────────────────────
const cleanIban = (s: any) => String(s || "").replace(/\s+/g, "").toUpperCase();
/** ISO 13616 mod-97 check. */
export function ibanValid(raw: string) {
  const s = cleanIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  if (s.startsWith("SA") && s.length !== 24) return false;
  if (s.startsWith("EG") && s.length !== 29) return false;
  const re = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let m = 0; for (const ch of re) m = (m * 10 + Number(ch)) % 97;
  return m === 1;
}

export async function saveBank(t: Db, C: string, partnerId: string, b: any) {
  const p = await t.one(`SELECT id FROM partners WHERE id=$1 AND company_id=$2`, [UUID.test(partnerId) ? partnerId : null, C], "الطرف غير موجود");
  const iban = cleanIban(b?.iban);
  if (iban && !ibanValid(iban)) throw bad("رقم الآيبان غير صحيح — راجع الأرقام (خانتا التحقق لا تطابقان)");
  await t.exec(`UPDATE partners SET iban=$2, bank_name=$3, bank_beneficiary=$4 WHERE id=$1`, [p.id, iban || null, b?.bankName ? String(b.bankName).slice(0, 120) : null, b?.bankBeneficiary ? String(b.bankBeneficiary).slice(0, 160) : null]);
  return { id: p.id, iban: iban || null, bankName: b?.bankName || null, bankBeneficiary: b?.bankBeneficiary || null };
}

/** One transfer per supplier of an approved or posted run. Suppliers without an IBAN are listed, not exported. */
export async function bankFile(t: Db, C: string, runId: string) {
  const run: any = await getRun(t, C, runId);
  if (!["APPROVED", "POSTED"].includes(run.status)) throw conflict("ملف البنك يصدر بعد اعتماد الدفعة");
  const sup: any[] = run.suppliers || [];
  const info = await t.rows(`SELECT id, iban, bank_name, bank_beneficiary, name FROM partners WHERE company_id=$1 AND id = ANY($2::uuid[])`, [C, sup.map((s) => s.partnerId)]);
  const by = new Map(info.map((x: any) => [x.id, x]));
  const src = await t.maybe(`SELECT iban, name_ar FROM accounts WHERE id=$1`, [run.accountId]);
  const rows: any[] = [], missing: string[] = [];
  for (const s of sup) {
    const pi: any = by.get(s.partnerId) || {};
    const amount = s.netPaid !== null && s.netPaid !== undefined ? Number(s.netPaid) : Number(s.total);
    if (!pi.iban) { missing.push(s.partnerName); continue; }
    rows.push({ beneficiary: pi.bankBeneficiary || s.partnerName, iban: pi.iban, bank: pi.bankName || "", amount: r2(amount), currency: BASE, reference: run.number, details: s.invoices.map((i: any) => i.supplierRef || i.number).join(" ").slice(0, 140) });
  }
  const q = (v: any) => { const x = String(v ?? ""); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  const head = ["Beneficiary", "IBAN", "Bank", "Amount", "Currency", "Reference", "Details", "Debit IBAN", "Value date"];
  const csv = "﻿" + [head, ...rows.map((r) => [r.beneficiary, r.iban, r.bank, r.amount.toFixed(2), r.currency, r.reference, r.details, src?.iban || "", iso(run.payDate)])].map((a) => a.map(q).join(",")).join("\r\n") + "\r\n";
  // ISO 20022 customer credit transfer initiation (pain.001.001.03) — the format banks accept for bulk transfers
  const x = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const co = await t.one(`SELECT COALESCE(NULLIF(name_en,''), name_ar) AS name FROM companies WHERE id=$1`, [C]);
  const total = r2(rows.reduce((s, r) => s + r.amount, 0));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
 <CstmrCdtTrfInitn>
  <GrpHdr><MsgId>${x(run.number)}</MsgId><CreDtTm>${new Date().toISOString().slice(0, 19)}</CreDtTm><NbOfTxs>${rows.length}</NbOfTxs><CtrlSum>${total.toFixed(2)}</CtrlSum><InitgPty><Nm>${x(co.name).slice(0, 70)}</Nm></InitgPty></GrpHdr>
  <PmtInf><PmtInfId>${x(run.number)}</PmtInfId><PmtMtd>TRF</PmtMtd><NbOfTxs>${rows.length}</NbOfTxs><CtrlSum>${total.toFixed(2)}</CtrlSum><ReqdExctnDt>${iso(run.payDate)}</ReqdExctnDt>
   <Dbtr><Nm>${x(co.name).slice(0, 70)}</Nm></Dbtr><DbtrAcct><Id>${src?.iban ? `<IBAN>${x(src.iban)}</IBAN>` : `<Othr><Id>NOTPROVIDED</Id></Othr>`}</Id></DbtrAcct><DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>
${rows.map((r, i) => `   <CdtTrfTxInf><PmtId><EndToEndId>${x(run.number)}-${i + 1}</EndToEndId></PmtId><Amt><InstdAmt Ccy="${x(r.currency)}">${r.amount.toFixed(2)}</InstdAmt></Amt><Cdtr><Nm>${x(r.beneficiary).slice(0, 70)}</Nm></Cdtr><CdtrAcct><Id><IBAN>${x(r.iban)}</IBAN></Id></CdtrAcct><RmtInf><Ustrd>${x(r.details || r.reference).slice(0, 140)}</Ustrd></RmtInf></CdtTrfTxInf>`).join("\n")}
  </PmtInf>
 </CstmrCdtTrfInitn>
</Document>
`;
  return { xml, xmlFilename: `${run.number}-pain001.xml`, number: run.number, status: run.status, count: rows.length, total: r2(rows.reduce((s, r) => s + r.amount, 0)), missing, debitIban: src?.iban || null, rows, csv, filename: `${run.number}-bank.csv` };
}
