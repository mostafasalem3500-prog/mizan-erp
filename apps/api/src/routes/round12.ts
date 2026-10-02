/** Round 12 routes: global quick search (Ctrl+K). */
import { Router } from "express";
import { db } from "../db/pool";
import { h } from "../lib/core";
import { authenticate, perm, cid, can } from "../lib/auth";
import { runAccountingSelfCheck } from "../services/selfcheck";
import { AppError } from "../lib/core";

export const r12 = Router();
r12.use(authenticate);

/** One box for everything: documents by number/customer, partners by name/phone/VAT, products by SKU/barcode/name, vouchers. */
r12.get("/search", perm("dashboard.read"), h(async (req) => {
  const raw = String(req.query.q || "").trim().slice(0, 60);
  if (raw.length < 2) return { results: [] };
  const like = `%${raw}%`;
  const role = req.auth.role;
  const locked = req.auth.lockedBranchId || null;
  const out: any[] = [];
  const tasks: Promise<void>[] = [];
  if (can(role, "sales.read") || can(role, "purchases.read")) tasks.push((async () => {
    const rows = await db.rows(
      `SELECT id, number, kind, direction, partner_name, total, date, status, channel FROM invoices
       WHERE company_id=$1 AND (number ILIKE $2 OR partner_name ILIKE $2 OR supplier_ref ILIKE $2 OR external_ref ILIKE $2) ${locked ? "AND branch_id=$3" : ""}
       ORDER BY date DESC, created_at DESC LIMIT 8`, locked ? [cid(req), like, locked] : [cid(req), like]);
    for (const r of rows) out.push({ type: "doc", id: r.id, title: r.number, sub: `${r.partnerName || ""} · ${String(r.date).slice(0, 10)}`, amount: Number(r.total), kind: r.kind, direction: r.direction, status: r.status, to: `/doc/${r.id}` });
  })());
  if (can(role, "partners.read")) tasks.push((async () => {
    const rows = await db.rows(
      `SELECT id, code, name, phone, vat_number, is_customer, is_supplier FROM partners
       WHERE company_id=$1 AND (name ILIKE $2 OR code ILIKE $2 OR phone ILIKE $2 OR vat_number ILIKE $2 OR email ILIKE $2) ORDER BY name LIMIT 6`, [cid(req), like]);
    for (const r of rows) out.push({ type: "partner", id: r.id, title: r.name, sub: [r.code, r.phone, r.vatNumber].filter(Boolean).join(" · "), role: r.isCustomer ? "CUSTOMER" : "SUPPLIER", to: `${r.isCustomer ? "/customers" : "/suppliers"}?q=${encodeURIComponent(r.name)}` });
  })());
  if (can(role, "products.read")) tasks.push((async () => {
    const rows = await db.rows(
      `SELECT p.id, p.sku, p.name, p.sale_price, p.barcode FROM products p
       WHERE p.company_id=$1 AND p.is_active AND (p.name ILIKE $2 OR p.sku ILIKE $2 OR p.barcode=$3 OR EXISTS (SELECT 1 FROM product_uoms u WHERE u.product_id=p.id AND u.barcode=$3)) ORDER BY p.name LIMIT 6`, [cid(req), like, raw]);
    for (const r of rows) out.push({ type: "product", id: r.id, title: r.name, sub: `${r.sku}${r.barcode ? " · " + r.barcode : ""}`, amount: Number(r.salePrice), to: `/products?q=${encodeURIComponent(r.sku)}` });
  })());
  if (can(role, "payments.read")) tasks.push((async () => {
    const rows = await db.rows(
      `SELECT p.id, p.number, p.direction, p.amount, p.date, pr.name FROM payments p JOIN partners pr ON pr.id=p.partner_id
       WHERE p.company_id=$1 AND (p.number ILIKE $2 OR p.reference ILIKE $2) ${locked ? "AND EXISTS (SELECT 1 FROM journal_entries e WHERE e.id=p.journal_id AND e.branch_id=$3)" : ""} ORDER BY p.date DESC LIMIT 5`, locked ? [cid(req), like, locked] : [cid(req), like]);
    for (const r of rows) out.push({ type: "payment", id: r.id, title: r.number, sub: `${r.name} · ${String(r.date).slice(0, 10)}`, amount: Number(r.amount), direction: r.direction, to: r.direction === "IN" ? `/receipts?q=${encodeURIComponent(r.number)}` : `/vouchers?q=${encodeURIComponent(r.number)}` });
  })());
  await Promise.all(tasks);
  // exact number / SKU hits first
  const q = raw.toLowerCase();
  out.sort((a, b) => Number(b.title.toLowerCase() === q) - Number(a.title.toLowerCase() === q));
  return { results: out };
}));

/** Runs the scripted dummy-company accounting cycle (rolled back) and returns every assertion. */
let selfcheckRunning = false;
r12.post("/selfcheck", perm("reports.read"), h(async () => {
  if (selfcheckRunning) throw new AppError(429, "الفحص قيد التشغيل — حاول بعد ثوانٍ", "BUSY");
  selfcheckRunning = true;
  try { return await runAccountingSelfCheck(); } finally { selfcheckRunning = false; }
}));
