/** E-mailed management reports (recipients and what each one receives) and the document archive. */
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, q, session, useFetch, Modal, Field, Input, Select, Money, Loading, Empty, useAction, useToast, useCompanyContext, fmtDate, fmtDT, confirmDlg, DateRange, ExportBtn, useTabParam, yearStart, today, useDebounce } from "../lib";

const FREQ: Record<string, string> = { DAILY: "يومياً نهاية اليوم", WEEKLY: "أسبوعياً", MONTHLY: "شهرياً آخر الشهر" };
const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

// ─── e-mailed reports ──────────────────────────────────────────────────────
export function DigestPage() {
  const { can } = useCompanyContext();
  const { data, loading, reload } = useFetch<any>("/digest");
  const branches = useFetch<any[]>("/branches");
  const { run, busy } = useAction();
  const toast = useToast();
  const [edit, setEdit] = useState<any>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [s, setS] = useState<any>(null);
  useEffect(() => { if (data) setS(data.settings); }, [data]);
  if (loading && !data) return <Loading />;
  if (!data || !s) return null;
  const W = can("settings.write");
  const showPreview = async (query: string) => { try { const r = await fetch(`/api/digest/preview${query}`, { headers: { Authorization: `Bearer ${session.token}` } }); if (!r.ok) throw new Error("تعذّر تجهيز المعاينة"); setPreview(await r.text()); } catch (e: any) { toast(e.message, "err"); } };
  return (
    <div className="grid">
      {!data.mail.configured && <div className="alert warn">⚠ خدمة البريد غير مفعّلة على الخادم، فلن يُرسل شيء حتى تُضبط متغيرات <span dir="ltr">SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM</span>. يمكنك إضافة المستلمين ومعاينة التقرير الآن.</div>}
      <div className="card"><div className="card-h"><h3>📧 تقارير الإدارة بالبريد</h3>{s.enabled ? <span className="badge green">الإرسال التلقائي مفعّل</span> : <span className="badge gray">متوقف</span>}</div>
        <div className="card-b"><div className="form-grid">
          <Field label="الإرسال التلقائي"><label className="check"><input type="checkbox" checked={!!s.enabled} disabled={!W} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> إرسال التقارير تلقائياً</label></Field>
          <Field label="ساعة الإرسال (توقيت الرياض)"><Select value={s.hour} disabled={!W} onChange={(e) => setS({ ...s, hour: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00{h === 21 ? " — نهاية اليوم" : ""}</option>)}</Select></Field>
          <Field label="يوم التقرير الأسبوعي"><Select value={s.weekday} disabled={!W} onChange={(e) => setS({ ...s, weekday: Number(e.target.value) })}>{DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}</Select></Field>
        </div>
        <div className="row mt">{W && <button className="btn primary" disabled={busy} onClick={() => run(async () => { await api("/digest/settings", { method: "PUT", body: s }); reload(); }, "تم الحفظ")}>حفظ</button>}
          <button className="btn" onClick={() => showPreview("")}>👁 معاينة التقرير الكامل</button>
          {W && <button className="btn" disabled={busy || !data.mail.configured || !data.recipients.length} onClick={() => run(async () => { if (!confirmDlg(`إرسال التقرير الآن إلى ${data.recipients.filter((r: any) => r.isActive).length} مستلم؟`)) return; const r = await api("/digest/send", { body: {} }); toast(`أُرسل ${r.sent}${r.failed.length ? ` — فشل ${r.failed.length}` : ""}`, r.failed.length ? "err" : "ok"); reload(); })}>✉ إرسال الآن للجميع</button>}</div>
        <p className="small muted mt">اليومي يغطي يوم الإرسال، الأسبوعي آخر 7 أيام، والشهري من أول الشهر — كلٌّ مع المقارنة بالفترة السابقة. كل مستلم يصله فقط ما تحدده له من أقسام.</p></div>
      </div>
      <div className="card"><div className="card-h"><h3>المستلمون <span className="muted small">({data.recipients.length} / 50)</span></h3>{W && <button className="btn primary sm" onClick={() => setEdit({})}>＋ مستلم جديد</button>}</div>
        {!data.recipients.length ? <Empty text="أضف مدير عام، مدير مالي، مدير مبيعات، أمين مستودع… وحدّد لكلٍّ ما يصله" /> : <div className="table-wrap"><table className="tbl"><thead><tr><th>الاسم</th><th>البريد</th><th>التكرار</th><th>ما يصله</th><th>الفرع</th><th>آخر إرسال</th><th></th></tr></thead>
          <tbody>{data.recipients.map((r: any) => <tr key={r.id} className={r.isActive ? "" : "muted"}><td><b>{r.name}</b>{r.title && <div className="small muted">{r.title}</div>}{!r.isActive && <span className="badge gray">موقوف</span>}</td><td dir="ltr" style={{ textAlign: "right" }}>{r.email}</td><td>{FREQ[r.frequency]}</td>
            <td><div className="row" style={{ gap: 4 }}>{r.sections.map((x: string) => <span key={x} className="badge teal">{data.sections[x]?.split(" ")[0] === "تحليل" ? data.sections[x].split(" ").slice(1, 2).join(" ") : data.sections[x]?.split(" و")[0]}</span>)}</div></td>
            <td className="small">{r.branchName || "كل الفروع"}</td><td className="small">{r.lastError ? <span className="neg-val" title={r.lastError}>فشل ✕</span> : r.lastSentAt ? fmtDT(r.lastSentAt) : "—"}</td>
            <td><div className="row" style={{ gap: 4, flexWrap: "nowrap" }}><button className="btn sm ghost" onClick={() => showPreview(`?recipientId=${r.id}`)}>معاينة</button>{W && <><button className="btn sm ghost" disabled={!data.mail.configured || busy} onClick={() => run(async () => { const x = await api("/digest/send", { body: { recipientId: r.id } }); if (x.failed.length) throw new Error(x.failed[0].error); reload(); }, "أُرسل")}>إرسال</button><button className="btn sm ghost" onClick={() => setEdit(r)}>تعديل</button></>}</div></td></tr>)}</tbody></table></div>}
      </div>
      {data.log.length > 0 && <div className="card"><div className="card-h"><h3>سجل الإرسال</h3></div><div className="table-wrap"><table className="tbl compact"><thead><tr><th>الوقت</th><th>البريد</th><th>الفترة</th><th>الحالة</th></tr></thead><tbody>{data.log.map((l: any, i: number) => <tr key={i}><td className="small">{fmtDT(l.createdAt)}</td><td dir="ltr" style={{ textAlign: "right" }}>{l.email}</td><td className="num small">{l.period}</td><td>{l.ok ? <span className="badge green">أُرسل</span> : <span className="badge red" title={l.error}>فشل: {String(l.error).slice(0, 60)}</span>}</td></tr>)}</tbody></table></div></div>}
      {edit && <RecipientEditor r={edit} sections={data.sections} branches={branches.data || []} onClose={(sv) => { setEdit(null); if (sv) reload(); }} />}
      {preview !== null && <Modal wide title="معاينة البريد" onClose={() => setPreview(null)}><iframe title="preview" srcDoc={preview} style={{ width: "100%", height: "70vh", border: "1px solid var(--border)", borderRadius: 8, background: "#fff" }} /></Modal>}
    </div>
  );
}
function RecipientEditor({ r, sections, branches, onClose }: { r: any; sections: Record<string, string>; branches: any[]; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ frequency: "DAILY", sections: ["summary", "alerts"], isActive: true, ...r });
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const tg = (k: string) => setF({ ...f, sections: f.sections.includes(k) ? f.sections.filter((x: string) => x !== k) : [...f.sections, k] });
  const PRESET: Record<string, string[]> = { "الإدارة العليا (الكل)": Object.keys(sections), "مدير مالي": ["summary", "expenses", "receivables", "payables", "cash", "alerts"], "مدير مبيعات": ["summary", "sales", "receivables"], "مدير مشتريات ومخزون": ["purchases", "inventory", "payables"], "تنبيهات فقط": ["alerts"] };
  return (
    <Modal title={r.id ? `تعديل: ${r.name}` : "مستلم جديد"} onClose={() => onClose()} footer={<>
      {r.id && <button className="btn danger sm" onClick={() => run(async () => { if (!confirmDlg("حذف المستلم؟")) return; await api(`/digest/recipients/${r.id}`, { method: "DELETE" }); onClose(true); })}>حذف</button>}<div className="grow" />
      <button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy} onClick={() => run(async () => { r.id ? await api(`/digest/recipients/${r.id}`, { method: "PUT", body: f }) : await api("/digest/recipients", { body: f }); onClose(true); }, "تم الحفظ")}>حفظ</button></>}>
      <div className="form-grid">
        <Field label="الاسم *"><Input autoFocus value={f.name || ""} onChange={s("name")} /></Field>
        <Field label="المسمى الوظيفي"><Input value={f.title || ""} onChange={s("title")} placeholder="المدير العام" /></Field>
        <Field label="البريد الإلكتروني *"><Input value={f.email || ""} onChange={s("email")} dir="ltr" type="email" /></Field>
        <Field label="التكرار"><Select value={f.frequency} onChange={s("frequency")}>{Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        {branches.length > 1 && <Field label="الفرع"><Select value={f.branchId || ""} onChange={s("branchId")}><option value="">كل الفروع</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>}
        <Field label="الحالة"><label className="check"><input type="checkbox" checked={!!f.isActive} onChange={s("isActive")} /> فعّال</label></Field>
        <Field label="صلاحية المحتوى — ما الذي يصل هذا المستلم؟" span3>
          <div className="row" style={{ gap: 6, marginBottom: 8 }}>{Object.entries(PRESET).map(([k, v]) => <button key={k} className="btn sm" onClick={() => setF({ ...f, sections: v })}>{k}</button>)}</div>
          <div className="pick-list" style={{ maxHeight: "none" }}>{Object.entries(sections).map(([k, v]) => <label key={k} className="check"><input type="checkbox" checked={f.sections.includes(k)} onChange={() => tg(k)} /> {v}</label>)}</div>
        </Field>
      </div>
    </Modal>
  );
}

