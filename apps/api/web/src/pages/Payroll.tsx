import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, q, useFetch, Money, money, Loading, Empty, Badge, Modal, Field, Input, Select, NumInput, Picker, accountFetcher, useAction, useCompanyContext, ExportBtn, PrintBtn, today, fmtDate, confirmDlg, SearchBox, FilterInfo, useSorted, Th, matches } from "../lib";
import { LeavesTab, LoansTab, ProvisionsTab, SettlementsTab, EmployeeStatement } from "./Hr";

const NAT: Record<string, string> = { SAUDI: "سعودي", NON_SAUDI: "غير سعودي" };
const RS: Record<string, string> = { DRAFT: "مسودة", POSTED: "مرحّل", PAID: "مصروف" };

export function PayrollPage() {
  const { can } = useCompanyContext();
  const { tab = "runs" } = useParams();
  const nav = useNavigate();
  const setTab = (t: string) => nav(`/payroll/${t}`);
  const emps = useFetch("/employees");
  const [file, setFile] = useState<any>(null);
  const runs = useFetch("/payroll");
  const [edit, setEdit] = useState<any>(null);
  const [newRun, setNewRun] = useState(false);
  const [view, setView] = useState<any>(null);
  const [pay, setPay] = useState<any>(null);
  const { run, busy } = useAction();
  const [et, setEt] = useState("");
  const [dept, setDept] = useState("");
  const [nat, setNat] = useState("");
  const [est, setEst] = useState("active");
  const depts = [...new Set((emps.data || []).map((e: any) => e.department).filter(Boolean))] as string[];
  const empRows = (emps.data || []).filter((e: any) => matches(e, et, ["code", "name", "jobTitle", "department", "iban"]) && (!dept || e.department === dept) && (!nat || e.nationality === nat) && (est === "all" || (est === "active" ? e.isActive : !e.isActive))).map((e: any) => ({ ...e, total: Number(e.basic) + Number(e.housing) + Number(e.transport) + Number(e.otherAllow) }));
  const es = useSorted(empRows);
  const [ry, setRy] = useState("");
  const years = [...new Set((runs.data?.runs || []).map((r: any) => String(r.period).slice(0, 4)))] as string[];
  const runRows = (runs.data?.runs || []).filter((r: any) => !ry || String(r.period).startsWith(ry));
  return (
    <div className="grid">
      <div className="tabs">{[["runs", "مسيرات الرواتب"], ["employees", `الموظفون (${emps.data?.filter((e: any) => e.isActive).length || 0})`], ["leaves", "الإجازات"], ["loans", "السلف"], ["provisions", "مخصصات نهاية الخدمة والإجازات"], ["settlements", "التصفية النهائية"]].map(([k, l]) => <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "leaves" && emps.data && <LeavesTab emps={emps.data} />}
      {tab === "loans" && emps.data && <LoansTab emps={emps.data} />}
      {tab === "provisions" && <ProvisionsTab />}
      {tab === "settlements" && emps.data && <SettlementsTab emps={emps.data} onChanged={() => emps.reload()} />}
      {tab === "employees" && (
        <div className="card"><div className="card-h"><h3>الموظفون</h3>{can("accounting.write") && <div className="row">{emps.data && <ExportBtn name="الموظفون" rows={() => emps.data.map((e: any) => ({ الكود: e.code, الاسم: e.name, الوظيفة: e.jobTitle, القسم: e.department, الجنسية: NAT[e.nationality], "تاريخ التعيين": e.hireDate, IBAN: e.iban, البنك: e.bankName, الأساسي: e.basic, السكن: e.housing, النقل: e.transport, "بدلات أخرى": e.otherAllow, "الإجمالي": Number(e.basic) + Number(e.housing) + Number(e.transport) + Number(e.otherAllow) }))} />}<button className="btn primary sm" onClick={() => setEdit({})}>＋ موظف</button></div>}</div>
          <div className="card-b" style={{ paddingBottom: 0 }}><div className="toolbar">
            <SearchBox value={et} onChange={setEt} placeholder="بحث بالاسم / الكود / الوظيفة / IBAN" />
            {depts.length > 0 && <Select value={dept} onChange={(e) => setDept(e.target.value)}><option value="">كل الأقسام</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}</Select>}
            <Select value={nat} onChange={(e) => setNat(e.target.value)}><option value="">كل الجنسيات</option>{Object.entries(NAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
            <Select value={est} onChange={(e) => setEst(e.target.value)}><option value="active">على رأس العمل</option><option value="inactive">منتهية خدمتهم</option><option value="all">الكل</option></Select>
            <FilterInfo shown={empRows.length} total={emps.data?.length || 0} active={!!(et || dept || nat || est !== "active")} onClear={() => { setEt(""); setDept(""); setNat(""); setEst("active"); }} />
          </div></div>
          {!emps.data ? <Loading /> : !empRows.length ? <Empty text={emps.data.length ? "لا نتائج مطابقة" : "لا يوجد موظفون"} /> : <div className="table-wrap"><table className="tbl"><thead><tr><Th k="code" s={es}>الكود</Th><Th k="name" s={es}>الاسم</Th><Th k="jobTitle" s={es}>الوظيفة</Th><th>الجنسية</th><Th k="basic" s={es} n>الأساسي</Th><th className="n" title="السكن + النقل + بدلات أخرى">البدلات</th><Th k="total" s={es} n>الإجمالي</Th><th>تأمينات</th><th>الحالة</th><th /></tr></thead>
            <tbody>{es.sorted.map((e: any) => <tr key={e.id} className={e.isActive ? "" : "muted"}><td className="dt">{e.code}</td><td><b>{e.name}</b><div className="small muted">{e.department}</div></td><td>{e.jobTitle}</td><td>{NAT[e.nationality]}</td><td className="n"><Money v={e.basic} /></td><td className="n" title={`سكن ${money(e.housing)} · نقل ${money(e.transport)} · أخرى ${money(e.otherAllow)}`}><Money v={Number(e.housing) + Number(e.transport) + Number(e.otherAllow)} /></td><td className="n"><b><Money v={Number(e.basic) + Number(e.housing) + Number(e.transport) + Number(e.otherAllow)} /></b></td><td>{e.gosi ? "✓" : "—"}</td><td><Badge s={e.isActive ? "ACTIVE" : "CANCELLED"} map={{ ACTIVE: "نشط", CANCELLED: "منتهٍ" }} /></td><td className="row" style={{ gap: 4 }}><button className="btn sm" onClick={() => setFile(e)}>الملف والكشف</button>{can("accounting.write") && <button className="btn sm ghost" onClick={() => setEdit(e)}>تعديل</button>}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={4}>الإجمالي ({empRows.length})</td><td className="n"><Money v={empRows.reduce((a: number, e: any) => a + Number(e.basic), 0)} /></td><td className="n"><Money v={empRows.reduce((a: number, e: any) => a + Number(e.housing) + Number(e.transport) + Number(e.otherAllow), 0)} /></td><td className="n"><Money v={empRows.reduce((a: number, e: any) => a + e.total, 0)} /></td><td colSpan={3} /></tr></tfoot></table></div>}
        </div>
      )}
      {tab === "runs" && (
        <div className="card"><div className="card-h"><div><h3>مسيرات الرواتب</h3><div className="small muted">التأمينات: سعودي 9.75% موظف + 11.75% منشأة على (الأساسي + السكن) بحد 45,000 · غير سعودي 2% منشأة فقط</div></div><div className="row">{years.length > 1 && <Select value={ry} onChange={(e) => setRy(e.target.value)}><option value="">كل السنوات</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>}{runs.data && <ExportBtn name="مسيرات الرواتب" rows={() => runRows.map((r: any) => ({ الشهر: r.period, التاريخ: r.date, الموظفون: r.lines.length, الإجمالي: r.totalGross, "تأمينات الموظف": r.totalGosiEmp, "تأمينات المنشأة": r.totalGosiEr, الصافي: r.totalNet, القيد: r.journalNumber, الحالة: RS[r.status] }))} />}{can("accounting.write") && <button className="btn primary sm" onClick={() => setNewRun(true)}>＋ مسير جديد</button>}</div></div>
          {!runs.data ? <Loading /> : !runRows.length ? <Empty text="لا توجد مسيرات بعد" /> : <div className="table-wrap"><table className="tbl"><thead><tr><th>الشهر</th><th>التاريخ</th><th className="n">الموظفون</th><th className="n">الإجمالي</th><th className="n">تأمينات الموظف</th><th className="n">تأمينات المنشأة</th><th className="n">الصافي</th><th>القيد</th><th>الحالة</th><th /></tr></thead>
            <tbody>{runRows.map((r: any) => <tr key={r.id}><td><b>{r.period}</b></td><td className="dt">{fmtDate(r.date)}</td><td className="n">{r.lines.length}</td><td className="n"><Money v={r.totalGross} /></td><td className="n"><Money v={r.totalGosiEmp} /></td><td className="n"><Money v={r.totalGosiEr} /></td><td className="n"><b><Money v={r.totalNet} /></b></td><td>{r.journalNumber}</td><td><Badge s={r.status} map={RS} /></td>
              <td className="row" style={{ gap: 4 }}><button className="btn sm" onClick={() => setView(r)}>عرض</button>{can("accounting.write") && r.status === "DRAFT" && <><button className="btn sm primary" disabled={busy} onClick={() => run(async () => { if (confirmDlg(`ترحيل قيد رواتب ${r.period}؟`)) { await api(`/payroll/${r.id}/post`, { body: {} }); runs.reload(); } }, "تم ترحيل قيد الرواتب")}>ترحيل</button><button className="btn sm ghost" onClick={() => run(async () => { if (confirmDlg("حذف المسير؟")) { await api(`/payroll/${r.id}`, { method: "DELETE" }); runs.reload(); } })}>حذف</button></>}{can("payments.write") && r.status === "POSTED" && <button className="btn sm accent" onClick={() => setPay(r)}>صرف الرواتب</button>}<a className="btn sm" href={`/api/payroll/${r.id}/wps.csv?token=${localStorage.getItem("mz_token")}`}>ملف WPS</a></td></tr>)}</tbody></table></div>}
        </div>
      )}
      {edit && <EmployeeForm e={edit} onClose={(s) => { setEdit(null); if (s) emps.reload(); }} />}
      {file && <EmployeeStatement e={file} onClose={() => setFile(null)} />}
      {newRun && <NewRun onClose={(s) => { setNewRun(false); if (s) { runs.reload(); setTab("runs"); } }} />}
      {view && <RunView r={view} onClose={() => setView(null)} />}
      {pay && <PayModal r={pay} onClose={(s) => { setPay(null); if (s) runs.reload(); }} />}
    </div>
  );
}

function EmployeeForm({ e, onClose }: { e: any; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ nationality: "SAUDI", gosi: true, basic: 0, housing: 0, transport: 0, otherAllow: 0, isActive: true, leaveDaysPerYear: 21, leaveOpening: 0, ...e, hireDate: e.hireDate ? String(e.hireDate).slice(0, 10) : "" });
  const s = (k: string) => (ev: any) => setF({ ...f, [k]: ev.target.type === "checkbox" ? ev.target.checked : ev.target.value });
  return (
    <Modal title={e.id ? `تعديل: ${e.name}` : "موظف جديد"} onClose={() => onClose()} footer={<>{e.id && <button className="btn danger sm" onClick={() => run(async () => { if (confirmDlg("إنهاء خدمة الموظف (إيقاف)؟")) { await api(`/employees/${e.id}`, { method: "DELETE" }); onClose(true); } })}>إنهاء الخدمة</button>}<div className="grow" /><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !f.name} onClick={() => run(async () => { e.id ? await api(`/employees/${e.id}`, { method: "PUT", body: f }) : await api("/employees", { body: f }); onClose(true); }, "تم الحفظ")}>حفظ</button></>}>
      <div className="form-grid">
        <Field label="الاسم" span2><Input autoFocus value={f.name || ""} onChange={s("name")} /></Field>
        <Field label="الكود (تلقائي)"><Input value={f.code || ""} onChange={s("code")} dir="ltr" /></Field>
        <Field label="الوظيفة"><Input value={f.jobTitle || ""} onChange={s("jobTitle")} /></Field>
        <Field label="القسم"><Input value={f.department || ""} onChange={s("department")} /></Field>
        <Field label="الجنسية (للتأمينات)"><Select value={f.nationality} onChange={s("nationality")}><option value="SAUDI">سعودي</option><option value="NON_SAUDI">غير سعودي</option></Select></Field>
        <Field label="تاريخ التعيين"><Input type="date" value={f.hireDate || ""} onChange={s("hireDate")} /></Field>
        <Field label="الراتب الأساسي"><NumInput value={f.basic} onChange={s("basic")} /></Field>
        <Field label="بدل السكن"><NumInput value={f.housing} onChange={s("housing")} /></Field>
        <Field label="بدل النقل"><NumInput value={f.transport} onChange={s("transport")} /></Field>
        <Field label="بدلات أخرى"><NumInput value={f.otherAllow} onChange={s("otherAllow")} /></Field>
        <Field label="IBAN"><Input value={f.iban || ""} onChange={s("iban")} dir="ltr" placeholder="SA..." /></Field>
        <Field label="البنك"><Input value={f.bankName || ""} onChange={s("bankName")} /></Field>
        <Field label="التأمينات"><label className="check"><input type="checkbox" checked={!!f.gosi} onChange={s("gosi")} /> مسجل في التأمينات الاجتماعية</label></Field>
        <Field label="أيام الإجازة السنوية" hint="21 يوماً، وتصبح 30 تلقائياً بعد 5 سنوات"><NumInput value={f.leaveDaysPerYear ?? 21} onChange={s("leaveDaysPerYear")} /></Field>
        <Field label="رصيد الإجازات الافتتاحي (يوم)" hint="الرصيد المتبقي كما في التاريخ المجاور"><NumInput value={f.leaveOpening ?? 0} onChange={s("leaveOpening")} /></Field>
        <Field label="تاريخ الرصيد الافتتاحي" hint="افتراضياً تاريخ التعيين — يبدأ احتساب الإجازات منه"><Input type="date" value={f.leaveBalanceDate ? String(f.leaveBalanceDate).slice(0, 10) : ""} onChange={s("leaveBalanceDate")} /></Field>
        {e.id && <Field label="الحالة"><label className="check"><input type="checkbox" checked={!!f.isActive} onChange={s("isActive")} /> على رأس العمل</label></Field>}
      </div>
    </Modal>
  );
}

function NewRun({ onClose }: { onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [period, setPeriod] = useState(today().slice(0, 7));
  const { data: preview } = useFetch(`/payroll/preview${q({ period })}`, [period]);
  const [adj, setAdj] = useState<Record<string, any>>({});
  const upd = (id: string, k: string, v: any) => setAdj({ ...adj, [id]: { ...(adj[id] || {}), [k]: v } });
  const calc = (l: any) => { const a = adj[l.employeeId] || {}; const gross = l.gross + Number(a.bonus || 0) + Number(a.overtime || 0); const loan = a.loan === undefined || a.loan === "" ? l.loan : Math.min(l.loan, Number(a.loan) || 0); const net = gross - l.gosiEmp - Number(a.deduction || 0) - Number(a.absence || 0) - loan; return { gross, net, loan }; };
  return (
    <Modal wide title="مسير رواتب جديد" onClose={() => onClose()} footer={<><span className="grow muted">الصافي الإجمالي: <b><Money v={(preview || []).reduce((s: number, l: any) => s + calc(l).net, 0)} /></b></span><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !preview?.length} onClick={() => run(async () => { await api("/payroll", { body: { period, adjustments: adj } }); onClose(true); }, "تم إنشاء المسير (مسودة)")}>إنشاء المسير</button></>}>
      <div className="row mb"><Field label="الشهر"><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field></div>
      {!preview ? <Loading /> : !preview.length ? <Empty text="أضف موظفين أولاً" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الموظف</th><th className="n">الإجمالي الثابت</th><th>مكافأة</th><th>إضافي</th><th>خصم</th><th>غياب</th><th>قسط سلفة</th><th className="n">تأمينات الموظف</th><th className="n">الصافي</th></tr></thead>
        <tbody>{preview.map((l: any) => <tr key={l.employeeId}><td>{l.name}<div className="small muted">{l.code}</div></td><td className="n"><Money v={l.gross} /></td><td><NumInput style={{ width: 90 }} value={adj[l.employeeId]?.bonus || ""} onChange={(e) => upd(l.employeeId, "bonus", e.target.value)} /></td><td><NumInput style={{ width: 90 }} value={adj[l.employeeId]?.overtime || ""} onChange={(e) => upd(l.employeeId, "overtime", e.target.value)} /></td><td><NumInput style={{ width: 90 }} value={adj[l.employeeId]?.deduction || ""} onChange={(e) => upd(l.employeeId, "deduction", e.target.value)} /></td><td><NumInput style={{ width: 90 }} value={adj[l.employeeId]?.absence || ""} onChange={(e) => upd(l.employeeId, "absence", e.target.value)} /></td><td>{l.loan ? <NumInput style={{ width: 90 }} title={`القسط المستحق ${l.loan}`} value={adj[l.employeeId]?.loan ?? l.loan} onChange={(e) => upd(l.employeeId, "loan", e.target.value)} /> : <span className="muted">—</span>}</td><td className="n"><Money v={l.gosiEmp} /></td><td className="n"><b><Money v={calc(l).net} /></b></td></tr>)}</tbody></table></div>}
    </Modal>
  );
}

function RunView({ r, onClose }: { r: any; onClose: () => void }) {
  const { me } = useCompanyContext();
  return (
    <Modal wide title={`مسير رواتب ${r.period}`} onClose={onClose} footer={<><PrintBtn /><ExportBtn name={`مسير رواتب ${r.period}`} rows={() => r.lines.map((l: any) => ({ الكود: l.code, الاسم: l.name, الأساسي: l.basic, السكن: l.housing, النقل: l.transport, أخرى: l.other, مكافأة: l.bonus, إضافي: l.overtime, الإجمالي: l.gross, "تأمينات الموظف": l.gosiEmp, "تأمينات المنشأة": l.gosiEr, خصم: l.deduction, غياب: l.absence, سلفة: l.loan || 0, الصافي: l.net, IBAN: l.iban }))} /><button className="btn" onClick={onClose}>إغلاق</button></>}>
      <div className="print-doc" style={{ padding: 0 }}>
        <div className="print-only"><h2>{me.company.nameAr} — مسير رواتب {r.period}</h2></div>
        <table className="tbl compact"><thead><tr><th>الموظف</th><th className="n">الأساسي</th><th className="n">السكن</th><th className="n">النقل</th><th className="n">أخرى</th><th className="n">مكافآت/إضافي</th><th className="n">الإجمالي</th><th className="n">تأمينات</th><th className="n">خصومات</th><th className="n">سلف</th><th className="n">الصافي</th></tr></thead>
          <tbody>{r.lines.map((l: any) => <tr key={l.employeeId}><td>{l.name}<div className="small muted">{l.code} · {NAT[l.nationality]}</div></td><td className="n"><Money v={l.basic} /></td><td className="n"><Money v={l.housing} /></td><td className="n"><Money v={l.transport} /></td><td className="n"><Money v={l.other} /></td><td className="n"><Money v={l.bonus + l.overtime} blankZero /></td><td className="n"><Money v={l.gross} /></td><td className="n"><Money v={l.gosiEmp} blankZero /></td><td className="n"><Money v={l.deduction + l.absence} blankZero /></td><td className="n"><Money v={l.loan || 0} blankZero /></td><td className="n"><b><Money v={l.net} /></b></td></tr>)}</tbody>
          <tfoot><tr><td>الإجمالي</td><td colSpan={5} /><td className="n"><Money v={r.totalGross} /></td><td className="n"><Money v={r.totalGosiEmp} /></td><td className="n"><Money v={r.totalDeductions} /></td><td className="n"><Money v={r.lines.reduce((a: number, l: any) => a + (l.loan || 0), 0)} /></td><td className="n"><Money v={r.totalNet} /></td></tr></tfoot></table>
        <div className="small muted mt">حصة المنشأة في التأمينات: <Money v={r.totalGosiEr} /> — تُحمَّل كمصروف وتُستحق مع حصة الموظف على حساب التأمينات المستحقة.</div>
      </div>
    </Modal>
  );
}

function PayModal({ r, onClose }: { r: any; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [acc, setAcc] = useState<any>(null);
  const [date, setDate] = useState(today());
  return (
    <Modal narrow title={`صرف رواتب ${r.period}`} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !acc} onClick={() => run(async () => { await api(`/payroll/${r.id}/pay`, { body: { accountId: acc.id, date } }); onClose(true); }, "تم قيد صرف الرواتب")}>تأكيد الصرف</button></>}>
      <div className="grid"><div className="stat-list"><div className="item"><span>صافي الرواتب</span><b><Money v={r.totalNet} /></b></div></div><Field label="من حساب البنك"><Picker value={acc} onChange={setAcc} fetcher={accountFetcher((a) => a.isCashBank)} label={(a: any) => `${a.code} ${a.nameAr}`} /></Field><Field label="التاريخ"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field><div className="hint">حمّل ملف WPS من القائمة لرفعه على منصة البنك / مدد.</div></div>
    </Modal>
  );
}
