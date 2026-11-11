/**
 * The analyst side of the built-in assistant: figures worked out from the books (no language model involved) —
 * financial ratios with a grade and a recommendation, period-to-period comparison, one item's position,
 * the VAT position, and payroll totals. The wording of the answers lives in aiLocal.ts.
 */
import { Db } from "../db/pool";
import { r2, isDate, today } from "../lib/core";
import { incomeStatement, balanceSheet, vatReturn } from "./reports";
import { executive } from "./insights";

const AR = (col: string) => `replace(replace(replace(replace(replace(lower(${col}),'أ','ا'),'إ','ا'),'آ','ا'),'ة','ه'),'ى','ي')`;
const arNorm = (s: string) => String(s || "").toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
type Grade = "good" | "ok" | "weak" | "na";
export type Ratio = { key: string; name: string; value: number | null; unit: "x" | "%" | "d" | ""; grade: Grade; bench: string; meaning: string };

/** Liquidity, profitability, activity and leverage ratios for a period, each graded against a common benchmark. */
export async function financialAnalysis(t: Db, C: string, q: any) {
  const to = isDate(q.to) ? q.to : today();
  const from = isDate(q.from) && q.from <= to ? q.from : `${to.slice(0, 4)}-01-01`;
  const days = daysBetween(from, to);
  const is: any = await incomeStatement(t, C, { from, to });
  const bs: any = await balanceSheet(t, C, { to });
  const sec = (g: any, keys: string[]) => r2(g.sections.filter((s: any) => keys.includes(s.subtype)).reduce((a: number, s: any) => a + s.total, 0));
  const cash = sec(bs.currentAssets, ["CASH", "BANK"]), ar = sec(bs.currentAssets, ["RECEIVABLE"]), inv = sec(bs.currentAssets, ["INVENTORY"]);
  const ca = bs.currentAssets.total, cl = bs.currentLiab.total, ap = sec(bs.currentLiab, ["PAYABLE"]);
  const sales = is.netSales, cogs = is.cogs.total, opex = is.opex.total, net = is.net;
  const div = (a: number, b: number) => (Math.abs(b) < 0.005 ? null : r2(a / b));
  const g = (v: number | null, good: number, ok: number, lowerIsBetter = false): Grade => v === null ? "na" : lowerIsBetter ? (v <= good ? "good" : v <= ok ? "ok" : "weak") : (v >= good ? "good" : v >= ok ? "ok" : "weak");
  const dso = sales > 0 ? r2((ar / sales) * days) : null, dio = cogs > 0 ? r2((inv / cogs) * days) : null, dpo = cogs > 0 ? r2((ap / cogs) * days) : null;
  const current = div(ca, cl), quick = div(ca - inv, cl), cashR = div(cash, cl);
  const gm = sales > 0 ? is.grossMargin : null, nm = sales > 0 ? is.netMargin : null, opx = sales > 0 ? r2((opex / sales) * 100) : null;
  const debt = bs.totalAssets > 0 ? r2((bs.totalLiab / bs.totalAssets) * 100) : null;
  const roe = bs.totalEquity > 0 ? r2((net / bs.totalEquity) * 100) : null;
  const ratios: Ratio[] = [
    { key: "current", name: "نسبة التداول", value: current, unit: "x", grade: cl < 0.005 ? "good" : g(current, 1.5, 1), bench: "1.5 فأكثر", meaning: "الأصول المتداولة ÷ الالتزامات المتداولة: قدرة المنشأة على سداد التزامات السنة" },
    { key: "quick", name: "نسبة السيولة السريعة", value: quick, unit: "x", grade: cl < 0.005 ? "good" : g(quick, 1, 0.7), bench: "1 فأكثر", meaning: "كالتداول لكن بلا المخزون: السداد دون انتظار بيع البضاعة" },
    { key: "cash", name: "نسبة النقدية", value: cashR, unit: "x", grade: cl < 0.005 ? "good" : g(cashR, 0.2, 0.1), bench: "0.2 فأكثر", meaning: "النقد والبنوك ÷ الالتزامات المتداولة" },
    { key: "gm", name: "هامش مجمل الربح", value: gm, unit: "%", grade: g(gm, 25, 10), bench: "25% فأكثر (يختلف حسب النشاط)", meaning: "ما يبقى من كل 100 مبيعات بعد تكلفة البضاعة" },
    { key: "opex", name: "المصروفات إلى المبيعات", value: opx, unit: "%", grade: g(opx, 20, 35, true), bench: "20% فأقل", meaning: "ما تأكله المصروفات التشغيلية من المبيعات" },
    { key: "nm", name: "هامش صافي الربح", value: nm, unit: "%", grade: g(nm, 10, 3), bench: "10% فأكثر", meaning: "صافي الربح من كل 100 مبيعات" },
    { key: "dso", name: "فترة التحصيل", value: dso, unit: "d", grade: g(dso, 45, 75, true), bench: "45 يوماً فأقل", meaning: "متوسط الأيام بين البيع الآجل وتحصيله" },
    { key: "dio", name: "فترة بقاء المخزون", value: dio, unit: "d", grade: g(dio, 60, 120, true), bench: "60 يوماً فأقل", meaning: "متوسط الأيام التي تبقاها البضاعة قبل بيعها" },
    { key: "dpo", name: "فترة السداد للموردين", value: dpo, unit: "d", grade: "na", bench: "قريبة من فترة التحصيل", meaning: "متوسط الأيام حتى نسدد للمورد" },
    { key: "ccc", name: "دورة التحويل النقدي", value: dso !== null && dio !== null && dpo !== null ? r2(dso + dio - dpo) : null, unit: "d", grade: g(dso !== null && dio !== null && dpo !== null ? dso + dio - dpo : null, 60, 120, true), bench: "كلما قصرت أفضل", meaning: "الأيام بين دفع ثمن البضاعة وتحصيل ثمن بيعها" },
    { key: "debt", name: "نسبة المديونية", value: debt, unit: "%", grade: g(debt, 50, 70, true), bench: "50% فأقل", meaning: "ما يموّله الدائنون من إجمالي الأصول" },
    { key: "roe", name: "العائد على حقوق الملكية", value: roe, unit: "%", grade: bs.totalEquity <= 0 ? "weak" : g(roe, 15 * days / 365, 5 * days / 365), bench: "15% سنوياً فأكثر", meaning: "صافي ربح الفترة ÷ حقوق الملكية" },
  ];
  const R = (k: string) => ratios.find((x) => x.key === k)!;
  const actions: string[] = [];
  if (sales <= 0) actions.push("لا مبيعات مرحّلة في الفترة: النسب المرتبطة بالمبيعات غير محسوبة. اختر فترة فيها نشاط أو رحّل الفواتير المسودة.");
  if (R("current").grade === "weak") actions.push(`الالتزامات المتداولة (${cl.toLocaleString("en")}) أكبر من الأصول المتداولة (${ca.toLocaleString("en")}): عجّل التحصيل، أجّل المشتريات غير الضرورية، أو حوّل جزءاً من الدين القصير إلى تمويل طويل الأجل.`);
  else if (R("quick").grade === "weak") actions.push("السيولة تعتمد على بيع المخزون: خفّض الأصناف الراكدة وحوّلها إلى نقد بعروض، وشدّد شروط البيع الآجل.");
  if (R("gm").grade === "weak" && sales > 0) actions.push("هامش مجمل الربح ضعيف: راجع أسعار البيع والخصومات الممنوحة، وفاوض الموردين على التكلفة، وركّز على الأصناف الأعلى هامشاً.");
  if (R("opex").grade === "weak") actions.push("المصروفات التشغيلية مرتفعة قياساً بالمبيعات: راجع أكبر ثلاثة بنود مصروفات وضع لها موازنة شهرية.");
  if (nm !== null && nm < 0) actions.push("النتيجة خسارة: المبيعات لا تغطي التكلفة والمصروفات. حدّد نقطة التعادل وقارنها بمبيعاتك الشهرية.");
  if (R("dso").grade === "weak") actions.push(`التحصيل بطيء (${Math.round(dso!)} يوماً): تابع المتأخرين من شاشة التحصيل، وضع حد ائتمان لكل عميل، واعرض خصم تعجيل الدفع.`);
  if (R("dio").grade === "weak") actions.push(`المخزون يدور ببطء (${Math.round(dio!)} يوماً): قلّل كميات الشراء للأصناف البطيئة واعتمد حد إعادة الطلب بدل الشراء بالجملة.`);
  if (dso !== null && dpo !== null && dpo + 15 < dso) actions.push("نسدد للموردين أسرع مما نحصّل من العملاء: اطلب مهلة سداد أطول من الموردين الرئيسيين.");
  if (R("debt").grade === "weak") actions.push("الاعتماد على الدائنين مرتفع: أبقِ الأرباح في المنشأة أو زد رأس المال قبل أي توسع بالدين.");
  if (bs.totalEquity <= 0) actions.push("حقوق الملكية سالبة أو صفر: الخسائر المتراكمة استهلكت رأس المال — يلزم دعم من الملاك.");
  if (!actions.length) actions.push("المؤشرات ضمن الحدود الجيدة. حافظ على متابعة التحصيل ودوران المخزون شهرياً.");
  const graded = ratios.filter((x) => x.grade !== "na" && x.value !== null);
  const score = graded.length ? Math.round((graded.reduce((a, x) => a + (x.grade === "good" ? 1 : x.grade === "ok" ? 0.5 : 0), 0) / graded.length) * 100) : null;
  return { period: { from, to, days }, figures: { sales, cogs, grossProfit: is.grossProfit, opex, net, cash, receivables: ar, inventory: inv, currentAssets: ca, currentLiab: cl, payables: ap, workingCapital: r2(ca - cl), totalAssets: bs.totalAssets, totalLiab: bs.totalLiab, equity: bs.totalEquity }, ratios, actions, score, balanced: bs.balanced };
}

