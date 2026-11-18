/** Financial reviewer's notes: closing reminders & closing centre, supporting documents on vouchers, project budget table,
 *  final disbursement & project closing, daily archive and automatic daily backups. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, q, session, useFetch, Money, Loading, Empty, Badge, Modal, Field, Input, NumInput, Picker, accountFetcher, useAction, useCompanyContext, useToast, today, fmtDate, Tabs, confirmDlg } from "../lib";
import { Attachments } from "../pages/Round28";
import { useCharity } from "./ctx";

const WD = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const LV: Record<string, string> = { danger: "err", warn: "warn", info: "info" };
const expFetcher = accountFetcher((a) => a.type === "EXPENSE");
const cashFetcher = accountFetcher((a) => a.isCashBank);
const acLabel = (a: any) => `${a.code} — ${a.nameAr}`;
const benefFetcher = (s: string) => api(`/charity/beneficiaries${q({ q: s, limit: 20 })}`);
const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} م.ب` : `${Math.max(1, Math.round(n / 1024))} ك.ب`);

async function downloadAuth(url: string, name: string) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${session.token}` } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "تعذّر التنزيل");
  const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ─── 📎 supporting documents ───────────────────────────────────────────────
/** The 📎 icon on a voucher row: count of supporting files; opens upload / view. */
export function AttachIcon({ entity, row, title, onChanged }: { entity: "ch_disb" | "ch_rcpt" | "ch_req" | "payment" | "expense"; row: any; title?: string; onChanged?: () => void }) {
  const { can } = useCompanyContext();
  const [open, setOpen] = useState(false);
  const n = Number(row.attachCount ?? row.attachments ?? 0);
  const missing = !n && entity === "ch_disb" && row.status === "POSTED";
  return <>
    <button className={"btn sm" + (missing ? " warn-btn" : "")} title={n ? `${n} مسوغ مرفق` : "رفع مسوغات الصرف (فاتورة، إيصال، قرار، صورة هوية…)"} aria-label="مسوغات ومرفقات" onClick={() => setOpen(true)}>📎{n ? ` ${n}` : missing ? " ⚠" : ""}</button>
    {open && <Modal narrow title={title || `مسوغات ${row.number}`} onClose={() => { setOpen(false); onChanged?.(); }}><Attachments entity={entity} id={row.id} canWrite={can("payments.write")} /></Modal>}
  </>;
}

/** Files picked in a form before the voucher exists; uploaded right after it is saved. */
export function PendingFiles({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const inp = useRef<HTMLInputElement>(null);
  return <div className="attach" style={{ marginTop: 10 }}>
    <div className="row between"><b>📎 مسوغات الصرف {files.length ? `(${files.length})` : ""}</b><button type="button" className="btn sm" onClick={() => inp.current?.click()}>＋ رفع مسوغ</button><input ref={inp} type="file" multiple hidden accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => { if (e.target.files?.length) onChange([...files, ...(Array.from(e.target.files) as File[])].slice(0, 20)); e.target.value = ""; }} /></div>
    {!files.length ? <div className="muted small">فاتورة المورد، الإيصال، قرار الصرف، صورة الهوية… تُرفق بالسند فور حفظه (حتى 8 ميجابايت للملف)</div> : <div className="attach-list">{files.map((f, i) => <div key={i} className="attach-item"><span className="ic">📄</span><span>{f.name}</span><span className="muted small">{fmtSize(f.size)}</span><button type="button" className="btn ghost sm" onClick={() => onChange(files.filter((_, j) => j !== i))}>✕</button></div>)}</div>}
  </div>;
}
const readB64 = (file: File): Promise<string> => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
export async function uploadFiles(entity: string, id: string, files: File[]) {
  let ok = 0; const errs: string[] = [];
  for (const f of files) {
    if (f.size > 8 * 1024 * 1024) { errs.push(`${f.name}: أكبر من 8 م.ب`); continue; }
    try { await api(`/attachments/${entity}/${id}`, { body: { name: f.name, mime: f.type || "application/octet-stream", data: await readB64(f) } }); ok++; } catch (e: any) { errs.push(`${f.name}: ${e.message}`); }
  }
  return { ok, errs };
}

// ─── 🔔 closing reminders ──────────────────────────────────────────────────
/** Bell in the association's top bar: closing reminders and missing documents; a browser notification once a day when allowed. */
export function ClosingBell() {
  const { data, reload } = useFetch<any[]>("/charity/closing/alerts");
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => { const t = setInterval(reload, 5 * 60_000); return () => clearInterval(t); }, []);
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  const list = data || [];
  const urgent = list.filter((a) => a.level !== "info").length;
  useEffect(() => {
    if (!urgent || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const key = `mz-closing-notified-${today()}`;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); } catch { return; }
    try { new Notification("تنبيه التقفيل", { body: list.filter((a) => a.level !== "info").map((a) => a.title).join("\n"), icon: "/charity/logo-192.png", lang: "ar", dir: "rtl" }); } catch { /* not allowed here */ }
  }, [urgent]);
  return <div style={{ position: "relative" }}>
    <button className="btn sm" aria-label="تنبيهات التقفيل" title="تنبيهات التقفيل والمسوغات" onClick={() => setOpen((o) => !o)}>🔔{list.length ? <span className={"badge " + (urgent ? "red" : "blue")} style={{ marginInlineStart: 4 }}>{list.length}</span> : null}</button>
    {open && <div className="card bell-pop" role="dialog" aria-label="التنبيهات">
      <div className="card-h"><h3>التنبيهات</h3><Link className="btn sm" to="/charity/closing">مركز التقفيل</Link></div>
      <div className="card-b">{!list.length ? <div className="muted small">لا توجد تنبيهات — كل التقفيلات في موعدها ✓</div> : list.map((a, i) => <Link key={i} to={a.link} className={"alert small " + (LV[a.level] || "info")} style={{ display: "block", marginBottom: 6 }}><b>{a.title}</b><div>{a.detail}</div></Link>)}</div>
    </div>}
  </div>;
}

