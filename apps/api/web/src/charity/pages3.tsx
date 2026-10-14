/** Round 19 charity screens: sponsorships, in-kind donations, volunteers, alerts. */
import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, q, useFetch, Money, money, Loading, Empty, Modal, Field, Input, Select, NumInput, Picker, accountFetcher, useAction, useCompanyContext, today, fmtDate, SearchBox, FilterInfo, useSorted, Th, matches, exportExcel, useUrlSearch, confirmDlg, PeriodFilter } from "../lib";
import { useCharity } from "./CharityApp";
import { PrintModal, fromInkind, volunteerCertData } from "./templates";

const cashFetcher = accountFetcher((a) => a.isCashBank);
const acLabel = (a: any) => `${a.code} — ${a.nameAr}`;
const donorFetcher = (s: string) => api(`/charity/donors${q({ q: s, limit: 20 })}`);
const benefFetcher = (s: string) => api(`/charity/beneficiaries${q({ q: s, limit: 20 })}`);
const SP_KIND: Record<string, string> = { ORPHAN: "كفالة يتيم", FAMILY: "كفالة أسرة", STUDENT: "كفالة طالب علم", PATIENT: "كفالة مريض", OTHER: "كفالة أخرى" };
const FREQ: Record<number, string> = { 1: "شهري", 3: "ربع سنوي", 6: "نصف سنوي", 12: "سنوي" };
const ST: Record<string, string> = { ACTIVE: "نشطة", PAUSED: "موقوفة", ENDED: "منتهية" };
function ProjectSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { projects } = useCharity();
  return <Select value={value || ""} onChange={(e) => onChange(e.target.value)}><option value="">— بدون مشروع —</option>{projects.map((p: any) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</Select>;
}
export const waLink = (phone: string, text: string) => { const p = String(phone || "").replace(/\D/g, "").replace(/^0/, "966"); return `https://wa.me/${p}?text=${encodeURIComponent(text)}`; };

// ─── alerts card (dashboard) ───────────────────────────────────────────────
export function AlertsCard() {
  const { data } = useFetch<any[]>("/charity/alerts");
  if (!data) return null;
  if (!data.length) return <div className="alert info small mb">✓ لا توجد تنبيهات — كل العهد مسوّاة في مواعيدها، والكفالات محصّلة، والأيام مقفلة.</div>;
  const icon: Record<string, string> = { danger: "⛔", warn: "⚠", info: "ℹ" };
  return (
    <div className="card mb ch-alerts"><div className="card-h"><h3>🔔 تنبيهات تحتاج متابعة ({data.length})</h3></div>
      <div className="card-b">{data.map((a, i) => <Link key={i} to={a.link} className={"ch-alert " + a.level}><span className="ic">{icon[a.level]}</span><div><b>{a.title}</b><div className="small">{a.detail}</div></div><span className="go">←</span></Link>)}</div>
    </div>
  );
}

// ─── sponsorships ──────────────────────────────────────────────────────────
export function SponsorshipsPage() {
  const { can } = useCompanyContext();
  const nav = useNavigate();
  const [text, setText] = useUrlSearch();
  const [status, setStatus] = useState("ACTIVE");
  const [onlyLate, setOnlyLate] = useState(false);
  const { data, loading, reload } = useFetch<any[]>(`/charity/sponsorships${q({ status })}`);
  const [edit, setEdit] = useState<any>(null);
  const [col, setCol] = useState<any>(null);
  const [payout, setPayout] = useState(false);
  const rows = useMemo(() => (data || []).filter((r) => matches(r, text, ["number", "sponsorName", "beneficiaryName", "notes"]) && (!onlyLate || r.overdue > 0)), [data, text, onlyLate]);
  const s = useSorted(rows);
  const active = (data || []).filter((r) => r.status === "ACTIVE");
  const monthly = active.reduce((a, r) => a + Number(r.monthly), 0);
  const late = active.filter((r) => r.overdue > 0);
  return (
    <div className="card">
      <div className="card-h"><h3>الكفالات</h3><div className="row">
        <button className="btn sm" onClick={() => exportExcel(rows.map((r) => ({ الرقم: r.number, الكافل: r.sponsorName, المكفول: r.beneficiaryName, النوع: SP_KIND[r.kind], القسط: Number(r.amount), الدورية: FREQ[r.frequency], "شهرياً": Number(r.monthly), البداية: fmtDate(r.startDate), النهاية: fmtDate(r.endDate), "أقساط مستحقة": r.due, "مسددة": r.paid, "متأخرة": r.overdue, "المبلغ المتأخر": r.overdueAmount, "القسط القادم": fmtDate(r.nextDue), الحالة: ST[r.status] })), "الكفالات")}>⬇ Excel</button>
        {can("payments.write") && <><button className="btn sm" onClick={() => setPayout(true)}>🧾 مسير صرف الكفالات للمستفيدين</button><button className="btn primary" onClick={() => setEdit({})}>＋ كفالة جديدة</button></>}
      </div></div>
      <div className="card-b">
        <div className="grid c3 mb">
          <div className="card kpi"><span className="label">الكفالات النشطة</span><span className="value num">{active.length}</span><span className="sub">التزام شهري <Money v={monthly} /></span><span className="icon">🤲</span></div>
          <div className={"card kpi " + (late.length ? "danger" : "success")}><span className="label">كفالات عليها أقساط متأخرة</span><span className="value num">{late.length}</span><span className="sub">بمبلغ <Money v={late.reduce((a, r) => a + r.overdueAmount, 0)} /></span><span className="icon">⏰</span></div>
          <div className="card kpi info"><span className="label">المحصّل من الكفالات</span><span className="value"><Money v={(data || []).reduce((a, r) => a + Number(r.paidAmount), 0)} /></span><span className="icon">💚</span></div>
        </div>
        <div className="toolbar">
          <SearchBox value={text} onChange={setText} placeholder="الكافل أو المكفول أو الرقم" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 140 }}><option value="">كل الحالات</option>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={onlyLate} onChange={(e) => setOnlyLate(e.target.checked)} />المتأخرة فقط</label>
          <FilterInfo shown={rows.length} total={data?.length || 0} active={!!(text || onlyLate)} onClear={() => { setText(""); setOnlyLate(false); }} />
        </div>
      </div>
      {loading && !data ? <Loading /> : !rows.length ? <Empty text="لا توجد كفالات — أضف كفالة تربط متبرعاً (كافلاً) بمستفيد بمبلغ دوري" /> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><Th k="number" s={s}>الرقم</Th><Th k="sponsorName" s={s}>الكافل</Th><Th k="beneficiaryName" s={s}>المكفول</Th><Th k="amount" s={s} n>القسط</Th><th>الأقساط</th><Th k="nextDue" s={s}>القسط القادم</Th><Th k="overdueAmount" s={s} n>المتأخر</Th><th /></tr></thead>
          <tbody>{s.sorted.map((r: any) => <tr key={r.id} style={r.overdue > 0 ? { background: "var(--danger-soft)" } : undefined}>
            <td className="num">{r.number}<div className="small muted">{SP_KIND[r.kind]}</div></td>
            <td><b>{r.sponsorName}</b><div className="small muted num">{r.sponsorPhone}</div></td>
            <td>{r.beneficiaryName || <span className="muted">— غير محدد —</span>}{r.projectName && <div className="small muted">{r.projectName}</div>}</td>
            <td className="n"><b><Money v={r.amount} /></b><div className="small muted">{FREQ[r.frequency]}</div></td>
            <td className="small">مسدد <b className="num">{r.paid}</b> من <b className="num">{r.due}</b> مستحق{r.total ? <> · المدة <span className="num">{r.total}</span></> : ""}<div className="progress" style={{ marginTop: 4 }}><div style={{ width: `${r.due ? Math.min(100, (r.paid / r.due) * 100) : 100}%` }} /></div></td>
            <td className="dt">{fmtDate(r.nextDue) || "—"}</td>
            <td className={"n " + (r.overdue ? "neg-val" : "")}>{r.overdue ? <><Money v={r.overdueAmount} /><div className="small">{r.overdue} قسط</div></> : "—"}</td>
            <td className="row" style={{ gap: 4 }}>
              {can("payments.write") && r.status !== "ENDED" && <button className="btn sm primary" onClick={() => setCol(r)}>تحصيل</button>}
              {r.overdue > 0 && r.sponsorPhone && <a className="btn sm" target="_blank" rel="noreferrer" href={waLink(r.sponsorPhone, `السلام عليكم ${r.sponsorName}،\nنذكّركم بقسط ${SP_KIND[r.kind]}${r.beneficiaryName ? " لـ " + r.beneficiaryName : ""} بمبلغ ${money(r.amount)} ريال (${r.overdue} قسط مستحق).\nجزاكم الله خيراً على عطائكم.`)}>واتساب تذكير</a>}
              <button className="btn sm" onClick={() => nav(`/charity/receipts?q=${encodeURIComponent(r.number)}`)} title="سندات التحصيل">السجل</button>
              {can("payments.write") && <button className="btn sm ghost" onClick={() => setEdit(r)}>تعديل</button>}
            </td>
          </tr>)}</tbody>
        </table></div>
      )}
      {edit && <SponsorshipModal init={edit} onClose={(ok) => { setEdit(null); if (ok) reload(); }} />}
      {col && <CollectModal s={col} onClose={(ok) => { setCol(null); if (ok) reload(); }} />}
      {payout && <PayoutModal onClose={(id) => { setPayout(false); if (id) nav("/charity/batches"); }} />}
    </div>
  );
}

