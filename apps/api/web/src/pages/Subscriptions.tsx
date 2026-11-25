/**
 * 3.51.0 — the subscriptions module: dashboard (MRR, churn, renewals, past due), plans, subscribers, one subscriber's
 * page (change plan, pause, resume, cancel), the check-in desk and the usage report.
 */
import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, useFetch, useAction, useCompanyContext, Modal, Field, Input, Select, NumInput, Money, money, Loading, Empty, DateRange, ExportBtn, PrintBtn, Picker, partnerFetcher, today, useNewParam, confirmDlg } from "../lib";

export const SUB_ST: Record<string, string> = { TRIAL: "تجربة مجانية", ACTIVE: "ساري", PAUSED: "موقوف مؤقتاً", CANCELLED: "ملغى", EXPIRED: "منتهٍ" };
const SUB_COLOR: Record<string, string> = { TRIAL: "blue", ACTIVE: "green", PAUSED: "amber", CANCELLED: "red", EXPIRED: "gray" };
const SubBadge = ({ s }: { s: string }) => <span className={"badge " + (SUB_COLOR[s] || "gray")}>{SUB_ST[s] || s}</span>;
export const PERIOD_L: Record<string, string> = { WEEK: "أسبوعي", MONTH: "شهري", QUARTER: "ربع سنوي", HALF: "نصف سنوي", YEAR: "سنوي" };
const MV: Record<string, string> = { START: "بداية", INVOICE: "فاتورة", CREDIT: "إشعار دائن", PAUSE: "إيقاف مؤقت", RESUME: "استئناف", CHANGE: "تغيير الخطة", CANCEL: "إلغاء", EXPIRE: "انتهاء" };
const waLink = (phone: string, text: string) => { let p = String(phone || "").replace(/\D/g, ""); if (p.startsWith("05")) p = "966" + p.slice(1); else if (p.startsWith("01") && p.length === 11) p = "20" + p.slice(1); return `https://wa.me/${p}?text=${encodeURIComponent(text)}`; };

