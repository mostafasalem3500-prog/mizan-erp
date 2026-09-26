/**
 * Sales & purchase documents (quotation → order → invoice → credit/debit note)
 * and their automatic accounting/inventory effects.
 */
import { Db } from "../db/pool";
import { AppError, bad, conflict, notFound, calcLine, r2, r3, r4, D, num, sum, isDate, addDays, TAX_CODES, today } from "../lib/core";
import { post, nextNumber, assertOpenDate, accountByKey, Line } from "../accounting/engine";
import { stockIn, stockOut, avgCost } from "../accounting/stock";
import { stampInvoice } from "../zatca/stamp";

export const PREFIX: Record<string, Record<string, string>> = {
  SALE: { QUOTATION: "QT", ORDER: "SO", INVOICE: "INV", CREDIT_NOTE: "CN", DEBIT_NOTE: "DN" },
  PURCHASE: { QUOTATION: "RFQ", ORDER: "PO", INVOICE: "BILL", CREDIT_NOTE: "PR", DEBIT_NOTE: "PDN" },
};

export interface LineInput {
  productId?: string | null;
  accountId?: string | null;
  description?: string;
  qty: number;
  unitPrice: number;
  discountPct?: number;
  taxCode?: string;
}

export interface InvoiceInput {
  direction: "SALE" | "PURCHASE";
  kind: string;
  date?: string;
  dueDate?: string | null;
  partnerId?: string | null;
  warehouseId?: string | null;
  branchId?: string | null;
  invoiceType?: string;
  originId?: string | null;
  supplierRef?: string | null;
  reason?: string | null;
  notes?: string | null;
  lines: LineInput[];
  channel?: string;
  isDemo?: boolean;
  pricesIncludeVat?: boolean;
}

export async function defaultWarehouse(t: Db, companyId: string) {
  const w = await t.maybe(`SELECT id FROM warehouses WHERE company_id=$1 ORDER BY is_default DESC, code LIMIT 1`, [companyId]);
  if (!w) throw bad("لا يوجد مستودع معرف");
  return w.id as string;
}

async function buildLines(t: Db, companyId: string, input: InvoiceInput, pricesIncludeVat: boolean) {
  if (!Array.isArray(input.lines) || !input.lines.length) throw bad("أضف بنداً واحداً على الأقل");
  const productIds = input.lines.map((l) => l.productId).filter(Boolean) as string[];
  const products = productIds.length
    ? await t.rows(`SELECT * FROM products WHERE company_id=$1 AND id = ANY($2)`, [companyId, productIds])
    : [];
  const pmap = new Map(products.map((p) => [p.id, p]));
  return input.lines.map((l, i) => {
    const p = l.productId ? pmap.get(l.productId) : null;
    if (l.productId && !p) throw bad(`الصنف في السطر ${i + 1} غير موجود`);
    const qty = r3(num(l.qty));
    if (qty <= 0) throw bad(`الكمية في السطر ${i + 1} يجب أن تكون أكبر من صفر`);
    const unitPrice = r4(num(l.unitPrice));
    if (unitPrice < 0) throw bad(`السعر في السطر ${i + 1} لا يمكن أن يكون سالباً`);
    const discountPct = num(l.discountPct);
    if (discountPct < 0 || discountPct > 100) throw bad(`نسبة الخصم في السطر ${i + 1} غير صحيحة`);
    let taxCode = l.taxCode || p?.taxCode || "S";
    if (!TAX_CODES[taxCode]) throw bad(`رمز ضريبي غير معروف في السطر ${i + 1}`);
    if (input.direction === "SALE" && (taxCode === "IM" || taxCode === "RC")) throw bad("رموز الاستيراد تخص المشتريات فقط");
    const c = calcLine(qty, unitPrice, discountPct, taxCode, pricesIncludeVat);
    return {
      productId: p?.id || null,
      accountId: l.accountId || null,
      description: (l.description || p?.name || "").trim() || `بند ${i + 1}`,
      qty,
      unitPrice,
      discountPct,
      taxCode,
      taxRate: c.rate,
      netAmount: c.net,
      vatAmount: c.vat,
      total: c.total,
      discount: c.discount,
      product: p,
      sort: i,
    };
  });
}

