/**
 * 3.43.0
 *  • Set-off (SAP customer/vendor clearing, Odoo netting): a party that is both customer and supplier settles what it owes
 *    against what it is owed with one entry — Dr payables / Cr receivables — allocated to the open invoices of both sides.
 *  • Recipes (Foodics ingredients, Odoo kit): a non-stock item with a recipe consumes its ingredients from stock when it
 *    is sold, and its cost of sales is the cost of what was consumed.
 *  • Supplier bank details and the bank transfer file of an approved payment run (SAP payment medium, Dynamics export).
 */
import { Db } from "../db/pool";
import { bad, conflict, num, r2, r3, isDate, today } from "../lib/core";
import { nextNumber, post, reverse } from "../accounting/engine";
import { applySettlement } from "./invoices";
import { BASE } from "./currency";
import { getRun } from "./paymentruns";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (d: any) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);

// ───────────────────────── set-off ─────────────────────────
const OPEN_SQL = (dir: "SALE" | "PURCHASE") => `
  SELECT i.id, i.number, i.date, COALESCE(i.due_date, i.date) due, i.total, i.amount_paid,
         ${dir === "PURCHASE" ? `COALESCE((SELECT SUM(l.amount) FROM payment_run_lines l JOIN payment_runs r ON r.id=l.run_id WHERE l.invoice_id=i.id AND r.status IN ('DRAFT','APPROVED')),0)` : "0"} held
    FROM invoices i
   WHERE i.company_id=$1 AND i.partner_id=$2 AND i.direction='${dir}' AND i.kind IN ('INVOICE','DEBIT_NOTE') AND i.status='POSTED'
     AND i.total - i.amount_paid > 0.005 AND COALESCE(i.currency,$3)=$3
   ORDER BY COALESCE(i.due_date, i.date), i.date, i.number`;

async function openOf(t: Db, C: string, partnerId: string, dir: "SALE" | "PURCHASE", lock = false) {
  const rows = await t.rows(OPEN_SQL(dir) + (lock ? " FOR UPDATE OF i" : ""), [C, partnerId, BASE]);
  return rows.map((r: any) => ({ id: r.id, number: r.number, date: iso(r.date), due: iso(r.due), open: r2(Number(r.total) - Number(r.amountPaid) - Number(r.held)) })).filter((r: any) => r.open > 0.005);
}

/** Parties that have open invoices on both sides, with the most that can be set off for each. */
export async function setoffCandidates(t: Db, C: string) {
  const rows = await t.rows(
    `SELECT p.id, p.name, p.code,
            COALESCE(SUM(i.total - i.amount_paid) FILTER (WHERE i.direction='SALE'),0) ar,
            COALESCE(SUM(i.total - i.amount_paid) FILTER (WHERE i.direction='PURCHASE'),0) ap
       FROM partners p JOIN invoices i ON i.partner_id=p.id AND i.company_id=p.company_id AND i.kind IN ('INVOICE','DEBIT_NOTE') AND i.status='POSTED' AND i.total - i.amount_paid > 0.005 AND COALESCE(i.currency,$2)=$2
      WHERE p.company_id=$1 GROUP BY p.id
     HAVING COALESCE(SUM(i.total - i.amount_paid) FILTER (WHERE i.direction='SALE'),0) > 0.005 AND COALESCE(SUM(i.total - i.amount_paid) FILTER (WHERE i.direction='PURCHASE'),0) > 0.005
      ORDER BY p.name`, [C, BASE]);
  const out: any[] = [];
  for (const r of rows) {
    const ar = await openOf(t, C, r.id, "SALE"), ap = await openOf(t, C, r.id, "PURCHASE");
    const a = r2(ar.reduce((s: number, x: any) => s + x.open, 0)), b = r2(ap.reduce((s: number, x: any) => s + x.open, 0));
    if (a > 0.005 && b > 0.005) out.push({ partnerId: r.id, name: r.name, code: r.code, receivable: a, payable: b, max: Math.min(a, b), net: r2(a - b), sales: ar, purchases: ap });
  }
  return { rows: out };
}

