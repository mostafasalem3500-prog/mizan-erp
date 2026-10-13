/**
 * Report center: detailed, multi-filter reports for every module.
 * Every report returns the same generic shape so one UI component renders all of them:
 *   { columns: [{ key, label, type, sum }], rows: [...], totals: {...}, meta }
 * Rows may carry `_link` (in-app path) for drill-down.
 */
import { Db } from "../db/pool";
import { bad, r2, D, isDate, today, addDays, addMonths, monthEnd } from "../lib/core";
import { SUBTYPE_AR } from "../accounting/coa";
import { incomeStatement, balanceSheet, aging } from "./reports";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type Col = { key: string; label: string; type?: "money" | "qty" | "int" | "pct" | "date" | "datetime" | "text" | "month"; sum?: boolean; avg?: boolean };
export type Result = { columns: Col[]; rows: any[]; totals?: Record<string, number>; meta?: any };

const JTYPE_AR: Record<string, string> = { MANUAL: "قيد يدوي", OPENING: "افتتاحي", CLOSING: "إقفال", SALES: "مبيعات", SALES_RETURN: "مرتجع مبيعات", PURCHASE: "مشتريات", PURCHASE_RETURN: "مرتجع مشتريات", RECEIPT: "سند قبض", PAYMENT: "سند صرف", EXPENSE: "مصروف", POS: "نقاط بيع", POS_CLOSE: "إغلاق وردية", STOCK: "مخزون", DEPRECIATION: "إهلاك", ASSET: "أصول", VAT_SETTLEMENT: "تسوية ضريبة", REVERSAL: "قيد عكسي", CHEQUE: "شيكات", PAYROLL: "رواتب", HR_PROVISION: "مخصصات", LOAN: "سلفة", SETTLEMENT: "تصفية", LANDED_COST: "تكاليف استيراد", ESTORE_PAYOUT: "تحويل منصة" };
const KIND_AR: Record<string, string> = { QUOTATION: "عرض سعر", ORDER: "أمر", INVOICE: "فاتورة", CREDIT_NOTE: "إشعار دائن", DEBIT_NOTE: "إشعار مدين" };
const STATUS_AR: Record<string, string> = { DRAFT: "مسودة", POSTED: "مرحّل", CANCELLED: "ملغى", CONVERTED: "محوّل", UNPAID: "غير مسدد", PARTIAL: "جزئي", PAID: "مسدد", OPEN: "مفتوحة", CLOSED: "مغلقة" };
const CHANNEL_AR: Record<string, string> = { BACKOFFICE: "المكتب", POS: "نقطة البيع", SALLA: "سلة", ZID: "زد", API: "API" };
const METHOD_AR: Record<string, string> = { CASH: "نقدي", CARD: "شبكة", BANK: "تحويل", CHEQUE: "شيك", CREDIT: "آجل" };
const MOVE_AR: Record<string, string> = { SALE: "بيع", SALE_RETURN: "مرتجع بيع", PURCHASE: "شراء", PURCHASE_RETURN: "مرتجع شراء", ADJUSTMENT: "تسوية جرد", OPENING: "رصيد افتتاحي", TRANSFER: "تحويل", POS: "نقطة بيع", LANDED_COST: "تكاليف استيراد" };
const TYPE_AR: Record<string, string> = { ASSET: "أصول", LIABILITY: "خصوم", EQUITY: "حقوق ملكية", REVENUE: "إيرادات", EXPENSE: "مصروفات" };
const sum = (rows: any[], k: string) => r2(rows.reduce((a, r) => a + Number(r[k] || 0), 0));
const totalsOf = (cols: Col[], rows: any[]) => Object.fromEntries(cols.filter((c) => c.sum).map((c) => [c.key, sum(rows, c.key)]));
const pct = (a: number, b: number) => (b ? r2((a / b) * 100) : 0);
const list = (v: any) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);

/** Parameterised WHERE builder. */
class W {
  params: any[] = [];
  conds: string[] = [];
  constructor(companyCond: string, companyId: string) { this.params.push(companyId); this.conds.push(companyCond.replace("?", "$1")); }
  add(sql: string, v: any) { this.params.push(v); this.conds.push(sql.replace(/\?/g, `$${this.params.length}`)); return this; }
  uuid(col: string, v: any) { if (v && UUID.test(String(v))) this.add(`${col}=?::uuid`, String(v)); return this; }
  uuids(col: string, v: any) { const ids = list(v).filter((x) => UUID.test(x)); if (ids.length) this.add(`${col} = ANY(?::uuid[])`, ids); return this; }
  in(col: string, v: any) { const xs = list(v); if (xs.length) this.add(`${col} = ANY(?::text[])`, xs); return this; }
  range(col: string, from?: string, to?: string) { if (from && isDate(from)) this.add(`${col} >= ?`, from); if (to && isDate(to)) this.add(`${col} <= ?`, to); return this; }
  like(cols: string[], v: any) { if (v) { this.params.push(`%${String(v)}%`); this.conds.push(`(${cols.map((c) => `${c} ILIKE $${this.params.length}`).join(" OR ")})`); } return this; }
  raw(sql: string) { this.conds.push(sql); return this; }
  get sql() { return this.conds.join(" AND "); }
}
const period = (q: any) => ({ from: q.from && isDate(q.from) ? q.from : "1900-01-01", to: q.to && isDate(q.to) ? q.to : today() });
const monthsBetween = (from: string, to: string) => { const out: string[] = []; let m = from.slice(0, 7) + "-01"; while (m <= to) { out.push(m.slice(0, 7)); m = addMonths(m, 1); } return out.slice(0, 36); };

// ───────────────────────── catalog ─────────────────────────
export type Def = { key: string; module: string; title: string; desc: string; filters: string[]; groupBy?: { key: string; label: string }[]; fixed?: Record<string, any>; base?: string; perm?: string; chart?: string; companyOnly?: boolean };
const DOC_FILTERS = ["period", "partner", "product", "category", "branch", "warehouse", "channel", "status", "paymentStatus", "user", "zatca", "q"];
const SALES_GROUPS = [["product", "الصنف"], ["category", "التصنيف"], ["partner", "العميل"], ["branch", "الفرع"], ["warehouse", "المستودع"], ["channel", "القناة"], ["user", "المستخدم/الكاشير"], ["month", "الشهر"], ["week", "الأسبوع"], ["day", "اليوم"], ["taxCode", "الرمز الضريبي"], ["invoiceType", "نوع الفاتورة"], ["city", "مدينة العميل"]].map(([key, label]) => ({ key, label }));
const PURCH_GROUPS = SALES_GROUPS.filter((g) => !["channel", "invoiceType", "city"].includes(g.key)).map((g) => (g.key === "partner" ? { key: "partner", label: "المورد" } : g));
export const CATALOG: Def[] = [
  // ── financial
  { key: "fin.income-monthly", module: "financial", title: "قائمة الدخل الشهرية", desc: "المبيعات والتكلفة والمصروفات وصافي الربح لكل شهر في الفترة", filters: ["period", "branch"], chart: "net", companyOnly: false },
  { key: "fin.balance-compare", module: "financial", title: "الميزانية المقارنة", desc: "المركز المالي بتاريخين مع التغير ونسبته", filters: ["to", "compareTo", "branch"] },
  { key: "fin.equity-changes", module: "financial", title: "التغيرات في حقوق الملكية", desc: "رصيد أول المدة، الإضافات والمسحوبات، صافي الربح، رصيد آخر المدة", filters: ["period", "branch"], companyOnly: true },
  { key: "fin.ratios", module: "financial", title: "النسب المالية", desc: "السيولة والربحية والمديونية ودورة رأس المال العامل", filters: ["period", "branch"] },
  { key: "fin.account-activity", module: "financial", title: "حركة الحسابات", desc: "رصيد أول المدة والحركة ورصيد آخر المدة لكل حساب مع الفلترة بالنوع والتصنيف ومركز التكلفة", filters: ["period", "branch", "accountType", "subtype", "costCenter", "partner", "nonzero", "q"], groupBy: [{ key: "account", label: "الحساب" }, { key: "subtype", label: "التصنيف" }, { key: "type", label: "النوع" }] },
  { key: "fin.ledger", module: "financial", title: "دفتر الأستاذ العام (تفصيلي)", desc: "كل سطور القيود بفلاتر الحساب والطرف ومركز التكلفة ونوع القيد", filters: ["period", "branch", "account", "accountType", "partner", "costCenter", "entryType", "q"], groupBy: [{ key: "none", label: "تفصيلي" }, { key: "account", label: "حسب الحساب" }, { key: "partner", label: "حسب الطرف" }, { key: "costCenter", label: "حسب مركز التكلفة" }, { key: "entryType", label: "حسب نوع القيد" }, { key: "month", label: "حسب الشهر" }] },
  { key: "fin.partner-balances", module: "financial", title: "أرصدة العملاء والموردين", desc: "رصيد كل طرف كما في تاريخ، مع المتأخر وحد الائتمان وآخر حركة", filters: ["to", "role", "branch", "city", "nonzero", "q"], groupBy: [{ key: "partner", label: "الطرف" }, { key: "city", label: "المدينة" }] },
  { key: "fin.cost-centers", module: "financial", title: "تفصيل مراكز التكلفة", desc: "الإيرادات والمصروفات لكل مركز تكلفة بالفترة", filters: ["period", "branch", "costCenter"], groupBy: [{ key: "costCenter", label: "مركز التكلفة" }, { key: "account", label: "مركز التكلفة والحساب" }], companyOnly: true },
  { key: "fin.entries-summary", module: "financial", title: "ملخص القيود", desc: "عدد القيود وقيمتها حسب النوع والشهر والمستخدم", filters: ["period", "branch", "entryType", "user"], groupBy: [{ key: "entryType", label: "نوع القيد" }, { key: "month", label: "الشهر" }, { key: "user", label: "المستخدم" }, { key: "branch", label: "الفرع" }] },
  // ── sales
  { key: "sales.summary", module: "sales", title: "تحليل المبيعات", desc: "المبيعات والمرتجعات والتكلفة والربح مجمّعة حسب أي بُعد", filters: ["period", "partner", "product", "category", "branch", "warehouse", "channel", "user", "taxCode", "groupBy"], groupBy: SALES_GROUPS, chart: "net" },
  { key: "sales.register", module: "sales", title: "سجل فواتير المبيعات", desc: "قائمة الفواتير والإشعارات بكل الفلاتر", filters: ["period", ...DOC_FILTERS.slice(1), "kind", "overdue", "minTotal"] },
  { key: "sales.lines", module: "sales", title: "تفصيل بنود المبيعات", desc: "سطر لكل صنف مباع مع السعر والخصم والتكلفة والربح", filters: ["period", "partner", "product", "category", "branch", "warehouse", "channel", "user", "taxCode", "q"] },
  { key: "sales.returns", module: "sales", title: "مرتجعات المبيعات", desc: "الإشعارات الدائنة والسبب والفاتورة الأصلية", filters: ["period", "partner", "branch", "channel", "user", "q"], groupBy: [{ key: "none", label: "تفصيلي" }, { key: "partner", label: "حسب العميل" }, { key: "reason", label: "حسب السبب" }, { key: "month", label: "حسب الشهر" }] },
  { key: "sales.pipeline", module: "sales", title: "عروض الأسعار وأوامر البيع", desc: "عدد العروض والأوامر وقيمتها وما تحوّل منها إلى فواتير", filters: ["period", "partner", "branch", "user"], groupBy: [{ key: "month", label: "الشهر" }, { key: "partner", label: "العميل" }, { key: "user", label: "المستخدم" }] },
  { key: "sales.daily-cash", module: "sales", title: "ملخص المبيعات اليومي حسب طريقة الدفع", desc: "نقدي / شبكة / آجل لكل يوم من فواتير المبيعات ونقطة البيع", filters: ["period", "branch", "warehouse", "channel", "user"], groupBy: [{ key: "day", label: "اليوم" }, { key: "month", label: "الشهر" }, { key: "user", label: "المستخدم" }], chart: "total" },
  { key: "sales.collections", module: "sales", title: "التحصيلات من العملاء", desc: "سندات القبض حسب العميل أو الطريقة أو الشهر", filters: ["period", "partner", "method", "account", "branch", "user"], groupBy: [{ key: "partner", label: "العميل" }, { key: "method", label: "طريقة الدفع" }, { key: "account", label: "الصندوق/البنك" }, { key: "month", label: "الشهر" }, { key: "day", label: "اليوم" }, { key: "user", label: "المستخدم" }], fixed: { direction: "IN" }, base: "cash.vouchers-summary", chart: "amount" },
  { key: "sales.unpaid", module: "sales", title: "فواتير المبيعات غير المسددة", desc: "الفواتير المفتوحة مع أيام التأخير", filters: ["to", "partner", "branch", "overdueOnly", "q"], base: "sales.register", fixed: { status: "POSTED", kind: "INVOICE", paymentStatus: "UNPAID,PARTIAL", openAsOf: 1 } },
  // ── purchases
  { key: "purch.summary", module: "purchases", title: "تحليل المشتريات", desc: "المشتريات والمرتجعات مجمّعة حسب المورد أو الصنف أو التصنيف أو الشهر", filters: ["period", "partner", "product", "category", "branch", "warehouse", "user", "taxCode", "groupBy"], groupBy: PURCH_GROUPS, chart: "net" },
  { key: "purch.register", module: "purchases", title: "سجل فواتير المشتريات", desc: "قائمة فواتير وأوامر ومرتجعات الشراء", filters: ["period", "partner", "product", "category", "branch", "warehouse", "status", "paymentStatus", "user", "kind", "overdue", "minTotal", "q"] },
  { key: "purch.lines", module: "purchases", title: "تفصيل بنود المشتريات", desc: "سطر لكل صنف مشترى بسعره وكميته ومورده", filters: ["period", "partner", "product", "category", "branch", "warehouse", "user", "q"] },
  { key: "purch.price-history", module: "purchases", title: "تطور أسعار الشراء", desc: "آخر سعر وأدنى وأعلى ومتوسط لكل صنف، أو التفصيل بالمورد والتاريخ", filters: ["period", "partner", "product", "category"], groupBy: [{ key: "product", label: "حسب الصنف" }, { key: "productSupplier", label: "الصنف والمورد" }, { key: "none", label: "تفصيلي" }] },
  { key: "purch.returns", module: "purchases", title: "مرتجعات المشتريات", desc: "الإشعارات الدائنة للموردين", filters: ["period", "partner", "branch", "q"], base: "sales.returns", fixed: { direction: "PURCHASE" } },
  { key: "purch.payments", module: "purchases", title: "المدفوعات للموردين", desc: "سندات الصرف حسب المورد أو الطريقة أو الشهر", filters: ["period", "partner", "method", "account", "branch", "user"], groupBy: [{ key: "partner", label: "المورد" }, { key: "method", label: "طريقة الدفع" }, { key: "account", label: "الصندوق/البنك" }, { key: "month", label: "الشهر" }, { key: "user", label: "المستخدم" }], fixed: { direction: "OUT" }, base: "cash.vouchers-summary", chart: "amount" },
  { key: "purch.unpaid", module: "purchases", title: "فواتير الموردين غير المسددة", desc: "المستحقات المفتوحة للموردين مع أيام التأخير", filters: ["to", "partner", "branch", "overdueOnly", "q"], base: "sales.register", fixed: { direction: "PURCHASE", status: "POSTED", kind: "INVOICE", paymentStatus: "UNPAID,PARTIAL", openAsOf: 1 } },
  // ── inventory
  { key: "inv.movement", module: "inventory", title: "حركة المخزون (وارد / صادر)", desc: "رصيد أول المدة والوارد والصادر ورصيد آخر المدة كمية وقيمة", filters: ["period", "warehouse", "product", "category", "branch", "moveType"], groupBy: [{ key: "product", label: "الصنف" }, { key: "productWarehouse", label: "الصنف والمستودع" }, { key: "category", label: "التصنيف" }, { key: "warehouse", label: "المستودع" }] },
  { key: "inv.moves", module: "inventory", title: "سجل حركات المخزون", desc: "كل حركة مخزنية بالتاريخ والمرجع والمستودع والتكلفة", filters: ["period", "warehouse", "product", "category", "branch", "moveType", "q"] },
  { key: "inv.by-warehouse", module: "inventory", title: "المخزون حسب المستودع", desc: "مصفوفة الأصناف × المستودعات بالكميات الحالية", filters: ["category", "product", "branch", "nonzero", "q"] },
  { key: "inv.status", module: "inventory", title: "حالة المخزون وتغطية الأيام", desc: "الرصيد مقابل حد الطلب، ومتوسط البيع اليومي وأيام التغطية المتوقعة", filters: ["category", "warehouse", "branch", "days", "stockState", "q"] },
  { key: "inv.dead-stock", module: "inventory", title: "الأصناف الراكدة", desc: "أصناف لها رصيد ولم تُبع منذ مدة", filters: ["days", "category", "warehouse", "branch", "q"] },
  { key: "inv.turnover", module: "inventory", title: "دوران المخزون", desc: "تكلفة المبيعات ÷ متوسط المخزون لكل صنف أو تصنيف، وأيام الدوران", filters: ["period", "category", "warehouse", "branch"], groupBy: [{ key: "product", label: "الصنف" }, { key: "category", label: "التصنيف" }] },
  { key: "inv.adjustments", module: "inventory", title: "سجل الجرد والتسويات والتحويلات", desc: "مستندات الجرد بالأصناف والقيمة", filters: ["period", "warehouse", "branch", "adjKind", "q"] },
  { key: "inv.valuation-category", module: "inventory", title: "قيمة المخزون حسب التصنيف", desc: "القيمة بالتكلفة وقيمة البيع والهامش المتوقع", filters: ["warehouse", "branch"], groupBy: [{ key: "category", label: "التصنيف" }, { key: "warehouse", label: "المستودع" }, { key: "categoryWarehouse", label: "التصنيف والمستودع" }], chart: "value" },
  // ── pos
  { key: "pos.sessions", module: "pos", title: "تقرير الورديات", desc: "كل وردية بالكاشير والنقدية والشبكة والمرتجعات والفرق", filters: ["period", "user", "warehouse", "branch", "sessionStatus"], groupBy: [{ key: "none", label: "تفصيلي" }, { key: "user", label: "حسب الكاشير" }, { key: "day", label: "حسب اليوم" }, { key: "warehouse", label: "حسب المستودع" }] },
  { key: "pos.by-cashier", module: "pos", title: "المبيعات حسب الكاشير", desc: "مبيعات وربح كل كاشير", filters: ["period", "branch", "warehouse"], base: "sales.summary", fixed: { channel: "POS", groupBy: "user" }, chart: "net" },
  { key: "pos.products", module: "pos", title: "الأصناف الأكثر مبيعاً في نقطة البيع", desc: "كمية ومبيعات وربح كل صنف عبر نقطة البيع", filters: ["period", "branch", "warehouse", "category", "user"], base: "sales.summary", fixed: { channel: "POS", groupBy: "product" }, chart: "qty" },
  { key: "pos.hourly", module: "pos", title: "المبيعات حسب الساعة", desc: "توزيع فواتير نقطة البيع على ساعات اليوم", filters: ["period", "branch", "warehouse", "user"], chart: "total" },
  { key: "pos.tenders", module: "pos", title: "طرق الدفع في نقطة البيع", desc: "نقدي / شبكة / آجل حسب اليوم أو الشهر أو الكاشير", filters: ["period", "branch", "warehouse", "user"], groupBy: [{ key: "method", label: "طريقة الدفع" }, { key: "day", label: "اليوم" }, { key: "month", label: "الشهر" }, { key: "user", label: "الكاشير" }], chart: "amount" },
  { key: "pos.returns", module: "pos", title: "مرتجعات نقطة البيع", desc: "المرتجعات المسجلة من نقطة البيع", filters: ["period", "branch", "user", "q"], base: "sales.returns", fixed: { channel: "POS" } },
  // ── treasury
  { key: "cash.balances", module: "treasury", title: "أرصدة الصناديق والبنوك", desc: "رصيد أول المدة والمقبوضات والمدفوعات ورصيد آخر المدة لكل حساب نقدي", filters: ["period", "branch"], chart: "closing" },
  { key: "cash.movement", module: "treasury", title: "حركة الصناديق والبنوك", desc: "كل حركة على الحسابات النقدية بالطرف والمرجع", filters: ["period", "account", "branch", "partner", "entryType", "q"], groupBy: [{ key: "none", label: "تفصيلي" }, { key: "account", label: "حسب الحساب" }, { key: "entryType", label: "حسب نوع الحركة" }, { key: "day", label: "حسب اليوم" }, { key: "month", label: "حسب الشهر" }] },
  { key: "cash.vouchers", module: "treasury", title: "سجل سندات القبض والصرف", desc: "كل السندات بفلاتر الاتجاه والطريقة والحساب والطرف", filters: ["period", "direction", "partner", "method", "account", "branch", "user", "status", "q"] },
  { key: "cash.vouchers-summary", module: "treasury", title: "ملخص السندات", desc: "إجمالي القبض والصرف مجمّعاً", filters: ["period", "direction", "partner", "method", "account", "branch", "user"], groupBy: [{ key: "method", label: "طريقة الدفع" }, { key: "account", label: "الصندوق/البنك" }, { key: "partner", label: "الطرف" }, { key: "month", label: "الشهر" }, { key: "day", label: "اليوم" }, { key: "user", label: "المستخدم" }, { key: "direction", label: "الاتجاه" }], chart: "amount" },
  { key: "cash.cheques", module: "treasury", title: "الشيكات", desc: "الشيكات المستلمة والصادرة حسب الحالة والاستحقاق", filters: ["duePeriod", "direction", "chequeStatus", "partner", "q"] },
  { key: "cash.fx", module: "treasury", title: "فروق العملة", desc: "السندات بالعملات الأجنبية وفرق الصرف المحقق", filters: ["period", "partner", "currency"] },
  // ── expenses
  { key: "exp.register", module: "expenses", title: "سجل المصروفات", desc: "كل المصروفات بالحساب ومركز التكلفة والمستفيد وطريقة الدفع", filters: ["period", "account", "costCenter", "branch", "payType", "status", "partner", "q"] },
  { key: "exp.summary", module: "expenses", title: "تحليل المصروفات", desc: "المصروفات مجمّعة حسب الحساب أو مركز التكلفة أو الشهر أو المستفيد", filters: ["period", "account", "costCenter", "branch", "payType", "groupBy"], groupBy: [{ key: "account", label: "الحساب" }, { key: "costCenter", label: "مركز التكلفة" }, { key: "month", label: "الشهر" }, { key: "payee", label: "المستفيد" }, { key: "branch", label: "الفرع" }, { key: "payType", label: "نقدي/آجل" }, { key: "user", label: "المستخدم" }], chart: "amount" },
  { key: "exp.monthly", module: "expenses", title: "المصروفات الشهرية حسب الحساب", desc: "مصفوفة حسابات المصروفات × الأشهر (من الأستاذ العام، تشمل الرواتب والإهلاك)", filters: ["period", "branch", "costCenter"] },
  // ── hr
  { key: "hr.payroll", module: "hr", title: "ملخص الرواتب", desc: "الإجمالي والتأمينات والخصومات والصافي لكل شهر أو قسم", filters: ["period", "department", "nationality", "payrollStatus"], groupBy: [{ key: "period", label: "الشهر" }, { key: "department", label: "القسم" }, { key: "nationality", label: "الجنسية" }, { key: "employee", label: "الموظف" }], chart: "net" },
  { key: "hr.payslips", module: "hr", title: "تفصيل قسائم الرواتب", desc: "سطر لكل موظف في كل مسير", filters: ["period", "department", "nationality", "employee", "payrollStatus", "q"] },
  { key: "hr.employee-cost", module: "hr", title: "تكلفة الموظفين", desc: "الإجمالي + تأمينات المنشأة = التكلفة الكلية لكل موظف في الفترة", filters: ["period", "department", "nationality", "employee"], groupBy: [{ key: "employee", label: "الموظف" }, { key: "department", label: "القسم" }], chart: "cost" },
  { key: "hr.gosi", module: "hr", title: "تقرير التأمينات الاجتماعية", desc: "الأجر الخاضع وحصة الموظف والمنشأة لكل شهر", filters: ["period", "department", "nationality", "employee"], groupBy: [{ key: "period", label: "الشهر" }, { key: "employee", label: "الموظف" }, { key: "nationality", label: "الجنسية" }] },
  { key: "hr.loans", module: "hr", title: "سلف الموظفين", desc: "السلف والمسدد والمتبقي", filters: ["period", "employee", "department", "loanStatus"] },
  // ── assets
  { key: "asset.register", module: "assets", title: "سجل الأصول الثابتة", desc: "التكلفة ومجمع الإهلاك والقيمة الدفترية", filters: ["assetCategory", "assetStatus", "acqPeriod", "q"], groupBy: [{ key: "none", label: "تفصيلي" }, { key: "category", label: "حسب الفئة" }, { key: "account", label: "حسب حساب الأصل" }] },
  { key: "asset.depreciation", module: "assets", title: "جدول الإهلاك", desc: "الإهلاك المرحّل في الفترة لكل أصل أو فئة أو شهر", filters: ["period", "assetCategory", "asset"], groupBy: [{ key: "asset", label: "الأصل" }, { key: "category", label: "الفئة" }, { key: "month", label: "الشهر" }, { key: "none", label: "تفصيلي" }], chart: "amount" },
  // ── vat
  { key: "vat.detail", module: "vat", title: "تفصيل ضريبة المخرجات والمدخلات", desc: "كل مستند بالقاعدة الخاضعة والضريبة ورمز الضريبة", filters: ["period", "vatSide", "taxCode", "partner", "branch", "q"], groupBy: [{ key: "none", label: "تفصيلي" }, { key: "taxCode", label: "حسب الرمز الضريبي" }, { key: "partner", label: "حسب الطرف" }, { key: "month", label: "حسب الشهر" }, { key: "source", label: "حسب المصدر" }] },
  { key: "vat.monthly", module: "vat", title: "الضريبة الشهرية", desc: "ضريبة المخرجات والمدخلات وصافي الضريبة لكل شهر", filters: ["period", "branch"], chart: "net" },
  // ── estore
  { key: "estore.orders", module: "estore", title: "طلبات المتاجر الإلكترونية", desc: "طلبات سلة وزد حسب المنصة والشهر والحالة", filters: ["period", "platform", "paymentStatus", "user"], groupBy: [{ key: "platform", label: "المنصة" }, { key: "month", label: "الشهر" }, { key: "day", label: "اليوم" }, { key: "paymentStatus", label: "حالة السداد" }, { key: "none", label: "تفصيلي" }], chart: "total" },
  { key: "estore.payouts", module: "estore", title: "تحويلات المنصات", desc: "التحويلات المستلمة من سلة وزد والعمولات", filters: ["period", "platform"] },
];
export const MODULES = [["financial", "المالية"], ["sales", "المبيعات"], ["purchases", "المشتريات"], ["inventory", "المخزون"], ["pos", "نقطة البيع"], ["treasury", "الخزينة"], ["expenses", "المصروفات"], ["hr", "الرواتب والموظفون"], ["assets", "الأصول الثابتة"], ["vat", "الضريبة"], ["estore", "المتاجر الإلكترونية"]].map(([key, label]) => ({ key, label }));

