/** Associations edition: members & subscriptions, member shares and surplus distribution (cooperatives), and the one register of every voucher. */
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, q, useFetch, Money, Loading, Empty, Badge, Modal, Field, Input, NumInput, Picker, accountFetcher, useAction, useCompanyContext, today, fmtDate, SearchBox, FilterInfo, useSorted, Th, matches, exportExcel, Tabs, PeriodFilter, yearStart, confirmDlg } from "../lib";
import { CFG } from "../shared/country";
import { EntryPreview } from "../pages/EntryPreview";
import { useCharity } from "./ctx";

const KIND: Record<string, string> = { FOUNDER: "مؤسس", WORKING: "عامل", AFFILIATE: "منتسب", HONORARY: "فخري" };
const MST: Record<string, string> = { ACTIVE: "نشط", SUSPENDED: "موقوف", WITHDRAWN: "منسحب" };
const DST: Record<string, string> = { POSTED: "مرحّل", CANCELLED: "ملغى" };
const METHOD: Record<string, string> = { CASH: "نقدي", TRANSFER: "تحويل بنكي", CHEQUE: "شيك", CARD: "شبكة / بطاقة" };
const cashFetcher = accountFetcher((a) => a.isCashBank);
const acLabel = (a: any) => `${a.code} — ${a.nameAr}`;
const memberFetcher = (s: string) => api(`/charity/members${q({ q: s, limit: 20 })}`);
const memberLabel = (m: any) => `${m.member?.no || m.code} — ${m.name}`;

function Kpi({ label, v, icon, money: m = true, sub }: { label: string; v: any; icon: string; money?: boolean; sub?: React.ReactNode }) {
  return <div className="card kpi"><span className="label">{label}</span><span className="value">{m ? <Money v={v} /> : <span className="num">{v}</span>}</span>{sub && <span className="sub">{sub}</span>}<span className="icon">{icon}</span></div>;
}

/** «معاينة القيد» + «حفظ وترحيل» for any posting form: the preview runs the real posting inside a rolled-back transaction. */
function PostFooter({ previewUrl, body, onSaved, saveUrl, ok, onClose, label = "حفظ وترحيل", msg }: { previewUrl: string; saveUrl: string; body: () => any; ok: boolean; onSaved: (r: any) => void; onClose: () => void; label?: string; msg: string }) {
  const { run, busy } = useAction();
  const [prev, setPrev] = useState<any>(null);
  return <>
    {prev && <Modal title="معاينة القيد" onClose={() => setPrev(null)} footer={<button className="btn" onClick={() => setPrev(null)}>رجوع</button>}><EntryPreview prev={prev} /></Modal>}
    <button className="btn" onClick={onClose}>إلغاء</button>
    <button className="btn" disabled={busy || !ok} onClick={() => run(async () => setPrev(await api(previewUrl, { body: body() })))}>معاينة القيد</button>
    <button className="btn primary" disabled={busy || !ok} onClick={() => run(async () => onSaved(await api(saveUrl, { body: body() })), msg)}>{label}</button>
  </>;
}

