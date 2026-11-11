/** Payroll transactions of the month (overtime, bonuses, absence, lateness, penalties), the payslip, and loan repayment / rescheduling. */
import React, { useEffect, useState } from "react";
import { api, q, useFetch, useAction, useToast, useCompanyContext, Modal, Field, Input, Select, NumInput, Picker, accountFetcher, Money, money, Empty, Loading, ExportBtn, PrintBtn, today, fmtDate, confirmDlg, SearchBox, matches } from "../lib";
import { CFG } from "../shared/country";

const UNIT: Record<string, string> = { hours: "ساعة", days: "يوم" };
export const KIND_AR: Record<string, string> = { OVERTIME: "عمل إضافي", BONUS: "مكافأة", COMMISSION: "عمولة", ALLOWANCE: "بدل لمرة واحدة", ABSENCE: "غياب", LATE: "تأخير", PENALTY: "جزاء", DEDUCTION: "خصم آخر" };
const EARN = ["OVERTIME", "BONUS", "COMMISSION", "ALLOWANCE"];

export function PayrollItemsTab({ emps }: { emps: any[] }) {
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [text, setText] = useState("");
  const [kind, setKind] = useState("");
  const { data, loading, reload } = useFetch<any>(`/payroll-items${q({ period })}`, [period]);
  const [edit, setEdit] = useState<any>(null);
  const W = can("accounting.write");
  const rows = (data?.rows || []).filter((r: any) => matches(r, text, ["employeeName", "employeeCode", "note"]) && (!kind || r.kind === kind));
  const tot = (ks: string[]) => rows.filter((r: any) => ks.includes(r.kind)).reduce((a: number, r: any) => a + Number(r.amount), 0);
  const earn = tot(EARN), ded = rows.reduce((a: number, r: any) => a + Number(r.amount), 0) - earn;
  return (
    <div className="grid">
      <div className="kpis">
        <div className="card kpi accent"><div className="label">إضافات الشهر</div><div className="value num pos-val">{money(earn)}</div><div className="small muted">إضافي {money(tot(["OVERTIME"]))} · مكافآت وعمولات {money(tot(["BONUS", "COMMISSION", "ALLOWANCE"]))}</div></div>
        <div className="card kpi"><div className="label">حسميات الشهر</div><div className="value num neg-val">{money(ded)}</div><div className="small muted">غياب {money(tot(["ABSENCE"]))} · تأخير وجزاءات {money(tot(["LATE", "PENALTY"]))} · أخرى {money(tot(["DEDUCTION"]))}</div></div>
        <div className="card kpi"><div className="label">عدد الحركات</div><div className="value num">{rows.length}</div><div className="small muted">{rows.filter((r: any) => r.status === "OPEN").length} لم تدخل مسيراً بعد</div></div>
      </div>
      <div className="card"><div className="card-h"><div><h3>الإضافي والحسميات</h3><div className="small muted">تُسجَّل خلال الشهر وتدخل مسير رواتبه تلقائياً. العمل الإضافي = الساعات × (أجر الساعة + {Math.round(((data?.overtimeFactor || 1.5) - 1) * 100)}% من أجر الساعة الأساسي)، والغياب = الأيام × (الأجر ÷ 30).</div></div>
        <div className="row">{data && <ExportBtn name={`الإضافي والحسميات ${period}`} rows={() => rows.map((r: any) => ({ الكود: r.employeeCode, الموظف: r.employeeName, التاريخ: fmtDate(r.date), النوع: KIND_AR[r.kind], الكمية: r.qty, المعامل: r.factor, المبلغ: (EARN.includes(r.kind) ? 1 : -1) * Number(r.amount), ملاحظة: r.note, الحالة: r.status === "OPEN" ? "لم تدخل مسيراً" : `في مسير ${r.runPeriod || ""}` }))} />}{W && <button className="btn primary sm" onClick={() => setEdit({ kind: "OVERTIME", date: today(), period })}>＋ حركة جديدة</button>}</div></div>
        <div className="card-b" style={{ paddingBottom: 0 }}><div className="toolbar"><Field label="الشهر"><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field><SearchBox value={text} onChange={setText} placeholder="بحث بالموظف أو الملاحظة" /><Select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">كل الأنواع</option>{Object.entries(KIND_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div></div>
        {loading && !data ? <Loading /> : !rows.length ? <Empty text="لا توجد حركات لهذا الشهر" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>التاريخ</th><th>الموظف</th><th>النوع</th><th className="n">الكمية</th><th className="n">المبلغ</th><th>ملاحظة</th><th>الحالة</th><th /></tr></thead>
          <tbody>{rows.map((r: any) => <tr key={r.id}><td className="dt">{fmtDate(r.date)}</td><td><b>{r.employeeName}</b><div className="small muted">{r.employeeCode}</div></td><td><span className={"badge " + (EARN.includes(r.kind) ? "green" : "red")}>{KIND_AR[r.kind]}</span></td><td className="n">{r.qty ? `${Number(r.qty)} ${UNIT[data.kinds[r.kind].unit] || ""}${r.kind === "OVERTIME" && r.factor ? ` ×${Number(r.factor)}` : ""}` : "—"}</td><td className={"n " + (EARN.includes(r.kind) ? "pos-val" : "neg-val")}><Money v={r.amount} />{r.manual && <span className="small muted" title="مبلغ مُدخل يدوياً"> ✎</span>}</td><td className="small">{r.note}</td><td>{r.status === "OPEN" ? <span className="badge amber">لم تدخل مسيراً</span> : <span className="badge">مسير {r.runPeriod}</span>}</td>
            <td className="row" style={{ gap: 4 }}>{W && r.status === "OPEN" && <><button className="btn sm" onClick={() => setEdit({ ...r, date: fmtDate(r.date), qty: r.qty === null ? "" : Number(r.qty), amount: r.manual ? Number(r.amount) : "" })}>تعديل</button><button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { if (!confirmDlg("حذف الحركة؟")) return; await api(`/payroll-items/${r.id}`, { method: "DELETE" }); reload(); })}>حذف</button></>}</td></tr>)}</tbody></table></div>}
      </div>
      {edit && <ItemForm item={edit} emps={emps} kinds={data?.kinds || {}} factor={data?.overtimeFactor || 1.5} onClose={(s) => { setEdit(null); if (s) reload(); }} />}
    </div>
  );
}
function ItemForm({ item, emps, kinds, factor, onClose }: { item: any; emps: any[]; kinds: any; factor: number; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ employeeId: item.employeeId || "", kind: item.kind, date: item.date || today(), period: item.period || today().slice(0, 7), qty: item.qty ?? "", factor: item.factor ? Number(item.factor) : factor, amount: item.amount ?? "", note: item.note || "" });
  const [qt, setQt] = useState<any>(null);
  const unit = kinds[f.kind]?.unit as string | null;
  useEffect(() => { let on = true; if (f.employeeId && unit && Number(f.qty) > 0) api("/payroll-items/quote", { body: { employeeId: f.employeeId, kind: f.kind, qty: Number(f.qty), factor: Number(f.factor) } }).then((r) => on && setQt(r)).catch(() => undefined); else if (f.employeeId) api("/payroll-items/quote", { body: { employeeId: f.employeeId, kind: "X", qty: 0 } }).then((r) => on && setQt({ ...r, amount: 0 })).catch(() => undefined); else setQt(null); return () => { on = false; }; }, [f.employeeId, f.kind, f.qty, f.factor]);
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const final = Number(f.amount) > 0 ? Number(f.amount) : qt?.amount || 0;
  return (
    <Modal title={item.id ? "تعديل حركة راتب" : "حركة راتب جديدة"} onClose={() => onClose()} footer={<><span className="grow">المبلغ: <b className={"num " + (EARN.includes(f.kind) ? "pos-val" : "neg-val")}>{money(final)}</b></span><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !f.employeeId || !(final > 0)} onClick={() => run(async () => { const body = { ...f, qty: unit ? f.qty : undefined, amount: f.amount === "" ? undefined : f.amount }; if (item.id) await api(`/payroll-items/${item.id}`, { method: "PUT", body }); else await api("/payroll-items", { body }); onClose(true); }, "حُفظت الحركة")}>حفظ</button></>}>
      <div className="form-grid">
        <Field label="الموظف" span2><Select autoFocus value={f.employeeId} onChange={s("employeeId")}><option value="">— اختر —</option>{emps.filter((e) => e.isActive || e.id === f.employeeId).map((e) => <option key={e.id} value={e.id}>{e.code} {e.name}</option>)}</Select></Field>
        <Field label="النوع"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, qty: "", amount: "" })}><optgroup label="إضافات">{EARN.map((k) => <option key={k} value={k}>{KIND_AR[k]}</option>)}</optgroup><optgroup label="حسميات">{Object.keys(KIND_AR).filter((k) => !EARN.includes(k)).map((k) => <option key={k} value={k}>{KIND_AR[k]}</option>)}</optgroup></Select></Field>
        <Field label="التاريخ"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value, period: e.target.value.slice(0, 7) })} /></Field>
        <Field label="يدخل مسير شهر"><Input type="month" value={f.period} onChange={s("period")} /></Field>
        {unit && <Field label={unit === "hours" ? "عدد الساعات" : "عدد الأيام"}><NumInput value={f.qty} onChange={s("qty")} /></Field>}
        {f.kind === "OVERTIME" && <Field label="المعامل" hint="1.5 للساعة الإضافية"><Select value={String(f.factor)} onChange={s("factor")}>{[...new Set([factor, 1.25, 1.35, 1.5, 1.7, 2])].sort().map((x) => <option key={x} value={x}>× {x}</option>)}</Select></Field>}
        <Field label={unit ? "مبلغ مختلف (اختياري)" : "المبلغ"} hint={unit ? "اتركه فارغاً ليُحتسب من الأجر" : undefined}><NumInput value={f.amount} onChange={s("amount")} placeholder={unit && qt?.amount ? money(qt.amount) : ""} /></Field>
        <Field label="ملاحظة / السبب" span3><Input value={f.note} onChange={s("note")} placeholder={f.kind === "PENALTY" ? "سبب الجزاء ورقم القرار" : ""} /></Field>
      </div>
      {qt && <div className="hint mt">الأجر الشهري {money(qt.wage)} · أجر اليوم {money(qt.daily)} · أجر الساعة {money(qt.hourly)}{unit && Number(f.qty) > 0 ? <> · المحتسب: <b>{money(qt.amount)}</b></> : null}</div>}
      {f.kind === "PENALTY" && <div className="hint">الجزاء بالأيام يُحتسب من الأجر اليومي، أو اكتب مبلغاً محدداً. {CFG.country === "SA" ? "نظام العمل: لا يتجاوز ما يُحسم من الأجر نصفه في الشهر." : ""}</div>}
    </Modal>
  );
}