export async function listSetoffs(t: Db, C: string) {
  const rows = await t.rows(`SELECT s.*, p.name partner_name, e.number journal_number FROM partner_setoffs s JOIN partners p ON p.id=s.partner_id LEFT JOIN journal_entries e ON e.id=s.journal_id WHERE s.company_id=$1 ORDER BY s.date DESC, s.created_at DESC LIMIT 300`, [C]);
  return { rows: rows.map((r: any) => ({ ...r, date: iso(r.date), amount: Number(r.amount) })) };
}

/** FIFO by due date over the open invoices of one side. */
function allocate(open: any[], amount: number, side: "AR" | "AP") {
  let rest = amount; const out: any[] = [];
  for (const o of open) { if (rest <= 0.005) break; const a = r2(Math.min(o.open, rest)); out.push({ invoiceId: o.id, number: o.number, side, amount: a }); rest = r2(rest - a); }
  return out;
}

export async function setoffPreview(t: Db, C: string, b: any) {
  const partner = await t.one(`SELECT id, name FROM partners WHERE id=$1 AND company_id=$2`, [UUID.test(String(b.partnerId)) ? b.partnerId : null, C], "الطرف غير موجود");
  const ar = await openOf(t, C, partner.id, "SALE"), ap = await openOf(t, C, partner.id, "PURCHASE");
  const a = r2(ar.reduce((s: number, x: any) => s + x.open, 0)), p = r2(ap.reduce((s: number, x: any) => s + x.open, 0));
  const max = Math.min(a, p);
  const amount = b.amount === undefined || b.amount === null || b.amount === "" ? max : r2(num(b.amount));
  return { partner, receivable: a, payable: p, max, amount, allocations: [...allocate(ar, Math.min(amount, max), "AR"), ...allocate(ap, Math.min(amount, max), "AP")], after: { receivable: r2(a - Math.min(amount, max)), payable: r2(p - Math.min(amount, max)) } };
}

export async function createSetoff(t: Db, C: string, user: string, b: any, opts: { isDemo?: boolean } = {}) {
  const date = isDate(b.date) ? String(b.date) : today();
  const partner = await t.one(`SELECT id, name FROM partners WHERE id=$1 AND company_id=$2 FOR UPDATE`, [UUID.test(String(b.partnerId)) ? b.partnerId : null, C], "الطرف غير موجود");
  const ar = await openOf(t, C, partner.id, "SALE", true), ap = await openOf(t, C, partner.id, "PURCHASE", true);
  const a = r2(ar.reduce((s: number, x: any) => s + x.open, 0)), p = r2(ap.reduce((s: number, x: any) => s + x.open, 0));
  if (a <= 0.005 || p <= 0.005) throw bad(`لا مقاصة ممكنة: «${partner.name}» ليس له فواتير مفتوحة في الجانبين (عليه ${a.toFixed(2)}، له ${p.toFixed(2)})`);
  const max = Math.min(a, p);
  const amount = b.amount === undefined || b.amount === null || b.amount === "" ? max : r2(num(b.amount));
  if (!(amount > 0)) throw bad("مبلغ المقاصة يجب أن يكون أكبر من صفر");
  if (amount > max + 0.001) throw bad(`مبلغ المقاصة ${amount.toFixed(2)} يتجاوز الممكن ${max.toFixed(2)} (الأقل من: عليه ${a.toFixed(2)}، له ${p.toFixed(2)})`);
  const allocations = [...allocate(ar, amount, "AR"), ...allocate(ap, amount, "AP")];
  const number = await nextNumber(t, C, "SET", date);
  const memo = `مقاصة ${number} — ${partner.name}${b.memo ? ` — ${String(b.memo).slice(0, 200)}` : ""}`;
  const row = await t.insert("partner_setoffs", { companyId: C, number, date, partnerId: partner.id, amount, allocations: JSON.stringify(allocations), memo: b.memo ? String(b.memo).slice(0, 300) : null, createdBy: user, isDemo: !!opts.isDemo });
  const entry = await post(t, C, { date, type: "MANUAL", sourceType: "SETOFF", sourceId: row.id, reference: number, memo, createdBy: user, isDemo: !!opts.isDemo,
    lines: [{ key: "AP", debit: amount, partnerId: partner.id, description: memo }, { key: "AR", credit: amount, partnerId: partner.id, description: memo }] });
  for (const x of allocations) await applySettlement(t, x.invoiceId, x.amount);
  await t.exec(`UPDATE partner_setoffs SET journal_id=$2 WHERE id=$1`, [row.id, entry.id]);
  return { ...row, journalId: entry.id, journalNumber: entry.number, amount, allocations, partnerName: partner.name };
}