// ───────────────────────── runner ─────────────────────────
export async function runReport(t: Db, companyId: string, key: string, q: any, ctx: { lockedBranchId?: string | null }): Promise<Result & { def: Def }> {
  const def = CATALOG.find((d) => d.key === key);
  if (!def) throw bad("تقرير غير معروف");
  const params = { ...q, ...(def.fixed || {}) };
  if (ctx.lockedBranchId) params.branchId = ctx.lockedBranchId;
  const impl = IMPL[def.base || def.key];
  if (!impl) throw bad("التقرير غير متاح");
  const r = await impl(t, companyId, params);
  if (!r.totals) r.totals = totalsOf(r.columns, r.rows);
  return { ...r, def };
}

const branchViaWarehouse = (w: W, q: any, alias = "w") => { if (q.branchId && UUID.test(q.branchId)) w.add(`${alias}.branch_id=?::uuid`, q.branchId); };

type Impl = (t: Db, companyId: string, q: any) => Promise<Result>;
const IMPL: Record<string, Impl> = {};

// ── documents (sales / purchases) ───────────────────────────
function docWhere(companyId: string, q: any, alias = "i") {
  const { from, to } = period(q);
  const w = new W(`${alias}.company_id=?`, companyId);
  w.add(`${alias}.direction=?`, q.direction === "PURCHASE" ? "PURCHASE" : "SALE");
  if (!q.openAsOf) w.range(`${alias}.date`, from, to); else { if (q.to && isDate(q.to)) w.add(`${alias}.date <= ?`, q.to); }
  w.uuid(`${alias}.partner_id`, q.partnerId).uuid(`${alias}.branch_id`, q.branchId).uuids(`${alias}.warehouse_id`, q.warehouseId);
  w.in(`${alias}.channel`, q.channel).in(`${alias}.status`, q.status).in(`${alias}.payment_status`, q.paymentStatus).in(`${alias}.kind`, q.kind).in(`${alias}.zatca_status`, q.zatca);
  if (q.user) w.add(`${alias}.created_by=?`, q.user);
  if (q.productId && UUID.test(q.productId)) w.add(`EXISTS (SELECT 1 FROM invoice_lines x WHERE x.invoice_id=${alias}.id AND x.product_id=?::uuid)`, q.productId);
  const cats = list(q.categoryId).filter((x) => UUID.test(x));
  if (cats.length) w.add(`EXISTS (SELECT 1 FROM invoice_lines x JOIN products px ON px.id=x.product_id WHERE x.invoice_id=${alias}.id AND px.category_id = ANY(?::uuid[]))`, cats);
  if (q.overdue === "1" || q.overdueOnly === "1") w.raw(`${alias}.status='POSTED' AND ${alias}.kind IN ('INVOICE','DEBIT_NOTE') AND ${alias}.total-${alias}.amount_paid>0.001 AND COALESCE(${alias}.due_date,${alias}.date) < CURRENT_DATE`);
  if (q.minTotal && Number(q.minTotal) > 0) w.add(`${alias}.total >= ?`, Number(q.minTotal));
  w.like([`${alias}.number`, `${alias}.partner_name`, `${alias}.supplier_ref`, `${alias}.notes`, `${alias}.external_ref`], q.q);
  return w;
}
const SIGN = "CASE WHEN i.kind='CREDIT_NOTE' THEN -1 ELSE 1 END";

IMPL["sales.register"] = async (t, companyId, q) => {
  const w = docWhere(companyId, q);
  const sale = q.direction !== "PURCHASE";
  const rows = await t.rows(`SELECT i.id, i.number, i.date, i.due_date, i.kind, i.channel, i.status, i.payment_status, i.zatca_status, i.partner_name, i.created_by, i.taxable, i.vat_total, i.total, i.amount_paid, i.total-i.amount_paid remaining, i.cost_total, i.currency, i.external_ref, i.supplier_ref,
      b.name AS branch, w.name AS warehouse, GREATEST(0, CURRENT_DATE - COALESCE(i.due_date, i.date)) days_overdue
    FROM invoices i LEFT JOIN branches b ON b.id=i.branch_id LEFT JOIN warehouses w ON w.id=i.warehouse_id WHERE ${w.sql} ORDER BY i.date DESC, i.created_at DESC LIMIT 5000`, w.params);
  const out = rows.map((r) => ({ ...r, kind: KIND_AR[r.kind], channel: CHANNEL_AR[r.channel] || r.channel, status: STATUS_AR[r.status] || r.status, paymentStatus: r.status === "POSTED" && r.kind === "INVOICE" ? STATUS_AR[r.paymentStatus] : "", daysOverdue: r.status === "POSTED" && r.kind === "INVOICE" && Number(r.remaining) > 0.001 ? Number(r.daysOverdue) : null, remaining: r.status === "POSTED" && r.kind === "INVOICE" ? r2(r.remaining) : 0, profit: sale && r.kind === "INVOICE" ? r2(Number(r.taxable) - Number(r.costTotal || 0)) : null, _link: `/doc/${r.id}` }));
  const columns: Col[] = [{ key: "number", label: "الرقم" }, { key: "date", label: "التاريخ", type: "date" }, { key: "dueDate", label: "الاستحقاق", type: "date" }, { key: "partnerName", label: sale ? "العميل" : "المورد" }, { key: "kind", label: "النوع" }, ...(sale ? [{ key: "channel", label: "القناة" }] : [{ key: "supplierRef", label: "مرجع المورد" }]), { key: "branch", label: "الفرع" }, { key: "warehouse", label: "المستودع" }, { key: "createdBy", label: "المستخدم" }, { key: "taxable", label: "قبل الضريبة", type: "money", sum: true }, { key: "vatTotal", label: "الضريبة", type: "money", sum: true }, { key: "total", label: "الإجمالي", type: "money", sum: true }, { key: "amountPaid", label: "المسدد", type: "money", sum: true }, { key: "remaining", label: "المتبقي", type: "money", sum: true }, { key: "daysOverdue", label: "أيام التأخير", type: "int" }, ...(sale ? [{ key: "profit", label: "مجمل الربح", type: "money", sum: true } as Col] : []), { key: "status", label: "الحالة" }, { key: "paymentStatus", label: "السداد" }, ...(sale ? [{ key: "zatcaStatus", label: "الهيئة" }] : [])];
  return { columns, rows: out, meta: { count: out.length } };
};
IMPL["purch.register"] = (t, c, q) => IMPL["sales.register"](t, c, { ...q, direction: "PURCHASE" });

function lineDim(g: string) {
  const M: Record<string, [string, string, string?]> = {
    product: ["p.id", "p.name", "p.sku"], category: ["COALESCE(c.name,'بدون تصنيف')", "COALESCE(c.name,'بدون تصنيف')"], partner: ["i.partner_id", "i.partner_name"], branch: ["b.name", "COALESCE(b.name,'—')"], warehouse: ["w.name", "COALESCE(w.name,'—')"], channel: ["i.channel", "i.channel"],
    user: ["i.created_by", "i.created_by"], month: ["to_char(i.date,'YYYY-MM')", "to_char(i.date,'YYYY-MM')"], week: ["to_char(date_trunc('week', i.date),'YYYY-MM-DD')", "to_char(date_trunc('week', i.date),'YYYY-MM-DD')"], day: ["i.date::text", "i.date::text"], taxCode: ["l.tax_code", "l.tax_code"], invoiceType: ["i.invoice_type", "i.invoice_type"], city: ["COALESCE(pr.city,'—')", "COALESCE(pr.city,'—')"],
  };
  return M[g] || M.product;
}
IMPL["sales.summary"] = async (t, companyId, q) => {
  const g = q.groupBy || "product";
  const w = docWhere(companyId, q);
  w.raw("i.status='POSTED' AND i.kind IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE')");
  w.uuid("p.category_id", undefined); // placeholder (category handled in docWhere via EXISTS; also line-level below)
  const cats = list(q.categoryId).filter((x) => UUID.test(x));
  if (cats.length) w.add("p.category_id = ANY(?::uuid[])", cats);
  if (q.productId && UUID.test(q.productId)) w.add("l.product_id=?::uuid", q.productId);
  if (q.taxCode) w.in("l.tax_code", q.taxCode);
  const [gk, gl, gs] = lineDim(g);
  const rows = await t.rows(`SELECT ${gk} AS gkey, ${gl} AS glabel${gs ? `, ${gs} AS gsub` : ""}, COUNT(DISTINCT i.id)::int docs,
      SUM(CASE WHEN i.kind='INVOICE' THEN l.qty*l.factor ELSE 0 END) qty_sold, SUM(CASE WHEN i.kind='CREDIT_NOTE' THEN l.qty*l.factor ELSE 0 END) qty_returned,
      SUM(l.net_amount*${SIGN}) net, SUM(l.vat_amount*${SIGN}) vat, SUM(l.total*${SIGN}) total,
      SUM(CASE WHEN i.kind='CREDIT_NOTE' THEN l.net_amount ELSE 0 END) returns, SUM(l.qty*l.factor*l.unit_cost*${SIGN}) cost
    FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id LEFT JOIN products p ON p.id=l.product_id LEFT JOIN product_categories c ON c.id=p.category_id LEFT JOIN branches b ON b.id=i.branch_id LEFT JOIN warehouses w ON w.id=i.warehouse_id LEFT JOIN partners pr ON pr.id=i.partner_id
    WHERE ${w.sql} GROUP BY 1,2${gs ? ",3" : ""} ORDER BY ${["month", "week", "day"].includes(g) ? "1" : "net DESC"} LIMIT 2000`, w.params);
  const sale = q.direction !== "PURCHASE";
  const out = rows.map((r) => { const net = r2(r.net), cost = r2(r.cost), profit = r2(net - cost); return { group: g === "channel" ? CHANNEL_AR[r.glabel] || r.glabel : g === "invoiceType" ? (r.glabel === "SIMPLIFIED" ? "مبسطة" : "ضريبية") : r.glabel, sub: r.gsub, docs: r.docs, qty: r2(Number(r.qtySold) - Number(r.qtyReturned)), qtyReturned: r2(r.qtyReturned), net, returns: r2(r.returns), vat: r2(r.vat), total: r2(r.total), cost, profit, margin: pct(profit, net), _link: g === "product" && r.gkey ? `/products?q=${encodeURIComponent(r.gsub || "")}` : g === "partner" && r.gkey ? `/${sale ? "customers" : "suppliers"}?q=${encodeURIComponent(r.glabel || "")}` : undefined }; });
  const GL = Object.fromEntries(SALES_GROUPS.map((x) => [x.key, x.label]));
  const columns: Col[] = [{ key: "group", label: sale ? GL[g] || "المجموعة" : g === "partner" ? "المورد" : GL[g] }, ...(gs ? [{ key: "sub", label: "الرمز" }] : []), { key: "docs", label: "المستندات", type: "int", sum: true }, { key: "qty", label: "الكمية (صافي)", type: "qty", sum: true }, { key: "qtyReturned", label: "كمية المرتجع", type: "qty", sum: true }, { key: "net", label: sale ? "صافي المبيعات" : "صافي المشتريات", type: "money", sum: true }, { key: "returns", label: "المرتجعات", type: "money", sum: true }, { key: "vat", label: "الضريبة", type: "money", sum: true }, { key: "total", label: "الإجمالي", type: "money", sum: true }, ...(sale ? [{ key: "cost", label: "التكلفة", type: "money", sum: true } as Col, { key: "profit", label: "مجمل الربح", type: "money", sum: true } as Col, { key: "margin", label: "الهامش %", type: "pct" } as Col] : [])];
  const totals = totalsOf(columns, out); if (sale) totals.margin = pct(totals.profit, totals.net);
  return { columns, rows: out, totals };
};
IMPL["purch.summary"] = (t, c, q) => IMPL["sales.summary"](t, c, { ...q, direction: "PURCHASE" });

