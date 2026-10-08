import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, q, useFetch, Money, money, Loading, Empty, Badge, Modal, Field, Input, Select, useAction, useToast, useCompanyContext, ExportBtn, PrintBtn, today, fmtDate, fmtDT, addMonths, SearchBox, FilterInfo, matches, useSorted, Th } from "../lib";
import { StatementModal } from "./Master";

const CH: Record<string, string> = { WHATSAPP: "واتساب", EMAIL: "بريد", CALL: "اتصال", NOTE: "ملاحظة" };
const waLink = (phone: string, text: string) => { let p = String(phone || "").replace(/\D/g, ""); if (p.startsWith("05")) p = "966" + p.slice(1); if (p.startsWith("5") && p.length === 9) p = "966" + p; return `https://wa.me/${p}?text=${encodeURIComponent(text)}`; };

export function CollectionsPage() {
  const { can } = useCompanyContext();
  const { data, reload } = useFetch("/collections");
  const mail = useFetch("/mail/status");
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<any>(null);
  const [stmt, setStmt] = useState<any>(null);
  const [bulk, setBulk] = useState(false);
  const [filter, setFilter] = useState<"overdue" | "all">("overdue");
  const [text, setText] = useState("");
  const [age, setAge] = useState("");
  const [rem, setRem] = useState("");
  const rows0 = (data || []).filter((r: any) => (filter === "all" || r.overdue > 0) && matches(r, text, ["name", "phone", "email"]) && (!age || (age === "30" ? r.daysOverdue > 0 && r.daysOverdue <= 30 : age === "60" ? r.daysOverdue > 30 && r.daysOverdue <= 60 : age === "90" ? r.daysOverdue > 60 && r.daysOverdue <= 90 : r.daysOverdue > 90)) && (!rem || (rem === "never" ? !r.lastReminder : rem === "old" ? !r.lastReminder || new Date(r.lastReminder.at).getTime() < Date.now() - 7 * 864e5 : !!r.lastReminder)));
  const srt = useSorted(rows0);
  if (!data) return <Loading />;
  const rows = srt.sorted;
  const tot = (k: string) => rows.reduce((a: number, r: any) => a + Number(r[k] || 0), 0);
  const selected = rows.filter((r: any) => sel[r.id]);
  return (
    <div className="grid">
      <div className="grid c4">
        <div className="card kpi danger"><div className="label">متأخر عن السداد</div><div className="value"><Money v={tot("overdue")} /></div><div className="sub">{data.filter((r: any) => r.overdue > 0).length} عميل</div></div>
        <div className="card kpi"><div className="label">إجمالي الذمم المفتوحة</div><div className="value"><Money v={data.reduce((a: number, r: any) => a + r.due, 0)} /></div><div className="sub">{data.length} عميل</div></div>
        <div className="card kpi info"><div className="label">تذكيرات آخر 30 يوماً</div><div className="value">{data.reduce((a: number, r: any) => a + Number(r.reminders30 || 0), 0)}</div></div>
        <div className="card kpi success"><div className="label">البريد الإلكتروني</div><div className="value" style={{ fontSize: 16 }}>{mail.data?.configured ? "مفعّل ✓" : "غير مفعّل"}</div><div className="sub">{mail.data?.configured ? mail.data.from : "اضبط SMTP على الخادم لإرسال الفواتير والكشوف"}</div></div>
      </div>
      <div className="card">
        <div className="card-h"><div><h3>التحصيل ومتابعة العملاء</h3><div className="small muted">رسالة تذكير جاهزة بروابط الفواتير تُرسل عبر واتساب أو البريد، وسجل للمتابعات</div></div>
          <div className="row"><Select value={filter} onChange={(e) => setFilter(e.target.value as any)} style={{ width: 170 }}><option value="overdue">المتأخرون فقط</option><option value="all">كل الذمم المفتوحة</option></Select><button className="btn sm" disabled={!selected.length} onClick={() => setBulk(true)}>🖨 كشوف حساب للمحدد ({selected.length})</button><ExportBtn name="التحصيل" rows={() => rows.map((r: any) => ({ العميل: r.name, الجوال: r.phone, البريد: r.email, "المستحق": r.due, "المتأخر": r.overdue, "أقدم استحقاق": r.oldestDue, "أيام التأخير": r.daysOverdue, "آخر تذكير": r.lastReminder ? `${CH[r.lastReminder.channel]} ${fmtDate(r.lastReminder.at)}` : "" }))} /></div></div>
        <div className="card-b" style={{ paddingBottom: 0 }}><div className="toolbar"><SearchBox value={text} onChange={setText} placeholder="بحث باسم العميل / الجوال / البريد" /><Select value={age} onChange={(e) => setAge(e.target.value)}><option value="">كل فترات التأخير</option><option value="30">1–30 يوم</option><option value="60">31–60 يوم</option><option value="90">61–90 يوم</option><option value="120">أكثر من 90 يوم</option></Select><Select value={rem} onChange={(e) => setRem(e.target.value)}><option value="">كل حالات التذكير</option><option value="never">لم يُذكَّروا أبداً</option><option value="old">لم يُذكَّروا منذ أسبوع</option><option value="done">ذُكِّروا</option></Select><FilterInfo shown={rows.length} total={data.filter((r: any) => filter === "all" || r.overdue > 0).length} active={!!(text || age || rem)} onClear={() => { setText(""); setAge(""); setRem(""); }} /></div></div>
        {!rows.length ? <Empty text={text || age || rem ? "لا نتائج مطابقة" : "لا توجد ذمم متأخرة 🎉"} /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th><input type="checkbox" onChange={(e) => { const s: Record<string, boolean> = {}; if (e.target.checked) rows.forEach((r: any) => (s[r.id] = true)); setSel(s); }} /></th><Th k="name" s={srt}>العميل</Th><th>التواصل</th><Th k="invoices" s={srt} n>الفواتير</Th><Th k="due" s={srt} n>المستحق</Th><Th k="overdue" s={srt} n>المتأخر</Th><Th k="daysOverdue" s={srt}>أقدم استحقاق</Th><th>آخر تذكير</th><th /></tr></thead>
          <tbody>{rows.map((r: any) => <tr key={r.id} className={r.daysOverdue > 60 ? "bold" : ""}><td><input type="checkbox" checked={!!sel[r.id]} onChange={(e) => setSel({ ...sel, [r.id]: e.target.checked })} /></td><td><b>{r.name}</b>{Number(r.creditLimit) > 0 && r.due > Number(r.creditLimit) && <span className="badge red" style={{ marginInlineStart: 6 }}>تجاوز الحد</span>}</td><td className="small num">{r.phone}{r.email && <div dir="ltr" style={{ textAlign: "end" }}>{r.email}</div>}</td><td className="n">{r.invoices}</td><td className="n"><Money v={r.due} /></td><td className={"n " + (r.overdue ? "neg-val" : "")}><Money v={r.overdue} blankZero /></td><td>{r.oldestDue ? <>{fmtDate(r.oldestDue)}<div className="small muted">متأخر {r.daysOverdue} يوم</div></> : <span className="muted">غير مستحق</span>}</td><td className="small">{r.lastReminder ? <>{CH[r.lastReminder.channel]} · {fmtDate(r.lastReminder.at)}<div className="muted">{r.lastReminder.by}</div></> : <span className="muted">—</span>}</td>
            <td className="row" style={{ gap: 4 }}><button className="btn sm primary" onClick={() => setMsg(r)}>تذكير</button><button className="btn sm" onClick={() => setStmt(r)}>كشف حساب</button></td></tr>)}</tbody>
          <tfoot><tr><td colSpan={4}>الإجمالي</td><td className="n"><Money v={tot("due")} /></td><td className="n"><Money v={tot("overdue")} /></td><td colSpan={3} /></tr></tfoot></table></div>}
      </div>
      {msg && <ReminderModal partner={msg} mailOk={!!mail.data?.configured} onClose={(s) => { setMsg(null); if (s) reload(); }} />}
      {stmt && <StatementModal partner={stmt} role="CUSTOMER" onClose={() => setStmt(null)} />}
      {bulk && <BulkStatements partners={selected} onClose={() => setBulk(false)} />}
    </div>
  );
}

