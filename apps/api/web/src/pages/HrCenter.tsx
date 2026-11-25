/**
 * 3.52.0 — the HR centre: dashboard, the employee file, leave requests and types, documents with expiry, GOSI rates.
 */
import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CFG } from "../shared/country";
import { api, useFetch, useAction, useCompanyContext, Modal, Field, Input, Select, NumInput, Money, money, Loading, Empty, ExportBtn, PrintBtn, today, useNewParam, confirmDlg, useToast } from "../lib";
import { Attachments } from "./Round28";

const EG = CFG.country === "EG";
const LS: Record<string, [string, string]> = { PENDING: ["بانتظار القرار", "amber"], APPROVED: ["معتمدة", "green"], REJECTED: ["مرفوضة", "red"], CANCELLED: ["ملغاة", "gray"] };
const LBadge = ({ s }: { s: string }) => <span className={"badge " + (LS[s]?.[1] || "gray")}>{LS[s]?.[0] || s}</span>;
export const DOC_KINDS: Record<string, string> = { NATIONAL_ID: "الهوية الوطنية", IQAMA: "الإقامة", PASSPORT: "جواز السفر", WORK_PERMIT: "رخصة العمل", HEALTH_INSURANCE: "التأمين الطبي", CONTRACT: "عقد العمل", DRIVING_LICENSE: "رخصة القيادة", CERTIFICATE: "شهادة / مؤهل", MEDICAL: "شهادة صحية", OTHER: "أخرى" };
const DS: Record<string, [string, string]> = { EXPIRED: ["منتهية", "red"], SOON: ["خلال 30 يوماً", "amber"], UPCOMING: ["خلال 90 يوماً", "blue"], OK: ["سارية", "green"], NONE: ["بلا تاريخ", "gray"] };
const DBadge = ({ d }: { d: any }) => <span className={"badge " + DS[d.state][1]}>{d.state === "EXPIRED" ? `منتهية منذ ${-d.daysLeft} يوم` : d.state === "NONE" ? DS.NONE[0] : d.state === "OK" ? DS.OK[0] : `بعد ${d.daysLeft} يوم`}</span>;
const PER: Record<string, string> = { OCCURRENCE: "في كل مرة", YEAR: "في السنة", SERVICE: "طوال الخدمة" };
const BR: Record<string, string> = { PENSION: "المعاشات", SANED: "ساند", HAZARD: "الأخطار المهنية" };
const useEmps = () => useFetch<any[]>("/employees");

// ───────────────────────── dashboard ─────────────────────────
export function HrDashboard() {
  const { data } = useFetch<any>("/hr/dashboard");
  const nav = useNavigate();
  if (!data) return <Loading />;
  const H = data.headcount;
  const top = Math.max(1, ...data.payrollTrend.map((x: any) => x.gross));
  const people = (rows: any[], empty: string, extra: (x: any) => React.ReactNode) => !rows.length ? <Empty text={empty} /> : <div className="table-wrap"><table className="tbl compact"><tbody>{rows.map((x: any, i: number) => <tr key={i} className="clickable" onClick={() => nav(`/hr/employees/${x.employeeId || x.id}`)}><td>{x.employeeName || x.name}</td><td className="small">{extra(x)}</td></tr>)}</tbody></table></div>;
  return (
    <div className="grid" data-hr-dash>
      <div className="fc-kpis" data-hr-kpis>
        <div className="fc-kpi"><span>الموظفون على رأس العمل</span><b className="num">{H.active}</b><small>{H.joiners} انضم هذا الشهر · {H.leavers} غادر</small></div>
        {!EG && <div className={"fc-kpi" + (H.saudizationPct < 30 ? " high" : " good")} data-hr-saudi><span>نسبة التوطين</span><b className="num">{H.saudizationPct}%</b><small>{H.saudi} سعودي · {H.nonSaudi} غير سعودي — راجع نطاقك في منصة قوى</small></div>}
        <div className="fc-kpi"><span>الرواتب الشهرية الثابتة</span><b className="num">{money(data.monthlyPayroll)}</b><small>أساسي وبدلات</small></div>
        <div className="fc-kpi"><span>مخصص نهاية الخدمة</span><b className="num">{money(data.liabilities.eosb)}</b><small>والإجازات {money(data.liabilities.leave)}</small></div>
        <div className={"fc-kpi" + (data.pendingLeaves.length ? " high" : "")}><span>طلبات إجازة بانتظار القرار</span><b className="num">{data.pendingLeaves.length}</b><small>{data.onLeaveToday.length} في إجازة اليوم</small></div>
        <div className={"fc-kpi" + (data.documents.expired.length ? " high" : "")} data-hr-docs><span>وثائق منتهية أو قريبة الانتهاء</span><b className="num">{data.documents.expired.length + data.documents.soon.length}</b><small>{data.documents.expired.length} منتهية · {data.documents.soon.length} خلال 60 يوماً</small></div>
      </div>
      {(data.missing.iban > 0 || data.missing.idNumber > 0) && <div className="alert warn small">قبل ملف حماية الأجور: {data.missing.iban ? `${data.missing.iban} موظف بلا IBAN صحيح` : ""}{data.missing.iban && data.missing.idNumber ? " · " : ""}{data.missing.idNumber ? `${data.missing.idNumber} موظف بلا رقم هوية أو إقامة` : ""} — أكمل ملفاتهم من <Link to="/payroll/employees">الموظفين</Link>.</div>}
      <div className="grid c2">
        <div className="card"><div className="card-h"><h3>طلبات الإجازة</h3><Link className="btn sm ghost" to="/hr/leaves">الإجازات</Link></div>{people(data.pendingLeaves, "لا طلبات معلقة", (l) => `${l.typeName} · ${l.days} يوم من ${l.fromDate}`)}</div>
        <div className="card"><div className="card-h"><h3>وثائق تنتهي أو انتهت</h3><Link className="btn sm ghost" to="/hr/documents">الوثائق</Link></div>{people([...data.documents.expired, ...data.documents.soon].slice(0, 10), "لا شيء خلال 60 يوماً", (d) => <>{d.kindAr} <DBadge d={d} /></>)}</div>
      </div>
      <div className="grid c2">
        <div className="card"><div className="card-h"><h3>تكلفة الرواتب — آخر المسيرات</h3></div>{!data.payrollTrend.length ? <Empty text="لا مسيرات بعد" /> : <div className="row" style={{ alignItems: "flex-end", gap: 10, height: 140 }} data-hr-trend>{data.payrollTrend.map((x: any) => <div key={x.period} style={{ flex: 1, textAlign: "center" }} title={`صافي ${money(x.net)} · تأمينات المنشأة ${money(x.gosiEr)}`}><div className="small num">{money(x.gross + x.gosiEr)}</div><div style={{ height: `${Math.round(((x.gross + x.gosiEr) / top) * 95)}px`, background: "var(--primary, #0f766e)", borderRadius: 4, minHeight: 2 }} /><div className="small muted">{x.period}</div></div>)}</div>}</div>
        <div className="card"><div className="card-h"><h3>في إجازة اليوم</h3></div>{people(data.onLeaveToday, "لا أحد", (l) => `${l.typeName} حتى ${l.toDate}`)}
          <div className="card-h mt"><h3>الأقسام</h3></div><div className="table-wrap"><table className="tbl compact"><tbody>{data.departments.map((d: any) => <tr key={d.name}><td>{d.name}</td><td className="n">{d.count}</td></tr>)}</tbody></table></div></div>
      </div>
      <div className="grid c2">
        <div className="card"><div className="card-h"><h3>عقود تنتهي خلال 60 يوماً</h3></div>{people(data.contractsEnding, "لا شيء", (x) => x.date)}<div className="card-h mt"><h3>فترات تجربة تنتهي خلال 30 يوماً</h3></div>{people(data.probationEnding, "لا شيء", (x) => x.date)}</div>
        <div className="card"><div className="card-h"><h3>تعديلات رواتب قادمة</h3></div>{people(data.pendingChanges, "لا شيء", (c) => `من ${c.effectiveDate}: ${money(Object.values(c.oldPay).reduce((a: number, v: any) => a + Number(v), 0))} ← ${money(Object.values(c.newPay).reduce((a: number, v: any) => a + Number(v), 0))}`)}<div className="card-h mt"><h3>ذكرى التعيين هذا الأسبوع</h3></div>{people(data.anniversaries, "لا شيء", (x) => `${x.years} سنة · ${x.date}`)}</div>
      </div>
    </div>
  );
}

