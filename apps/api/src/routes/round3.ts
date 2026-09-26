/** Round 3 routes: cheques register, recurring templates, zakat estimate. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h, bad, req as need, num, isDate, today, addDays, r2 } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import { registerCheque, clearCheque, depositCheque, bounceCheque } from "../services/cheques";
import { runDueForCompany, runTemplate } from "../services/recurring";
import { post } from "../accounting/engine";
import { balanceSheet, incomeStatement } from "../services/reports";

export const r3 = Router();
r3.use(authenticate);

// ─── cheques ───────────────────────────────────────────────────────────────
r3.get("/cheques", perm("payments.read"), h(async (req) => {
  const params: any[] = [cid(req)];
  const where = ["c.company_id=$1"];
  if (req.query.direction) { params.push(req.query.direction); where.push(`c.direction=$${params.length}`); }
  if (req.query.status) { params.push(req.query.status); where.push(`c.status=$${params.length}`); }
  const rows = await db.rows(`SELECT c.*, pr.name AS partner_name, a.name_ar AS bank_account_name, pay.number AS voucher_number FROM cheques c JOIN partners pr ON pr.id=c.partner_id LEFT JOIN accounts a ON a.id=c.bank_account_id LEFT JOIN payments pay ON pay.id=c.payment_id WHERE ${where.join(" AND ")} ORDER BY c.due_date DESC, c.created_at DESC LIMIT 500`, params);
  const summary = await db.rows(`SELECT direction, status, COUNT(*)::int c, SUM(amount) amount FROM cheques WHERE company_id=$1 GROUP BY 1,2`, [cid(req)]);
  const dueSoon = await db.rows(`SELECT c.id, c.cheque_no, c.direction, c.amount, c.due_date, pr.name AS partner_name FROM cheques c JOIN partners pr ON pr.id=c.partner_id WHERE c.company_id=$1 AND c.status IN ('PENDING','DEPOSITED') AND c.due_date <= $2 ORDER BY c.due_date LIMIT 20`, [cid(req), addDays(today(), 7)]);
  return { rows, summary, dueSoon };
}));
r3.post("/cheques", perm("payments.write"), h(async (req) => { const c = await tx((t) => registerCheque(t, cid(req), actor(req), req.body)); await audit(req, "CREATE", "cheque", c.id, { chequeNo: c.chequeNo, amount: c.amount }); return c; }));
r3.post("/cheques/:id/deposit", perm("payments.write"), h(async (req) => tx((t) => depositCheque(t, cid(req), p(req).id, String(need(req.body, "bankAccountId", "حساب البنك"))))));
r3.post("/cheques/:id/clear", perm("payments.write"), h(async (req) => { const c = await tx((t) => clearCheque(t, cid(req), actor(req), p(req).id, String(need(req.body, "bankAccountId", "حساب البنك")), req.body.date)); await audit(req, "CHEQUE_CLEARED", "cheque", c.id); return c; }));
r3.post("/cheques/:id/bounce", perm("payments.write"), h(async (req) => { const c = await tx((t) => bounceCheque(t, cid(req), actor(req), p(req).id, req.body.cancelled !== true)); await audit(req, req.body.cancelled ? "CHEQUE_CANCELLED" : "CHEQUE_BOUNCED", "cheque", c.id); return c; }));

// ─── recurring templates ───────────────────────────────────────────────────
r3.get("/recurring", perm("accounting.read"), h(async (req) => db.rows(`SELECT * FROM recurring_templates WHERE company_id=$1 ORDER BY is_active DESC, next_date`, [cid(req)])));
r3.post("/recurring", perm("accounting.write"), h(async (req) => {
  const b = req.body || {};
  const kind = String(b.kind || "");
  if (!["EXPENSE", "JOURNAL", "SALE_INVOICE"].includes(kind)) throw bad("نوع القالب غير صحيح");
  if (!isDate(b.nextDate)) throw bad("تاريخ أول تنفيذ غير صحيح");
  const payload = b.payload || {};
  if (kind === "EXPENSE" && (!payload.accountId || !num(payload.amount))) throw bad("حساب المصروف والمبلغ مطلوبان");
  if (kind === "JOURNAL" && !(payload.lines?.length >= 2)) throw bad("القيد يحتاج سطرين على الأقل");
  if (kind === "SALE_INVOICE" && (!payload.partnerId || !payload.lines?.length)) throw bad("العميل والبنود مطلوبة");
  const row = await db.insert("recurring_templates", { companyId: cid(req), kind, name: String(need(b, "name", "اسم القالب")), frequency: ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"].includes(b.frequency) ? b.frequency : "MONTHLY", nextDate: b.nextDate, endDate: isDate(b.endDate) ? b.endDate : null, payload, createdBy: actor(req) });
  await audit(req, "CREATE", "recurring", row.id, { name: row.name });
  return row;
}));
r3.put("/recurring/:id", perm("accounting.write"), h(async (req) => db.update("recurring_templates", { id: p(req).id, companyId: cid(req) }, { name: req.body.name, frequency: req.body.frequency, nextDate: isDate(req.body.nextDate) ? req.body.nextDate : undefined, endDate: req.body.endDate === null ? null : isDate(req.body.endDate) ? req.body.endDate : undefined, isActive: req.body.isActive, payload: req.body.payload })));
r3.delete("/recurring/:id", perm("accounting.write"), h(async (req) => { await db.exec(`DELETE FROM recurring_templates WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]); return { ok: true }; }));
r3.post("/recurring/run", perm("accounting.write"), h(async (req) => { const r = await runDueForCompany(cid(req), actor(req)); await audit(req, "RECURRING_RUN", "recurring", null, { count: r.length }); return r; }));
r3.post("/recurring/:id/run-now", perm("accounting.write"), h(async (req) => {
  const tpl = await db.one(`SELECT * FROM recurring_templates WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)], "القالب غير موجود");
  return tx((t) => runTemplate(t, req.company, { ...tpl, nextDate: isDate(req.body?.date) ? req.body.date : tpl.nextDate }, actor(req)));
}));

// ─── zakat estimate ────────────────────────────────────────────────────────
r3.get("/reports/zakat", perm("reports.read"), h(async (req) => {
  const to = isDate(req.query.to) ? String(req.query.to) : today();
  const from = isDate(req.query.from) ? String(req.query.from) : to.slice(0, 4) + "-01-01";
  const bs = await balanceSheet(db, cid(req), { to });
  const is = await incomeStatement(db, cid(req), { from, to });
  const sumSub = (g: any, keys: string[]) => r2(g.sections.filter((s: any) => keys.includes(s.subtype)).reduce((a: number, s: any) => a + s.total, 0));
  const capital = sumSub(bs.equity, ["CAPITAL"]);
  const reserves = sumSub(bs.equity, ["EQUITY"]);
  const retained = sumSub(bs.equity, ["RETAINED"]);
  const currentResult = bs.currentResult;
  const provisionBooked = await db.one(`SELECT COALESCE(SUM(l.credit-l.debit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND a.system_key='ZAKAT_PAYABLE' AND e.status='POSTED' AND e.date <= $2`, [cid(req), to]);
  const provisions = r2(provisionBooked.b); // zakat provision only — VAT balances are not part of the zakat base
  const longTerm = bs.ltLiab.total;
  const fixedAssetsNet = bs.fixedAssets.total;
  const additions = r2(capital + reserves + retained + currentResult + provisions + longTerm);
  const deductions = r2(fixedAssetsNet);
  const baseEquity = r2(additions - deductions);
  const adjustedProfit = is.net;
  // ZATCA: base cannot be lower than net adjusted profit; zakat 2.5% (Hijri) ≈ 2.577% for a Gregorian year
  const base = Math.max(baseEquity, adjustedProfit, 0);
  const rate = req.query.calendar === "hijri" ? 0.025 : 0.02577;
  const zakat = r2(base * rate);
  return { from, to, lines: [
    { label: "رأس المال", amount: capital }, { label: "الاحتياطيات وحقوق ملكية أخرى", amount: reserves }, { label: "الأرباح المبقاة (أول المدة)", amount: retained }, { label: "نتيجة الفترة الجارية", amount: currentResult },
    { label: "مخصص الزكاة", amount: provisions }, { label: "القروض والالتزامات طويلة الأجل", amount: longTerm },
    { label: "إجمالي الإضافات", amount: additions, bold: true }, { label: "يُخصم: صافي الأصول الثابتة", amount: -deductions },
    { label: "الوعاء الزكوي (طريقة حقوق الملكية)", amount: baseEquity, bold: true }, { label: "صافي الربح المعدّل (الحد الأدنى للوعاء)", amount: adjustedProfit },
  ], base, rate, zakat, provisionBooked: r2(provisionBooked.b), disclaimer: "احتساب تقديري مبسط وفق طريقة حقوق الملكية دون التعديلات التفصيلية للائحة الزكاة (المصروفات غير المقبولة، الاستثمارات، التمويل…) — يُراجع من محاسب قانوني قبل التقديم." };
}));
r3.post("/reports/zakat/provision", perm("accounting.write"), h(async (req) => {
  const amount = r2(num(req.body.amount));
  if (amount <= 0) throw bad("المبلغ غير صحيح");
  const date = isDate(req.body.date) ? req.body.date : today();
  const e = await tx((t) => post(t, cid(req), { date, type: "MANUAL", memo: `مخصص الزكاة عن الفترة المنتهية في ${date}`, createdBy: actor(req), lines: [{ key: "ZAKAT", debit: amount, description: "مصروف الزكاة" }, { key: "ZAKAT_PAYABLE", credit: amount, description: "مخصص الزكاة" }] }));
  await audit(req, "ZAKAT_PROVISION", "journal", e?.id || null, { amount });
  return e;
}));
