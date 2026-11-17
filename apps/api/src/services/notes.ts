/**
 * Notes to the financial statements, built from the books: the accounting policies the program actually applies and the
 * breakdowns behind the main lines (cash, receivables with ageing, inventory, property and equipment movement, payables,
 * employee provisions, VAT, equity, revenue, expenses by nature). Sections that only management can write
 * (commitments, contingencies, subsequent events, related parties) are listed as "to be completed" — never invented.
 * Also: combined statements of several establishments of the same owner (a simple aggregation by account code).
 */
import { Db } from "../db/pool";
import { IS_EG, CFG } from "../lib/country";
import { isDate, today, r2 } from "../lib/core";

const n = (v: any) => r2(Number(v || 0));

export async function financialNotes(t: Db, C: string, q: any) {
  const to = isDate(q.to) ? String(q.to) : today();
  const from = isDate(q.from) ? String(q.from) : `${to.slice(0, 4)}-01-01`;
  const co = await t.one(`SELECT name_ar, name_en, vat_number, cr_number, city, country FROM companies WHERE id=$1`, [C]);
  const acc = await t.rows(
    `SELECT a.id, a.code, a.name_ar, a.type, a.subtype, a.system_key,
        COALESCE(SUM(CASE WHEN e.date <= $3 THEN l.debit-l.credit END),0) bal,
        COALESCE(SUM(CASE WHEN e.date < $2 THEN l.debit-l.credit END),0) opening,
        COALESCE(SUM(CASE WHEN e.date BETWEEN $2 AND $3 THEN l.debit-l.credit END),0) move
       FROM accounts a JOIN journal_lines l ON l.account_id=a.id JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED' AND e.date <= $3
      WHERE a.company_id=$1 AND NOT a.is_group GROUP BY a.id ORDER BY a.code`, [C, from, to]);
  const rows = (f: (a: any) => boolean, sign: 1 | -1, field: "bal" | "move" = "bal") => acc.filter(f).map((a: any) => ({ code: a.code, name: a.nameAr, amount: n(sign * Number(a[field])) })).filter((x: any) => Math.abs(x.amount) > 0.004);
  const total = (xs: any[]) => n(xs.reduce((s, x) => s + x.amount, 0));
  const sub = (s: string) => (a: any) => a.subtype === s;

  // ageing of what is still open on invoices at the date
  const ageing = async (direction: string) => {
    const r = await t.one(
      `SELECT COALESCE(SUM(CASE WHEN d <= 0 THEN due END),0) current, COALESCE(SUM(CASE WHEN d BETWEEN 1 AND 30 THEN due END),0) d30, COALESCE(SUM(CASE WHEN d BETWEEN 31 AND 60 THEN due END),0) d60,
              COALESCE(SUM(CASE WHEN d BETWEEN 61 AND 90 THEN due END),0) d90, COALESCE(SUM(CASE WHEN d > 90 THEN due END),0) over90, COALESCE(SUM(due),0) total
         FROM (SELECT total-amount_paid due, ($2::date - COALESCE(due_date, date)) d FROM invoices WHERE company_id=$1 AND status='POSTED' AND direction=$3 AND kind IN ('INVOICE','DEBIT_NOTE') AND date <= $2 AND total-amount_paid > 0.005) x`, [C, to, direction]);
    return { notDue: n(r.current), d1_30: n(r.d30), d31_60: n(r.d60), d61_90: n(r.d90), over90: n(r.over90), total: n(r.total) };
  };
  // property and equipment: cost and accumulated depreciation movement by category
  const fa = await t.rows(`SELECT id, COALESCE(category,'أخرى') category, acquisition_date, cost, status FROM fixed_assets WHERE company_id=$1`, [C]);
  const dep = await t.rows(`SELECT d.asset_id, d.period_end, d.amount FROM asset_depreciations d WHERE d.company_id=$1 AND d.period_end <= $2`, [C, to]);
  const cats = [...new Set(fa.map((a: any) => a.category))].sort();
  const ppe = cats.map((cat) => {
    const as = fa.filter((a: any) => a.category === cat); const ids = new Set(as.map((a: any) => a.id));
    const d0 = String(from), inP = (d: any) => String(d).slice(0, 10) >= d0 && String(d).slice(0, 10) <= to;
    const costOpen = n(as.filter((a: any) => String(a.acquisitionDate).slice(0, 10) < d0).reduce((s: number, a: any) => s + Number(a.cost), 0));
    const additions = n(as.filter((a: any) => inP(a.acquisitionDate)).reduce((s: number, a: any) => s + Number(a.cost), 0));
    const dd = dep.filter((x: any) => ids.has(x.assetId));
    const depOpen = n(dd.filter((x: any) => String(x.periodEnd).slice(0, 10) < d0).reduce((s: number, x: any) => s + Number(x.amount), 0));
    const charge = n(dd.filter((x: any) => inP(x.periodEnd)).reduce((s: number, x: any) => s + Number(x.amount), 0));
    return { category: cat, costOpen, additions, costClose: n(costOpen + additions), depOpen, charge, depClose: n(depOpen + charge), netBook: n(costOpen + additions - depOpen - charge) };
  });
  const inv = await t.rows(`SELECT COALESCE(c.name,'بدون تصنيف') category, COALESCE(SUM(b.value),0) value, COUNT(DISTINCT p.id)::int items FROM stock_balances b JOIN products p ON p.id=b.product_id LEFT JOIN product_categories c ON c.id=p.category_id WHERE b.company_id=$1 AND b.qty <> 0 GROUP BY 1 ORDER BY 2 DESC`, [C]).catch(() => []);
  const emp = await t.one(`SELECT COUNT(*)::int c FROM employees WHERE company_id=$1 AND is_active`, [C]).catch(() => ({ c: 0 }));

  const cash = rows((a) => ["CASH", "BANK"].includes(a.subtype), 1);
  const revenue = rows((a) => a.type === "REVENUE", -1, "move"), cogs = rows(sub("COGS"), 1, "move"), expenses = rows((a) => a.type === "EXPENSE" && a.subtype !== "COGS", 1, "move");
  const equity = rows((a) => a.type === "EQUITY", -1); const profit = n(total(revenue) - total(cogs) - total(expenses));
  const provisions = rows((a) => ["EOSB_PROVISION", "LEAVE_PROVISION"].includes(a.systemKey), -1);
  const vat = { output: n(-(acc.find((a: any) => a.systemKey === "VAT_OUT")?.bal || 0)), input: n(acc.find((a: any) => a.systemKey === "VAT_IN")?.bal || 0) };
  const frame = IS_EG ? "معايير المحاسبة المصرية" : "المعيار الدولي للتقرير المالي للمنشآت الصغيرة والمتوسطة (IFRS for SMEs) المعتمد في المملكة العربية السعودية";
  const vatRate = CFG.vatRate;
  return {
    from, to, company: { name: co.nameAr, nameEn: co.nameEn, vatNumber: co.vatNumber, crNumber: co.crNumber, city: co.city }, currency: CFG.currencyAr || CFG.currency, profit,
    notes: [
      { no: 1, title: "معلومات عن المنشأة", text: [`${co.nameAr}${co.crNumber ? `، سجل تجاري رقم ${co.crNumber}` : ""}${co.vatNumber ? `، ${IS_EG ? "رقم التسجيل الضريبي" : "الرقم الضريبي"} ${co.vatNumber}` : ""}${co.city ? `، ${co.city}` : ""}.`, `تغطي هذه القوائم الفترة من ${from} إلى ${to}. عدد العاملين في نهاية الفترة: ${emp.c}.`], todo: "النشاط الرئيسي، الشكل القانوني، الملاك، وتاريخ اعتماد القوائم — تُستكمل من الإدارة." },
      { no: 2, title: "أساس الإعداد", text: [`أُعدّت القوائم المالية وفق ${frame}، على أساس الاستحقاق ومبدأ التكلفة التاريخية وافتراض الاستمرارية.`, `عملة العرض والعملة الوظيفية: ${CFG.currencyAr || CFG.currency}. الأرقام مقرَّبة إلى أقرب هللة/قرش.`] },
      { no: 3, title: "ملخص السياسات المحاسبية الهامة", text: [
        "الإيرادات: تُثبت عند إصدار الفاتورة وانتقال السيطرة على البضاعة أو تقديم الخدمة، بالصافي بعد الخصومات والمرتجعات ودون ضريبة القيمة المضافة.",
        "المخزون: يُقاس بالتكلفة بطريقة المتوسط المرجح، وتشمل التكلفة ثمن الشراء والتكاليف المحمَّلة على الاستيراد. تُثبت فروق الجرد والتالف في قائمة الدخل.",
        "الممتلكات والمعدات: بالتكلفة ناقصاً مجمع الإهلاك، وتُهلك بالقسط الثابت على العمر الإنتاجي المقدَّر لكل أصل بعد خصم القيمة التخريدية.",
        "الذمم المدينة والدائنة: بمبلغ الفاتورة الأصلي ناقصاً ما حُصّل أو سُدّد.",
        `ضريبة القيمة المضافة: تُحتسب بنسبة ${vatRate}% على التوريدات الخاضعة؛ ضريبة المخرجات التزام وضريبة المدخلات القابلة للاسترداد أصل، ويُسوّى الصافي في الإقرار الدوري.`,
        "منافع الموظفين: يُكوَّن مخصص لمكافأة نهاية الخدمة والإجازات المستحقة شهرياً وفق نظام العمل.",
        "العملات الأجنبية: تُسجَّل المعاملات بسعر الصرف في تاريخها، وتُثبت فروق الصرف عند السداد في قائمة الدخل.",
      ] },
      { no: 4, title: "النقد وما في حكمه", rows: cash, total: total(cash) },
      { no: 5, title: "الذمم المدينة التجارية", rows: rows(sub("RECEIVABLE"), 1), total: total(rows(sub("RECEIVABLE"), 1)), ageing: await ageing("SALE"), todo: "تقدير مخصص الخسائر الائتمانية المتوقعة على الأرصدة المتأخرة — يُحدَّد من الإدارة." },
      { no: 6, title: "المخزون", rows: inv.map((x: any) => ({ name: `${x.category} (${x.items} صنف)`, amount: n(x.value) })), total: n(inv.reduce((s: number, x: any) => s + Number(x.value), 0)) },
      { no: 7, title: "الممتلكات والمعدات", ppe, total: n(ppe.reduce((s, x) => s + x.netBook, 0)) },
      { no: 8, title: "الذمم الدائنة التجارية", rows: rows(sub("PAYABLE"), -1), total: total(rows(sub("PAYABLE"), -1)), ageing: await ageing("PURCHASE") },
      { no: 9, title: "مخصصات منافع الموظفين", rows: provisions, total: total(provisions) },
      { no: 10, title: "ضريبة القيمة المضافة", rows: [{ name: "ضريبة المخرجات المستحقة", amount: vat.output }, { name: "ضريبة المدخلات القابلة للاسترداد", amount: -vat.input }], total: n(vat.output - vat.input), text: [vat.output - vat.input >= 0 ? "الصافي مستحق للهيئة." : "الصافي رصيد دائن لصالح المنشأة."] },
      { no: 11, title: "حقوق الملكية", rows: [...equity, { name: "صافي ربح (خسارة) الفترة", amount: profit }], total: n(total(equity) + profit) },
      { no: 12, title: "الإيرادات", rows: revenue, total: total(revenue) },
      { no: 13, title: "تكلفة الإيرادات", rows: cogs, total: total(cogs) },
      { no: 14, title: "المصروفات حسب طبيعتها", rows: expenses, total: total(expenses) },
      { no: 15, title: "الأطراف ذات العلاقة", todo: "المعاملات والأرصدة مع الملاك وأعضاء الإدارة والمنشآت الشقيقة — تُستكمل من الإدارة. (رصيد جاري المالك ظاهر في إيضاح حقوق الملكية.)" },
      { no: 16, title: "الالتزامات المحتملة والارتباطات", todo: "الضمانات البنكية، القضايا، وعقود الإيجار والشراء غير المنفَّذة — تُستكمل من الإدارة." },
      { no: 17, title: "الأحداث اللاحقة", todo: "أي حدث جوهري بعد تاريخ القوائم وقبل اعتمادها — يُستكمل من الإدارة." },
    ],
  };
}

