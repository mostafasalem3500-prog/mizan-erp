/**
 * Modifiers (as in restaurant POS systems such as Foodics): priced add-ons chosen with a product — a size, extras,
 * «without onion». A group has options and a minimum/maximum number to choose (minimum 1 = required) and applies to
 * chosen products and/or whole categories. The price of the chosen options is added to the line's unit price, so the
 * revenue, the VAT and the tax invoice all carry it; what was chosen is kept on the line (names and prices as sold).
 *
 * Service charge: a percentage added to the bill of chosen order types (dine-in by default). It is a taxable line of
 * its own on the invoice (service revenue), computed by the server from the restaurant settings.
 */
import { randomUUID } from "crypto";
import { Db } from "../db/pool";
import { bad, num, r2 } from "../lib/core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ids = (x: any) => (Array.isArray(x) ? [...new Set(x.filter((v: any) => UUID.test(String(v || ""))))] as string[] : []);
/** factor: multiplies the dish's recipe (a large size = 1.5); componentId/componentQty: a stock ingredient this option adds per unit sold */
export type Option = { id: string; name: string; price: number; active: boolean; factor?: number; componentId?: string | null; componentQty?: number; componentName?: string };
export type Chosen = { groupId: string; group: string; optionId: string; name: string; price: number; factor?: number; componentId?: string | null; componentQty?: number };

const shape = (g: any) => ({ id: g.id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, options: (g.options || []) as Option[], productIds: g.productIds || [], categoryIds: g.categoryIds || [], isActive: g.isActive, sort: g.sort });

export async function listGroups(t: Db, C: string, activeOnly = false) {
  const rows = await t.rows(`SELECT * FROM modifier_groups WHERE company_id=$1 ${activeOnly ? "AND is_active" : ""} ORDER BY sort, created_at`, [C]);
  return rows.map(shape).map((g) => (activeOnly ? { ...g, options: g.options.filter((o) => o.active !== false) } : g));
}