function ReminderModal({ partner, mailOk, onClose }: { partner: any; mailOk: boolean; onClose: (s?: boolean) => void }) {
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const toast = useToast();
  const { data: m } = useFetch(`/collections/${partner.id}/message`);
  const history = useFetch(`/collections/${partner.id}/history`);
  const [text, setText] = useState("");
  const [to, setTo] = useState(partner.email || "");
  const [note, setNote] = useState("");
  useEffect(() => { if (m) setText(m.text); }, [m]);
  if (!m) return <Modal title={partner.name} onClose={() => onClose()}><Loading /></Modal>;
  const log = (channel: string, body: string, extra: any = {}) => run(async () => { await api(`/collections/${partner.id}/reminders`, { body: { channel, body, amountDue: m.due, subject: m.subject, ...extra } }); history.reload(); }, channel === "EMAIL" ? "تم إرسال البريد وتسجيله" : "تم التسجيل");
  return (
    <Modal wide title={`تذكير بالسداد — ${partner.name}`} onClose={() => onClose(true)} footer={<><button className="btn" onClick={() => onClose(true)}>إغلاق</button></>}>
      <div className="grid c2">
        <div>
          <div className="stat-list mb"><div className="item"><span>إجمالي المستحق</span><b><Money v={m.due} /></b></div><div className="item"><span>المتأخر</span><b className="neg-val"><Money v={m.overdue} /></b></div><div className="item"><span>الفواتير المفتوحة</span><b>{m.invoices.length}</b></div></div>
          <Field label="نص الرسالة (قابل للتعديل)"><textarea className="input" rows={12} value={text} onChange={(e) => setText(e.target.value)} style={{ fontFamily: "inherit", lineHeight: 1.6 }} /></Field>
          <div className="row mt" style={{ flexWrap: "wrap" }}>
            {partner.phone ? <a className="btn primary" href={waLink(partner.phone, text)} target="_blank" rel="noreferrer" onClick={() => can("sales.write") && log("WHATSAPP", text)}>📱 إرسال عبر واتساب</a> : <span className="muted small">لا يوجد جوال للعميل</span>}
            <button className="btn" onClick={() => { navigator.clipboard?.writeText(text); toast("تم نسخ الرسالة", "ok"); }}>نسخ النص</button>
          </div>
          <div className="row mt" style={{ alignItems: "flex-end" }}><Field label="إرسال بالبريد إلى"><Input value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" placeholder="name@company.com" /></Field><button className="btn accent" disabled={busy || !mailOk || !to || !can("sales.write")} title={mailOk ? "" : "خدمة البريد غير مفعّلة على الخادم"} onClick={() => log("EMAIL", text, { to })}>✉ إرسال بالبريد</button></div>
          {!mailOk && <div className="hint">لتفعيل البريد اضبط متغيرات SMTP على الخادم (Railway → Variables): SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.</div>}
        </div>
        <div>
          <b>الفواتير المفتوحة</b>
          <table className="tbl compact mt"><thead><tr><th>الفاتورة</th><th>الاستحقاق</th><th className="n">المتبقي</th></tr></thead><tbody>{m.invoices.map((i: any) => <tr key={i.number}><td><Link to={`/doc/${i.id || ""}`}>{i.number}</Link></td><td className={String(i.dueDate).slice(0, 10) < today() ? "neg-val" : ""}>{fmtDate(i.dueDate)}</td><td className="n"><Money v={i.due} /></td></tr>)}</tbody></table>
          <div className="row mt" style={{ alignItems: "flex-end" }}><Field label="تسجيل اتصال / ملاحظة متابعة"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: وعد بالسداد يوم الخميس" /></Field><button className="btn sm" disabled={busy || !note || !can("sales.write")} onClick={() => { log("CALL", note); setNote(""); }}>حفظ</button></div>
          <b className="mt" style={{ display: "block" }}>سجل المتابعة</b>
          {!history.data ? <Loading /> : !history.data.length ? <div className="muted small">لا توجد متابعات سابقة</div> : <div className="ok-list card mt" style={{ maxHeight: 260, overflow: "auto" }}>{history.data.map((h: any) => <div key={h.id} className="item"><span className="badge blue">{CH[h.channel]}</span><div className="grow small">{h.body?.slice(0, 120)}{h.body?.length > 120 ? "…" : ""}<div className="muted">{fmtDT(h.createdAt)} · {h.sentBy}{h.amountDue ? ` · المستحق ${money(h.amountDue)}` : ""}</div></div></div>)}</div>}
        </div>
      </div>
    </Modal>
  );
}

