/** 3.47.0 home-screen sections: business pulse, smart observations, ask the assistant, peak hours, and the choice of sections. */
import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useFetch, money, Loading, useCompanyContext, fmtDate } from "../lib";
import { CUR } from "../shared/country";

const PERIODS: [string, string][] = [["today", "اليوم"], ["week", "7 أيام"], ["month", "الشهر"], ["quarter", "الربع"], ["year", "السنة"]];
const ICON: Record<string, string> = { sales: "🧾", gross: "📊", net: "💰", expenses: "🧮", docs: "📄", ticket: "🎫", collected: "💵", customers: "👥" };

/** A tiny line of the period's values. */
function Spark({ pts }: { pts: number[] }) {
  if (pts.length < 2) return null;
  const max = Math.max(...pts, 0), min = Math.min(...pts, 0), w = 120, h = 34, span = max - min || 1;
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * w, h - ((v - min) / span) * (h - 4) - 2]);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true"><path d={`${d} L${w} ${h} L0 ${h} Z`} className="area" /><path d={d} className="line" /></svg>;
}
function Delta({ k }: { k: any }) {
  if (k.changePct === null || k.changePct === undefined) return <span className="delta flat">— لا مقارنة</span>;
  const up = k.changePct > 0, good = k.lowerIsBetter ? !up : up;
  return <span className={"delta " + (Math.abs(k.changePct) < 0.5 ? "flat" : good ? "up" : "down")} title={`السابق ${k.count ? k.prev : money(k.prev)}`}>{up ? "▲" : k.changePct < 0 ? "▼" : "•"} {Math.abs(k.changePct)}%</span>;
}

export function Pulse() {
  const { can } = useCompanyContext();
  const [period, setPeriod] = useState(() => { try { return localStorage.getItem("mz_pulse") || "month"; } catch { return "month"; } });
  const { data } = useFetch<any>(`/dashboard/pulse?period=${period}`, [period]);
  const pick = (p: string) => { setPeriod(p); try { localStorage.setItem("mz_pulse", p); } catch { /* private window */ } };
  const show = (k: string) => can("reports.read") || ["sales", "docs", "ticket", "customers"].includes(k);
  return (
    <section className="card pulse" data-pulse>
      <div className="pulse-h">
        <div><h3>نبض الأعمال</h3>{data && <div className="small muted">{data.label}: {fmtDate(data.from)}{data.from !== data.to && ` — ${fmtDate(data.to)}`} · مقارنة بـ{data.vs}</div>}</div>
        <div className="seg" role="tablist">{PERIODS.map(([k, l]) => <button key={k} role="tab" aria-selected={period === k} className={period === k ? "on" : ""} data-pulse-period={k} onClick={() => pick(k)}>{l}</button>)}</div>
      </div>
      {!data ? <Loading /> : <div className="pulse-grid">
        {data.kpis.filter((k: any) => show(k.key)).map((k: any) => <div key={k.key} className={"pulse-kpi" + (k.key === "sales" ? " lead" : "")} data-kpi={k.key}>
          <div className="row between"><span className="lbl">{ICON[k.key]} {k.label}</span><Delta k={k} /></div>
          <b className="num val">{k.count ? Number(k.value).toLocaleString("en-US") : money(k.value)}{!k.count && <small> {CUR()}</small>}</b>
          {k.marginPct !== undefined && <span className="small muted">الهامش {k.marginPct}%{k.prevMarginPct !== undefined && ` (كان ${k.prevMarginPct}%)`}</span>}
          {k.key === "sales" && <Spark pts={data.series.map((x: any) => x.v)} />}
        </div>)}
      </div>}
    </section>
  );
}

export function AskBox() {
  const { can } = useCompanyContext();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  if (!can("dashboard.read")) return null;
  const go = (t: string) => { const v = t.trim(); if (v) nav(`/ai?q=${encodeURIComponent(v)}`); };
  return (
    <form className="card ask-box" data-ask-box onSubmit={(e) => { e.preventDefault(); go(q); }}>
      <span className="ask-ic" aria-hidden="true">✨</span>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسأل المساعد عن أرقامك… مثل: المبيعات حسب التصنيف هذا الشهر" aria-label="اسأل المساعد الذكي" />
      <button className="btn primary" type="submit" disabled={!q.trim()}>اسأل</button>
      <div className="ask-chips">{["ملاحظاتك على الوضع", "المبيعات حسب التصنيف", "متى وقت الذروة؟", "من لم يسدد؟"].map((x) => <button type="button" key={x} className="chip" onClick={() => go(x)}>{x}</button>)}</div>
    </form>
  );
}

