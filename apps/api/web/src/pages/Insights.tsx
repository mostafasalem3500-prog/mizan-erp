/** Management dashboard: KPIs against the previous period, sales / purchases / stock / receivables analysis, alerts and findings. */
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CUR } from "../shared/country";
import { q, useFetch, money, Loading, Empty, DateRange, Select, ExportBtn, PrintBtn, today, monthStart, yearStart, useTabParam, useCompanyContext } from "../lib";

import { TargetCard } from "./Learn";
const f0 = (v: any) => Number(v || 0).toLocaleString("en", { maximumFractionDigits: 0 });
const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const CH: Record<string, string> = { POS: "نقطة البيع", SALES: "الفواتير", SALLA: "سلة", ZID: "زد", API: "الربط" };
const PM: Record<string, string> = { CASH: "نقدي", CARD: "شبكة/بطاقة", BANK: "تحويل", CREDIT: "آجل", CHEQUE: "شيك" };
const shift = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

function Delta({ v, goodUp = true }: { v: number | null | undefined; goodUp?: boolean }) {
  if (v === null || v === undefined) return <span className="muted small">جديد</span>;
  if (!v) return <span className="muted small">• 0%</span>;
  return <span className={"small " + ((v > 0) === goodUp ? "pos-val" : "neg-val")} title="مقارنة بالفترة السابقة المماثلة">{v > 0 ? "▲" : "▼"} {Math.abs(v)}%</span>;
}
function Kpi({ label, value, delta, goodUp, sub, tone }: { label: string; value: React.ReactNode; delta?: number | null; goodUp?: boolean; sub?: React.ReactNode; tone?: string }) {
  return <div className={"card kpi" + (tone ? " " + tone : "")}><div className="label">{label}</div><div className="value num">{value}</div><div className="row between">{sub ? <span className="small muted">{sub}</span> : <span />}{delta !== undefined && <Delta v={delta} goodUp={goodUp} />}</div></div>;
}
/** Area + line for a daily series; a second series as a thin line. */
function Trend({ data, a, b, la, lb }: { data: any[]; a: string; b?: string; la: string; lb?: string }) {
  if (data.length < 2) return <Empty text="لا توجد بيانات كافية للرسم في هذه الفترة" />;
  const W = 900, H = 220, P = { l: 8, r: 8, t: 12, b: 24 };
  const max = Math.max(1, ...data.map((d) => Math.max(d[a], b ? d[b] : 0))), min = Math.min(0, ...data.map((d) => Math.min(d[a], b ? d[b] : 0)));
  const x = (i: number) => P.l + (i * (W - P.l - P.r)) / (data.length - 1), y = (v: number) => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
  const line = (k: string) => data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(" ");
  const step = Math.ceil(data.length / 8);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 220 }} role="img" aria-label={la}>
        {[0, 0.5, 1].map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={y(min + t * (max - min))} y2={y(min + t * (max - min))} stroke="var(--border)" strokeDasharray="3 4" /><text x={W - P.r} y={y(min + t * (max - min)) - 3} fontSize="10" fill="var(--muted)" textAnchor="end">{f0(min + t * (max - min))}</text></g>)}
        <path d={`${line(a)} L${x(data.length - 1)},${y(min)} L${x(0)},${y(min)} Z`} fill="var(--primary)" opacity=".12" />
        <path d={line(a)} fill="none" stroke="var(--primary)" strokeWidth="2.2" />
        {b && <path d={line(b)} fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeDasharray="5 4" />}
        {data.map((d, i) => <g key={i}><circle cx={x(i)} cy={y(d[a])} r={data.length > 40 ? 0 : 2.6} fill="var(--primary)" /><rect x={x(i) - (W / data.length) / 2} y={0} width={W / data.length} height={H} fill="transparent"><title>{`${d.d}\n${la}: ${f0(d[a])}${b ? `\n${lb}: ${f0(d[b])}` : ""}`}</title></rect>
          {i % step === 0 && <text x={x(i)} y={H - 6} fontSize="10" fill="var(--muted)" textAnchor="middle">{d.d.slice(5)}</text>}</g>)}
      </svg>
      <div className="row small muted" style={{ justifyContent: "center", gap: 18 }}><span><i className="lg-dot" style={{ background: "var(--primary)" }} /> {la}</span>{b && <span><i className="lg-dot" style={{ background: "var(--accent)" }} /> {lb}</span>}</div>
    </div>
  );
}
/** Ranked horizontal bars with the value at the end. */
function Bars({ rows, label, value, fmt = f0, link, sub, color = "var(--primary)" }: { rows: any[]; label: (r: any) => string; value: (r: any) => number; fmt?: (v: number) => string; link?: (r: any) => string | null; sub?: (r: any) => string; color?: string }) {
  if (!rows.length) return <Empty text="لا توجد بيانات" />;
  const max = Math.max(1, ...rows.map((r) => Math.abs(value(r))));
  return <div className="hbars">{rows.map((r, i) => { const v = value(r); const l = link?.(r); return (
    <div key={i} className="hbar"><div className="t">{l ? <Link to={l}>{label(r)}</Link> : label(r)}{sub && <span className="small muted"> · {sub(r)}</span>}</div>
      <div className="b"><i style={{ width: `${(Math.abs(v) / max) * 100}%`, background: v < 0 ? "var(--danger)" : color }} /></div><div className="v num">{fmt(v)}</div></div>); })}</div>;
}
function Cols({ rows, label, value }: { rows: { k: any; v: number; n?: number }[]; label: (k: any) => string; value?: string }) {
  if (!rows.length) return <Empty text="لا توجد بيانات" />;
  const max = Math.max(1, ...rows.map((r) => r.v));
  return <div className="vcols">{rows.map((r) => <div key={r.k} className="vcol" title={`${label(r.k)}: ${f0(r.v)}${r.n !== undefined ? ` — ${r.n} فاتورة` : ""}`}><div className="bar"><i style={{ height: `${(r.v / max) * 100}%` }} /></div><div className="l">{label(r.k)}</div></div>)}</div>;
}
function Aging({ a, title }: { a: any; title: string }) {
  const parts = [["جارية", a.current, "var(--success)"], ["1–30", a.d30, "#eab308"], ["31–60", a.d60, "#f97316"], ["61–90", a.d90, "#ef4444"], ["+90", a.d90p, "#991b1b"]] as const;
  return (
    <div className="card"><div className="card-h"><h3>{title}</h3><b className="num">{money(a.total)}</b></div><div className="card-b">
      {a.total > 0 ? <><div className="stackbar">{parts.filter((p) => p[1] > 0).map((p) => <i key={p[0]} style={{ width: `${(p[1] / a.total) * 100}%`, background: p[2] }} title={`${p[0]}: ${f0(p[1])}`} />)}</div>
        <div className="row small" style={{ gap: 14, marginTop: 8 }}>{parts.map((p) => <span key={p[0]}><i className="lg-dot" style={{ background: p[2] }} /> {p[0]} يوم: <b className="num">{f0(p[1])}</b></span>)}</div>
        <div className="small muted mt">المتأخر <b className="num neg-val">{f0(a.overdue)}</b> في {a.overdueDocs} فاتورة · يستحق خلال 30 يوماً <b className="num">{f0(a.dueIn30)}</b></div>
        <table className="tbl compact mt"><thead><tr><th>الطرف</th><th className="n">المتأخر</th><th className="n">الرصيد</th><th className="n">أقدم تأخير</th></tr></thead><tbody>{a.top.map((x: any) => <tr key={x.id}><td>{x.name}</td><td className="n num neg-val">{x.overdue ? f0(x.overdue) : ""}</td><td className="n num">{f0(x.open)}</td><td className="n num">{x.maxAge ? `${x.maxAge} يوم` : "—"}</td></tr>)}</tbody></table></> : <Empty text="لا توجد أرصدة مفتوحة" />}
    </div></div>);
}
const ProdTable = ({ rows, name }: { rows: any[]; name: string }) => !rows.length ? <Empty text="لا توجد مبيعات أصناف في الفترة" /> : (
  <div className="table-wrap"><table className="tbl compact"><thead><tr><th>#</th><th>الصنف</th><th>التصنيف</th><th className="n">الكمية</th><th className="n">المبيعات</th><th className="n">الربح</th><th className="n">الهامش</th><th>الفئة</th></tr></thead>
    <tbody>{rows.map((p, i) => <tr key={p.id}><td className="num muted">{i + 1}</td><td><Link to={`/products/${p.id}`}>{p.name}</Link></td><td className="small">{p.category}</td><td className="n num">{f0(p.qty)}</td><td className="n num">{money(p.net)}</td><td className={"n num " + (p.profit < 0 ? "neg-val" : "")}>{money(p.profit)}</td><td className={"n num " + (p.margin < 0 ? "neg-val" : p.margin < 10 ? "" : "pos-val")}>{p.margin}%</td><td>{p.abc && <span className={"badge " + (p.abc === "A" ? "green" : p.abc === "B" ? "blue" : "gray")}>{p.abc}</span>}</td></tr>)}</tbody></table></div>);