// ───────────────────────── dashboard ─────────────────────────
export function SubsDashboard() {
  const { can } = useCompanyContext();
  const { data, reload } = useFetch<any>("/subs/dashboard");
  const plans = useFetch<any[]>("/subs/plans");
  const { run, busy } = useAction();
  const nav = useNavigate();
  if (!data || !plans.data) return <Loading />;
  const K = data.counts;
  const list = (rows: any[], empty: string, extra?: (s: any) => React.ReactNode) => !rows.length ? <Empty text={empty} /> : <table className="tbl compact"><tbody>{rows.map((s: any) => <tr key={s.id} className="clickable" onClick={() => nav(`/subs/${s.id}`)}><td className="num">{s.number}</td><td>{s.partnerName}</td><td className="small">{s.planName}</td><td className="small">{extra ? extra(s) : null}</td></tr>)}</tbody></table>;
  const top = Math.max(1, ...data.trend.map((x: any) => x.mrr));
  return (
    <div className="grid" data-subs-dash>
      {!plans.data.length && <div className="card mfg-start" data-subs-start><h3>ابدأ الاشتراكات</h3>
        <ol className="mfg-steps"><li><b>الخطة</b>: المدة (شهر، ربع سنة، سنة…) والسعر، ورسوم التأسيس، والتجربة المجانية، وحد الزيارات أو الاستخدام. <Link to="/subs/plans?new=1">أضف خطة</Link></li>
          <li><b>المشترك</b>: العميل والخطة والعدد؛ تصدر الفاتورة في أول كل فترة تلقائياً. <Link to="/subs/list?new=1">مشترك جديد</Link></li>
          <li><b>الحضور والتجديد</b>: تسجيل الدخول برقم الجوال، والتذكير بالتجديد والمتأخرات بالواتساب.</li></ol>
        {can("sales.write") && <button className="btn" disabled={busy} data-subs-example onClick={() => run(async () => { await api("/subs-example", { body: {} }); reload(); plans.reload(); }, "حُمّل مثال الاشتراكات")}>تحميل مثال جاهز (نادٍ رياضي وبرنامج سحابي وصندوق قهوة)</button>}</div>}
      <div className="fc-kpis" data-subs-kpis>
        <div className="fc-kpi good" data-subs-mrr><span>الإيراد الشهري المتكرر (MRR)</span><b className="num">{money(data.mrr)}</b><small>سنوياً {money(data.arr)} · متوسط المشترك {money(data.arpu)}</small></div>
        <div className="fc-kpi"><span>مشتركون ساريون</span><b className="num">{K.active}</b><small>{K.trial} تجربة · {K.paused} موقوف</small></div>
        <div className={"fc-kpi" + (data.churn.ratePct > 5 ? " high" : "")} data-subs-churn><span>معدل الإلغاء (30 يوماً)</span><b className="num">{data.churn.ratePct}%</b><small>{data.churn.lost} من {data.churn.base} · {data.fresh} جديد</small></div>
        <div className="fc-kpi"><span>إيراد الاشتراكات هذا الشهر</span><b className="num">{money(data.month.revenue)}</b></div>
        <div className="fc-kpi"><span>إيراد مؤجل لم يُستحق</span><b className="num">{money(data.deferredLeft)}</b><small>من الخطط الأطول من شهر</small></div>
        <div className={"fc-kpi" + (data.pastDue.length ? " high" : "")}><span>متأخرون عن السداد</span><b className="num">{data.pastDue.length}</b></div>
      </div>
      {data.billingDue > 0 && can("sales.write") && <div className="alert warn row" style={{ alignItems: "center", gap: 10 }}><span>{data.billingDue} اشتراك حلّ موعد فاتورته.</span><button className="btn sm" disabled={busy} onClick={() => run(async () => { await api("/subs-bill-due", { body: {} }); reload(); }, "صدرت الفواتير المستحقة")}>إصدار الفواتير الآن</button></div>}
      <div className="grid c2">
        <div className="card"><div className="card-h"><h3>الإيراد الشهري المتكرر — آخر 6 أشهر</h3></div>
          <div className="row" style={{ alignItems: "flex-end", gap: 10, height: 140 }} data-subs-trend>{data.trend.map((x: any) => <div key={x.month} style={{ flex: 1, textAlign: "center" }}><div className="small num">{money(x.mrr)}</div><div style={{ height: `${Math.round((x.mrr / top) * 100)}px`, background: "var(--primary, #0f766e)", borderRadius: 4, minHeight: 2 }} /><div className="small muted">{x.month}</div></div>)}</div></div>
        <div className="card"><div className="card-h"><h3>حسب الخطة</h3><Link className="btn sm ghost" to="/subs/plans">الخطط</Link></div>{!data.byPlan.length ? <Empty text="لا مشتركين" /> : <table className="tbl compact"><thead><tr><th>الخطة</th><th className="n">المشتركون</th><th className="n">الإيراد الشهري</th></tr></thead><tbody>{data.byPlan.map((p: any) => <tr key={p.id}><td>{p.name} <span className="small muted">{PERIOD_L[p.period]}</span></td><td className="n">{p.subscribers}</td><td className="n"><Money v={p.mrr} /></td></tr>)}</tbody></table>}</div>
      </div>
      <div className="grid c2">
        <div className="card"><div className="card-h"><h3>متأخرون عن السداد</h3></div>{list(data.pastDue, "لا متأخرات", (s) => <span className="neg-val">{money(s.due)} منذ {s.dueSince}{s.partnerPhone ? <> · <a href={waLink(s.partnerPhone, `عميلنا العزيز، على اشتراككم ${s.number} (${s.planName}) مبلغ ${money(s.due)} مستحق منذ ${s.dueSince}. نرجو السداد لاستمرار الخدمة.`)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>تذكير واتساب</a></> : null}</span>)}</div>
        <div className="card"><div className="card-h"><h3>تجديد خلال 7 أيام</h3></div>{list(data.renewSoon, "لا تجديدات قريبة", (s) => <span>{s.currentTo}{s.ending ? <b className="neg-val"> · لن يتجدد</b> : ""}{s.partnerPhone ? <> · <a href={waLink(s.partnerPhone, s.ending ? `عميلنا العزيز، ينتهي اشتراككم ${s.number} (${s.planName}) في ${s.currentTo}. يسعدنا تجديده.` : `عميلنا العزيز، يتجدد اشتراككم ${s.number} (${s.planName}) في ${s.currentTo} بمبلغ ${money(s.value)}.`)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>واتساب</a></> : null}</span>)}</div>
      </div>
      <div className="grid c2">
        <div className="card"><div className="card-h"><h3>تجارب تنتهي خلال 7 أيام</h3></div>{list(data.trialsEnding, "لا تجارب قريبة الانتهاء", (s) => `حتى ${s.trialEnd}`)}</div>
        <div className="card"><div className="card-h"><h3>موقوفون مؤقتاً</h3></div>{list(data.paused, "لا أحد", (s) => s.pausedUntil ? `حتى ${s.pausedUntil}` : "حتى الاستئناف")}</div>
      </div>
      <div className="card small muted">القيود: فترة شهر أو أقل من ح/ العميل إلى ح/ إيرادات الاشتراكات وضريبة المخرجات. الفترة الأطول (ربع سنة، سنة) إيراد مقبوض مقدماً: من ح/ العميل إلى ح/ إيرادات مؤجلة، ثم يُستحق كل شهر من ح/ إيرادات مؤجلة إلى ح/ إيرادات الاشتراكات (IFRS 15). الإلغاء بإشعار دائن للأيام غير المستخدمة.</div>
    </div>
  );
}

// ───────────────────────── plans ─────────────────────────
export function SubPlansPage() {
  const { can } = useCompanyContext();
  const { data, reload } = useFetch<any[]>("/subs/plans");
  const [edit, setEdit] = useState<any>(null);
  useNewParam(() => setEdit({}));
  return (
    <div className="grid" data-subs-plans>
      <div className="card"><div className="row" style={{ gap: 8, alignItems: "center" }}><div className="grow" />
        {can("sales.write") && <button className="btn primary" data-plan-new onClick={() => setEdit({})}>＋ خطة اشتراك</button>}</div></div>
      <div className="card">{!data ? <Loading /> : !data.length ? <Empty text="لا خطط اشتراك" /> : <div className="table-wrap"><table className="tbl" data-plan-table>
        <thead><tr><th>الرمز</th><th>الخطة</th><th>المدة</th><th className="n">السعر</th><th className="n">شهرياً</th><th className="n">التأسيس</th><th className="n">التجربة</th><th>الحد في الفترة</th><th className="n">المشتركون</th><th className="n">MRR</th></tr></thead>
        <tbody>{data.map((p) => <tr key={p.id} className={"clickable" + (p.isActive ? "" : " muted")} data-plan-row={p.code} onClick={() => setEdit(p)}>
          <td className="num">{p.code}</td><td><b>{p.name}</b>{p.category && <div className="small muted">{p.category}</div>}</td><td>{PERIOD_L[p.period]}{p.deferred && <div className="small muted">إيراد مؤجل</div>}</td><td className="n"><Money v={p.price} /></td><td className="n small">{money(p.monthly)}</td><td className="n">{p.setupFee ? money(p.setupFee) : "—"}</td><td className="n">{p.trialDays ? `${p.trialDays} يوم` : "—"}</td>
          <td className="small">{p.quota !== null ? `${p.quota} ${p.quotaUnit || ""}${p.overagePrice ? ` · الزائد ${money(p.overagePrice)}` : " · يُمنع الزائد"}` : "غير محدود"}</td><td className="n">{p.subscribers}</td><td className="n"><Money v={p.mrr} /></td></tr>)}</tbody></table></div>}</div>
      {edit && <PlanModal init={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </div>
  );
}
function PlanModal({ init, onClose, onDone }: { init: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<any>(() => ({ name: "", code: "", category: "", period: "MONTH", price: 0, setupFee: 0, trialDays: 0, taxCode: "S", quotaUnit: "", overagePrice: 0, graceDays: 7, pausable: true, description: "", isActive: true, ...init, quota: init.quota ?? "" }));
  const { run, busy } = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const long = ["QUARTER", "HALF", "YEAR"].includes(f.period);
  return (
    <Modal title={init.id ? `الخطة ${init.code}` : "خطة اشتراك جديدة"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" data-plan-save disabled={busy || !String(f.name).trim()} onClick={() => run(async () => { await api(init.id ? `/subs/plans/${init.id}` : "/subs/plans", { method: init.id ? "PUT" : "POST", body: f }); onDone(); }, "حُفظت الخطة")}>حفظ</button></>}>
      <div className="grid c2">
        <Field label="الاسم"><Input value={f.name} onChange={set("name")} data-plan-name /></Field>
        <Field label="الفئة"><Input value={f.category || ""} onChange={set("category")} placeholder="نادي رياضي، برمجيات، صيانة…" /></Field>
        <Field label="المدة"><Select value={f.period} onChange={set("period")} data-plan-period>{Object.entries(PERIOD_L).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="السعر للفترة" hint="للمشترك الواحد أو للمستخدم"><NumInput value={f.price} onChange={set("price")} data-plan-price /></Field>
        <Field label="رسوم التأسيس" hint="مرة واحدة مع أول فاتورة"><NumInput value={f.setupFee} onChange={set("setupFee")} /></Field>
        <Field label="أيام التجربة المجانية"><NumInput value={f.trialDays} onChange={set("trialDays")} /></Field>
        <Field label="الحد في الفترة" hint="فارغ = غير محدود"><NumInput value={f.quota} onChange={set("quota")} data-plan-quota /></Field>
        <Field label="وحدة الاستخدام"><Input value={f.quotaUnit || ""} onChange={set("quotaUnit")} placeholder="زيارة، جلسة، وجبة…" /></Field>
        <Field label="سعر الاستخدام فوق الحد" hint="0 = يُمنع بعد الحد"><NumInput value={f.overagePrice} onChange={set("overagePrice")} data-plan-overage /></Field>
        <Field label="أيام السماح للسداد"><NumInput value={f.graceDays} onChange={set("graceDays")} /></Field>
        <Field label="الضريبة"><Select value={f.taxCode} onChange={set("taxCode")}><option value="S">خاضعة</option><option value="Z">صفرية</option><option value="E">معفاة</option><option value="O">خارج النطاق</option></Select></Field>
        <Field label="الرمز" hint="فارغ = تلقائي"><Input value={f.code || ""} onChange={set("code")} /></Field>
      </div>
      <Field label="الوصف"><Input value={f.description || ""} onChange={set("description")} /></Field>
      <div className="row" style={{ gap: 14 }}><label className="check"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> نشطة</label>{!long && <label className="check"><input type="checkbox" checked={f.pausable} onChange={(e) => setF({ ...f, pausable: e.target.checked })} /> تسمح بالإيقاف المؤقت</label>}</div>
      {long && <div className="alert small mt">المدة أطول من شهر: تُسجَّل الفاتورة إيراداً مؤجلاً، ويُستحق جزء كل شهر تلقائياً.</div>}
    </Modal>
  );
}

// ───────────────────────── subscribers ─────────────────────────
export function SubsListPage() {
  const { can } = useCompanyContext();
  const [st, setSt] = useState("LIVE");
  const [q, setQ] = useState("");
  const flag = st === "PAST_DUE" || st === "RENEW" ? st : "";
  const { data, reload } = useFetch<any[]>(`/subs?status=${flag ? "LIVE" : st}&flag=${flag}&q=${encodeURIComponent(q)}`, [st, q]);
  const [neu, setNeu] = useState(false);
  useNewParam(() => setNeu(true));
  const nav = useNavigate();
  return (
    <div className="grid" data-subs-list>
      <div className="card"><div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div className="seg">{[["LIVE", "الساريون"], ["TRIAL", "تجربة"], ["PAUSED", "موقوفون"], ["PAST_DUE", "متأخرون عن السداد"], ["RENEW", "تجديد قريب"], ["CANCELLED", "ملغون"], ["EXPIRED", "منتهون"], ["", "الكل"]].map(([key, l]) => <button key={key} className={st === key ? "on" : ""} onClick={() => setSt(key)}>{l}</button>)}</div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="رقم، اسم أو جوال" style={{ maxWidth: 200 }} /><div className="grow" />
        {data && <ExportBtn rows={() => data.map((s) => ({ "الرقم": s.number, "المشترك": s.partnerName, "الجوال": s.partnerPhone, "الخطة": s.planName, "العدد": s.qty, "القيمة": s.value, "الحالة": SUB_ST[s.status], "حتى": s.currentTo, "المتأخر": s.due }))} name="المشتركون" />}
        {can("sales.write") && <button className="btn primary" data-sub-new onClick={() => setNeu(true)}>＋ مشترك</button>}
      </div></div>
      <div className="card">{!data ? <Loading /> : !data.length ? <Empty text="لا مشتركين" /> : <div className="table-wrap"><table className="tbl" data-sub-table>
        <thead><tr><th>الرقم</th><th>المشترك</th><th>الخطة</th><th className="n">القيمة</th><th>الفترة الحالية</th><th>الاستخدام</th><th className="n">غير المسدد</th><th>الحالة</th></tr></thead>
        <tbody>{data.map((s) => <tr key={s.id} className="clickable" data-sub-row={s.number} onClick={() => nav(`/subs/${s.id}`)}>
          <td className="num"><b>{s.number}</b></td><td>{s.partnerName}{s.partnerPhone && <div className="small muted">{s.partnerPhone}</div>}</td><td>{s.planName}{s.qty !== 1 && ` × ${s.qty}`}<div className="small muted">{PERIOD_L[s.period]}{s.pendingPlanName ? ` · ثم ${s.pendingPlanName}` : ""}</div></td>
          <td className="n"><Money v={s.value} /></td><td className="small">{s.currentFrom ? `${s.currentFrom} ← ${s.currentTo}` : s.nextBillDate ? `يبدأ ${s.nextBillDate}` : "—"}{s.cancelAtPeriodEnd && <div className="neg-val">يُلغى في نهايتها</div>}</td>
          <td className="small">{s.quota !== null ? `${s.used} / ${s.quota}` : s.used ? `${s.used}` : "—"}</td><td className={"n" + (s.pastDue ? " neg-val" : "")}>{s.due ? <Money v={s.due} /> : "—"}</td><td><SubBadge s={s.status} />{s.pastDue && <span className="badge red">متأخر</span>}</td></tr>)}</tbody></table></div>}</div>
      {neu && <NewSubModal onClose={() => setNeu(false)} onDone={(s: any) => { setNeu(false); reload(); nav(`/subs/${s.id}`); }} />}
    </div>
  );
}
function NewSubModal({ onClose, onDone }: { onClose: () => void; onDone: (s: any) => void }) {
  const plans = useFetch<any[]>("/subs/plans");
  const [partner, setPartner] = useState<any>(null);
  const [f, setF] = useState<any>({ planId: "", startDate: today(), qty: 1, discountPct: 0, price: "", endDate: "", autoRenew: true, trial: true, waiveSetup: false, notes: "" });
  const { run, busy } = useAction();
  const active = (plans.data || []).filter((p: any) => p.isActive);
  useEffect(() => { if (!f.planId && active[0]) setF((x: any) => ({ ...x, planId: active[0].id })); }, [plans.data]);
  const plan = active.find((p: any) => p.id === f.planId);
  const price = f.price === "" ? plan?.price || 0 : Number(f.price);
  const value = Math.round(price * Number(f.qty || 0) * (1 - Number(f.discountPct || 0) / 100) * 100) / 100;
  return (
    <Modal title="مشترك جديد" onClose={onClose} footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" data-sub-save disabled={busy || !partner || !plan} onClick={() => run(async () => onDone(await api("/subs", { body: { ...f, partnerId: partner.id, price: f.price === "" ? undefined : Number(f.price), endDate: f.endDate || null } })), "حُفظ الاشتراك")}>حفظ الاشتراك</button></>}>
      <Field label="المشترك (العميل)"><Picker value={partner} onChange={setPartner} fetcher={partnerFetcher("CUSTOMER")} label={(p: any) => p.name} placeholder="ابحث عن العميل" /></Field>
      <div className="grid c2">
        <Field label="الخطة"><Select value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })} data-sub-plan>{active.map((p: any) => <option key={p.id} value={p.id}>{p.name} — {money(p.price)} {PERIOD_L[p.period]}</option>)}</Select></Field>
        <Field label="تاريخ البداية"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} data-sub-start /></Field>
        <Field label="العدد" hint="مستخدمون، مقاعد، وحدات"><NumInput value={f.qty} onChange={(e: any) => setF({ ...f, qty: e.target.value })} data-sub-qty /></Field>
        <Field label="خصم %"><NumInput value={f.discountPct} onChange={(e: any) => setF({ ...f, discountPct: e.target.value })} /></Field>
        <Field label="سعر متفق عليه" hint="فارغ = سعر الخطة"><NumInput value={f.price} onChange={(e: any) => setF({ ...f, price: e.target.value })} placeholder={plan ? String(plan.price) : ""} /></Field>
        <Field label="نهاية محددة" hint="فارغ = يتجدد حتى الإلغاء"><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
      </div>
      {plan && <div className="alert small" data-sub-summary>قيمة الفترة {money(value)} ({PERIOD_L[plan.period]}){plan.setupFee && !f.waiveSetup ? ` + رسوم التأسيس ${money(plan.setupFee)}` : ""}{plan.trialDays && f.trial ? ` · تجربة مجانية ${plan.trialDays} يوماً ثم الفاتورة الأولى` : " · تصدر الفاتورة الأولى الآن"}{plan.deferred ? " · إيراد مؤجل يُستحق شهرياً" : ""}</div>}
      <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
        <label className="check"><input type="checkbox" checked={f.autoRenew} onChange={(e) => setF({ ...f, autoRenew: e.target.checked })} /> تجديد تلقائي</label>
        {plan?.trialDays > 0 && <label className="check"><input type="checkbox" checked={f.trial} onChange={(e) => setF({ ...f, trial: e.target.checked })} /> مع التجربة المجانية</label>}
        {plan?.setupFee > 0 && <label className="check"><input type="checkbox" checked={f.waiveSetup} onChange={(e) => setF({ ...f, waiveSetup: e.target.checked })} /> إعفاء من رسوم التأسيس</label>}
      </div>
    </Modal>
  );
}

export function SubPage() {
  const { id } = useParams();
  const { can } = useCompanyContext();
  const { data: s, reload, error } = useFetch<any>(`/subs/${id}`, [id]);
  const [m, setM] = useState<string | null>(null);
  const { run, busy } = useAction();
  if (error) return <div className="card"><Empty text={error} /></div>;
  if (!s) return <Loading />;
  const W = can("sales.write");
  const live = ["TRIAL", "ACTIVE", "PAUSED"].includes(s.status);
  const done = () => { setM(null); reload(); };
  return (
    <div className="grid" data-sub={s.number}>
      <div className="card">
        <div className="row between" style={{ flexWrap: "wrap", gap: 10 }}>
          <div><div className="row" style={{ gap: 8, alignItems: "center" }}><h2 style={{ margin: 0 }} className="num">{s.number}</h2><SubBadge s={s.status} />{s.pastDue && <span className="badge red">متأخر عن السداد</span>}{s.cancelAtPeriodEnd && <span className="badge amber">يُلغى في {s.currentTo}</span>}</div>
            <div className="mt"><b>{s.partnerName}</b>{s.partnerPhone && <span className="muted"> · {s.partnerPhone}</span>}</div>
            <div className="small muted">{s.planName}{s.qty !== 1 ? ` × ${s.qty}` : ""} · {PERIOD_L[s.period]} · بدأ {s.startDate}{s.trialEnd ? ` · التجربة حتى ${s.trialEnd}` : ""}{s.endDate ? ` · ينتهي ${s.endDate}` : ""}{!s.autoRenew ? " · بلا تجديد تلقائي" : ""}{s.nextBillDate ? ` · الفاتورة القادمة ${s.nextBillDate}` : ""}{s.pendingPlanName ? ` · من الفترة القادمة: ${s.pendingPlanName}${s.pendingQty && s.pendingQty !== s.qty ? ` × ${s.pendingQty}` : ""}` : ""}{s.pausedFrom ? ` · موقوف من ${s.pausedFrom}${s.pausedUntil ? ` حتى ${s.pausedUntil}` : ""}` : ""}{s.cancelledDate ? ` · أُلغي ${s.cancelledDate}` : ""}{s.cancelReason ? ` (${s.cancelReason})` : ""}</div></div>
          <div className="row no-print" style={{ gap: 6, flexWrap: "wrap" }}>
            {W && ["TRIAL", "ACTIVE"].includes(s.status) && s.nextBillDate && s.nextBillDate <= today() && <button className="btn" disabled={busy} data-sub-bill onClick={() => run(async () => { await api(`/subs/${s.id}/bill`, { body: {} }); reload(); }, "صدرت الفاتورة المستحقة")}>فاتورة الفترة</button>}
            {W && ["TRIAL", "ACTIVE"].includes(s.status) && <button className="btn" disabled={busy} data-sub-change onClick={() => setM("change")}>تغيير الخطة</button>}
            {W && s.status === "ACTIVE" && ["WEEK", "MONTH"].includes(s.period) && <button className="btn" disabled={busy} data-sub-pause onClick={() => setM("pause")}>إيقاف مؤقت</button>}
            {W && s.status === "PAUSED" && <button className="btn primary" disabled={busy} data-sub-resume onClick={() => run(async () => { await api(`/subs/${s.id}/resume`, { body: {} }); reload(); }, "استُؤنف الاشتراك")}>استئناف</button>}
            {W && live && <button className="btn ghost danger" disabled={busy} data-sub-cancel onClick={() => setM("cancel")}>إلغاء الاشتراك</button>}
            <PrintBtn pdfName={s.number} />
          </div>
        </div>
        <div className="fc-kpis mt" data-sub-kpis>
          <div className="fc-kpi"><span>قيمة الفترة</span><b className="num">{money(s.value)}</b><small>{s.discountPct ? `بعد خصم ${s.discountPct}%` : "قبل الضريبة"}{s.mrr ? ` · شهرياً ${money(s.mrr)}` : ""}</small></div>
          <div className="fc-kpi"><span>الفترة الحالية</span><b className="num small">{s.currentFrom ? `${s.currentFrom} ← ${s.currentTo}` : "—"}</b></div>
          <div className="fc-kpi" data-sub-used><span>الاستخدام في الفترة</span><b className="num">{s.quota !== null ? `${s.used} / ${s.quota}` : s.used}</b><small>{s.quotaUnit || ""}{s.quota !== null ? ` · الباقي ${Math.max(0, s.quota - s.used)}` : " · غير محدود"}</small></div>
          <div className={"fc-kpi" + (s.due > 0 ? " high" : " good")}><span>غير المسدد</span><b className="num">{money(s.due)}</b><small>المفوتر {money(s.billed)}</small></div>
          {s.deferred.length > 0 && <div className="fc-kpi" data-sub-deferred><span>إيراد مؤجل باقٍ</span><b className="num">{money(s.deferredLeft)}</b><small>يُستحق شهرياً</small></div>}
        </div>
      </div>
      <div className="grid c2">
        <div className="card"><div className="card-h"><h3>الفواتير والإشعارات</h3></div>{!s.invoices.length ? <Empty text={s.status === "TRIAL" ? `لا فواتير في التجربة — الأولى في ${s.nextBillDate}` : "لا فواتير"} /> : <table className="tbl compact" data-sub-invoices><thead><tr><th>المستند</th><th>الفترة</th><th className="n">الصافي</th><th className="n">الإجمالي</th><th className="n">المتبقي</th></tr></thead><tbody>{s.invoices.map((i: any) => <tr key={i.id + i.date}><td><Link to={`/doc/${i.id}`} className="num">{i.number}</Link>{i.kind === "CREDIT_NOTE" && <span className="small muted"> إشعار دائن</span>}</td><td className="small">{i.from ? `${i.from} ← ${i.to}` : "—"}</td><td className="n"><Money v={i.net} /></td><td className="n"><Money v={i.total} /></td><td className="n">{i.kind === "CREDIT_NOTE" ? "" : i.due ? <Money v={i.due} /> : "✓"}</td></tr>)}</tbody></table>}
          {s.deferred.length > 0 && <table className="tbl compact mt"><thead><tr><th>جدول الإيراد المؤجل</th><th className="n">الإجمالي</th><th className="n">استُحق</th><th className="n">الباقي</th></tr></thead><tbody>{s.deferred.map((d: any) => <tr key={d.id}><td><Link to="/amortization" className="num">{d.number}</Link></td><td className="n"><Money v={d.total} /></td><td className="n"><Money v={d.earned} /></td><td className="n"><Money v={d.left} /></td></tr>)}</tbody></table>}</div>
        <div className="card"><div className="card-h"><h3>السجل</h3></div><table className="tbl compact" data-sub-moves><tbody>{s.moves.map((x: any) => <tr key={x.id}><td className="small">{x.date}</td><td>{MV[x.kind] || x.kind}</td><td className="n">{x.amount ? <Money v={x.amount} /> : ""}</td><td className="small">{x.notes || ""}</td></tr>)}</tbody></table></div>
      </div>
      <div className="card"><div className="card-h"><h3>الحضور والاستخدام</h3>{live && <Link className="btn sm" to={`/subs/checkin?q=${encodeURIComponent(s.number)}`}>تسجيل حضور</Link>}</div>{!s.usage.length ? <Empty text="لا استخدام مسجّل" /> : <table className="tbl compact"><tbody>{s.usage.map((u: any) => <tr key={u.id}><td className="small">{u.date} {new Date(u.at).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}</td><td className="n">{u.qty}</td><td className="small">{u.overage ? <span className="badge amber">فوق الحد{u.billed ? " — فُوتر" : ""}</span> : ""} {u.note || ""}</td><td className="small muted">{u.createdBy}</td><td>{W && !u.billed && <button className="btn sm ghost danger" onClick={() => run(async () => { if (!confirmDlg("حذف هذا الاستخدام؟")) return; await api(`/subs-usage/${u.id}`, { method: "DELETE" }); reload(); })}>حذف</button>}</td></tr>)}</tbody></table>}</div>
      {s.notes && <div className="card small"><b>ملاحظات:</b> {s.notes}</div>}
      {m === "change" && <ChangeModal s={s} onClose={() => setM(null)} onDone={done} />}
      {m === "pause" && <PauseModal s={s} onClose={() => setM(null)} onDone={done} />}
      {m === "cancel" && <CancelModal s={s} onClose={() => setM(null)} onDone={done} />}
    </div>
  );
}
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
function ChangeModal({ s, onClose, onDone }: any) {
  const plans = useFetch<any[]>("/subs/plans");
  const [f, setF] = useState<any>({ planId: s.planId, qty: s.qty });
  const { run, busy } = useAction();
  const plan = (plans.data || []).find((p: any) => p.id === f.planId);
  const oldV = s.price * s.qty, newV = plan ? plan.price * Number(f.qty || 0) : 0;
  const now = s.status === "ACTIVE" && plan && plan.period === s.period && newV > oldV && s.currentTo && today() <= s.currentTo;
  const left = now ? dayDiff(today(), s.currentTo) : 0, span = s.currentFrom && s.currentTo ? dayDiff(s.currentFrom, s.currentTo) : 1;
  const charge = now ? Math.round((((newV - oldV) * (1 - s.discountPct / 100) * left) / span) * 100) / 100 : 0;
  return <Modal title={`تغيير خطة ${s.number}`} onClose={onClose} narrow footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" data-change-save disabled={busy || !plan || (plan.id === s.planId && Number(f.qty) === s.qty)} onClick={() => run(async () => { await api(`/subs/${s.id}/change`, { body: f }); onDone(); }, "غُيّرت الخطة")}>تغيير</button></>}>
    <Field label="الخطة"><Select value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })} data-change-plan>{(plans.data || []).filter((p: any) => p.isActive).map((p: any) => <option key={p.id} value={p.id}>{p.name} — {money(p.price)} {PERIOD_L[p.period]}</option>)}</Select></Field>
    <Field label="العدد"><NumInput value={f.qty} onChange={(e: any) => setF({ ...f, qty: e.target.value })} data-change-qty /></Field>
    {plan && <div className="alert small" data-change-note>{s.status === "TRIAL" ? "خلال التجربة: تُطبَّق الخطة الجديدة فوراً دون فاتورة." : now ? `ترقية الآن: فاتورة بفرق ${left} يوماً من ${span} = ${money(charge)} قبل الضريبة.` : `تبدأ الخطة الجديدة من الفترة القادمة (${s.nextBillDate || "—"}).`}</div>}
  </Modal>;
}
function PauseModal({ s, onClose, onDone }: any) {
  const [f, setF] = useState<any>({ from: today(), until: "", reason: "" });
  const { run, busy } = useAction();
  const left = s.currentTo && f.from <= s.currentTo ? dayDiff(f.from, s.currentTo) : 0;
  return <Modal title={`إيقاف ${s.number} مؤقتاً`} onClose={onClose} narrow footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" data-pause-save disabled={busy} onClick={() => run(async () => { await api(`/subs/${s.id}/pause`, { body: { ...f, until: f.until || null } }); onDone(); }, "أُوقف الاشتراك مؤقتاً")}>إيقاف</button></>}>
    <div className="grid c2"><Field label="من"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field><Field label="حتى" hint="فارغ = حتى الاستئناف"><Input type="date" value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} data-pause-until /></Field></div>
    <Field label="السبب"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="سفر، إصابة…" /></Field>
    <div className="small muted">لا تصدر فواتير أثناء الإيقاف، ويُحفظ للمشترك {left} يوماً مدفوعة تُضاف بعد الاستئناف.</div>
  </Modal>;
}
function CancelModal({ s, onClose, onDone }: any) {
  const [f, setF] = useState<any>({ when: s.status === "ACTIVE" ? "END" : "NOW", date: today(), credit: true, reason: "" });
  const { run, busy } = useAction();
  const unused = f.when === "NOW" && s.currentTo && f.date < s.currentTo ? dayDiff(f.date, s.currentTo) - 1 : 0;
  return <Modal title={`إلغاء ${s.number}`} onClose={onClose} narrow footer={<><button className="btn" onClick={onClose}>رجوع</button><button className="btn primary danger" data-cancel-save disabled={busy} onClick={() => run(async () => { await api(`/subs/${s.id}/cancel`, { body: f }); onDone(); }, "أُلغي الاشتراك")}>تأكيد الإلغاء</button></>}>
    {s.status === "ACTIVE" && <div className="seg mb"><button className={f.when === "END" ? "on" : ""} onClick={() => setF({ ...f, when: "END" })} data-cancel-end>في نهاية الفترة ({s.currentTo})</button><button className={f.when === "NOW" ? "on" : ""} onClick={() => setF({ ...f, when: "NOW" })} data-cancel-now>الآن</button></div>}
    {f.when === "NOW" && <><Field label="تاريخ الإلغاء"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      {unused > 0 && <label className="check"><input type="checkbox" checked={f.credit} onChange={(e) => setF({ ...f, credit: e.target.checked })} data-cancel-credit /> إشعار دائن بالأيام غير المستخدمة ({unused} يوماً)</label>}</>}
    <Field label="سبب الإلغاء"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="السعر، انتقل، لم يعد يحتاج…" data-cancel-reason /></Field>
    <div className="small muted">{f.when === "END" ? "تبقى الخدمة حتى نهاية الفترة المدفوعة ولا تصدر فاتورة بعدها." : "تتوقف الخدمة الآن. في الخطط ذات الإيراد المؤجل يُستحق ما مضى ويُرد بالإشعار ما لم يُستخدم."}</div>
  </Modal>;
}

