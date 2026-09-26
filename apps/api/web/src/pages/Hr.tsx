import React, { useState } from "react";
import { api, q, useFetch, Money, money, Loading, Empty, Badge, Modal, Field, Input, Select, NumInput, Picker, accountFetcher, useAction, useCompanyContext, ExportBtn, PrintBtn, today, fmtDate, confirmDlg } from "../lib";
import { amountToArabicWords } from "../shared/tafqeet";

const d1 = (v: any) => Math.round(Number(v || 0) * 10) / 10;
const LEAVE_AR: Record<string, string> = { ANNUAL: "سنوية", SICK: "مرضية", UNPAID: "بدون راتب", OTHER: "أخرى" };
const LS: Record<string, string> = { ACTIVE: "نشطة", SETTLED: "مسددة", CANCELLED: "ملغاة" };
const PS: Record<string, string> = { DRAFT: "مسودة", POSTED: "مرحّل", PAID: "مصروف" };

function EmpSelect({ value, onChange, emps, autoFocus }: { value: string; onChange: (id: string) => void; emps: any[]; autoFocus?: boolean }) {
  return <Select autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)}><option value="">— اختر الموظف —</option>{emps.filter((e) => e.isActive).map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}</Select>;
}

// ─── Leaves ────────────────────────────────────────────────────────────────
export function LeavesTab({ emps }: { emps: any[] }) {
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const leaves = useFetch("/hr/leaves");
  const pos = useFetch("/hr/positions");
  const [add, setAdd] = useState(false);
  return (
    <div className="grid c2">
      <div className="card"><div className="card-h"><div><h3>أرصدة الإجازات السنوية</h3><div className="small muted">21 يوماً سنوياً، و30 يوماً بعد 5 سنوات خدمة (المادة 109) — الرصيد = رصيد أول المدة + المستحق − المستخدم</div></div></div>
        {!pos.data ? <Loading /> : !pos.data.rows.length ? <Empty text="لا يوجد موظفون" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الموظف</th><th className="n">سنوات الخدمة</th><th className="n">المستحق</th><th className="n">المستخدم</th><th className="n">الرصيد (يوم)</th><th className="n">قيمة الرصيد</th></tr></thead>
          <tbody>{pos.data.rows.map((r: any) => <tr key={r.employeeId}><td>{r.name}<div className="small muted">{r.code}{r.hireDate ? ` · تعيين ${r.hireDate}` : " · بدون تاريخ تعيين"}</div></td><td className="n">{r.years}</td><td className="n">{d1(r.leaveAccrued)}</td><td className="n">{d1(r.leaveTaken)}</td><td className="n"><b className={r.leaveDays < 0 ? "neg-val" : ""}>{d1(r.leaveDays)}</b></td><td className="n"><Money v={r.leaveDue} /></td></tr>)}</tbody></table></div>}
      </div>
      <div className="card"><div className="card-h"><h3>سجل الإجازات</h3>{can("accounting.write") && <button className="btn primary sm" onClick={() => setAdd(true)}>＋ تسجيل إجازة</button>}</div>
        {!leaves.data ? <Loading /> : !leaves.data.length ? <Empty text="لم تُسجل إجازات بعد" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الموظف</th><th>النوع</th><th>من</th><th>إلى</th><th className="n">الأيام</th><th /></tr></thead>
          <tbody>{leaves.data.map((l: any) => <tr key={l.id}><td>{l.employeeName}</td><td>{LEAVE_AR[l.type]}</td><td>{fmtDate(l.fromDate)}</td><td>{fmtDate(l.toDate)}</td><td className="n">{Number(l.days)}</td><td>{can("accounting.write") && <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { if (confirmDlg("حذف الإجازة؟")) { await api(`/hr/leaves/${l.id}`, { method: "DELETE" }); leaves.reload(); pos.reload(); } })}>حذف</button>}</td></tr>)}</tbody></table></div>}
      </div>
      {add && <LeaveForm emps={emps} onClose={(s) => { setAdd(false); if (s) { leaves.reload(); pos.reload(); } }} />}
    </div>
  );
}