const StockTable = ({ rows, cols }: { rows: any[]; cols: ("qty" | "reorder" | "daily" | "cover" | "value" | "lastSale")[] }) => !rows.length ? <Empty text="لا يوجد ✓" /> : (
  <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الصنف</th>{cols.map((c) => <th key={c} className="n">{({ qty: "الرصيد", reorder: "حد الطلب", daily: "بيع يومي", cover: "يكفي (يوم)", value: "القيمة", lastSale: "آخر بيع" } as any)[c]}</th>)}</tr></thead>
    <tbody>{rows.map((x) => <tr key={x.id}><td><Link to={`/products/${x.id}`}>{x.name}</Link> <span className="small muted num">{x.sku}</span></td>{cols.map((c) => <td key={c} className="n num">{c === "value" ? money(x.value) : c === "cover" ? (x.cover ?? "—") : c === "lastSale" ? (x.lastSale || "لا يوجد") : c === "daily" ? x.daily : f0(x[c])}</td>)}</tr>)}</tbody></table></div>);

const PRESETS: [string, () => [string, string]][] = [
  ["اليوم", () => [today(), today()]], ["أمس", () => [shift(today(), -1), shift(today(), -1)]], ["آخر 7 أيام", () => [shift(today(), -6), today()]], ["هذا الشهر", () => [monthStart(), today()]],
  ["الشهر الماضي", () => { const e = shift(monthStart(), -1); return [e.slice(0, 8) + "01", e]; }], ["آخر 90 يوماً", () => [shift(today(), -89), today()]], ["هذه السنة", () => [yearStart(), today()]],
];