IMPL["sales.lines"] = async (t, companyId, q) => {
  const w = docWhere(companyId, q);
  w.raw("i.status='POSTED' AND i.kind IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE')");
  if (q.productId && UUID.test(q.productId)) w.add("l.product_id=?::uuid", q.productId);
  const cats = list(q.categoryId).filter((x) => UUID.test(x)); if (cats.length) w.add("p.category_id = ANY(?::uuid[])", cats);
  if (q.taxCode) w.in("l.tax_code", q.taxCode);
  const sale = q.direction !== "PURCHASE";
  const rows = await t.rows(`SELECT i.id, i.number, i.date, i.kind, i.partner_name, i.channel, i.created_by, l.description, p.sku, c.name AS category, l.qty, l.uom, l.factor, l.unit_price, l.discount_pct, l.tax_code, l.net_amount*${SIGN} net, l.vat_amount*${SIGN} vat, l.total*${SIGN} total, l.qty*l.factor*l.unit_cost*${SIGN} cost, w.name AS warehouse
    FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id LEFT JOIN products p ON p.id=l.product_id LEFT JOIN product_categories c ON c.id=p.category_id LEFT JOIN warehouses w ON w.id=i.warehouse_id WHERE ${w.sql} ORDER BY i.date DESC, i.created_at DESC, l.sort LIMIT 5000`, w.params);
  const out = rows.map((r) => ({ ...r, kind: KIND_AR[r.kind], channel: CHANNEL_AR[r.channel] || r.channel, qty: r2(Number(r.qty) * (r.kind === "إشعار دائن" ? -1 : 1)), uom: r.uom || "", profit: sale ? r2(Number(r.net) - Number(r.cost)) : null, _link: `/doc/${r.id}` }));
  const columns: Col[] = [{ key: "date", label: "التاريخ", type: "date" }, { key: "number", label: "المستند" }, { key: "kind", label: "النوع" }, { key: "partnerName", label: sale ? "العميل" : "المورد" }, { key: "sku", label: "الرمز" }, { key: "description", label: "الصنف / البيان" }, { key: "category", label: "التصنيف" }, { key: "warehouse", label: "المستودع" }, { key: "qty", label: "الكمية", type: "qty", sum: true }, { key: "uom", label: "الوحدة" }, { key: "unitPrice", label: "السعر", type: "money" }, { key: "discountPct", label: "خصم %", type: "pct" }, { key: "taxCode", label: "الضريبة" }, { key: "net", label: "الصافي", type: "money", sum: true }, { key: "vat", label: "الضريبة", type: "money", sum: true }, { key: "total", label: "الإجمالي", type: "money", sum: true }, ...(sale ? [{ key: "cost", label: "التكلفة", type: "money", sum: true } as Col, { key: "profit", label: "الربح", type: "money", sum: true } as Col] : []), { key: "createdBy", label: "المستخدم" }];
  return { columns, rows: out };
};
IMPL["purch.lines"] = (t, c, q) => IMPL["sales.lines"](t, c, { ...q, direction: "PURCHASE" });

IMPL["sales.returns"] = async (t, companyId, q) => {
  const w = docWhere(companyId, { ...q, kind: "CREDIT_NOTE", status: "POSTED" });
  const g = q.groupBy || "none";
  const sale = q.direction !== "PURCHASE";
  if (g === "none") {
    const rows = await t.rows(`SELECT i.id, i.number, i.date, i.partner_name, i.reason, i.channel, i.created_by, o.number AS origin, o.date AS origin_date, i.taxable, i.vat_total, i.total, b.name AS branch FROM invoices i LEFT JOIN invoices o ON o.id=i.origin_id LEFT JOIN branches b ON b.id=i.branch_id WHERE ${w.sql} ORDER BY i.date DESC LIMIT 5000`, w.params);
    return { columns: [{ key: "date", label: "التاريخ", type: "date" }, { key: "number", label: "الإشعار" }, { key: "origin", label: "الفاتورة الأصلية" }, { key: "originDate", label: "تاريخها", type: "date" }, { key: "partnerName", label: sale ? "العميل" : "المورد" }, { key: "reason", label: "السبب" }, { key: "channel", label: "القناة" }, { key: "branch", label: "الفرع" }, { key: "createdBy", label: "المستخدم" }, { key: "taxable", label: "قبل الضريبة", type: "money", sum: true }, { key: "vatTotal", label: "الضريبة", type: "money", sum: true }, { key: "total", label: "الإجمالي", type: "money", sum: true }], rows: rows.map((r) => ({ ...r, channel: CHANNEL_AR[r.channel] || r.channel, _link: `/doc/${r.id}` })) };
  }
  const gk = g === "partner" ? "i.partner_name" : g === "reason" ? "COALESCE(i.reason,'—')" : "to_char(i.date,'YYYY-MM')";
  const rows = await t.rows(`SELECT ${gk} AS grp, COUNT(*)::int docs, SUM(i.taxable) taxable, SUM(i.vat_total) vat, SUM(i.total) total FROM invoices i WHERE ${w.sql} GROUP BY 1 ORDER BY total DESC`, w.params);
  return { columns: [{ key: "grp", label: g === "partner" ? (sale ? "العميل" : "المورد") : g === "reason" ? "السبب" : "الشهر" }, { key: "docs", label: "عدد الإشعارات", type: "int", sum: true }, { key: "taxable", label: "قبل الضريبة", type: "money", sum: true }, { key: "vat", label: "الضريبة", type: "money", sum: true }, { key: "total", label: "الإجمالي", type: "money", sum: true }], rows };
};

IMPL["sales.pipeline"] = async (t, companyId, q) => {
  const w = docWhere(companyId, { ...q, kind: "QUOTATION,ORDER" });
  const g = q.groupBy || "month";
  const gk = g === "partner" ? "i.partner_name" : g === "user" ? "i.created_by" : "to_char(i.date,'YYYY-MM')";
  const rows = await t.rows(`SELECT ${gk} AS grp,
      COUNT(*) FILTER (WHERE i.kind='QUOTATION')::int quotes, SUM(i.total) FILTER (WHERE i.kind='QUOTATION') quotes_value,
      COUNT(*) FILTER (WHERE i.kind='QUOTATION' AND i.status='CONVERTED')::int quotes_converted,
      COUNT(*) FILTER (WHERE i.kind='ORDER')::int orders, SUM(i.total) FILTER (WHERE i.kind='ORDER') orders_value,
      COUNT(*) FILTER (WHERE i.kind='ORDER' AND i.status='CONVERTED')::int orders_converted,
      SUM(i.total) FILTER (WHERE i.status='CONVERTED') converted_value, SUM(i.total) FILTER (WHERE i.status='DRAFT') open_value
    FROM invoices i WHERE ${w.sql} GROUP BY 1 ORDER BY 1`, w.params);
  const out = rows.map((r) => ({ ...r, quoteRate: pct(r.quotesConverted, r.quotes), orderRate: pct(r.ordersConverted, r.orders) }));
  return { columns: [{ key: "grp", label: g === "partner" ? "العميل" : g === "user" ? "المستخدم" : "الشهر" }, { key: "quotes", label: "عروض الأسعار", type: "int", sum: true }, { key: "quotesValue", label: "قيمتها", type: "money", sum: true }, { key: "quotesConverted", label: "تحوّلت", type: "int", sum: true }, { key: "quoteRate", label: "نسبة التحويل %", type: "pct" }, { key: "orders", label: "الأوامر", type: "int", sum: true }, { key: "ordersValue", label: "قيمتها", type: "money", sum: true }, { key: "ordersConverted", label: "تحوّلت", type: "int", sum: true }, { key: "orderRate", label: "نسبة التحويل %", type: "pct" }, { key: "openValue", label: "قيمة المفتوح", type: "money", sum: true }, { key: "convertedValue", label: "قيمة المحوّل", type: "money", sum: true }], rows: out };
};

IMPL["sales.daily-cash"] = async (t, companyId, q) => {
  const w = docWhere(companyId, { ...q, kind: "INVOICE", status: "POSTED" });
  const g = q.groupBy || "day";
  const gk = g === "month" ? "to_char(i.date,'YYYY-MM')" : g === "user" ? "i.created_by" : "i.date::text";
  const rows = await t.rows(`WITH x AS (
      SELECT i.id, i.date, i.created_by, i.total, i.channel,
        COALESCE((SELECT SUM((e->>'amount')::numeric) FROM jsonb_array_elements(COALESCE(i.tenders,'[]'::jsonb)) e WHERE e->>'method'='CASH'),0) cash,
        COALESCE((SELECT SUM((e->>'amount')::numeric) FROM jsonb_array_elements(COALESCE(i.tenders,'[]'::jsonb)) e WHERE e->>'method'='CARD'),0) card
      FROM invoices i WHERE ${w.sql})
    SELECT ${gk.replace(/i\./g, "x.")} AS grp, COUNT(*)::int docs, SUM(total) total, SUM(LEAST(cash,total)) cash, SUM(card) card, SUM(GREATEST(total-cash-card,0)) credit, COUNT(*) FILTER (WHERE channel='POS')::int pos_docs FROM x GROUP BY 1 ORDER BY 1`, w.params);
  return { columns: [{ key: "grp", label: g === "month" ? "الشهر" : g === "user" ? "المستخدم" : "اليوم" }, { key: "docs", label: "الفواتير", type: "int", sum: true }, { key: "posDocs", label: "منها نقطة بيع", type: "int", sum: true }, { key: "cash", label: "نقدي", type: "money", sum: true }, { key: "card", label: "شبكة / بطاقة", type: "money", sum: true }, { key: "credit", label: "آجل / أخرى", type: "money", sum: true }, { key: "total", label: "الإجمالي", type: "money", sum: true }], rows, meta: { note: "نقدي/شبكة من مدفوعات نقطة البيع لحظة البيع؛ فواتير المكتب تظهر كآجل وتُحصَّل بسندات القبض" } };
};

IMPL["purch.price-history"] = async (t, companyId, q) => {
  const w = docWhere(companyId, { ...q, direction: "PURCHASE", kind: "INVOICE", status: "POSTED" });
  if (q.productId && UUID.test(q.productId)) w.add("l.product_id=?::uuid", q.productId);
  const cats = list(q.categoryId).filter((x) => UUID.test(x)); if (cats.length) w.add("p.category_id = ANY(?::uuid[])", cats);
  w.raw("l.product_id IS NOT NULL");
  const g = q.groupBy || "product";
  const base = `FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id JOIN products p ON p.id=l.product_id WHERE ${w.sql}`;
  if (g === "none") {
    const rows = await t.rows(`SELECT i.id, i.date, i.number, i.partner_name, p.sku, p.name, l.qty*l.factor qty, l.uom, l.unit_price/NULLIF(l.factor,0) unit_price, l.net_amount ${base} ORDER BY p.name, i.date DESC LIMIT 5000`, w.params);
    return { columns: [{ key: "sku", label: "الرمز" }, { key: "name", label: "الصنف" }, { key: "date", label: "التاريخ", type: "date" }, { key: "number", label: "الفاتورة" }, { key: "partnerName", label: "المورد" }, { key: "qty", label: "الكمية (أساسية)", type: "qty", sum: true }, { key: "unitPrice", label: "سعر الوحدة الأساسية", type: "money" }, { key: "netAmount", label: "الصافي", type: "money", sum: true }], rows: rows.map((r) => ({ ...r, _link: `/doc/${r.id}` })) };
  }
  const extra = g === "productSupplier" ? ", i.partner_name" : "";
  const rows = await t.rows(`SELECT p.sku, p.name${extra}, COUNT(*)::int buys, SUM(l.qty*l.factor) qty, SUM(l.net_amount) net, MIN(l.unit_price/NULLIF(l.factor,0)) min_price, MAX(l.unit_price/NULLIF(l.factor,0)) max_price, SUM(l.net_amount)/NULLIF(SUM(l.qty*l.factor),0) avg_price,
      (ARRAY_AGG(l.unit_price/NULLIF(l.factor,0) ORDER BY i.date DESC, i.created_at DESC))[1] last_price, MAX(i.date) last_date, p.purchase_price default_price ${base} GROUP BY p.id${extra} ORDER BY p.name${extra}`, w.params);
  return { columns: [{ key: "sku", label: "الرمز" }, { key: "name", label: "الصنف" }, ...(extra ? [{ key: "partnerName", label: "المورد" }] : []), { key: "buys", label: "مرات الشراء", type: "int", sum: true }, { key: "qty", label: "الكمية", type: "qty", sum: true }, { key: "net", label: "إجمالي الشراء", type: "money", sum: true }, { key: "lastPrice", label: "آخر سعر", type: "money" }, { key: "lastDate", label: "تاريخه", type: "date" }, { key: "avgPrice", label: "المتوسط", type: "money" }, { key: "minPrice", label: "الأدنى", type: "money" }, { key: "maxPrice", label: "الأعلى", type: "money" }, { key: "defaultPrice", label: "السعر الافتراضي", type: "money" }], rows: rows.map((r) => ({ ...r, change: r.defaultPrice ? pct(Number(r.lastPrice) - Number(r.defaultPrice), Number(r.defaultPrice)) : null })) };
};