export function ClosingPage() {
  const loc = useLocation();
  const [tab, setTab] = useState(new URLSearchParams(loc.search).get("tab") || "weekly");
  const { data, loading, reload } = useFetch<any>("/charity/closing");
  const alerts = useFetch<any[]>("/charity/closing/alerts");
  const re = () => { reload(); alerts.reload(); };
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const due = { daily: data.daily.filter((d: any) => d.due).length, weekly: data.weeks.filter((w: any) => w.due).length, monthly: data.months.filter((m: any) => m.due).length };
  return <>
    {!!alerts.data?.length && <div className="mb">{alerts.data.map((a, i) => <Link key={i} to={a.link} className={"alert small " + (LV[a.level] || "info")} style={{ display: "block", marginBottom: 6 }}><b>{a.title}</b> — {a.detail}</Link>)}</div>}
    <Tabs tabs={[{ key: "daily", label: `اليومي${due.daily ? ` (${due.daily})` : ""}` }, { key: "weekly", label: `الأسبوعي${due.weekly ? ` (${due.weekly})` : ""}` }, { key: "monthly", label: `الشهري${due.monthly ? ` (${due.monthly})` : ""}` }, { key: "settings", label: "إعدادات التنبيه" }]} value={tab} onChange={setTab} />
    <div className="mt">
      {tab === "daily" && <div className="card"><div className="card-h"><h3>التقفيل اليومي — إقفال صندوق التحصيل</h3><Link className="btn sm primary" to="/charity/daily">فتح إقفال اليوم</Link></div>
        <div className="table-wrap"><table className="tbl"><thead><tr><th>اليوم</th><th className="n">التحصيل النقدي</th><th>الحالة</th><th /></tr></thead><tbody>
          {data.daily.map((d: any) => <tr key={d.date}><td className="dt">{WD[new Date(d.date + "T00:00:00Z").getUTCDay()]} {fmtDate(d.date)}</td><td className="n"><Money v={d.cash} blankZero /></td>
            <td>{d.closed ? <span className="badge green">مُقفل ✓</span> : d.cash > 0 ? (d.today ? <span className="badge blue">يُقفل آخر اليوم</span> : <span className="badge red">لم يُقفل</span>) : <span className="muted small">لا تحصيل نقدي</span>}</td>
            <td>{!d.closed && d.cash > 0 && <Link className="btn sm" to={`/charity/daily?date=${d.date}`}>إقفال</Link>}</td></tr>)}
        </tbody></table></div></div>}
      {tab === "weekly" && <WeeklyTab data={data} onDone={re} />}
      {tab === "monthly" && <MonthlyTab data={data} onDone={re} />}
      {tab === "settings" && <ClosingSettings cfg={data.config} onDone={re} />}
    </div>
  </>;
}

function WeeklyTab({ data, onDone }: { data: any; onDone: () => void }) {
  const [sel, setSel] = useState<any>(null);
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  return <div className="card"><div className="card-h"><h3>التقفيل الأسبوعي</h3><span className="small muted">الأسبوع ينتهي يوم {WD[data.config.weekEndDay]} — مراجعة حركة الأسبوع وأرصدة الصناديق والبنوك وتوقيعها</span></div>
    <div className="table-wrap"><table className="tbl"><thead><tr><th>الأسبوع</th><th>الحالة</th><th>أقفله</th><th /></tr></thead><tbody>
      {data.weeks.map((w: any) => <tr key={w.key}><td className="dt">{fmtDate(w.from)} ← {fmtDate(w.to)}</td>
        <td>{w.closed ? <span className="badge green">مُقفل ✓</span> : w.current ? <span className="badge blue">الأسبوع الحالي</span> : <span className="badge red">مستحق</span>}</td>
        <td className="small">{w.closed ? <>{w.closedBy} · {fmtDate(w.closedAt)}{w.notes ? <div className="muted">{w.notes}</div> : null}</> : "—"}</td>
        <td className="row" style={{ gap: 4 }}>
          <button className="btn sm" onClick={() => setSel(w)}>{w.closed ? "الملخص" : w.due ? "مراجعة وتقفيل" : "معاينة"}</button>
          {w.closed && can("accounting.write") && <button className="btn sm ghost" disabled={busy} onClick={() => { if (confirmDlg("إعادة فتح الأسبوع؟")) run(async () => { await api(`/charity/closing/week/${w.key}`, { method: "DELETE" }); onDone(); }, "أُعيد فتح الأسبوع"); }}>إعادة فتح</button>}
        </td></tr>)}
    </tbody></table></div>
    {sel && <WeekModal w={sel} onClose={(ok) => { setSel(null); if (ok) onDone(); }} />}
  </div>;
}

