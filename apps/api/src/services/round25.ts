/**
 * Round 25 — financial analysis (التحليل المالي) and the association's governance indicators.
 * Everything is derived from the posted ledger through the existing statements, so the analysis always
 * agrees with the income statement, balance sheet and cash-flow reports.
 */
import { Db } from "../db/pool";
import { r2, D, isDate, today, addDays } from "../lib/core";
import { incomeStatement, balanceSheet, cashFlow } from "./reports";

type Status = "good" | "ok" | "bad" | "na";
interface Ratio { key: string; group: string; name: string; value: number | null; unit: "x" | "%" | "days" | "SAR" | "months"; formula: string; benchmark: string; status: Status; note: string }

const sec = (g: any, ...subtypes: string[]) => r2((g?.sections || []).filter((s: any) => subtypes.includes(s.subtype)).reduce((a: number, s: any) => a + s.total, 0));
const div = (a: number, b: number) => (Math.abs(b) < 0.005 ? null : a / b);
const pct = (a: number, b: number) => { const v = div(a, b); return v === null ? null : r2(v * 100); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
const grade = (v: number | null, good: (x: number) => boolean, ok: (x: number) => boolean): Status => (v === null ? "na" : good(v) ? "good" : ok(v) ? "ok" : "bad");

async function glMove(t: Db, companyId: string, from: string, to: string, where: string, params: any[] = []) {
  const r = await t.one(
    `SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id
      WHERE l.company_id=$1 AND e.status='POSTED' AND e.type<>'CLOSING' AND e.date BETWEEN $2 AND $3 AND ${where}`, [companyId, from, to, ...params]);
  return Number(r.b);
}

function snapshot(bs: any) {
  const cash = sec(bs.currentAssets, "CASH", "BANK");
  const receivables = sec(bs.currentAssets, "RECEIVABLE");
  const inventory = sec(bs.currentAssets, "INVENTORY");
  const currentAssets = bs.currentAssets.total, currentLiab = bs.currentLiab.total;
  const payables = sec(bs.currentLiab, "PAYABLE");
  return { cash, receivables, inventory, currentAssets, currentLiab, payables, totalAssets: bs.totalAssets, totalLiab: bs.totalLiab, ltLiab: bs.ltLiab.total, equity: bs.totalEquity, fixedAssets: bs.fixedAssets.total };
}

export async function financialAnalysis(t: Db, companyId: string, q: any) {
  const to = isDate(q.to) ? q.to : today();
  const from = isDate(q.from) ? q.from : to.slice(0, 4) + "-01-01";
  const days = daysBetween(from, to);
  const annual = 365 / days;
  const prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -(days - 1));
  const branchId = q.branchId || undefined;
  const [is, isP, bsE, bsO] = await Promise.all([
    incomeStatement(t, companyId, { from, to, branchId }), incomeStatement(t, companyId, { from: prevFrom, to: prevTo, branchId }),
    balanceSheet(t, companyId, { to, branchId }), balanceSheet(t, companyId, { to: prevTo, branchId }),
  ]);
  const E = snapshot(bsE), O = snapshot(bsO);
  const avg = (k: keyof typeof E) => r2((Number(E[k]) + Number(O[k])) / 2);
  const netSales = is.netSales, cogs = is.cogs.total, gp = is.grossProfit, opex = is.opex.total, op = is.operating, net = is.net;
  // gross (VAT-inclusive) credit sales and purchases, to match receivables / payables that carry VAT
  const vatOut = -(await glMove(t, companyId, from, to, "a.system_key='VAT_OUT'"));
  const vatIn = await glMove(t, companyId, from, to, "a.system_key='VAT_IN'");
  const grossSales = r2(netSales + Math.max(0, vatOut));
  const purchases = r2(cogs + (E.inventory - O.inventory) + Math.max(0, vatIn));
  const finance = await glMove(t, companyId, from, to, "a.code='5402'");
  const depreciation = await glMove(t, companyId, from, to, "a.system_key='DEPRECIATION'");

  const R: Ratio[] = [];
  const add = (r: Ratio) => R.push(r);
  // ── liquidity
  const cur = div(E.currentAssets, E.currentLiab), quick = div(E.currentAssets - E.inventory, E.currentLiab), cashR = div(E.cash, E.currentLiab);
  add({ key: "current", group: "السيولة", name: "نسبة التداول", value: cur === null ? null : r2(cur), unit: "x", formula: "الأصول المتداولة ÷ الخصوم المتداولة", benchmark: "1.5 – 3 جيد · أقل من 1 خطر", status: grade(cur, (x) => x >= 1.5, (x) => x >= 1), note: cur === null ? "لا توجد خصوم متداولة" : cur >= 1.5 ? "الأصول المتداولة تغطي الالتزامات قصيرة الأجل براحة" : cur >= 1 ? "تغطية مقبولة لكن هامش الأمان محدود" : "الالتزامات قصيرة الأجل أكبر من الأصول المتداولة — راقب السيولة" });
  add({ key: "quick", group: "السيولة", name: "نسبة السيولة السريعة", value: quick === null ? null : r2(quick), unit: "x", formula: "(الأصول المتداولة − المخزون) ÷ الخصوم المتداولة", benchmark: "1 فأكثر جيد", status: grade(quick, (x) => x >= 1, (x) => x >= 0.7), note: "القدرة على السداد دون الاعتماد على بيع المخزون" });
  add({ key: "cash", group: "السيولة", name: "نسبة النقدية", value: cashR === null ? null : r2(cashR), unit: "x", formula: "النقدية والبنوك ÷ الخصوم المتداولة", benchmark: "0.2 – 0.5 مقبول", status: grade(cashR, (x) => x >= 0.5, (x) => x >= 0.2), note: "أشد مقاييس السيولة تحفظاً" });
  add({ key: "wc", group: "السيولة", name: "رأس المال العامل", value: r2(E.currentAssets - E.currentLiab), unit: "SAR", formula: "الأصول المتداولة − الخصوم المتداولة", benchmark: "موجب", status: E.currentAssets - E.currentLiab >= 0 ? "good" : "bad", note: "فائض الموارد قصيرة الأجل لتمويل التشغيل" });
  // ── profitability
  const gm = pct(gp, netSales), om = pct(op, netSales), nm = pct(net, netSales);
  const roa = div(net * annual, avg("totalAssets")), roe = div(net * annual, avg("equity"));
  add({ key: "gm", group: "الربحية", name: "هامش مجمل الربح", value: gm, unit: "%", formula: "مجمل الربح ÷ صافي المبيعات", benchmark: "يختلف بالنشاط — التجزئة 20–40%", status: grade(gm, (x) => x >= 25, (x) => x >= 10), note: "ما يتبقى من كل ريال مبيعات بعد تكلفة البضاعة" });
  add({ key: "om", group: "الربحية", name: "هامش الربح التشغيلي", value: om, unit: "%", formula: "الربح التشغيلي ÷ صافي المبيعات", benchmark: "10% فأكثر جيد", status: grade(om, (x) => x >= 10, (x) => x >= 3), note: "كفاءة النشاط الأساسي بعد المصروفات التشغيلية" });
  add({ key: "nm", group: "الربحية", name: "هامش صافي الربح", value: nm, unit: "%", formula: "صافي الربح ÷ صافي المبيعات", benchmark: "5% فأكثر جيد", status: grade(nm, (x) => x >= 5, (x) => x >= 1), note: "بعد كل المصروفات والزكاة" });
  add({ key: "roa", group: "الربحية", name: "العائد على الأصول (سنوي)", value: roa === null ? null : r2(roa * 100), unit: "%", formula: "صافي الربح السنوي ÷ متوسط الأصول", benchmark: "5% فأكثر جيد", status: grade(roa === null ? null : roa * 100, (x) => x >= 5, (x) => x >= 1), note: "كفاءة استخدام الأصول في تحقيق الربح" });
  add({ key: "roe", group: "الربحية", name: "العائد على حقوق الملكية (سنوي)", value: roe === null ? null : r2(roe * 100), unit: "%", formula: "صافي الربح السنوي ÷ متوسط حقوق الملكية", benchmark: "15% فأكثر جيد", status: grade(roe === null ? null : roe * 100, (x) => x >= 15, (x) => x >= 5), note: "عائد الملاك على أموالهم المستثمرة" });
  // ── efficiency (days)
  const dso = div(avg("receivables") * days, grossSales), dio = div(avg("inventory") * days, cogs), dpo = div(avg("payables") * days, purchases);
  const ccc = dso === null && dio === null ? null : r2((dso || 0) + (dio || 0) - (dpo || 0));
  const at = div(netSales * annual, avg("totalAssets"));
  add({ key: "dso", group: "كفاءة النشاط", name: "متوسط فترة التحصيل", value: dso === null ? null : r2(dso), unit: "days", formula: "متوسط الذمم المدينة × أيام الفترة ÷ المبيعات شاملة الضريبة", benchmark: "أقل من 45 يوماً جيد", status: grade(dso, (x) => x <= 45, (x) => x <= 75), note: "كم يوماً يحتاج العميل للسداد في المتوسط" });
  add({ key: "dio", group: "كفاءة النشاط", name: "متوسط فترة بقاء المخزون", value: dio === null ? null : r2(dio), unit: "days", formula: "متوسط المخزون × أيام الفترة ÷ تكلفة المبيعات", benchmark: "أقل من 60 يوماً جيد", status: grade(dio, (x) => x <= 60, (x) => x <= 120), note: "مدة تحوّل المخزون إلى مبيعات" });
  add({ key: "dpo", group: "كفاءة النشاط", name: "متوسط فترة السداد للموردين", value: dpo === null ? null : r2(dpo), unit: "days", formula: "متوسط الذمم الدائنة × أيام الفترة ÷ المشتريات شاملة الضريبة", benchmark: "قريبة من شروط الموردين", status: dpo === null ? "na" : "ok", note: "فترة الائتمان التي تحصل عليها من الموردين" });
  add({ key: "ccc", group: "كفاءة النشاط", name: "دورة التحويل النقدي", value: ccc, unit: "days", formula: "فترة التحصيل + فترة المخزون − فترة السداد", benchmark: "كلما قلّت كان أفضل", status: grade(ccc, (x) => x <= 30, (x) => x <= 90), note: "عدد الأيام التي يُموَّل فيها التشغيل من أموال المنشأة" });
  add({ key: "at", group: "كفاءة النشاط", name: "معدل دوران الأصول (سنوي)", value: at === null ? null : r2(at), unit: "x", formula: "صافي المبيعات السنوية ÷ متوسط الأصول", benchmark: "1 فأكثر للتجارة", status: grade(at, (x) => x >= 1, (x) => x >= 0.5), note: "كم ريال مبيعات يولّده كل ريال أصول" });
  // ── leverage
  const dr = div(E.totalLiab, E.totalAssets), de = div(E.totalLiab, E.equity), ic = finance > 0 ? div(op, finance) : null;
  add({ key: "dr", group: "الرفع المالي", name: "نسبة المديونية", value: dr === null ? null : r2(dr * 100), unit: "%", formula: "إجمالي الخصوم ÷ إجمالي الأصول", benchmark: "أقل من 60% جيد", status: grade(dr === null ? null : dr * 100, (x) => x <= 60, (x) => x <= 80), note: "نسبة الأصول الممولة بالديون" });
  add({ key: "de", group: "الرفع المالي", name: "الديون إلى حقوق الملكية", value: de === null ? null : r2(de), unit: "x", formula: "إجمالي الخصوم ÷ حقوق الملكية", benchmark: "أقل من 1.5 جيد", status: E.equity <= 0 ? "bad" : grade(de, (x) => x <= 1.5, (x) => x <= 3), note: E.equity <= 0 ? "حقوق الملكية سالبة — الخسائر تجاوزت رأس المال" : "مدى اعتماد المنشأة على التمويل بالدين" });
  add({ key: "ic", group: "الرفع المالي", name: "تغطية المصروفات التمويلية", value: ic === null ? null : r2(ic), unit: "x", formula: "الربح التشغيلي ÷ المصروفات التمويلية", benchmark: "3 فأكثر جيد", status: ic === null ? "na" : grade(ic, (x) => x >= 3, (x) => x >= 1.5), note: finance > 0 ? "قدرة الربح التشغيلي على تغطية تكلفة التمويل" : "لا توجد مصروفات تمويلية في الفترة" });

  // ── DuPont
  const em = div(avg("totalAssets"), avg("equity"));
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  // components kept at 3–4 decimals so margin × turnover × multiplier reconciles to ROE
  const dupont = { netMargin: nm === null ? null : Math.round((net / netSales) * 10000) / 100, assetTurnover: at === null ? null : r3(at), equityMultiplier: em === null ? null : r3(em), roe: roe === null ? null : r2(roe * 100) };
  // ── break-even (variable = cost of sales; fixed = operating expenses)
  const cmr = div(gp, netSales);
  const be = cmr && cmr > 0 ? r2(opex / cmr) : null;
  const breakEven = { contributionMargin: gp, cmRatio: cmr === null ? null : r2(cmr * 100), fixedCosts: opex, breakEvenSales: be, breakEvenMonthly: be === null ? null : r2((be / days) * 30.4), marginOfSafety: be === null || !netSales ? null : r2(((netSales - be) / netSales) * 100), achieved: be === null ? null : netSales >= be };
  // ── cash
  const cf = await cashFlow(t, companyId, { from, to, branchId });
  const monthlyOp = r2((cf.totals.operating / days) * 30.4);
  const monthlyCash = r2(((opex - depreciation + cogs) / days) * 30.4);
  const cash = { opening: cf.opening, closing: cf.closing, operating: cf.totals.operating, investing: cf.totals.investing, financing: cf.totals.financing, monthlyOperating: monthlyOp, runwayMonths: monthlyOp < 0 ? r2(cf.closing / -monthlyOp) : null, monthsOfExpenses: monthlyCash > 0 ? r2(cf.closing / monthlyCash) : null, depreciation: r2(depreciation) };
  add({ key: "cover", group: "السيولة", name: "النقدية تغطي مصروفات", value: cash.monthsOfExpenses, unit: "months", formula: "النقدية آخر الفترة ÷ متوسط المصروفات النقدية الشهرية", benchmark: "3 أشهر فأكثر جيد", status: grade(cash.monthsOfExpenses, (x) => x >= 3, (x) => x >= 1), note: "كم شهراً تكفي النقدية لتغطية التكاليف لو توقفت الإيرادات" });

  // ── growth vs previous period of equal length
  const g = (a: number, b: number) => (Math.abs(b) < 0.005 ? null : r2(((a - b) / Math.abs(b)) * 100));
  const growth = { prevFrom, prevTo, sales: g(netSales, isP.netSales), grossProfit: g(gp, isP.grossProfit), opex: g(opex, isP.opex.total), net: g(net, isP.net), prev: { netSales: isP.netSales, grossProfit: isP.grossProfit, opex: isP.opex.total, net: isP.net } };

  // ── common-size income statement (vertical) with previous period (horizontal)
  const lines = [["صافي المبيعات", netSales, isP.netSales], ["تكلفة المبيعات", cogs, isP.cogs.total], ["مجمل الربح", gp, isP.grossProfit], ["المصروفات التشغيلية", opex, isP.opex.total], ["الربح التشغيلي", op, isP.operating], ["إيرادات أخرى", is.otherIncome.total, isP.otherIncome.total], ["مصروفات أخرى", is.otherExp.total, isP.otherExp.total], ["الزكاة", is.zakat.total, isP.zakat.total], ["صافي الربح", net, isP.net]] as [string, number, number][];
  const commonSize = lines.map(([name, cur, prev]) => ({ name, current: r2(cur), currentPct: pct(cur, netSales), previous: r2(prev), previousPct: pct(prev, isP.netSales), change: g(cur, prev) }));
  const opexBreakdown = (is.opex.sections || []).flatMap((s: any) => s.items).sort((a: any, b: any) => b.amount - a.amount).slice(0, 8).map((i: any) => ({ ...i, pct: pct(i.amount, netSales), share: pct(i.amount, opex) }));

  // ── concentration: customers & products (net of credit notes), ABC on products
  const cust = await t.rows(
    `SELECT COALESCE(i.partner_name,'—') name, SUM(CASE WHEN i.kind='CREDIT_NOTE' THEN -i.taxable ELSE i.taxable END) v
       FROM invoices i WHERE i.company_id=$1 AND i.direction='SALE' AND i.status='POSTED' AND i.kind IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE') AND i.date BETWEEN $2 AND $3 ${branchId ? "AND i.branch_id=$4" : ""}
      GROUP BY 1 HAVING SUM(CASE WHEN i.kind='CREDIT_NOTE' THEN -i.taxable ELSE i.taxable END) <> 0 ORDER BY 2 DESC`, branchId ? [companyId, from, to, branchId] : [companyId, from, to]);
  const prod = await t.rows(
    `SELECT COALESCE(p.name, l.description) name, SUM(CASE WHEN i.kind='CREDIT_NOTE' THEN -l.net_amount ELSE l.net_amount END) v,
            SUM(CASE WHEN i.kind='CREDIT_NOTE' THEN -1 ELSE 1 END * l.qty * COALESCE(l.factor,1) * COALESCE(l.unit_cost,0)) c
       FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id LEFT JOIN products p ON p.id=l.product_id
      WHERE i.company_id=$1 AND i.direction='SALE' AND i.status='POSTED' AND i.kind IN ('INVOICE','CREDIT_NOTE') AND i.date BETWEEN $2 AND $3 ${branchId ? "AND i.branch_id=$4" : ""}
      GROUP BY 1 HAVING SUM(CASE WHEN i.kind='CREDIT_NOTE' THEN -l.net_amount ELSE l.net_amount END) <> 0 ORDER BY 2 DESC`, branchId ? [companyId, from, to, branchId] : [companyId, from, to]);
  const totC = cust.reduce((a: number, r: any) => a + Number(r.v), 0), totP = prod.reduce((a: number, r: any) => a + Number(r.v), 0);
  let run = 0;
  const abc = prod.map((r: any) => { run += Number(r.v); const cum = totP ? (run / totP) * 100 : 0; const v = Number(r.v), c = Number(r.c); return { name: r.name, sales: r2(v), cost: r2(c), margin: v ? r2(((v - c) / v) * 100) : null, share: totP ? r2((v / totP) * 100) : 0, cumulative: r2(cum), class: cum - (totP ? (v / totP) * 100 : 0) < 80 ? "A" : cum - (totP ? (v / totP) * 100 : 0) < 95 ? "B" : "C" }; });
  const concentration = {
    customers: cust.length, top1: totC ? r2((Number(cust[0]?.v || 0) / totC) * 100) : 0, top5: totC ? r2((cust.slice(0, 5).reduce((a: number, r: any) => a + Number(r.v), 0) / totC) * 100) : 0,
    topCustomers: cust.slice(0, 10).map((r: any) => ({ name: r.name, sales: r2(r.v), share: totC ? r2((Number(r.v) / totC) * 100) : 0 })),
    products: prod.length, abc: abc.slice(0, 50), abcSummary: ["A", "B", "C"].map((k) => ({ class: k, count: abc.filter((x) => x.class === k).length, sales: r2(abc.filter((x) => x.class === k).reduce((a, x) => a + x.sales, 0)) })),
  };

  // ── 12-month trend ending at `to`
  // one pass over the 12 months: P&L by month plus cash movement, then a running cash balance
  const tStart = new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 12, 1)).toISOString().slice(0, 10);
  const tParams: any[] = [companyId, tStart, to];
  const tb = branchId ? (tParams.push(branchId), " AND e.branch_id=$4") : "";
  const raw = await t.rows(
    `SELECT to_char(e.date,'YYYY-MM') AS month,
       COALESCE(SUM(CASE WHEN a.subtype IN ('SALES','SALES_RETURNS') AND e.type<>'CLOSING' THEN l.credit-l.debit END),0) sales,
       COALESCE(SUM(CASE WHEN a.subtype='COGS' AND e.type<>'CLOSING' THEN l.debit-l.credit END),0) cogs,
       COALESCE(SUM(CASE WHEN a.subtype IN ('EXPENSE','SELLING_EXPENSE') AND e.type<>'CLOSING' THEN l.debit-l.credit END),0) opex,
       COALESCE(SUM(CASE WHEN a.type IN ('REVENUE','EXPENSE') AND e.type<>'CLOSING' THEN l.credit-l.debit END),0) net,
       COALESCE(SUM(CASE WHEN a.is_cash_bank THEN l.debit-l.credit END),0) cashmove
     FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id JOIN accounts a ON a.id=l.account_id
     WHERE e.company_id=$1 AND e.status='POSTED' AND e.date BETWEEN $2 AND $3${tb} GROUP BY 1`, tParams);
  const cash0 = await t.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id WHERE l.company_id=$1 AND e.status='POSTED' AND a.is_cash_bank AND e.date < $2`, [companyId, tStart]);
  const byM = new Map(raw.map((r: any) => [r.month, r]));
  let running = Number(cash0.b);
  const trend: any[] = [], cashTrend: any[] = [];
  for (let i = 0; i < 12; i++) {
    const d0 = new Date(Date.UTC(Number(tStart.slice(0, 4)), Number(tStart.slice(5, 7)) - 1 + i, 1)).toISOString().slice(0, 7);
    const r: any = byM.get(d0) || { sales: 0, cogs: 0, opex: 0, net: 0, cashmove: 0 };
    running += Number(r.cashmove);
    trend.push({ month: d0, ...r }); cashTrend.push({ month: d0, cash: running });
  }
  const months = trend.map((r: any, i: number) => { const s = Number(r.sales), c = Number(r.cogs); return { month: r.month, sales: r2(s), grossProfit: r2(s - c), grossMargin: s ? r2(((s - c) / s) * 100) : null, opex: r2(r.opex), net: r2(r.net), cash: r2(cashTrend[i]?.cash || 0) }; });

  // ── health score (weighted: liquidity 30, profitability 30, efficiency 20, leverage 20)
  const pts: Record<Status, number> = { good: 1, ok: 0.5, bad: 0, na: -1 };
  const weights: Record<string, number> = { "السيولة": 30, "الربحية": 30, "كفاءة النشاط": 20, "الرفع المالي": 20 };
  let score = 0, wsum = 0;
  for (const [grp, w] of Object.entries(weights)) {
    const rs = R.filter((r) => r.group === grp && r.status !== "na" && r.unit !== "SAR");
    if (!rs.length) continue;
    score += (rs.reduce((a, r) => a + pts[r.status], 0) / rs.length) * w; wsum += w;
  }
  const health = wsum ? Math.round((score / wsum) * 100) : null;
  const insights: string[] = [];
  if (growth.sales !== null) insights.push(`المبيعات ${growth.sales >= 0 ? "ارتفعت" : "انخفضت"} ${Math.abs(growth.sales)}% مقارنة بالفترة السابقة (${prevFrom} – ${prevTo}).`);
  if (gm !== null && isP.netSales) { const pg = r2((isP.grossProfit / isP.netSales) * 100); if (Math.abs(gm - pg) >= 2) insights.push(`هامش مجمل الربح ${gm > pg ? "تحسّن" : "تراجع"} من ${pg}% إلى ${gm}%.`); }
  if (breakEven.breakEvenSales !== null) insights.push(breakEven.achieved ? `تجاوزت المبيعات نقطة التعادل بهامش أمان ${breakEven.marginOfSafety}%.` : `المبيعات أقل من نقطة التعادل (${breakEven.breakEvenSales.toFixed(2)} ر.س) — تحتاج ${(breakEven.breakEvenSales - netSales).toFixed(2)} ر.س إضافية لتغطية المصروفات الثابتة.`);
  if (concentration.top5 >= 60 && concentration.customers > 5) insights.push(`تركّز مرتفع: أكبر 5 عملاء يمثلون ${concentration.top5}% من المبيعات — خطر الاعتماد على عدد محدود.`);
  if (dso !== null && dso > 60) insights.push(`التحصيل بطيء (${r2(dso)} يوماً) — راجع شروط الائتمان ومتابعة المتأخرات.`);
  if (cash.runwayMonths !== null) insights.push(`التدفق التشغيلي سالب — النقدية الحالية تكفي ${cash.runwayMonths} شهراً بالمعدل الحالي.`);
  if (E.equity < 0) insights.push("حقوق الملكية سالبة — الخسائر المتراكمة تجاوزت رأس المال.");
  const opTop = opexBreakdown[0];
  if (opTop && opex) insights.push(`أكبر بند مصروفات: ${opTop.name} (${opTop.share}% من المصروفات التشغيلية).`);
  return { from, to, days, prevFrom, prevTo, ratios: R, dupont, breakEven, cash, growth, commonSize, opexBreakdown, concentration, months, health, insights, snapshot: { end: E, start: O }, summary: { netSales, grossProfit: gp, operating: op, net, opex, cogs } };
}

// ─── charity governance indicators ─────────────────────────────────────────
export async function charityIndicators(t: Db, companyId: string, q: any) {
  const to = isDate(q.to) ? q.to : today();
  const from = isDate(q.from) ? q.from : to.slice(0, 4) + "-01-01";
  const days = daysBetween(from, to);
  const prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -(days - 1));
  const exp = await t.rows(
    `SELECT a.code, a.name_ar, a.system_key, a.subtype, SUM(l.debit-l.credit) v FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id
      WHERE l.company_id=$1 AND e.status='POSTED' AND e.type<>'CLOSING' AND a.type='EXPENSE' AND e.date BETWEEN $2 AND $3 GROUP BY a.id HAVING SUM(l.debit-l.credit)<>0`, [companyId, from, to]);
  const isProgram = (a: any) => a.code.startsWith("55");
  const program = r2(exp.filter(isProgram).reduce((s: number, a: any) => s + Number(a.v), 0));
  const totalExp = r2(exp.reduce((s: number, a: any) => s + Number(a.v), 0));
  const admin = r2(totalExp - program);
  const rev = await t.rows(
    `SELECT source, COUNT(*)::int n, SUM(amount) v, COUNT(DISTINCT COALESCE(partner_id::text, payer_name))::int donors, SUM(CASE WHEN restricted THEN amount ELSE 0 END) restricted
       FROM charity_receipts WHERE company_id=$1 AND status='POSTED' AND date BETWEEN $2 AND $3 GROUP BY source ORDER BY 3 DESC`, [companyId, from, to]);
  const totalRev = r2(rev.reduce((s: number, r: any) => s + Number(r.v), 0));
  const restricted = r2(rev.reduce((s: number, r: any) => s + Number(r.restricted), 0));
  const donorsQ = async (a: string, b: string) => (await t.rows(`SELECT DISTINCT COALESCE(partner_id::text, payer_name) k FROM charity_receipts WHERE company_id=$1 AND status='POSTED' AND date BETWEEN $2 AND $3`, [companyId, a, b])).map((r: any) => r.k);
  const cur = await donorsQ(from, to), prev = await donorsQ(prevFrom, prevTo);
  const retained = prev.filter((k) => cur.includes(k)).length;
  const newDonors = cur.filter((k) => !prev.includes(k)).length;
  const gifts = await t.one(`SELECT COUNT(*)::int n, COALESCE(AVG(amount),0) avg, COALESCE(MAX(amount),0) mx FROM charity_receipts WHERE company_id=$1 AND status='POSTED' AND date BETWEEN $2 AND $3`, [companyId, from, to]);
  const aid = await t.one(`SELECT COUNT(*)::int n, COUNT(DISTINCT COALESCE(partner_id::text, beneficiary_name))::int people, COALESCE(SUM(amount),0) v FROM charity_disbursements WHERE company_id=$1 AND status='POSTED' AND capacity='BENEFICIARY' AND date BETWEEN $2 AND $3`, [companyId, from, to]);
  const inkind = await t.maybe(`SELECT COALESCE(SUM(total),0) v, COUNT(DISTINCT party_name)::int people FROM charity_inkind_docs WHERE company_id=$1 AND status='POSTED' AND kind='OUT' AND date BETWEEN $2 AND $3`, [companyId, from, to]);
  const zIn = await t.one(`SELECT COALESCE(SUM(amount),0) v FROM charity_receipts WHERE company_id=$1 AND status='POSTED' AND source='ZAKAT' AND date BETWEEN $2 AND $3`, [companyId, from, to]);
  const zOut = await t.one(`SELECT COALESCE(SUM(amount),0) v FROM charity_disbursements WHERE company_id=$1 AND status='POSTED' AND fund='ZAKAT' AND date BETWEEN $2 AND $3`, [companyId, from, to]);
  const cashRow = await t.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id WHERE l.company_id=$1 AND e.status='POSTED' AND a.is_cash_bank AND e.date <= $2`, [companyId, to]);
  const vol = await t.maybe(`SELECT COALESCE(SUM(hours),0) h, COUNT(DISTINCT volunteer_id)::int n FROM charity_volunteer_hours WHERE company_id=$1 AND date BETWEEN $2 AND $3`, [companyId, from, to]);
  const bud = await t.one(`SELECT COALESCE(SUM(amount),0) planned FROM charity_budget_lines WHERE company_id=$1 AND kind='EXPENSE' AND year=$2`, [companyId, Number(to.slice(0, 4))]);
  const monthlyExp = totalExp > 0 ? (totalExp / days) * 30.4 : 0;
  const ratio = (a: number, b: number) => (b ? r2((a / b) * 100) : null);
  const progR = ratio(program, totalExp), adminR = ratio(admin, totalExp);
  const reserves = monthlyExp > 0 ? r2(Number(cashRow.b) / monthlyExp) : null;
  const people = Number(aid.people) + Number(inkind?.people || 0);
  const ind: Ratio[] = [
    { key: "program", group: "كفاءة الإنفاق", name: "نسبة الإنفاق على البرامج والمستفيدين", value: progR, unit: "%", formula: "مصروفات البرامج والمساعدات ÷ إجمالي المصروفات", benchmark: "65% فأكثر جيد", status: grade(progR, (x) => x >= 65, (x) => x >= 50), note: "مؤشر رئيسي لدى الجهات المانحة: كم يصل للمستفيدين من كل ريال" },
    { key: "admin", group: "كفاءة الإنفاق", name: "نسبة المصروفات الإدارية والعمومية", value: adminR, unit: "%", formula: "المصروفات الإدارية ÷ إجمالي المصروفات", benchmark: "أقل من 35%", status: grade(adminR, (x) => x <= 35, (x) => x <= 50), note: "الرواتب والإيجارات والمصروفات التشغيلية غير المباشرة" },
    { key: "cpb", group: "كفاءة الإنفاق", name: "متوسط الدعم لكل مستفيد", value: people ? r2((Number(aid.v) + Number(inkind?.v || 0)) / people) : null, unit: "SAR", formula: "(المساعدات النقدية + العينية) ÷ عدد المستفيدين", benchmark: "حسب طبيعة البرامج", status: "na", note: `${people} مستفيد خُدموا في الفترة` },
    { key: "retention", group: "تنمية الموارد", name: "معدل الاحتفاظ بالمتبرعين", value: prev.length ? r2((retained / prev.length) * 100) : null, unit: "%", formula: "متبرعو الفترة السابقة الذين تبرعوا مجدداً ÷ متبرعي الفترة السابقة", benchmark: "45% فأكثر جيد", status: grade(prev.length ? (retained / prev.length) * 100 : null, (x) => x >= 45, (x) => x >= 25), note: `${retained} من ${prev.length} متبرع عادوا · ${newDonors} متبرع جديد` },
    { key: "avgGift", group: "تنمية الموارد", name: "متوسط التبرع", value: r2(gifts.avg), unit: "SAR", formula: "إجمالي التبرعات ÷ عدد السندات", benchmark: "—", status: "na", note: `${gifts.n} سند · أعلى تبرع ${r2(gifts.mx)} ر.س` },
    { key: "restricted", group: "تنمية الموارد", name: "نسبة الإيرادات المقيدة", value: ratio(restricted, totalRev), unit: "%", formula: "التبرعات المقيدة بمشاريع ÷ إجمالي الإيرادات", benchmark: "توازن بين المقيد والعام", status: "na", note: "الإيرادات المقيدة لا تُصرف إلا على مشاريعها" },
    { key: "coverage", group: "الاستدامة المالية", name: "تغطية الإيرادات للمصروفات", value: totalExp ? r2(totalRev / totalExp) : null, unit: "x", formula: "إجمالي التبرعات والمنح ÷ إجمالي المصروفات", benchmark: "1 فأكثر", status: grade(totalExp ? totalRev / totalExp : null, (x) => x >= 1, (x) => x >= 0.8), note: "هل تغطي الموارد المحصّلة الإنفاق في الفترة" },
    { key: "reserves", group: "الاستدامة المالية", name: "الاحتياطي النقدي", value: reserves, unit: "months", formula: "النقدية والبنوك ÷ متوسط المصروفات الشهرية", benchmark: "3 – 12 شهراً", status: grade(reserves, (x) => x >= 3 && x <= 12, (x) => x >= 1), note: reserves !== null && reserves > 12 ? "احتياطي مرتفع — يمكن توجيه جزء منه للبرامج" : "قدرة الجمعية على الاستمرار دون إيرادات جديدة" },
    { key: "zakat", group: "الاستدامة المالية", name: "نسبة توزيع الزكاة", value: ratio(Number(zOut.v), Number(zIn.v)), unit: "%", formula: "الزكاة المصروفة ÷ الزكاة المحصّلة في الفترة", benchmark: "قريبة من 100%", status: Number(zIn.v) ? grade(ratio(Number(zOut.v), Number(zIn.v)), (x) => x >= 80, (x) => x >= 50) : "na", note: "الأصل تعجيل إخراج الزكاة لمستحقيها" },
    { key: "budget", group: "الاستدامة المالية", name: "تنفيذ موازنة المصروفات", value: Number(bud.planned) ? r2((totalExp / Number(bud.planned)) * 100) : null, unit: "%", formula: "المصروفات الفعلية ÷ المصروفات المقدّرة للسنة", benchmark: "حسب الفترة المنقضية من السنة", status: "na", note: Number(bud.planned) ? `المقدّر ${r2(bud.planned)} ر.س` : "لا توجد موازنة مقدّرة لهذه السنة" },
  ];
  if (vol && Number(vol.h)) ind.push({ key: "vol", group: "تنمية الموارد", name: "ساعات التطوع", value: r2(vol.h), unit: "x", formula: "مجموع الساعات المسجلة", benchmark: "—", status: "na", note: `${vol.n} متطوع · قيمة تقديرية ${r2(Number(vol.h) * 50)} ر.س (50 ر.س/ساعة)` });
  const months = await t.rows(
    `WITH m AS (SELECT generate_series(date_trunc('month', $2::date) - interval '11 months', date_trunc('month', $2::date), interval '1 month')::date ms)
     SELECT to_char(m.ms,'YYYY-MM') AS month,
       (SELECT COALESCE(SUM(amount),0) FROM charity_receipts r WHERE r.company_id=$1 AND r.status='POSTED' AND r.date >= m.ms AND r.date < m.ms + interval '1 month') donations,
       (SELECT COALESCE(SUM(amount),0) FROM charity_disbursements d WHERE d.company_id=$1 AND d.status='POSTED' AND d.capacity='BENEFICIARY' AND d.date >= m.ms AND d.date < m.ms + interval '1 month') aid,
       (SELECT COALESCE(SUM(l.debit-l.credit),0) FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id WHERE l.company_id=$1 AND e.status='POSTED' AND e.type<>'CLOSING' AND a.type='EXPENSE' AND a.code NOT LIKE '55%' AND e.date >= m.ms AND e.date < m.ms + interval '1 month') admin
     FROM m ORDER BY m.ms`, [companyId, to]);
  const SRC: Record<string, string> = { CASH_DONATION: "تبرع نقدي", SUPPORT: "دعم مالي / منحة", FOUNDING: "مساهمة تأسيسية", PROGRAM: "إيرادات برامج", ZAKAT: "زكاة", MEMBERSHIP: "اشتراك عضوية", SPONSORSHIP: "كفالة", REFUND: "استرداد", OTHER: "أخرى" };
  return {
    from, to, prevFrom, prevTo, indicators: ind,
    totals: { revenue: totalRev, expenses: totalExp, program, admin, surplus: r2(totalRev - totalExp), cash: r2(cashRow.b), donors: cur.length, newDonors, beneficiaries: people, aid: r2(aid.v), zakatIn: r2(zIn.v), zakatOut: r2(zOut.v) },
    revenueMix: rev.map((r: any) => ({ source: SRC[r.source] || r.source, amount: r2(r.v), count: r.n, donors: r.donors, share: totalRev ? r2((Number(r.v) / totalRev) * 100) : 0 })),
    expenseMix: exp.sort((a: any, b: any) => Number(b.v) - Number(a.v)).slice(0, 10).map((a: any) => ({ name: a.nameAr, amount: r2(a.v), program: isProgram(a), share: totalExp ? r2((Number(a.v) / totalExp) * 100) : 0 })),
    months: months.map((m: any) => ({ month: m.month, donations: r2(m.donations), aid: r2(m.aid), admin: r2(m.admin) })),
  };
}
