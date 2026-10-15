/**
 * Round 20 — ERP punch list:
 *   • partner profile (KPIs, documents, payments, openings), opening balance per partner, stop/activate, salesperson & terms
 *   • invoice copy / notes / extras (profit, stock moves, warehouse voucher data)
 *   • treasury: cash & bank accounts with balances, transfers between accounts (with bank fee), disable when zero
 *   • chart of accounts: latest journal lines per account
 *   • reports: inventory count sheet, inventory operations summary
 */
import { Db } from "../db/pool";
import { bad, conflict, r2, num, isDate, today } from "../lib/core";
import { post, reverse, nextNumber } from "../accounting/engine";
import { saveDraft, getInvoice } from "./invoices";

const AR_OR_AP = (role: string) => (role === "SUPPLIER" ? "AP" : "AR");

// ─── partners ──────────────────────────────────────────────────────────────
export async function partnerProfile(t: Db, companyId: string, id: string, roleQ: string) {
  const p = await t.one(`SELECT * FROM partners WHERE id=$1 AND company_id=$2`, [id, companyId], "الطرف غير موجود");
  const role = roleQ === "SUPPLIER" || (!p.isCustomer && p.isSupplier) ? "SUPPLIER" : "CUSTOMER";
  const dir = role === "CUSTOMER" ? "SALE" : "PURCHASE";
  const key = AR_OR_AP(role);
  const sign = role === "CUSTOMER" ? 1 : -1;
  const bal = await t.one(
    `SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id
     WHERE l.company_id=$1 AND l.partner_id=$2 AND a.system_key=$3 AND e.status='POSTED'`, [companyId, id, key]);
  const k = await t.one(
    `SELECT COUNT(*) FILTER (WHERE kind='INVOICE' AND status='POSTED')::int invoices,
       COALESCE(SUM(CASE WHEN kind='INVOICE' THEN total WHEN kind='CREDIT_NOTE' THEN -total ELSE 0 END) FILTER (WHERE status='POSTED'),0) total,
       COALESCE(SUM(CASE WHEN kind='INVOICE' THEN total WHEN kind='CREDIT_NOTE' THEN -total ELSE 0 END) FILTER (WHERE status='POSTED' AND date >= date_trunc('year', CURRENT_DATE)),0) ytd,
       COALESCE(SUM(CASE WHEN kind='INVOICE' THEN taxable - cost_total WHEN kind='CREDIT_NOTE' THEN -(taxable - cost_total) ELSE 0 END) FILTER (WHERE status='POSTED'),0) profit,
       COALESCE(SUM(total - amount_paid) FILTER (WHERE kind='INVOICE' AND status='POSTED' AND total - amount_paid > 0.005),0) open_amount,
       COUNT(*) FILTER (WHERE kind='INVOICE' AND status='POSTED' AND total - amount_paid > 0.005)::int open_count,
       COALESCE(SUM(total - amount_paid) FILTER (WHERE kind='INVOICE' AND status='POSTED' AND total - amount_paid > 0.005 AND due_date < CURRENT_DATE),0) overdue,
       COUNT(*) FILTER (WHERE kind IN ('QUOTATION','ORDER') AND status='DRAFT')::int open_quotes,
       MAX(date) FILTER (WHERE kind='INVOICE' AND status='POSTED') last_invoice
     FROM invoices WHERE company_id=$1 AND partner_id=$2 AND direction=$3`, [companyId, id, dir]);
  const docs = await t.rows(
    `SELECT id, kind, number, date, due_date, status, payment_status, total, amount_paid, total - amount_paid AS remaining, taxable - cost_total AS profit, salesperson, origin_id
     FROM invoices WHERE company_id=$1 AND partner_id=$2 AND direction=$3 ORDER BY date DESC, created_at DESC LIMIT 500`, [companyId, id, dir]);
  const payments = await t.rows(
    `SELECT p.id, p.number, p.date, p.amount, p.allocated, p.method, p.status, p.reference, a.name_ar account_name FROM payments p JOIN accounts a ON a.id=p.account_id
     WHERE p.company_id=$1 AND p.partner_id=$2 AND p.direction=$3 ORDER BY p.date DESC, p.created_at DESC LIMIT 500`, [companyId, id, role === "CUSTOMER" ? "IN" : "OUT"]);
  const openings = await t.rows(
    `SELECT e.id, e.number, e.date, e.memo, e.status, SUM(l.debit-l.credit) * $4 AS amount FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id JOIN accounts a ON a.id=l.account_id
     WHERE e.company_id=$1 AND e.source_type='PARTNER_OPENING' AND l.partner_id=$2 AND a.system_key=$3 GROUP BY e.id ORDER BY e.date`, [companyId, id, key, sign]);
  return { partner: p, role, balance: r2(Number(bal.b) * sign), kpis: { ...k, total: r2(k.total), ytd: r2(k.ytd), profit: r2(k.profit), openAmount: r2(k.openAmount), overdue: r2(k.overdue) }, documents: docs, payments, openings };
}

