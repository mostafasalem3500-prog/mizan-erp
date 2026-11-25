/**
 * 3.49.0 — the manufacturing module: dashboard, orders (and one order's work: materials, stages, output, cost sheet),
 * bills of materials, work centres, the shop floor, requirements planning, capacity schedule, disassembly and reports.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, useFetch, useAction, useToast, useCompanyContext, Modal, Field, Input, Select, NumInput, Badge, Money, money, Loading, Empty, Tabs, DateRange, ExportBtn, PrintBtn, Picker, productFetcher, partnerFetcher, fmtDT, today, useNewParam, useTabParam, confirmDlg } from "../lib";

export const MO_ST: Record<string, string> = { DRAFT: "مسودة", CONFIRMED: "مؤكد", IN_PROGRESS: "قيد التنفيذ", DONE: "منتهٍ", CANCELLED: "ملغى" };
const MO_COLOR: Record<string, string> = { DRAFT: "gray", CONFIRMED: "blue", IN_PROGRESS: "amber", DONE: "green", CANCELLED: "red" };
const MoBadge = ({ s }: { s: string }) => <span className={"badge " + (MO_COLOR[s] || "gray")}>{MO_ST[s] || s}</span>;
const OP_ST: Record<string, [string, string]> = { PENDING: ["لم تبدأ", "gray"], RUNNING: ["قيد العمل", "amber"], PAUSED: ["متوقفة", "blue"], DONE: ["منتهية", "green"], FAILED: ["فشل الفحص", "red"] };
const AV: Record<string, [string, string]> = { OK: ["المواد متوفرة", "green"], PARTIAL: ["متوفرة جزئياً", "amber"], SHORT: ["مواد ناقصة", "red"], ISSUED: ["مصروفة", "teal"] };
const PRI: Record<number, string> = { 1: "عاجل", 2: "عادي", 3: "منخفض" };
export const WC_KIND: Record<string, string> = { MACHINE: "آلة", LABOR: "فريق عمل", LINE: "خط إنتاج", ASSEMBLY: "تجميع", OUTSOURCE: "ورشة خارجية" };
const KIND_MV: Record<string, string> = { SUBCONTRACT: "فاتورة ورشة خارجية", ISSUE: "صرف مواد", RETURN: "إرجاع مواد", LABOR: "وقت مرحلة", RECEIPT: "استلام إنتاج", BYPRODUCT: "منتج ثانوي", SCRAP: "تالف", CLOSE: "إقفال (انحراف)", CANCEL: "إلغاء" };
const stockFetcher = async (s: string) => ((await productFetcher(s)) as any[]).filter((p) => p.type === "STOCK");
const q3 = (x: any) => (x === null || x === undefined ? "—" : Number(Number(x).toFixed(3)).toLocaleString("en-US"));
const mins = (m: any) => { const v = Number(m) || 0; if (v < 60) return `${q3(v)} د`; const h = Math.floor(v / 60), r = Math.round(v % 60); return r ? `${h} س ${r} د` : `${h} س`; };
const Bar = ({ pct, color }: { pct: number; color?: string }) => <div className="mini-bar"><i style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color || "var(--primary)" }} /></div>;
const useWcs = () => useFetch<any[]>("/mfg/work-centers");
const useWh = () => useFetch<any[]>("/warehouses");

// ───────────────────────── dashboard ─────────────────────────
export function MfgDashboard() {
  const { can } = useCompanyContext();
  const { data, reload } = useFetch<any>("/mfg/dashboard");
  const nav = useNavigate();
  const { run, busy } = useAction();
  if (!data) return <Loading />;
  const C = data.counts, M = data.month;
  const empty = !C.boms;
  return (
    <div className="grid" data-mfg-dash>
      {empty && <div className="card mfg-start" data-mfg-start>
        <h3>ابدأ التصنيع في ثلاث خطوات</h3>
        <ol className="mfg-steps">
          <li><b>مراكز العمل</b>: آلة، خط إنتاج، فريق تجميع أو ورشة خارجية، بتكلفة الساعة. <Link to="/mfg/work-centers">افتح مراكز العمل</Link></li>
          <li><b>قائمة المواد</b> لكل منتج: المكونات والخلطات بنسبة الهالك، والمراحل على مراكز العمل، والمنتجات الثانوية. <Link to="/mfg/boms?new=1">قائمة مواد جديدة</Link></li>
          <li><b>أمر تصنيع</b>: يصرف المواد، يسجّل وقت كل مرحلة، ويستلم الإنتاج للمخزن بتكلفته الفعلية مع القيود. <Link to="/mfg/orders?new=1">أمر تصنيع جديد</Link></li>
        </ol>
        {can("mfg.write") && <button className="btn" disabled={busy} data-mfg-example onClick={() => run(async () => { await api("/mfg/example", { body: {} }); reload(); }, "حُمّل مثال ورشة الأثاث ومصنع المنظفات")}>تحميل مثال جاهز (ورشة أثاث ومصنع منظفات)</button>}
      </div>}
      <div className="fc-kpis" data-mfg-kpis>
        <div className="fc-kpi"><span>أوامر مفتوحة</span><b className="num">{C.draft + C.confirmed + C.inProgress}</b><small>{C.inProgress} قيد التنفيذ · {C.confirmed} مؤكد · {C.draft} مسودة</small></div>
        <div className={"fc-kpi" + (data.wip.match ? " good" : " high")} data-mfg-wip><span>إنتاج تحت التشغيل</span><b className="num">{money(data.wip.orders)}</b><small>{data.wip.match ? "مطابق لحساب الأستاذ" : `الأستاذ ${money(data.wip.ledger)} — غير مطابق`}</small></div>
        <div className="fc-kpi"><span>إنتاج هذا الشهر</span><b className="num">{money(M.received)}</b><small>{q3(M.producedQty)} وحدة</small></div>
        <div className="fc-kpi"><span>مواد مستهلكة هذا الشهر</span><b className="num">{money(M.material)}</b></div>
        <div className="fc-kpi"><span>تكلفة المراحل المحمّلة</span><b className="num">{money(M.conversion)}</b><small>{q3(M.hours)} ساعة عمل</small></div>
        <div className={"fc-kpi" + (data.late.length ? " high" : "")}><span>أوامر متأخرة</span><b className="num">{data.late.length}</b><small>تجاوزت تاريخ التسليم</small></div>
      </div>
      <div className="grid c2">
        <div className="card"><div className="card-h"><h3>الأوامر القادمة</h3><Link className="btn sm ghost" to="/mfg/orders">كل الأوامر</Link></div>
          {!data.upcoming.length ? <Empty text="لا أوامر مفتوحة" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الأمر</th><th>المنتج</th><th className="n">الكمية</th><th>التسليم</th><th>الحالة</th></tr></thead>
            <tbody>{data.upcoming.map((o: any) => <tr key={o.id} className="clickable" onClick={() => nav(`/mfg/orders/${o.id}`)}><td className="num">{o.number}</td><td>{o.name}{o.priority === 1 && <span className="badge red" style={{ marginInlineStart: 6 }}>عاجل</span>}</td><td className="n">{q3(o.producedQty)} / {q3(o.qty)}</td><td className="small">{o.dueDate || "—"}</td><td><MoBadge s={o.status} /></td></tr>)}</tbody></table></div>}</div>
        <div className="card"><div className="card-h"><h3>يعمل الآن</h3><Link className="btn sm ghost" to="/mfg/floor">شاشة الورشة</Link></div>
          {!data.running.length ? <Empty text="لا مراحل قيد العمل الآن" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الأمر</th><th>المرحلة</th><th>مركز العمل</th><th>منذ</th></tr></thead>
            <tbody>{data.running.map((r: any, i: number) => <tr key={i} className="clickable" onClick={() => nav(`/mfg/orders/${r.id}`)}><td className="num">{r.number}</td><td>{r.stage} <span className="muted small">— {r.name}</span></td><td>{r.workCenter}</td><td className="small">{fmtDT(r.startedAt)}{r.operator ? ` · ${r.operator}` : ""}</td></tr>)}</tbody></table></div>}</div>
      </div>
      <div className="grid c2">
        <div className="card"><div className="card-h"><h3>مواد ناقصة للأوامر المؤكدة</h3><Link className="btn sm ghost" to="/mfg/plan">تخطيط الاحتياجات</Link></div>
          {!data.shortages.length ? <Empty text="مواد كل الأوامر المؤكدة متوفرة" /> : data.shortages.map((s: any) => <div key={s.id} className="mfg-short"><Link to={`/mfg/orders/${s.id}`} className="num">{s.number}</Link> <span className={"badge " + AV[s.state][1]}>{AV[s.state][0]}</span><div className="small muted">{s.missing.map((m: any) => `${m.name}: مطلوب ${q3(m.need)}، متاح ${q3(m.onHand)} ${m.unit || ""}`).join(" · ")}</div></div>)}</div>
        <div className="card"><div className="card-h"><h3>المتأخر عن التسليم</h3></div>
          {!data.late.length ? <Empty text="لا أوامر متأخرة" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الأمر</th><th>المنتج</th><th>التسليم</th><th className="n">المنجز</th></tr></thead>
            <tbody>{data.late.map((o: any) => <tr key={o.id} className="clickable" onClick={() => nav(`/mfg/orders/${o.id}`)}><td className="num">{o.number}</td><td>{o.name}</td><td className="neg-val small">{o.dueDate}</td><td className="n">{q3(o.producedQty)} / {q3(o.qty)}</td></tr>)}</tbody></table></div>}</div>
      </div>
      <div className="card small muted">القيود: صرف المواد من ح/ إنتاج تحت التشغيل إلى ح/ المخزون؛ وقت المراحل من ح/ إنتاج تحت التشغيل إلى ح/ تكاليف تشغيل محمّلة على الإنتاج؛ الاستلام من ح/ المخزون إلى ح/ إنتاج تحت التشغيل؛ التالف غير العادي يُحمَّل على ح/ تالف التصنيع؛ وما يبقى عند إقفال أمر قبل اكتماله يذهب إلى ح/ انحرافات أوامر التصنيع.</div>
    </div>
  );
}

// ───────────────────────── orders ─────────────────────────
export function MfgOrdersPage() {
  const { can } = useCompanyContext();
  const [st, setSt] = useState("OPEN");
  const { data, reload } = useFetch<any[]>(`/mfg/orders?status=${st}`, [st]);
  const [neu, setNeu] = useState<any>(null);
  useNewParam(() => setNeu({}));
  const nav = useNavigate();
  const [qs, setQs] = useState("");
  const rows = (data || []).filter((o) => !qs || `${o.number} ${o.productName} ${o.sku || ""} ${o.partnerName || ""}`.includes(qs));
  return (
    <div className="grid" data-mfg-orders>
      <div className="card"><div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div className="seg">{[["OPEN", "المفتوحة"], ["DRAFT", "مسودة"], ["CONFIRMED", "مؤكدة"], ["IN_PROGRESS", "قيد التنفيذ"], ["DONE", "منتهية"], ["CANCELLED", "ملغاة"], ["", "الكل"]].map(([k, l]) => <button key={k} className={st === k ? "on" : ""} onClick={() => setSt(k)}>{l}</button>)}</div>
        <Input placeholder="بحث برقم الأمر أو المنتج أو العميل" value={qs} onChange={(e) => setQs(e.target.value)} style={{ maxWidth: 260 }} />
        <div className="grow" />
        <ExportBtn rows={() => rows.map((o) => ({ "الأمر": o.number, "التاريخ": o.date, "المنتج": o.productName, "الكمية": o.qty, "الكمية المنتجة": o.producedQty, "التالف": o.scrapQty, "الحالة": MO_ST[o.status], "التسليم": o.dueDate, "إنتاج تحت التشغيل": o.wip, "تكلفة الوحدة الفعلية": o.actualUnitCost }))} name="أوامر التصنيع" />
        {can("mfg.write") && <button className="btn primary" data-mo-new onClick={() => setNeu({})}>＋ أمر تصنيع</button>}
      </div></div>
      <div className="card">{!data ? <Loading /> : !rows.length ? <Empty text="لا أوامر تصنيع" /> : <div className="table-wrap"><table className="tbl" data-mo-table>
        <thead><tr><th>الأمر</th><th>المنتج</th><th className="n">الكمية</th><th style={{ width: 150 }}>الإنجاز</th><th>المرحلة الحالية</th><th>المواد</th><th>التسليم</th><th className="n">تحت التشغيل</th><th>الحالة</th></tr></thead>
        <tbody>{rows.map((o) => <tr key={o.id} className="clickable" data-mo-row={o.number} onClick={() => nav(`/mfg/orders/${o.id}`)}>
          <td className="num"><b>{o.number}</b>{o.parentId && <div className="small muted">تجميع فرعي</div>}</td>
          <td>{o.productName} <span className="muted small">{o.sku}</span>{o.partnerName && <div className="small muted">للعميل {o.partnerName}{o.salesRef ? ` — ${o.salesRef}` : ""}</div>}</td>
          <td className="n">{q3(o.qty)} <span className="small muted">{o.unit}</span></td>
          <td><div className="row" style={{ gap: 6 }}><Bar pct={o.progressPct} color={o.status === "DONE" ? "#10b981" : undefined} /><span className="small num">{q3(o.producedQty)}</span></div></td>
          <td className="small">{o.stages ? `${o.stagesDone}/${o.stages}${o.currentStage && o.status !== "DONE" ? ` · ${o.currentStage}` : ""}` : "—"}</td>
          <td>{o.availability ? <span className={"badge " + AV[o.availability][1]}>{AV[o.availability][0]}</span> : "—"}</td>
          <td className={"small" + (o.late ? " neg-val" : "")}>{o.dueDate || "—"}{o.priority === 1 && <span className="badge red" style={{ marginInlineStart: 4 }}>عاجل</span>}</td>
          <td className="n">{o.wip ? <Money v={o.wip} /> : "—"}</td><td><MoBadge s={o.status} /></td></tr>)}</tbody></table></div>}</div>
      {neu && <NewOrderModal init={neu} onClose={() => setNeu(null)} onDone={(o: any) => { setNeu(null); reload(); nav(`/mfg/orders/${o.id}`); }} />}
    </div>
  );
}

export function NewOrderModal({ init, onClose, onDone }: { init: any; onClose: () => void; onDone: (o: any) => void }) {
  const [prod, setProd] = useState<any>(init.product || null);
  const boms = useFetch<any[]>(prod ? `/mfg/boms?productId=${prod.id}` : null, [prod?.id]);
  const wh = useWh();
  const [f, setF] = useState<any>({ qty: init.qty || 1, date: today(), plannedStart: today(), dueDate: "", priority: 2, subAssemblies: true, confirm: true, warehouseId: "", outputWarehouseId: "", notes: "", salesRef: "", lotNo: "" });
  const [partner, setPartner] = useState<any>(null);
  const bomList = (boms.data || []).filter((b: any) => b.isActive);
  const bom = bomList.find((b: any) => b.id === f.bomId) || bomList.find((b: any) => b.isDefault) || bomList[0];
  const cost = useFetch<any>(bom && Number(f.qty) > 0 ? `/mfg/cost?bomId=${bom.id}&qty=${f.qty}` : null, [bom?.id, f.qty]);
  const { run, busy } = useAction();
  const flat = (rows: any[], d = 0): any[] => rows.flatMap((r) => [{ ...r, d }, ...flat(r.children || [], d + 1)]);
  return (
    <Modal title="أمر تصنيع جديد" onClose={onClose} wide footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" data-mo-save disabled={busy || !prod || !bom || !(Number(f.qty) > 0)} onClick={() => run(async () => onDone(await api("/mfg/orders", { body: { ...f, productId: prod.id, bomId: bom.id, partnerId: partner?.id, warehouseId: f.warehouseId || undefined, outputWarehouseId: f.outputWarehouseId || undefined, dueDate: f.dueDate || undefined } })), "أُنشئ أمر التصنيع")}>إنشاء الأمر</button></>}>
      <div className="grid c3">
        <Field label="المنتج" span2><Picker value={prod} onChange={(p) => { setProd(p); setF({ ...f, bomId: undefined }); }} fetcher={stockFetcher} label={(p: any) => `${p.name}${p.sku ? " (" + p.sku + ")" : ""}`} placeholder="ابحث عن المنتج المطلوب تصنيعه" /></Field>
        <Field label="الكمية"><NumInput value={f.qty} onChange={(e: any) => setF({ ...f, qty: e.target.value })} data-mo-qty /></Field>
        {prod && <Field label="قائمة المواد" span2>{boms.data && !bomList.length ? <div className="alert warn small">لا قائمة مواد لهذا المنتج — <Link to="/mfg/boms?new=1">أنشئها أولاً</Link></div> : <Select value={bom?.id || ""} onChange={(e) => setF({ ...f, bomId: e.target.value })}>{bomList.map((b: any) => <option key={b.id} value={b.id}>{b.code}{b.isDefault ? " (الافتراضية)" : ""} — تكلفة الوحدة {money(b.unitCost)}</option>)}</Select>}</Field>}
        <Field label="الأولوية"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: Number(e.target.value) })}>{[1, 2, 3].map((p) => <option key={p} value={p}>{PRI[p]}</option>)}</Select></Field>
        <Field label="تاريخ الأمر"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="بداية التنفيذ"><Input type="date" value={f.plannedStart} onChange={(e) => setF({ ...f, plannedStart: e.target.value })} /></Field>
        <Field label="تاريخ التسليم"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        <Field label="مستودع المواد"><Select value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}><option value="">الافتراضي</option>{(wh.data || []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
        <Field label="مستودع المنتج التام"><Select value={f.outputWarehouseId} onChange={(e) => setF({ ...f, outputWarehouseId: e.target.value })}><option value="">نفس مستودع المواد</option>{(wh.data || []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
        <Field label="رقم الدفعة للإنتاج" hint="فارغ = رقم الأمر"><Input value={f.lotNo} onChange={(e) => setF({ ...f, lotNo: e.target.value })} /></Field>
        <Field label="لعميل (تصنيع حسب الطلب)" span2><Picker value={partner} onChange={setPartner} fetcher={partnerFetcher("CUSTOMER")} label={(p: any) => p.name} placeholder="اختياري" /></Field>
        <Field label="مرجع طلب العميل"><Input value={f.salesRef} onChange={(e) => setF({ ...f, salesRef: e.target.value })} /></Field>
        <Field label="ملاحظات" span3><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <div className="row mt" style={{ gap: 16, flexWrap: "wrap" }}>
        <label className="check"><input type="checkbox" checked={f.subAssemblies} onChange={(e) => setF({ ...f, subAssemblies: e.target.checked })} data-mo-subs /> أنشئ أوامر للمكونات المصنّعة الناقصة في المخزون (تجميع فرعي)</label>
        <label className="check"><input type="checkbox" checked={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.checked })} /> تأكيد الأمر مباشرة</label>
      </div>
      {cost.data && <div className="card mt" data-mo-preview><div className="card-h"><h3>ما يحتاجه الأمر</h3><span className="small">التكلفة المعيارية: <b className="num">{money(cost.data.totalForQty)}</b> ({money(cost.data.unitCost)} للوحدة)</span></div>
        <div className="table-wrap"><table className="tbl compact"><thead><tr><th>المكوّن</th><th className="n">الكمية</th><th className="n">في المخزون</th><th>الحالة</th></tr></thead>
          <tbody>{flat(cost.data.tree).map((r: any, i: number) => <tr key={i}><td style={{ paddingInlineStart: 8 + r.d * 18 }}>{r.d ? "↳ " : ""}{r.name} {r.kind && <span className="badge teal">{r.kind === "KIT" ? "طقم" : "يُصنَّع"}</span>}</td><td className="n">{q3(r.qty)} <span className="small muted">{r.unit}</span></td><td className="n">{q3(r.onHand)}</td><td>{r.onHand >= r.qty ? <span className="badge green">متوفر</span> : r.kind === "MANUFACTURE" ? <span className="badge blue">يُصنَّع</span> : <span className="badge red">ناقص {q3(r.qty - r.onHand)}</span>}</td></tr>)}</tbody></table></div></div>}
    </Modal>
  );
}

export function MfgOrderPage() {
  const { id } = useParams();
  const { can } = useCompanyContext();
  const { data: o, reload, error } = useFetch<any>(`/mfg/orders/${id}`, [id]);
  const [tab, setTab] = useTabParam("materials");
  const [modal, setModal] = useState<any>(null);
  const { run, busy } = useAction();
  const nav = useNavigate();
  const W = can("mfg.write");
  if (error) return <div className="card"><Empty text={error} /></div>;
  if (!o) return <Loading />;
  const open = ["DRAFT", "CONFIRMED", "IN_PROGRESS"].includes(o.status);
  const act = (path: string, body: any, msg?: string) => run(async () => { await api(`/mfg/orders/${o.id}/${path}`, { body }); reload(); }, msg);
  const S = o.sheet;
  return (
    <div className="grid" data-mo={o.number}>
      <div className="card">
        <div className="row between" style={{ flexWrap: "wrap", gap: 10 }}>
          <div><div className="row" style={{ gap: 8, alignItems: "center" }}><h2 style={{ margin: 0 }} className="num">{o.number}</h2><MoBadge s={o.status} />{o.priority === 1 && <span className="badge red">عاجل</span>}{o.late && <span className="badge red">متأخر</span>}</div>
            <div className="mt"><b>{o.productName}</b> <span className="muted">{o.sku}</span> — {q3(o.qty)} {o.unit} · قائمة المواد {o.bomCode}</div>
            <div className="small muted">التاريخ {o.date} · البداية {o.plannedStart || "—"} · التسليم {o.dueDate || "—"} · المواد من {o.warehouseName} ← المنتج إلى {o.outputWarehouseName}{o.partnerName ? ` · للعميل ${o.partnerName}` : ""}{o.salesRef ? ` (${o.salesRef})` : ""}{o.costCenterName ? ` · ${o.costCenterName}` : ""}</div>
            {o.parentNumber && <div className="small">تجميع فرعي لأمر <Link to={`/mfg/orders/${o.parentId}`}>{o.parentNumber}</Link></div>}
            {o.notes && <div className="small mt">{o.notes}</div>}</div>
          <div className="row no-print" style={{ gap: 6, flexWrap: "wrap" }}>
            {W && o.status === "DRAFT" && <button className="btn" disabled={busy} data-mo-confirm onClick={() => act("confirm", {}, "تم تأكيد الأمر")}>تأكيد</button>}
            {W && open && <button className="btn" disabled={busy} data-mo-issue-all onClick={() => act("issue", { all: true }, "صُرفت المواد")}>صرف كل المواد</button>}
            {W && open && <button className="btn primary" disabled={busy} data-mo-produce onClick={() => setModal({ k: "produce" })}>تسجيل إنتاج</button>}
            {W && o.status === "IN_PROGRESS" && <button className="btn" disabled={busy} data-mo-close onClick={() => setModal({ k: "close" })}>إقفال</button>}
            {W && open && <button className="btn ghost danger" disabled={busy} data-mo-cancel onClick={() => run(async () => { if (!confirmDlg("إلغاء الأمر؟ تعود المواد المصروفة للمخزن ويُعكس وقت المراحل.")) return; await api(`/mfg/orders/${o.id}/cancel`, { body: {} }); reload(); }, "أُلغي الأمر")}>إلغاء</button>}
            <PrintBtn pdfName={o.number} />
          </div>
        </div>
        <div className="row mt" style={{ gap: 10, alignItems: "center" }}><Bar pct={o.progressPct} color={o.status === "DONE" ? "#10b981" : undefined} /><span className="small num">أُنتج {q3(o.producedQty)} · تالف {q3(o.scrapQty)} من {q3(o.qty)}</span></div>
        <div className="fc-kpis mt" data-mo-kpis>
          <div className="fc-kpi"><span>تكلفة المواد</span><b className="num">{money(S.material)}</b></div>
          <div className="fc-kpi"><span>تكلفة المراحل</span><b className="num">{money(S.conversion)}</b><small>{q3(o.actualHours)} من {q3(o.plannedHours)} ساعة مخططة</small></div>
          <div className="fc-kpi"><span>تحت التشغيل الآن</span><b className="num" data-mo-wip>{money(S.wip)}</b></div>
          <div className="fc-kpi"><span>المستلم للمخزن</span><b className="num">{money(S.received)}</b>{S.byproducts > 0 && <small>منه منتجات ثانوية {money(S.byproducts)}</small>}</div>
          <div className="fc-kpi"><span>تكلفة الوحدة</span><b className="num">{S.actualUnitCost !== null ? money(S.actualUnitCost) : "—"}</b><small>المعيارية {money(S.stdUnitCost)}</small></div>
          <div className={"fc-kpi" + (S.costVariance > 0 ? " high" : S.costVariance < 0 ? " good" : "")}><span>الانحراف عن المعيار</span><b className="num">{S.costVariance !== null ? money(S.costVariance) : "—"}</b><small>{S.scrap ? `تالف ${money(S.scrap)}` : ""}{S.variance ? ` · إقفال ${money(S.variance)}` : ""}</small></div>
        </div>
      </div>
      <Tabs tabs={[{ key: "materials", label: `المواد (${o.materials.length})` }, { key: "stages", label: `المراحل (${o.ops.length})` }, { key: "cost", label: "التكلفة والإنتاج" }, { key: "moves", label: `الحركات والقيود (${o.moves.length})` }]} value={tab} onChange={setTab} />
      {tab === "materials" && <MaterialsTab o={o} W={W && open} reload={reload} />}
      {tab === "stages" && <div className="card"><div className="table-wrap"><table className="tbl" data-mo-ops>
        <thead><tr><th>#</th><th>المرحلة</th><th>مركز العمل</th><th className="n">المخطط</th><th className="n">الفعلي</th><th className="n">التكلفة</th><th>الحالة</th><th>المشغّل</th><th /></tr></thead>
        <tbody>{o.ops.map((op: any) => <tr key={op.seq} data-op={op.seq}>
          <td className="num">{op.seq}</td><td><b>{op.name}</b>{op.qc && <span className="badge teal" style={{ marginInlineStart: 6 }}>فحص جودة</span>}{op.instructions && <div className="small muted">{op.instructions}</div>}{op.qcNote && <div className="small neg-val">{op.qcNote}</div>}</td>
          <td>{op.workCenter}</td><td className="n">{mins(op.plannedMin)}</td><td className="n">{mins(op.actualMin)}</td><td className="n"><Money v={op.cost} /></td>
          <td><span className={"badge " + OP_ST[op.status][1]}>{OP_ST[op.status][0]}</span>{op.qcResult && <span className={"badge " + (op.qcResult === "PASS" ? "green" : "red")} style={{ marginInlineStart: 4 }}>{op.qcResult === "PASS" ? "ناجح" : "غير مطابق"}</span>}</td>
          <td className="small">{op.operator || "—"}{op.startedAt && <div className="muted">بدأ {fmtDT(op.startedAt)}</div>}</td>
          <td className="row" style={{ gap: 4 }}>{W && open && op.status !== "DONE" && <>
            {op.status !== "RUNNING" && <button className="btn sm" data-op-start onClick={() => act(`ops/${op.seq}`, { action: "start" }, `بدأت مرحلة ${op.name}`)}>بدء</button>}
            {op.outsourced && <button className="btn sm" data-op-sub onClick={() => setModal({ k: "sub", op })}>فاتورة الورشة</button>}
            <button className="btn sm primary" data-op-finish onClick={() => setModal({ k: "op", op })}>إنهاء</button></>}{op.qcResults && <div className="small muted">{op.qcResults.map((r: any) => `${r.name}: ${r.value}${r.unit ? " " + r.unit : ""}${r.ok ? " ✓" : " ✗"}`).join(" · ")}</div>}{op.subcontracted > 0 && <div className="small muted">ورشة خارجية {op.supplier}: {money(op.subcontracted)}</div>}</td></tr>)}</tbody></table></div>
        {!o.ops.length && <Empty text="قائمة المواد بلا مراحل: التكلفة من المواد فقط" />}</div>}
      {tab === "cost" && <CostTab o={o} />}
      {tab === "moves" && <div className="card"><div className="table-wrap"><table className="tbl compact" data-mo-moves><thead><tr><th>التاريخ</th><th>الحركة</th><th>الصنف / المرحلة</th><th className="n">الكمية</th><th className="n">القيمة</th><th>القيد</th><th>ملاحظة</th></tr></thead>
        <tbody>{o.moves.map((m: any) => <tr key={m.id}><td className="small">{m.date}</td><td>{KIND_MV[m.kind] || m.kind}</td><td>{m.productName || (m.opSeq ? (o.ops.find((x: any) => x.seq === m.opSeq)?.name || `مرحلة ${m.opSeq}`) : "—")}{m.minutes !== null && <span className="small muted"> · {mins(m.minutes)}</span>}</td><td className="n">{m.qty ? q3(m.qty) : "—"}</td><td className="n"><Money v={m.value} /></td><td>{m.entryId ? <Link to={`/journals/${m.entryId}`} className="num">{m.entryNumber}</Link> : "—"}</td><td className="small">{m.notes || ""}{m.operator ? <span> · المشغّل {m.operator}</span> : ""}{m.createdBy ? <span className="muted"> · {m.createdBy}</span> : ""}{m.serials?.length ? <details><summary>{m.serials.length} رقم تسلسلي</summary><div className="num">{m.serials.join("، ")}</div></details> : null}</td></tr>)}</tbody></table></div>
        {!o.moves.length && <Empty text="لم تُسجَّل حركات بعد" />}</div>}
      {o.children.length > 0 && <div className="card"><div className="card-h"><h3>أوامر التجميع الفرعي</h3></div><div className="table-wrap"><table className="tbl compact"><tbody>{o.children.map((c: any) => <tr key={c.id} className="clickable" onClick={() => nav(`/mfg/orders/${c.id}`)}><td className="num">{c.number}</td><td>{c.name}</td><td className="n">{q3(c.producedQty)} / {q3(c.qty)}</td><td><MoBadge s={c.status} /></td></tr>)}</tbody></table></div></div>}
      {modal?.k === "produce" && <ProduceModal o={o} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal?.k === "op" && <OpModal o={o} op={modal.op} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal?.k === "sub" && <SubcontractModal o={o} op={modal.op} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal?.k === "close" && <CloseModal o={o} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
    </div>
  );
}

function MaterialsTab({ o, W, reload }: { o: any; W: boolean; reload: () => void }) {
  const [q, setQ] = useState<Record<string, any>>({});
  const [extra, setExtra] = useState<any>(null); const [eq, setEq] = useState<any>("");
  const { run, busy } = useAction();
  const go = (path: string, componentId: string, qty: any, msg: string) => run(async () => { await api(`/mfg/orders/${o.id}/${path}`, { body: { lines: [{ componentId, qty: Number(qty) }] } }); setQ({}); reload(); }, msg);
  return (
    <div className="card"><div className="table-wrap"><table className="tbl" data-mo-materials>
      <thead><tr><th>المكوّن</th><th className="n">المخطط</th><th className="n">المصروف</th><th className="n">المرتجع</th><th className="n">المتبقي</th><th className="n">في المستودع</th><th>التوفر</th><th className="n">القيمة</th><th className="n">انحراف الكمية</th>{W && <th style={{ width: 210 }} />}</tr></thead>
      <tbody>{o.materials.map((m: any) => <tr key={m.componentId} data-mat={m.sku}>
        <td><b>{m.name}</b> <span className="small muted">{m.sku}</span>{m.extra && <span className="badge amber" style={{ marginInlineStart: 4 }}>بديل / إضافي</span>}{m.opSeq && <div className="small muted">يُستخدم في المرحلة {m.opSeq}</div>}</td>
        <td className="n">{q3(m.planned)} <span className="small muted">{m.unit}</span></td><td className="n">{q3(m.issued)}</td><td className="n">{m.returned ? q3(m.returned) : "—"}</td><td className="n">{q3(m.need)}</td><td className="n">{q3(m.onHand)}</td>
        <td><span className={"badge " + AV[m.avail][1]}>{AV[m.avail][0]}</span></td><td className="n"><Money v={m.value} /></td>
        <td className={"n" + (m.qtyVariance > 0.0005 ? " neg-val" : "")}>{o.producedQty + o.scrapQty > 0 ? q3(m.qtyVariance) : "—"}</td>
        {W && <td><div className="row" style={{ gap: 4 }}><NumInput style={{ width: 70 }} value={q[m.componentId] ?? ""} placeholder={q3(m.need)} onChange={(e: any) => setQ({ ...q, [m.componentId]: e.target.value })} aria-label={`كمية ${m.name}`} />
          <button className="btn sm" disabled={busy} data-mat-issue onClick={() => go("issue", m.componentId, q[m.componentId] || m.need, `صُرف ${m.name}`)}>صرف</button>
          {m.net > 0 && <button className="btn sm ghost" disabled={busy || !q[m.componentId]} data-mat-return onClick={() => go("return", m.componentId, q[m.componentId], `أُرجع ${m.name}`)}>إرجاع</button>}</div></td>}
      </tr>)}</tbody></table></div>
      {W && <div className="row mt" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ minWidth: 260, flex: 1 }}><Field label="صرف مكوّن بديل أو إضافي"><Picker value={extra} onChange={setExtra} fetcher={stockFetcher} label={(p: any) => `${p.name}${p.sku ? " (" + p.sku + ")" : ""}`} placeholder="ابحث عن صنف" /></Field></div>
        <Field label="الكمية"><NumInput style={{ width: 100 }} value={eq} onChange={(e: any) => setEq(e.target.value)} /></Field>
        <button className="btn" disabled={busy || !extra || !(Number(eq) > 0)} onClick={() => run(async () => { await api(`/mfg/orders/${o.id}/issue`, { body: { lines: [{ componentId: extra.id, qty: Number(eq) }] } }); setExtra(null); setEq(""); reload(); }, "صُرف المكوّن")}>صرف</button>
      </div>}
      <div className="small muted mt">«المتبقي» ما لم يُصرف من المخطط. عند تسجيل الإنتاج يُصرف تلقائياً ما يحتاجه الإنتاج المسجّل (إن لم تُلغِ خيار الصرف التلقائي). انحراف الكمية = الصافي المصروف − المعيار للمنتَج والتالف.</div>
    </div>
  );
}

function CostTab({ o }: { o: any }) {
  const S = o.sheet;
  const stdMat = o.materials.reduce((a: number, m: any) => a + m.stdValue, 0);
  const done = o.producedQty + o.scrapQty;
  const stdConv = o.ops.reduce((a: number, op: any) => a + op.plannedCost, 0) * (o.qty ? done / o.qty : 0);
  return (
    <div className="grid c2">
      <div className="card"><div className="card-h"><h3>ورقة التكلفة</h3></div><div className="table-wrap"><table className="tbl compact" data-mo-sheet>
        <thead><tr><th>البند</th><th className="n">المعياري للمنجز</th><th className="n">الفعلي</th><th className="n">الفرق</th></tr></thead>
        <tbody>
          <tr><td>المواد</td><td className="n">{done ? money(stdMat) : "—"}</td><td className="n">{money(S.material)}</td><td className="n">{done ? money(S.material - stdMat) : "—"}</td></tr>
          <tr><td>المراحل (عمالة وتشغيل)</td><td className="n">{done ? money(stdConv) : "—"}</td><td className="n">{money(S.conversion)}</td><td className="n">{done ? money(S.conversion - stdConv) : "—"}</td></tr>
          <tr className="total"><td>الإجمالي</td><td className="n">{done ? money(stdMat + stdConv) : "—"}</td><td className="n">{money(S.total)}</td><td className="n">{done ? money(S.total - stdMat - stdConv) : "—"}</td></tr>
          <tr><td colSpan={4} className="muted small">توزيعها</td></tr>
          <tr><td>استُلم للمخزن — المنتج</td><td /><td className="n">{money(S.receivedMain)}</td><td /></tr>
          {S.byproducts > 0 && <tr><td>استُلم للمخزن — منتجات ثانوية</td><td /><td className="n">{money(S.byproducts)}</td><td /></tr>}
          {S.scrap > 0 && <tr><td>تالف غير عادي (مصروف)</td><td /><td className="n">{money(S.scrap)}</td><td /></tr>}
          {S.variance !== 0 && <tr><td>انحراف عند الإقفال</td><td /><td className="n">{money(S.variance)}</td><td /></tr>}
          <tr><td>باقٍ تحت التشغيل</td><td /><td className="n">{money(S.wip)}</td><td /></tr>
        </tbody></table></div>
        <div className="small muted mt">الاستلام الجزئي يدخل المخزن بالتكلفة المعيارية، والاستلام الأخير يأخذ كل ما بقي في الأمر، فتكون تكلفة المنتج هي الفعلية. التالف العادي (المتوقع) يبقى على الإنتاج السليم، وغير العادي يُحمَّل على المصروفات بالتكلفة المعيارية.</div></div>
      <div className="card"><div className="card-h"><h3>النتيجة</h3></div><table className="tbl compact"><tbody>
        <tr><td>المنتج السليم</td><td className="n">{q3(o.producedQty)} {o.unit}</td></tr>
        <tr><td>التالف</td><td className="n">{q3(o.scrapQty)}</td></tr>
        <tr><td>نسبة السليم</td><td className="n">{S.yieldPct !== null ? `${S.yieldPct}%` : "—"}</td></tr>
        <tr><td>تكلفة الوحدة الفعلية</td><td className="n">{S.actualUnitCost !== null ? money(S.actualUnitCost) : "—"}</td></tr>
        <tr><td>تكلفة الوحدة المعيارية</td><td className="n">{money(S.stdUnitCost)}</td></tr>
        <tr><td>الانحراف (الفعلي − المعيار × المنتج)</td><td className="n">{S.costVariance !== null ? money(S.costVariance) : "يُحسب عند الإنهاء"}</td></tr>
      </tbody></table>
        {o.byproducts.length > 0 && <><h4 className="mt">المنتجات الثانوية</h4><table className="tbl compact"><thead><tr><th>الصنف</th><th className="n">المخطط</th><th className="n">المستلم</th><th className="n">النصيب</th><th className="n">القيمة</th></tr></thead><tbody>{o.byproducts.map((x: any) => <tr key={x.productId}><td>{x.name}</td><td className="n">{q3(x.planned)}</td><td className="n">{q3(x.received)}</td><td className="n">{x.sharePct}%</td><td className="n"><Money v={x.value} /></td></tr>)}</tbody></table></>}
      </div>
    </div>
  );
}

function ProduceModal({ o, onClose, onDone }: { o: any; onClose: () => void; onDone: () => void }) {
  const left = Math.max(0, o.qty - o.producedQty - o.scrapQty);
  const [f, setF] = useState<any>({ qty: left, scrapQty: 0, scrapKind: "NORMAL", lotNo: o.lotNo || "", expiryDate: o.expiryDate || "", backflush: true, date: today(), final: false, serialize: false, serialText: "" });
  const { run, busy } = useAction();
  const willFinish = f.final || Number(f.qty || 0) + Number(f.scrapQty || 0) + o.producedQty + o.scrapQty >= o.qty - 1e-9;
  return (
    <Modal title={`تسجيل إنتاج — ${o.number}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" data-produce-save disabled={busy || !(Number(f.qty) + Number(f.scrapQty) > 0)} onClick={() => run(async () => { await api(`/mfg/orders/${o.id}/produce`, { body: { ...f, qty: Number(f.qty) || 0, scrapQty: Number(f.scrapQty) || 0, serials: f.serialize && f.serialText.trim() ? f.serialText.split(/[\n,،]+/).map((x: string) => x.trim()).filter(Boolean) : undefined } }); onDone(); }, willFinish ? "اكتمل الأمر واستُلم الإنتاج" : "استُلم الإنتاج")}>{willFinish ? "استلام وإنهاء الأمر" : "استلام"}</button></>}>
      <div className="grid c2">
        <Field label={`الكمية السليمة (${o.unit || ""})`} hint={`المتبقي ${q3(left)}`}><NumInput value={f.qty} onChange={(e: any) => setF({ ...f, qty: e.target.value })} data-produce-qty /></Field>
        <Field label="التاريخ"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="التالف"><NumInput value={f.scrapQty} onChange={(e: any) => setF({ ...f, scrapQty: e.target.value })} data-produce-scrap /></Field>
        <Field label="نوع التالف"><Select value={f.scrapKind} onChange={(e) => setF({ ...f, scrapKind: e.target.value })} data-produce-kind><option value="NORMAL">عادي متوقع — يُحمَّل على الإنتاج السليم</option><option value="ABNORMAL">غير عادي — مصروف بالتكلفة المعيارية</option></Select></Field>
        <Field label="رقم الدفعة"><Input value={f.lotNo} onChange={(e) => setF({ ...f, lotNo: e.target.value })} placeholder={o.number} /></Field>
        <Field label="تاريخ الانتهاء (إن وجد)"><Input type="date" value={f.expiryDate} onChange={(e) => setF({ ...f, expiryDate: e.target.value })} /></Field>
      </div>
      <label className="check mt"><input type="checkbox" checked={f.serialize} onChange={(e) => setF({ ...f, serialize: e.target.checked })} data-produce-serial /> رقم تسلسلي لكل قطعة (تتبّع القطعة حتى العميل)</label>
      {f.serialize && <Field label="الأرقام التسلسلية" hint={`فارغ = تلقائياً ${f.lotNo || o.number}-001 …؛ أو سطر لكل قطعة (${q3(f.qty)} قطعة)`}><textarea className="input" rows={3} value={f.serialText} onChange={(e) => setF({ ...f, serialText: e.target.value })} dir="ltr" /></Field>}
      <label className="check mt"><input type="checkbox" checked={f.backflush} onChange={(e) => setF({ ...f, backflush: e.target.checked })} /> صرف تلقائي لما يحتاجه هذا الإنتاج من مواد لم تُصرف{willFinish ? "، وتسجيل المراحل غير المنتهية بزمنها المعياري" : ""}</label>
      {!willFinish && <label className="check"><input type="checkbox" checked={f.final} onChange={(e) => setF({ ...f, final: e.target.checked })} /> هذا آخر استلام (إنهاء الأمر بكمية أقل)</label>}
      <div className={"alert small mt " + (willFinish ? "info" : "")}>{willFinish ? "الاستلام الأخير: يدخل المنتج المخزن بكل ما بقي من تكلفة في الأمر (التكلفة الفعلية)، وتُستلم المنتجات الثانوية بأنصبتها، ويُغلق الأمر." : `استلام جزئي بالتكلفة المعيارية ${money(o.stdUnitCost)} للوحدة؛ الفرق يُسوّى في الاستلام الأخير.`}</div>
    </Modal>
  );
}

function OpModal({ o, op, onClose, onDone }: { o: any; op: any; onClose: () => void; onDone: () => void }) {
  const running = op.status === "RUNNING" && op.startedAt;
  const elapsed = running ? Math.round(((Date.now() - Date.parse(op.startedAt)) / 60000) * 10) / 10 : null;
  const [f, setF] = useState<any>({ minutes: elapsed ?? Math.max(0, Math.round((op.plannedMin - op.actualMin) * 100) / 100), qcResult: "", qcNote: "", operator: op.operator || "" });
  const [vals, setVals] = useState<Record<string, any>>({});
  const checks: any[] = op.checks || [];
  const inRange = (c: any, v: any) => (v === "" || v === undefined ? null : c.min === null && c.max === null ? !/^(لا|no)$/i.test(String(v).trim()) : (c.min === null || Number(v) >= c.min) && (c.max === null || Number(v) <= c.max));
  const allMeasured = checks.every((c) => vals[c.name] !== undefined && vals[c.name] !== "");
  const { run, busy } = useAction();
  const cost = (Number(f.minutes) / 60) * (op.rateHour + op.overheadHour);
  return (
    <Modal title={`إنهاء مرحلة «${op.name}» — ${o.number}`} onClose={onClose} narrow footer={<><button className="btn" onClick={onClose}>إلغاء</button>
      <button className="btn" disabled={busy} data-op-time onClick={() => run(async () => { await api(`/mfg/orders/${o.id}/ops/${op.seq}`, { body: { action: "time", minutes: Number(f.minutes), operator: f.operator } }); onDone(); }, "سُجّل الوقت")}>تسجيل وقت فقط</button>
      <button className="btn primary" data-op-save disabled={busy || (op.qc && (checks.length ? !allMeasured : !f.qcResult))} onClick={() => run(async () => { await api(`/mfg/orders/${o.id}/ops/${op.seq}`, { body: { action: "finish", ...f, minutes: Number(f.minutes), qcResults: checks.length ? checks.map((c) => ({ name: c.name, value: vals[c.name] })) : undefined } }); onDone(); }, "انتهت المرحلة")}>إنهاء المرحلة</button></>}>
      <Field label="الدقائق الفعلية" hint={`المخطط ${mins(op.plannedMin)}، المسجّل سابقاً ${mins(op.actualMin)}${elapsed !== null ? ` · منذ البدء ${mins(elapsed)}` : ""}`}><NumInput value={f.minutes} onChange={(e: any) => setF({ ...f, minutes: e.target.value })} data-op-minutes /></Field>
      <Field label="المشغّل"><Input value={f.operator} onChange={(e) => setF({ ...f, operator: e.target.value })} /></Field>
      {op.qc && checks.length > 0 && <div data-op-criteria><div className="small mt"><b>معايير الفحص</b></div><table className="tbl compact"><tbody>{checks.map((c) => { const r = inRange(c, vals[c.name]); return <tr key={c.name}><td>{c.name}{c.min !== null || c.max !== null ? <div className="small muted">{c.min ?? "—"} إلى {c.max ?? "—"} {c.unit || ""}</div> : <div className="small muted">نعم / لا</div>}</td><td style={{ width: 120 }}>{c.min !== null || c.max !== null ? <NumInput value={vals[c.name] ?? ""} onChange={(e: any) => setVals({ ...vals, [c.name]: e.target.value })} data-crit={c.name} /> : <Select value={vals[c.name] ?? ""} onChange={(e) => setVals({ ...vals, [c.name]: e.target.value })} data-crit={c.name}><option value="">—</option><option value="نعم">نعم</option><option value="لا">لا</option></Select>}</td><td style={{ width: 40 }}>{r === null ? "" : r ? <span className="pos-val">✓</span> : <span className="neg-val">✗</span>}</td></tr>; })}</tbody></table>
        {allMeasured && <div className={"alert small mt " + (checks.every((c) => inRange(c, vals[c.name])) ? "info" : "warn")}>{checks.every((c) => inRange(c, vals[c.name])) ? "كل المعايير ضمن الحدود — الفحص ناجح" : "معيار خارج حدوده — الفحص «غير مطابق» وتُعاد المرحلة"}</div>}</div>}
      {op.qc && !checks.length && <><Field label="نتيجة فحص الجودة"><div className="seg" data-op-qc><button className={f.qcResult === "PASS" ? "on" : ""} onClick={() => setF({ ...f, qcResult: "PASS" })}>✓ ناجح</button><button className={f.qcResult === "FAIL" ? "on" : ""} onClick={() => setF({ ...f, qcResult: "FAIL" })}>✗ غير مطابق</button></div></Field>
        </>}
      {op.qc && <Field label="ملاحظة الفحص"><Input value={f.qcNote} onChange={(e) => setF({ ...f, qcNote: e.target.value })} /></Field>}
      <div className="small muted">التكلفة: {mins(f.minutes)} × {money(op.rateHour + op.overheadHour)} للساعة = <b>{money(cost)}</b>{op.rateUnit > 0 ? ` + ${money(op.rateUnit)} لكل وحدة` : ""}</div>
    </Modal>
  );
}

function SubcontractModal({ o, op, onClose, onDone }: { o: any; op: any; onClose: () => void; onDone: () => void }) {
  const [sup, setSup] = useState<any>(null);
  const [f, setF] = useState<any>({ amount: "", ref: "", qty: o.qty, taxCode: "S", finish: true, date: today() });
  const { run, busy } = useAction();
  return (
    <Modal title={`فاتورة الورشة الخارجية — ${op.name} (${o.number})`} onClose={onClose} narrow footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" data-sub-save disabled={busy || !sup || !(Number(f.amount) > 0)} onClick={() => run(async () => { await api(`/mfg/orders/${o.id}/ops/${op.seq}`, { body: { action: "subcontract", supplierId: sup.id, ...f, amount: Number(f.amount), qty: Number(f.qty) } }); onDone(); }, "رُحّلت فاتورة الورشة وأضيفت تكلفتها للأمر")}>ترحيل الفاتورة</button></>}>
      <Field label="الورشة (المورد)"><Picker value={sup} onChange={setSup} fetcher={partnerFetcher("SUPPLIER")} label={(p: any) => p.name} placeholder="ابحث عن المورد" /></Field>
      <div className="grid c2"><Field label="المبلغ قبل الضريبة"><NumInput value={f.amount} onChange={(e: any) => setF({ ...f, amount: e.target.value })} data-sub-amount /></Field><Field label="الكمية المنفذة"><NumInput value={f.qty} onChange={(e: any) => setF({ ...f, qty: e.target.value })} /></Field>
        <Field label="رقم فاتورة المورد"><Input value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} /></Field><Field label="الضريبة"><Select value={f.taxCode} onChange={(e) => setF({ ...f, taxCode: e.target.value })}><option value="S">خاضعة</option><option value="Z">صفرية</option><option value="E">معفاة</option><option value="O">خارج النطاق</option></Select></Field></div>
      <label className="check"><input type="checkbox" checked={f.finish} onChange={(e) => setF({ ...f, finish: e.target.checked })} /> إنهاء المرحلة بعد الفاتورة{op.qc ? " (المرحلة فيها فحص جودة: أنهِها بنتيجته)" : ""}</label>
      <div className="small muted mt">تُرحَّل فاتورة مشتريات للمورد: من ح/ إنتاج تحت التشغيل (+ ضريبة المدخلات) إلى ح/ المورد، فتدخل تكلفة الورشة في تكلفة المنتج بالمبلغ المفوتر.</div>
    </Modal>
  );
}

function CloseModal({ o, onClose, onDone }: { o: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<any>({ reason: "", returnUnused: true });
  const { run, busy } = useAction();
  return (
    <Modal title={`إقفال ${o.number} قبل اكتماله`} onClose={onClose} narrow footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" data-close-save disabled={busy || !f.reason.trim()} onClick={() => run(async () => { await api(`/mfg/orders/${o.id}/close`, { body: f }); onDone(); }, "أُقفل الأمر")}>إقفال</button></>}>
      <div className="alert small">أُنتج {q3(o.producedQty)} من {q3(o.qty)}. ما يبقى تحت التشغيل ({money(o.sheet.wip)}) يُحمَّل على «انحرافات أوامر التصنيع».</div>
      <Field label="السبب"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} data-close-reason /></Field>
      <label className="check"><input type="checkbox" checked={f.returnUnused} onChange={(e) => setF({ ...f, returnUnused: e.target.checked })} /> أرجع أولاً للمخزن المواد المصروفة الزائدة عن المنتج والتالف</label>
    </Modal>
  );
}

// ───────────────────────── bills of materials ─────────────────────────
export function MfgBomsPage() {
  const { can } = useCompanyContext();
  const { data, reload } = useFetch<any[]>("/mfg/boms");
  const [edit, setEdit] = useState<any>(null);
  useNewParam(() => setEdit({}));
  const [qs, setQs] = useState("");
  const rows = (data || []).filter((b) => !qs || `${b.code} ${b.productName} ${b.sku || ""}`.includes(qs));
  return (
    <div className="grid" data-boms>
      <div className="card"><div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Input placeholder="بحث بالمنتج أو الرمز" value={qs} onChange={(e) => setQs(e.target.value)} style={{ maxWidth: 260 }} /><div className="grow" />
        <ExportBtn rows={() => rows.map((b) => ({ "الرمز": b.code, "المنتج": b.productName, "الإصدار": b.version, "النوع": b.kind === "KIT" ? "طقم" : "تصنيع", "حجم الدفعة": b.outputQty, "المكونات": b.components, "المراحل": b.stages, "تكلفة المواد للوحدة": b.material, "تكلفة المراحل للوحدة": b.conversion, "تكلفة الوحدة": b.unitCost }))} name="قوائم المواد" />
        {can("mfg.write") && <button className="btn primary" data-bom-new onClick={() => setEdit({})}>＋ قائمة مواد</button>}
      </div><div className="small muted mt">قائمة المواد تبيّن من أي شيء يُصنع المنتج وكيف: المكونات أو الخلطة بكمياتها ونسبة الهالك، والمراحل على مراكز العمل، والمنتجات الثانوية. المكوّن الذي له قائمة مواد يُصنَّع بدوره (مستويات متعددة)، و«الطقم» يُفكّ إلى مكوناته داخل المنتج.</div></div>
      <div className="card">{!data ? <Loading /> : !rows.length ? <Empty text="لا قوائم مواد بعد" /> : <div className="table-wrap"><table className="tbl" data-bom-table>
        <thead><tr><th>الرمز</th><th>المنتج</th><th>النوع</th><th className="n">حجم الدفعة</th><th className="n">المكونات</th><th className="n">المراحل</th><th className="n">المستويات</th><th className="n">مواد / وحدة</th><th className="n">مراحل / وحدة</th><th className="n">تكلفة الوحدة</th><th className="n">المعيار المجمّد</th><th className="n">أوامر</th></tr></thead>
        <tbody>{rows.map((b) => <tr key={b.id} className={"clickable" + (b.isActive ? "" : " muted")} data-bom-row={b.sku} onClick={() => setEdit(b)}>
          <td className="num">{b.code}{b.isDefault && <span className="badge teal" style={{ marginInlineStart: 4 }}>افتراضية</span>}{!b.isActive && <span className="badge gray" style={{ marginInlineStart: 4 }}>موقوفة</span>}</td>
          <td><b>{b.productName}</b> <span className="small muted">{b.sku}</span></td><td>{b.kind === "KIT" ? "طقم" : "تصنيع"}</td><td className="n">{q3(b.outputQty)} {b.unit}</td><td className="n">{b.components}</td><td className="n">{b.stages}</td><td className="n">{b.levels}</td>
          <td className="n"><Money v={b.material} /></td><td className="n"><Money v={b.conversion} /></td><td className="n"><b><Money v={b.unitCost} /></b></td><td className="n">{b.frozenCost !== null ? <>{money(b.frozenCost)}{b.drift ? <div className={"small " + (b.drift > 0 ? "neg-val" : "pos-val")}>{b.drift > 0 ? "+" : ""}{b.drift}%</div> : null}</> : "—"}</td><td className="n">{b.orders || "—"}</td></tr>)}</tbody></table></div>}</div>
      {edit && <BomEditor init={edit} onClose={() => setEdit(null)} onSaved={() => { reload(); }} />}
    </div>
  );
}

function BomEditor({ init, onClose, onSaved }: { init: any; onClose: () => void; onSaved: () => void }) {
  const { can } = useCompanyContext();
  const W = can("mfg.write");
  const [id, setId] = useState<string | null>(init.id || null);
  const full = useFetch<any>(id ? `/mfg/boms/${id}` : null, [id]);
  const wcs = useWcs();
  const [prod, setProd] = useState<any>(null);
  const [f, setF] = useState<any>({ kind: "MANUFACTURE", outputQty: 1, lotQty: "", name: "", notes: "", isDefault: true, isActive: true });
  const [lines, setLines] = useState<any[]>([{ k: 1, comp: null, qty: "", wastePct: 0, opSeq: "" }]);
  const [ops, setOps] = useState<any[]>([]);
  const [bys, setBys] = useState<any[]>([]);
  const [tab, setTab] = useState("lines");
  const [chk, setChk] = useState<number | null>(null);
  const { run, busy } = useAction();
  useEffect(() => {
    const b = full.data; if (!b) return;
    setProd({ id: b.productId, name: b.productName, sku: b.sku, unit: b.unit });
    setF({ kind: b.kind, outputQty: b.outputQty, lotQty: b.lotQty ?? "", name: b.name || "", notes: b.notes || "", isDefault: b.isDefault, isActive: b.isActive });
    const cl = new Map(b.cost.lines.map((l: any) => [l.componentId, l]));
    setLines(b.lines.map((l: any, i: number) => { const c: any = cl.get(l.componentId) || {}; return { k: i + 1, comp: { id: l.componentId, name: c.name, sku: c.sku, unit: c.unit }, qty: l.qty, wastePct: l.wastePct || 0, opSeq: l.opSeq ?? "", note: l.note || "" }; }));
    setOps(b.ops.map((o: any) => ({ ...o })));
    const bl = new Map(b.cost.byproducts.map((x: any) => [x.productId, x]));
    setBys(b.byproducts.map((x: any) => { const c: any = bl.get(x.productId) || {}; return { prod: { id: x.productId, name: c.name, sku: c.sku }, qty: x.qty, sharePct: x.sharePct }; }));
  }, [full.data]);
  const body = () => ({ productId: prod?.id, ...f, outputQty: Number(f.outputQty), lotQty: Number(f.lotQty) > 0 ? Number(f.lotQty) : null, lines: lines.filter((l) => l.comp).map((l) => ({ componentId: l.comp.id, qty: Number(l.qty), wastePct: Number(l.wastePct) || 0, opSeq: l.opSeq === "" ? null : Number(l.opSeq), note: l.note || undefined })), ops: ops.map((o, i) => ({ seq: Number(o.seq) || (i + 1) * 10, name: o.name, workCenterId: o.workCenterId, setupMin: Number(o.setupMin) || 0, runMin: Number(o.runMin) || 0, qc: !!o.qc, checks: o.qc ? (o.checks || []).filter((c: any) => String(c.name || "").trim()) : [], instructions: o.instructions || undefined })), byproducts: bys.filter((x) => x.prod).map((x) => ({ productId: x.prod.id, qty: Number(x.qty), sharePct: Number(x.sharePct) || 0 })) });
  const save = (asNew: boolean) => run(async () => { const r = await api(asNew || !id ? "/mfg/boms" : `/mfg/boms/${id}`, { method: asNew || !id ? "POST" : "PUT", body: { ...body(), ...(asNew ? { isDefault: true } : {}) } }); setId(r.id); full.reload(); onSaved(); }, asNew ? "حُفظ إصدار جديد" : "حُفظت قائمة المواد");
  const cost = full.data?.cost;
  const cl = new Map((cost?.lines || []).map((l: any) => [l.componentId, l]));
  const wcList = (wcs.data || []).filter((w: any) => w.isActive);
  const upd = (set: any, list: any[], i: number, patch: any) => set(list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const flat = (rows: any[], d = 0): any[] => rows.flatMap((r) => [{ ...r, d }, ...flat(r.children || [], d + 1)]);
  return (
    <Modal title={id ? `قائمة المواد ${full.data?.code || ""}` : "قائمة مواد جديدة"} onClose={onClose} wide footer={<>
      <button className="btn" onClick={onClose}>إغلاق</button>
      {W && id && <button className="btn ghost danger" disabled={busy} onClick={() => run(async () => { if (!confirmDlg("حذف قائمة المواد؟ إن استُخدمت في أوامر تُوقف بدل الحذف.")) return; await api(`/mfg/boms/${id}`, { method: "DELETE" }); onSaved(); onClose(); }, "تم")}>حذف</button>}
      {W && id && <button className="btn" disabled={busy} data-bom-version onClick={() => save(true)}>حفظ كإصدار جديد</button>}
      {W && <button className="btn primary" disabled={busy || !prod} data-bom-save onClick={() => save(false)}>حفظ</button>}</>}>
      <div className="grid c3">
        <Field label="المنتج" span2>{id ? <Input value={`${prod?.name || ""} ${prod?.sku ? "(" + prod.sku + ")" : ""}`} disabled /> : <Picker value={prod} onChange={setProd} fetcher={stockFetcher} label={(p: any) => `${p.name}${p.sku ? " (" + p.sku + ")" : ""}`} placeholder="المنتج التام أو نصف المصنّع" />}</Field>
        <Field label="النوع"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="MANUFACTURE">تصنيع (يدخل المخزون)</option><option value="KIT">طقم — يُفكّ إلى مكوناته داخل المنتج</option></Select></Field>
        <Field label="الكميات أدناه لإنتاج" hint="حجم الدفعة: 1 قطعة، 100 لتر، 50 كجم…"><NumInput value={f.outputQty} onChange={(e: any) => setF({ ...f, outputQty: e.target.value })} data-bom-output /></Field>
        <Field label="كمية التشغيل المعتادة" hint="يُوزَّع عليها زمن التجهيز في التكلفة المعيارية (فارغ = حجم الدفعة)"><NumInput value={f.lotQty} onChange={(e: any) => setF({ ...f, lotQty: e.target.value })} /></Field>
        <Field label="وصف (اختياري)"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="مثل: خلطة الصيف" /></Field>
        <div className="row" style={{ gap: 12, alignItems: "flex-end" }}><label className="check"><input type="checkbox" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} /> الافتراضية للمنتج</label><label className="check"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> نشطة</label></div>
      </div>
      <Tabs tabs={[{ key: "lines", label: `المكونات والخلطة (${lines.filter((l) => l.comp).length})` }, ...(f.kind === "KIT" ? [] : [{ key: "ops", label: `المراحل (${ops.length})` }, { key: "by", label: `منتجات ثانوية (${bys.length})` }]), ...(id ? [{ key: "cost", label: "التكلفة والهيكل" }] : [])]} value={tab} onChange={setTab} />
      {tab === "lines" && <><div className="table-wrap"><table className="tbl compact" data-bom-lines><thead><tr><th style={{ minWidth: 240 }}>المكوّن</th><th className="n" style={{ width: 100 }}>الكمية</th><th className="n" style={{ width: 80 }}>هالك %</th><th style={{ width: 150 }}>في المرحلة</th><th className="n">تكلفة الوحدة</th><th className="n">التكلفة</th><th /></tr></thead>
        <tbody>{lines.map((l, i) => { const c: any = l.comp ? cl.get(l.comp.id) : null; return <tr key={l.k} data-bom-line={i}>
          <td><Picker value={l.comp} onChange={(p) => upd(setLines, lines, i, { comp: p })} fetcher={stockFetcher} label={(p: any) => `${p.name}${p.sku ? " (" + p.sku + ")" : ""}`} placeholder="مادة خام، مكوّن أو نصف مصنّع" />{c?.hasBom && <span className="badge teal small">{c.bomKind === "KIT" ? "طقم" : "يُصنَّع"}</span>}</td>
          <td><NumInput value={l.qty} onChange={(e: any) => upd(setLines, lines, i, { qty: e.target.value })} placeholder={l.comp?.unit || ""} data-bom-qty /></td>
          <td><NumInput value={l.wastePct} onChange={(e: any) => upd(setLines, lines, i, { wastePct: e.target.value })} /></td>
          <td><Select value={l.opSeq} onChange={(e) => upd(setLines, lines, i, { opSeq: e.target.value })}><option value="">—</option>{ops.map((o) => <option key={o.seq} value={o.seq}>{o.seq} {o.name}</option>)}</Select></td>
          <td className="n">{c ? money(c.unitCost) : "—"}</td><td className="n">{c ? money(c.cost) : "—"}</td>
          <td><button className="btn sm ghost danger" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="حذف السطر">✕</button></td></tr>; })}</tbody></table></div>
        <button className="btn sm mt" data-bom-add-line onClick={() => setLines([...lines, { k: Date.now(), comp: null, qty: "", wastePct: 0, opSeq: "" }])}>＋ مكوّن</button>
        {lines.some((l) => l.comp && Number(l.qty) > 0) && prod?.unit && lines.filter((l) => l.comp).every((l) => l.comp.unit === prod.unit) && <div className="small muted mt">مجموع المدخلات بالوزن/الحجم يفيد في الخلطات: {q3(lines.filter((l) => l.comp).reduce((a, l) => a + (Number(l.qty) || 0) * (1 + (Number(l.wastePct) || 0) / 100), 0))} لإنتاج {q3(f.outputQty)} — نسبة الناتج {(() => { const inp = lines.filter((l) => l.comp).reduce((a, l) => a + (Number(l.qty) || 0) * (1 + (Number(l.wastePct) || 0) / 100), 0); return inp ? `${Math.round((Number(f.outputQty) / inp) * 1000) / 10}%` : "—"; })()} (إن كانت الوحدات متجانسة)</div>}</>}
      {tab === "ops" && <><div className="table-wrap"><table className="tbl compact" data-bom-ops><thead><tr><th style={{ width: 70 }}>#</th><th>المرحلة</th><th>مركز العمل</th><th className="n" style={{ width: 100 }}>تجهيز (د)</th><th className="n" style={{ width: 100 }}>لكل وحدة (د)</th><th>فحص جودة</th><th>تعليمات</th><th /></tr></thead>
        <tbody>{ops.map((o, i) => <tr key={i} data-bom-op={i}>
          <td><NumInput value={o.seq} onChange={(e: any) => upd(setOps, ops, i, { seq: e.target.value })} /></td>
          <td><Input value={o.name} onChange={(e) => upd(setOps, ops, i, { name: e.target.value })} placeholder="قص، خلط، تجميع، دهان…" data-op-name /></td>
          <td><Select value={o.workCenterId || ""} onChange={(e) => upd(setOps, ops, i, { workCenterId: e.target.value })} data-op-wc><option value="">اختر</option>{wcList.map((w: any) => <option key={w.id} value={w.id}>{w.name} — {money(w.costHour)}/س</option>)}</Select></td>
          <td><NumInput value={o.setupMin || 0} onChange={(e: any) => upd(setOps, ops, i, { setupMin: e.target.value })} /></td>
          <td><NumInput value={o.runMin || 0} onChange={(e: any) => upd(setOps, ops, i, { runMin: e.target.value })} data-op-run /></td>
          <td><input type="checkbox" checked={!!o.qc} onChange={(e) => upd(setOps, ops, i, { qc: e.target.checked })} aria-label="فحص جودة" />{o.qc && <button className="btn sm ghost" data-op-checks onClick={() => setChk(i)}>معايير ({(o.checks || []).length})</button>}</td>
          <td><Input value={o.instructions || ""} onChange={(e) => upd(setOps, ops, i, { instructions: e.target.value })} /></td>
          <td><button className="btn sm ghost danger" onClick={() => setOps(ops.filter((_, j) => j !== i))} aria-label="حذف المرحلة">✕</button></td></tr>)}</tbody></table></div>
        <div className="row mt" style={{ gap: 8 }}><button className="btn sm" data-bom-add-op onClick={() => setOps([...ops, { seq: (ops.length + 1) * 10, name: "", workCenterId: wcList[0]?.id || "", setupMin: 0, runMin: 0, qc: false }])}>＋ مرحلة</button>{!wcList.length && <span className="small">لا مراكز عمل — <Link to="/mfg/work-centers">أضفها أولاً</Link></span>}</div>
        {chk !== null && ops[chk] && <div className="card mt" data-checks-editor><div className="card-h"><h3>معايير فحص «{ops[chk].name || "المرحلة"}»</h3><button className="btn sm" onClick={() => setChk(null)}>تم</button></div>
          <table className="tbl compact"><thead><tr><th>المعيار</th><th className="n">الحد الأدنى</th><th className="n">الحد الأعلى</th><th>الوحدة</th><th /></tr></thead><tbody>{(ops[chk].checks || []).map((c: any, j: number) => { const setC = (patch: any) => upd(setOps, ops, chk, { checks: ops[chk].checks.map((x: any, k: number) => (k === j ? { ...x, ...patch } : x)) }); return <tr key={j} data-check-row={j}>
            <td><Input value={c.name || ""} onChange={(e) => setC({ name: e.target.value })} placeholder="القياس، اللون، الحموضة…" data-check-name /></td><td><NumInput value={c.min ?? ""} onChange={(e: any) => setC({ min: e.target.value })} data-check-min /></td><td><NumInput value={c.max ?? ""} onChange={(e: any) => setC({ max: e.target.value })} data-check-max /></td><td><Input value={c.unit || ""} onChange={(e) => setC({ unit: e.target.value })} style={{ width: 80 }} /></td>
            <td><button className="btn sm ghost danger" onClick={() => upd(setOps, ops, chk, { checks: ops[chk].checks.filter((_: any, k: number) => k !== j) })} aria-label="حذف">✕</button></td></tr>; })}</tbody></table>
          <button className="btn sm mt" data-check-add onClick={() => upd(setOps, ops, chk, { checks: [...(ops[chk].checks || []), { name: "", min: "", max: "", unit: "" }] })}>＋ معيار</button>
          <div className="small muted mt">معيار بحدين رقميين يُقاس عند إنهاء المرحلة، وخروج أي قيمة عن حدودها يجعل الفحص «غير مطابق» تلقائياً. معيار بلا حدود يُجاب بنعم/لا.</div></div>}
        <div className="small muted mt">زمن التجهيز مرة لكل أمر، وزمن الوحدة يُضرب في الكمية. تكلفة المرحلة = الزمن × تكلفة ساعة مركز العمل (+ تكلفة الوحدة للورش الخارجية).</div></>}
      {tab === "by" && <><div className="table-wrap"><table className="tbl compact"><thead><tr><th>المنتج الثانوي</th><th className="n" style={{ width: 110 }}>الكمية للدفعة</th><th className="n" style={{ width: 120 }}>نصيبه من التكلفة %</th><th /></tr></thead>
        <tbody>{bys.map((x, i) => <tr key={i}><td><Picker value={x.prod} onChange={(p) => upd(setBys, bys, i, { prod: p })} fetcher={stockFetcher} label={(p: any) => p.name} placeholder="نشارة، قصاصات، منتج مرافق…" /></td><td><NumInput value={x.qty} onChange={(e: any) => upd(setBys, bys, i, { qty: e.target.value })} /></td><td><NumInput value={x.sharePct} onChange={(e: any) => upd(setBys, bys, i, { sharePct: e.target.value })} /></td><td><button className="btn sm ghost danger" onClick={() => setBys(bys.filter((_, j) => j !== i))} aria-label="حذف">✕</button></td></tr>)}</tbody></table></div>
        <button className="btn sm mt" onClick={() => setBys([...bys, { prod: null, qty: "", sharePct: 0 }])}>＋ منتج ثانوي</button>
        <div className="small muted mt">يدخل المنتج الثانوي المخزن مع الاستلام الأخير بنصيبه من تكلفة الأمر؛ الباقي على المنتج الرئيسي.</div></>}
      {tab === "cost" && cost && <div className="grid c2" data-bom-cost>
        <div><table className="tbl compact"><tbody>
          <tr><td>المواد للوحدة</td><td className="n">{money(cost.material)}</td></tr><tr><td>المراحل للوحدة</td><td className="n">{money(cost.conversion)}</td></tr>
          {cost.byproductShare > 0 && <tr><td>نصيب المنتجات الثانوية</td><td className="n">{cost.byproductShare}%</td></tr>}
          <tr className="total"><td>التكلفة الحالية للوحدة</td><td className="n" data-bom-unit>{money(cost.unitCost)}</td></tr>
          <tr><td>التكلفة المعيارية المجمّدة</td><td className="n" data-bom-frozen>{full.data.frozenCost !== null ? <>{money(full.data.frozenCost)} <span className="small muted">({String(full.data.frozenAt).slice(0, 10)})</span></> : "—"}</td></tr><tr><td>تكلفة الدفعة ({q3(cost.outputQty)})</td><td className="n">{money(cost.batchCost)}</td></tr></tbody></table>
          {cost.ops.length > 0 && <table className="tbl compact mt"><thead><tr><th>المرحلة</th><th className="n">دقيقة/وحدة</th><th className="n">تكلفة/وحدة</th></tr></thead><tbody>{cost.ops.map((o: any) => <tr key={o.seq}><td>{o.name} <span className="small muted">{o.workCenter}</span></td><td className="n">{o.minPerUnit}</td><td className="n">{money(o.perUnit)}</td></tr>)}</tbody></table>}
          {W && <div className="row mt" style={{ gap: 6 }}><button className="btn sm" disabled={busy} data-bom-freeze onClick={() => run(async () => { await api(`/mfg/boms/${id}/freeze`, { body: {} }); full.reload(); onSaved(); }, "جُمّدت التكلفة المعيارية")}>{full.data.frozenCost !== null ? "تحديث التجميد بالتكلفة الحالية" : "تجميد التكلفة المعيارية"}</button>{full.data.frozenCost !== null && <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { await api(`/mfg/boms/${id}/freeze`, { body: { release: true } }); full.reload(); onSaved(); }, "أُلغي التجميد")}>إلغاء التجميد</button>}</div>}
          <div className="small muted mt">التجميد يثبّت المعيار (كما يفعل SAP وDynamics): الأوامر والاستلام الجزئي تُقاس عليه، والانحراف يُظهر أثر تغيّر الأسعار والكفاءة.</div>
          {full.data.usedIn.length > 0 && <div className="small mt">يدخل في: {full.data.usedIn.map((u: any) => u.name).join("، ")}</div>}
          {full.data.versions.length > 1 && <div className="small mt">الإصدارات: {full.data.versions.map((v: any) => <button key={v.id} className={"chip" + (v.id === id ? " on" : "")} onClick={() => setId(v.id)}>V{v.version}{v.isDefault ? " ✓" : ""}</button>)}</div>}</div>
        <div><h4 style={{ marginTop: 0 }}>الهيكل لدفعة واحدة</h4><table className="tbl compact"><tbody>{flat(full.data.tree).map((r: any, i: number) => <tr key={i}><td style={{ paddingInlineStart: 8 + r.d * 18 }}>{r.d ? "↳ " : ""}{r.name}{r.kind && <span className="badge teal" style={{ marginInlineStart: 4 }}>{r.kind === "KIT" ? "طقم" : "يُصنَّع"}</span>}</td><td className="n">{q3(r.qty)} <span className="small muted">{r.unit}</span></td><td className="n">{money(r.unitCost)}</td></tr>)}</tbody></table></div>
      </div>}
      <Field label="ملاحظات"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    </Modal>
  );
}

// ───────────────────────── work centres ─────────────────────────
export function MfgWorkCentersPage() {
  const { can } = useCompanyContext();
  const { data, reload } = useWcs();
  const [edit, setEdit] = useState<any>(null);
  useNewParam(() => setEdit({}));
  return (
    <div className="grid" data-wcs>
      <div className="card"><div className="row" style={{ alignItems: "center" }}><div className="small muted grow">مركز العمل مكان تُنفَّذ فيه مرحلة: آلة، خط إنتاج، فريق عمل أو ورشة خارجية. تكلفة الساعة (أجور + تشغيل وطاقة وإهلاك) تُحمَّل على أوامر التصنيع بالوقت الفعلي، والطاقة اليومية تُستخدم في جدولة الأحمال.</div>
        {can("mfg.write") && <button className="btn primary" data-wc-new onClick={() => setEdit({})}>＋ مركز عمل</button>}</div></div>
      <div className="card">{!data ? <Loading /> : !data.length ? <Empty text="لا مراكز عمل" /> : <div className="table-wrap"><table className="tbl" data-wc-table>
        <thead><tr><th>الرمز</th><th>الاسم</th><th>النوع</th><th className="n">أجور/س</th><th className="n">تشغيل/س</th><th className="n">التكلفة/س</th><th className="n">لكل وحدة</th><th className="n">الطاقة اليومية</th><th>مركز التكلفة</th><th className="n">مراحل مفتوحة</th></tr></thead>
        <tbody>{data.map((w: any) => <tr key={w.id} className={"clickable" + (w.isActive ? "" : " muted")} onClick={() => setEdit(w)} data-wc-row={w.code}>
          <td className="num">{w.code}</td><td><b>{w.name}</b>{!w.isActive && <span className="badge gray" style={{ marginInlineStart: 4 }}>موقوف</span>}</td><td>{WC_KIND[w.kind]}</td><td className="n"><Money v={w.rateHour} /></td><td className="n"><Money v={w.overheadHour} /></td><td className="n"><b><Money v={w.costHour} /></b></td><td className="n">{w.rateUnit ? <Money v={w.rateUnit} /> : "—"}</td>
          <td className="n">{mins(w.dailyMinutes)} <span className="small muted">({w.units} × {w.capacityHours} س × {w.efficiencyPct}%)</span></td><td className="small">{w.costCenterName || "—"}</td><td className="n">{w.openOps ? `${w.openOps} · ${q3(w.openHours)} س` : "—"}</td></tr>)}</tbody></table></div>}</div>
      {edit && <WcModal init={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </div>
  );
}
function WcModal({ init, onClose, onDone }: { init: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<any>(() => ({ name: "", code: "", kind: "MACHINE", rateHour: 0, overheadHour: 0, rateUnit: 0, capacityHours: 8, units: 1, efficiencyPct: 100, notes: "", isActive: true, ...init, costCenterId: init.costCenterId || "" }));
  const cc = useFetch<any[]>("/cost-centers");
  const { run, busy } = useAction();
  return (
    <Modal title={init.id ? `مركز العمل ${init.code}` : "مركز عمل جديد"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>إلغاء</button>{init.id && <button className="btn ghost danger" disabled={busy} onClick={() => run(async () => { await api(`/mfg/work-centers/${init.id}`, { method: "DELETE" }); onDone(); }, "تم")}>حذف</button>}<button className="btn primary" data-wc-save disabled={busy || !String(f.name).trim()} onClick={() => run(async () => { await api(init.id ? `/mfg/work-centers/${init.id}` : "/mfg/work-centers", { method: init.id ? "PUT" : "POST", body: { ...f, costCenterId: f.costCenterId || null } }); onDone(); }, "حُفظ مركز العمل")}>حفظ</button></>}>
      <div className="grid c2">
        <Field label="الاسم"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-wc-name /></Field>
        <Field label="الرمز" hint="فارغ = تلقائي"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="النوع"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(WC_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="مركز التكلفة (لتحليل التكاليف)"><Select value={f.costCenterId} onChange={(e) => setF({ ...f, costCenterId: e.target.value })}><option value="">—</option>{(cc.data || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="أجور التشغيل للساعة"><NumInput value={f.rateHour} onChange={(e: any) => setF({ ...f, rateHour: e.target.value })} data-wc-rate /></Field>
        <Field label="تكاليف التشغيل للساعة" hint="كهرباء، صيانة، إهلاك الآلة، إيجار المساحة"><NumInput value={f.overheadHour} onChange={(e: any) => setF({ ...f, overheadHour: e.target.value })} data-wc-overhead /></Field>
        <Field label="تكلفة لكل وحدة" hint="للورش الخارجية (دهان، طلاء، تقطيع بالقطعة)"><NumInput value={f.rateUnit} onChange={(e: any) => setF({ ...f, rateUnit: e.target.value })} /></Field>
        <Field label="ساعات العمل في اليوم"><NumInput value={f.capacityHours} onChange={(e: any) => setF({ ...f, capacityHours: e.target.value })} /></Field>
        <Field label="عدد الآلات أو العمال بالتوازي"><NumInput value={f.units} onChange={(e: any) => setF({ ...f, units: e.target.value })} /></Field>
        <Field label="الكفاءة %"><NumInput value={f.efficiencyPct} onChange={(e: any) => setF({ ...f, efficiencyPct: e.target.value })} /></Field>
      </div>
      <Field label="ملاحظات"><Input value={f.notes || ""} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <label className="check"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> نشط</label>
    </Modal>
  );
}

// ───────────────────────── shop floor ─────────────────────────
export function MfgFloorPage() {
  const wcs = useWcs();
  const [wc, setWc] = useState<string>(() => { try { return localStorage.getItem("mz_floor_wc") || ""; } catch { return ""; } });
  const { data, reload } = useFetch<any[]>(`/mfg/floor${wc ? `?workCenterId=${wc}` : ""}`, [wc]);
  const [op, setOp] = useState<any>(null);
  const { run, busy } = useAction();
  const { can } = useCompanyContext();
  useEffect(() => { const t = setInterval(reload, 20000); return () => clearInterval(t); }, [wc]);
  const pick = (v: string) => { setWc(v); try { localStorage.setItem("mz_floor_wc", v); } catch { /* blocked */ } };
  return (
    <div className="grid" data-floor>
      <div className="card"><div className="seg" data-floor-wcs><button className={!wc ? "on" : ""} onClick={() => pick("")}>كل مراكز العمل</button>{(wcs.data || []).filter((w: any) => w.isActive).map((w: any) => <button key={w.id} className={wc === w.id ? "on" : ""} data-floor-wc={w.name} onClick={() => pick(w.id)}>{w.name}</button>)}</div>
        <div className="small muted mt">ما على الورشة الآن بترتيب الأولوية وموعد التسليم. المرحلة «جاهزة» حين تنتهي ما قبلها. تتحدث كل 20 ثانية.</div></div>
      {!data ? <Loading /> : !data.length ? <div className="card"><Empty text="لا مراحل مطلوبة في هذا المركز" /></div> : <div className="floor-grid">{data.map((x) => <div key={`${x.orderId}-${x.seq}`} className={"card floor-card" + (x.status === "RUNNING" ? " running" : "") + (!x.ready ? " waiting" : "") + (x.late ? " late" : "")} data-floor-op={`${x.number}-${x.seq}`}>
        <div className="row between"><Link to={`/mfg/orders/${x.orderId}`} className="num"><b>{x.number}</b></Link><span className={"badge " + OP_ST[x.status][1]}>{OP_ST[x.status][0]}</span></div>
        <div className="floor-stage">{x.seq}. {x.name}{x.qc && <span className="badge teal" style={{ marginInlineStart: 6 }}>فحص جودة</span>}</div>
        <div>{x.productName} — <b>{q3(x.qty)}</b> {x.unit}{x.producedQty ? <span className="small muted"> (أُنجز {q3(x.producedQty)})</span> : ""}</div>
        <div className="small muted">{x.workCenter} · المخطط {mins(x.plannedMin)}{x.actualMin ? ` · المسجّل ${mins(x.actualMin)}` : ""}{x.dueDate ? ` · التسليم ${x.dueDate}` : ""}{x.priority === 1 ? " · عاجل" : ""}</div>
        {x.instructions && <div className="small mt">{x.instructions}</div>}
        {x.availability !== "OK" && <div className={"badge " + AV[x.availability][1]} style={{ marginTop: 6 }}>{AV[x.availability][0]}</div>}
        {!x.ready && <div className="small muted mt">بانتظار انتهاء المرحلة السابقة</div>}
        {can("mfg.write") && <div className="row mt" style={{ gap: 6 }}>{x.status !== "RUNNING" && <button className="btn" disabled={busy} data-floor-start onClick={() => run(async () => { await api(`/mfg/orders/${x.orderId}/ops/${x.seq}`, { body: { action: "start" } }); reload(); }, "بدأت المرحلة")}>▶ بدء</button>}<button className="btn primary" disabled={busy} data-floor-finish onClick={async () => setOp({ x, o: await api(`/mfg/orders/${x.orderId}`) })}>✓ إنهاء</button></div>}
      </div>)}</div>}
      {op && <OpModal o={op.o} op={op.o.ops.find((y: any) => y.seq === op.x.seq)} onClose={() => setOp(null)} onDone={() => { setOp(null); reload(); }} />}
    </div>
  );
}

