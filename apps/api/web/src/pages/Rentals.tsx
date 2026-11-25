/**
 * 3.50.0 — the rentals module: dashboard, assets for rent (with maintenance windows), contracts (quote, reserve,
 * deliver, extend, return, deposits), one contract's page, the occupancy calendar and the reports.
 */
import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, useFetch, useAction, useCompanyContext, Modal, Field, Input, Select, NumInput, Money, money, Loading, Empty, DateRange, ExportBtn, PrintBtn, Picker, partnerFetcher, today, useNewParam, confirmDlg } from "../lib";

export const RC_ST: Record<string, string> = { DRAFT: "مسودة", RESERVED: "محجوز", ACTIVE: "مؤجر الآن", RETURNED: "أُرجع — بانتظار التسوية", CLOSED: "مغلق", CANCELLED: "ملغى" };
const RC_COLOR: Record<string, string> = { DRAFT: "gray", RESERVED: "blue", ACTIVE: "amber", RETURNED: "teal", CLOSED: "green", CANCELLED: "red" };
const RcBadge = ({ s }: { s: string }) => <span className={"badge " + (RC_COLOR[s] || "gray")}>{RC_ST[s] || s}</span>;
export const RA_KIND: Record<string, string> = { EQUIPMENT: "معدات", VEHICLE: "مركبات", PROPERTY: "عقارات", UNIT: "وحدات", OTHER: "أخرى" };
const RA_ST: Record<string, [string, string]> = { AVAILABLE: ["متاح", "green"], RENTED: ["مؤجر", "amber"], MAINTENANCE: ["صيانة", "red"], RETIRED: ["خارج الخدمة", "gray"] };
const UNIT_L: Record<string, string> = { AUTO: "أفضل سعر تلقائياً", DAY: "باليوم", WEEK: "بالأسبوع", MONTH: "بالشهر", HOUR: "بالساعة" };
const UNIT_AR: Record<string, string> = { HOUR: "ساعة", DAY: "يوم", WEEK: "أسبوع", MONTH: "شهر" };
const MV: Record<string, string> = { DEPOSIT_IN: "تأمين مستلم", DEPOSIT_OUT: "رد التأمين", DEPOSIT_APPLY: "خصم من التأمين", INVOICE: "فاتورة", DELIVER: "تسليم", RETURN: "إرجاع", EXTEND: "تمديد", CANCEL: "إلغاء" };
const parts = (p: any[]) => (p || []).map((x) => `${x.qty} ${UNIT_AR[x.unit]} × ${money(x.rate)}`).join(" + ");
const useCash = () => useFetch<any>("/accounts");
const cashList = (d: any) => (d?.rows || []).filter((a: any) => a.isCashBank && !a.isGroup && a.isActive);
const addDays = (s: string, k: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };

// ───────────────────────── dashboard ─────────────────────────
export function RentalsDashboard() {
  const { can } = useCompanyContext();
  const { data, reload } = useFetch<any>("/rentals/dashboard");
  const { run, busy } = useAction();
  const nav = useNavigate();
  if (!data) return <Loading />;
  const A = data.assets;
  const list = (rows: any[], empty: string, extra?: (c: any) => React.ReactNode) => !rows.length ? <Empty text={empty} /> : <table className="tbl compact"><tbody>{rows.map((c: any) => <tr key={c.id} className="clickable" onClick={() => nav(`/rentals/contracts/${c.id}`)}><td className="num">{c.number}</td><td>{c.partnerName}</td><td className="small">{c.assets}</td><td className="small">{extra ? extra(c) : null}</td></tr>)}</tbody></table>;
  return (
    <div className="grid" data-rent-dash>
      {!A.total && <div className="card mfg-start" data-rent-start><h3>ابدأ التأجير</h3>
        <ol className="mfg-steps"><li><b>الأصول</b>: معدة، سيارة، وحدة سكنية أو عقار، بأسعار الساعة واليوم والأسبوع والشهر والتأمين المعتاد. <Link to="/rentals/assets?new=1">أضف أصلاً</Link></li>
          <li><b>العقد</b>: المستأجر والأصول والمدة؛ يختار البرنامج أرخص مزيج من الأسعار ويمنع الحجز المزدوج. <Link to="/rentals/contracts?new=1">عقد جديد</Link></li>
          <li><b>التسليم والإرجاع</b>: فاتورة مقدماً أو شهرية تلقائياً، والتأمين التزام يُسوّى في النهاية مع الغرامات والأضرار.</li></ol>
        {can("sales.write") && <button className="btn" disabled={busy} data-rent-example onClick={() => run(async () => { await api("/rentals/example", { body: {} }); reload(); }, "حُمّل مثال التأجير")}>تحميل مثال جاهز (معدات وسيارة وشقة وخيمة)</button>}</div>}
      <div className="fc-kpis" data-rent-kpis>
        <div className="fc-kpi"><span>الأصول المؤجرة الآن</span><b className="num">{A.rented} / {A.total}</b><small>نسبة الإشغال {A.utilizationPct}%</small></div>
        <div className="fc-kpi good"><span>متاحة</span><b className="num">{A.available}</b><small>{A.maintenance ? `${A.maintenance} في الصيانة` : ""}</small></div>
        <div className="fc-kpi"><span>عقود نشطة</span><b className="num">{data.contracts.active}</b><small>{data.contracts.reserved} محجوز · {data.contracts.draft} مسودة</small></div>
        <div className="fc-kpi"><span>إيراد التأجير هذا الشهر</span><b className="num">{money(data.month.billed)}</b><small>{data.month.delivered} تسليم · {data.month.returned} إرجاع</small></div>
        <div className={"fc-kpi" + (data.deposits.match ? " good" : " high")} data-rent-deposits><span>تأمينات محتفظ بها</span><b className="num">{money(data.deposits.held)}</b><small>{data.deposits.match ? "مطابقة لحساب التأمينات" : `الحساب ${money(data.deposits.ledger)} — غير مطابق`}</small></div>
        <div className={"fc-kpi" + (data.overdue.length ? " high" : "")}><span>متأخر عن الإرجاع</span><b className="num">{data.overdue.length}</b></div>
      </div>
      {data.billingDue > 0 && can("sales.write") && <div className="alert warn row" style={{ alignItems: "center", gap: 10 }}><span>{data.billingDue} عقد شهري حلّ موعد فاتورته.</span><button className="btn sm" disabled={busy} onClick={() => run(async () => { await api("/rentals/bill-due", { body: {} }); reload(); }, "صدرت الفواتير المستحقة")}>إصدار الفواتير الآن</button></div>}
      <div className="grid c2">
        <div className="card"><div className="card-h"><h3>متأخر عن الإرجاع</h3></div>{list(data.overdue, "لا متأخرات", (c) => <span className="neg-val">{c.lateDays} يوم بعد {c.endDate}{c.partnerPhone ? <> · <a href={`https://wa.me/${String(c.partnerPhone).replace(/\D/g, "").replace(/^0/, "966")}?text=${encodeURIComponent(`عميلنا العزيز، انتهت مدة عقد الإيجار ${c.number} في ${c.endDate}. نرجو إرجاع ${c.assets} أو طلب التمديد.`)}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>تذكير واتساب</a></> : null}</span>)}</div>
        <div className="card"><div className="card-h"><h3>يُرجَع اليوم</h3></div>{list(data.dueToday, "لا إرجاعات اليوم")}</div>
      </div>
      <div className="grid c2">
        <div className="card"><div className="card-h"><h3>حجوزات تبدأ خلال 7 أيام</h3><Link className="btn sm ghost" to="/rentals/calendar">التقويم</Link></div>{list(data.startingSoon, "لا حجوزات قريبة", (c) => `من ${c.startDate}`)}</div>
        <div className="card"><div className="card-h"><h3>أُرجعت — بانتظار تسوية التأمين</h3></div>{list(data.toSettle, "لا شيء بانتظار التسوية", (c) => `تأمين ${money(c.depositHeld)}`)}</div>
      </div>
      <div className="card small muted">القيود: التأمين المستلم من ح/ الصندوق أو البنك إلى ح/ تأمينات مستلمة من المستأجرين (التزام). فاتورة الإيجار من ح/ العميل إلى ح/ إيرادات التأجير وضريبة المخرجات. عند التسوية يُخصم التأمين من فواتير العقد غير المسددة (من ح/ التأمينات إلى ح/ العميل)، ويُرد الباقي.</div>
    </div>
  );
}

// ───────────────────────── assets ─────────────────────────
export function RentalAssetsPage() {
  const { can } = useCompanyContext();
  const { data, reload } = useFetch<any[]>("/rentals/assets");
  const [edit, setEdit] = useState<any>(null);
  const [mnt, setMnt] = useState<any>(null);
  useNewParam(() => setEdit({}));
  const [k, setK] = useState("");
  const rows = (data || []).filter((a) => !k || a.kind === k);
  return (
    <div className="grid" data-rent-assets>
      <div className="card"><div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div className="seg"><button className={!k ? "on" : ""} onClick={() => setK("")}>الكل</button>{Object.entries(RA_KIND).map(([key, l]) => <button key={key} className={k === key ? "on" : ""} onClick={() => setK(key)}>{l}</button>)}</div><div className="grow" />
        <ExportBtn rows={() => rows.map((a) => ({ "الرمز": a.code, "الأصل": a.name, "النوع": RA_KIND[a.kind], "المعرف": a.identifier, "يوم": a.rateDay, "أسبوع": a.rateWeek, "شهر": a.rateMonth, "التأمين": a.deposit, "الحالة": RA_ST[a.status][0] }))} name="أصول التأجير" />
        {can("sales.write") && <button className="btn primary" data-ra-new onClick={() => setEdit({})}>＋ أصل للتأجير</button>}
      </div></div>
      <div className="card">{!data ? <Loading /> : !rows.length ? <Empty text="لا أصول للتأجير" /> : <div className="table-wrap"><table className="tbl" data-ra-table>
        <thead><tr><th>الرمز</th><th>الأصل</th><th>النوع</th><th className="n">ساعة</th><th className="n">يوم</th><th className="n">أسبوع</th><th className="n">شهر</th><th className="n">التأمين</th><th className="n">العداد</th><th>الحالة</th><th>الحجز القادم</th><th /></tr></thead>
        <tbody>{rows.map((a) => <tr key={a.id} data-ra-row={a.code}>
          <td className="num">{a.code}</td><td className="clickable" onClick={() => setEdit(a)}><b>{a.name}</b>{a.identifier && <div className="small muted">{a.identifier}</div>}</td><td>{RA_KIND[a.kind]}</td>
          {["rateHour", "rateDay", "rateWeek", "rateMonth"].map((f) => <td key={f} className="n">{a[f] ? money(a[f]) : "—"}</td>)}<td className="n">{money(a.deposit)}</td><td className="n small">{a.meter !== null ? `${a.meter} ${a.meterUnit || ""}` : "—"}</td>
          <td><span className={"badge " + RA_ST[a.status][1]}>{RA_ST[a.status][0]}</span>{a.current && <div className="small"><Link to={`/rentals/contracts/${a.current.id}`}>{a.current.number}</Link> · حتى {a.current.endDate}{a.current.overdue && <span className="neg-val"> (متأخر)</span>}</div>}</td>
          <td className="small">{a.nextBooking ? <Link to={`/rentals/contracts/${a.nextBooking.id}`}>{a.nextBooking.startDate} — {a.nextBooking.partner}</Link> : "—"}{a.maintenanceWindows.length > 0 && <div className="muted">صيانة {a.maintenanceWindows.map((m: any) => `${m.fromDate}${m.toDate !== m.fromDate ? `←${m.toDate}` : ""}`).join("، ")}</div>}</td>
          <td>{can("sales.write") && <button className="btn sm ghost" onClick={() => setMnt(a)}>صيانة</button>}</td></tr>)}</tbody></table></div>}</div>
      {edit && <AssetModal init={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
      {mnt && <MaintModal a={mnt} onClose={() => setMnt(null)} onDone={() => { setMnt(null); reload(); }} />}
    </div>
  );
}
function AssetModal({ init, onClose, onDone }: { init: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<any>(() => ({ name: "", code: "", kind: "EQUIPMENT", category: "", identifier: "", rateHour: 0, rateDay: 0, rateWeek: 0, rateMonth: 0, deposit: 0, meterUnit: "", costValue: 0, notes: "", isActive: true, maintenance: false, ...init, meter: init.meter ?? "" }));
  const { run, busy } = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={init.id ? `الأصل ${init.code}` : "أصل جديد للتأجير"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" data-ra-save disabled={busy || !String(f.name).trim()} onClick={() => run(async () => { await api(init.id ? `/rentals/assets/${init.id}` : "/rentals/assets", { method: init.id ? "PUT" : "POST", body: f }); onDone(); }, "حُفظ الأصل")}>حفظ</button></>}>
      <div className="grid c2">
        <Field label="الاسم"><Input value={f.name} onChange={set("name")} data-ra-name /></Field>
        <Field label="النوع"><Select value={f.kind} onChange={set("kind")}>{Object.entries(RA_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="المعرّف" hint="رقم اللوحة، الرقم التسلسلي أو رقم الوحدة"><Input value={f.identifier || ""} onChange={set("identifier")} /></Field>
        <Field label="الفئة"><Input value={f.category || ""} onChange={set("category")} placeholder="مولدات، رافعات، سيارات، شقق…" /></Field>
        <Field label="سعر الساعة"><NumInput value={f.rateHour} onChange={set("rateHour")} /></Field>
        <Field label="سعر اليوم"><NumInput value={f.rateDay} onChange={set("rateDay")} data-ra-day /></Field>
        <Field label="سعر الأسبوع"><NumInput value={f.rateWeek} onChange={set("rateWeek")} data-ra-week /></Field>
        <Field label="سعر الشهر"><NumInput value={f.rateMonth} onChange={set("rateMonth")} data-ra-month /></Field>
        <Field label="التأمين المعتاد"><NumInput value={f.deposit} onChange={set("deposit")} data-ra-deposit /></Field>
        <Field label="تكلفة الأصل" hint="لحساب العائد على الأصل في التقارير"><NumInput value={f.costValue} onChange={set("costValue")} /></Field>
        <Field label="العداد الحالي"><NumInput value={f.meter} onChange={set("meter")} /></Field>
        <Field label="وحدة العداد"><Input value={f.meterUnit || ""} onChange={set("meterUnit")} placeholder="كم، ساعة تشغيل" /></Field>
        <Field label="الرمز" hint="فارغ = تلقائي"><Input value={f.code || ""} onChange={set("code")} /></Field>
      </div>
      <Field label="ملاحظات"><Input value={f.notes || ""} onChange={set("notes")} /></Field>
      <div className="row" style={{ gap: 14 }}><label className="check"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> نشط</label><label className="check"><input type="checkbox" checked={f.maintenance} onChange={(e) => setF({ ...f, maintenance: e.target.checked })} /> خارج الخدمة للصيانة الآن</label></div>
    </Modal>
  );
}
function MaintModal({ a, onClose, onDone }: { a: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<any>({ fromDate: today(), toDate: today(), description: "", cost: 0 });
  const { run, busy } = useAction();
  return (
    <Modal title={`صيانة «${a.name}»`} onClose={onClose} narrow footer={<><button className="btn" onClick={onClose}>إغلاق</button><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api(`/rentals/assets/${a.id}/maintenance`, { body: f }); onDone(); }, "سُجّلت فترة الصيانة")}>حجز للصيانة</button></>}>
      <div className="grid c2"><Field label="من"><Input type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} /></Field><Field label="إلى"><Input type="date" value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></Field></div>
      <Field label="الوصف"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="التكلفة التقديرية"><NumInput value={f.cost} onChange={(e: any) => setF({ ...f, cost: e.target.value })} /></Field>
      {a.maintenanceWindows.length > 0 && <table className="tbl compact mt"><tbody>{a.maintenanceWindows.map((m: any) => <tr key={m.id}><td>{m.fromDate} ← {m.toDate}</td><td>{m.description}</td><td><button className="btn sm ghost danger" onClick={() => run(async () => { await api(`/rentals/maintenance/${m.id}`, { method: "DELETE" }); onDone(); })}>حذف</button></td></tr>)}</tbody></table>}
      <div className="small muted mt">فترة الصيانة تمنع حجز الأصل في أيامها، ولا تُقبل إن كان محجوزاً أو مؤجراً فيها. سجّل تكلفة الصيانة الفعلية في المصروفات.</div>
    </Modal>
  );
}

// ───────────────────────── contracts ─────────────────────────
export function RentalContractsPage() {
  const { can } = useCompanyContext();
  const [st, setSt] = useState("OPEN");
  const { data, reload } = useFetch<any[]>(`/rentals/contracts?status=${st}`, [st]);
  const [neu, setNeu] = useState(false);
  useNewParam(() => setNeu(true));
  const nav = useNavigate();
  return (
    <div className="grid" data-rent-contracts>
      <div className="card"><div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div className="seg">{[["OPEN", "المفتوحة"], ["RESERVED", "محجوزة"], ["ACTIVE", "مؤجرة الآن"], ["RETURNED", "بانتظار التسوية"], ["CLOSED", "مغلقة"], ["", "الكل"]].map(([key, l]) => <button key={key} className={st === key ? "on" : ""} onClick={() => setSt(key)}>{l}</button>)}</div><div className="grow" />
        {can("sales.write") && <button className="btn primary" data-rc-new onClick={() => setNeu(true)}>＋ عقد إيجار</button>}
      </div></div>
      <div className="card">{!data ? <Loading /> : !data.length ? <Empty text="لا عقود" /> : <div className="table-wrap"><table className="tbl" data-rc-table>
        <thead><tr><th>العقد</th><th>المستأجر</th><th>الأصول</th><th>من</th><th>إلى</th><th>الفوترة</th><th className="n">القيمة</th><th className="n">تأمين محتفظ به</th><th>الحالة</th></tr></thead>
        <tbody>{data.map((c) => <tr key={c.id} className="clickable" data-rc-row={c.number} onClick={() => nav(`/rentals/contracts/${c.id}`)}>
          <td className="num"><b>{c.number}</b></td><td>{c.partnerName}</td><td className="small">{c.assets}</td><td className="small">{c.startDate}</td><td className={"small" + (c.overdue ? " neg-val" : "")}>{c.endDate}{c.overdue && ` (+${c.lateDays} يوم)`}</td>
          <td className="small">{c.billing === "MONTHLY" ? "شهرية" : "مقدماً"}</td><td className="n"><Money v={c.subtotal} /></td><td className="n">{c.depositHeld ? <Money v={c.depositHeld} /> : "—"}</td><td><RcBadge s={c.status} /></td></tr>)}</tbody></table></div>}</div>
      {neu && <NewContractModal onClose={() => setNeu(false)} onDone={(c: any) => { setNeu(false); reload(); nav(`/rentals/contracts/${c.id}`); }} />}
    </div>
  );
}

function NewContractModal({ onClose, onDone }: { onClose: () => void; onDone: (c: any) => void }) {
  const assets = useFetch<any[]>("/rentals/assets");
  const [partner, setPartner] = useState<any>(null);
  const [f, setF] = useState<any>({ startDate: today(), endDate: addDays(today(), 6), billing: "UPFRONT", discountPct: 0, deposit: "", lateFeeDay: "", taxCode: "S", notes: "", terms: "", reserve: true });
  const [lines, setLines] = useState<any[]>([]);
  const [qt, setQt] = useState<any>(null);
  const { run, busy } = useAction();
  const key = JSON.stringify([f.startDate, f.endDate, f.discountPct, lines]);
  useEffect(() => { if (!lines.length || !f.startDate || !f.endDate || f.endDate < f.startDate) { setQt(null); return; } const tm = setTimeout(() => api("/rentals/quote", { body: { ...f, lines } }).then(setQt).catch((e) => setQt({ error: String(e.message || e) })), 300); return () => clearTimeout(tm); }, [key]);
  const avail = (assets.data || []).filter((a: any) => a.isActive && !lines.some((l) => l.assetId === a.id));
  return (
    <Modal title="عقد إيجار جديد" onClose={onClose} wide footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" data-rc-save disabled={busy || !partner || !lines.length || !!qt?.conflicts?.length || !!qt?.error} onClick={() => run(async () => onDone(await api("/rentals/contracts", { body: { ...f, partnerId: partner.id, lines, deposit: f.deposit === "" ? undefined : Number(f.deposit), lateFeeDay: f.lateFeeDay === "" ? null : Number(f.lateFeeDay) } })), f.reserve ? "حُجز العقد" : "حُفظ العقد مسودة")}>{f.reserve ? "حفظ وحجز" : "حفظ مسودة"}</button></>}>
      <div className="grid c3">
        <Field label="المستأجر" span2><Picker value={partner} onChange={setPartner} fetcher={partnerFetcher("CUSTOMER")} label={(p: any) => p.name} placeholder="ابحث عن العميل" /></Field>
        <Field label="الفوترة"><Select value={f.billing} onChange={(e) => setF({ ...f, billing: e.target.value })} data-rc-billing><option value="UPFRONT">فاتورة مقدماً للمدة كلها</option><option value="MONTHLY">فاتورة كل شهر (تلقائياً)</option></Select></Field>
        <Field label="من"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} data-rc-from /></Field>
        <Field label="إلى (شاملاً)"><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} data-rc-to /></Field>
        <Field label="خصم %"><NumInput value={f.discountPct} onChange={(e: any) => setF({ ...f, discountPct: e.target.value })} /></Field>
      </div>
      <div className="card mt"><div className="card-h"><h3>الأصول</h3><Select value="" onChange={(e) => { if (e.target.value) setLines([...lines, { assetId: e.target.value, unit: "AUTO" }]); }} data-rc-add style={{ maxWidth: 320 }}><option value="">＋ أضف أصلاً</option>{avail.map((a: any) => <option key={a.id} value={a.id}>{a.code} — {a.name}{a.status !== "AVAILABLE" ? ` (${RA_ST[a.status][0]})` : ""}</option>)}</Select></div>
        {!lines.length ? <Empty text="اختر الأصول المؤجرة" /> : <table className="tbl compact" data-rc-lines><thead><tr><th>الأصل</th><th>طريقة التسعير</th><th className="n">التفصيل</th><th className="n">المبلغ</th><th /></tr></thead>
          <tbody>{lines.map((l, i) => { const a = (assets.data || []).find((x: any) => x.id === l.assetId) || {}; const ql = qt?.lines?.find((x: any) => x.assetId === l.assetId); return <tr key={l.assetId}>
            <td><b>{a.name}</b> <span className="small muted">{a.identifier || ""}</span></td>
            <td><div className="row" style={{ gap: 4 }}><Select value={l.unit} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))}>{Object.entries(UNIT_L).filter(([u]) => u === "AUTO" || a["rate" + u.charAt(0) + u.slice(1).toLowerCase()]).map(([u, lab]) => <option key={u} value={u}>{lab}</option>)}</Select>{l.unit === "HOUR" && <NumInput style={{ width: 80 }} value={l.hours || ""} placeholder="ساعات" onChange={(e: any) => setLines(lines.map((x, j) => (j === i ? { ...x, hours: e.target.value } : x)))} />}</div></td>
            <td className="n small">{ql ? `${ql.days} يوم: ${parts(ql.parts)}` : ""}</td><td className="n">{ql ? <Money v={ql.amount} /> : "—"}</td>
            <td><button className="btn sm ghost danger" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="حذف">✕</button></td></tr>; })}</tbody></table>}
        {qt?.error && <div className="alert warn small mt">{qt.error}</div>}
        {qt?.conflicts?.length > 0 && <div className="alert warn small mt" data-rc-conflict>غير متاح: {qt.conflicts.map((c: any) => `${c.assets.join("، ")} — ${c.number} (${c.from} إلى ${c.to})`).join(" · ")}</div>}
        {qt && !qt.error && <div className="row mt" style={{ gap: 16 }} data-rc-total><span>{qt.days} يوم</span><span>الإجمالي قبل الضريبة <b className="num">{money(qt.subtotal)}</b></span><span>التأمين المقترح <b className="num">{money(qt.deposit)}</b></span></div>}
      </div>
      <div className="grid c3 mt">
        <Field label="التأمين" hint="فارغ = مجموع تأمين الأصول"><NumInput value={f.deposit} onChange={(e: any) => setF({ ...f, deposit: e.target.value })} placeholder={qt ? String(qt.deposit) : ""} /></Field>
        <Field label="غرامة التأخير لليوم" hint="فارغ = سعر اليوم للأصول"><NumInput value={f.lateFeeDay} onChange={(e: any) => setF({ ...f, lateFeeDay: e.target.value })} /></Field>
        <Field label="الضريبة"><Select value={f.taxCode} onChange={(e) => setF({ ...f, taxCode: e.target.value })}><option value="S">خاضعة</option><option value="E">معفاة (سكن)</option><option value="Z">صفرية</option><option value="O">خارج النطاق</option></Select></Field>
        <Field label="شروط العقد" span3><textarea className="input" rows={2} value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} placeholder="المسؤولية عن الأضرار، الوقود، الكيلومترات المسموحة…" /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={f.reserve} onChange={(e) => setF({ ...f, reserve: e.target.checked })} /> احجز الأصول الآن (يمنع حجزها لغيره في هذه الأيام)</label>
    </Modal>
  );
}

export function RentalContractPage() {
  const { id } = useParams();
  const { can } = useCompanyContext();
  const { data: c, reload, error } = useFetch<any>(`/rentals/contracts/${id}`, [id]);
  const [m, setM] = useState<string | null>(null);
  const { run, busy } = useAction();
  if (error) return <div className="card"><Empty text={error} /></div>;
  if (!c) return <Loading />;
  const W = can("sales.write"), P = can("payments.write");
  const act = (path: string, body: any, msg: string) => run(async () => { await api(`/rentals/contracts/${c.id}/${path}`, { body }); reload(); }, msg);
  return (
    <div className="grid" data-rc={c.number}>
      <div className="card">
        <div className="row between" style={{ flexWrap: "wrap", gap: 10 }}>
          <div><div className="row" style={{ gap: 8, alignItems: "center" }}><h2 style={{ margin: 0 }} className="num">{c.number}</h2><RcBadge s={c.status} />{c.overdue && <span className="badge red">متأخر {c.lateDays} يوم</span>}</div>
            <div className="mt"><b>{c.partnerName}</b>{c.partnerPhone && <span className="muted"> · {c.partnerPhone}</span>}</div>
            <div className="small muted">من {c.startDate} إلى {c.endDate} · {c.billing === "MONTHLY" ? "فوترة شهرية" : "فوترة مقدماً"}{c.discountPct ? ` · خصم ${c.discountPct}%` : ""}{c.deliveredDate ? ` · سُلّم ${c.deliveredDate}` : ""}{c.returnedDate ? ` · أُرجع ${c.returnedDate}` : ""}{c.nextBillDate ? ` · الفاتورة القادمة ${c.nextBillDate}` : ""}</div></div>
          <div className="row no-print" style={{ gap: 6, flexWrap: "wrap" }}>
            {W && c.status === "DRAFT" && <button className="btn" disabled={busy} onClick={() => act("reserve", {}, "حُجز")}>حجز</button>}
            {W && ["DRAFT", "RESERVED"].includes(c.status) && <button className="btn primary" disabled={busy} data-rc-deliver onClick={() => setM("deliver")}>تسليم</button>}
            {W && ["RESERVED", "ACTIVE"].includes(c.status) && <button className="btn" disabled={busy} data-rc-extend onClick={() => setM("extend")}>تمديد</button>}
            {W && c.status === "ACTIVE" && <button className="btn primary" disabled={busy} data-rc-return onClick={() => setM("return")}>إرجاع</button>}
            {W && c.status === "ACTIVE" && c.billing === "MONTHLY" && c.nextBillDate && c.nextBillDate <= today() && <button className="btn" disabled={busy} onClick={() => act("bill", {}, "صدرت الفاتورة المستحقة")}>فاتورة الشهر</button>}
            {P && !["CLOSED", "CANCELLED"].includes(c.status) && <button className="btn" disabled={busy} data-rc-deposit onClick={() => setM("deposit")}>استلام تأمين</button>}
            {P && ["RETURNED", "ACTIVE"].includes(c.status) && c.depositHeld > 0 && <button className="btn" disabled={busy} data-rc-settle onClick={() => setM("settle")}>تسوية التأمين</button>}
            {W && ["DRAFT", "RESERVED"].includes(c.status) && <button className="btn ghost danger" disabled={busy} onClick={() => run(async () => { if (!confirmDlg("إلغاء العقد؟")) return; await api(`/rentals/contracts/${c.id}/cancel`, { body: {} }); reload(); }, "أُلغي العقد")}>إلغاء</button>}
            <PrintBtn pdfName={c.number} />
          </div>
        </div>
        <div className="fc-kpis mt" data-rc-kpis>
          <div className="fc-kpi"><span>قيمة العقد</span><b className="num">{money(c.subtotal)}</b><small>قبل الضريبة</small></div>
          <div className="fc-kpi"><span>المفوتر</span><b className="num">{money(c.billed)}</b><small>{c.invoices.length} فاتورة</small></div>
          <div className={"fc-kpi" + (c.due > 0 ? " high" : " good")}><span>غير المسدد</span><b className="num">{money(c.due)}</b></div>
          <div className="fc-kpi" data-rc-held><span>التأمين المحتفظ به</span><b className="num">{money(c.depositHeld)}</b><small>المطلوب {money(c.deposit)} · مستلم {money(c.depositReceived)}{c.depositApplied ? ` · خُصم ${money(c.depositApplied)}` : ""}{c.depositRefunded ? ` · رُد ${money(c.depositRefunded)}` : ""}</small></div>
        </div>
      </div>
      <div className="card"><div className="card-h"><h3>الأصول</h3></div><div className="table-wrap"><table className="tbl compact" data-rc-assets><thead><tr><th>الأصل</th><th>التسعير</th><th className="n">المبلغ</th><th className="n">العداد عند التسليم</th><th className="n">عند الإرجاع</th><th className="n">الاستخدام</th><th>الحالة</th></tr></thead>
        <tbody>{c.lines.map((l: any) => <tr key={l.assetId}><td><b>{l.name}</b> <span className="small muted">{l.identifier || ""}</span></td><td className="small">{l.days} يوم: {parts(l.parts)}</td><td className="n"><Money v={l.amount} /></td><td className="n">{l.meterOut ?? "—"}</td><td className="n">{l.meterIn ?? "—"}</td><td className="n">{l.meterIn !== null && l.meterIn !== undefined && l.meterOut !== null && l.meterOut !== undefined ? l.meterIn - l.meterOut : "—"}</td><td className="small">{[l.condition, l.returnCondition].filter(Boolean).join(" ← ") || "—"}</td></tr>)}</tbody></table></div></div>
      <div className="grid c2">
        <div className="card"><div className="card-h"><h3>الفواتير</h3></div>{!c.invoices.length ? <Empty text="لا فواتير بعد — تصدر عند التسليم" /> : <table className="tbl compact" data-rc-invoices><thead><tr><th>الفاتورة</th><th>الفترة</th><th className="n">الصافي</th><th className="n">الإجمالي</th><th className="n">المتبقي</th></tr></thead><tbody>{c.invoices.map((i: any) => <tr key={i.id}><td><Link to={`/doc/${i.id}`} className="num">{i.number}</Link></td><td className="small">{i.from ? `${i.from} ← ${i.to}` : "رسوم الإرجاع"}</td><td className="n"><Money v={i.net} /></td><td className="n"><Money v={i.total} /></td><td className="n">{i.due ? <Money v={i.due} /> : "✓"}</td></tr>)}</tbody></table>}</div>
        <div className="card"><div className="card-h"><h3>السجل</h3></div><table className="tbl compact"><tbody>{c.moves.map((x: any) => <tr key={x.id}><td className="small">{x.date}</td><td>{MV[x.kind] || x.kind}</td><td className="n">{x.amount ? <Money v={x.amount} /> : ""}</td><td className="small">{x.notes || ""}{x.entryId && <> · <Link to={`/journals/${x.entryId}`}>{x.entryNumber}</Link></>}</td></tr>)}</tbody></table></div>
      </div>
      {(c.terms || c.notes) && <div className="card small">{c.terms && <div><b>الشروط:</b> {c.terms}</div>}{c.notes && <div><b>ملاحظات:</b> {c.notes}</div>}</div>}
      {m === "deliver" && <DeliverModal c={c} onClose={() => setM(null)} onDone={() => { setM(null); reload(); }} />}
      {m === "return" && <ReturnModal c={c} onClose={() => setM(null)} onDone={() => { setM(null); reload(); }} />}
      {m === "extend" && <ExtendModal c={c} onClose={() => setM(null)} onDone={() => { setM(null); reload(); }} />}
      {(m === "deposit" || m === "settle") && <DepositModal c={c} settle={m === "settle"} onClose={() => setM(null)} onDone={() => { setM(null); reload(); }} />}
    </div>
  );
}
function DeliverModal({ c, onClose, onDone }: any) {
  const [date, setDate] = useState(c.startDate <= today() ? today() : c.startDate);
  const [ls, setLs] = useState<any[]>(c.lines.map((l: any) => ({ assetId: l.assetId, meterOut: "", condition: "" })));
  const { run, busy } = useAction();
  return <Modal title={`تسليم ${c.number}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" data-deliver-save disabled={busy} onClick={() => run(async () => { await api(`/rentals/contracts/${c.id}/deliver`, { body: { date, lines: ls } }); onDone(); }, c.billing === "UPFRONT" ? "سُلّم وصدرت الفاتورة" : "سُلّم وصدرت فاتورة الشهر الأول")}>تسليم وإصدار الفاتورة</button></>}>
    <Field label="تاريخ التسليم"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
    <table className="tbl compact"><thead><tr><th>الأصل</th><th>العداد</th><th>الحالة عند التسليم</th></tr></thead><tbody>{c.lines.map((l: any, i: number) => <tr key={l.assetId}><td>{l.name}</td><td><NumInput value={ls[i].meterOut} onChange={(e: any) => setLs(ls.map((x, j) => (j === i ? { ...x, meterOut: e.target.value } : x)))} style={{ width: 110 }} /></td><td><Input value={ls[i].condition} onChange={(e) => setLs(ls.map((x, j) => (j === i ? { ...x, condition: e.target.value } : x)))} placeholder="سليم، خدش بسيط…" /></td></tr>)}</tbody></table>
    <div className="small muted mt">{c.billing === "UPFRONT" ? `تصدر فاتورة المدة كلها (${money(c.subtotal)} قبل الضريبة).` : "تصدر فاتورة الشهر الأول، ثم فاتورة كل شهر تلقائياً."}{c.depositHeld < c.deposit ? ` لم يُستلم التأمين كاملاً (${money(c.depositHeld)} من ${money(c.deposit)}).` : ""}</div>
  </Modal>;
}
function ReturnModal({ c, onClose, onDone }: any) {
  const [date, setDate] = useState(today());
  const [ls, setLs] = useState<any[]>(c.lines.map((l: any) => ({ assetId: l.assetId, meterIn: "", condition: "" })));
  const [ch, setCh] = useState<any[]>([]);
  const [waive, setWaive] = useState(false);
  const { run, busy } = useAction();
  const late = Math.max(0, Math.round((Date.parse(date) - Date.parse(c.endDate)) / 864e5));
  return <Modal title={`إرجاع ${c.number}`} onClose={onClose} wide footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" data-return-save disabled={busy} onClick={() => run(async () => { await api(`/rentals/contracts/${c.id}/return`, { body: { date, lines: ls, charges: ch, waiveLate: waive } }); onDone(); }, "سُجّل الإرجاع")}>تسجيل الإرجاع</button></>}>
    <Field label="تاريخ الإرجاع"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-return-date /></Field>
    {late > 0 && <div className="alert warn small">متأخر {late} يوم بعد {c.endDate}: تُضاف غرامة تأخير{c.lateFeeDay !== null ? ` ${money(c.lateFeeDay)} لليوم` : " بسعر اليوم للأصول"}. <label className="check"><input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} /> إعفاء من الغرامة</label></div>}
    <table className="tbl compact"><thead><tr><th>الأصل</th><th className="n">عند التسليم</th><th>العداد الآن</th><th>الحالة</th></tr></thead><tbody>{c.lines.map((l: any, i: number) => <tr key={l.assetId}><td>{l.name}</td><td className="n">{l.meterOut ?? "—"}</td><td><NumInput value={ls[i].meterIn} onChange={(e: any) => setLs(ls.map((x, j) => (j === i ? { ...x, meterIn: e.target.value } : x)))} style={{ width: 110 }} data-return-meter /></td><td><Input value={ls[i].condition} onChange={(e) => setLs(ls.map((x, j) => (j === i ? { ...x, condition: e.target.value } : x)))} /></td></tr>)}</tbody></table>
    <h4 className="mt">أضرار ورسوم إضافية</h4>
    {ch.map((x, i) => <div key={i} className="row" style={{ gap: 6, marginBottom: 6 }}><Input value={x.description} onChange={(e) => setCh(ch.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)))} placeholder="إصلاح، تنظيف، وقود، كيلومترات زائدة…" data-charge-desc /><NumInput value={x.amount} onChange={(e: any) => setCh(ch.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} style={{ width: 120 }} data-charge-amount /><button className="btn sm ghost danger" onClick={() => setCh(ch.filter((_, j) => j !== i))} aria-label="حذف">✕</button></div>)}
    <button className="btn sm" data-charge-add onClick={() => setCh([...ch, { description: "", amount: "" }])}>＋ بند</button>
    <div className="small muted mt">تصدر فاتورة الإرجاع بما لم يُفوتر من الأيام (للعقود الشهرية) وغرامة التأخير والبنود الإضافية. ثم «تسوية التأمين» تخصمها من التأمين وترد الباقي.</div>
  </Modal>;
}
function ExtendModal({ c, onClose, onDone }: any) {
  const [end, setEnd] = useState(addDays(c.endDate, 7));
  const { run, busy } = useAction();
  return <Modal title={`تمديد ${c.number}`} onClose={onClose} narrow footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" data-extend-save disabled={busy || end <= c.endDate} onClick={() => run(async () => { await api(`/rentals/contracts/${c.id}/extend`, { body: { endDate: end } }); onDone(); }, "مُدّد العقد")}>تمديد</button></>}>
    <Field label="النهاية الجديدة" hint={`الحالية ${c.endDate}`}><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} data-extend-date /></Field>
    <div className="small muted">يُتحقق أن الأصول غير محجوزة في الأيام الجديدة. {c.status === "ACTIVE" && c.billing === "UPFRONT" ? "تصدر فاتورة بأيام التمديد." : ""}</div>
  </Modal>;
}
function DepositModal({ c, settle, onClose, onDone }: any) {
  const cash = useCash();
  const [f, setF] = useState<any>({ amount: Math.max(0, c.deposit - c.depositHeld) || "", accountId: "", date: today(), apply: true });
  const { run, busy } = useAction();
  const list = cashList(cash.data);
  useEffect(() => { if (!f.accountId && list[0]) setF((x: any) => ({ ...x, accountId: list[0].id })); }, [cash.data]);
  return <Modal title={settle ? `تسوية تأمين ${c.number}` : `استلام تأمين ${c.number}`} onClose={onClose} narrow footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" data-dep-save disabled={busy || !f.accountId || (!settle && !(Number(f.amount) > 0))} onClick={() => run(async () => { await api(`/rentals/contracts/${c.id}/${settle ? "settle" : "deposit"}`, { body: { ...f, amount: Number(f.amount) } }); onDone(); }, settle ? "سُوّي التأمين" : "استُلم التأمين")}>{settle ? "تسوية" : "استلام"}</button></>}>
    {!settle && <Field label="المبلغ"><NumInput value={f.amount} onChange={(e: any) => setF({ ...f, amount: e.target.value })} data-dep-amount /></Field>}
    <Field label={settle ? "الرد من" : "إلى"}><Select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>{list.map((a: any) => <option key={a.id} value={a.id}>{a.code} {a.nameAr}</option>)}</Select></Field>
    <Field label="التاريخ"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
    {settle && <><label className="check"><input type="checkbox" checked={f.apply} onChange={(e) => setF({ ...f, apply: e.target.checked })} /> اخصم أولاً فواتير العقد غير المسددة ({money(c.due)})</label>
      <div className="alert small mt">التأمين المحتفظ به {money(c.depositHeld)}: {f.apply ? `يُخصم منه ${money(Math.min(c.depositHeld, c.due))} للفواتير، ويُرد ${money(Math.max(0, c.depositHeld - c.due))}` : `يُرد كاملاً`}.</div></>}
  </Modal>;
}

// ───────────────────────── calendar ─────────────────────────
export function RentalCalendarPage() {
  const [p, setP] = useState({ from: today(), days: 21 });
  const { data } = useFetch<any>(`/rentals/calendar?from=${p.from}&days=${p.days}`, [p.from, p.days]);
  const nav = useNavigate();
  const C: Record<string, [string, string]> = { R: ["rgba(245,158,11,.45)", "مؤجر"], L: ["rgba(239,68,68,.45)", "متأخر"], B: ["rgba(59,130,246,.35)", "محجوز"], M: ["rgba(100,116,139,.45)", "صيانة"], D: ["rgba(16,185,129,.30)", "كان مؤجراً"] };
  return (
    <div className="grid" data-rent-cal>
      <div className="card"><div className="row" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <Field label="من"><Input type="date" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} /></Field>
        <Field label="عدد الأيام"><Select value={p.days} onChange={(e) => setP({ ...p, days: Number(e.target.value) })}>{[14, 21, 31, 62].map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
        <div className="row" style={{ gap: 10 }}>{Object.entries(C).map(([k, [bg, l]]) => <span key={k} className="small"><span style={{ display: "inline-block", width: 14, height: 14, background: bg, borderRadius: 3, verticalAlign: "middle" }} /> {l}</span>)}</div>
      </div></div>
      <div className="card">{!data ? <Loading /> : !data.assets.length ? <Empty text="لا أصول" /> : <div className="table-wrap"><table className="tbl compact sched" data-cal-table>
        <thead><tr><th>الأصل</th>{data.days.map((d: string) => <th key={d} className="n small">{d.slice(5)}</th>)}<th className="n">الإشغال</th></tr></thead>
        <tbody>{data.assets.map((a: any) => <tr key={a.id} data-cal-asset={a.name}><td><b>{a.name}</b><div className="small muted">{a.identifier || a.code}</div></td>{a.cells.map((x: any, i: number) => <td key={i} title={x.label || ""} style={{ background: x.s ? C[x.s][0] : undefined, cursor: x.id ? "pointer" : undefined }} onClick={() => x.id && nav(`/rentals/contracts/${x.id}`)} data-cell={x.s} />)}<td className="n">{a.occupancyPct}%</td></tr>)}</tbody></table></div>}</div>
    </div>
  );
}

// ───────────────────────── reports ─────────────────────────
export function RentalReportsPage() {
  const [r, setR] = useState({ from: today().slice(0, 8) + "01", to: today() });
  const { data } = useFetch<any>(`/rentals/reports?from=${r.from}&to=${r.to}`, [r.from, r.to]);
  return (
    <div className="grid" data-rent-reports>
      <div className="card"><div className="row" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}><DateRange from={r.from} to={r.to} onChange={(f, t) => setR({ from: f, to: t })} /><div className="grow" /><PrintBtn pdfName="تقرير التأجير" /></div></div>
      {!data ? <Loading /> : <>
        <div className="fc-kpis"><div className="fc-kpi"><span>إيراد التأجير</span><b className="num">{money(data.totals.revenue)}</b><small>منه رسوم وغرامات {money(data.totals.extras)}</small></div><div className="fc-kpi"><span>متوسط الإشغال</span><b className="num">{data.totals.utilizationPct}%</b><small>{data.days} يوم</small></div></div>
        <div className="card"><div className="card-h"><h3>الأصول: الإشغال والإيراد والعائد</h3><ExportBtn rows={() => data.assets.map((a: any) => ({ "الأصل": a.name, "أيام التأجير": a.rentedDays, "الإشغال %": a.utilizationPct, "الإيراد": a.revenue, "متوسط اليوم": a.perDay, "أيام الصيانة": a.maintenanceDays, "تكلفة الصيانة": a.maintenanceCost, "تكلفة الأصل": a.costValue, "العائد %": a.returnPct }))} name="تقرير أصول التأجير" /></div>
          <div className="table-wrap"><table className="tbl compact" data-rep-assets><thead><tr><th>الأصل</th><th className="n">أيام التأجير</th><th style={{ width: "22%" }}>الإشغال</th><th className="n">الإيراد</th><th className="n">لليوم</th><th className="n">صيانة</th><th className="n">العائد على التكلفة</th></tr></thead>
            <tbody>{data.assets.map((a: any) => <tr key={a.id}><td><b>{a.name}</b> <span className="small muted">{RA_KIND[a.kind]}</span></td><td className="n">{a.rentedDays} / {a.days}</td><td><div className="row" style={{ gap: 6 }}><div className="mini-bar"><i style={{ width: `${Math.min(100, a.utilizationPct)}%`, background: a.utilizationPct > 70 ? "#10b981" : a.utilizationPct > 35 ? "#f59e0b" : "#ef4444" }} /></div><span className="small num">{a.utilizationPct}%</span></div></td><td className="n"><Money v={a.revenue} /></td><td className="n">{a.perDay ? money(a.perDay) : "—"}</td><td className="n small">{a.maintenanceDays ? `${a.maintenanceDays} يوم · ${money(a.maintenanceCost)}` : "—"}</td><td className="n">{a.returnPct !== null ? `${a.returnPct}%` : "—"}</td></tr>)}</tbody></table></div></div>
        <div className="card"><div className="card-h"><h3>حسب المستأجر</h3></div>{!data.customers.length ? <Empty text="لا فواتير في الفترة" /> : <table className="tbl compact"><tbody>{data.customers.map((x: any, i: number) => <tr key={i}><td>{x.name}</td><td className="n"><Money v={x.amount} /></td></tr>)}</tbody></table>}</div>
      </>}
    </div>
  );
}
