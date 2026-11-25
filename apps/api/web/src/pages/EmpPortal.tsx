/** 3.53.0 employee self-service (public, /e/:token): payslips, leave balance, documents, and a leave request — on the phone. */
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, Money, qty, fmtDate, Loading } from "../lib";
import { CUR } from "../shared/country";

const ST: Record<string, [string, string]> = { PENDING: ["بانتظار القرار", "amber"], APPROVED: ["معتمدة", "green"], REJECTED: ["مرفوضة", "red"], CANCELLED: ["ملغاة", "gray"] };
const DS: Record<string, [string, string]> = { EXPIRED: ["منتهية", "red"], SOON: ["تنتهي قريباً", "amber"], UPCOMING: ["سارية", "blue"], OK: ["سارية", "green"] };
const PIN_KEY = (t: string) => "mz_emp_pin_" + t;

export function EmployeePortal() {
  const { token = "" } = useParams();
  const [pin, setPin] = useState(() => { try { return sessionStorage.getItem(PIN_KEY(token)) || ""; } catch { return ""; } });
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState(""); const [needPin, setNeedPin] = useState(false); const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"home" | "slips" | "leave" | "docs">("home");
  const [only, setOnly] = useState<string | null>(null);
  const load = async (p = pin) => {
    setBusy(true); setErr("");
    try { const r = await api(`/public/emp/${token}`, { body: { pin: p } }); setD(r); setNeedPin(false); try { if (p) sessionStorage.setItem(PIN_KEY(token), p); } catch {} }
    catch (e: any) { if (e.code === "PIN_REQUIRED" || e.code === "PIN_WRONG") { setNeedPin(true); if (e.code === "PIN_WRONG") setErr(e.message); try { sessionStorage.removeItem(PIN_KEY(token)); } catch {} } else setErr(e.message); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, [token]);
  useEffect(() => { const h = () => setOnly(null); window.addEventListener("afterprint", h); return () => window.removeEventListener("afterprint", h); }, []);
  if (needPin) return <div className="emp-portal" data-emp-pin><div className="card"><div className="card-b">
    <h3 style={{ marginTop: 0 }}>بوابة الموظف</h3><p className="small muted">للتحقق من هويتك اكتب آخر 4 أرقام من رقم هويتك أو إقامتك.</p>
    <form onSubmit={(e) => { e.preventDefault(); load(pin); }} className="row" style={{ gap: 8 }}><input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} aria-label="آخر 4 أرقام من الهوية" style={{ maxWidth: 140, letterSpacing: 6, textAlign: "center" }} data-emp-pin-input autoFocus /><button className="btn primary" disabled={busy || pin.length !== 4}>دخول</button></form>
    {err && <div className="alert danger mt small">{err}</div>}</div></div></div>;
  if (err) return <div className="emp-portal"><div className="empty" style={{ paddingTop: 60 }}>{err}</div></div>;
  if (!d) return <Loading />;
  const e = d.employee, c = d.company, A = d.balances.annual;
  const slips = only ? d.payslips.filter((s: any) => s.period === only) : d.payslips;
  return <div className="emp-portal" data-emp-portal>
    <div className="card no-print"><div className="card-b row" style={{ gap: 12, alignItems: "center" }}>
      {c.logo ? <img src={c.logo} alt="" style={{ height: 44, maxWidth: 90, objectFit: "contain" }} /> : <img src="/favicon.svg" width={36} alt="" />}
      <div className="grow"><b style={{ fontSize: 17 }}>{e.name}</b><div className="small muted">{[e.jobTitle, e.department, c.nameAr].filter(Boolean).join(" · ")}</div></div>
    </div></div>
    <div className="seg no-print emp-tabs" role="tablist">{([["home", "الرئيسية"], ["slips", "قسائم الراتب"], ["leave", "الإجازات"], ["docs", "وثائقي"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)} data-emp-tab={k}>{l}</button>)}</div>
    {tab === "home" && <>
      <div className="grid c2">
        <div className="card kpi success"><div className="label">رصيد الإجازة السنوية</div><div className="value" data-emp-balance>{qty(A.balance)} يوم</div><div className="sub">استحق {qty(A.accrued)} · استخدم {qty(A.taken)}</div></div>
        <div className="card kpi"><div className="label">آخر راتب صافٍ</div><div className="value">{d.payslips[0] ? <Money v={d.payslips[0].net} /> : "—"}</div><div className="sub">{d.payslips[0] ? `${d.payslips[0].period} · ${CUR()}` : "لا قسائم بعد"}</div></div>
      </div>
      <div className="card"><div className="card-b small">
        <div>تاريخ التعيين: <b>{fmtDate(e.hireDate)}</b>{d.service?.years != null && <> · مدة الخدمة <b>{qty(d.service.years)}</b> سنة</>}</div>
        {e.contractEnd && <div>نهاية العقد: <b>{fmtDate(e.contractEnd)}</b></div>}
        {e.ibanTail && <div>الراتب يُحوَّل إلى الحساب المنتهي بـ <b dir="ltr">{e.ibanTail}</b></div>}
      </div></div>
      {d.documents.some((x: any) => x.state === "EXPIRED" || x.state === "SOON") && <div className="alert warn small">لديك وثيقة منتهية أو تنتهي قريباً — راجع تبويب «وثائقي» وأرسل النسخة المجددة للموارد البشرية.</div>}
      <button className="btn primary" style={{ width: "100%" }} onClick={() => setTab("leave")}>＋ طلب إجازة</button>
    </>}
    {tab === "slips" && (!d.payslips.length ? <div className="empty">لا قسائم رواتب مرحّلة بعد</div> : <div className="grid">{slips.map((s: any) => <Slip key={s.period} s={s} name={e.name} code={e.code} company={c.nameAr} onPrint={() => { setOnly(s.period); setTimeout(() => window.print(), 80); }} />)}</div>)}
    {tab === "leave" && <LeaveTab token={token} pin={pin} d={d} reload={() => load()} />}
    {tab === "docs" && <div className="card"><div className="table-wrap"><table className="tbl compact"><thead><tr><th>الوثيقة</th><th>الرقم</th><th>الانتهاء</th><th></th></tr></thead>
      <tbody>{!d.documents.length ? <tr><td colSpan={4} className="muted">لا وثائق مسجلة</td></tr> : d.documents.map((x: any, i: number) => <tr key={i}><td>{x.kindAr}</td><td dir="ltr">{x.number || "—"}</td><td className="dt">{x.expiryDate ? fmtDate(x.expiryDate) : "—"}</td><td><span className={"badge " + (DS[x.state] || DS.OK)[1]}>{(DS[x.state] || DS.OK)[0]}</span></td></tr>)}</tbody></table></div></div>}
    <div className="small muted no-print" style={{ textAlign: "center" }}>رابط خاص بك من {c.nameAr} — لا تشاركه. للاستفسار تواصل مع الموارد البشرية{c.phone ? ` ${c.phone}` : ""}.</div>
  </div>;
}