function SummaryView({ s }: { s: any }) {
  return <>
    <div className="kpis mb">
      <div className="card kpi"><span className="label">المقبوضات</span><span className="value"><Money v={s.totals.in} /></span><span className="sub">الجمعية <Money v={s.totals.assocIn} /> · المحاسبي <Money v={s.totals.coreIn} /></span></div>
      <div className="card kpi"><span className="label">المدفوعات</span><span className="value"><Money v={s.totals.out} /></span><span className="sub">الجمعية <Money v={s.totals.assocOut} /> · المحاسبي <Money v={s.totals.coreOut} /></span></div>
      <div className="card kpi"><span className="label">النقدية في نهاية الفترة</span><span className="value"><Money v={s.cashTotal} /></span><span className="sub">{s.vouchers} سند</span></div>
    </div>
    {s.unclosedDays.length > 0 && <div className="alert warn small mb">أيام لم يُقفل صندوقها: {s.unclosedDays.join("، ")}</div>}
    {s.disbursementsWithoutDocs.count > 0 && <div className="alert warn small mb">{s.disbursementsWithoutDocs.count} سند صرف بلا مسوغات بمبلغ <Money v={s.disbursementsWithoutDocs.amount} /></div>}
    {s.pendingRequests > 0 && <div className="alert info small mb">{s.pendingRequests} طلب صرف لم يُنهَ</div>}
    {s.mismatches > 0 && <div className="alert err small mb">{s.mismatches} سند لا يطابق قيده — راجع سجل السندات الموحّد</div>}
    <table className="tbl compact"><thead><tr><th>الصندوق / البنك</th><th className="n">الرصيد</th></tr></thead><tbody>{s.balances.map((b: any) => <tr key={b.code}><td>{b.code} {b.name}</td><td className="n"><Money v={b.balance} /></td></tr>)}</tbody></table>
  </>;
}

function WeekModal({ w, onClose }: { w: any; onClose: (ok?: boolean) => void }) {
  const { data } = useFetch<any>(`/charity/closing/summary${q({ from: w.from, to: w.to })}`);
  const { run, busy } = useAction();
  const [notes, setNotes] = useState("");
  const issues = data && (data.unclosedDays.length > 0 || data.disbursementsWithoutDocs.count > 0);
  const ref = useRef<HTMLDivElement>(null);
  return <Modal wide title={`التقفيل الأسبوعي ${fmtDate(w.from)} ← ${fmtDate(w.to)}`} onClose={() => onClose()} footer={<>
    <button className="btn" onClick={() => onClose()}>إغلاق</button>
    <button className="btn" onClick={() => window.print()}>🖨 طباعة</button>
    {!w.closed && w.due && <button className="btn primary" disabled={busy || !data || (issues && !notes.trim())} onClick={() => run(async () => { await api("/charity/closing/week", { body: { key: w.key, notes, force: !!issues } }); onClose(true); }, "تم تقفيل الأسبوع")}>{issues ? "تقفيل مع الملاحظات" : "اعتماد وتقفيل الأسبوع"}</button>}
  </>}>
    {!data ? <Loading /> : <div ref={ref}>
      <SummaryView s={data} />
      {!w.closed && w.due && <Field label={issues ? "ملاحظات المراجع (مطلوبة مع وجود ملاحظات)" : "ملاحظات المراجع"}><Input value={notes} onChange={(e: any) => setNotes(e.target.value)} /></Field>}
    </div>}
  </Modal>;
}

function MonthlyTab({ data, onDone }: { data: any; onDone: () => void }) {
  const [sel, setSel] = useState<any>(null);
  return <div className="card"><div className="card-h"><h3>التقفيل الشهري — قفل الفترة المحاسبية</h3><span className="small muted">بعد القفل لا يُقبل أي قيد أو سند بتاريخ الشهر</span></div>
    <div className="table-wrap"><table className="tbl"><thead><tr><th>الشهر</th><th>الحالة</th><th>أقفله</th><th /></tr></thead><tbody>
      {data.months.map((m: any) => <tr key={m.periodId}><td>{m.name}</td>
        <td>{m.closed ? <span className="badge green">مُقفل ✓</span> : m.overdue ? <span className="badge red">متأخر</span> : m.due ? <span className="badge amber">مستحق</span> : <span className="badge blue">جارٍ</span>}</td>
        <td className="small">{m.closedBy ? `${m.closedBy} · ${fmtDate(m.closedAt)}` : "—"}</td>
        <td>{!m.closed && m.due && <button className="btn sm primary" onClick={() => setSel(m)}>فحص وتقفيل</button>}</td></tr>)}
    </tbody></table></div>
    {sel && <MonthModal m={sel} onClose={(ok) => { setSel(null); if (ok) onDone(); }} />}
  </div>;
}