/**
 * Combined trial balance and statements of several establishments the same user belongs to: balances added by account
 * code. It is an aggregation — balances between the establishments themselves are NOT eliminated, which the result says.
 */
export async function combinedStatements(t: Db, userId: string, companyIds: string[], q: any) {
  const to = isDate(q.to) ? String(q.to) : today();
  const from = isDate(q.from) ? String(q.from) : `${to.slice(0, 4)}-01-01`;
  const mine = await t.rows(`SELECT c.id, c.name_ar, c.currency FROM companies c JOIN memberships m ON m.company_id=c.id WHERE m.user_id=$1 AND m.is_active AND m.role IN ('OWNER','ADMIN','ACCOUNTANT') ORDER BY c.created_at`, [userId]);
  const chosen = mine.filter((c: any) => !companyIds.length || companyIds.includes(c.id));
  const out = { from, to, available: mine.map((c: any) => ({ id: c.id, name: c.nameAr, currency: c.currency })), companies: chosen.map((c: any) => ({ id: c.id, name: c.nameAr })), mixedCurrency: new Set(chosen.map((c: any) => c.currency)).size > 1, rows: [] as any[], totals: {} as any };
  if (chosen.length < 1 || out.mixedCurrency) return out;
  const ids = `{${chosen.map((c: any) => c.id).join(",")}}`;
  const r = await t.rows(
    `SELECT a.code, MIN(a.name_ar) name, MIN(a.type) AS type, a.company_id,
        COALESCE(SUM(CASE WHEN a.type IN ('REVENUE','EXPENSE') THEN (CASE WHEN e.date BETWEEN $2 AND $3 THEN l.debit-l.credit END) ELSE l.debit-l.credit END),0) bal
       FROM accounts a JOIN journal_lines l ON l.account_id=a.id JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED' AND e.date <= $3
      WHERE a.company_id = ANY($1::uuid[]) AND NOT a.is_group GROUP BY a.code, a.company_id`, [ids, from, to]);
  const by = new Map<string, any>();
  for (const x of r) { const k = x.code; const row = by.get(k) || { code: x.code, name: x.name, type: x.type, per: {} as Record<string, number>, total: 0 }; row.per[x.companyId] = n(Number(row.per[x.companyId] || 0) + Number(x.bal)); row.total = n(row.total + Number(x.bal)); by.set(k, row); }
  out.rows = [...by.values()].filter((x) => Math.abs(x.total) > 0.004 || Object.values(x.per).some((v: any) => Math.abs(v) > 0.004)).sort((a, b) => a.code.localeCompare(b.code));
  const sum = (ty: string, sign: number) => n(out.rows.filter((x) => x.type === ty).reduce((s, x) => s + sign * x.total, 0));
  const revenue = sum("REVENUE", -1), expenses = sum("EXPENSE", 1), assets = sum("ASSET", 1), liabilities = sum("LIABILITY", -1), equity = sum("EQUITY", -1);
  out.totals = { revenue, expenses, profit: n(revenue - expenses), assets, liabilities, equity, equityWithProfit: n(equity + revenue - expenses), balanced: Math.abs(assets - liabilities - equity - (revenue - expenses)) < 0.02 };
  return out;
}
