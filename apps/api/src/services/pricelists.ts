/** Price lists: fixed prices per product (with quantity breaks) or a % discount off the sale price; linked to partners. */
import { Db } from "../db/pool";
import { bad, conflict, r2, r4, num } from "../lib/core";

export async function listPriceLists(t: Db, companyId: string) {
  return t.rows(`SELECT l.*, (SELECT COUNT(*)::int FROM price_list_items i WHERE i.price_list_id=l.id) items_count, (SELECT COUNT(*)::int FROM partners p WHERE p.price_list_id=l.id) partners_count FROM price_lists l WHERE l.company_id=$1 ORDER BY l.name`, [companyId]);
}

export async function getPriceList(t: Db, companyId: string, id: string) {
  const l = await t.one(`SELECT * FROM price_lists WHERE id=$1 AND company_id=$2`, [id, companyId], "قائمة الأسعار غير موجودة");
  const items = await t.rows(`SELECT i.*, p.sku, p.name, p.sale_price FROM price_list_items i JOIN products p ON p.id=i.product_id WHERE i.price_list_id=$1 ORDER BY p.name, i.min_qty`, [id]);
  return { ...l, items };
}

export async function savePriceList(t: Db, companyId: string, b: any, id?: string) {
  const name = String(b.name || "").trim();
  if (!name) throw bad("اسم القائمة مطلوب");
  const kind = b.kind === "DISCOUNT" ? "DISCOUNT" : "FIXED";
  const discountPct = Math.max(0, Math.min(100, r2(num(b.discountPct))));
  const dup = await t.maybe(`SELECT id FROM price_lists WHERE company_id=$1 AND name=$2 AND id<>$3`, [companyId, name, id || "00000000-0000-0000-0000-000000000000"]);
  if (dup) throw conflict("توجد قائمة بنفس الاسم");
  const data = { name, kind, discountPct, isActive: b.isActive !== false };
  const row = id ? await t.update("price_lists", { id, companyId }, data) : await t.insert("price_lists", { companyId, ...data, isDemo: !!b.isDemo });
  if (!row) throw bad("قائمة الأسعار غير موجودة");
  if (Array.isArray(b.items)) {
    await t.exec(`DELETE FROM price_list_items WHERE price_list_id=$1`, [row.id]);
    const seen = new Set<string>();
    const items = b.items.map((i: any) => ({ priceListId: row.id, productId: i.productId, minQty: Math.max(0.001, num(i.minQty) || 1), price: r4(num(i.price)) })).filter((i: any) => i.productId && i.price >= 0 && !seen.has(i.productId + "|" + i.minQty) && seen.add(i.productId + "|" + i.minQty));
    if (items.length) {
      const ok = await t.rows(`SELECT id FROM products WHERE company_id=$1 AND id = ANY($2)`, [companyId, [...new Set(items.map((i: any) => i.productId))]]);
      if (ok.length !== new Set(items.map((i: any) => i.productId)).size) throw bad("أحد الأصناف غير موجود");
      await t.insertMany("price_list_items", items);
    }
  }
  return getPriceList(t, companyId, row.id);
}

export async function deletePriceList(t: Db, companyId: string, id: string) {
  await t.exec(`UPDATE partners SET price_list_id=NULL WHERE company_id=$1 AND price_list_id=$2`, [companyId, id]);
  await t.exec(`DELETE FROM price_lists WHERE id=$1 AND company_id=$2`, [id, companyId]);
}

/** Map productId → unit price for a price list (best quantity break ≤ qty; DISCOUNT lists derive from the sale price). */
export async function resolvePrices(t: Db, companyId: string, priceListId: string, productIds: string[], qty = 1) {
  const out: Record<string, number> = {};
  if (!priceListId || !productIds.length) return out;
  const l = await t.maybe(`SELECT * FROM price_lists WHERE id=$1 AND company_id=$2 AND is_active`, [priceListId, companyId]);
  if (!l) return out;
  const prods = await t.rows(`SELECT id, sale_price FROM products WHERE company_id=$1 AND id = ANY($2)`, [companyId, productIds]);
  if (l.kind === "DISCOUNT") { for (const p of prods) out[p.id] = r4(Number(p.salePrice) * (1 - Number(l.discountPct) / 100)); return out; }
  const items = await t.rows(`SELECT product_id, min_qty, price FROM price_list_items WHERE price_list_id=$1 AND product_id = ANY($2) ORDER BY min_qty`, [priceListId, productIds]);
  for (const it of items) if (Number(it.minQty) <= qty) out[it.productId] = Number(it.price); // ascending min_qty → last applicable wins
  return out;
}
