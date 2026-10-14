/** Round 17 charity screens: financial custody, purchase requests & receiving reports, refund requests. */
import React, { useMemo, useState } from "react";
import { api, q, useFetch, Money, money, Loading, Empty, Modal, Field, Input, Select, NumInput, Picker, accountFetcher, useAction, useCompanyContext, today, fmtDate, PeriodFilter, SearchBox, FilterInfo, useSorted, Th, matches, exportExcel, useUrlSearch, confirmDlg } from "../lib";
import { amountToArabicWords } from "../shared/tafqeet";
import { useCharity } from "./CharityApp";
import { PrintModal, fromCustody, fromForm } from "./templates";

const words = (v: any) => (Number(v) > 0 ? amountToArabicWords(Number(v)) : "");
const cashFetcher = accountFetcher((a) => a.isCashBank);
const expFetcher = accountFetcher((a) => a.type === "EXPENSE");
const anyNonCash = accountFetcher((a) => !a.isCashBank);
const acLabel = (a: any) => `${a.code} — ${a.nameAr}`;
const MTH: Record<string, string> = { TRANSFER: "تحويل بنكي", CHEQUE: "شيك", CASH: "نقدًا" };
const isAdmin = (me: any) => me?.superAdmin || ["OWNER", "ADMIN", "ACCOUNTANT"].includes(me?.role);

function ProjectSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { projects } = useCharity();
  return <Select value={value || ""} onChange={(e) => onChange(e.target.value)}><option value="">— بدون مشروع —</option>{projects.map((p: any) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</Select>;
}
function Steps({ status, flow, labels, rejected }: { status: string; flow: string[]; labels: string[]; rejected?: string }) {
  if (status === "REJECTED") return <div className="ch-steps"><span className="no">مرفوض{rejected ? ": " + rejected : ""}</span></div>;
  const at = flow.indexOf(status);
  return <div className="ch-steps">{flow.map((x, i) => <span key={x} className={at >= i ? "on" : ""}>{labels[i]}</span>)}</div>;
}
function Checks({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return <div className="row" style={{ gap: 10 }}>{options.map((o) => <label key={o} className="row" style={{ gap: 4 }}><input type="checkbox" checked={(value || []).includes(o)} onChange={(e) => onChange(e.target.checked ? [...(value || []), o] : (value || []).filter((x) => x !== o))} />{o}</label>)}</div>;
}
/** Asks for a note / amount then calls an action. */
function useDecide(reload: () => void) {
  const { run, busy } = useAction();
  const act = (url: string, body: any, ok: string) => run(async () => { await api(url, { body }); reload(); }, ok);
  return { act, busy };
}

// ─── custody (العهد المالية) ───────────────────────────────────────────────
const C_ST: Record<string, string> = { REQUESTED: "مقدَّم", REVIEWED: "تمت المراجعة", APPROVED: "معتمد — بانتظار الصرف", REJECTED: "مرفوض", DISBURSED: "مصروفة — بانتظار التسوية", SETTLED: "مسوّاة" };
export function CustodyPage() {
  const { me, can } = useCompanyContext();
  const { settings } = useCharity();
  const [text, setText] = useUrlSearch();
  const [status, setStatus] = useState("");
  const { data, loading, reload } = useFetch<any[]>(`/charity/custody${q({ status })}`);
  const [edit, setEdit] = useState<any>(null);
  const [pay, setPay] = useState<any>(null);
  const [settle, setSettle] = useState<any>(null);
  const [pr, setPr] = useState<any>(null);
  const { act, busy } = useDecide(reload);
  const rows = useMemo(() => (data || []).filter((r) => matches(r, text, ["number", "holderName", "purpose", "department", "projectName"])), [data, text]);
  const s = useSorted(rows);
  const open = (data || []).filter((r) => r.status === "DISBURSED");
  const openAmt = open.reduce((a, r) => a + Number(r.disbursedAmount || 0), 0);
  const overdue = open.filter((r) => r.overdue).length;
  return (
    <div className="card">
      <div className="card-h">
        <h3>العهد المالية</h3>
        <div className="row">
          <button className="btn sm" onClick={() => exportExcel(rows.map((r) => ({ الرقم: r.number, التاريخ: fmtDate(r.date), "صاحب العهدة": r.holderName, القسم: r.department, الغرض: r.purpose, المشروع: r.projectName, المطلوب: Number(r.amount), المعتمد: Number(r.approvedAmount || 0), المصروف: Number(r.disbursedAmount || 0), "المصروفات المؤيدة": Number(r.settlement?.spent || 0), "المعاد": Number(r.settlement?.returned || 0), "موعد التسوية": fmtDate(r.settleDue), الحالة: C_ST[r.status] })), "العهد-المالية")}>⬇ Excel</button>
          <button className="btn sm" onClick={() => setPr({ key: "custodyReq", data: {} })}>🖨 نموذج طلب فارغ</button>
          <button className="btn sm" onClick={() => setPr({ key: "custodySettle", data: {} })}>🖨 نموذج تسوية فارغ</button>
          {can("payments.write") && <button className="btn primary" onClick={() => setEdit({})}>＋ طلب عهدة</button>}
        </div>
      </div>
      <div className="card-b">
        <div className="grid c3 mb">
          <div className="card kpi"><span className="label">عهد قائمة غير مسوّاة</span><span className="value"><Money v={openAmt} /></span><span className="sub">{open.length} عهدة</span><span className="icon">💼</span></div>
          <div className={"card kpi " + (overdue ? "danger" : "")}><span className="label">متأخرة عن موعد التسوية</span><span className="value num">{overdue}</span><span className="sub">تظهر باللون الأحمر في القائمة</span><span className="icon">⏰</span></div>
          <div className="card kpi info"><span className="label">طلبات بانتظار القرار</span><span className="value num">{(data || []).filter((r) => ["REQUESTED", "REVIEWED"].includes(r.status)).length}</span><span className="icon">📋</span></div>
        </div>
        <div className="toolbar">
          <SearchBox value={text} onChange={setText} placeholder="رقم العهدة أو صاحبها أو الغرض" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 200 }}><option value="">كل الحالات</option>{Object.entries(C_ST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <FilterInfo shown={rows.length} total={data?.length || 0} active={!!(text || status)} onClear={() => { setText(""); setStatus(""); }} />
          <div className="grow" /><span className="small muted">طلب ← مراجعة ← اعتماد ← صرف (قيد على حساب العهد) ← تسوية بالمستندات وإعادة المتبقي</span>
        </div>
      </div>
      {loading && !data ? <Loading /> : !rows.length ? <Empty text="لا توجد عهد مالية" /> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><Th k="number" s={s}>الرقم</Th><Th k="date" s={s}>التاريخ</Th><Th k="holderName" s={s}>صاحب العهدة</Th><Th k="purpose" s={s}>الغرض</Th><Th k="amount" s={s} n>المبلغ</Th><Th k="settleDue" s={s}>موعد التسوية</Th><th>المسار</th><th /></tr></thead>
          <tbody>{s.sorted.map((r: any) => (
            <tr key={r.id} style={r.overdue ? { background: "var(--danger-soft)" } : undefined}>
              <td className="num">{r.number}{r.disbursementNumber && <div className="small muted num">{r.disbursementNumber}</div>}</td>
              <td className="dt">{fmtDate(r.date)}</td>
              <td><b>{r.holderName}</b><div className="small muted">{[r.jobTitle, r.department].filter(Boolean).join(" · ")}</div></td>
              <td>{r.purpose}<div className="small muted">{r.projectName}</div></td>
              <td className="n"><b><Money v={r.disbursedAmount ?? r.approvedAmount ?? r.amount} /></b>{r.status === "SETTLED" && <div className="small muted">مؤيد <Money v={r.settlement?.spent} /> · معاد <Money v={r.settlement?.returned} /></div>}</td>
              <td className={"dt " + (r.overdue ? "neg-val" : "")}>{fmtDate(r.settleDue) || "—"}</td>
              <td><Steps status={r.status} flow={["REQUESTED", "REVIEWED", "APPROVED", "DISBURSED", "SETTLED"]} labels={["مقدَّم", "مراجعة", "معتمد", "مصروف", "مسوّى"]} rejected={r.reviewNote} /></td>
              <td className="row" style={{ gap: 4 }}>
                <button className="btn sm" onClick={() => setPr({ key: r.status === "SETTLED" ? "custodySettle" : "custodyReq", data: fromCustody(r), choices: ["custodyReq", "custodySettle"] })}>🖨</button>
                {can("payments.write") && ["REQUESTED", "REJECTED", "REVIEWED"].includes(r.status) && <button className="btn sm" onClick={() => setEdit(r)}>تعديل</button>}
                {can("payments.write") && r.status === "REQUESTED" && <button className="btn sm" disabled={busy} onClick={() => act(`/charity/custody/${r.id}/review`, { note: window.prompt("ملاحظات المراجعة المالية (اختياري)") || undefined }, "تمت المراجعة")}>مراجعة</button>}
                {isAdmin(me) && ["REQUESTED", "REVIEWED"].includes(r.status) && <button className="btn sm primary" disabled={busy} onClick={() => { const v = window.prompt("المبلغ المعتمد", String(r.amount)); if (v !== null) act(`/charity/custody/${r.id}/approve`, { approvedAmount: v }, "تم اعتماد العهدة"); }}>اعتماد</button>}
                {isAdmin(me) && ["REQUESTED", "REVIEWED", "APPROVED"].includes(r.status) && <button className="btn sm ghost" disabled={busy} onClick={() => { const n = window.prompt("سبب الرفض"); if (n) act(`/charity/custody/${r.id}/reject`, { note: n }, "تم الرفض"); }}>رفض</button>}
                {can("payments.write") && r.status === "APPROVED" && <button className="btn sm primary" onClick={() => setPay(r)}>صرف العهدة</button>}
                {can("payments.write") && r.status === "DISBURSED" && <button className="btn sm primary" onClick={() => setSettle(r)}>تسوية</button>}
                {isAdmin(me) && r.status === "SETTLED" && <button className="btn sm ghost" disabled={busy} onClick={() => confirmDlg(`إلغاء تسوية العهدة ${r.number}؟ سيُعكس قيد التسوية.`) && act(`/charity/custody/${r.id}/unsettle`, {}, "تم إلغاء التسوية")}>إلغاء التسوية</button>}
                {can("payments.write") && ["REQUESTED", "REJECTED", "REVIEWED"].includes(r.status) && <button className="btn sm ghost" disabled={busy} onClick={() => confirmDlg(`حذف ${r.number}؟`) && api(`/charity/custody/${r.id}`, { method: "DELETE" }).then(reload)}>حذف</button>}
              </td>
            </tr>))}
          </tbody>
        </table></div>
      )}
      {edit && <CustodyModal init={edit} onClose={(ok) => { setEdit(null); if (ok) reload(); }} />}
      {pay && <CustodyPayModal c={pay} onClose={(ok) => { setPay(null); if (ok) reload(); }} />}
      {settle && <SettleModal c={settle} onClose={(ok) => { setSettle(null); if (ok) reload(); }} />}
      {pr && <PrintModal tplKey={pr.key} choices={pr.choices} data={pr.data} settings={settings} onClose={() => setPr(null)} />}
    </div>
  );
}

function CustodyModal({ init, onClose }: { init: any; onClose: (ok?: boolean) => void }) {
  const { me } = useCompanyContext();
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ date: fmtDate(init.date) || today(), holderName: init.holderName || me.user.fullName, idNo: init.idNo || "", phone: init.phone || "", department: init.department || "", jobTitle: init.jobTitle || "", projectId: init.projectId || "", purpose: init.purpose || "", funding: init.funding || "", amount: init.amount || "", neededDate: fmtDate(init.neededDate), settleDue: fmtDate(init.settleDue), method: init.method || "TRANSFER", justification: init.justification || "" });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  return (
    <Modal title={init.id ? `تعديل ${init.number}` : "نموذج طلب عهدة مالية"} wide onClose={() => onClose()} footer={<><button className="btn primary" disabled={busy} onClick={() => run(async () => { if (init.id) await api(`/charity/custody/${init.id}`, { method: "PUT", body: f }); else await api("/charity/custody", { body: f }); onClose(true); }, "تم تقديم الطلب")}>حفظ وتقديم</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <div className="grid c3">
        <Field label="اسم مقدم الطلب / صاحب العهدة"><Input value={f.holderName} onChange={set("holderName")} /></Field>
        <Field label="المسمى الوظيفي"><Input value={f.jobTitle} onChange={set("jobTitle")} /></Field>
        <Field label="القسم / الإدارة"><Input value={f.department} onChange={set("department")} /></Field>
        <Field label="رقم الهوية"><Input value={f.idNo} onChange={set("idNo")} dir="ltr" /></Field>
        <Field label="الجوال"><Input value={f.phone} onChange={set("phone")} dir="ltr" /></Field>
        <Field label="التاريخ"><Input type="date" value={f.date} onChange={set("date")} disabled={!!init.id} /></Field>
        <Field label="مبلغ العهدة"><NumInput value={f.amount} onChange={set("amount")} /></Field>
        <Field label="المبلغ كتابةً" span2><div className="input" style={{ background: "var(--surface-2)", minHeight: 36 }}>{words(f.amount)}</div></Field>
        <Field label="الغرض من طلب العهدة" span3><Input value={f.purpose} onChange={set("purpose")} /></Field>
        <Field label="البرنامج / المشروع"><ProjectSelect value={f.projectId} onChange={set("projectId")} /></Field>
        <Field label="مصدر التمويل"><Input value={f.funding} onChange={set("funding")} /></Field>
        <Field label="طريقة الصرف"><Select value={f.method} onChange={set("method")}>{Object.entries(MTH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="تاريخ الاستلام المطلوب"><Input type="date" value={f.neededDate} onChange={set("neededDate")} /></Field>
        <Field label="تاريخ التسوية المتوقع" hint="تظهر العهدة متأخرة بعده"><Input type="date" value={f.settleDue} onChange={set("settleDue")} /></Field>
        <div />
        <Field label="مبررات طلب العهدة" span3><textarea className="input" rows={3} value={f.justification} onChange={set("justification")} /></Field>
      </div>
    </Modal>
  );
}

function CustodyPayModal({ c, onClose }: { c: any; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const [acc, setAcc] = useState<any>(null);
  const [f, setF] = useState<any>({ date: today(), method: c.method, refNo: "", iban: "", bankName: "" });
  return (
    <Modal title={`صرف العهدة ${c.number}`} onClose={() => onClose()} footer={<><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api(`/charity/custody/${c.id}/disburse`, { body: { ...f, payAccountId: acc?.id } }); onClose(true); }, "تم صرف العهدة وإنشاء سند الصرف")}>صرف وترحيل</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <div className="stat-list mb"><div className="item"><span>صاحب العهدة</span><b>{c.holderName}</b></div><div className="item"><span>المبلغ المعتمد</span><b><Money v={c.approvedAmount ?? c.amount} /></b></div></div>
      <div className="grid c2">
        <Field label="تاريخ الصرف"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="طريقة الصرف"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(MTH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="من حساب (الصندوق / البنك)" span2 hint="فارغ = الصندوق للنقدي والبنك لغيره"><Picker value={acc} onChange={setAcc} fetcher={cashFetcher} label={acLabel} /></Field>
        {f.method !== "CASH" && <><Field label="رقم الشيك / مرجع التحويل"><Input value={f.refNo} onChange={(e) => setF({ ...f, refNo: e.target.value })} dir="ltr" /></Field><Field label="آيبان صاحب العهدة"><Input value={f.iban} onChange={(e) => setF({ ...f, iban: e.target.value })} dir="ltr" /></Field></>}
      </div>
      <div className="alert info small mt">القيد: من ح/ العهد المالية المؤقتة (110390) إلى ح/ الصندوق أو البنك، ويُنشأ سند صرف مرتبط قابل للطباعة.</div>
    </Modal>
  );
}

function SettleModal({ c, onClose }: { c: any; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const [lines, setLines] = useState<any[]>([{ date: today(), description: "", docNo: "", amount: "", account: null }]);
  const [ret, setRet] = useState<any>(null);
  const [f, setF] = useState<any>({ date: today(), receiptRef: "", note: "", allowExtra: false });
  const adv = Number(c.disbursedAmount || 0);
  const spent = lines.reduce((a, l) => a + Number(l.amount || 0), 0);
  const diff = adv - spent;
  const setL = (i: number, k: string, v: any) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <Modal title={`تسوية العهدة ${c.number} — ${c.holderName}`} wide onClose={() => onClose()} footer={<><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api(`/charity/custody/${c.id}/settle`, { body: { ...f, returnAccountId: ret?.id, lines: lines.map((l) => ({ ...l, accountId: l.account?.id })) } }); onClose(true); }, "تمت تسوية العهدة وترحيل القيد")}>اعتماد التسوية وترحيل القيد</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <div className="grid c4 mb">
        <div className="card kpi"><span className="label">قيمة العهدة المستلمة</span><span className="value"><Money v={adv} /></span></div>
        <div className="card kpi accent"><span className="label">المصروفات المؤيدة</span><span className="value"><Money v={spent} /></span></div>
        <div className={"card kpi " + (diff >= 0 ? "success" : "danger")}><span className="label">{diff >= 0 ? "المتبقي الواجب إعادته" : "مستحق لصاحب العهدة"}</span><span className="value"><Money v={Math.abs(diff)} /></span></div>
        <Field label="تاريخ التسوية"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      </div>
      <div className="table-wrap"><table className="tbl compact">
        <thead><tr><th>#</th><th>تاريخ المصروف</th><th>بيان المصروف والغرض منه</th><th>رقم الفاتورة / المستند</th><th>حساب المصروف</th><th className="n">المبلغ</th><th /></tr></thead>
        <tbody>{lines.map((l, i) => <tr key={i}>
          <td>{i + 1}</td>
          <td><Input type="date" value={l.date} onChange={(e) => setL(i, "date", e.target.value)} /></td>
          <td><Input value={l.description} onChange={(e) => setL(i, "description", e.target.value)} /></td>
          <td><Input value={l.docNo} onChange={(e) => setL(i, "docNo", e.target.value)} dir="ltr" /></td>
          <td style={{ minWidth: 200 }}><Picker value={l.account} onChange={(a) => setL(i, "account", a)} fetcher={expFetcher} label={acLabel} placeholder="افتراضي: مصروفات البرامج" /></td>
          <td><NumInput value={l.amount} onChange={(e) => setL(i, "amount", e.target.value)} style={{ width: 110 }} /></td>
          <td><button className="btn sm ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button></td>
        </tr>)}</tbody>
      </table></div>
      <button className="btn sm mt" onClick={() => setLines([...lines, { date: today(), description: "", docNo: "", amount: "", account: null }])}>＋ سطر مصروف</button>
      <div className="grid c3 mt">
        {diff > 0 && <><Field label="يُعاد المتبقي إلى حساب" hint="فارغ = الصندوق الرئيسي"><Picker value={ret} onChange={setRet} fetcher={cashFetcher} label={acLabel} /></Field><Field label="رقم سند القبض / مرجع الإيداع"><Input value={f.receiptRef} onChange={(e) => setF({ ...f, receiptRef: e.target.value })} /></Field></>}
        {diff < 0 && <Field label=" " span2><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.allowExtra} onChange={(e) => setF({ ...f, allowExtra: e.target.checked })} />اعتماد صرف الفرق (<Money v={-diff} />) لصاحب العهدة من حساب صرف العهدة</label></Field>}
        <Field label="ملاحظات المراجعة"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

// ─── purchases & receiving (طلبات الشراء ومحاضر الاستلام) ────────────────────
const P_ST: Record<string, string> = { SUBMITTED: "مقدَّم", REVIEWED: "تمت المراجعة", APPROVED: "معتمد", REJECTED: "مرفوض", ORDERED: "صدر أمر الشراء", RECEIVED: "تم الاستلام" };
export function PurchasesPage() {
  const { me, can } = useCompanyContext();
  const { settings } = useCharity();
  const [tab, setTab] = useState<"req" | "grn">("req");
  const [text, setText] = useUrlSearch();
  const [status, setStatus] = useState("");
  const reqs = useFetch<any[]>(`/charity/forms/purchases${q({ status })}`);
  const grns = useFetch<any[]>("/charity/forms/receivings");
  const [edit, setEdit] = useState<any>(null);
  const [grn, setGrn] = useState<any>(null);
  const [review, setReview] = useState<any>(null);
  const [pr, setPr] = useState<any>(null);
  const reload = () => { reqs.reload(); grns.reload(); };
  const { act, busy } = useDecide(reload);
  const list = tab === "req" ? reqs : grns;
  const rows = useMemo(() => (list.data || []).filter((r) => matches(r, text, ["number", "party", (x) => x.data?.purpose, (x) => x.data?.supplier, (x) => x.data?.poNumber, "parentNumber", (x) => x.data?.invoiceNo])), [list.data, text]);
  const s = useSorted(rows);
  return (
    <div className="card">
      <div className="card-h">
        <div className="row"><h3>المشتريات</h3><div className="tabs" style={{ margin: 0 }}><button className={tab === "req" ? "active" : ""} onClick={() => setTab("req")}>طلبات الشراء</button><button className={tab === "grn" ? "active" : ""} onClick={() => setTab("grn")}>محاضر الاستلام</button></div></div>
        <div className="row">
          <button className="btn sm" onClick={() => setPr({ key: tab === "req" ? "purchase" : "receiving", data: {} })}>🖨 نموذج فارغ</button>
          <button className="btn sm" onClick={() => exportExcel(rows.map((r) => ({ الرقم: r.number, التاريخ: fmtDate(r.date), [tab === "req" ? "مقدم الطلب" : "المورد"]: r.party, الغرض: r.data?.purpose, "أمر الشراء": r.data?.poNumber, "طلب الشراء": r.parentNumber, الإجمالي: Number(r.amount), الحالة: P_ST[r.status] || "" })), tab === "req" ? "طلبات-الشراء" : "محاضر-الاستلام")}>⬇ Excel</button>
          {can("payments.write") && (tab === "req" ? <button className="btn primary" onClick={() => setEdit({})}>＋ طلب شراء</button> : <button className="btn primary" onClick={() => setGrn({})}>＋ محضر استلام</button>)}
        </div>
      </div>
      <div className="card-b"><div className="toolbar">
        <SearchBox value={text} onChange={setText} placeholder="الرقم أو المورد أو الغرض" />
        {tab === "req" && <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 180 }}><option value="">كل الحالات</option>{Object.entries(P_ST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
        <FilterInfo shown={rows.length} total={list.data?.length || 0} active={!!(text || status)} onClear={() => { setText(""); setStatus(""); }} />
        <div className="grow" /><span className="small muted">طلب ← مراجعة المشتريات والمالية ← اعتماد ← أمر شراء ← محضر استلام ← فاتورة المورد في البرنامج الأساسي</span>
      </div></div>
      {list.loading && !list.data ? <Loading /> : !rows.length ? <Empty text={tab === "req" ? "لا توجد طلبات شراء" : "لا توجد محاضر استلام"} /> : tab === "req" ? (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><Th k="number" s={s}>الرقم</Th><Th k="date" s={s}>التاريخ</Th><Th k="party" s={s}>مقدم الطلب</Th><th>الغرض والأصناف</th><Th k="amount" s={s} n>الإجمالي</Th><th>المسار</th><th /></tr></thead>
          <tbody>{s.sorted.map((r: any) => <tr key={r.id}>
            <td className="num">{r.number}{r.data?.poNumber && <div className="small muted num">{r.data.poNumber}</div>}</td><td className="dt">{fmtDate(r.date)}</td>
            <td>{r.party}<div className="small muted">{r.data?.department}{r.data?.urgency === "عاجل" && <span className="badge red" style={{ marginInlineStart: 4 }}>عاجل</span>}</div></td>
            <td>{r.data?.purpose}<div className="small muted">{(r.data?.items || []).map((i: any) => i.name).join("، ")}</div></td>
            <td className="n"><b><Money v={r.amount} /></b></td>
            <td><Steps status={r.status} flow={["SUBMITTED", "REVIEWED", "APPROVED", "ORDERED", "RECEIVED"]} labels={["مقدَّم", "مراجعة", "معتمد", "أمر شراء", "مستلم"]} rejected={r.review?.decisionNote} />{r.children?.length > 0 && <div className="small muted num">{r.children.map((c: any) => c.number).join("، ")}</div>}</td>
            <td className="row" style={{ gap: 4 }}>
              <button className="btn sm" onClick={() => setPr({ key: "purchase", data: fromForm({ ...r, kind: "PURCHASE" }) })}>🖨</button>
              {can("payments.write") && ["SUBMITTED", "REVIEWED", "REJECTED"].includes(r.status) && <button className="btn sm" onClick={() => setEdit(r)}>تعديل</button>}
              {can("payments.write") && ["SUBMITTED", "REVIEWED"].includes(r.status) && <button className="btn sm" onClick={() => setReview(r)}>مراجعة</button>}
              {isAdmin(me) && ["SUBMITTED", "REVIEWED"].includes(r.status) && <button className="btn sm primary" disabled={busy} onClick={() => { const v = window.prompt("المبلغ المعتمد", String(r.amount)); if (v !== null) act(`/charity/forms/purchases/${r.id}/approve`, { approvedAmount: v }, "تم الاعتماد"); }}>اعتماد</button>}
              {isAdmin(me) && ["SUBMITTED", "REVIEWED", "APPROVED"].includes(r.status) && <button className="btn sm ghost" disabled={busy} onClick={() => { const n = window.prompt("سبب الرفض"); if (n) act(`/charity/forms/purchases/${r.id}/reject`, { note: n }, "تم الرفض"); }}>رفض</button>}
              {can("payments.write") && r.status === "APPROVED" && <button className="btn sm primary" disabled={busy} onClick={() => { const po = window.prompt("رقم أمر الشراء (فارغ = تلقائي)", ""); if (po !== null) act(`/charity/forms/purchases/${r.id}/order`, { poNumber: po, supplier: window.prompt("اسم المورد المعتمد", r.data?.supplier || "") || r.data?.supplier }, "تم تسجيل أمر الشراء"); }}>أمر شراء</button>}
              {can("payments.write") && ["APPROVED", "ORDERED"].includes(r.status) && <button className="btn sm primary" onClick={() => { setTab("grn"); setGrn({ parent: r }); }}>محضر استلام</button>}
              {can("payments.write") && ["SUBMITTED", "REVIEWED", "REJECTED"].includes(r.status) && <button className="btn sm ghost" onClick={() => confirmDlg(`حذف ${r.number}؟`) && api(`/charity/forms/purchases/${r.id}`, { method: "DELETE" }).then(reload)}>حذف</button>}
            </td></tr>)}</tbody>
        </table></div>
      ) : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><Th k="number" s={s}>الرقم</Th><Th k="date" s={s}>التاريخ</Th><Th k="party" s={s}>المورد</Th><th>طلب / أمر الشراء</th><th>الفاتورة</th><th>النتيجة</th><Th k="amount" s={s} n>القيمة</Th><th /></tr></thead>
          <tbody>{s.sorted.map((r: any) => <tr key={r.id}>
            <td className="num">{r.number}</td><td className="dt">{fmtDate(r.date)}</td><td>{r.party}</td>
            <td className="num small">{r.parentNumber || "—"}{r.data?.poNumber ? " / " + r.data.poNumber : ""}</td><td className="num small">{r.data?.invoiceNo}</td>
            <td className="small">{(r.data?.results || []).join("، ") || "—"}</td><td className="n"><Money v={r.amount} /></td>
            <td className="row" style={{ gap: 4 }}><button className="btn sm" onClick={() => setPr({ key: "receiving", data: fromForm({ ...r, kind: "RECEIVING" }) })}>🖨</button>{can("payments.write") && <><button className="btn sm" onClick={() => setGrn(r)}>تعديل</button><button className="btn sm ghost" onClick={() => confirmDlg(`حذف ${r.number}؟`) && api(`/charity/forms/receivings/${r.id}`, { method: "DELETE" }).then(reload)}>حذف</button></>}</td>
          </tr>)}</tbody>
        </table></div>
      )}
      {edit && <PurchaseModal init={edit} onClose={(ok) => { setEdit(null); if (ok) reload(); }} />}
      {grn && <ReceivingModal init={grn} onClose={(ok) => { setGrn(null); if (ok) reload(); }} />}
      {review && <PurchaseReview r={review} onClose={(ok) => { setReview(null); if (ok) reload(); }} />}
      {pr && <PrintModal tplKey={pr.key} data={pr.data} settings={settings} onClose={() => setPr(null)} />}
    </div>
  );
}

function PurchaseModal({ init, onClose }: { init: any; onClose: (ok?: boolean) => void }) {
  const { me } = useCompanyContext();
  const { run, busy } = useAction();
  const d0 = init.data || {};
  const [f, setF] = useState<any>({ requester: me.user.fullName, department: "", jobTitle: "", purpose: "", urgency: "عادي", needDate: "", funding: "", supplier: "", supplierVat: "", quoteNo: "", quoteDate: "", quotes: [], applyVat: true, ...d0 });
  const [items, setItems] = useState<any[]>(d0.items?.length ? d0.items : [{ name: "", spec: "", qty: 1, price: "" }]);
  const [projectId, setProjectId] = useState(init.projectId || "");
  const [date, setDate] = useState(fmtDate(init.date) || today());
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e?.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e });
  const setI = (i: number, k: string, v: any) => setItems(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const sub = items.reduce((a, i) => a + Number(i.qty || 0) * Number(i.price || 0), 0);
  const vat = f.applyVat ? Math.round(sub * 15) / 100 : 0;
  return (
    <Modal title={init.id ? `تعديل ${init.number}` : "نموذج طلب شراء"} wide onClose={() => onClose()} footer={<><b className="grow">الإجمالي النهائي: <Money v={sub + vat} /></b><button className="btn primary" disabled={busy} onClick={() => run(async () => { const body = { date, projectId, data: { ...f, items, vat: f.applyVat ? undefined : 0 } }; if (init.id) await api(`/charity/forms/purchases/${init.id}`, { method: "PUT", body }); else await api("/charity/forms/purchases", { body }); onClose(true); }, "تم تقديم طلب الشراء")}>حفظ وتقديم</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <div className="grid c4">
        <Field label="اسم مقدم الطلب"><Input value={f.requester} onChange={set("requester")} /></Field>
        <Field label="المسمى الوظيفي"><Input value={f.jobTitle} onChange={set("jobTitle")} /></Field>
        <Field label="الإدارة / القسم الطالب"><Input value={f.department} onChange={set("department")} /></Field>
        <Field label="تاريخ الطلب"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!!init.id} /></Field>
      </div>
      <div className="table-wrap mt"><table className="tbl compact">
        <thead><tr><th>م</th><th>اسم الصنف / الخدمة</th><th>المواصفات المطلوبة</th><th>الكمية</th><th>سعر الوحدة</th><th className="n">الإجمالي</th><th /></tr></thead>
        <tbody>{items.map((it, i) => <tr key={i}><td>{i + 1}</td><td><Input value={it.name} onChange={(e) => setI(i, "name", e.target.value)} /></td><td><Input value={it.spec} onChange={(e) => setI(i, "spec", e.target.value)} /></td><td><NumInput value={it.qty} onChange={(e) => setI(i, "qty", e.target.value)} style={{ width: 80 }} /></td><td><NumInput value={it.price} onChange={(e) => setI(i, "price", e.target.value)} style={{ width: 100 }} /></td><td className="n"><Money v={Number(it.qty || 0) * Number(it.price || 0)} /></td><td><button className="btn sm ghost" onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button></td></tr>)}</tbody>
        <tfoot><tr><td colSpan={5}>الإجمالي قبل الضريبة / الضريبة</td><td className="n"><Money v={sub} /> / <Money v={vat} /></td><td /></tr></tfoot>
      </table></div>
      <div className="row mt"><button className="btn sm" onClick={() => setItems([...items, { name: "", spec: "", qty: 1, price: "" }])}>＋ صنف</button><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={!!f.applyVat} onChange={set("applyVat")} />إضافة ضريبة القيمة المضافة 15%</label><span className="muted small">{words(sub + vat)}</span></div>
      <div className="grid c3 mt">
        <Field label="الغرض من الشراء" span2><Input value={f.purpose} onChange={set("purpose")} /></Field>
        <Field label="البرنامج / المشروع"><ProjectSelect value={projectId} onChange={setProjectId} /></Field>
        <Field label="مدى الحاجة"><Select value={f.urgency} onChange={set("urgency")}><option>عادي</option><option>عاجل</option></Select></Field>
        <Field label="تاريخ الحاجة"><Input type="date" value={f.needDate} onChange={set("needDate")} /></Field>
        <Field label="مصدر التمويل / بند الميزانية"><Input value={f.funding} onChange={set("funding")} /></Field>
        <Field label="المورد المقترح"><Input value={f.supplier} onChange={set("supplier")} /></Field>
        <Field label="الرقم الضريبي للمورد"><Input value={f.supplierVat} onChange={set("supplierVat")} dir="ltr" /></Field>
        <Field label="رقم / تاريخ عرض السعر"><div className="row" style={{ gap: 4, flexWrap: "nowrap" }}><Input value={f.quoteNo} onChange={set("quoteNo")} dir="ltr" /><Input type="date" value={f.quoteDate} onChange={set("quoteDate")} /></div></Field>
        <Field label="عروض الأسعار" span3><Checks options={["مرفق عرض سعر", "مرفق أكثر من عرض سعر وفق السياسة المعتمدة"]} value={f.quotes} onChange={(v) => setF({ ...f, quotes: v })} /></Field>
      </div>
    </Modal>
  );
}

