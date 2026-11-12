/** Restaurant / café side of the point of sale: the hall with its tables, open orders, kitchen tickets, the kitchen screen and the setup page. */
import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CUR } from "../shared/country";
import { api, q, useFetch, useAction, useToast, useCompanyContext, Modal, Field, Input, Select, NumInput, Empty, Loading, money, today, fmtDT, confirmDlg, DateRange } from "../lib";

export const TYPE_AR: Record<string, string> = { DINE_IN: "محلي", TAKEAWAY: "سفري", DELIVERY: "توصيل" };
const TYPE_IC: Record<string, string> = { DINE_IN: "🍽", TAKEAWAY: "🥡", DELIVERY: "🛵" };
export const mins = (iso: string, now = Date.now()) => Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
const dur = (m: number) => (m < 60 ? `${m} د` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} س`);

/** The first screen of a restaurant: halls and tables (free / occupied), and the take-away and delivery orders. */
export function RestaurantHome({ data, reload, session, online, onOpen, onClose, onReturn, busy }: { data: any; reload: () => void; session: any; online: boolean; onOpen: (o: any) => void; onClose: () => void; onReturn: () => void; busy?: boolean }) {
  const nav = useNavigate();
  const toast = useToast();
  const { can } = useCompanyContext();
  const { run } = useAction();
  const cafe = data.settings.mode === "CAFE";
  const [tab, setTab] = useState<string>(cafe ? "orders" : data.floors[0]?.id || "orders");
  const [now, setNow] = useState(Date.now());
  const [guests, setGuests] = useState<any>(null); // the table being opened
  const [newOrder, setNewOrder] = useState<string | null>(null);
  useEffect(() => { const iv = setInterval(() => { setNow(Date.now()); if (navigator.onLine) reload(); }, 15000); return () => clearInterval(iv); }, []);
  useEffect(() => { if (!cafe && tab !== "orders" && !data.floors.some((f: any) => f.id === tab)) setTab(data.floors[0]?.id || "orders"); }, [data.floors.length]);
  const open = (body: any) => run(async () => { onOpen(await api("/pos/orders", { body })); setGuests(null); setNewOrder(null); });
  const floor = data.floors.find((f: any) => f.id === tab);
  const s = data.stats;
  return (
    <div className="rest">
      <div className="cat-head">
        <button className="btn sm" onClick={() => nav("/")}>← النظام</button>
        <b style={{ fontSize: 16 }}>{cafe ? "☕ الطلبات" : "🍽 الصالة والطاولات"}</b>
        <span className="badge teal">وردية {session.number} · {session.orders} طلب</span>
        {!online && <span className="badge red">غير متصل — الطاولات تحتاج اتصالاً</span>}
        <div className="grow" />
        {!cafe && <span className="small muted">مشغولة <b>{s.busy}</b> من {s.tables} · مفتوح <b className="num">{money(s.value)}</b> {CUR()}</span>}
        <Link className="btn sm" to="/pos/kitchen">👨‍🍳 شاشة المطبخ</Link>
        {can("settings.write") && <Link className="btn sm" to="/pos/setup">⚙ الإعداد</Link>}
        <button className="btn sm" onClick={onReturn}>↩ مرتجع</button>
        <button className="btn sm" onClick={onClose}>إغلاق الوردية</button>
      </div>
      <div className="cats" role="tablist">
        {!cafe && data.floors.map((f: any) => <button key={f.id} role="tab" aria-selected={tab === f.id} className={tab === f.id ? "active" : ""} onClick={() => setTab(f.id)}>{f.name} <span className="small">({f.tables.filter((t: any) => t.order).length}/{f.tables.length})</span></button>)}
        <button role="tab" aria-selected={tab === "orders"} className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}>🥡 سفري وتوصيل{data.orders.length ? ` (${data.orders.length})` : ""}</button>
      </div>
      <div className="rest-body">
        {tab !== "orders" && floor && (floor.tables.length ? <div className="tables">{floor.tables.map((t: any) => { const o = t.order, m = o ? mins(o.openedAt, now) : 0; return (
          <button key={t.id} className={"tbl-card" + (o ? " busy" : "") + (o && m >= 90 ? " late" : "")} disabled={busy} onClick={() => (o ? open({ tableId: t.id }) : data.settings.askGuests ? setGuests(t) : open({ tableId: t.id, guests: 1 }))}>
            <div className="tn">{t.name}</div>
            {o ? <><div className="tt num">{money(o.total)}</div><div className="small">👥 {o.guests} · ⏱ {dur(m)}</div><div className="small">طلب #{o.number}{o.pending ? " · 🔔 لم يُرسل" : ""}</div></> : <><div className="tf">فارغة</div><div className="small muted">🪑 {t.seats} مقاعد</div></>}
          </button>); })}</div> : <Empty text="لا طاولات في هذه الصالة — أضفها من «الإعداد»" />)}
        {tab !== "orders" && !floor && <Empty text="لا توجد صالات بعد — أضف صالة وطاولات من «⚙ الإعداد»" />}
        {tab === "orders" && <>
          <div className="row mb">{(cafe ? ["TAKEAWAY", "DINE_IN", "DELIVERY"] : ["TAKEAWAY", "DELIVERY"]).map((k) => <button key={k} className="btn primary lg" disabled={busy} onClick={() => (k === "DELIVERY" ? setNewOrder(k) : open({ type: k }))}>＋ طلب {TYPE_AR[k]} {TYPE_IC[k]}</button>)}</div>
          {data.orders.length ? <div className="tables">{data.orders.map((o: any) => <button key={o.id} className="tbl-card busy" onClick={async () => { try { onOpen(await api(`/pos/orders/${o.id}`)); } catch (e: any) { toast(e.message, "err"); reload(); } }}>
            <div className="tn">{TYPE_IC[o.type]} طلب #{o.number}</div><div className="tt num">{money(o.total)}</div><div className="small">{TYPE_AR[o.type]} · ⏱ {dur(mins(o.openedAt, now))}</div>{(o.customerName || o.customerPhone) && <div className="small">{o.customerName} <span className="num">{o.customerPhone}</span></div>}</button>)}</div> : <Empty text="لا طلبات مفتوحة" />}
        </>}
      </div>
      {guests && <Modal narrow title={`فتح ${guests.name}`} onClose={() => setGuests(null)}>
        <p className="muted">كم عدد الضيوف؟</p>
        <div className="guest-grid">{Array.from({ length: Math.max(8, guests.seats) }, (_, i) => i + 1).map((n) => <button key={n} className="btn lg" onClick={() => open({ tableId: guests.id, guests: n })}>{n}</button>)}</div>
      </Modal>}
      {newOrder && <DeliveryModal onClose={() => setNewOrder(null)} onSave={(b) => open({ type: newOrder, ...b })} />}
    </div>
  );
}
function DeliveryModal({ onClose, onSave }: { onClose: () => void; onSave: (b: any) => void }) {
  const [f, setF] = useState({ customerName: "", customerPhone: "", address: "" });
  return <Modal narrow title="طلب توصيل جديد" onClose={onClose} footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" disabled={!f.customerPhone.trim()} onClick={() => onSave(f)}>فتح الطلب</button></>}>
    <div className="grid"><Field label="جوال العميل *"><Input autoFocus dir="ltr" inputMode="tel" value={f.customerPhone} onChange={(e) => setF({ ...f, customerPhone: e.target.value })} /></Field><Field label="اسم العميل"><Input value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} /></Field><Field label="العنوان"><textarea className="input" rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field></div>
  </Modal>;
}

/** The strip above the cart while an order is open: where it is, and what can be done with it. */
export function OrderBar({ order, dirty, busy, onBack, onSend, onBill, onMove, onSplit, onCancel, splitting, onEndSplit }: { order: any; dirty: boolean; busy: boolean; splitting: boolean; onBack: () => void; onSend: () => void; onBill: () => void; onMove: () => void; onSplit: () => void; onCancel: () => void; onEndSplit: () => void }) {
  return <div className="order-bar">
    <div className="row between"><b>{order.tableName ? `🍽 ${order.tableName}` : `${TYPE_IC[order.type]} ${TYPE_AR[order.type]}`} · طلب #{order.number}</b><span className="small">{order.tableName ? `👥 ${order.guests} · ` : ""}⏱ {dur(mins(order.openedAt))}{order.waiter ? ` · ${order.waiter}` : ""}</span></div>
    {(order.customerName || order.customerPhone || order.address) && <div className="small">{order.customerName} <span className="num">{order.customerPhone}</span> {order.address}</div>}
    {splitting ? <div className="row"><span className="badge amber">تقسيم: ادفع الأصناف المختارة، والباقي يبقى على الطلب</span><button className="btn sm" onClick={onEndSplit}>إلغاء التقسيم</button></div>
      : <div className="row" style={{ gap: 6 }}>
        <button className="btn sm" disabled={busy} onClick={onBack}>← {order.tableName ? "الطاولات" : "الطلبات"}</button>
        <button className={"btn sm" + (dirty ? " primary" : "")} disabled={busy} onClick={onSend} title="يطبع تذكرة بما لم يُرسل بعد">👨‍🍳 إرسال للمطبخ</button>
        <button className="btn sm" disabled={busy} onClick={onBill} title="كشف مبدئي للعميل قبل الدفع">🧾 الحساب</button>
        <button className="btn sm" disabled={busy} onClick={onSplit}>✂ تقسيم</button>
        <button className="btn sm" disabled={busy} onClick={onMove}>⇄ نقل / دمج</button>
        <button className="btn sm ghost" disabled={busy} onClick={onCancel}>إلغاء الطلب</button>
      </div>}
  </div>;
}

/** What the kitchen prints for one round. */
export function KitchenTicket({ ticket, onClose }: { ticket: any; onClose: () => void }) {
  return <Modal narrow title="تذكرة المطبخ" onClose={onClose} footer={<><button className="btn" onClick={onClose}>إغلاق</button><button className="btn primary" autoFocus onClick={() => window.print()}>🖨 طباعة</button></>}>
    <div className="thermal card kt">
      <div className="c" style={{ fontSize: 20, fontWeight: 800 }}>{ticket.tableName || TYPE_AR[ticket.type]}</div>
      <div className="c" style={{ fontSize: 15, fontWeight: 700 }}>طلب #{ticket.number} · {TYPE_AR[ticket.type]}</div>
      <div className="row between"><span className="num">{fmtDT(ticket.at)}</span><span>{ticket.waiter}</span></div>
      <table style={{ marginTop: 6 }}><tbody>{ticket.items.map((i: any, k: number) => <tr key={k} className={i.cancel ? "kt-x" : ""}><td style={{ fontSize: 18, fontWeight: 800, width: 44 }} className="num">{i.cancel ? "✕" : ""}{i.qty}</td><td style={{ fontSize: 15, fontWeight: 700 }}>{i.cancel ? "إلغاء: " : ""}{i.name}{i.note && <div style={{ fontWeight: 400, fontSize: 13 }}>← {i.note}</div>}</td></tr>)}</tbody></table>
      {ticket.notes && <div style={{ marginTop: 6 }}>ملاحظة: {ticket.notes}</div>}
    </div>
  </Modal>;
}
/** The bill the guest looks at before paying — not a tax invoice. */
export function PreBill({ order, lines, totals, company, onClose }: { order: any; lines: { name: string; qty: number; total: number; note?: string }[]; totals: any; company: any; onClose: () => void }) {
  return <Modal narrow title="كشف الحساب" onClose={onClose} footer={<><button className="btn" onClick={onClose}>إغلاق</button><button className="btn primary" autoFocus onClick={() => window.print()}>🖨 طباعة</button></>}>
    <div className="thermal card">
      <div className="c" style={{ fontWeight: 700, fontSize: 14 }}>{company.nameAr}</div>
      <div className="c" style={{ fontWeight: 700, margin: "4px 0" }}>كشف حساب — ليس فاتورة ضريبية</div>
      <div className="row between"><span>{order.tableName || TYPE_AR[order.type]} · طلب #{order.number}</span><span className="num">{fmtDT(new Date().toISOString())}</span></div>
      <table style={{ marginTop: 6 }}><thead><tr><th style={{ textAlign: "start" }}>الصنف</th><th>الكمية</th><th>الإجمالي</th></tr></thead><tbody>{lines.map((l, i) => <tr key={i}><td>{l.name}</td><td className="c num">{l.qty}</td><td className="c num">{money(l.total)}</td></tr>)}</tbody></table>
      <div style={{ marginTop: 6 }}><div className="row between"><span>قبل الضريبة</span><span className="num">{money(totals.net)}</span></div><div className="row between"><span>الضريبة</span><span className="num">{money(totals.vat)}</span></div>
        <div className="row between" style={{ fontWeight: 700, fontSize: 15, borderTop: "1px solid #000", paddingTop: 3 }}><span>المطلوب</span><span className="num">{money(totals.total)} {CUR()}</span></div>
        {order.guests > 1 && <div className="row between"><span>نصيب الفرد ({order.guests})</span><span className="num">{money(totals.total / order.guests)}</span></div>}</div>
    </div>
  </Modal>;
}
/** Move the order to a free table, or put it together with the order of an occupied one. */
export function MoveModal({ order, data, onClose, onDone }: { order: any; data: any; onClose: () => void; onDone: (o: any) => void }) {
  const { run, busy } = useAction();
  return <Modal title={`نقل أو دمج الطلب #${order.number}`} onClose={onClose}>
    {data.floors.map((f: any) => <div key={f.id} className="mb"><b>{f.name}</b><div className="tables sm">{f.tables.filter((t: any) => t.id !== order.tableId).map((t: any) => <button key={t.id} disabled={busy} className={"tbl-card" + (t.order ? " busy" : "")} onClick={() => run(async () => {
      if (t.order) { if (!confirmDlg(`دمج الطلب #${order.number} مع طلب «${t.name}» (#${t.order.number})؟ تُجمع الأصناف في طلب واحد.`)) return; onDone(await api(`/pos/orders/${order.id}/merge`, { body: { intoId: t.order.id } })); }
      else onDone(await api(`/pos/orders/${order.id}/move`, { body: { tableId: t.id } }));
    })}><div className="tn">{t.name}</div><div className="small">{t.order ? `دمج مع #${t.order.number}` : "نقل إليها"}</div></button>)}</div></div>)}
    {!data.floors.length && <Empty text="لا توجد طاولات" />}
  </Modal>;
}
/** Choose what is paid now; the rest stays on the order. */
export function SplitModal({ lines, guests, onClose, onPick }: { lines: { key: string; name: string; qty: number; unit: number }[]; guests: number; onClose: () => void; onPick: (m: Record<string, number>) => void }) {
  const [m, setM] = useState<Record<string, number>>({});
  const total = lines.reduce((a, l) => a + (m[l.key] || 0) * l.unit, 0);
  const set = (k: string, v: number, max: number) => setM((x) => ({ ...x, [k]: Math.min(max, Math.max(0, v)) }));
  return <Modal title="تقسيم الفاتورة" onClose={onClose} footer={<><span className="grow">المختار: <b className="num">{money(total)}</b> {CUR()} (قبل الضريبة)</span><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" disabled={!total} onClick={() => onPick(m)}>ادفع المختار ←</button></>}>
    <p className="muted small">اختر الكميات التي يدفعها هذا الضيف الآن. ما لم تختره يبقى على الطاولة ليُدفع لاحقاً.</p>
    <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الصنف</th><th className="n">على الطلب</th><th className="n">يُدفع الآن</th></tr></thead><tbody>{lines.map((l) => <tr key={l.key}><td>{l.name}</td><td className="n num">{l.qty}</td><td className="n"><div className="row" style={{ gap: 4, justifyContent: "flex-end" }}><button className="btn sm" onClick={() => set(l.key, (m[l.key] || 0) - 1, l.qty)}>−</button><b className="num" style={{ minWidth: 26, textAlign: "center" }}>{m[l.key] || 0}</b><button className="btn sm" onClick={() => set(l.key, (m[l.key] || 0) + 1, l.qty)}>＋</button><button className="btn sm ghost" onClick={() => set(l.key, l.qty, l.qty)}>الكل</button></div></td></tr>)}</tbody></table></div>
    {guests > 1 && <div className="small muted mt">للقسمة بالتساوي على {guests} ضيوف استخدم «🧾 الحساب»: يعرض نصيب الفرد.</div>}
  </Modal>;
}
/** A note for the kitchen on one line: quick choices and free text. */
export function NoteModal({ name, value, quick, onClose, onSave }: { name: string; value: string; quick: string[]; onClose: () => void; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  const parts = v.split("،").map((x) => x.trim()).filter(Boolean);
  const toggle = (n: string) => setV(parts.includes(n) ? parts.filter((x) => x !== n).join("، ") : [...parts, n].join("، "));
  return <Modal narrow title={`ملاحظة للمطبخ: ${name}`} onClose={onClose} footer={<><button className="btn" onClick={() => onSave("")}>مسح</button><button className="btn primary" onClick={() => onSave(v.trim())}>حفظ</button></>}>
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{quick.map((n) => <button key={n} className={"chip" + (parts.includes(n) ? " on" : "")} onClick={() => toggle(n)}>{n}</button>)}</div>
    <Field label="ملاحظة أخرى"><Input autoFocus value={v} onChange={(e) => setV(e.target.value)} maxLength={160} onKeyDown={(e) => { if (e.key === "Enter") onSave(v.trim()); }} /></Field>
  </Modal>;
}

/** Kitchen display: one card per order with what is still to be prepared; the cook taps «جاهز». */
export function KitchenPage() {
  const { data, reload, loading } = useFetch<any[]>("/pos/kitchen");
  const { run, busy } = useAction();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const iv = setInterval(() => { setNow(Date.now()); reload(); }, 8000); return () => clearInterval(iv); }, []);
  if (loading && !data) return <Loading />;
  return <div className="grid">
    <div className="card"><div className="card-h"><div><h3>👨‍🍳 شاشة المطبخ</h3><div className="small muted">الأصناف المرسلة من الصالة بترتيب وصولها. تتحدث تلقائياً كل 8 ثوانٍ.</div></div><div className="row"><span className="badge teal">{(data || []).length} طلب قيد التجهيز</span><Link className="btn sm" to="/pos">← نقطة البيع</Link></div></div></div>
    {!(data || []).length ? <div className="card"><Empty text="لا طلبات بانتظار التجهيز ✓" /></div> : <div className="kds">{(data || []).map((o) => { const m = mins(o.since, now); return (
      <div key={o.id} className={"card kds-card" + (m >= 20 ? " late" : m >= 10 ? " warn" : "")}>
        <div className="kds-h"><b>{o.tableName || TYPE_AR[o.type]}</b><span>#{o.number} · {TYPE_AR[o.type]}</span><span className="num">⏱ {dur(m)}</span></div>
        <div className="kds-b">{o.items.map((i: any) => <div key={i.key} className="kds-i"><b className="num">{i.qty}×</b><span>{i.name}{i.note && <div className="kds-n">← {i.note}</div>}</span></div>)}{o.notes && <div className="kds-n">ملاحظة: {o.notes}</div>}</div>
        <button className="btn primary block" disabled={busy} onClick={() => run(async () => { await api(`/pos/orders/${o.id}/ready`, { body: {} }); reload(); })}>✓ جاهز</button>
      </div>); })}</div>}
  </div>;
}

