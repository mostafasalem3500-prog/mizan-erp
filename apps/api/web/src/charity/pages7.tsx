/** Governance (meetings & decisions), grants from donor entities, the financial authority matrix, and the non-profit statements. */
import React, { useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, q, useFetch, Money, money, Loading, Empty, Badge, Modal, Field, Input, NumInput, Picker, useAction, useCompanyContext, today, fmtDate, Tabs, PeriodFilter, yearStart, exportExcel, PdfBtn } from "../lib";
import { CFG } from "../shared/country";
import { useCharity } from "./ctx";
import { printA4 } from "./templates";

const MK: Record<string, string> = { BOARD: "مجلس الإدارة", GA: "الجمعية العمومية العادية", EGA: "الجمعية العمومية غير العادية", COMMITTEE: "لجنة" };
const DC: Record<string, string> = { FINANCIAL: "مالي", PROGRAM: "برامج ومشاريع", ADMIN: "إداري", HR: "موارد بشرية", OTHER: "أخرى" };
const DS: Record<string, string> = { OPEN: "قيد التنفيذ", DONE: "منفَّذ", CANCELLED: "ملغى" };
const donorFetcher = (s: string) => api(`/charity/donors${q({ q: s, limit: 20 })}`);

// ─── governance ────────────────────────────────────────────────────────────
export function GovernancePage() {
  const loc = useLocation();
  const [tab, setTab] = useState(new URLSearchParams(loc.search).get("tab") || "meetings");
  return <>
    <Tabs tabs={[{ key: "meetings", label: "الاجتماعات والمحاضر" }, { key: "decisions", label: "سجل القرارات ومتابعتها" }, { key: "authority", label: "لائحة الصلاحيات المالية" }]} value={tab} onChange={setTab} />
    <div className="mt">{tab === "meetings" ? <Meetings /> : tab === "decisions" ? <Decisions /> : <AuthorityCard />}</div>
  </>;
}

function Meetings() {
  const { data, loading, reload } = useFetch<any[]>("/charity/meetings");
  const { can } = useCompanyContext();
  const [edit, setEdit] = useState<any>(null);
  const [view, setView] = useState<any>(null);
  return <div className="card">
    <div className="card-h"><h3>اجتماعات مجلس الإدارة والجمعية العمومية</h3>{can("payments.write") && <button className="btn primary" onClick={() => setEdit({})}>＋ اجتماع جديد</button>}</div>
    {loading && !data ? <Loading /> : !data?.length ? <Empty text="لا توجد اجتماعات مسجلة" /> : <div className="table-wrap"><table className="tbl">
      <thead><tr><th>الرقم</th><th>التاريخ</th><th>الجهة</th><th>النصاب</th><th className="n">القرارات</th><th>المحضر</th><th /></tr></thead>
      <tbody>{data.map((m) => <tr key={m.id}>
        <td className="num">{m.number}</td><td className="dt">{fmtDate(m.date)}</td><td><b>{MK[m.kind]}</b>{m.title && <div className="small muted">{m.title}</div>}</td>
        <td>{m.quorum.present} من {m.quorum.total} <span className={"badge " + (m.quorum.ok ? "green" : "red")}>{m.quorum.ok ? "مكتمل" : "غير مكتمل"}</span></td>
        <td className="n num">{m.decisions}</td><td><Badge s={m.status} map={{ DRAFT: "مسودة", APPROVED: "معتمد" }} /></td>
        <td className="row" style={{ gap: 4 }}><button className="btn sm" onClick={() => setView(m)}>🖨 المحضر</button>{can("payments.write") && m.status !== "APPROVED" && <button className="btn sm ghost" onClick={() => setEdit(m)}>تعديل</button>}</td>
      </tr>)}</tbody></table></div>}
    {edit && <MeetingModal init={edit} onClose={(ok) => { setEdit(null); if (ok) reload(); }} />}
    {view && <MinutesModal m={view} onClose={() => setView(null)} />}
  </div>;
}

