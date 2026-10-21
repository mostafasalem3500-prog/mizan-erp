/** Charity interface screens. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, q, useFetch, Money, money, Loading, Empty, Badge, Modal, Field, Input, Select, NumInput, Picker, accountFetcher, useAction, useToast, useCompanyContext, today, fmtDate, monthStart, yearStart, PeriodFilter, SearchBox, FilterInfo, useSorted, Th, matches, exportExcel, BarChart, useUrlSearch, confirmDlg, PdfBtn } from "../lib";
import { amountToArabicWords } from "../shared/tafqeet";
import { useCharity } from "./CharityApp";
import { CaseStudyModal, VerdictBadge } from "./pages4";
import { PrintModal, fromReceipt, fromDisb, fromRequest, printA4, donorCertData, DEFAULT_LOGO } from "./templates";
import { AlertsCard, waLink } from "./pages3";

// ─── labels ────────────────────────────────────────────────────────────────
export const SOURCE: Record<string, string> = { CASH_DONATION: "تبرع نقدي", SUPPORT: "دعم مالي / منحة", FOUNDING: "مساهمة تأسيسية", PROGRAM: "إيرادات برامج", ZAKAT: "زكاة", MEMBERSHIP: "اشتراك عضوية", SPONSORSHIP: "كفالة", REFUND: "استرداد مبلغ", OTHER: "أخرى", GENERAL: "سند قبض عام" };
export const METHOD: Record<string, string> = { CASH: "نقدي", TRANSFER: "تحويل بنكي", CHEQUE: "شيك", CARD: "شبكة / بطاقة", BANK: "تحويل بنكي" };
export const PAYER: Record<string, string> = { INDIVIDUAL: "فرد", ENTITY: "جهة مانحة", COMPANY: "شركة", OTHER: "أخرى" };
export const CAPACITY: Record<string, string> = { BENEFICIARY: "مستفيد", VOLUNTEER: "متطوع", EMPLOYEE: "موظف", SUPPLIER: "مورد", OTHER: "أخرى" };
export const KIND: Record<string, string> = { CASH: "نقدي", CHEQUE: "شيك", TRANSFER: "تحويل بنكي" };
export const REQ_ST: Record<string, string> = { DRAFT: "مسودة", SUBMITTED: "مقدَّم", REVIEWED: "تمت المراجعة المالية", APPROVED: "معتمد — بانتظار الصرف", REJECTED: "مرفوض", PAID: "تم الصرف" };
const REQ_COLOR: Record<string, string> = { DRAFT: "gray", SUBMITTED: "amber", REVIEWED: "blue", APPROVED: "teal", REJECTED: "red", PAID: "green" };
const DOC_ST: Record<string, string> = { POSTED: "مرحّل", CANCELLED: "ملغى", DRAFT: "مسودة" };
const PROJ_KIND: Record<string, string> = { PROGRAM: "برنامج", PROJECT: "مشروع", CAMPAIGN: "حملة", ENDOWMENT: "وقف" };
const ATTACH = ["عرض سعر", "فاتورة", "عقد / اتفاقية", "قرار / محضر اعتماد", "صورة هوية المستفيد", "دراسة حالة", "أخرى"];
const REVIEW = ["توفر الاعتماد في الموازنة", "اكتمال المستندات", "صحة التوجيه المحاسبي", "ضمن حدود الصلاحيات"];
const DOCS = ["طلب صرف معتمد", "فاتورة / إيصال", "عقد", "صورة الهوية", "شهادة الآيبان", "كشف حضور / تكليف", "أخرى"];

const donorFetcher = (s: string) => api(`/charity/donors${q({ q: s, limit: 20 })}`);
const benefFetcher = (s: string) => api(`/charity/beneficiaries${q({ q: s, limit: 20 })}`);
const cashFetcher = accountFetcher((a) => a.isCashBank);
const expFetcher = accountFetcher((a) => a.type === "EXPENSE");
const revFetcher = accountFetcher((a) => a.type === "REVENUE");
const acLabel = (a: any) => `${a.code} — ${a.nameAr}`;
const words = (v: any) => (Number(v) > 0 ? amountToArabicWords(Number(v)) : "");
const useQ = () => new URLSearchParams(useLocation().search);

function ProjectSelect({ value, onChange, all }: { value: string; onChange: (v: string) => void; all?: string }) {
  const { projects } = useCharity();
  return <Select value={value || ""} onChange={(e) => onChange(e.target.value)}><option value="">{all || "— بدون مشروع —"}</option>{projects.map((p: any) => <option key={p.id} value={p.id}>{p.code} — {p.name}{p.status === "CLOSED" ? " (مغلق)" : ""}</option>)}</Select>;
}
function MapSelect({ map, value, onChange, all, style }: { map: Record<string, string>; value: string; onChange: (v: string) => void; all?: string; style?: any }) {
  return <Select value={value} onChange={(e) => onChange(e.target.value)} style={style}>{all !== undefined && <option value="">{all}</option>}{Object.entries(map).filter(([k]) => k !== "GENERAL" && k !== "BANK").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>;
}
function Checks({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return <div className="row" style={{ gap: 10 }}>{options.map((o) => <label key={o} className="row" style={{ gap: 4 }}><input type="checkbox" checked={value.includes(o)} onChange={(e) => onChange(e.target.checked ? [...value, o] : value.filter((x) => x !== o))} />{o}</label>)}</div>;
}
function Kpi({ label, v, icon, cls, sub, money: m = true }: { label: string; v: any; icon: string; cls?: string; sub?: React.ReactNode; money?: boolean }) {
  return <div className={"card kpi " + (cls || "")}><span className="label">{label}</span><span className="value">{m ? <Money v={v} /> : <span className="num">{v}</span>}</span>{sub && <span className="sub">{sub}</span>}<span className="icon">{icon}</span></div>;
}
function Bars({ rows, label, total, gold }: { rows: any[]; label: (r: any) => string; total?: number; gold?: boolean }) {
  const max = Math.max(1, total || 0, ...rows.map((r) => Number(r.amount)));
  if (!rows.length) return <Empty />;
  return <div>{rows.map((r, i) => <div key={i} className="ch-bar"><span className="lbl">{label(r)}</span><div className="trk"><div className={gold ? "gold" : ""} style={{ width: `${(Number(r.amount) / max) * 100}%` }} /></div><span className="v"><Money v={r.amount} /></span></div>)}</div>;
}

// ─── dashboard ─────────────────────────────────────────────────────────────
export function CharityDashboard() {
  const { settings } = useCharity();
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const { data, loading } = useFetch(`/charity/dashboard${q({ from, to })}`);
  const k = data?.kpis;
  const quick = [
    { to: "/charity/receipts?new=1", ic: "💚", t: "سند قبض / تبرع", s: "تسجيل تبرع أو دعم" },
    { to: "/charity/expenses?new=1", ic: "💸", t: "سند صرف", s: "نقدي أو شيك أو تحويل" },
    { to: "/charity/requests?new=1", ic: "📋", t: "طلب صرف", s: "FIN-001" },
    { to: "/charity/batches", ic: "🧾", t: "مسير المصروفات", s: "صرف جماعي للمستفيدين" },
    { to: "/charity/custody", ic: "💼", t: "العهد المالية", s: "طلب، صرف، تسوية" },
    { to: "/charity/sponsorships", ic: "🤲", t: "الكفالات", s: "تحصيل الأقساط" },
    { to: "/charity/inkind", ic: "📦", t: "تبرع عيني", s: "استلام وتوزيع" },
    { to: "/charity/purchases", ic: "🛍", t: "طلب شراء", s: "ومحضر استلام" },
    { to: "/charity/daily", ic: "📥", t: "تحصيل اليوم", s: "إقفال الصندوق اليومي" },
    { to: "/charity/blank-forms", ic: "📄", t: "نماذج فارغة", s: "طباعة للتعبئة اليدوية" },
    { to: "/charity/templates", ic: "🖨", t: "القوالب A4", s: "تخصيص النماذج" },
  ];
  return (
    <div>
      <div className="ch-hero">
        <div className="ch-hero-id"><img src={settings?.logoUrl || DEFAULT_LOGO} alt="" /><div>
          <h2>{settings?.associationName}</h2>
          <div className="muted">{settings?.licenseNo ? `ترخيص رقم ${settings.licenseNo}` : "أضف رقم الترخيص من إعدادات الجمعية"} · مؤشرات الفترة من {from} إلى {to}</div>
        </div></div>
        <div className="row"><PeriodFilter from={from} to={to} onChange={(f, t) => { setFrom(f || yearStart()); setTo(t || today()); }} /></div>
      </div>
      <div className="ch-quick">{quick.map((x) => <Link key={x.to} to={x.to}><span className="ic">{x.ic}</span><b>{x.t}</b><small>{x.s}</small></Link>)}</div>
      <AlertsCard />
      {loading && !data ? <Loading /> : data && <>
        <div className="grid c4">
          <Kpi label="إجمالي المقبوضات (التبرعات والدعم)" v={k.received} icon="💚" sub={<>{k.receiptsCount} سند · اليوم <Money v={k.todayIn} /></>} />
          <Kpi label="إجمالي المصروفات والمساعدات" v={k.spent} icon="💸" cls="accent" sub={<>{k.disbCount} سند صرف</>} />
          <Kpi label="صافي الفائض / (العجز)" v={k.net} icon="⚖" cls={Number(k.net) < 0 ? "danger" : "success"} />
          <Kpi label="النقدية بالصناديق والبنوك" v={data.cashTotal} icon="🏦" cls="info" sub={`${data.cash.length} حساب`} />
          <Kpi label="المتبرعون" v={k.donors} money={false} icon="🤝" sub={<>مقبوضات الشهر <Money v={k.monthIn} /></>} />
          <Kpi label="المستفيدون (خُدموا في الفترة)" v={`${k.served} / ${k.beneficiaries}`} money={false} icon="👪" cls="success" />
          <Kpi label="طلبات صرف بانتظار القرار" v={k.pendingRequests} money={false} icon="📋" cls={k.pendingRequests ? "accent" : ""} sub={<><Money v={k.pendingAmount} /> · {k.approvedUnpaid} معتمد بانتظار الصرف</>} />
          <Kpi label="العهد المالية القائمة" v={k.custodyOpen} icon="💼" cls={k.custodyOverdue ? "danger" : ""} sub={<>{k.custodyCount} عهدة{k.custodyOverdue ? ` · ${k.custodyOverdue} متأخرة التسوية` : ""}{k.custodyPending ? ` · ${k.custodyPending} طلب جديد` : ""}</>} />
          <Kpi label="طلبات شراء بانتظار الاعتماد" v={k.purchasesPending} money={false} icon="🛍" cls={k.purchasesPending ? "accent" : ""} sub={`${k.purchasesOpen} معتمد بانتظار الاستلام`} />
          <Kpi label="طلبات استرداد مفتوحة" v={k.refundsPending} money={false} icon="↩" cls={k.refundsPending ? "accent" : ""} />
          <Kpi label="الكفالات النشطة" v={k.sponsorshipsActive} money={false} icon="🤲" sub={<>التزام شهري <Money v={k.sponsorshipsMonthly} /></>} />
          <Kpi label="مخزون التبرعات العينية" v={k.inkindValue} icon="📦" cls="info" sub={<>وُزّع في الفترة <Money v={k.inkindDistributed} /></>} />
          <Kpi label="ساعات التطوع في الفترة" v={Number(k.volunteerHours).toLocaleString("en-US")} money={false} icon="🙋" cls="success" sub={`${k.volunteers} متطوع نشط`} />
          <Kpi label="المشاريع والبرامج النشطة" v={k.activeProjects} money={false} icon="🎯" cls="info" sub={<>موازنة المصروفات <Money v={data.budget.expense.budget} /> · المنفذ <Money v={data.budget.expense.actual} /></>} />
        </div>
        <div className="grid c2 mt">
          <div className="card"><div className="card-h"><h3>المقبوضات والمصروفات — آخر 12 شهراً</h3><span className="small muted"><span style={{ color: "var(--primary)" }}>■</span> مقبوضات <span style={{ color: "var(--accent)" }}>■</span> مصروفات</span></div><div className="card-b"><BarChart data={data.months} keys={["received", "spent"]} labels={(d) => d.ym.slice(5)} /></div></div>
          <div className="card"><div className="card-h"><h3>المقبوضات حسب المصدر</h3></div><div className="card-b"><Bars rows={data.bySource} label={(r) => SOURCE[r.k] || r.k} /><h4 className="mt" style={{ marginBottom: 6 }}>حسب طريقة الاستلام</h4><Bars rows={data.byMethod} label={(r) => METHOD[r.k] || r.k} gold /></div></div>
          <div className="card"><div className="card-h"><h3>المشاريع والبرامج</h3><Link className="btn sm" to="/charity/projects">الكل</Link></div><div className="card-b">{!data.projects.length ? <Empty text="لا توجد مشاريع — أضف مشروعاً لتتبع التبرعات المقيدة" /> : data.projects.map((p: any) => { const pct = Number(p.target) ? Math.min(100, (Number(p.received) / Number(p.target)) * 100) : 0; return <div key={p.id} style={{ marginBottom: 10 }}><div className="row between"><b>{p.name}</b><span className="small muted">مقبوض <Money v={p.received} /> · مصروف <Money v={p.spent} /></span></div>{Number(p.target) > 0 && <><div className="progress"><div style={{ width: pct + "%" }} /></div><div className="small muted">{pct.toFixed(0)}% من المستهدف <Money v={p.target} /></div></>}</div>; })}</div></div>
          <div className="card"><div className="card-h"><h3>المصروفات حسب صفة المستلم</h3></div><div className="card-b"><Bars rows={data.byCapacity} label={(r) => `${CAPACITY[r.k] || r.k} (${r.count})`} gold /></div></div>
          <div className="card"><div className="card-h"><h3>أكبر المتبرعين</h3><Link className="btn sm" to="/charity/donors">المتبرعون</Link></div><div className="table-wrap"><table className="tbl compact"><tbody>{data.topDonors.map((d: any, i: number) => <tr key={i}><td>{d.name}</td><td className="n muted">{d.count} سند</td><td className="n"><b><Money v={d.amount} /></b></td></tr>)}</tbody></table>{!data.topDonors.length && <Empty />}</div></div>
          <div className="card"><div className="card-h"><h3>طلبات الصرف المفتوحة</h3><Link className="btn sm" to="/charity/requests">الطلبات</Link></div><div className="table-wrap"><table className="tbl compact"><tbody>{data.pending.map((r: any) => <tr key={r.id}><td className="num">{r.number}</td><td>{r.beneficiaryName}<div className="small muted">{r.purpose}</div></td><td><span className={"badge " + REQ_COLOR[r.status]}>{REQ_ST[r.status]}</span></td><td className="n"><Money v={r.amount} /></td></tr>)}</tbody></table>{!data.pending.length && <Empty text="لا توجد طلبات معلقة" />}</div></div>
          <div className="card"><div className="card-h"><h3>أرصدة الصناديق والبنوك</h3></div><div className="table-wrap"><table className="tbl compact"><tbody>{data.cash.map((c: any) => <tr key={c.id}><td className="num muted">{c.code}</td><td>{c.nameAr}</td><td className="n"><Money v={c.balance} sign /></td></tr>)}</tbody></table></div></div>
          <div className="card"><div className="card-h"><h3>تنفيذ الموازنة التقديرية {to.slice(0, 4)}</h3><Link className="btn sm" to="/charity/budget">الموازنة</Link></div><div className="card-b">
            {[["الإيرادات", data.budget.revenue], ["المصروفات", data.budget.expense]].map(([l, b]: any) => { const pct = b.budget ? Math.min(100, (b.actual / b.budget) * 100) : 0; return <div key={l} style={{ marginBottom: 12 }}><div className="row between"><b>{l}</b><span className="small">الفعلي <Money v={b.actual} /> من <Money v={b.budget} /></span></div><div className="progress"><div style={{ width: pct + "%", background: pct > 95 && l === "المصروفات" ? "var(--danger)" : undefined }} /></div></div>; })}
            {!data.budget.expense.budget && !data.budget.revenue.budget && <div className="small muted">لم تُعد موازنة تقديرية لهذه السنة بعد.</div>}
          </div></div>
        </div>
      </>}
    </div>
  );
}

// ─── receipts (سندات القبض) ─────────────────────────────────────────────────
export function ReceiptsPage() {
  const { can } = useCompanyContext();
  const { settings } = useCharity();
  const qs = useQ();
  const nav = useNavigate();
  const [text, setText] = useUrlSearch();
  const [f, setF] = useState({ from: "", to: "", source: "", method: "", projectId: "", status: "" });
  const { data, loading, reload } = useFetch<any[]>(`/charity/receipts${q(f)}`);
  const [add, setAdd] = useState(qs.get("new") === "1");
  const [pr, setPr] = useState<any>(null);
  const { run, busy } = useAction();
  useEffect(() => { if (qs.get("new") === "1") setAdd(true); }, [qs.get("new")]);
  const rows = useMemo(() => (data || []).filter((r) => matches(r, text, ["number", "payerName", "purpose", "refNo", "projectName", "payerIdNo"])), [data, text]);
  const s = useSorted(rows);
  const active = (r: any) => r.status === "POSTED";
  const total = rows.filter(active).reduce((a, r) => a + Number(r.amount), 0);
  const anyF = !!(text || Object.values(f).some(Boolean));
  return (
    <div className="card">
      <div className="card-h">
        <h3>سندات القبض والتبرعات</h3>
        <div className="row">
          <button className="btn sm" onClick={() => exportExcel(rows.map((r) => ({ الرقم: r.number, التاريخ: fmtDate(r.date), الدافع: r.payerName, الصفة: PAYER[r.payerType], المصدر: SOURCE[r.source], الغرض: r.purpose, المشروع: r.projectName, الطريقة: METHOD[r.method], المرجع: r.refNo, المبلغ: Number(r.amount), الحالة: DOC_ST[r.status] })), "سندات-القبض")}>⬇ Excel</button>
          <button className="btn sm" onClick={() => setPr({ blank: true })}>🖨 نموذج فارغ</button>
          {can("payments.write") && <button className="btn primary" onClick={() => setAdd(true)}>＋ سند قبض جديد</button>}
        </div>
      </div>
      <div className="card-b">
        <div className="toolbar">
          <SearchBox value={text} onChange={setText} placeholder="بحث بالرقم أو الاسم أو المرجع" />
          <PeriodFilter from={f.from} to={f.to} onChange={(a, b) => setF({ ...f, from: a, to: b })} />
          <MapSelect map={SOURCE} value={f.source} onChange={(v) => setF({ ...f, source: v })} all="كل المصادر" />
          <MapSelect map={METHOD} value={f.method} onChange={(v) => setF({ ...f, method: v })} all="كل الطرق" />
          <div style={{ width: 200 }}><ProjectSelect value={f.projectId} onChange={(v) => setF({ ...f, projectId: v })} all="كل المشاريع" /></div>
          <MapSelect map={DOC_ST} value={f.status} onChange={(v) => setF({ ...f, status: v })} all="كل الحالات" />
          <FilterInfo shown={rows.length} total={data?.length || 0} active={anyF} onClear={() => { setText(""); setF({ from: "", to: "", source: "", method: "", projectId: "", status: "" }); }} />
          <div className="grow" /><b>الإجمالي: <Money v={total} /></b>
        </div>
      </div>
      {loading && !data ? <Loading /> : !rows.length ? <Empty text="لا توجد سندات قبض" /> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><Th k="number" s={s}>الرقم</Th><Th k="date" s={s}>التاريخ</Th><Th k="payerName" s={s}>الدافع / المتبرع</Th><Th k="source" s={s}>المصدر</Th><Th k="projectName" s={s}>المشروع</Th><Th k="method" s={s}>الطريقة</Th><Th k="amount" s={s} n>المبلغ</Th><th>الحالة</th><th /></tr></thead>
          <tbody>{s.sorted.map((r: any) => (
            <tr key={r.id} style={r.status === "CANCELLED" ? { opacity: .55 } : undefined}>
              <td className="num">{r.number}</td><td className="dt">{fmtDate(r.date)}</td>
              <td><b>{r.payerName}</b><div className="small muted">{PAYER[r.payerType]}{r.purpose ? " · " + r.purpose : ""}</div></td>
              <td>{SOURCE[r.source]}{r.restricted && <span className="badge amber" style={{ marginInlineStart: 4 }}>مقيد</span>}</td>
              <td>{r.projectName || <span className="muted">—</span>}</td>
              <td>{METHOD[r.method]}<div className="small muted">{r.cashAccountName}{r.refNo ? " · " + r.refNo : ""}</div></td>
              <td className="n"><b><Money v={r.amount} /></b></td>
              <td><Badge s={r.status} map={DOC_ST} /></td>
              <td className="row" style={{ gap: 4 }}>
                <button className="btn sm" onClick={() => setPr(r)}>🖨 طباعة</button>
                {r.payerPhone && r.status === "POSTED" && <a className="btn sm" target="_blank" rel="noreferrer" title="إرسال شكر وإشعار بالسند عبر واتساب" href={waLink(r.payerPhone, `السلام عليكم ${r.payerName}،\nتشكر ${settings?.associationName || "الجمعية"} دعمكم الكريم.\nتم استلام مبلغ ${money(r.amount)} ريال (${SOURCE[r.source]}${r.purpose ? " — " + r.purpose : ""}) بموجب السند رقم ${r.number} بتاريخ ${fmtDate(r.date)}.\nجزاكم الله خيراً وجعله في موازين حسناتكم.`)}>واتساب</a>}
                {can("payments.write") && r.status === "POSTED" && <button className="btn sm ghost" disabled={busy} onClick={() => { const why = window.prompt(`سبب إلغاء السند ${r.number}؟ (سيُعكس القيد)`); if (why !== null) run(async () => { await api(`/charity/receipts/${r.id}/cancel`, { body: { reason: why } }); reload(); }, "تم الإلغاء وعكس القيد"); }}>إلغاء</button>}
              </td>
            </tr>))}
          </tbody>
        </table></div>
      )}
      {add && <ReceiptModal onClose={(saved) => { setAdd(false); if (qs.get("new")) nav("/charity/receipts", { replace: true }); if (saved) { reload(); setPr(saved); } }} />}
      {pr && <PrintModal tplKey="receipt" choices={["receipt", "ack"]} data={pr.blank ? {} : fromReceipt(pr)} settings={settings} onClose={() => setPr(null)} />}
    </div>
  );
}

function ReceiptModal({ onClose }: { onClose: (saved?: any) => void }) {
  const { projects } = useCharity();
  const { run, busy } = useAction();
  const [donor, setDonor] = useState<any>(null);
  const [cash, setCash] = useState<any>(null);
  const [rev, setRev] = useState<any>(null);
  const [adv, setAdv] = useState(false);
  const [quick, setQuick] = useState(false);
  const [f, setF] = useState<any>({ date: today(), payerName: "", payerIdNo: "", payerPhone: "", payerType: "INDIVIDUAL", source: "CASH_DONATION", purpose: "", projectId: "", restricted: false, amount: "", method: "CASH", bankName: "", refNo: "", depositDate: "", notes: "" });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e?.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e });
  const pickDonor = (d: any) => { setDonor(d); if (d) setF({ ...f, payerName: d.name, payerIdNo: d.idNumber || d.crNumber || "", payerPhone: d.phone || "", payerType: d.donorType || "INDIVIDUAL" }); };
  const proj = projects.find((p: any) => p.id === f.projectId);
  const save = () => run(async () => { const r = await api("/charity/receipts", { body: { ...f, partnerId: donor?.id, cashAccountId: cash?.id, revenueAccountId: adv ? rev?.id : undefined } }); onClose({ ...r, projectName: proj?.name }); }, "تم حفظ السند وترحيل القيد");
  return (
    <Modal title="سند قبض مالي — تبرع / دعم" onClose={() => onClose()} wide footer={<><button className="btn primary" disabled={busy} onClick={save}>حفظ وترحيل</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <div className="grid c3">
        <Field label="المتبرع (من سجل المتبرعين)" span2><Picker value={donor} onChange={pickDonor} fetcher={donorFetcher} label={(d: any) => `${d.code} — ${d.name}`} placeholder="ابحث باسم المتبرع أو اتركه فارغاً" onCreate={() => setQuick(true)} /></Field>
        <Field label="التاريخ"><Input type="date" value={f.date} onChange={set("date")} /></Field>
        <Field label="استلمنا من (اسم الدافع)"><Input value={f.payerName} onChange={set("payerName")} /></Field>
        <Field label="رقم الهوية / السجل"><Input value={f.payerIdNo} onChange={set("payerIdNo")} dir="ltr" /></Field>
        <Field label="صفة الدافع"><MapSelect map={PAYER} value={f.payerType} onChange={set("payerType")} /></Field>
        <Field label="مصدر المبلغ"><MapSelect map={SOURCE} value={f.source} onChange={set("source")} /></Field>
        <Field label="المشروع / البرنامج"><ProjectSelect value={f.projectId} onChange={set("projectId")} /></Field>
        <Field label="الجوال"><Input value={f.payerPhone} onChange={set("payerPhone")} dir="ltr" /></Field>
        <Field label="الغرض / وذلك عن" span2><Input value={f.purpose} onChange={set("purpose")} /></Field>
        <Field label=" "><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.restricted || !!proj?.restricted} disabled={!!proj?.restricted} onChange={set("restricted")} />تبرع مقيد بغرض محدد</label></Field>
        <Field label="المبلغ (ريال)"><NumInput value={f.amount} onChange={set("amount")} /></Field>
        <Field label="المبلغ كتابةً" span2><div className="input" style={{ background: "var(--surface-2)", minHeight: 36 }}>{words(f.amount)}</div></Field>
        <Field label="طريقة الاستلام"><MapSelect map={METHOD} value={f.method} onChange={set("method")} /></Field>
        <Field label="إلى حساب (الصندوق / البنك)" hint="فارغ = الصندوق الرئيسي للنقدي والبنك الافتراضي لغيره"><Picker value={cash} onChange={setCash} fetcher={cashFetcher} label={acLabel} /></Field>
        {f.method !== "CASH" ? <Field label="رقم الحوالة / الشيك / المرجع"><Input value={f.refNo} onChange={set("refNo")} dir="ltr" /></Field> : <div />}
        {f.method !== "CASH" && <><Field label="البنك"><Input value={f.bankName} onChange={set("bankName")} /></Field><Field label="تاريخ الإيداع"><Input type="date" value={f.depositDate} onChange={set("depositDate")} /></Field><div /></>}
        <Field label="ملاحظات" span2><Input value={f.notes} onChange={set("notes")} /></Field>
        <Field label=" "><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={adv} onChange={(e) => setAdv(e.target.checked)} />تحديد حساب الإيراد يدوياً</label></Field>
        {adv && <Field label="حساب الإيراد" span3><Picker value={rev} onChange={setRev} fetcher={revFetcher} label={acLabel} /></Field>}
      </div>
      <div className="alert info mt small">القيد الآلي: من ح/ {cash ? cash.nameAr : f.method === "CASH" ? "الصندوق الرئيسي" : "البنك"} — إلى ح/ {adv && rev ? rev.nameAr : f.restricted || proj?.restricted ? "تبرعات مقيدة لمشاريع" : SOURCE[f.source]}{proj ? ` (مركز تكلفة: ${proj.name})` : ""}</div>
      {quick && <PersonModal role="DONOR" onClose={(p) => { setQuick(false); if (p) pickDonor(p); }} />}
    </Modal>
  );
}

// ─── disbursements (المصروفات / سندات الصرف) ────────────────────────────────
const ZK_CAT: Record<string, string> = { FUQARA: "الفقراء", MASAKIN: "المساكين", AMILIN: "العاملين عليها", MUALLAFA: "المؤلفة قلوبهم", RIQAB: "في الرقاب", GHARIMIN: "الغارمين", FISABILILLAH: "في سبيل الله", IBN_SABIL: "ابن السبيل" };
export function DisbursementsPage() {
  const { can } = useCompanyContext();
  const { settings } = useCharity();
  const qs = useQ();
  const nav = useNavigate();
  const [text, setText] = useUrlSearch();
  const [f, setF] = useState({ from: "", to: "", kind: "", capacity: "", projectId: "", status: "" });
  const { data, loading, reload } = useFetch<any[]>(`/charity/disbursements${q(f)}`);
  const [add, setAdd] = useState<any>(qs.get("new") === "1" || qs.get("request") ? { requestId: qs.get("request") } : null);
  const [pr, setPr] = useState<any>(null);
  const { run, busy } = useAction();
  useEffect(() => { if (qs.get("new") === "1" || qs.get("request")) setAdd({ requestId: qs.get("request") }); }, [qs.get("new"), qs.get("request")]);
  const rows = useMemo(() => (data || []).filter((r) => matches(r, text, ["number", "beneficiaryName", "reason", "refNo", "projectName", "requestNumber", "batchNumber", "iban"])), [data, text]);
  const s = useSorted(rows);
  const total = rows.filter((r) => r.status === "POSTED").reduce((a, r) => a + Number(r.amount), 0);
  const anyF = !!(text || Object.values(f).some(Boolean));
  return (
    <div className="card">
      <div className="card-h">
        <h3>المصروفات — سندات الصرف</h3>
        <div className="row">
          <button className="btn sm" onClick={() => exportExcel(rows.map((r) => ({ الرقم: r.number, التاريخ: fmtDate(r.date), النوع: KIND[r.kind], المستلم: r.beneficiaryName, الصفة: CAPACITY[r.capacity], السبب: r.reason, المشروع: r.projectName, "حساب المصروف": r.expenseAccountName, "من حساب": r.payAccountName, المرجع: r.refNo, الآيبان: r.iban, المبلغ: Number(r.amount), "طلب الصرف": r.requestNumber, المسير: r.batchNumber, الحالة: DOC_ST[r.status] })), "سندات-الصرف")}>⬇ Excel</button>
          <button className="btn sm" onClick={() => setPr({ blank: true, kind: "CASH" })}>🖨 نموذج فارغ</button>
          {can("payments.write") && <button className="btn primary" onClick={() => setAdd({})}>＋ سند صرف جديد</button>}
        </div>
      </div>
      <div className="card-b">
        <div className="toolbar">
          <SearchBox value={text} onChange={setText} placeholder="بحث بالرقم أو المستلم أو المرجع" />
          <PeriodFilter from={f.from} to={f.to} onChange={(a, b) => setF({ ...f, from: a, to: b })} />
          <MapSelect map={KIND} value={f.kind} onChange={(v) => setF({ ...f, kind: v })} all="كل الأنواع" />
          <MapSelect map={CAPACITY} value={f.capacity} onChange={(v) => setF({ ...f, capacity: v })} all="كل الصفات" />
          <div style={{ width: 200 }}><ProjectSelect value={f.projectId} onChange={(v) => setF({ ...f, projectId: v })} all="كل المشاريع" /></div>
          <MapSelect map={DOC_ST} value={f.status} onChange={(v) => setF({ ...f, status: v })} all="كل الحالات" />
          <FilterInfo shown={rows.length} total={data?.length || 0} active={anyF} onClear={() => { setText(""); setF({ from: "", to: "", kind: "", capacity: "", projectId: "", status: "" }); }} />
          <div className="grow" /><b>الإجمالي: <Money v={total} /></b>
        </div>
      </div>
      {loading && !data ? <Loading /> : !rows.length ? <Empty text="لا توجد سندات صرف" /> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><Th k="number" s={s}>الرقم</Th><Th k="date" s={s}>التاريخ</Th><Th k="beneficiaryName" s={s}>المستلم</Th><Th k="reason" s={s}>السبب</Th><Th k="projectName" s={s}>المشروع</Th><Th k="kind" s={s}>النوع</Th><Th k="amount" s={s} n>المبلغ</Th><th>الحالة</th><th /></tr></thead>
          <tbody>{s.sorted.map((r: any) => (
            <tr key={r.id} style={r.status === "CANCELLED" ? { opacity: .55 } : undefined}>
              <td className="num">{r.number}{(r.requestNumber || r.batchNumber) && <div className="small muted num">{r.requestNumber || r.batchNumber}</div>}</td><td className="dt">{fmtDate(r.date)}</td>
              <td><b>{r.beneficiaryName}</b><div className="small muted">{CAPACITY[r.capacity]}{r.beneficiaryIdNo ? " · " + r.beneficiaryIdNo : ""}</div>{r.fund === "ZAKAT" && <span className="badge" style={{ background: "#e8eef9", color: "#1c3f8a" }}>زكاة: {ZK_CAT[r.zakatCategory] || "—"}</span>}</td>
              <td>{r.reason}<div className="small muted">{r.expenseAccountName}</div></td>
              <td>{r.projectName || <span className="muted">—</span>}</td>
              <td>{KIND[r.kind]}<div className="small muted">{r.payAccountName}{r.refNo ? " · " + r.refNo : ""}</div></td>
              <td className="n"><b><Money v={r.amount} /></b></td>
              <td><Badge s={r.status} map={DOC_ST} /></td>
              <td className="row" style={{ gap: 4 }}>
                <button className="btn sm" onClick={() => setPr(r)}>🖨 طباعة</button>
                {can("payments.write") && r.status === "POSTED" && <button className="btn sm ghost" disabled={busy} onClick={() => { const why = window.prompt(`سبب إلغاء السند ${r.number}؟ (سيُعكس القيد)`); if (why !== null) run(async () => { await api(`/charity/disbursements/${r.id}/cancel`, { body: { reason: why } }); reload(); }, "تم الإلغاء وعكس القيد"); }}>إلغاء</button>}
              </td>
            </tr>))}
          </tbody>
        </table></div>
      )}
      {add && <DisbModal init={add} onClose={(saved) => { setAdd(null); if (qs.get("new") || qs.get("request")) nav("/charity/expenses", { replace: true }); if (saved) { reload(); setPr(saved); } }} />}
      {pr && <PrintModal tplKey={pr.capacity === "VOLUNTEER" ? "volunteer" : pr.kind === "CASH" ? "cash" : "voucher"} choices={pr.blank ? ["cash", "voucher", "cheque", "volunteer"] : [...(pr.kind === "CASH" ? ["cash", "voucher"] : ["voucher", "cheque"]), ...(pr.capacity === "VOLUNTEER" ? ["volunteer"] : [])]} data={pr.blank ? {} : fromDisb(pr)} settings={settings} onClose={() => setPr(null)} />}
    </div>
  );
}

function DisbModal({ init, onClose }: { init: any; onClose: (saved?: any) => void }) {
  const { projects } = useCharity();
  const { run, busy } = useAction();
  const reqs = useFetch<any[]>("/charity/requests?status=APPROVED");
  const [benef, setBenef] = useState<any>(null);
  const [exp, setExp] = useState<any>(null);
  const [pay, setPay] = useState<any>(null);
  const [quick, setQuick] = useState(false);
  const [f, setF] = useState<any>({ date: today(), kind: "CASH", capacity: "BENEFICIARY", beneficiaryName: "", beneficiaryIdNo: "", beneficiaryPhone: "", department: "", amount: "", reason: "", projectId: "", budgetLine: "", requestId: init?.requestId || "", bankName: "", accountHolder: "", iban: "", refNo: "", execDate: "", docs: [] as string[], notes: "", programName: "", periodFrom: "", periodTo: "" });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const pickBenef = (b: any) => { setBenef(b); if (b) setF({ ...f, beneficiaryName: b.name, beneficiaryIdNo: b.idNumber || b.crNumber || "", beneficiaryPhone: b.phone || "", iban: b.beneficiaryInfo?.iban || f.iban, bankName: b.beneficiaryInfo?.bankName || f.bankName, accountHolder: b.name }); };
  const applyReq = (id: string, list = reqs.data) => {
    const r = (list || []).find((x: any) => x.id === id);
    if (!r) return setF((x: any) => ({ ...x, requestId: id }));
    setF((x: any) => ({ ...x, requestId: id, beneficiaryName: r.beneficiaryName, beneficiaryIdNo: r.beneficiaryIdNo || "", amount: r.amount, reason: r.purpose, projectId: r.projectId || "", budgetLine: r.budgetLine || "", kind: r.method === "CASH" ? "CASH" : r.method === "CHEQUE" ? "CHEQUE" : "TRANSFER", department: r.department || "", docs: ["طلب صرف معتمد"] }));
    if (r.expenseAccountId) setExp({ id: r.expenseAccountId, code: "", nameAr: r.expenseAccountName });
    if (r.partnerId) setBenef({ id: r.partnerId, code: "", name: r.beneficiaryName });
  };
  useEffect(() => { if (init?.requestId && reqs.data) applyReq(init.requestId, reqs.data); }, [reqs.data]);
  const proj = projects.find((p: any) => p.id === f.projectId);
  // zakat fund (Round 23): the eight Sharia categories, available balance, beneficiary eligibility & aid history
  const zmeta = useFetch<any>("/charity/zakat/meta");
  const hist = useFetch<any>(benef?.id ? `/charity/beneficiaries/${benef.id}/aid-history` : null);
  const cs = hist.data?.caseStudy;
  const needOverride = f.fund === "ZAKAT" && ["FUQARA", "MASAKIN"].includes(f.zakatCategory) && benef && zmeta.data?.policy?.requireCaseForZakat && (!cs || !cs.zakatEligible || (cs.validUntil && String(cs.validUntil).slice(0, 10) < f.date));
  const save = () => run(async () => { const r = await api("/charity/disbursements", { body: { ...f, requestId: f.requestId || undefined, partnerId: benef?.id, expenseAccountId: exp?.id, payAccountId: pay?.id } }); const req = reqs.data?.find((x: any) => x.id === f.requestId); onClose({ ...r, projectName: proj?.name, expenseAccountName: exp?.nameAr, payAccountName: pay?.nameAr, requestNumber: req?.number }); }, "تم حفظ سند الصرف وترحيل القيد");
  return (
    <Modal title="سند صرف — نقدي / شيك / تحويل بنكي" onClose={() => onClose()} wide footer={<><button className="btn primary" disabled={busy} onClick={save}>حفظ وترحيل</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <div className="grid c3">
        <Field label="نوع الصرف"><div className="row" style={{ gap: 6 }}>{Object.entries(KIND).map(([k, v]) => <button key={k} type="button" className={"btn sm" + (f.kind === k ? " primary" : "")} onClick={() => setF({ ...f, kind: k })}>{v}</button>)}</div></Field>
        <Field label="طلب صرف معتمد (اختياري)"><Select value={f.requestId} onChange={(e) => applyReq(e.target.value)}><option value="">— بدون طلب —</option>{(reqs.data || []).map((r: any) => <option key={r.id} value={r.id}>{r.number} — {r.beneficiaryName} — {money(r.amount)}</option>)}</Select></Field>
        <Field label="التاريخ"><Input type="date" value={f.date} onChange={set("date")} /></Field>
        <Field label="المستفيد (من سجل المستفيدين)" span2><Picker value={benef} onChange={pickBenef} fetcher={benefFetcher} label={(b: any) => `${b.code ? b.code + " — " : ""}${b.name}`} placeholder="ابحث في المستفيدين أو اكتب الاسم يدوياً بالأسفل" onCreate={() => setQuick(true)} /></Field>
        <Field label="الصفة"><MapSelect map={CAPACITY} value={f.capacity} onChange={set("capacity")} /></Field>
        <Field label="اسم المستلم / المستفيد"><Input value={f.beneficiaryName} onChange={set("beneficiaryName")} /></Field>
        <Field label="رقم الهوية / السجل"><Input value={f.beneficiaryIdNo} onChange={set("beneficiaryIdNo")} dir="ltr" /></Field>
        <Field label="الجوال"><Input value={f.beneficiaryPhone} onChange={set("beneficiaryPhone")} dir="ltr" /></Field>
        {f.capacity === "VOLUNTEER" && <>
          <Field label="البرنامج / المبادرة التطوعية"><Input value={f.programName} onChange={set("programName")} /></Field>
          <Field label="الفترة التطوعية من"><Input type="date" value={f.periodFrom} onChange={set("periodFrom")} /></Field>
          <Field label="إلى"><Input type="date" value={f.periodTo} onChange={set("periodTo")} /></Field>
          <div className="alert warn small" style={{ gridColumn: "1 / -1", margin: 0 }}>الأصل في التطوع أنه دون مقابل؛ وضّح في السبب طبيعة المبلغ (بدل مصروفات فعلية / تعويض معتمد / مكافأة مصرح بها). يُطبع له «إقرار استلام مستحقات متطوع».</div>
        </>}
        <Field label="يُصرف من صندوق"><Select value={f.fund || "GENERAL"} onChange={(e) => setF({ ...f, fund: e.target.value, zakatCategory: e.target.value === "ZAKAT" ? f.zakatCategory || "FUQARA" : "" })}><option value="GENERAL">الصندوق العام (التبرعات)</option><option value="ZAKAT">صندوق الزكاة — المتاح {money(zmeta.data?.fund?.available || 0)}</option></Select></Field>
        {f.fund === "ZAKAT" && <Field label="مصرف الزكاة (الأصناف الثمانية)"><Select value={f.zakatCategory || ""} onChange={set("zakatCategory")}>{Object.entries(zmeta.data?.categories || {}).map(([k, v]: any) => <option key={k} value={k}>{v}</option>)}</Select></Field>}
        {f.fund === "ZAKAT" && <div className="alert info small" style={{ gridColumn: "1 / -1", margin: 0 }}>الزكاة تُصرف في مصارفها الثمانية فقط ولا تتجاوز المحصّل منها{f.zakatCategory === "AMILIN" ? ` — حصة «العاملين عليها» بحد أقصى ${zmeta.data?.policy?.amilinCapPct ?? 12.5}% من زكاة السنة` : " — للمستفيدين فقط"}.{cs ? ` دراسة الحالة ${cs.number}: ${cs.verdict === "FAQIR" ? "فقير" : cs.verdict === "MISKEEN" ? "مسكين" : "غير مستحق للزكاة"} (نصيب الفرد ${money(cs.perCapita)}، الأولوية ${cs.score}/100)${cs.validUntil ? ` — سارية حتى ${fmtDate(cs.validUntil)}` : ""}.` : ""}</div>}
        {needOverride && <Field label="مبرر الاستثناء المعتمد من اللجنة (إلزامي)" span3 hint={!cs ? "لا توجد دراسة حالة للمستفيد — سجّلها من سجل المستفيدين أو اكتب مبرر الاستثناء" : "دراسة الحالة لا تؤهله للزكاة أو منتهية"}><Input value={f.eligibilityOverride || ""} onChange={set("eligibilityOverride")} placeholder="مثال: قرار لجنة المساعدات رقم ... لظرف طارئ" /></Field>}
        {hist.data?.warning && <div className="alert warn small" style={{ gridColumn: "1 / -1", margin: 0 }}>⚠ {hist.data.warning}. إجمالي ما صُرف له هذا العام {money(hist.data.yearTotal)} ({hist.data.yearCount} سند).</div>}
        <Field label="المبلغ (ريال)"><NumInput value={f.amount} onChange={set("amount")} /></Field>
        <Field label="المبلغ كتابةً" span2><div className="input" style={{ background: "var(--surface-2)", minHeight: 36 }}>{words(f.amount)}</div></Field>
        <Field label="سبب الصرف" span2><Input value={f.reason} onChange={set("reason")} /></Field>
        <Field label="الإدارة / القسم"><Input value={f.department} onChange={set("department")} /></Field>
        <Field label="المشروع / البرنامج"><ProjectSelect value={f.projectId} onChange={set("projectId")} /></Field>
        <Field label="بند الموازنة"><Input value={f.budgetLine} onChange={set("budgetLine")} /></Field>
        <Field label="حساب المصروف" hint="فارغ = حسب الصفة (مساعدات / مكافآت متطوعين / برامج)"><Picker value={exp} onChange={setExp} fetcher={expFetcher} label={(a: any) => a.code ? acLabel(a) : a.nameAr} /></Field>
        <Field label="من حساب (الصندوق / البنك)" hint="فارغ = الصندوق للنقدي والبنك لغيره"><Picker value={pay} onChange={setPay} fetcher={cashFetcher} label={acLabel} /></Field>
        {f.kind !== "CASH" && <>
          <Field label={f.kind === "CHEQUE" ? "رقم الشيك" : "مرجع التحويل"}><Input value={f.refNo} onChange={set("refNo")} dir="ltr" /></Field>
          <Field label="تاريخ التنفيذ"><Input type="date" value={f.execDate} onChange={set("execDate")} /></Field>
          <Field label="بنك المستفيد"><Input value={f.bankName} onChange={set("bankName")} /></Field>
          <Field label="اسم صاحب الحساب"><Input value={f.accountHolder} onChange={set("accountHolder")} /></Field>
          <Field label="رقم الآيبان" span2><Input value={f.iban} onChange={set("iban")} dir="ltr" placeholder="SA.." /></Field>
        </>}
        <Field label="المستندات المؤيدة" span3><Checks options={DOCS} value={f.docs} onChange={(v) => setF({ ...f, docs: v })} /></Field>
        <Field label="ملاحظات" span3><Input value={f.notes} onChange={set("notes")} /></Field>
      </div>
      {quick && <PersonModal role="BENEFICIARY" onClose={(p) => { setQuick(false); if (p) pickBenef(p); }} />}
    </Modal>
  );
}

// ─── payment requests (FIN-001) ────────────────────────────────────────────
export function RequestsPage() {
  const { can } = useCompanyContext();
  const { settings } = useCharity();
  const qs = useQ();
  const nav = useNavigate();
  const [text, setText] = useUrlSearch();
  const [status, setStatus] = useState("");
  const { data, loading, reload } = useFetch<any[]>(`/charity/requests${q({ status })}`);
  const [edit, setEdit] = useState<any>(qs.get("new") === "1" ? {} : null);
  const [review, setReview] = useState<any>(null);
  const [pr, setPr] = useState<any>(null);
  const { run, busy } = useAction();
  useEffect(() => { if (qs.get("new") === "1") setEdit({}); }, [qs.get("new")]);
  const rows = useMemo(() => (data || []).filter((r) => matches(r, text, ["number", "beneficiaryName", "purpose", "requester", "department", "projectName"])), [data, text]);
  const s = useSorted(rows);
  const act = (r: any, a: string, note?: string) => run(async () => { await api(`/charity/requests/${r.id}/${a}`, { body: { note } }); reload(); }, a === "approve" ? "تم اعتماد الطلب" : a === "reject" ? "تم رفض الطلب" : "تم");
  const steps = ["SUBMITTED", "REVIEWED", "APPROVED", "PAID"];
  return (
    <div className="card">
      <div className="card-h">
        <h3>طلبات الصرف المالي (FIN-001)</h3>
        <div className="row">
          <button className="btn sm" onClick={() => exportExcel(rows.map((r) => ({ الرقم: r.number, التاريخ: fmtDate(r.date), "مقدم الطلب": r.requester, القسم: r.department, المستفيد: r.beneficiaryName, الغرض: r.purpose, المشروع: r.projectName, المبلغ: Number(r.amount), الحالة: REQ_ST[r.status], "سند الصرف": r.disbursementNumber })), "طلبات-الصرف")}>⬇ Excel</button>
          <button className="btn sm" onClick={() => setPr({ blank: true })}>🖨 نموذج فارغ</button>
          {can("payments.write") && <button className="btn primary" onClick={() => setEdit({})}>＋ طلب صرف جديد</button>}
        </div>
      </div>
      <div className="card-b"><div className="toolbar">
        <SearchBox value={text} onChange={setText} placeholder="بحث بالرقم أو المستفيد أو الغرض" />
        <MapSelect map={REQ_ST} value={status} onChange={setStatus} all="كل الحالات" />
        <FilterInfo shown={rows.length} total={data?.length || 0} active={!!(text || status)} onClear={() => { setText(""); setStatus(""); }} />
        <div className="grow" /><span className="small muted">مسار الاعتماد: تقديم ← مراجعة مالية ← اعتماد صاحب الصلاحية ← صرف بسند</span>
      </div></div>
      {loading && !data ? <Loading /> : !rows.length ? <Empty text="لا توجد طلبات صرف" /> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><Th k="number" s={s}>الرقم</Th><Th k="date" s={s}>التاريخ</Th><Th k="requester" s={s}>مقدم الطلب</Th><Th k="beneficiaryName" s={s}>المستفيد والغرض</Th><Th k="amount" s={s} n>المبلغ</Th><th>المسار</th><th /></tr></thead>
          <tbody>{s.sorted.map((r: any) => (
            <tr key={r.id}>
              <td className="num">{r.number}</td><td className="dt">{fmtDate(r.date)}</td>
              <td>{r.requester}<div className="small muted">{r.department}</div></td>
              <td><b>{r.beneficiaryName}</b><div className="small muted">{r.purpose}{r.projectName ? " · " + r.projectName : ""}</div></td>
              <td className="n"><b><Money v={r.amount} /></b><div className="small muted">{METHOD[r.method]}</div></td>
              <td><div className="ch-steps">{r.status === "REJECTED" ? <span className="no">مرفوض{r.decisionNote ? ": " + r.decisionNote : ""}</span> : r.status === "DRAFT" ? <span>مسودة</span> : steps.map((x, i) => <span key={x} className={steps.indexOf(r.status) >= i ? "on" : ""}>{["مقدَّم", "مراجعة", "معتمد", "مصروف"][i]}</span>)}</div>{r.disbursementNumber && <div className="small muted num">{r.disbursementNumber}</div>}</td>
              <td className="row" style={{ gap: 4 }}>
                <button className="btn sm" onClick={() => setPr(r)}>🖨</button>
                {can("payments.write") && ["DRAFT", "SUBMITTED", "REJECTED"].includes(r.status) && <button className="btn sm" onClick={() => setEdit(r)}>تعديل</button>}
                {can("payments.write") && ["SUBMITTED", "REVIEWED"].includes(r.status) && <button className="btn sm" onClick={() => setReview(r)}>مراجعة مالية</button>}
                {can("accounting.write") && ["SUBMITTED", "REVIEWED"].includes(r.status) && <button className="btn sm primary" disabled={busy} onClick={() => act(r, "approve", window.prompt("ملاحظات الاعتماد (اختياري)") || undefined)}>اعتماد</button>}
                {can("accounting.write") && ["SUBMITTED", "REVIEWED", "APPROVED"].includes(r.status) && !r.disbursementId && <button className="btn sm ghost" disabled={busy} onClick={() => { const n = window.prompt("سبب الرفض"); if (n) act(r, "reject", n); }}>رفض</button>}
                {can("payments.write") && r.status === "APPROVED" && <button className="btn sm primary" onClick={() => nav(`/charity/expenses?request=${r.id}`)}>صرف ←</button>}
                {can("payments.write") && ["DRAFT", "SUBMITTED", "REJECTED"].includes(r.status) && <button className="btn sm ghost" disabled={busy} onClick={() => confirmDlg(`حذف الطلب ${r.number}؟`) && run(async () => { await api(`/charity/requests/${r.id}`, { method: "DELETE" }); reload(); })}>حذف</button>}
              </td>
            </tr>))}
          </tbody>
        </table></div>
      )}
      {edit && <RequestModal init={edit} onClose={(saved) => { setEdit(null); if (qs.get("new")) nav("/charity/requests", { replace: true }); if (saved) reload(); }} />}
      {review && <ReviewModal r={review} onClose={(ok) => { setReview(null); if (ok) reload(); }} />}
      {pr && <PrintModal tplKey="request" data={pr.blank ? {} : fromRequest(pr)} settings={settings} onClose={() => setPr(null)} />}
    </div>
  );
}

function RequestModal({ init, onClose }: { init: any; onClose: (saved?: boolean) => void }) {
  const { me } = useCompanyContext();
  const { run, busy } = useAction();
  const [benef, setBenef] = useState<any>(init.partnerId ? { id: init.partnerId, code: "", name: init.beneficiaryName } : null);
  const [exp, setExp] = useState<any>(init.expenseAccountId ? { id: init.expenseAccountId, code: "", nameAr: init.expenseAccountName } : null);
  const [f, setF] = useState<any>({ date: fmtDate(init.date) || today(), requester: init.requester || me.user.fullName, department: init.department || "", beneficiaryName: init.beneficiaryName || "", beneficiaryIdNo: init.beneficiaryIdNo || "", purpose: init.purpose || "", projectId: init.projectId || "", budgetLine: init.budgetLine || "", method: init.method || "TRANSFER", amount: init.amount || "", justification: init.justification || "", attachments: init.attachments || [] });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const save = (status?: string) => run(async () => { const body = { ...f, partnerId: benef?.id, expenseAccountId: exp?.id, status }; if (init.id) await api(`/charity/requests/${init.id}`, { method: "PUT", body }); else await api("/charity/requests", { body }); onClose(true); }, status === "DRAFT" ? "تم الحفظ كمسودة" : "تم تقديم الطلب");
  return (
    <Modal title={init.id ? `تعديل طلب الصرف ${init.number}` : "نموذج طلب صرف مالي (FIN-001)"} onClose={() => onClose()} wide footer={<><button className="btn primary" disabled={busy} onClick={() => save()}>تقديم الطلب</button><button className="btn" disabled={busy} onClick={() => save("DRAFT")}>حفظ كمسودة</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <div className="grid c3">
        <Field label="اسم مقدم الطلب"><Input value={f.requester} onChange={set("requester")} /></Field>
        <Field label="الإدارة / القسم"><Input value={f.department} onChange={set("department")} /></Field>
        <Field label="تاريخ الطلب"><Input type="date" value={f.date} onChange={set("date")} disabled={!!init.id} /></Field>
        <Field label="المستفيد من السجل (اختياري)"><Picker value={benef} onChange={(b: any) => { setBenef(b); if (b) setF({ ...f, beneficiaryName: b.name, beneficiaryIdNo: b.idNumber || "" }); }} fetcher={(s) => api(`/partners${q({ q: s, limit: 20 })}`).then((r: any) => r.rows || r)} label={(b: any) => b.name} /></Field>
        <Field label="الجهة / الشخص المستفيد"><Input value={f.beneficiaryName} onChange={set("beneficiaryName")} /></Field>
        <Field label="رقم الهوية / السجل"><Input value={f.beneficiaryIdNo} onChange={set("beneficiaryIdNo")} dir="ltr" /></Field>
        <Field label="الغرض من الصرف" span3><Input value={f.purpose} onChange={set("purpose")} /></Field>
        <Field label="المشروع / البرنامج"><ProjectSelect value={f.projectId} onChange={set("projectId")} /></Field>
        <Field label="بند الموازنة"><Input value={f.budgetLine} onChange={set("budgetLine")} /></Field>
        <Field label="حساب المصروف (التوجيه المحاسبي)"><Picker value={exp} onChange={setExp} fetcher={expFetcher} label={(a: any) => a.code ? acLabel(a) : a.nameAr} /></Field>
        <Field label="طريقة الصرف المقترحة"><Select value={f.method} onChange={set("method")}><option value="TRANSFER">تحويل بنكي</option><option value="CHEQUE">شيك</option><option value="CASH">نقدي</option></Select></Field>
        <Field label="المبلغ المطلوب"><NumInput value={f.amount} onChange={set("amount")} /></Field>
        <Field label="المبلغ كتابةً"><div className="input" style={{ background: "var(--surface-2)", minHeight: 36, fontSize: 12 }}>{words(f.amount)}</div></Field>
        <Field label="مبررات الطلب" span3><textarea className="input" rows={3} value={f.justification} onChange={set("justification")} /></Field>
        <Field label="المرفقات" span3><Checks options={ATTACH} value={f.attachments} onChange={(v) => setF({ ...f, attachments: v })} /></Field>
      </div>
    </Modal>
  );
}

function ReviewModal({ r, onClose }: { r: any; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const [rv, setRv] = useState<Record<string, boolean>>(r.review || {});
  const [note, setNote] = useState(r.decisionNote || "");
  return (
    <Modal title={`المراجعة المالية — ${r.number}`} narrow onClose={() => onClose()} footer={<><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api(`/charity/requests/${r.id}/review`, { body: { review: rv, note } }); onClose(true); }, "تم تسجيل المراجعة")}>حفظ المراجعة</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <div className="stat-list">{REVIEW.map((x) => <label key={x} className="item"><span>{x}</span><input type="checkbox" checked={!!rv[x]} onChange={(e) => setRv({ ...rv, [x]: e.target.checked })} /></label>)}</div>
      <Field label="ملاحظات الإدارة المالية"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="small muted mt">المبلغ: <Money v={r.amount} /> — {r.purpose}</div>
    </Modal>
  );
}

// ─── expense runs (مسير المصروفات) ───────────────────────────────────────────
export function BatchesPage() {
  const { can } = useCompanyContext();
  const { data, loading, reload } = useFetch<any[]>("/charity/batches");
  const [edit, setEdit] = useState<any>(null);
  const [sheet, setSheet] = useState<any>(null);
  const { run, busy } = useAction();
  const BS: Record<string, string> = { DRAFT: "مسودة", POSTED: "مرحّل", CANCELLED: "ملغى" };
  return (
    <div className="card">
      <div className="card-h"><h3>مسير المصروفات (صرف جماعي)</h3>{can("payments.write") && <button className="btn primary" onClick={() => setEdit({})}>＋ مسير جديد</button>}</div>
      <div className="card-b small muted">أعدّ مسيراً بأسماء المستفيدين أو المتطوعين ومبالغهم، ثم اعتمده ليُنشئ سند صرف لكل بند ويرحّل قيوده دفعة واحدة. يمكن طباعة كشف المسير للتوقيع وتصديره للبنك.</div>
      {loading && !data ? <Loading /> : !data?.length ? <Empty text="لا توجد مسيرات بعد" /> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>الرقم</th><th>التاريخ</th><th>العنوان</th><th>المشروع</th><th>النوع</th><th className="n">البنود</th><th className="n">الإجمالي</th><th>الحالة</th><th /></tr></thead>
          <tbody>{data.map((b: any) => <tr key={b.id}>
            <td className="num">{b.number}</td><td className="dt">{fmtDate(b.date)}</td><td><b>{b.title}</b></td><td>{b.projectName || "—"}</td><td>{KIND[b.kind]}</td><td className="n">{b.linesCount}</td><td className="n"><b><Money v={b.total} /></b></td><td><Badge s={b.status} map={BS} /></td>
            <td className="row" style={{ gap: 4 }}>
              <button className="btn sm" onClick={() => setSheet(b)}>🖨 الكشف</button>
              {b.status === "DRAFT" && can("payments.write") && <button className="btn sm" onClick={() => setEdit(b)}>تعديل</button>}
              {b.status === "DRAFT" && can("accounting.write") && <button className="btn sm primary" disabled={busy} onClick={() => confirmDlg(`اعتماد وترحيل المسير ${b.number} بإجمالي ${money(b.total)}؟ سيُنشأ سند صرف لكل بند.`) && run(async () => { await api(`/charity/batches/${b.id}/post`, { body: {} }); reload(); }, "تم ترحيل المسير")}>اعتماد وترحيل</button>}
              {b.status !== "CANCELLED" && can("accounting.write") && <button className="btn sm ghost" disabled={busy} onClick={() => confirmDlg(b.status === "DRAFT" ? "حذف المسودة؟" : `إلغاء المسير ${b.number}؟ ستُلغى جميع سندات الصرف التابعة وتُعكس قيودها.`) && run(async () => { await api(`/charity/batches/${b.id}/cancel`, { body: {} }); reload(); }, "تم")}>{b.status === "DRAFT" ? "حذف" : "إلغاء"}</button>}
            </td></tr>)}</tbody>
        </table></div>
      )}
      {edit && <BatchModal init={edit} onClose={(ok) => { setEdit(null); if (ok) reload(); }} />}
      {sheet && <BatchSheet b={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}

function BatchModal({ init, onClose }: { init: any; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const toast = useToast();
  const [f, setF] = useState<any>({ date: fmtDate(init.date) || today(), title: init.title || "", projectId: init.projectId || "", kind: init.kind || "TRANSFER", notes: init.notes || "" });
  const [pay, setPay] = useState<any>(init.payAccountId ? { id: init.payAccountId, code: "", nameAr: "الحساب المحدد" } : null);
  const [exp, setExp] = useState<any>(init.expenseAccountId ? { id: init.expenseAccountId, code: "", nameAr: "الحساب المحدد" } : null);
  const [lines, setLines] = useState<any[]>(init.lines?.length ? init.lines : [{ name: "", amount: "" }]);
  const [def, setDef] = useState("500");
  const setL = (i: number, k: string, v: any) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const total = lines.reduce((a, l) => a + Number(l.amount || 0), 0);
  const importAll = () => run(async () => { const list: any[] = await api("/charity/beneficiaries"); const have = new Set(lines.map((l) => l.partnerId).filter(Boolean)); const add = list.filter((b) => !have.has(b.id) && (b.beneficiaryInfo?.status || "ACTIVE") === "ACTIVE").map((b) => ({ partnerId: b.id, name: b.name, idNo: b.idNumber, phone: b.phone, iban: b.beneficiaryInfo?.iban, bankName: b.beneficiaryInfo?.bankName, capacity: "BENEFICIARY", amount: def })); setLines([...lines.filter((l) => l.name), ...add]); toast(`أضيف ${add.length} مستفيد`, "ok"); });
  const save = () => run(async () => { const body = { ...f, payAccountId: pay?.id, expenseAccountId: exp?.id, lines }; if (init.id) await api(`/charity/batches/${init.id}`, { method: "PUT", body }); else await api("/charity/batches", { body }); onClose(true); }, "تم حفظ المسير");
  return (
    <Modal title={init.id ? `تعديل المسير ${init.number}` : "مسير مصروفات جديد"} onClose={() => onClose()} wide footer={<><b className="grow">الإجمالي: <Money v={total} /> · {lines.filter((l) => l.name).length} بند</b><button className="btn primary" disabled={busy} onClick={save}>حفظ كمسودة</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <div className="grid c3">
        <Field label="عنوان المسير"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="مثال: مساعدات شهر أكتوبر" /></Field>
        <Field label="التاريخ"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="نوع الصرف"><MapSelect map={KIND} value={f.kind} onChange={(v) => setF({ ...f, kind: v })} /></Field>
        <Field label="المشروع / البرنامج"><ProjectSelect value={f.projectId} onChange={(v) => setF({ ...f, projectId: v })} /></Field>
        <Field label="من حساب (الصندوق / البنك)"><Picker value={pay} onChange={setPay} fetcher={cashFetcher} label={(a: any) => a.code ? acLabel(a) : a.nameAr} /></Field>
        <Field label="حساب المصروف" hint="فارغ = حسب صفة كل بند"><Picker value={exp} onChange={setExp} fetcher={expFetcher} label={(a: any) => a.code ? acLabel(a) : a.nameAr} /></Field>
      </div>
      <div className="row mt"><b>البنود</b><div className="grow" /><span className="small muted">مبلغ افتراضي</span><Input style={{ width: 90 }} value={def} onChange={(e) => setDef(e.target.value)} /><button className="btn sm" disabled={busy} onClick={importAll}>＋ إضافة كل المستفيدين النشطين</button><button className="btn sm" onClick={() => setLines([...lines, { name: "", amount: def, capacity: "BENEFICIARY" }])}>＋ بند</button></div>
      <div className="table-wrap mt ch-batch"><table className="tbl compact">
        <thead><tr><th>#</th><th>الاسم</th><th>الهوية</th><th>الصفة</th><th>الآيبان</th><th>السبب</th><th className="n">المبلغ</th><th /></tr></thead>
        <tbody>{lines.map((l, i) => <tr key={i}>
          <td className="num">{i + 1}</td>
          <td><Input value={l.name} onChange={(e) => setL(i, "name", e.target.value)} /></td>
          <td><Input value={l.idNo || ""} onChange={(e) => setL(i, "idNo", e.target.value)} dir="ltr" /></td>
          <td><MapSelect map={CAPACITY} value={l.capacity || "BENEFICIARY"} onChange={(v) => setL(i, "capacity", v)} /></td>
          <td><Input value={l.iban || ""} onChange={(e) => setL(i, "iban", e.target.value)} dir="ltr" style={{ minWidth: 200 }} /></td>
          <td><Input value={l.reason || ""} onChange={(e) => setL(i, "reason", e.target.value)} /></td>
          <td><NumInput value={l.amount} onChange={(e) => setL(i, "amount", e.target.value)} style={{ width: 100 }} /></td>
          <td><button className="btn sm ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button></td>
        </tr>)}</tbody>
      </table></div>
    </Modal>
  );
}

function BatchSheet({ b, onClose }: { b: any; onClose: () => void }) {
  const { settings } = useCharity();
  const ref = useRef<HTMLDivElement>(null);
  const sig = settings?.signatories || {};
  const lines: any[] = b.lines || [];
  return (
    <Modal title={`كشف المسير ${b.number}`} wide onClose={onClose} footer={<><button className="btn" onClick={() => exportExcel(lines.map((l, i) => ({ "#": i + 1, الاسم: l.name, الهوية: l.idNo, البنك: l.bankName, الآيبان: l.iban, المبلغ: Number(l.amount), السبب: l.reason || b.title })), `مسير-${b.number}`)}>⬇ Excel للبنك</button><button className="btn primary" onClick={() => printA4(ref.current)}>🖨 طباعة A4</button><button className="btn" onClick={onClose}>إغلاق</button></>}>
      <div className="a4-stage"><div className="a4-wrap" ref={ref}><div className="a4" style={{ ["--a4c" as any]: settings?.theme?.color || "#1c3f8a", ["--a4a" as any]: settings?.theme?.accent || "#3f86d8", fontSize: 12 }}>
        <header className="a4-h"><div className="a4-org"><img src={settings?.logoUrl || DEFAULT_LOGO} alt="" /><div><b>{settings?.associationName}</b>{settings?.licenseNo && <span>ترخيص رقم ({settings.licenseNo})</span>}</div></div><div className="a4-title"><h1>كشف مسير المصروفات</h1><p>{b.title}</p><div className="a4-meta"><span className="a4-code">{b.number}</span></div></div></header>
        <div className="a4-body">
          <div className="a4-grid" style={{ marginBottom: 8 }}><div className="a4-f"><label>التاريخ</label><div className="a4-v">{fmtDate(b.date)}</div></div><div className="a4-f"><label>نوع الصرف</label><div className="a4-v">{KIND[b.kind]}</div></div><div className="a4-f"><label>المشروع</label><div className="a4-v">{b.projectName || "—"}</div></div></div>
          <table className="tbl compact" style={{ width: "100%", border: "1px solid #ccc" }}><thead><tr><th>#</th><th>الاسم</th><th>الهوية</th><th>الآيبان</th><th className="n">المبلغ</th><th>توقيع المستلم</th></tr></thead>
            <tbody>{lines.map((l, i) => <tr key={i}><td>{i + 1}</td><td>{l.name}</td><td className="num">{l.idNo}</td><td className="num" style={{ fontSize: 11 }}>{l.iban}</td><td className="n"><Money v={l.amount} /></td><td style={{ width: 110 }} /></tr>)}</tbody>
            <tfoot><tr><td colSpan={4}>الإجمالي: {words(b.total)}</td><td className="n"><Money v={b.total} /></td><td /></tr></tfoot></table>
        </div>
        <footer className="a4-f-sign"><div className="a4-sigs">{["preparer", "finance", "authority"].map((r) => <div key={r} className="a4-sig"><b>{sig[r]?.title || { preparer: "المُعِد / المحاسب", finance: "المدير المالي", authority: "صاحب الصلاحية" }[r]}</b><span className="nm">{sig[r]?.name || ""}</span><span className="ln">التوقيع</span></div>)}<div className="a4-seal">ختم الجمعية</div></div></footer>
      </div></div></div>
    </Modal>
  );
}

// ─── daily cash-in (تحصيل دخول الأموال اليومية) ─────────────────────────────
export function DailyPage() {
  const { can } = useCompanyContext();
  const [d, setD] = useState(today());
  const { data, loading, reload } = useFetch(`/charity/daily${q({ date: d })}`);
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const { run, busy } = useAction();
  useEffect(() => { setCounted(""); setNotes(""); }, [d]);
  const diff = counted === "" ? 0 : Number(counted) - Number(data?.expectedCash || 0);
  return (
    <div>
      <div className="toolbar no-print"><b>يوم التحصيل</b><Input type="date" value={d} onChange={(e) => setD(e.target.value)} style={{ width: 160 }} /><button className="btn sm ghost" onClick={() => setD(today())}>اليوم</button><div className="grow" /><button className="btn sm" onClick={() => window.print()}>🖨 طباعة تقرير اليوم</button><PdfBtn name={`تحصيل يوم ${d}`} />{data && <button className="btn sm" onClick={() => exportExcel(data.rows.map((r: any) => ({ الرقم: r.number, الطرف: r.party, المصدر: SOURCE[r.source], الطريقة: METHOD[r.method], الحساب: r.accountName, المبلغ: Number(r.amount), "بواسطة": r.createdBy })), `تحصيل-${d}`)}>⬇ Excel</button>}</div>
      <AlertsCard />
      {loading && !data ? <Loading /> : data && <>
        <div className="grid c4">
          <Kpi label={`إجمالي المتحصلات يوم ${d}`} v={data.total} icon="📥" sub={`${data.rows.length} عملية`} />
          <Kpi label="نقدي (المتوقع في الصندوق)" v={data.byMethod.CASH || 0} icon="💵" cls="success" />
          <Kpi label="تحويلات بنكية" v={data.byMethod.TRANSFER || 0} icon="🏦" cls="info" />
          <Kpi label="شيكات وبطاقات" v={Number(data.byMethod.CHEQUE || 0) + Number(data.byMethod.CARD || 0)} icon="🧾" cls="accent" />
        </div>
        <div className="grid c2 mt">
          <div className="card"><div className="card-h"><h3>حركات التحصيل</h3></div>{!data.rows.length ? <Empty text="لا توجد متحصلات في هذا اليوم" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الرقم</th><th>الطرف</th><th>المصدر</th><th>الطريقة</th><th>الحساب</th><th className="n">المبلغ</th></tr></thead><tbody>{data.rows.map((r: any) => <tr key={r.id}><td className="num">{r.number}</td><td>{r.party}</td><td>{SOURCE[r.source] || r.source}</td><td>{METHOD[r.method] || r.method}</td><td className="small">{r.accountName}</td><td className="n"><Money v={r.amount} /></td></tr>)}</tbody><tfoot><tr><td colSpan={5}>الإجمالي</td><td className="n"><Money v={data.total} /></td></tr></tfoot></table></div>}</div>
          <div className="grid">
            <div className="card"><div className="card-h"><h3>حسب المصدر والحساب</h3></div><div className="card-b"><Bars rows={Object.entries(data.bySource).map(([k, amount]) => ({ k, amount }))} label={(r) => SOURCE[r.k] || r.k} /><h4 className="mt" style={{ marginBottom: 6 }}>حسب الصندوق / البنك</h4><Bars rows={data.byAccount} label={(r) => r.name} gold /></div></div>
            <div className="card"><div className="card-h"><h3>إقفال الصندوق اليومي</h3>{data.closing && <span className="badge green">مُقفل</span>}</div><div className="card-b">
              {data.closing ? <div className="stat-list"><div className="item"><span>النقد المتوقع</span><Money v={data.closing.expectedCash} /></div><div className="item"><span>النقد المعدود</span><Money v={data.closing.countedCash} /></div><div className="item"><span>الفرق</span><Money v={data.closing.difference} sign /></div><div className="item"><span>أقفله</span><span>{data.closing.closedBy}</span></div>{data.closing.notes && <div className="item"><span>ملاحظات</span><span>{data.closing.notes}</span></div>}</div> : <>
                <div className="stat-list"><div className="item"><span>النقد المتوقع في الصندوق</span><b><Money v={data.expectedCash} /></b></div></div>
                <div className="grid c2 mt"><Field label="النقد المعدود فعلياً"><NumInput value={counted} onChange={(e) => setCounted(e.target.value)} /></Field><Field label="الفرق"><div className={"input " + (diff < 0 ? "neg-val" : diff > 0 ? "pos-val" : "")}>{counted === "" ? "—" : money(diff)}</div></Field></div>
                <Field label="ملاحظات"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
                {can("payments.write") && <button className="btn primary mt" disabled={busy || counted === ""} onClick={() => run(async () => { await api("/charity/daily/close", { body: { date: d, countedCash: counted, notes } }); reload(); }, diff ? "تم الإقفال وقيد فرق الصندوق" : "تم إقفال اليوم")}>إقفال اليوم</button>}
                <div className="small muted mt">عند وجود فرق يُرحَّل قيد عجز/زيادة الصندوق آلياً.</div>
              </>}
            </div></div>
          </div>
        </div>
        <div className="card mt no-print"><div className="card-h"><h3>آخر 14 يوماً</h3></div><div className="table-wrap"><table className="tbl compact"><tbody>{data.last14.map((x: any) => <tr key={x.date} className="clickable" onClick={() => setD(fmtDate(x.date))}><td className="dt">{fmtDate(x.date)}</td><td className="n"><Money v={x.total} /></td><td>{x.closed ? <span className="badge green">مُقفل</span> : Number(x.total) ? <span className="badge amber">غير مُقفل</span> : <span className="muted small">—</span>}</td></tr>)}</tbody></table></div></div>
      </>}
    </div>
  );
}

// ─── archive (أرشيف الفواتير والمستندات) ────────────────────────────────────
const ARCH: Record<string, string> = { INVOICE: "فواتير وعروض أسعار", DONATION: "سندات قبض الجمعية", DISB: "سندات صرف الجمعية", REQUEST: "طلبات الصرف", CUSTODY: "العهد المالية", FORM: "طلبات الشراء والاستلام والاسترداد", INKIND: "التبرعات العينية", PAYMENT: "سندات القبض والصرف العامة", EXPENSE: "المصروفات العامة" };
const FORM_AR: Record<string, string> = { PURCHASE: "طلب شراء", RECEIVING: "محضر استلام", REFUND: "طلب استرداد" };
const SUB: Record<string, string> = { INVOICE: "فاتورة", QUOTATION: "عرض سعر", ORDER: "أمر", CREDIT_NOTE: "إشعار دائن", DEBIT_NOTE: "إشعار مدين" };
export function ArchivePage() {
  const nav = useNavigate();
  const [text, setText] = useUrlSearch();
  const [types, setTypes] = useState<string[]>([]);
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const { data, loading } = useFetch<any[]>(`/charity/archive${q({ type: types.join(","), from, to, status })}`);
  const rows = useMemo(() => (data || []).filter((r) => matches(r, text, ["number", "party"])), [data, text]);
  const s = useSorted(rows);
  const open = (r: any) => {
    if (r.t === "INVOICE") return nav(`/charity/doc/${r.id}`);
    if (r.t === "DONATION") return nav(`/charity/receipts?q=${encodeURIComponent(r.number)}`);
    if (r.t === "DISB") return nav(`/charity/expenses?q=${encodeURIComponent(r.number)}`);
    if (r.t === "REQUEST") return nav(`/charity/requests?q=${encodeURIComponent(r.number)}`);
    if (r.t === "PAYMENT") return nav(`/${r.dir === "OUT" ? "vouchers" : "receipts"}?q=${encodeURIComponent(r.number)}`);
    if (r.t === "EXPENSE") return nav(`/expenses?q=${encodeURIComponent(r.number)}`);
    if (r.t === "INKIND") return nav(`/charity/inkind?q=${encodeURIComponent(r.number)}`);
    if (r.t === "CUSTODY") return nav(`/charity/custody?q=${encodeURIComponent(r.number)}`);
    if (r.t === "FORM") return nav(`/charity/${r.sub === "REFUND" ? "refunds" : "purchases"}?q=${encodeURIComponent(r.number)}`);
  };
  const label = (r: any) => r.t === "INVOICE" ? `${SUB[r.sub] || r.sub} ${r.dir === "PURCHASE" ? "مشتريات" : "مبيعات"}` : r.t === "DONATION" ? `سند قبض · ${SOURCE[r.sub] || ""}` : r.t === "DISB" ? `سند صرف · ${KIND[r.sub] || ""}` : r.t === "REQUEST" ? "طلب صرف" : r.t === "PAYMENT" ? (r.dir === "OUT" ? "سند صرف عام" : "سند قبض عام") : r.t === "CUSTODY" ? "عهدة مالية" : r.t === "INKIND" ? (r.sub === "IN" ? "استلام تبرع عيني" : "صرف مساعدات عينية") : r.t === "FORM" ? FORM_AR[r.sub] || "نموذج" : "مصروف";
  return (
    <div className="card">
      <div className="card-h"><h3>أرشيف الفواتير والمستندات</h3><button className="btn sm" onClick={() => exportExcel(rows.map((r) => ({ النوع: label(r), الرقم: r.number, التاريخ: fmtDate(r.date), الطرف: r.party, المبلغ: Number(r.amount), الحالة: REQ_ST[r.status] || DOC_ST[r.status] || r.status })), "أرشيف-المستندات")}>⬇ Excel</button></div>
      <div className="card-b"><div className="toolbar">
        <SearchBox value={text} onChange={setText} placeholder="رقم المستند أو اسم الطرف" />
        <PeriodFilter from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 140 }}><option value="">كل الحالات</option><option value="POSTED">مرحّل</option><option value="DRAFT">مسودة</option><option value="CANCELLED">ملغى</option><option value="PAID">مسدد / مصروف</option><option value="APPROVED">معتمد</option></Select>
        <FilterInfo shown={rows.length} total={data?.length || 0} active={!!(text || types.length || from || to || status)} onClear={() => { setText(""); setTypes([]); setFrom(""); setTo(""); setStatus(""); }} />
      </div>
      <div className="row" style={{ gap: 6 }}>{Object.entries(ARCH).map(([k, v]) => <button key={k} className={"btn sm" + (types.includes(k) ? " primary" : "")} onClick={() => setTypes(types.includes(k) ? types.filter((x) => x !== k) : [...types, k])}>{v}</button>)}</div></div>
      {loading && !data ? <Loading /> : !rows.length ? <Empty text="لا توجد مستندات" /> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><Th k="t" s={s}>النوع</Th><Th k="number" s={s}>الرقم</Th><Th k="date" s={s}>التاريخ</Th><Th k="party" s={s}>الطرف</Th><Th k="amount" s={s} n>المبلغ</Th><Th k="status" s={s}>الحالة</Th></tr></thead>
          <tbody>{s.sorted.map((r: any) => <tr key={r.t + r.id} className="clickable" onClick={() => open(r)}><td>{label(r)}</td><td className="num">{r.number}</td><td className="dt">{fmtDate(r.date)}</td><td>{r.party}</td><td className="n"><Money v={r.amount} /></td><td>{r.t === "REQUEST" ? <span className={"badge " + REQ_COLOR[r.status]}>{REQ_ST[r.status]}</span> : <Badge s={r.status} />}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}

// ─── projects & programs ───────────────────────────────────────────────────
export function ProjectsPage() {
  const { can } = useCompanyContext();
  const { projects, reloadProjects } = useCharity();
  const [edit, setEdit] = useState<any>(null);
  const [text, setText] = useState("");
  const rows = projects.filter((p: any) => matches(p, text, ["code", "name", "description"]));
  return (
    <div className="card">
      <div className="card-h"><h3>المشاريع والبرامج</h3><div className="row"><SearchBox value={text} onChange={setText} />{can("payments.write") && <button className="btn primary" onClick={() => setEdit({})}>＋ مشروع / برنامج</button>}</div></div>
      <div className="card-b small muted">كل مشروع يُنشأ له مركز تكلفة تلقائياً، فتظهر إيراداته ومصروفاته في تقارير مراكز التكلفة والموازنة. التبرعات للمشاريع المقيدة تُقيد في حساب «تبرعات مقيدة لمشاريع».</div>
      {!rows.length ? <Empty text="لا توجد مشاريع" /> : <div className="table-wrap"><table className="tbl">
        <thead><tr><th>الرمز</th><th>الاسم</th><th>النوع</th><th className="n">المستهدف</th><th className="n">المقبوض</th><th className="n">المصروف</th><th className="n">الرصيد المتاح</th><th>الإنجاز</th><th>الحالة</th><th /></tr></thead>
        <tbody>{rows.map((p: any) => { const pct = Number(p.target) ? Math.min(100, (Number(p.received) / Number(p.target)) * 100) : null; return <tr key={p.id}>
          <td className="num">{p.code}</td><td><b>{p.name}</b>{p.restricted && <span className="badge amber" style={{ marginInlineStart: 6 }}>مقيد</span>}<div className="small muted">{p.description}</div></td><td>{PROJ_KIND[p.kind]}</td>
          <td className="n"><Money v={p.target} blankZero /></td><td className="n"><Money v={p.received} /></td><td className="n"><Money v={p.spent} /></td><td className="n"><b><Money v={Number(p.received) - Number(p.spent)} sign /></b></td>
          <td style={{ minWidth: 120 }}>{pct !== null ? <><div className="progress"><div style={{ width: pct + "%" }} /></div><span className="small muted">{pct.toFixed(0)}%</span></> : <span className="muted small">—</span>}</td>
          <td><span className={"badge " + (p.status === "ACTIVE" ? "green" : "gray")}>{p.status === "ACTIVE" ? "نشط" : "مغلق"}</span></td>
          <td>{can("payments.write") && <button className="btn sm" onClick={() => setEdit(p)}>تعديل</button>}</td>
        </tr>; })}</tbody>
      </table></div>}
      {edit && <ProjectModal init={edit} onClose={(ok) => { setEdit(null); if (ok) reloadProjects(); }} />}
    </div>
  );
}

function ProjectModal({ init, onClose }: { init: any; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ name: init.name || "", kind: init.kind || "PROGRAM", restricted: !!init.restricted, target: init.target || "", startDate: fmtDate(init.startDate), endDate: fmtDate(init.endDate), status: init.status || "ACTIVE", description: init.description || "" });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <Modal title={init.id ? `تعديل ${init.code}` : "مشروع / برنامج جديد"} onClose={() => onClose()} footer={<><button className="btn primary" disabled={busy} onClick={() => run(async () => { if (init.id) await api(`/charity/projects/${init.id}`, { method: "PUT", body: f }); else await api("/charity/projects", { body: f }); onClose(true); }, "تم الحفظ")}>حفظ</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <div className="grid c2">
        <Field label="الاسم" span2><Input value={f.name} onChange={set("name")} /></Field>
        <Field label="النوع"><MapSelect map={PROJ_KIND} value={f.kind} onChange={(v) => setF({ ...f, kind: v })} /></Field>
        <Field label="المبلغ المستهدف"><NumInput value={f.target} onChange={set("target")} /></Field>
        <Field label="تاريخ البداية"><Input type="date" value={f.startDate} onChange={set("startDate")} /></Field>
        <Field label="تاريخ النهاية"><Input type="date" value={f.endDate} onChange={set("endDate")} /></Field>
        <Field label="الحالة"><Select value={f.status} onChange={set("status")}><option value="ACTIVE">نشط</option><option value="CLOSED">مغلق</option></Select></Field>
        <Field label=" "><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.restricted} onChange={set("restricted")} />أموال مقيدة بهذا المشروع</label></Field>
        <Field label="الوصف" span2><textarea className="input" rows={2} value={f.description} onChange={set("description")} /></Field>
      </div>
    </Modal>
  );
}

// ─── donors & beneficiaries ────────────────────────────────────────────────
export function PeoplePage({ role }: { role: "DONOR" | "BENEFICIARY" }) {
  const { can } = useCompanyContext();
  const path = role === "DONOR" ? "donors" : "beneficiaries";
  const { data, loading, reload } = useFetch<any[]>(`/charity/${path}`);
  const [text, setText] = useUrlSearch();
  const [type, setType] = useState("");
  const [edit, setEdit] = useState<any>(null);
  const [hist, setHist] = useState<any>(null);
  const [caseP, setCase] = useState<any>(null);
  const rows = useMemo(() => (data || []).filter((r) => matches(r, text, ["code", "name", "phone", "idNumber", "city", (x) => x.beneficiaryInfo?.category]) && (!type || (role === "DONOR" ? r.donorType === type : (r.beneficiaryInfo?.category || "") === type))), [data, text, type]);
  const s = useSorted(rows);
  const total = rows.reduce((a, r) => a + Number(r.total || 0), 0);
  const cats = [...new Set((data || []).map((r) => r.beneficiaryInfo?.category).filter(Boolean))] as string[];
  const title = role === "DONOR" ? "العملاء المتبرعون" : "المستفيدون";
  return (
    <div className="card">
      <div className="card-h"><h3>{title}</h3><div className="row">
        <button className="btn sm" onClick={() => exportExcel(rows.map((r) => ({ الرمز: r.code, الاسم: r.name, الجوال: r.phone, الهوية: r.idNumber, المدينة: r.city, ...(role === "DONOR" ? { الصفة: PAYER[r.donorType] || "", "إجمالي التبرعات": Number(r.total), "تبرعات السنة": Number(r.ytd), "عدد السندات": r.count } : { الفئة: r.beneficiaryInfo?.category, "أفراد الأسرة": r.beneficiaryInfo?.familySize, الآيبان: r.beneficiaryInfo?.iban, "إجمالي المساعدات": Number(r.total), "عدد الدفعات": r.count }), "آخر حركة": fmtDate(r.lastDate) })), title)}>⬇ Excel</button>
        {can("partners.write") && <button className="btn primary" onClick={() => setEdit({})}>＋ {role === "DONOR" ? "متبرع جديد" : "مستفيد جديد"}</button>}
      </div></div>
      <div className="card-b"><div className="toolbar">
        <SearchBox value={text} onChange={setText} placeholder="الاسم أو الجوال أو الهوية" />
        {role === "DONOR" ? <MapSelect map={PAYER} value={type} onChange={setType} all="كل الصفات" /> : <Select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 160 }}><option value="">كل الفئات</option>{cats.map((c) => <option key={c}>{c}</option>)}</Select>}
        <FilterInfo shown={rows.length} total={data?.length || 0} active={!!(text || type)} onClear={() => { setText(""); setType(""); }} />
        <div className="grow" /><b>{role === "DONOR" ? "إجمالي التبرعات" : "إجمالي المساعدات"}: <Money v={total} /></b>
      </div></div>
      {loading && !data ? <Loading /> : !rows.length ? <Empty text={role === "DONOR" ? "لا يوجد متبرعون بعد" : "لا يوجد مستفيدون بعد"} /> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><Th k="code" s={s}>الرمز</Th><Th k="name" s={s}>الاسم</Th><Th k="phone" s={s}>الجوال</Th><Th k="idNumber" s={s}>الهوية / السجل</Th><th>{role === "DONOR" ? "الصفة" : "الفئة / الأسرة"}</th><Th k="count" s={s} n>{role === "DONOR" ? "السندات" : "الدفعات"}</Th>{role === "DONOR" && <Th k="ytd" s={s} n>هذه السنة</Th>}<Th k="total" s={s} n>الإجمالي</Th><Th k="lastDate" s={s}>آخر حركة</Th><th /></tr></thead>
          <tbody>{s.sorted.map((r: any) => <tr key={r.id}>
            <td className="num">{r.code}</td><td><b>{r.name}</b>{r.city && <div className="small muted">{r.city}</div>}</td><td className="num">{r.phone}</td><td className="num">{r.idNumber || r.crNumber}</td>
            <td>{role === "DONOR" ? PAYER[r.donorType] || "—" : <>{r.beneficiaryInfo?.category || "—"}{r.beneficiaryInfo?.familySize ? <span className="small muted"> · {r.beneficiaryInfo.familySize} أفراد</span> : null}{r.beneficiaryInfo?.status === "INACTIVE" && <span className="badge gray" style={{ marginInlineStart: 4 }}>موقوف</span>}<div><VerdictBadge a={r.beneficiaryInfo?.assessment} /></div></>}</td>
            <td className="n">{r.count}</td>{role === "DONOR" && <td className="n"><Money v={r.ytd} /></td>}<td className="n"><b><Money v={r.total} /></b></td><td className="dt">{fmtDate(r.lastDate)}</td>
            <td className="row" style={{ gap: 4 }}>{role === "BENEFICIARY" && can("partners.write") && <button className="btn sm" onClick={() => setCase(r)}>دراسة الحالة</button>}<button className="btn sm" onClick={() => setHist(r)}>السجل والكشف</button>{can("partners.write") && <button className="btn sm ghost" onClick={() => setEdit(r)}>تعديل</button>}</td>
          </tr>)}</tbody>
        </table></div>
      )}
      {edit && <PersonModal role={role} init={edit} onClose={(p) => { setEdit(null); if (p) reload(); }} />}
      {hist && <HistoryModal role={role} p={hist} onClose={() => setHist(null)} />}
      {caseP && <CaseStudyModal p={caseP} onClose={(sv) => { setCase(null); if (sv) reload(); }} />}
    </div>
  );
}

export function PersonModal({ role, init = {}, onClose }: { role: "DONOR" | "BENEFICIARY"; init?: any; onClose: (p?: any) => void }) {
  const { run, busy } = useAction();
  const bi = init.beneficiaryInfo || {};
  const [f, setF] = useState<any>({ name: init.name || "", phone: init.phone || "", email: init.email || "", idNumber: init.idNumber || "", crNumber: init.crNumber || "", city: init.city || "", district: init.district || "", notes: init.notes || "", donorType: init.donorType || "INDIVIDUAL", category: bi.category || "", familySize: bi.familySize || "", iban: bi.iban || "", bankName: bi.bankName || "", benefStatus: bi.status || "ACTIVE" });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const path = role === "DONOR" ? "donors" : "beneficiaries";
  return (
    <Modal title={init.id ? `تعديل ${init.name}` : role === "DONOR" ? "متبرع جديد" : "مستفيد جديد"} onClose={() => onClose()} footer={<><button className="btn primary" disabled={busy} onClick={() => run(async () => { const r = init.id ? await api(`/charity/${path}/${init.id}`, { method: "PUT", body: f }) : await api(`/charity/${path}`, { body: f }); onClose(r); }, "تم الحفظ")}>حفظ</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <div className="grid c2">
        <Field label="الاسم" span2><Input value={f.name} onChange={set("name")} autoFocus /></Field>
        {role === "DONOR" && <Field label="الصفة"><MapSelect map={PAYER} value={f.donorType} onChange={(v) => setF({ ...f, donorType: v })} /></Field>}
        <Field label="رقم الهوية"><Input value={f.idNumber} onChange={set("idNumber")} dir="ltr" /></Field>
        {role === "DONOR" && <Field label="السجل التجاري (للجهات)"><Input value={f.crNumber} onChange={set("crNumber")} dir="ltr" /></Field>}
        <Field label="الجوال"><Input value={f.phone} onChange={set("phone")} dir="ltr" /></Field>
        <Field label="البريد الإلكتروني"><Input value={f.email} onChange={set("email")} dir="ltr" /></Field>
        <Field label="المدينة"><Input value={f.city} onChange={set("city")} /></Field>
        <Field label="الحي"><Input value={f.district} onChange={set("district")} /></Field>
        {role === "BENEFICIARY" && <>
          <Field label="الفئة" hint="مثال: أيتام، أرامل، أسر محتاجة، طلاب"><Input value={f.category} onChange={set("category")} list="benef-cats" /></Field>
          <datalist id="benef-cats"><option>أسر محتاجة</option><option>أيتام</option><option>أرامل ومطلقات</option><option>كبار السن</option><option>ذوو الإعاقة</option><option>طلاب</option><option>غارمون</option></datalist>
          <Field label="عدد أفراد الأسرة"><NumInput value={f.familySize} onChange={set("familySize")} /></Field>
          <Field label="البنك"><Input value={f.bankName} onChange={set("bankName")} /></Field>
          <Field label="الآيبان"><Input value={f.iban} onChange={set("iban")} dir="ltr" placeholder="SA.." /></Field>
          <Field label="حالة الملف"><Select value={f.benefStatus} onChange={set("benefStatus")}><option value="ACTIVE">نشط</option><option value="INACTIVE">موقوف</option></Select></Field>
        </>}
        <Field label="ملاحظات" span2><Input value={f.notes} onChange={set("notes")} /></Field>
      </div>
    </Modal>
  );
}

function HistoryModal({ role, p, onClose }: { role: "DONOR" | "BENEFICIARY"; p: any; onClose: () => void }) {
  const { settings } = useCharity();
  const { data } = useFetch(`/charity/people/${p.id}/history`);
  const [pr, setPr] = useState<any>(null);
  const list = role === "DONOR" ? data?.receipts : data?.disbursements;
  const ok = (list || []).filter((x: any) => x.status === "POSTED");
  const [certYear, setCertYear] = useState("");
  const [cert, setCert] = useState<any>(null);
  return (
    <Modal title={`${role === "DONOR" ? "سجل تبرعات" : "سجل مساعدات"}: ${p.name}`} wide onClose={onClose} footer={<>{role === "DONOR" && data && <><select className="input" style={{ width: 150 }} value={certYear} onChange={(e) => setCertYear(e.target.value)}><option value="">كل السنوات</option>{data.byYear.map((y: any) => <option key={y.year} value={y.year}>{y.year}</option>)}</select><button className="btn primary" onClick={() => { const list = ok.filter((x: any) => !certYear || String(x.date).startsWith(certYear)); const amt = list.reduce((a: number, x: any) => a + Number(x.amount), 0); setCert(donorCertData(p.name, amt, certYear ? `عام ${certYear}م` : list.length ? `من ${fmtDate(list[list.length - 1].date)} إلى ${fmtDate(list[0].date)}` : "")); }}>🎖 شهادة شكر وتقدير</button></>}<button className="btn" onClick={() => window.print()}>🖨 طباعة الكشف</button><PdfBtn className="btn" name={`كشف ${p.name}`} /><button className="btn" onClick={onClose}>إغلاق</button></>}>
      {!data ? <Loading /> : <div className="print-doc stmt">
        <div className="head"><div className="row"><img className="ch-print-logo" src={settings?.logoUrl || DEFAULT_LOGO} alt="" /><div><h2>{settings?.associationName}</h2><div className="small">{settings?.licenseNo ? `ترخيص رقم ${settings.licenseNo}` : ""}</div></div></div><div style={{ textAlign: "left" }}><h3>{role === "DONOR" ? "كشف تبرعات" : "كشف مساعدات"}</h3><div>{p.name} — {p.code}</div><div className="small">تاريخ الطباعة {today()}</div></div></div>
        {role === "DONOR" && data.byYear.length > 0 && <div className="row mb">{data.byYear.map((y: any) => <div key={y.year} className="badge teal" style={{ fontSize: 13 }}>{y.year}: {money(y.total)} ({y.count})</div>)}</div>}
        <table><thead><tr><th>الرقم</th><th>التاريخ</th><th>{role === "DONOR" ? "المصدر" : "السبب"}</th><th>المشروع</th><th>الطريقة</th><th>المبلغ</th><th>الحالة</th><th className="no-print" /></tr></thead>
          <tbody>{(list || []).map((x: any) => <tr key={x.id}><td>{x.number}</td><td>{fmtDate(x.date)}</td><td>{role === "DONOR" ? SOURCE[x.source] : x.reason}</td><td>{x.projectName || "—"}</td><td>{role === "DONOR" ? METHOD[x.method] : KIND[x.kind]}</td><td className="num"><Money v={x.amount} /></td><td>{DOC_ST[x.status]}</td><td className="no-print"><button className="btn sm" onClick={() => setPr(x)}>🖨</button></td></tr>)}</tbody>
          <tfoot><tr><td colSpan={5}>الإجمالي ({ok.length} سند) — {words(ok.reduce((a: number, x: any) => a + Number(x.amount), 0))}</td><td className="num"><Money v={ok.reduce((a: number, x: any) => a + Number(x.amount), 0)} /></td><td colSpan={2} /></tr></tfoot></table>
        {role === "DONOR" && <p className="mt">تتقدم {settings?.associationName} بالشكر والتقدير على دعمكم المتواصل، سائلين الله أن يجعله في موازين حسناتكم.</p>}
      </div>}
      {cert && <PrintModal tplKey="donorCert" data={cert} settings={settings} onClose={() => setCert(null)} />}
      {pr && <PrintModal tplKey={role === "DONOR" ? "receipt" : pr.kind === "CASH" ? "cash" : "voucher"} choices={role === "DONOR" ? ["receipt", "ack"] : ["cash", "voucher", "cheque"]} data={role === "DONOR" ? fromReceipt({ ...pr, payerName: pr.payerName }) : fromDisb(pr)} settings={settings} onClose={() => setPr(null)} />}
    </Modal>
  );
}

// ─── estimated budget ──────────────────────────────────────────────────────
export function BudgetPage() {
  const { can } = useCompanyContext();
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, loading, reload } = useFetch(`/charity/budget${q({ year })}`);
  const [edit, setEdit] = useState<any>(null);
  const [copy, setCopy] = useState(false);
  const { run, busy } = useAction();
  const sec = (kind: string, title: string) => {
    const ls = (data?.lines || []).filter((l: any) => l.kind === kind);
    const t = kind === "REVENUE" ? data?.revenue : data?.expense;
    return <>
      <tr className="group"><td colSpan={8}>{title}</td></tr>
      {ls.map((l: any) => { const pct = l.pct ?? 0; const over = kind === "EXPENSE" && pct > 100; return <tr key={l.id}>
        <td>{l.name}<div className="small muted num">{l.accountCode} {l.accountName}</div></td><td>{l.projectName || "عام"}</td>
        <td className="n"><Money v={l.amount} /></td><td className="n"><Money v={l.actual} /></td><td className={"n " + (l.variance < 0 && kind === "EXPENSE" ? "neg-val" : "")}><Money v={l.variance} /></td>
        <td style={{ minWidth: 130 }}><div className="progress"><div style={{ width: Math.min(100, pct) + "%", background: over ? "var(--danger)" : undefined }} /></div><span className="small muted">{l.pct === null ? "—" : `${pct}%`}</span></td>
        <td className="small muted">{l.notes}</td>
        <td className="row no-print" style={{ gap: 4 }}>{can("accounting.write") && <><button className="btn sm" onClick={() => setEdit(l)}>تعديل</button><button className="btn sm ghost" disabled={busy} onClick={() => confirmDlg("حذف البند؟") && run(async () => { await api(`/charity/budget/lines/${l.id}`, { method: "DELETE" }); reload(); })}>✕</button></>}</td>
      </tr>; })}
      <tr className="sub"><td colSpan={2}><b>إجمالي {title}</b></td><td className="n"><b><Money v={t?.budget} /></b></td><td className="n"><b><Money v={t?.actual} /></b></td><td className="n"><b><Money v={(t?.budget || 0) - (t?.actual || 0)} /></b></td><td colSpan={3} /></tr>
    </>;
  };
  return (
    <div className="card">
      <div className="card-h"><h3>الموازنة التقديرية {year}</h3><div className="row no-print">
        <Select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 110 }}>{[-2, -1, 0, 1, 2].map((d) => { const y = new Date().getFullYear() + d; return <option key={y} value={y}>{y}</option>; })}</Select>
        <button className="btn sm" onClick={() => window.print()}>🖨 طباعة</button><PdfBtn name={`الموازنة التقديرية ${year}`} />
        {data && <button className="btn sm" onClick={() => exportExcel(data.lines.map((l: any) => ({ النوع: l.kind === "REVENUE" ? "إيرادات" : "مصروفات", البند: l.name, الحساب: `${l.accountCode} ${l.accountName}`, المشروع: l.projectName || "عام", المقدر: l.amount, الفعلي: l.actual, الانحراف: l.variance, "نسبة التنفيذ %": l.pct })), `الموازنة-${year}`)}>⬇ Excel</button>}
        {can("accounting.write") && <><button className="btn sm" onClick={() => setCopy(true)}>نسخ من سنة سابقة</button><button className="btn primary" onClick={() => setEdit({ year })}>＋ بند موازنة</button></>}
      </div></div>
      {loading && !data ? <Loading /> : !data?.lines.length ? <Empty text="لا توجد بنود — أضف بنود الإيرادات المتوقعة (تبرعات، منح، اشتراكات) والمصروفات المخططة لكل برنامج" /> : <>
        <div className="card-b grid c3">
          <Kpi label="الإيرادات المقدرة / الفعلية" v={data.revenue.actual} icon="💚" sub={<>من <Money v={data.revenue.budget} /></>} />
          <Kpi label="المصروفات المقدرة / الفعلية" v={data.expense.actual} icon="💸" cls="accent" sub={<>من <Money v={data.expense.budget} /></>} />
          <Kpi label="الفائض المقدر / الفعلي" v={data.revenue.actual - data.expense.actual} icon="⚖" cls="info" sub={<>المقدر <Money v={data.revenue.budget - data.expense.budget} /></>} />
        </div>
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>البند</th><th>المشروع</th><th className="n">المقدّر</th><th className="n">الفعلي</th><th className="n">الانحراف</th><th>نسبة التنفيذ</th><th>ملاحظات</th><th /></tr></thead>
          <tbody>{sec("REVENUE", "الإيرادات")}{sec("EXPENSE", "المصروفات")}</tbody>
        </table></div>
      </>}
      {edit && <BudgetLineModal init={edit} onClose={(ok) => { setEdit(null); if (ok) reload(); }} />}
      {copy && <Modal title="نسخ موازنة" narrow onClose={() => setCopy(false)} footer={<button className="btn primary" disabled={busy} onClick={() => run(async () => { const el = document.getElementById("cp-from") as HTMLSelectElement; const g = document.getElementById("cp-g") as HTMLInputElement; const a = document.getElementById("cp-a") as HTMLInputElement; await api("/charity/budget/copy", { body: { from: Number(el.value), to: year, growthPct: Number(g.value || 0), fromActual: a.checked } }); setCopy(false); reload(); }, "تم النسخ")}>نسخ إلى {year}</button>}>
        <Field label="من سنة"><Select id="cp-from" defaultValue={year - 1}>{[1, 2, 3].map((d) => <option key={d} value={year - d}>{year - d}</option>)}</Select></Field>
        <Field label="نسبة الزيادة %"><Input id="cp-g" type="number" defaultValue="0" /></Field>
        <label className="row mt" style={{ gap: 6 }}><input id="cp-a" type="checkbox" />استخدام الفعلي بدلاً من المقدّر</label>
        <div className="alert warn mt small">سيتم استبدال بنود موازنة {year} الحالية.</div>
      </Modal>}
    </div>
  );
}

function BudgetLineModal({ init, onClose }: { init: any; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const [acc, setAcc] = useState<any>(init.accountId ? { id: init.accountId, code: init.accountCode, nameAr: init.accountName } : null);
  const [f, setF] = useState<any>({ year: init.year, name: init.name || "", projectId: init.projectId || "", amount: init.amount || "", notes: init.notes || "" });
  return (
    <Modal title={init.id ? "تعديل بند موازنة" : "بند موازنة جديد"} onClose={() => onClose()} footer={<><button className="btn primary" disabled={busy} onClick={() => run(async () => { const body = { ...f, accountId: acc?.id }; if (init.id) await api(`/charity/budget/lines/${init.id}`, { method: "PUT", body }); else await api("/charity/budget/lines", { body }); onClose(true); }, "تم الحفظ")}>حفظ</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <div className="grid c2">
        <Field label="الحساب (إيراد أو مصروف)" span2><Picker value={acc} onChange={setAcc} fetcher={accountFetcher((a) => a.type === "REVENUE" || a.type === "EXPENSE")} label={acLabel} /></Field>
        <Field label="اسم البند (اختياري)"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="المشروع / البرنامج"><ProjectSelect value={f.projectId} onChange={(v) => setF({ ...f, projectId: v })} all="عام (كل الجمعية)" /></Field>
        <Field label="المبلغ المقدّر للسنة"><NumInput value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="ملاحظات"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

// ─── statement of activities & reports ─────────────────────────────────────
export function ActivitiesPage() {
  const { settings } = useCharity();
  const [from, setFrom] = useState(yearStart()); const [to, setTo] = useState(today());
  const { data, loading } = useFetch(`/charity/activities${q({ from, to })}`);
  const grp: Record<string, string> = { PROGRAM: "مصروفات البرامج والأنشطة", ADMIN: "المصروفات العمومية والإدارية", OTHER: "مصروفات أخرى" };
  return (
    <div>
      <div className="toolbar no-print"><PeriodFilter from={from} to={to} onChange={(a, b) => { setFrom(a || yearStart()); setTo(b || today()); }} /><div className="grow" /><button className="btn sm" onClick={() => window.print()}>🖨 طباعة</button><PdfBtn name="قائمة الأنشطة" />{data && <button className="btn sm" onClick={() => exportExcel([...data.revenues.map((r: any) => ({ القسم: "الإيرادات", الحساب: `${r.code} ${r.nameAr}`, المبلغ: r.amount })), ...data.expenses.map((r: any) => ({ القسم: grp[r.group], الحساب: `${r.code} ${r.nameAr}`, المبلغ: r.amount }))], "قائمة-الأنشطة")}>⬇ Excel</button>}<Link className="btn sm" to="/reports-center">مركز التقارير الكامل ←</Link></div>
      {loading && !data ? <Loading /> : data && <>
        <div className="grid c4 no-print">
          <Kpi label="إجمالي الإيرادات والتبرعات" v={data.totalRevenue} icon="💚" />
          <Kpi label="إجمالي المصروفات" v={data.totalExpense} icon="💸" cls="accent" />
          <Kpi label="التغير في صافي الأصول" v={data.net} icon="⚖" cls={data.net < 0 ? "danger" : "success"} />
          <Kpi label="نسبة الإنفاق على البرامج" v={`${data.programRatio}%`} money={false} icon="🎯" cls="info" sub="من إجمالي المصروفات" />
        </div>
        <div className="grid c2 mt">
          <div className="card"><div className="print-doc stmt">
            <div className="head"><div className="row"><img className="ch-print-logo" src={settings?.logoUrl || DEFAULT_LOGO} alt="" /><div><h2>{settings?.associationName}</h2><div className="small">{settings?.licenseNo && `ترخيص رقم ${settings.licenseNo}`}</div></div></div><div style={{ textAlign: "left" }}><h3>قائمة الأنشطة</h3><div className="small">للفترة من {data.from} إلى {data.to}</div></div></div>
            <table><tbody>
              <tr><th colSpan={2} style={{ textAlign: "start" }}>الإيرادات والتبرعات</th></tr>
              {data.revenues.map((r: any) => <tr key={r.code}><td>{r.nameAr} <span className="small muted">{r.code}</span></td><td className="num"><Money v={r.amount} /></td></tr>)}
              <tr><td><b>إجمالي الإيرادات</b></td><td className="num"><b><Money v={data.totalRevenue} /></b></td></tr>
              {["PROGRAM", "ADMIN", "OTHER"].map((g) => { const ls = data.expenses.filter((e: any) => e.group === g); if (!ls.length) return null; return <React.Fragment key={g}><tr><th colSpan={2} style={{ textAlign: "start" }}>{grp[g]}</th></tr>{ls.map((r: any) => <tr key={r.code}><td>{r.nameAr} <span className="small muted">{r.code}</span></td><td className="num"><Money v={r.amount} /></td></tr>)}</React.Fragment>; })}
              <tr><td><b>إجمالي المصروفات</b></td><td className="num"><b><Money v={data.totalExpense} /></b></td></tr>
              <tr><td><b>التغير في صافي الأصول (فائض / عجز)</b></td><td className="num"><b><Money v={data.net} sign /></b></td></tr>
            </tbody></table>
            <div className="small mt">منها تبرعات مقيدة: <Money v={data.restricted.restricted} /> — غير مقيدة: <Money v={data.restricted.unrestricted} /></div>
          </div></div>
          <div className="card"><div className="card-h"><h3>الأموال حسب المشروع / البرنامج</h3></div><div className="table-wrap"><table className="tbl compact"><thead><tr><th>المشروع</th><th className="n">المقبوض</th><th className="n">المصروف</th><th className="n">الرصيد المتاح</th></tr></thead><tbody>{data.byProject.map((p: any) => <tr key={p.code}><td>{p.name}{p.restricted && <span className="badge amber" style={{ marginInlineStart: 4 }}>مقيد</span>}</td><td className="n"><Money v={p.received} /></td><td className="n"><Money v={p.spent} /></td><td className="n"><b><Money v={p.balance} sign /></b></td></tr>)}</tbody></table>{!data.byProject.length && <Empty />}</div>
            <div className="card-b no-print"><h4 style={{ marginBottom: 8 }}>تقارير إضافية</h4><div className="row" style={{ gap: 6 }}>
              <Link className="btn sm" to="/reports">القوائم المالية</Link><Link className="btn sm" to="/reports/cost-centers">الأرباح حسب مراكز التكلفة (المشاريع)</Link><Link className="btn sm" to="/reports-center">مركز التقارير (58 تقريراً)</Link><Link className="btn sm" to="/charity/archive">أرشيف المستندات</Link>
            </div></div>
          </div>
        </div>
      </>}
    </div>
  );
}