export async function cancelSetoff(t: Db, C: string, user: string, id: string) {
  const s = await t.one(`SELECT * FROM partner_setoffs WHERE id=$1 AND company_id=$2 FOR UPDATE`, [UUID.test(id) ? id : null, C], "المقاصة غير موجودة");
  if (s.status !== "POSTED") throw conflict("المقاصة ملغاة من قبل");
  for (const x of (s.allocations || []) as any[]) await applySettlement(t, x.invoiceId, -Number(x.amount));
  if (s.journalId) await reverse(t, C, s.journalId, today(), `إلغاء مقاصة ${s.number}`, user);
  await t.exec(`UPDATE partner_setoffs SET status='CANCELLED' WHERE id=$1`, [s.id]);
  return { id: s.id, number: s.number, status: "CANCELLED" };
}

/** A set-off entry is undone from the set-off screen (which also reopens the invoices), not from the journal. */
export async function setoffGuardOnReverse(t: Db, C: string, entryId: string) {
  const s = await t.maybe(`SELECT number FROM partner_setoffs WHERE company_id=$1 AND journal_id=$2 AND status='POSTED'`, [C, UUID.test(entryId) ? entryId : null]);
  if (s) throw conflict(`هذا قيد المقاصة ${s.number}: ألغِها من شاشة «مقاصة عميل/مورد» ليُعاد فتح فواتيرها`);
}

// ───────────────────────── recipes ─────────────────────────
export async function getRecipe(t: Db, C: string, productId: string) {
  const prod = await t.one(`SELECT id, name, type, sale_price FROM products WHERE id=$1 AND company_id=$2`, [UUID.test(productId) ? productId : null, C], "الصنف غير موجود");
  const rows = await t.rows(
    `SELECT r.component_id, r.qty, r.waste_pct, c.name, c.sku, c.unit, c.purchase_price,
            COALESCE((SELECT SUM(b.value)/NULLIF(SUM(b.qty),0) FROM stock_balances b WHERE b.company_id=$1 AND b.product_id=c.id AND b.qty > 0), c.purchase_price, 0) avg_cost,
            COALESCE((SELECT SUM(b.qty) FROM stock_balances b WHERE b.company_id=$1 AND b.product_id=c.id),0) on_hand
       FROM product_recipes r JOIN products c ON c.id=r.component_id WHERE r.company_id=$1 AND r.product_id=$2 ORDER BY r.sort, c.name`, [C, prod.id]);
  // what is taken from stock per unit sold = the net quantity plus its waste (peel, trim, spill)
  const lines = rows.map((r: any) => { const w = Number(r.wastePct || 0), used = Number(r.qty) * (1 + w / 100); return { componentId: r.componentId, name: r.name, sku: r.sku, unit: r.unit, qty: Number(r.qty), wastePct: w, usedQty: Math.round(used * 10000) / 10000, unitCost: r2(Number(r.avgCost)), cost: r2(used * Number(r.avgCost)), onHand: r3(Number(r.onHand)) }; });
  const cost = r2(lines.reduce((s: number, l: any) => s + l.cost, 0));
  const price = Number(prod.salePrice || 0);
  return { productId: prod.id, name: prod.name, type: prod.type, canHaveRecipe: prod.type !== "STOCK", lines, cost, salePrice: price, margin: price > 0 ? r2(price - cost) : null, marginPct: price > 0 ? r2(((price - cost) / price) * 100) : null,
    canMake: lines.length ? Math.max(0, Math.floor(Math.min(...lines.map((l: any) => l.onHand / l.usedQty)))) : null };
}