function LeaveForm({ emps, onClose }: { emps: any[]; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ employeeId: "", type: "ANNUAL", fromDate: today(), toDate: today(), days: "", notes: "" });
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const autoDays = f.fromDate && f.toDate && f.toDate >= f.fromDate ? Math.round((Date.parse(f.toDate) - Date.parse(f.fromDate)) / 86400000) + 1 : 0;
  return (
    <Modal narrow title="تسجيل إجازة" onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !f.employeeId} onClick={() => run(async () => { await api("/hr/leaves", { body: f }); onClose(true); }, "تم تسجيل الإجازة")}>حفظ</button></>}>
      <div className="grid">
        <Field label="الموظف"><EmpSelect autoFocus value={f.employeeId} onChange={(v) => setF({ ...f, employeeId: v })} emps={emps} /></Field>
        <Field label="النوع" hint="السنوية فقط تُخصم من الرصيد؛ بدون راتب تُدخل كغياب في المسير"><Select value={f.type} onChange={s("type")}>{Object.entries(LEAVE_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <div className="form-grid"><Field label="من"><Input type="date" value={f.fromDate} onChange={s("fromDate")} /></Field><Field label="إلى"><Input type="date" value={f.toDate} onChange={s("toDate")} /></Field></div>
        <Field label={`عدد الأيام (تلقائي: ${autoDays})`}><NumInput value={f.days} placeholder={String(autoDays)} onChange={s("days")} /></Field>
        <Field label="ملاحظات"><Input value={f.notes} onChange={s("notes")} /></Field>
      </div>
    </Modal>
  );
}

// ─── Loans ─────────────────────────────────────────────────────────────────
export function LoansTab({ emps }: { emps: any[] }) {
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const loans = useFetch("/hr/loans");
  const [add, setAdd] = useState(false);
  return (
    <div className="card"><div className="card-h"><div><h3>سلف الموظفين</h3><div className="small muted">تُقيد السلفة على حساب سلف وعهد الموظفين، ويُخصم القسط تلقائياً من مسير الرواتب ابتداءً من الشهر المحدد</div></div>{can("payments.write") && <button className="btn primary sm" onClick={() => setAdd(true)}>＋ سلفة جديدة</button>}</div>
      {!loans.data ? <Loading /> : !loans.data.length ? <Empty text="لا توجد سلف" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الرقم</th><th>الموظف</th><th>التاريخ</th><th className="n">المبلغ</th><th className="n">القسط الشهري</th><th className="n">المسدد</th><th className="n">المتبقي</th><th>بداية الخصم</th><th>القيد</th><th>الحالة</th><th /></tr></thead>
        <tbody>{loans.data.map((l: any) => <tr key={l.id} className={l.status !== "ACTIVE" ? "muted" : ""}><td>{l.number}</td><td><b>{l.employeeName}</b></td><td>{fmtDate(l.date)}</td><td className="n"><Money v={l.amount} /></td><td className="n"><Money v={l.installment} /></td><td className="n"><Money v={l.paid} /></td><td className="n"><b><Money v={l.amount - l.paid} /></b></td><td>{l.startPeriod}</td><td>{l.journalNumber}</td><td><Badge s={l.status} map={LS} /></td><td>{can("payments.write") && l.status === "ACTIVE" && Number(l.paid) === 0 && <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { if (confirmDlg("إلغاء السلفة وعكس قيدها؟")) { await api(`/hr/loans/${l.id}/cancel`, { body: {} }); loans.reload(); } }, "تم الإلغاء")}>إلغاء</button>}</td></tr>)}</tbody></table></div>}
      {add && <LoanForm emps={emps} onClose={(s) => { setAdd(false); if (s) loans.reload(); }} />}
    </div>
  );
}

