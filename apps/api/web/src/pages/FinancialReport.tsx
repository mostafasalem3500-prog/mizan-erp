/** The written financial report (company position and state of the books) and the periodic reports archive. */
import React, { useState } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { api, q, useFetch, useAction, Loading, Empty, Field, Input, Select, DateRange, PrintBtn, today, fmtDT, confirmDlg, useCompanyContext } from "../lib";
import { isEn } from "../i18n";
import { Gauge } from "./Round25";

const pad = (n: number) => String(n).padStart(2, "0");
const mEnd = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
function presets(): [string, string, string][] {
  const d = today(), y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)), qs = Math.floor((m - 1) / 3) * 3 + 1;
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y, pqs = qs === 1 ? 10 : qs - 3, pqy = qs === 1 ? y - 1 : y;
  return [
    ["هذا الشهر", `${y}-${pad(m)}-01`, d], ["الشهر الماضي", `${py}-${pad(pm)}-01`, mEnd(py, pm)],
    ["هذا الربع", `${y}-${pad(qs)}-01`, d], ["الربع الماضي", `${pqy}-${pad(pqs)}-01`, mEnd(pqy, pqs + 2)],
    ["هذه السنة", `${y}-01-01`, d], ["السنة الماضية", `${y - 1}-01-01`, `${y - 1}-12-31`],
  ];
}
const ST: Record<string, { c: string; t: string; i: string }> = {
  good: { c: "var(--success)", t: "سليم", i: "✓" }, ok: { c: "var(--info)", t: "مقبول", i: "•" }, info: { c: "var(--info)", t: "ملاحظة", i: "ℹ" },
  warn: { c: "var(--accent)", t: "يحتاج متابعة", i: "!" }, bad: { c: "var(--danger)", t: "يحتاج تصحيحاً", i: "✕" },
};
const LEVEL: Record<string, { c: string; t: string }> = { good: { c: "var(--success)", t: "وضع جيد" }, ok: { c: "var(--info)", t: "وضع مستقر" }, watch: { c: "var(--accent)", t: "يحتاج انتباهاً" }, critical: { c: "var(--danger)", t: "وضع حرج" } };
const money = (v: any) => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const Pill = ({ s }: { s: string }) => <span className="fr-pill" style={{ background: ST[s]?.c || "var(--muted)" }}>{ST[s]?.i} {ST[s]?.t || s}</span>;