/** Prints statements for several customers in one go. */
function BulkStatements({ partners, onClose }: { partners: any[]; onClose: () => void }) {
  const { me } = useCompanyContext();
  const [from, setFrom] = useState(addMonths(today().slice(0, 7) + "-01", -12));
  const [to, setTo] = useState(today());
  const [data, setData] = useState<any[] | null>(null);
  useEffect(() => { Promise.all(partners.map((p) => api(`/reports/statement/${p.id}${q({ from, to, role: "CUSTOMER" })}`))).then(setData); }, [from, to]);
  return (
    <Modal wide title={`كشوف حساب — ${partners.length} عميل`} onClose={onClose} footer={<><div className="row no-print"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div><div className="grow" /><PrintBtn /><button className="btn" onClick={onClose}>إغلاق</button></>}>
      {!data ? <Loading /> : data.map((st: any) => (
        <div key={st.partner.id} className="print-doc" style={{ padding: 0, marginBottom: 24, pageBreakAfter: "always" }}>
          <div className="row between"><div><h3>{me.company.nameAr}</h3><div className="small muted">كشف حساب عميل — {from} إلى {to}</div></div><div style={{ textAlign: "start" }}><b>{st.partner.name}</b><div className="small muted">{st.partner.phone}{st.partner.vatNumber ? ` · ${st.partner.vatNumber}` : ""}</div></div></div>
          <table className="tbl compact mt"><thead><tr><th>التاريخ</th><th>المستند</th><th>البيان</th><th className="n">مدين</th><th className="n">دائن</th><th className="n">الرصيد</th></tr></thead>
            <tbody><tr><td colSpan={5}>رصيد أول المدة</td><td className="n"><Money v={st.opening} /></td></tr>{st.rows.map((r: any, i: number) => <tr key={i}><td className="dt">{fmtDate(r.date)}</td><td>{r.number}</td><td>{r.memo}</td><td className="n"><Money v={r.debit} blankZero /></td><td className="n"><Money v={r.credit} blankZero /></td><td className="n"><Money v={r.balance} /></td></tr>)}</tbody>
            <tfoot><tr><td colSpan={5}>الرصيد المستحق</td><td className="n"><Money v={st.closing} /></td></tr></tfoot></table>
        </div>))}
    </Modal>
  );
}