function LoanForm({ emps, onClose }: { emps: any[]; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ employeeId: "", date: today(), amount: "", installment: "", startPeriod: "", notes: "" });
  const [acc, setAcc] = useState<any>(null);
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const months = Number(f.amount) && Number(f.installment) ? Math.ceil(Number(f.amount) / Number(f.installment)) : 0;
  return (
    <Modal narrow title="سلفة موظف" onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !f.employeeId || !acc || !Number(f.amount)} onClick={() => run(async () => { await api("/hr/loans", { body: { ...f, accountId: acc.id } }); onClose(true); }, "تم صرف السلفة وقيدها")}>صرف السلفة</button></>}>
      <div className="grid">
        <Field label="الموظف"><EmpSelect autoFocus value={f.employeeId} onChange={(v) => setF({ ...f, employeeId: v })} emps={emps} /></Field>
        <div className="form-grid"><Field label="التاريخ"><Input type="date" value={f.date} onChange={s("date")} /></Field><Field label="بداية الخصم (شهر)"><Input type="month" value={f.startPeriod} onChange={s("startPeriod")} /></Field></div>
        <div className="form-grid"><Field label="مبلغ السلفة"><NumInput value={f.amount} onChange={s("amount")} /></Field><Field label="القسط الشهري" hint={months ? `${months} شهر` : ""}><NumInput value={f.installment} onChange={s("installment")} /></Field></div>
        <Field label="الصرف من"><Picker value={acc} onChange={setAcc} fetcher={accountFetcher((a) => a.isCashBank)} label={(a: any) => `${a.code} ${a.nameAr}`} /></Field>
        <Field label="ملاحظات"><Input value={f.notes} onChange={s("notes")} /></Field>
      </div>
    </Modal>
  );
}

// ─── Monthly provisions ────────────────────────────────────────────────────
export function ProvisionsTab() {
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const list = useFetch("/hr/provisions");
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [showNew, setShowNew] = useState(false);
  const preview = useFetch(showNew ? `/hr/provisions/preview${q({ period })}` : null, [period]);
  const [view, setView] = useState<any>(null);
  const pv = preview.data;
  return (
    <div className="grid">
      <div className="card"><div className="card-h"><div><h3>مخصصات نهاية الخدمة والإجازات</h3><div className="small muted">كل شهر يُرفع مخصص كل موظف إلى كامل استحقاقه في نهاية الشهر: نهاية الخدمة (نصف شهر عن كل سنة من الخمس الأولى ثم شهر عن كل سنة — المادة 84) وبدل الإجازات (رصيد الأيام × الأجر ÷ 30)</div></div>{can("accounting.write") && !showNew && <button className="btn primary sm" onClick={() => setShowNew(true)}>＋ قيد مخصصات شهري</button>}</div>
        {showNew && <div className="card-b" style={{ background: "var(--primary-soft)" }}>
          <div className="row mb"><Field label="الشهر"><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field><div className="grow" /><button className="btn" onClick={() => setShowNew(false)}>إغلاق</button><button className="btn primary" disabled={busy || !pv?.lines?.length} onClick={() => run(async () => { const r = await api("/hr/provisions", { body: { period } }); await api(`/hr/provisions/${r.id}/post`, { body: {} }); setShowNew(false); list.reload(); }, "تم إنشاء قيد المخصصات وترحيله")}>إنشاء وترحيل القيد</button></div>
          {!pv ? <Loading /> : <ProvisionTable lines={pv.lines} totalEosb={pv.totalEosb} totalLeave={pv.totalLeave} />}
        </div>}
        {!list.data ? <Loading /> : !list.data.length ? <Empty text="لم تُسجل مخصصات بعد" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الشهر</th><th>التاريخ</th><th className="n">الموظفون</th><th className="n">مخصص نهاية الخدمة</th><th className="n">مخصص الإجازات</th><th>القيد</th><th>الحالة</th><th /></tr></thead>
          <tbody>{list.data.map((r: any) => <tr key={r.id}><td><b>{r.period}</b></td><td>{fmtDate(r.date)}</td><td className="n">{r.lines.length}</td><td className="n"><Money v={r.totalEosb} sign /></td><td className="n"><Money v={r.totalLeave} sign /></td><td>{r.journalNumber}</td><td><Badge s={r.status} map={PS} /></td><td className="row" style={{ gap: 4 }}><button className="btn sm" onClick={() => setView(r)}>عرض</button>{can("accounting.write") && r.status === "DRAFT" && <><button className="btn sm primary" disabled={busy} onClick={() => run(async () => { await api(`/hr/provisions/${r.id}/post`, { body: {} }); list.reload(); }, "تم الترحيل")}>ترحيل</button><button className="btn sm ghost" onClick={() => run(async () => { if (confirmDlg("حذف القيد؟")) { await api(`/hr/provisions/${r.id}`, { method: "DELETE" }); list.reload(); } })}>حذف</button></>}</td></tr>)}</tbody></table></div>}
      </div>
      {view && <Modal wide title={`مخصصات ${view.period}`} onClose={() => setView(null)} footer={<><PrintBtn /><ExportBtn name={`مخصصات ${view.period}`} rows={() => view.lines.map((l: any) => ({ الكود: l.code, الاسم: l.name, الأجر: l.wage, "سنوات الخدمة": l.years, "استحقاق نهاية الخدمة": l.eosbDue, "المخصص السابق": l.eosbBal, "إضافة الشهر": l.eosbAmount, "رصيد الإجازات": l.leaveDays, "استحقاق الإجازات": l.leaveDue, "مخصص الإجازات السابق": l.leaveBal, "إضافة الشهر (إجازات)": l.leaveAmount }))} /><button className="btn" onClick={() => setView(null)}>إغلاق</button></>}><div className="print-doc" style={{ padding: 0 }}><ProvisionTable lines={view.lines} totalEosb={view.totalEosb} totalLeave={view.totalLeave} /></div></Modal>}
    </div>
  );
}