export async function saveGroup(t: Db, C: string, b: any, id?: string) {
  const name = String(b?.name || "").trim().slice(0, 60);
  if (!name) throw bad("اسم مجموعة الإضافات مطلوب");
  const minSelect = Math.max(0, Math.round(num(b.minSelect)));
  const maxSelect = Math.max(1, Math.round(num(b.maxSelect) || 1));
  if (maxSelect < minSelect) throw bad("الحد الأقصى للاختيار أقل من الحد الأدنى");
  const raw = Array.isArray(b.options) ? b.options : [];
  if (!raw.length) throw bad("أضف خياراً واحداً على الأقل");
  if (raw.length > 40) throw bad("حتى 40 خياراً في المجموعة");
  const seen = new Set<string>();
  const options: Option[] = raw.map((o: any, i: number) => {
    const n = String(o?.name || "").trim().slice(0, 60);
    if (!n) throw bad(`اسم الخيار ${i + 1} مطلوب`);
    if (seen.has(n)) throw bad(`الخيار «${n}» مكرر`);
    seen.add(n);
    const price = r2(num(o.price));
    if (price < 0) throw bad(`سعر الخيار «${n}» لا يكون سالباً`);
    const factor = o.factor === undefined || o.factor === null || o.factor === "" ? 1 : Math.round(num(o.factor) * 1000) / 1000;
    if (!(factor >= 0.1 && factor <= 10)) throw bad(`معامل الوصفة للخيار «${n}» بين 0.1 و10`);
    const componentId = UUID.test(String(o.componentId || "")) ? String(o.componentId) : null;
    const componentQty = componentId ? Math.round(num(o.componentQty) * 10000) / 10000 : 0;
    if (componentId && !(componentQty > 0)) throw bad(`اكتب كمية المكوّن الذي يخصمه الخيار «${n}»`);
    return { id: UUID.test(String(o.id || "")) ? o.id : randomUUID(), name: n, price, active: o.active !== false, ...(factor !== 1 ? { factor } : {}), ...(componentId ? { componentId, componentQty } : {}) };
  });
  const compIds = [...new Set(options.map((o) => o.componentId).filter(Boolean))] as string[];
  if (compIds.length) { const ok = await t.rows(`SELECT id, name FROM products WHERE company_id=$1 AND type='STOCK' AND id = ANY($2::uuid[])`, [C, compIds]); if (ok.length !== compIds.length) throw bad("المكوّن الذي يخصمه الخيار يجب أن يكون صنفاً مخزنياً موجوداً"); for (const o of options) if (o.componentId) o.componentName = ok.find((x: any) => x.id === o.componentId)?.name; }
  if (minSelect > options.filter((o) => o.active).length) throw bad("الحد الأدنى للاختيار أكبر من عدد الخيارات المتاحة");
  const productIds = ids(b.productIds), categoryIds = ids(b.categoryIds);
  if (productIds.length) { const n = await t.one(`SELECT COUNT(*)::int c FROM products WHERE company_id=$1 AND id = ANY($2)`, [C, productIds]); if (n.c !== productIds.length) throw bad("أحد الأصناف غير موجود"); }
  if (categoryIds.length) { const n = await t.one(`SELECT COUNT(*)::int c FROM product_categories WHERE company_id=$1 AND id = ANY($2)`, [C, categoryIds]); if (n.c !== categoryIds.length) throw bad("أحد التصنيفات غير موجود"); }
  const pgArr = (a: string[]) => `{${a.join(",")}}`; // the insert helper would send a JS array as JSON
  const row = { name, minSelect, maxSelect, options: JSON.stringify(options), productIds: pgArr(productIds), categoryIds: pgArr(categoryIds), isActive: b.isActive !== false, sort: Math.round(num(b.sort)), updatedAt: new Date() };
  if (id) { await t.one(`SELECT id FROM modifier_groups WHERE id=$1 AND company_id=$2`, [UUID.test(id) ? id : null, C], "المجموعة غير موجودة"); return shape(await t.update("modifier_groups", { id, companyId: C }, row)); }
  const n = await t.one(`SELECT COUNT(*)::int c FROM modifier_groups WHERE company_id=$1`, [C]);
  if (n.c >= 200) throw bad("الحد 200 مجموعة إضافات");
  return shape(await t.insert("modifier_groups", { companyId: C, ...row }));
}

export async function deleteGroup(t: Db, C: string, id: string) {
  const r = await t.maybe(`DELETE FROM modifier_groups WHERE id=$1 AND company_id=$2 RETURNING id`, [UUID.test(id) ? id : null, C]);
  if (!r) throw bad("المجموعة غير موجودة");
  return { ok: true };
}

/** The groups that apply to a product: attached to it, or to its category. */
export const groupsFor = (groups: ReturnType<typeof shape>[], p: { id: string; categoryId?: string | null }) =>
  groups.filter((g) => g.isActive && (g.productIds.includes(p.id) || (!!p.categoryId && g.categoryIds.includes(p.categoryId))));

/**
 * Checks a line's chosen options against the product's groups (each option belongs to one of them, minimum and
 * maximum of each group respected) and returns them with the prices of the server — never the screen's.
 */
export function resolveChoice(groups: ReturnType<typeof shape>[], p: { id: string; name: string; categoryId?: string | null }, optionIds: any): Chosen[] {
  const mine = groupsFor(groups, p);
  const picked = Array.isArray(optionIds) ? optionIds.map(String) : [];
  if (picked.length > 60) throw bad("عدد الإضافات كبير");
  const out: Chosen[] = [];
  for (const oid of picked) {
    let hit: Chosen | null = null;
    for (const g of mine) { const o = g.options.find((x) => x.id === oid && x.active !== false); if (o) { hit = { groupId: g.id, group: g.name, optionId: o.id, name: o.name, price: Number(o.price), ...(o.factor && o.factor !== 1 ? { factor: Number(o.factor) } : {}), ...(o.componentId ? { componentId: o.componentId, componentQty: Number(o.componentQty) } : {}) }; break; } }
    if (!hit) throw bad(`إضافة غير متاحة للصنف «${p.name}»`);
    if (out.some((x) => x.optionId === oid)) continue;
    out.push(hit);
  }
  for (const g of mine) {
    const n = out.filter((x) => x.groupId === g.id).length;
    if (n < g.minSelect) throw bad(`اختر ${g.minSelect === 1 ? "خياراً" : `${g.minSelect} خيارات`} من «${g.name}» للصنف «${p.name}»`);
    if (n > g.maxSelect) throw bad(`الحد ${g.maxSelect} من «${g.name}» للصنف «${p.name}»`);
  }
  return out;
}
export const choiceText = (c: Chosen[]) => c.map((x) => x.name + (x.price ? ` +${x.price}` : "")).join("، ");
export const choicePrice = (c: Chosen[]) => r2(c.reduce((a, x) => a + x.price, 0));