// ── inventory ───────────────────────────────────────────────
function moveWhere(companyId: string, q: any, withPeriod = true) {
  const { from, to } = period(q);
  const w = new W("m.company_id=?", companyId);
  if (withPeriod) w.range("m.date", from, to);
  w.uuids("m.warehouse_id", q.warehouseId).uuid("m.product_id", q.productId);
  const cats = list(q.categoryId).filter((x) => UUID.test(x)); if (cats.length) w.add("p.category_id = ANY(?::uuid[])", cats);
  branchViaWarehouse(w, q);
  w.in("m.source_type", q.moveType);
  w.like(["m.reference", "p.name", "p.sku"], q.q);
  return w;
}
IMPL["inv.movement"] = async (t, companyId, q) => {
  const { from, to } = period(q);
  const g = q.groupBy || "product";
  const w = new W("m.company_id=?", companyId);
  w.add("m.date <= ?", to).uuids("m.warehouse_id", q.warehouseId).uuid("m.product_id", q.productId);
  const cats = list(q.categoryId).filter((x) => UUID.test(x)); if (cats.length) w.add("p.category_id = ANY(?::uuid[])", cats);
  branchViaWarehouse(w, q);
  if (q.moveType) w.add("(m.date < ? OR m.source_type = ANY(?::text[]))", from), w.params.push(list(q.moveType)), (w.conds[w.conds.length - 1] = w.conds[w.conds.length - 1].replace("ANY(?", `ANY($${w.params.length}`));
  w.params.push(from); const F = `$${w.params.length}`;
  const G: Record<string, [string, string[]]> = { product: ["p.id, p.sku, p.name, p.unit", ["sku", "name", "unit"]], productWarehouse: ["p.id, p.sku, p.name, p.unit, w.name", ["sku", "name", "unit", "warehouse"]], category: ["COALESCE(c.name,'بدون تصنيف')", ["category"]], warehouse: ["w.name", ["warehouse"]] };
  const [gcols, keys] = G[g] || G.product;
  const sel = g === "product" || g === "productWarehouse" ? `p.sku, p.name, p.unit${g === "productWarehouse" ? ", w.name AS warehouse" : ""}` : g === "category" ? "COALESCE(c.name,'بدون تصنيف') AS category" : "w.name AS warehouse";
  const rows = await t.rows(`SELECT ${sel},
      SUM(CASE WHEN m.date < ${F} THEN m.qty ELSE 0 END) opening_qty, SUM(CASE WHEN m.date < ${F} THEN m.value ELSE 0 END) opening_val,
      SUM(CASE WHEN m.date >= ${F} AND m.qty > 0 THEN m.qty ELSE 0 END) in_qty, SUM(CASE WHEN m.date >= ${F} AND (m.qty > 0 OR (m.qty = 0 AND m.value > 0)) THEN m.value ELSE 0 END) in_val,
      SUM(CASE WHEN m.date >= ${F} AND m.qty < 0 THEN -m.qty ELSE 0 END) out_qty, SUM(CASE WHEN m.date >= ${F} AND (m.qty < 0 OR (m.qty = 0 AND m.value < 0)) THEN -m.value ELSE 0 END) out_val,
      SUM(m.qty) closing_qty, SUM(m.value) closing_val, COUNT(*) FILTER (WHERE m.date >= ${F})::int moves
    FROM stock_moves m JOIN products p ON p.id=m.product_id JOIN warehouses w ON w.id=m.warehouse_id LEFT JOIN product_categories c ON c.id=p.category_id WHERE ${w.sql} GROUP BY ${gcols} ORDER BY ${keys.includes("name") ? "p.name" : "1"} LIMIT 5000`, w.params);
  const cols: Col[] = [...(keys.includes("sku") ? [{ key: "sku", label: "الرمز" }, { key: "name", label: "الصنف" }, { key: "unit", label: "الوحدة" }] : []), ...(keys.includes("category") ? [{ key: "category", label: "التصنيف" }] : []), ...(keys.includes("warehouse") ? [{ key: "warehouse", label: "المستودع" }] : []),
    { key: "openingQty", label: "رصيد أول المدة", type: "qty", sum: true }, { key: "openingVal", label: "قيمته", type: "money", sum: true }, { key: "inQty", label: "الوارد", type: "qty", sum: true }, { key: "inVal", label: "قيمة الوارد", type: "money", sum: true }, { key: "outQty", label: "الصادر", type: "qty", sum: true }, { key: "outVal", label: "قيمة الصادر", type: "money", sum: true }, { key: "closingQty", label: "رصيد آخر المدة", type: "qty", sum: true }, { key: "closingVal", label: "قيمته", type: "money", sum: true }, { key: "avgCost", label: "متوسط التكلفة", type: "money" }, { key: "moves", label: "الحركات", type: "int", sum: true }];
  return { columns: cols, rows: rows.map((r) => ({ ...r, avgCost: Number(r.closingQty) > 0 ? r2(Number(r.closingVal) / Number(r.closingQty)) : null })), meta: { from, to } };
};
IMPL["inv.moves"] = async (t, companyId, q) => {
  const w = moveWhere(companyId, q);
  const rows = await t.rows(`SELECT m.date, m.source_type, m.reference, m.source_id, p.sku, p.name, p.unit, w.name AS warehouse, c.name AS category, m.qty, m.unit_cost, m.value, m.balance_qty, m.balance_val FROM stock_moves m JOIN products p ON p.id=m.product_id JOIN warehouses w ON w.id=m.warehouse_id LEFT JOIN product_categories c ON c.id=p.category_id WHERE ${w.sql} ORDER BY m.date DESC, m.created_at DESC LIMIT 5000`, w.params);
  return { columns: [{ key: "date", label: "التاريخ", type: "date" }, { key: "type", label: "الحركة" }, { key: "reference", label: "المرجع" }, { key: "sku", label: "الرمز" }, { key: "name", label: "الصنف" }, { key: "category", label: "التصنيف" }, { key: "warehouse", label: "المستودع" }, { key: "inQty", label: "وارد", type: "qty", sum: true }, { key: "outQty", label: "صادر", type: "qty", sum: true }, { key: "unitCost", label: "تكلفة الوحدة", type: "money" }, { key: "value", label: "القيمة", type: "money", sum: true }, { key: "balanceQty", label: "رصيد الكمية", type: "qty" }, { key: "balanceVal", label: "رصيد القيمة", type: "money" }], rows: rows.map((r) => ({ ...r, type: MOVE_AR[r.sourceType] || r.sourceType, inQty: Number(r.qty) > 0 ? r2(r.qty) : 0, outQty: Number(r.qty) < 0 ? r2(-r.qty) : 0, _link: ["SALE", "SALE_RETURN", "PURCHASE", "PURCHASE_RETURN", "POS"].includes(r.sourceType) && r.sourceId ? `/doc/${r.sourceId}` : undefined })) };
};
IMPL["inv.by-warehouse"] = async (t, companyId, q) => {
  const w = new W("b.company_id=?", companyId);
  w.uuid("b.product_id", q.productId);
  const cats = list(q.categoryId).filter((x) => UUID.test(x)); if (cats.length) w.add("p.category_id = ANY(?::uuid[])", cats);
  branchViaWarehouse(w, q);
  w.like(["p.name", "p.sku"], q.q);
  const rows = await t.rows(`SELECT p.id, p.sku, p.name, p.unit, p.reorder_level, c.name AS category, w.name AS warehouse, b.qty, b.value FROM stock_balances b JOIN products p ON p.id=b.product_id JOIN warehouses w ON w.id=b.warehouse_id LEFT JOIN product_categories c ON c.id=p.category_id WHERE ${w.sql} ORDER BY p.name`, w.params);
  const whs = [...new Set(rows.map((r) => r.warehouse))].sort();
  const by = new Map<string, any>();
  for (const r of rows) { const x = by.get(r.id) || { sku: r.sku, name: r.name, unit: r.unit, category: r.category, reorderLevel: Number(r.reorderLevel), total: 0, value: 0 }; x["w_" + r.warehouse] = r2(Number(x["w_" + r.warehouse] || 0) + Number(r.qty)); x.total = r2(x.total + Number(r.qty)); x.value = r2(x.value + Number(r.value)); by.set(r.id, x); }
  let out = [...by.values()];
  if (q.nonzero === "1") out = out.filter((r) => Math.abs(r.total) > 0.0001);
  return { columns: [{ key: "sku", label: "الرمز" }, { key: "name", label: "الصنف" }, { key: "category", label: "التصنيف" }, { key: "unit", label: "الوحدة" }, ...whs.map((h) => ({ key: "w_" + h, label: h, type: "qty" as const, sum: true })), { key: "total", label: "الإجمالي", type: "qty", sum: true }, { key: "reorderLevel", label: "حد الطلب", type: "qty" }, { key: "value", label: "القيمة", type: "money", sum: true }], rows: out };
};
IMPL["inv.status"] = async (t, companyId, q) => {
  const days = Math.max(7, Number(q.days) || 90);
  const w = new W("p.company_id=?", companyId); w.raw("p.type='STOCK' AND p.is_active");
  const cats = list(q.categoryId).filter((x) => UUID.test(x)); if (cats.length) w.add("p.category_id = ANY(?::uuid[])", cats);
  w.like(["p.name", "p.sku"], q.q);
  const whIds = list(q.warehouseId).filter((x) => UUID.test(x));
  const whCond = whIds.length ? `AND b.warehouse_id = ANY('{${whIds.join(",")}}'::uuid[])` : q.branchId && UUID.test(q.branchId) ? `AND b.warehouse_id IN (SELECT id FROM warehouses WHERE branch_id='${q.branchId}'::uuid)` : "";
  const mvCond = whCond.replace(/b\.warehouse_id/g, "m.warehouse_id");
  const rows = await t.rows(`SELECT p.id, p.sku, p.name, p.unit, p.reorder_level, c.name AS category,
      COALESCE((SELECT SUM(b.qty) FROM stock_balances b WHERE b.product_id=p.id ${whCond}),0) qty, COALESCE((SELECT SUM(b.value) FROM stock_balances b WHERE b.product_id=p.id ${whCond}),0) value,
      COALESCE((SELECT SUM(-m.qty) FROM stock_moves m WHERE m.product_id=p.id AND m.source_type IN ('SALE','POS') AND m.date >= CURRENT_DATE - ${days} ${mvCond}),0) sold,
      (SELECT MAX(m.date) FROM stock_moves m WHERE m.product_id=p.id AND m.source_type IN ('SALE','POS') ${mvCond}) last_sale,
      (SELECT MAX(m.date) FROM stock_moves m WHERE m.product_id=p.id AND m.source_type='PURCHASE' ${mvCond}) last_purchase
    FROM products p LEFT JOIN product_categories c ON c.id=p.category_id WHERE ${w.sql} ORDER BY p.name`, w.params);
  let out = rows.map((r) => { const daily = Number(r.sold) / days; const qty = Number(r.qty); const cover = daily > 0 ? Math.round(qty / daily) : null; const state = qty <= 0 ? "OUT" : qty <= Number(r.reorderLevel) ? "LOW" : cover !== null && cover > 180 ? "EXCESS" : "OK"; return { ...r, qty: r2(qty), sold: r2(r.sold), dailyAvg: r2(daily), coverDays: cover, state, stateAr: ({ OUT: "نافد", LOW: "منخفض", EXCESS: "فائض", OK: "جيد" } as any)[state] }; });
  if (q.stockState) out = out.filter((r) => list(q.stockState).includes(r.state));
  return { columns: [{ key: "sku", label: "الرمز" }, { key: "name", label: "الصنف" }, { key: "category", label: "التصنيف" }, { key: "qty", label: "الرصيد", type: "qty", sum: true }, { key: "reorderLevel", label: "حد الطلب", type: "qty" }, { key: "value", label: "القيمة", type: "money", sum: true }, { key: "sold", label: `مبيعات ${days} يوم`, type: "qty", sum: true }, { key: "dailyAvg", label: "متوسط يومي", type: "qty" }, { key: "coverDays", label: "أيام التغطية", type: "int" }, { key: "lastSale", label: "آخر بيع", type: "date" }, { key: "lastPurchase", label: "آخر شراء", type: "date" }, { key: "stateAr", label: "الحالة" }], rows: out, meta: { days } };
};
IMPL["inv.dead-stock"] = async (t, companyId, q) => {
  const days = Math.max(7, Number(q.days) || 90);
  const r = await IMPL["inv.status"](t, companyId, { ...q, days });
  const cutoff = addDays(today(), -days);
  const rows = r.rows.filter((x) => Number(x.qty) > 0 && (!x.lastSale || String(x.lastSale).slice(0, 10) < cutoff)).map((x) => ({ ...x, idleDays: x.lastSale ? Math.round((Date.parse(today()) - Date.parse(String(x.lastSale).slice(0, 10))) / 864e5) : null }));
  return { columns: [{ key: "sku", label: "الرمز" }, { key: "name", label: "الصنف" }, { key: "category", label: "التصنيف" }, { key: "qty", label: "الرصيد", type: "qty", sum: true }, { key: "value", label: "القيمة المجمّدة", type: "money", sum: true }, { key: "lastSale", label: "آخر بيع", type: "date" }, { key: "idleDays", label: "أيام بلا بيع", type: "int" }, { key: "lastPurchase", label: "آخر شراء", type: "date" }], rows, meta: { days } };
};
IMPL["inv.turnover"] = async (t, companyId, q) => {
  const { from, to } = period(q);
  const g = q.groupBy || "product";
  const w = new W("m.company_id=?", companyId);
  w.add("m.date <= ?", to).uuids("m.warehouse_id", q.warehouseId);
  const cats = list(q.categoryId).filter((x) => UUID.test(x)); if (cats.length) w.add("p.category_id = ANY(?::uuid[])", cats);
  branchViaWarehouse(w, q);
  w.params.push(from); const F = `$${w.params.length}`;
  const sel = g === "category" ? "COALESCE(c.name,'بدون تصنيف') AS name" : "p.sku, p.name";
  const grp = g === "category" ? "1" : "p.id";
  const rows = await t.rows(`SELECT ${sel}, SUM(CASE WHEN m.date < ${F} THEN m.value ELSE 0 END) opening, SUM(m.value) closing, SUM(CASE WHEN m.date >= ${F} AND m.source_type IN ('SALE','POS','SALE_RETURN') THEN -m.value ELSE 0 END) cogs, SUM(CASE WHEN m.date >= ${F} AND m.source_type IN ('SALE','POS','SALE_RETURN') THEN -m.qty ELSE 0 END) sold_qty
    FROM stock_moves m JOIN products p ON p.id=m.product_id JOIN warehouses w ON w.id=m.warehouse_id LEFT JOIN product_categories c ON c.id=p.category_id WHERE ${w.sql} GROUP BY ${grp} ORDER BY cogs DESC`, w.params);
  const pdays = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1);
  const out = rows.map((r) => { const avg = (Number(r.opening) + Number(r.closing)) / 2; const turns = avg > 0 ? r2(Number(r.cogs) / avg) : null; return { ...r, avgInventory: r2(avg), turns, days: turns && turns > 0 ? Math.round(pdays / turns) : null }; });
  return { columns: [...(g === "category" ? [{ key: "name", label: "التصنيف" }] : [{ key: "sku", label: "الرمز" }, { key: "name", label: "الصنف" }]), { key: "opening", label: "مخزون أول المدة", type: "money", sum: true }, { key: "closing", label: "مخزون آخر المدة", type: "money", sum: true }, { key: "avgInventory", label: "المتوسط", type: "money", sum: true }, { key: "soldQty", label: "الكمية المباعة", type: "qty", sum: true }, { key: "cogs", label: "تكلفة المبيعات", type: "money", sum: true }, { key: "turns", label: "معدل الدوران", type: "qty" }, { key: "days", label: "أيام الدوران", type: "int" }], rows: out, meta: { periodDays: pdays } };
};
IMPL["inv.adjustments"] = async (t, companyId, q) => {
  const { from, to } = period(q);
  const w = new W("a.company_id=?", companyId); w.range("a.date", from, to).uuids("a.warehouse_id", q.warehouseId).in("a.kind", q.adjKind); branchViaWarehouse(w, q); w.like(["a.number", "a.notes", "a.lines::text"], q.q);
  const rows = await t.rows(`SELECT a.id, a.number, a.date, a.kind, w.name AS warehouse, w2.name AS to_warehouse, a.notes, a.total_value, jsonb_array_length(a.lines) items, (SELECT string_agg((l->>'name')||' ('||(l->>'qty')||')', '، ') FROM jsonb_array_elements(a.lines) l) detail FROM stock_adjustments a JOIN warehouses w ON w.id=a.warehouse_id LEFT JOIN warehouses w2 ON w2.id=a.to_warehouse WHERE ${w.sql} ORDER BY a.date DESC LIMIT 2000`, w.params);
  return { columns: [{ key: "number", label: "الرقم" }, { key: "date", label: "التاريخ", type: "date" }, { key: "kindAr", label: "النوع" }, { key: "warehouse", label: "المستودع" }, { key: "toWarehouse", label: "إلى مستودع" }, { key: "items", label: "الأصناف", type: "int", sum: true }, { key: "detail", label: "التفصيل" }, { key: "totalValue", label: "أثر القيمة", type: "money", sum: true }, { key: "notes", label: "ملاحظات" }], rows: rows.map((r) => ({ ...r, kindAr: ({ COUNT: "جرد", OPENING: "رصيد افتتاحي", TRANSFER: "تحويل" } as any)[r.kind] || r.kind })) };
};
IMPL["inv.valuation-category"] = async (t, companyId, q) => {
  const g = q.groupBy || "category";
  const w = new W("b.company_id=?", companyId); w.uuids("b.warehouse_id", q.warehouseId); branchViaWarehouse(w, q);
  const sel = g === "category" ? "COALESCE(c.name,'بدون تصنيف') AS category" : g === "warehouse" ? "w.name AS warehouse" : "COALESCE(c.name,'بدون تصنيف') AS category, w.name AS warehouse";
  const rows = await t.rows(`SELECT ${sel}, COUNT(DISTINCT p.id)::int products, SUM(b.qty) qty, SUM(b.value) value, SUM(b.qty*p.sale_price) retail FROM stock_balances b JOIN products p ON p.id=b.product_id JOIN warehouses w ON w.id=b.warehouse_id LEFT JOIN product_categories c ON c.id=p.category_id WHERE ${w.sql} GROUP BY ${g === "categoryWarehouse" ? "1,2" : "1"} ORDER BY value DESC`, w.params);
  const out = rows.map((r) => ({ ...r, margin: r2(Number(r.retail) - Number(r.value)), marginPct: pct(Number(r.retail) - Number(r.value), Number(r.retail)) }));
  const tot = totalsOf([{ key: "value", label: "", sum: true }, { key: "retail", label: "", sum: true }, { key: "margin", label: "", sum: true }, { key: "qty", label: "", sum: true }, { key: "products", label: "", sum: true }], out);
  return { columns: [...(g !== "warehouse" ? [{ key: "category", label: "التصنيف" }] : []), ...(g !== "category" ? [{ key: "warehouse", label: "المستودع" }] : []), { key: "products", label: "الأصناف", type: "int", sum: true }, { key: "qty", label: "الكمية", type: "qty", sum: true }, { key: "value", label: "القيمة بالتكلفة", type: "money", sum: true }, { key: "retail", label: "قيمة البيع", type: "money", sum: true }, { key: "margin", label: "الهامش المتوقع", type: "money", sum: true }, { key: "marginPct", label: "الهامش %", type: "pct" }, { key: "share", label: "النسبة من المخزون %", type: "pct" }], rows: out.map((r) => ({ ...r, share: pct(Number(r.value), tot.value) })), totals: { ...tot, marginPct: pct(tot.margin, tot.retail), share: 100 } };
};

// ── POS ─────────────────────────────────────────────────────
IMPL["pos.sessions"] = async (t, companyId, q) => {
  const { from, to } = period(q);
  const w = new W("s.company_id=?", companyId); w.add("s.opened_at::date >= ?", from).add("s.opened_at::date <= ?", to).uuids("s.warehouse_id", q.warehouseId).in("s.status", q.sessionStatus);
  if (q.user) w.add("s.user_name=?", q.user);
  if (q.branchId && UUID.test(q.branchId)) w.add("s.warehouse_id IN (SELECT id FROM warehouses WHERE branch_id=?::uuid)", q.branchId);
  const g = q.groupBy || "none";
  if (g === "none") {
    const rows = await t.rows(`SELECT s.number, s.user_name, w.name AS warehouse, s.opened_at, s.closed_at, s.status, s.orders_count, s.opening_cash, s.cash_sales, s.card_sales, s.returns_total, s.expected_cash, s.counted_cash, s.difference, EXTRACT(EPOCH FROM (COALESCE(s.closed_at, now()) - s.opened_at))/3600 hours FROM pos_sessions s LEFT JOIN warehouses w ON w.id=s.warehouse_id WHERE ${w.sql} ORDER BY s.opened_at DESC LIMIT 2000`, w.params);
    return { columns: [{ key: "number", label: "الوردية" }, { key: "userName", label: "الكاشير" }, { key: "warehouse", label: "المستودع" }, { key: "openedAt", label: "الفتح", type: "datetime" }, { key: "closedAt", label: "الإغلاق", type: "datetime" }, { key: "hours", label: "الساعات", type: "qty" }, { key: "ordersCount", label: "الطلبات", type: "int", sum: true }, { key: "openingCash", label: "نقدية افتتاحية", type: "money", sum: true }, { key: "cashSales", label: "مبيعات نقدية", type: "money", sum: true }, { key: "cardSales", label: "شبكة", type: "money", sum: true }, { key: "returnsTotal", label: "مرتجعات", type: "money", sum: true }, { key: "expectedCash", label: "المتوقع", type: "money", sum: true }, { key: "countedCash", label: "المعدود", type: "money", sum: true }, { key: "difference", label: "الفرق", type: "money", sum: true }, { key: "statusAr", label: "الحالة" }], rows: rows.map((r) => ({ ...r, hours: r2(r.hours), statusAr: STATUS_AR[r.status] || r.status })) };
  }
  const gk = g === "user" ? "s.user_name" : g === "warehouse" ? "w.name" : "(s.opened_at AT TIME ZONE 'Asia/Riyadh')::date::text";
  const rows = await t.rows(`SELECT ${gk} AS grp, COUNT(*)::int sessions, SUM(s.orders_count)::int orders, SUM(s.cash_sales) cash_sales, SUM(s.card_sales) card_sales, SUM(s.returns_total) returns_total, SUM(s.difference) difference, AVG(EXTRACT(EPOCH FROM (COALESCE(s.closed_at, now()) - s.opened_at))/3600) avg_hours FROM pos_sessions s LEFT JOIN warehouses w ON w.id=s.warehouse_id WHERE ${w.sql} GROUP BY 1 ORDER BY 1`, w.params);
  return { columns: [{ key: "grp", label: g === "user" ? "الكاشير" : g === "warehouse" ? "المستودع" : "اليوم" }, { key: "sessions", label: "الورديات", type: "int", sum: true }, { key: "orders", label: "الطلبات", type: "int", sum: true }, { key: "cashSales", label: "نقدي", type: "money", sum: true }, { key: "cardSales", label: "شبكة", type: "money", sum: true }, { key: "returnsTotal", label: "مرتجعات", type: "money", sum: true }, { key: "total", label: "الإجمالي", type: "money", sum: true }, { key: "avgTicket", label: "متوسط الطلب", type: "money" }, { key: "difference", label: "فرق العدّ", type: "money", sum: true }, { key: "avgHours", label: "متوسط ساعات الوردية", type: "qty" }], rows: rows.map((r) => ({ ...r, total: r2(Number(r.cashSales) + Number(r.cardSales)), avgTicket: r.orders ? r2((Number(r.cashSales) + Number(r.cardSales)) / r.orders) : 0, avgHours: r2(r.avgHours) })) };
};
IMPL["pos.hourly"] = async (t, companyId, q) => {
  const w = docWhere(companyId, { ...q, channel: "POS", status: "POSTED", kind: "INVOICE,CREDIT_NOTE" });
  const rows = await t.rows(`SELECT EXTRACT(HOUR FROM i.issued_at AT TIME ZONE 'Asia/Riyadh')::int AS hour, COUNT(*) FILTER (WHERE i.kind='INVOICE')::int docs, SUM(i.total*${SIGN}) total, SUM(i.taxable*${SIGN}) net FROM invoices i WHERE ${w.sql} GROUP BY 1 ORDER BY 1`, w.params);
  const by = new Map(rows.map((r) => [r.hour, r]));
  const out = Array.from({ length: 24 }, (_, h) => { const r: any = by.get(h) || { docs: 0, total: 0, net: 0 }; return { hour: `${String(h).padStart(2, "0")}:00`, docs: r.docs, total: r2(r.total), net: r2(r.net), avgTicket: r.docs ? r2(Number(r.total) / r.docs) : 0 }; });
  const tot = sum(out, "total");
  return { columns: [{ key: "hour", label: "الساعة" }, { key: "docs", label: "الفواتير", type: "int", sum: true }, { key: "net", label: "قبل الضريبة", type: "money", sum: true }, { key: "total", label: "الإجمالي", type: "money", sum: true }, { key: "avgTicket", label: "متوسط الفاتورة", type: "money" }, { key: "share", label: "النسبة %", type: "pct" }], rows: out.map((r) => ({ ...r, share: pct(r.total, tot) })) };
};
IMPL["pos.tenders"] = async (t, companyId, q) => {
  const w = docWhere(companyId, { ...q, channel: "POS", status: "POSTED", kind: "INVOICE" });
  const g = q.groupBy || "method";
  const gk = g === "day" ? "i.date::text" : g === "month" ? "to_char(i.date,'YYYY-MM')" : g === "user" ? "i.created_by" : "e->>'method'";
  const rows = await t.rows(`SELECT ${gk} AS grp, ${g === "method" ? "" : "e->>'method' AS method, "}COUNT(DISTINCT i.id)::int docs, SUM(COALESCE((e->>'amount')::numeric, i.total)) amount FROM invoices i, jsonb_array_elements(COALESCE(NULLIF(i.tenders,'[]'::jsonb), '[{"method":"CREDIT"}]'::jsonb)) e WHERE ${w.sql} GROUP BY 1${g === "method" ? "" : ",2"} ORDER BY 1`, w.params);
  const out = rows.map((r) => ({ ...r, grp: g === "method" ? METHOD_AR[r.grp] || r.grp : r.grp, method: r.method ? METHOD_AR[r.method] || r.method : undefined }));
  const tot = sum(out, "amount");
  return { columns: [{ key: "grp", label: g === "day" ? "اليوم" : g === "month" ? "الشهر" : g === "user" ? "الكاشير" : "طريقة الدفع" }, ...(g !== "method" ? [{ key: "method", label: "طريقة الدفع" }] : []), { key: "docs", label: "الفواتير", type: "int", sum: true }, { key: "amount", label: "المبلغ", type: "money", sum: true }, { key: "share", label: "النسبة %", type: "pct" }], rows: out.map((r) => ({ ...r, share: pct(Number(r.amount), tot) })) };
};