function ProvisionTable({ lines, totalEosb, totalLeave }: { lines: any[]; totalEosb: number; totalLeave: number }) {
  return (
    <div className="table-wrap"><table className="tbl compact"><thead><tr><th rowSpan={2}>الموظف</th><th rowSpan={2} className="n">الأجر</th><th rowSpan={2} className="n">سنوات الخدمة</th><th colSpan={3} style={{ textAlign: "center" }}>مكافأة نهاية الخدمة</th><th colSpan={4} style={{ textAlign: "center" }}>الإجازات</th></tr><tr><th className="n">الاستحقاق</th><th className="n">المخصص السابق</th><th className="n">قيد الشهر</th><th className="n">الرصيد (يوم)</th><th className="n">الاستحقاق</th><th className="n">المخصص السابق</th><th className="n">قيد الشهر</th></tr></thead>
      <tbody>{lines.map((l: any) => <tr key={l.employeeId}><td>{l.name}<div className="small muted">{l.code}</div></td><td className="n"><Money v={l.wage} /></td><td className="n">{l.years}</td><td className="n"><Money v={l.eosbDue} /></td><td className="n"><Money v={l.eosbBal} /></td><td className="n"><b><Money v={l.eosbAmount} sign /></b></td><td className="n">{d1(l.leaveDays)}</td><td className="n"><Money v={l.leaveDue} /></td><td className="n"><Money v={l.leaveBal} /></td><td className="n"><b><Money v={l.leaveAmount} sign /></b></td></tr>)}</tbody>
      <tfoot><tr><td colSpan={5}>الإجمالي</td><td className="n"><Money v={totalEosb} sign /></td><td colSpan={3} /><td className="n"><Money v={totalLeave} sign /></td></tr></tfoot></table></div>
  );
}