/** One employee's payslip from a run line: earnings on one side, deductions on the other, with the month's transactions listed. */
export function Payslip({ run, line, onClose }: { run: any; line: any; onClose: () => void }) {
  const { me } = useCompanyContext();
  const earn: [string, number][] = [["الراتب الأساسي", line.basic], ["بدل السكن", line.housing], ["بدل النقل", line.transport], ["بدلات أخرى", line.other], ["عمل إضافي", line.overtime], ["مكافآت وعمولات", line.bonus]];
  const ded: [string, number][] = [[CFG.country === "EG" ? "التأمينات الاجتماعية (حصة العامل)" : "التأمينات الاجتماعية (حصة الموظف)", line.gosiEmp], ["ضريبة كسب العمل", line.salaryTax || 0], ["صندوق الشهداء", line.martyrs || 0], ["غياب", line.absence], ["تأخير وجزاءات وخصومات", line.deduction], ["قسط سلفة", line.loan || 0]];
  const sum = (a: [string, number][]) => a.reduce((x, [, v]) => x + Number(v || 0), 0);
  const Rows = ({ a }: { a: [string, number][] }) => <>{a.filter(([, v]) => Number(v) > 0.004).map(([l, v]) => <tr key={l}><td>{l}</td><td className="n"><Money v={v} /></td></tr>)}</>;
  return (
    <Modal title={`قسيمة راتب — ${line.name}`} onClose={onClose} footer={<><PrintBtn pdfName={`قسيمة راتب ${line.name} ${run.period}`} /><button className="btn" onClick={onClose}>إغلاق</button></>}>
      <div className="print-doc payslip">
        <div className="row between"><div><h3 style={{ margin: 0 }}>{me.company.nameAr}</h3><div className="small muted">قسيمة راتب شهر <b className="num" dir="ltr">{run.period}</b></div></div><div style={{ textAlign: "end" }}><b>{line.name}</b><div className="small muted">{line.code}{line.jobTitle ? ` · ${line.jobTitle}` : ""}{line.department ? ` · ${line.department}` : ""}</div></div></div>
        <div className="grid cols-2 mt">
          <table className="tbl compact"><thead><tr><th>الاستحقاقات</th><th className="n">المبلغ</th></tr></thead><tbody><Rows a={earn} /></tbody><tfoot><tr><td>إجمالي الاستحقاقات</td><td className="n"><Money v={sum(earn)} /></td></tr></tfoot></table>
          <table className="tbl compact"><thead><tr><th>الاستقطاعات</th><th className="n">المبلغ</th></tr></thead><tbody><Rows a={ded} />{sum(ded) < 0.005 && <tr><td colSpan={2} className="muted small">لا توجد</td></tr>}</tbody><tfoot><tr><td>إجمالي الاستقطاعات</td><td className="n"><Money v={sum(ded)} /></td></tr></tfoot></table>
        </div>
        <div className="payslip-net mt"><span>صافي الراتب المستحق</span><b className="num">{money(line.net)}</b></div>
        {line.items?.length > 0 && <table className="tbl compact mt"><thead><tr><th>حركات الشهر</th><th>التاريخ</th><th className="n">الكمية</th><th className="n">المبلغ</th><th>ملاحظة</th></tr></thead><tbody>{line.items.map((i: any) => <tr key={i.id}><td>{KIND_AR[i.kind]}</td><td className="dt">{i.date}</td><td className="n">{i.qty ?? "—"}</td><td className={"n " + (EARN.includes(i.kind) ? "" : "neg-val")}><Money v={i.amount} /></td><td className="small">{i.note}</td></tr>)}</tbody></table>}
        <div className="small muted mt">{line.iban ? <>يُحوَّل إلى: <span className="num">{line.iban}</span>{line.bankName ? ` — ${line.bankName}` : ""}</> : "طريقة الصرف: نقداً / حسب المتفق"}</div>
        <div className="row between mt small" style={{ gap: 40 }}><span>توقيع الموظف: ........................</span><span>المحاسب: ........................</span></div>
      </div>
    </Modal>
  );
}

