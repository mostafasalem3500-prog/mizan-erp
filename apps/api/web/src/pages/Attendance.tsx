/** Attendance: daily sheet, month grid with totals, import from a time-clock export, and posting the month to payroll. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, q, useFetch, useAction, useToast, useCompanyContext, Modal, Field, Input, Select, NumInput, Empty, Loading, ExportBtn, today, confirmDlg } from "../lib";
import { readSheet } from "../shared/sheet";

const ST: Record<string, [string, string, string]> = { PRESENT: ["حاضر", "ح", "att-p"], ABSENT: ["غائب", "غ", "att-a"], LEAVE: ["إجازة", "إ", "att-l"], OFF: ["راحة", "ر", "att-o"] };
const WD = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const addH = (t: string, h: number) => { const [a, b] = t.split(":").map(Number); const m = (a * 60 + b + Math.round(h * 60)) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };

export function AttendanceTab() {
  const { can } = useCompanyContext();
  const toast = useToast();
  const { run, busy } = useAction();
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [day, setDay] = useState(today());
  const { data, loading, reload } = useFetch<any>(`/attendance${q({ period })}`, [period]);
  const [rows, setRows] = useState<Record<string, any>>({});
  const [dirty, setDirty] = useState(false);
  const [cfg, setCfg] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const W = can("accounting.write");
  useEffect(() => { if (day.slice(0, 7) !== period) setDay(period === today().slice(0, 7) ? today() : `${period}-01`); }, [period]);
  useEffect(() => { if (!data) return; const m: Record<string, any> = {}; for (const e of data.employees) { const d = e.days[day]; m[e.id] = d ? { status: d.status, timeIn: d.timeIn || "", timeOut: d.timeOut || "" } : { status: "", timeIn: "", timeOut: "" }; } setRows(m); setDirty(false); }, [data, day]);
  const s = data?.settings; const dayInfo = data?.days.find((d: any) => d.date === day);
  const upd = (id: string, p: any) => { setRows((r) => ({ ...r, [id]: { ...r[id], ...p } })); setDirty(true); };
  const fill = (status: string) => { if (!data) return; const end = addH(s.workStart, s.workHours); const m: Record<string, any> = {}; for (const e of data.employees) m[e.id] = status === "PRESENT" ? { status, timeIn: rows[e.id]?.timeIn || s.workStart, timeOut: rows[e.id]?.timeOut || end } : { status, timeIn: "", timeOut: "" }; setRows(m); setDirty(true); };
  const save = () => run(async () => { await api("/attendance/day", { method: "PUT", body: { date: day, rows: Object.entries(rows).map(([employeeId, r]: any) => ({ employeeId, ...r })) } }); reload(); }, "حُفظ حضور اليوم");
  const importFile = async (f: File) => {
    try {
      const aoa = (await readSheet(f)).map((r) => r.map((c) => c ?? ""));
      const hi = aoa.findIndex((r) => r.filter((c) => String(c).trim()).length >= 3); const head = (aoa[hi] || []).map((x: any) => String(x).trim().toLowerCase());
      const col = (re: RegExp) => head.findIndex((x) => re.test(x));
      const ci = { code: col(/كود|رقم الموظف|الرقم|code|emp.*id|^id$|no\.?$/), name: col(/اسم|name/), date: col(/تاريخ|date|اليوم/), timeIn: col(/دخول|حضور|check.?in|^in$|time in/), timeOut: col(/خروج|انصراف|check.?out|^out$|time out/) };
      if (ci.date < 0 || (ci.code < 0 && ci.name < 0)) throw new Error("لم أجد أعمدة «كود الموظف» (أو الاسم) و«التاريخ» — سمِّ الأعمدة: كود الموظف، التاريخ، الدخول، الخروج");
      const body = aoa.slice(hi + 1).filter((r) => r.some((c) => String(c).trim())).map((r) => ({ code: ci.code >= 0 ? r[ci.code] : "", name: ci.name >= 0 ? r[ci.name] : "", date: r[ci.date], timeIn: ci.timeIn >= 0 ? r[ci.timeIn] : "", timeOut: ci.timeOut >= 0 ? r[ci.timeOut] : "" }));
      const r = await api("/attendance/import", { body: { rows: body } });
      toast(`استُورد ${r.saved} سجل في ${r.days} يوم${r.skipped ? ` — تُرك ${r.skipped}: ${r.errors[0] || ""}` : ""}`, r.skipped ? "err" : "ok"); reload();
    } catch (e: any) { toast(e.message, "err"); } finally { if (fileRef.current) fileRef.current.value = ""; }
  };
  const tot = useMemo(() => (data?.employees || []).reduce((a: any, e: any) => ({ absent: a.absent + e.summary.absent, late: a.late + e.summary.lateMinutes, ot: a.ot + e.summary.overtimeHours }), { absent: 0, late: 0, ot: 0 }), [data]);
  if (loading && !data) return <Loading />;
  if (!data) return <Empty />;
  return (
    <div className="grid">
      <div className="card"><div className="card-h"><div><h3>الحضور والانصراف</h3><div className="small muted">الدوام من {s.workStart} لمدة {s.workHours} ساعات · سماح {s.graceMinutes} دقيقة · الراحة الأسبوعية: {s.weekend.map((d: number) => WD[d]).join("، ") || "—"} · الإضافي يُحتسب بعد {s.overtimeAfter} ساعة زيادة</div></div>
        <div className="row"><Field label="الشهر"><Input type="month" value={period} max={today().slice(0, 7)} onChange={(e) => setPeriod(e.target.value)} /></Field>
          {W && <><label className="btn sm" title="ملف Excel أو CSV من جهاز البصمة: كود الموظف، التاريخ، الدخول، الخروج">⬆ استيراد من جهاز البصمة<input ref={fileRef} type="file" hidden accept=".xlsx,.csv" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} /></label>
            {can("settings.write") && <button className="btn sm" onClick={() => setCfg({ ...s })}>⚙ إعدادات الدوام</button>}
            <button className="btn primary sm" disabled={busy || !(tot.absent || tot.late || tot.ot)} title="ينشئ حركات الغياب والتأخير والإضافي لهذا الشهر في «الإضافي والحسميات»" onClick={() => run(async () => { if (!confirmDlg(`ترحيل حضور ${period} إلى حركات الرواتب؟\nغياب ${tot.absent} يوم · تأخير ${tot.late} دقيقة · إضافي ${tot.ot} ساعة`)) return; const r = await api("/attendance/post", { body: { period } }); toast(`أُنشئت ${r.created} حركة راتب`); reload(); })}>⇨ ترحيل إلى الرواتب</button></>}</div></div>
        {data.posted.open + data.posted.included > 0 && <div className="card-b" style={{ paddingBottom: 0 }}><div className="alert info small">رُحّل حضور هذا الشهر إلى الرواتب (عدد الحركات: {data.posted.open + data.posted.included}{data.posted.included ? "، دخلت مسيراً" : " — إعادة الترحيل تستبدلها"}). <Link to="/payroll/items">عرض الحركات ←</Link></div></div>}
        <div className="card-b"><div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
          <Field label="تسجيل يوم"><Input type="date" value={day} min={`${period}-01`} max={today() < data.days[data.days.length - 1].date ? today() : data.days[data.days.length - 1].date} onChange={(e) => e.target.value && setDay(e.target.value)} /></Field>
          <span className="small muted" style={{ paddingBottom: 8 }}>{WD[new Date(`${day}T12:00:00Z`).getUTCDay()]}{dayInfo?.off ? " — يوم راحة: ساعات العمل فيه كلها إضافي" : ""}</span><div className="grow" />
          {W && <><button className="btn sm" onClick={() => fill("PRESENT")}>الكل حاضر</button><button className="btn sm" onClick={() => fill(dayInfo?.off ? "OFF" : "ABSENT")}>{dayInfo?.off ? "الكل راحة" : "الكل غائب"}</button><button className="btn primary sm" disabled={busy || !dirty} onClick={save}>حفظ اليوم</button></>}
        </div>
          {!data.employees.length ? <Empty text="لا يوجد موظفون" /> : <div className="table-wrap mt" style={{ maxHeight: 360 }}><table className="tbl compact"><thead><tr><th>الموظف</th><th>الحالة</th><th>الدخول</th><th>الخروج</th><th className="n">ساعات</th><th className="n">تأخير (د)</th><th className="n">إضافي (س)</th></tr></thead>
            <tbody>{data.employees.map((e: any) => { const r = rows[e.id] || {}; const d = e.days[day]; return <tr key={e.id}><td><b>{e.name}</b><span className="small muted"> {e.code}</span></td>
              <td><Select value={r.status || ""} disabled={!W} style={{ width: 110 }} onChange={(ev) => upd(e.id, ev.target.value === "PRESENT" ? { status: "PRESENT", timeIn: r.timeIn || s.workStart, timeOut: r.timeOut || addH(s.workStart, s.workHours) } : { status: ev.target.value, timeIn: "", timeOut: "" })}><option value="">—</option>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</Select></td>
              <td><Input type="time" style={{ width: 120 }} disabled={!W || r.status !== "PRESENT"} value={r.timeIn || ""} onChange={(ev) => upd(e.id, { timeIn: ev.target.value })} /></td><td><Input type="time" style={{ width: 120 }} disabled={!W || r.status !== "PRESENT"} value={r.timeOut || ""} onChange={(ev) => upd(e.id, { timeOut: ev.target.value })} /></td>
              <td className="n">{d?.hours || ""}</td><td className={"n " + (d?.late ? "neg-val" : "")}>{d?.late || ""}</td><td className={"n " + (d?.overtime ? "pos-val" : "")}>{d?.overtime || ""}</td></tr>; })}</tbody></table></div>}
        </div></div>
      <div className="card"><div className="card-h"><h3>ملخص الشهر</h3><ExportBtn name={`الحضور ${period}`} rows={() => data.employees.map((e: any) => ({ الكود: e.code, الموظف: e.name, "أيام الحضور": e.summary.present, "أيام الغياب": e.summary.absent, "أيام الإجازة": e.summary.leave, "دقائق التأخير": e.summary.lateMinutes, "ساعات الإضافي": e.summary.overtimeHours, "ساعات العمل": e.summary.hours }))} /></div>
        <div className="table-wrap"><table className="tbl compact att-grid"><thead><tr><th>الموظف</th>{data.days.map((d: any) => <th key={d.date} className={(d.off ? "off " : "") + (d.date === day ? "cur" : "")} title={WD[new Date(`${d.date}T12:00:00Z`).getUTCDay()]}>{+d.date.slice(8)}</th>)}<th className="n">حضور</th><th className="n">غياب</th><th className="n">تأخير</th><th className="n">إضافي</th></tr></thead>
          <tbody>{data.employees.map((e: any) => <tr key={e.id}><td className="nowrap">{e.name}</td>{data.days.map((d: any) => { const x = e.days[d.date]; return <td key={d.date} className={"c " + (x ? ST[x.status][2] : d.off ? "off" : "") + (d.date === day ? " cur" : "")} title={x ? `${ST[x.status][0]}${x.timeIn ? ` ${x.timeIn}–${x.timeOut || ""}` : ""}${x.late ? ` · تأخير ${x.late}د` : ""}${x.overtime ? ` · إضافي ${x.overtime}س` : ""}` : ""} onClick={() => !d.future && setDay(d.date)}>{x ? ST[x.status][1] + (x.late ? "ʼ" : "") + (x.overtime ? "⁺" : "") : ""}</td>; })}
            <td className="n">{e.summary.present}</td><td className={"n " + (e.summary.absent ? "neg-val" : "")}>{e.summary.absent || ""}</td><td className="n" title={`${e.summary.lateDays} يوم`}>{e.summary.lateMinutes ? `${e.summary.lateMinutes}د` : ""}</td><td className="n">{e.summary.overtimeHours ? `${e.summary.overtimeHours}س` : ""}</td></tr>)}</tbody></table></div>
        <div className="card-b small muted">ح حاضر · غ غائب · إ إجازة · ر راحة · ʼ تأخير · ⁺ إضافي — اضغط اليوم لفتحه في التسجيل أعلاه.</div></div>
      {cfg && <Modal narrow title="إعدادات الدوام" onClose={() => setCfg(null)} footer={<><button className="btn" onClick={() => setCfg(null)}>إلغاء</button><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api("/attendance/settings", { method: "PUT", body: cfg }); setCfg(null); reload(); }, "حُفظت الإعدادات")}>حفظ</button></>}>
        <div className="grid"><Field label="بداية الدوام"><Input type="time" value={cfg.workStart} onChange={(e) => setCfg({ ...cfg, workStart: e.target.value })} /></Field>
          <Field label="ساعات الدوام اليومي"><NumInput value={cfg.workHours} onChange={(e) => setCfg({ ...cfg, workHours: e.target.value })} /></Field>
          <Field label="دقائق السماح قبل احتساب التأخير"><NumInput value={cfg.graceMinutes} onChange={(e) => setCfg({ ...cfg, graceMinutes: e.target.value })} /></Field>
          <Field label="الإضافي يُحتسب إذا زاد عن (ساعة)" hint="0.5 = لا يُحتسب أقل من نصف ساعة"><NumInput value={cfg.overtimeAfter} onChange={(e) => setCfg({ ...cfg, overtimeAfter: e.target.value })} /></Field>
          <Field label="أيام الراحة الأسبوعية"><div className="row" style={{ gap: 8, flexWrap: "wrap" }}>{WD.map((n, i) => <label key={i} className="row small" style={{ gap: 4 }}><input type="checkbox" checked={cfg.weekend.includes(i)} onChange={(e) => setCfg({ ...cfg, weekend: e.target.checked ? [...cfg.weekend, i] : cfg.weekend.filter((x: number) => x !== i) })} />{n}</label>)}</div></Field></div>
        <p className="small muted">تغيير الإعدادات يسري على ما يُسجَّل بعده؛ أعد حفظ الأيام السابقة إن أردت إعادة احتسابها.</p>
      </Modal>}
    </div>
  );
}