// ─── Final settlements ─────────────────────────────────────────────────────
export function SettlementsTab({ emps, onChanged }: { emps: any[]; onChanged: () => void }) {
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const list = useFetch("/hr/settlements");
  const [add, setAdd] = useState(false);
  const [view, setView] = useState<any>(null);
  const [pay, setPay] = useState<any>(null);
  return (
    <div className="card"><div className="card-h"><div><h3>تصفية مستحقات نهاية الخدمة</h3><div className="small muted">المادة 84 (إنهاء/انتهاء العقد: كامل المكافأة) · المادة 85 (استقالة: لا شيء تحت سنتين، الثلث من 2–5، الثلثان من 5–10، الكامل بعد 10) · المادة 80: بدون مكافأة</div></div>{can("accounting.write") && <button className="btn primary sm" onClick={() => setAdd(true)}>＋ تصفية جديدة</button>}</div>
      {!list.data ? <Loading /> : !list.data.length ? <Empty text="لا توجد تصفيات" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الرقم</th><th>الموظف</th><th>التاريخ</th><th>السبب</th><th className="n">نهاية الخدمة</th><th className="n">بدل إجازات</th><th className="n">راتب</th><th className="n">سلف</th><th className="n">الصافي</th><th>القيد</th><th>الحالة</th><th /></tr></thead>
        <tbody>{list.data.map((s: any) => <tr key={s.id}><td>{s.number}</td><td><b>{s.employeeName}</b></td><td>{fmtDate(s.date)}</td><td>{s.data.reasonAr}</td><td className="n"><Money v={s.data.eosbDue} /></td><td className="n"><Money v={s.data.leaveAmount} /></td><td className="n"><Money v={s.data.salaryAmount} /></td><td className="n"><Money v={s.data.loans} blankZero /></td><td className="n"><b><Money v={s.net} /></b></td><td>{s.journalNumber}</td><td><Badge s={s.status} map={PS} /></td>
          <td className="row" style={{ gap: 4 }}><button className="btn sm" onClick={() => setView(s)}>عرض</button>{can("accounting.write") && s.status === "DRAFT" && <><button className="btn sm primary" disabled={busy} onClick={() => run(async () => { if (confirmDlg(`ترحيل التصفية وإنهاء خدمة ${s.employeeName}؟`)) { await api(`/hr/settlements/${s.id}/post`, { body: {} }); list.reload(); onChanged(); } }, "تم ترحيل التصفية وإنهاء الخدمة")}>ترحيل</button><button className="btn sm ghost" onClick={() => run(async () => { if (confirmDlg("حذف التصفية؟")) { await api(`/hr/settlements/${s.id}`, { method: "DELETE" }); list.reload(); } })}>حذف</button></>}{can("payments.write") && s.status === "POSTED" && <button className="btn sm accent" onClick={() => setPay(s)}>صرف</button>}</td></tr>)}</tbody></table></div>}
      {add && <SettlementForm emps={emps} onClose={(s) => { setAdd(false); if (s) list.reload(); }} />}
      {view && <SettlementView s={view} onClose={() => setView(null)} />}
      {pay && <SettlementPayModal s={pay} onClose={(ok) => { setPay(null); if (ok) list.reload(); }} />}
    </div>
  );
}

function SettlementPayModal({ s, onClose }: { s: any; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const [acc, setAcc] = useState<any>(null);
  const [date, setDate] = useState(today());
  return (
    <Modal narrow title={`صرف تصفية ${s.employeeName}`} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !acc} onClick={() => run(async () => { await api(`/hr/settlements/${s.id}/pay`, { body: { accountId: acc.id, date } }); onClose(true); }, "تم قيد الصرف")}>تأكيد الصرف</button></>}>
      <div className="grid"><div className="stat-list"><div className="item"><span>صافي المستحقات</span><b><Money v={s.net} /></b></div></div><Field label="من حساب"><Picker value={acc} onChange={setAcc} fetcher={accountFetcher((a) => a.isCashBank)} label={(a: any) => `${a.code} ${a.nameAr}`} /></Field><Field label="التاريخ"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field></div>
    </Modal>
  );
}