// ─── archive ───────────────────────────────────────────────────────────────
const ENT: Record<string, string> = { invoice: "فاتورة", expense: "مصروف", payment: "سند", journal: "قيد", partner: "عميل / مورد", product: "صنف", asset: "أصل ثابت", archive: "مستند عام" };
const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} م.ب` : `${Math.max(1, Math.round(b / 1024))} ك.ب`);
const ICON = (m: string) => (m.startsWith("image/") ? "🖼" : m === "application/pdf" ? "📄" : /sheet|excel|csv/.test(m) ? "📊" : /word/.test(m) ? "📝" : "📎");
const readB64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });
async function openFile(id: string, name: string, download = false) {
  const r = await fetch(`/api/attachments/file/${id}${download ? "?download=1" : ""}`, { headers: { Authorization: `Bearer ${session.token}` } });
  if (!r.ok) throw new Error("تعذّر فتح الملف");
  const url = URL.createObjectURL(await r.blob());
  if (download) { const a = document.createElement("a"); a.href = url; a.download = name; a.click(); } else window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const srcOf = (a: any): { label: string; to: string | null } => {
  if (a.entity === "invoice") return { label: `${a.direction === "SALE" ? "مبيعات" : "مشتريات"} ${a.ref || ""}${a.partnerName ? ` — ${a.partnerName}` : ""}`, to: `/doc/${a.entityId}` };
  if (a.entity === "expense") return { label: `مصروف ${a.ref || ""}`, to: "/expenses" };
  if (a.entity === "payment") return { label: `${a.payDir === "IN" ? "سند قبض" : "سند صرف"} ${a.ref || ""}`, to: a.payDir === "IN" ? "/receipts" : "/vouchers" };
  if (a.entity === "journal") return { label: `قيد ${a.ref || ""}`, to: `/journals/${a.entityId}` };
  if (a.entity === "partner") return { label: a.ref || "", to: `/${a.isCustomer ? "customers" : "suppliers"}/${a.entityId}` };
  if (a.entity === "product") return { label: a.ref || "", to: `/products/${a.entityId}` };
  if (a.entity === "asset") return { label: a.ref || "", to: "/assets" };
  return { label: "مستندات المنشأة", to: null };
};

export function ArchivePage() {
  const { can } = useCompanyContext();
  const toast = useToast();
  const [tab, setTab] = useTabParam("all");
  const [search, setSearch] = useState("");
  const dq = useDebounce(search);
  const [entity, setEntity] = useState("");
  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [up, setUp] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const listTab = tab === "missing" ? "all" : tab;
  const { data, loading, reload } = useFetch<any>(`/archive${q({ q: dq, entity: tab === "general" ? "archive" : entity, category, from, to, tab: listTab })}`, [dq, entity, category, from, to, tab]);
  const [mFrom, setMFrom] = useState(yearStart()); const [mTo, setMTo] = useState(today());
  const missing = useFetch<any[]>(tab === "missing" ? `/archive/missing${q({ from: mFrom, to: mTo })}` : null, [tab, mFrom, mTo]);
  const W = can("accounting.write");
  const st = data?.stats;
  return (
    <div className="grid">
      {st && <div className="kpis">
        <div className="card kpi accent"><div className="label">الملفات المؤرشفة</div><div className="value num">{st.files}</div><div className="small muted">{fmtSize(Number(st.bytes))}</div></div>
        <div className="card kpi"><div className="label">مرفقات الفواتير</div><div className="value num">{st.invoices}</div></div>
        <div className="card kpi"><div className="label">مرفقات المصروفات</div><div className="value num">{st.expenses}</div></div>
        <div className="card kpi"><div className="label">مستندات المنشأة</div><div className="value num">{st.general}</div></div>
        <div className="card kpi"><div className="label">تنتهي خلال 60 يوماً</div><div className={"value num " + (st.expiring ? "neg-val" : "")}>{st.expiring}</div><div className="small muted">{st.expired ? `منها ${st.expired} منتهية` : "سجل، رخص، عقود…"}</div></div>
      </div>}
      <div className="tabs">{[["all", "كل المستندات"], ["general", "مستندات المنشأة"], ["expiring", `تنتهي قريباً${st?.expiring ? ` (${st.expiring})` : ""}`], ["missing", "مستندات ناقصة"]].map(([k, l]) => <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab !== "missing" ? <div className="card">
        <div className="card-h"><h3>🗄 الأرشيف</h3><div className="row">{data && <ExportBtn name="الأرشيف" rows={() => data.rows.map((a: any) => ({ الملف: a.title || a.name, التصنيف: a.category, المصدر: srcOf(a).label, "تاريخ المستند": fmtDate(a.docDate), "ينتهي في": fmtDate(a.expiresAt), الوسوم: a.tags, "أُضيف بواسطة": a.createdBy, "تاريخ الإضافة": fmtDate(a.createdAt) }))} />}<PackBtn from={from} to={to} entity={tab === "general" ? "archive" : entity} category={category} />{W && <button className="btn primary sm" onClick={() => setUp(true)}>＋ أرشفة مستند</button>}</div></div>
        {data?.byKind?.length > 1 && <div className="card-b row arch-kinds" style={{ gap: 6, paddingBottom: 0 }}>{data.byKind.map((k: any) => <button key={k.label} className={"chip" + ((k.general ? category === k.k && (tab === "general" || entity === "archive") : entity === k.k && !category) ? " on" : "")} title={fmtSize(Number(k.bytes))} onClick={() => { if (k.general) { setCategory(category === k.k ? "" : k.k); if (tab === "all") setEntity("archive"); } else { setCategory(""); setEntity(entity === k.k ? "" : k.k); if (tab !== "all") setTab("all"); } }}>{k.label} <b className="num">{k.n}</b></button>)}</div>}
        <div className="card-b toolbar"><div className="search grow" style={{ minWidth: 220 }}><span className="ic">🔍</span><input className="input" placeholder="بحث باسم الملف، العنوان، الوسوم، رقم المستند، اسم العميل أو المورد…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          {tab === "all" && <Select value={entity} onChange={(e) => setEntity(e.target.value)} style={{ width: "auto" }}><option value="">كل المصادر</option>{Object.entries(ENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
          <Select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: "auto" }}><option value="">كل التصنيفات</option>{(data?.categories || []).map((c: string) => <option key={c} value={c}>{c}</option>)}</Select>
          <DateRange from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} /></div>
        {loading && !data ? <Loading /> : !data?.rows.length ? <Empty text={tab === "expiring" ? "لا توجد مستندات تنتهي قريباً ✓" : "لا توجد مستندات — المرفقات على الفواتير والمصروفات والسندات تظهر هنا تلقائياً"} /> : (
          <div className="table-wrap"><table className="tbl"><thead><tr><th>الملف</th><th>التصنيف</th><th>المصدر</th><th>تاريخ المستند</th><th>ينتهي في</th><th>أُضيف</th><th></th></tr></thead>
            <tbody>{data.rows.map((a: any) => { const s = srcOf(a); const days = a.expiresAt ? Math.round((Date.parse(String(a.expiresAt).slice(0, 10)) - Date.parse(today())) / 86400000) : null; return (
              <tr key={a.id}><td><a style={{ cursor: "pointer", fontWeight: 600 }} onClick={() => openFile(a.id, a.name).catch((e) => toast(e.message, "err"))}>{ICON(a.mime)} {a.title || a.name}</a><div className="small muted">{a.title ? `${a.name} · ` : ""}{fmtSize(a.size)}{a.tags && <> · {String(a.tags).split(/[,،]/).map((t: string) => <span key={t} className="badge" style={{ marginInlineStart: 3 }}>{t.trim()}</span>)}</>}</div>{a.notes && <div className="small">{a.notes}</div>}</td>
                <td>{a.category || <span className="muted">{ENT[a.entity]}</span>}</td><td className="small">{s.to ? <Link to={s.to}>{s.label}</Link> : s.label}{a.amount && <div className="muted num">{Number(a.amount).toLocaleString("en", { minimumFractionDigits: 2 })}</div>}</td>
                <td className="num small">{fmtDate(a.docDate)}</td><td className="small">{a.expiresAt ? <span className={"badge " + (days! < 0 ? "red" : days! <= 30 ? "amber" : "green")}>{fmtDate(a.expiresAt)} · {days! < 0 ? "منتهٍ" : `${days} يوم`}</span> : "—"}</td>
                <td className="small">{a.createdBy}<div className="muted">{fmtDate(a.createdAt)}</div></td>
                <td><div className="row" style={{ gap: 2, flexWrap: "nowrap" }}><button className="btn sm ghost" title="تنزيل" onClick={() => openFile(a.id, a.name, true).catch((e) => toast(e.message, "err"))}>⬇</button>{W && <button className="btn sm ghost" title="تصنيف ووسوم وتاريخ انتهاء" onClick={() => setEdit(a)}>✎</button>}</div></td></tr>); })}</tbody></table></div>)}
      </div> : <div className="card">
        <div className="card-h"><h3>مستندات ناقصة — فواتير مشتريات ومصروفات بلا مرفق</h3><div className="row"><DateRange from={mFrom} to={mTo} onChange={(a, b) => { setMFrom(a); setMTo(b); }} />{missing.data && <ExportBtn name="مستندات ناقصة" rows={() => missing.data!.map((m) => ({ النوع: m.label, الرقم: m.number, التاريخ: fmtDate(m.date), الطرف: m.party, الإجمالي: Number(m.total) }))} />}</div></div>
        <div className="card-b small muted">خصم ضريبة المدخلات والمراجعة يتطلبان الاحتفاظ بالفاتورة الأصلية. افتح المستند وأرفق صورته، أو أرسلها للمساعد الذكي فيُرفقها تلقائياً.</div>
        {missing.loading ? <Loading /> : !missing.data?.length ? <Empty text="كل فواتير المشتريات والمصروفات في الفترة لها مرفقات ✓" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>النوع</th><th>الرقم</th><th>التاريخ</th><th>الطرف / البيان</th><th className="n">الإجمالي</th><th></th></tr></thead>
          <tbody>{missing.data.map((m) => <tr key={m.id}><td>{m.label}</td><td className="num">{m.number}</td><td className="num">{fmtDate(m.date)}</td><td>{m.party}</td><td className="n"><Money v={m.total} /></td><td><Link className="btn sm ghost" to={m.entity === "invoice" ? `/doc/${m.id}` : "/expenses"}>فتح وإرفاق ←</Link></td></tr>)}</tbody>
          <tfoot><tr><td colSpan={4}>{missing.data.length} مستند</td><td className="n"><Money v={missing.data.reduce((a, m) => a + Number(m.total), 0)} /></td><td /></tr></tfoot></table></div>}
      </div>}
      {up && <ArchiveUpload categories={data?.categories || []} onClose={(s) => { setUp(false); if (s) reload(); }} />}
      {edit && <ArchiveMeta a={edit} categories={data?.categories || []} onClose={(s) => { setEdit(null); if (s) reload(); }} />}
    </div>
  );
}
function MetaFields({ f, setF, categories }: { f: any; setF: (x: any) => void; categories: string[] }) {
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return <>
    <Field label="العنوان" span2><Input value={f.title || ""} onChange={s("title")} placeholder="مثال: السجل التجاري — تجديد 2026" /></Field>
    <Field label="التصنيف"><Select value={f.category || ""} onChange={s("category")}><option value="">—</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
    <Field label="تاريخ المستند"><Input type="date" value={f.docDate ? String(f.docDate).slice(0, 10) : ""} onChange={s("docDate")} /></Field>
    <Field label="تاريخ الانتهاء" hint="للتنبيه قبل انتهاء السجل أو الرخصة أو العقد"><Input type="date" value={f.expiresAt ? String(f.expiresAt).slice(0, 10) : ""} onChange={s("expiresAt")} /></Field>
    <Field label="وسوم" hint="افصل بفاصلة"><Input value={f.tags || ""} onChange={s("tags")} placeholder="بلدية، 2026" /></Field>
    <Field label="ملاحظات" span3><Input value={f.notes || ""} onChange={s("notes")} /></Field>
  </>;
}
/** One ZIP for the auditor: the period's documents in a folder per kind, with an index sheet and the list of what is missing. */
function PackBtn({ from, to, entity, category }: { from: string; to: string; entity: string; category: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    const f = from || yearStart(), t = to || today();
    if (!confirmDlg(`تنزيل حزمة المستندات من ${f} إلى ${t}${entity || category ? " (حسب الفلتر الحالي)" : ""} في ملف ZIP واحد؟`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/archive/pack${q({ from: f, to: t, entity, category })}`, { headers: { Authorization: `Bearer ${session.token}` } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "تعذّر إنشاء الحزمة");
      const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = `أرشيف ${f} إلى ${t}.zip`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(`تم تجهيز ${r.headers.get("X-Files") || ""} ملفاً مع الفهرس`);
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  return <button className="btn sm" disabled={busy} title="كل مستندات الفترة في مجلدات مع فهرس — لتسليمها للمراجع" onClick={go}>{busy ? "…جارٍ التجهيز" : "📦 حزمة المراجع (ZIP)"}</button>;
}
function ArchiveUpload({ categories, onClose }: { categories: string[]; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ category: "عقد" });
  const [files, setFiles] = useState<File[]>([]);
  const inp = useRef<HTMLInputElement>(null);
  return (
    <Modal title="أرشفة مستند للمنشأة" onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !files.length} onClick={() => run(async () => { for (const file of files) { if (file.size > 8 * 1048576) throw new Error(`«${file.name}» أكبر من 8 ميجابايت`); const body = { ...f, title: files.length > 1 && f.title ? `${f.title} — ${file.name}` : f.title, name: file.name, mime: file.type || "application/octet-stream", data: await readB64(file) };
        try { await api("/archive/upload", { body }); } catch (e: any) { if (e?.code !== "DUPLICATE") throw e; if (confirmDlg(`${e.message}\n\nحفظ نسخة ثانية من «${file.name}»؟`)) await api("/archive/upload", { body: { ...body, allowDuplicate: true } }); } } onClose(true); }, "تمت الأرشفة")}>حفظ في الأرشيف</button></>}>
      <div className="attach" style={{ marginTop: 0 }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setFiles(Array.from(e.dataTransfer.files)); }}>
        <div className="row between"><b>{files.length ? files.map((x) => x.name).join("، ") : "اسحب الملفات هنا (صور، PDF، Word، Excel — حتى 8 ميجابايت)"}</b><button className="btn sm" onClick={() => inp.current?.click()}>اختيار ملفات</button><input ref={inp} hidden type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} /></div>
      </div>
      <div className="form-grid mt"><MetaFields f={f} setF={setF} categories={categories} /></div>
      <p className="small muted">مرفقات الفواتير والمصروفات والسندات تُضاف من المستند نفسه وتظهر في الأرشيف تلقائياً.</p>
    </Modal>
  );
}
function ArchiveMeta({ a, categories, onClose }: { a: any; categories: string[]; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ title: a.title, category: a.category, tags: a.tags, notes: a.notes, docDate: a.docDate, expiresAt: a.expiresAt });
  return (
    <Modal title={`بيانات الأرشفة: ${a.name}`} onClose={() => onClose()} footer={<>
      <button className="btn danger sm" onClick={() => run(async () => { if (!confirmDlg(`حذف «${a.name}» نهائياً؟`)) return; await api(`/attachments/file/${a.id}`, { method: "DELETE" }); onClose(true); })}>حذف الملف</button><div className="grow" />
      <button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api(`/archive/${a.id}`, { method: "PUT", body: { ...f, category: f.category || "", docDate: f.docDate ? String(f.docDate).slice(0, 10) : null, expiresAt: f.expiresAt ? String(f.expiresAt).slice(0, 10) : null } }); onClose(true); }, "تم الحفظ")}>حفظ</button></>}>
      <div className="form-grid"><MetaFields f={f} setF={setF} categories={categories} /></div>
    </Modal>
  );
}