/** Opening balance for one customer/supplier: Dr AR / Cr opening equity (customer) — Cr AP / Dr opening equity (supplier). Negative = reverse side. */
export async function partnerOpening(t: Db, companyId: string, user: string, id: string, b: any) {
  const p = await t.one(`SELECT * FROM partners WHERE id=$1 AND company_id=$2`, [id, companyId], "الطرف غير موجود");
  const role = b.role === "SUPPLIER" || (!p.isCustomer && p.isSupplier) ? "SUPPLIER" : "CUSTOMER";
  const amount = r2(num(b.amount));
  if (!amount) throw bad("أدخل مبلغ الرصيد الافتتاحي");
  const date = isDate(b.date) ? b.date : today();
  const key = AR_OR_AP(role);
  const debitPartner = (role === "CUSTOMER") === amount > 0; // customer owes us / supplier advance
  const a = Math.abs(amount);
  const memo = `رصيد افتتاحي ${role === "CUSTOMER" ? "للعميل" : "للمورد"} ${p.name}${b.memo ? " — " + b.memo : ""}`;
  const e = await post(t, companyId, {
    date, type: "OPENING", sourceType: "PARTNER_OPENING", sourceId: p.id, reference: `OB-${p.code}`, memo, createdBy: user,
    lines: debitPartner
      ? [{ key, debit: a, partnerId: p.id, description: memo }, { key: "OPENING_EQUITY", credit: a, description: memo }]
      : [{ key: "OPENING_EQUITY", debit: a, description: memo }, { key, credit: a, partnerId: p.id, description: memo }],
  });
  return e;
}

export async function cancelPartnerOpening(t: Db, companyId: string, user: string, entryId: string) {
  const e = await t.one(`SELECT * FROM journal_entries WHERE id=$1 AND company_id=$2 AND source_type='PARTNER_OPENING'`, [entryId, companyId], "القيد غير موجود");
  if (e.reversedBy) throw conflict("القيد معكوس مسبقاً");
  return reverse(t, companyId, entryId, today(), `إلغاء ${e.memo}`, user);
}

export async function partnerSettings(t: Db, companyId: string, id: string, b: any) {
  await t.one(`SELECT id FROM partners WHERE id=$1 AND company_id=$2`, [id, companyId], "الطرف غير موجود");
  const upd: any = {};
  if (b.isActive !== undefined) upd.isActive = !!b.isActive;
  if (b.salesperson !== undefined) upd.salesperson = String(b.salesperson || "").trim() || null;
  if (b.paymentTerms !== undefined) upd.paymentTerms = Math.max(0, Math.min(3650, Math.round(num(b.paymentTerms))));
  if (b.creditLimit !== undefined) upd.creditLimit = Math.max(0, r2(num(b.creditLimit)));
  if (!Object.keys(upd).length) throw bad("لا توجد تغييرات");
  return t.update("partners", { id, companyId }, upd);
}

