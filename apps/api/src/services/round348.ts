/**
 * 3.48.0
 *  • Kitchen stations (grill, drinks, desserts…): each station takes items by category (a main category brings its
 *    sub categories); the kitchen screen shows one station, a ticket prints per station, and each item's time from the
 *    hall to «ready» is logged for the kitchen performance report.
 *  • Ingredient purchase plan: what the kitchen actually consumed (stock card: sales, till and batches — so ingredients
 *    used through recipes count), days of cover left, and how much to buy to last the chosen days plus the supplier's
 *    lead time.
 */
import { randomUUID } from "crypto";
import { Db } from "../db/pool";
import { bad, num, r2, r3, isDate, today, addDays } from "../lib/core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type Station = { id: string; name: string; icon: string | null; categoryIds: string[] };

export async function stationsOf(t: Db, C: string): Promise<Station[]> {
  const r = await t.one(`SELECT accounting->'pos'->'stations' s FROM companies WHERE id=$1`, [C]);
  return Array.isArray(r.s) ? r.s : [];
}
export async function saveStations(t: Db, C: string, list: any) {
  const raw = Array.isArray(list) ? list : [];
  if (raw.length > 12) throw bad("حتى 12 محطة في المطبخ");
  const cats = new Set((await t.rows(`SELECT id FROM product_categories WHERE company_id=$1`, [C])).map((r: any) => r.id));
  const names = new Set<string>(); const taken = new Map<string, string>();
  const out: Station[] = raw.map((s: any) => {
    const name = String(s?.name || "").trim().slice(0, 40);
    if (!name) throw bad("اسم المحطة مطلوب");
    if (names.has(name)) throw bad(`المحطة «${name}» مكررة`);
    names.add(name);
    const categoryIds = [...new Set((Array.isArray(s.categoryIds) ? s.categoryIds : []).filter((x: any) => cats.has(String(x))))] as string[];
    for (const c of categoryIds) { if (taken.has(c)) throw bad(`التصنيف نفسه في محطتين: «${taken.get(c)}» و«${name}»`); taken.set(c, name); }
    return { id: UUID.test(String(s.id || "")) ? String(s.id) : randomUUID(), name, icon: s.icon ? Array.from(String(s.icon)).slice(0, 2).join("") : null, categoryIds };
  });
  await t.exec(`UPDATE companies SET accounting = jsonb_set(jsonb_set(COALESCE(accounting,'{}'::jsonb), '{pos}', COALESCE(accounting->'pos','{}'::jsonb)), '{pos,stations}', $2::jsonb) WHERE id=$1`, [C, JSON.stringify(out)]);
  return out;
}

/** product id → station (by its category or the nearest category above it that a station takes). */
export async function stationMap(t: Db, C: string, productIds: string[]) {
  const st = await stationsOf(t, C);
  const out = new Map<string, Station | null>();
  if (!st.length || !productIds.length) return { stations: st, of: (id: string) => out.get(id) || null };
  const cats = await t.rows(`SELECT id, parent_id FROM product_categories WHERE company_id=$1`, [C]);
  const parent = new Map(cats.map((c: any) => [c.id, c.parentId]));
  const byCat = new Map<string, Station>(); for (const s of st) for (const c of s.categoryIds) byCat.set(c, s);
  const prods = await t.rows(`SELECT id, category_id FROM products WHERE company_id=$1 AND id = ANY($2::uuid[])`, [C, [...new Set(productIds)].filter((x) => UUID.test(x))]);
  for (const p of prods) { let c = p.categoryId, n = 0, hit: Station | null = null; while (c && n++ < 6) { if (byCat.has(c)) { hit = byCat.get(c)!; break; } c = parent.get(c); } out.set(p.id, hit); }
  return { stations: st, of: (id: string) => out.get(id) || null };
}