// ── treasury ────────────────────────────────────────────────
IMPL["cash.balances"] = async (t, companyId, q) => {
  const { from, to } = period(q);
  const B = q.branchId && UUID.test(q.branchId) ? ` AND e.branch_id='${q.branchId}'::uuid` : "";
  const rows = await t.rows(`SELECT a.id, a.code, a.name_ar, a.subtype,
      COALESCE(SUM(CASE WHEN e.date < $2 THEN l.debit-l.credit END),0) opening, COALESCE(SUM(CASE WHEN e.date BETWEEN $2 AND $3 THEN l.debit END),0) inflow, COALESCE(SUM(CASE WHEN e.date BETWEEN $2 AND $3 THEN l.credit END),0) outflow, COUNT(l.id) FILTER (WHERE e.date BETWEEN $2 AND $3)::int moves
    FROM accounts a LEFT JOIN journal_lines l ON l.account_id=a.id LEFT JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED' AND e.date <= $3${B}
    WHERE a.company_id=$1 AND a.is_cash_bank AND NOT a.is_group GROUP BY a.id ORDER BY a.code`, [companyId, from, to]);
  return { columns: [{ key: "code", label: "الرقم" }, { key: "nameAr", label: "الحساب" }, { key: "kind", label: "النوع" }, { key: "opening", label: "رصيد أول المدة", type: "money", sum: true }, { key: "inflow", label: "المقبوضات", type: "money", sum: true }, { key: "outflow", label: "المدفوعات", type: "money", sum: true }, { key: "closing", label: "رصيد آخر المدة", type: "money", sum: true }, { key: "moves", label: "الحركات", type: "int", sum: true }], rows: rows.map((r) => ({ ...r, kind: SUBTYPE_AR[r.subtype] || r.subtype, opening: r2(r.opening), inflow: r2(r.inflow), outflow: r2(r.outflow), closing: r2(Number(r.opening) + Number(r.inflow) - Number(r.outflow)), _link: `/accounts?q=${r.code}` })) };
};
function lineWhere(companyId: string, q: any) {
  const { from, to } = period(q);
  const w = new W("l.company_id=?", companyId); w.raw("e.status='POSTED'").range("e.date", from, to).uuid("e.branch_id", q.branchId).uuids("l.account_id", q.accountId).uuid("l.partner_id", q.partnerId).uuid("l.cost_center_id", q.costCenterId).in("e.type", q.entryType);
  if (q.accountType) w.in("a.type", q.accountType);
  if (q.subtype) w.in("a.subtype", q.subtype);
  if (q.user) w.add("e.created_by=?", q.user);
  w.like(["e.number", "e.memo", "e.reference", "l.description", "pr.name", "a.name_ar", "a.code"], q.q);
  return w;
}
const LINE_FROM = "FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id LEFT JOIN partners pr ON pr.id=l.partner_id LEFT JOIN cost_centers cc ON cc.id=l.cost_center_id LEFT JOIN branches b ON b.id=e.branch_id";
IMPL["fin.ledger"] = async (t, companyId, q) => {
  const w = lineWhere(companyId, q);
  const g = q.groupBy || "none";
  if (g === "none") {
    const rows = await t.rows(`SELECT e.id AS entry_id, e.number, e.date, e.type, e.memo, e.reference, e.source_type, e.source_id, a.code, a.name_ar, pr.name AS partner, cc.name AS cost_center, b.name AS branch, l.description, l.debit, l.credit, e.created_by ${LINE_FROM} WHERE ${w.sql} ORDER BY e.date, e.created_at, l.sort LIMIT 10000`, w.params);
    const single = list(q.accountId).length === 1;
    let bal = 0;
    if (single) { const ob = await t.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id=$1::uuid AND e.status='POSTED' AND e.date < $2${q.branchId && UUID.test(q.branchId) ? ` AND e.branch_id='${q.branchId}'::uuid` : ""}`, [q.accountId, period(q).from]); bal = Number(ob.b); }
    const out = rows.map((r) => { bal += Number(r.debit) - Number(r.credit); return { ...r, typeAr: JTYPE_AR[r.type] || r.type, balance: single ? r2(bal) : null, _link: r.sourceType === "INVOICE" && r.sourceId ? `/doc/${r.sourceId}` : `/journals?q=${r.number}` }; });
    return { columns: [{ key: "date", label: "التاريخ", type: "date" }, { key: "number", label: "القيد" }, { key: "typeAr", label: "النوع" }, { key: "code", label: "الحساب" }, { key: "nameAr", label: "اسم الحساب" }, { key: "description", label: "البيان" }, { key: "memo", label: "بيان القيد" }, { key: "partner", label: "الطرف" }, { key: "costCenter", label: "مركز التكلفة" }, { key: "branch", label: "الفرع" }, { key: "reference", label: "المرجع" }, { key: "debit", label: "مدين", type: "money", sum: true }, { key: "credit", label: "دائن", type: "money", sum: true }, ...(single ? [{ key: "balance", label: "الرصيد", type: "money" } as Col] : []), { key: "createdBy", label: "المستخدم" }], rows: out, meta: { openingBalance: single ? rows.length ? r2(bal - out.reduce((a, r) => a + Number(r.debit) - Number(r.credit), 0)) : bal : null } };
  }
  const G: Record<string, string> = { account: "a.code || ' ' || a.name_ar", partner: "COALESCE(pr.name,'بدون طرف')", costCenter: "COALESCE(cc.name,'غير موزع')", entryType: "e.type", month: "to_char(e.date,'YYYY-MM')" };
  const rows = await t.rows(`SELECT ${G[g] || G.account} AS grp, COUNT(DISTINCT e.id)::int entries, COUNT(*)::int lines, SUM(l.debit) debit, SUM(l.credit) credit ${LINE_FROM} WHERE ${w.sql} GROUP BY 1 ORDER BY 1`, w.params);
  return { columns: [{ key: "grp", label: ({ account: "الحساب", partner: "الطرف", costCenter: "مركز التكلفة", entryType: "نوع القيد", month: "الشهر" } as any)[g] }, { key: "entries", label: "القيود", type: "int", sum: true }, { key: "lines", label: "السطور", type: "int", sum: true }, { key: "debit", label: "مدين", type: "money", sum: true }, { key: "credit", label: "دائن", type: "money", sum: true }, { key: "net", label: "الصافي (مدين−دائن)", type: "money", sum: true }], rows: rows.map((r) => ({ ...r, grp: g === "entryType" ? JTYPE_AR[r.grp] || r.grp : r.grp, net: r2(Number(r.debit) - Number(r.credit)) })) };
};
IMPL["cash.movement"] = async (t, companyId, q) => {
  const r = await IMPL["fin.ledger"](t, companyId, { ...q, groupBy: q.groupBy === "day" ? "none" : q.groupBy, subtype: "CASH,BANK" });
  if (q.groupBy !== "day") return r;
  const by = new Map<string, any>();
  for (const x of r.rows) { const d = String(x.date).slice(0, 10); const o = by.get(d) || { grp: d, lines: 0, debit: 0, credit: 0 }; o.lines++; o.debit = r2(o.debit + Number(x.debit)); o.credit = r2(o.credit + Number(x.credit)); by.set(d, o); }
  return { columns: [{ key: "grp", label: "اليوم" }, { key: "lines", label: "الحركات", type: "int", sum: true }, { key: "debit", label: "مقبوضات", type: "money", sum: true }, { key: "credit", label: "مدفوعات", type: "money", sum: true }, { key: "net", label: "الصافي", type: "money", sum: true }], rows: [...by.values()].map((x) => ({ ...x, net: r2(x.debit - x.credit) })) };
};
function voucherWhere(companyId: string, q: any) {
  const { from, to } = period(q);
  const w = new W("p.company_id=?", companyId); w.range("p.date", from, to).in("p.direction", q.direction).uuid("p.partner_id", q.partnerId).in("p.method", q.method).uuids("p.account_id", q.accountId).in("p.status", q.status);
  if (q.currency) w.in("p.currency", q.currency);
  if (q.user) w.add("p.created_by=?", q.user);
  if (q.branchId && UUID.test(q.branchId)) w.add("EXISTS (SELECT 1 FROM journal_entries je WHERE je.id=p.journal_id AND je.branch_id=?::uuid)", q.branchId);
  w.like(["p.number", "pr.name", "p.reference", "p.notes"], q.q);
  return w;
}
const V_FROM = "FROM payments p JOIN partners pr ON pr.id=p.partner_id JOIN accounts a ON a.id=p.account_id";
IMPL["cash.vouchers"] = async (t, companyId, q) => {
  const w = voucherWhere(companyId, q);
  const rows = await t.rows(`SELECT p.number, p.direction, p.date, pr.name AS partner, p.method, a.code || ' ' || a.name_ar AS account, p.amount, p.allocated, p.currency, p.fc_amount, p.fx_diff, p.reference, p.notes, p.status, p.created_by, jsonb_array_length(COALESCE(p.allocations,'[]'::jsonb)) invoices ${V_FROM} WHERE ${w.sql} ORDER BY p.date DESC, p.created_at DESC LIMIT 5000`, w.params);
  return { columns: [{ key: "number", label: "الرقم" }, { key: "dirAr", label: "النوع" }, { key: "date", label: "التاريخ", type: "date" }, { key: "partner", label: "الطرف" }, { key: "methodAr", label: "الطريقة" }, { key: "account", label: "الصندوق/البنك" }, { key: "amount", label: "المبلغ", type: "money", sum: true }, { key: "allocated", label: "المخصص للفواتير", type: "money", sum: true }, { key: "invoices", label: "الفواتير", type: "int" }, { key: "currency", label: "العملة" }, { key: "fcAmount", label: "بالعملة", type: "money" }, { key: "reference", label: "المرجع" }, { key: "notes", label: "البيان" }, { key: "statusAr", label: "الحالة" }, { key: "createdBy", label: "المستخدم" }], rows: rows.map((r) => ({ ...r, dirAr: r.direction === "IN" ? "قبض" : "صرف", methodAr: METHOD_AR[r.method] || r.method, statusAr: STATUS_AR[r.status] || r.status, _link: `/${r.direction === "IN" ? "receipts" : "vouchers"}?q=${r.number}` })) };
};
IMPL["cash.vouchers-summary"] = async (t, companyId, q) => {
  const w = voucherWhere(companyId, { ...q, status: q.status || "POSTED" });
  const g = q.groupBy || "method";
  const G: Record<string, string> = { method: "p.method", account: "a.code || ' ' || a.name_ar", partner: "pr.name", month: "to_char(p.date,'YYYY-MM')", day: "p.date::text", user: "p.created_by", direction: "p.direction" };
  const rows = await t.rows(`SELECT ${G[g] || G.method} AS grp, COUNT(*)::int vouchers, SUM(p.amount) FILTER (WHERE p.direction='IN') received, SUM(p.amount) FILTER (WHERE p.direction='OUT') paid, SUM(p.amount) amount, SUM(p.allocated) allocated ${V_FROM} WHERE ${w.sql} GROUP BY 1 ORDER BY amount DESC`, w.params);
  const single = list(q.direction).length === 1;
  return { columns: [{ key: "grp", label: ({ method: "طريقة الدفع", account: "الصندوق/البنك", partner: "الطرف", month: "الشهر", day: "اليوم", user: "المستخدم", direction: "الاتجاه" } as any)[g] }, { key: "vouchers", label: "السندات", type: "int", sum: true }, ...(single ? [] : [{ key: "received", label: "مقبوضات", type: "money", sum: true } as Col, { key: "paid", label: "مدفوعات", type: "money", sum: true } as Col]), { key: "amount", label: single ? "المبلغ" : "الإجمالي", type: "money", sum: true }, { key: "allocated", label: "المخصص للفواتير", type: "money", sum: true }, { key: "onAccount", label: "دفعات على الحساب", type: "money", sum: true }], rows: rows.map((r) => ({ ...r, grp: g === "method" ? METHOD_AR[r.grp] || r.grp : g === "direction" ? (r.grp === "IN" ? "قبض" : "صرف") : r.grp, received: r2(r.received), paid: r2(r.paid), onAccount: r2(Number(r.amount) - Number(r.allocated)) })) };
};
IMPL["cash.cheques"] = async (t, companyId, q) => {
  const w = new W("c.company_id=?", companyId); w.range("c.due_date", q.dueFrom, q.dueTo).in("c.direction", q.direction).in("c.status", q.chequeStatus).uuid("c.partner_id", q.partnerId).like(["c.cheque_no", "c.bank_name", "pr.name", "c.notes"], q.q);
  const rows = await t.rows(`SELECT c.direction, c.cheque_no, c.bank_name, pr.name AS partner, c.amount, c.received_date, c.due_date, c.status, a.name_ar AS bank_account, c.notes, (c.due_date - CURRENT_DATE) days_to_due FROM cheques c JOIN partners pr ON pr.id=c.partner_id LEFT JOIN accounts a ON a.id=c.bank_account_id WHERE ${w.sql} ORDER BY c.due_date LIMIT 2000`, w.params);
  const ST: Record<string, string> = { PENDING: "قيد التحصيل/لم يُصرف", DEPOSITED: "مودع", CLEARED: "محصّل/مصروف", BOUNCED: "مرتجع", CANCELLED: "ملغى" };
  return { columns: [{ key: "dirAr", label: "النوع" }, { key: "chequeNo", label: "رقم الشيك" }, { key: "bankName", label: "البنك" }, { key: "partner", label: "الطرف" }, { key: "amount", label: "المبلغ", type: "money", sum: true }, { key: "receivedDate", label: "الاستلام/الإصدار", type: "date" }, { key: "dueDate", label: "الاستحقاق", type: "date" }, { key: "daysToDue", label: "أيام للاستحقاق", type: "int" }, { key: "statusAr", label: "الحالة" }, { key: "bankAccount", label: "حساب البنك" }, { key: "notes", label: "ملاحظات" }], rows: rows.map((r) => ({ ...r, dirAr: r.direction === "IN" ? "مستلم" : "صادر", statusAr: ST[r.status] || r.status })) };
};
IMPL["cash.fx"] = async (t, companyId, q) => {
  const w = voucherWhere(companyId, { ...q, status: "POSTED" }); w.raw("p.currency <> 'SAR'");
  const rows = await t.rows(`SELECT p.number, p.direction, p.date, pr.name AS partner, p.currency, p.fc_amount, p.exchange_rate, p.amount, p.fx_diff ${V_FROM} WHERE ${w.sql} ORDER BY p.date DESC`, w.params);
  return { columns: [{ key: "number", label: "السند" }, { key: "dirAr", label: "النوع" }, { key: "date", label: "التاريخ", type: "date" }, { key: "partner", label: "الطرف" }, { key: "currency", label: "العملة" }, { key: "fcAmount", label: "المبلغ بالعملة", type: "money", sum: true }, { key: "exchangeRate", label: "سعر الصرف", type: "qty" }, { key: "amount", label: "المعادل بالريال", type: "money", sum: true }, { key: "fxDiff", label: "فرق العملة (+ربح/−خسارة)", type: "money", sum: true }], rows: rows.map((r) => ({ ...r, dirAr: r.direction === "IN" ? "قبض" : "صرف" })) };
};

// ── expenses ────────────────────────────────────────────────
function expWhere(companyId: string, q: any) {
  const { from, to } = period(q);
  const w = new W("x.company_id=?", companyId); w.range("x.date", from, to).uuids("x.account_id", q.accountId).uuid("x.cost_center_id", q.costCenterId).uuid("x.partner_id", q.partnerId).in("x.status", q.status);
  if (q.payType === "CREDIT") w.raw("x.pay_account_id IS NULL"); if (q.payType === "NOW") w.raw("x.pay_account_id IS NOT NULL");
  if (q.user) w.add("x.created_by=?", q.user);
  if (q.branchId && UUID.test(q.branchId)) w.add("EXISTS (SELECT 1 FROM journal_entries je WHERE je.id=x.journal_id AND je.branch_id=?::uuid)", q.branchId);
  w.like(["x.number", "x.description", "x.payee", "x.supplier_ref"], q.q);
  return w;
}
const X_FROM = "FROM expenses x JOIN accounts a ON a.id=x.account_id LEFT JOIN accounts pa ON pa.id=x.pay_account_id LEFT JOIN cost_centers cc ON cc.id=x.cost_center_id LEFT JOIN partners pr ON pr.id=x.partner_id LEFT JOIN journal_entries je ON je.id=x.journal_id LEFT JOIN branches b ON b.id=je.branch_id";
IMPL["exp.register"] = async (t, companyId, q) => {
  const w = expWhere(companyId, q);
  const rows = await t.rows(`SELECT x.number, x.date, a.code || ' ' || a.name_ar AS account, x.description, x.payee, pr.name AS supplier, x.supplier_ref, x.tax_code, x.amount, x.vat_amount, x.total, COALESCE(pa.name_ar, 'آجل') AS paid_from, cc.name AS cost_center, b.name AS branch, x.status, x.created_by ${X_FROM} WHERE ${w.sql} ORDER BY x.date DESC LIMIT 5000`, w.params);
  return { columns: [{ key: "number", label: "الرقم" }, { key: "date", label: "التاريخ", type: "date" }, { key: "account", label: "حساب المصروف" }, { key: "description", label: "البيان" }, { key: "payee", label: "المستفيد" }, { key: "supplier", label: "المورد" }, { key: "supplierRef", label: "فاتورة المورد" }, { key: "taxCode", label: "الضريبة" }, { key: "amount", label: "قبل الضريبة", type: "money", sum: true }, { key: "vatAmount", label: "الضريبة", type: "money", sum: true }, { key: "total", label: "الإجمالي", type: "money", sum: true }, { key: "paidFrom", label: "الدفع من" }, { key: "costCenter", label: "مركز التكلفة" }, { key: "branch", label: "الفرع" }, { key: "statusAr", label: "الحالة" }, { key: "createdBy", label: "المستخدم" }], rows: rows.map((r) => ({ ...r, statusAr: STATUS_AR[r.status] || r.status, _link: `/expenses?q=${r.number}` })) };
};
IMPL["exp.summary"] = async (t, companyId, q) => {
  const w = expWhere(companyId, { ...q, status: q.status || "POSTED" });
  const g = q.groupBy || "account";
  const G: Record<string, string> = { account: "a.code || ' ' || a.name_ar", costCenter: "COALESCE(cc.name,'غير موزع')", month: "to_char(x.date,'YYYY-MM')", payee: "COALESCE(NULLIF(x.payee,''), pr.name, '—')", branch: "COALESCE(b.name,'—')", payType: "CASE WHEN x.pay_account_id IS NULL THEN 'آجل' ELSE 'نقدي/بنك' END", user: "x.created_by" };
  const rows = await t.rows(`SELECT ${G[g] || G.account} AS grp, COUNT(*)::int docs, SUM(x.amount) amount, SUM(x.vat_amount) vat, SUM(x.total) total ${X_FROM} WHERE ${w.sql} GROUP BY 1 ORDER BY amount DESC`, w.params);
  const tot = sum(rows, "amount");
  return { columns: [{ key: "grp", label: ({ account: "الحساب", costCenter: "مركز التكلفة", month: "الشهر", payee: "المستفيد", branch: "الفرع", payType: "طريقة الدفع", user: "المستخدم" } as any)[g] }, { key: "docs", label: "المصروفات", type: "int", sum: true }, { key: "amount", label: "قبل الضريبة", type: "money", sum: true }, { key: "vat", label: "الضريبة", type: "money", sum: true }, { key: "total", label: "الإجمالي", type: "money", sum: true }, { key: "share", label: "النسبة %", type: "pct" }], rows: rows.map((r) => ({ ...r, share: pct(Number(r.amount), tot) })) };
};
IMPL["exp.monthly"] = async (t, companyId, q) => {
  const { from, to } = period(q);
  const months = monthsBetween(from, to);
  const w = lineWhere(companyId, { ...q, from: months[0] + "-01", to, accountType: "EXPENSE" });
  const rows = await t.rows(`SELECT a.code, a.name_ar, to_char(e.date,'YYYY-MM') m, SUM(l.debit-l.credit) amt ${LINE_FROM} WHERE ${w.sql} AND e.type <> 'CLOSING' GROUP BY a.id, 3 ORDER BY a.code`, w.params);
  const by = new Map<string, any>();
  for (const r of rows) { const x = by.get(r.code) || { code: r.code, nameAr: r.nameAr, total: 0 }; x["m_" + r.m] = r2(Number(x["m_" + r.m] || 0) + Number(r.amt)); x.total = r2(x.total + Number(r.amt)); by.set(r.code, x); }
  return { columns: [{ key: "code", label: "الرقم" }, { key: "nameAr", label: "الحساب" }, ...months.map((m) => ({ key: "m_" + m, label: m, type: "money" as const, sum: true })), { key: "total", label: "الإجمالي", type: "money", sum: true }], rows: [...by.values()] };
};

// ── HR ──────────────────────────────────────────────────────
const PAY_FROM = `FROM payroll_runs r, jsonb_array_elements(r.lines) l JOIN employees em ON em.id::text = l->>'employeeId'`;
function payWhere(companyId: string, q: any) {
  const { from, to } = period(q);
  const w = new W("r.company_id=?", companyId); w.add("r.period >= ?", from.slice(0, 7)).add("r.period <= ?", to.slice(0, 7)).in("r.status", q.payrollStatus); if (q.department) w.in("em.department", q.department); if (q.nationality) w.in("em.nationality", q.nationality); w.uuid("em.id", q.employeeId); w.like(["em.name", "em.code", "em.job_title"], q.q);
  return w;
}
const NAT: Record<string, string> = { SAUDI: "سعودي", NON_SAUDI: "غير سعودي" };
const PS: Record<string, string> = { DRAFT: "مسودة", POSTED: "مرحّل", PAID: "مصروف" };
IMPL["hr.payroll"] = async (t, companyId, q) => {
  const w = payWhere(companyId, q); const g = q.groupBy || "period";
  const G: Record<string, string> = { period: "r.period", department: "COALESCE(em.department,'—')", nationality: "em.nationality", employee: "em.code || ' · ' || em.name" };
  const rows = await t.rows(`SELECT ${G[g] || G.period} AS grp, COUNT(*)::int employees, SUM((l->>'basic')::numeric) basic, SUM(COALESCE((l->>'housing')::numeric,0)+COALESCE((l->>'transport')::numeric,0)+COALESCE((l->>'other')::numeric,0)) allowances, SUM(COALESCE((l->>'overtime')::numeric,0)+COALESCE((l->>'bonus')::numeric,0)) extras, SUM((l->>'gross')::numeric) gross, SUM(COALESCE((l->>'gosiEmp')::numeric,0)) gosi_emp, SUM(COALESCE((l->>'gosiEr')::numeric,0)) gosi_er, SUM(COALESCE((l->>'deduction')::numeric,0)+COALESCE((l->>'absence')::numeric,0)) deductions, SUM(COALESCE((l->>'loan')::numeric,0)) loans, SUM((l->>'net')::numeric) net ${PAY_FROM} WHERE ${w.sql} GROUP BY 1 ORDER BY 1`, w.params);
  return { columns: [{ key: "grp", label: ({ period: "الشهر", department: "القسم", nationality: "الجنسية", employee: "الموظف" } as any)[g] }, { key: "employees", label: "الموظفون", type: "int", sum: true }, { key: "basic", label: "الأساسي", type: "money", sum: true }, { key: "allowances", label: "البدلات", type: "money", sum: true }, { key: "extras", label: "إضافي ومكافآت", type: "money", sum: true }, { key: "gross", label: "الإجمالي", type: "money", sum: true }, { key: "gosiEmp", label: "تأمينات الموظف", type: "money", sum: true }, { key: "deductions", label: "خصومات", type: "money", sum: true }, { key: "loans", label: "أقساط سلف", type: "money", sum: true }, { key: "net", label: "الصافي", type: "money", sum: true }, { key: "gosiEr", label: "تأمينات المنشأة", type: "money", sum: true }, { key: "cost", label: "التكلفة الكلية", type: "money", sum: true }], rows: rows.map((r) => ({ ...r, grp: g === "nationality" ? NAT[r.grp] || r.grp : r.grp, cost: r2(Number(r.gross) + Number(r.gosiEr)) })) };
};
IMPL["hr.payslips"] = async (t, companyId, q) => {
  const w = payWhere(companyId, q);
  const rows = await t.rows(`SELECT r.period, r.status, em.code, em.name, em.department, em.job_title, em.nationality, (l->>'basic')::numeric basic, (l->>'housing')::numeric housing, (l->>'transport')::numeric transport, (l->>'other')::numeric other, (l->>'overtime')::numeric overtime, (l->>'bonus')::numeric bonus, (l->>'gross')::numeric gross, (l->>'gosiEmp')::numeric gosi_emp, (l->>'gosiEr')::numeric gosi_er, (l->>'deduction')::numeric deduction, (l->>'absence')::numeric absence, (l->>'loan')::numeric loan, (l->>'net')::numeric net, l->>'iban' iban, l->>'bankName' bank ${PAY_FROM} WHERE ${w.sql} ORDER BY r.period DESC, em.code LIMIT 5000`, w.params);
  return { columns: [{ key: "period", label: "الشهر" }, { key: "code", label: "الكود" }, { key: "name", label: "الموظف" }, { key: "department", label: "القسم" }, { key: "jobTitle", label: "الوظيفة" }, { key: "natAr", label: "الجنسية" }, { key: "basic", label: "الأساسي", type: "money", sum: true }, { key: "housing", label: "سكن", type: "money", sum: true }, { key: "transport", label: "نقل", type: "money", sum: true }, { key: "other", label: "أخرى", type: "money", sum: true }, { key: "overtime", label: "إضافي", type: "money", sum: true }, { key: "bonus", label: "مكافأة", type: "money", sum: true }, { key: "gross", label: "الإجمالي", type: "money", sum: true }, { key: "gosiEmp", label: "تأمينات", type: "money", sum: true }, { key: "deduction", label: "خصم", type: "money", sum: true }, { key: "absence", label: "غياب", type: "money", sum: true }, { key: "loan", label: "سلفة", type: "money", sum: true }, { key: "net", label: "الصافي", type: "money", sum: true }, { key: "iban", label: "IBAN" }, { key: "bank", label: "البنك" }, { key: "statusAr", label: "الحالة" }], rows: rows.map((r) => ({ ...r, natAr: NAT[r.nationality], statusAr: PS[r.status] || r.status })) };
};
IMPL["hr.employee-cost"] = async (t, companyId, q) => {
  const w = payWhere(companyId, { ...q, payrollStatus: q.payrollStatus || "POSTED,PAID" }); const g = q.groupBy || "employee";
  const G: Record<string, string> = { employee: "em.code || ' · ' || em.name", department: "COALESCE(em.department,'—')" };
  const rows = await t.rows(`SELECT ${G[g] || G.employee} AS grp, ${g === "employee" ? "MAX(em.department) department, MAX(em.job_title) job_title, " : ""}COUNT(DISTINCT r.period)::int months, SUM((l->>'gross')::numeric) gross, SUM(COALESCE((l->>'gosiEr')::numeric,0)) gosi_er, SUM((l->>'net')::numeric) net ${PAY_FROM} WHERE ${w.sql} GROUP BY 1 ORDER BY gross DESC`, w.params);
  const out = rows.map((r) => ({ ...r, cost: r2(Number(r.gross) + Number(r.gosiEr)), monthly: r.months ? r2((Number(r.gross) + Number(r.gosiEr)) / r.months) : 0 }));
  const tot = sum(out, "cost");
  return { columns: [{ key: "grp", label: g === "employee" ? "الموظف" : "القسم" }, ...(g === "employee" ? [{ key: "department", label: "القسم" }, { key: "jobTitle", label: "الوظيفة" }] : []), { key: "months", label: "الأشهر", type: "int" }, { key: "gross", label: "إجمالي الرواتب", type: "money", sum: true }, { key: "gosiEr", label: "تأمينات المنشأة", type: "money", sum: true }, { key: "cost", label: "التكلفة الكلية", type: "money", sum: true }, { key: "monthly", label: "متوسط شهري", type: "money" }, { key: "net", label: "صافي المدفوع", type: "money", sum: true }, { key: "share", label: "النسبة %", type: "pct" }], rows: out.map((r) => ({ ...r, share: pct(r.cost, tot) })) };
};
IMPL["hr.gosi"] = async (t, companyId, q) => {
  const w = payWhere(companyId, q); w.raw("COALESCE((l->>'gosiEmp')::numeric,0)+COALESCE((l->>'gosiEr')::numeric,0) > 0"); const g = q.groupBy || "period";
  const G: Record<string, string> = { period: "r.period", employee: "em.code || ' · ' || em.name", nationality: "em.nationality" };
  const rows = await t.rows(`SELECT ${G[g] || G.period} AS grp, COUNT(*)::int employees, SUM(COALESCE((l->>'gosiBase')::numeric,0)) base, SUM(COALESCE((l->>'gosiEmp')::numeric,0)) emp, SUM(COALESCE((l->>'gosiEr')::numeric,0)) er ${PAY_FROM} WHERE ${w.sql} GROUP BY 1 ORDER BY 1`, w.params);
  return { columns: [{ key: "grp", label: ({ period: "الشهر", employee: "الموظف", nationality: "الجنسية" } as any)[g] }, { key: "employees", label: "المشتركون", type: "int", sum: true }, { key: "base", label: "الأجر الخاضع", type: "money", sum: true }, { key: "emp", label: "حصة الموظف", type: "money", sum: true }, { key: "er", label: "حصة المنشأة", type: "money", sum: true }, { key: "total", label: "الإجمالي المستحق", type: "money", sum: true }], rows: rows.map((r) => ({ ...r, grp: g === "nationality" ? NAT[r.grp] || r.grp : r.grp, total: r2(Number(r.emp) + Number(r.er)) })) };
};
IMPL["hr.loans"] = async (t, companyId, q) => {
  const { from, to } = period(q);
  const w = new W("l.company_id=?", companyId); w.range("l.date", from, to).uuid("l.employee_id", q.employeeId).in("l.status", q.loanStatus); if (q.department) w.in("em.department", q.department);
  const rows = await t.rows(`SELECT l.number, l.date, em.code, em.name, em.department, l.amount, l.installment, l.paid, l.amount-l.paid remaining, l.start_period, l.status, l.notes FROM employee_loans l JOIN employees em ON em.id=l.employee_id WHERE ${w.sql} ORDER BY l.date DESC`, w.params);
  const LS: Record<string, string> = { ACTIVE: "نشطة", SETTLED: "مسددة", CANCELLED: "ملغاة" };
  return { columns: [{ key: "number", label: "الرقم" }, { key: "date", label: "التاريخ", type: "date" }, { key: "code", label: "الكود" }, { key: "name", label: "الموظف" }, { key: "department", label: "القسم" }, { key: "amount", label: "المبلغ", type: "money", sum: true }, { key: "installment", label: "القسط", type: "money" }, { key: "paid", label: "المسدد", type: "money", sum: true }, { key: "remaining", label: "المتبقي", type: "money", sum: true }, { key: "startPeriod", label: "بداية الخصم" }, { key: "statusAr", label: "الحالة" }, { key: "notes", label: "ملاحظات" }], rows: rows.map((r) => ({ ...r, statusAr: LS[r.status] || r.status })) };
};

// ── assets ──────────────────────────────────────────────────
IMPL["asset.register"] = async (t, companyId, q) => {
  const w = new W("f.company_id=?", companyId); if (q.assetCategory) w.in("f.category", q.assetCategory); w.in("f.status", q.assetStatus).range("f.acquisition_date", q.acqFrom, q.acqTo).like(["f.code", "f.name", "f.category"], q.q);
  const g = q.groupBy || "none";
  const AS: Record<string, string> = { ACTIVE: "نشط", FULLY_DEPRECIATED: "مهلك بالكامل", DISPOSED: "مستبعد" };
  if (g === "none") {
    const rows = await t.rows(`SELECT f.code, f.name, f.category, f.acquisition_date, f.cost, f.salvage_value, f.useful_life_months, f.accumulated, f.cost-f.accumulated nbv, ROUND((f.cost-f.salvage_value)/NULLIF(f.useful_life_months,0),2) monthly, f.last_depreciation, f.status, a.code || ' ' || a.name_ar AS account FROM fixed_assets f JOIN accounts a ON a.id=f.asset_account_id WHERE ${w.sql} ORDER BY f.code`, w.params);
    return { columns: [{ key: "code", label: "الكود" }, { key: "name", label: "الأصل" }, { key: "category", label: "الفئة" }, { key: "account", label: "الحساب" }, { key: "acquisitionDate", label: "تاريخ الشراء", type: "date" }, { key: "cost", label: "التكلفة", type: "money", sum: true }, { key: "salvageValue", label: "التخريدية", type: "money", sum: true }, { key: "usefulLifeMonths", label: "العمر (شهر)", type: "int" }, { key: "monthly", label: "إهلاك شهري", type: "money", sum: true }, { key: "accumulated", label: "مجمع الإهلاك", type: "money", sum: true }, { key: "nbv", label: "القيمة الدفترية", type: "money", sum: true }, { key: "depPct", label: "نسبة الإهلاك %", type: "pct" }, { key: "lastDepreciation", label: "آخر إهلاك", type: "date" }, { key: "statusAr", label: "الحالة" }], rows: rows.map((r) => ({ ...r, depPct: pct(Number(r.accumulated), Number(r.cost)), statusAr: AS[r.status] || r.status, _link: "/assets" })) };
  }
  const gk = g === "account" ? "a.code || ' ' || a.name_ar" : "COALESCE(f.category,'—')";
  const rows = await t.rows(`SELECT ${gk} AS grp, COUNT(*)::int assets, SUM(f.cost) cost, SUM(f.accumulated) accumulated, SUM(f.cost-f.accumulated) nbv FROM fixed_assets f JOIN accounts a ON a.id=f.asset_account_id WHERE ${w.sql} GROUP BY 1 ORDER BY cost DESC`, w.params);
  return { columns: [{ key: "grp", label: g === "account" ? "حساب الأصل" : "الفئة" }, { key: "assets", label: "الأصول", type: "int", sum: true }, { key: "cost", label: "التكلفة", type: "money", sum: true }, { key: "accumulated", label: "مجمع الإهلاك", type: "money", sum: true }, { key: "nbv", label: "القيمة الدفترية", type: "money", sum: true }], rows };
};
IMPL["asset.depreciation"] = async (t, companyId, q) => {
  const { from, to } = period(q);
  const w = new W("d.company_id=?", companyId); w.range("d.period_end", from, to).uuid("d.asset_id", q.assetId); if (q.assetCategory) w.in("f.category", q.assetCategory);
  const g = q.groupBy || "asset";
  const base = `FROM asset_depreciations d JOIN fixed_assets f ON f.id=d.asset_id LEFT JOIN journal_entries e ON e.id=d.journal_id WHERE ${w.sql}`;
  if (g === "none") {
    const rows = await t.rows(`SELECT to_char(d.period_end,'YYYY-MM') AS month, f.code, f.name, f.category, d.amount, e.number AS journal ${base} ORDER BY d.period_end DESC, f.code LIMIT 5000`, w.params);
    return { columns: [{ key: "month", label: "الشهر" }, { key: "code", label: "الكود" }, { key: "name", label: "الأصل" }, { key: "category", label: "الفئة" }, { key: "amount", label: "الإهلاك", type: "money", sum: true }, { key: "journal", label: "القيد" }], rows };
  }
  const gk = g === "category" ? "COALESCE(f.category,'—')" : g === "month" ? "to_char(d.period_end,'YYYY-MM')" : "f.code || ' · ' || f.name";
  const rows = await t.rows(`SELECT ${gk} AS grp, COUNT(*)::int entries, SUM(d.amount) amount, MIN(d.period_end) first_period, MAX(d.period_end) last_period ${base} GROUP BY 1 ORDER BY 1`, w.params);
  return { columns: [{ key: "grp", label: g === "category" ? "الفئة" : g === "month" ? "الشهر" : "الأصل" }, { key: "entries", label: "القيود", type: "int", sum: true }, { key: "amount", label: "الإهلاك", type: "money", sum: true }, { key: "firstPeriod", label: "من", type: "date" }, { key: "lastPeriod", label: "إلى", type: "date" }], rows };
};

// ── VAT ─────────────────────────────────────────────────────
IMPL["vat.detail"] = async (t, companyId, q) => {
  const { from, to } = period(q);
  const B = q.branchId && UUID.test(q.branchId) ? ` AND i.branch_id='${q.branchId}'::uuid` : "";
  const BX = q.branchId && UUID.test(q.branchId) ? ` AND EXISTS (SELECT 1 FROM journal_entries je WHERE je.id=x.journal_id AND je.branch_id='${q.branchId}'::uuid)` : "";
  const P = q.partnerId && UUID.test(q.partnerId) ? ` AND partner_id='${q.partnerId}'::uuid` : "";
  const rows = await t.rows(`WITH u AS (
      SELECT i.date, i.number, 'OUTPUT' side, CASE WHEN i.kind='CREDIT_NOTE' THEN 'إشعار دائن مبيعات' ELSE 'فاتورة مبيعات' END source, i.partner_name AS partner, i.partner_vat AS vat_no, l.tax_code, l.net_amount*${SIGN} taxable, l.vat_amount*${SIGN} vat, i.id AS doc_id, i.partner_id
        FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.company_id=$1 AND i.direction='SALE' AND i.status='POSTED' AND i.kind IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE') AND i.date BETWEEN $2 AND $3${B}
      UNION ALL
      SELECT i.date, i.number, 'INPUT', CASE WHEN i.kind='CREDIT_NOTE' THEN 'مرتجع مشتريات' WHEN l.tax_code='IM' THEN 'استيراد (ضريبة الجمارك)' WHEN l.tax_code='RC' THEN 'احتساب عكسي — مدخلات' ELSE 'فاتورة مشتريات' END, i.partner_name, i.partner_vat, l.tax_code, l.net_amount*${SIGN}, CASE WHEN l.tax_code='RC' THEN l.net_amount*0.15 ELSE l.vat_amount END*${SIGN}, i.id, i.partner_id
        FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.company_id=$1 AND i.direction='PURCHASE' AND i.status='POSTED' AND i.kind IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE') AND i.date BETWEEN $2 AND $3${B}
      UNION ALL
      SELECT i.date, i.number, 'OUTPUT', 'احتساب عكسي — مخرجات', i.partner_name, i.partner_vat, 'RC', l.net_amount*${SIGN}, l.net_amount*0.15*${SIGN}, i.id, i.partner_id
        FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.company_id=$1 AND i.direction='PURCHASE' AND i.status='POSTED' AND i.kind IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE') AND l.tax_code='RC' AND i.date BETWEEN $2 AND $3${B}
      UNION ALL
      SELECT x.date, x.number, 'OUTPUT', 'احتساب عكسي — مخرجات', COALESCE(NULLIF(x.payee,''), pr.name), x.supplier_vat, 'RC', x.amount, x.amount*0.15, NULL, x.partner_id FROM expenses x LEFT JOIN partners pr ON pr.id=x.partner_id WHERE x.company_id=$1 AND x.status='POSTED' AND x.tax_code='RC' AND x.date BETWEEN $2 AND $3${BX}
      UNION ALL
      SELECT e.date, f.code, 'INPUT', 'شراء أصل ثابت', f.name, NULL, 'S', ROUND((l.debit-l.credit)/0.15,2), l.debit-l.credit, NULL, NULL
        FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id JOIN fixed_assets f ON f.id=e.source_id WHERE a.company_id=$1 AND a.system_key='VAT_IN' AND e.type='ASSET' AND e.status='POSTED' AND e.date BETWEEN $2 AND $3${q.branchId && UUID.test(q.branchId) ? ` AND e.branch_id='${q.branchId}'::uuid` : ""}
      UNION ALL
      SELECT x.date, x.number, 'INPUT', CASE WHEN x.tax_code='RC' THEN 'احتساب عكسي — مدخلات' ELSE 'مصروف' END, COALESCE(NULLIF(x.payee,''), pr.name), x.supplier_vat, x.tax_code, x.amount, CASE WHEN x.tax_code='RC' THEN x.amount*0.15 ELSE x.vat_amount END, NULL, x.partner_id FROM expenses x LEFT JOIN partners pr ON pr.id=x.partner_id WHERE x.company_id=$1 AND x.status='POSTED' AND x.date BETWEEN $2 AND $3${BX}
      UNION ALL
      SELECT p.date, p.number, 'INPUT', 'عمولة منصة', p.platform, NULL, 'S', p.fees, p.fee_vat, NULL, NULL FROM estore_payouts p WHERE p.company_id=$1 AND p.status='POSTED' AND p.date BETWEEN $2 AND $3)
    SELECT * FROM u WHERE 1=1${P}${q.vatSide ? ` AND side='${q.vatSide === "INPUT" ? "INPUT" : "OUTPUT"}'` : ""}${list(q.taxCode).length ? ` AND tax_code = ANY('{${list(q.taxCode).join(",")}}'::text[])` : ""}${q.q ? ` AND (number ILIKE $4 OR partner ILIKE $4 OR vat_no ILIKE $4)` : ""} ORDER BY date, number`, q.q ? [companyId, from, to, `%${q.q}%`] : [companyId, from, to]);
  const g = q.groupBy || "none";
  const TC: Record<string, string> = { S: "خاضع 15%", Z: "نسبة صفر", X: "صادرات", E: "معفى", O: "خارج النطاق", IM: "استيراد", RC: "احتساب عكسي" };
  if (g === "none") return { columns: [{ key: "date", label: "التاريخ", type: "date" }, { key: "number", label: "المستند" }, { key: "sideAr", label: "النوع" }, { key: "source", label: "المصدر" }, { key: "partner", label: "الطرف" }, { key: "vatNo", label: "الرقم الضريبي" }, { key: "taxCodeAr", label: "الرمز الضريبي" }, { key: "taxable", label: "القاعدة الخاضعة", type: "money", sum: true }, { key: "vat", label: "الضريبة", type: "money", sum: true }], rows: rows.map((r) => ({ ...r, sideAr: r.side === "OUTPUT" ? "مخرجات" : "مدخلات", taxCodeAr: TC[r.taxCode] || r.taxCode, _link: r.docId ? `/doc/${r.docId}` : undefined })) };
  const keyOf = (r: any) => g === "taxCode" ? TC[r.taxCode] || r.taxCode : g === "partner" ? r.partner || "—" : g === "month" ? String(r.date).slice(0, 7) : r.source;
  const by = new Map<string, any>();
  for (const r of rows) { const k = keyOf(r); const x = by.get(k) || { grp: k, docs: 0, outTaxable: 0, outVat: 0, inTaxable: 0, inVat: 0 }; x.docs++; if (r.side === "OUTPUT") { x.outTaxable = r2(x.outTaxable + Number(r.taxable)); x.outVat = r2(x.outVat + Number(r.vat)); } else { x.inTaxable = r2(x.inTaxable + Number(r.taxable)); x.inVat = r2(x.inVat + Number(r.vat)); } by.set(k, x); }
  return { columns: [{ key: "grp", label: ({ taxCode: "الرمز الضريبي", partner: "الطرف", month: "الشهر", source: "المصدر" } as any)[g] }, { key: "docs", label: "السطور", type: "int", sum: true }, { key: "outTaxable", label: "مبيعات خاضعة", type: "money", sum: true }, { key: "outVat", label: "ضريبة المخرجات", type: "money", sum: true }, { key: "inTaxable", label: "مشتريات خاضعة", type: "money", sum: true }, { key: "inVat", label: "ضريبة المدخلات", type: "money", sum: true }, { key: "net", label: "صافي الضريبة", type: "money", sum: true }], rows: [...by.values()].map((x) => ({ ...x, net: r2(x.outVat - x.inVat) })) };
};
IMPL["vat.monthly"] = async (t, companyId, q) => {
  const r = await IMPL["vat.detail"](t, companyId, { ...q, groupBy: "month" });
  return { ...r, rows: r.rows.sort((a, b) => a.grp.localeCompare(b.grp)) };
};

// ── e-store ─────────────────────────────────────────────────
IMPL["estore.orders"] = async (t, companyId, q) => {
  const w = docWhere(companyId, { ...q, channel: q.platform || "SALLA,ZID", kind: "INVOICE", status: "POSTED" });
  const g = q.groupBy || "platform";
  if (g === "none") return IMPL["sales.register"](t, companyId, { ...q, channel: q.platform || "SALLA,ZID", kind: "INVOICE", status: "POSTED" });
  const G: Record<string, string> = { platform: "i.channel", month: "to_char(i.date,'YYYY-MM')", day: "i.date::text", paymentStatus: "i.payment_status" };
  const rows = await t.rows(`SELECT ${G[g] || G.platform} AS grp, COUNT(*)::int orders, SUM(i.taxable) taxable, SUM(i.vat_total) vat, SUM(i.total) total, SUM(i.amount_paid) paid, SUM(i.cost_total) cost, (SELECT COUNT(*) FROM invoices cn WHERE cn.origin_id = ANY(ARRAY_AGG(i.id)) AND cn.kind='CREDIT_NOTE' AND cn.status='POSTED')::int returns FROM invoices i WHERE ${w.sql} GROUP BY 1 ORDER BY 1`, w.params);
  return { columns: [{ key: "grp", label: ({ platform: "المنصة", month: "الشهر", day: "اليوم", paymentStatus: "حالة السداد" } as any)[g] }, { key: "orders", label: "الطلبات", type: "int", sum: true }, { key: "returns", label: "مرتجعات", type: "int", sum: true }, { key: "taxable", label: "قبل الضريبة", type: "money", sum: true }, { key: "vat", label: "الضريبة", type: "money", sum: true }, { key: "total", label: "الإجمالي", type: "money", sum: true }, { key: "paid", label: "المحصّل", type: "money", sum: true }, { key: "profit", label: "مجمل الربح", type: "money", sum: true }, { key: "avgOrder", label: "متوسط الطلب", type: "money" }], rows: rows.map((r) => ({ ...r, grp: g === "platform" ? CHANNEL_AR[r.grp] || r.grp : g === "paymentStatus" ? STATUS_AR[r.grp] || r.grp : r.grp, profit: r2(Number(r.taxable) - Number(r.cost || 0)), avgOrder: r.orders ? r2(Number(r.total) / r.orders) : 0 })) };
};
IMPL["estore.payouts"] = async (t, companyId, q) => {
  const { from, to } = period(q);
  const w = new W("p.company_id=?", companyId); w.range("p.date", from, to).in("p.platform", q.platform);
  const rows = await t.rows(`SELECT p.number, p.date, p.platform, p.reference, p.gross, p.fees, p.fee_vat, p.net, a.name_ar AS bank, p.status, p.notes FROM estore_payouts p LEFT JOIN accounts a ON a.id=p.bank_account_id WHERE ${w.sql} ORDER BY p.date DESC`, w.params);
  return { columns: [{ key: "number", label: "الرقم" }, { key: "date", label: "التاريخ", type: "date" }, { key: "platformAr", label: "المنصة" }, { key: "reference", label: "المرجع" }, { key: "gross", label: "إجمالي المبيعات", type: "money", sum: true }, { key: "fees", label: "العمولة", type: "money", sum: true }, { key: "feeVat", label: "ضريبة العمولة", type: "money", sum: true }, { key: "net", label: "الصافي المحوّل", type: "money", sum: true }, { key: "feePct", label: "نسبة العمولة %", type: "pct" }, { key: "bank", label: "البنك" }, { key: "statusAr", label: "الحالة" }], rows: rows.map((r) => ({ ...r, platformAr: CHANNEL_AR[r.platform] || r.platform, feePct: pct(Number(r.fees), Number(r.gross)), statusAr: STATUS_AR[r.status] || r.status })) };
};

// ── financial statements (extended) ─────────────────────────
IMPL["fin.income-monthly"] = async (t, companyId, q) => {
  const { from, to } = period(q);
  const months = monthsBetween(from === "1900-01-01" ? today().slice(0, 4) + "-01-01" : from, to);
  const rows: any[] = [];
  for (const m of months) {
    const mf = m + "-01", mt = monthEnd(mf) < to ? monthEnd(mf) : to;
    const s = await incomeStatement(t, companyId, { from: mf, to: mt, branchId: q.branchId });
    rows.push({ month: m, sales: s.sales.total, returns: s.returns.total, netSales: s.netSales, cogs: s.cogs.total, grossProfit: s.grossProfit, grossMargin: s.grossMargin, opex: s.opex.total, operating: s.operating, otherIncome: s.otherIncome.total, otherExp: s.otherExp.total, zakat: s.zakat.total, net: s.net, netMargin: s.netMargin });
  }
  const columns: Col[] = [{ key: "month", label: "الشهر" }, { key: "sales", label: "المبيعات", type: "money", sum: true }, { key: "returns", label: "المرتجعات", type: "money", sum: true }, { key: "netSales", label: "صافي المبيعات", type: "money", sum: true }, { key: "cogs", label: "تكلفة المبيعات", type: "money", sum: true }, { key: "grossProfit", label: "مجمل الربح", type: "money", sum: true }, { key: "grossMargin", label: "هامش مجمل %", type: "pct" }, { key: "opex", label: "المصروفات التشغيلية", type: "money", sum: true }, { key: "operating", label: "الربح التشغيلي", type: "money", sum: true }, { key: "otherIncome", label: "إيرادات أخرى", type: "money", sum: true }, { key: "otherExp", label: "مصروفات أخرى", type: "money", sum: true }, { key: "zakat", label: "الزكاة", type: "money", sum: true }, { key: "net", label: "صافي الربح", type: "money", sum: true }, { key: "netMargin", label: "هامش صافي %", type: "pct" }];
  const totals = totalsOf(columns, rows); totals.grossMargin = pct(totals.grossProfit, totals.netSales); totals.netMargin = pct(totals.net, totals.netSales);
  return { columns, rows, totals };
};
IMPL["fin.balance-compare"] = async (t, companyId, q) => {
  const to = q.to && isDate(q.to) ? q.to : today();
  const cmp = q.compareTo && isDate(q.compareTo) ? q.compareTo : addMonths(to, -12);
  const [a, b] = await Promise.all([balanceSheet(t, companyId, { to, branchId: q.branchId }), balanceSheet(t, companyId, { to: cmp, branchId: q.branchId })]);
  const rows: any[] = [];
  const push = (section: string, name: string, cur: number, prev: number, bold = false) => rows.push({ section, name, cur: r2(cur), prev: r2(prev), change: r2(cur - prev), pct: prev ? pct(cur - prev, Math.abs(prev)) : null, _bold: bold });
  const secs: [string, string][] = [["currentAssets", "الأصول المتداولة"], ["fixedAssets", "الأصول الثابتة"], ["currentLiab", "الخصوم المتداولة"], ["ltLiab", "الخصوم طويلة الأجل"], ["equity", "حقوق الملكية"]];
  for (const [k, label] of secs) {
    const items = new Map<string, any>();
    for (const s of a[k].sections) for (const i of s.items) items.set(i.code, { name: `${i.code} ${i.name}`, cur: i.amount, prev: 0 });
    for (const s of b[k].sections) for (const i of s.items) { const x = items.get(i.code) || { name: `${i.code} ${i.name}`, cur: 0, prev: 0 }; x.prev = i.amount; items.set(i.code, x); }
    for (const [, x] of [...items.entries()].sort()) push(label, x.name, x.cur, x.prev);
    push(label, `مجموع ${label}`, a[k].total, b[k].total, true);
  }
  push("حقوق الملكية", "نتيجة الفترة غير المقفلة", a.currentResult, b.currentResult);
  push("الإجماليات", "إجمالي الأصول", a.totalAssets, b.totalAssets, true);
  push("الإجماليات", "إجمالي الخصوم", a.totalLiab, b.totalLiab, true);
  push("الإجماليات", "إجمالي حقوق الملكية", a.totalEquity, b.totalEquity, true);
  return { columns: [{ key: "section", label: "القسم" }, { key: "name", label: "البند" }, { key: "cur", label: `كما في ${to}`, type: "money" }, { key: "prev", label: `كما في ${cmp}`, type: "money" }, { key: "change", label: "التغير", type: "money" }, { key: "pct", label: "%", type: "pct" }], rows, totals: {}, meta: { to, compareTo: cmp } };
};
IMPL["fin.equity-changes"] = async (t, companyId, q) => {
  const { from, to } = period(q);
  const f0 = from === "1900-01-01" ? today().slice(0, 4) + "-01-01" : from;
  const B = q.branchId && UUID.test(q.branchId) ? ` AND e.branch_id='${q.branchId}'::uuid` : "";
  const eq = await t.rows(`SELECT a.code, a.name_ar, a.subtype,
      COALESCE(SUM(CASE WHEN e.date < $2 THEN l.credit-l.debit END),0) opening,
      COALESCE(SUM(CASE WHEN e.date BETWEEN $2 AND $3 AND e.type<>'CLOSING' THEN l.credit END),0) additions,
      COALESCE(SUM(CASE WHEN e.date BETWEEN $2 AND $3 AND e.type<>'CLOSING' THEN l.debit END),0) withdrawals,
      COALESCE(SUM(CASE WHEN e.date BETWEEN $2 AND $3 AND e.type='CLOSING' THEN l.credit-l.debit END),0) closing_entries
    FROM accounts a LEFT JOIN journal_lines l ON l.account_id=a.id LEFT JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED' AND e.date <= $3${B} WHERE a.company_id=$1 AND a.type='EQUITY' AND NOT a.is_group GROUP BY a.id ORDER BY a.code`, [companyId, f0, to]);
  const resBefore = await t.one(`SELECT COALESCE(SUM(l.credit-l.debit),0) r FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND a.type IN ('REVENUE','EXPENSE') AND e.status='POSTED' AND e.date < $2${B}`, [companyId, f0]);
  const inc = await incomeStatement(t, companyId, { from: f0, to, branchId: q.branchId });
  const rows = eq.map((r) => ({ name: `${r.code} ${r.nameAr}`, opening: r2(r.opening), additions: r2(r.additions), withdrawals: r2(r.withdrawals), result: r2(r.closingEntries), closing: r2(Number(r.opening) + Number(r.additions) - Number(r.withdrawals) + Number(r.closingEntries)) }));
  const closedInPeriod = r2(rows.reduce((a, r) => a + r.result, 0));
  rows.push({ name: "نتيجة أعمال غير مقفلة (أرباح/خسائر مرحّلة ضمنياً)", opening: r2(resBefore.r), additions: inc.net > 0 ? inc.net : 0, withdrawals: inc.net < 0 ? -inc.net : 0, result: r2(-closedInPeriod), closing: r2(Number(resBefore.r) + inc.net - closedInPeriod) });
  const columns: Col[] = [{ key: "name", label: "البند" }, { key: "opening", label: `رصيد ${f0}`, type: "money", sum: true }, { key: "additions", label: "إضافات / أرباح", type: "money", sum: true }, { key: "withdrawals", label: "مسحوبات / خسائر", type: "money", sum: true }, { key: "result", label: "تحويل نتيجة الإقفال", type: "money", sum: true }, { key: "closing", label: `رصيد ${to}`, type: "money", sum: true }];
  return { columns, rows, meta: { netIncome: inc.net } };
};
IMPL["fin.ratios"] = async (t, companyId, q) => {
  const { from, to } = period(q);
  const f0 = from === "1900-01-01" ? today().slice(0, 4) + "-01-01" : from;
  const [bs, inc, ar, ap, bs0] = await Promise.all([balanceSheet(t, companyId, { to, branchId: q.branchId }), incomeStatement(t, companyId, { from: f0, to, branchId: q.branchId }), aging(t, companyId, { to, role: "CUSTOMER", branchId: q.branchId }), aging(t, companyId, { to, role: "SUPPLIER", branchId: q.branchId }), balanceSheet(t, companyId, { to: addDays(f0, -1), branchId: q.branchId })]);
  const secTotal = (g: any, subs: string[]) => r2(g.sections.filter((s: any) => subs.includes(s.subtype)).reduce((a: number, s: any) => a + s.total, 0));
  const cash = secTotal(bs.currentAssets, ["CASH", "BANK"]), recv = secTotal(bs.currentAssets, ["RECEIVABLE"]), inv = secTotal(bs.currentAssets, ["INVENTORY"]), inv0 = secTotal(bs0.currentAssets, ["INVENTORY"]);
  const ca = bs.currentAssets.total, cl = bs.currentLiab.total, ta = bs.totalAssets, tl = bs.totalLiab, te = bs.totalEquity;
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(f0)) / 864e5) + 1);
  const ratio = (a: number, b: number, d = 2) => (b ? Number((a / b).toFixed(d)) : null);
  const rows = [
    { group: "السيولة", name: "نسبة التداول", value: ratio(ca, cl), unit: "مرة", formula: "الأصول المتداولة ÷ الخصوم المتداولة", hint: "المعيار الشائع ≥ 1.5" },
    { group: "السيولة", name: "النسبة السريعة", value: ratio(ca - inv, cl), unit: "مرة", formula: "(الأصول المتداولة − المخزون) ÷ الخصوم المتداولة", hint: "≥ 1 مريح" },
    { group: "السيولة", name: "نسبة النقدية", value: ratio(cash, cl), unit: "مرة", formula: "النقدية والبنوك ÷ الخصوم المتداولة" },
    { group: "السيولة", name: "رأس المال العامل", value: r2(ca - cl), unit: "ر.س", formula: "الأصول المتداولة − الخصوم المتداولة" },
    { group: "الربحية", name: "هامش مجمل الربح", value: inc.grossMargin, unit: "%", formula: "مجمل الربح ÷ صافي المبيعات" },
    { group: "الربحية", name: "هامش الربح التشغيلي", value: pct(inc.operating, inc.netSales), unit: "%", formula: "الربح التشغيلي ÷ صافي المبيعات" },
    { group: "الربحية", name: "هامش صافي الربح", value: inc.netMargin, unit: "%", formula: "صافي الربح ÷ صافي المبيعات" },
    { group: "الربحية", name: "العائد على الأصول (ROA)", value: pct(inc.net, ta), unit: "%", formula: "صافي الربح ÷ إجمالي الأصول", hint: `عن الفترة ${f0} — ${to}` },
    { group: "الربحية", name: "العائد على حقوق الملكية (ROE)", value: pct(inc.net, te), unit: "%", formula: "صافي الربح ÷ حقوق الملكية" },
    { group: "الربحية", name: "نسبة المصروفات التشغيلية", value: pct(inc.opex.total, inc.netSales), unit: "%", formula: "المصروفات التشغيلية ÷ صافي المبيعات" },
    { group: "المديونية", name: "نسبة المديونية", value: pct(tl, ta), unit: "%", formula: "إجمالي الخصوم ÷ إجمالي الأصول" },
    { group: "المديونية", name: "الخصوم إلى حقوق الملكية", value: ratio(tl, te), unit: "مرة", formula: "إجمالي الخصوم ÷ حقوق الملكية" },
    { group: "المديونية", name: "نسبة حقوق الملكية", value: pct(te, ta), unit: "%", formula: "حقوق الملكية ÷ إجمالي الأصول" },
    { group: "الكفاءة", name: "فترة تحصيل الذمم (أيام)", value: inc.netSales ? Math.round((recv / (inc.netSales * 1.15)) * days) : null, unit: "يوم", formula: "ذمم العملاء ÷ المبيعات شاملة الضريبة × أيام الفترة" },
    { group: "الكفاءة", name: "فترة سداد الموردين (أيام)", value: inc.cogs.total ? Math.round((secTotal(bs.currentLiab, ["PAYABLE"]) / (inc.cogs.total * 1.15)) * days) : null, unit: "يوم", formula: "ذمم الموردين ÷ تكلفة المبيعات × أيام الفترة" },
    { group: "الكفاءة", name: "معدل دوران المخزون", value: ratio(inc.cogs.total, (inv + inv0) / 2 || inv), unit: "مرة", formula: "تكلفة المبيعات ÷ متوسط المخزون" },
    { group: "الكفاءة", name: "أيام بقاء المخزون", value: inc.cogs.total ? Math.round((((inv + inv0) / 2 || inv) / inc.cogs.total) * days) : null, unit: "يوم", formula: "متوسط المخزون ÷ تكلفة المبيعات × أيام الفترة" },
    { group: "الكفاءة", name: "دوران الأصول", value: ratio(inc.netSales, ta), unit: "مرة", formula: "صافي المبيعات ÷ إجمالي الأصول" },
    { group: "الذمم", name: "ذمم عملاء متأخرة", value: r2(ar.totals.total - ar.totals.current), unit: "ر.س", formula: "من تقرير أعمار الديون", hint: `${pct(ar.totals.total - ar.totals.current, ar.totals.total)}% من الذمم` },
    { group: "الذمم", name: "ذمم موردين متأخرة", value: r2(ap.totals.total - ap.totals.current), unit: "ر.س", formula: "من تقرير أعمار الديون" },
  ];
  return { columns: [{ key: "group", label: "المجموعة" }, { key: "name", label: "النسبة" }, { key: "value", label: "القيمة", type: "qty" }, { key: "unit", label: "الوحدة" }, { key: "formula", label: "طريقة الحساب" }, { key: "hint", label: "ملاحظة" }], rows, totals: {}, meta: { from: f0, to, base: { cash, recv, inv, ca, cl, ta, tl, te, netSales: inc.netSales, net: inc.net } } };
};
IMPL["fin.account-activity"] = async (t, companyId, q) => {
  const { from, to } = period(q);
  const w = new W("a.company_id=?", companyId); w.raw("NOT a.is_group").in("a.type", q.accountType).in("a.subtype", q.subtype).like(["a.code", "a.name_ar"], q.q);
  const lw: string[] = ["e.status='POSTED'", `e.date <= '${to}'`];
  if (q.branchId && UUID.test(q.branchId)) lw.push(`e.branch_id='${q.branchId}'::uuid`);
  if (q.costCenterId && UUID.test(q.costCenterId)) lw.push(`l.cost_center_id='${q.costCenterId}'::uuid`);
  if (q.partnerId && UUID.test(q.partnerId)) lw.push(`l.partner_id='${q.partnerId}'::uuid`);
  w.params.push(from); const F = `$${w.params.length}`;
  const g = q.groupBy || "account";
  const sel = g === "account" ? "a.code, a.name_ar, a.type, a.subtype" : g === "subtype" ? "a.type, a.subtype" : "a.type";
  const grp = g === "account" ? "a.id" : g === "subtype" ? "a.type, a.subtype" : "a.type";
  const rows = await t.rows(`SELECT ${sel}, COALESCE(SUM(CASE WHEN e.date < ${F} THEN l.debit-l.credit END),0) opening, COALESCE(SUM(CASE WHEN e.date >= ${F} THEN l.debit END),0) debit, COALESCE(SUM(CASE WHEN e.date >= ${F} THEN l.credit END),0) credit, COUNT(l.id) FILTER (WHERE e.date >= ${F})::int moves
    FROM accounts a LEFT JOIN journal_lines l ON l.account_id=a.id LEFT JOIN journal_entries e ON e.id=l.entry_id AND ${lw.join(" AND ")} WHERE ${w.sql} GROUP BY ${grp} ORDER BY ${g === "account" ? "a.code" : "1"}`, w.params);
  let out = rows.map((r) => ({ ...r, typeAr: TYPE_AR[r.type], subtypeAr: SUBTYPE_AR[r.subtype] || r.subtype, opening: r2(r.opening), debit: r2(r.debit), credit: r2(r.credit), closing: r2(Number(r.opening) + Number(r.debit) - Number(r.credit)), _link: g === "account" ? `/accounts?q=${r.code}` : undefined }));
  if (q.nonzero === "1") out = out.filter((r) => r.opening || r.debit || r.credit || r.closing);
  return { columns: [...(g === "account" ? [{ key: "code", label: "الرقم" }, { key: "nameAr", label: "الحساب" }] : []), { key: "typeAr", label: "النوع" }, ...(g !== "type" ? [{ key: "subtypeAr", label: "التصنيف" }] : []), { key: "opening", label: "رصيد أول المدة", type: "money", sum: true }, { key: "debit", label: "مدين", type: "money", sum: true }, { key: "credit", label: "دائن", type: "money", sum: true }, { key: "closing", label: "رصيد آخر المدة", type: "money", sum: true }, { key: "moves", label: "الحركات", type: "int", sum: true }], rows: out };
};
IMPL["fin.partner-balances"] = async (t, companyId, q) => {
  const to = q.to && isDate(q.to) ? q.to : today();
  const role = q.role === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER";
  const key = role === "CUSTOMER" ? "AR" : "AP", dir = role === "CUSTOMER" ? "SALE" : "PURCHASE", sign = role === "CUSTOMER" ? 1 : -1;
  const B = q.branchId && UUID.test(q.branchId) ? ` AND e.branch_id='${q.branchId}'::uuid` : "";
  const BI = q.branchId && UUID.test(q.branchId) ? ` AND i.branch_id='${q.branchId}'::uuid` : "";
  const w = new W("p.company_id=?", companyId); w.raw(role === "CUSTOMER" ? "p.is_customer" : "p.is_supplier"); if (q.city) w.in("p.city", q.city); w.like(["p.name", "p.code", "p.phone", "p.vat_number"], q.q);
  w.params.push(to); const T = `$${w.params.length}`;
  const rows = await t.rows(`SELECT p.id, p.code, p.name, p.city, p.phone, p.credit_limit, p.payment_terms,
      COALESCE((SELECT SUM(l.debit-l.credit)*${sign} FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE l.partner_id=p.id AND a.system_key='${key}' AND e.status='POSTED' AND e.date <= ${T}${B}),0) balance,
      COALESCE((SELECT SUM(i.total-i.amount_paid) FROM invoices i WHERE i.partner_id=p.id AND i.direction='${dir}' AND i.status='POSTED' AND i.kind IN ('INVOICE','DEBIT_NOTE') AND i.total-i.amount_paid>0.001 AND i.date <= ${T} AND COALESCE(i.due_date,i.date) < ${T}${BI}),0) overdue,
      (SELECT COUNT(*)::int FROM invoices i WHERE i.partner_id=p.id AND i.direction='${dir}' AND i.status='POSTED' AND i.kind='INVOICE' AND i.total-i.amount_paid>0.001 AND i.date <= ${T}${BI}) open_docs,
      (SELECT MAX(i.date) FROM invoices i WHERE i.partner_id=p.id AND i.direction='${dir}' AND i.status='POSTED' AND i.date <= ${T}${BI}) last_doc,
      (SELECT MAX(pm.date) FROM payments pm WHERE pm.partner_id=p.id AND pm.status='POSTED' AND pm.direction='${role === "CUSTOMER" ? "IN" : "OUT"}' AND pm.date <= ${T}) last_payment,
      COALESCE((SELECT SUM(i.total*CASE WHEN i.kind='CREDIT_NOTE' THEN -1 ELSE 1 END) FROM invoices i WHERE i.partner_id=p.id AND i.direction='${dir}' AND i.status='POSTED' AND i.kind IN ('INVOICE','CREDIT_NOTE') AND i.date BETWEEN ${T}::date - 365 AND ${T}${BI}),0) volume_12m
    FROM partners p WHERE ${w.sql} ORDER BY balance DESC`, w.params);
  let out = rows.map((r) => ({ ...r, balance: r2(r.balance), overdue: r2(r.overdue), volume12m: r2(r.volume12m), available: role === "CUSTOMER" && Number(r.creditLimit) > 0 ? r2(Number(r.creditLimit) - Number(r.balance)) : null, overLimit: role === "CUSTOMER" && Number(r.creditLimit) > 0 && Number(r.balance) > Number(r.creditLimit) ? "تجاوز" : "", _link: `/${role === "CUSTOMER" ? "customers" : "suppliers"}?q=${encodeURIComponent(r.code)}` }));
  if (q.nonzero === "1") out = out.filter((r) => Math.abs(r.balance) > 0.004 || r.overdue);
  if ((q.groupBy || "partner") === "city") {
    const by = new Map<string, any>();
    for (const r of out) { const k = r.city || "—"; const x = by.get(k) || { city: k, partners: 0, balance: 0, overdue: 0, volume12m: 0 }; x.partners++; x.balance = r2(x.balance + r.balance); x.overdue = r2(x.overdue + r.overdue); x.volume12m = r2(x.volume12m + r.volume12m); by.set(k, x); }
    return { columns: [{ key: "city", label: "المدينة" }, { key: "partners", label: "الأطراف", type: "int", sum: true }, { key: "balance", label: "الرصيد", type: "money", sum: true }, { key: "overdue", label: "المتأخر", type: "money", sum: true }, { key: "volume12m", label: "تعاملات 12 شهراً", type: "money", sum: true }], rows: [...by.values()] };
  }
  return { columns: [{ key: "code", label: "الكود" }, { key: "name", label: role === "CUSTOMER" ? "العميل" : "المورد" }, { key: "city", label: "المدينة" }, { key: "phone", label: "الجوال" }, { key: "paymentTerms", label: "أيام السداد", type: "int" }, { key: "balance", label: `الرصيد في ${to}`, type: "money", sum: true }, { key: "overdue", label: "المتأخر", type: "money", sum: true }, { key: "openDocs", label: "فواتير مفتوحة", type: "int", sum: true }, ...(role === "CUSTOMER" ? [{ key: "creditLimit", label: "حد الائتمان", type: "money" } as Col, { key: "available", label: "المتاح", type: "money" } as Col, { key: "overLimit", label: "تجاوز الحد" } as Col] : []), { key: "volume12m", label: "تعاملات 12 شهراً", type: "money", sum: true }, { key: "lastDoc", label: "آخر فاتورة", type: "date" }, { key: "lastPayment", label: "آخر سداد", type: "date" }], rows: out };
};
IMPL["fin.cost-centers"] = async (t, companyId, q) => {
  const w = lineWhere(companyId, { ...q, accountType: "REVENUE,EXPENSE", entryType: undefined }); w.raw("e.type <> 'CLOSING'");
  const g = q.groupBy || "costCenter";
  const rows = await t.rows(`SELECT COALESCE(cc.name,'غير موزع') AS cost_center${g === "account" ? ", a.code, a.name_ar" : ""}, SUM(CASE WHEN a.type='REVENUE' THEN l.credit-l.debit ELSE 0 END) revenue, SUM(CASE WHEN a.subtype='COGS' THEN l.debit-l.credit ELSE 0 END) cogs, SUM(CASE WHEN a.type='EXPENSE' AND a.subtype<>'COGS' THEN l.debit-l.credit ELSE 0 END) expenses ${LINE_FROM} WHERE ${w.sql} GROUP BY 1${g === "account" ? ",2,3" : ""} ORDER BY 1${g === "account" ? ",2" : ""}`, w.params);
  const out = rows.map((r) => ({ ...r, revenue: r2(r.revenue), cogs: r2(r.cogs), expenses: r2(r.expenses), net: r2(Number(r.revenue) - Number(r.cogs) - Number(r.expenses)), margin: pct(Number(r.revenue) - Number(r.cogs) - Number(r.expenses), Number(r.revenue)) }));
  return { columns: [{ key: "costCenter", label: "مركز التكلفة" }, ...(g === "account" ? [{ key: "code", label: "الحساب" }, { key: "nameAr", label: "اسم الحساب" }] : []), { key: "revenue", label: "الإيرادات", type: "money", sum: true }, { key: "cogs", label: "تكلفة المبيعات", type: "money", sum: true }, { key: "expenses", label: "المصروفات", type: "money", sum: true }, { key: "net", label: "صافي النتيجة", type: "money", sum: true }, { key: "margin", label: "الهامش %", type: "pct" }], rows: out };
};
IMPL["fin.entries-summary"] = async (t, companyId, q) => {
  const { from, to } = period(q);
  const w = new W("e.company_id=?", companyId); w.raw("e.status='POSTED'").range("e.date", from, to).uuid("e.branch_id", q.branchId).in("e.type", q.entryType); if (q.user) w.add("e.created_by=?", q.user);
  const g = q.groupBy || "entryType";
  const G: Record<string, string> = { entryType: "e.type", month: "to_char(e.date,'YYYY-MM')", user: "COALESCE(e.created_by,'—')", branch: "COALESCE(b.name,'—')" };
  const rows = await t.rows(`SELECT ${G[g] || G.entryType} AS grp, COUNT(*)::int entries, SUM(e.total_debit) amount, COUNT(*) FILTER (WHERE e.reversed_by IS NOT NULL)::int reversed, MIN(e.date) first_date, MAX(e.date) last_date FROM journal_entries e LEFT JOIN branches b ON b.id=e.branch_id WHERE ${w.sql} GROUP BY 1 ORDER BY 1`, w.params);
  return { columns: [{ key: "grp", label: ({ entryType: "نوع القيد", month: "الشهر", user: "المستخدم", branch: "الفرع" } as any)[g] }, { key: "entries", label: "القيود", type: "int", sum: true }, { key: "amount", label: "إجمالي المبالغ", type: "money", sum: true }, { key: "reversed", label: "معكوسة", type: "int", sum: true }, { key: "firstDate", label: "من", type: "date" }, { key: "lastDate", label: "إلى", type: "date" }], rows: rows.map((r) => ({ ...r, grp: g === "entryType" ? JTYPE_AR[r.grp] || r.grp : r.grp })) };
};