/** The same headline figures for two periods, side by side. */
export async function comparePeriods(t: Db, C: string, q: any) {
  const pick = async (p: any) => { const d: any = await executive(t, C, { from: p.from, to: p.to }); return { label: String(p.label || `${d.period.from} → ${d.period.to}`), from: d.period.from, to: d.period.to, kpis: d.kpis, topProduct: d.topProducts[0]?.name || null, topExpense: (d.expByAccount || [])[0] || null }; };
  if (!isDate(q?.a?.from) || !isDate(q?.a?.to) || !isDate(q?.b?.from) || !isDate(q?.b?.to)) return { error: "حدّد فترتين للمقارنة" };
  return { metric: String(q.metric || "summary"), a: await pick(q.a), b: await pick(q.b) };
}

/** One item: stock on hand and its cost, prices, what it sold and earned in the period, and the last purchase. */
export async function productInfo(t: Db, C: string, q: any) {
  const n = arNorm(q.query); if (n.length < 2) return { found: 0 };
  const cols = `id, sku, name, unit, type, sale_price, purchase_price, reorder_level`;
  let rows = await t.rows(`SELECT ${cols} FROM products WHERE company_id=$1 AND is_active AND (${AR("name")} LIKE $2 OR lower(sku) = $3 OR barcode = $3) ORDER BY (${AR("name")} = $3) DESC, length(name) LIMIT 6`, [C, `%${n}%`, n]);
  const words = n.split(" ").filter((w) => w.length > 1);
  if (!rows.length && words.length > 1) rows = await t.rows(`SELECT ${cols} FROM products WHERE company_id=$1 AND is_active AND ${words.map((_, i) => `${AR("name")} LIKE $${i + 2}`).join(" AND ")} ORDER BY length(name) LIMIT 6`, [C, ...words.map((w) => `%${w}%`)]);
  if (!rows.length) return { found: 0 };
  const exact = rows.find((r) => arNorm(r.name) === n || String(r.sku).toLowerCase() === n);
  if (rows.length > 1 && !exact) return { found: rows.length, candidates: rows.map((r) => r.name) };
  const p = exact || rows[0];
  const to = isDate(q.to) ? q.to : today(); const from = isDate(q.from) && q.from <= to ? q.from : `${to.slice(0, 8)}01`;
  const st = await t.one(`SELECT COALESCE(SUM(qty),0) qty, COALESCE(SUM(value),0) value FROM stock_balances WHERE company_id=$1 AND product_id=$2`, [C, p.id]);
  const sold = await t.one(`SELECT COALESCE(SUM(s*l.qty*COALESCE(l.factor,1)),0) qty, COALESCE(SUM(s*l.net_amount*COALESCE(i.exchange_rate,1)),0) net, COALESCE(SUM(s*l.qty*COALESCE(l.factor,1)*COALESCE(l.unit_cost,0)),0) cost, COUNT(DISTINCT i.id) FILTER (WHERE i.kind='INVOICE')::int n
    FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id CROSS JOIN LATERAL (SELECT CASE WHEN i.kind='CREDIT_NOTE' THEN -1 ELSE 1 END s) x
    WHERE i.company_id=$1 AND l.product_id=$2 AND i.direction='SALE' AND i.status='POSTED' AND i.kind IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE') AND i.date BETWEEN $3 AND $4`, [C, p.id, from, to]);
  const lastBuy = await t.maybe(`SELECT i.date, i.number, l.unit_price, pt.name supplier FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id LEFT JOIN partners pt ON pt.id=i.partner_id WHERE i.company_id=$1 AND l.product_id=$2 AND i.direction='PURCHASE' AND i.status='POSTED' AND i.kind='INVOICE' ORDER BY i.date DESC, i.created_at DESC LIMIT 1`, [C, p.id]);
  const qty = Number(st.qty), avgCost = qty > 0 ? r2(Number(st.value) / qty) : 0, price = Number(p.salePrice || 0);
  const dailyQty = Number(sold.qty) / daysBetween(from, to);
  return { found: 1, id: p.id, sku: p.sku, name: p.name, unit: p.unit, isService: p.type === "SERVICE", period: { from, to }, onHand: r2(qty), stockValue: r2(st.value), avgCost, salePrice: price, unitMargin: price > 0 && avgCost > 0 ? r2(((price - avgCost) / price) * 100) : null,
    reorderLevel: Number(p.reorderLevel || 0), soldQty: r2(sold.qty), soldNet: r2(sold.net), soldProfit: r2(Number(sold.net) - Number(sold.cost)), invoices: sold.n, daysCover: dailyQty > 0 && qty > 0 ? Math.round(qty / dailyQty) : null,
    lastPurchase: lastBuy ? { date: String(lastBuy.date instanceof Date ? lastBuy.date.toISOString() : lastBuy.date).slice(0, 10), number: lastBuy.number, price: r2(lastBuy.unitPrice), supplier: lastBuy.supplier } : null };
}

