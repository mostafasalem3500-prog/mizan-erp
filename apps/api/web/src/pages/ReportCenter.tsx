/** Report center: one generic renderer for every module report — filter bar built from the catalog, KPIs, chart, sortable table, Excel/print, saved presets, URL-synced filters. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useLocation, Link } from "react-router-dom";
import { api, q as qs, useFetch, Money, money, Loading, Empty, Input, Select, Picker, partnerFetcher, productFetcher, accountFetcher, useCompanyContext, useToast, exportExcel, today, yearStart, fmtDate, fmtDT, useSorted, Th, SearchBox, PeriodFilter, BarChart, useLocalState, matches, addMonths } from "../lib";

type Def = { key: string; module: string; title: string; desc: string; filters: string[]; groupBy?: { key: string; label: string }[]; chart?: string };
type Col = { key: string; label: string; type?: string; sum?: boolean };

const OPTS: Record<string, [string, string][]> = {
  status: [["DRAFT", "مسودة"], ["POSTED", "مرحّل"], ["CONVERTED", "محوّل"], ["CANCELLED", "ملغى"]],
  paymentStatus: [["UNPAID", "غير مسدد"], ["PARTIAL", "جزئي"], ["PAID", "مسدد"]],
  channel: [["BACKOFFICE", "المكتب"], ["POS", "نقطة البيع"], ["SALLA", "سلة"], ["ZID", "زد"], ["API", "API"]],
  zatca: [["NOT_REQUIRED", "مرحلة أولى"], ["PENDING", "بانتظار الإرسال"], ["REPORTED", "مُبلَّغ"], ["CLEARED", "معتمد"], ["WARNING", "بتحذير"], ["REJECTED", "مرفوض"], ["FAILED", "فشل"]],
  kind: [["QUOTATION", "عرض سعر"], ["ORDER", "أمر"], ["INVOICE", "فاتورة"], ["CREDIT_NOTE", "إشعار دائن"], ["DEBIT_NOTE", "إشعار مدين"]],
  taxCode: [["S", "خاضع 15%"], ["Z", "نسبة صفر"], ["X", "صادرات"], ["E", "معفى"], ["O", "خارج النطاق"], ["IM", "استيراد"], ["RC", "احتساب عكسي"]],
  accountType: [["ASSET", "أصول"], ["LIABILITY", "خصوم"], ["EQUITY", "حقوق ملكية"], ["REVENUE", "إيرادات"], ["EXPENSE", "مصروفات"]],
  subtype: [["CASH", "نقدية"], ["BANK", "بنوك"], ["RECEIVABLE", "ذمم مدينة"], ["INVENTORY", "مخزون"], ["CURRENT_ASSET", "أصول متداولة أخرى"], ["FIXED_ASSET", "أصول ثابتة"], ["ACC_DEPRECIATION", "مجمع إهلاك"], ["PAYABLE", "ذمم دائنة"], ["TAX", "ضرائب وزكاة"], ["CURRENT_LIABILITY", "خصوم متداولة"], ["LONG_TERM_LIABILITY", "خصوم طويلة الأجل"], ["CAPITAL", "رأس المال"], ["RETAINED", "أرباح مبقاة"], ["SALES", "مبيعات"], ["SALES_RETURNS", "مرتجعات مبيعات"], ["OTHER_INCOME", "إيرادات أخرى"], ["COGS", "تكلفة المبيعات"], ["EXPENSE", "مصروفات تشغيلية"], ["SELLING_EXPENSE", "مصروفات بيعية"], ["OTHER_EXPENSE", "مصروفات أخرى"], ["ZAKAT", "زكاة"]],
  entryType: [["MANUAL", "قيد يدوي"], ["OPENING", "افتتاحي"], ["SALES", "مبيعات"], ["SALES_RETURN", "مرتجع مبيعات"], ["PURCHASE", "مشتريات"], ["PURCHASE_RETURN", "مرتجع مشتريات"], ["RECEIPT", "سند قبض"], ["PAYMENT", "سند صرف"], ["EXPENSE", "مصروف"], ["POS", "نقاط بيع"], ["POS_CLOSE", "إغلاق وردية"], ["STOCK", "مخزون"], ["DEPRECIATION", "إهلاك"], ["ASSET", "أصول"], ["VAT_SETTLEMENT", "تسوية ضريبة"], ["REVERSAL", "عكسي"], ["CHEQUE", "شيكات"], ["PAYROLL", "رواتب"], ["CLOSING", "إقفال"]],
  method: [["CASH", "نقدي"], ["CARD", "شبكة"], ["BANK", "تحويل"], ["CHEQUE", "شيك"]],
  chequeStatus: [["PENDING", "قيد التحصيل / لم يُصرف"], ["DEPOSITED", "مودع"], ["CLEARED", "محصّل / مصروف"], ["BOUNCED", "مرتجع"], ["CANCELLED", "ملغى"]],
  moveType: [["PURCHASE", "شراء"], ["SALE", "بيع"], ["POS", "نقطة بيع"], ["SALE_RETURN", "مرتجع بيع"], ["PURCHASE_RETURN", "مرتجع شراء"], ["ADJUSTMENT", "تسوية جرد"], ["OPENING", "رصيد افتتاحي"], ["TRANSFER", "تحويل"], ["LANDED_COST", "تكاليف استيراد"]],
  adjKind: [["COUNT", "جرد"], ["OPENING", "رصيد افتتاحي"], ["TRANSFER", "تحويل"]],
  stockState: [["OUT", "نافد"], ["LOW", "منخفض"], ["OK", "جيد"], ["EXCESS", "فائض"]],
  sessionStatus: [["OPEN", "مفتوحة"], ["CLOSED", "مغلقة"]],
  payrollStatus: [["DRAFT", "مسودة"], ["POSTED", "مرحّل"], ["PAID", "مصروف"]],
  loanStatus: [["ACTIVE", "نشطة"], ["SETTLED", "مسددة"], ["CANCELLED", "ملغاة"]],
  assetStatus: [["ACTIVE", "نشط"], ["FULLY_DEPRECIATED", "مهلك بالكامل"], ["DISPOSED", "مستبعد"]],
  platform: [["SALLA", "سلة"], ["ZID", "زد"]],
  nationality: [["SAUDI", "سعودي"], ["NON_SAUDI", "غير سعودي"]],
};
const LABEL: Record<string, string> = { status: "الحالة", paymentStatus: "حالة السداد", channel: "القناة", zatca: "حالة الهيئة", kind: "نوع المستند", taxCode: "الرمز الضريبي", accountType: "نوع الحساب", subtype: "تصنيف الحساب", entryType: "نوع القيد", method: "طريقة الدفع", chequeStatus: "حالة الشيك", moveType: "نوع الحركة", adjKind: "نوع المستند", stockState: "حالة المخزون", sessionStatus: "حالة الوردية", payrollStatus: "حالة المسير", loanStatus: "حالة السلفة", assetStatus: "حالة الأصل", platform: "المنصة", nationality: "الجنسية", warehouse: "المستودع", category: "التصنيف" };
const MULTI = new Set(["status", "paymentStatus", "channel", "zatca", "kind", "taxCode", "accountType", "subtype", "entryType", "method", "chequeStatus", "moveType", "adjKind", "stockState", "sessionStatus", "payrollStatus", "loanStatus", "assetStatus", "platform", "nationality", "warehouse", "category"]);
const PARAM: Record<string, string> = { warehouse: "warehouseId", category: "categoryId", branch: "branchId", partner: "partnerId", product: "productId", account: "accountId", costCenter: "costCenterId", employee: "employeeId", asset: "assetId" };

/** Compact multi-select: a button that opens a checkbox list; value is a comma-separated string. */
function MultiSelect({ label, options, value, onChange }: { label: string; options: [string, string][]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const sel = new Set(value ? value.split(",") : []);
  useEffect(() => { if (!open) return; const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as any)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, [open]);
  const toggle = (k: string) => { const n = new Set(sel); n.has(k) ? n.delete(k) : n.add(k); onChange([...n].join(",")); };
  return (
    <div className="ms" ref={ref}>
      <button type="button" className={"input ms-btn" + (sel.size ? " on" : "")} onClick={() => setOpen((o) => !o)}>{sel.size ? `${label}: ${sel.size === 1 ? options.find((o) => o[0] === [...sel][0])?.[1] || [...sel][0] : sel.size + " محدد"}` : `كل ${label}`}<span className="muted"> ▾</span></button>
      {open && <div className="ms-pop">
        {options.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={sel.has(k)} onChange={() => toggle(k)} /> {l}</label>)}
        {sel.size > 0 && <button type="button" className="link-btn" onClick={() => onChange("")}>مسح</button>}
      </div>}
    </div>
  );
}