function Slip({ s, name, code, company, onPrint }: any) {
  const earn = [["الأساسي", s.basic], ["بدل السكن", s.housing], ["بدل النقل", s.transport], ["بدلات أخرى", s.other], ["مكافأة", s.bonus], ["عمل إضافي", s.overtime]].filter(([, v]) => Number(v));
  const ded = [["التأمينات (حصتك)", s.gosiEmp], ["خصومات", s.deduction], [s.leaveDeduction ? `غياب وإجازة بدون أجر (${qty(s.leaveDeduction.days)} يوم)` : "غياب", s.absence], ["قسط سلفة", s.loan], ["ضريبة كسب العمل", s.salaryTax], ["صندوق الشهداء", s.martyrs]].filter(([, v]) => Number(v));
  return <div className="card slip" data-emp-slip={s.period}><div className="card-h"><div><h3>قسيمة راتب {s.period}</h3><div className="small muted">{company} · {name} ({code})</div></div><button className="btn sm no-print" onClick={onPrint}>طباعة</button></div>
    <div className="card-b"><div className="grid c2">
      <table className="tbl compact"><thead><tr><th>المستحقات</th><th className="n">المبلغ</th></tr></thead><tbody>{earn.map(([l, v]) => <tr key={l as string}><td>{l}</td><td className="n"><Money v={v} /></td></tr>)}</tbody><tfoot><tr><td>الإجمالي</td><td className="n"><Money v={s.gross} /></td></tr></tfoot></table>
      <table className="tbl compact"><thead><tr><th>الاستقطاعات</th><th className="n">المبلغ</th></tr></thead><tbody>{!ded.length ? <tr><td colSpan={2} className="muted">لا استقطاعات</td></tr> : ded.map(([l, v]) => <tr key={l as string}><td>{l}</td><td className="n"><Money v={v} /></td></tr>)}</tbody></table>
    </div><div className="row between mt" style={{ fontSize: 17 }}><b>الصافي</b><b><Money v={s.net} /> {CUR()}</b></div></div></div>;
}