// ─── invoices ──────────────────────────────────────────────────────────────
export async function copyInvoice(t: Db, company: any, user: string, id: string, b: any) {
  const src = await getInvoice(t, company.id, id);
  const kind = ["INVOICE", "QUOTATION", "ORDER"].includes(b.kind) ? b.kind : ["QUOTATION", "ORDER", "INVOICE"].includes(src.kind) ? src.kind : "INVOICE";
  const draft = await saveDraft(t, company, user, {
    direction: src.direction, kind, date: today(), partnerId: b.partnerId || src.partnerId, warehouseId: src.warehouseId, branchId: src.branchId,
    invoiceType: src.invoiceType, originId: null, notes: src.notes ? `${src.notes} (نسخة من ${src.number})` : `نسخة من ${src.number}`, currency: src.currency, exchangeRate: Number(src.exchangeRate), priceListId: src.priceListId,
    lines: src.lines.map((l: any) => ({ productId: l.productId, accountId: l.accountId, description: l.description, qty: l.qty, unitPrice: l.fcUnitPrice ?? l.unitPrice, discountPct: l.discountPct, taxCode: l.taxCode, uomId: l.uomId || null })),
    pricesIncludeVat: false, salesperson: src.salesperson,
  } as any);
  return draft;
}

export async function setInvoiceNotes(t: Db, companyId: string, id: string, notes: string) {
  const r = await t.maybe(`UPDATE invoices SET notes=$3, updated_at=now() WHERE id=$1 AND company_id=$2 RETURNING id`, [id, companyId, String(notes ?? "").slice(0, 2000) || null]);
  if (!r) throw bad("المستند غير موجود");
  return { ok: true };
}

export async function invoiceExtras(t: Db, companyId: string, id: string) {
  const inv = await t.one(`SELECT id, number, direction, kind, status, taxable, cost_total, total, warehouse_id FROM invoices WHERE id=$1 AND company_id=$2`, [id, companyId], "المستند غير موجود");
  const moves = await t.rows(
    `SELECT m.id, m.date, m.qty, m.unit_cost, m.value, m.balance_qty, p.sku, p.name, p.unit, w.name warehouse FROM stock_moves m JOIN products p ON p.id=m.product_id JOIN warehouses w ON w.id=m.warehouse_id
     WHERE m.company_id=$1 AND (m.source_id=$2 OR (m.source_id IS NULL AND m.reference=$3)) ORDER BY p.name`, [companyId, id, inv.number]);
  const sign = inv.kind === "CREDIT_NOTE" ? -1 : 1;
  const revenue = r2(Number(inv.taxable) * sign), cost = r2(Number(inv.costTotal) * sign), profit = r2(revenue - cost);
  return { profit: inv.direction === "SALE" && inv.status === "POSTED" ? { revenue, cost, profit, margin: revenue ? r2((profit / revenue) * 100) : 0 } : null, moves };
}