/** Creates (or replaces, when id given) an unposted document. */
export async function saveDraft(t: Db, company: any, user: string, input: InvoiceInput, id?: string) {
  const companyId = company.id;
  if (!["SALE", "PURCHASE"].includes(input.direction)) throw bad("نوع المستند غير صحيح");
  if (!PREFIX.SALE[input.kind]) throw bad("نوع المستند غير صحيح");
  const date = input.date || today();
  if (!isDate(date)) throw bad("التاريخ غير صحيح");
  if (!input.partnerId) throw bad(input.direction === "SALE" ? "اختر العميل" : "اختر المورد");
  const partner = await t.one(`SELECT * FROM partners WHERE id=$1 AND company_id=$2`, [input.partnerId, companyId], "الطرف غير موجود");
  const incl = input.pricesIncludeVat ?? (input.direction === "SALE" ? !!company.pricesIncludeVat : false);
  const lines = await buildLines(t, companyId, input, incl);
  const subtotal = sum(lines, (l) => D(l.netAmount).plus(l.discount));
  const discountTotal = sum(lines, (l) => l.discount);
  const taxable = sum(lines, (l) => l.netAmount);
  const vatTotal = sum(lines, (l) => l.vatAmount);
  const total = r2(D(taxable).plus(vatTotal));
  let invoiceType = input.invoiceType || (partner.vatNumber ? "STANDARD" : "SIMPLIFIED");
  if (input.direction === "PURCHASE") invoiceType = "STANDARD";

  if (input.kind === "CREDIT_NOTE" || input.kind === "DEBIT_NOTE") {
    if (!input.originId) throw bad("الإشعار الدائن/المدين يجب أن يرتبط بالفاتورة الأصلية");
    const origin = await t.one(`SELECT * FROM invoices WHERE id=$1 AND company_id=$2`, [input.originId, companyId], "الفاتورة الأصلية غير موجودة");
    if (origin.kind !== "INVOICE" || origin.status !== "POSTED" || origin.direction !== input.direction) throw bad("يجب ربط الإشعار بفاتورة مرحلة من نفس النوع");
    if (origin.partnerId !== input.partnerId) throw bad("الإشعار يجب أن يكون لنفس طرف الفاتورة الأصلية");
    if (input.direction === "SALE" && !input.reason) throw bad("سبب إصدار الإشعار مطلوب (متطلب هيئة الزكاة)");
    invoiceType = origin.invoiceType;
  }

  const doc: any = {
    companyId,
    direction: input.direction,
    kind: input.kind,
    channel: input.channel || "BACKOFFICE",
    date,
    dueDate: input.dueDate || (partner.paymentTerms ? addDays(date, partner.paymentTerms) : date),
    partnerId: partner.id,
    partnerName: partner.name,
    partnerVat: partner.vatNumber,
    warehouseId: input.warehouseId || (await defaultWarehouse(t, companyId)),
    branchId: input.branchId || null,
    invoiceType,
    originId: input.originId || null,
    supplierRef: input.supplierRef || null,
    reason: input.reason || null,
    notes: input.notes || null,
    subtotal,
    discountTotal,
    taxable,
    vatTotal,
    total,
    isDemo: !!input.isDemo,
  };
  let inv: any;
  if (id) {
    const cur = await t.one(`SELECT * FROM invoices WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId]);
    if (cur.status !== "DRAFT") throw conflict("لا يمكن تعديل مستند مرحل أو محول");
    inv = await t.update("invoices", { id }, { ...doc, updatedAt: new Date() });
    await t.exec(`DELETE FROM invoice_lines WHERE invoice_id=$1`, [id]);
  } else {
    const isNumberedDraft = input.kind === "QUOTATION" || input.kind === "ORDER";
    doc.number = isNumberedDraft
      ? await nextNumber(t, companyId, PREFIX[input.direction][input.kind], date)
      : `DRAFT-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    doc.createdBy = user;
    inv = await t.insert("invoices", doc);
  }
  await t.insertMany(
    "invoice_lines",
    lines.map((l) => ({
      invoiceId: inv.id, productId: l.productId, accountId: l.accountId, description: l.description, qty: l.qty,
      unitPrice: l.unitPrice, discountPct: l.discountPct, taxCode: l.taxCode, taxRate: l.taxRate,
      netAmount: l.netAmount, vatAmount: l.vatAmount, total: l.total, unitCost: 0, sort: l.sort,
    })),
  );
  return inv;
}

export async function getInvoice(t: Db, companyId: string, id: string) {
  const inv = await t.one(`SELECT * FROM invoices WHERE id=$1 AND company_id=$2`, [id, companyId], "المستند غير موجود");
  inv.lines = await t.rows(
    `SELECT l.*, p.sku, p.unit, p.barcode FROM invoice_lines l LEFT JOIN products p ON p.id=l.product_id WHERE l.invoice_id=$1 ORDER BY l.sort`,
    [id],
  );
  return inv;
}

/** Posts an INVOICE / CREDIT_NOTE / DEBIT_NOTE: numbering, stock, journal, ZATCA stamp. */
export async function postInvoice(t: Db, company: any, id: string, user: string, opts: { tenders?: { method: string; amount: number; accountId?: string }[]; posSessionId?: string } = {}) {
  const companyId = company.id;
  const inv = await t.one(`SELECT * FROM invoices WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "المستند غير موجود");
  if (inv.status !== "DRAFT") throw conflict("المستند مرحل مسبقاً");
  if (!["INVOICE", "CREDIT_NOTE", "DEBIT_NOTE"].includes(inv.kind)) throw bad("عروض الأسعار والأوامر لا تُرحّل محاسبياً — حوّلها إلى فاتورة");
  await assertOpenDate(t, companyId, inv.date);
  const lines = await t.rows(`SELECT l.*, p.type AS ptype, p.name AS pname, p.purchase_price FROM invoice_lines l LEFT JOIN products p ON p.id=l.product_id WHERE invoice_id=$1 ORDER BY sort`, [id]);
  const number = await nextNumber(t, companyId, inv.channel === "POS" ? (inv.kind === "INVOICE" ? "POS" : "PRT") : PREFIX[inv.direction][inv.kind], inv.date);
  const isSale = inv.direction === "SALE";
  const isReturn = inv.kind === "CREDIT_NOTE";
  const ref = number;
  const jl: Line[] = [];
  let costTotal = 0;

  const origin = inv.originId ? await t.maybe(`SELECT * FROM invoices WHERE id=$1`, [inv.originId]) : null;
  const originLines = origin ? await t.rows(`SELECT * FROM invoice_lines WHERE invoice_id=$1`, [origin.id]) : [];

  if (isReturn && origin) {
    // cannot return more than was invoiced (net of previous returns)
    const prev = await t.rows(
      `SELECT l.product_id, SUM(l.qty) q FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id
       WHERE i.origin_id=$1 AND i.kind='CREDIT_NOTE' AND i.status='POSTED' AND l.product_id IS NOT NULL GROUP BY l.product_id`,
      [origin.id],
    );
    for (const l of lines.filter((x) => x.productId)) {
      const sold = originLines.filter((o) => o.productId === l.productId).reduce((a, o) => a + Number(o.qty), 0);
      const already = Number(prev.find((p) => p.productId === l.productId)?.q || 0);
      if (Number(l.qty) > sold - already + 1e-9) throw bad(`كمية المرتجع للصنف «${l.description}» تتجاوز المتبقي في الفاتورة الأصلية (${r3(sold - already)})`);
    }
    const prevTotal = await t.one(`SELECT COALESCE(SUM(total),0) s FROM invoices WHERE origin_id=$1 AND kind='CREDIT_NOTE' AND status='POSTED'`, [origin.id]);
    if (Number(inv.total) > Number(origin.total) - Number(prevTotal.s) + 0.001) throw bad("قيمة الإشعار الدائن تتجاوز المتبقي من الفاتورة الأصلية");
  }

  // ── inventory effects ──
  for (const l of lines) {
    if (!l.productId || l.ptype !== "STOCK") continue;
    const q = Number(l.qty);
    const base = { productId: l.productId, warehouseId: inv.warehouseId, qty: q, date: inv.date, sourceId: inv.id, reference: ref, isDemo: inv.isDemo };
    let cost = 0;
    if (isSale && !isReturn) {
      cost = await stockOut(t, companyId, { ...base, sourceType: inv.channel === "POS" ? "POS" : "SALE", allowNegative: company.allowNegativeStock, fallbackCost: Number(l.purchasePrice), productName: l.pname });
    } else if (isSale && isReturn) {
      const ol = originLines.find((o) => o.productId === l.productId);
      const unit = ol ? Number(ol.unitCost) : await avgCost(t, companyId, l.productId, inv.warehouseId);
      cost = await stockIn(t, companyId, { ...base, sourceType: "SALE_RETURN", unitCost: unit });
    } else if (!isSale && !isReturn) {
      cost = await stockIn(t, companyId, { ...base, sourceType: "PURCHASE", value: Number(l.netAmount) });
    } else {
      cost = await stockOut(t, companyId, { ...base, sourceType: "PURCHASE_RETURN", allowNegative: false, productName: l.pname });
    }
    costTotal = r2(D(costTotal).plus(cost));
    await t.exec(`UPDATE invoice_lines SET unit_cost=$2 WHERE id=$1`, [l.id, q ? r4(D(cost).div(q)) : 0]);
    l._cost = cost;
  }

  // ── journal ──
  const partnerId = inv.partnerId;
  const desc = `${inv.partnerName || ""}`;
  if (isSale) {
    const revenue = (l: any) => (l.accountId ? { account: l.accountId } : { key: l.ptype === "SERVICE" || !l.productId ? "SERVICE_REVENUE" : "SALES" });
    const s = isReturn ? -1 : 1; // credit note mirrors
    if (!isReturn) {
      if (opts.tenders?.length) {
        for (const tnd of opts.tenders) {
          const accKey = tnd.method === "CASH" ? "POS_CASH" : "CARD_CLEARING";
          jl.push({ ...(tnd.accountId ? { account: tnd.accountId } : { key: accKey }), debit: tnd.amount, description: `تحصيل ${tnd.method === "CASH" ? "نقدي" : "شبكة/بطاقة"} ${ref}` });
        }
      } else jl.push({ key: "AR", debit: inv.total, partnerId, description: desc });
    } else {
      if (opts.tenders?.length) {
        for (const tnd of opts.tenders) jl.push({ ...(tnd.accountId ? { account: tnd.accountId } : { key: tnd.method === "CASH" ? "POS_CASH" : "CARD_CLEARING" }), credit: tnd.amount, description: `رد مبلغ ${ref}` });
      } else jl.push({ key: "AR", credit: inv.total, partnerId, description: desc });
    }
    for (const l of lines) {
      const acc = isReturn && !l.accountId ? { key: "SALES_RETURNS" } : revenue(l);
      if (s > 0) jl.push({ ...acc, credit: Number(l.netAmount), description: l.description });
      else jl.push({ ...acc, debit: Number(l.netAmount), description: l.description });
    }
    const vat = Number(inv.vatTotal);
    if (vat) jl.push(s > 0 ? { key: "VAT_OUT", credit: vat, description: `ضريبة مخرجات ${ref}` } : { key: "VAT_OUT", debit: vat, description: `ضريبة مخرجات ${ref}` });
    if (costTotal) {
      if (s > 0) jl.push({ key: "COGS", debit: costTotal, description: `تكلفة ${ref}` }, { key: "INVENTORY", credit: costTotal, description: `تكلفة ${ref}` });
      else jl.push({ key: "INVENTORY", debit: costTotal, description: `مرتجع ${ref}` }, { key: "COGS", credit: costTotal, description: `مرتجع ${ref}` });
    }
  } else {
    // purchases
    const dr = isReturn ? "credit" : "debit";
    const cr = isReturn ? "debit" : "credit";
    let rcVat = 0;
    for (const l of lines) {
      const net = Number(l.netAmount);
      if (l.productId && l.ptype === "STOCK") {
        if (!isReturn) jl.push({ key: "INVENTORY", debit: net, description: l.description });
        else {
          jl.push({ key: "INVENTORY", credit: l._cost, description: l.description });
          const diff = r2(D(net).minus(l._cost)); // return price vs average cost
          if (diff) jl.push({ key: "COGS", credit: diff, description: `فرق تكلفة مرتجع ${l.description}` });
        }
      } else {
        jl.push({ ...(l.accountId ? { account: l.accountId } : { key: "PURCHASE_EXPENSE" }), [dr]: net, description: l.description } as Line);
      }
      if (l.taxCode === "RC") rcVat = r2(D(rcVat).plus(D(net).times(0.15)));
    }
    const vat = Number(inv.vatTotal);
    if (vat) jl.push({ key: "VAT_IN", [dr]: vat, description: `ضريبة مدخلات ${ref}` } as Line);
    if (rcVat) {
      jl.push({ key: "VAT_IN", [dr]: rcVat, description: `احتساب عكسي ${ref}` } as Line);
      jl.push({ key: "VAT_OUT", [cr]: rcVat, description: `احتساب عكسي ${ref}` } as Line);
    }
    jl.push({ key: "AP", [cr]: Number(inv.total), partnerId, description: desc } as Line);
  }

  const kindAr = isSale ? (isReturn ? "إشعار دائن / مرتجع مبيعات" : inv.kind === "DEBIT_NOTE" ? "إشعار مدين" : "فاتورة مبيعات") : isReturn ? "مرتجع مشتريات" : inv.kind === "DEBIT_NOTE" ? "إشعار مدين مورد" : "فاتورة مشتريات";
  const entry = await post(t, companyId, {
    date: inv.date,
    type: inv.channel === "POS" ? "POS" : isSale ? (isReturn ? "SALES_RETURN" : "SALES") : isReturn ? "PURCHASE_RETURN" : "PURCHASE",
    sourceType: "INVOICE",
    sourceId: inv.id,
    reference: ref,
    memo: `${kindAr} ${ref} — ${inv.partnerName || ""}`,
    isDemo: inv.isDemo,
    createdBy: user,
    lines: jl,
  });

  let amountPaid = 0;
  if (opts.tenders?.length) amountPaid = Number(inv.total);
  await t.update("invoices", { id }, {
    number, status: "POSTED", journalId: entry?.id || null, costTotal, amountPaid,
    paymentStatus: amountPaid >= Number(inv.total) ? "PAID" : "UNPAID", issuedAt: new Date(), updatedAt: new Date(),
    tenders: opts.tenders || null, posSessionId: opts.posSessionId || null,
  });

  // credit note automatically settles the original invoice's open balance
  if (isReturn && origin && !opts.tenders?.length) {
    const residual = r2(D(origin.total).minus(origin.amountPaid));
    const apply = Math.min(residual, Number(inv.total));
    if (apply > 0) {
      await applySettlement(t, origin.id, apply);
      await applySettlement(t, inv.id, apply);
    }
  }
  if (inv.kind !== "INVOICE" && origin && isReturn && Number(inv.total) >= Number(origin.total) - 0.001) {
    // fully returned
  }

  if (isSale) await stampInvoice(t, company, id);
  return getInvoice(t, companyId, id);
}

export async function applySettlement(t: Db, invoiceId: string, amount: number) {
  const inv = await t.one(`SELECT total, amount_paid FROM invoices WHERE id=$1 FOR UPDATE`, [invoiceId]);
  const paid = r2(D(inv.amountPaid).plus(amount));
  if (paid > Number(inv.total) + 0.001) throw bad("المبلغ المخصص يتجاوز المتبقي على المستند");
  if (paid < -0.001) throw bad("تخصيص غير صحيح");
  const status = paid >= Number(inv.total) - 0.001 ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID";
  await t.exec(`UPDATE invoices SET amount_paid=$2, payment_status=$3, updated_at=now() WHERE id=$1`, [invoiceId, paid, status]);
}

/** quotation → order → invoice (copies lines, keeps traceability) */
export async function convert(t: Db, company: any, id: string, user: string, toKind: string) {
  const src = await getInvoice(t, company.id, id);
  if (!["QUOTATION", "ORDER"].includes(src.kind)) throw bad("يمكن التحويل من عرض سعر أو أمر فقط");
  if (src.status === "CONVERTED") throw conflict("تم تحويل هذا المستند مسبقاً");
  const draft = await saveDraft(t, company, user, {
    direction: src.direction, kind: toKind, date: today(), partnerId: src.partnerId, warehouseId: src.warehouseId,
    invoiceType: src.invoiceType, originId: null, notes: src.notes, isDemo: src.isDemo,
    lines: src.lines.map((l: any) => ({ productId: l.productId, accountId: l.accountId, description: l.description, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct, taxCode: l.taxCode })),
    pricesIncludeVat: false,
  });
  await t.exec(`UPDATE invoices SET notes = COALESCE(notes,'') || $2 WHERE id=$1`, [draft.id, ` (من ${src.number})`]);
  await t.exec(`UPDATE invoices SET status='CONVERTED', updated_at=now() WHERE id=$1`, [id]);
  return draft;
}