export async function saveRecipe(t: Db, C: string, productId: string, b: any) {
  const prod = await t.one(`SELECT id, name, type FROM products WHERE id=$1 AND company_id=$2 FOR UPDATE`, [UUID.test(productId) ? productId : null, C], "الصنف غير موجود");
  const lines: any[] = Array.isArray(b?.lines) ? b.lines : [];
  if (lines.length && prod.type === "STOCK") throw bad("الوصفة تكون لصنف غير مخزني (طبق أو خدمة أو باقة): الصنف المخزني يُخصم هو نفسه من المخزون");
  if (lines.length > 60) throw bad("الوصفة لا تزيد عن 60 مكوناً");
  const seen = new Set<string>();
  for (const l of lines) {
    if (!UUID.test(String(l.componentId))) throw bad("اختر المكوّن");
    if (l.componentId === prod.id) throw bad("الصنف لا يكون مكوناً لنفسه");
    if (seen.has(l.componentId)) throw bad("المكوّن مكرر في الوصفة");
    seen.add(l.componentId);
    if (!(num(l.qty) > 0)) throw bad("كمية المكوّن يجب أن تكون أكبر من صفر");
    if (num(l.wastePct) < 0 || num(l.wastePct) > 90) throw bad("نسبة الهالك بين 0 و90%");
    const c = await t.maybe(`SELECT type, name FROM products WHERE id=$1 AND company_id=$2`, [l.componentId, C]);
    if (!c) throw bad("المكوّن غير موجود");
    if (c.type !== "STOCK") throw bad(`المكوّن «${c.name}» ليس صنفاً مخزنياً`);
  }
  await t.exec(`DELETE FROM product_recipes WHERE product_id=$1 AND company_id=$2`, [prod.id, C]);
  let i = 0;
  for (const l of lines) await t.exec(`INSERT INTO product_recipes (company_id, product_id, component_id, qty, sort, waste_pct) VALUES ($1,$2,$3,$4,$5,$6)`, [C, prod.id, l.componentId, Math.round(num(l.qty) * 10000) / 10000, i++, Math.round(num(l.wastePct) * 100) / 100]);
  return getRecipe(t, C, prod.id);
}

/** Recipes of the given products: productId → [{componentId, qty, name, purchasePrice}] */
export async function recipesOf(t: Db, C: string, productIds: string[]) {
  const out = new Map<string, any[]>();
  if (!productIds.length) return out;
  const rows = await t.rows(`SELECT r.product_id, r.component_id, r.qty * (1 + r.waste_pct / 100.0) qty, c.name, c.purchase_price FROM product_recipes r JOIN products c ON c.id=r.component_id WHERE r.company_id=$1 AND r.product_id = ANY($2::uuid[]) ORDER BY r.sort`, [C, productIds]);
  for (const r of rows) { const a = out.get(r.productId) || []; a.push({ componentId: r.componentId, qty: Number(r.qty), name: r.name, purchasePrice: Number(r.purchasePrice || 0) }); out.set(r.productId, a); }
  return out;
}

/** Items that have a recipe, with today's cost and margin (menu engineering). */
export async function recipeList(t: Db, C: string) {
  const ids = await t.rows(`SELECT DISTINCT r.product_id id FROM product_recipes r WHERE r.company_id=$1`, [C]);
  const rows: any[] = [];
  for (const x of ids) { const r = await getRecipe(t, C, x.id); rows.push({ productId: r.productId, name: r.name, components: r.lines.length, cost: r.cost, salePrice: r.salePrice, margin: r.margin, marginPct: r.marginPct, canMake: r.canMake }); }
  rows.sort((a, b) => a.name.localeCompare(b.name, "ar"));
  return { rows };
}

/**
 * Menu engineering (Kasavana & Smith): each dish is placed by how much it sells against how much each sale leaves.
 * Popular = its share of units is at least 70% of an equal share; profitable = its margin per unit is at least the
 * average margin per unit sold. Star (both), plowhorse (sells, thin margin), puzzle (good margin, sells little), dog (neither).
 */