export function InsightsPage() {
  const { me } = useCompanyContext();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [branchId, setBranchId] = useState("");
  const [tab, setTab] = useTabParam("overview");
  const branches = useFetch<any[]>("/branches");
  const { data: d, loading } = useFetch<any>(`/analytics/executive${q({ from, to, branchId })}`, [from, to, branchId]);
  const alertsBy = useMemo(() => ({ danger: (d?.alerts || []).filter((a: any) => a.level === "danger").length, warn: (d?.alerts || []).filter((a: any) => a.level === "warn").length }), [d]);
  if (loading && !d) return <Loading />;
  if (!d) return <Empty text="تعذّر تحميل التحليل" />;
  const k = d.kpis, c = d.change, inv = d.inventory;
  const TABS = [["overview", "نظرة عامة"], ["sales", "المبيعات والأصناف"], ["purchases", "المشتريات والمصروفات"], ["stock", `المخزون${inv.counts.outOfStock + inv.counts.belowReorder ? ` (${inv.counts.outOfStock + inv.counts.belowReorder})` : ""}`], ["money", "الذمم والسيولة"], ["alerts", `التنبيهات (${d.alerts.length})`]];
  return (
    <div className="grid insights">
      <div className="card no-print"><div className="card-b row" style={{ gap: 8 }}>
        {PRESETS.map(([l, fn]) => { const [a, b] = fn(); return <button key={l} className={"btn sm" + (a === from && b === to ? " primary" : "")} onClick={() => { setFrom(a); setTo(b); }}>{l}</button>; })}
        <DateRange from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} />
        {!me.lockedBranch && (branches.data?.length || 0) > 1 && <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={{ width: "auto" }}><option value="">كل الفروع</option>{branches.data!.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}
        <div className="grow" /><span className="small muted">مقارنةً بـ <span className="num">{d.period.prevFrom} → {d.period.prevTo}</span> · المبالغ قبل الضريبة ({CUR()})</span><PrintBtn pdfName="لوحة الإدارة" />
      </div></div>
      <div className="tabs no-print">{TABS.map(([key, l]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{l}</button>)}</div>

      {tab === "overview" && <>
        <div className="kpis">
          <Kpi label="المبيعات" value={f0(k.sales)} delta={c.sales} sub={`${k.invoices} فاتورة`} tone="accent" />
          <Kpi label="مجمل الربح" value={f0(k.grossProfit)} delta={c.grossProfit} sub={`هامش ${k.margin}%`} />
          <Kpi label="المصروفات" value={f0(k.expenses)} delta={c.expenses} goodUp={false} sub={`${k.expenseCount} سند`} />
          <Kpi label="صافي الربح التشغيلي" value={<span className={k.netProfit < 0 ? "neg-val" : ""}>{f0(k.netProfit)}</span>} delta={c.netProfit} />
          <Kpi label="متوسط الفاتورة" value={f0(k.avgTicket)} delta={c.avgTicket} sub={`${k.customers} عميل`} />
          <Kpi label="المشتريات" value={f0(k.purchases)} delta={c.purchases} goodUp={false} sub={`${k.purchaseInvoices} فاتورة`} />
          <Kpi label="المحصّل من العملاء" value={f0(k.collected)} delta={c.collected} sub={`المدفوع للموردين ${f0(k.paid)}`} />
          <Kpi label="النقدية والبنوك" value={f0(d.cash.total)} sub={`متوقع بعد 30 يوماً ${f0(d.forecast.projected)}`} />
        </div>
        <TargetCard />
        <div className="grid cols-2">
          <div className="card"><div className="card-h"><h3>🧠 قراءة الفترة</h3></div><div className="card-b">{d.insights.length ? <ul className="ins-list">{d.insights.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul> : <Empty text="لا توجد حركة في الفترة" />}</div></div>
          <div className="card"><div className="card-h"><h3>🔔 أهم التنبيهات</h3><button className="btn sm ghost" onClick={() => setTab("alerts")}>الكل ({d.alerts.length})</button></div><div className="card-b">{d.alerts.length ? d.alerts.slice(0, 6).map((a: any, i: number) => <AlertRow key={i} a={a} />) : <div className="alert ok">لا توجد تنبيهات ✓</div>}</div></div>
        </div>
        <div className="card"><div className="card-h"><h3>المبيعات والربح اليومي</h3></div><div className="card-b"><Trend data={d.daily} a="sales" b="profit" la="المبيعات" lb="مجمل الربح" /></div></div>
        <div className="grid cols-2">
          <div className="card"><div className="card-h"><h3>الأكثر مبيعاً</h3><button className="btn sm ghost" onClick={() => setTab("sales")}>التفاصيل</button></div><div className="card-b"><Bars rows={d.topProducts.slice(0, 8)} label={(r) => r.name} value={(r) => r.net} sub={(r) => `${f0(r.qty)} وحدة`} link={(r) => `/products/${r.id}`} /></div></div>
          <div className="card"><div className="card-h"><h3>أكبر العملاء</h3></div><div className="card-b"><Bars rows={d.topCustomers.slice(0, 8)} label={(r) => r.name} value={(r) => r.v} sub={(r) => `${r.n} فاتورة`} link={(r) => `/customers/${r.id}`} color="var(--info)" /></div></div>
        </div>
      </>}

      {tab === "sales" && <>
        <div className="kpis">
          <Kpi label="صافي المبيعات" value={f0(k.sales)} delta={c.sales} tone="accent" />
          <Kpi label="تكلفة المبيعات" value={f0(k.cost)} delta={c.cost} goodUp={false} />
          <Kpi label="هامش مجمل الربح" value={`${k.margin}%`} sub={`كان ${d.prev.margin}%`} />
          <Kpi label="المرتجعات" value={f0(k.returns)} delta={c.returns} goodUp={false} />
          <Kpi label="الخصومات الممنوحة" value={f0(k.discounts)} delta={c.discounts} goodUp={false} />
          <Kpi label="أصناف مباعة" value={d.productsSold} sub={`A ${d.abc.A.n} · B ${d.abc.B.n} · C ${d.abc.C.n}`} />
        </div>
        <div className="card"><div className="card-h"><h3>الأصناف الأكثر مبيعاً (بالقيمة)</h3><ExportBtn name="الأكثر مبيعاً" rows={() => d.topProducts.map((p: any) => ({ الصنف: p.name, الرمز: p.sku, التصنيف: p.category, الكمية: p.qty, المبيعات: p.net, الربح: p.profit, "الهامش %": p.margin, "فئة ABC": p.abc }))} /></div><ProdTable rows={d.topProducts} name="top" />
          <div className="card-b small muted">تحليل ABC: فئة <b>A</b> أصناف تحقق أول 80% من الإيراد ({d.abc.A.n} صنف — {f0(d.abc.A.v)})، <b>B</b> التالية 15% ({d.abc.B.n})، <b>C</b> الباقي ({d.abc.C.n}).</div></div>
        <div className="grid cols-2">
          <div className="card"><div className="card-h"><h3>الأكثر مبيعاً بالكمية</h3></div><div className="card-b"><Bars rows={d.topByQty} label={(r) => r.name} value={(r) => r.qty} link={(r) => `/products/${r.id}`} /></div></div>
          <div className="card"><div className="card-h"><h3>الأعلى ربحاً</h3></div><div className="card-b"><Bars rows={d.topByProfit} label={(r) => r.name} value={(r) => r.profit} sub={(r) => `${r.margin}%`} link={(r) => `/products/${r.id}`} color="var(--success)" /></div></div>
          <div className="card"><div className="card-h"><h3>الأقل هامشاً</h3></div><div className="card-b"><Bars rows={d.lowMargin} label={(r) => r.name} value={(r) => r.margin} fmt={(v) => `${v}%`} link={(r) => `/products/${r.id}`} color="var(--accent)" /></div></div>
          <div className="card"><div className="card-h"><h3>المبيعات حسب التصنيف</h3></div><div className="card-b"><Bars rows={d.categories.slice(0, 10)} label={(r) => r.k} value={(r) => r.v} sub={(r) => `ربح ${f0(r.profit)}`} color="var(--info)" /></div></div>
          <div className="card"><div className="card-h"><h3>المبيعات حسب أيام الأسبوع</h3></div><div className="card-b"><Cols rows={d.byWeekday} label={(x) => DAYS[x]} /></div></div>
          <div className="card"><div className="card-h"><h3>المبيعات حسب الساعة</h3></div><div className="card-b"><Cols rows={d.byHour} label={(x) => `${x}`} /></div></div>
          <div className="card"><div className="card-h"><h3>قنوات البيع</h3></div><div className="card-b"><Bars rows={d.byChannel} label={(r) => CH[r.k] || r.k} value={(r) => r.v} sub={(r) => `${r.n} فاتورة`} /></div></div>
          <div className="card"><div className="card-h"><h3>طرق الدفع</h3></div><div className="card-b"><Bars rows={d.payMethods} label={(r) => PM[r.k] || r.k} value={(r) => r.v} color="var(--info)" /></div></div>
        </div>
        <div className="card"><div className="card-h"><h3>أكبر العملاء</h3></div><div className="table-wrap"><table className="tbl compact"><thead><tr><th>العميل</th><th className="n">الفواتير</th><th className="n">المبيعات</th><th className="n">الربح</th><th className="n">الحصة</th></tr></thead><tbody>{d.topCustomers.map((x: any) => <tr key={x.id}><td><Link to={`/customers/${x.id}`}>{x.name}</Link></td><td className="n num">{x.n}</td><td className="n num">{money(x.v)}</td><td className="n num">{money(x.profit)}</td><td className="n num">{k.sales ? Math.round((x.v / k.sales) * 100) : 0}%</td></tr>)}</tbody></table></div></div>
      </>}

      {tab === "purchases" && <>
        <div className="kpis"><Kpi label="المشتريات" value={f0(k.purchases)} delta={c.purchases} goodUp={false} sub={`${k.purchaseInvoices} فاتورة`} tone="accent" /><Kpi label="المدفوع للموردين" value={f0(k.paid)} delta={c.paid} goodUp={false} /><Kpi label="المصروفات" value={f0(k.expenses)} delta={c.expenses} goodUp={false} /><Kpi label="مستحقات الموردين" value={f0(d.payables.total)} sub={`متأخر ${f0(d.payables.overdue)}`} /></div>
        <div className="card"><div className="card-h"><h3>المشتريات اليومية</h3></div><div className="card-b"><Trend data={d.daily} a="purchases" b="sales" la="المشتريات" lb="المبيعات" /></div></div>
        <div className="grid cols-2">
          <div className="card"><div className="card-h"><h3>أكبر الموردين</h3></div><div className="card-b"><Bars rows={d.topSuppliers} label={(r) => r.name} value={(r) => r.v} sub={(r) => `${r.n} فاتورة`} link={(r) => `/suppliers/${r.id}`} /></div></div>
          <div className="card"><div className="card-h"><h3>المصروفات حسب البند</h3></div><div className="card-b"><Bars rows={d.expByAccount} label={(r) => r.k} value={(r) => r.v} color="var(--accent)" /></div></div>
        </div>
        <div className="card"><div className="card-h"><h3>الأصناف الأكثر شراءً وتذبذب سعرها</h3></div>{d.topPurchased.length ? <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الصنف</th><th className="n">الكمية</th><th className="n">القيمة</th><th className="n">أدنى سعر</th><th className="n">أعلى سعر</th><th className="n">الفرق</th></tr></thead><tbody>{d.topPurchased.map((x: any) => <tr key={x.id}><td><Link to={`/products/${x.id}`}>{x.name}</Link></td><td className="n num">{f0(x.qty)}</td><td className="n num">{money(x.v)}</td><td className="n num">{money(x.minPrice)}</td><td className="n num">{money(x.maxPrice)}</td><td className={"n num " + (x.minPrice && x.maxPrice / x.minPrice > 1.1 ? "neg-val" : "")}>{x.minPrice ? `${Math.round((x.maxPrice / x.minPrice - 1) * 100)}%` : "—"}</td></tr>)}</tbody></table></div> : <Empty text="لا توجد مشتريات أصناف في الفترة" />}</div>
        {d.anomalies.duplicateBills.length > 0 && <div className="card"><div className="card-h"><h3>⚠ فواتير موردين مكررة محتملة</h3></div><table className="tbl compact"><thead><tr><th>المورد</th><th>رقم فاتورة المورد</th><th className="n">مرات التسجيل</th><th className="n">الإجمالي</th></tr></thead><tbody>{d.anomalies.duplicateBills.map((x: any, i: number) => <tr key={i}><td>{x.name}</td><td className="num">{x.ref}</td><td className="n num">{x.n}</td><td className="n num">{money(x.total)}</td></tr>)}</tbody></table></div>}
      </>}

      {tab === "stock" && <>
        <div className="kpis"><Kpi label="قيمة المخزون" value={f0(inv.value)} sub={`${inv.skus} صنف`} tone="accent" /><Kpi label="نافد ومطلوب" value={<span className={inv.counts.outOfStock ? "neg-val" : ""}>{inv.counts.outOfStock}</span>} /><Kpi label="عند حد إعادة الطلب" value={inv.counts.belowReorder} /><Kpi label="يكفي أقل من أسبوع" value={inv.counts.runningOut} /><Kpi label="راكد (90 يوماً)" value={inv.counts.dead} sub={`بقيمة ${f0(inv.deadValue)}`} /><Kpi label="دفعات تنتهي خلال 60 يوماً" value={inv.counts.expiring} /></div>
        <div className="row no-print"><Link className="btn primary sm" to="/reorder">🔔 إنشاء أوامر الشراء المقترحة</Link><Link className="btn sm" to="/lots">⏳ الدفعات والصلاحية</Link><Link className="btn sm" to="/inventory">تقييم المخزون</Link></div>
        <div className="grid cols-2">
          <div className="card"><div className="card-h"><h3>🔴 نافد وعليه طلب</h3></div><StockTable rows={inv.outOfStock} cols={["qty", "daily", "lastSale"]} /></div>
          <div className="card"><div className="card-h"><h3>🟠 عند حد إعادة الطلب</h3></div><StockTable rows={inv.belowReorder} cols={["qty", "reorder", "cover"]} /></div>
          <div className="card"><div className="card-h"><h3>🟡 يكفي أقل من أسبوع</h3></div><StockTable rows={inv.runningOut} cols={["qty", "daily", "cover"]} /></div>
          <div className="card"><div className="card-h"><h3>⚪ راكد بلا بيع منذ 90 يوماً</h3></div><StockTable rows={inv.dead} cols={["qty", "value", "lastSale"]} /></div>
          <div className="card"><div className="card-h"><h3>📦 مخزون زائد (يكفي أكثر من 6 أشهر)</h3></div><StockTable rows={inv.overstock} cols={["qty", "cover", "value"]} /></div>
          <div className="card"><div className="card-h"><h3>⏳ دفعات قاربت الانتهاء</h3></div>{inv.expiring.length ? <table className="tbl compact"><thead><tr><th>الصنف</th><th>الدفعة</th><th className="n">الكمية</th><th className="n">الانتهاء</th><th className="n">متبقٍ</th></tr></thead><tbody>{inv.expiring.map((x: any, i: number) => <tr key={i}><td>{x.name}</td><td className="num small">{x.lotNo}</td><td className="n num">{f0(x.qty)}</td><td className="n num">{x.expiry}</td><td className={"n num " + (x.days < 0 ? "neg-val" : "")}>{x.days < 0 ? "منتهية" : `${x.days} يوم`}</td></tr>)}</tbody></table> : <Empty text="لا يوجد ✓" />}</div>
        </div>
      </>}

      {tab === "money" && <>
        <div className="kpis"><Kpi label="النقدية والبنوك" value={f0(d.cash.total)} tone="accent" /><Kpi label="تحصيل متوقع (30 يوماً)" value={f0(d.forecast.inflow30)} /><Kpi label="سداد مستحق (30 يوماً)" value={f0(d.forecast.outflow30)} /><Kpi label="السيولة المتوقعة" value={<span className={d.forecast.projected < 0 ? "neg-val" : "pos-val"}>{f0(d.forecast.projected)}</span>} sub="النقد + التحصيل − السداد" /></div>
        <div className="grid cols-2"><Aging a={d.receivables} title="ذمم العملاء وأعمارها" /><Aging a={d.payables} title="مستحقات الموردين وأعمارها" /></div>
        <div className="card"><div className="card-h"><h3>أرصدة الصناديق والبنوك</h3></div><div className="card-b"><Bars rows={d.cash.accounts} label={(r) => r.name} value={(r) => r.balance} fmt={(v) => money(v)} /></div></div>
        {d.anomalies.overLimit.length > 0 && <div className="card"><div className="card-h"><h3>عملاء تجاوزوا حد الائتمان</h3></div><table className="tbl compact"><thead><tr><th>العميل</th><th className="n">الحد</th><th className="n">الرصيد</th></tr></thead><tbody>{d.anomalies.overLimit.map((x: any) => <tr key={x.id}><td><Link to={`/customers/${x.id}`}>{x.name}</Link></td><td className="n num">{money(x.limit)}</td><td className="n num neg-val">{money(x.open)}</td></tr>)}</tbody></table></div>}
      </>}

      {tab === "alerts" && <div className="card"><div className="card-h"><h3>التنبيهات والملاحظات</h3><span className="small muted">{alertsBy.danger} عاجل · {alertsBy.warn} يحتاج متابعة</span></div><div className="card-b">{d.alerts.length ? d.alerts.map((a: any, i: number) => <AlertRow key={i} a={a} />) : <div className="alert ok">لا توجد تنبيهات — كل شيء ضمن الحدود ✓</div>}
        {d.anomalies.belowCost.length > 0 && <><h3 className="mt">بنود بيعت بأقل من التكلفة</h3><table className="tbl compact"><thead><tr><th>الفاتورة</th><th>البند</th><th className="n">البيع</th><th className="n">التكلفة</th></tr></thead><tbody>{d.anomalies.belowCost.map((x: any, i: number) => <tr key={i}><td><Link to={`/doc/${x.id}`}>{x.number}</Link></td><td>{x.description}</td><td className="n num">{money(x.net)}</td><td className="n num neg-val">{money(x.cost)}</td></tr>)}</tbody></table></>}
      </div></div>}
    </div>
  );
}
function AlertRow({ a }: { a: any }) {
  return <div className={"alert small " + (a.level === "danger" ? "err" : a.level === "warn" ? "warn" : "info")} style={{ marginBottom: 6, display: "flex", gap: 8, alignItems: "center" }}><b>{a.area}</b><span className="grow">{a.text}</span>{a.to && <Link className="btn sm ghost no-print" to={a.to}>فتح ←</Link>}</div>;
}
