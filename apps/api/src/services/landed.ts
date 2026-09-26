/**
 * Landed costs: freight, customs, clearance and similar charges already booked to the
 * "landed cost clearing" account (via an expense or a supplier bill) are re-allocated to the
 * stock lines of a posted purchase bill → inventory value rises (moving average) without quantity.
 * The share belonging to quantities already sold goes to COGS instead.
 */
import { Db } from "../db/pool";
import { bad, conflict, r2, r4, D, num, isDate, today } from "../lib/core";
import { post, nextNumber } from "../accounting/engine";
import { stockIn } from "../accounting/stock";

export interface LandedInput {
  invoiceId: string;
  date?: string;
  method?: "VALUE" | "QTY";
  costs: { description: string; amount: number; accountId?: string | null }[];
  notes?: string | null;
  isDemo?: boolean;
}

async function billLines(t: Db, companyId: string, invoiceId: string) {
  const inv = await t.one(`SELECT * FROM invoices WHERE id=$1 AND company_id=$2`, [invoiceId, companyId], "فاتورة المشتريات غير موجودة");
  if (inv.direction !== "PURCHASE" || inv.kind !== "INVOICE" || inv.status !== "POSTED") throw bad("تكاليف الاستيراد تُحمَّل على فاتورة مشتريات مرحّلة فقط");
  const lines = await t.rows(`SELECT l.*, p.name AS pname FROM invoice_lines l JOIN products p ON p.id=l.product_id WHERE l.invoice_id=$1 AND p.type='STOCK' ORDER BY l.sort`, [invoiceId]);
  if (!lines.length) throw bad("الفاتورة لا تحتوي على أصناف مخزنية");
  return { inv, lines };
}

export async function computeAllocation(t: Db, companyId: string, input: LandedInput) {
  const { inv, lines } = await billLines(t, companyId, input.invoiceId);
  const costs = (input.costs || []).map((c) => ({ description: String(c.description || "").trim() || "تكلفة استيراد", amount: r2(num(c.amount)), accountId: c.accountId || null })).filter((c) => c.amount > 0);
  const total = r2(costs.reduce((a, c) => a + c.amount, 0));
  if (total <= 0) throw bad("أدخل تكلفة واحدة على الأقل");
  const method = input.method === "QTY" ? "QTY" : "VALUE";
  const baseOf = (l: any) => (method === "QTY" ? Number(l.qty) : Number(l.netAmount));
  const baseTotal = lines.reduce((a, l) => a + baseOf(l), 0);
  if (baseTotal <= 0) throw bad("لا يمكن التوزيع — قيم الأسطر صفرية");
  const allocation: any[] = [];
  let acc = 0;
  for (const [i, l] of lines.entries()) {
    const share = i === lines.length - 1 ? r2(total - acc) : r2((total * baseOf(l)) / baseTotal);
    acc = r2(acc + share);
    // portion still on hand (moving average): compare current stock of the product in the bill's warehouse to the received qty
    const bal = await t.maybe(`SELECT qty, value FROM stock_balances WHERE company_id=$1 AND product_id=$2 AND warehouse_id=$3`, [companyId, l.productId, inv.warehouseId]);
    const onHand = Math.max(0, Number(bal?.qty || 0));
    const ratio = Math.min(1, onHand / Number(l.qty));
    const toInventory = r2(share * ratio);
    allocation.push({ lineId: l.id, productId: l.productId, description: l.pname, qty: Number(l.qty), base: baseOf(l), share, onHand, toInventory, toCogs: r2(share - toInventory), newUnitCost: onHand > 0 ? r4(D(bal?.value || 0).plus(toInventory).div(onHand)) : null });
  }
  return { invoice: { id: inv.id, number: inv.number, partnerName: inv.partnerName, date: inv.date, total: inv.total, currency: inv.currency, warehouseId: inv.warehouseId }, method, costs, total, allocation, toInventory: r2(allocation.reduce((a, x) => a + x.toInventory, 0)), toCogs: r2(allocation.reduce((a, x) => a + x.toCogs, 0)) };
}

export async function createLandedCost(t: Db, companyId: string, user: string, input: LandedInput) {
  const c = await computeAllocation(t, companyId, input);
  const date = isDate(input.date) ? input.date! : today();
  const number = await nextNumber(t, companyId, "LC", date, 4);
  return t.insert("landed_costs", { companyId, number, date, invoiceId: c.invoice.id, method: c.method, costs: c.costs, allocation: c.allocation, total: c.total, notes: input.notes || null, isDemo: !!input.isDemo, createdBy: user });
}

export async function postLandedCost(t: Db, companyId: string, user: string, id: string) {
  const lc = await t.one(`SELECT * FROM landed_costs WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "المستند غير موجود");
  if (lc.status !== "DRAFT") throw conflict("المستند مرحّل مسبقاً");
  // recompute on the live stock so the inventory/COGS split reflects what is on hand now
  const c = await computeAllocation(t, companyId, { invoiceId: lc.invoiceId, method: lc.method, costs: lc.costs });
  const date = String(lc.date).slice(0, 10);
  for (const a of c.allocation) {
    if (a.toInventory > 0) await stockIn(t, companyId, { productId: a.productId, warehouseId: c.invoice.warehouseId, qty: 0, value: a.toInventory, date, sourceType: "LANDED_COST", sourceId: lc.id, reference: lc.number, isDemo: lc.isDemo });
  }
  const lines: any[] = [
    { key: "INVENTORY", debit: c.toInventory, description: `تكاليف استيراد ${lc.number} — ${c.invoice.number}` },
    { key: "COGS", debit: c.toCogs, description: `تكاليف استيراد لكميات مباعة ${lc.number}` },
    ...c.costs.map((x) => ({ ...(x.accountId ? { account: x.accountId } : { key: "LANDED_COST" }), credit: x.amount, description: x.description })),
  ];
  const e = await post(t, companyId, { date, type: "STOCK", sourceType: "LANDED_COST", sourceId: lc.id, reference: lc.number, memo: `تحميل تكاليف استيراد على ${c.invoice.number} — ${c.invoice.partnerName}`, createdBy: user, isDemo: lc.isDemo, lines });
  return t.update("landed_costs", { id }, { status: "POSTED", journalId: e!.id, allocation: c.allocation, total: c.total });
}

export async function deleteLandedCost(t: Db, companyId: string, id: string) {
  const lc = await t.one(`SELECT status FROM landed_costs WHERE id=$1 AND company_id=$2`, [id, companyId], "المستند غير موجود");
  if (lc.status !== "DRAFT") throw conflict("لا يمكن حذف مستند مرحّل");
  await t.exec(`DELETE FROM landed_costs WHERE id=$1`, [id]);
}