/** Values for dynamic dropdowns (users, departments, cities, asset categories…). */
export async function dimensionValues(t: Db, companyId: string, key: string) {
  const Q: Record<string, string> = {
    user: `SELECT DISTINCT v FROM (SELECT created_by v FROM invoices WHERE company_id=$1 UNION SELECT user_name FROM pos_sessions WHERE company_id=$1 UNION SELECT created_by FROM journal_entries WHERE company_id=$1 UNION SELECT created_by FROM payments WHERE company_id=$1) x WHERE v IS NOT NULL ORDER BY 1`,
    department: `SELECT DISTINCT department v FROM employees WHERE company_id=$1 AND department IS NOT NULL ORDER BY 1`,
    city: `SELECT DISTINCT city v FROM partners WHERE company_id=$1 AND city IS NOT NULL AND city<>'' ORDER BY 1`,
    assetCategory: `SELECT DISTINCT category v FROM fixed_assets WHERE company_id=$1 AND category IS NOT NULL ORDER BY 1`,
    currency: `SELECT DISTINCT currency v FROM payments WHERE company_id=$1 AND currency<>'SAR' ORDER BY 1`,
    employee: `SELECT id, code || ' · ' || name AS v FROM employees WHERE company_id=$1 ORDER BY code`,
    asset: `SELECT id, code || ' · ' || name AS v FROM fixed_assets WHERE company_id=$1 ORDER BY code`,
  };
  if (!Q[key]) return [];
  return (await t.rows(Q[key], [companyId])).map((r) => ({ id: r.id || r.v, label: r.v }));
}