// ───────────────────────── requirements planning ─────────────────────────
export function MfgPlanPage() {
  const [safety, setSafety] = useState(true);
  const { data, reload } = useFetch<any>(`/mfg/plan?safety=${safety ? 1 : 0}`, [safety]);
  const [qty, setQty] = useState<Record<string, any>>({});
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const { run, busy } = useAction();
  const toast = useToast();
  const nav = useNavigate();
  const { can } = useCompanyContext();
  useEffect(() => { if (data) { setQty(Object.fromEntries(data.rows.map((r: any) => [r.productId, r.suggested]))); setSel(Object.fromEntries(data.rows.filter((r: any) => r.suggested > 0).map((r: any) => [r.productId, true]))); } }, [data]);
  const chosen = (make: boolean) => (data?.rows || []).filter((r: any) => r.make === make && sel[r.productId] && Number(qty[r.productId]) > 0);
  return (
    <div className="grid" data-plan-mfg>
      <div className="card"><div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label className="check"><input type="checkbox" checked={safety} onChange={(e) => setSafety(e.target.checked)} /> احسب حد إعادة الطلب كمخزون أمان</label><div className="grow" />
        {data && <><span className="badge blue">{data.totals.make} للتصنيع</span><span className="badge amber">{data.totals.buy} للشراء · {money(data.totals.buyValue)}</span></>}
      </div><div className="small muted mt">الطلب = أوامر البيع المفتوحة + مكونات أوامر التصنيع المفتوحة التي لم تُصرف + ما تحتاجه الأوامر المقترحة (مستوى بعد مستوى) + مخزون الأمان. المتاح = المخزون + أوامر الشراء المفتوحة + المتبقي من أوامر التصنيع. الصنف الذي له قائمة مواد يُقترح تصنيعه، وغيره شراؤه.</div></div>
      <div className="card">{!data ? <Loading /> : !data.rows.length ? <Empty text="لا احتياجات: لا أوامر بيع أو تصنيع مفتوحة ولا أصناف تحت حد الطلب" /> : <div className="table-wrap"><table className="tbl" data-mrp-table>
        <thead><tr><th style={{ width: 28 }} /><th>الصنف</th><th>القرار</th><th className="n">أوامر البيع</th><th className="n">أوامر التصنيع</th><th className="n">للمقترح</th><th className="n">أمان</th><th className="n">المخزون</th><th className="n">أوامر شراء</th><th className="n">قيد التصنيع</th><th className="n">الصافي</th><th className="n" style={{ width: 100 }}>المقترح</th><th>المورد</th><th className="n">القيمة</th></tr></thead>
        <tbody>{data.rows.map((r: any) => <tr key={r.productId} data-mrp-row={r.sku}>
          <td>{r.suggested > 0 && <input type="checkbox" checked={!!sel[r.productId]} onChange={(e) => setSel({ ...sel, [r.productId]: e.target.checked })} aria-label={r.name} />}</td>
          <td style={{ paddingInlineStart: 8 + r.level * 16 }}>{r.level ? "↳ " : ""}<b>{r.name}</b> <span className="small muted">{r.unit}</span></td>
          <td>{r.make ? <span className="badge blue">تصنيع</span> : <span className="badge amber">شراء</span>}</td>
          <td className="n">{r.sales ? q3(r.sales) : "—"}</td><td className="n">{r.moDemand ? q3(r.moDemand) : "—"}</td><td className="n">{r.planDemand ? q3(r.planDemand) : "—"}</td><td className="n">{r.safety ? q3(r.safety) : "—"}</td>
          <td className="n">{q3(r.onHand)}</td><td className="n">{r.onPO ? q3(r.onPO) : "—"}</td><td className="n">{r.inProduction ? q3(r.inProduction) : "—"}</td><td className={"n" + (r.net > 0 ? " neg-val" : "")}>{q3(r.net)}</td>
          <td className="n">{r.suggested > 0 ? <NumInput style={{ width: 90 }} value={qty[r.productId] ?? r.suggested} onChange={(e: any) => setQty({ ...qty, [r.productId]: e.target.value })} data-mrp-qty /> : "—"}</td>
          <td className="small">{r.supplierName || (r.make ? "" : "—")}</td><td className="n">{r.value ? <Money v={r.value} /> : "—"}</td></tr>)}</tbody></table></div>}</div>
      {data && <div className="card"><div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        {can("mfg.write") && <button className="btn primary" disabled={busy || !chosen(true).length} data-mrp-make onClick={() => run(async () => { const r = await api("/mfg/plan/orders", { body: { items: chosen(true).map((x: any) => ({ productId: x.productId, qty: Number(qty[x.productId]) })) } }); toast(`أُنشئ ${r.length} أمر تصنيع (مسودة)`); reload(); nav("/mfg/orders"); }, undefined)}>إنشاء أوامر التصنيع ({chosen(true).length})</button>}
        {can("purchases.write") && <button className="btn" disabled={busy || !chosen(false).length} data-mrp-buy onClick={() => run(async () => { const r = await api("/inventory/reorder/orders", { body: { items: chosen(false).map((x: any) => ({ productId: x.productId, qty: Number(qty[x.productId]), supplierId: x.supplierId, price: x.price })) } }); toast(`أُنشئ ${r.length} أمر شراء (مسودة)`); reload(); }, undefined)}>إنشاء أوامر الشراء ({chosen(false).length})</button>}
      </div></div>}
    </div>
  );
}