function SponsorshipModal({ init, onClose }: { init: any; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const [sp, setSp] = useState<any>(init.sponsorId ? { id: init.sponsorId, code: init.sponsorCode, name: init.sponsorName } : null);
  const [bn, setBn] = useState<any>(init.beneficiaryId ? { id: init.beneficiaryId, code: init.beneficiaryCode, name: init.beneficiaryName } : null);
  const [f, setF] = useState<any>({ kind: init.kind || "ORPHAN", amount: init.amount || "", frequency: init.frequency || 1, startDate: fmtDate(init.startDate) || today().slice(0, 8) + "01", endDate: fmtDate(init.endDate), status: init.status || "ACTIVE", projectId: init.projectId || "", notes: init.notes || "" });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  return (
    <Modal title={init.id ? `تعديل الكفالة ${init.number}` : "كفالة جديدة"} onClose={() => onClose()} footer={<><button className="btn primary" disabled={busy} onClick={() => run(async () => { const body = { ...f, sponsorId: sp?.id, beneficiaryId: bn?.id }; if (init.id) await api(`/charity/sponsorships/${init.id}`, { method: "PUT", body }); else await api("/charity/sponsorships", { body }); onClose(true); }, "تم حفظ الكفالة")}>حفظ</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <div className="grid c2">
        <Field label="الكافل (من المتبرعين)" span2><Picker value={sp} onChange={setSp} fetcher={donorFetcher} label={(d: any) => `${d.code ? d.code + " — " : ""}${d.name}`} /></Field>
        <Field label="المكفول (من المستفيدين)" span2><Picker value={bn} onChange={setBn} fetcher={benefFetcher} label={(d: any) => `${d.code ? d.code + " — " : ""}${d.name}`} placeholder="اختياري — يمكن تحديده لاحقاً" /></Field>
        <Field label="نوع الكفالة"><Select value={f.kind} onChange={set("kind")}>{Object.entries(SP_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="الدورية"><Select value={f.frequency} onChange={set("frequency")}>{Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="مبلغ القسط"><NumInput value={f.amount} onChange={set("amount")} /></Field>
        <Field label="المشروع / البرنامج"><ProjectSelect value={f.projectId} onChange={set("projectId")} /></Field>
        <Field label="تاريخ البداية (أول استحقاق)"><Input type="date" value={f.startDate} onChange={set("startDate")} /></Field>
        <Field label="تاريخ النهاية (اختياري)"><Input type="date" value={f.endDate} onChange={set("endDate")} /></Field>
        <Field label="الحالة"><Select value={f.status} onChange={set("status")}>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="ملاحظات"><Input value={f.notes} onChange={set("notes")} /></Field>
      </div>
    </Modal>
  );
}

function CollectModal({ s, onClose }: { s: any; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const [acc, setAcc] = useState<any>(null);
  const [f, setF] = useState<any>({ count: Math.max(1, s.overdue || 1), method: "CASH", refNo: "", date: today() });
  return (
    <Modal title={`تحصيل الكفالة ${s.number} — ${s.sponsorName}`} narrow onClose={() => onClose()} footer={<><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api(`/charity/sponsorships/${s.id}/collect`, { body: { ...f, cashAccountId: acc?.id } }); onClose(true); }, "تم التحصيل وإصدار سند القبض")}>تحصيل <Money v={Number(s.amount) * Number(f.count || 0)} /></button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <div className="stat-list mb"><div className="item"><span>القسط</span><b><Money v={s.amount} /> ({FREQ[s.frequency]})</b></div><div className="item"><span>متأخر</span><b>{s.overdue} قسط</b></div><div className="item"><span>القسط القادم</span><b>{fmtDate(s.nextDue) || "—"}</b></div></div>
      <div className="grid c2">
        <Field label="عدد الأقساط"><NumInput value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} /></Field>
        <Field label="التاريخ"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="الطريقة"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="CASH">نقدي</option><option value="TRANSFER">تحويل بنكي</option><option value="CARD">شبكة</option><option value="CHEQUE">شيك</option></Select></Field>
        {f.method !== "CASH" && f.method !== "CARD" && <Field label="المرجع"><Input value={f.refNo} onChange={(e) => setF({ ...f, refNo: e.target.value })} dir="ltr" /></Field>}
        <Field label="إلى حساب" span2><Picker value={acc} onChange={setAcc} fetcher={cashFetcher} label={acLabel} placeholder="افتراضي حسب الطريقة" /></Field>
      </div>
    </Modal>
  );
}

function PayoutModal({ onClose }: { onClose: (id?: string) => void }) {
  const { run, busy } = useAction();
  const [acc, setAcc] = useState<any>(null);
  const [month, setMonth] = useState(today().slice(0, 7));
  return (
    <Modal title="مسير صرف الكفالات للمستفيدين" narrow onClose={() => onClose()} footer={<><button className="btn primary" disabled={busy} onClick={() => run(async () => { const r = await api("/charity/sponsorships-payout", { body: { month, payAccountId: acc?.id } }); onClose(r.id); }, "تم إنشاء مسودة المسير — راجعها واعتمدها من مسير المصروفات")}>إنشاء المسير</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <div className="small muted mb">يُنشئ مسودة مسير مصروفات بسطر لكل مستفيد مكفول بنصيبه الشهري من كفالاته النشطة، على حساب «كفالات مصروفة للمستفيدين».</div>
      <Field label="الشهر"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
      <Field label="من حساب (البنك)"><Picker value={acc} onChange={setAcc} fetcher={cashFetcher} label={acLabel} /></Field>
    </Modal>
  );
}

// ─── in-kind donations ─────────────────────────────────────────────────────
export function InkindPage() {
  const { can } = useCompanyContext();
  const { settings } = useCharity();
  const [tab, setTab] = useState<"stock" | "docs">("stock");
  const items = useFetch<any[]>("/charity/inkind/items");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [kind, setKind] = useState("");
  const docs = useFetch<any[]>(`/charity/inkind/docs${q({ from, to, kind })}`);
  const [text, setText] = useUrlSearch();
  const [doc, setDoc] = useState<"IN" | "OUT" | null>(null);
  const [item, setItem] = useState<any>(null);
  const [pr, setPr] = useState<any>(null);
  const { run, busy } = useAction();
  const reload = () => { items.reload(); docs.reload(); };
  const itemRows = (items.data || []).filter((r) => matches(r, text, ["code", "name", "category"]));
  const docRows = (docs.data || []).filter((r) => matches(r, text, ["number", "partyName", (x) => (x.lines || []).map((l: any) => l.name).join(" ")]));
  const sI = useSorted(itemRows), sD = useSorted(docRows);
  const totalValue = (items.data || []).reduce((a, r) => a + Number(r.value), 0);
  return (
    <div className="card">
      <div className="card-h"><div className="row"><h3>التبرعات العينية</h3><div className="tabs" style={{ margin: 0 }}><button className={tab === "stock" ? "active" : ""} onClick={() => setTab("stock")}>المخزون</button><button className={tab === "docs" ? "active" : ""} onClick={() => setTab("docs")}>الاستلام والتوزيع</button></div></div>
        <div className="row">
          <button className="btn sm" onClick={() => setPr({ key: "inkindIn", data: {} })}>🖨 سند استلام فارغ</button>
          <button className="btn sm" onClick={() => setPr({ key: "inkindOut", data: {} })}>🖨 محضر صرف فارغ</button>
          {can("payments.write") && <><button className="btn sm" onClick={() => setItem({})}>＋ صنف</button><button className="btn primary" onClick={() => setDoc("IN")}>＋ استلام تبرع عيني</button><button className="btn primary" onClick={() => setDoc("OUT")}>↗ صرف مساعدات</button></>}
        </div>
      </div>
      <div className="card-b"><div className="toolbar">
        <SearchBox value={text} onChange={setText} placeholder={tab === "stock" ? "الصنف أو الفئة" : "الرقم أو الطرف أو الصنف"} />
        {tab === "docs" && <><PeriodFilter from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} /><Select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 130 }}><option value="">الكل</option><option value="IN">استلام</option><option value="OUT">توزيع</option></Select></>}
        <div className="grow" /><b>قيمة المخزون الحالي: <Money v={totalValue} /></b>
      </div></div>
      {tab === "stock" ? (items.loading && !items.data ? <Loading /> : !itemRows.length ? <Empty text="لا توجد أصناف — تُضاف تلقائياً عند أول استلام" /> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><Th k="code" s={sI}>الرمز</Th><Th k="name" s={sI}>الصنف</Th><Th k="category" s={sI}>الفئة</Th><Th k="received" s={sI} n>المستلم</Th><Th k="distributed" s={sI} n>الموزع</Th><Th k="qty" s={sI} n>الرصيد</Th><Th k="avgValue" s={sI} n>متوسط القيمة</Th><Th k="value" s={sI} n>القيمة</Th><th /></tr></thead>
          <tbody>{sI.sorted.map((r: any) => <tr key={r.id} style={Number(r.minQty) > 0 && Number(r.qty) <= Number(r.minQty) ? { background: "var(--accent-soft)" } : undefined}>
            <td className="num">{r.code}</td><td><b>{r.name}</b> <span className="small muted">({r.unit})</span></td><td>{r.category || "—"}</td>
            <td className="n">{Number(r.received)}</td><td className="n">{Number(r.distributed)}</td><td className="n"><b>{Number(r.qty)}</b>{Number(r.minQty) > 0 && <div className="small muted">الحد {Number(r.minQty)}</div>}</td>
            <td className="n"><Money v={r.avgValue} /></td><td className="n"><Money v={r.value} /></td>
            <td>{can("payments.write") && <button className="btn sm ghost" onClick={() => setItem(r)}>تعديل</button>}</td>
          </tr>)}</tbody>
        </table></div>
      )) : (docs.loading && !docs.data ? <Loading /> : !docRows.length ? <Empty text="لا توجد مستندات" /> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><Th k="number" s={sD}>الرقم</Th><Th k="date" s={sD}>التاريخ</Th><th>النوع</th><Th k="partyName" s={sD}>الطرف</Th><th>الأصناف</th><Th k="total" s={sD} n>القيمة</Th><th>الحالة</th><th /></tr></thead>
          <tbody>{sD.sorted.map((r: any) => <tr key={r.id} style={r.status === "CANCELLED" ? { opacity: .55 } : undefined}>
            <td className="num">{r.number}{r.journalNumber && <div className="small muted num">{r.journalNumber}</div>}</td><td className="dt">{fmtDate(r.date)}</td>
            <td><span className={"badge " + (r.kind === "IN" ? "green" : "amber")}>{r.kind === "IN" ? "استلام" : "توزيع"}</span></td>
            <td>{r.partyName}<div className="small muted">{r.projectName}</div></td>
            <td className="small">{(r.lines || []).map((l: any) => `${l.name} × ${Number(l.qty)}`).join("، ")}</td>
            <td className="n"><Money v={r.total} /></td><td><span className={"badge " + (r.status === "POSTED" ? "green" : "red")}>{r.status === "POSTED" ? "مرحّل" : "ملغى"}</span></td>
            <td className="row" style={{ gap: 4 }}><button className="btn sm" onClick={() => setPr({ key: r.kind === "IN" ? "inkindIn" : "inkindOut", data: fromInkind(r) })}>🖨</button>{can("payments.write") && r.status === "POSTED" && <button className="btn sm ghost" disabled={busy} onClick={() => confirmDlg(`إلغاء ${r.number}؟ ستُعاد الكميات ويُعكس القيد.`) && run(async () => { await api(`/charity/inkind/docs/${r.id}/cancel`, { body: {} }); reload(); }, "تم الإلغاء")}>إلغاء</button>}</td>
          </tr>)}</tbody>
        </table></div>
      ))}
      {doc && <InkindModal kind={doc} items={items.data || []} onClose={(saved) => { setDoc(null); if (saved) { reload(); setTab("docs"); setPr({ key: saved.kind === "IN" ? "inkindIn" : "inkindOut", data: fromInkind(saved, saved._partner) }); } }} />}
      {item && <ItemModal init={item} onClose={(ok) => { setItem(null); if (ok) reload(); }} />}
      {pr && <PrintModal tplKey={pr.key} data={pr.data} settings={settings} onClose={() => setPr(null)} />}
    </div>
  );
}