// ─── treasury ──────────────────────────────────────────────────────────────
export async function treasury(t: Db, companyId: string) {
  const rows = await t.rows(
    `SELECT a.id, a.code, a.name_ar, a.subtype, a.system_key, a.is_active, a.bank_name, a.iban, a.bank_account_no,
       COALESCE(SUM(l.debit-l.credit) FILTER (WHERE e.status='POSTED'),0) balance,
       COALESCE(SUM(l.debit) FILTER (WHERE e.status='POSTED' AND e.date >= date_trunc('month', CURRENT_DATE)),0) month_in,
       COALESCE(SUM(l.credit) FILTER (WHERE e.status='POSTED' AND e.date >= date_trunc('month', CURRENT_DATE)),0) month_out,
       MAX(e.date) FILTER (WHERE e.status='POSTED') last_date, COUNT(l.id) FILTER (WHERE e.status='POSTED')::int moves
     FROM accounts a LEFT JOIN journal_lines l ON l.account_id=a.id LEFT JOIN journal_entries e ON e.id=l.entry_id
     WHERE a.company_id=$1 AND a.is_cash_bank AND NOT a.is_group GROUP BY a.id ORDER BY a.is_active DESC, a.code`, [companyId]);
  const transfers = await t.rows(
    `SELECT x.*, fa.name_ar from_name, ta.name_ar to_name, je.number journal_number FROM treasury_transfers x JOIN accounts fa ON fa.id=x.from_account_id JOIN accounts ta ON ta.id=x.to_account_id LEFT JOIN journal_entries je ON je.id=x.journal_id
     WHERE x.company_id=$1 ORDER BY x.date DESC, x.number DESC LIMIT 300`, [companyId]);
  return { accounts: rows.map((r: any) => ({ ...r, balance: r2(r.balance) })), transfers };
}

async function cashAcc(t: Db, companyId: string, id: string, label: string) {
  const a = await t.one(`SELECT * FROM accounts WHERE id=$1 AND company_id=$2`, [id, companyId], `${label}: الحساب غير موجود`);
  if (!a.isCashBank || a.isGroup) throw bad(`${label}: يجب أن يكون صندوقاً أو حساباً بنكياً`);
  if (!a.isActive) throw bad(`${label}: الحساب معطّل`);
  return a;
}

export async function treasuryTransfer(t: Db, companyId: string, user: string, b: any) {
  const from = await cashAcc(t, companyId, b.fromAccountId, "من حساب");
  const to = await cashAcc(t, companyId, b.toAccountId, "إلى حساب");
  if (from.id === to.id) throw bad("اختر حسابين مختلفين");
  const amount = r2(num(b.amount));
  if (!(amount > 0)) throw bad("المبلغ يجب أن يكون أكبر من صفر");
  const fee = Math.max(0, r2(num(b.fee)));
  const feeVat = b.feeVat ? r2(fee * 0.15) : 0;
  const date = isDate(b.date) ? b.date : today();
  if (!b.allowOverdraft) {
    const bal = await t.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id=$1 AND e.status='POSTED' AND e.date <= $2`, [from.id, date]);
    if (Number(bal.b) + 1e-6 < amount + fee + feeVat) throw bad(`رصيد «${from.nameAr}» (${r2(bal.b)}) لا يكفي للتحويل والرسوم`);
  }
  const number = await nextNumber(t, companyId, "TRN", date);
  const memo = `تحويل من ${from.nameAr} إلى ${to.nameAr}${b.memo ? " — " + b.memo : ""}`;
  const lines: any[] = [{ account: to.id, debit: amount, description: memo }, { account: from.id, credit: r2(amount + fee + feeVat), description: memo }];
  if (fee) lines.push({ key: "BANK_FEES", debit: fee, description: `رسوم تحويل ${number}` });
  if (feeVat) lines.push({ key: "VAT_IN", debit: feeVat, description: `ضريبة رسوم تحويل ${number}` });
  const e = await post(t, companyId, { date, type: "MANUAL", sourceType: "TREASURY_TRANSFER", reference: b.reference || number, memo, createdBy: user, lines });
  const row = await t.insert("treasury_transfers", { companyId, number, date, fromAccountId: from.id, toAccountId: to.id, amount, fee, feeVat, reference: b.reference || null, memo: b.memo || null, journalId: e!.id, createdBy: user });
  await t.exec(`UPDATE journal_entries SET source_id=$1 WHERE id=$2`, [row.id, e!.id]);
  return row;
}

export async function cancelTransfer(t: Db, companyId: string, user: string, id: string) {
  const x = await t.one(`SELECT * FROM treasury_transfers WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "التحويل غير موجود");
  if (x.status !== "POSTED") throw bad("التحويل ملغى مسبقاً");
  if (x.journalId) await reverse(t, companyId, x.journalId, today() < String(x.date).slice(0, 10) ? x.date : today(), `إلغاء التحويل ${x.number}`, user);
  await t.exec(`UPDATE treasury_transfers SET status='CANCELLED' WHERE id=$1`, [id]);
  return { ok: true };
}