function LeaveTab({ token, pin, d, reload }: any) {
  const [f, setF] = useState<any>({ typeId: d.leaveTypes[0]?.id || "", fromDate: "", toDate: "", reason: "" });
  const [q, setQ] = useState<any>(null); const [qErr, setQErr] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => {
    setQ(null); setQErr("");
    if (!f.typeId || !f.fromDate || !f.toDate) return;
    const h = setTimeout(() => api(`/public/emp/${token}/quote`, { body: { ...f, pin } }).then(setQ).catch((e) => setQErr(e.message)), 250);
    return () => clearTimeout(h);
  }, [f.typeId, f.fromDate, f.toDate]);
  const send = async () => { setBusy(true); setMsg(""); try { await api(`/public/emp/${token}/leave`, { body: { ...f, pin } }); setMsg("أُرسل الطلب — يصلك القرار من الموارد البشرية"); setF({ ...f, fromDate: "", toDate: "", reason: "" }); reload(); } catch (e: any) { setQErr(e.message); } finally { setBusy(false); } };
  const cancel = async (id: string) => { try { await api(`/public/emp/${token}/cancel`, { body: { id, pin } }); reload(); } catch (e: any) { setQErr(e.message); } };
  const ty = d.leaveTypes.find((x: any) => x.id === f.typeId);
  return <div className="grid">
    <div className="card"><div className="card-h"><h3>طلب إجازة</h3></div><div className="card-b grid">
      <label className="field"><span>النوع</span><select className="input" value={f.typeId} onChange={(e) => setF({ ...f, typeId: e.target.value })} data-emp-leave-type>{d.leaveTypes.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>{ty?.note && <span className="small muted">{ty.note}</span>}</label>
      <div className="grid c2"><label className="field"><span>من</span><input className="input" type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value, toDate: f.toDate && f.toDate >= e.target.value ? f.toDate : e.target.value })} data-emp-leave-from /></label>
        <label className="field"><span>إلى</span><input className="input" type="date" value={f.toDate} min={f.fromDate || undefined} onChange={(e) => setF({ ...f, toDate: e.target.value })} data-emp-leave-to /></label></div>
      <label className="field"><span>السبب (اختياري)</span><input className="input" value={f.reason} maxLength={300} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
      {q && <div className="alert info small" data-emp-leave-quote>{qty(q.days)} يوم{q.pay?.length ? " · " + q.pay.map((p: any) => `${qty(p.days)} ${p.pct === 100 ? "بأجر كامل" : p.pct === 0 ? "بدون أجر" : `بأجر ${p.pct}%`}`).join(" + ") : ""}{q.balance != null ? ` · رصيدك قبلها ${qty(q.balance)} يوم` : ""}{q.warnings?.map((w: string) => <div key={w}>⚠ {w}</div>)}</div>}
      {ty?.needsDocument && <div className="small muted">هذا النوع يحتاج مستنداً (تقرير طبي مثلاً) — أرسله للموارد البشرية.</div>}
      {qErr && <div className="alert danger small">{qErr}</div>}{msg && <div className="alert success small" data-emp-leave-sent>{msg}</div>}
      <button className="btn primary" disabled={busy || !q} onClick={send} data-emp-leave-send>إرسال الطلب</button>
    </div></div>
    <div className="card"><div className="card-h"><h3>طلباتي</h3></div><div className="table-wrap"><table className="tbl compact"><thead><tr><th>النوع</th><th>من</th><th>إلى</th><th className="n">أيام</th><th>الحالة</th><th></th></tr></thead>
      <tbody>{!d.leaves.length ? <tr><td colSpan={6} className="muted">لا طلبات</td></tr> : d.leaves.map((l: any) => <tr key={l.id} data-emp-leave-row={l.status}><td>{l.typeName}</td><td className="dt">{fmtDate(l.fromDate)}</td><td className="dt">{fmtDate(l.toDate)}</td><td className="n">{qty(l.days)}</td><td><span className={"badge " + (ST[l.status] || ST.PENDING)[1]}>{(ST[l.status] || ST.PENDING)[0]}</span>{l.decisionNote && <div className="small muted">{l.decisionNote}</div>}</td><td>{l.status === "PENDING" && <button className="btn sm ghost" onClick={() => cancel(l.id)}>إلغاء</button>}</td></tr>)}</tbody></table></div></div>
    <div className="card"><div className="card-h"><h3>أرصدتي</h3></div><div className="table-wrap"><table className="tbl compact"><tbody><tr><td>الإجازة السنوية</td><td className="n"><b>{qty(d.balances.annual.balance)}</b> يوم متاح</td></tr>{d.balances.others.filter((o: any) => o.left != null || o.used).map((o: any) => <tr key={o.code}><td>{o.name}</td><td className="n">استُخدم {qty(o.used)}{o.left != null ? ` · باقٍ ${qty(o.left)}` : ""}</td></tr>)}</tbody></table></div></div>
  </div>;
}