function ItemModal({ init, onClose }: { init: any; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ name: init.name || "", unit: init.unit || "حبة", category: init.category || "", minQty: init.minQty || "" });
  return (
    <Modal title={init.id ? `تعديل ${init.code}` : "صنف عيني جديد"} narrow onClose={() => onClose()} footer={<><button className="btn primary" disabled={busy} onClick={() => run(async () => { if (init.id) await api(`/charity/inkind/items/${init.id}`, { method: "PUT", body: f }); else await api("/charity/inkind/items", { body: f }); onClose(true); }, "تم الحفظ")}>حفظ</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <Field label="اسم الصنف"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="grid c3"><Field label="الوحدة"><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} list="ik-units" /></Field><Field label="الفئة"><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} list="ik-cats" /></Field><Field label="حد إعادة الطلب"><NumInput value={f.minQty} onChange={(e) => setF({ ...f, minQty: e.target.value })} /></Field></div>
      <datalist id="ik-units"><option>حبة</option><option>سلة</option><option>كرتون</option><option>كيس</option><option>قطعة</option><option>كيلو</option></datalist>
      <datalist id="ik-cats"><option>مواد غذائية</option><option>ملابس</option><option>بطانيات ومفروشات</option><option>أجهزة كهربائية</option><option>أثاث</option><option>مستلزمات مدرسية</option><option>أدوية ومستلزمات طبية</option></datalist>
    </Modal>
  );
}