function MonthModal({ m, onClose }: { m: any; onClose: (ok?: boolean) => void }) {
  const chk = useFetch<any>(`/charity/closing/month/${m.periodId}`);
  const sum = useFetch<any>(`/charity/closing/summary${q({ from: m.from, to: m.to })}`);
  const { me } = useCompanyContext() as any;
  const { run, busy } = useAction();
  const [notes, setNotes] = useState("");
  const owner = me?.superAdmin || ["OWNER", "ADMIN"].includes(me?.role);
  const blockers = chk.data?.blockers || 0;
  return <Modal wide title={`تقفيل ${m.name}`} onClose={() => onClose()} footer={<>
    <button className="btn" onClick={() => onClose()}>إلغاء</button>
    <button className="btn primary" disabled={busy || !chk.data || (blockers > 0 && (!owner || !notes.trim()))} onClick={() => run(async () => { await api("/charity/closing/month", { body: { periodId: m.periodId, notes, force: blockers > 0 } }); onClose(true); }, "تم قفل الشهر")}>{blockers ? "قفل رغم البنود المانعة" : "قفل الشهر"}</button>
  </>}>
    {!chk.data ? <Loading /> : <>
      {!chk.data.items.length ? <div className="alert ok small mb">لا توجد بنود مانعة ولا تحذيرات ✓</div> : chk.data.items.map((i: any, k: number) => <div key={k} className={"alert small mb " + (i.level === "block" ? "err" : i.level === "warn" ? "warn" : "info")}><b>{i.label}</b>{i.detail ? ` — ${i.detail}` : ""}</div>)}
      {blockers > 0 && <div className="small muted mb">{owner ? "يمكنك القفل رغم البنود المانعة مع ذكر السبب (يُسجَّل في سجل التدقيق)." : "القفل مع بنود مانعة للمالك أو المدير فقط."}</div>}
    </>}
    {sum.data && <SummaryView s={sum.data} />}
    <Field label="ملاحظات"><Input value={notes} onChange={(e: any) => setNotes(e.target.value)} /></Field>
  </Modal>;
}

function ClosingSettings({ cfg, onDone }: { cfg: any; onDone: () => void }) {
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const toast = useToast();
  const [f, setF] = useState<any>(cfg);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const perm = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
  return <div className="card"><div className="card-h"><h3>إعدادات تنبيهات التقفيل</h3></div><div className="card-b grid c3">
    <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.daily} onChange={set("daily")} />تنبيه التقفيل اليومي (إقفال الصندوق)</label>
    <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.weekly} onChange={set("weekly")} />تنبيه التقفيل الأسبوعي</label>
    <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.monthly} onChange={set("monthly")} />تنبيه التقفيل الشهري</label>
    <Field label="آخر يوم في الأسبوع"><select className="input" value={f.weekEndDay} onChange={(e) => setF({ ...f, weekEndDay: Number(e.target.value) })}>{WD.map((d, i) => <option key={i} value={i}>{d}</option>)}</select></Field>
    <Field label="مهلة التقفيل الشهري بعد نهاية الشهر (أيام)"><NumInput value={f.monthGraceDays} onChange={set("monthGraceDays")} /></Field>
    <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.requireDocs} onChange={set("requireDocs")} />المسوغات إلزامية: لا يُقفل الأسبوع وفيه سند صرف بلا مسوغ إلا بملاحظة</label>
    <div className="alert info small" style={{ gridColumn: "1 / -1" }}>تظهر التنبيهات في 🔔 أعلى الشاشة وفي لوحة المؤشرات. {perm === "granted" ? "إشعارات المتصفح مفعّلة على هذا الجهاز ✓" : perm === "unsupported" ? "" : <button className="btn sm" onClick={async () => { const r = await Notification.requestPermission(); toast(r === "granted" ? "فُعّلت إشعارات المتصفح على هذا الجهاز" : "لم يُسمح بالإشعارات", r === "granted" ? undefined : "err"); }}>تفعيل إشعارات المتصفح على هذا الجهاز</button>}</div>
    {can("settings.write") && <div><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api("/charity/closing/settings", { method: "PUT", body: f }); onDone(); }, "تم الحفظ")}>حفظ</button></div>}
  </div></div>;
}

