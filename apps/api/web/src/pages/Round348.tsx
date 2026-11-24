/** 3.48.0 restaurant screens: ingredient purchase plan and kitchen performance. */
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, useFetch, useAction, useToast, useCompanyContext, Field, NumInput, Money, money, Loading, Empty, fmtDT, today, DateRange } from "../lib";

const ST: Record<string, [string, string]> = { critical: ["ينفد قبل وصول الطلب", "red"], low: ["يحتاج شراء", "amber"], ok: ["كافٍ", "green"], idle: ["بلا استهلاك", ""] };

export function PurchasePlan() {
  const { can } = useCompanyContext();
  const nav = useNavigate();
  const toast = useToast();
  const [p, setP] = useState(() => { try { return { cover: 7, lead: 2, history: 28, onlyRecipe: true, ...JSON.parse(localStorage.getItem("mz_plan") || "{}") }; } catch { return { cover: 7, lead: 2, history: 28, onlyRecipe: true }; } });
  const { data } = useFetch<any>(`/inventory/purchase-plan?cover=${p.cover}&lead=${p.lead}&history=${p.history}&onlyRecipe=${p.onlyRecipe ? 1 : 0}`, [p.cover, p.lead, p.history, p.onlyRecipe]);
  const [qty, setQty] = useState<Record<string, any>>({});
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const { run, busy } = useAction();
  useEffect(() => { try { localStorage.setItem("mz_plan", JSON.stringify(p)); } catch { /* blocked */ } }, [p]);
  useEffect(() => { if (data) { setQty(Object.fromEntries(data.rows.map((r: any) => [r.productId, r.suggested]))); setSel(Object.fromEntries(data.rows.filter((r: any) => r.suggested > 0).map((r: any) => [r.productId, true]))); } }, [data]);
  const chosen = useMemo(() => (data?.rows || []).filter((r: any) => sel[r.productId] && Number(qty[r.productId]) > 0), [data, sel, qty]);
  const value = chosen.reduce((a: number, r: any) => a + Number(qty[r.productId]) * r.price, 0);
  const maxCover = p.cover + p.lead;
  return (
    <div className="grid" data-plan>
      <div className="card"><div className="row" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <Field label="يكفي لكم يوماً"><NumInput style={{ width: 90 }} value={p.cover} onChange={(e: any) => setP({ ...p, cover: Number(e.target.value) || 1 })} data-plan-cover /></Field>
        <Field label="أيام وصول الطلب من المورد"><NumInput style={{ width: 90 }} value={p.lead} onChange={(e: any) => setP({ ...p, lead: Number(e.target.value) || 0 })} data-plan-lead /></Field>
        <Field label="احسب الاستهلاك من آخر"><select className="input" value={p.history} onChange={(e) => setP({ ...p, history: Number(e.target.value) })}>{[7, 14, 28, 56, 90].map((d) => <option key={d} value={d}>{d} يوماً</option>)}</select></Field>
        <label className="check"><input type="checkbox" checked={p.onlyRecipe} onChange={(e) => setP({ ...p, onlyRecipe: e.target.checked })} data-plan-only /> مكونات الوصفات فقط</label>
        <div className="grow" />
        {data && <div className="row" style={{ gap: 6 }}><span className="badge red">{data.totals.critical} حرج</span><span className="badge amber">{data.totals.low} منخفض</span></div>}
      </div>
      <div className="small muted mt">الاستهلاك من كرت الصنف: ما خرج للبيع ونقطة البيع والطبخات (فيدخل ما استُهلك عبر الوصفات)، ناقص المرتجعات. المقترح = الاستهلاك اليومي × (أيام الكفاية + أيام الوصول) − الرصيد − المطلوب في أوامر شراء مفتوحة.</div></div>
      <div className="card">{!data ? <Loading /> : !data.rows.length ? <Empty text="لا استهلاك مسجّل في الفترة" /> : <div className="table-wrap"><table className="tbl" data-plan-table>
        <thead><tr><th style={{ width: 30 }} /><th>الصنف</th><th className="n">الاستهلاك اليومي</th><th className="n">الرصيد</th><th className="n">في الطريق</th><th style={{ width: 170 }}>يكفي لـ</th><th>الحالة</th><th className="n" style={{ width: 110 }}>الكمية المقترحة</th><th className="n">آخر سعر</th><th>المورد</th></tr></thead>
        <tbody>{data.rows.map((r: any) => <tr key={r.productId} className={"plan-" + r.status} data-plan-row={r.sku}>
          <td>{!r.isPrep && <input type="checkbox" checked={!!sel[r.productId]} onChange={(e) => setSel({ ...sel, [r.productId]: e.target.checked })} aria-label={r.name} />}</td>
          <td><b>{r.name}</b> <span className="small muted">{r.unit}</span>{r.isPrep && <div className="small muted">تحضيرة تُطبخ في المطبخ — لا تُشترى</div>}</td>
          <td className="n num">{r.daily}</td><td className="n num">{r.onHand}</td><td className="n num">{r.onOrder || "—"}</td>
          <td>{r.coverDays === null ? "—" : <div className="plan-cover"><div className="mini-bar"><i style={{ width: `${Math.min(100, (r.coverDays / maxCover) * 100)}%`, background: r.status === "critical" ? "#ef4444" : r.status === "low" ? "#f59e0b" : "#10b981" }} /></div><span className="num small">{r.coverDays} يوم</span></div>}</td>
          <td><span className={"badge " + ST[r.status][1]}>{ST[r.status][0]}</span></td>
          <td className="n">{r.isPrep ? "—" : <NumInput style={{ width: 96 }} value={qty[r.productId] ?? 0} onChange={(e: any) => setQty({ ...qty, [r.productId]: e.target.value })} data-plan-qty />}</td>
          <td className="n">{r.price ? <Money v={r.price} /> : "—"}</td><td className="small">{r.supplierName || <span className="muted">—</span>}</td></tr>)}</tbody></table></div>}</div>
      {data && can("purchases.write") && <div className="card"><div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span>{chosen.length} صنف بقيمة تقديرية <b className="num">{money(value)}</b>، في {new Set(chosen.map((r: any) => r.supplierId || "_")).size} أمر شراء (أمر لكل مورد).</span><div className="grow" />
        <button className="btn primary" disabled={busy || !chosen.length} data-plan-orders onClick={() => run(async () => { const r = await api("/inventory/reorder/orders", { body: { items: chosen.map((x: any) => ({ productId: x.productId, qty: Number(qty[x.productId]), supplierId: x.supplierId, price: x.price })) } }); toast(`أُنشئ ${r.length} أمر شراء (مسودة) — راجعها وأرسلها للموردين`); nav("/purchases/orders"); })}>إنشاء أوامر الشراء</button>
      </div></div>}
    </div>
  );
}