function InkindModal({ kind, items, onClose }: { kind: "IN" | "OUT"; items: any[]; onClose: (saved?: any) => void }) {
  const { run, busy } = useAction();
  const [party, setParty] = useState<any>(null);
  const [f, setF] = useState<any>({ date: today(), partyName: "", projectId: "", notes: "" });
  const [lines, setLines] = useState<any[]>([{ itemId: "", name: "", unit: "حبة", qty: "", unitValue: "" }]);
  const setL = (i: number, k: string, v: any) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const avail = (id: string) => items.find((x) => x.id === id);
  const total = kind === "IN" ? lines.reduce((a, l) => a + Number(l.qty || 0) * Number(l.unitValue || 0), 0) : lines.reduce((a, l) => { const it = avail(l.itemId); return a + (it ? Number(it.avgValue) * Number(l.qty || 0) : 0); }, 0);
  return (
    <Modal title={kind === "IN" ? "استلام تبرع عيني" : "صرف مساعدات عينية لمستفيد"} wide onClose={() => onClose()} footer={<><b className="grow">القيمة: <Money v={total} /></b><button className="btn primary" disabled={busy} onClick={() => run(async () => { const r = await api("/charity/inkind/docs", { body: { ...f, kind, partnerId: party?.id, partyName: f.partyName || party?.name, lines: lines.map((l) => ({ ...l, itemId: l.itemId || undefined })) } }); onClose({ ...r, _partner: party }); }, "تم الحفظ وترحيل القيد")}>حفظ وترحيل</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <div className="grid c3">
        <Field label={kind === "IN" ? "المتبرع (من السجل)" : "المستفيد (من السجل)"}><Picker value={party} onChange={(p: any) => { setParty(p); if (p) setF({ ...f, partyName: p.name }); }} fetcher={kind === "IN" ? donorFetcher : benefFetcher} label={(d: any) => `${d.code} — ${d.name}`} /></Field>
        <Field label={kind === "IN" ? "اسم المتبرع / الجهة" : "اسم المستفيد"}><Input value={f.partyName} onChange={(e) => setF({ ...f, partyName: e.target.value })} /></Field>
        <Field label="التاريخ"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="المشروع / البرنامج"><ProjectSelect value={f.projectId} onChange={(v) => setF({ ...f, projectId: v })} /></Field>
        <Field label="ملاحظات" span2><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <div className="table-wrap mt"><table className="tbl compact">
        <thead><tr><th>الصنف</th>{kind === "IN" && <th>أو صنف جديد</th>}<th>الوحدة</th><th>الكمية</th>{kind === "IN" ? <th>القيمة التقديرية للوحدة</th> : <th>المتاح</th>}<th className="n">القيمة</th><th /></tr></thead>
        <tbody>{lines.map((l, i) => { const it = avail(l.itemId); return <tr key={i}>
          <td style={{ minWidth: 180 }}><Select value={l.itemId} onChange={(e) => { const x = avail(e.target.value); setLines(lines.map((y, j) => (j === i ? { ...y, itemId: e.target.value, unit: x?.unit || y.unit, name: "" } : y))); }}><option value="">{kind === "IN" ? "— صنف جديد —" : "— اختر —"}</option>{items.filter((x) => kind === "IN" || Number(x.qty) > 0).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></td>
          {kind === "IN" && <td><Input value={l.name} disabled={!!l.itemId} onChange={(e) => setL(i, "name", e.target.value)} placeholder="اسم الصنف" /></td>}
          <td><Input value={l.unit} disabled={!!l.itemId} onChange={(e) => setL(i, "unit", e.target.value)} style={{ width: 80 }} /></td>
          <td><NumInput value={l.qty} onChange={(e) => setL(i, "qty", e.target.value)} style={{ width: 90 }} /></td>
          {kind === "IN" ? <td><NumInput value={l.unitValue} onChange={(e) => setL(i, "unitValue", e.target.value)} style={{ width: 110 }} /></td> : <td className="num small">{it ? `${Number(it.qty)} ${it.unit}` : "—"}</td>}
          <td className="n"><Money v={kind === "IN" ? Number(l.qty || 0) * Number(l.unitValue || 0) : (it ? Number(it.avgValue) * Number(l.qty || 0) : 0)} /></td>
          <td><button className="btn sm ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button></td>
        </tr>; })}</tbody>
      </table></div>
      <button className="btn sm mt" onClick={() => setLines([...lines, { itemId: "", name: "", unit: "حبة", qty: "", unitValue: "" }])}>＋ صنف</button>
      <div className="alert info small mt">{kind === "IN" ? "القيد: من ح/ مخزون التبرعات العينية (110391) إلى ح/ تبرعات عينية (4308) بالقيمة التقديرية العادلة." : "القيد: من ح/ مساعدات عينية موزعة (5506) إلى ح/ مخزون التبرعات العينية بمتوسط قيمة الصنف."}</div>
    </Modal>
  );
}

// ─── volunteers ────────────────────────────────────────────────────────────
export function VolunteersPage() {
  const { can } = useCompanyContext();
  const { settings } = useCharity();
  const { data, loading, reload } = useFetch<any[]>("/charity/volunteers");
  const [text, setText] = useUrlSearch();
  const [edit, setEdit] = useState<any>(null);
  const [hrs, setHrs] = useState<any>(null);
  const [cert, setCert] = useState<any>(null);
  const rows = useMemo(() => (data || []).filter((r) => matches(r, text, ["code", "name", "phone", "idNo", "skills", "city"])), [data, text]);
  const s = useSorted(rows);
  const active = (data || []).filter((r) => r.status === "ACTIVE");
  return (
    <div className="card">
      <div className="card-h"><h3>المتطوعون</h3><div className="row">
        <button className="btn sm" onClick={() => setCert({ v: null })}>🖨 شهادة تطوع فارغة</button>
        <button className="btn sm" onClick={() => exportExcel(rows.map((r) => ({ الرمز: r.code, الاسم: r.name, الهوية: r.idNo, الجوال: r.phone, المدينة: r.city, المهارات: r.skills, "إجمالي الساعات": Number(r.hours), "ساعات السنة": Number(r.hoursYtd), "عدد المشاركات": r.sessions, "آخر مشاركة": fmtDate(r.lastDate), "المستحقات المصروفة": Number(r.paid), الحالة: r.status === "ACTIVE" ? "نشط" : "غير نشط" })), "المتطوعون")}>⬇ Excel</button>
        {can("payments.write") && <button className="btn primary" onClick={() => setEdit({})}>＋ متطوع</button>}
      </div></div>
      <div className="card-b">
        <div className="grid c3 mb">
          <div className="card kpi"><span className="label">المتطوعون النشطون</span><span className="value num">{active.length}</span><span className="icon">🙋</span></div>
          <div className="card kpi success"><span className="label">ساعات التطوع (هذه السنة)</span><span className="value num">{(data || []).reduce((a, r) => a + Number(r.hoursYtd), 0).toLocaleString("en-US")}</span><span className="sub">الإجمالي {(data || []).reduce((a, r) => a + Number(r.hours), 0).toLocaleString("en-US")} ساعة</span><span className="icon">⏱</span></div>
          <div className="card kpi info"><span className="label">مستحقات مصروفة للمتطوعين</span><span className="value"><Money v={(data || []).reduce((a, r) => a + Number(r.paid), 0)} /></span><span className="icon">💸</span></div>
        </div>
        <div className="toolbar"><SearchBox value={text} onChange={setText} placeholder="الاسم أو الجوال أو المهارة" /><FilterInfo shown={rows.length} total={data?.length || 0} active={!!text} onClear={() => setText("")} /></div>
      </div>
      {loading && !data ? <Loading /> : !rows.length ? <Empty text="لا يوجد متطوعون" /> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><Th k="code" s={s}>الرمز</Th><Th k="name" s={s}>الاسم</Th><Th k="phone" s={s}>الجوال</Th><Th k="skills" s={s}>المهارات</Th><Th k="hours" s={s} n>الساعات</Th><Th k="sessions" s={s} n>المشاركات</Th><Th k="lastDate" s={s}>آخر مشاركة</Th><th /></tr></thead>
          <tbody>{s.sorted.map((r: any) => <tr key={r.id} style={r.status !== "ACTIVE" ? { opacity: .6 } : undefined}>
            <td className="num">{r.code}</td><td><b>{r.name}</b><div className="small muted num">{r.idNo}</div></td><td className="num">{r.phone}</td><td className="small">{r.skills}</td>
            <td className="n"><b>{Number(r.hours)}</b><div className="small muted">هذه السنة {Number(r.hoursYtd)}</div></td><td className="n">{r.sessions}</td><td className="dt">{fmtDate(r.lastDate)}</td>
            <td className="row" style={{ gap: 4 }}>
              <button className="btn sm primary" onClick={() => setHrs(r)}>الساعات</button>
              <button className="btn sm" onClick={() => setCert({ v: r })}>🎖 شهادة</button>
              {r.phone && <a className="btn sm" target="_blank" rel="noreferrer" href={waLink(r.phone, `السلام عليكم ${r.name}،\nتشكر ${settings?.associationName} جهودكم التطوعية (${Number(r.hours)} ساعة). جزاكم الله خيراً.`)}>واتساب</a>}
              {can("payments.write") && <button className="btn sm ghost" onClick={() => setEdit(r)}>تعديل</button>}
            </td>
          </tr>)}</tbody>
        </table></div>
      )}
      {edit && <VolunteerModal init={edit} onClose={(ok) => { setEdit(null); if (ok) reload(); }} />}
      {hrs && <HoursModal v={hrs} onClose={() => { setHrs(null); reload(); }} />}
      {cert && <CertModal v={cert.v} onClose={() => setCert(null)} />}
    </div>
  );
}

function VolunteerModal({ init, onClose }: { init: any; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ name: init.name || "", idNo: init.idNo || "", phone: init.phone || "", email: init.email || "", city: init.city || "", skills: init.skills || "", status: init.status || "ACTIVE", joinedAt: fmtDate(init.joinedAt) || today(), notes: init.notes || "" });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={init.id ? `تعديل ${init.name}` : "متطوع جديد"} onClose={() => onClose()} footer={<><button className="btn primary" disabled={busy} onClick={() => run(async () => { if (init.id) await api(`/charity/volunteers/${init.id}`, { method: "PUT", body: f }); else await api("/charity/volunteers", { body: f }); onClose(true); }, "تم الحفظ")}>حفظ</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <div className="grid c2">
        <Field label="الاسم رباعياً" span2><Input value={f.name} onChange={set("name")} /></Field>
        <Field label="رقم الهوية"><Input value={f.idNo} onChange={set("idNo")} dir="ltr" /></Field>
        <Field label="الجوال"><Input value={f.phone} onChange={set("phone")} dir="ltr" /></Field>
        <Field label="البريد"><Input value={f.email} onChange={set("email")} dir="ltr" /></Field>
        <Field label="المدينة"><Input value={f.city} onChange={set("city")} /></Field>
        <Field label="المهارات" span2><Input value={f.skills} onChange={set("skills")} placeholder="إسعافات أولية، تصوير، تنظيم فعاليات…" /></Field>
        <Field label="تاريخ الانضمام"><Input type="date" value={f.joinedAt} onChange={set("joinedAt")} /></Field>
        <Field label="الحالة"><Select value={f.status} onChange={set("status")}><option value="ACTIVE">نشط</option><option value="INACTIVE">غير نشط</option></Select></Field>
      </div>
    </Modal>
  );
}