// ─── 📊 project budget table ───────────────────────────────────────────────
export function ProjectBudgetModal({ project, onClose }: { project: any; onClose: () => void }) {
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const { data, reload } = useFetch<any>(`/charity/projects/${project.id}/budget${q({ year })}`);
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const [add, setAdd] = useState<any>(null);
  const [acc, setAcc] = useState<any>(null);
  const years = useMemo(() => Array.from(new Set([new Date().getFullYear() + 1, new Date().getFullYear(), ...(data?.years || [])])).sort((a: any, b: any) => b - a), [data?.years]);
  const t = data?.totals;
  return <Modal wide title={`ميزانية المشروع: ${project.name}`} onClose={onClose} footer={<><button className="btn" onClick={() => window.print()}>🖨 طباعة</button><button className="btn" onClick={onClose}>إغلاق</button></>}>
    <div className="toolbar mb"><label className="row small" style={{ gap: 6 }}>السنة <select className="input" style={{ width: 120 }} value={year} onChange={(e) => setYear(e.target.value)}><option value="all">كل السنوات</option>{years.map((y: any) => <option key={y} value={y}>{y}</option>)}</select></label>
      <div className="grow" />{can("accounting.write") && project.status !== "CLOSED" && year !== "all" && <button className="btn sm primary" onClick={() => { setAdd({ name: "", amount: "" }); setAcc(null); }}>＋ بند ميزانية</button>}</div>
    {!data ? <Loading /> : <>
      <div className="kpis mb">
        <div className="card kpi"><span className="label">ميزانية المصروفات</span><span className="value"><Money v={t.expenseBudget} /></span><span className="sub">المصروف <Money v={t.expenseActual} /></span></div>
        <div className="card kpi"><span className="label">المتبقي من الميزانية</span><span className="value" style={t.expenseRemaining < 0 ? { color: "var(--danger-ink)" } : undefined}><Money v={t.expenseRemaining} /></span><span className="sub">{t.expenseBudget ? `${Math.round((t.expenseActual / t.expenseBudget) * 100)}% منفَّذ` : "لا ميزانية"}</span></div>
        <div className="card kpi"><span className="label">المقبوض للمشروع</span><span className="value"><Money v={data.received} /></span><span className="sub">المستهدف <Money v={data.project.target} /></span></div>
        <div className="card kpi"><span className="label">رصيد المشروع</span><span className="value"><Money v={data.balance} /></span><span className="sub">المقبوض − المصروف</span></div>
      </div>
      {!data.lines.length ? <Empty text="لا توجد بنود ميزانية لهذا المشروع في السنة المختارة" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr>{year === "all" && <th>السنة</th>}<th>البند</th><th>الحساب</th><th className="n">المقدّر</th><th className="n">الفعلي</th><th className="n">المتبقي</th><th className="n">التنفيذ</th>{can("accounting.write") && <th />}</tr></thead>
        <tbody>{data.lines.map((l: any) => <tr key={l.id} style={l.over ? { background: "var(--danger-soft, #fde8e8)" } : undefined}>{year === "all" && <td>{l.year}</td>}<td><b>{l.name}</b>{l.kind === "REVENUE" && <span className="badge green" style={{ marginInlineStart: 4 }}>إيراد</span>}</td><td className="small">{l.accountCode} {l.accountName}</td><td className="n"><Money v={l.amount} /></td><td className="n"><Money v={l.actual} /></td><td className="n"><Money v={l.remaining} /></td>
          <td className="n"><div className="ch-bar" style={{ margin: 0 }}><div className="trk" style={{ width: 70 }}><div style={{ width: `${Math.min(100, l.pct || 0)}%`, height: "100%", background: l.over ? "var(--danger)" : (l.pct || 0) >= 90 ? "var(--accent)" : "var(--primary)" }} /></div><span className="small num">{l.pct ?? "—"}%</span></div></td>
          {can("accounting.write") && <td>{project.status !== "CLOSED" && <button className="btn sm ghost" disabled={busy} onClick={() => { if (confirmDlg(`حذف البند «${l.name}»؟`)) run(async () => { await api(`/charity/budget/lines/${l.id}`, { method: "DELETE" }); reload(); }, "حُذف البند"); }}>🗑</button>}</td>}</tr>)}</tbody>
        <tfoot><tr><th colSpan={year === "all" ? 3 : 2}>إجمالي المصروفات</th><th className="n"><Money v={t.expenseBudget} /></th><th className="n"><Money v={t.expenseActual} /></th><th className="n"><Money v={t.expenseRemaining} /></th><th colSpan={can("accounting.write") ? 2 : 1} /></tr></tfoot></table></div>}
      {data.unbudgeted.length > 0 && <div className="alert warn small mt"><b>مصروفات على المشروع خارج الميزانية (<Money v={t.unbudgeted} />):</b> {data.unbudgeted.map((u: any) => `${u.code} ${u.name} (${u.year}): ${u.amount}`).join("، ")}</div>}
      <div className="alert info small mt">الصرف على المشروع من «سندات الصرف» يُمنع إذا لم يكن بنده في الميزانية أو تجاوز المتبقي فيه، إلا باختيار «تجاوز الميزانية» مع ذكر السبب (يُسجَّل على السند وفي سجل التدقيق).</div>
    </>}
    {add && <Modal narrow title="بند ميزانية للمشروع" onClose={() => setAdd(null)} footer={<><button className="btn" onClick={() => setAdd(null)}>إلغاء</button><button className="btn primary" disabled={busy || !acc || !(Number(add.amount) > 0)} onClick={() => run(async () => { await api("/charity/budget/lines", { body: { year: Number(year), accountId: acc.id, projectId: project.id, name: add.name, amount: add.amount } }); setAdd(null); reload(); }, "أُضيف البند")}>حفظ</button></>}>
      <div className="grid">
        <Field label="حساب المصروف"><Picker value={acc} onChange={setAcc} fetcher={expFetcher} label={acLabel} /></Field>
        <Field label="اسم البند" hint="فارغ = اسم الحساب"><Input value={add.name} onChange={(e: any) => setAdd({ ...add, name: e.target.value })} /></Field>
        <Field label={`المبلغ المقدّر لعام ${year}`}><NumInput value={add.amount} onChange={(e: any) => setAdd({ ...add, amount: e.target.value })} /></Field>
      </div>
    </Modal>}
  </Modal>;
}