export async function treasuryAccount(t: Db, companyId: string, id: string, b: any) {
  const a = await t.one(`SELECT * FROM accounts WHERE id=$1 AND company_id=$2 AND is_cash_bank`, [id, companyId], "الحساب غير موجود");
  const upd: any = {};
  if (b.nameAr !== undefined) { const n = String(b.nameAr).trim(); if (!n) throw bad("اسم الحساب مطلوب"); upd.nameAr = n; }
  if (b.bankName !== undefined) upd.bankName = b.bankName || null;
  if (b.bankAccountNo !== undefined) upd.bankAccountNo = b.bankAccountNo || null;
  if (b.iban !== undefined) {
    const iban = String(b.iban || "").replace(/\s/g, "").toUpperCase();
    if (iban && !/^SA\d{22}$/.test(iban)) throw bad("رقم الآيبان يجب أن يبدأ بـ SA ويتكون من 24 خانة");
    upd.iban = iban || null;
  }
  if (b.isActive !== undefined) {
    if (!b.isActive) {
      if (a.systemKey) throw bad("لا يمكن تعطيل حساب أساسي مستخدم في القيود الآلية — يمكنك إعادة تسميته");
      const bal = await t.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id=$1 AND e.status='POSTED'`, [id]);
      if (Math.abs(Number(bal.b)) > 0.004) throw bad(`لا يمكن تعطيل حساب رصيده ${r2(bal.b)} — حوّل الرصيد أولاً`);
    }
    upd.isActive = !!b.isActive;
  }
  return t.update("accounts", { id, companyId }, upd);
}

export async function createCashAccount(t: Db, companyId: string, b: any) {
  const kind = b.kind === "BANK" ? "BANK" : "CASH";
  const parent = await t.one(`SELECT * FROM accounts WHERE company_id=$1 AND code=$2`, [companyId, kind === "BANK" ? "1102" : "1101"], "مجموعة الحسابات غير موجودة");
  const name = String(b.nameAr || "").trim();
  if (!name) throw bad("اسم الحساب مطلوب");
  const last = await t.maybe(`SELECT code FROM accounts WHERE company_id=$1 AND parent_id=$2 ORDER BY code DESC LIMIT 1`, [companyId, parent.id]);
  const code = last ? String(Number(last.code) + 1) : parent.code + "01";
  const iban = String(b.iban || "").replace(/\s/g, "").toUpperCase();
  if (iban && !/^SA\d{22}$/.test(iban)) throw bad("رقم الآيبان يجب أن يبدأ بـ SA ويتكون من 24 خانة");
  return t.insert("accounts", { companyId, code, nameAr: name, nameEn: b.nameEn || null, type: "ASSET", subtype: parent.subtype, parentId: parent.id, level: parent.level + 1, isGroup: false, isSystem: false, isCashBank: true, bankName: b.bankName || null, iban: iban || null, bankAccountNo: b.bankAccountNo || null });
}

// ─── chart of accounts: latest lines ───────────────────────────────────────
export async function accountLines(t: Db, companyId: string, id: string, limit = 15) {
  const a = await t.one(`SELECT id, code, name_ar, is_group FROM accounts WHERE id=$1 AND company_id=$2`, [id, companyId], "الحساب غير موجود");
  const ids = a.isGroup ? (await t.rows(`WITH RECURSIVE c AS (SELECT id FROM accounts WHERE id=$1 UNION ALL SELECT x.id FROM accounts x JOIN c ON x.parent_id=c.id) SELECT id FROM c`, [id])).map((r: any) => r.id) : [id];
  const rows = await t.rows(
    `SELECT l.id, e.id entry_id, e.number, e.date, e.type, e.memo, l.description, l.debit, l.credit, ac.code, ac.name_ar account_name, pt.name partner_name, e.source_type, e.source_id
     FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts ac ON ac.id=l.account_id LEFT JOIN partners pt ON pt.id=l.partner_id
     WHERE l.company_id=$1 AND l.account_id = ANY($2::uuid[]) AND e.status='POSTED' ORDER BY e.date DESC, e.created_at DESC LIMIT ${Math.min(200, Math.max(5, limit))}`, [companyId, ids]);
  const tot = await t.one(`SELECT COUNT(*)::int n, COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.company_id=$1 AND l.account_id = ANY($2::uuid[]) AND e.status='POSTED'`, [companyId, ids]);
  return { account: a, rows, count: tot.n, debit: r2(tot.d), credit: r2(tot.c), balance: r2(Number(tot.d) - Number(tot.c)) };
}

// ─── inventory reports ─────────────────────────────────────────────────────
const SRC_AR: Record<string, string> = { INVOICE: "مبيعات / مشتريات", PURCHASE: "مشتريات", SALE: "مبيعات", POS: "نقاط البيع", OPENING: "أرصدة افتتاحية", ADJUSTMENT: "جرد وتسويات وإتلاف", TRANSFER: "تحويلات بين المستودعات", LANDED: "تكاليف استيراد", RETURN: "مرتجعات" };
export async function countSheet(t: Db, companyId: string, q: any) {
  const params: any[] = [companyId];
  let w = "p.company_id=$1 AND p.type='STOCK' AND p.is_active";
  if (q.categoryId) { params.push(q.categoryId); w += ` AND p.category_id=$${params.length}`; }
  params.push(q.warehouseId || null);
  const whp = params.length;
  const rows = await t.rows(
    `SELECT p.sku, p.barcode, p.name, p.unit, c.name category, COALESCE(SUM(b.qty),0) system_qty, COALESCE(SUM(b.value),0) value
     FROM products p LEFT JOIN product_categories c ON c.id=p.category_id LEFT JOIN stock_balances b ON b.product_id=p.id AND ($${whp}::uuid IS NULL OR b.warehouse_id=$${whp}::uuid)
     WHERE ${w} GROUP BY p.id, c.name ORDER BY c.name NULLS LAST, p.name`, params);
  const wh = q.warehouseId ? await t.maybe(`SELECT name FROM warehouses WHERE id=$1 AND company_id=$2`, [q.warehouseId, companyId]) : null;
  return { warehouse: wh?.name || "كل المستودعات", date: today(), rows: q.nonzero ? rows.filter((r: any) => Number(r.systemQty) !== 0) : rows };
}

export async function inventoryOpsSummary(t: Db, companyId: string, q: any) {
  const from = isDate(q.from) ? q.from : today().slice(0, 8) + "01", to = isDate(q.to) ? q.to : today();
  const params: any[] = [companyId, from, to];
  let wh = "";
  if (q.warehouseId) { params.push(q.warehouseId); wh = ` AND m.warehouse_id=$${params.length}`; }
  const rows = await t.rows(
    `SELECT m.source_type, CASE WHEN m.qty >= 0 THEN 'IN' ELSE 'OUT' END dir, COUNT(*)::int moves, COUNT(DISTINCT m.product_id)::int products, SUM(m.qty) qty, SUM(m.value) value
     FROM stock_moves m WHERE m.company_id=$1 AND m.date BETWEEN $2 AND $3${wh} GROUP BY 1,2 ORDER BY 2, 1`, params);
  const open = await t.one(`SELECT COALESCE(SUM(m.value),0) v, COALESCE(SUM(m.qty),0) q FROM stock_moves m WHERE m.company_id=$1 AND m.date < $2${wh.replace(`$${params.length}`, "$3")}`, q.warehouseId ? [companyId, from, q.warehouseId] : [companyId, from]);
  const inV = rows.filter((r: any) => r.dir === "IN").reduce((a: number, r: any) => a + Number(r.value), 0);
  const outV = rows.filter((r: any) => r.dir === "OUT").reduce((a: number, r: any) => a + Number(r.value), 0);
  return { from, to, opening: r2(open.v), inValue: r2(inV), outValue: r2(-outV), closing: r2(Number(open.v) + inV + outV), rows: rows.map((r: any) => ({ ...r, typeAr: `${SRC_AR[r.sourceType] || r.sourceType} — ${r.dir === "IN" ? "وارد" : "صادر"}`, qty: Math.abs(Number(r.qty)), value: r2(Math.abs(Number(r.value))) })) };
}

// ─── product profile ───────────────────────────────────────────────────────
export async function productProfile(t: Db, companyId: string, id: string) {
  const p = await t.one(
    `SELECT p.id, p.sku, p.barcode, p.name, p.name_en, p.type, p.unit, p.sale_price, p.purchase_price, p.tax_code, p.reorder_level, p.is_active, p.track_lots, p.shelf_life_days, p.category_id, p.image_updated_at,
       (p.image IS NOT NULL) has_image, c.name category FROM products p LEFT JOIN product_categories c ON c.id=p.category_id WHERE p.id=$1 AND p.company_id=$2`, [id, companyId], "الصنف غير موجود");
  const stock = await t.rows(`SELECT w.id warehouse_id, w.name warehouse, b.qty, b.value, CASE WHEN b.qty <> 0 THEN b.value/b.qty ELSE 0 END avg_cost FROM stock_balances b JOIN warehouses w ON w.id=b.warehouse_id WHERE b.company_id=$1 AND b.product_id=$2 ORDER BY w.name`, [companyId, id]);
  const sales = await t.one(
    `SELECT COALESCE(SUM(CASE WHEN i.kind='CREDIT_NOTE' THEN -l.qty*l.factor ELSE l.qty*l.factor END),0) qty,
       COALESCE(SUM(CASE WHEN i.kind='CREDIT_NOTE' THEN -l.net_amount ELSE l.net_amount END),0) revenue,
       COALESCE(SUM(CASE WHEN i.kind='CREDIT_NOTE' THEN -1 ELSE 1 END * l.qty*l.factor*l.unit_cost),0) cost, MAX(i.date) last_sale
     FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.company_id=$1 AND l.product_id=$2 AND i.direction='SALE' AND i.status='POSTED' AND i.kind IN ('INVOICE','CREDIT_NOTE') AND i.date >= date_trunc('year', CURRENT_DATE)`, [companyId, id]);
  const lastBuy = await t.maybe(
    `SELECT i.date, i.number, i.id, COALESCE(i.partner_name, pt.name) supplier, l.unit_price FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id LEFT JOIN partners pt ON pt.id=i.partner_id
     WHERE i.company_id=$1 AND l.product_id=$2 AND i.direction='PURCHASE' AND i.kind='INVOICE' AND i.status='POSTED' ORDER BY i.date DESC, i.created_at DESC LIMIT 1`, [companyId, id]);
  const uoms = await t.rows(`SELECT name, factor, barcode, sale_price FROM product_uoms WHERE company_id=$1 AND product_id=$2 ORDER BY sort`, [companyId, id]);
  const qty = stock.reduce((a: number, s: any) => a + Number(s.qty), 0), value = stock.reduce((a: number, s: any) => a + Number(s.value), 0);
  return { product: p, stock, totals: { qty, value: r2(value), avgCost: qty ? r2(value / qty) : 0 }, sales: { qty: Number(sales.qty), revenue: r2(sales.revenue), cost: r2(sales.cost), profit: r2(Number(sales.revenue) - Number(sales.cost)), lastSale: sales.lastSale }, lastBuy, uoms };
}
