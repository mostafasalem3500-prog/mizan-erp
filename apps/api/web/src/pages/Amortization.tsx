/** Amortisation schedules: prepaid expenses and deferred revenue spread over the months they cover. */
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api, useFetch, useAction, useNewParam, Money, money, Loading, Empty, Modal, Field, Input, Select, NumInput, Picker, accountFetcher, partnerFetcher, today, fmtDate, confirmDlg } from "../lib";

const KIND = { PREPAID: "مصروف مدفوع مقدماً", DEFERRED: "إيراد مؤجل" } as const;
const STATUS: Record<string, string> = { ACTIVE: "نشط", DONE: "اكتمل", CANCELLED: "موقوف" };
const STATUS_CLS: Record<string, string> = { ACTIVE: "blue", DONE: "green", CANCELLED: "" };

export function AmortizationPage() {
  const { data, loading, reload } = useFetch<any[]>("/amortizations");
  const [form, setForm] = useState(false), [view, setView] = useState<string | null>(null);
  const { run, busy } = useAction();
  useNewParam(() => setForm(true));
  const rows = data || [];
  const due = rows.reduce((s, a) => s + (a.dueMonths || 0), 0);
  const active = rows.filter((a) => a.status === "ACTIVE");
  return (
    <div className="grid" data-amort>
      <div className="card">
        <div className="card-h">
          <div><h3>المصروفات المدفوعة مقدماً والإيرادات المؤجلة</h3>
            <div className="small muted">مبلغ يغطي عدة أشهر (إيجار سنة، تأمين، اشتراك، عقد صيانة مقبوض مقدماً) يُوزَّع على أشهره بقيد في نهاية كل شهر.</div></div>
          <div className="row">
            {due > 0 && <button className="btn" disabled={busy} data-run onClick={() => run(async () => { const r = await api("/amortizations/run", { body: {} }); reload(); return r; }, "رُحّلت الأشهر المستحقة")}>ترحيل الأشهر المستحقة ({due})</button>}
            <button className="btn primary" onClick={() => setForm(true)}>＋ جدول جديد</button>
          </div>
        </div>
        <div className="card-b">
          <div className="grid c3" style={{ marginBottom: 12 }}>
            <div className="kpi card"><div className="label">مدفوع مقدماً متبقٍّ</div><div className="value"><Money v={active.filter((a) => a.kind === "PREPAID").reduce((s, a) => s + a.remaining, 0)} /></div></div>
            <div className="kpi card"><div className="label">إيراد مؤجل متبقٍّ</div><div className="value"><Money v={active.filter((a) => a.kind === "DEFERRED").reduce((s, a) => s + a.remaining, 0)} /></div></div>
            <div className="kpi card"><div className="label">أشهر مستحقة لم تُرحَّل</div><div className="value">{due}</div><div className="sub">الجداول التلقائية تُرحَّل وحدها كل شهر</div></div>
          </div>
          {loading && !data ? <Loading /> : !rows.length ? <Empty text="لا توجد جداول بعد — أضف أول جدول (مثال: إيجار المعرض لسنة مدفوع مقدماً)" /> : (
            <div className="table-wrap"><table className="tbl">
              <thead><tr><th>الرقم</th><th>الوصف</th><th>النوع</th><th className="n">المبلغ</th><th className="n">القسط الشهري</th><th>الأشهر</th><th className="n">المتبقي</th><th>ينتهي</th><th>الحالة</th></tr></thead>
              <tbody>{rows.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => setView(a.id)}>
                  <td className="num">{a.number}</td>
                  <td><b>{a.name}</b>{a.partnerName && <div className="small muted">{a.partnerName}</div>}<div className="small muted">{a.tgtCode} {a.tgtName}{a.costCenterName ? ` · ${a.costCenterName}` : ""}</div></td>
                  <td>{KIND[a.kind as keyof typeof KIND]}</td>
                  <td className="n"><Money v={a.total} /></td>
                  <td className="n"><Money v={a.monthly} /></td>
                  <td><span className="num">{a.postedMonths}/{a.months}</span>{a.dueMonths > 0 && <span className="badge amber" style={{ marginInlineStart: 6 }}>مستحق {a.dueMonths}</span>}</td>
                  <td className="n"><Money v={a.remaining} /></td>
                  <td className="dt">{fmtDate(a.endDate)}</td>
                  <td><span className={"badge " + STATUS_CLS[a.status]}>{STATUS[a.status]}</span>{a.status === "ACTIVE" && !a.auto && <div className="small muted">ترحيل يدوي</div>}</td>
                </tr>))}</tbody>
            </table></div>)}
        </div>
      </div>
      {form && <AmortForm onClose={() => setForm(false)} onSaved={(id) => { setForm(false); reload(); setView(id); }} />}
      {view && <AmortView id={view} onClose={() => setView(null)} onChanged={reload} />}
    </div>
  );
}