// ── service charge ─────────────────────────────────────────────────────────────────────
export type ServiceCharge = { pct: number; types: string[]; minGuests: number; label: string };
export function serviceSettings(company: any): ServiceCharge {
  const s = company.accounting?.pos?.serviceCharge || {};
  const types = Array.isArray(s.types) ? s.types.filter((x: any) => ["DINE_IN", "TAKEAWAY", "DELIVERY"].includes(x)) : ["DINE_IN"];
  return { pct: Math.min(30, Math.max(0, num(s.pct))), types, minGuests: Math.max(0, Math.round(num(s.minGuests))), label: String(s.label || "رسوم الخدمة").slice(0, 40) };
}
export function cleanService(b: any): ServiceCharge {
  const pct = num(b?.pct);
  if (pct < 0 || pct > 30) throw bad("نسبة رسوم الخدمة بين 0 و30%");
  return serviceSettings({ accounting: { pos: { serviceCharge: { pct, types: b?.types, minGuests: b?.minGuests, label: b?.label } } } });
}
/** Whether an order of this type and size carries the service charge. */
export const serviceApplies = (s: ServiceCharge, order: { type: string; guests: number } | null) =>
  !!order && s.pct > 0 && s.types.includes(order.type) && (!s.minGuests || num(order.guests) >= s.minGuests);

/** Modifiers sold in a period, and the service charge collected — for the restaurant report. */
export async function salesOfModifiers(t: Db, C: string, from: string, to: string) {
  const rows = await t.rows(
    `SELECT m->>'group' grp, m->>'name' name, SUM(l.qty * CASE WHEN i.kind='CREDIT_NOTE' THEN -1 ELSE 1 END)::numeric n,
            SUM(l.qty * (m->>'price')::numeric * (1 - l.discount_pct/100) * CASE WHEN i.kind='CREDIT_NOTE' THEN -1 ELSE 1 END) amount
       FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id, jsonb_array_elements(l.modifiers) m
      WHERE i.company_id=$1 AND i.direction='SALE' AND i.status='POSTED' AND i.date BETWEEN $2 AND $3 AND jsonb_typeof(l.modifiers)='array'
      GROUP BY 1,2 ORDER BY 4 DESC NULLS LAST LIMIT 60`, [C, from, to]);
  return rows.map((r) => ({ group: r.grp, name: r.name, qty: Number(r.n), amount: r2(Number(r.amount || 0)) }));
}
export async function serviceCollected(t: Db, C: string, from: string, to: string) {
  const r = await t.one(`SELECT COUNT(DISTINCT i.id)::int n, COALESCE(SUM(l.net_amount * CASE WHEN i.kind='CREDIT_NOTE' THEN -1 ELSE 1 END),0) net, COALESCE(SUM(l.vat_amount * CASE WHEN i.kind='CREDIT_NOTE' THEN -1 ELSE 1 END),0) vat
      FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id
     WHERE i.company_id=$1 AND i.direction='SALE' AND i.status='POSTED' AND i.date BETWEEN $2 AND $3 AND l.modifiers ? 'serviceCharge'`, [C, from, to]);
  return { invoices: r.n, net: r2(Number(r.net)), vat: r2(Number(r.vat)) };
}