function DimSelect({ dim, value, onChange, placeholder }: { dim: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  const { data } = useFetch<any[]>(`/reports/dimension/${dim}`);
  return <Select value={value} onChange={(e) => onChange(e.target.value)}><option value="">{placeholder}</option>{(data || []).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select>;
}

function fmt(v: any, type?: string) {
  if (v === null || v === undefined || v === "") return "";
  switch (type) {
    case "money": return <Money v={v} />;
    case "qty": return <span className="num">{Number(v).toLocaleString("en-US", { maximumFractionDigits: 3 })}</span>;
    case "int": return <span className="num">{Number(v).toLocaleString("en-US")}</span>;
    case "pct": return <span className="num">{Number(v).toLocaleString("en-US", { maximumFractionDigits: 1 })}%</span>;
    case "date": return <span className="dt">{fmtDate(v)}</span>;
    case "datetime": return <span className="dt small">{fmtDT(v)}</span>;
    default: return String(v);
  }
}

const DEFAULTS = (def: Def): Record<string, string> => ({ from: def.filters.includes("period") ? yearStart() : "", to: def.filters.includes("period") || def.filters.includes("to") ? today() : "", compareTo: def.filters.includes("compareTo") ? addMonths(today(), -12) : "", groupBy: def.groupBy?.[0]?.key || "", days: def.filters.includes("days") ? "90" : "" });

export function ReportCenterPage() {
  const { key } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const { me } = useCompanyContext();
  const cat = useFetch<{ modules: { key: string; label: string }[]; reports: Def[] }>("/reports/catalog");
  const branches = useFetch<any[]>("/branches");
  const warehouses = useFetch<any[]>("/warehouses");
  const categories = useFetch<any[]>("/categories");
  const costCenters = useFetch<any[]>("/cost-centers");
  const [search, setSearch] = useState("");
  const [mod, setMod] = useState("");
  const def = cat.data?.reports.find((r) => r.key === key) || null;
  const [f, setF] = useState<Record<string, string>>({});
  const [pickers, setPickers] = useState<Record<string, any>>({});
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [presets, setPresets] = useLocalState<Record<string, { name: string; f: Record<string, string>; pickers: Record<string, any> }[]>>("mz_report_presets", {});
  const [recent, setRecent] = useLocalState<string[]>("mz_report_recent", []);
  const [showChart, setShowChart] = useState(true);
  const [text, setText] = useState("");

  // filters from URL (shareable) or defaults when the report changes
  useEffect(() => {
    if (!def) return;
    const p = new URLSearchParams(loc.search);
    const fromUrl: Record<string, string> = {}; p.forEach((v, k) => { fromUrl[k] = v; });
    const init = { ...DEFAULTS(def), ...fromUrl };
    setF(init); setPickers({}); setResult(null); setText("");
    setRecent((r) => [def.key, ...r.filter((x) => x !== def.key)].slice(0, 8));
    run(init, def);
  }, [def?.key]);

  const run = async (filters = f, d = def) => {
    if (!d) return;
    setLoading(true);
    try {
      const r = await api(`/reports/run/${d.key}${qs(filters)}`);
      setResult(r);
      nav(`/reports-center/${d.key}${qs(filters)}`, { replace: true });
    } catch (e: any) { toast(e.message, "err"); } finally { setLoading(false); }
  };
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const has = (k: string) => !!def?.filters.includes(k);
  const role = def?.module === "purchases" || f.direction === "OUT" || f.role === "SUPPLIER" ? "SUPPLIER" : def?.module === "sales" || def?.module === "pos" || f.role === "CUSTOMER" ? "CUSTOMER" : undefined;

  const rows: any[] = useMemo(() => (result?.rows || []).filter((r: any) => !text || matches(r, text, Object.keys(r).filter((k) => !k.startsWith("_")))), [result, text]);
  const srt = useSorted(rows);
  const cols: Col[] = result?.columns || [];
  const kpis = cols.filter((c) => c.sum && (c.type === "money" || c.type === "qty" || c.type === "int")).slice(0, 5);
  const chartKey = def?.chart && cols.find((c) => c.key === def.chart) ? def.chart : null;
  const labelKey = cols[0]?.key;

  const exportRows = () => srt.sorted.map((r) => Object.fromEntries(cols.map((c) => [c.label, c.type === "date" ? fmtDate(r[c.key]) : c.type === "datetime" ? fmtDT(r[c.key]) : r[c.key]])));
  const savePreset = () => { if (!def) return; const name = prompt("اسم الفلتر المحفوظ"); if (!name) return; setPresets((p) => ({ ...p, [def.key]: [...(p[def.key] || []).filter((x) => x.name !== name), { name, f, pickers }] })); toast("تم حفظ الفلتر", "ok"); };
  const applyPreset = (p: { f: Record<string, string>; pickers: Record<string, any> }) => { setF(p.f); setPickers(p.pickers || {}); run(p.f); };
  const copyLink = () => { navigator.clipboard?.writeText(location.href); toast("تم نسخ رابط التقرير بفلاتره", "ok"); };

  if (!cat.data) return <Loading />;
  const reportsOf = (m: string) => cat.data!.reports.filter((r) => r.module === m && (!search || matches(r, search, ["title", "desc"])));
  return (
    <div className="rc">
      <aside className="rc-side no-print">
        <SearchBox value={search} onChange={setSearch} placeholder="ابحث عن تقرير" />
        {!search && recent.length > 0 && !mod && <div className="rc-mod"><div className="rc-mod-h">الأخيرة</div>{recent.map((k) => cat.data!.reports.find((r) => r.key === k)).filter(Boolean).map((r) => <Link key={r!.key} to={`/reports-center/${r!.key}`} className={"rc-item" + (key === r!.key ? " on" : "")}>{r!.title}</Link>)}</div>}
        {cat.data.modules.map((m) => { const list = reportsOf(m.key); if (!list.length) return null; const open = search || mod === m.key || (!mod && def?.module === m.key); return (
          <div key={m.key} className="rc-mod">
            <button className={"rc-mod-h" + (open ? " open" : "")} onClick={() => setMod(mod === m.key ? "" : m.key)}>{m.label} <span className="muted small">({list.length})</span><span className="grow" />{open ? "▾" : "▸"}</button>
            {open && list.map((r) => <Link key={r.key} to={`/reports-center/${r.key}`} className={"rc-item" + (key === r.key ? " on" : "")} title={r.desc}>{r.title}</Link>)}
          </div>); })}
        <div className="rc-mod"><Link to="/reports" className="rc-item">📊 القوائم المالية الأساسية</Link></div>
      </aside>
      <div className="rc-main">
        {!def ? (
          <div className="card"><div className="card-b">
            <h2>مركز التقارير</h2><p className="muted">{cat.data.reports.length} تقريراً مفصّلاً في {cat.data.modules.length} مديولات — كل تقرير بفلاتر متعددة وتجميع وتصدير وطباعة. اختر تقريراً من القائمة.</p>
            <div className="rc-grid">{cat.data.modules.map((m) => <div key={m.key} className="card"><div className="card-h"><h3>{m.label}</h3></div><div className="card-b">{reportsOf(m.key).map((r) => <Link key={r.key} to={`/reports-center/${r.key}`} className="rc-link"><b>{r.title}</b><span className="small muted">{r.desc}</span></Link>)}</div></div>)}</div>
          </div></div>
        ) : (
          <div className="card">
            <div className="card-h no-print"><div><h3>{def.title}</h3><div className="small muted">{def.desc}</div></div>
              <div className="row">
                {(presets[def.key] || []).length > 0 && <Select value="" onChange={(e) => { const p = presets[def.key].find((x) => x.name === e.target.value); if (p) applyPreset(p); }}><option value="">فلاتر محفوظة…</option>{presets[def.key].map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</Select>}
                <button className="btn sm" onClick={savePreset} title="حفظ الفلاتر الحالية باسم">💾 حفظ الفلتر</button>
                <button className="btn sm" onClick={copyLink}>🔗 نسخ الرابط</button>
                <button className="btn sm" onClick={() => window.print()}>🖨 طباعة</button>
                {result && <button className="btn sm" onClick={() => exportExcel(exportRows(), def.title)}>⬇ Excel</button>}
              </div>
            </div>
            <div className="card-b">
              <form className="rc-filters no-print" onSubmit={(e) => { e.preventDefault(); run(); }}>
                {has("period") && <PeriodFilter from={f.from || ""} to={f.to || ""} onChange={(a, b) => setF((x) => ({ ...x, from: a, to: b }))} />}
                {has("to") && !has("period") && <label className="rc-f"><span>كما في</span><Input type="date" value={f.to || ""} onChange={(e) => set("to", e.target.value)} /></label>}
                {has("compareTo") && <label className="rc-f"><span>مقارنة بـ</span><Input type="date" value={f.compareTo || ""} onChange={(e) => set("compareTo", e.target.value)} /></label>}
                {has("duePeriod") && <label className="rc-f"><span>الاستحقاق من</span><Input type="date" value={f.dueFrom || ""} onChange={(e) => set("dueFrom", e.target.value)} /><span>إلى</span><Input type="date" value={f.dueTo || ""} onChange={(e) => set("dueTo", e.target.value)} /></label>}
                {has("acqPeriod") && <label className="rc-f"><span>الشراء من</span><Input type="date" value={f.acqFrom || ""} onChange={(e) => set("acqFrom", e.target.value)} /><span>إلى</span><Input type="date" value={f.acqTo || ""} onChange={(e) => set("acqTo", e.target.value)} /></label>}
                {has("branch") && (branches.data?.length || 0) > 1 && !me.lockedBranch && <Select value={f.branchId || ""} onChange={(e) => set("branchId", e.target.value)}><option value="">كل الفروع</option>{branches.data!.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}
                {has("warehouse") && (warehouses.data?.length || 0) > 1 && <MultiSelect label="المستودعات" options={(warehouses.data || []).map((w) => [w.id, w.name])} value={f.warehouseId || ""} onChange={(v) => set("warehouseId", v)} />}
                {has("category") && (categories.data?.length || 0) > 0 && <MultiSelect label="التصنيفات" options={(categories.data || []).map((c) => [c.id, c.name])} value={f.categoryId || ""} onChange={(v) => set("categoryId", v)} />}
                {has("role") && <Select value={f.role || "CUSTOMER"} onChange={(e) => set("role", e.target.value)}><option value="CUSTOMER">العملاء</option><option value="SUPPLIER">الموردون</option></Select>}
                {has("direction") && <Select value={f.direction || ""} onChange={(e) => set("direction", e.target.value)}><option value="">قبض وصرف</option><option value="IN">قبض</option><option value="OUT">صرف</option></Select>}
                {has("vatSide") && <Select value={f.vatSide || ""} onChange={(e) => set("vatSide", e.target.value)}><option value="">مخرجات ومدخلات</option><option value="OUTPUT">المخرجات (المبيعات)</option><option value="INPUT">المدخلات (المشتريات والمصروفات)</option></Select>}
                {has("payType") && <Select value={f.payType || ""} onChange={(e) => set("payType", e.target.value)}><option value="">نقدي وآجل</option><option value="NOW">دفع فوري</option><option value="CREDIT">آجل على مورد</option></Select>}
                {has("partner") && <div className="rc-picker"><Picker value={pickers.partner || null} onChange={(p) => { setPickers((x) => ({ ...x, partner: p })); set("partnerId", p?.id || ""); }} fetcher={partnerFetcher(role)} label={(p: any) => p.name} placeholder={role === "SUPPLIER" ? "كل الموردين" : role === "CUSTOMER" ? "كل العملاء" : "كل الأطراف"} /></div>}
                {has("product") && <div className="rc-picker"><Picker value={pickers.product || null} onChange={(p) => { setPickers((x) => ({ ...x, product: p })); set("productId", p?.id || ""); }} fetcher={productFetcher} label={(p: any) => `${p.name} (${p.sku})`} placeholder="كل الأصناف" /></div>}
                {has("account") && <div className="rc-picker"><Picker value={pickers.account || null} onChange={(a) => { setPickers((x) => ({ ...x, account: a })); set("accountId", a?.id || ""); }} fetcher={accountFetcher(def.module === "treasury" ? (a) => a.isCashBank : def.module === "expenses" ? (a) => a.type === "EXPENSE" : undefined)} label={(a: any) => `${a.code} ${a.nameAr}`} placeholder="كل الحسابات" /></div>}
                {has("costCenter") && (costCenters.data?.length || 0) > 0 && <Select value={f.costCenterId || ""} onChange={(e) => set("costCenterId", e.target.value)}><option value="">كل مراكز التكلفة</option>{costCenters.data!.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}
                {has("user") && <DimSelect dim="user" value={f.user || ""} onChange={(v) => set("user", v)} placeholder="كل المستخدمين" />}
                {has("department") && <DimSelect dim="department" value={f.department || ""} onChange={(v) => set("department", v)} placeholder="كل الأقسام" />}
                {has("employee") && <DimSelect dim="employee" value={f.employeeId || ""} onChange={(v) => set("employeeId", v)} placeholder="كل الموظفين" />}
                {has("asset") && <DimSelect dim="asset" value={f.assetId || ""} onChange={(v) => set("assetId", v)} placeholder="كل الأصول" />}
                {has("assetCategory") && <DimSelect dim="assetCategory" value={f.assetCategory || ""} onChange={(v) => set("assetCategory", v)} placeholder="كل الفئات" />}
                {has("city") && <DimSelect dim="city" value={f.city || ""} onChange={(v) => set("city", v)} placeholder="كل المدن" />}
                {has("currency") && <DimSelect dim="currency" value={f.currency || ""} onChange={(v) => set("currency", v)} placeholder="كل العملات" />}
                {def.filters.filter((k) => MULTI.has(k) && OPTS[k]).map((k) => <MultiSelect key={k} label={LABEL[k] || k} options={OPTS[k]} value={f[k] || ""} onChange={(v) => set(k, v)} />)}
                {has("days") && <label className="rc-f"><span>خلال</span><Input type="number" value={f.days || "90"} onChange={(e) => set("days", e.target.value)} style={{ width: 80 }} /><span>يوم</span></label>}
                {has("minTotal") && <Input type="number" placeholder="الإجمالي ≥" value={f.minTotal || ""} onChange={(e) => set("minTotal", e.target.value)} style={{ width: 120 }} />}
                {has("overdue") && <label className="check"><input type="checkbox" checked={f.overdue === "1"} onChange={(e) => set("overdue", e.target.checked ? "1" : "")} /> المتأخرة فقط</label>}
                {has("overdueOnly") && <label className="check"><input type="checkbox" checked={f.overdueOnly === "1"} onChange={(e) => set("overdueOnly", e.target.checked ? "1" : "")} /> المتأخرة فقط</label>}
                {has("nonzero") && <label className="check"><input type="checkbox" checked={f.nonzero === "1"} onChange={(e) => set("nonzero", e.target.checked ? "1" : "")} /> ذات الرصيد فقط</label>}
                {def.groupBy && def.groupBy.length > 1 && <label className="rc-f"><span>تجميع حسب</span><Select value={f.groupBy || def.groupBy[0].key} onChange={(e) => set("groupBy", e.target.value)}>{def.groupBy.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}</Select></label>}
                {has("q") && <Input placeholder="بحث نصي (في الاستعلام)" value={f.q || ""} onChange={(e) => set("q", e.target.value)} style={{ width: 170 }} />}
                <button className="btn primary" disabled={loading}>{loading ? "…" : "عرض التقرير"}</button>
                <button type="button" className="btn ghost sm" onClick={() => { const d = DEFAULTS(def); setF(d); setPickers({}); run(d); }}>إعادة الضبط</button>
              </form>
              <div className="print-only"><h2>{me.company.nameAr} — {def.title}</h2><div className="small">{f.from ? `من ${f.from} ` : ""}{f.to ? `إلى ${f.to}` : ""}{result?.meta?.note ? ` · ${result.meta.note}` : ""}</div></div>
              {loading && !result ? <Loading /> : !result ? null : (
                <>
                  {kpis.length > 0 && <div className="stmt-summary">{kpis.map((c) => <div key={c.key} className="box"><span>{c.label}</span><b className="num">{fmt(result.totals?.[c.key], c.type)}</b></div>)}<div className="box"><span>السجلات</span><b className="num">{rows.length}</b></div></div>}
                  {result.meta?.note && <div className="alert info small no-print">{result.meta.note}</div>}
                  {chartKey && showChart && rows.length > 1 && rows.length <= 60 && <div className="rc-chart no-print"><BarChart data={srt.sorted.slice(0, 40)} keys={[chartKey]} labels={(r) => String(r[labelKey] ?? "").slice(0, 14)} /></div>}
                  <div className="toolbar no-print"><SearchBox value={text} onChange={setText} placeholder="تصفية النتائج المعروضة" />{chartKey && <label className="check"><input type="checkbox" checked={showChart} onChange={(e) => setShowChart(e.target.checked)} /> رسم بياني</label>}<span className="muted small">{rows.length} سجل{rows.length !== (result.rows || []).length ? ` من ${result.rows.length}` : ""} · اضغط على عنوان العمود للفرز</span></div>
                  {!rows.length ? <Empty text="لا توجد بيانات مطابقة للفلاتر" /> : (
                    <div className="table-wrap" style={{ maxHeight: "70vh" }}><table className="tbl compact rc-tbl"><thead><tr>{cols.map((c) => <Th key={c.key} k={c.key} s={srt} n={["money", "qty", "int", "pct"].includes(c.type || "")}>{c.label}</Th>)}</tr></thead>
                      <tbody>{srt.sorted.map((r, i) => <tr key={i} className={(r._link ? "clickable " : "") + (r._bold ? "group" : "")} onClick={() => r._link && nav(r._link)}>{cols.map((c) => <td key={c.key} className={["money", "qty", "int", "pct"].includes(c.type || "") ? "n" : c.type === "date" || c.type === "datetime" ? "dt" : ""}>{fmt(r[c.key], c.type)}</td>)}</tr>)}</tbody>
                      {result.totals && Object.keys(result.totals).length > 0 && <tfoot><tr>{cols.map((c, i) => <td key={c.key} className={c.sum || result.totals[c.key] !== undefined ? "n" : ""}>{i === 0 ? `الإجمالي (${rows.length})` : result.totals[c.key] !== undefined && (c.sum || c.type === "pct") ? fmt(text ? (c.sum ? rows.reduce((a, r) => a + Number(r[c.key] || 0), 0) : result.totals[c.key]) : result.totals[c.key], c.type) : ""}</td>)}</tr></tfoot>}
                    </table></div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