function AmortForm({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState<any>({ kind: "PREPAID", name: "", total: "", months: 12, startDate: today().slice(0, 8) + "01", auto: true, payNow: true, vat: "" });
  const [target, setTarget] = useState<any>(null), [cash, setCash] = useState<any>(null), [partner, setPartner] = useState<any>(null);
  const [centre, setCentre] = useState("");
  const [prev, setPrev] = useState<any>(null);
  const centres = useFetch<any[]>("/cost-centers");
  const { run, busy } = useAction();
  const set = (k: string) => (e: any) => { setPrev(null); setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }); };
  const pre = f.kind === "PREPAID";
  const body = () => ({ kind: f.kind, name: f.name, total: Number(f.total), months: Number(f.months), startDate: f.startDate, targetAccountId: target?.id, costCenterId: centre || null, partnerId: partner?.id || null, auto: f.auto, payAccountId: f.payNow ? cash?.id : null, vat: f.payNow ? Number(f.vat || 0) : 0 });
  const monthly = Number(f.total) > 0 && Number(f.months) > 0 ? Number(f.total) / Number(f.months) : 0;
  return (
    <Modal wide title="جدول إطفاء جديد" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>إلغاء</button>
      <button className="btn" disabled={busy} data-preview-btn onClick={() => run(async () => setPrev(await api("/amortizations/preview", { body: body() })))}>معاينة القيود</button>
      <button className="btn primary" disabled={busy} onClick={() => run(async () => { const a = await api("/amortizations", { body: body() }); onSaved(a.id); }, "حُفظ الجدول")}>حفظ</button></>}>
      <div className="chip-toggle mb" role="group" aria-label="النوع">
        {(["PREPAID", "DEFERRED"] as const).map((k) => <button key={k} type="button" className={f.kind === k ? "on" : ""} aria-pressed={f.kind === k} onClick={() => { setPrev(null); setTarget(null); setPartner(null); setF({ ...f, kind: k }); }}>{KIND[k]}</button>)}
      </div>
      <div className="alert info small mb">{pre
        ? "دفعت مبلغاً يغطي عدة أشهر (إيجار سنة، تأمين، اشتراك سنوي): يُسجَّل أصلاً في «مصروفات مدفوعة مقدماً» ثم يتحول إلى مصروف شهراً بشهر."
        : "قبضت مبلغاً عن خدمة تُقدَّم على عدة أشهر (عقد صيانة سنوي، اشتراك): يُسجَّل التزاماً في «إيرادات مؤجلة» ثم يتحول إلى إيراد مع كل شهر تُقدَّم فيه الخدمة."}</div>
      <div className="form-grid">
        <Field label="الوصف"><Input value={f.name} onChange={set("name")} placeholder={pre ? "مثال: إيجار المعرض من يناير إلى ديسمبر" : "مثال: عقد صيانة سنوي — شركة الأفق"} autoFocus /></Field>
        <Field label="المبلغ قبل الضريبة"><NumInput value={f.total} onChange={set("total")} /></Field>
        <Field label="عدد الأشهر" hint={monthly ? `القسط الشهري ${money(monthly)}` : undefined}><NumInput value={f.months} onChange={set("months")} /></Field>
        <Field label="أول شهر"><Input type="date" value={f.startDate} onChange={set("startDate")} /></Field>
        <Field label={pre ? "حساب المصروف (يُحمَّل عليه كل شهر)" : "حساب الإيراد (يُثبت فيه كل شهر)"}>
          <Picker value={target} onChange={(a) => { setPrev(null); setTarget(a); }} fetcher={accountFetcher((a: any) => a.type === (pre ? "EXPENSE" : "REVENUE"))} label={(a: any) => `${a.code} ${a.nameAr}`} placeholder="اختر الحساب" /></Field>
        <Field label="مركز التكلفة / المشروع (اختياري)"><Select value={centre} onChange={(e) => { setPrev(null); setCentre(e.target.value); }}><option value="">— عام —</option>{(centres.data || []).filter((c: any) => c.status !== "CLOSED").map((c: any) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</Select></Field>
        <Field label={pre ? "المورد (اختياري)" : "العميل (اختياري)"}><Picker value={partner} onChange={(x) => { setPrev(null); setPartner(x); }} fetcher={partnerFetcher(pre ? "SUPPLIER" : "CUSTOMER")} label={(x: any) => x.name} placeholder="بحث بالاسم" /></Field>
      </div>
      <label className="row mt"><input type="checkbox" checked={f.payNow} onChange={set("payNow")} /> {pre ? "سجّل الدفع الآن من صندوق أو بنك" : "سجّل القبض الآن في صندوق أو بنك"}</label>
      {f.payNow ? <div className="form-grid mt">
        <Field label={pre ? "دُفع من" : "قُبض في"}><Picker value={cash} onChange={(a) => { setPrev(null); setCash(a); }} fetcher={accountFetcher((a: any) => a.isCashBank)} label={(a: any) => `${a.code} ${a.nameAr}`} placeholder="الصندوق أو البنك" /></Field>
        <Field label="ضريبة القيمة المضافة (إن وُجدت)" hint={pre ? "تُسجَّل ضريبة مدخلات عند الدفع" : "تُسجَّل ضريبة مخرجات عند القبض"}><NumInput value={f.vat} onChange={set("vat")} /></Field>
      </div> : <div className="small muted mt">المبلغ مسجَّل مسبقاً في حساب {pre ? "المصروفات المدفوعة مقدماً" : "الإيرادات المؤجلة"} (مثلاً من سند صرف أو قيد)، والجدول يوزّعه فقط.</div>}
      <label className="row mt"><input type="checkbox" checked={f.auto} onChange={set("auto")} /> ترحيل تلقائي لكل شهر عند انتهائه</label>
      {prev && <div className="mt" data-amort-preview>
        <div className="small muted mb">القسط الشهري <b><Money v={prev.monthly} /></b> · آخر شهر {fmtDate(prev.endDate)} · {prev.schedule.length} شهراً. القيود التالية للدفع وأول شهر (لم يُحفظ شيء):</div>
        <div className="table-wrap"><table className="tbl compact"><thead><tr><th>التاريخ</th><th>الحساب</th><th className="n">مدين</th><th className="n">دائن</th></tr></thead>
          <tbody>{prev.lines.map((l: any, i: number) => <tr key={i}><td className="dt">{fmtDate(l.date)}</td><td>{l.code} {l.nameAr}</td><td className="n">{Number(l.debit) ? <Money v={l.debit} /> : ""}</td><td className="n">{Number(l.credit) ? <Money v={l.credit} /> : ""}</td></tr>)}</tbody></table></div>
      </div>}
    </Modal>
  );
}

