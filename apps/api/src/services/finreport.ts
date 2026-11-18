/**
 * The written financial report: the company's position and the state of its books for a period, in plain sentences
 * built from the posted ledger (income statement, balance sheet, cash flow through financialAnalysis), the operating
 * dashboard (receivables, stock, alerts) and a set of book-keeping and regulatory checks for the Saudi or the Egyptian
 * edition. Every figure in the text comes from those reports, so the report always agrees with them.
 * The text is produced in Arabic or in English (lang=en) — not translated afterwards.
 */
import { Db } from "../db/pool";
import { r2, today, isDate, addDays, addMonths } from "../lib/core";
import { CFG, IS_EG } from "../lib/country";
import { financialAnalysis } from "./round25";
import { executive, dashFilters } from "./insights";
import { integrity, vatReturn, accountantAlerts } from "./reports";
import { checkPartner } from "../lib/partnerRules";

type Level = "good" | "ok" | "warn" | "bad" | "info";
export interface Check { key: string; label: string; status: Level; text: string; to?: string; ref?: string }
export interface Section { key: string; title: string; status: Level; paragraphs: string[]; table?: { head: string[]; rows: (string | number)[][] } }

const N = (v: any) => Number(v || 0);
const monthEnd = (d: string) => { const x = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)); return x.toISOString().slice(0, 10); };