export async function menuEngineering(t: Db, C: string, q: { days?: number }) {
  const days = Math.min(365, Math.max(7, Math.round(num(q.days) || 30)));
  const sold = await t.rows(
    `SELECT l.product_id id, SUM(l.qty * COALESCE(l.factor,1) * CASE WHEN i.kind='CREDIT_NOTE' THEN -1 ELSE 1 END) qty,
            SUM(l.net_amount * COALESCE(i.exchange_rate,1) * CASE WHEN i.kind='CREDIT_NOTE' THEN -1 ELSE 1 END) net,
            SUM(CASE WHEN i.kind='INVOICE' THEN l.qty * COALESCE(l.factor,1) * l.unit_cost ELSE 0 END) cost
       FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id
      WHERE i.company_id=$1 AND i.direction='SALE' AND i.status='POSTED' AND i.kind IN ('INVOICE','CREDIT_NOTE') AND i.date > CURRENT_DATE - $2::int
        AND l.product_id IN (SELECT product_id FROM product_recipes WHERE company_id=$1) GROUP BY l.product_id`, [C, days]);
  const by = new Map(sold.map((x: any) => [x.id, x]));
  const list = (await recipeList(t, C)).rows;
  const rows = list.map((r: any) => { const s: any = by.get(r.productId) || {}; const qty = r3(Number(s.qty || 0)), net = r2(Number(s.net || 0)), cost = r2(Number(s.cost || 0)); return { ...r, soldQty: qty, revenue: net, soldCost: cost, profit: r2(net - cost), unitMargin: qty > 0 ? r2((net - cost) / qty) : r.margin }; });
  const totalQty = rows.reduce((a: number, r: any) => a + Math.max(0, r.soldQty), 0), totalProfit = rows.reduce((a: number, r: any) => a + r.profit, 0);
  const popLine = rows.length ? (totalQty / rows.length) * 0.7 : 0, avgMargin = totalQty > 0 ? totalProfit / totalQty : 0;
  for (const r of rows) {
    const pop = totalQty > 0 && r.soldQty >= popLine - 1e-9 && r.soldQty > 0, prof = Number(r.unitMargin || 0) >= avgMargin - 1e-9;
    r.sharePct = totalQty > 0 ? r2((Math.max(0, r.soldQty) / totalQty) * 100) : 0;
    r.klass = totalQty <= 0 ? "NEW" : pop && prof ? "STAR" : pop ? "PLOWHORSE" : prof ? "PUZZLE" : "DOG";
    r.advice = r.klass === "STAR" ? "حافظ عليه: مكانه البارز في القائمة وجودته كما هي" : r.klass === "PLOWHORSE" ? "يُباع كثيراً بهامش ضعيف: ارفع السعر قليلاً أو خفّض تكلفة الوصفة" : r.klass === "PUZZLE" ? "هامشه جيد ويُباع قليلاً: روّج له أو غيّر مكانه واسمه في القائمة" : r.klass === "DOG" ? "لا يُباع ولا يربح: راجع وجوده في القائمة" : "لا مبيعات في الفترة بعد";
  }
  rows.sort((a: any, b: any) => b.profit - a.profit);
  return { days, rows, totals: { qty: r3(totalQty), profit: r2(totalProfit), avgMargin: r2(avgMargin), popularityLine: r3(popLine) }, counts: { STAR: rows.filter((r: any) => r.klass === "STAR").length, PLOWHORSE: rows.filter((r: any) => r.klass === "PLOWHORSE").length, PUZZLE: rows.filter((r: any) => r.klass === "PUZZLE").length, DOG: rows.filter((r: any) => r.klass === "DOG").length } };
}

// ───────────────────────── supplier bank details + bank file ─────────────────────────
const cleanIban = (s: any) => String(s || "").replace(/\s+/g, "").toUpperCase();
/** ISO 13616 mod-97 check. */
export function ibanValid(raw: string) {
  const s = cleanIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  if (s.startsWith("SA") && s.length !== 24) return false;
  if (s.startsWith("EG") && s.length !== 29) return false;
  const re = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let m = 0; for (const ch of re) m = (m * 10 + Number(ch)) % 97;
  return m === 1;
}

export async function saveBank(t: Db, C: string, partnerId: string, b: any) {
  const p = await t.one(`SELECT id FROM partners WHERE id=$1 AND company_id=$2`, [UUID.test(partnerId) ? partnerId : null, C], "الطرف غير موجود");
  const iban = cleanIban(b?.iban);
  if (iban && !ibanValid(iban)) throw bad("رقم الآيبان غير صحيح — راجع الأرقام (خانتا التحقق لا تطابقان)");
  await t.exec(`UPDATE partners SET iban=$2, bank_name=$3, bank_beneficiary=$4 WHERE id=$1`, [p.id, iban || null, b?.bankName ? String(b.bankName).slice(0, 120) : null, b?.bankBeneficiary ? String(b.bankBeneficiary).slice(0, 160) : null]);
  return { id: p.id, iban: iban || null, bankName: b?.bankName || null, bankBeneficiary: b?.bankBeneficiary || null };
}