// ───────────────────────── check-in desk ─────────────────────────
export function SubCheckinPage() {
  const init = new URLSearchParams(window.location.search).get("q") || "";
  const [q, setQ] = useState(init);
  const [qty, setQty] = useState<any>(1);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string>("");
  const [log, setLog] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const go = async (body: any) => {
    setBusy(true); setErr(""); setRes(null);
    try {
      const r = await api("/subs-checkin", { body: { qty: Number(qty) || 1, ...body } });
      if (r.choose) setRes(r);
      else { setRes(r); setLog((l) => [{ at: new Date().toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }), ...r.subscription, overage: r.overage }, ...l].slice(0, 30)); setQ(""); }
    } catch (e: any) { setErr(String(e.message || e)); } finally { setBusy(false); ref.current?.focus(); }
  };
  const S = res?.subscription;
  return (
    <div className="grid" data-checkin>
      <div className="card"><div className="row" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <Field label="رقم الاشتراك أو الجوال أو الاسم"><input className="input" ref={ref} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) go({ q: q.trim() }); }} data-checkin-q style={{ minWidth: 260 }} /></Field>
        <Field label="العدد"><NumInput value={qty} onChange={(e: any) => setQty(e.target.value)} style={{ width: 80 }} /></Field>
        <button className="btn primary" disabled={busy || !q.trim()} data-checkin-go onClick={() => go({ q: q.trim() })}>تسجيل الحضور</button>
      </div></div>
      {err && <div className="alert warn" data-checkin-err>{err}{/متأخرة منذ|overdue since/.test(err) && res === null && <> <button className="btn sm" onClick={() => go({ q: q.trim(), force: true })} data-checkin-force>السماح بالدخول</button></>}</div>}
      {res?.choose && <div className="card"><div className="card-h"><h3>أكثر من مشترك — اختر</h3></div><table className="tbl compact"><tbody>{res.choose.map((c: any) => <tr key={c.subscription.id} className="clickable" onClick={() => go({ subscriptionId: c.subscription.id })}><td className="num">{c.subscription.number}</td><td>{c.subscription.partnerName}</td><td>{c.subscription.planName}</td><td><SubBadge s={c.subscription.status} /></td></tr>)}</tbody></table></div>}
      {S && !res.choose && <div className={"card " + (res.overage ? "warn" : "")} data-checkin-ok><h3 style={{ marginTop: 0 }}>✓ {S.partnerName}</h3>
        <div>{S.planName} · <span className="num">{S.number}</span> · حتى {S.currentTo}</div>
        <div className="mt" data-checkin-left>{S.quota !== null ? <>استُخدم <b className="num">{S.used}</b> من <b className="num">{S.quota}</b> — الباقي <b className="num">{S.left}</b></> : <>استخدام غير محدود · هذه الفترة <b className="num">{S.used}</b></>}</div>
        {res.overage && <div className="alert warn small mt">فوق حد الفترة: يُضاف على الفاتورة القادمة.</div>}</div>}
      <div className="card"><div className="card-h"><h3>سُجّل في هذه الجلسة</h3></div>{!log.length ? <Empty text="لا أحد بعد" /> : <table className="tbl compact"><tbody>{log.map((l, i) => <tr key={i}><td className="small">{l.at}</td><td>{l.partnerName}</td><td className="small">{l.planName}</td><td className="small">{l.quota !== null ? `${l.used} / ${l.quota}` : l.used}{l.overage ? " · فوق الحد" : ""}</td></tr>)}</tbody></table>}</div>
    </div>
  );
}