// ───────────────────────── capacity schedule ─────────────────────────
export function MfgSchedulePage() {
  const [p, setP] = useState({ from: today(), days: 14, offDay: 5 });
  const { data } = useFetch<any>(`/mfg/schedule?from=${p.from}&days=${p.days}&offDay=${p.offDay}`, [p.from, p.days, p.offDay]);
  const nav = useNavigate();
  const heat = (m: number, c: number) => (c <= 0 ? "var(--surface-2)" : m <= 0 ? "transparent" : m / c > 0.95 ? "rgba(239,68,68,.35)" : m / c > 0.7 ? "rgba(245,158,11,.35)" : "rgba(16,185,129,.28)");
  return (
    <div className="grid" data-schedule>
      <div className="card"><div className="row" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <Field label="من"><Input type="date" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} /></Field>
        <Field label="عدد الأيام"><Select value={p.days} onChange={(e) => setP({ ...p, days: Number(e.target.value) })}>{[7, 14, 21, 31, 62].map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
        <Field label="يوم العطلة"><Select value={p.offDay} onChange={(e) => setP({ ...p, offDay: Number(e.target.value) })}><option value={5}>الجمعة</option><option value={6}>السبت</option><option value={0}>الأحد</option><option value={-1}>بلا عطلة</option></Select></Field>
        {data && <span className={"badge " + (data.late ? "red" : "green")}>{data.late ? `${data.late} أمر سينتهي بعد موعده` : "كل الأوامر في موعدها"}</span>}
      </div><div className="small muted mt">جدولة بطاقة محدودة: الأوامر بترتيب الحالة والأولوية وموعد التسليم، وكل مرحلة تبدأ بعد سابقتها وتملأ الوقت الفارغ في مركز عملها يوماً بعد يوم.</div></div>
      {!data ? <Loading /> : <>
        <div className="card"><div className="card-h"><h3>حمل مراكز العمل (دقائق مشغولة من الطاقة)</h3></div><div className="table-wrap"><table className="tbl compact sched" data-sched-load>
          <thead><tr><th>مركز العمل</th>{data.days.map((d: string) => <th key={d} className="n small">{d.slice(5)}</th>)}<th className="n">الاستغلال</th></tr></thead>
          <tbody>{data.centers.map((c: any) => <tr key={c.id} data-sched-wc={c.name}><td><b>{c.name}</b><div className="small muted">{mins(c.dailyMinutes)} يومياً</div></td>{c.load.map((x: any) => <td key={x.day} className="n small" style={{ background: heat(x.minutes, x.capacity) }} title={`${x.minutes} من ${x.capacity} دقيقة`}>{x.capacity <= 0 ? "عطلة" : x.minutes ? Math.round((x.minutes / x.capacity) * 100) + "%" : ""}</td>)}<td className="n">{c.utilizationPct}%{c.backlogHours > c.loadHours ? <div className="small muted">+{q3(r2(c.backlogHours - c.loadHours))} س بعد الفترة</div> : null}</td></tr>)}</tbody></table></div></div>
        <div className="card"><div className="card-h"><h3>متى ينتهي كل أمر</h3></div>{!data.orders.length ? <Empty text="لا أوامر مفتوحة" /> : <div className="table-wrap"><table className="tbl compact" data-sched-orders>
          <thead><tr><th>الأمر</th><th>المنتج</th><th>البداية المتوقعة</th><th>النهاية المتوقعة</th><th>التسليم</th><th>المراحل</th></tr></thead>
          <tbody>{data.orders.map((o: any) => <tr key={o.id} className="clickable" onClick={() => nav(`/mfg/orders/${o.id}`)}><td className="num">{o.number} <MoBadge s={o.status} /></td><td>{o.productName} × {q3(o.qty)}</td><td className="small">{o.start || "—"}</td><td className={"small" + (o.late ? " neg-val" : "")}>{o.end || "—"}{o.late && " ⚠"}</td><td className="small">{o.dueDate || "—"}</td><td className="small">{o.ops.filter((x: any) => x.minutes).map((x: any) => `${x.name}: ${x.start?.slice(5)}${x.end !== x.start ? `←${x.end?.slice(5)}` : ""}`).join(" · ") || "—"}</td></tr>)}</tbody></table></div>}</div>
      </>}
    </div>
  );
}
const r2 = (x: number) => Math.round(x * 100) / 100;