// ───────────────────────── employee file ─────────────────────────
/** The employee's self-service link: copy it, send it by WhatsApp, renew it (the old one stops), or withdraw it. */
function EmpPortalBtn({ e, onChange }: { e: any; onChange: () => void }) {
  const { run, busy } = useAction(); const toast = useToast();
  const [info, setInfo] = useState<any>(null);
  const link = (p: string) => location.origin + p;
  const make = (renew = false) => run(async () => { const r = await api(`/hr/employees/${e.id}/portal`, { body: { renew } }); setInfo(r); onChange(); });
  if (!e.portalToken && !info) return <button className="btn" disabled={busy} onClick={() => make()} data-emp-portal-make title="رابط خاص يفتحه الموظف من جواله: قسائم الراتب، رصيد الإجازة، الوثائق، وطلب إجازة">🔗 بوابة الموظف</button>;
  const url = link(info?.path || `/e/${e.portalToken}`);
  const wa = () => { let ph = String(e.phone || "").replace(/\D/g, ""); if (ph.startsWith("05")) ph = "966" + ph.slice(1); if (ph.startsWith("01") && ph.length === 11) ph = "2" + ph; window.open(`https://wa.me/${ph}?text=${encodeURIComponent(`مرحباً ${e.name}، هذا رابطك الخاص لقسائم الراتب ورصيد الإجازة وطلب الإجازات:\n${url}${e.idNumber ? "\nيُطلب منك آخر 4 أرقام من هويتك." : ""}`)}`, "_blank"); };
  return <span className="row" style={{ gap: 4 }} data-emp-portal-link={url}>
    <button className="btn" onClick={() => { navigator.clipboard?.writeText(url); toast("نُسخ رابط بوابة الموظف", "ok"); }}>🔗 نسخ رابط البوابة</button>
    {e.phone && <button className="btn" onClick={wa}>واتساب</button>}
    <button className="btn ghost" disabled={busy} title="رابط جديد ويتوقف القديم" onClick={() => { if (confirmDlg("إصدار رابط جديد؟ يتوقف الرابط الحالي")) make(true); }}>↻</button>
    <button className="btn ghost danger" disabled={busy} title="إلغاء الرابط" onClick={() => run(async () => { if (!confirmDlg("إلغاء رابط بوابة الموظف؟")) return; await api(`/hr/employees/${e.id}/portal`, { method: "DELETE" }); setInfo(null); onChange(); })}>✕</button>
    {!e.idNumber && <span className="small muted" style={{ alignSelf: "center" }}>سجّل رقم الهوية ليُطلب للتحقق</span>}
  </span>;
}

