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
  lotNo?: string | null; // stock-in: lot received (auto when omitted)
  expiryDate?: string | null;
  lots?: { lotNo: string; expiry: string | null; qty: number }[]; // stock-in: exact lots to restore (returns, transfers)
}

export interface LotAlloc { lotNo: string; expiry: string | null; qty: number }

async function lotProduct(t: Db, companyId: string, productId: string) {
  return t.maybe(`SELECT track_lots, shelf_life_days, name FROM products WHERE id=$1 AND company_id=$2 AND track_lots`, [productId, companyId]);
}

/** Adds quantity to lots (exact allocation, or a single lot from lotNo/expiry or auto-generated). */
async function lotsIn(t: Db, companyId: string, m: MoveInput, prod: any): Promise<LotAlloc[]> {
  if (!m.qty) return [];
  let list: LotAlloc[] = m.lots?.length ? m.lots : [];
  if (!list.length) {
    const lotNo = (m.lotNo || "").trim() || `L${m.date.replace(/-/g, "").slice(2)}`;
    let expiry = m.expiryDate || null;
    if (!expiry && prod.shelfLifeDays) { const d = new Date(m.date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + Number(prod.shelfLifeDays)); expiry = d.toISOString().slice(0, 10); }
    list = [{ lotNo, expiry, qty: m.qty }];
  }
  for (const l of list) {
    await t.exec(`INSERT INTO stock_lots(company_id, product_id, warehouse_id, lot_no, expiry_date, qty, received_at, is_demo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (company_id, product_id, warehouse_id, lot_no) DO UPDATE SET qty=stock_lots.qty+EXCLUDED.qty, expiry_date=COALESCE(stock_lots.expiry_date, EXCLUDED.expiry_date)`,
      [companyId, m.productId, m.warehouseId, l.lotNo, l.expiry, l.qty, m.date, !!m.isDemo]);
  }
  return list;
}

/** Takes quantity out FEFO (earliest expiry first). Expired lots are skipped for sales when the company blocks them. */
async function lotsOut(t: Db, companyId: string, m: MoveInput, prod: any, blockExpired: boolean): Promise<LotAlloc[]> {
  const lots = await t.rows(`SELECT id, lot_no, expiry_date, qty FROM stock_lots WHERE company_id=$1 AND product_id=$2 AND warehouse_id=$3 AND qty > 0 ORDER BY expiry_date NULLS LAST, received_at, lot_no FOR UPDATE`, [companyId, m.productId, m.warehouseId]);
  const usable = blockExpired ? lots.filter((l) => !l.expiryDate || String(l.expiryDate).slice(0, 10) >= m.date) : lots;
  const avail = usable.reduce((a, l) => a + Number(l.qty), 0);
  if (blockExpired && avail + 1e-9 < m.qty && lots.length > usable.length) {
    throw new AppError(409, `الكمية الصالحة من «${prod.name}» غير كافية — المتاح غير المنتهي ${r3(avail)}، والباقي منتهي الصلاحية`, "EXPIRED_STOCK");
  }
  let rest = m.qty;
  const out: LotAlloc[] = [];
  for (const l of usable) {
    if (rest <= 1e-9) break;
    const take = r3(Math.min(Number(l.qty), rest));
    await t.exec(`UPDATE stock_lots SET qty=qty-$2 WHERE id=$1`, [l.id, take]);
    out.push({ lotNo: l.lotNo, expiry: l.expiryDate ? String(l.expiryDate).slice(0, 10) : null, qty: take });
    rest = r3(rest - take);
  }
  if (rest > 1e-9) { // negative stock allowed: book against a placeholder lot so Σ lots = stock qty
    await t.exec(`INSERT INTO stock_lots(company_id, product_id, warehouse_id, lot_no, qty, received_at) VALUES ($1,$2,$3,'NEG',$4,$5) ON CONFLICT (company_id, product_id, warehouse_id, lot_no) DO UPDATE SET qty=stock_lots.qty+EXCLUDED.qty`, [companyId, m.productId, m.warehouseId, -rest, m.date]);
    out.push({ lotNo: "NEG", expiry: null, qty: rest });
  }
  return out;
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
  const prod = m.qty ? await lotProduct(t, companyId, m.productId) : null;
  const lots = prod ? await lotsIn(t, companyId, m, prod) : null;
  await t.insert("stock_moves", {
    companyId, date: m.date, productId: m.productId, warehouseId: m.warehouseId,
    qty: m.qty, unitCost: m.qty ? r4(D(value).div(m.qty)) : 0, value, balanceQty: newQty, balanceVal: newVal,
    sourceType: m.sourceType, sourceId: m.sourceId || null, reference: m.reference || null, isDemo: !!m.isDemo, lots,
  });
  return value;
}

/** Issue stock at current average cost. Returns the (positive) value removed. */
export async function stockOut(t: Db, companyId: string, m: MoveInput & { allowNegative?: boolean; fallbackCost?: number; productName?: string; onLots?: (l: LotAlloc[]) => void }) {
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
  const prod = await lotProduct(t, companyId, m.productId);
  let lots: LotAlloc[] | null = null;
  if (prod) {
    const block = ["SALE", "POS"].includes(m.sourceType) && !!(await t.one(`SELECT block_expired_sales b FROM companies WHERE id=$1`, [companyId])).b;
    lots = await lotsOut(t, companyId, m, prod, block);
    m.onLots?.(lots);
  }
  await t.insert("stock_moves", {
    companyId, date: m.date, productId: m.productId, warehouseId: m.warehouseId,
    qty: -m.qty, unitCost: m.qty ? r4(D(value).div(m.qty)) : 0, value: -value, balanceQty: newQty, balanceVal: newVal,
    sourceType: m.sourceType, sourceId: m.sourceId || null, reference: m.reference || null, isDemo: !!m.isDemo, lots,
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

/** When lot tracking is switched on for a product with stock, open a lot for the existing quantity so Σ lots = stock. */
export async function openLotsForExisting(t: Db, companyId: string, productId: string, date: string) {
  const bals = await t.rows(`SELECT warehouse_id, qty FROM stock_balances WHERE company_id=$1 AND product_id=$2 AND qty <> 0`, [companyId, productId]);
  for (const b of bals) {
    const cur = await t.one(`SELECT COALESCE(SUM(qty),0) q FROM stock_lots WHERE company_id=$1 AND product_id=$2 AND warehouse_id=$3`, [companyId, productId, b.warehouseId]);
    const diff = r3(Number(b.qty) - Number(cur.q));
    if (Math.abs(diff) > 1e-9) await t.exec(`INSERT INTO stock_lots(company_id, product_id, warehouse_id, lot_no, qty, received_at) VALUES ($1,$2,$3,'OPENING',$4,$5) ON CONFLICT (company_id, product_id, warehouse_id, lot_no) DO UPDATE SET qty=stock_lots.qty+EXCLUDED.qty`, [companyId, productId, b.warehouseId, diff, date]);
  }
}