// ───────────────────────── disassembly ─────────────────────────
export function MfgUnbuildPage() {
  const { can } = useCompanyContext();
  const list = useFetch<any[]>("/mfg/unbuilds");
  const wh = useWh();
  const [prod, setProd] = useState<any>(null);
  const [f, setF] = useState<any>({ qty: 1, warehouseId: "", notes: "", date: today() });
  const prev = useFetch<any>(prod && Number(f.qty) > 0 ? `/mfg/cost?productId=${prod.id}&qty=${f.qty}` : null, [prod?.id, f.qty]);
  const { run, busy } = useAction();
  return (
    <div className="grid" data-unbuild>
      <div className="card"><div className="small muted">الفك: يخرج المنتج من المخزن وتعود مكوناته حسب قائمة المواد، وتتوزع قيمته عليها بنسبة تكلفتها — بلا قيد لأن القيمة تبقى في المخزون. مفيد لمراكز التجميع والصيانة وإعادة التدوير وفك الأطقم.</div>
        {can("mfg.write") && <div className="grid c3 mt">
          <Field label="المنتج المراد فكّه" span2><Picker value={prod} onChange={setProd} fetcher={stockFetcher} label={(p: any) => `${p.name}${p.sku ? " (" + p.sku + ")" : ""}`} placeholder="ابحث عن المنتج" /></Field>
          <Field label="الكمية"><NumInput value={f.qty} onChange={(e: any) => setF({ ...f, qty: e.target.value })} data-unbuild-qty /></Field>
          <Field label="المستودع"><Select value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}><option value="">الافتراضي</option>{(wh.data || []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
          <Field label="التاريخ"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="السبب"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>}
        {prev.data && <div className="mt"><div className="small">يعود للمخزن:</div><div className="chips mt">{prev.data.lines.map((l: any) => <span key={l.componentId} className="chip">{l.name}: {q3((l.qty * Number(f.qty)) / prev.data.outputQty)} {l.unit}</span>)}</div></div>}
        {prev.error && prod && <div className="alert warn small mt">{prev.error}</div>}
        {can("mfg.write") && <button className="btn primary mt" disabled={busy || !prod || !(Number(f.qty) > 0)} data-unbuild-save onClick={() => run(async () => { await api("/mfg/unbuilds", { body: { ...f, productId: prod.id, qty: Number(f.qty), warehouseId: f.warehouseId || undefined } }); setProd(null); list.reload(); }, "تم الفك وأُعيدت المكونات للمخزن")}>فك وإرجاع المكونات</button>}
      </div>
      <div className="card"><div className="card-h"><h3>عمليات الفك</h3></div>{!list.data ? <Loading /> : !list.data.length ? <Empty text="لا عمليات فك" /> : <div className="table-wrap"><table className="tbl compact" data-unbuild-table>
        <thead><tr><th>الرقم</th><th>التاريخ</th><th>المنتج</th><th className="n">الكمية</th><th className="n">القيمة</th><th>المكونات العائدة</th></tr></thead>
        <tbody>{list.data.map((u: any) => <tr key={u.id}><td className="num">{u.number}</td><td className="small">{u.date}</td><td>{u.productName}</td><td className="n">{q3(u.qty)}</td><td className="n"><Money v={u.value} /></td><td className="small">{u.lines.map((l: any) => `${l.name} ${q3(l.qty)} (${money(l.value)})`).join("، ")}</td></tr>)}</tbody></table></div>}</div>
    </div>
  );
}

// ───────────────────────── reports ─────────────────────────
export function MfgReportsPage() {
  const [r, setR] = useState({ from: today().slice(0, 8) + "01", to: today() });
  const [tab, setTab] = useTabParam("orders");
  const { data } = useFetch<any>(`/mfg/reports?from=${r.from}&to=${r.to}`, [r.from, r.to]);
  const nav = useNavigate();
  return (
    <div className="grid" data-mfg-reports>
      <div className="card"><div className="row" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}><DateRange from={r.from} to={r.to} onChange={(f, t) => setR({ from: f, to: t })} /><div className="grow" /><PrintBtn pdfName="تقارير التصنيع" /></div></div>
      {!data ? <Loading /> : <>
        <div className="fc-kpis">
          <div className="fc-kpi"><span>أوامر منتهية</span><b className="num">{data.totals.orders}</b></div>
          <div className="fc-kpi"><span>قيمة الإنتاج</span><b className="num">{money(data.totals.produced)}</b><small>المعيار {money(data.totals.std)}</small></div>
          <div className={"fc-kpi" + (data.totals.costVariance > 0 ? " high" : " good")}><span>انحراف التكلفة</span><b className="num">{money(data.totals.costVariance)}</b><small>{data.totals.costVariance > 0 ? "أعلى من المعيار" : "ضمن المعيار أو أقل"}</small></div>
          <div className="fc-kpi"><span>تالف غير عادي</span><b className="num">{money(data.totals.scrap)}</b></div>
          <div className="fc-kpi"><span>انحرافات الإقفال</span><b className="num">{money(data.totals.closeVariance)}</b></div>
          <div className={"fc-kpi" + (data.wip.match ? " good" : " high")}><span>تحت التشغيل الآن</span><b className="num">{money(data.wip.total)}</b><small>{data.wip.match ? "مطابق للأستاذ" : `الأستاذ ${money(data.wip.ledger)}`}</small></div>
        </div>
        <Tabs tabs={[{ key: "orders", label: "الأوامر المنتهية" }, { key: "production", label: "الإنتاج حسب المنتج" }, { key: "materials", label: "المواد المستهلكة" }, { key: "centers", label: "مراكز العمل" }, { key: "scrap", label: "التالف" }, { key: "operators", label: "ساعات العمال" }, { key: "outside", label: "الورش الخارجية" }, { key: "wip", label: "تحت التشغيل" }]} value={tab} onChange={setTab} />
        {tab === "orders" && <div className="card"><div className="card-h"><h3>الأوامر المنتهية والانحرافات</h3><ExportBtn rows={() => data.orders.map((o: any) => ({ "الأمر": o.number, "المنتج": o.productName, "المطلوب": o.qty, "الكمية المنتجة": o.producedQty, "التالف": o.scrapQty, "المواد": o.material, "المراحل": o.conversion, "المستلم": o.received, "المعيار": o.std, "الانحراف": o.costVariance, "تكلفة الوحدة": o.unitCost, "المعيارية": o.stdUnitCost, "نسبة السليم %": o.yieldPct }))} name="أوامر التصنيع المنتهية" /></div>
          {!data.orders.length ? <Empty text="لا أوامر انتهت في الفترة" /> : <div className="table-wrap"><table className="tbl compact" data-rep-orders><thead><tr><th>الأمر</th><th>المنتج</th><th className="n">المنتج / المطلوب</th><th className="n">التالف</th><th className="n">المواد</th><th className="n">المراحل</th><th className="n">قيمة المنتج</th><th className="n">الوحدة</th><th className="n">المعيارية</th><th className="n">الانحراف</th><th className="n">السليم %</th></tr></thead>
            <tbody>{data.orders.map((o: any) => <tr key={o.id} className="clickable" onClick={() => nav(`/mfg/orders/${o.id}`)}><td className="num">{o.number}</td><td>{o.productName}</td><td className="n">{q3(o.producedQty)} / {q3(o.qty)}</td><td className="n">{o.scrapQty ? q3(o.scrapQty) : "—"}</td><td className="n"><Money v={o.material} /></td><td className="n"><Money v={o.conversion} /></td><td className="n"><Money v={o.received} /></td><td className="n">{o.unitCost !== null ? money(o.unitCost) : "—"}</td><td className="n">{money(o.stdUnitCost)}</td><td className={"n" + (o.costVariance > 0 ? " neg-val" : "")}>{o.costVariance !== null ? money(o.costVariance) : "—"}</td><td className="n">{o.yieldPct ?? "—"}</td></tr>)}</tbody></table></div>}</div>}
        {tab === "production" && <div className="card"><div className="table-wrap"><table className="tbl compact"><thead><tr><th>المنتج</th><th className="n">الكمية</th><th className="n">القيمة</th><th className="n">متوسط تكلفة الوحدة</th></tr></thead><tbody>{data.production.map((p: any) => <tr key={p.productId}><td>{p.name} <span className="small muted">{p.sku}</span></td><td className="n">{q3(p.qty)} {p.unit}</td><td className="n"><Money v={p.value} /></td><td className="n">{money(p.unitCost)}</td></tr>)}</tbody></table>{!data.production.length && <Empty text="لا إنتاج في الفترة" />}</div></div>}
        {tab === "materials" && <div className="card"><div className="table-wrap"><table className="tbl compact"><thead><tr><th>المادة</th><th className="n">الصافي المصروف</th><th className="n">القيمة</th></tr></thead><tbody>{data.materials.map((p: any) => <tr key={p.productId}><td>{p.name} <span className="small muted">{p.sku}</span></td><td className="n">{q3(p.qty)} {p.unit}</td><td className="n"><Money v={p.value} /></td></tr>)}</tbody></table>{!data.materials.length && <Empty text="لا مواد صُرفت في الفترة" />}</div></div>}
        {tab === "centers" && <div className="card"><div className="table-wrap"><table className="tbl compact" data-rep-centers><thead><tr><th>مركز العمل</th><th className="n">الساعات</th><th className="n">الطاقة في الفترة</th><th style={{ width: "28%" }}>الاستغلال</th><th className="n">التكلفة المحمّلة</th></tr></thead><tbody>{data.centers.map((w: any) => <tr key={w.id}><td><b>{w.name}</b></td><td className="n">{q3(w.hours)}</td><td className="n">{q3(w.capacityHours)}</td><td><div className="row" style={{ gap: 6 }}><Bar pct={w.utilizationPct} /><span className="small num">{w.utilizationPct}%</span></div></td><td className="n"><Money v={w.value} /></td></tr>)}</tbody></table></div></div>}
        {tab === "scrap" && <div className="card"><div className="table-wrap"><table className="tbl compact"><thead><tr><th>التاريخ</th><th>الأمر</th><th>المنتج</th><th className="n">الكمية</th><th className="n">القيمة المحمّلة</th><th>النوع</th></tr></thead><tbody>{data.scrap.map((s: any, i: number) => <tr key={i}><td className="small">{s.date}</td><td className="num">{s.number}</td><td>{s.name}</td><td className="n">{q3(s.qty)}</td><td className="n"><Money v={s.value} /></td><td className="small">{s.notes}</td></tr>)}</tbody></table>{!data.scrap.length && <Empty text="لا تالف في الفترة" />}</div></div>}
        {tab === "operators" && <div className="card"><div className="table-wrap"><table className="tbl compact" data-rep-operators><thead><tr><th>المشغّل</th><th className="n">الساعات</th><th className="n">أوامر</th><th className="n">التكلفة المحمّلة</th></tr></thead><tbody>{data.operators.map((x: any) => <tr key={x.operator}><td><b>{x.operator}</b></td><td className="n">{q3(x.hours)}</td><td className="n">{x.orders}</td><td className="n"><Money v={x.value} /></td></tr>)}</tbody></table>{!data.operators.length && <Empty text="لا وقت مسجّل في الفترة" />}</div><div className="small muted mt">من وقت المراحل المسجّل باسم المشغّل في الأمر أو شاشة الورشة.</div></div>}
        {tab === "outside" && <div className="card"><div className="table-wrap"><table className="tbl compact"><thead><tr><th>التاريخ</th><th>الأمر</th><th>الورشة والفاتورة</th><th className="n">المبلغ</th></tr></thead><tbody>{data.outside.map((x: any, i: number) => <tr key={i}><td className="small">{x.date}</td><td className="num">{x.number}</td><td>{x.invoiceId ? <Link to={`/doc/${x.invoiceId}`}>{x.notes}</Link> : x.notes}</td><td className="n"><Money v={x.value} /></td></tr>)}</tbody></table>{!data.outside.length && <Empty text="لا فواتير ورش خارجية في الفترة" />}</div></div>}
        {tab === "wip" && <div className="card"><div className={"alert small " + (data.wip.match ? "info" : "warn")}>مجموع أوامر التشغيل المفتوحة {money(data.wip.total)} — رصيد حساب «إنتاج تحت التشغيل» {money(data.wip.ledger)}{data.wip.match ? " ✓ مطابق" : " — غير مطابق"}</div>
          <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الأمر</th><th>المنتج</th><th>الحالة</th><th className="n">المواد</th><th className="n">المراحل</th><th className="n">المستلم</th><th className="n">تحت التشغيل</th></tr></thead><tbody>{data.wip.orders.map((o: any) => <tr key={o.id} className="clickable" onClick={() => nav(`/mfg/orders/${o.id}`)}><td className="num">{o.number}</td><td>{o.name}</td><td><MoBadge s={o.status} /></td><td className="n"><Money v={o.material} /></td><td className="n"><Money v={o.conversion} /></td><td className="n"><Money v={o.received} /></td><td className="n"><b><Money v={o.wip} /></b></td></tr>)}</tbody></table></div></div>}
      </>}
    </div>
  );
}
void useMemo;