export function Insights() {
  const { can } = useCompanyContext();
  const { data, reload } = useFetch<any>(can("reports.read") ? "/dashboard/insights" : null);
  const nav = useNavigate();
  if (!can("reports.read")) return null;
  return (
    <section className="card insights" data-insights>
      <div className="card-h"><h3>💡 ملاحظات ذكية</h3><button className="btn sm ghost" onClick={() => reload()} title="تحديث">↻</button></div>
      {!data ? <Loading /> : !data.items.length ? <div className="card-b muted">لا شيء لافت الآن: لا تغيّر كبير في المبيعات، ولا أصناف تنفد قريباً، ولا ديون متأخرة طويلاً ✓</div> :
        <div className="ins-list">{data.items.map((x: any) => <div key={x.key} className={"ins " + x.level} data-insight={x.key}>
          <span className="ins-ic" aria-hidden="true">{x.icon}</span>
          <div className="grow"><b>{x.title}</b><div className="small muted">{x.text}</div>
            <div className="row" style={{ gap: 6, marginTop: 6 }}>{x.to && x.to !== "/" && <Link className="btn sm ghost" to={x.to}>افتح</Link>}{x.ask && <button className="btn sm ghost" onClick={() => nav(`/ai?q=${encodeURIComponent(x.ask)}`)}>✨ اسأل المساعد</button>}</div></div>
        </div>)}</div>}
    </section>
  );
}

const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
export function PeakHours() {
  const { can } = useCompanyContext();
  const [days, setDays] = useState(28);
  const { data } = useFetch<any>(can("reports.read") ? `/analytics/heatmap?days=${days}` : null, [days]);
  if (!can("reports.read")) return null;
  if (data && !data.cells.length) return null;
  const [h0, h1] = data ? [Math.max(0, Math.min(data.hours[0], 8)), Math.min(23, Math.max(data.hours[1], 22))] : [8, 22];
  const hours = Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i);
  const max = data ? Math.max(1, ...data.cells.map((c: any) => c.docs)) : 1;
  const cell = (d: number, h: number) => data?.cells.find((c: any) => c.day === d && c.hour === h);
  return (
    <section className="card" data-peak>
      <div className="card-h"><div><h3>أوقات الذروة</h3><div className="small muted">عدد فواتير البيع حسب اليوم والساعة — الأغمق أزحم</div></div>
        <div className="seg">{[7, 28, 90].map((d) => <button key={d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>{d === 7 ? "أسبوع" : d === 28 ? "4 أسابيع" : "3 أشهر"}</button>)}</div></div>
      {!data ? <Loading /> : <div className="card-b">
        <div className="heat" style={{ gridTemplateColumns: `64px repeat(${hours.length}, minmax(18px, 1fr))` }} data-heat>
          <span />{hours.map((h) => <span key={h} className="hh num">{h % 2 === 0 ? h : ""}</span>)}
          {DAYS.flatMap((name, d) => [<span key={`d${d}`} className="hd">{name}</span>, ...hours.map((h) => { const c = cell(d, h); const a = c ? c.docs / max : 0; return <span key={`${d}-${h}`} className="hc" title={c ? `${name} ${String(h).padStart(2, "0")}:00 — ${c.docs} فاتورة، ${money(c.net)}` : `${name} ${h}:00 — لا مبيعات`} style={{ background: a ? `color-mix(in srgb, var(--primary) ${Math.round(15 + a * 85)}%, transparent)` : undefined }} />; })])}
        </div>
        {data.peak && <div className="small mt" data-peak-text>الأزحم: <b>{data.peak.dayName} {String(data.peak.hour).padStart(2, "0")}:00</b> ({data.peak.docs} فاتورة){data.bestDay && <> · أفضل يوم مبيعاً: <b>{data.bestDay.name}</b></>}{data.untimed > 0 && <span className="muted"> · {data.untimed} فاتورة بلا وقت مسجل</span>}</div>}
      </div>}
    </section>
  );
}

/** Which sections of the home screen this user sees (kept in the browser). */
export const SECTIONS: [string, string][] = [["ask", "اسأل المساعد"], ["pulse", "نبض الأعمال"], ["insights", "ملاحظات ذكية"], ["kpis", "الأرصدة والمؤشرات"], ["charts", "الرسوم الشهرية"], ["peak", "أوقات الذروة"], ["branches", "أداء الفروع"], ["tops", "الأكثر مبيعاً والعملاء والمتأخرات"], ["recent", "آخر المستندات والمخزون"], ["alerts", "تنبيهات المحاسب"]];
export function useHomeSections() {
  const { me } = useCompanyContext();
  const key = `mz_home_${me?.user?.id || me?.user?.email || ""}`;
  const [hidden, setHidden] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; } });
  const toggle = (k: string) => { const n = { ...hidden, [k]: !hidden[k] }; setHidden(n); try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* private window */ } };
  return { on: (k: string) => !hidden[k], toggle, hidden };
}
export function CustomizeHome({ s }: { s: ReturnType<typeof useHomeSections> }) {
  const [open, setOpen] = useState(false);
  return <div className="home-cust" data-home-customize>
    <button className="btn sm ghost" onClick={() => setOpen(!open)} aria-expanded={open}>⚙ تخصيص الشاشة الرئيسية</button>
    {open && <div className="card home-cust-pop">{SECTIONS.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={s.on(k)} onChange={() => s.toggle(k)} data-home-sec={k} /> {l}</label>)}</div>}
  </div>;
}