/** VAT of a period as the return computes it: output − input. */
export async function vatPosition(t: Db, C: string, q: any) {
  const to = isDate(q.to) ? q.to : today(); const from = isDate(q.from) && q.from <= to ? q.from : `${to.slice(0, 8)}01`;
  const v: any = await vatReturn(t, C, { from, to });
  return { period: { from, to }, outputVat: v.outputVat, inputVat: v.inputVat, net: v.net, reconciled: v.reconciled };
}

/** Headcount, the monthly wage bill, the latest payroll run and what is still out on loans. */
export async function hrSummary(t: Db, C: string) {
  const e = await t.one(`SELECT COUNT(*) FILTER (WHERE is_active)::int n, COALESCE(SUM(basic+housing+transport+other_allow) FILTER (WHERE is_active),0) wages FROM employees WHERE company_id=$1`, [C]);
  const run = await t.maybe(`SELECT period, status, total_gross, total_deductions, total_net, total_gosi_er FROM payroll_runs WHERE company_id=$1 ORDER BY period DESC, created_at DESC LIMIT 1`, [C]);
  const loans = await t.one(`SELECT COUNT(*)::int n, COALESCE(SUM(amount-paid),0) rest FROM employee_loans WHERE company_id=$1 AND status='ACTIVE'`, [C]);
  const items = await t.one(`SELECT COUNT(*)::int n FROM payroll_items WHERE company_id=$1 AND status='OPEN'`, [C]);
  return { employees: e.n, wages: r2(e.wages), lastRun: run ? { period: run.period, status: run.status, gross: r2(run.totalGross), deductions: r2(run.totalDeductions), net: r2(run.totalNet), employerCost: r2(run.totalGosiEr) } : null, loans: { count: loans.n, rest: r2(loans.rest) }, openItems: items.n };
}