function SettlementForm({ emps, onClose }: { emps: any[]; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ employeeId: "", date: today(), reason: "TERMINATION", salaryDays: 0, otherAdditions: "", otherDeductions: "", notes: "" });
  const [calc, setCalc] = useState<any>(null);
  const s = (k: string) => (e: any) => { setF({ ...f, [k]: e.target.value }); setCalc(null); };
  const reasons: Record<string, string> = { TERMINATION: "إنهاء من صاحب العمل", CONTRACT_END: "انتهاء العقد", RESIGNATION: "استقالة", ART80: "فصل وفق المادة 80 (بدون مكافأة)" };
  return (
    <Modal wide title="تصفية مستحقات نهاية الخدمة" onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn" disabled={busy || !f.employeeId} onClick={() => run(async () => setCalc(await api("/hr/settlements/compute", { body: f })))}>احتساب</button><button className="btn primary" disabled={busy || !calc} onClick={() => run(async () => { await api("/hr/settlements", { body: f }); onClose(true); }, "تم حفظ التصفية (مسودة)")}>حفظ التصفية</button></>}>
      <div className="form-grid">
        <Field label="الموظف" span2><EmpSelect autoFocus value={f.employeeId} onChange={(v) => { setF({ ...f, employeeId: v }); setCalc(null); }} emps={emps} /></Field>
        <Field label="تاريخ انتهاء الخدمة"><Input type="date" value={f.date} onChange={s("date")} /></Field>
        <Field label="سبب انتهاء الخدمة"><Select value={f.reason} onChange={s("reason")}>{Object.entries(reasons).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="أيام الراتب غير المدفوعة في الشهر الأخير" hint="تُحتسب على أساس الأجر ÷ 30"><NumInput value={f.salaryDays} onChange={s("salaryDays")} /></Field>
        <Field label="إضافات أخرى"><NumInput value={f.otherAdditions} onChange={s("otherAdditions")} /></Field>
        <Field label="خصومات أخرى"><NumInput value={f.otherDeductions} onChange={s("otherDeductions")} /></Field>
        <Field label="ملاحظات"><Input value={f.notes} onChange={s("notes")} /></Field>
      </div>
      {calc && <SettlementBreakdown s={calc} />}
    </Modal>
  );
}

function SettlementBreakdown({ s }: { s: any }) {
  const R = ({ l, v, b, sub }: { l: string; v: any; b?: boolean; sub?: string }) => <div className="item"><span>{l}{sub && <div className="small muted">{sub}</div>}</span>{b ? <b><Money v={v} /></b> : <Money v={v} />}</div>;
  return (
    <div className="grid c2 mt">
      <div className="stat-list">
        <R l="الأجر الشامل (أساسي + بدلات)" v={s.wage} />
        <div className="item"><span>مدة الخدمة</span><b>{s.years} سنة</b></div>
        <R l="مكافأة نهاية الخدمة الكاملة (م. 84)" v={s.eosbFull} />
        <R l={`المستحق حسب السبب (${s.reasonAr})`} v={s.eosbDue} b />
        <R l="بدل الإجازات غير المستخدمة" v={s.leaveAmount} b sub={`${d1(s.leaveDays)} يوم × ${money(s.wage / 30)}`} />
        <R l="راتب أيام العمل الأخيرة" v={s.salaryAmount} sub={`${s.salaryDays} يوم`} />
      </div>
      <div className="stat-list">
        <R l="إضافات أخرى" v={s.otherAdditions} />
        <R l="(−) سلف قائمة" v={s.loans} />
        <R l="(−) خصومات أخرى" v={s.otherDeductions} />
        <div className="item" style={{ background: "var(--primary-soft)" }}><span><b>صافي المستحق للموظف</b></span><b style={{ fontSize: 18 }}><Money v={s.net} /></b></div>
        <div className="small muted">المخصص المكوّن: نهاية خدمة <Money v={s.eosbBal} /> · إجازات <Money v={s.leaveBal} /> — يُحرَّر بالكامل عند الترحيل ويُحمَّل الفرق على المصروف.</div>
      </div>
    </div>
  );
}

function SettlementView({ s, onClose }: { s: any; onClose: () => void }) {
  const { me } = useCompanyContext();
  const d = s.data;
  return (
    <Modal wide title={`تصفية ${s.number} — ${s.employeeName}`} onClose={onClose} footer={<><PrintBtn /><button className="btn" onClick={onClose}>إغلاق</button></>}>
      <div className="print-doc" style={{ padding: 0 }}>
        <div className="print-only"><h2>{me.company.nameAr}</h2><h3>مخالصة نهائية / تصفية مستحقات نهاية الخدمة</h3></div>
        <div className="row small muted mb"><span>الموظف: <b>{s.employeeName}</b> ({s.employeeCode})</span><span>تاريخ انتهاء الخدمة: {fmtDate(s.date)}</span><span>السبب: {d.reasonAr}</span><span>تاريخ التعيين: {d.hireDate}</span></div>
        <SettlementBreakdown s={d} />
        <div className="mt"><b>{amountToArabicWords(Number(s.net))}</b></div>
        <div className="print-only mt" style={{ display: "flex", justifyContent: "space-between", paddingTop: 40 }}><span>توقيع الموظف: ..........................</span><span>المحاسب: ..........................</span><span>المدير: ..........................</span></div>
        <div className="print-only small mt">أقر أنا الموظف باستلام كامل مستحقاتي المبينة أعلاه ولا يحق لي المطالبة بأي مبالغ أخرى.</div>
      </div>
    </Modal>
  );
}

