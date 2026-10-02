/** Round 9: lot & expiry tracking — lots report, product lots, expiry write-off. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h, bad, isDate, today, addDays, r2, r3, num } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import { stockAdjustment } from "../services/misc";

export const r9 = Router();
r9.use(authenticate);

/** All lots with stock, their expiry status and value at the warehouse average cost. */
r9.get("/lots", perm("inventory.read"), h(async (req) => {
  const days = Math.max(0, Number(req.query.days) || 60);
  const td = today();
  const params: any[] = [cid(req)]; const w = ["l.company_id=$1", "l.qty <> 0"];
  if (req.query.productId) { params.push(req.query.productId); w.push(`l.product_id=$${params.length}`); }
  if (req.query.warehouseId) { params.push(req.query.warehouseId); w.push(`l.warehouse_id=$${params.length}`); }
  if (req.query.status === "expired") { params.push(td); w.push(`l.expiry_date < $${params.length}`); }
  else if (req.query.status === "soon") { params.push(td, addDays(td, days)); w.push(`l.expiry_date BETWEEN $${params.length - 1} AND $${params.length}`); }
  const rows = await db.rows(
    `SELECT l.id, l.lot_no, l.expiry_date, l.qty, l.received_at, p.id AS product_id, p.sku, p.name, p.unit, wh.name AS warehouse, wh.id AS warehouse_id,
       CASE WHEN b.qty > 0 THEN b.value / b.qty ELSE p.purchase_price END unit_cost, p.sale_price
     FROM stock_lots l JOIN products p ON p.id=l.product_id JOIN warehouses wh ON wh.id=l.warehouse_id
     LEFT JOIN stock_balances b ON b.product_id=l.product_id AND b.warehouse_id=l.warehouse_id
     WHERE ${w.join(" AND ")} ORDER BY l.expiry_date NULLS LAST, p.name`, params);
  const out = rows.map((r) => {
    const exp = r.expiryDate ? String(r.expiryDate).slice(0, 10) : null;
    const daysLeft = exp ? Math.round((Date.parse(exp) - Date.parse(td)) / 86400000) : null;
    return { ...r, expiryDate: exp, daysLeft, status: daysLeft === null ? "NONE" : daysLeft < 0 ? "EXPIRED" : daysLeft <= days ? "SOON" : "OK", value: r2(Number(r.qty) * Number(r.unitCost || 0)) };
  });
  const sum = (s: string) => ({ count: out.filter((r) => r.status === s).length, qty: r3(out.filter((r) => r.status === s).reduce((a, r) => a + Number(r.qty), 0)), value: r2(out.filter((r) => r.status === s).reduce((a, r) => a + r.value, 0)) });
  return { days, rows: out, summary: { expired: sum("EXPIRED"), soon: sum("SOON"), ok: sum("OK"), none: sum("NONE") } };
}));

r9.get("/products/:id/lots", perm("inventory.read"), h(async (req) => db.rows(`SELECT l.*, w.name AS warehouse FROM stock_lots l JOIN warehouses w ON w.id=l.warehouse_id WHERE l.company_id=$1 AND l.product_id=$2 AND l.qty <> 0 ORDER BY l.expiry_date NULLS LAST`, [cid(req), p(req).id])));

/** Writes off an expired/damaged lot: stock count adjustment (Dr shrinkage / Cr inventory) on that exact lot. */
r9.post("/lots/:id/write-off", perm("inventory.write"), h(async (req) => {
  const lot = await db.one(`SELECT * FROM stock_lots WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)], "الدفعة غير موجودة");
  const qty = req.body?.qty ? Math.min(num(req.body.qty), Number(lot.qty)) : Number(lot.qty);
  if (qty <= 0) throw bad("لا توجد كمية لإتلافها");
  const r = await tx(async (t) => {
    // move this lot to the front of the FEFO queue by issuing exactly from it
    const bal = await t.one(`SELECT qty FROM stock_balances WHERE company_id=$1 AND product_id=$2 AND warehouse_id=$3`, [cid(req), lot.productId, lot.warehouseId]);
    await t.exec(`UPDATE stock_lots SET qty=qty-$2 WHERE id=$1`, [lot.id, qty]);
    await t.exec(`INSERT INTO stock_lots(company_id, product_id, warehouse_id, lot_no, expiry_date, qty, received_at) VALUES ($1,$2,$3,'__WO__','1900-01-01',$4,$5) ON CONFLICT (company_id, product_id, warehouse_id, lot_no) DO UPDATE SET qty=stock_lots.qty+EXCLUDED.qty, expiry_date='1900-01-01'`, [cid(req), lot.productId, lot.warehouseId, qty, today()]);
    const adj = await stockAdjustment(t, cid(req), actor(req), { kind: "COUNT", warehouseId: lot.warehouseId, date: isDate(req.body?.date) ? req.body.date : today(), notes: `إتلاف دفعة ${lot.lotNo}${req.body?.reason ? " — " + req.body.reason : ""}`, lines: [{ productId: lot.productId, qty: r3(Number(bal.qty) - qty) }] } as any);
    await t.exec(`DELETE FROM stock_lots WHERE company_id=$1 AND product_id=$2 AND warehouse_id=$3 AND lot_no='__WO__' AND qty=0`, [cid(req), lot.productId, lot.warehouseId]);
    return adj;
  });
  await audit(req, "WRITE_OFF", "lot", lot.id, { lotNo: lot.lotNo, qty });
  return r;
}));
