/** Round 2 routes: public invoice links, bank reconciliation, bulk import, backup export, extra reports. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h, bad, notFound, num, isDate, today, TAX_CODES, r2, D } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import { getInvoice } from "../services/invoices";
import { stockAdjustment } from "../services/misc";

// ─── public (no auth): shareable invoice ───────────────────────────────────
export const pub = Router();
pub.get(
  "/invoice/:token",
  h(async (req) => {
    const token = p(req).token;
    if (!/^[0-9a-f-]{36}$/.test(token)) throw notFound();
    const inv = await db.maybe(`SELECT id, company_id FROM invoices WHERE share_token=$1 AND status='POSTED'`, [token]);
    if (!inv) throw notFound("الرابط غير صالح");
    const doc = await getInvoice(db, inv.companyId, inv.id);
    doc.partner = doc.partnerId ? await db.maybe(`SELECT name, vat_number, phone, city, street, district, building_no FROM partners WHERE id=$1`, [doc.partnerId]) : null;
    doc.company = await db.one(`SELECT name_ar, name_en, vat_number, cr_number, phone, email, logo, street, building_no, additional_no, district, city, postal_code, invoice_footer, invoice_terms FROM companies WHERE id=$1`, [inv.companyId]);
    delete doc.xml; delete doc.zatcaResponse; delete doc.costTotal;
    doc.lines = doc.lines.map((l: any) => { const { unitCost, ...rest } = l; return rest; });
    return doc;
  }),
);

export const extra = Router();
extra.use(authenticate);

// ─── bank reconciliation ───────────────────────────────────────────────────
extra.get(
  "/bank/:accountId/lines",
  perm("accounting.read"),
  h(async (req) => {
    const acc = await db.one(`SELECT * FROM accounts WHERE id=$1 AND company_id=$2 AND is_cash_bank`, [p(req).accountId, cid(req)], "الحساب غير موجود");
    const to = isDate(req.query.to) ? String(req.query.to) : today();
    const rows = await db.rows(
      `SELECT l.id, e.number, e.date, e.type, e.memo, e.reference, l.debit, l.credit, l.description, c.cleared_date
       FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id LEFT JOIN bank_cleared_lines c ON c.line_id=l.id
       WHERE l.account_id=$1 AND e.status='POSTED' AND e.date <= $2 ORDER BY e.date, e.created_at`,
      [acc.id, to],
    );
    const book = r2(rows.reduce((a, r) => a + Number(r.debit) - Number(r.credit), 0));
    const cleared = r2(rows.filter((r) => r.clearedDate).reduce((a, r) => a + Number(r.debit) - Number(r.credit), 0));
    const history = await db.rows(`SELECT * FROM bank_reconciliations WHERE account_id=$1 ORDER BY statement_date DESC LIMIT 12`, [acc.id]);
    return { account: acc, to, rows, bookBalance: book, clearedBalance: cleared, uncleared: r2(book - cleared), history };
  }),
);
extra.post(
  "/bank/:accountId/clear",
  perm("accounting.write"),
  h(async (req) => {
    const ids: string[] = req.body.lineIds || [];
    const cleared = !!req.body.cleared;
    const date = isDate(req.body.date) ? req.body.date : today();
    if (!ids.length) return { ok: true };
    const valid = await db.rows(`SELECT l.id FROM journal_lines l WHERE l.id = ANY($1) AND l.company_id=$2 AND l.account_id=$3`, [ids, cid(req), p(req).accountId]);
    const vids = valid.map((v) => v.id);
    if (cleared) await db.exec(`INSERT INTO bank_cleared_lines(line_id, company_id, cleared_date) SELECT unnest($1::uuid[]), $2, $3 ON CONFLICT (line_id) DO UPDATE SET cleared_date=EXCLUDED.cleared_date`, [vids, cid(req), date]);
    else await db.exec(`DELETE FROM bank_cleared_lines WHERE line_id = ANY($1) AND reconciliation_id IS NULL`, [vids]);
    return { ok: true, count: vids.length };
  }),
);
extra.post(
  "/bank/:accountId/reconcile",
  perm("accounting.write"),
  h(async (req) => {
    const statementBalance = r2(num(req.body.statementBalance));
    const date = isDate(req.body.date) ? req.body.date : today();
    return tx(async (t) => {
      const acc = await t.one(`SELECT id FROM accounts WHERE id=$1 AND company_id=$2 AND is_cash_bank`, [p(req).accountId, cid(req)]);
      const c = await t.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN bank_cleared_lines x ON x.line_id=l.id WHERE l.account_id=$1 AND e.status='POSTED' AND x.cleared_date <= $2`, [acc.id, date]);
      const diff = r2(statementBalance - Number(c.b));
      const rec = await t.insert("bank_reconciliations", { companyId: cid(req), accountId: acc.id, statementDate: date, statementBalance, clearedBalance: r2(c.b), difference: diff, notes: req.body.notes || null, createdBy: actor(req) });
      await t.exec(`UPDATE bank_cleared_lines SET reconciliation_id=$1 WHERE line_id IN (SELECT l.id FROM journal_lines l WHERE l.account_id=$2) AND reconciliation_id IS NULL AND cleared_date <= $3`, [rec.id, acc.id, date]);
      await audit(req, "BANK_RECONCILE", "account", acc.id, { date, statementBalance, diff });
      return rec;
    });
  }),
);

// ─── bulk import (rows parsed client-side from Excel) ──────────────────────
extra.post(
  "/import/products",
  perm("products.write"),
  h(async (req) => {
    const rows: any[] = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) throw bad("لا توجد صفوف");
    if (rows.length > 5000) throw bad("الحد الأقصى 5000 صف في المرة الواحدة");
    const cats = await db.rows(`SELECT id, name FROM product_categories WHERE company_id=$1`, [cid(req)]);
    const result = { created: 0, updated: 0, errors: [] as string[] };
    const opening: { productId: string; qty: number; unitCost: number }[] = [];
    await tx(async (t) => {
      for (const [i, r] of rows.entries()) {
        try {
          const name = String(r.name || "").trim();
          if (!name) throw new Error("الاسم مطلوب");
          const taxCode = String(r.taxCode || "S").toUpperCase();
          if (!TAX_CODES[taxCode]) throw new Error(`رمز ضريبي غير صحيح: ${taxCode}`);
          let categoryId: string | null = null;
          if (r.category) {
            let c = cats.find((x) => x.name === String(r.category).trim());
            if (!c) { c = await t.insert("product_categories", { companyId: cid(req), name: String(r.category).trim() }); cats.push(c); }
            categoryId = c.id;
          }
          const sku = String(r.sku || "").trim() || null;
          const data = { name, nameEn: r.nameEn || null, barcode: r.barcode ? String(r.barcode) : null, type: String(r.type || "STOCK").toUpperCase() === "SERVICE" ? "SERVICE" : "STOCK", categoryId, unit: r.unit || "حبة", salePrice: num(r.salePrice), purchasePrice: num(r.purchasePrice), taxCode, reorderLevel: num(r.reorderLevel) };
          const existing = sku ? await t.maybe(`SELECT id FROM products WHERE company_id=$1 AND sku=$2`, [cid(req), sku]) : null;
          let id: string;
          if (existing) { await t.update("products", { id: existing.id }, data); id = existing.id; result.updated++; }
          else {
            const seq = await t.one(`INSERT INTO sequences(company_id, key, next) VALUES ($1,'CODE-P',2) ON CONFLICT (company_id, key) DO UPDATE SET next=sequences.next+1 RETURNING next-1 AS n`, [cid(req)]);
            const row = await t.insert("products", { companyId: cid(req), sku: sku || `P-${String(seq.n).padStart(4, "0")}`, ...data });
            id = row.id; result.created++;
          }
          if (num(r.openingQty) > 0 && data.type === "STOCK") opening.push({ productId: id, qty: num(r.openingQty), unitCost: num(r.purchasePrice) });
        } catch (e: any) {
          result.errors.push(`صف ${i + 2}: ${e.message}`);
        }
      }
      if (result.errors.length && req.body.strict) throw bad("توجد أخطاء — لم يُستورد شيء", result.errors);
      if (opening.length) await stockAdjustment(t, cid(req), actor(req), { kind: "OPENING", date: isDate(req.body.openingDate) ? req.body.openingDate : today(), lines: opening, notes: "استيراد من Excel" });
    });
    await audit(req, "IMPORT", "product", null, { created: result.created, updated: result.updated });
    return result;
  }),
);
extra.post(
  "/import/partners",
  perm("partners.write"),
  h(async (req) => {
    const rows: any[] = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) throw bad("لا توجد صفوف");
    const role = req.body.role === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER";
    const result = { created: 0, updated: 0, errors: [] as string[] };
    await tx(async (t) => {
      for (const [i, r] of rows.entries()) {
        try {
          const name = String(r.name || "").trim();
          if (!name) throw new Error("الاسم مطلوب");
          if (r.vatNumber && !/^3\d{13}3$/.test(String(r.vatNumber))) throw new Error("رقم ضريبي غير صحيح");
          const data = { name, nameEn: r.nameEn || null, kind: String(r.kind || "").includes("فرد") || String(r.kind).toUpperCase() === "INDIVIDUAL" ? "INDIVIDUAL" : "COMPANY", vatNumber: r.vatNumber ? String(r.vatNumber) : null, crNumber: r.crNumber ? String(r.crNumber) : null, phone: r.phone ? String(r.phone) : null, email: r.email || null, street: r.street || null, buildingNo: r.buildingNo ? String(r.buildingNo) : null, district: r.district || null, city: r.city || null, postalCode: r.postalCode ? String(r.postalCode) : null, creditLimit: num(r.creditLimit), paymentTerms: Math.round(num(r.paymentTerms)), isCustomer: role === "CUSTOMER", isSupplier: role === "SUPPLIER" };
          const code = String(r.code || "").trim();
          const existing = code ? await t.maybe(`SELECT id FROM partners WHERE company_id=$1 AND code=$2`, [cid(req), code]) : await t.maybe(`SELECT id FROM partners WHERE company_id=$1 AND name=$2`, [cid(req), name]);
          if (existing) { await t.update("partners", { id: existing.id }, { ...data, isCustomer: undefined, isSupplier: undefined }); await t.exec(`UPDATE partners SET is_customer = is_customer OR $2, is_supplier = is_supplier OR $3 WHERE id=$1`, [existing.id, data.isCustomer, data.isSupplier]); result.updated++; }
          else {
            const seq = await t.one(`INSERT INTO sequences(company_id, key, next) VALUES ($1,$2,2) ON CONFLICT (company_id, key) DO UPDATE SET next=sequences.next+1 RETURNING next-1 AS n`, [cid(req), role === "CUSTOMER" ? "CODE-C" : "CODE-S"]);
            await t.insert("partners", { companyId: cid(req), code: code || `${role === "CUSTOMER" ? "C" : "S"}-${String(seq.n).padStart(4, "0")}`, ...data });
            result.created++;
          }
        } catch (e: any) {
          result.errors.push(`صف ${i + 2}: ${e.message}`);
        }
      }
    });
    await audit(req, "IMPORT", "partner", null, { role, created: result.created, updated: result.updated });
    return result;
  }),
);

// ─── full backup export (JSON) ─────────────────────────────────────────────
extra.get(
  "/backup",
  perm("settings.read"),
  h(async (req, res) => {
    if (!["OWNER", "ADMIN"].includes(req.auth.role || "") && !req.auth.superAdmin) throw bad("النسخ الاحتياطي للمالك فقط");
    const tables = ["accounts", "cost_centers", "fiscal_years", "periods", "journal_entries", "partners", "product_categories", "products", "warehouses", "stock_balances", "stock_moves", "stock_adjustments", "invoices", "payments", "expenses", "pos_sessions", "fixed_assets", "asset_depreciations", "vat_returns", "bank_reconciliations", "audit_logs"];
    const out: any = { exportedAt: new Date(), company: await db.one(`SELECT * FROM companies WHERE id=$1`, [cid(req)]) };
    for (const t of tables) out[t] = await db.rows(`SELECT * FROM ${t} WHERE company_id=$1`, [cid(req)]);
    out.journal_lines = await db.rows(`SELECT l.* FROM journal_lines l WHERE l.company_id=$1`, [cid(req)]);
    out.invoice_lines = await db.rows(`SELECT l.* FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.company_id=$1`, [cid(req)]);
    await audit(req, "BACKUP_EXPORT", "company", cid(req));
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="mizan-backup-${today()}.json"`);
    res.send(JSON.stringify(out));
  }),
);

// ─── extra reports ─────────────────────────────────────────────────────────
extra.get(
  "/reports/salespersons",
  perm("reports.read"),
  h(async (req) => {
    const from = isDate(req.query.from) ? req.query.from : "1900-01-01", to = isDate(req.query.to) ? req.query.to : today();
    return db.rows(
      `SELECT COALESCE(created_by,'—') salesperson, COUNT(*)::int invoices, SUM(CASE WHEN kind='CREDIT_NOTE' THEN -total ELSE total END) total, SUM(CASE WHEN kind='CREDIT_NOTE' THEN -(taxable-cost_total) ELSE taxable-cost_total END) gross_profit,
         SUM(CASE WHEN channel='POS' THEN 1 ELSE 0 END)::int pos_tickets
       FROM invoices WHERE company_id=$1 AND direction='SALE' AND status='POSTED' AND kind IN ('INVOICE','CREDIT_NOTE') AND date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY total DESC`,
      [cid(req), from, to],
    );
  }),
);
extra.get(
  "/reports/expenses-by-account",
  perm("reports.read"),
  h(async (req) => {
    const from = isDate(req.query.from) ? req.query.from : "1900-01-01", to = isDate(req.query.to) ? req.query.to : today();
    const byAccount = await db.rows(
      `SELECT a.code, a.name_ar, COALESCE(SUM(l.debit - l.credit),0) amount FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id
       WHERE a.company_id=$1 AND a.type='EXPENSE' AND e.status='POSTED' AND e.type<>'CLOSING' AND e.date BETWEEN $2 AND $3 GROUP BY a.id ORDER BY amount DESC`, [cid(req), from, to]);
    const byMonth = await db.rows(
      `SELECT to_char(e.date,'YYYY-MM') m, a.subtype, COALESCE(SUM(l.debit - l.credit),0) amount FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id
       WHERE a.company_id=$1 AND a.type='EXPENSE' AND e.status='POSTED' AND e.type<>'CLOSING' AND e.date BETWEEN $2 AND $3 GROUP BY 1,2 ORDER BY 1`, [cid(req), from, to]);
    const byCostCenter = await db.rows(
      `SELECT COALESCE(c.code||' '||c.name,'بدون مركز تكلفة') cost_center, COALESCE(SUM(l.debit - l.credit),0) amount FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id LEFT JOIN cost_centers c ON c.id=l.cost_center_id
       WHERE a.company_id=$1 AND a.type='EXPENSE' AND e.status='POSTED' AND e.type<>'CLOSING' AND e.date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY amount DESC`, [cid(req), from, to]);
    return { from, to, byAccount, byMonth, byCostCenter, total: r2(byAccount.reduce((a, r) => a + Number(r.amount), 0)) };
  }),
);
