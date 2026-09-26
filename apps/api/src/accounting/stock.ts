/**
 * Perpetual inventory with moving-average cost per (product, warehouse).
 * stock_balances keeps quantity AND total value, so the inventory GL account
 * always equals Σ value exactly (no rounding residue: when a balance reaches
 * zero quantity, its full remaining value leaves with it).
 */
import { Db } from "../db/pool";
import { AppError, r2, r3, r4, D } from "../lib/core";

export interface MoveInput {
  productId: string;
  warehouseId: string;
  qty: number; // positive magnitude
  date: string;
  sourceType: string;
  sourceId?: string;
  reference?: string;
  isDemo?: boolean;
}

async function lockBalance(t: Db, companyId: string, productId: string, warehouseId: string) {
  await t.exec(
    `INSERT INTO stock_balances(company_id, product_id, warehouse_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [companyId, productId, warehouseId],
  );
  return t.one(
    `SELECT qty, value FROM stock_balances WHERE company_id=$1 AND product_id=$2 AND warehouse_id=$3 FOR UPDATE`,
    [companyId, productId, warehouseId],
  );
}

/** Receive stock at a known unit cost (or total value). Returns the value added. */
export async function stockIn(t: Db, companyId: string, m: MoveInput & { unitCost?: number; value?: number }) {
  const bal = await lockBalance(t, companyId, m.productId, m.warehouseId);
  const value = m.value !== undefined ? r2(m.value) : r2(D(m.qty).times(m.unitCost || 0));
  const newQty = r3(D(bal.qty).plus(m.qty));
  const newVal = r2(D(bal.value).plus(value)); // never force to zero here: GL must equal Σ value
  await t.exec(`UPDATE stock_balances SET qty=$4, value=$5 WHERE company_id=$1 AND product_id=$2 AND warehouse_id=$3`, [companyId, m.productId, m.warehouseId, newQty, newVal]);
  await t.insert("stock_moves", {
    companyId, date: m.date, productId: m.productId, warehouseId: m.warehouseId,
    qty: m.qty, unitCost: m.qty ? r4(D(value).div(m.qty)) : 0, value, balanceQty: newQty, balanceVal: newVal,
    sourceType: m.sourceType, sourceId: m.sourceId || null, reference: m.reference || null, isDemo: !!m.isDemo,
  });
  return value;
}

/** Issue stock at current average cost. Returns the (positive) value removed. */
export async function stockOut(t: Db, companyId: string, m: MoveInput & { allowNegative?: boolean; fallbackCost?: number; productName?: string }) {
  const bal = await lockBalance(t, companyId, m.productId, m.warehouseId);
  const qty = Number(bal.qty), val = Number(bal.value);
  if (m.qty > qty + 1e-9 && !m.allowNegative) {
    throw new AppError(409, `الكمية غير كافية للصنف «${m.productName || ""}» — المتاح ${qty}، المطلوب ${m.qty}`, "INSUFFICIENT_STOCK");
  }
  let value: number;
  if (qty <= 0) value = r2(D(m.qty).times(m.fallbackCost || 0));
  else if (Math.abs(m.qty - qty) < 1e-9) value = val;
  else if (m.qty > qty) value = r2(D(val).plus(D(m.qty - qty).times(D(val).div(qty))));
  else value = r2(D(m.qty).times(D(val).div(qty)));
  const newQty = r3(D(qty).minus(m.qty));
  const newVal = newQty === 0 ? 0 : r2(D(val).minus(value));
  await t.exec(`UPDATE stock_balances SET qty=$4, value=$5 WHERE company_id=$1 AND product_id=$2 AND warehouse_id=$3`, [companyId, m.productId, m.warehouseId, newQty, newVal]);
  await t.insert("stock_moves", {
    companyId, date: m.date, productId: m.productId, warehouseId: m.warehouseId,
    qty: -m.qty, unitCost: m.qty ? r4(D(value).div(m.qty)) : 0, value: -value, balanceQty: newQty, balanceVal: newVal,
    sourceType: m.sourceType, sourceId: m.sourceId || null, reference: m.reference || null, isDemo: !!m.isDemo,
  });
  return value;
}

export async function avgCost(t: Db, companyId: string, productId: string, warehouseId?: string) {
  const r = await t.one(
    `SELECT COALESCE(SUM(qty),0) q, COALESCE(SUM(value),0) v FROM stock_balances WHERE company_id=$1 AND product_id=$2 ${warehouseId ? "AND warehouse_id=$3" : ""}`,
    warehouseId ? [companyId, productId, warehouseId] : [companyId, productId],
  );
  return Number(r.q) > 0 ? r4(D(r.v).div(r.q)) : 0;
}