// ─── members ───────────────────────────────────────────────────────────────
export function MembersPage() {
  const { settings } = useCharity();
  const { can } = useCompanyContext();
  const coop = settings?.assocType === "COOPERATIVE";
  const [year, setYear] = useState(new Date().getFullYear());
  const [text, setText] = useState("");
  const [st, setSt] = useState("");
  const { data, loading, reload } = useFetch<any[]>(`/charity/members${q({ year })}`);
  const [edit, setEdit] = useState<any>(null);
  const [fee, setFee] = useState<any>(null);
  const [share, setShare] = useState<any>(null);
  const [stmt, setStmt] = useState<any>(null);
  const rows = useMemo(() => (data || []).filter((m) => (!st || m.member.status === st || (st === "UNPAID" && m.feeBalance > 0)) && matches(m, text, ["name", "code", "phone", "idNumber"])), [data, text, st]);
  const s = useSorted(rows);
  const all = data || [];
  const active = all.filter((m) => m.member.status === "ACTIVE");
  const paid = all.reduce((a, m) => a + Number(m.feePaid), 0);
  const owed = all.reduce((a, m) => a + Number(m.feeBalance), 0);
  const shares = all.reduce((a, m) => a + Number(m.shares), 0);
  const capital = all.reduce((a, m) => a + Number(m.shareCapital), 0);
  return <>
    <div className="kpis mb">
      <Kpi label="الأعضاء النشطون" v={`${active.length} من ${all.length}`} icon="👥" money={false} />
      <Kpi label={`اشتراكات ${year} المحصلة`} v={paid} icon="💳" />
      <Kpi label={`اشتراكات ${year} غير المسددة`} v={owed} icon="⏳" sub={settings?.membership?.annualFee ? <>الرسم السنوي <Money v={settings.membership.annualFee} /></> : "حدّد الرسم السنوي من الإعدادات"} />
      {coop && <Kpi label="الأسهم المكتتبة" v={shares} icon="📈" money={false} sub={<>رأس مال الأعضاء <Money v={capital} /></>} />}
    </div>
    <div className="card">
      <div className="card-h"><h3>{coop ? "الأعضاء والمساهمون" : "الأعضاء والجمعية العمومية"}</h3>
        <div className="row">
          <button className="btn sm" onClick={() => exportExcel(rows.map((m) => ({ "رقم العضوية": m.member.no, الاسم: m.name, الصفة: KIND[m.member.kind], الحالة: MST[m.member.status], "تاريخ الانضمام": fmtDate(m.member.joinDate), الجوال: m.phone, الهوية: m.idNumber, ...(coop ? { الأسهم: Number(m.shares), "رأس المال": Number(m.shareCapital), "نسبة الملكية %": m.sharePct } : {}), [`اشتراك ${year} مسدد`]: Number(m.feePaid), "المتبقي": Number(m.feeBalance) })), `الأعضاء-${year}`)}>⬇ Excel</button>
          {can("partners.write") && <button className="btn primary" onClick={() => setEdit({})}>＋ عضو جديد</button>}
        </div>
      </div>
      <div className="card-b"><div className="toolbar">
        <SearchBox value={text} onChange={setText} placeholder="بحث بالاسم أو رقم العضوية أو الجوال" />
        <label className="row small" style={{ gap: 6 }}>سنة الاشتراك <input className="input" type="number" style={{ width: 96 }} value={year} onChange={(e) => setYear(Number(e.target.value) || new Date().getFullYear())} /></label>
        <select className="input" style={{ width: 170 }} value={st} onChange={(e) => setSt(e.target.value)}><option value="">كل الأعضاء</option>{Object.entries(MST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="UNPAID">عليهم اشتراك {year}</option></select>
        <FilterInfo shown={rows.length} total={all.length} active={!!(text || st)} onClear={() => { setText(""); setSt(""); }} />
      </div></div>
      {loading && !data ? <Loading /> : !rows.length ? <Empty text="لا يوجد أعضاء — أضف أول عضو" /> : <div className="table-wrap"><table className="tbl">
        <thead><tr><Th k="code" s={s}>رقم العضوية</Th><Th k="name" s={s}>العضو</Th><th>الصفة / الحالة</th>{coop && <><Th k="shares" s={s} n>الأسهم</Th><Th k="shareCapital" s={s} n>رأس المال</Th></>}<Th k="feePaid" s={s} n>اشتراك {year}</Th><th /></tr></thead>
        <tbody>{s.sorted.map((m: any) => <tr key={m.id} style={m.member.status !== "ACTIVE" ? { opacity: .6 } : undefined}>
          <td className="num">{m.member.no}</td>
          <td><b>{m.name}</b><div className="small muted">{m.phone || ""}{m.member.joinDate ? ` · منذ ${fmtDate(m.member.joinDate)}` : ""}</div></td>
          <td>{KIND[m.member.kind]} <Badge s={m.member.status} map={MST} /></td>
          {coop && <><td className="n num">{m.shares}<div className="small muted">{m.sharePct}%</div></td><td className="n"><Money v={m.shareCapital} /></td></>}
          <td className="n"><Money v={m.feePaid} />{m.feeBalance > 0 ? <div className="small" style={{ color: "var(--danger-ink)" }}>متبقٍ <Money v={m.feeBalance} /></div> : m.feeDue > 0 ? <div className="small" style={{ color: "var(--success-ink)" }}>مسدد ✓</div> : null}</td>
          <td className="row" style={{ gap: 4 }}>
            {can("payments.write") && m.member.status === "ACTIVE" && <button className="btn sm" onClick={() => setFee({ member: m, year, amount: m.feeBalance || settings?.membership?.annualFee || "" })}>💳 اشتراك</button>}
            {coop && can("payments.write") && <button className="btn sm" onClick={() => setShare({ member: m })}>📈 أسهم</button>}
            <button className="btn sm" onClick={() => setStmt(m)}>كشف</button>
            {can("partners.write") && <button className="btn sm ghost" onClick={() => setEdit(m)}>تعديل</button>}
          </td>
        </tr>)}</tbody>
      </table></div>}
    </div>
    {edit && <MemberModal init={edit} coop={coop} onClose={(ok) => { setEdit(null); if (ok) reload(); }} />}
    {fee && <FeeModal init={fee} onClose={(ok) => { setFee(null); if (ok) reload(); }} />}
    {share && <ShareModal init={share} onClose={(ok) => { setShare(null); if (ok) reload(); }} />}
    {stmt && <MemberStatement m={stmt} coop={coop} onClose={() => setStmt(null)} />}
  </>;
}

function MemberModal({ init, coop, onClose }: { init: any; coop: boolean; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const mi = init.member || {};
  const [f, setF] = useState<any>({ name: init.name || "", memberNo: init.id ? mi.no || "" : "", kind: mi.kind || "WORKING", status: mi.status || "ACTIVE", joinDate: mi.joinDate || today(), idNumber: init.idNumber || "", phone: init.phone || "", email: init.email || "", city: init.city || "", iban: mi.iban || "", bankName: mi.bankName || "", notes: init.notes || "", isCustomer: init.id ? !!init.isCustomer : coop });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const save = () => run(async () => { if (init.id) await api(`/charity/members/${init.id}`, { method: "PUT", body: f }); else await api("/charity/members", { body: f }); onClose(true); }, "تم حفظ العضو");
  return <Modal title={init.id ? `تعديل العضو ${init.name}` : "عضو جديد"} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !f.name.trim()} onClick={save}>حفظ</button></>}>
    <div className="grid c3">
      <Field label="اسم العضو" span2><Input value={f.name} onChange={set("name")} autoFocus /></Field>
      <Field label="رقم العضوية" hint="فارغ = يُولَّد تلقائياً"><Input value={f.memberNo} onChange={set("memberNo")} dir="ltr" /></Field>
      <Field label="صفة العضوية"><select className="input" value={f.kind} onChange={set("kind")}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="الحالة"><select className="input" value={f.status} onChange={set("status")}>{Object.entries(MST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="تاريخ الانضمام"><Input type="date" value={f.joinDate} onChange={set("joinDate")} /></Field>
      <Field label="رقم الهوية / الإقامة"><Input value={f.idNumber} onChange={set("idNumber")} dir="ltr" /></Field>
      <Field label="الجوال"><Input value={f.phone} onChange={set("phone")} dir="ltr" /></Field>
      <Field label="البريد"><Input value={f.email} onChange={set("email")} dir="ltr" /></Field>
      <Field label="المدينة"><Input value={f.city} onChange={set("city")} /></Field>
      <Field label="الآيبان (لصرف العوائد)" span2><Input value={f.iban} onChange={set("iban")} dir="ltr" placeholder="SA..." /></Field>
      <Field label="البنك"><Input value={f.bankName} onChange={set("bankName")} /></Field>
      <Field label="ملاحظات" span2><Input value={f.notes} onChange={set("notes")} /></Field>
      <Field label=" "><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.isCustomer} onChange={set("isCustomer")} />يشتري من الجمعية (عميل)</label></Field>
    </div>
    {coop && <div className="alert info small mt">العضو العميل تُحتسب فواتير مبيعاته من البرنامج المحاسبي «تعاملات» عند توزيع عائد المعاملات.</div>}
  </Modal>;
}

function FeeModal({ init, onClose }: { init: any; onClose: (ok?: boolean) => void }) {
  const [m, setM] = useState<any>(init.member || null);
  const [cash, setCash] = useState<any>(null);
  const [f, setF] = useState<any>({ date: today(), feeYear: init.year || new Date().getFullYear(), amount: init.amount || "", method: "CASH", refNo: "" });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const body = () => ({ ...f, partnerId: m?.id, cashAccountId: cash?.id });
  return <Modal title="تحصيل اشتراك عضوية" onClose={() => onClose()} footer={<PostFooter previewUrl="/charity/members/fee/preview-entry" saveUrl="/charity/members/fee" body={body} ok={!!m && Number(f.amount) > 0} onSaved={() => onClose(true)} onClose={() => onClose()} msg="تم حفظ سند الاشتراك وترحيل القيد" />}>
    <div className="grid c2">
      <Field label="العضو" span2><Picker value={m} onChange={setM} fetcher={memberFetcher} label={memberLabel} /></Field>
      <Field label="عن سنة"><Input type="number" value={f.feeYear} onChange={set("feeYear")} /></Field>
      <Field label="التاريخ"><Input type="date" value={f.date} onChange={set("date")} /></Field>
      <Field label={`المبلغ (${CFG.words.one})`}><NumInput value={f.amount} onChange={set("amount")} /></Field>
      <Field label="الطريقة"><select className="input" value={f.method} onChange={set("method")}>{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="إلى حساب" hint="فارغ = الصندوق الرئيسي للنقدي والبنك لغيره"><Picker value={cash} onChange={setCash} fetcher={cashFetcher} label={acLabel} /></Field>
      {f.method !== "CASH" && <Field label="المرجع / رقم الحوالة"><Input value={f.refNo} onChange={set("refNo")} dir="ltr" /></Field>}
    </div>
    <div className="alert info small mt">يُسجَّل كسند قبض جمعية بمصدر «اشتراك عضوية» — من ح/ الصندوق أو البنك إلى ح/ اشتراكات الأعضاء — ويظهر في سندات القبض وكشف العضو.</div>
  </Modal>;
}

function ShareModal({ init, onClose }: { init: any; onClose: (ok?: boolean) => void }) {
  const { settings } = useCharity();
  const [m, setM] = useState<any>(init.member || null);
  const [cash, setCash] = useState<any>(null);
  const [f, setF] = useState<any>({ kind: init.kind || "SUBSCRIBE", date: today(), shares: "", unitValue: settings?.membership?.shareValue || "", notes: "", overrideCap: false });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const amount = (Number(f.shares) || 0) * (Number(f.unitValue) || 0);
  const body = () => ({ ...f, partnerId: m?.id, cashAccountId: cash?.id });
  return <Modal title="اكتتاب / استرداد أسهم" onClose={() => onClose()} footer={<PostFooter previewUrl="/charity/shares/preview-entry" saveUrl="/charity/shares" body={body} ok={!!m && Number(f.shares) > 0 && Number(f.unitValue) > 0} onSaved={() => onClose(true)} onClose={() => onClose()} msg="تم تسجيل حركة الأسهم وترحيل القيد" />}>
    <div className="grid c2">
      <Field label="العضو" span2><Picker value={m} onChange={setM} fetcher={memberFetcher} label={memberLabel} /></Field>
      <Field label="العملية"><select className="input" value={f.kind} onChange={set("kind")}><option value="SUBSCRIBE">اكتتاب (شراء أسهم)</option><option value="REDEEM">استرداد (إعادة قيمة أسهم)</option></select></Field>
      <Field label="التاريخ"><Input type="date" value={f.date} onChange={set("date")} /></Field>
      <Field label="عدد الأسهم"><NumInput value={f.shares} onChange={set("shares")} /></Field>
      <Field label={`القيمة الاسمية للسهم (${CFG.words.one})`}><NumInput value={f.unitValue} onChange={set("unitValue")} /></Field>
      <Field label={f.kind === "SUBSCRIBE" ? "إلى حساب" : "من حساب"} hint="فارغ = الصندوق الرئيسي"><Picker value={cash} onChange={setCash} fetcher={cashFetcher} label={acLabel} /></Field>
      <Field label="المبلغ"><div className="input" style={{ background: "var(--surface-2)" }}><Money v={amount} /></div></Field>
      <Field label="ملاحظات / رقم القرار" span2><Input value={f.notes} onChange={set("notes")} /></Field>
      {f.kind === "SUBSCRIBE" && <label className="row small" style={{ gap: 6, gridColumn: "1 / -1" }}><input type="checkbox" checked={f.overrideCap} onChange={set("overrideCap")} />تجاوز الحد الأعلى لملكية العضو بقرار مسجّل</label>}
    </div>
    <div className="alert info small mt">القيد: {f.kind === "SUBSCRIBE" ? "من ح/ الصندوق أو البنك إلى ح/ رأس المال (أسهم الأعضاء)" : "من ح/ رأس المال (أسهم الأعضاء) إلى ح/ الصندوق أو البنك"}.</div>
  </Modal>;
}

function MemberStatement({ m, coop, onClose }: { m: any; coop: boolean; onClose: () => void }) {
  const { data } = useFetch<any>(`/charity/members/${m.id}/statement`);
  return <Modal wide title={`كشف العضو: ${m.name} (${m.member.no})`} onClose={onClose} footer={<><button className="btn" onClick={() => window.print()}>🖨 طباعة</button><button className="btn" onClick={onClose}>إغلاق</button></>}>
    {!data ? <Loading /> : <>
      <h4 className="mb">الاشتراكات</h4>
      {!data.fees.length ? <div className="muted small mb">لا توجد اشتراكات مسجلة</div> : <table className="tbl compact mb"><thead><tr><th>السند</th><th>التاريخ</th><th>عن سنة</th><th className="n">المبلغ</th><th>الحالة</th></tr></thead><tbody>{data.fees.map((r: any) => <tr key={r.id} style={r.status !== "POSTED" ? { opacity: .55 } : undefined}><td className="num">{r.number}</td><td className="dt">{fmtDate(r.date)}</td><td>{r.feeYear || "—"}</td><td className="n"><Money v={r.amount} /></td><td><Badge s={r.status} map={DST} /></td></tr>)}</tbody></table>}
      {coop && <>
        <h4 className="mb">حركات الأسهم</h4>
        {!data.shares.length ? <div className="muted small mb">لا توجد أسهم</div> : <table className="tbl compact mb"><thead><tr><th>الرقم</th><th>التاريخ</th><th>العملية</th><th className="n">الأسهم</th><th className="n">المبلغ</th><th>القيد</th></tr></thead><tbody>{data.shares.map((x: any) => <tr key={x.id} style={x.status !== "POSTED" ? { opacity: .55 } : undefined}><td className="num">{x.number}</td><td>{fmtDate(x.date)}</td><td>{x.kind === "SUBSCRIBE" ? "اكتتاب" : "استرداد"}</td><td className="n num">{x.shares}</td><td className="n"><Money v={x.amount} /></td><td>{x.journalId ? <Link to={`/charity/journals/${x.journalId}`}>{x.journalNumber}</Link> : "—"}</td></tr>)}</tbody></table>}
        <h4 className="mb">العوائد الموزعة</h4>
        {!data.distributions.length ? <div className="muted small">لا توجد توزيعات</div> : <table className="tbl compact"><thead><tr><th>التوزيع</th><th>السنة</th><th className="n">عائد رأس المال</th><th className="n">عائد المعاملات</th><th className="n">الإجمالي</th><th className="n">المصروف</th></tr></thead><tbody>{data.distributions.map((d: any) => <tr key={d.id} style={d.status !== "POSTED" ? { opacity: .55 } : undefined}><td className="num">{d.number}</td><td>{d.year}</td><td className="n"><Money v={d.capitalReturn} /></td><td className="n"><Money v={d.txReturn} /></td><td className="n"><b><Money v={d.total} /></b></td><td className="n"><Money v={d.paid} /></td></tr>)}</tbody></table>}
      </>}
    </>}
  </Modal>;
}

// ─── shares & surplus distribution (cooperatives) ──────────────────────────
export function SharesPage() {
  const [tab, setTab] = useState("dist");
  return <>
    <Tabs tabs={[{ key: "dist", label: "توزيع الفائض" }, { key: "list", label: "سجل التوزيعات وصرف العوائد" }, { key: "shares", label: "حركات الأسهم" }]} value={tab} onChange={setTab} />
    <div className="mt">{tab === "dist" ? <DistributionPlan onPosted={() => setTab("list")} /> : tab === "list" ? <DistributionsList /> : <ShareTxns />}</div>
  </>;
}

const PCT_AR: Record<string, string> = { reserve: "الاحتياطي النظامي", capital: "عائد على رأس المال", social: "الخدمات الاجتماعية", training: "تدريب وتثقيف الأعضاء" };

function DistributionPlan({ onPosted }: { onPosted: () => void }) {
  const { settings } = useCharity();
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [pcts, setPcts] = useState<any>(settings?.membership?.dist || {});
  const [surplus, setSurplus] = useState("");
  const [plan, setPlan] = useState<any>(null);
  const [prev, setPrev] = useState<any>(null);
  const [date, setDate] = useState(today());
  const [ref, setRef] = useState("");
  const body = () => ({ year, pcts, surplus: surplus === "" ? undefined : surplus, date, decisionRef: ref });
  const calc = () => run(async () => setPlan(await api("/charity/distributions/plan", { body: body() })));
  return <div className="grid">
    <div className="card"><div className="card-h"><h3>احتساب توزيع الفائض الصافي</h3></div><div className="card-b grid c4">
      <Field label="السنة المالية"><Input type="number" value={year} onChange={(e: any) => { setYear(Number(e.target.value)); setPlan(null); }} /></Field>
      <Field label="الفائض الصافي" hint="فارغ = من الأستاذ العام (الإيرادات − المصروفات)"><NumInput value={surplus} onChange={(e: any) => { setSurplus(e.target.value); setPlan(null); }} /></Field>
      {Object.keys(PCT_AR).map((k) => <Field key={k} label={`${PCT_AR[k]} %`}><NumInput value={pcts[k] ?? ""} onChange={(e: any) => { setPcts({ ...pcts, [k]: e.target.value }); setPlan(null); }} /></Field>)}
      <Field label="أساس توزيع الباقي"><select className="input" value={pcts.basis || "TRANSACTIONS"} onChange={(e) => { setPcts({ ...pcts, basis: e.target.value }); setPlan(null); }}><option value="TRANSACTIONS">تعاملات العضو</option><option value="CAPITAL">عدد الأسهم</option></select></Field>
      <Field label=" "><button className="btn primary" disabled={busy} onClick={calc}>احتساب</button></Field>
    </div></div>
    {plan && <div className="card"><div className="card-h"><h3>التوزيع المقترح لعام {plan.year}</h3><div className="row"><button className="btn sm" onClick={() => exportExcel(plan.lines.map((l: any) => ({ "رقم العضوية": l.no, العضو: l.name, الأسهم: l.shares, التعاملات: l.transactions, "عائد رأس المال": l.capitalReturn, "عائد المعاملات/الأسهم": l.txReturn, الإجمالي: l.total })), `توزيع-الفائض-${plan.year}`)}>⬇ Excel</button></div></div>
      <div className="card-b">
        {plan.warnings.map((w: string, i: number) => <div key={i} className="alert warn small mb">{w}</div>)}
        <div className="kpis mb">
          <Kpi label="الفائض الصافي" v={plan.surplus} icon="Σ" sub={plan.surplus !== plan.ledgerSurplus ? <>في الأستاذ <Money v={plan.ledgerSurplus} /></> : "من الأستاذ العام"} />
          <Kpi label={`الاحتياطي النظامي ${plan.pcts.reserve}%`} v={plan.reserve} icon="🏦" />
          <Kpi label="الخدمات الاجتماعية + التدريب" v={plan.social + plan.training} icon="🤝" />
          <Kpi label="للأعضاء" v={plan.toMembers} icon="👥" sub={plan.retained > 0 ? <>يبقى في الأرباح المبقاة <Money v={plan.retained} /></> : undefined} />
        </div>
        <div className="table-wrap"><table className="tbl compact"><thead><tr><th>العضو</th><th className="n">الأسهم</th><th className="n">التعاملات</th><th className="n">عائد رأس المال</th><th className="n">{plan.basis === "CAPITAL" ? "عائد حسب الأسهم" : "عائد المعاملات"}</th><th className="n">الإجمالي</th></tr></thead>
          <tbody>{plan.lines.map((l: any) => <tr key={l.partnerId}><td><b>{l.name}</b> <span className="muted small">{l.no}</span></td><td className="n num">{l.shares}</td><td className="n"><Money v={l.transactions} /></td><td className="n"><Money v={l.capitalReturn} /></td><td className="n"><Money v={l.txReturn} /></td><td className="n"><b><Money v={l.total} /></b></td></tr>)}</tbody>
          <tfoot><tr><th>الإجمالي</th><th className="n num">{plan.totalShares}</th><th className="n"><Money v={plan.totalTransactions} /></th><th className="n"><Money v={plan.lines.reduce((a: number, l: any) => a + l.capitalReturn, 0)} /></th><th className="n"><Money v={plan.lines.reduce((a: number, l: any) => a + l.txReturn, 0)} /></th><th className="n"><Money v={plan.toMembers} /></th></tr></tfoot></table></div>
        {can("accounting.write") && plan.assocType === "COOPERATIVE" && plan.surplus > 0 && <div className="row mt" style={{ flexWrap: "wrap" }}>
          <Field label="تاريخ القيد"><Input type="date" value={date} onChange={(e: any) => setDate(e.target.value)} /></Field>
          <Field label="رقم قرار الجمعية العمومية"><Input value={ref} onChange={(e: any) => setRef(e.target.value)} /></Field>
          <button className="btn" disabled={busy} onClick={() => run(async () => setPrev(await api("/charity/distributions/preview-entry", { body: body() })))}>معاينة القيد</button>
          <button className="btn primary" disabled={busy} onClick={() => { if (confirmDlg(`ترحيل توزيع فائض ${plan.year} بمبلغ ${plan.surplus}؟`)) run(async () => { await api("/charity/distributions", { body: body() }); onPosted(); }, "تم ترحيل التوزيع"); }}>اعتماد وترحيل التوزيع</button>
        </div>}
      </div></div>}
    {prev && <Modal title="معاينة قيد توزيع الفائض" onClose={() => setPrev(null)} footer={<button className="btn" onClick={() => setPrev(null)}>رجوع</button>}><EntryPreview prev={prev} /></Modal>}
    {settings?.assocType !== "COOPERATIVE" && <div className="alert info">التوزيع على الأعضاء متاح للجمعيات التعاونية فقط — غيّر النوع من «إعدادات الجمعية».</div>}
  </div>;
}

function DistributionsList() {
  const { data, loading, reload } = useFetch<any[]>("/charity/distributions");
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const [pay, setPay] = useState<any>(null);
  if (loading && !data) return <Loading />;
  if (!data?.length) return <Empty text="لا توجد توزيعات مرحّلة" />;
  return <div className="card"><div className="table-wrap"><table className="tbl">
    <thead><tr><th>الرقم</th><th>السنة</th><th>التاريخ</th><th className="n">الفائض</th><th className="n">الاحتياطي</th><th className="n">للأعضاء</th><th className="n">المصروف</th><th>القيد</th><th>الحالة</th><th /></tr></thead>
    <tbody>{data.map((d) => { const toM = d.lines.reduce((a: number, l: any) => a + Number(l.total), 0); return <tr key={d.id} style={d.status !== "POSTED" ? { opacity: .55 } : undefined}>
      <td className="num">{d.number}</td><td>{d.year}</td><td>{fmtDate(d.date)}</td><td className="n"><Money v={d.surplus} /></td><td className="n"><Money v={d.reserve} /></td><td className="n"><Money v={toM} /></td><td className="n"><Money v={d.paid} /></td>
      <td>{d.journalId ? <Link to={`/charity/journals/${d.journalId}`}>{d.journalNumber}</Link> : "—"}</td><td><Badge s={d.status} map={DST} /></td>
      <td className="row" style={{ gap: 4 }}>
        {d.status === "POSTED" && can("payments.write") && toM - Number(d.paid) > 0.005 && <button className="btn sm primary" onClick={() => setPay(d)}>صرف العوائد</button>}
        {d.status === "POSTED" && can("accounting.write") && Number(d.paid) === 0 && <button className="btn sm ghost" disabled={busy} onClick={() => { const why = window.prompt(`سبب إلغاء التوزيع ${d.number}؟ (سيُعكس القيد)`); if (why !== null) run(async () => { await api(`/charity/distributions/${d.id}/cancel`, { body: { reason: why } }); reload(); }, "أُلغي التوزيع"); }}>إلغاء</button>}
      </td></tr>; })}</tbody></table></div>
    {pay && <PayModal d={pay} onClose={(ok) => { setPay(null); if (ok) reload(); }} />}
  </div>;
}

function PayModal({ d, onClose }: { d: any; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const [cash, setCash] = useState<any>(null);
  const [date, setDate] = useState(today());
  const [sel, setSel] = useState<Record<string, boolean>>(Object.fromEntries(d.lines.map((l: any) => [l.partnerId, true])));
  const ids = Object.keys(sel).filter((k) => sel[k]);
  return <Modal wide title={`صرف عوائد ${d.year} — ${d.number}`} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !ids.length} onClick={() => run(async () => { await api(`/charity/distributions/${d.id}/pay`, { body: { partnerIds: ids, cashAccountId: cash?.id, date } }); onClose(true); }, "تم صرف العوائد وترحيل القيود")}>صرف لـ {ids.length} عضو</button></>}>
    <div className="grid c2 mb"><Field label="من حساب" hint="فارغ = البنك الافتراضي"><Picker value={cash} onChange={setCash} fetcher={cashFetcher} label={acLabel} /></Field><Field label="التاريخ"><Input type="date" value={date} onChange={(e: any) => setDate(e.target.value)} /></Field></div>
    <table className="tbl compact"><thead><tr><th /><th>العضو</th><th className="n">المستحق</th></tr></thead><tbody>{d.lines.filter((l: any) => Number(l.total) > 0).map((l: any) => <tr key={l.partnerId}><td><input type="checkbox" checked={!!sel[l.partnerId]} onChange={(e) => setSel({ ...sel, [l.partnerId]: e.target.checked })} /></td><td>{l.name} <span className="muted small">{l.no}</span></td><td className="n"><Money v={l.total} /></td></tr>)}</tbody></table>
    <div className="alert info small mt">لكل عضو قيد: من ح/ عوائد وأرباح مستحقة للأعضاء إلى ح/ البنك. ما صُرف سابقاً لا يُصرف مرة أخرى.</div>
  </Modal>;
}

function ShareTxns() {
  const [f, setF] = useState({ from: yearStart(), to: "" });
  const { data, loading, reload } = useFetch<any[]>(`/charity/shares${q(f)}`);
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const [add, setAdd] = useState(false);
  return <div className="card">
    <div className="card-h"><h3>حركات الأسهم</h3><div className="row"><PeriodFilter from={f.from} to={f.to} onChange={(a, b) => setF({ from: a, to: b })} />{can("payments.write") && <button className="btn primary" onClick={() => setAdd(true)}>＋ اكتتاب / استرداد</button>}</div></div>
    {loading && !data ? <Loading /> : !data?.length ? <Empty text="لا توجد حركات أسهم في الفترة" /> : <div className="table-wrap"><table className="tbl">
      <thead><tr><th>الرقم</th><th>التاريخ</th><th>العضو</th><th>العملية</th><th className="n">الأسهم</th><th className="n">القيمة</th><th>الحساب</th><th>القيد</th><th>الحالة</th><th /></tr></thead>
      <tbody>{data.map((x) => <tr key={x.id} style={x.status !== "POSTED" ? { opacity: .55 } : undefined}>
        <td className="num">{x.number}</td><td>{fmtDate(x.date)}</td><td>{x.memberName} <span className="muted small">{x.memberNo}</span></td><td>{x.kind === "SUBSCRIBE" ? "اكتتاب" : "استرداد"}</td><td className="n num">{x.shares}</td><td className="n"><Money v={x.amount} /></td><td className="small">{x.cashAccountName}</td>
        <td>{x.journalId ? <Link to={`/charity/journals/${x.journalId}`}>{x.journalNumber}</Link> : "—"}</td><td><Badge s={x.status} map={DST} /></td>
        <td>{x.status === "POSTED" && can("accounting.write") && <button className="btn sm ghost" disabled={busy} onClick={() => { const why = window.prompt(`سبب إلغاء ${x.number}؟`); if (why !== null) run(async () => { await api(`/charity/shares/${x.id}/cancel`, { body: { reason: why } }); reload(); }, "أُلغيت الحركة وعُكس القيد"); }}>إلغاء</button>}</td>
      </tr>)}</tbody></table></div>}
    {add && <ShareModal init={{}} onClose={(ok) => { setAdd(false); if (ok) reload(); }} />}
  </div>;
}

// ─── one register for every voucher ────────────────────────────────────────
const SRC: Record<string, string> = { CORE_PAY: "سند قبض/صرف — البرنامج المحاسبي", CORE_EXP: "مصروف — البرنامج المحاسبي", CH_RCPT: "سند قبض — الجمعية", CH_DISB: "سند صرف — الجمعية", SHARES: "أسهم الأعضاء", DIST_PAY: "صرف عائد عضو" };
const SRC_C: Record<string, string> = { CORE_PAY: "blue", CORE_EXP: "blue", CH_RCPT: "green", CH_DISB: "amber", SHARES: "teal", DIST_PAY: "teal" };

export function VouchersPage() {
  const [f, setF] = useState({ from: yearStart(), to: today() });
  const [src, setSrc] = useState("");
  const [dir, setDir] = useState("");
  const [text, setText] = useState("");
  const { data, loading } = useFetch<any>(`/charity/vouchers${q(f)}`);
  const rows = useMemo(() => (data?.rows || []).filter((r: any) => (!src || (src === "CORE" ? r.src.startsWith("CORE") : src === "ASSOC" ? !r.src.startsWith("CORE") : r.src === src)) && (!dir || r.dir === dir) && matches(r, text, ["number", "party", "memo", "journalNumber"])), [data, src, dir, text]);
  const s = useSorted(rows);
  const t = data?.totals;
  return <>
    {t && <div className="kpis mb">
      <Kpi label="المقبوضات" v={t.in} icon="⬇" sub={<>الجمعية <Money v={t.assocIn} /> · المحاسبي <Money v={t.coreIn} /></>} />
      <Kpi label="المدفوعات" v={t.out} icon="⬆" sub={<>الجمعية <Money v={t.assocOut} /> · المحاسبي <Money v={t.coreOut} /></>} />
      <Kpi label="الصافي" v={t.in - t.out} icon="Σ" />
      <Kpi label="سندات بقيود مطابقة" v={data.mismatches ? `${data.mismatches} سند يحتاج مراجعة` : "كلها ✓"} money={false} icon="🔗" />
    </div>}
    <div className="card">
      <div className="card-h"><h3>سجل السندات الموحّد</h3><span className="small muted">سندات البرنامج المحاسبي وسندات الجمعية في سجل واحد، كلٌّ بقيده في الأستاذ العام نفسه</span>
        <button className="btn sm" onClick={() => exportExcel(rows.map((r: any) => ({ المصدر: SRC[r.src], الرقم: r.number, التاريخ: fmtDate(r.date), الطرف: r.party, البيان: r.memo, قبض: r.dir === "IN" ? Number(r.amount) : 0, صرف: r.dir === "OUT" ? Number(r.amount) : 0, الحساب: r.cashName, القيد: r.journalNumber, الحالة: DST[r.status] || r.status })), "سجل-السندات")}>⬇ Excel</button></div>
      <div className="card-b"><div className="toolbar">
        <SearchBox value={text} onChange={setText} placeholder="بحث بالرقم أو الطرف أو القيد" />
        <PeriodFilter from={f.from} to={f.to} onChange={(a, b) => setF({ from: a, to: b })} />
        <select className="input" style={{ width: 220 }} value={src} onChange={(e) => setSrc(e.target.value)}><option value="">كل المصادر</option><option value="ASSOC">سندات الجمعية</option><option value="CORE">سندات البرنامج المحاسبي</option>{Object.entries(SRC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="input" style={{ width: 120 }} value={dir} onChange={(e) => setDir(e.target.value)}><option value="">قبض وصرف</option><option value="IN">قبض</option><option value="OUT">صرف</option></select>
        <FilterInfo shown={rows.length} total={data?.rows?.length || 0} active={!!(src || dir || text)} onClear={() => { setSrc(""); setDir(""); setText(""); }} />
      </div></div>
      {loading && !data ? <Loading /> : !rows.length ? <Empty text="لا توجد سندات في الفترة" /> : <div className="table-wrap"><table className="tbl">
        <thead><tr><Th k="src" s={s}>المصدر</Th><Th k="number" s={s}>الرقم</Th><Th k="date" s={s}>التاريخ</Th><Th k="party" s={s}>الطرف / البيان</Th><th className="n">قبض</th><th className="n">صرف</th><th>الحساب</th><th>القيد</th><th /></tr></thead>
        <tbody>{s.sorted.map((r: any) => <tr key={r.src + r.id} style={r.status !== "POSTED" ? { opacity: .55 } : undefined}>
          <td><span className={"badge " + SRC_C[r.src]}>{SRC[r.src]}</span></td><td className="num">{r.number}</td><td className="dt">{fmtDate(r.date)}</td>
          <td><b>{r.party}</b>{r.memo && <div className="small muted">{r.memo}</div>}</td>
          <td className="n">{r.dir === "IN" ? <Money v={r.amount} /> : ""}</td><td className="n">{r.dir === "OUT" ? <Money v={r.amount} /> : ""}</td>
          <td className="small">{r.cashName}</td>
          <td>{r.journalId ? <Link to={`/charity/journals/${r.journalId}`}>{r.journalNumber}</Link> : "—"}</td>
          <td>{r.status !== "POSTED" ? <Badge s={r.status} map={DST} /> : r.ok ? <span title="القيد مرحّل ومبلغه على الصندوق/البنك يطابق السند" style={{ color: "var(--success-ink)" }}>✓</span> : <span className="badge red" title="لا قيد مرحّل أو مبلغه يخالف السند">⚠ راجِع</span>}</td>
        </tr>)}</tbody></table></div>}
    </div>
  </>;
}