export function KitchenPerformance() {
  const [range, setRange] = useState({ from: new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10), to: today() });
  const [late, setLate] = useState(15);
  const { data } = useFetch<any>(`/restaurant/kitchen-performance?from=${range.from}&to=${range.to}&late=${late}`, [range.from, range.to, late]);
  const T = data?.totals;
  const bar = (v: number, max: number, lvl: string) => <div className="mini-bar"><i style={{ width: `${Math.min(100, (v / Math.max(1, max)) * 100)}%`, background: lvl }} /></div>;
  const maxAvg = Math.max(late, ...(data?.byStation || []).map((x: any) => x.avg), ...(data?.byItem || []).map((x: any) => x.avg));
  const col = (v: number) => (v > late ? "#ef4444" : v > late * 0.7 ? "#f59e0b" : "#10b981");
  return (
    <div className="grid" data-kperf>
      <div className="card"><div className="row" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <DateRange from={range.from} to={range.to} onChange={(f, t) => setRange({ from: f, to: t })} />
        <Field label="يُعدّ متأخراً بعد (دقيقة)"><NumInput style={{ width: 90 }} value={late} onChange={(e: any) => setLate(Number(e.target.value) || 15)} /></Field>
      </div><div className="small muted mt">الوقت من إرسال الصنف من الصالة حتى ضغط «جاهز» في شاشة المطبخ.</div></div>
      {!data ? <div className="card"><Loading /></div> : !T ? <div className="card"><Empty text="لا أصناف جُهّزت في هذه الفترة — يُسجَّل الوقت عند ضغط «جاهز» في شاشة المطبخ" /></div> : <>
        <div className="fc-kpis" data-kperf-kpis>
          <div className="fc-kpi"><span>أصناف جُهّزت</span><b className="num">{T.count}</b></div>
          <div className="fc-kpi"><span>متوسط وقت التجهيز</span><b className="num">{T.avg} د</b><small>الوسيط {T.median} د</small></div>
          <div className={"fc-kpi" + (T.latePct > 10 ? " high" : " good")}><span>متأخرة (أكثر من {late} د)</span><b className="num">{T.late}</b><small>{T.latePct}%</small></div>
          <div className="fc-kpi"><span>أطول انتظار</span><b className="num">{T.max} د</b></div>
        </div>
        <div className="grid c2">
          <div className="card"><div className="card-h"><h3>حسب المحطة</h3></div><div className="table-wrap"><table className="tbl compact" data-kperf-st><thead><tr><th>المحطة</th><th className="n">أصناف</th><th style={{ width: "35%" }}>المتوسط</th><th className="n">متأخر</th></tr></thead>
            <tbody>{data.byStation.map((x: any) => <tr key={x.key}><td><b>{x.key}</b></td><td className="n">{x.count}</td><td><div className="row" style={{ gap: 6 }}>{bar(x.avg, maxAvg, col(x.avg))}<span className="num small">{x.avg} د</span></div></td><td className="n">{x.late ? <span className="neg-val">{x.late} ({x.latePct}%)</span> : "—"}</td></tr>)}</tbody></table></div></div>
          <div className="card"><div className="card-h"><h3>أبطأ الأصناف</h3></div><div className="table-wrap"><table className="tbl compact"><thead><tr><th>الصنف</th><th className="n">مرات</th><th style={{ width: "35%" }}>المتوسط</th><th className="n">الأطول</th></tr></thead>
            <tbody>{data.byItem.slice(0, 10).map((x: any) => <tr key={x.key}><td>{x.key}</td><td className="n">{x.count}</td><td><div className="row" style={{ gap: 6 }}>{bar(x.avg, maxAvg, col(x.avg))}<span className="num small">{x.avg} د</span></div></td><td className="n num">{x.max}</td></tr>)}</tbody></table></div></div>
        </div>
        {data.slow.length > 0 && <div className="card"><div className="card-h"><h3>الأصناف المتأخرة</h3></div><div className="table-wrap"><table className="tbl compact"><thead><tr><th>الطلب</th><th>الصنف</th><th>المحطة</th><th className="n">الكمية</th><th className="n">الدقائق</th><th>أُرسل</th></tr></thead>
          <tbody>{data.slow.map((x: any, i: number) => <tr key={i}><td className="num">#{x.orderNo}</td><td>{x.name}</td><td>{x.station}</td><td className="n">{x.qty}</td><td className="n neg-val num">{x.minutes}</td><td className="small">{fmtDT(x.sentAt)}</td></tr>)}</tbody></table></div></div>}
      </>}
    </div>
  );
}
