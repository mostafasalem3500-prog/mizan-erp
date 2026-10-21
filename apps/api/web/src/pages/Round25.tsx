/** Round 25 — financial analysis (program) and governance indicators (association). */
import React, { useState } from "react";
import { useFetch, Money, money, Loading, Empty, BarChart, PeriodFilter, PrintBtn, exportExcel, today, useCompanyContext } from "../lib";

const yStart = () => today().slice(0, 4) + "-01-01";
const ST: Record<string, { c: string; t: string }> = { good: { c: "#16a34a", t: "جيد" }, ok: { c: "#d97706", t: "مقبول" }, bad: { c: "#dc2626", t: "ضعيف" }, na: { c: "#94a3b8", t: "—" } };
const mLabel = (m: string) => ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"][Number(m.slice(5, 7)) - 1]?.slice(0, 3) + " " + m.slice(2, 4);

export function fmtVal(v: number | null, unit: string) {
  if (v === null || v === undefined) return "—";
  if (unit === "%") return `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  if (unit === "days") return `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })} يوم`;
  if (unit === "months") return `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })} شهر`;
  if (unit === "SAR") return `${money(v)} ر.س`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

/** Tiny dependency-free line chart (RTL-aware: latest month on the left like the bar charts). */
export function LineChart({ data, k, label, color = "var(--primary)", unit = "" }: { data: any[]; k: string; label: (d: any) => string; color?: string; unit?: string }) {
  const vals = data.map((d) => (d[k] === null || d[k] === undefined ? null : Number(d[k])));
  const nums = vals.filter((v): v is number => v !== null);
  if (!nums.length) return <div className="empty">لا توجد بيانات</div>;
  const W = 600, H = 170, P = 26;
  const min = Math.min(0, ...nums), max = Math.max(...nums, min + 1);
  const x = (i: number) => W - P - (i * (W - 2 * P)) / Math.max(1, data.length - 1);
  const y = (v: number) => H - P - ((v - min) / (max - min)) * (H - 2 * P);
  const pts = vals.map((v, i) => (v === null ? null : [x(i), y(v)] as const)).filter(Boolean) as (readonly [number, number])[];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 180 }} role="img" aria-label={k}>
      <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="var(--border)" />
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
      {vals.map((v, i) => v === null ? null : <g key={i}><circle cx={x(i)} cy={y(v)} r={3.5} fill={color}><title>{`${label(data[i])}: ${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}${unit}`}</title></circle>
        <text x={x(i)} y={H - 6} fontSize={10} textAnchor="middle" fill="var(--muted)">{label(data[i])}</text></g>)}
      <text x={P} y={y(max) - 6} fontSize={10} fill="var(--muted)">{max.toLocaleString("en-US", { maximumFractionDigits: 0 })}{unit}</text>
    </svg>
  );
}

function Gauge({ v }: { v: number | null }) {
  const val = v ?? 0, ang = Math.PI * (1 - val / 100);
  const col = v === null ? "#94a3b8" : val >= 70 ? "#16a34a" : val >= 45 ? "#d97706" : "#dc2626";
  return (
    <svg viewBox="0 0 200 120" style={{ width: 200 }} role="img" aria-label={`المؤشر ${val}`}>
      <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="var(--border)" strokeWidth={16} strokeLinecap="round" />
      <path d={`M20 100 A80 80 0 0 1 ${100 + 80 * Math.cos(ang)} ${100 - 80 * Math.sin(ang)}`} fill="none" stroke={col} strokeWidth={16} strokeLinecap="round" />
      <text x={100} y={92} textAnchor="middle" fontSize={32} fontWeight={800} fill={col}>{v === null ? "—" : val}</text>
      <text x={100} y={114} textAnchor="middle" fontSize={11} fill="var(--muted)">من 100</text>
    </svg>
  );
}

function RatioCard({ title, rows }: { title: string; rows: any[] }) {
  return (
    <div className="card fa-card"><div className="card-h"><h3>{title}</h3></div><div className="card-b" style={{ padding: 0 }}>
      {rows.map((r) => <div key={r.key} className="fa-ratio">
        <div className="fa-top"><span className="fa-dot" style={{ background: ST[r.status].c }} title={ST[r.status].t} /><b>{r.name}</b><span className="grow" /><span className="fa-val" style={{ color: r.status === "bad" ? ST.bad.c : undefined }}>{fmtVal(r.value, r.unit)}</span></div>
        <div className="small muted">{r.formula} · المعيار: {r.benchmark}</div>
        <div className="small">{r.note}</div>
      </div>)}
    </div></div>
  );
}

export function FinancialAnalysisPage() {
  const { me } = useCompanyContext();
  const [from, setFrom] = useState(yStart());
  const [to, setTo] = useState(today());
  const { data: d, loading } = useFetch<any>(`/analysis/financial?from=${from}&to=${to}`);
  const groups = d ? [...new Set(d.ratios.map((r: any) => r.group))] as string[] : [];
  const xls = () => exportExcel(d.ratios.map((r: any) => ({ المجموعة: r.group, المؤشر: r.name, القيمة: r.value, الوحدة: r.unit, التقييم: ST[r.status].t, المعادلة: r.formula, المعيار: r.benchmark, التعليق: r.note })), `التحليل المالي ${from} ${to}`);
  return (
    <div className="grid">
      <div className="card no-print"><div className="card-h"><h3>📈 التحليل المالي والمؤشرات</h3><div className="row"><PeriodFilter from={from} to={to} onChange={(a, b) => { setFrom(a || yStart()); setTo(b || today()); }} />{d && <button className="btn sm" onClick={xls}>⬇ Excel</button>}<PrintBtn pdfName={`التحليل المالي ${from} – ${to}`} /></div></div></div>
      {loading && !d ? <Loading /> : !d ? <Empty text="تعذّر تحميل التحليل" /> : <div className="print-doc fa" style={{ maxWidth: "none", padding: 0, background: "transparent" }}>
        <div className="print-only"><h2 style={{ margin: 0 }}>{me.company.nameAr} — التحليل المالي</h2><div className="small">الفترة {d.from} – {d.to} ({d.days} يوماً) · المقارنة مع {d.prevFrom} – {d.prevTo}</div><hr /></div>
        <div className="grid fa-head">
          <div className="card"><div className="card-b row" style={{ gap: 18, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ textAlign: "center" }}><Gauge v={d.health} /><div className="small"><b>مؤشر الصحة المالية</b><div className="muted">السيولة 30 · الربحية 30 · الكفاءة 20 · الرفع 20</div></div></div>
            <div style={{ flex: 1, minWidth: 260 }}><h4 style={{ margin: "0 0 6px" }}>أبرز الملاحظات</h4><ul className="fa-ins">{d.insights.map((x: string, i: number) => <li key={i}>{x}</li>)}{!d.insights.length && <li className="muted">لا توجد ملاحظات للفترة</li>}</ul></div>
          </div></div>
          <div className="mini-kpis fa-kpis">
            <div><span>صافي المبيعات</span><b><Money v={d.summary.netSales} /></b>{d.growth.sales !== null && <small className={d.growth.sales >= 0 ? "pos-val" : "neg-val"}>{d.growth.sales >= 0 ? "▲" : "▼"} {Math.abs(d.growth.sales)}%</small>}</div>
            <div><span>مجمل الربح</span><b><Money v={d.summary.grossProfit} /></b></div>
            <div><span>صافي الربح</span><b className={d.summary.net < 0 ? "neg-val" : "pos-val"}><Money v={d.summary.net} /></b>{d.growth.net !== null && <small className={d.growth.net >= 0 ? "pos-val" : "neg-val"}>{d.growth.net >= 0 ? "▲" : "▼"} {Math.abs(d.growth.net)}%</small>}</div>
            <div><span>النقدية آخر الفترة</span><b><Money v={d.cash.closing} /></b></div>
            <div><span>رأس المال العامل</span><b><Money v={d.ratios.find((r: any) => r.key === "wc")?.value} /></b></div>
            <div><span>دورة التحويل النقدي</span><b>{fmtVal(d.ratios.find((r: any) => r.key === "ccc")?.value, "days")}</b></div>
          </div>
        </div>
        <div className="grid c2 mt">{groups.map((g) => <RatioCard key={g} title={g} rows={d.ratios.filter((r: any) => r.group === g)} />)}</div>
        <div className="grid c3 mt">
          <div className="card"><div className="card-h"><h3>تحليل ديبونت (DuPont)</h3></div><div className="card-b">
            <div className="fa-dupont"><div><span>هامش صافي الربح</span><b>{fmtVal(d.dupont.netMargin, "%")}</b></div><i>×</i><div><span>دوران الأصول</span><b>{fmtVal(d.dupont.assetTurnover, "x")}</b></div><i>×</i><div><span>مضاعف حقوق الملكية</span><b>{fmtVal(d.dupont.equityMultiplier, "x")}</b></div><i>=</i><div className="eq"><span>العائد على حقوق الملكية</span><b>{fmtVal(d.dupont.roe, "%")}</b></div></div>
            <div className="small muted mt">يفسّر مصدر العائد: الربحية، أو كفاءة استخدام الأصول، أو الاعتماد على الديون (سنوي).</div>
          </div></div>
          <div className="card"><div className="card-h"><h3>نقطة التعادل</h3></div><div className="card-b">
            {d.breakEven.breakEvenSales === null ? <div className="muted small">لا يمكن حسابها — هامش المساهمة غير موجب أو لا توجد مبيعات</div> : <>
              <div className="stat-list"><div className="item"><span>المصروفات الثابتة (التشغيلية)</span><b><Money v={d.breakEven.fixedCosts} /></b></div><div className="item"><span>نسبة هامش المساهمة</span><b>{d.breakEven.cmRatio}%</b></div><div className="item"><span>مبيعات التعادل للفترة</span><b><Money v={d.breakEven.breakEvenSales} /></b></div><div className="item"><span>مبيعات التعادل الشهرية</span><b><Money v={d.breakEven.breakEvenMonthly} /></b></div></div>
              <div className="fa-bar mt"><div style={{ width: `${Math.min(100, (d.breakEven.breakEvenSales / Math.max(d.summary.netSales, d.breakEven.breakEvenSales)) * 100)}%` }} /><span style={{ insetInlineStart: `${Math.min(100, (d.summary.netSales / Math.max(d.summary.netSales, d.breakEven.breakEvenSales)) * 100)}%` }} /></div>
              <div className={"small mt " + (d.breakEven.achieved ? "pos-val" : "neg-val")}>{d.breakEven.achieved ? `✓ هامش الأمان ${d.breakEven.marginOfSafety}% من المبيعات` : `المبيعات أقل من التعادل بـ ${money(d.breakEven.breakEvenSales - d.summary.netSales)} ر.س`}</div>
            </>}
            <div className="small muted mt">التكاليف المتغيرة = تكلفة المبيعات؛ الثابتة = المصروفات التشغيلية.</div>
          </div></div>
          <div className="card"><div className="card-h"><h3>التدفقات النقدية</h3></div><div className="card-b"><div className="stat-list">
            <div className="item"><span>رصيد أول الفترة</span><b><Money v={d.cash.opening} /></b></div>
            <div className="item"><span>من الأنشطة التشغيلية</span><b className={d.cash.operating < 0 ? "neg-val" : "pos-val"}><Money v={d.cash.operating} /></b></div>
            <div className="item"><span>من الأنشطة الاستثمارية</span><b><Money v={d.cash.investing} /></b></div>
            <div className="item"><span>من الأنشطة التمويلية</span><b><Money v={d.cash.financing} /></b></div>
            <div className="item"><span>رصيد آخر الفترة</span><b><Money v={d.cash.closing} /></b></div>
            <div className="item"><span>التدفق التشغيلي الشهري</span><b><Money v={d.cash.monthlyOperating} /></b></div>
            {d.cash.runwayMonths !== null && <div className="item"><span>النقدية تكفي بالمعدل الحالي</span><b className="neg-val">{d.cash.runwayMonths} شهر</b></div>}
          </div></div></div>
        </div>
        <div className="grid c2 mt">
          <div className="card"><div className="card-h"><h3>قائمة الدخل النسبية والمقارنة</h3><span className="small muted">مقابل {d.prevFrom} – {d.prevTo}</span></div><div className="table-wrap"><table className="tbl compact"><thead><tr><th>البند</th><th className="n">الفترة</th><th className="n">% من المبيعات</th><th className="n">السابقة</th><th className="n">%</th><th className="n">التغير</th></tr></thead>
            <tbody>{d.commonSize.map((r: any) => <tr key={r.name} className={["مجمل الربح", "الربح التشغيلي", "صافي الربح"].includes(r.name) ? "group" : ""}><td>{r.name}</td><td className="n"><Money v={r.current} /></td><td className="n">{r.currentPct === null ? "—" : r.currentPct + "%"}</td><td className="n"><Money v={r.previous} /></td><td className="n">{r.previousPct === null ? "—" : r.previousPct + "%"}</td><td className={"n " + (r.change === null ? "" : r.change >= 0 ? "pos-val" : "neg-val")}>{r.change === null ? "—" : `${r.change >= 0 ? "+" : ""}${r.change}%`}</td></tr>)}</tbody></table></div></div>
          <div className="card"><div className="card-h"><h3>أكبر بنود المصروفات التشغيلية</h3></div><div className="card-b">{!d.opexBreakdown.length ? <div className="muted small">لا توجد مصروفات تشغيلية</div> : d.opexBreakdown.map((o: any) => <div key={o.code} className="ch-bar"><span className="lbl">{o.name}</span><div className="trk"><div style={{ width: `${o.share}%` }} /></div><span className="v">{money(o.amount)} · {o.share}%</span></div>)}</div></div>
        </div>
        <div className="card mt"><div className="card-h"><h3>الاتجاه الشهري — آخر 12 شهراً</h3></div><div className="card-b grid c2">
          <div><BarChart data={d.months} keys={["sales", "grossProfit", "net"]} labels={(x) => mLabel(x.month)} colors={["var(--primary)", "var(--info)", "var(--accent)"]} /><div className="row small muted mt"><span>■ المبيعات</span><span style={{ color: "var(--info)" }}>■ مجمل الربح</span><span style={{ color: "var(--accent)" }}>■ صافي الربح</span></div></div>
          <div className="grid" style={{ gap: 4 }}><div className="small"><b>هامش مجمل الربح %</b></div><LineChart data={d.months} k="grossMargin" label={(x) => mLabel(x.month)} unit="%" /><div className="small"><b>رصيد النقدية آخر الشهر</b></div><LineChart data={d.months} k="cash" label={(x) => mLabel(x.month)} color="var(--info)" /></div>
        </div></div>
        <div className="grid c2 mt">
          <div className="card"><div className="card-h"><h3>تركّز العملاء</h3><span className="small muted">{d.concentration.customers} عميل</span></div><div className="card-b">
            <div className="mini-kpis mb"><div><span>أكبر عميل</span><b className={d.concentration.top1 >= 30 && d.concentration.customers > 3 ? "neg-val" : ""}>{d.concentration.top1}%</b></div><div><span>أكبر 5 عملاء</span><b className={d.concentration.top5 >= 60 && d.concentration.customers > 5 ? "neg-val" : ""}>{d.concentration.top5}%</b></div></div>
            <div className="table-wrap"><table className="tbl compact"><tbody>{d.concentration.topCustomers.map((c: any) => <tr key={c.name}><td>{c.name}</td><td className="n"><Money v={c.sales} /></td><td className="n">{c.share}%</td></tr>)}{!d.concentration.topCustomers.length && <tr><td className="muted">لا توجد مبيعات</td></tr>}</tbody></table></div>
          </div></div>
          <div className="card"><div className="card-h"><h3>تحليل ABC للأصناف</h3><span className="small muted">A = أعلى 80% من المبيعات</span></div><div className="card-b">
            <div className="mini-kpis mb">{d.concentration.abcSummary.map((s: any) => <div key={s.class}><span>الفئة {s.class} ({s.count} صنف)</span><b><Money v={s.sales} /></b></div>)}</div>
            <div className="table-wrap" style={{ maxHeight: 320 }}><table className="tbl compact"><thead><tr><th>الصنف</th><th>الفئة</th><th className="n">المبيعات</th><th className="n">الهامش</th><th className="n">التراكمي</th></tr></thead>
              <tbody>{d.concentration.abc.map((p: any) => <tr key={p.name}><td>{p.name}</td><td><span className={"badge " + (p.class === "A" ? "green" : p.class === "B" ? "amber" : "gray")}>{p.class}</span></td><td className="n"><Money v={p.sales} /></td><td className={"n " + (p.margin !== null && p.margin < 10 ? "neg-val" : "")}>{p.margin === null ? "—" : p.margin + "%"}</td><td className="n">{p.cumulative}%</td></tr>)}</tbody></table></div>
          </div></div>
        </div>
        <div className="small muted mt">تُحسب المؤشرات من القيود المرحّلة. معدلات الأيام تستخدم متوسط رصيد أول الفترة وآخرها؛ العائد ودوران الأصول محوّلة لمعدل سنوي. المعايير استرشادية وتختلف حسب النشاط.</div>
      </div>}
    </div>
  );
}

export function CharityIndicatorsPage({ settings }: { settings?: any }) {
  const [from, setFrom] = useState(yStart());
  const [to, setTo] = useState(today());
  const { data: d, loading } = useFetch<any>(`/charity/indicators?from=${from}&to=${to}`);
  const groups = d ? [...new Set(d.indicators.map((r: any) => r.group))] as string[] : [];
  return (
    <div className="grid">
      <div className="card no-print"><div className="card-h"><h3>📊 مؤشرات الأداء والحوكمة المالية</h3><div className="row"><PeriodFilter from={from} to={to} onChange={(a, b) => { setFrom(a || yStart()); setTo(b || today()); }} />{d && <button className="btn sm" onClick={() => exportExcel(d.indicators.map((r: any) => ({ المجموعة: r.group, المؤشر: r.name, القيمة: r.value, التقييم: ST[r.status].t, المعادلة: r.formula, المعيار: r.benchmark, التعليق: r.note })), "مؤشرات الجمعية")}>⬇ Excel</button>}<PrintBtn pdfName={`مؤشرات الجمعية ${from} – ${to}`} /></div></div></div>
      {loading && !d ? <Loading /> : !d ? <Empty text="تعذّر تحميل المؤشرات" /> : <div className="print-doc fa" style={{ maxWidth: "none", padding: 0, background: "transparent" }}>
        <div className="print-only"><div className="row"><img className="ch-print-logo" src={settings?.logoUrl} alt="" /><div><h2 style={{ margin: 0 }}>{settings?.associationName}</h2><div className="small">مؤشرات الأداء والحوكمة المالية · {d.from} – {d.to}</div></div></div><hr /></div>
        <div className="mini-kpis">
          <div><span>إجمالي الإيرادات</span><b className="pos-val"><Money v={d.totals.revenue} /></b></div>
          <div><span>إجمالي المصروفات</span><b><Money v={d.totals.expenses} /></b></div>
          <div><span>الفائض / العجز</span><b className={d.totals.surplus < 0 ? "neg-val" : "pos-val"}><Money v={d.totals.surplus} /></b></div>
          <div><span>المتبرعون ({d.totals.newDonors} جديد)</span><b>{d.totals.donors}</b></div>
          <div><span>المستفيدون المخدومون</span><b>{d.totals.beneficiaries}</b></div>
          <div><span>النقدية والبنوك</span><b><Money v={d.totals.cash} /></b></div>
        </div>
        <div className="grid c3 mt">{groups.map((g) => <RatioCard key={g} title={g} rows={d.indicators.filter((r: any) => r.group === g)} />)}</div>
        <div className="grid c2 mt">
          <div className="card"><div className="card-h"><h3>مصادر الإيرادات</h3></div><div className="card-b">{d.revenueMix.map((r: any) => <div key={r.source} className="ch-bar"><span className="lbl">{r.source}</span><div className="trk"><div style={{ width: `${r.share}%` }} /></div><span className="v">{money(r.amount)} · {r.share}%</span></div>)}{!d.revenueMix.length && <div className="muted small">لا توجد إيرادات</div>}</div></div>
          <div className="card"><div className="card-h"><h3>توزيع المصروفات</h3><span className="small muted">■ برامج ومساعدات · ■ إدارية</span></div><div className="card-b">{d.expenseMix.map((r: any) => <div key={r.name} className="ch-bar"><span className="lbl">{r.name}</span><div className="trk"><div className={r.program ? "" : "gold"} style={{ width: `${r.share}%` }} /></div><span className="v">{money(r.amount)} · {r.share}%</span></div>)}{!d.expenseMix.length && <div className="muted small">لا توجد مصروفات</div>}</div></div>
        </div>
        <div className="card mt"><div className="card-h"><h3>الاتجاه الشهري — آخر 12 شهراً</h3></div><div className="card-b"><BarChart data={d.months} keys={["donations", "aid", "admin"]} labels={(x) => mLabel(x.month)} colors={["var(--primary)", "var(--info)", "var(--accent)"]} /><div className="row small muted mt"><span>■ التبرعات</span><span style={{ color: "var(--info)" }}>■ المساعدات</span><span style={{ color: "var(--accent)" }}>■ المصروفات الإدارية</span></div></div></div>
        <div className="small muted mt">مصروفات البرامج = حسابات مجموعة 55 (المساعدات والبرامج والأنشطة والكفالات)؛ ما عداها إداري وعمومي. المعايير استرشادية وفق الممارسات الشائعة لدى الجهات المانحة في القطاع غير الربحي.</div>
      </div>}
    </div>
  );
}