/** Cash repayment and rescheduling of an employee loan. */
export function LoanActions({ loan, onDone }: { loan: any; onDone: () => void }) {
  const { run, busy } = useAction();
  const toast = useToast();
  const [mode, setMode] = useState<"" | "repay" | "plan">("");
  const rest = Number(loan.amount) - Number(loan.paid);
  const [f, setF] = useState<any>({ amount: "", date: today(), installment: Number(loan.installment), startPeriod: loan.startPeriod || today().slice(0, 7) });
  const [acc, setAcc] = useState<any>(null);
  return <>
    <button className="btn sm" onClick={() => setMode("repay")}>سداد نقدي</button><button className="btn sm ghost" onClick={() => setMode("plan")}>جدولة</button>
    {mode === "repay" && <Modal narrow title={`سداد سلفة ${loan.number} — ${loan.employeeName}`} onClose={() => setMode("")} footer={<><button className="btn" onClick={() => setMode("")}>إلغاء</button><button className="btn primary" disabled={busy || !acc} onClick={() => run(async () => { const r = await api(`/hr/loans/${loan.id}/repay`, { body: { amount: f.amount === "" ? undefined : f.amount, accountId: acc.id, date: f.date } }); toast(`قُيّد السداد ${r.number} — المتبقي ${money(r.rest)}`); setMode(""); onDone(); })}>تسجيل السداد</button></>}>
      <div className="grid"><div className="stat-list"><div className="item"><span>المتبقي من السلفة</span><b><Money v={rest} /></b></div></div>
        <Field label="المبلغ المسدَّد" hint="اتركه فارغاً لسداد كامل المتبقي"><NumInput autoFocus value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder={money(rest)} /></Field>
        <Field label="استُلم في"><Picker value={acc} onChange={setAcc} fetcher={accountFetcher((a) => a.isCashBank)} label={(a: any) => `${a.code} ${a.nameAr}`} /></Field>
        <Field label="التاريخ"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field></div>
    </Modal>}
    {mode === "plan" && <Modal narrow title={`جدولة سلفة ${loan.number}`} onClose={() => setMode("")} footer={<><button className="btn" onClick={() => setMode("")}>إلغاء</button><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api(`/hr/loans/${loan.id}`, { method: "PUT", body: { installment: f.installment, startPeriod: f.startPeriod } }); setMode(""); onDone(); }, "عُدّلت الجدولة")}>حفظ</button></>}>
      <div className="grid"><div className="stat-list"><div className="item"><span>المتبقي</span><b><Money v={rest} /></b></div><div className="item"><span>عدد الأقساط بالقسط الجديد</span><b>{Number(f.installment) > 0 ? Math.ceil(rest / Number(f.installment)) : "—"}</b></div></div>
        <Field label="القسط الشهري"><NumInput autoFocus value={f.installment} onChange={(e) => setF({ ...f, installment: e.target.value })} /></Field>
        <Field label="يبدأ (أو يُستأنف) الخصم من شهر" hint="اختر شهراً لاحقاً لتأجيل الأقساط"><Input type="month" value={f.startPeriod} onChange={(e) => setF({ ...f, startPeriod: e.target.value })} /></Field></div>
    </Modal>}
  </>;
}