/** Splits a kitchen ticket by station (items of no station go to «عام»). */
export async function splitTicket(t: Db, C: string, items: { productId?: string; name: string; qty: number; note?: string; cancel?: boolean }[]) {
  const m = await stationMap(t, C, items.map((i) => i.productId || "").filter(Boolean));
  if (!m.stations.length) return null;
  const groups = new Map<string, { station: string; icon: string | null; items: any[] }>();
  for (const i of items) { const s = i.productId ? m.of(i.productId) : null; const k = s?.id || "_"; if (!groups.has(k)) groups.set(k, { station: s?.name || "عام", icon: s?.icon || null, items: [] }); groups.get(k)!.items.push(i); }
  return [...groups.values()];
}

/** Kitchen performance: minutes from the hall to «ready», by station and by item, with the slow ones. */
export async function kitchenPerformance(t: Db, C: string, q: { from?: string; to?: string; late?: number }) {
  const to = isDate(q.to) ? String(q.to) : today(), from = isDate(q.from) ? String(q.from) : addDays(to, -6);
  const late = Math.max(1, Math.min(120, Math.round(num(q.late) || 15)));
  const agg = (k: string) => t.rows(`SELECT ${k} k, COUNT(*)::int n, SUM(qty) qty, AVG(minutes) avg, percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes) med, MAX(minutes) max, COUNT(*) FILTER (WHERE minutes > $4)::int late
      FROM kitchen_log WHERE company_id=$1 AND (ready_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY avg DESC`, [C, from, to, late]);
  const shape = (r: any) => ({ key: r.k || "عام", count: r.n, qty: r3(Number(r.qty)), avg: r2(Number(r.avg)), median: r2(Number(r.med)), max: r2(Number(r.max)), late: r.late, latePct: r.n ? r2((r.late / r.n) * 100) : 0 });
  const [byStation, byItem, all] = await Promise.all([agg("station"), agg("name"), agg("'*'")]);
  const slow = await t.rows(`SELECT order_no, name, station, qty, minutes, sent_at FROM kitchen_log WHERE company_id=$1 AND (ready_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2 AND $3 AND minutes > $4 ORDER BY minutes DESC LIMIT 15`, [C, from, to, late]);
  return { from, to, lateMinutes: late, totals: all[0] ? shape(all[0]) : null, byStation: byStation.map(shape), byItem: byItem.slice(0, 30).map(shape), slow: slow.map((r: any) => ({ orderNo: r.orderNo, name: r.name, station: r.station || "عام", qty: Number(r.qty), minutes: r2(Number(r.minutes)), sentAt: r.sentAt })) };
}

/**
 * Ingredient (and any stock item) purchase plan from what actually left the warehouse: sales and till issues plus
 * ingredients drawn into batches and through recipes, net of sales returns.
 */