/** Renders one issued or live report; the text comes from the server in the interface language. */
export function ReportView({ r, title }: { r: any; title?: string }) {
  const lv = LEVEL[r.verdict.level] || LEVEL.ok;
  return (
    <div className="print-doc fr" data-fin-report style={{ maxWidth: "none" }}>
      <div className="fr-head">
        <div><h2 style={{ margin: 0 }}>{title || "التقرير المالي المكتوب"}</h2>
          <div className="small">{r.company.name}{r.company.vatNumber ? <> · <span className="num">{r.company.vatNumber}</span></> : null}</div>
          <div className="small muted">الفترة <span className="num">{r.period.from} → {r.period.to}</span> ({r.period.days} يوماً) · المقارنة مع <span className="num">{r.period.prevFrom} → {r.period.prevTo}</span> · المبالغ بـ {r.company.currency}</div>
          <div className="small muted">أُعدّ في {fmtDT(r.generatedAt)} من القيود المرحّلة</div></div>
        <div className="fr-verdict" style={{ borderColor: lv.c }} data-verdict={r.verdict.level}><Gauge v={r.verdict.health} /><b style={{ color: lv.c }}>{lv.t}</b></div>
      </div>
      <div className="mini-kpis mt">{r.keyFigures.map((k: any) => <div key={k.key}><span>{k.label}</span><b className={"num" + (k.value < 0 ? " neg-val" : "")}>{money(k.value)}</b>
        {k.change !== null && k.change !== undefined ? <small className={(k.change >= 0) !== !!k.upBad ? "pos-val" : "neg-val"}>{k.change >= 0 ? "▲" : "▼"} {Math.abs(k.change)}%</small> : k.prev !== null && k.prev !== undefined ? <small className="muted">كان <span className="num">{money(k.prev)}</span></small> : null}</div>)}</div>
      {r.trend?.some((x: any) => x.sales || x.net || x.cash) && <TrendChart rows={r.trend} />}
      {r.sections.map((s: any) => <section key={s.key} className="fr-sec" data-section={s.key}>
        <h3><span>{s.title}</span><Pill s={s.status} /></h3>
        {s.paragraphs.map((p: string, i: number) => <p key={i}>{p}</p>)}
        {s.table && <div className="table-wrap"><table className="tbl compact"><thead><tr>{s.table.head.map((h: string, i: number) => <th key={i} className={i ? "n" : ""}>{h}</th>)}</tr></thead>
          <tbody>{s.table.rows.map((row: any[], i: number) => <tr key={i}>{row.map((c, j) => <td key={j} className={j ? "n num" : ""}>{c}</td>)}</tr>)}</tbody></table></div>}
        {s.key === "books" && <CheckTable rows={r.checks} />}
        {s.key === "compliance" && <CheckTable rows={r.compliance} refs />}
      </section>)}
      <section className="fr-sec" data-section="recommendations"><h3><span>التوصيات</span></h3>
        {r.recommendations.length ? <ol className="fr-recs">{r.recommendations.map((x: any, i: number) => <li key={i} data-priority={x.priority}><span className={"badge p" + x.priority}>{x.priority === 1 ? "عاجل" : x.priority === 2 ? "مهم" : "للتحسين"}</span> {x.text}{x.to && <> <Link className="no-print small" to={x.to}>فتح ←</Link></>}</li>)}</ol>
          : <p className="muted">لا توجد توصيات — لم تظهر مشكلات في الفحوص.</p>}
      </section>
      <div className="small muted mt">هذا التقرير تحليل آلي من الدفاتر لمساعدة الإدارة، وليس رأياً مهنياً لمراجع حسابات. القوائم التفصيلية: <Link to="/reports/income">قائمة الدخل</Link> · <Link to="/reports/balance-sheet">الميزانية</Link> · <Link to="/analysis">التحليل المالي والمؤشرات</Link></div>
    </div>
  );
}
/** Twelve months to the end of the period: net sales as bars, net result and month-end cash as lines. */
function TrendChart({ rows }: { rows: any[] }) {
  const W = 760, H = 190, P = { l: 6, r: 6, t: 14, b: 26 };
  const vals = rows.flatMap((x) => [x.sales, x.net, x.cash]);
  const max = Math.max(1, ...vals), min = Math.min(0, ...vals);
  const bw = (W - P.l - P.r) / rows.length;
  const y = (v: number) => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
  const cx = (i: number) => P.l + bw * i + bw / 2;
  const line = (k: string) => rows.map((x, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)},${y(x[k]).toFixed(1)}`).join(" ");
  return (
    <section className="fr-sec" data-section="trend"><h3><span>آخر 12 شهراً</span></h3>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }} role="img" aria-label="صافي المبيعات وصافي النتيجة والنقدية لآخر 12 شهراً">
        <line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} stroke="var(--border)" />
        {rows.map((x, i) => <g key={x.month}><rect x={cx(i) - bw * 0.32} width={bw * 0.64} y={Math.min(y(x.sales), y(0))} height={Math.abs(y(x.sales) - y(0))} fill="var(--primary)" opacity=".28"><title>{`${x.month}\n${money(x.sales)}`}</title></rect>
          <text x={cx(i)} y={H - 8} fontSize="10" textAnchor="middle" fill="var(--muted)">{x.month.slice(2)}</text></g>)}
        <path d={line("net")} fill="none" stroke="var(--success)" strokeWidth="2.2" />
        <path d={line("cash")} fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="5 4" />
        {rows.map((x, i) => <circle key={i} cx={cx(i)} cy={y(x.net)} r="2.8" fill={x.net < 0 ? "var(--danger)" : "var(--success)"}><title>{`${x.month}: ${money(x.net)}`}</title></circle>)}
      </svg>
      <div className="row small muted" style={{ gap: 16, justifyContent: "center" }}><span><i className="lg-dot" style={{ background: "var(--primary)", opacity: 0.5 }} /> صافي المبيعات</span><span><i className="lg-dot" style={{ background: "var(--success)" }} /> صافي النتيجة</span><span><i className="lg-dot" style={{ background: "var(--accent)" }} /> النقدية آخر الشهر</span></div>
    </section>
  );
}

function CheckTable({ rows, refs }: { rows: any[]; refs?: boolean }) {
  return <div className="table-wrap"><table className="tbl compact fr-checks"><thead><tr><th style={{ width: 130 }}>الحالة</th><th>البند</th><th>النتيجة</th></tr></thead>
    <tbody>{rows.map((c: any) => <tr key={c.key} data-check={c.key} data-status={c.status}><td><Pill s={c.status} /></td><td><b>{c.label}</b>{refs && c.ref && <div className="small muted">{c.ref}</div>}</td>
      <td>{c.text}{c.to && <> <Link className="no-print small" to={c.to}>فتح ←</Link></>}</td></tr>)}</tbody></table></div>;
}

export function FinancialReportPage() {
  const { me } = useCompanyContext();
  const P = presets();
  const [sp] = useSearchParams();
  const ok = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const [from, setFrom] = useState(ok(sp.get("from")) || P[0][1]);
  const [to, setTo] = useState(ok(sp.get("to")) || P[0][2]);
  const [branchId, setBranchId] = useState(sp.get("branchId") || "");
  const branches = useFetch<any[]>("/branches");
  const { data: r, loading, error } = useFetch<any>(`/reports/financial-report${q({ from, to, branchId, lang: isEn() ? "en" : undefined })}`, [from, to, branchId]);
  return (
    <div className="grid">
      <div className="card no-print"><div className="card-h"><div><h3>📝 التقرير المالي المكتوب</h3><div className="small muted">وضع المنشأة وحالة الحسابات بجمل واضحة: الملخص التنفيذي، الربحية، السيولة، المركز المالي، الذمم والمخزون، سلامة الدفاتر، والالتزامات النظامية، مع التوصيات.</div></div>
        <div className="row"><Link className="btn sm" to="/periodic-reports">🗂 التقارير الدورية</Link><PrintBtn pdfName="التقرير المالي" /></div></div>
        <div className="card-b row" style={{ gap: 8 }}>
          {P.map(([l, a, b]) => <button key={l} className={"btn sm" + (a === from && b === to ? " primary" : "")} onClick={() => { setFrom(a); setTo(b); }}>{l}</button>)}
          <DateRange from={from} to={to} onChange={(a, b) => { setFrom(a || P[0][1]); setTo(b || today()); }} />
          {!me.lockedBranch && (branches.data?.length || 0) > 1 && <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={{ width: "auto" }} aria-label="الفرع"><option value="">كل الفروع</option>{branches.data!.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}
          {branchId && <span className="small muted">مع فلتر الفرع: فحوص مطابقة الدفاتر للمنشأة كاملة لا تُعرض.</span>}
        </div></div>
      {loading && !r ? <Loading /> : !r ? <Empty text={error || "تعذّر إعداد التقرير"} /> : <ReportView r={r} />}
    </div>
  );
}

const KIND: Record<string, string> = { MONTH: "شهري", QUARTER: "ربع سنوي", YEAR: "سنوي" };
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const label = (r: any) => r.kind === "MONTH" ? `${MONTHS[Number(r.periodFrom.slice(5, 7)) - 1]} ${r.periodFrom.slice(0, 4)}` : r.kind === "QUARTER" ? `الربع ${Math.floor((Number(r.periodFrom.slice(5, 7)) - 1) / 3) + 1} — ${r.periodFrom.slice(0, 4)}` : `${r.periodFrom} → ${r.periodTo}`;

export function PeriodicReportsPage() {
  const { can } = useCompanyContext();
  const { data, loading, reload } = useFetch<any>("/periodic-reports");
  const { run, busy } = useAction();
  const [kind, setKind] = useState("");
  const [year, setYear] = useState("");
  const [nk, setNk] = useState("MONTH");
  const [nd, setNd] = useState(() => { const d = new Date(Date.UTC(Number(today().slice(0, 4)), Number(today().slice(5, 7)) - 1, 0)); return d.toISOString().slice(0, 10); });
  const nav = useNavigate();
  if (loading && !data) return <Loading />;
  if (data?.lockedBranch) return <Empty text="التقارير الدورية للمنشأة كاملة — غير متاحة لمستخدم مقيّد بفرع. استخدم «التقرير المالي المكتوب» لفرعك." />;
  const rows = (data?.rows || []).filter((r: any) => (!kind || r.kind === kind) && (!year || r.periodFrom.startsWith(year)));
  const years = [...new Set((data?.rows || []).map((r: any) => r.periodFrom.slice(0, 4)))] as string[];
  const s = data?.settings || {};
  const canSet = can("settings.write");
  return (
    <div className="grid" data-periodic>
      <div className="card"><div className="card-h"><div><h3>🗂 التقارير المالية الدورية</h3><div className="small muted">يُصدر التقرير المالي المكتوب تلقائياً بعد انتهاء كل شهر، وربع سنوي وسنوي عند انتهاء الربع أو السنة المالية، ويُحفظ كما صدر للرجوع إليه. يمكن إصدار أي فترة أو إعادة إصدارها يدوياً.</div></div>
        <Link className="btn sm" to="/financial-report">📝 التقرير المالي المكتوب</Link></div>
        <div className="card-b row" style={{ gap: 8, alignItems: "flex-end" }}>
          <Field label="نوع التقرير"><Select value={nk} onChange={(e) => setNk(e.target.value)}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="تاريخ داخل الفترة"><Input type="date" value={nd} onChange={(e) => setNd(e.target.value)} /></Field>
          <button className="btn primary" disabled={busy} data-issue onClick={() => run(async () => { const x = await api("/periodic-reports", { body: { kind: nk, date: nd } }); await reload(); nav(`/periodic-reports/${x.id}`); }, "صدر التقرير")}>إصدار التقرير</button>
          <div className="grow" />
          {canSet && <div className="row small" data-auto-settings>تلقائياً: {Object.entries(KIND).map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={s[k] !== false} onChange={(e) => run(async () => { await api("/periodic-reports/settings", { method: "PUT", body: { ...s, [k]: e.target.checked } }); reload(); })} /> {l}</label>)}</div>}
        </div></div>
      <div className="card"><div className="card-h"><h3>التقارير الصادرة</h3><div className="row">
        <Select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: "auto" }} aria-label="النوع"><option value="">كل الأنواع</option>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select value={year} onChange={(e) => setYear(e.target.value)} style={{ width: "auto" }} aria-label="السنة"><option value="">كل السنوات</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select></div></div>
        {!rows.length ? <div className="card-b"><Empty text="لم يصدر أي تقرير بعد — يصدر الشهري تلقائياً بعد انتهاء الشهر الذي فيه حركات، أو أصدره من الأعلى." /></div> :
          <div className="table-wrap"><table className="tbl" data-periodic-list><thead><tr><th>التقرير</th><th>النوع</th><th>الفترة</th><th>التقييم</th><th className="n">المؤشر</th><th>صدر</th><th /></tr></thead>
            <tbody>{rows.map((r: any) => <tr key={r.id}><td><Link to={`/periodic-reports/${r.id}`}>{label(r)}</Link></td><td>{KIND[r.kind]}</td><td className="small num">{r.periodFrom} → {r.periodTo}</td>
              <td>{r.level && <b style={{ color: LEVEL[r.level]?.c }}>{LEVEL[r.level]?.t}</b>}</td><td className="n num">{r.health ?? "—"}</td>
              <td className="small">{r.auto ? "تلقائياً" : r.createdBy}<div className="muted">{fmtDT(r.createdAt)}</div></td>
              <td>{canSet && <button className="btn sm ghost" onClick={() => confirmDlg("حذف هذا التقرير الصادر؟") && run(async () => { await api(`/periodic-reports/${r.id}`, { method: "DELETE" }); reload(); }, "حُذف")}>حذف</button>}</td></tr>)}</tbody></table></div>}
      </div>
    </div>
  );
}

export function PeriodicReportPage() {
  const { id } = useParams();
  const { data, loading, reload } = useFetch<any>(`/periodic-reports/${id}${q({ lang: isEn() ? "en" : undefined })}`, [id]);
  const { run, busy } = useAction();
  if (loading && !data) return <Loading />;
  if (!data) return <Empty text="التقرير غير موجود" />;
  return (
    <div className="grid">
      <div className="card no-print"><div className="card-b row"><Link className="btn sm" to="/periodic-reports">→ التقارير الدورية</Link>
        <span className="small muted">صدر {data.auto ? "تلقائياً" : `بواسطة ${data.createdBy}`} في {fmtDT(data.createdAt)} — لا يتغير بالقيود اللاحقة.</span><div className="grow" />
        <button className="btn sm" disabled={busy} data-reissue onClick={() => confirmDlg("إعادة إصدار التقرير من الدفاتر الحالية؟ يحل محل النسخة الصادرة.") && run(async () => { await api("/periodic-reports", { body: { kind: data.kind, date: data.periodFrom } }); reload(); }, "أعيد الإصدار")}>↻ إعادة الإصدار</button><PrintBtn pdfName={label(data)} /></div></div>
      <ReportView r={data.report} title={`التقرير المالي ${KIND[data.kind]} — ${label(data)}`} />
    </div>
  );
}