function PurchaseReview({ r, onClose }: { r: any; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const [rv, setRv] = useState<any>({ procReview: !!r.review?.procReview, finReview: !!r.review?.finReview, budgetLine: r.review?.budgetLine || r.data?.funding || "" });
  const [note, setNote] = useState(r.review?.reviewNote || "");
  return (
    <Modal title={`مراجعة طلب الشراء ${r.number}`} narrow onClose={() => onClose()} footer={<><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api(`/charity/forms/purchases/${r.id}/review`, { body: { review: rv, note } }); onClose(true); }, "تم تسجيل المراجعة")}>حفظ المراجعة</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <div className="stat-list">
        <label className="item"><span>مسؤول المشتريات: تمت مراجعة الطلب وعروض الأسعار</span><input type="checkbox" checked={rv.procReview} onChange={(e) => setRv({ ...rv, procReview: e.target.checked })} /></label>
        <label className="item"><span>المسؤول المالي: يوجد اعتماد مالي متاح</span><input type="checkbox" checked={rv.finReview} onChange={(e) => setRv({ ...rv, finReview: e.target.checked })} /></label>
      </div>
      <Field label="بند الميزانية"><Input value={rv.budgetLine} onChange={(e) => setRv({ ...rv, budgetLine: e.target.value })} /></Field>
      <Field label="ملاحظات"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}