/** Point-of-sale setup: the kind of activity, halls and tables, quick kitchen notes, and the restaurant report. */
export function PosSetupPage() {
  const { can } = useCompanyContext();
  const toast = useToast();
  const { run, busy } = useAction();
  const { data, reload, loading } = useFetch<any>("/pos/restaurant");
  const [floorName, setFloorName] = useState("");
  const [add, setAdd] = useState<any>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [range, setRange] = useState({ from: today().slice(0, 8) + "01", to: today() });
  const rep = useFetch<any>(`/pos/restaurant/report${q(range)}`, [range.from, range.to]);
  const W = can("settings.write");
  if (loading && !data) return <Loading />;
  if (!data) return <Empty />;
  const s = data.settings;
  const MODES: [string, string, string, string][] = [["RETAIL", "🛒", "تجزئة وخدمات", "بقالة، ملابس، صيدلية، قطع غيار، مغسلة، صالون: بيع مباشر بالباركود والبحث، تعليق الطلب، وأسعار الجملة."], ["RESTAURANT", "🍽", "مطعم بطاولات", "صالات وطاولات، طلب مفتوح لكل طاولة، إرسال للمطبخ على دفعات، نقل ودمج وتقسيم الفاتورة، وسفري وتوصيل."], ["CAFE", "☕", "كافيه ووجبات سريعة", "طلبات مرقّمة سفري ومحلي وتوصيل بلا طاولات، مع تذكرة تحضير وشاشة المطبخ."]];
  return <div className="grid">
    <div className="card"><div className="card-h"><div><h3>نوع النشاط في نقطة البيع</h3><div className="small muted">يحدد شكل شاشة البيع. يمكن تغييره في أي وقت؛ المبيعات والقيود والمخزون واحدة في كل الأنواع.</div></div><Link className="btn sm" to="/pos">← نقطة البيع</Link></div>
      <div className="card-b mode-grid">{MODES.map(([k, ic, t, d]) => <button key={k} className={"mode-card" + (s.mode === k ? " on" : "")} disabled={!W || busy} onClick={() => run(async () => { await api("/pos/restaurant/settings", { method: "PUT", body: { mode: k } }); reload(); }, `نوع النشاط: ${t}`)}><div className="mi">{ic}</div><b>{t}</b><div className="small muted">{d}</div>{s.mode === k && <span className="badge green">المستخدم الآن</span>}</button>)}</div></div>
    {s.mode === "RESTAURANT" && <div className="card"><div className="card-h"><h3>الصالات والطاولات</h3>{W && <div className="row"><Input placeholder="اسم صالة جديدة (مثل: العائلات، الخارجية)" value={floorName} onChange={(e) => setFloorName(e.target.value)} style={{ width: 260 }} /><button className="btn primary sm" disabled={busy || !floorName.trim()} onClick={() => run(async () => { await api("/pos/floors", { body: { name: floorName } }); setFloorName(""); reload(); })}>＋ صالة</button></div>}</div>
      <div className="card-b grid">{data.floors.map((f: any) => <div key={f.id} className="floor-box">
        <div className="row between"><b>{f.name} <span className="small muted">({f.tables.length} طاولة)</span></b>{W && <div className="row"><button className="btn sm" onClick={() => setAdd({ floorId: f.id, count: 4, seats: 4, prefix: "طاولة" })}>＋ طاولات</button><button className="btn sm ghost" disabled={busy} onClick={() => { const n = prompt("اسم الصالة", f.name); if (n) run(async () => { await api(`/pos/floors/${f.id}`, { method: "PUT", body: { name: n } }); reload(); }); }}>تسمية</button><button className="btn sm ghost" disabled={busy} onClick={() => confirmDlg(`حذف الصالة «${f.name}» وطاولاتها؟`) && run(async () => { await api(`/pos/floors/${f.id}`, { method: "DELETE" }); reload(); })}>حذف</button></div>}</div>
        <div className="tables sm mt">{f.tables.map((t: any) => <div key={t.id} className={"tbl-card static" + (t.order ? " busy" : "")}><div className="tn">{t.name}</div><div className="small muted">🪑 {t.seats}</div>{W && <div className="row" style={{ gap: 2, justifyContent: "center" }}><button className="btn sm ghost" title="تعديل الاسم والمقاعد" onClick={() => { const n = prompt("اسم الطاولة", t.name); if (!n) return; const st = prompt("عدد المقاعد", String(t.seats)); run(async () => { await api(`/pos/tables/${t.id}`, { method: "PUT", body: { name: n, seats: Number(st) || t.seats } }); reload(); }); }}>✎</button><button className="btn sm ghost" title="حذف" onClick={() => confirmDlg(`حذف «${t.name}»؟`) && run(async () => { await api(`/pos/tables/${t.id}`, { method: "DELETE" }); reload(); })}>🗑</button></div>}</div>)}{!f.tables.length && <span className="muted small">لا طاولات بعد</span>}</div>
      </div>)}{!data.floors.length && <Empty text="أضف صالة أولاً" />}</div></div>}
    {s.mode !== "RETAIL" && <div className="card"><div className="card-h"><div><h3>ملاحظات المطبخ السريعة</h3><div className="small muted">تظهر كأزرار عند الضغط على 📝 بجانب الصنف في الطلب.</div></div>{W && (notes === null ? <button className="btn sm" onClick={() => setNotes(s.quickNotes.join("\n"))}>تعديل</button> : <div className="row"><button className="btn sm" onClick={() => setNotes(null)}>إلغاء</button><button className="btn primary sm" disabled={busy} onClick={() => run(async () => { await api("/pos/restaurant/settings", { method: "PUT", body: { quickNotes: notes.split("\n") } }); setNotes(null); reload(); }, "حُفظت")}>حفظ</button></div>)}</div>
      <div className="card-b">{notes === null ? <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{s.quickNotes.map((n: string) => <span key={n} className="badge">{n}</span>)}</div> : <textarea className="input" rows={8} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظة في كل سطر" />}
        <label className="check mt"><input type="checkbox" checked={s.askGuests} disabled={!W} onChange={(e) => run(async () => { await api("/pos/restaurant/settings", { method: "PUT", body: { askGuests: e.target.checked } }); reload(); })} /> اسأل عن عدد الضيوف عند فتح الطاولة</label></div></div>}
    {s.mode !== "RETAIL" && <div className="card"><div className="card-h"><h3>تقرير المطعم</h3><DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} /></div>
      {rep.data ? <div className="card-b grid"><div className="grid c4"><div className="card kpi"><div className="label">الطلبات المدفوعة</div><div className="value num">{rep.data.orders}</div></div><div className="card kpi success"><div className="label">الإجمالي شامل الضريبة</div><div className="value num">{money(rep.data.total)}</div></div><div className="card kpi info"><div className="label">متوسط الطلب</div><div className="value num">{money(rep.data.average)}</div></div><div className="card kpi danger"><div className="label">طلبات ملغاة</div><div className="value num">{rep.data.cancelled}</div></div></div>
        <div className="grid c3"><RepTable title="حسب نوع الطلب" rows={rep.data.byType.map((r: any) => [TYPE_AR[r.type] || r.type, r.n, r.total])} /><RepTable title="حسب الطاولة" rows={rep.data.byTable.map((r: any) => [r.name, r.n, r.total])} /><RepTable title="حسب الساعة" rows={rep.data.byHour.map((r: any) => [`${String(r.h).padStart(2, "0")}:00`, r.n, r.total])} /></div></div> : <Loading />}</div>}
    {add && <Modal narrow title="إضافة طاولات" onClose={() => setAdd(null)} footer={<><button className="btn" onClick={() => setAdd(null)}>إلغاء</button><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api("/pos/tables", { body: add }); setAdd(null); reload(); }, "أُضيفت الطاولات")}>إضافة</button></>}>
      <div className="grid"><Field label="عدد الطاولات"><NumInput autoFocus value={add.count} onChange={(e) => setAdd({ ...add, count: e.target.value })} /></Field><Field label="المقاعد لكل طاولة"><NumInput value={add.seats} onChange={(e) => setAdd({ ...add, seats: e.target.value })} /></Field><Field label="بادئة الاسم" hint="تُرقَّم تلقائياً: طاولة 1، طاولة 2…"><Input value={add.prefix} onChange={(e) => setAdd({ ...add, prefix: e.target.value })} /></Field></div>
    </Modal>}
  </div>;
}
const RepTable = ({ title, rows }: { title: string; rows: [string, number, number][] }) => <div><b>{title}</b><div className="table-wrap mt" style={{ maxHeight: 260 }}><table className="tbl compact"><thead><tr><th>البند</th><th className="n">طلبات</th><th className="n">الإجمالي</th></tr></thead><tbody>{rows.map((r, i) => <tr key={i}><td>{r[0]}</td><td className="n num">{r[1]}</td><td className="n num">{money(r[2])}</td></tr>)}{!rows.length && <tr><td colSpan={3} className="muted">لا بيانات في الفترة</td></tr>}</tbody></table></div></div>;