export async function financialReport(t: Db, C: string, q: any = {}) {
  const en = q.lang === "en";
  const T = (ar: string, e: string) => (en ? e : ar);
  const to = isDate(q.to) ? q.to : today();
  const from = isDate(q.from) && q.from <= to ? q.from : to.slice(0, 8) + "01";
  const F = dashFilters(q);
  const branchId = F.branchId || undefined;
  const cur = en ? CFG.currency : CFG.currencySymbol;
  const num = (v: any, d = 2) => N(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const m = (v: any) => (en ? `${cur} ${num(v)}` : `${num(v)} ${cur}`);
  const pc = (v: any) => (v === null || v === undefined ? "—" : `${num(v, 1)}%`);
  const dd = (v: any) => (v === null || v === undefined ? "—" : en ? `${num(v, 0)} days` : `${num(v, 0)} يوماً`);
  const chg = (v: number | null | undefined, upGood = true) => v === null || v === undefined ? "" : v === 0 ? T(" دون تغيّر عن فترة المقارنة", " unchanged from the comparison period")
    : T(` ${v > 0 ? "بارتفاع" : "بانخفاض"} ${num(Math.abs(v), 1)}% عن فترة المقارنة${(v > 0) === upGood ? "" : ""}`, ` ${v > 0 ? "up" : "down"} ${num(Math.abs(v), 1)}% on the comparison period`);

  const co = await t.one(`SELECT name_ar, name_en, vat_number, vat_period FROM companies WHERE id=$1`, [C]);
  const [fa, ex] = [await financialAnalysis(t, C, { from, to, branchId }), await executive(t, C, { from, to, branchId: F.branchId, compare: F.compare })];
  const integ = branchId ? null : await integrity(t, C);
  const vat = await vatReturn(t, C, { from, to });
  const tdy = today();
  const alerts = await accountantAlerts(t, C, tdy);
  const R = (k: string) => fa.ratios.find((r: any) => r.key === k) as any;
  const S = fa.summary, E = fa.snapshot.end, O = fa.snapshot.start;
  const rv = ex.receivables, pv = ex.payables, inv = ex.inventory;
  const prevNet = fa.growth.prev.net, prevSales = fa.growth.prev.netSales;

  // ── book-keeping checks ────────────────────────────────────────────────────
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  if (integ) {
    const bad = integ.checks.filter((c: any) => !c.ok);
    add({ key: "integrity", label: T("مطابقة الدفاتر المساعدة مع الأستاذ العام", "Sub-ledgers agree with the general ledger"), status: bad.length ? "bad" : "good", to: "/reports/integrity",
      text: bad.length ? T(`${bad.length} من ${integ.checks.length} فحص تطابق لم ينجح: ${bad.slice(0, 3).map((c: any) => c.name).join("؛ ")}`, `${bad.length} of ${integ.checks.length} reconciliation checks failed — open the books check for details`)
        : T(`نجحت كل فحوص التطابق (${integ.checks.length}): ميزان المراجعة متوازن، والميزانية متوازنة، وأرصدة العملاء والموردين والمخزون والضريبة تطابق حساباتها.`, `All ${integ.checks.length} reconciliation checks pass: trial balance and balance sheet balance; customers, suppliers, stock and VAT agree with their accounts.`) });
  }
  const drafts = await t.one(`SELECT (SELECT COUNT(*) FROM invoices WHERE company_id=$1 AND status='DRAFT' AND kind IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE') AND date <= $2)::int docs,
      (SELECT COUNT(*) FROM journal_drafts WHERE company_id=$1 AND status='SUBMITTED')::int journals`, [C, to]);
  add({ key: "drafts", label: T("مستندات غير مرحّلة", "Unposted documents"), status: drafts.docs + drafts.journals ? "warn" : "good", to: "/sales/invoices",
    text: drafts.docs + drafts.journals ? T(`${drafts.docs} مستند مسودة و${drafts.journals} قيد بانتظار الاعتماد حتى ${to} — لا تدخل القوائم المالية حتى تُرحَّل.`, `${drafts.docs} draft documents and ${drafts.journals} journal entries awaiting approval up to ${to} — they are not in the statements until posted.`)
      : T("لا توجد مستندات مسودة ولا قيود معلّقة.", "No draft documents or pending journal entries.") });
  const negCash = await t.rows(`SELECT a.code, a.name_ar, SUM(l.debit-l.credit) b FROM accounts a JOIN journal_lines l ON l.account_id=a.id JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED'
      WHERE a.company_id=$1 AND a.is_cash_bank AND NOT a.is_group AND e.date <= $2 GROUP BY a.id HAVING SUM(l.debit-l.credit) < -0.005 ORDER BY 3`, [C, to]);
  add({ key: "cash", label: T("أرصدة الصناديق والبنوك", "Cash and bank balances"), status: negCash.length ? "bad" : "good", to: "/treasury",
    text: negCash.length ? T(`${negCash.length} حساب نقدية برصيد دائن (سالب) وهذا غير ممكن فعلياً: ${negCash.slice(0, 3).map((a: any) => `${a.code} ${a.nameAr} (${m(a.b)})`).join("، ")} — غالباً سند صرف أو مصروف سُجّل على الحساب الخطأ أو قبض لم يُسجَّل.`, `${negCash.length} cash/bank accounts have a credit (negative) balance, which cannot happen in reality: ${negCash.slice(0, 3).map((a: any) => `${a.code} (${m(a.b)})`).join(", ")} — usually a payment posted to the wrong account or a receipt not recorded.`)
      : T("لا يوجد صندوق أو بنك برصيد سالب.", "No cash or bank account is negative.") });
  const partnerBal = await t.one(`SELECT
      COUNT(*) FILTER (WHERE k='AR' AND b < -0.5)::int ar_n, COALESCE(SUM(-b) FILTER (WHERE k='AR' AND b < -0.5),0) ar_v,
      COUNT(*) FILTER (WHERE k='AP' AND b > 0.5)::int ap_n, COALESCE(SUM(b) FILTER (WHERE k='AP' AND b > 0.5),0) ap_v
    FROM (SELECT a.system_key k, l.partner_id, SUM(l.debit-l.credit) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED'
      WHERE a.company_id=$1 AND a.system_key IN ('AR','AP') AND l.partner_id IS NOT NULL AND e.date <= $2 GROUP BY 1,2) x`, [C, to]);
  add({ key: "partners", label: T("أرصدة العملاء والموردين بعكس طبيعتها", "Customer and supplier balances on the wrong side"), status: partnerBal.arN + partnerBal.apN ? "info" : "good", to: "/reports/aging",
    text: partnerBal.arN + partnerBal.apN ? T(`${partnerBal.arN} عميل برصيد دائن (${m(partnerBal.arV)} دفعات مقدمة أو مبالغ زائدة) و${partnerBal.apN} مورد برصيد مدين (${m(partnerBal.apV)}). راجعها: إما دفعات مقدمة تُخصَّص لاحقاً أو أخطاء تسجيل. في القوائم المنشورة تُعرض أرصدة العملاء الدائنة ضمن الخصوم.`, `${partnerBal.arN} customers with a credit balance (${m(partnerBal.arV)} advances or overpayments) and ${partnerBal.apN} suppliers with a debit balance (${m(partnerBal.apV)}). Review them: advances to be allocated, or posting errors. In published statements customer credit balances belong with liabilities.`)
      : T("لا توجد أرصدة عملاء دائنة ولا أرصدة موردين مدينة.", "No customer credit or supplier debit balances.") });
  const negStock = await t.one(`SELECT COUNT(*)::int c FROM (SELECT product_id FROM stock_balances WHERE company_id=$1 GROUP BY product_id HAVING SUM(qty) < -0.0001) x`, [C]);
  add({ key: "stock", label: T("كميات المخزون", "Stock quantities"), status: negStock.c ? "warn" : "good", to: "/inventory",
    text: negStock.c ? T(`${negStock.c} صنف برصيد كمية سالب — بيع قبل تسجيل شرائه، فتكلفته غير صحيحة حتى يُصحَّح بالجرد أو بفاتورة الشراء.`, `${negStock.c} items have a negative quantity — sold before their purchase was recorded, so their cost is wrong until corrected.`) : T("لا يوجد صنف برصيد سالب.", "No item has a negative quantity.") });
  if (!branchId) {
    const ib = await t.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED' WHERE a.company_id=$1 AND a.system_key='INTER_BRANCH' AND e.date <= $2`, [C, to]);
    if (Math.abs(N(ib.b)) >= 0.01) add({ key: "interbranch", label: T("جاري الفروع", "Inter-branch account"), status: "warn", to: "/reports/trial-balance", text: T(`رصيد جاري الفروع على مستوى المنشأة ${m(ib.b)} ويجب أن يكون صفراً — تحويل بين فرعين لم يُستكمل طرفه الآخر.`, `The inter-branch account is ${m(ib.b)} for the company and should be zero — a transfer between branches is missing its other side.`) });
  }
  const bank = await t.one(`SELECT COUNT(*)::int c, COALESCE(SUM(ABS(amount)),0) v FROM bank_statement_lines WHERE company_id=$1 AND status='OPEN' AND date < $2::date - 30`, [C, to]);
  if (bank.c) add({ key: "bank", label: T("التسوية البنكية", "Bank reconciliation"), status: "warn", to: "/bank", text: T(`${bank.c} سطر في كشف البنك أقدم من 30 يوماً لم يُطابَق (${m(bank.v)}) — حركات في البنك لم تُسجَّل في الدفاتر أو العكس.`, `${bank.c} bank statement lines older than 30 days are unmatched (${m(bank.v)}).`) });
  const openPeriods = await t.one(`SELECT COUNT(*)::int c, MIN(start_date)::text first FROM periods WHERE company_id=$1 AND status='OPEN' AND end_date < date_trunc('month', $2::date)::date - 31`, [C, tdy]);
  add({ key: "periods", label: T("قفل الفترات المحاسبية", "Closed accounting periods"), status: openPeriods.c ? "info" : "good", to: "/closing",
    text: openPeriods.c ? T(`أشهر مضى عليها أكثر من شهر وما زالت مفتوحة للقيد: ${openPeriods.c} (أولها ${String(openPeriods.first).slice(0, 7)}). قفل الشهر بعد مراجعته يمنع تغيير أرقام قُدِّمت أو أُقرّت.`, `${openPeriods.c} months more than a month old are still open for posting (from ${String(openPeriods.first).slice(0, 7)}). Locking a reviewed month stops figures already reported from changing.`)
      : T("الأشهر السابقة مقفلة بعد مراجعتها.", "Past months are locked after review.") });
  const lastMonthEnd = addDays(tdy.slice(0, 8) + "01", -1);
  const dep = await t.one(`SELECT COUNT(*)::int c FROM fixed_assets WHERE company_id=$1 AND status='ACTIVE' AND acquisition_date <= $2 AND (last_depreciation IS NULL OR last_depreciation < $2) AND COALESCE(accumulated,0) < cost - COALESCE(salvage_value,0) - 0.01`, [C, lastMonthEnd]).catch(() => ({ c: 0 }));
  if (dep.c) add({ key: "depreciation", label: T("إهلاك الأصول الثابتة", "Depreciation"), status: "warn", to: "/assets", text: T(`${dep.c} أصل لم يُحسب إهلاكه حتى ${lastMonthEnd} — الأرباح أعلى من حقيقتها بمقدار الإهلاك غير المسجّل.`, `${dep.c} assets are not depreciated up to ${lastMonthEnd} — profit is overstated by the missing depreciation.`) });
  const amort = await t.one(`SELECT COUNT(*)::int c FROM amortizations a WHERE a.company_id=$1 AND a.status='ACTIVE' AND a.posted_months < a.months
      AND (date_trunc('month', a.start_date) + (a.posted_months + 1) * interval '1 month' - interval '1 day')::date <= $2`, [C, lastMonthEnd]);
  if (amort.c) add({ key: "amortization", label: T("الإطفاء الشهري", "Monthly amortisation"), status: "warn", to: "/amortizations", text: T(`${amort.c} جدول إطفاء فيه أشهر منتهية لم تُرحَّل — المصروف المدفوع مقدماً أو الإيراد المؤجل لم يُحمَّل على أشهره.`, `${amort.c} amortisation schedules have ended months not posted yet.`) });
  const allowance = await t.one(`SELECT COALESCE(SUM(l.credit-l.debit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED' WHERE a.company_id=$1 AND a.system_key='DOUBTFUL_ALLOWANCE' AND e.date <= $2`, [C, to]);
  if (rv.d90p > 0) add({ key: "ecl", label: T("مخصص الديون المشكوك فيها", "Allowance for doubtful debts"), status: N(allowance.b) > 0 ? "good" : "warn", to: "/ecl",
    text: N(allowance.b) > 0 ? T(`المخصص في الدفاتر ${m(allowance.b)} مقابل ديون متأخرة أكثر من 90 يوماً ${m(rv.d90p)}.`, `The allowance is ${m(allowance.b)} against debts more than 90 days overdue of ${m(rv.d90p)}.`)
      : T(`ديون متأخرة أكثر من 90 يوماً ${m(rv.d90p)} بلا مخصص — قدّر الخسائر الائتمانية المتوقعة (معيار IFRS 9) حتى لا تُعرض الذمم بأكثر من قيمتها القابلة للتحصيل.`, `${m(rv.d90p)} is more than 90 days overdue with no allowance — measure expected credit losses (IFRS 9) so receivables are not shown above their recoverable amount.`) });
  add({ key: "vat", label: T("حسابات الضريبة مقابل إقرار الفترة", "VAT accounts against the period return"), status: vat.reconciled ? "good" : "bad", to: "/reports/vat",
    text: vat.reconciled ? T(`إقرار الفترة يطابق حسابات الضريبة: مخرجات ${m(vat.outputVat)}، مدخلات ${m(vat.inputVat)}، الصافي ${m(vat.net)}.`, `The period return agrees with the VAT accounts: output ${m(vat.outputVat)}, input ${m(vat.inputVat)}, net ${m(vat.net)}.`)
      : T(`الإقرار لا يطابق الحسابات: المخرجات ${m(vat.outputVat)} مقابل ${m(vat.glOutputVat)} في الحساب، والمدخلات ${m(vat.inputVat)} مقابل ${m(vat.glInputVat)} — قيد يدوي على حساب الضريبة غالباً.`, `The return does not agree with the accounts: output ${m(vat.outputVat)} vs ${m(vat.glOutputVat)}, input ${m(vat.inputVat)} vs ${m(vat.glInputVat)} — usually a manual entry on a VAT account.`) });
  const noDocs = ex.anomalies?.missingDocs || { purchases: 0, expenses: 0 };
  if (noDocs.purchases + noDocs.expenses) add({ key: "docs", label: T("المستندات المؤيدة", "Supporting documents"), status: "info", to: "/archive?tab=missing", text: T(`${noDocs.purchases} فاتورة مشتريات و${noDocs.expenses} مصروف في الفترة بلا مستند مرفق. الأنظمة الضريبية تشترط حفظ الفاتورة الضريبية الأصلية لخصم ضريبة المدخلات وتأييد المصروف.`, `${noDocs.purchases} purchase invoices and ${noDocs.expenses} expenses in the period have no attached document. Tax rules require keeping the original tax invoice to deduct input VAT and support the expense.`) });

  // ── regulatory obligations ─────────────────────────────────────────────────
  const comp: Check[] = [];
  const v = alerts.vat;
  const vatDue = Math.round((Date.parse(v.dueDate) - Date.parse(tdy)) / 86400000);
  comp.push({ key: "vatReturn", label: T(`إقرار ضريبة القيمة المضافة (${CFG.vatRate}%)`, `VAT return (${CFG.vatRate}%)`), ref: IS_EG ? T("قانون الضريبة على القيمة المضافة رقم 67 لسنة 2016", "VAT Law No. 67 of 2016") : T("نظام ضريبة القيمة المضافة ولائحته التنفيذية", "VAT Law and its Implementing Regulations"), to: "/reports/vat",
    status: v.filed || !v.active ? "good" : vatDue < 0 ? "bad" : vatDue <= 15 ? "warn" : "info",
    text: !v.filed && !v.active ? T(`لا حركات في فترة الإقرار الأخيرة المنتهية (${v.periodFrom} – ${v.periodTo}) — لا إقرار مستحق عنها.`, `No activity in the last ended return period (${v.periodFrom} – ${v.periodTo}) — no return due for it.`) : v.filed ? T(`إقرار الفترة ${v.periodFrom} – ${v.periodTo} مسجَّل في البرنامج.`, `The return for ${v.periodFrom} – ${v.periodTo} is recorded.`)
      : vatDue < 0 ? T(`إقرار الفترة ${v.periodFrom} – ${v.periodTo} متأخر ${-vatDue} يوماً (كان آخر موعد ${v.dueDate}) — التأخير يعرّض المنشأة لغرامة.`, `The return for ${v.periodFrom} – ${v.periodTo} is ${-vatDue} days late (due ${v.dueDate}) — late filing carries a penalty.`)
        : T(`إقرار الفترة ${v.periodFrom} – ${v.periodTo} يُقدَّم ويُسدَّد حتى ${v.dueDate} (بعد ${vatDue} يوماً).`, `The return for ${v.periodFrom} – ${v.periodTo} is due with payment by ${v.dueDate} (in ${vatDue} days).`) });
  const vatPay = await t.one(`SELECT COALESCE(SUM(l.credit-l.debit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED' WHERE a.company_id=$1 AND a.system_key IN ('VAT_OUT','VAT_IN','VAT_PAYABLE') AND e.date <= $2`, [C, to]);
  comp.push({ key: "vatBalance", label: T("صافي الضريبة في الدفاتر", "Net VAT in the books"), status: "info", to: "/reports/vat",
    text: N(vatPay.b) >= 0 ? T(`صافي الضريبة المستحقة للجهة الضريبية في ${to}: ${m(vatPay.b)} (ضريبة الفترة وحدها ${m(vat.net)}).`, `Net VAT owed to the tax authority at ${to}: ${m(vatPay.b)} (this period alone ${m(vat.net)}).`)
      : T(`رصيد ضريبة مدين (قابل للاسترداد أو الترحيل) ${m(-N(vatPay.b))} في ${to}.`, `VAT receivable (refundable or carried forward) ${m(-N(vatPay.b))} at ${to}.`) });
  if (IS_EG) {
    const eta = await t.one(`SELECT COUNT(*)::int c FROM invoices WHERE company_id=$1 AND status='POSTED' AND eta_status IN ('PENDING','NOT_CONFIGURED','NEEDS_SIGNATURE','INVALID','REJECTED')`, [C]);
    comp.push({ key: "einvoice", label: T("منظومة الفاتورة والإيصال الإلكتروني", "E-invoice and e-receipt system"), ref: T("مصلحة الضرائب المصرية", "Egyptian Tax Authority"), to: "/eta", status: eta.c ? "warn" : "good",
      text: eta.c ? T(`${eta.c} مستند لم يُقبل بعد في المنظومة — المستند غير المقبول لا يُعتدّ به ضريبياً لدى العميل.`, `${eta.c} documents are not yet accepted by the system — a document not accepted is not valid for tax at the customer.`) : T("كل المستندات المرحّلة مقبولة في المنظومة أو لا توجد مستندات معلقة.", "All posted documents are accepted or none is pending.") });
  } else {
    const z = await t.maybe(`SELECT (production_cert IS NOT NULL) prod FROM zatca_configs WHERE company_id=$1`, [C]);
    const zp = await t.one(`SELECT COUNT(*)::int c FROM invoices WHERE company_id=$1 AND status='POSTED' AND zatca_status IN ('PENDING','FAILED','REJECTED')`, [C]);
    comp.push({ key: "einvoice", label: T("الفوترة الإلكترونية (فاتورة)", "E-invoicing (FATOORA)"), ref: T("لائحة الفوترة الإلكترونية — هيئة الزكاة والضريبة والجمارك", "E-invoicing Regulation — ZATCA"), to: "/zatca",
      status: zp.c ? "warn" : z?.prod ? "good" : "info",
      text: zp.c ? T(`${zp.c} فاتورة لم تُرسل أو رُفضت في منصة فاتورة.`, `${zp.c} invoices were not sent or were rejected by FATOORA.`)
        : z?.prod ? T("الربط مع منصة فاتورة (المرحلة الثانية) مفعّل ولا توجد فواتير معلقة.", "FATOORA integration (phase 2) is active with nothing pending.")
          : T("المرحلة الأولى (رمز QR) مطبّقة على كل فاتورة. الربط مع المنصة (المرحلة الثانية) لم يُفعَّل بعد — يلزم عند شمول المنشأة بموجة الربط التي تحددها الهيئة.", "Phase 1 (QR code) is on every invoice. Phase 2 integration is not active yet — required once the establishment's integration wave is announced by ZATCA.") });
  }
  // the dated obligations already tracked for the to-do list: withholding, zakat / income tax, Form 41
  for (const it of alerts.items.filter((x: any) => /^\/(tax|zakat)/.test(x.to || "")))
    comp.push({ key: "due-" + comp.length, label: /زكاة|الزكاة/.test(it.text) ? T("الزكاة", "Zakat") : /الدخل/.test(it.text) ? T("ضريبة الدخل", "Income tax") : /41/.test(it.text) ? T("نموذج 41 (الخصم تحت حساب الضريبة)", "Form 41 (withholding)") : T("ضريبة الاستقطاع", "Withholding tax"),
      status: it.level === "err" ? "bad" : it.level === "warn" ? "warn" : "info", text: it.text, to: it.to });
  const bal = async (keys: string[]) => N((await t.one(`SELECT COALESCE(SUM(l.credit-l.debit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED' WHERE a.company_id=$1 AND a.system_key = ANY($2) AND e.date <= $3`, [C, keys, to])).b);
  const emps = await t.one(`SELECT COUNT(*)::int c FROM employees WHERE company_id=$1 AND is_active`, [C]);
  if (emps.c) {
    const gosi = await bal(["GOSI_PAYABLE"]);
    comp.push({ key: "insurance", label: IS_EG ? T("التأمينات الاجتماعية", "Social insurance") : T("التأمينات الاجتماعية (GOSI)", "Social insurance (GOSI)"), ref: IS_EG ? T("قانون التأمينات الاجتماعية والمعاشات رقم 148 لسنة 2019", "Social Insurance Law No. 148 of 2019") : T("نظام التأمينات الاجتماعية", "Social Insurance Law"), to: "/payroll",
      status: gosi > 0.5 ? "info" : "good", text: gosi > 0.5 ? T(`اشتراكات مستحقة غير مسددة في ${to}: ${m(gosi)} (عدد الموظفين ${emps.c}) — تُسدَّد شهرياً.`, `Contributions owed and unpaid at ${to}: ${m(gosi)} for ${emps.c} employees — paid monthly.`) : T(`لا اشتراكات مستحقة غير مسددة (عدد الموظفين ${emps.c}).`, `No unpaid contributions (${emps.c} employees).`) });
    if (IS_EG) {
      const tax = await bal(["SALARY_TAX_PAYABLE", "MARTYRS_PAYABLE"]);
      comp.push({ key: "payrollTax", label: T("ضريبة كسب العمل وصندوق الشهداء", "Payroll tax and Martyrs' Fund"), ref: T("قانون الضريبة على الدخل وقانون صندوق الشهداء", "Income Tax Law; Martyrs' Fund Law"), to: "/payroll", status: tax > 0.5 ? "info" : "good",
        text: tax > 0.5 ? T(`مبالغ مخصومة من الرواتب لم تورَّد بعد: ${m(tax)}.`, `Amounts withheld from salaries not remitted yet: ${m(tax)}.`) : T("لا مبالغ مخصومة غير مورّدة.", "Nothing withheld and unremitted.") });
    } else {
      const eosb = await bal(["EOSB_PROVISION"]);
      comp.push({ key: "eosb", label: T("مخصص مكافأة نهاية الخدمة", "End-of-service provision"), ref: T("نظام العمل — المادة 84", "Labour Law — Article 84"), to: "/payroll", status: eosb > 0 ? "good" : "warn",
        text: eosb > 0 ? T(`المخصص في الدفاتر ${m(eosb)} (عدد الموظفين ${emps.c}).`, `The provision is ${m(eosb)} for ${emps.c} employees.`) : T(`لا يوجد مخصص لمكافأة نهاية الخدمة وعدد الموظفين ${emps.c} — كوّن المخصص الشهري حتى تظهر الالتزامات كاملة.`, `No end-of-service provision although there are ${emps.c} employees — post the monthly provision so liabilities are complete.`) });
    }
  }
  if (!IS_EG) {
    const ps = await t.rows(`SELECT * FROM partners WHERE company_id=$1 AND is_active AND (is_supplier OR (is_customer AND kind='COMPANY'))`, [C]);
    const badC = ps.filter((p: any) => p.isCustomer && p.kind === "COMPANY" && !checkPartner(p).standardReady).length, badS = ps.filter((p: any) => p.isSupplier && !checkPartner(p).supplierReady).length;
    comp.push({ key: "partnerTax", label: T("بيانات العملاء والموردين الضريبية", "Customer and supplier tax data"), ref: T("متطلبات الفاتورة الضريبية", "Tax invoice requirements"), to: "/customers", status: badC + badS ? "warn" : "good",
      text: badC + badS ? T(`${badC} عميل منشأة و${badS} مورد بيانات الرقم الضريبي أو العنوان الوطني ناقصة — الفاتورة الضريبية القياسية لا تصدر لهم، ولا تُخصم ضريبة مدخلات بلا رقم المورد.`, `${badC} business customers and ${badS} suppliers miss a VAT number or national address — no standard tax invoice can be issued to them, and input VAT needs the supplier's number.`)
        : T("بيانات العملاء المنشآت والموردين مكتملة.", "Business customer and supplier data is complete.") });
  }

  // ── narrative ─────────────────────────────────────────────────────────────
  const gm = R("gm")?.value, om = R("om")?.value, nm = R("nm")?.value, cr = R("current")?.value, qr = R("quick")?.value, dr = R("dr")?.value, de = R("de")?.value;
  const dso = R("dso")?.value, dio = R("dio")?.value, dpo = R("dpo")?.value, ccc = R("ccc")?.value, cover = R("cover")?.value;
  const bad = (cs: Check[]) => cs.filter((c) => c.status === "bad").length, warn = (cs: Check[]) => cs.filter((c) => c.status === "warn").length;
  const health = fa.health;
  const redFlags: string[] = [];
  if (E.equity < 0) redFlags.push(T("حقوق الملكية سالبة", "negative equity"));
  if (ex.forecast.projected < 0) redFlags.push(T("سيولة متوقعة سالبة خلال 30 يوماً", "negative 30-day cash outlook"));
  if (S.net < 0 && fa.cash.operating < 0) redFlags.push(T("خسارة مع تدفق تشغيلي سالب", "a loss with negative operating cash flow"));
  if (bad(checks)) redFlags.push(T("فحوص دفاتر لم تنجح", "failed book checks"));
  const late = comp.filter((c) => c.status === "bad").length;
  if (late) redFlags.push(T("التزامات نظامية متأخرة", "late regulatory obligations"));
  const level: "good" | "ok" | "watch" | "critical" = redFlags.length >= 2 || E.equity < 0 ? "critical" : redFlags.length || (health !== null && health < 50) || S.net < 0 ? "watch" : health !== null && health >= 70 && S.net > 0 ? "good" : "ok";
  const LV = { good: T("وضع جيد", "Sound"), ok: T("وضع مستقر", "Stable"), watch: T("يحتاج انتباهاً", "Needs attention"), critical: T("وضع حرج", "Critical") }[level];
  const activity = S.netSales !== 0 || S.opex !== 0 || E.totalAssets !== 0;

  const sections: Section[] = [];
  const sum: string[] = [];
  if (!activity) sum.push(T("لا توجد قيود مرحّلة في الفترة ولا أرصدة؛ لا يمكن تقييم الوضع المالي قبل تسجيل الحركات.", "There are no posted entries or balances for the period; the position cannot be assessed until transactions are recorded."));
  else {
    sum.push(T(`التقييم العام: ${LV}${health !== null ? ` — مؤشر الصحة المالية ${health} من 100` : ""}${redFlags.length ? `، مع تنبيهات: ${redFlags.join("، ")}` : ""}.`, `Overall: ${LV}${health !== null ? ` — financial health score ${health} out of 100` : ""}${redFlags.length ? `, with warnings: ${redFlags.join(", ")}` : ""}.`));
    sum.push(T(`حققت المنشأة صافي مبيعات ${m(S.netSales)}${chg(fa.growth.sales)}، و${S.net >= 0 ? "صافي ربح" : "صافي خسارة"} ${m(Math.abs(S.net))}${nm !== null ? ` (هامش ${pc(nm)})` : ""}${prevSales || prevNet ? ` مقابل ${m(prevNet)} في فترة المقارنة` : ""}.`,
      `Net sales were ${m(S.netSales)}${chg(fa.growth.sales)}, with a net ${S.net >= 0 ? "profit" : "loss"} of ${m(Math.abs(S.net))}${nm !== null ? ` (margin ${pc(nm)})` : ""}${prevSales || prevNet ? ` against ${m(prevNet)} in the comparison period` : ""}.`));
    sum.push(T(`النقدية في نهاية الفترة ${m(fa.cash.closing)}${cr !== null ? `، ونسبة التداول ${num(cr)} مرة` : ""}${cover !== null ? `، والنقدية تغطي ${num(cover, 1)} شهر من المصروفات` : ""}. المتوقع بعد 30 يوماً ${m(ex.forecast.projected)} بعد التحصيل والسداد المستحقين.`,
      `Cash at period end was ${m(fa.cash.closing)}${cr !== null ? `, the current ratio ${num(cr)}x` : ""}${cover !== null ? `, covering ${num(cover, 1)} months of expenses` : ""}. Expected in 30 days: ${m(ex.forecast.projected)} after amounts due in and out.`));
    if (rv.total) sum.push(T(`ذمم العملاء ${m(rv.total)}، المتأخر منها ${m(rv.overdue)} (${pc(rv.total ? (rv.overdue / rv.total) * 100 : 0)})؛ ومستحقات الموردين ${m(pv.total)}.`, `Receivables ${m(rv.total)}, of which ${m(rv.overdue)} overdue (${pc(rv.total ? (rv.overdue / rv.total) * 100 : 0)}); payables ${m(pv.total)}.`));
    const cnt = (cs: Check[], st: Level) => cs.filter((c) => c.status === st).length;
    sum.push(T(`فحوص الدفاتر (${checks.length}): سليم ${cnt(checks, "good")}${cnt(checks, "info") ? `، ملاحظات ${cnt(checks, "info")}` : ""}${warn(checks) ? `، يحتاج تصحيحاً ${warn(checks)}` : ""}${bad(checks) ? `، أخطاء ${bad(checks)}` : ""}. الالتزامات النظامية: ${late ? `متأخر ${late}` : "لا متأخرات"}${warn(comp) ? `، يحتاج متابعة ${warn(comp)}` : ""}.`,
      `Book checks (${checks.length}): ${cnt(checks, "good")} clean${cnt(checks, "info") ? `, ${cnt(checks, "info")} notes` : ""}${warn(checks) ? `, ${warn(checks)} to correct` : ""}${bad(checks) ? `, ${bad(checks)} errors` : ""}. Regulatory: ${late ? `${late} late` : "nothing late"}${warn(comp) ? `, ${warn(comp)} to follow up` : ""}.`));
  }
  sections.push({ key: "summary", title: T("الملخص التنفيذي", "Executive summary"), status: level === "good" ? "good" : level === "ok" ? "ok" : level === "watch" ? "warn" : "bad", paragraphs: sum });

  if (activity) {
    const P: string[] = [];
    P.push(T(`صافي المبيعات ${m(S.netSales)} وتكلفة المبيعات ${m(S.cogs)}، فمجمل الربح ${m(S.grossProfit)}${gm !== null ? ` بهامش ${pc(gm)}` : ""}${chg(fa.growth.grossProfit)}.`, `Net sales ${m(S.netSales)} and cost of sales ${m(S.cogs)} give a gross profit of ${m(S.grossProfit)}${gm !== null ? ` (${pc(gm)} margin)` : ""}${chg(fa.growth.grossProfit)}.`));
    P.push(T(`المصروفات التشغيلية ${m(S.opex)}${chg(fa.growth.opex, false)}، فالربح التشغيلي ${m(S.operating)}${om !== null ? ` (${pc(om)} من المبيعات)` : ""}، وصافي الربح بعد البنود الأخرى والزكاة/الضريبة ${m(S.net)}.`, `Operating expenses ${m(S.opex)}${chg(fa.growth.opex, false)}, so operating profit is ${m(S.operating)}${om !== null ? ` (${pc(om)} of sales)` : ""}, and net profit after other items and zakat/tax ${m(S.net)}.`));
    const top = fa.opexBreakdown.slice(0, 3);
    if (top.length) P.push(T(`أكبر المصروفات: ${top.map((x: any) => `${x.name} ${m(x.amount)} (${pc(x.share)})`).join("، ")}.`, `Largest expenses: ${top.map((x: any) => `${x.name} ${m(x.amount)} (${pc(x.share)})`).join(", ")}.`));
    const be = fa.breakEven;
    if (be.breakEvenSales !== null) P.push(be.achieved ? T(`المبيعات فوق نقطة التعادل (${m(be.breakEvenSales)}) بهامش أمان ${pc(be.marginOfSafety)}.`, `Sales are above break-even (${m(be.breakEvenSales)}) with a ${pc(be.marginOfSafety)} margin of safety.`) : T(`المبيعات أقل من نقطة التعادل (${m(be.breakEvenSales)}) — يلزم رفع المبيعات أو الهامش أو خفض المصروفات الثابتة.`, `Sales are below break-even (${m(be.breakEvenSales)}) — raise sales or margin, or cut fixed costs.`));
    if (fa.concentration.top1 >= 30 && fa.concentration.customers > 1) P.push(T(`أكبر عميل يمثل ${pc(fa.concentration.top1)} من المبيعات وأكبر خمسة ${pc(fa.concentration.top5)} — اعتماد مرتفع على عدد قليل من العملاء.`, `The largest customer is ${pc(fa.concentration.top1)} of sales and the top five ${pc(fa.concentration.top5)} — high dependence on few customers.`));
    sections.push({ key: "profit", title: T("الأداء والربحية", "Performance and profitability"), status: S.net < 0 ? "bad" : (nm ?? 0) >= 5 ? "good" : "ok", paragraphs: P,
      table: { head: [T("البند", "Item"), T("الفترة", "Period"), T("المقارنة", "Comparison"), T("التغير", "Change")], rows: fa.commonSize.map((x: any) => [x.name, num(x.current), num(x.previous), x.change === null ? "—" : pc(x.change)]) } });

    const L: string[] = [];
    L.push(T(`النقدية بدأت الفترة بـ ${m(fa.cash.opening)} وانتهت بـ ${m(fa.cash.closing)}: تدفق تشغيلي ${m(fa.cash.operating)}، واستثماري ${m(fa.cash.investing)}، وتمويلي ${m(fa.cash.financing)}.`, `Cash opened at ${m(fa.cash.opening)} and closed at ${m(fa.cash.closing)}: operating ${m(fa.cash.operating)}, investing ${m(fa.cash.investing)}, financing ${m(fa.cash.financing)}.`));
    if (cr !== null) L.push(T(`نسبة التداول ${num(cr)} مرة${qr !== null ? ` والسريعة ${num(qr)} مرة` : ""} — ${cr >= 1.5 ? "الأصول المتداولة تغطي الالتزامات القصيرة بارتياح" : cr >= 1 ? "تغطية مقبولة لكنها ضيقة" : "الالتزامات القصيرة أكبر من الأصول المتداولة، وهذا خطر سيولة"}.`, `Current ratio ${num(cr)}x${qr !== null ? `, quick ratio ${num(qr)}x` : ""} — ${cr >= 1.5 ? "short-term obligations are comfortably covered" : cr >= 1 ? "acceptable but tight cover" : "short-term obligations exceed current assets — a liquidity risk"}.`));
    L.push(T(`خلال 30 يوماً: تحصيل متوقع ${m(ex.forecast.inflow30)} وسداد مستحق ${m(ex.forecast.outflow30)}، فالنقدية المتوقعة ${m(ex.forecast.projected)}${ex.forecast.projected < 0 ? " — عجز متوقع يحتاج تمويلاً أو تأجيل مدفوعات أو تسريع التحصيل" : ""}.`, `Over 30 days: ${m(ex.forecast.inflow30)} expected in and ${m(ex.forecast.outflow30)} due out, so expected cash is ${m(ex.forecast.projected)}${ex.forecast.projected < 0 ? " — a shortfall needing finance, deferred payments or faster collection" : ""}.`));
    if (fa.cash.runwayMonths !== null) L.push(T(`التدفق التشغيلي سالب؛ النقدية الحالية تكفي ${num(fa.cash.runwayMonths, 1)} شهر بالمعدل الحالي.`, `Operating cash flow is negative; current cash lasts ${num(fa.cash.runwayMonths, 1)} months at this rate.`));
    sections.push({ key: "liquidity", title: T("السيولة والتدفق النقدي", "Liquidity and cash flow"), status: ex.forecast.projected < 0 || (cr !== null && cr < 1) ? "bad" : cr !== null && cr >= 1.5 ? "good" : "ok", paragraphs: L });

    const B2: string[] = [];
    B2.push(T(`في ${to}: الأصول ${m(E.totalAssets)} (متداولة ${m(E.currentAssets)}، ثابتة بصافي قيمتها ${m(E.fixedAssets)})، والخصوم ${m(E.totalLiab)}، وحقوق الملكية ${m(E.equity)}.`, `At ${to}: assets ${m(E.totalAssets)} (current ${m(E.currentAssets)}, fixed at net book value ${m(E.fixedAssets)}), liabilities ${m(E.totalLiab)}, equity ${m(E.equity)}.`));
    if (dr !== null) B2.push(T(`نسبة المديونية ${pc(dr)} والديون إلى حقوق الملكية ${de === null ? "—" : num(de)} مرة — ${dr < 60 ? "الاعتماد على التمويل الخارجي في حدود آمنة" : "مديونية مرتفعة ترفع مخاطر السداد"}.`, `Debt ratio ${pc(dr)} and debt-to-equity ${de === null ? "—" : num(de)}x — ${dr < 60 ? "reliance on outside finance is within safe limits" : "high leverage raises repayment risk"}.`));
    B2.push(T(`رأس المال العامل ${m(E.currentAssets - E.currentLiab)} (كان ${m(O.currentAssets - O.currentLiab)} في بداية الفترة).`, `Working capital ${m(E.currentAssets - E.currentLiab)} (was ${m(O.currentAssets - O.currentLiab)} at the start of the period).`));
    if (E.equity < 0) B2.push(T(`حقوق الملكية سالبة: الخسائر المتراكمة تجاوزت رأس المال. ${IS_EG ? "قانون الشركات المصري" : "نظام الشركات السعودي"} يوجب عرض الأمر على الشركاء أو الجمعية العامة لتقرير استمرار الشركة إذا بلغت الخسائر نصف رأس المال؛ راجع المستشار النظامي.`, `Equity is negative: accumulated losses exceed capital. ${IS_EG ? "Egyptian company law" : "The Saudi Companies Law"} requires the partners or the general assembly to decide on the company's continuation once losses reach half the capital; consult your legal adviser.`));
    sections.push({ key: "position", title: T("المركز المالي والملاءة", "Financial position and solvency"), status: E.equity < 0 ? "bad" : dr !== null && dr >= 60 ? "warn" : "good", paragraphs: B2 });

    const W: string[] = [];
    W.push(T(`متوسط فترة التحصيل ${dd(dso)}، وبقاء المخزون ${dd(dio)}، والسداد للموردين ${dd(dpo)}، فدورة التحويل النقدي ${dd(ccc)}.`, `Average collection period ${dd(dso)}, stock days ${dd(dio)}, supplier payment days ${dd(dpo)}, so the cash conversion cycle is ${dd(ccc)}.`));
    if (dso !== null && dso > 60) W.push(T("التحصيل بطيء: راجع شروط الائتمان وتابع المتأخرات أسبوعياً.", "Collection is slow: review credit terms and chase overdue accounts weekly."));
    if (rv.total) W.push(T(`أعمار ذمم العملاء: جارية ${m(rv.current)}، 1–30 يوماً ${m(rv.d30)}، 31–60 ${m(rv.d60)}، 61–90 ${m(rv.d90)}، أكثر من 90 ${m(rv.d90p)}.${rv.top[0] ? ` أكبر رصيد: ${rv.top[0].name} ${m(rv.top[0].open)}${rv.top[0].overdue ? ` منه ${m(rv.top[0].overdue)} متأخر` : ""}.` : ""}`,
      `Receivables by age: current ${m(rv.current)}, 1–30 days ${m(rv.d30)}, 31–60 ${m(rv.d60)}, 61–90 ${m(rv.d90)}, over 90 ${m(rv.d90p)}.${rv.top[0] ? ` Largest balance: ${rv.top[0].name} ${m(rv.top[0].open)}${rv.top[0].overdue ? `, ${m(rv.top[0].overdue)} overdue` : ""}.` : ""}`));
    if (pv.total) W.push(T(`مستحقات الموردين ${m(pv.total)}، منها ${m(pv.overdue)} تجاوزت موعدها${pv.overdue > 0 ? " — التأخير يضر بالعلاقة مع الموردين وشروط الشراء" : ""}.`, `Payables ${m(pv.total)}, of which ${m(pv.overdue)} past due${pv.overdue > 0 ? " — late payment hurts supplier terms" : ""}.`));
    if (inv.value) W.push(T(`المخزون ${m(inv.value)} (عدد الأصناف ${inv.skus})؛ الراكد بلا بيع منذ 90 يوماً ${m(inv.deadValue)} (${pc(inv.value ? (inv.deadValue / inv.value) * 100 : 0)})${inv.counts.outOfStock ? `، وأصناف مطلوبة نفدت: ${inv.counts.outOfStock}` : ""}${inv.counts.expiring ? `، ودفعات قاربت انتهاء صلاحيتها: ${inv.counts.expiring}` : ""}.`,
      `Stock ${m(inv.value)} in ${inv.skus} items; slow-moving with no sale for 90 days ${m(inv.deadValue)} (${pc(inv.value ? (inv.deadValue / inv.value) * 100 : 0)})${inv.counts.outOfStock ? `; ${inv.counts.outOfStock} items in demand are out of stock` : ""}${inv.counts.expiring ? `; ${inv.counts.expiring} lots near expiry` : ""}.`));
    sections.push({ key: "working", title: T("رأس المال العامل: الذمم والمخزون", "Working capital: receivables, payables and stock"), status: (dso ?? 0) > 90 || rv.d90p > rv.total * 0.2 ? "warn" : "ok", paragraphs: W });
  }
  sections.push({ key: "books", title: T("حالة الحسابات وسلامة الدفاتر", "State of the accounts"), status: bad(checks) ? "bad" : warn(checks) ? "warn" : "good",
    paragraphs: [T(`فحوص على الدفاتر حتى ${to}: سليم ${checks.filter((c) => c.status === "good").length}، ملاحظات ${checks.filter((c) => c.status === "info").length}، يحتاج تصحيحاً ${warn(checks)}، أخطاء تؤثر على القوائم ${bad(checks)}.`, `Checks on the books up to ${to}: ${checks.filter((c) => c.status === "good").length} clean, ${checks.filter((c) => c.status === "info").length} notes, ${warn(checks)} to correct, ${bad(checks)} errors affecting the statements.`)] });
  sections.push({ key: "compliance", title: IS_EG ? T("الالتزامات النظامية (مصر)", "Regulatory obligations (Egypt)") : T("الالتزامات النظامية (السعودية)", "Regulatory obligations (Saudi Arabia)"), status: late ? "bad" : warn(comp) ? "warn" : "good",
    paragraphs: [T(`كما في ${tdy}. التواريخ محسوبة من دورية الإقرار المضبوطة (${co.vatPeriod === "MONTHLY" ? "شهري" : "ربع سنوي"}) ومن حركات الدفاتر؛ المرجع النهائي هو بوابة الجهة المختصة.`, `As of ${tdy}. Dates come from the configured filing frequency (${co.vatPeriod === "MONTHLY" ? "monthly" : "quarterly"}) and the books; the authority's portal is the final reference.`)] });

  // ── recommendations: the problems found, most serious first ───────────────
  const recs: { priority: 1 | 2 | 3; text: string; to?: string }[] = [];
  for (const c of [...comp, ...checks].filter((c) => c.status === "bad")) recs.push({ priority: 1, text: `${c.label}: ${c.text}`, to: c.to });
  if (ex.forecast.projected < 0) recs.push({ priority: 1, text: T("السيولة المتوقعة سالبة: رتّب تمويلاً قصير الأجل أو أجّل مدفوعات غير عاجلة وسرّع تحصيل المتأخرات.", "Expected cash is negative: arrange short-term finance, defer non-urgent payments and speed up overdue collections."), to: "/collections" });
  if (S.net < 0 && activity) recs.push({ priority: 1, text: T("الفترة خاسرة: راجع الأصناف ذات الهامش الضعيف وأكبر بنود المصروفات.", "The period made a loss: review low-margin items and the largest expenses."), to: "/insights?tab=sales" });
  for (const c of [...comp, ...checks].filter((c) => c.status === "warn")) recs.push({ priority: 2, text: `${c.label}: ${c.text}`, to: c.to });
  if (rv.d90p > 0) recs.push({ priority: 2, text: T(`تابع تحصيل الديون المتأخرة أكثر من 90 يوماً (${m(rv.d90p)})${rv.top[0] ? `، بدءاً بـ ${rv.top[0].name}` : ""}.`, `Chase debts more than 90 days overdue (${m(rv.d90p)})${rv.top[0] ? `, starting with ${rv.top[0].name}` : ""}.`), to: "/collections" });
  if (inv.deadValue > 0 && inv.value && inv.deadValue / inv.value > 0.15) recs.push({ priority: 3, text: T(`تصرّف في المخزون الراكد (${m(inv.deadValue)}) بعروض أو إرجاع للمورد لتحرير النقدية.`, `Move slow-moving stock (${m(inv.deadValue)}) with offers or returns to free cash.`), to: "/insights?tab=stock" });
  // information lines that are only statements of balance are not recommendations
  for (const c of [...comp, ...checks].filter((c) => c.status === "info" && !["vatBalance", "einvoice"].includes(c.key))) recs.push({ priority: 3, text: `${c.label}: ${c.text}`, to: c.to });

  const kf = [
    { key: "sales", label: T("صافي المبيعات", "Net sales"), value: S.netSales, prev: fa.growth.prev.netSales, change: fa.growth.sales },
    { key: "gp", label: T("مجمل الربح", "Gross profit"), value: S.grossProfit, prev: fa.growth.prev.grossProfit, change: fa.growth.grossProfit },
    { key: "opex", label: T("المصروفات التشغيلية", "Operating expenses"), value: S.opex, prev: fa.growth.prev.opex, change: fa.growth.opex, upBad: true },
    { key: "net", label: T("صافي الربح", "Net profit"), value: S.net, prev: fa.growth.prev.net, change: fa.growth.net },
    { key: "cash", label: T("النقدية آخر الفترة", "Cash at period end"), value: fa.cash.closing, prev: fa.cash.opening, change: null },
    { key: "ar", label: T("ذمم العملاء", "Receivables"), value: rv.total, prev: null, change: null },
    { key: "ap", label: T("مستحقات الموردين", "Payables"), value: pv.total, prev: null, change: null },
    { key: "equity", label: T("حقوق الملكية", "Equity"), value: E.equity, prev: O.equity, change: null },
  ];
  return {
    lang: en ? "en" : "ar", company: { name: en && co.nameEn ? co.nameEn : co.nameAr, vatNumber: co.vatNumber, country: CFG.code, currency: cur },
    period: { from, to, days: fa.days, prevFrom: fa.prevFrom, prevTo: fa.prevTo, compare: "prev", branchId: F.branchId }, generatedAt: new Date().toISOString(),
    verdict: { level, label: LV, health, redFlags }, keyFigures: kf, sections, checks, compliance: comp, recommendations: recs,
  };
}

/** Period bounds for the periodic reports: the month, quarter or year that contains `date`. */
export function periodOf(kind: string, date: string) {
  const y = Number(date.slice(0, 4)), mo = Number(date.slice(5, 7));
  if (kind === "YEAR") return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (kind === "QUARTER") { const s = Math.floor((mo - 1) / 3) * 3 + 1; const f = `${y}-${String(s).padStart(2, "0")}-01`; return { from: f, to: monthEnd(addMonths(f, 2)) }; }
  const f = `${y}-${String(mo).padStart(2, "0")}-01`;
  return { from: f, to: monthEnd(f) };
}
