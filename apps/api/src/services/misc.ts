import { Db } from "../db/pool";
import { bad, conflict, r2, D, num, isDate, today } from "../lib/core";
import { post, nextNumber, reverse } from "../accounting/engine";
import { stockIn, stockOut } from "../accounting/stock";
import { vatReturn } from "./reports";

/** Files the VAT return for a period and posts the settlement entry (VAT_OUT/VAT_IN → VAT_PAYABLE). */
export async function fileVatReturn(t: Db, companyId: string, user: string, from: string, to: string, isDemo = false) {
  if (!isDate(from) || !isDate(to) || from > to) throw bad("فترة الإقرار غير صحيحة");
  const dup = await t.maybe(`SELECT id FROM vat_returns WHERE company_id=$1 AND period_from=$2 AND period_to=$3`, [companyId, from, to]);
  if (dup) throw conflict("تم تقديم إقرار لهذه الفترة مسبقاً");
  const data = await vatReturn(t, companyId, { from, to });
  const lines: any[] = [];
  if (data.glOutputVat) lines.push({ key: "VAT_OUT", debit: data.glOutputVat, description: `إقفال ضريبة المخرجات ${from} – ${to}` });
  if (data.glInputVat) lines.push({ key: "VAT_IN", credit: data.glInputVat, description: `إقفال ضريبة المدخلات ${from} – ${to}` });
  const net = r2(data.glOutputVat - data.glInputVat);
  if (net > 0) lines.push({ key: "VAT_PAYABLE", credit: net, description: `صافي الضريبة المستحقة للهيئة` });
  if (net < 0) lines.push({ key: "VAT_PAYABLE", debit: -net, description: `رصيد ضريبي دائن (مسترد)` });
  const entry = lines.length ? await post(t, companyId, { date: to, type: "VAT_SETTLEMENT", sourceType: "VAT_RETURN", reference: `VAT ${from}..${to}`, memo: `إقرار ضريبة القيمة المضافة ${from} – ${to}`, createdBy: user, isDemo, lines }) : null;
  const row = await t.insert("vat_returns", { companyId, periodFrom: from, periodTo: to, data, netVat: net, journalId: entry?.id || null, isDemo });
  if (entry) await t.exec(`UPDATE journal_entries SET source_id=$2 WHERE id=$1`, [entry.id, row.id]);
  return row;
}

/** Pays the settled VAT liability from cash/bank. */
export async function payVat(t: Db, companyId: string, user: string, returnId: string, accountId: string, date?: string) {
  const vr = await t.one(`SELECT * FROM vat_returns WHERE id=$1 AND company_id=$2 FOR UPDATE`, [returnId, companyId], "الإقرار غير موجود");
  if (vr.status === "SETTLED") throw conflict("تم سداد هذا الإقرار مسبقاً");
  if (Number(vr.netVat) <= 0) throw bad("لا يوجد مبلغ مستحق للسداد");
  const acc = await t.one(`SELECT id FROM accounts WHERE id=$1 AND company_id=$2 AND is_cash_bank`, [accountId, companyId], "حساب السداد غير صحيح");
  const e = await post(t, companyId, { date: date || today(), type: "PAYMENT", sourceType: "VAT_RETURN", sourceId: vr.id, reference: `VAT ${vr.periodFrom}..${vr.periodTo}`, memo: `سداد ضريبة القيمة المضافة عن الفترة ${vr.periodFrom} – ${vr.periodTo}`, createdBy: user, isDemo: vr.isDemo, lines: [
    { key: "VAT_PAYABLE", debit: Number(vr.netVat), description: "سداد الضريبة للهيئة" },
    { account: acc.id, credit: Number(vr.netVat), description: "سداد الضريبة للهيئة" },
  ] });
  await t.exec(`UPDATE vat_returns SET status='SETTLED' WHERE id=$1`, [vr.id]);
  return e;
}

export interface AdjustmentInput {
  date?: string;
  warehouseId?: string;
  kind?: "COUNT" | "OPENING" | "TRANSFER";
  toWarehouse?: string;
  notes?: string;
  lines: { productId: string; qty: number; unitCost?: number }[]; // COUNT: qty = counted (actual) qty ; OPENING: qty to add ; TRANSFER: qty to move
  isDemo?: boolean;
}