// ───────────────────────── usage report ─────────────────────────
export function SubUsagePage() {
  const [r, setR] = useState({ from: new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10), to: today() });
  const { data } = useFetch<any>(`/subs/usage?from=${r.from}&to=${r.to}`, [r.from, r.to]);
  const top = Math.max(1, ...(data?.daily || []).map((d: any) => d.people));
  return (
    <div className="grid" data-subs-usage>
      <div className="card"><div className="row" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}><DateRange from={r.from} to={r.to} onChange={(f, t) => setR({ from: f, to: t })} /><div className="grow" /><PrintBtn pdfName="تقرير الحضور" /></div></div>
      {!data ? <Loading /> : <>
        <div className="fc-kpis"><div className="fc-kpi"><span>الحضور في الفترة</span><b className="num">{data.daily.reduce((x: number, d: any) => x + d.qty, 0)}</b></div><div className={"fc-kpi" + (data.idle ? " high" : "")}><span>مشتركون لم يحضروا</span><b className="num">{data.idle}</b><small>معرّضون للإلغاء — تواصل معهم</small></div></div>
        <div className="card"><div className="card-h"><h3>الحضور يوماً بيوم</h3></div>{!data.daily.length ? <Empty text="لا حضور في الفترة" /> : <div className="row" style={{ alignItems: "flex-end", gap: 3, height: 110 }}>{data.daily.map((d: any) => <div key={d.date} title={`${d.date}: ${d.people}`} style={{ flex: 1, height: `${Math.round((d.people / top) * 100)}px`, background: "var(--primary, #0f766e)", borderRadius: 2, minHeight: 2 }} />)}</div>}</div>
        <div className="card"><div className="card-h"><h3>المشتركون</h3><ExportBtn rows={() => data.subscribers.map((s: any) => ({ "الرقم": s.number, "المشترك": s.partner, "الخطة": s.plan, "الاستخدام": s.used, "الحد": s.quota, "آخر حضور": s.last }))} name="استخدام المشتركين" /></div>
          <div className="table-wrap"><table className="tbl compact" data-usage-table><thead><tr><th>الرقم</th><th>المشترك</th><th>الخطة</th><th className="n">الاستخدام</th><th>آخر حضور</th></tr></thead>
            <tbody>{data.subscribers.map((s: any) => <tr key={s.id}><td className="num"><Link to={`/subs/${s.id}`}>{s.number}</Link></td><td>{s.partner}</td><td className="small">{s.plan}</td><td className={"n" + (s.used === 0 ? " neg-val" : "")}>{s.used}{s.quota !== null ? ` / ${s.quota}` : ""}</td><td className="small">{s.last || "—"}</td></tr>)}</tbody></table></div></div>
      </>}
    </div>
  );
}