/** One transfer per supplier of an approved or posted run. Suppliers without an IBAN are listed, not exported. */
export async function bankFile(t: Db, C: string, runId: string) {
  const run: any = await getRun(t, C, runId);
  if (!["APPROVED", "POSTED"].includes(run.status)) throw conflict("ملف البنك يصدر بعد اعتماد الدفعة");
  const sup: any[] = run.suppliers || [];
  const info = await t.rows(`SELECT id, iban, bank_name, bank_beneficiary, name FROM partners WHERE company_id=$1 AND id = ANY($2::uuid[])`, [C, sup.map((s) => s.partnerId)]);
  const by = new Map(info.map((x: any) => [x.id, x]));
  const src = await t.maybe(`SELECT iban, name_ar FROM accounts WHERE id=$1`, [run.accountId]);
  const rows: any[] = [], missing: string[] = [];
  for (const s of sup) {
    const pi: any = by.get(s.partnerId) || {};
    const amount = s.netPaid !== null && s.netPaid !== undefined ? Number(s.netPaid) : Number(s.total);
    if (!pi.iban) { missing.push(s.partnerName); continue; }
    rows.push({ beneficiary: pi.bankBeneficiary || s.partnerName, iban: pi.iban, bank: pi.bankName || "", amount: r2(amount), currency: BASE, reference: run.number, details: s.invoices.map((i: any) => i.supplierRef || i.number).join(" ").slice(0, 140) });
  }
  const q = (v: any) => { const x = String(v ?? ""); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  const head = ["Beneficiary", "IBAN", "Bank", "Amount", "Currency", "Reference", "Details", "Debit IBAN", "Value date"];
  const csv = "﻿" + [head, ...rows.map((r) => [r.beneficiary, r.iban, r.bank, r.amount.toFixed(2), r.currency, r.reference, r.details, src?.iban || "", iso(run.payDate)])].map((a) => a.map(q).join(",")).join("\r\n") + "\r\n";
  // ISO 20022 customer credit transfer initiation (pain.001.001.03) — the format banks accept for bulk transfers
  const x = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const co = await t.one(`SELECT COALESCE(NULLIF(name_en,''), name_ar) AS name FROM companies WHERE id=$1`, [C]);
  const total = r2(rows.reduce((s, r) => s + r.amount, 0));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
 <CstmrCdtTrfInitn>
  <GrpHdr><MsgId>${x(run.number)}</MsgId><CreDtTm>${new Date().toISOString().slice(0, 19)}</CreDtTm><NbOfTxs>${rows.length}</NbOfTxs><CtrlSum>${total.toFixed(2)}</CtrlSum><InitgPty><Nm>${x(co.name).slice(0, 70)}</Nm></InitgPty></GrpHdr>
  <PmtInf><PmtInfId>${x(run.number)}</PmtInfId><PmtMtd>TRF</PmtMtd><NbOfTxs>${rows.length}</NbOfTxs><CtrlSum>${total.toFixed(2)}</CtrlSum><ReqdExctnDt>${iso(run.payDate)}</ReqdExctnDt>
   <Dbtr><Nm>${x(co.name).slice(0, 70)}</Nm></Dbtr><DbtrAcct><Id>${src?.iban ? `<IBAN>${x(src.iban)}</IBAN>` : `<Othr><Id>NOTPROVIDED</Id></Othr>`}</Id></DbtrAcct><DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>
${rows.map((r, i) => `   <CdtTrfTxInf><PmtId><EndToEndId>${x(run.number)}-${i + 1}</EndToEndId></PmtId><Amt><InstdAmt Ccy="${x(r.currency)}">${r.amount.toFixed(2)}</InstdAmt></Amt><Cdtr><Nm>${x(r.beneficiary).slice(0, 70)}</Nm></Cdtr><CdtrAcct><Id><IBAN>${x(r.iban)}</IBAN></Id></CdtrAcct><RmtInf><Ustrd>${x(r.details || r.reference).slice(0, 140)}</Ustrd></RmtInf></CdtTrfTxInf>`).join("\n")}
  </PmtInf>
 </CstmrCdtTrfInitn>
</Document>
`;
  return { xml, xmlFilename: `${run.number}-pain001.xml`, number: run.number, status: run.status, count: rows.length, total: r2(rows.reduce((s, r) => s + r.amount, 0)), missing, debitIban: src?.iban || null, rows, csv, filename: `${run.number}-bank.csv` };
}