// ─── Employee HR file ──────────────────────────────────────────────────────
export function EmployeeStatement({ e, onClose }: { e: any; onClose: () => void }) {
  const { data: d } = useFetch(`/hr/employees/${e.id}/statement`);
  if (!d) return <Modal title={e.name} onClose={onClose}><Loading /></Modal>;
  const p = d.position;
  return (
    <Modal wide title={`ملف الموظف — ${e.name}`} onClose={onClose} footer={<><PrintBtn /><button className="btn" onClick={onClose}>إغلاق</button></>}>
      <div className="print-doc" style={{ padding: 0 }}>
        <div className="grid c4">
          <div className="card kpi"><div className="label">الأجر الشامل</div><div className="value"><Money v={p.wage} /></div><div className="sub">سنوات الخدمة: {p.years}</div></div>
          <div className="card kpi info"><div className="label">استحقاق نهاية الخدمة</div><div className="value"><Money v={p.eosbDue} /></div><div className="sub">المخصص: {money(p.eosbBal)}</div></div>
          <div className="card kpi success"><div className="label">رصيد الإجازات</div><div className="value">{d1(p.leaveDays)} يوم</div><div className="sub">قيمته: {money(p.leaveDue)} · المخصص: {money(p.leaveBal)}</div></div>
          <div className="card kpi danger"><div className="label">سلف قائمة</div><div className="value"><Money v={p.loans} /></div></div>
        </div>
        <div className="grid c2 mt">
          <div className="card"><div className="card-h"><h3>قسائم الرواتب</h3></div><div className="table-wrap"><table className="tbl compact"><thead><tr><th>الشهر</th><th className="n">الإجمالي</th><th className="n">تأمينات</th><th className="n">خصومات</th><th className="n">سلف</th><th className="n">الصافي</th><th>الحالة</th></tr></thead><tbody>{d.payslips.map((r: any) => <tr key={r.period}><td>{r.period}</td><td className="n"><Money v={r.gross} /></td><td className="n"><Money v={r.gosiEmp} blankZero /></td><td className="n"><Money v={Number(r.deduction) + Number(r.absence)} blankZero /></td><td className="n"><Money v={r.loan} blankZero /></td><td className="n"><b><Money v={r.net} /></b></td><td><Badge s={r.status} map={PS} /></td></tr>)}{!d.payslips.length && <tr><td className="muted" colSpan={7}>—</td></tr>}</tbody></table></div></div>
          <div className="grid">
            <div className="card"><div className="card-h"><h3>الإجازات</h3></div><div className="table-wrap"><table className="tbl compact"><tbody>{d.leaves.map((l: any) => <tr key={l.id}><td>{LEAVE_AR[l.type]}</td><td>{fmtDate(l.fromDate)} — {fmtDate(l.toDate)}</td><td className="n">{Number(l.days)} يوم</td></tr>)}{!d.leaves.length && <tr><td className="muted">—</td></tr>}</tbody></table></div></div>
            <div className="card"><div className="card-h"><h3>حركة المخصصات</h3></div><div className="table-wrap"><table className="tbl compact"><tbody>{d.ledger.map((l: any) => <tr key={l.id}><td>{fmtDate(l.date)}</td><td>{l.type === "EOSB" ? "نهاية خدمة" : "إجازات"} · {({ PROVISION: "مخصص شهري", SETTLEMENT: "تصفية", OPENING: "رصيد افتتاحي" } as any)[l.sourceType] || l.sourceType}</td><td className="n"><Money v={l.amount} sign /></td></tr>)}{!d.ledger.length && <tr><td className="muted">—</td></tr>}</tbody></table></div></div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