// ───────────────────────── lot / serial traceability ─────────────────────────
export function MfgTracePage() {
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get("lot") || "");
  const [lot, setLot] = useState(q);
  const { data, error } = useFetch<any>(lot ? `/mfg/trace?lot=${encodeURIComponent(lot)}` : null, [lot]);
  return (
    <div className="grid" data-trace>
      <div className="card"><div className="row" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <Field label="رقم الدفعة أو الرقم التسلسلي أو رقم أمر التصنيع"><Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setLot(q.trim()); }} dir="ltr" style={{ minWidth: 260 }} data-trace-q /></Field>
        <button className="btn primary" data-trace-go onClick={() => setLot(q.trim())}>تتبّع</button>
      </div><div className="small muted mt">للخلف: من أي أمر تصنيع خرجت الدفعة، ومن شغّله، ونتائج فحص الجودة، ودفعات المكونات ومورديها. للأمام: أوامر التصنيع التي استهلكتها، والعملاء الذين اشتروها، وما بقي منها في المخزون. يفيد عند سحب منتج من السوق أو شكوى جودة.</div></div>
      {error && <div className="card"><Empty text={error} /></div>}
      {data && !data.found && <div className="card"><Empty text={`لا أثر للدفعة ${data.lot}`} /></div>}
      {data?.found && <>
        {data.origins.map((og: any) => <div className="card" key={og.order.id} data-trace-origin><div className="card-h"><h3>صُنعت في <Link to={`/mfg/orders/${og.order.id}`} className="num">{og.order.number}</Link> — {og.order.productName}</h3><MoBadge s={og.order.status} /></div>
          <div className="small">التاريخ {og.order.date} · أُنتج {q3(og.order.producedQty)} من {q3(og.order.qty)}{og.operators.length ? ` · المشغّلون: ${og.operators.join("، ")}` : ""}</div>
          {og.qc.length > 0 && <div className="small mt">فحص الجودة: {og.qc.map((x: any) => `${x.stage}: ${x.result === "PASS" ? "ناجح" : x.result === "FAIL" ? "غير مطابق" : "—"}${x.results ? ` (${x.results.map((r: any) => `${r.name} ${r.value}`).join("، ")})` : ""}`).join(" · ")}</div>}
          <div className="table-wrap mt"><table className="tbl compact" data-trace-components><thead><tr><th>المكوّن</th><th className="n">الكمية</th><th>دفعاته</th><th>المورد (فاتورة الشراء)</th></tr></thead>
            <tbody>{og.components.map((c: any, i: number) => <tr key={i}><td>{c.name}</td><td className="n">{q3(c.qty)} {c.unit}</td><td className="small num">{c.lots.map((l: any) => <Link key={l.lotNo} to={`/mfg/trace?lot=${encodeURIComponent(l.lotNo)}`} onClick={() => { setQ(l.lotNo); setLot(l.lotNo); }}>{l.lotNo} </Link>)}{!c.lots.length && "—"}</td><td className="small">{c.suppliers.map((x: any) => `${x.supplier} (${x.invoice})`).join("، ") || "—"}</td></tr>)}</tbody></table></div></div>)}
        {data.consumedBy.length > 0 && <div className="card"><div className="card-h"><h3>استُهلكت في أوامر التصنيع</h3></div><table className="tbl compact"><tbody>{data.consumedBy.map((x: any) => <tr key={x.id}><td><Link to={`/mfg/orders/${x.id}`} className="num">{x.number}</Link></td><td>{x.product}</td><td className="small">{x.date}</td><td className="n">{q3(x.qty)}</td><td><MoBadge s={x.status} /></td></tr>)}</tbody></table></div>}
        <div className="card" data-trace-sold><div className="card-h"><h3>بيعت إلى</h3></div>{!data.soldTo.length ? <Empty text="لم يُبع منها شيء" /> : <table className="tbl compact"><tbody>{data.soldTo.map((x: any, i: number) => <tr key={i}><td><Link to={`/doc/${x.id}`} className="num">{x.number}</Link></td><td>{x.customer || "عميل نقدي"}</td><td>{x.product}</td><td className="small">{x.date}</td><td className="n">{q3(x.qty)}</td></tr>)}</tbody></table>}</div>
        {data.stock.length > 0 && <div className="card"><div className="card-h"><h3>الباقي في المخزون</h3></div><table className="tbl compact"><tbody>{data.stock.map((x: any, i: number) => <tr key={i}><td>{x.product}</td><td>{x.warehouse}</td><td className="n">{q3(x.qty)}</td><td className="small">{x.expiry || ""}</td></tr>)}</tbody></table></div>}
      </>}
    </div>
  );
}
