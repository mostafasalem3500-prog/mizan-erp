/** Leases as a lessee (IFRS 16 / Egyptian standard 49): right-of-use asset, lease liability, monthly postings, payments. */
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api, useFetch, useAction, Money, Loading, Empty, Modal, Field, Input, Select, NumInput, Picker, accountFetcher, partnerFetcher, today, fmtDate, confirmDlg, useCompanyContext } from "../lib";
import { CFG } from "../shared/country";

const FREQ: Record<number, string> = { 1: "شهري", 3: "ربع سنوي", 6: "نصف سنوي", 12: "سنوي" };
const ST: Record<string, string> = { ACTIVE: "قائم", ENDED: "انتهى", TERMINATED: "أُنهي مبكراً" };
const STD = () => (CFG.country === "EG" ? "معيار المحاسبة المصري 49" : "المعيار الدولي للتقرير المالي 16");

export function LeasesPage() {
  const { can } = useCompanyContext();
  const { data, loading, reload } = useFetch<any>("/leases");
  const { run, busy } = useAction();
  const [add, setAdd] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (!data) return <Empty text="تعذّر التحميل" />;
  const smes = data.framework === "IFRS_SMES";
  const tt = data.totals;
  return (
    <div className="grid" data-leases>
      <div className="card"><div className="card-h"><div><h3>عقود الإيجار (حق الاستخدام)</h3>
        <div className="small muted">المستأجر يثبت في بداية العقد <b>أصل حق استخدام</b> و<b>التزام إيجار</b> بالقيمة الحالية لدفعات الإيجار ({STD()}). كل شهر: إهلاك الأصل بالقسط الثابت وفائدة على الالتزام؛ وكل دفعة تخفض الالتزام. العقود 12 شهراً أو أقل تبقى مصروف إيجار.</div></div>
        <div className="row">{tt.dueMonths > 0 && <button className="btn sm" disabled={busy} data-run-leases onClick={() => run(async () => { await api("/leases/run", { body: {} }); reload(); }, "رُحّلت الأشهر المستحقة")}>ترحيل الأشهر المستحقة ({tt.dueMonths})</button>}
          <button className="btn primary sm" disabled={smes} data-new-lease onClick={() => setAdd(true)}>＋ عقد جديد</button></div></div>
        {CFG.country !== "EG" && <div className="card-b" data-framework={data.framework} style={{ paddingTop: 0 }}>
          {smes ? <div className="alert info small">المنشأة مضبوطة على <b>IFRS للمنشآت الصغيرة والمتوسطة</b>: عقد الإيجار التشغيلي يُسجَّل مصروفاً بالقسط الثابت (القسم 20) — من المصروفات أو المدفوع مقدماً. نموذج حق الاستخدام للمنشآت التي تطبق <b>IFRS الكاملة</b> (الشركات المدرجة وما يُلزمها نظامها).
            {can("settings.write") && <button className="btn sm mt" disabled={busy} data-set-ifrs onClick={() => confirmDlg("تغيير إطار التقرير المالي إلى المعايير الدولية الكاملة (IFRS)؟ يتغير نص الإيضاحات تبعاً لذلك.") && run(async () => { await api("/leases/framework", { method: "PUT", body: { framework: "IFRS" } }); reload(); }, "الإطار: IFRS الكاملة")}>المنشأة تطبق IFRS الكاملة</button>}</div>
            : <div className="small muted">إطار التقرير المالي: <b>المعايير الدولية الكاملة (IFRS)</b>{can("settings.write") && !data.rows.length && <> · <button className="btn sm ghost" onClick={() => run(async () => { await api("/leases/framework", { method: "PUT", body: { framework: "IFRS_SMES" } }); reload(); })}>الرجوع إلى IFRS للمنشآت الصغيرة والمتوسطة</button></>}</div>}
        </div>}
      </div>
      <div className="grid c4">
        <div className="card kpi"><div className="label">صافي أصول حق الاستخدام</div><div className="value"><Money v={tt.nbv} /></div></div>
        <div className="card kpi accent"><div className="label">التزامات عقود الإيجار</div><div className="value"><Money v={tt.liability} /></div></div>
        <div className="card kpi"><div className="label">أشهر مستحقة الترحيل</div><div className="value">{tt.dueMonths}</div></div>
        <div className="card kpi"><div className="label">دفعات مستحقة لم تُسجَّل</div><div className="value">{tt.duePayments}</div></div>
      </div>
      <div className="card">{!data.rows.length ? <div className="card-b"><Empty text={smes ? "لا توجد عقود — المنشأة على IFRS للمنشآت الصغيرة والمتوسطة" : "لا توجد عقود إيجار مسجّلة"} /></div> :
        <div className="table-wrap"><table className="tbl" data-lease-list><thead><tr><th>العقد</th><th>المؤجر</th><th>المدة</th><th className="n">الدفعة</th><th className="n">الالتزام</th><th className="n">صافي حق الاستخدام</th><th>مستحق</th><th>الحالة</th></tr></thead>
          <tbody>{data.rows.map((l: any) => <tr key={l.id} className="clickable" onClick={() => setOpen(l.id)}><td><b className="num">{l.number}</b> {l.name}</td><td className="small">{l.partnerName || "—"}</td>
            <td className="small num">{fmtDate(l.startDate)} → {fmtDate(l.endDate)}<div className="muted">{l.months} شهراً</div></td><td className="n"><Money v={l.payment} /><div className="small muted">{FREQ[l.frequency]} · {l.timing === "ADVANCE" ? "مقدماً" : "مؤخراً"}</div></td>
            <td className="n"><Money v={l.liability} /></td><td className="n"><Money v={l.nbv} /></td>
            <td className="small">{l.dueMonths ? <span className="badge amber">{l.dueMonths} شهر</span> : null} {l.duePayments ? <span className="badge red">{l.duePayments} دفعة</span> : null}</td><td>{ST[l.status]}</td></tr>)}</tbody></table></div>}
      </div>
      {add && <NewLease onClose={(ok) => { setAdd(false); if (ok) reload(); }} />}
      {open && <LeaseDetail id={open} onClose={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

function NewLease({ onClose }: { onClose: (ok?: boolean) => void }) {
  const [f, setF] = useState<any>({ name: "", startDate: today().slice(0, 8) + "01", months: 60, payment: "", frequency: 1, timing: "ADVANCE", annualRate: 6, directCosts: 0, auto: true });
  const [partner, setPartner] = useState<any>(null);
  const [cash, setCash] = useState<any>(null);
  const [prev, setPrev] = useState<any>(null);
  const centres = useFetch<any[]>("/cost-centers");
  const { run, busy } = useAction();
  const set = (k: string, v: any) => { setPrev(null); setF({ ...f, [k]: v }); };
  const body = () => ({ ...f, months: Number(f.months), payment: Number(f.payment), frequency: Number(f.frequency), annualRate: Number(f.annualRate), directCosts: Number(f.directCosts || 0), partnerId: partner?.id, payAccountId: cash?.id });
  return (
    <Modal wide title="عقد إيجار جديد" onClose={() => onClose()} footer={<>
      <button className="btn" disabled={busy || !f.payment} data-lease-preview onClick={() => run(async () => setPrev(await api("/leases/preview", { body: body() })))}>معاينة القياس</button>
      <button className="btn primary" disabled={busy || !f.name || !f.payment} data-lease-save onClick={() => run(async () => { await api("/leases", { body: body() }); onClose(true); }, "سُجّل العقد وقيد بدايته")}>حفظ وترحيل قيد البداية</button></>}>
      <div className="grid c3">
        <Field label="وصف العقد" span2><Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="مثال: إيجار المعرض الرئيسي — 5 سنوات" /></Field>
        <Field label="المؤجر (اختياري)"><Picker value={partner} onChange={setPartner} fetcher={partnerFetcher("SUPPLIER")} label={(p: any) => p.name} placeholder="المورد / المؤجر" /></Field>
        <Field label="تاريخ بداية العقد"><Input type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} /></Field>
        <Field label="مدة العقد بالأشهر"><NumInput value={f.months} onChange={(e) => set("months", e.target.value)} /></Field>
        <Field label="قيمة الدفعة (قبل الضريبة)"><NumInput value={f.payment} onChange={(e) => set("payment", e.target.value)} /></Field>
        <Field label="دورية السداد"><Select value={f.frequency} onChange={(e) => set("frequency", e.target.value)}>{Object.entries(FREQ).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="توقيت الدفعة"><Select value={f.timing} onChange={(e) => set("timing", e.target.value)}><option value="ADVANCE">مقدماً (أول كل فترة)</option><option value="ARREARS">مؤخراً (آخر كل فترة)</option></Select></Field>
        <Field label="معدل الخصم السنوي %" hint="معدل الاقتراض الإضافي للمنشأة إن لم يُعرف المعدل الضمني في العقد"><NumInput value={f.annualRate} onChange={(e) => set("annualRate", e.target.value)} /></Field>
        <Field label="تكاليف مباشرة أولية (اختياري)" hint="عمولة السمسار ونحوها — تُضاف لأصل حق الاستخدام"><NumInput value={f.directCosts} onChange={(e) => set("directCosts", e.target.value)} /></Field>
        <Field label="حساب السداد"><Picker value={cash} onChange={setCash} fetcher={accountFetcher((a: any) => a.isCashBank)} label={(a: any) => `${a.code} ${a.nameAr}`} placeholder="الصندوق أو البنك" /></Field>
        <Field label="مركز التكلفة / المشروع (اختياري)"><Select value={f.costCenterId || ""} onChange={(e) => set("costCenterId", e.target.value || undefined)}><option value="">— عام —</option>{(centres.data || []).map((c: any) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</Select></Field>
        <Field label="الترحيل الشهري"><label className="check"><input type="checkbox" checked={f.auto} onChange={(e) => set("auto", e.target.checked)} /> تلقائياً في نهاية كل شهر</label></Field>
      </div>
      {prev && <div className="mt" data-lease-measure><div className="mini-kpis">
        <div><span>التزام الإيجار (القيمة الحالية)</span><b className="num"><Money v={prev.pv} /></b></div>
        <div><span>أصل حق الاستخدام</span><b className="num"><Money v={prev.rou} /></b></div>
        <div><span>إهلاك شهري</span><b className="num"><Money v={prev.depreciation} /></b></div>
        <div><span>إجمالي الدفعات ({prev.payments})</span><b className="num"><Money v={prev.totalPayments} /></b></div>
        <div><span>إجمالي الفائدة على المدة</span><b className="num"><Money v={prev.totalInterest} /></b></div>
        <div><span>السنة الأولى: فائدة + إهلاك</span><b className="num"><Money v={prev.firstYear.interest + prev.firstYear.depreciation} /></b></div></div>
        <div className="small muted mt">قيد البداية: من ح/ أصول حق الاستخدام <Money v={prev.rou} /> إلى ح/ التزامات عقود الإيجار <Money v={prev.pv} />{prev.directCosts > 0 && <> وإلى ح/ الصندوق أو البنك <Money v={prev.directCosts} /></>}.</div></div>}
    </Modal>
  );
}

function LeaseDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: l, reload } = useFetch<any>(`/leases/${id}`, [id]);
  const { run, busy } = useAction();
  const [pay, setPay] = useState<any>(null);
  const [end, setEnd] = useState("");
  if (!l) return <Modal title="عقد إيجار" onClose={onClose}><Loading /></Modal>;
  const next = l.payments.find((p: any) => !p.paid);
  const due = l.months.filter((m: any) => !m.posted && m.periodEnd <= today()).length;
  const active = l.status === "ACTIVE";
  const nothing = !l.months.some((m: any) => m.posted) && !l.payments.some((p: any) => p.paid);
  return (
    <Modal wide title={<>{l.number} — {l.name}</>} onClose={onClose}>
      <div className="mini-kpis" data-lease-detail>
        <div><span>التزام الإيجار الآن</span><b className="num"><Money v={l.liability} /></b></div>
        <div><span>صافي حق الاستخدام</span><b className="num"><Money v={l.nbv} /></b></div>
        <div><span>القيمة الحالية عند البداية</span><b className="num"><Money v={l.pv} /></b></div>
        <div><span>الحالة</span><b>{ST[l.status]}</b></div>
      </div>
      <div className="small muted mt">قيد البداية {l.startEntry && <Link to={`/journals/${l.startEntry.id}`} className="num">{l.startEntry.number}</Link>} · {l.months.length} شهراً · {FREQ[l.frequency]} {l.timing === "ADVANCE" ? "مقدماً" : "مؤخراً"} · معدل الخصم {l.annualRate}%</div>
      {active && <div className="row mt" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        {due > 0 && <button className="btn" disabled={busy} data-lease-run onClick={() => run(async () => { await api("/leases/run", { body: { id } }); reload(); }, "رُحّل")}>ترحيل الأشهر المستحقة ({due})</button>}
        {next && <button className="btn primary" disabled={busy} data-lease-pay onClick={() => setPay({ date: next.date > today() ? today() : next.date, vat: "", account: null })}>تسجيل الدفعة {next.n} (<Money v={next.amount} />)</button>}
        <Field label="إنهاء مبكر في"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={{ width: 160 }} /></Field>
        <button className="btn ghost" disabled={busy || !end} data-lease-terminate onClick={() => confirmDlg("إنهاء العقد مبكراً؟ يُستبعد الأصل والالتزام ويُثبت الفرق ربحاً أو خسارة.") && run(async () => { await api(`/leases/${id}/terminate`, { body: { date: end } }); reload(); }, "أُنهي العقد")}>إنهاء</button>
        {nothing && <button className="btn ghost" disabled={busy} data-lease-delete onClick={() => confirmDlg("حذف العقد وعكس قيد بدايته؟") && run(async () => { await api(`/leases/${id}`, { method: "DELETE" }); onClose(); }, "حُذف")}>حذف</button>}
      </div>}
      {pay && next && <div className="card mt" data-lease-payform><div className="card-b row" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <Field label="تاريخ السداد"><Input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field>
        <Field label="من"><Picker value={pay.account} onChange={(a) => setPay({ ...pay, account: a })} fetcher={accountFetcher((a: any) => a.isCashBank)} label={(a: any) => `${a.code} ${a.nameAr}`} placeholder={l.payAccountId ? "حساب العقد" : "الصندوق أو البنك"} /></Field>
        <Field label="ضريبة المدخلات (إن صدرت فاتورة ضريبية)"><NumInput value={pay.vat} onChange={(e) => setPay({ ...pay, vat: e.target.value })} style={{ width: 120 }} /></Field>
        <button className="btn sm ghost" onClick={() => setPay({ ...pay, vat: String(Math.round(next.amount * CFG.vatRate) / 100) })}>+{CFG.vatRate}%</button>
        <button className="btn primary" disabled={busy || (!pay.account && !l.payAccountId)} data-lease-paysave onClick={() => run(async () => { await api(`/leases/${id}/pay`, { body: { date: pay.date, payAccountId: pay.account?.id, vat: Number(pay.vat || 0) } }); setPay(null); reload(); }, "سُجّلت الدفعة")}>تسجيل</button></div></div>}
      <h4 className="mt">الدفعات</h4>
      <div className="table-wrap"><table className="tbl compact" data-lease-payments><thead><tr><th>#</th><th>الاستحقاق</th><th className="n">المبلغ</th><th>السداد</th><th className="n">الضريبة</th><th>القيد</th></tr></thead>
        <tbody>{l.payments.map((p: any) => <tr key={p.n} className={!p.paid && p.date <= today() ? "warn-row" : ""}><td className="num">{p.n}</td><td className="dt">{fmtDate(p.date)}</td><td className="n"><Money v={p.amount} /></td><td className="small">{p.paid ? fmtDate(p.paidOn) : p.date <= today() ? <span className="badge red">مستحقة</span> : "—"}</td><td className="n">{p.vat ? <Money v={p.vat} /> : ""}</td><td>{p.entryId && <Link to={`/journals/${p.entryId}`} className="num">{p.entryNumber}</Link>}</td></tr>)}</tbody></table></div>
      <h4 className="mt">جدول الالتزام والإهلاك</h4>
      <div className="table-wrap"><table className="tbl compact" data-lease-schedule><thead><tr><th>#</th><th>نهاية الشهر</th><th className="n">التزام أول الشهر</th><th className="n">الدفعات</th><th className="n">الفائدة</th><th className="n">التزام آخر الشهر</th><th className="n">الإهلاك</th><th className="n">صافي حق الاستخدام</th><th>القيد</th></tr></thead>
        <tbody>{l.months.map((m: any) => <tr key={m.n}><td className="num">{m.n}</td><td className="dt">{fmtDate(m.periodEnd)}</td><td className="n"><Money v={m.opening} /></td><td className="n"><Money v={m.payments} blankZero /></td><td className="n"><Money v={m.interest} /></td><td className="n"><Money v={m.closing} /></td><td className="n"><Money v={m.depreciation} /></td><td className="n"><Money v={m.nbv} /></td>
          <td>{m.entryId ? <Link to={`/journals/${m.entryId}`} className="num">{m.entryNumber}</Link> : m.periodEnd <= today() && active ? <span className="badge amber">مستحق</span> : ""}</td></tr>)}</tbody></table></div>
    </Modal>
  );
}