// ─── 🏁 final disbursement & closing of a project ──────────────────────────
const SRC_AR: Record<string, string> = { CASH_DONATION: "تبرع نقدي", SUPPORT: "دعم / منحة", FOUNDING: "مساهمة تأسيسية", PROGRAM: "إيرادات برامج", ZAKAT: "زكاة", MEMBERSHIP: "اشتراك", SPONSORSHIP: "كفالة", REFUND: "استرداد", OTHER: "أخرى" };
export function ProjectFinalModal({ project, onClose }: { project: any; onClose: (changed?: boolean) => void }) {
  const { data, reload } = useFetch<any>(`/charity/projects/${project.id}/final`);
  const auth = useFetch<any>("/charity/authority");
  const { projects } = useCharity();
  const { me, can } = useCompanyContext() as any;
  const { run, busy } = useAction();
  const toast = useToast();
  const owner = me?.superAdmin || ["OWNER", "ADMIN"].includes(me?.role);
  const [fd, setFd] = useState<any>({ on: false, amount: "", beneficiaryName: "", kind: "TRANSFER", refNo: "", capacity: "BENEFICIARY", reason: "" });
  const [benef, setBenef] = useState<any>(null);
  const [exp, setExp] = useState<any>(null);
  const [pay, setPay] = useState<any>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [rem, setRem] = useState({ remainder: "KEEP", toProjectId: "", notes: "", date: today() });
  const closed = data?.project?.status === "CLOSED";
  const afterFinal = data ? Math.max(0, data.balance - (fd.on ? Number(fd.amount) || 0 : 0)) : 0;
  const close = () => run(async () => {
    const overLimit = fd.on && auth.data?.enabled && Number(fd.amount) > Number(auth.data.directLimit || 0);
    const body: any = { ...rem, force: !!data?.openItems?.length || (owner && overLimit) };
    if (fd.on) body.finalDisbursement = { amount: fd.amount, beneficiaryName: benef?.name || fd.beneficiaryName, partnerId: benef?.id, kind: fd.kind, refNo: fd.refNo, capacity: fd.capacity, reason: fd.reason || undefined, expenseAccountId: exp?.id, payAccountId: pay?.id };
    const r = await api(`/charity/projects/${project.id}/close`, { body });
    if (r.finalVoucher && files.length) { const u = await uploadFiles("ch_disb", r.finalVoucher.id, files); if (u.errs.length) toast(u.errs.join(" — "), "err"); }
    onClose(true);
  }, "تم الصرف النهائي وإقفال المشروع");
  return <Modal wide title={`الصرف النهائي وإقفال المشروع: ${project.name}`} onClose={() => onClose()} footer={<>
    <button className="btn" onClick={() => window.print()}>🖨 طباعة الكشف الختامي</button>
    <button className="btn" onClick={() => onClose()}>إغلاق</button>
    {closed ? owner && <button className="btn" disabled={busy} onClick={() => { if (confirmDlg("إعادة فتح المشروع؟")) run(async () => { const r = await api(`/charity/projects/${project.id}/reopen`, { body: {} }); toast(r.note); reload(); onClose(true); }); }}>إعادة فتح المشروع</button>
      : can("accounting.write") && <button className="btn primary" disabled={busy || !data || (data.openItems.length > 0 && !owner) || (fd.on && !(Number(fd.amount) > 0 && (benef || fd.beneficiaryName))) || (rem.remainder === "TRANSFER" && !rem.toProjectId)} onClick={() => { if (confirmDlg("بعد الإقفال لا يُسجَّل على المشروع أي سند قبض أو صرف. متابعة؟")) close(); }}>{fd.on ? "الصرف النهائي وإقفال المشروع" : "إقفال المشروع"}</button>}
  </>}>
    {!data ? <Loading /> : <>
      {closed && <div className="alert ok small mb">المشروع مُقفل منذ {fmtDate(data.project.closedAt)} — {data.project.closedBy}{data.project.finalSettlement?.finalVoucher ? ` · الصرف النهائي ${data.project.finalSettlement.finalVoucher.number}` : ""}{data.project.finalSettlement?.remainder?.amount > 0 ? ` · الرصيد المتبقي ${data.project.finalSettlement.remainder.amount} (${{ KEEP: "بقي في صافي الأصول", RELEASE: "فُكّ قيده إلى التبرعات العامة", TRANSFER: "نُقل لمشروع آخر" }[data.project.finalSettlement.remainder.mode as "KEEP"]})` : ""}</div>}
      <div className="kpis mb">
        <div className="card kpi"><span className="label">المقبوض</span><span className="value"><Money v={data.received} /></span><span className="sub">{data.targetPct !== null ? `${data.targetPct}% من المستهدف` : ""}</span></div>
        <div className="card kpi"><span className="label">المصروف</span><span className="value"><Money v={data.spent} /></span><span className="sub">الميزانية <Money v={data.budget.expenseBudget} /></span></div>
        <div className="card kpi"><span className="label">الرصيد المتبقي</span><span className="value"><Money v={data.balance} /></span></div>
      </div>
      <div className="grid c2 mb">
        <table className="tbl compact"><thead><tr><th>المقبوض حسب المصدر</th><th className="n">المبلغ</th></tr></thead><tbody>{data.bySource.map((x: any) => <tr key={x.source}><td>{SRC_AR[x.source] || x.source} <span className="muted small">({x.count})</span></td><td className="n"><Money v={x.amount} /></td></tr>)}</tbody></table>
        <table className="tbl compact"><thead><tr><th>المصروف حسب البند</th><th className="n">المبلغ</th></tr></thead><tbody>{data.byAccount.map((x: any) => <tr key={x.code}><td>{x.code} {x.name} <span className="muted small">({x.count})</span></td><td className="n"><Money v={x.amount} /></td></tr>)}</tbody></table>
      </div>
      {data.openItems.length > 0 && <div className="alert warn small mb">بنود مفتوحة على المشروع: {data.openItems.join("، ")}{!closed && (owner ? " — يمكنك الإقفال رغمها (يُسجَّل)." : " — أنهِها أولاً أو اطلب من المالك/المدير الإقفال.")}</div>}
      {data.disbursementsWithoutDocs > 0 && <div className="alert info small mb">{data.disbursementsWithoutDocs} سند صرف على المشروع بلا مسوغات مرفقة.</div>}
      {!closed && can("accounting.write") && <>
        <label className="row mb" style={{ gap: 6 }}><input type="checkbox" checked={fd.on} onChange={(e) => setFd({ ...fd, on: e.target.checked, amount: e.target.checked && !fd.amount ? String(data.balance > 0 ? data.balance : "") : fd.amount })} /><b>إضافة سند الصرف النهائي للمشروع</b></label>
        {fd.on && <div className="card mb"><div className="card-b grid c3">
          <Field label="المستفيد / المستلم" span2><Picker value={benef} onChange={setBenef} fetcher={benefFetcher} label={(b: any) => `${b.code} — ${b.name}`} placeholder="من سجل المستفيدين أو اكتب الاسم أدناه" /></Field>
          <Field label="أو اسم المستلم"><Input value={fd.beneficiaryName} onChange={(e: any) => setFd({ ...fd, beneficiaryName: e.target.value })} /></Field>
          <Field label="المبلغ"><NumInput value={fd.amount} onChange={(e: any) => setFd({ ...fd, amount: e.target.value })} /></Field>
          <Field label="طريقة الصرف"><select className="input" value={fd.kind} onChange={(e) => setFd({ ...fd, kind: e.target.value })}><option value="TRANSFER">تحويل بنكي</option><option value="CHEQUE">شيك</option><option value="CASH">نقدي</option></select></Field>
          {fd.kind !== "CASH" ? <Field label="رقم الحوالة / الشيك"><Input value={fd.refNo} onChange={(e: any) => setFd({ ...fd, refNo: e.target.value })} dir="ltr" /></Field> : <div />}
          <Field label="صفة المستلم"><select className="input" value={fd.capacity} onChange={(e) => setFd({ ...fd, capacity: e.target.value })}><option value="BENEFICIARY">مستفيد</option><option value="SUPPLIER">مورد</option><option value="OTHER">أخرى</option></select></Field>
          <Field label="حساب المصروف" hint="فارغ = حسب الصفة"><Picker value={exp} onChange={setExp} fetcher={expFetcher} label={acLabel} /></Field>
          <Field label="من حساب" hint="فارغ = البنك / الصندوق"><Picker value={pay} onChange={setPay} fetcher={cashFetcher} label={acLabel} /></Field>
          <Field label="البيان" span3><Input value={fd.reason} placeholder={`الصرف النهائي لمشروع ${project.name}`} onChange={(e: any) => setFd({ ...fd, reason: e.target.value })} /></Field>
          <div style={{ gridColumn: "1 / -1" }}><PendingFiles files={files} onChange={setFiles} /></div>
        </div></div>}
        <div className="card"><div className="card-b grid c3">
          <Field label={`الرصيد المتبقي بعد الصرف النهائي: ${afterFinal.toLocaleString("en", { minimumFractionDigits: 2 })}`} span2><select className="input" value={rem.remainder} onChange={(e) => setRem({ ...rem, remainder: e.target.value })}>
            <option value="KEEP">يبقى في صافي أصول الجمعية (دون قيد)</option>
            <option value="RELEASE">فك القيد: يُحوَّل من التبرعات المقيدة إلى التبرعات العامة</option>
            <option value="TRANSFER">ينقل إلى مشروع آخر (تبرعات مقيدة)</option></select></Field>
          <Field label="تاريخ الإقفال"><Input type="date" value={rem.date} onChange={(e: any) => setRem({ ...rem, date: e.target.value })} /></Field>
          {rem.remainder === "TRANSFER" && <Field label="المشروع المستلم" span2><select className="input" value={rem.toProjectId} onChange={(e) => setRem({ ...rem, toProjectId: e.target.value })}><option value="">— اختر —</option>{projects.filter((p: any) => p.id !== project.id && p.status !== "CLOSED").map((p: any) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>}
          <Field label="ملاحظات الإقفال" span3><Input value={rem.notes} onChange={(e: any) => setRem({ ...rem, notes: e.target.value })} /></Field>
        </div></div>
      </>}
    </>}
  </Modal>;
}

// ─── 🗄 daily archive & 💾 daily backups ───────────────────────────────────
const SRC: Record<string, string> = { CORE_PAY: "سند — المحاسبي", CORE_EXP: "مصروف — المحاسبي", CH_RCPT: "سند قبض — الجمعية", CH_DISB: "سند صرف — الجمعية", SHARES: "أسهم", DIST_PAY: "عائد عضو" };
export function DailyArchivePage() {
  const [d, setD] = useState(today());
  const { data, loading, reload } = useFetch<any>(`/charity/daily-archive${q({ date: d })}`);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const shift = (n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); setD(x.toISOString().slice(0, 10)); };
  return <>
    <div className="card mb"><div className="card-b toolbar">
      <button className="btn sm" onClick={() => shift(-1)}>→ اليوم السابق</button>
      <Input type="date" value={d} onChange={(e: any) => setD(e.target.value)} style={{ width: 170 }} />
      <button className="btn sm" disabled={d >= today()} onClick={() => shift(1)}>اليوم التالي ←</button>
      <div className="grow" />
      <button className="btn sm" disabled={busy} onClick={async () => { setBusy(true); try { await downloadAuth(`/api/archive/pack${q({ from: d, to: d })}`, `أرشيف ${d}.zip`); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); } }}>📦 مستندات اليوم (ZIP)</button>
      {data?.backup && <button className="btn sm" onClick={() => downloadAuth(`/api/backups/${data.backup.id}/download`, `mizan-backup-${d}.json.gz`).catch((e) => toast(e.message, "err"))}>💾 نسخة اليوم</button>}
      <button className="btn sm" onClick={() => window.print()}>🖨 سجل اليوم</button>
    </div></div>
    {loading && !data ? <Loading /> : data && <>
      <div className="kpis mb">
        <div className="card kpi"><span className="label">مقبوضات اليوم</span><span className="value"><Money v={data.totals.in} /></span></div>
        <div className="card kpi"><span className="label">مدفوعات اليوم</span><span className="value"><Money v={data.totals.out} /></span></div>
        <div className="card kpi"><span className="label">إقفال الصندوق</span><span className="value" style={{ fontSize: 18 }}>{data.dayClosed ? "مُقفل ✓" : "لم يُقفل"}</span><span className="sub">{data.dayClosed ? `${data.dayClosed.closedBy || ""}` : <Link to={`/charity/daily?date=${d}`}>إقفال اليوم</Link>}</span></div>
        <div className="card kpi"><span className="label">الحفظ اليومي</span><span className="value" style={{ fontSize: 18 }}>{data.backup ? "محفوظ ✓" : d === today() ? "يُحفظ تلقائياً" : "لا نسخة"}</span><span className="sub">{data.backup ? `${fmtSize(data.backup.size)} · ${data.backup.kind === "AUTO" ? "تلقائي" : "يدوي"}` : ""}</span></div>
      </div>
      {data.missingDocs > 0 && <div className="alert warn small mb">{data.missingDocs} سند صرف في هذا اليوم بلا مسوغات — ارفعها من 📎</div>}
      <div className="card"><div className="card-h"><h3>سجل مستندات يوم {fmtDate(d)}</h3><span className="small muted">{data.rows.length} مستند · {data.filesThatDay.n} ملف مؤرشف</span></div>
        {!data.rows.length ? <Empty text="لا توجد سندات في هذا اليوم" /> : <div className="table-wrap"><table className="tbl">
          <thead><tr><th>المصدر</th><th>الرقم</th><th>الطرف / البيان</th><th className="n">قبض</th><th className="n">صرف</th><th>القيد</th><th>المسوغات</th></tr></thead>
          <tbody>{data.rows.map((r: any) => <tr key={r.src + r.id} style={r.status !== "POSTED" ? { opacity: .55 } : undefined}>
            <td className="small">{SRC[r.src]}</td><td className="num">{r.number}</td><td><b>{r.party}</b>{r.memo && <div className="small muted">{r.memo}</div>}</td>
            <td className="n">{r.dir === "IN" ? <Money v={r.amount} /> : ""}</td><td className="n">{r.dir === "OUT" ? <Money v={r.amount} /> : ""}</td>
            <td>{r.journalId ? <Link to={`/charity/journals/${r.journalId}`}>{r.journalNumber}</Link> : "—"}</td>
            <td>{r.entity ? <AttachIcon entity={r.entity} row={{ ...r, attachCount: r.attachments }} onChanged={reload} /> : "—"}</td>
          </tr>)}</tbody></table></div>}
      </div>
    </>}
  </>;
}

export { BackupsPage } from "../pages/Backups";