export async function purchasePlan(t: Db, C: string, q: { cover?: number; lead?: number; history?: number; onlyRecipe?: string | boolean; categoryId?: string }) {
  const cover = Math.max(1, Math.min(120, Math.round(num(q.cover) || 7)));
  const lead = Math.max(0, Math.min(60, Math.round(num(q.lead) || 2)));
  const history = Math.max(7, Math.min(180, Math.round(num(q.history) || 28)));
  const onlyRecipe = q.onlyRecipe === true || q.onlyRecipe === "1";
  const rows = await t.rows(
    `WITH used AS (SELECT m.product_id, -SUM(m.qty) FILTER (WHERE m.source_type IN ('SALE','POS','SALE_RETURN') OR (m.source_type='PRODUCTION' AND m.qty < 0)) q
                     FROM stock_moves m WHERE m.company_id=$1 AND m.date > CURRENT_DATE - $2::int GROUP BY m.product_id),
          bal AS (SELECT product_id, SUM(qty) qty FROM stock_balances WHERE company_id=$1 GROUP BY product_id),
          onorder AS (SELECT l.product_id, SUM(l.qty*l.factor) q FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.company_id=$1 AND i.direction='PURCHASE' AND i.kind='ORDER' AND i.status='DRAFT' GROUP BY l.product_id),
          lastbuy AS (SELECT DISTINCT ON (l.product_id) l.product_id, i.partner_id, i.partner_name, l.unit_price/NULLIF(l.factor,0) price, i.date FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.company_id=$1 AND i.direction='PURCHASE' AND i.kind='INVOICE' AND i.status='POSTED' ORDER BY l.product_id, i.date DESC)
     SELECT p.id, p.sku, p.name, p.unit, p.purchase_price, p.reorder_level, COALESCE(c.name,'') category, COALESCE(u.q,0) used, COALESCE(b.qty,0) qty, COALESCE(o.q,0) on_order,
            lb.partner_id supplier_id, lb.partner_name supplier_name, lb.price last_price,
            EXISTS (SELECT 1 FROM product_recipes r WHERE r.component_id=p.id) in_recipe,
            EXISTS (SELECT 1 FROM product_recipes r WHERE r.product_id=p.id) is_prep
       FROM products p LEFT JOIN product_categories c ON c.id=p.category_id LEFT JOIN used u ON u.product_id=p.id LEFT JOIN bal b ON b.product_id=p.id LEFT JOIN onorder o ON o.product_id=p.id LEFT JOIN lastbuy lb ON lb.product_id=p.id
      WHERE p.company_id=$1 AND p.type='STOCK' AND p.is_active`, [C, history]);
  const out = rows.filter((r: any) => !onlyRecipe || r.inRecipe).filter((r: any) => !r.isPrep || true).map((r: any) => {
    const daily = Math.max(0, Number(r.used)) / history;
    const qty = Number(r.qty), onOrder = Number(r.onOrder);
    const coverDays = daily > 0 ? r2(qty / daily) : null;
    // a batch-made preparation is cooked in the kitchen, not bought: it is listed for its cover but never suggested for purchase
    const need = r.isPrep ? 0 : Math.max(0, daily * (cover + lead) - qty - onOrder, Number(r.reorderLevel) > 0 && qty + onOrder <= Number(r.reorderLevel) ? Number(r.reorderLevel) * 2 - qty - onOrder : 0);
    const suggested = need > 0 ? (r.unit && /حب|علب|كرتون|كيس|قطع|pc/i.test(r.unit) ? Math.ceil(need) : Math.ceil(need * 10) / 10) : 0;
    const price = Number(r.lastPrice ?? r.purchasePrice ?? 0);
    return { productId: r.id, sku: r.sku, name: r.name, unit: r.unit, category: r.category, inRecipe: r.inRecipe, isPrep: r.isPrep, used: r3(Number(r.used)), daily: Math.round(daily * 1000) / 1000, onHand: r3(qty), onOrder: r3(onOrder), coverDays,
      status: daily <= 0 ? "idle" : coverDays! < lead ? "critical" : coverDays! < cover + lead ? "low" : "ok", suggested, price: r2(price), value: r2(suggested * price), supplierId: r.supplierId, supplierName: r.supplierName };
  }).filter((r: any) => r.daily > 0 || r.suggested > 0)
    .sort((a: any, b: any) => (a.coverDays ?? 9e9) - (b.coverDays ?? 9e9));
  const buy = out.filter((r: any) => r.suggested > 0);
  const bySupplier = new Map<string, { supplierId: string | null; supplierName: string; items: number; value: number }>();
  for (const r of buy) { const k = r.supplierId || "_"; const g = bySupplier.get(k) || { supplierId: r.supplierId || null, supplierName: r.supplierName || "بلا مورد سابق", items: 0, value: 0 }; g.items++; g.value = r2(g.value + r.value); bySupplier.set(k, g); }
  return { cover, lead, history, rows: out, totals: { items: buy.length, value: r2(buy.reduce((a: number, r: any) => a + r.value, 0)), critical: out.filter((r: any) => r.status === "critical").length, low: out.filter((r: any) => r.status === "low").length }, suppliers: [...bySupplier.values()] };
}