function ReceivingModal({ init, onClose }: { init: any; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const parent = init.parent;
  const d0 = init.data || {};
  const [f, setF] = useState<any>(() => ({ supplier: parent?.data?.approvedSupplier || parent?.data?.supplier || "", supplierCr: "", supplierVat: parent?.data?.supplierVat || "", invoiceNo: "", invoiceDate: today(), department: parent?.data?.department || "", poNumber: parent?.data?.poNumber || "", results: [], shortage: "", action: "", subtotal: parent?.data?.subtotal || "", vat: parent?.data?.vat || "", docs: ["أمر الشراء المعتمد", "فاتورة المورد"], ...d0 }));
  const [items, setItems] = useState<any[]>(d0.items?.length ? d0.items : parent ? parent.data.items.map((i: any) => ({ name: i.name, spec: i.spec, qtyReq: i.qty, qtyRec: i.qty, condition: "سليم", notes: "" })) : [{ name: "", spec: "", qtyReq: "", qtyRec: "", condition: "سليم", notes: "" }]);
  const [date, setDate] = useState(fmtDate(init.date) || today());
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const setI = (i: number, k: string, v: any) => setItems(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const total = Number(f.subtotal || 0) + Number(f.vat || 0);
  const partial = items.some((i) => Number(i.qtyRec) < Number(i.qtyReq));
  return (
    <Modal title={init.id ? `تعديل ${init.number}` : `محضر استلام مشتريات${parent ? " — " + parent.number : ""}`} wide onClose={() => onClose()} footer={<><button className="btn primary" disabled={busy} onClick={() => run(async () => { const results = f.results?.length ? f.results : [partial ? "تم الاستلام جزئيًا" : "تم الاستلام كاملًا وبحالة سليمة ومطابقة للمواصفات"]; const body = { date, parentId: parent?.id, projectId: parent?.projectId, data: { ...f, results, items, total, due: f.due || total } }; if (init.id) await api(`/charity/forms/receivings/${init.id}`, { method: "PUT", body }); else await api("/charity/forms/receivings", { body }); onClose(true); }, "تم حفظ محضر الاستلام")}>حفظ المحضر</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <div className="grid c4">
        <Field label="اسم المورد / المؤسسة"><Input value={f.supplier} onChange={set("supplier")} /></Field>
        <Field label="السجل التجاري"><Input value={f.supplierCr} onChange={set("supplierCr")} dir="ltr" /></Field>
        <Field label="الرقم الضريبي"><Input value={f.supplierVat} onChange={set("supplierVat")} dir="ltr" /></Field>
        <Field label="تاريخ المحضر"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="رقم الفاتورة"><Input value={f.invoiceNo} onChange={set("invoiceNo")} dir="ltr" /></Field>
        <Field label="تاريخ الفاتورة"><Input type="date" value={f.invoiceDate} onChange={set("invoiceDate")} /></Field>
        <Field label="رقم أمر الشراء"><Input value={f.poNumber} onChange={set("poNumber")} dir="ltr" /></Field>
        <Field label="الإدارة المستفيدة"><Input value={f.department} onChange={set("department")} /></Field>
      </div>
      <div className="table-wrap mt"><table className="tbl compact">
        <thead><tr><th>م</th><th>اسم الصنف / الخدمة</th><th>المواصفات</th><th>المطلوبة</th><th>المستلمة</th><th>حالة الصنف</th><th>ملاحظات</th><th /></tr></thead>
        <tbody>{items.map((it, i) => <tr key={i} style={Number(it.qtyRec) < Number(it.qtyReq) ? { background: "var(--accent-soft)" } : undefined}><td>{i + 1}</td><td><Input value={it.name} onChange={(e) => setI(i, "name", e.target.value)} /></td><td><Input value={it.spec} onChange={(e) => setI(i, "spec", e.target.value)} /></td><td><NumInput value={it.qtyReq} onChange={(e) => setI(i, "qtyReq", e.target.value)} style={{ width: 75 }} /></td><td><NumInput value={it.qtyRec} onChange={(e) => setI(i, "qtyRec", e.target.value)} style={{ width: 75 }} /></td><td><Select value={it.condition} onChange={(e) => setI(i, "condition", e.target.value)}><option>سليم</option><option>منفذة</option><option>غير مطابق</option><option>تالف</option><option>ناقص</option></Select></td><td><Input value={it.notes} onChange={(e) => setI(i, "notes", e.target.value)} /></td><td><button className="btn sm ghost" onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button></td></tr>)}</tbody>
      </table></div>
      <button className="btn sm mt" onClick={() => setItems([...items, { name: "", spec: "", qtyReq: "", qtyRec: "", condition: "سليم", notes: "" }])}>＋ صنف</button>
      {partial && <div className="alert warn small mt">توجد كميات مستلمة أقل من المطلوبة — حدّد «تم الاستلام جزئيًا» واذكر تفاصيل النقص.</div>}
      <div className="grid c3 mt">
        <Field label="نتيجة الفحص والاستلام" span3><Checks options={["تم الاستلام كاملًا وبحالة سليمة ومطابقة للمواصفات", "تم الاستلام جزئيًا", "توجد أصناف غير مطابقة للمواصفات", "توجد أصناف تالفة أو بها نقص"]} value={f.results} onChange={(v) => setF({ ...f, results: v })} /></Field>
        <Field label="تفاصيل النقص أو الملاحظات" span2><Input value={f.shortage} onChange={set("shortage")} /></Field>
        <Field label="الإجراء المتخذ"><Input value={f.action} onChange={set("action")} /></Field>
        <Field label="القيمة قبل الضريبة"><NumInput value={f.subtotal} onChange={set("subtotal")} /></Field>
        <Field label="ضريبة القيمة المضافة"><NumInput value={f.vat} onChange={set("vat")} /></Field>
        <Field label="الإجمالي شامل الضريبة"><div className="input"><Money v={total} /></div></Field>
        <Field label="المستندات المرفقة" span3><Checks options={["أمر الشراء المعتمد", "فاتورة المورد", "عرض السعر المعتمد", "شهادة الضمان أو مستندات الأصناف", "صور المشتريات", "مستندات إضافية"]} value={f.docs} onChange={(v) => setF({ ...f, docs: v })} /></Field>
      </div>
    </Modal>
  );
}

// ─── refunds (طلبات الاسترداد) ─────────────────────────────────────────────
const R_ST: Record<string, string> = { SUBMITTED: "مقدَّم", REVIEWED: "تمت المراجعة", APPROVED: "معتمد — بانتظار التنفيذ", REJECTED: "مرفوض", PAID: "تم الاسترداد" };
const REASONS = ["سداد مبلغ بالزيادة", "تكرار عملية الدفع", "إلغاء طلب أو عملية شراء", "إعادة مبلغ غير مستحق", "سبب آخر"];
export function RefundsPage() {
  const { me, can } = useCompanyContext();
  const { settings } = useCharity();
  const [text, setText] = useUrlSearch();
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const { data, loading, reload } = useFetch<any[]>(`/charity/forms/refunds${q({ status, from, to })}`);
  const [edit, setEdit] = useState<any>(null);
  const [pay, setPay] = useState<any>(null);
  const [pr, setPr] = useState<any>(null);
  const { act, busy } = useDecide(reload);
  const rows = useMemo(() => (data || []).filter((r) => matches(r, text, ["number", "party", (x) => x.data?.reasonCode, (x) => x.data?.origRef, (x) => x.data?.iban])), [data, text]);
  const s = useSorted(rows);
  return (
    <div className="card">
      <div className="card-h"><h3>طلبات استرداد المبالغ</h3><div className="row">
        <button className="btn sm" onClick={() => setPr({ data: {} })}>🖨 نموذج فارغ</button>
        <button className="btn sm" onClick={() => exportExcel(rows.map((r) => ({ الرقم: r.number, التاريخ: fmtDate(r.date), "مقدم الطلب": r.party, السبب: r.data?.reasonCode, المبلغ: Number(r.amount), المعتمد: Number(r.review?.approvedAmount || 0), "سند الصرف": r.disbursementNumber, الحالة: R_ST[r.status] })), "طلبات-الاسترداد")}>⬇ Excel</button>
        {can("payments.write") && <button className="btn primary" onClick={() => setEdit({})}>＋ طلب استرداد</button>}
      </div></div>
      <div className="card-b"><div className="toolbar">
        <SearchBox value={text} onChange={setText} placeholder="الرقم أو الاسم أو المرجع" />
        <PeriodFilter from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 190 }}><option value="">كل الحالات</option>{Object.entries(R_ST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <FilterInfo shown={rows.length} total={data?.length || 0} active={!!(text || status || from || to)} onClear={() => { setText(""); setStatus(""); setFrom(""); setTo(""); }} />
      </div></div>
      {loading && !data ? <Loading /> : !rows.length ? <Empty text="لا توجد طلبات استرداد" /> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><Th k="number" s={s}>الرقم</Th><Th k="date" s={s}>التاريخ</Th><Th k="party" s={s}>مقدم الطلب</Th><th>السبب</th><Th k="amount" s={s} n>المبلغ</Th><th>المسار</th><th /></tr></thead>
          <tbody>{s.sorted.map((r: any) => <tr key={r.id}>
            <td className="num">{r.number}{r.disbursementNumber && <div className="small muted num">{r.disbursementNumber}</div>}</td><td className="dt">{fmtDate(r.date)}</td>
            <td>{r.party}<div className="small muted num">{r.data?.iban}</div></td><td>{r.data?.reasonCode}<div className="small muted">{r.data?.reasonText}</div></td>
            <td className="n"><b><Money v={r.review?.approvedAmount ?? r.amount} /></b></td>
            <td><Steps status={r.status} flow={["SUBMITTED", "REVIEWED", "APPROVED", "PAID"]} labels={["مقدَّم", "مراجعة", "معتمد", "مسترد"]} rejected={r.review?.decisionNote} /></td>
            <td className="row" style={{ gap: 4 }}>
              <button className="btn sm" onClick={() => setPr({ data: fromForm({ ...r, kind: "REFUND" }) })}>🖨</button>
              {can("payments.write") && ["SUBMITTED", "REVIEWED", "REJECTED"].includes(r.status) && <button className="btn sm" onClick={() => setEdit(r)}>تعديل</button>}
              {can("payments.write") && r.status === "SUBMITTED" && <button className="btn sm" disabled={busy} onClick={() => act(`/charity/forms/refunds/${r.id}/review`, { note: window.prompt("ملاحظات المراجعة المالية") || "" }, "تمت المراجعة")}>مراجعة</button>}
              {isAdmin(me) && ["SUBMITTED", "REVIEWED"].includes(r.status) && <button className="btn sm primary" disabled={busy} onClick={() => { const v = window.prompt("المبلغ الموافق عليه", String(r.amount)); if (v !== null) act(`/charity/forms/refunds/${r.id}/approve`, { approvedAmount: v }, "تم الاعتماد"); }}>اعتماد</button>}
              {isAdmin(me) && ["SUBMITTED", "REVIEWED", "APPROVED"].includes(r.status) && <button className="btn sm ghost" disabled={busy} onClick={() => { const n = window.prompt("سبب الرفض / عدم الاستحقاق"); if (n) act(`/charity/forms/refunds/${r.id}/reject`, { note: n }, "تم الرفض"); }}>رفض</button>}
              {can("payments.write") && r.status === "APPROVED" && <button className="btn sm primary" onClick={() => setPay(r)}>تنفيذ الاسترداد</button>}
              {can("payments.write") && ["SUBMITTED", "REVIEWED", "REJECTED"].includes(r.status) && <button className="btn sm ghost" onClick={() => confirmDlg(`حذف ${r.number}؟`) && api(`/charity/forms/refunds/${r.id}`, { method: "DELETE" }).then(reload)}>حذف</button>}
            </td></tr>)}</tbody>
        </table></div>
      )}
      {edit && <RefundModal init={edit} onClose={(ok) => { setEdit(null); if (ok) reload(); }} />}
      {pay && <RefundPay r={pay} onClose={(ok) => { setPay(null); if (ok) reload(); }} />}
      {pr && <PrintModal tplKey="refund" data={pr.data} settings={settings} onClose={() => setPr(null)} />}
    </div>
  );
}

function RefundModal({ init, onClose }: { init: any; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ requester: "", idNo: "", department: "", phone: "", amount: "", origDate: "", origMethod: "TRANSFER", origRef: "", reasonCode: REASONS[0], reasonText: "", beneficiary: "", bank: "", holder: "", iban: "", refundMethod: "TRANSFER", docs: [], journalNo: "", ...(init.data || {}) });
  const [date, setDate] = useState(fmtDate(init.date) || today());
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  return (
    <Modal title={init.id ? `تعديل ${init.number}` : "نموذج طلب استرداد مبلغ مالي"} wide onClose={() => onClose()} footer={<><button className="btn primary" disabled={busy} onClick={() => run(async () => { const body = { date, data: { ...f, beneficiary: f.beneficiary || f.requester, holder: f.holder || f.beneficiary || f.requester } }; if (init.id) await api(`/charity/forms/refunds/${init.id}`, { method: "PUT", body }); else await api("/charity/forms/refunds", { body }); onClose(true); }, "تم تقديم الطلب")}>حفظ وتقديم</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <div className="grid c4">
        <Field label="اسم مقدم الطلب" span2><Input value={f.requester} onChange={set("requester")} /></Field>
        <Field label="الهوية / السجل التجاري"><Input value={f.idNo} onChange={set("idNo")} dir="ltr" /></Field>
        <Field label="رقم التواصل"><Input value={f.phone} onChange={set("phone")} dir="ltr" /></Field>
        <Field label="القسم / الإدارة"><Input value={f.department} onChange={set("department")} /></Field>
        <Field label="تاريخ الطلب"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!!init.id} /></Field>
        <Field label="المبلغ المطلوب استرداده"><NumInput value={f.amount} onChange={set("amount")} /></Field>
        <Field label="رقم القيد المحاسبي الأصلي"><Input value={f.journalNo} onChange={set("journalNo")} dir="ltr" /></Field>
        <Field label="المبلغ كتابةً" span2><div className="input" style={{ background: "var(--surface-2)", minHeight: 36 }}>{words(f.amount)}</div></Field>
        <Field label="تاريخ الدفع الأصلي"><Input type="date" value={f.origDate} onChange={set("origDate")} /></Field>
        <Field label="طريقة الدفع الأصلية"><Select value={f.origMethod} onChange={set("origMethod")}><option value="CASH">نقدًا</option><option value="TRANSFER">تحويل بنكي</option><option value="CHEQUE">شيك</option><option value="أخرى">أخرى</option></Select></Field>
        <Field label="مرجع العملية الأصلية" span2><Input value={f.origRef} onChange={set("origRef")} dir="ltr" /></Field>
        <Field label="سبب الاسترداد" span2><Select value={f.reasonCode} onChange={set("reasonCode")}>{REASONS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
        <Field label="شرح تفصيلي للسبب" span3><Input value={f.reasonText} onChange={set("reasonText")} /></Field>
        <Field label="المستفيد من الاسترداد"><Input value={f.beneficiary} onChange={set("beneficiary")} placeholder={f.requester} /></Field>
        <Field label="اسم البنك"><Input value={f.bank} onChange={set("bank")} /></Field>
        <Field label="اسم صاحب الحساب"><Input value={f.holder} onChange={set("holder")} /></Field>
        <Field label="رقم الآيبان"><Input value={f.iban} onChange={set("iban")} dir="ltr" placeholder="SA.." /></Field>
        <Field label="طريقة الاسترداد"><Select value={f.refundMethod} onChange={set("refundMethod")}><option value="TRANSFER">تحويل بنكي</option><option value="CHEQUE">شيك</option><option value="CASH">نقدًا</option></Select></Field>
        <Field label="المستندات المؤيدة" span3><Checks options={["إيصال أو سند الدفع الأصلي", "فاتورة أو مستند العملية", "إثبات التحويل البنكي", "مستند يوضح سبب الاسترداد", "مستندات أخرى"]} value={f.docs} onChange={(v) => setF({ ...f, docs: v })} /></Field>
      </div>
    </Modal>
  );
}

function RefundPay({ r, onClose }: { r: any; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const [acc, setAcc] = useState<any>(null);
  const [pay, setPay] = useState<any>(null);
  const [f, setF] = useState<any>({ date: today(), refNo: "", method: r.data?.refundMethod || "TRANSFER" });
  return (
    <Modal title={`تنفيذ الاسترداد ${r.number}`} onClose={() => onClose()} footer={<><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api(`/charity/forms/refunds/${r.id}/pay`, { body: { ...f, accountId: acc?.id, payAccountId: pay?.id } }); onClose(true); }, "تم تنفيذ الاسترداد بسند صرف")}>تنفيذ وترحيل</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <div className="stat-list mb"><div className="item"><span>المستفيد</span><b>{r.data?.beneficiary || r.party}</b></div><div className="item"><span>المبلغ المعتمد</span><b><Money v={r.review?.approvedAmount ?? r.amount} /></b></div>{r.data?.iban && <div className="item"><span>الآيبان</span><b className="num">{r.data.iban}</b></div>}</div>
      <div className="grid c2">
        <Field label="التاريخ"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="الطريقة"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="TRANSFER">تحويل بنكي</option><option value="CHEQUE">شيك</option><option value="CASH">نقدًا</option></Select></Field>
        <Field label="الحساب المدين (يُخفَّض)" span2 hint="فارغ = إيرادات متنوعة؛ اختر حساب التبرع الأصلي إن كان المسترد تبرعاً"><Picker value={acc} onChange={setAcc} fetcher={anyNonCash} label={acLabel} /></Field>
        <Field label="من حساب (الصندوق / البنك)"><Picker value={pay} onChange={setPay} fetcher={cashFetcher} label={acLabel} /></Field>
        {f.method !== "CASH" && <Field label="مرجع التحويل / الشيك"><Input value={f.refNo} onChange={(e) => setF({ ...f, refNo: e.target.value })} dir="ltr" /></Field>}
      </div>
    </Modal>
  );
}