export async function stockAdjustment(t: Db, companyId: string, user: string, a: AdjustmentInput) {
  const date = a.date || today();
  if (!isDate(date)) throw bad("التاريخ غير صحيح");
  const kind = a.kind || "COUNT";
  const wh = a.warehouseId || (await t.one(`SELECT id FROM warehouses WHERE company_id=$1 ORDER BY is_default DESC LIMIT 1`, [companyId])).id;
  if (!a.lines?.length) throw bad("أضف صنفاً واحداً على الأقل");
  const number = await nextNumber(t, companyId, kind === "TRANSFER" ? "TRF" : kind === "OPENING" ? "OPN" : "ADJ", date);
  const jl: any[] = [];
  const out: any[] = [];
  let totalValue = 0;
  for (const l of a.lines) {
    const p = await t.one(`SELECT * FROM products WHERE id=$1 AND company_id=$2 AND type='STOCK'`, [l.productId, companyId], "الصنف غير موجود");
    const qty = num(l.qty);
    if (kind === "TRANSFER") {
      if (!a.toWarehouse || a.toWarehouse === wh) throw bad("حدد المستودع المستلم");
      const v = await stockOut(t, companyId, { productId: p.id, warehouseId: wh, qty, date, sourceType: "TRANSFER", reference: number, isDemo: a.isDemo, productName: p.name });
      await stockIn(t, companyId, { productId: p.id, warehouseId: a.toWarehouse, qty, date, sourceType: "TRANSFER", reference: number, value: v, isDemo: a.isDemo });
      out.push({ productId: p.id, name: p.name, qty, value: v });
      continue;
    }
    if (kind === "OPENING") {
      const cost = num(l.unitCost ?? p.purchasePrice);
      const v = await stockIn(t, companyId, { productId: p.id, warehouseId: wh, qty, date, sourceType: "OPENING", reference: number, unitCost: cost, isDemo: a.isDemo });
      jl.push({ key: "INVENTORY", debit: v, description: `رصيد افتتاحي ${p.name}` });
      totalValue = r2(totalValue + v);
      out.push({ productId: p.id, name: p.name, qty, value: v });
      continue;
    }
    // COUNT: bring balance to counted qty
    const bal = await t.maybe(`SELECT qty FROM stock_balances WHERE company_id=$1 AND product_id=$2 AND warehouse_id=$3`, [companyId, p.id, wh]);
    const cur = Number(bal?.qty || 0);
    const diff = r2(qty - cur);
    if (Math.abs(diff) < 0.0005) continue;
    if (diff > 0) {
      const v = await stockIn(t, companyId, { productId: p.id, warehouseId: wh, qty: diff, date, sourceType: "ADJUSTMENT", reference: number, unitCost: num(l.unitCost ?? p.purchasePrice), isDemo: a.isDemo });
      jl.push({ key: "INVENTORY", debit: v, description: `زيادة جرد ${p.name}` }, { key: "INV_GAIN", credit: v, description: `زيادة جرد ${p.name}` });
      totalValue = r2(totalValue + v);
      out.push({ productId: p.id, name: p.name, qty: diff, value: v });
    } else {
      const v = await stockOut(t, companyId, { productId: p.id, warehouseId: wh, qty: -diff, date, sourceType: "ADJUSTMENT", reference: number, allowNegative: true, isDemo: a.isDemo, productName: p.name });
      jl.push({ key: "INV_LOSS", debit: v, description: `عجز جرد ${p.name}` }, { key: "INVENTORY", credit: v, description: `عجز جرد ${p.name}` });
      totalValue = r2(totalValue - v);
      out.push({ productId: p.id, name: p.name, qty: diff, value: -v });
    }
  }
  if (kind === "OPENING" && totalValue) jl.push({ key: "OPENING_EQUITY", credit: totalValue, description: `رصيد افتتاحي للمخزون ${number}` });
  const entry = jl.length ? await post(t, companyId, { date, type: "STOCK", sourceType: "STOCK_ADJUSTMENT", reference: number, memo: kind === "OPENING" ? `أرصدة افتتاحية مخزون ${number}` : `تسوية جرد ${number}`, createdBy: user, isDemo: a.isDemo, lines: jl }) : null;
  const row = await t.insert("stock_adjustments", { companyId, number, date, warehouseId: wh, kind, toWarehouse: a.toWarehouse || null, notes: a.notes || null, lines: out, totalValue, journalId: entry?.id || null, isDemo: !!a.isDemo });
  if (entry) await t.exec(`UPDATE journal_entries SET source_id=$2 WHERE id=$1`, [entry.id, row.id]);
  return row;
}

/** Opening balances for accounts (and per-partner AR/AP) against Opening Balance Equity. */
export async function openingBalances(t: Db, companyId: string, user: string, date: string, lines: { accountId: string; debit?: number; credit?: number; partnerId?: string; description?: string }[]) {
  if (!isDate(date)) throw bad("التاريخ غير صحيح");
  const jl = lines.map((l) => ({ account: l.accountId, debit: num(l.debit), credit: num(l.credit), partnerId: l.partnerId || null, description: l.description || "رصيد افتتاحي" }));
  const d = jl.reduce((a, l) => D(a).plus(l.debit).toNumber(), 0);
  const c = jl.reduce((a, l) => D(a).plus(l.credit).toNumber(), 0);
  const diff = r2(d - c);
  if (diff > 0) jl.push({ account: undefined as any, key: "OPENING_EQUITY", credit: diff, description: "رصيد افتتاحي" } as any);
  if (diff < 0) jl.push({ account: undefined as any, key: "OPENING_EQUITY", debit: -diff, description: "رصيد افتتاحي" } as any);
  return post(t, companyId, { date, type: "OPENING", memo: "قيد الأرصدة الافتتاحية", createdBy: user, lines: jl });
}

export async function manualJournal(t: Db, companyId: string, user: string, j: { date: string; memo?: string; reference?: string; lines: any[]; isDemo?: boolean }) {
  return post(t, companyId, { date: j.date, type: "MANUAL", memo: j.memo || null, reference: j.reference || null, createdBy: user, isDemo: j.isDemo, lines: j.lines.map((l) => ({ account: l.accountId, debit: num(l.debit), credit: num(l.credit), partnerId: l.partnerId || null, costCenterId: l.costCenterId || null, description: l.description || null })) });
}