export function EmployeeProfile() {
  const { id } = useParams();
  const { can } = useCompanyContext();
  const { data, reload, error } = useFetch<any>(`/hr/employees/${id}/profile`, [id]);
  const [tab, setTab] = useState("info");
  const [m, setM] = useState<string | null>(null);
  if (error) return <div className="card"><Empty text={error} /></div>;
  if (!data) return <Loading />;
  const e = data.employee, P = data.position, B = data.balances, W = can("hr.write");
  const total = Number(e.basic) + Number(e.housing) + Number(e.transport) + Number(e.otherAllow);
  const kv = (k: string, v: any) => <div className="item"><span>{k}</span><b>{v || "—"}</b></div>;
  return (
    <div className="grid" data-emp-profile={e.code}>
      <div className="card">
        <div className="row between" style={{ flexWrap: "wrap", gap: 10 }}>
          <div><div className="row" style={{ gap: 8, alignItems: "center" }}><h2 style={{ margin: 0 }}>{e.name}</h2><span className={"badge " + (e.isActive ? "green" : "gray")}>{e.isActive ? "على رأس العمل" : "منتهية خدمته"}</span></div>
            <div className="small muted">{e.code} · {e.jobTitle || "—"} · {e.department || "—"}{e.managerName ? ` · المدير: ${e.managerName}` : ""}</div></div>
          <div className="row no-print" style={{ gap: 6 }}>{W && <button className="btn" data-emp-raise onClick={() => setM("raise")}>تعديل الراتب</button>}{W && <button className="btn" onClick={() => setM("leave")}>طلب إجازة</button>}{W && <button className="btn" onClick={() => setM("doc")}>＋ وثيقة</button>}{W && e.isActive && <EmpPortalBtn e={e} onChange={reload} />}<PrintBtn pdfName={e.name} /></div>
        </div>
        {(data.checks.iban || data.checks.idNumber) && <div className="alert warn small mt">{[data.checks.iban, data.checks.idNumber].filter(Boolean).join(" · ")} — مطلوب لملف حماية الأجور.</div>}
        <div className="fc-kpis mt">
          <div className="fc-kpi"><span>الراتب الشهري</span><b className="num">{money(total)}</b><small>أساسي {money(e.basic)} · سكن {money(e.housing)}</small></div>
          <div className="fc-kpi"><span>مدة الخدمة</span><b className="num">{P.years} سنة</b><small>منذ {String(e.hireDate || "").slice(0, 10) || "—"}</small></div>
          <div className="fc-kpi" data-emp-annual><span>رصيد الإجازة السنوية</span><b className="num">{B.annual.balance}</b><small>استحق {B.annual.accrued} · استخدم {B.annual.taken}</small></div>
          <div className="fc-kpi"><span>مكافأة نهاية الخدمة حتى اليوم</span><b className="num">{money(P.eosbDue)}</b><small>المخصص {money(P.eosbBal)}</small></div>
          <div className="fc-kpi"><span>سلف قائمة</span><b className="num">{money(P.loans)}</b></div>
        </div>
      </div>
      <div className="tabs">{[["info", "الملف"], ["pay", "الراتب وتاريخه"], ["leaves", `الإجازات (${data.leaves.length})`], ["docs", `الوثائق (${data.documents.length})`], ["slips", `قسائم الرواتب (${data.payslips.length})`]].map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "info" && <div className="grid c2">
        <div className="card"><div className="card-h"><h3>الهوية والتواصل</h3></div><div className="stat-list">{kv("الجنسية", e.country || (e.nationality === "SAUDI" ? "سعودي" : e.nationality))}{kv("الهوية", e.idNumber ? `${({ NATIONAL_ID: "هوية وطنية", IQAMA: "إقامة", PASSPORT: "جواز", BORDER: "رقم حدود" } as any)[e.idType] || ""} ${e.idNumber}` : null)}{kv("الجنس", e.gender === "F" ? "أنثى" : e.gender === "M" ? "ذكر" : null)}{kv("الجوال", e.phone)}{kv("البريد", e.email)}{kv("IBAN", e.iban)}{kv("البنك", e.bankName)}</div></div>
        <div className="card"><div className="card-h"><h3>العقد والتأمينات</h3></div><div className="stat-list">{kv("نوع العقد", ({ INDEFINITE: "غير محدد المدة", FIXED: "محدد المدة", PART_TIME: "دوام جزئي" } as any)[e.contractType])}{kv("نهاية العقد", e.contractEnd && String(e.contractEnd).slice(0, 10))}{kv("نهاية التجربة", e.probationEnd && String(e.probationEnd).slice(0, 10))}{!EG && kv("نظام التأمينات", e.gosi ? (e.gosiSchemeResolved === "NEW" ? "النظام الجديد" : "النظام السابق") : "غير مسجل")}{kv("رقم المشترك", e.gosiNumber)}{kv("أيام الإجازة السنوية", e.leaveDaysPerYear)}</div></div>
      </div>}
      {tab === "pay" && <div className="card"><div className="card-h"><h3>تاريخ الراتب</h3></div>{!data.history.length ? <Empty text="لا تعديلات مسجلة" /> : <div className="table-wrap"><table className="tbl compact" data-emp-history><thead><tr><th>من تاريخ</th><th className="n">قبل</th><th className="n">بعد</th><th className="n">الفرق</th><th>السبب</th><th>الحالة</th><th /></tr></thead><tbody>{data.history.map((h: any) => <tr key={h.id}><td>{h.effectiveDate}</td><td className="n"><Money v={h.oldTotal} /></td><td className="n"><Money v={h.newTotal} /></td><td className="n"><span className={h.newTotal >= h.oldTotal ? "pos-val" : "neg-val"}>{money(h.newTotal - h.oldTotal)}</span></td><td className="small">{h.reason}</td><td><span className={"badge " + (h.status === "APPLIED" ? "green" : h.status === "PENDING" ? "amber" : "gray")}>{h.status === "APPLIED" ? "سارٍ" : h.status === "PENDING" ? "ينتظر تاريخه" : "ملغى"}</span></td><td>{W && h.status === "PENDING" && <button className="btn sm ghost" onClick={async () => { await api(`/hr/salary-changes/${h.id}/cancel`, { body: {} }); reload(); }}>إلغاء</button>}</td></tr>)}</tbody></table></div>}</div>}
      {tab === "leaves" && <div className="card"><div className="card-h"><h3>الإجازات</h3></div><div className="row small mb" style={{ gap: 14, flexWrap: "wrap" }}>{B.others.filter((o: any) => o.used || o.left !== null).map((o: any) => <span key={o.code}>{o.name}: استُخدم {o.used}{o.left !== null ? ` · المتبقي ${o.left}` : ""}</span>)}</div><LeaveTable rows={data.leaves} onChanged={reload} /></div>}
      {tab === "docs" && <div className="card"><DocTable rows={data.documents} onChanged={reload} /></div>}
      {tab === "slips" && <div className="card">{!data.payslips.length ? <Empty text="لا مسيرات بعد" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الشهر</th><th className="n">الإجمالي</th><th className="n">التأمينات</th><th className="n">الخصومات</th><th className="n">الصافي</th></tr></thead><tbody>{data.payslips.map((s: any) => <tr key={s.runId}><td>{s.period}</td><td className="n"><Money v={s.gross} /></td><td className="n"><Money v={s.gosiEmp} /></td><td className="n"><Money v={Number(s.deduction) + Number(s.absence) + Number(s.loan || 0)} /></td><td className="n"><b><Money v={s.net} /></b></td></tr>)}</tbody></table></div>}</div>}
      {m === "raise" && <RaiseModal e={e} onClose={() => setM(null)} onDone={() => { setM(null); reload(); }} />}
      {m === "leave" && <LeaveModal emps={[e]} fixed={e} onClose={() => setM(null)} onDone={() => { setM(null); reload(); }} />}
      {m === "doc" && <DocModal emps={[e]} init={{ employeeId: e.id }} onClose={() => setM(null)} onDone={() => { setM(null); reload(); }} />}
    </div>
  );
}
function RaiseModal({ e, onClose, onDone }: any) {
  const [f, setF] = useState<any>({ effectiveDate: today().slice(0, 8) + "01", basic: Number(e.basic), housing: Number(e.housing), transport: Number(e.transport), otherAllow: Number(e.otherAllow), reason: "" });
  const { run, busy } = useAction();
  const before = Number(e.basic) + Number(e.housing) + Number(e.transport) + Number(e.otherAllow), after = ["basic", "housing", "transport", "otherAllow"].reduce((a, k) => a + Number(f[k] || 0), 0);
  const set = (k: string) => (ev: any) => setF({ ...f, [k]: ev.target.value });
  return <Modal title={`تعديل راتب ${e.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" data-raise-save disabled={busy} onClick={() => run(async () => { await api(`/hr/employees/${e.id}/salary-change`, { body: f }); onDone(); }, "سُجّل التعديل")}>حفظ</button></>}>
    <div className="grid c2"><Field label="يسري من"><Input type="date" value={f.effectiveDate} onChange={set("effectiveDate")} data-raise-date /></Field><Field label="السبب"><Input value={f.reason} onChange={set("reason")} placeholder="ترقية، تقييم سنوي، تعديل عقد…" /></Field>
      <Field label="الأساسي"><NumInput value={f.basic} onChange={set("basic")} data-raise-basic /></Field><Field label="السكن"><NumInput value={f.housing} onChange={set("housing")} /></Field><Field label="النقل"><NumInput value={f.transport} onChange={set("transport")} /></Field><Field label="بدلات أخرى"><NumInput value={f.otherAllow} onChange={set("otherAllow")} /></Field></div>
    <div className="alert small">{money(before)} ← <b>{money(after)}</b> ({before ? `${after >= before ? "+" : ""}${(((after - before) / before) * 100).toFixed(1)}%` : ""}). {f.effectiveDate > today() ? "يُطبَّق تلقائياً في تاريخه، ويبقى الراتب الحالي حتى ذلك اليوم." : "يُطبَّق الآن."}</div>
  </Modal>;
}

// ───────────────────────── leave ─────────────────────────
function LeaveTable({ rows, onChanged, showEmp }: { rows: any[]; onChanged: () => void; showEmp?: boolean }) {
  const { can } = useCompanyContext(); const { run, busy } = useAction(); const W = can("hr.write");
  const [att, setAtt] = useState<any>(null);
  const act = (l: any, path: string, msg: string, note?: string) => run(async () => { await api(`/hr/leave-requests/${l.id}/${path}`, { body: { note } }); onChanged(); }, msg);
  if (!rows.length) return <Empty text="لا إجازات" />;
  return <><div className="table-wrap"><table className="tbl compact" data-leave-table><thead><tr>{showEmp && <th>الموظف</th>}<th>النوع</th><th>من</th><th>إلى</th><th className="n">الأيام</th><th className="n">بدون أجر</th><th>السبب</th><th>الحالة</th><th /></tr></thead>
    <tbody>{rows.map((l: any) => <tr key={l.id} data-leave-row={l.status}>{showEmp && <td><Link to={`/hr/employees/${l.employeeId}`}>{l.employeeName}</Link><div className="small muted">{l.department || ""}</div></td>}<td>{l.typeName}{l.via === "PORTAL" && <span className="badge blue" style={{ marginInlineStart: 6 }} title="طلبه الموظف من بوابة الموظف">📱 من البوابة</span>}</td><td>{l.fromDate}</td><td>{l.toDate}</td><td className="n">{l.days}</td><td className="n">{l.unpaidDays ? l.unpaidDays : "—"}</td><td className="small">{l.reason || l.notes || ""}{l.decisionNote ? <div className="muted">القرار: {l.decisionNote}</div> : null}</td><td><LBadge s={l.status} />{l.decidedBy && <div className="small muted">{l.decidedBy}</div>}</td>
      <td className="row" style={{ gap: 4 }}>{W && l.status === "PENDING" && <><button className="btn sm primary" disabled={busy} data-leave-approve onClick={() => act(l, "approve", "اعتُمدت الإجازة")}>اعتماد</button><button className="btn sm" disabled={busy} data-leave-reject onClick={() => { const n = window.prompt("سبب الرفض") ?? undefined; if (n !== undefined) act(l, "reject", "رُفض الطلب", n); }}>رفض</button></>}{W && ["PENDING", "APPROVED"].includes(l.status) && <button className="btn sm ghost" disabled={busy} onClick={() => { if (confirmDlg("إلغاء الإجازة؟")) act(l, "cancel", "أُلغيت"); }}>إلغاء</button>}<button className="btn sm ghost" title="المرفقات (تقرير طبي…)" onClick={() => setAtt(l)}>📎</button></td></tr>)}</tbody></table></div>
    {att && <Modal title={`مرفقات إجازة ${att.employeeName || ""}`} narrow onClose={() => setAtt(null)}><Attachments entity="hr_leave" id={att.id} canWrite={W} /></Modal>}</>;
}
function LeaveModal({ emps, fixed, onClose, onDone }: { emps: any[]; fixed?: any; onClose: () => void; onDone: () => void }) {
  const types = useFetch<any[]>("/hr/leave-types");
  const [f, setF] = useState<any>({ employeeId: fixed?.id || "", typeId: "", fromDate: today(), toDate: today(), reason: "", approve: false });
  const [q, setQ] = useState<any>(null);
  const { run, busy } = useAction();
  useEffect(() => { if (!f.typeId && types.data?.length) setF((x: any) => ({ ...x, typeId: types.data!.find((t: any) => t.isActive)?.id })); }, [types.data]);
  const key = JSON.stringify([f.employeeId, f.typeId, f.fromDate, f.toDate]);
  useEffect(() => { if (!f.employeeId || !f.typeId || !f.fromDate || !f.toDate) { setQ(null); return; } const t = setTimeout(() => api("/hr/leave-requests/quote", { body: f }).then(setQ).catch((e) => setQ({ error: String(e.message || e) })), 250); return () => clearTimeout(t); }, [key]);
  const ty = (types.data || []).find((t: any) => t.id === f.typeId);
  return <Modal title="طلب إجازة" onClose={onClose} footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" data-leave-save disabled={busy || !q || q.error} onClick={() => run(async () => { await api("/hr/leave-requests", { body: f }); onDone(); }, f.approve ? "سُجّلت الإجازة معتمدة" : "سُجّل الطلب بانتظار القرار")}>{f.approve ? "حفظ واعتماد" : "إرسال الطلب"}</button></>}>
    {!fixed && <Field label="الموظف"><Select value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })} data-leave-emp><option value="">اختر الموظف</option>{emps.filter((e) => e.isActive).map((e) => <option key={e.id} value={e.id}>{e.code} — {e.name}</option>)}</Select></Field>}
    <div className="grid c3"><Field label="النوع"><Select value={f.typeId} onChange={(e) => setF({ ...f, typeId: e.target.value })} data-leave-type>{(types.data || []).filter((t: any) => t.isActive).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
      <Field label="من"><Input type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} data-leave-from /></Field><Field label="إلى (شاملاً)"><Input type="date" value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} data-leave-to /></Field></div>
    <Field label="السبب"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
    {ty?.note && <div className="small muted">{ty.note}</div>}
    {q?.error && <div className="alert warn small" data-leave-error>{q.error}</div>}
    {q && !q.error && <div className="alert small" data-leave-quote>{q.days} يوم{q.pay.length > 1 || q.pay[0].pct !== 100 ? ` — ${q.pay.map((p: any) => `${p.days} بأجر ${p.pct}%`).join("، ")}` : " بأجر كامل"}{q.unpaidDays ? ` · يُخصم من الراتب ما يعادل ${q.unpaidDays} يوم` : ""}{q.balance !== null ? ` · الرصيد قبلها ${q.balance} يوم` : ""}{q.warnings?.length ? <div className="neg-val">{q.warnings.join(" · ")}</div> : null}</div>}
    <label className="check"><input type="checkbox" checked={f.approve} onChange={(e) => setF({ ...f, approve: e.target.checked })} /> اعتمدها الآن (بدون انتظار قرار)</label>
  </Modal>;
}
export function LeavesCenter() {
  const emps = useEmps();
  const [st, setSt] = useState("PENDING");
  const { data, reload } = useFetch<any[]>(`/hr/leave-requests${st ? `?status=${st}` : ""}`, [st]);
  const [neu, setNeu] = useState(false);
  const [types, setTypes] = useState(false);
  useNewParam(() => setNeu(true));
  return <div className="grid" data-leaves>
    <div className="card"><div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <div className="seg">{[["PENDING", "بانتظار القرار"], ["APPROVED", "المعتمدة"], ["REJECTED", "المرفوضة"], ["", "الكل"]].map(([k, l]) => <button key={k} className={st === k ? "on" : ""} onClick={() => setSt(k)}>{l}</button>)}</div><div className="grow" />
      {data && <ExportBtn name="الإجازات" rows={() => data.map((l: any) => ({ الموظف: l.employeeName, النوع: l.typeName, من: l.fromDate, إلى: l.toDate, الأيام: l.days, "بدون أجر": l.unpaidDays, الحالة: LS[l.status]?.[0] }))} />}
      <button className="btn" onClick={() => setTypes(true)}>أنواع الإجازات</button><button className="btn primary" data-leave-new onClick={() => setNeu(true)}>＋ طلب إجازة</button>
    </div></div>
    <div className="card">{!data ? <Loading /> : <LeaveTable rows={data} onChanged={reload} showEmp />}</div>
    <div className="card small muted">المعتمدة فقط تدخل الرصيد والمسير. الجزء غير المدفوع (إجازة بدون أجر، أو ما بعد 30 يوماً من الإجازة المرضية بثلاثة أرباع الأجر ثم بلا أجر) يُخصم من مسير شهره بواقع ثلاثين جزءاً من الراتب الثابت لليوم.</div>
    {neu && emps.data && <LeaveModal emps={emps.data} onClose={() => setNeu(false)} onDone={() => { setNeu(false); reload(); }} />}
    {types && <LeaveTypesModal onClose={() => setTypes(false)} />}
  </div>;
}
function LeaveTypesModal({ onClose }: { onClose: () => void }) {
  const { data, reload } = useFetch<any[]>("/hr/leave-types");
  const { run, busy } = useAction();
  const [edit, setEdit] = useState<any>(null);
  return <Modal wide title="أنواع الإجازات" onClose={onClose}>
    {!data ? <Loading /> : <div className="table-wrap"><table className="tbl compact" data-leave-types><thead><tr><th>النوع</th><th className="n">الحد</th><th>المدة</th><th>الأجر</th><th>لمن</th><th /></tr></thead><tbody>{data.map((t: any) => <tr key={t.id} className={t.isActive ? "" : "muted"}><td><b>{t.name}</b><div className="small muted">{t.note}</div></td><td className="n">{t.usesBalance ? "الرصيد" : t.maxDays ?? "—"}</td><td className="small">{PER[t.per]}</td><td className="small">{t.tiers?.length ? t.tiers.map((x: any) => `${x.days} يوم ${x.pct}%`).join(" ← ") : `${t.paidPct}%`}</td><td className="small">{t.gender === "F" ? "الموظفات" : t.gender === "M" ? "الموظفون" : "الجميع"}{t.minServiceMonths ? ` · بعد ${t.minServiceMonths} شهراً` : ""}</td><td><button className="btn sm ghost" onClick={() => setEdit(t)}>تعديل</button></td></tr>)}</tbody></table></div>}
    <button className="btn sm mt" onClick={() => setEdit({ name: "", paidPct: 100, per: "OCCURRENCE", gender: "ANY", isActive: true })}>＋ نوع آخر</button>
    <div className="small muted mt">القيم الافتراضية من نظام العمل بعد تعديلاته — راجعها مع مستشارك قبل الاعتماد عليها، وعدّلها حسب لائحة المنشأة إن كانت أفضل للموظف.</div>
    {edit && <Modal narrow title={edit.id ? edit.name : "نوع إجازة"} onClose={() => setEdit(null)} footer={<button className="btn primary" disabled={busy} onClick={() => run(async () => { await api(edit.id ? `/hr/leave-types/${edit.id}` : "/hr/leave-types", { method: edit.id ? "PUT" : "POST", body: edit }); setEdit(null); reload(); }, "حُفظ")}>حفظ</button>}>
      <Field label="الاسم"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
      <div className="grid c2"><Field label="الحد الأقصى (يوم)" hint="فارغ = بلا حد"><NumInput value={edit.maxDays ?? ""} onChange={(e: any) => setEdit({ ...edit, maxDays: e.target.value })} /></Field><Field label="المدة"><Select value={edit.per} onChange={(e) => setEdit({ ...edit, per: e.target.value })}>{Object.entries(PER).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="نسبة الأجر %"><NumInput value={edit.paidPct} onChange={(e: any) => setEdit({ ...edit, paidPct: e.target.value })} /></Field><Field label="لمن"><Select value={edit.gender} onChange={(e) => setEdit({ ...edit, gender: e.target.value })}><option value="ANY">الجميع</option><option value="F">الموظفات</option><option value="M">الموظفون</option></Select></Field></div>
      <label className="check"><input type="checkbox" checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} /> نشط</label>
    </Modal>}
  </Modal>;
}

// ───────────────────────── documents ─────────────────────────
function DocTable({ rows, onChanged, showEmp }: { rows: any[]; onChanged: () => void; showEmp?: boolean }) {
  const { can } = useCompanyContext(); const W = can("hr.write");
  const [edit, setEdit] = useState<any>(null);
  if (!rows.length) return <Empty text="لا وثائق" />;
  return <><div className="table-wrap"><table className="tbl compact" data-doc-table><thead><tr>{showEmp && <th>الموظف</th>}<th>الوثيقة</th><th>الرقم</th><th>الإصدار</th><th>الانتهاء</th><th>الحالة</th><th /></tr></thead>
    <tbody>{rows.map((d: any) => <tr key={d.id} data-doc-state={d.state}>{showEmp && <td><Link to={`/hr/employees/${d.employeeId}`}>{d.employeeName}</Link></td>}<td>{d.kindAr}</td><td className="num">{d.number || "—"}</td><td className="small">{d.issueDate || "—"}</td><td className="small">{d.expiryDate || "—"}</td><td><DBadge d={d} /></td><td><button className="btn sm ghost" onClick={() => setEdit(d)}>{W ? "تعديل" : "عرض"}</button></td></tr>)}</tbody></table></div>
    {edit && <DocModal emps={[]} init={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); onChanged(); }} />}</>;
}
function DocModal({ emps, init, onClose, onDone }: any) {
  const act = emps.filter((e: any) => e.isActive);
  const [f, setF] = useState<any>({ kind: "IQAMA", number: "", issueDate: "", expiryDate: "", issuer: "", notes: "", employeeId: act.length === 1 ? act[0].id : undefined, ...init });
  const { run, busy } = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return <Modal title={f.id ? `${DOC_KINDS[f.kind]} — ${f.employeeName || ""}` : "وثيقة موظف"} onClose={onClose} footer={<>{f.id && <button className="btn ghost danger" onClick={() => run(async () => { if (!confirmDlg("حذف الوثيقة؟")) return; await api(`/hr/documents/${f.id}`, { method: "DELETE" }); onDone(); })}>حذف</button>}<div className="grow" /><button className="btn" onClick={onClose}>إغلاق</button><button className="btn primary" data-doc-save disabled={busy || !f.employeeId} onClick={() => run(async () => { await api(f.id ? `/hr/documents/${f.id}` : "/hr/documents", { method: f.id ? "PUT" : "POST", body: f }); onDone(); }, "حُفظت الوثيقة")}>حفظ</button></>}>
    {!f.id && <Field label="الموظف"><Select value={f.employeeId || ""} onChange={set("employeeId")} data-doc-emp><option value="">اختر الموظف</option>{emps.filter((e: any) => e.isActive).map((e: any) => <option key={e.id} value={e.id}>{e.code} — {e.name}</option>)}</Select></Field>}
    <div className="grid c2"><Field label="النوع"><Select value={f.kind} onChange={set("kind")} data-doc-kind>{Object.entries(DOC_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field><Field label="الرقم"><Input value={f.number || ""} onChange={set("number")} dir="ltr" data-doc-number /></Field>
      <Field label="تاريخ الإصدار"><Input type="date" value={f.issueDate || ""} onChange={set("issueDate")} /></Field><Field label="تاريخ الانتهاء"><Input type="date" value={f.expiryDate || ""} onChange={set("expiryDate")} data-doc-expiry /></Field>
      <Field label="جهة الإصدار"><Input value={f.issuer || ""} onChange={set("issuer")} /></Field><Field label="ملاحظات"><Input value={f.notes || ""} onChange={set("notes")} /></Field></div>
    {f.id && <Attachments entity="hr_doc" id={f.id} />}
  </Modal>;
}
export function DocumentsCenter() {
  const emps = useEmps();
  const [within, setWithin] = useState("90");
  const { data, reload } = useFetch<any[]>(`/hr/documents${within ? `?within=${within}` : ""}`, [within]);
  const [neu, setNeu] = useState(false);
  return <div className="grid" data-docs>
    <div className="card"><div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <div className="seg">{[["0", "المنتهية"], ["30", "خلال 30 يوماً"], ["90", "خلال 90 يوماً"], ["", "كل الوثائق"]].map(([k, l]) => <button key={k} className={within === k ? "on" : ""} onClick={() => setWithin(k)}>{l}</button>)}</div><div className="grow" />
      {data && <ExportBtn name="وثائق الموظفين" rows={() => data.map((d: any) => ({ الموظف: d.employeeName, الوثيقة: d.kindAr, الرقم: d.number, الانتهاء: d.expiryDate, "الأيام المتبقية": d.daysLeft }))} />}
      <button className="btn primary" data-doc-new onClick={() => setNeu(true)}>＋ وثيقة</button>
    </div></div>
    <div className="card">{!data ? <Loading /> : <DocTable rows={within === "0" ? data.filter((d) => d.state === "EXPIRED") : data} onChanged={reload} showEmp />}</div>
    <div className="small muted card">جدّد الإقامة ورخصة العمل والتأمين الطبي قبل انتهائها لتجنب الغرامات وتعطل الخدمات في قوى ومقيم. تظهر الوثائق القريبة من الانتهاء في لوحة الموارد البشرية.</div>
    {neu && emps.data && <DocModal emps={emps.data} init={{}} onClose={() => setNeu(false)} onDone={() => { setNeu(false); reload(); }} />}
  </div>;
}

// ───────────────────────── GOSI ─────────────────────────
export function GosiPage() {
  const { data, reload } = useFetch<any>("/hr/gosi-rates");
  const settings = useFetch<any>("/hr/settings");
  const { can } = useCompanyContext(); const W = can("hr.write");
  const { run, busy } = useAction();
  const [add, setAdd] = useState<any>(null);
  if (!data) return <Loading />;
  return <div className="grid" data-gosi>
    {!EG && <div className="card"><div className="card-h"><h3>النسب السارية اليوم</h3></div><div className="table-wrap"><table className="tbl compact" data-gosi-now><thead><tr><th>النظام</th><th>الجنسية</th><th className="n">الموظف</th><th className="n">المنشأة</th><th>الفروع</th></tr></thead><tbody>{data.now.map((x: any, i: number) => <tr key={i}><td>{x.scheme === "NEW" ? `النظام الجديد (التسجيل من ${data.newLawFrom})` : "النظام السابق"}</td><td>{x.nationality === "SAUDI" ? "سعودي" : "غير سعودي"}</td><td className="n"><b>{x.employee}%</b></td><td className="n"><b>{x.employer}%</b></td><td className="small">{x.branches.map((b: any) => `${BR[b.branch]} ${b.employee}/${b.employer}`).join(" · ")}</td></tr>)}</tbody></table></div>
      <div className="small muted mt">على الأساسي + السكن، بحد أعلى {money(data.maxBase)} للأجر الخاضع. نظام الموظف يُحدد من تاريخ أول تسجيل في ملفه (أو تاريخ التعيين)، ويمكن تحديده يدوياً.</div></div>}
    {!EG && <div className="card"><div className="card-h"><h3>جدول النسب بتاريخ سريانها</h3>{W && <div className="row"><button className="btn sm" onClick={() => setAdd({ kind: "rate", scheme: "NEW", nationality: "SAUDI", branch: "PENSION", employeePct: "", employerPct: "", effectiveFrom: today() })}>＋ نسبة</button><button className="btn sm" onClick={() => setAdd({ kind: "limit", maxBase: 45000, minBase: 0, effectiveFrom: today() })}>＋ حد الأجر</button></div>}</div>
      <div className="table-wrap"><table className="tbl compact" data-gosi-rates><thead><tr><th>من تاريخ</th><th>النظام</th><th>الجنسية</th><th>الفرع</th><th className="n">الموظف %</th><th className="n">المنشأة %</th><th>المصدر</th><th /></tr></thead><tbody>{data.rates.map((r: any) => <tr key={r.id}><td>{r.effectiveFrom}</td><td>{r.scheme === "NEW" ? "الجديد" : "السابق"}</td><td>{r.nationality === "SAUDI" ? "سعودي" : "غير سعودي"}</td><td>{BR[r.branch]}</td><td className="n">{r.employeePct}</td><td className="n">{r.employerPct}</td><td className="small">{r.own ? "أضافته المنشأة" : "المنشور"}{r.note ? ` — ${r.note}` : ""}</td><td>{W && r.own && <button className="btn sm ghost" onClick={() => run(async () => { await api(`/hr/gosi/rate/${r.id}`, { method: "DELETE" }); reload(); })}>حذف</button>}</td></tr>)}</tbody></table></div>
      <div className="table-wrap"><table className="tbl compact mt"><thead><tr><th>من تاريخ</th><th className="n">الحد الأدنى</th><th className="n">الحد الأعلى</th><th>المصدر</th><th /></tr></thead><tbody>{data.limits.map((l: any) => <tr key={l.id}><td>{l.effectiveFrom}</td><td className="n">{money(l.minBase)}</td><td className="n">{money(l.maxBase)}</td><td className="small">{l.own ? "أضافته المنشأة" : "المنشور"}</td><td>{W && l.own && <button className="btn sm ghost" onClick={() => run(async () => { await api(`/hr/gosi/limit/${l.id}`, { method: "DELETE" }); reload(); })}>حذف</button>}</td></tr>)}</tbody></table></div>
      <div className="small muted mt">النسب المنشورة من التأمينات الاجتماعية ونظام التأمينات الجديد (زيادة فرع المعاشات نصف نقطة على كل طرف كل يوليو حتى 11% في 2028). تحقق منها في gosi.gov.sa؛ وإن صدر تعديل أضفه بتاريخ سريانه دون تغيير ما سبق.</div></div>}
    <div className="card" id="hr-settings"><div className="card-h"><h3>سياسة المسير</h3></div><label className="check"><input type="checkbox" checked={!!settings.data?.requireApproval} disabled={!can("settings.write")} onChange={(e) => run(async () => { await api("/hr/settings", { method: "PUT", body: { requireApproval: e.target.checked } }); settings.reload(); }, "حُفظت السياسة")} data-hr-approval /> يُعتمد مسير الرواتب قبل ترحيله، ويعتمده مستخدم غير من أعدّه (اعتماد ثم ترحيل)</label></div>
    {add && <Modal narrow title={add.kind === "rate" ? "نسبة اشتراك" : "حد الأجر الخاضع"} onClose={() => setAdd(null)} footer={<button className="btn primary" disabled={busy} onClick={() => run(async () => { await api(add.kind === "rate" ? "/hr/gosi-rates" : "/hr/gosi-limits", { body: add }); setAdd(null); reload(); }, "أُضيف")}>إضافة</button>}>
      <Field label="يسري من"><Input type="date" value={add.effectiveFrom} onChange={(e) => setAdd({ ...add, effectiveFrom: e.target.value })} /></Field>
      {add.kind === "rate" ? <div className="grid c2"><Field label="النظام"><Select value={add.scheme} onChange={(e) => setAdd({ ...add, scheme: e.target.value })}><option value="NEW">الجديد</option><option value="OLD">السابق</option></Select></Field><Field label="الجنسية"><Select value={add.nationality} onChange={(e) => setAdd({ ...add, nationality: e.target.value })}><option value="SAUDI">سعودي</option><option value="NON_SAUDI">غير سعودي</option></Select></Field><Field label="الفرع"><Select value={add.branch} onChange={(e) => setAdd({ ...add, branch: e.target.value })}>{Object.entries(BR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field><div /><Field label="على الموظف %"><NumInput value={add.employeePct} onChange={(e: any) => setAdd({ ...add, employeePct: e.target.value })} /></Field><Field label="على المنشأة %"><NumInput value={add.employerPct} onChange={(e: any) => setAdd({ ...add, employerPct: e.target.value })} /></Field></div>
        : <div className="grid c2"><Field label="الحد الأدنى"><NumInput value={add.minBase} onChange={(e: any) => setAdd({ ...add, minBase: e.target.value })} /></Field><Field label="الحد الأعلى"><NumInput value={add.maxBase} onChange={(e: any) => setAdd({ ...add, maxBase: e.target.value })} /></Field></div>}
    </Modal>}
  </div>;
}