function MeetingModal({ init, onClose }: { init: any; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ kind: init.kind || "BOARD", title: init.title || "", date: init.date ? String(init.date).slice(0, 10) : today(), location: init.location || "", membersTotal: init.membersTotal || "", agenda: init.agenda || "", minutes: init.minutes || "" });
  const [att, setAtt] = useState<any[]>(init.attendees?.length ? init.attendees : [{ name: "", role: "رئيس المجلس", present: true }]);
  const [noQ, setNoQ] = useState("");
  const present = att.filter((a) => a.name && a.present).length, total = Number(f.membersTotal) || att.filter((a) => a.name).length;
  const ok = total > 0 && present > total / 2;
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const save = (approve?: boolean) => run(async () => { const body = { ...f, attendees: att, ...(approve ? { status: "APPROVED", noQuorumNote: noQ || undefined } : {}) }; if (init.id) await api(`/charity/meetings/${init.id}`, { method: "PUT", body }); else { const r = await api("/charity/meetings", { body }); if (approve) await api(`/charity/meetings/${r.id}`, { method: "PUT", body }); } onClose(true); }, approve ? "اعتُمد المحضر" : "تم الحفظ");
  return <Modal wide title={init.id ? `تعديل الاجتماع ${init.number}` : "اجتماع جديد"} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn" disabled={busy} onClick={() => save()}>حفظ مسودة</button><button className="btn primary" disabled={busy || (!ok && !noQ.trim())} onClick={() => save(true)}>اعتماد المحضر</button></>}>
    <div className="grid c3">
      <Field label="الجهة"><select className="input" value={f.kind} onChange={set("kind")}>{Object.entries(MK).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="التاريخ"><Input type="date" value={f.date} onChange={set("date")} /></Field>
      <Field label="عدد الأعضاء الكلي" hint="لحساب النصاب"><NumInput value={f.membersTotal} onChange={set("membersTotal")} /></Field>
      <Field label="العنوان" span2><Input value={f.title} onChange={set("title")} /></Field>
      <Field label="المكان"><Input value={f.location} onChange={set("location")} /></Field>
    </div>
    <h4 className="mt mb">الحضور <span className={"badge " + (ok ? "green" : "red")}>{present} من {total} — {ok ? "النصاب مكتمل" : "النصاب غير مكتمل"}</span></h4>
    <table className="tbl compact"><thead><tr><th>الاسم</th><th>الصفة</th><th>حاضر</th><th /></tr></thead><tbody>
      {att.map((a, i) => <tr key={i}><td><Input value={a.name} onChange={(e: any) => setAtt(att.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></td><td><Input value={a.role || ""} onChange={(e: any) => setAtt(att.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} /></td><td><input type="checkbox" checked={a.present !== false} onChange={(e) => setAtt(att.map((x, j) => (j === i ? { ...x, present: e.target.checked } : x)))} aria-label="حاضر" /></td><td><button className="btn ghost sm" onClick={() => setAtt(att.filter((_, j) => j !== i))}>✕</button></td></tr>)}
    </tbody></table>
    <button className="btn sm mt" onClick={() => setAtt([...att, { name: "", role: "عضو", present: true }])}>＋ عضو</button>
    <div className="grid mt">
      <Field label="جدول الأعمال"><textarea className="input" rows={3} value={f.agenda} onChange={set("agenda")} /></Field>
      <Field label="المحضر (ما دار في الاجتماع)"><textarea className="input" rows={5} value={f.minutes} onChange={set("minutes")} /></Field>
      {!ok && <Field label="سبب اعتماد المحضر دون نصاب (اجتماع ثانٍ مثلاً)"><Input value={noQ} onChange={(e: any) => setNoQ(e.target.value)} /></Field>}
    </div>
    <div className="small muted mt">القرارات تُضاف من «سجل القرارات» وتُربط بهذا الاجتماع، فتظهر في محضره المطبوع.</div>
  </Modal>;
}

function MinutesModal({ m, onClose }: { m: any; onClose: () => void }) {
  const { settings } = useCharity();
  const dec = useFetch<any[]>(`/charity/decisions?meetingId=${m.id}`);
  const ref = useRef<HTMLDivElement>(null);
  return <Modal wide title={`محضر ${MK[m.kind]} رقم ${m.number}`} onClose={onClose} footer={<><button className="btn primary" onClick={() => ref.current && printA4(ref.current)}>🖨 طباعة A4</button><PdfBtn className="btn" name={`محضر ${m.number}`} /><button className="btn" onClick={onClose}>إغلاق</button></>}>
    <div ref={ref} className="print-doc" style={{ padding: 8 }}>
      <div className="row between mb"><div><b style={{ fontSize: 17 }}>{settings?.associationName}</b><div className="small muted">ترخيص رقم {settings?.licenseNo}</div></div>{settings?.logoUrl && <img src={settings.logoUrl} alt="" style={{ width: 64, height: 64, objectFit: "contain" }} />}</div>
      <h3 style={{ textAlign: "center" }}>محضر اجتماع {MK[m.kind]} رقم {m.number}</h3>
      <p>عُقد بتاريخ {fmtDate(m.date)}{m.location ? ` في ${m.location}` : ""}، بحضور {m.quorum.present} من أصل {m.quorum.total} عضواً ({m.quorum.ok ? "النصاب مكتمل" : "النصاب غير مكتمل"}).</p>
      {m.agenda && <><b>جدول الأعمال:</b><p style={{ whiteSpace: "pre-wrap" }}>{m.agenda}</p></>}
      {m.minutes && <><b>المداولات:</b><p style={{ whiteSpace: "pre-wrap" }}>{m.minutes}</p></>}
      <b>القرارات:</b>
      {!dec.data?.length ? <p className="muted">—</p> : <ol>{dec.data.map((d) => <li key={d.id}><b>{d.number}:</b> {d.text}{d.amount ? ` (بمبلغ ${money(d.amount)} ${CFG.words.one})` : ""}{d.owner ? ` — المكلّف: ${d.owner}` : ""}{d.dueDate ? ` — المدة: ${fmtDate(d.dueDate)}` : ""}</li>)}</ol>}
      <table className="tbl compact mt"><thead><tr><th>الاسم</th><th>الصفة</th><th>الحضور</th><th>التوقيع</th></tr></thead><tbody>{(m.attendees || []).map((a: any, i: number) => <tr key={i}><td>{a.name}</td><td>{a.role}</td><td>{a.present !== false ? "حاضر" : "معتذر"}</td><td style={{ width: 140 }} /></tr>)}</tbody></table>
    </div>
  </Modal>;
}

function Decisions() {
  const [st, setSt] = useState("");
  const { data, loading, reload } = useFetch<any[]>(`/charity/decisions${q({ status: st })}`);
  const { can } = useCompanyContext();
  const [edit, setEdit] = useState<any>(null);
  return <div className="card">
    <div className="card-h"><h3>سجل القرارات</h3><div className="row"><select className="input" style={{ width: 150 }} value={st} onChange={(e) => setSt(e.target.value)}><option value="">كل القرارات</option>{Object.entries(DS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <button className="btn sm" onClick={() => exportExcel((data || []).map((d) => ({ الرقم: d.number, التاريخ: fmtDate(d.date), الاجتماع: d.meetingNumber, التصنيف: DC[d.category], القرار: d.text, المبلغ: d.amount ? Number(d.amount) : "", المكلف: d.owner, "موعد التنفيذ": fmtDate(d.dueDate), الحالة: DS[d.status] })), "سجل-القرارات")}>⬇ Excel</button>
      {can("payments.write") && <button className="btn primary" onClick={() => setEdit({})}>＋ قرار</button>}</div></div>
    {loading && !data ? <Loading /> : !data?.length ? <Empty text="لا توجد قرارات" /> : <div className="table-wrap"><table className="tbl">
      <thead><tr><th>الرقم</th><th>التاريخ</th><th>القرار</th><th className="n">المبلغ</th><th>المكلّف / الموعد</th><th>الحالة</th><th /></tr></thead>
      <tbody>{data.map((d) => <tr key={d.id} style={d.status === "CANCELLED" ? { opacity: .55 } : undefined}>
        <td className="num">{d.number}<div className="small muted">{d.meetingNumber || ""}</div></td><td className="dt">{fmtDate(d.date)}</td>
        <td><b>{d.text}</b><div className="small muted">{DC[d.category]}{d.projectName ? ` · ${d.projectName}` : ""}{d.requests ? ` · ${d.requests} طلب صرف` : ""}</div></td>
        <td className="n">{d.amount ? <Money v={d.amount} /> : ""}</td>
        <td className="small">{d.owner || "—"}<div className={d.overdue ? "" : "muted"} style={d.overdue ? { color: "var(--danger-ink)" } : undefined}>{d.dueDate ? fmtDate(d.dueDate) : ""}{d.overdue ? " — متأخر" : ""}</div></td>
        <td><Badge s={d.status} map={DS} />{d.doneNote && <div className="small muted">{d.doneNote}</div>}</td>
        <td className="row" style={{ gap: 4 }}>{can("payments.write") && d.status === "OPEN" && <button className="btn sm" onClick={() => setEdit({ ...d, markDone: true })}>✓ تم التنفيذ</button>}{can("payments.write") && <button className="btn sm ghost" onClick={() => setEdit(d)}>تعديل</button>}</td>
      </tr>)}</tbody></table></div>}
    {edit && <DecisionModal init={edit} onClose={(ok) => { setEdit(null); if (ok) reload(); }} />}
  </div>;
}

function DecisionModal({ init, onClose }: { init: any; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const { projects } = useCharity();
  const meetings = useFetch<any[]>("/charity/meetings");
  const [f, setF] = useState<any>({ meetingId: init.meetingId || "", number: init.number || "", date: init.date ? String(init.date).slice(0, 10) : "", text: init.text || "", category: init.category || "ADMIN", amount: init.amount ?? "", projectId: init.projectId || "", owner: init.owner || "", dueDate: init.dueDate ? String(init.dueDate).slice(0, 10) : "", status: init.markDone ? "DONE" : init.status || "OPEN", doneNote: init.doneNote || "" });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return <Modal title={init.markDone ? `تنفيذ القرار ${init.number}` : init.id ? `تعديل القرار ${init.number}` : "قرار جديد"} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !f.text.trim()} onClick={() => run(async () => { if (init.id) await api(`/charity/decisions/${init.id}`, { method: "PUT", body: f }); else await api("/charity/decisions", { body: f }); onClose(true); }, "تم الحفظ")}>حفظ</button></>}>
    <div className="grid c2">
      {!init.markDone && <>
        <Field label="الاجتماع"><select className="input" value={f.meetingId} onChange={set("meetingId")}><option value="">— قرار بالتمرير (دون اجتماع) —</option>{(meetings.data || []).map((m) => <option key={m.id} value={m.id}>{m.number} — {MK[m.kind]} {fmtDate(m.date)}</option>)}</select></Field>
        <Field label="رقم القرار" hint="فارغ = تلقائي"><Input value={f.number} onChange={set("number")} disabled={!!init.id} /></Field>
        <Field label="نص القرار" span2><textarea className="input" rows={3} value={f.text} onChange={set("text")} /></Field>
        <Field label="التصنيف"><select className="input" value={f.category} onChange={set("category")}>{Object.entries(DC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label={`المبلغ المعتمد (${CFG.words.one})`}><NumInput value={f.amount} onChange={set("amount")} /></Field>
        <Field label="المشروع / البرنامج"><select className="input" value={f.projectId} onChange={set("projectId")}><option value="">—</option>{projects.map((p: any) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>
        <Field label="المكلّف بالتنفيذ"><Input value={f.owner} onChange={set("owner")} /></Field>
        <Field label="موعد التنفيذ"><Input type="date" value={f.dueDate} onChange={set("dueDate")} /></Field>
        <Field label="الحالة"><select className="input" value={f.status} onChange={set("status")}>{Object.entries(DS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      </>}
      {f.status === "DONE" && <Field label="ما تم تنفيذه" span2><Input value={f.doneNote} onChange={set("doneNote")} /></Field>}
    </div>
  </Modal>;
}

/** The authority matrix: who approves what amount, and the ceiling for paying without a request. */
export function AuthorityCard() {
  const { data, reload } = useFetch<any>("/charity/authority");
  const { me } = useCompanyContext() as any;
  const owner = me?.superAdmin || ["OWNER", "ADMIN"].includes(me?.role);
  const { run, busy } = useAction();
  const [f, setF] = useState<any>(null);
  const c = f || data;
  if (!c) return <Loading />;
  const setL = (i: number, k: string, v: any) => setF({ ...c, levels: c.levels.map((l: any, j: number) => (j === i ? { ...l, [k]: v } : l)) });
  return <div className="card"><div className="card-h"><h3>لائحة الصلاحيات المالية</h3><span className="small muted">تُطبَّق على اعتماد طلبات الصرف وعلى الصرف المباشر</span></div><div className="card-b">
    <div className="grid c3 mb">
      <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={c.enabled} disabled={!owner} onChange={(e) => setF({ ...c, enabled: e.target.checked })} />تفعيل لائحة الصلاحيات</label>
      <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={c.separation} disabled={!owner} onChange={(e) => setF({ ...c, separation: e.target.checked })} />فصل المهام: مقدّم الطلب لا يعتمده</label>
      <Field label={`حد الصرف المباشر دون طلب صرف (${CFG.words.one})`}><NumInput value={c.directLimit} disabled={!owner} onChange={(e: any) => setF({ ...c, directLimit: e.target.value })} /></Field>
    </div>
    <table className="tbl compact"><thead><tr><th>حتى مبلغ</th><th>صاحب الصلاحية</th><th>عدد المعتمدين</th><th>يلزم قرار مجلس</th>{owner && <th />}</tr></thead><tbody>
      {c.levels.map((l: any, i: number) => <tr key={i}>
        <td><NumInput value={l.upTo ?? ""} placeholder="بلا حد أعلى" disabled={!owner} onChange={(e: any) => setL(i, "upTo", e.target.value === "" ? null : e.target.value)} /></td>
        <td><Input value={l.title} disabled={!owner} onChange={(e: any) => setL(i, "title", e.target.value)} /></td>
        <td><NumInput value={l.approvals} disabled={!owner} onChange={(e: any) => setL(i, "approvals", e.target.value)} /></td>
        <td><input type="checkbox" checked={l.decision} disabled={!owner} onChange={(e) => setL(i, "decision", e.target.checked)} aria-label="يلزم قرار" /></td>
        {owner && <td><button className="btn ghost sm" onClick={() => setF({ ...c, levels: c.levels.filter((_: any, j: number) => j !== i) })}>✕</button></td>}
      </tr>)}
    </tbody></table>
    {owner && <div className="row mt"><button className="btn sm" onClick={() => setF({ ...c, levels: [...c.levels.slice(0, -1), { upTo: "", title: "", approvals: 1, decision: false }, ...c.levels.slice(-1)] })}>＋ مستوى</button><div className="grow" /><button className="btn primary" disabled={busy || !f} onClick={() => run(async () => { await api("/charity/authority", { method: "PUT", body: c }); setF(null); reload(); }, "حُفظت لائحة الصلاحيات")}>حفظ اللائحة</button></div>}
    <div className="alert info small mt">كل طلب صرف يحتاج عدد المعتمدين في مستواه (معتمدين مختلفين)، والمستوى الذي يلزمه قرار لا يكتمل اعتماده إلا بربط قرار من «سجل القرارات». الصرف المباشر فوق الحد يُرفض ويلزمه طلب صرف معتمد. {!owner && "تعديل اللائحة للمالك أو المدير."}</div>
  </div></div>;
}

// ─── grants ────────────────────────────────────────────────────────────────
const TS: Record<string, string> = { RECEIVED: "مستلمة", PARTIAL: "جزئية", OVERDUE: "متأخرة", PENDING: "قادمة" };
const RS: Record<string, string> = { SUBMITTED: "سُلِّم", OVERDUE: "متأخر", SOON: "مستحق قريباً", PENDING: "قادم" };
const TC: Record<string, string> = { RECEIVED: "green", PARTIAL: "amber", OVERDUE: "red", PENDING: "gray", SUBMITTED: "green", SOON: "amber" };
export function GrantsPage() {
  const { data, loading, reload } = useFetch<any[]>("/charity/grants");
  const { can } = useCompanyContext();
  const [edit, setEdit] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  const tot = useMemo(() => (data || []).filter((g) => g.status === "ACTIVE").reduce((a, g) => ({ amount: a.amount + g.amount, received: a.received + g.received }), { amount: 0, received: 0 }), [data]);
  return <>
    <div className="kpis mb">
      <div className="card kpi"><span className="label">المنح النشطة</span><span className="value"><Money v={tot.amount} /></span><span className="sub">{(data || []).filter((g) => g.status === "ACTIVE").length} اتفاقية</span></div>
      <div className="card kpi"><span className="label">المستلم منها</span><span className="value"><Money v={tot.received} /></span></div>
      <div className="card kpi"><span className="label">المتبقي لدى المانحين</span><span className="value"><Money v={tot.amount - tot.received} /></span></div>
    </div>
    <div className="card"><div className="card-h"><h3>المنح واتفاقيات الجهات المانحة</h3>{can("payments.write") && <button className="btn primary" onClick={() => setEdit({})}>＋ منحة / اتفاقية</button>}</div>
      {loading && !data ? <Loading /> : !data?.length ? <Empty text="لا توجد منح مسجلة" /> : <div className="table-wrap"><table className="tbl">
        <thead><tr><th>الرقم</th><th>المنحة والجهة</th><th>المشروع</th><th className="n">القيمة</th><th className="n">المستلم</th><th>الدفعات</th><th>التقارير</th><th /></tr></thead>
        <tbody>{data.map((g) => <React.Fragment key={g.id}><tr style={g.status !== "ACTIVE" ? { opacity: .6 } : undefined}>
          <td className="num">{g.number}</td><td><b>{g.title}</b><div className="small muted">{g.grantorName}{g.agreementNo ? ` · ${g.agreementNo}` : ""}</div></td><td className="small">{g.projectName || "—"}</td>
          <td className="n"><Money v={g.amount} /></td><td className="n"><Money v={g.received} /><div className="small muted">{g.pct}%</div></td>
          <td>{g.overdueTranches ? <span className="badge red">{g.overdueTranches} متأخرة</span> : <span className="small muted">{g.tranches.filter((x: any) => x.status === "RECEIVED").length}/{g.tranches.length}</span>}</td>
          <td>{g.dueReports ? <span className="badge amber">{g.dueReports} مستحق</span> : <span className="small muted">{g.reports.filter((x: any) => x.submittedAt).length}/{g.reports.length}</span>}</td>
          <td className="row" style={{ gap: 4 }}><button className="btn sm" onClick={() => setOpen(open === g.id ? null : g.id)}>{open === g.id ? "إخفاء" : "التفاصيل"}</button>{can("payments.write") && <button className="btn sm ghost" onClick={() => setEdit(g)}>تعديل</button>}</td>
        </tr>
        {open === g.id && <tr><td colSpan={8}><div className="grid c2">
          <table className="tbl compact"><thead><tr><th>استحقاق الدفعة</th><th className="n">المبلغ</th><th className="n">المستلم</th><th>الحالة</th></tr></thead><tbody>{g.tranches.map((x: any, i: number) => <tr key={i}><td>{x.dueDate ? fmtDate(x.dueDate) : "—"}</td><td className="n"><Money v={x.amount} /></td><td className="n"><Money v={x.received} /></td><td><span className={"badge " + TC[x.status]}>{TS[x.status]}</span></td></tr>)}</tbody></table>
          <table className="tbl compact"><thead><tr><th>التقرير للمانح</th><th>الموعد</th><th>الحالة</th></tr></thead><tbody>{g.reports.map((x: any, i: number) => <tr key={i}><td>{x.title}</td><td>{x.dueDate ? fmtDate(x.dueDate) : "—"}</td><td><span className={"badge " + TC[x.status]}>{RS[x.status]}{x.submittedAt ? ` ${fmtDate(x.submittedAt)}` : ""}</span></td></tr>)}</tbody></table>
        </div><div className="small muted mt">تُسجَّل الدفعات من «سندات القبض» باختيار المنحة، فتُحتسب هنا وتُقيد على مشروعها. المصروف على المشروع منذ بداية المنحة: <Money v={g.spent} />.</div></td></tr>}
        </React.Fragment>)}</tbody></table></div>}
      {edit && <GrantModal init={edit} onClose={(ok) => { setEdit(null); if (ok) reload(); }} />}
    </div>
  </>;
}

function GrantModal({ init, onClose }: { init: any; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const { projects } = useCharity();
  const [donor, setDonor] = useState<any>(init.partnerId ? { id: init.partnerId, code: "", name: init.grantorName } : null);
  const [f, setF] = useState<any>({ title: init.title || "", grantorName: init.grantorName || "", agreementNo: init.agreementNo || "", projectId: init.projectId || "", amount: init.amount ?? "", startDate: init.startDate ? String(init.startDate).slice(0, 10) : today(), endDate: init.endDate ? String(init.endDate).slice(0, 10) : "", status: init.status || "ACTIVE", notes: init.notes || "" });
  const [tr, setTr] = useState<any[]>((init.tranches || []).map((x: any) => ({ dueDate: x.dueDate || "", amount: x.amount })));
  const [rp, setRp] = useState<any[]>((init.reports || []).map((x: any) => ({ title: x.title, dueDate: x.dueDate || "", submittedAt: x.submittedAt || "" })));
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const trSum = tr.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const bad = tr.length > 0 && Math.abs(trSum - Number(f.amount)) > 0.01;
  return <Modal wide title={init.id ? `تعديل المنحة ${init.number}` : "منحة / اتفاقية جديدة"} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !f.title || !(Number(f.amount) > 0) || bad} onClick={() => run(async () => { const body = { ...f, partnerId: donor?.id, grantorName: f.grantorName || donor?.name, tranches: tr, reports: rp }; if (init.id) await api(`/charity/grants/${init.id}`, { method: "PUT", body }); else await api("/charity/grants", { body }); onClose(true); }, "تم الحفظ")}>حفظ</button></>}>
    <div className="grid c3">
      <Field label="عنوان المنحة" span2><Input value={f.title} onChange={set("title")} /></Field>
      <Field label="رقم الاتفاقية"><Input value={f.agreementNo} onChange={set("agreementNo")} /></Field>
      <Field label="الجهة المانحة (من سجل المتبرعين)" span2><Picker value={donor} onChange={setDonor} fetcher={donorFetcher} label={(d: any) => `${d.code ? d.code + " — " : ""}${d.name}`} /></Field>
      <Field label="أو اسم الجهة"><Input value={f.grantorName} onChange={set("grantorName")} /></Field>
      <Field label="المشروع / البرنامج"><select className="input" value={f.projectId} onChange={set("projectId")}><option value="">—</option>{projects.filter((p: any) => p.status !== "CLOSED").map((p: any) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>
      <Field label={`قيمة المنحة (${CFG.words.one})`}><NumInput value={f.amount} onChange={set("amount")} /></Field>
      <Field label="الحالة"><select className="input" value={f.status} onChange={set("status")}><option value="ACTIVE">نشطة</option><option value="CLOSED">مُقفلة</option></select></Field>
      <Field label="من"><Input type="date" value={f.startDate} onChange={set("startDate")} /></Field>
      <Field label="إلى"><Input type="date" value={f.endDate} onChange={set("endDate")} /></Field>
    </div>
    <div className="grid c2 mt">
      <div><h4 className="mb">جدول الدفعات {bad && <span className="badge red">المجموع {money(trSum)} ≠ القيمة</span>}</h4>
        {tr.map((x, i) => <div key={i} className="row mb" style={{ gap: 6 }}><Input type="date" value={x.dueDate} onChange={(e: any) => setTr(tr.map((y, j) => (j === i ? { ...y, dueDate: e.target.value } : y)))} /><NumInput value={x.amount} placeholder="المبلغ" onChange={(e: any) => setTr(tr.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} /><button className="btn ghost sm" onClick={() => setTr(tr.filter((_, j) => j !== i))}>✕</button></div>)}
        <button className="btn sm" onClick={() => setTr([...tr, { dueDate: "", amount: "" }])}>＋ دفعة</button></div>
      <div><h4 className="mb">التقارير المطلوبة للمانح</h4>
        {rp.map((x, i) => <div key={i} className="row mb" style={{ gap: 6, flexWrap: "wrap" }}><Input value={x.title} placeholder="اسم التقرير" onChange={(e: any) => setRp(rp.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)))} style={{ flex: 2, minWidth: 140 }} /><Input type="date" value={x.dueDate} title="الموعد" onChange={(e: any) => setRp(rp.map((y, j) => (j === i ? { ...y, dueDate: e.target.value } : y)))} /><Input type="date" value={x.submittedAt} title="تاريخ التسليم" onChange={(e: any) => setRp(rp.map((y, j) => (j === i ? { ...y, submittedAt: e.target.value } : y)))} /><button className="btn ghost sm" onClick={() => setRp(rp.filter((_, j) => j !== i))}>✕</button></div>)}
        <button className="btn sm" onClick={() => setRp([...rp, { title: "", dueDate: "", submittedAt: "" }])}>＋ تقرير</button>
        <div className="small muted mt">الحقل الثاني موعد التقرير، والثالث تاريخ تسليمه فعلاً.</div></div>
    </div>
  </Modal>;
}

// ─── non-profit financial statements ───────────────────────────────────────
const FUND: Record<string, string> = { U: "غير مقيدة", R: "مقيدة", E: "أوقاف" };
export function NpoStatementsPage() {
  const { settings } = useCharity();
  const [f, setF] = useState({ from: yearStart(), to: today() });
  const { data, loading } = useFetch<any>(`/charity/npo-statements${q(f)}`);
  const ref = useRef<HTMLDivElement>(null);
  const showE = data && (Math.abs(data.columns.E.revenue) > 0 || Math.abs(data.closing.E) > 0);
  const keys = showE ? ["U", "R", "E"] : ["U", "R"];
  const tot = (o: any) => keys.reduce((a, k) => a + Number(o[k] || 0), 0);
  const row = (label: string, get: (k: string) => number, bold?: boolean) => <tr>{bold ? <th>{label}</th> : <td>{label}</td>}{keys.map((k) => <td key={k} className="n">{bold ? <b><Money v={get(k)} /></b> : <Money v={get(k)} blankZero />}</td>)}<td className="n"><b><Money v={keys.reduce((a, k) => a + get(k), 0)} /></b></td></tr>;
  return <>
    <div className="card mb"><div className="card-b toolbar"><PeriodFilter from={f.from} to={f.to} onChange={(a, b) => setF({ from: a, to: b })} /><div className="grow" /><button className="btn sm" onClick={() => ref.current && printA4(ref.current)}>🖨 طباعة</button><PdfBtn className="btn sm" name="قائمة الأنشطة" /></div></div>
    {loading && !data ? <Loading /> : data && <div ref={ref}>
      {data.warnings.map((w: string, i: number) => <div key={i} className="alert warn small mb">{w}</div>)}
      <div className="card mb"><div className="card-h"><h3>قائمة الأنشطة — {settings?.associationName}</h3><span className="small muted">للفترة {fmtDate(data.from)} — {fmtDate(data.to)} · وفق معيار المنشآت غير الهادفة للربح (صافي الأصول حسب القيود)</span></div>
        <div className="table-wrap"><table className="tbl compact"><thead><tr><th>البيان</th>{keys.map((k) => <th key={k} className="n">{FUND[k]}</th>)}<th className="n">الإجمالي</th></tr></thead><tbody>
          <tr><th colSpan={keys.length + 2}>الإيرادات والتبرعات</th></tr>
          {Array.from(new Set(data.revenues.map((r: any) => r.code))).map((code: any) => { const rs = data.revenues.filter((r: any) => r.code === code); return <tr key={code}><td>{code} {rs[0].name}</td>{keys.map((k) => <td key={k} className="n"><Money v={rs.filter((r: any) => r.fund === k).reduce((a: number, r: any) => a + r.amount, 0)} blankZero /></td>)}<td className="n"><Money v={rs.reduce((a: number, r: any) => a + r.amount, 0)} /></td></tr>; })}
          {row("صافي الأصول المحررة من القيود", (k) => data.columns[k].released)}
          {row("إجمالي الإيرادات والدعم", (k) => data.columns[k].revenue + data.columns[k].released, true)}
          <tr><th colSpan={keys.length + 2}>المصروفات</th></tr>
          {data.expenses.map((e: any) => <tr key={e.code}><td>{e.code} {e.name}{e.program && <span className="badge green" style={{ marginInlineStart: 4 }}>برامج</span>}</td><td className="n"><Money v={e.amount} /></td>{keys.slice(1).map((k) => <td key={k} />)}<td className="n"><Money v={e.amount} /></td></tr>)}
          {row("إجمالي المصروفات", (k) => data.columns[k].expenses, true)}
          {row("التغير في صافي الأصول", (k) => data.columns[k].change, true)}
          {row("صافي الأصول أول الفترة", (k) => data.opening[k])}
          {row("صافي الأصول آخر الفترة", (k) => data.closing[k], true)}
        </tbody></table></div></div>
      <div className="grid c2">
        <div className="card"><div className="card-h"><h3>صافي الأصول في قائمة المركز المالي</h3></div><div className="card-b"><table className="tbl compact"><tbody>
          <tr><td>إجمالي الأصول</td><td className="n"><Money v={data.position.totalAssets} /></td></tr>
          <tr><td>إجمالي الالتزامات</td><td className="n"><Money v={data.position.totalLiabilities} /></td></tr>
          {keys.map((k) => <tr key={k}><td>صافي الأصول {FUND[k]}</td><td className="n"><Money v={data.closing[k]} /></td></tr>)}
          <tr><th>إجمالي صافي الأصول</th><th className="n"><Money v={tot(data.closing)} /></th></tr>
          <tr><th>الالتزامات وصافي الأصول</th><th className="n"><Money v={data.position.totalLiabilities + tot(data.closing)} /> {Math.abs(data.position.totalLiabilities + tot(data.closing) - data.position.totalAssets) < 0.01 ? "✓" : "⚠"}</th></tr>
        </tbody></table></div></div>
        <div className="card"><div className="card-h"><h3>مؤشرات الإنفاق</h3></div><div className="card-b">
          <div className="kpis"><div className="card kpi"><span className="label">مصروفات البرامج</span><span className="value">{data.ratios.programPct}%</span></div><div className="card kpi"><span className="label">المصروفات الإدارية والعمومية</span><span className="value">{data.ratios.adminPct}%</span></div></div>
          <div className="small muted mt">التصنيف: إيرادات حساب «تبرعات مقيدة لمشاريع» والزكاة وما على مراكز تكلفة المشاريع المقيدة = مقيدة؛ برامج «الوقف» = أوقاف؛ غيرها غير مقيدة. المصروف على المشاريع المقيدة أو من صندوق الزكاة يُحرَّر من القيود.</div>
        </div></div>
      </div>
    </div>}
  </>;
}

/** Pick the board decision that authorises an operation above the authority limits. */
export function DecisionPickModal({ title, onPick, onClose }: { title: string; onPick: (id: string) => void; onClose: () => void }) {
  const { data } = useFetch<any[]>("/charity/decisions");
  const [id, setId] = useState("");
  const list = (data || []).filter((d) => d.status !== "CANCELLED");
  return <Modal narrow title={title} onClose={onClose} footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" disabled={!id} onClick={() => onPick(id)}>اعتماد بالقرار</button></>}>
    <div className="alert warn small mb">المبلغ يتجاوز حد الصرف المباشر في لائحة الصلاحيات — يلزم قرار اعتماد مسجّل.</div>
    {!data ? <Loading /> : !list.length ? <Empty text="لا توجد قرارات — سجّل القرار من «الحوكمة ← سجل القرارات»" /> : <Field label="القرار"><select className="input" value={id} onChange={(e) => setId(e.target.value)}><option value="">— اختر —</option>{list.map((d) => <option key={d.id} value={d.id}>{d.number} — {String(d.text).slice(0, 70)}{d.amount ? ` (${money(d.amount)})` : ""}</option>)}</select></Field>}
  </Modal>;
}

// ─── Salla donation store ───────────────────────────────────────────────────
const SRC_AR: Record<string, string> = { CASH_DONATION: "تبرع نقدي عام", SUPPORT: "دعم / منحة", PROGRAM: "إيرادات برامج", ZAKAT: "زكاة", MEMBERSHIP: "اشتراك عضوية", SPONSORSHIP: "كفالة", FOUNDING: "مساهمة تأسيسية", OTHER: "أخرى" };
const EV: Record<string, string> = { DONE: "green", FAILED: "red", IGNORED: "gray", PENDING: "amber" };
export function DonationStorePage() {
  const { data, loading, reload } = useFetch<any>("/charity/store");
  const { projects } = useCharity();
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const [f, setF] = useState<any>(null);
  const v = f || (data ? { mode: data.connection?.mode || "DONATIONS", enabled: data.connection?.enabled ?? true, secret: "", map: data.map } : null);
  if (loading && !data) return <Loading />;
  if (!v) return null;
  const set = (k: string, x: any) => setF({ ...v, [k]: x });
  const setMap = (k: string, x: any) => setF({ ...v, map: { ...v.map, [k]: x } });
  const setRule = (i: number, k: string, x: any) => setMap("rules", v.map.rules.map((r: any, j: number) => (j === i ? { ...r, [k]: x } : r)));
  const url = data?.connection ? `${location.origin}/api/hooks/salla/${data.connection.token}` : "";
  const write = can("settings.write");
  return <>
    <div className="kpis mb">
      <div className="card kpi"><span className="label">تبرعات المتجر</span><span className="value"><Money v={data.stats.total} /></span><span className="sub">{data.stats.receipts} سند · {data.stats.donors} متبرع</span></div>
      <div className="card kpi"><span className="label">حالة الربط</span><span className="value" style={{ fontSize: 18 }}>{!data.connected ? "غير مربوط" : data.connection.enabled ? (data.connection.mode === "DONATIONS" ? "متجر تبرعات ✓" : "متجر مبيعات") : "موقوف"}</span><span className="sub">{data.connection?.lastEventAt ? `آخر طلب ${fmtDate(data.connection.lastEventAt)}` : "لم يصل طلب بعد"}</span></div>
    </div>
    <div className="card mb"><div className="card-h"><h3>ربط متجر التبرعات في سلة</h3></div><div className="card-b grid">
      <div className="alert info small">كل طلب في متجر سلة يُسجَّل تلقائياً <b>سند قبض تبرع</b> (لا فاتورة مبيعات): من ح/ تسوية المتاجر الإلكترونية إلى ح/ التبرعات بحسب المنتج — والمتبرع يُضاف لسجل المتبرعين. الطلب الملغى أو المسترجع يُلغي سنده بقيد عكسي.</div>
      {url && <Field label="رابط الإشعارات (Webhook) — يُلصق في سلة: لوحة المتجر ← الإعدادات ← الربط والتطبيقات ← Webhooks، للأحداث order.created و order.status.updated و order.refunded"><div className="row"><input className="input" dir="ltr" readOnly value={url} onFocus={(e) => e.target.select()} /><button className="btn sm" onClick={() => navigator.clipboard?.writeText(url)}>نسخ</button></div></Field>}
      <div className="grid c3">
        <Field label="نوع المتجر"><select className="input" value={v.mode} disabled={!write} onChange={(e) => set("mode", e.target.value)}><option value="DONATIONS">متجر تبرعات (سندات قبض)</option><option value="SALES">متجر مبيعات (فواتير ضريبية)</option></select></Field>
        <Field label="المصدر الافتراضي"><select className="input" value={v.map.defaultSource} disabled={!write} onChange={(e) => setMap("defaultSource", e.target.value)}>{Object.entries(SRC_AR).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></Field>
        <Field label="المشروع الافتراضي"><select className="input" value={v.map.defaultProjectId || ""} disabled={!write} onChange={(e) => setMap("defaultProjectId", e.target.value || null)}><option value="">— تبرع عام —</option>{projects.filter((p: any) => p.status !== "CLOSED").map((p: any) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>
        <Field label="مفتاح التوقيع (Webhook Secret) — اختياري" hint={data.connection?.hasSecret ? "مضبوط — اتركه فارغاً لإبقائه" : "يتحقق من توقيع سلة"}><Input dir="ltr" value={v.secret} disabled={!write} onChange={(e: any) => set("secret", e.target.value)} /></Field>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={v.enabled} disabled={!write} onChange={(e) => set("enabled", e.target.checked)} />الربط مفعّل</label>
      </div>
      <h4>توجيه منتجات المتجر</h4>
      <table className="tbl compact"><thead><tr><th>رمز المنتج (SKU) أو جزء من اسمه</th><th>يُسجَّل على المشروع</th><th>المصدر</th>{write && <th />}</tr></thead><tbody>
        {v.map.rules.map((r: any, i: number) => <tr key={i}>
          <td><Input value={r.match} disabled={!write} placeholder="مثال: سلة غذائية" onChange={(e: any) => setRule(i, "match", e.target.value)} /></td>
          <td><select className="input" value={r.projectId || ""} disabled={!write} onChange={(e) => setRule(i, "projectId", e.target.value || null)}><option value="">— عام —</option>{projects.filter((p: any) => p.status !== "CLOSED").map((p: any) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></td>
          <td><select className="input" value={r.source || ""} disabled={!write} onChange={(e) => setRule(i, "source", e.target.value || null)}><option value="">— الافتراضي —</option>{Object.entries(SRC_AR).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></td>
          {write && <td><button className="btn ghost sm" onClick={() => setMap("rules", v.map.rules.filter((_: any, j: number) => j !== i))}>✕</button></td>}
        </tr>)}
      </tbody></table>
      {write && <div className="row"><button className="btn sm" onClick={() => setMap("rules", [...v.map.rules, { match: "", projectId: null, source: null }])}>＋ قاعدة</button><div className="grow" />
        {data.connected && data.connection.mode === "DONATIONS" && <button className="btn sm" disabled={busy} onClick={() => run(async () => { await api("/charity/store/sample", { body: {} }); reload(); }, "سُجّل طلب تبرع تجريبي")}>🧪 طلب تبرع تجريبي</button>}
        <button className="btn primary" disabled={busy} onClick={() => run(async () => { await api("/charity/store", { method: "PUT", body: { ...v, secret: v.secret || undefined } }); setF(null); reload(); }, data.connected ? "حُفظت الإعدادات" : "أُنشئ رابط الربط — الصقه في سلة")}>{data.connected ? "حفظ" : "إنشاء رابط الربط"}</button></div>}
      <div className="small muted">أول قاعدة تطابق رمز المنتج (أو بدايته مثل FOOD لـ FOOD-1) أو يظهر نصها في اسمه هي التي تُطبَّق. منتجات الزكاة اجعل مصدرها «زكاة» لتدخل صندوق الزكاة. الطلب التجريبي يُوسَم تجريبياً ويُحذف مع البيانات التجريبية.</div>
    </div></div>
    {data.connected && <StorePayouts data={data} reload={reload} />}
    <div className="card"><div className="card-h"><h3>آخر أحداث المتجر</h3></div>
      {!data.events.length ? <Empty text="لم يصل أي طلب بعد" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الوقت</th><th>الحدث</th><th>الطلب</th><th>النتيجة</th></tr></thead><tbody>
        {data.events.map((e: any) => <tr key={e.id}><td className="dt">{fmtDate(e.createdAt)}</td><td dir="ltr">{e.event}{e.isTest ? " (تجريبي)" : ""}</td><td className="num">{e.reference}</td><td><span className={"badge " + (EV[e.status] || "gray")}>{e.status}</span> <span className="small">{e.message}</span></td></tr>)}
      </tbody></table></div>}
    </div>
  </>;
}

// ─── integration audit: every association document ↔ its entry ↔ the ledger ─────
export function IntegrationAuditPage() {
  const { data, loading, reload } = useFetch<any>("/charity/integration-audit");
  const [open, setOpen] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const groups = Array.from(new Set(data.checks.map((c: any) => c.group))) as string[];
  return <>
    <div className="kpis mb">
      <div className="card kpi"><span className="label">النتيجة</span><span className="value" style={{ fontSize: 20, color: data.ok ? (data.warnings ? "#b54708" : "#067647") : "#b42318" }}>{data.ok ? (data.warnings ? `سليم مع ${data.warnings} ملاحظة` : "✔ الربط سليم") : `✖ ${data.errors} خلل`}</span><span className="sub">{data.checks.length} فحصاً · آخر فحص {new Date(data.at).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}</span></div>
      <div className="card kpi"><span className="label">المستندات المفحوصة</span><span className="value">{data.docs}</span><span className="sub">سندات الجمعية والعهد والعيني والأسهم</span></div>
      <div className="card kpi"><span className="label">القيود المرحّلة</span><span className="value">{data.entries}</span><span className="sub">في دفاتر النظام المحاسبي كلها</span></div>
    </div>
    <div className="alert info small mb">يفحص أن كل سند في نظام الجمعية له قيد واحد سارٍ بنفس المبلغ، وأن كل ملغى عُكس قيده، وأن لا قيود يتيمة، وأن ميزان المراجعة متوازن، وأن أرصدة الأستاذ تطابق السجلات (صندوق الزكاة، مخزون العيني، العهد، مراكز تكلفة المشاريع، رأس مال الأعضاء)، وأن كل سند — من الجمعية أو من البرنامج المحاسبي — حرّك الصندوق/البنك بمبلغه. اضغط على فحص فيه خلل لترى المستندات.</div>
    {groups.map((g) => <div key={g} className="card mb"><div className="card-h"><h3>{g}</h3></div>
      <div className="table-wrap"><table className="tbl compact"><tbody>
        {data.checks.filter((c: any) => c.group === g).map((c: any) => <React.Fragment key={c.key}>
          <tr style={{ cursor: c.items.length ? "pointer" : undefined }} onClick={() => c.items.length && setOpen(open === c.key ? null : c.key)}>
            <td style={{ width: 28 }}>{c.ok ? "✅" : c.level === "warn" ? "⚠️" : "❌"}</td>
            <td>{c.title}{c.note && !c.ok && <div className="small muted">{c.note}</div>}</td>
            <td className="num small">{c.expected !== undefined && c.expected !== null ? <>{c.labels?.[0] || "السجل"} <Money v={c.expected} /> · {c.labels?.[1] || "الأستاذ"} <Money v={c.actual} /></> : !c.ok ? `${c.count} مستند` : ""}</td>
          </tr>
          {open === c.key && <tr><td /><td colSpan={2}><table className="tbl compact"><thead><tr><th>النوع</th><th>الرقم</th><th>التاريخ</th><th>المشكلة</th></tr></thead><tbody>
            {c.items.map((i: any, k: number) => <tr key={k}><td>{i.type}</td><td><Link to={i.link}>{i.number}</Link></td><td className="dt">{i.date}</td><td>{i.issue}</td></tr>)}
          </tbody></table>{c.count > c.items.length && <div className="small muted">يُعرض أول {c.items.length} من {c.count}</div>}</td></tr>}
        </React.Fragment>)}
      </tbody></table></div></div>)}
    <div className="row"><button className="btn" onClick={reload}>↻ إعادة الفحص</button></div>
  </>;
}

/** Salla transfers what it collected to the bank less its commission: clearing account → bank, commission + VAT as expense. */
function StorePayouts({ data, reload }: { data: any; reload: () => void }) {
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ date: today(), net: "", fees: "", bankAccountId: "", reference: "" });
  const banks = useFetch<any>("/accounts").data;
  const list = (banks?.rows || banks || []).filter((a: any) => a.isCashBank && !a.isGroup && a.systemKey !== "ESTORE_CLEARING" && a.systemKey !== "CASH");
  const bal = data.clearing?.balance || 0;
  return <div className="card mb"><div className="card-h"><h3>تحويلات سلة إلى البنك</h3><span className="muted small">رصيد التسوية لدى سلة: <b><Money v={bal} /></b></span></div><div className="card-b grid">
    <div className="small muted">عند وصول تحويل من سلة: من ح/ البنك (الصافي) + ح/ عمولات المتاجر وضريبتها، إلى ح/ تسوية المتاجر الإلكترونية (الإجمالي). الرصيد الباقي هو ما لم تحوّله سلة بعد.</div>
    {can("payments.write") && <div className="grid c3">
      <Field label="التاريخ"><Input type="date" value={f.date} onChange={(e: any) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label="المبلغ الواصل للبنك"><NumInput value={f.net} onChange={(v: any) => setF({ ...f, net: v })} /></Field>
      <Field label="عمولة سلة (قبل الضريبة)"><NumInput value={f.fees} onChange={(v: any) => setF({ ...f, fees: v })} /></Field>
      <Field label="البنك المستلم"><select className="input" value={f.bankAccountId} onChange={(e) => setF({ ...f, bankAccountId: e.target.value })}><option value="">— اختر —</option>{list.map((a: any) => <option key={a.id} value={a.id}>{a.code} — {a.nameAr}</option>)}</select></Field>
      <Field label="مرجع التحويل"><Input value={f.reference} onChange={(e: any) => setF({ ...f, reference: e.target.value })} /></Field>
      <div className="row" style={{ alignItems: "end" }}><button className="btn primary" disabled={busy || !f.net || !f.bankAccountId} onClick={() => run(async () => { await api("/integrations/salla/payouts", { body: { ...f, fees: f.fees || 0 } }); setF({ ...f, net: "", fees: "", reference: "" }); reload(); }, "سُجّل التحويل")}>تسجيل التحويل</button></div>
    </div>}
    {!!data.payouts?.length && <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الرقم</th><th>التاريخ</th><th>الصافي</th><th>العمولة</th><th>ضريبتها</th><th>الإجمالي</th><th>البنك</th><th>القيد</th><th /></tr></thead><tbody>
      {data.payouts.map((p: any) => <tr key={p.id} className={p.status === "CANCELLED" ? "muted" : ""}><td>{p.number}</td><td className="dt">{fmtDate(p.date)}</td><td className="n"><Money v={p.net} /></td><td className="n"><Money v={p.fees} /></td><td className="n"><Money v={p.feeVat} /></td><td className="n"><b><Money v={p.gross} /></b></td><td>{p.bankName}</td><td>{p.journalNumber}</td>
        <td>{p.status === "POSTED" && can("payments.write") ? <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { await api(`/integrations/salla/payouts/${p.id}/cancel`, { body: {} }); reload(); }, "أُلغي التحويل وعُكس قيده")}>إلغاء</button> : p.status === "CANCELLED" ? "ملغى" : ""}</td></tr>)}
    </tbody></table></div>}
  </div></div>;
}