function AmortView({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data: a, reload } = useFetch<any>(`/amortizations/${id}`, [id]);
  const { run, busy } = useAction();
  const [endDate, setEndDate] = useState(today());
  const act = async (fn: () => Promise<any>, msg: string) => { await run(fn, msg); reload(); onChanged(); };
  if (!a) return <Modal title="جدول الإطفاء" onClose={onClose}><Loading /></Modal>;
  const due = a.lines.filter((l: any) => !l.posted && l.periodEnd <= today()).length;
  return (
    <Modal wide title={`${a.number} — ${a.name}`} onClose={onClose} footer={<>
      {a.status === "ACTIVE" && due > 0 && <button className="btn primary" disabled={busy} onClick={() => act(() => api("/amortizations/run", { body: { id } }), "رُحّلت الأشهر المستحقة")}>ترحيل المستحق ({due})</button>}
      {a.status === "ACTIVE" && a.postedMonths === 0 && <button className="btn danger" disabled={busy} onClick={() => confirmDlg(a.payEntry ? "حذف الجدول؟ سيُعكس قيد الدفع/القبض المسجّل معه." : "حذف الجدول؟") && act(async () => { await api(`/amortizations/${id}`, { method: "DELETE" }); onClose(); }, "حُذف الجدول")}>حذف</button>}
      {a.status === "ACTIVE" && <button className="btn" disabled={busy} onClick={() => confirmDlg("إيقاف الجدول؟ لن يُرحَّل شيء بعد الآن، ويبقى المتبقي في الحساب الوسيط.") && act(() => api(`/amortizations/${id}/cancel`, { body: {} }), "أُوقف الجدول")}>إيقاف</button>}
      <button className="btn" onClick={onClose}>إغلاق</button></>}>
      <div className="grid c3 mb">
        <div className="kpi card"><div className="label">{KIND[a.kind as keyof typeof KIND]}</div><div className="value"><Money v={a.total} /></div><div className="sub">{a.months} شهراً × <Money v={a.monthly} /></div></div>
        <div className="kpi card"><div className="label">رُحّل</div><div className="value"><Money v={a.postedAmount} /></div><div className="sub">{a.postedMonths} من {a.months} شهراً</div></div>
        <div className="kpi card"><div className="label">المتبقي في {a.srcName}</div><div className="value"><Money v={a.remaining} /></div><div className="sub">{STATUS[a.status]}{a.status === "ACTIVE" ? (a.auto ? " · تلقائي" : " · يدوي") : ""}</div></div>
      </div>
      <div className="small muted mb row" style={{ gap: 14 }}>
        <span>قيد نهاية كل شهر:</span>
        <span>مدين <b>{a.kind === "PREPAID" ? `${a.tgtCode} ${a.tgtName}` : `${a.srcCode} ${a.srcName}`}</b></span>
        <span>دائن <b>{a.kind === "PREPAID" ? `${a.srcCode} ${a.srcName}` : `${a.tgtCode} ${a.tgtName}`}</b></span>
        {a.payEntry && <span>{a.kind === "PREPAID" ? "قيد الدفع" : "قيد القبض"} <Link to={`/journals/${a.payEntry.id}`} className="num">{a.payEntry.number}</Link></span>}</div>
      <div className="table-wrap"><table className="tbl compact" data-schedule><thead><tr><th>#</th><th>الشهر</th><th className="n">القسط</th><th>القيد</th><th className="n">المتبقي بعده</th></tr></thead>
        <tbody>{a.lines.map((l: any) => <tr key={l.n} className={l.posted ? "" : "muted"}>
          <td className="num">{l.n}</td><td className="dt">{fmtDate(l.periodEnd)}</td><td className="n"><Money v={l.amount} /></td>
          <td>{l.posted ? <Link to={`/journals/${l.entryId}`} className="num">{l.entryNumber}</Link> : l.periodEnd <= today() ? <span className="badge amber">مستحق</span> : "قادم"}</td>
          <td className="n">{l.posted ? <Money v={l.balanceAfter} /> : ""}</td></tr>)}</tbody></table></div>
      {a.status === "ACTIVE" && <div className="row mt" style={{ alignItems: "end" }}>
        <Field label="إنهاء مبكر بتاريخ" hint="عند انتهاء العقد أو إلغائه: يُرحَّل المتبقي كله دفعة واحدة"><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
        <button className="btn" disabled={busy} onClick={() => confirmDlg(`ترحيل المتبقي (${money(a.remaining)}) بتاريخ ${endDate} وإنهاء الجدول؟`) && act(() => api(`/amortizations/${id}/finish`, { body: { date: endDate } }), "أُنهي الجدول")}>إنهاء وترحيل المتبقي</button>
      </div>}
    </Modal>
  );
}