function HoursModal({ v, onClose }: { v: any; onClose: () => void }) {
  const { run, busy } = useAction();
  const { data, reload } = useFetch<any[]>(`/charity/volunteers/${v.id}/hours`);
  const [f, setF] = useState<any>({ date: today(), hours: "", program: "", projectId: "", task: "" });
  const total = (data || []).reduce((a, r) => a + Number(r.hours), 0);
  return (
    <Modal title={`ساعات التطوع — ${v.name}`} wide onClose={onClose}>
      <div className="grid c4">
        <Field label="التاريخ"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="عدد الساعات"><NumInput value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></Field>
        <Field label="البرنامج / المبادرة"><Input value={f.program} onChange={(e) => setF({ ...f, program: e.target.value })} /></Field>
        <Field label="المشروع"><ProjectSelect value={f.projectId} onChange={(x) => setF({ ...f, projectId: x })} /></Field>
        <Field label="المهمة" span3><Input value={f.task} onChange={(e) => setF({ ...f, task: e.target.value })} /></Field>
        <Field label=" "><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api("/charity/volunteer-hours", { body: { ...f, volunteerId: v.id } }); setF({ ...f, hours: "", task: "" }); reload(); }, "تمت الإضافة")}>＋ تسجيل</button></Field>
      </div>
      <div className="table-wrap mt"><table className="tbl compact"><thead><tr><th>التاريخ</th><th>البرنامج</th><th>المهمة</th><th className="n">الساعات</th><th>اعتمدها</th><th /></tr></thead>
        <tbody>{(data || []).map((h) => <tr key={h.id}><td className="dt">{fmtDate(h.date)}</td><td>{h.program || h.projectName}</td><td>{h.task}</td><td className="n">{Number(h.hours)}</td><td className="small muted">{h.approvedBy}</td><td><button className="btn sm ghost" onClick={() => confirmDlg("حذف السجل؟") && api(`/charity/volunteer-hours/${h.id}`, { method: "DELETE" }).then(reload)}>✕</button></td></tr>)}</tbody>
        <tfoot><tr><td colSpan={3}>الإجمالي</td><td className="n">{total}</td><td colSpan={2} /></tr></tfoot></table></div>
    </Modal>
  );
}

function CertModal({ v, onClose }: { v: any; onClose: () => void }) {
  const { settings } = useCharity();
  const [hours, setHours] = useState<any[] | null>(null);
  React.useEffect(() => { if (v) api(`/charity/volunteers/${v.id}/hours`).then(setHours); }, [v?.id]);
  if (!v) return <PrintModal tplKey="volunteerCert" data={{}} settings={settings} onClose={onClose} />;
  if (!hours) return null;
  const dates = hours.map((h) => fmtDate(h.date)).sort();
  const programs = [...new Set(hours.map((h) => h.program || h.projectName).filter(Boolean))].join("، ");
  const period = dates.length ? `من ${dates[0]} إلى ${dates[dates.length - 1]}` : "";
  return <PrintModal tplKey="volunteerCert" data={volunteerCertData(v, period, programs)} settings={settings} onClose={onClose} />;
}

