/** Egypt edition screens: ETA e-invoice / e-receipt, Form 41 withholding, corporate income tax, salary-tax calculator. */
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api, q, useFetch, Money, money, Loading, Empty, Badge, Modal, Field, Input, Select, NumInput, useAction, useToast, useCompanyContext, fmtDate, useBase, exportExcel, today, confirmDlg } from "../lib";
import { PayModal } from "./Round23";
import { CFG } from "../shared/country";

export const ETA_ST: Record<string, { t: string; c: string }> = {
  NOT_CONFIGURED: { t: "بانتظار الإعداد", c: "gray" }, PENDING: { t: "بانتظار الإرسال", c: "amber" }, NEEDS_SIGNATURE: { t: "بانتظار التوقيع", c: "amber" },
  SUBMITTED: { t: "مُرسل — قيد المراجعة", c: "blue" }, VALID: { t: "مقبول", c: "green" }, INVALID: { t: "غير مطابق", c: "red" }, REJECTED: { t: "مرفوض", c: "red" }, CANCELLED: { t: "ملغى", c: "gray" }, FAILED: { t: "فشل الإرسال", c: "red" },
};
export const EtaBadge = ({ s }: { s?: string | null }) => (s ? <span className={"badge " + (ETA_ST[s]?.c || "gray")}>{ETA_ST[s]?.t || s}</span> : null);
const ENV_AR: Record<string, string> = { MOCK: "المحاكي المدمج (اختبار بلا إرسال)", PREPROD: "ما قبل الإنتاج (Pre-Production)", PROD: "الإنتاج (Production)" };

/** Shows the ETA document JSON, its canonical serialization and validation errors; submit / refresh / cancel. */
export function EtaDocModal({ id, onClose }: { id: string; onClose: (changed?: boolean) => void }) {
  const { data, loading, reload } = useFetch<any>(`/eta/invoices/${id}/preview`);
  const { run, busy } = useAction();
  const toast = useToast();
  const [tab, setTab] = useState("errors");
  const [changed, setChanged] = useState(false);
  const act = (path: string, body: any = {}) => run(async () => { const r = await api(`/eta/invoices/${id}/${path}`, { body }); toast(`الحالة: ${ETA_ST[r.status]?.t || r.status}${r.errors?.length ? " — " + r.errors[0] : ""}`, r.status === "VALID" || r.status === "SUBMITTED" || r.status === "CANCELLED" ? "ok" : "err"); setChanged(true); reload(); });
  return (
    <Modal wide title="مستند منظومة الضرائب المصرية" onClose={() => onClose(changed)} footer={<>
      <button className="btn danger sm" disabled={busy} onClick={() => { const reason = prompt("سبب الإلغاء في المنظومة؟"); if (reason) act("cancel", { reason }); }}>إلغاء في المنظومة</button>
      <button className="btn sm" disabled={busy} onClick={() => act("refresh")}>تحديث الحالة</button>
      <div className="grow" /><button className="btn" onClick={() => onClose(changed)}>إغلاق</button>
      <button className="btn primary" disabled={busy} onClick={() => act("submit")}>إرسال إلى المنظومة</button></>}>
      {loading || !data ? <Loading /> : <>
        <div className={"alert small " + (data.errors.length ? "warn" : "ok")}>{data.kind === "RECEIPT" ? "إيصال إلكتروني (B2C) — نسخة 1.2" : `فاتورة إلكترونية — نوع ${data.document.documentType} — نسخة ${data.document.documentTypeVersion}`} · {data.errors.length ? `${data.errors.length} ملاحظة تمنع القبول` : "المستند مطابق لقواعد المنظومة"}</div>
        <div className="tabs">{[["errors", `الملاحظات (${data.errors.length})`], ["json", "المستند JSON"], ["ser", "التسلسل القياسي للتوقيع"]].map(([k, t]) => <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{t}</button>)}</div>
        {tab === "errors" && (data.errors.length ? <ul className="small">{data.errors.map((e: string, i: number) => <li key={i} dir="auto">{e}</li>)}</ul> : <div className="muted small">لا توجد ملاحظات.</div>)}
        {tab === "json" && <pre className="code-box" dir="ltr">{JSON.stringify(data.document, null, 2)}</pre>}
        {tab === "ser" && <><div className="small muted mb">SHA-256: <span dir="ltr" className="num">{data.sha256 || data.document?.header?.uuid}</span></div><pre className="code-box" dir="ltr" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{data.serialized}</pre></>}
      </>}
    </Modal>
  );
}

export function EtaPage() {
  const { can } = useCompanyContext();
  const base = useBase();
  const { data, loading, reload } = useFetch<any>("/eta/config");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const docs = useFetch<any[]>(`/eta/documents${q({ status, kind })}`, [status, kind]);
  const [f, setF] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  const { run, busy } = useAction();
  const toast = useToast();
  if (loading || !data) return <Loading />;
  const c = f || data.config;
  const s = (k: string) => (e: any) => setF({ ...c, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const save = () => run(async () => { await api("/eta/config", { method: "PUT", body: c }); setF(null); reload(); docs.reload(); toast("تم حفظ إعدادات الربط", "ok"); });
  const stat = (st: string) => data.stats.filter((x: any) => x.status === st).reduce((a: number, x: any) => a + x.c, 0);
  return (
    <div className="grid">
      <div className="card"><div className="card-h"><h3>🧾 منظومة الفاتورة والإيصال الإلكتروني — {CFG.taxAuthority}</h3><div className="row">
        <span className={"badge " + (c.environment === "PROD" ? "green" : c.environment === "PREPROD" ? "blue" : "amber")}>{ENV_AR[c.environment]}</span>
        <button className="btn sm" disabled={busy} onClick={() => run(async () => { const r = await api("/eta/test", { body: {} }); toast(r.message, r.ok ? "ok" : "err"); })}>اختبار الربط</button>
        {can("sales.write") && <button className="btn primary sm" disabled={busy} onClick={() => run(async () => { const r = await api("/eta/submit-pending", { body: {} }); toast(`عولج ${r.processed} مستند: ${Object.entries(r.result).map(([k, v]) => `${ETA_ST[k]?.t || k} ${v}`).join("، ") || "—"}`, "ok"); reload(); docs.reload(); })}>إرسال كل المعلّق</button>}
      </div></div>
        <div className="card-b">
          {data.issues.length > 0 && <div className="alert warn small">أكمل لتفعيل الإرسال: {data.issues.join("، ")}</div>}
          <div className="mini-kpis">
            {[["VALID", "مقبول"], ["SUBMITTED", "قيد المراجعة"], ["PENDING", "بانتظار الإرسال"], ["NOT_CONFIGURED", "بانتظار الإعداد"], ["INVALID", "غير مطابق"], ["REJECTED", "مرفوض"]].map(([k, t]) => <div key={k} className="clickable" onClick={() => setStatus(status === k ? "" : k)}><span>{t}</span><b>{stat(k)}</b></div>)}
          </div>
        </div>
      </div>
      <div className="grid c2">
        <div className="card"><div className="card-h"><h3>بيانات المصدر والربط</h3></div><div className="card-b">
          <div className="form-grid">
            <Field label="البيئة"><Select value={c.environment} onChange={s("environment")}>{Object.entries(ENV_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="نسخة المستند" hint="1.0 تتطلب توقيع الختم الإلكتروني؛ 0.9 بدون توقيع (ما قبل الإنتاج فقط)"><Select value={c.documentVersion} onChange={s("documentVersion")}><option value="1.0">1.0 (موقّعة)</option><option value="0.9">0.9 (بدون توقيع)</option></Select></Field>
            <Field label="رقم التسجيل الضريبي (RIN)"><Input value={c.rin || ""} onChange={s("rin")} dir="ltr" maxLength={9} placeholder="9 أرقام" /></Field>
            <Field label="كود النشاط (ISIC)"><Input value={c.activityCode || ""} onChange={s("activityCode")} dir="ltr" maxLength={4} placeholder="مثل 4620" /></Field>
            <Field label="كود الفرع"><Input value={c.branchCode || "0"} onChange={s("branchCode")} dir="ltr" /></Field>
            <Field label="المحافظة"><Select value={c.governate || ""} onChange={s("governate")}><option value="">—</option>{data.governates.map((g: string) => <option key={g}>{g}</option>)}</Select></Field>
            <Field label="المدينة / الحي"><Input value={c.regionCity || ""} onChange={s("regionCity")} /></Field>
            <Field label="الشارع"><Input value={c.street || ""} onChange={s("street")} /></Field>
            <Field label="رقم المبنى"><Input value={c.buildingNumber || ""} onChange={s("buildingNumber")} /></Field>
            <Field label="الرمز البريدي"><Input value={c.postalCode || ""} onChange={s("postalCode")} dir="ltr" /></Field>
            <Field label="Client ID (نظام ERP)"><Input value={c.clientId || ""} onChange={s("clientId")} dir="ltr" /></Field>
            <Field label="Client Secret"><Input type="password" value={c.clientSecret || ""} onChange={s("clientSecret")} dir="ltr" /></Field>
            <Field label="خدمة التوقيع المحلية (USB Token)" hint="عنوان خدمة على جهاز الشركة تحمل الختم الإلكتروني وتُرجع توقيع CAdES-BES"><Input value={c.signerUrl || ""} onChange={s("signerUrl")} dir="ltr" placeholder="http://127.0.0.1:18089/sign" /></Field>
            <Field label="مفتاح خدمة التوقيع"><Input type="password" value={c.signerSecret || ""} onChange={s("signerSecret")} dir="ltr" /></Field>
          </div>
          <label className="check mt"><input type="checkbox" checked={c.autoSubmit !== false} onChange={s("autoSubmit")} /> إرسال المستند تلقائياً عند الترحيل</label>
        </div></div>
        <div className="card"><div className="card-h"><h3>الإيصال الإلكتروني (نقاط البيع)</h3></div><div className="card-b">
          <div className="alert info small">مبيعات نقطة البيع ومرتجعاتها تُرسل كإيصالات إلكترونية مرتبطة ببعضها (previousUUID)، وباقي فواتير المبيعات كفواتير إلكترونية.</div>
          <div className="form-grid">
            <Field label="الرقم التسلسلي لجهاز نقطة البيع"><Input value={c.posSerial || ""} onChange={s("posSerial")} dir="ltr" /></Field>
            <Field label="نظام تشغيل الجهاز"><Input value={c.posOsVersion || ""} onChange={s("posOsVersion")} dir="ltr" placeholder="windows" /></Field>
            <Field label="طراز الجهاز"><Input value={c.posModel || ""} onChange={s("posModel")} dir="ltr" /></Field>
            <Field label="POS Client ID"><Input value={c.posClientId || ""} onChange={s("posClientId")} dir="ltr" /></Field>
            <Field label="POS Client Secret"><Input type="password" value={c.posClientSecret || ""} onChange={s("posClientSecret")} dir="ltr" /></Field>
            <Field label="Pre-shared Key"><Input type="password" value={c.posPresharedKey || ""} onChange={s("posPresharedKey")} dir="ltr" /></Field>
          </div>
          <div className="small muted mt">آخر إيصال مقبول: <span dir="ltr" className="num">{c.receiptLastUuid ? c.receiptLastUuid.slice(0, 16) + "…" : "—"}</span></div>
          <details className="mt"><summary className="small">ربط الضرائب في المستند</summary><table className="tbl compact mt"><tbody>{Object.entries(data.taxMap).map(([k, v]: any) => <tr key={k}><td>{k}</td><td dir="ltr">{v.type}/{v.sub}</td><td className="small">{v.ar}</td></tr>)}</tbody></table></details>
        </div></div>
      </div>
      {can("settings.write") && f && <div className="card"><div className="card-b row"><span className="muted small">توجد تعديلات غير محفوظة</span><div className="grow" /><button className="btn" onClick={() => setF(null)}>تراجع</button><button className="btn primary" disabled={busy} onClick={save}>حفظ الإعدادات</button></div></div>}
      <div className="card"><div className="card-h"><h3>المستندات</h3><div className="row">
        <Select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 150 }}><option value="">كل الأنواع</option><option value="INVOICE">فواتير إلكترونية</option><option value="RECEIPT">إيصالات إلكترونية</option></Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 170 }}><option value="">كل الحالات</option>{Object.entries(ETA_ST).map(([k, v]) => <option key={k} value={k}>{v.t}</option>)}</Select>
        {docs.data && <button className="btn sm" onClick={() => exportExcel(docs.data!.map((d: any) => ({ الرقم: d.number, التاريخ: d.date, النوع: d.etaKind === "RECEIPT" ? "إيصال" : "فاتورة", العميل: d.partnerName, الإجمالي: Number(d.total), الحالة: ETA_ST[d.etaStatus]?.t, UUID: d.etaUuid })), "مستندات المنظومة")}>⬇ Excel</button>}
      </div></div>
        {!docs.data ? <Loading /> : !docs.data.length ? <Empty text="لا توجد مستندات — تظهر هنا فواتير المبيعات والإيصالات بعد ترحيلها" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الرقم</th><th>التاريخ</th><th>النوع</th><th>العميل</th><th className="n">الإجمالي</th><th>الحالة</th><th>UUID</th><th /></tr></thead>
          <tbody>{docs.data.map((d: any) => <tr key={d.id}><td><Link to={`${base}/invoices/${d.id}`}>{d.number}</Link></td><td className="dt">{fmtDate(d.date)}</td><td>{d.etaKind === "RECEIPT" ? "إيصال" : d.kind === "CREDIT_NOTE" ? "إشعار دائن" : d.kind === "DEBIT_NOTE" ? "إشعار مدين" : "فاتورة"}</td><td>{d.partnerName}</td><td className="n"><Money v={d.total} /></td><td><EtaBadge s={d.etaStatus} />{d.etaErrors?.length > 0 && <div className="small neg-val" title={d.etaErrors.join("\n")}>{String(d.etaErrors[0]).slice(0, 60)}</div>}</td><td className="small" dir="ltr">{d.etaUuid ? d.etaUuid.slice(0, 12) + "…" : "—"}</td><td><button className="btn sm ghost" onClick={() => setOpen(d.id)}>عرض</button></td></tr>)}</tbody></table></div>}
      </div>
      {open && <EtaDocModal id={open} onClose={(ch) => { setOpen(null); if (ch) { reload(); docs.reload(); } }} />}
    </div>
  );
}

const qOf = (d: string) => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
const prevQ = () => { const d = new Date(); d.setMonth(d.getMonth() - 3); return qOf(d.toISOString().slice(0, 10)); };

export function Form41Page() {
  const { me, can } = useCompanyContext();
  const base = useBase();
  const [period, setPeriod] = useState(prevQ());
  const { data, loading, reload } = useFetch<any>(`/tax/form41${q({ period })}`, [period]);
  const [file, setFile] = useState(false);
  const { run, busy } = useAction();
  const quarters = Array.from({ length: 8 }, (_, i) => { const d = new Date(); d.setMonth(d.getMonth() - 3 * i); return qOf(d.toISOString().slice(0, 10)); });
  const overdue = data && !data.filed && data.taxTotal > 0 && today() > data.dueDate;
  return (
    <div className="grid">
      <div className="card"><div className="card-h"><h3>🧾 الخصم تحت حساب الضريبة — نموذج 41</h3><div className="row no-print">
        <Select value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 130 }}>{[...new Set([period, ...quarters])].map((x) => <option key={x}>{x}</option>)}</Select>
        {data && <button className="btn sm" onClick={() => exportExcel([...data.deducted.map((r: any) => ({ البيان: "خصم من مورد", السند: r.number, التاريخ: r.date, الاسم: r.partnerName, "رقم التسجيل": r.vatNumber, النوع: data.types[r.whtType]?.ar, "النسبة %": Number(r.whtRate) * 100, المبلغ: Number(r.amount), الضريبة: Number(r.whtAmount) })), ...data.deductedFromUs.map((r: any) => ({ البيان: "خصم من المنشأة", السند: r.number, التاريخ: r.date, الاسم: r.partnerName, "رقم التسجيل": r.vatNumber, النوع: data.types[r.whtType]?.ar, "النسبة %": Number(r.whtRate) * 100, المبلغ: Number(r.amount), الضريبة: Number(r.whtAmount) }))], `نموذج 41 ${data.period}`)}>⬇ Excel</button>}
      </div></div>
        {loading && !data ? <Loading /> : data && <div className="card-b">
          <div className="mini-kpis mb">
            <div><span>المخصوم من الموردين (مستحق للمصلحة)</span><b className="neg-val"><Money v={data.taxTotal} /></b><small className="muted">على {money(data.baseTotal)}</small></div>
            <div><span>ما خصمه العملاء منا (رصيد مدين)</span><b className="pos-val"><Money v={data.creditsTotal} /></b></div>
            <div><span>موعد التوريد</span><b className={overdue ? "neg-val" : ""}>{fmtDate(data.dueDate)}</b></div>
            <div><span>رصيد الخصم المستحق حالياً</span><b><Money v={data.payableBalance} /></b></div>
            <div><span>رصيد الضرائب المخصومة منا</span><b><Money v={data.creditBalance} /></b><small className="muted">تُخصم من ضريبة الدخل</small></div>
          </div>
          {data.filed ? <div className="alert ok small">✓ وُرِّد الربع بالنموذج {data.filed.number} بتاريخ {fmtDate(data.filed.date)} — القيد <Link to={`${base}/journals/${data.filed.journalId}`}>{data.filed.journalNumber}</Link> {can("accounting.write") && <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { if (confirmDlg("إلغاء توريد النموذج وعكس قيده؟")) { await api(`/tax/form41/${data.filed.id}/cancel`, { body: {} }); reload(); } })}>إلغاء</button>}</div>
            : data.taxTotal > 0 && can("accounting.write") && <div className="row mb"><button className="btn primary" onClick={() => setFile(true)}>تقديم نموذج 41 وتوريد {money(data.taxTotal)}</button><span className="small muted">يُقدَّم إلكترونياً عن كل ربع خلال الشهر التالي لانتهائه. لا خصم على التعاملات حتى {data.threshold} جنيه.</span></div>}
          <h4>ملخص حسب نوع التعامل</h4>
          <div className="table-wrap"><table className="tbl compact"><thead><tr><th>النوع</th><th className="n">النسبة</th><th className="n">العدد</th><th className="n">المبالغ</th><th className="n">الضريبة</th></tr></thead>
            <tbody>{data.byType.map((g: any) => <tr key={g.type}><td>{g.typeAr}</td><td className="n">{(g.rate * 100).toFixed(1).replace(/\.0$/, "")}%</td><td className="n">{g.count}</td><td className="n"><Money v={g.base} /></td><td className="n"><Money v={g.tax} /></td></tr>)}{!data.byType.length && <tr><td colSpan={5} className="muted">لا توجد خصومات في هذا الربع</td></tr>}</tbody></table></div>
          {[["deducted", "خصومات من الموردين (المنشأة جهة خصم)"], ["deductedFromUs", "خصومات العملاء من المنشأة (تُضاف لرصيدها لدى المصلحة)"]].map(([k, t]) => data[k].length > 0 && <React.Fragment key={k}><h4 className="mt">{t}</h4><div className="table-wrap"><table className="tbl compact"><thead><tr><th>السند</th><th>التاريخ</th><th>الاسم</th><th>رقم التسجيل</th><th>النوع</th><th className="n">المبلغ</th><th className="n">الضريبة</th></tr></thead>
            <tbody>{data[k].map((r: any) => <tr key={r.id}><td>{r.number}</td><td className="dt">{fmtDate(r.date)}</td><td>{r.partnerName}</td><td dir="ltr">{r.vatNumber || "—"}</td><td className="small">{data.types[r.whtType]?.ar} {(Number(r.whtRate) * 100).toFixed(1).replace(/\.0$/, "")}%</td><td className="n"><Money v={r.amount} /></td><td className="n"><Money v={r.whtAmount} /></td></tr>)}</tbody></table></div></React.Fragment>)}
          <details className="mt"><summary className="small">نسب الخصم تحت حساب الضريبة</summary><table className="tbl compact mt"><tbody>{Object.entries(data.types).map(([k, v]: any) => <tr key={k}><td>{v.ar}</td><td className="n">{(v.rate * 100).toFixed(1).replace(/\.0$/, "")}%</td></tr>)}</tbody></table></details>
        </div>}
      </div>
      {data?.history?.length > 0 && <div className="card"><div className="card-h"><h3>سجل النماذج</h3></div><div className="table-wrap"><table className="tbl compact"><thead><tr><th>الرقم</th><th>الربع</th><th>التاريخ</th><th className="n">الضريبة</th><th>الحالة</th></tr></thead>
        <tbody>{data.history.map((h: any) => <tr key={h.id} className="clickable" onClick={() => setPeriod(h.period)}><td>{h.number}</td><td>{h.period}</td><td className="dt">{fmtDate(h.date)}</td><td className="n"><Money v={h.taxTotal} /></td><td><Badge s={h.status} /></td></tr>)}</tbody></table></div></div>}
      {file && data && <PayModal title={`توريد نموذج 41 للربع ${data.period}`} max={data.taxTotal} onSubmit={(b) => api("/tax/form41/file", { body: { period: data.period, accountId: b.accountId, date: b.date, reference: b.reference } })} onClose={(sv) => { setFile(false); if (sv) reload(); }} />}
    </div>
  );
}

export function IncomeTaxPage() {
  const { can } = useCompanyContext();
  const [year, setYear] = useState(String(new Date().getFullYear() - 1));
  const { data, loading, reload } = useFetch<any>(`/tax/income-tax${q({ year })}`, [year]);
  const [items, setItems] = useState<any[]>([]);
  const [settle, setSettle] = useState(false);
  const { run, busy } = useAction();
  const toast = useToast();
  if (loading && !data) return <Loading />;
  if (!data) return <Empty />;
  const add = items.filter((i) => i.group === "ADD").reduce((a, i) => a + Number(i.amount || 0), 0), ded = items.filter((i) => i.group === "DEDUCT").reduce((a, i) => a + Number(i.amount || 0), 0);
  const taxable = Math.max(0, data.profitBeforeTax + add - ded), tax = Math.round(taxable * data.rate * 100) / 100;
  const p = data.posted;
  return (
    <div className="grid">
      <div className="card"><div className="card-h"><h3>🏛 ضريبة الدخل على الأشخاص الاعتبارية (22.5%)</h3><div className="row"><Select value={year} onChange={(e) => { setYear(e.target.value); setItems([]); }} style={{ width: 110 }}>{Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i)).map((y) => <option key={y}>{y}</option>)}</Select></div></div>
        <div className="card-b">
          <div className="mini-kpis mb">
            <div><span>الربح المحاسبي قبل الضريبة</span><b><Money v={data.profitBeforeTax} /></b><small className="muted">{fmtDate(data.from)} – {fmtDate(data.to)}</small></div>
            <div><span>الوعاء الضريبي</span><b><Money v={p ? p.base : taxable} /></b></div>
            <div><span>الضريبة المستحقة</span><b className="neg-val"><Money v={p ? p.zakat : tax} /></b></div>
            <div><span>ضرائب مخصومة منا (خصم من المنبع)</span><b className="pos-val"><Money v={data.credits} /></b></div>
            <div><span>دفعات مقدمة</span><b><Money v={data.advances} /></b></div>
            <div><span>موعد تقديم الإقرار</span><b>{fmtDate(data.dueDate)}</b></div>
          </div>
          {p ? <div className="alert ok small">✓ مخصص ضريبة الدخل مرحّل: {p.number} — {money(p.zakat)} (المسدد {money(p.paid)}) {can("accounting.write") && Number(p.paid) < Number(p.zakat) && <><button className="btn sm primary" onClick={() => setSettle(true)}>تسوية وسداد</button> <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { if (confirmDlg("إلغاء المخصص وعكس قيده؟")) { await api(`/tax/income-tax/${p.id}/cancel`, { body: {} }); reload(); } })}>إلغاء</button></>}</div>
            : <>
              <h4>التسويات الضريبية على الربح المحاسبي</h4>
              <div className="table-wrap"><table className="tbl compact"><thead><tr><th>النوع</th><th>البيان</th><th className="n">المبلغ</th><th /></tr></thead>
                <tbody>{items.map((it, i) => <tr key={i}><td><Select value={it.group} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, group: e.target.value } : x)))}><option value="ADD">يُضاف (غير واجب الخصم)</option><option value="DEDUCT">يُخصم (إيراد معفى / خسائر مرحلة)</option></Select></td><td><Input value={it.label} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></td><td><NumInput value={it.amount} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} /></td><td><button className="btn sm ghost" onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button></td></tr>)}</tbody></table></div>
              <div className="row mt"><button className="btn sm" onClick={() => setItems([...items, { group: "ADD", label: "", amount: "" }])}>＋ تسوية</button><div className="grow" /><span>الوعاء {money(taxable)} × 22.5% = <b>{money(tax)}</b></span>
                {can("accounting.write") && <button className="btn primary" disabled={busy || !(tax > 0)} onClick={() => run(async () => { if (!confirmDlg(`ترحيل مخصص ضريبة الدخل ${money(tax)} لسنة ${year}؟`)) return; await api("/tax/income-tax", { body: { year, items } }); toast("تم ترحيل المخصص", "ok"); setItems([]); reload(); })}>ترحيل المخصص</button>}</div>
              <div className="small muted mt">القيد: من ح/ ضريبة الدخل على الأرباح إلى ح/ ضريبة الدخل المستحقة. عند التسوية تُخصم «الضرائب المخصومة منا» والدفعات المقدمة ويُسدَّد الباقي من البنك.</div>
            </>}
        </div>
      </div>
      {data.history.length > 0 && <div className="card"><div className="card-h"><h3>السجل</h3></div><div className="table-wrap"><table className="tbl compact"><thead><tr><th>الرقم</th><th>السنة</th><th className="n">الوعاء</th><th className="n">الضريبة</th><th className="n">المسدد</th><th>الحالة</th></tr></thead>
        <tbody>{data.history.map((h: any) => <tr key={h.id}><td>{h.number}</td><td>{String(h.periodTo).slice(0, 4)}</td><td className="n"><Money v={h.base} /></td><td className="n"><Money v={h.tax} /></td><td className="n"><Money v={h.paid} /></td><td><Badge s={h.status} /></td></tr>)}</tbody></table></div></div>}
      {settle && p && <PayModal title={`تسوية ضريبة الدخل ${p.number}`} max={Math.max(0, Number(p.zakat) - Number(p.paid) - data.credits - data.advances)} onSubmit={(b) => api(`/tax/income-tax/${p.id}/settle`, { body: { accountId: b.accountId, date: b.date, reference: b.reference } })} onClose={(sv) => { setSettle(false); if (sv) reload(); }} />}
    </div>
  );
}

/** Small salary-tax calculator for the payroll screen (Egyptian rules). */
export function SalaryTaxCalc() {
  const [m, setM] = useState("15000");
  const { data } = useFetch<any>(`/tax/salary-tax${q({ monthly: m })}`, [m]);
  return (
    <div className="card"><div className="card-h"><h3>حاسبة ضريبة كسب العمل والتأمينات</h3></div><div className="card-b">
      <div className="row"><Field label="إجمالي الأجر الشهري"><NumInput value={m} onChange={(e) => setM(e.target.value)} /></Field></div>
      {data && <div className="mini-kpis mt"><div><span>حصة العامل في التأمينات 11%</span><b><Money v={data.insuranceEmployee} /></b></div><div><span>الوعاء السنوي بعد الإعفاء الشخصي</span><b><Money v={data.annualTaxable} /></b></div><div><span>الضريبة السنوية</span><b><Money v={data.annualTax} /></b></div><div><span>الضريبة الشهرية</span><b className="neg-val"><Money v={data.monthlyTax} /></b></div></div>}
      {data && <table className="tbl compact mt"><thead><tr><th>الشريحة</th><th className="n">النسبة</th><th className="n">الضريبة</th></tr></thead><tbody>{data.brackets.map((b: any, i: number) => <tr key={i}><td>{money(b.from)} – {money(b.to)}</td><td className="n">{(b.rate * 100).toFixed(1).replace(/\.0$/, "")}%</td><td className="n"><Money v={b.tax} /></td></tr>)}</tbody></table>}
      <div className="small muted mt">التأمينات: 11% عامل و18.75% صاحب عمل على أجر اشتراك بين {money(data?.rules?.insurance?.minWage || 0)} و{money(data?.rules?.insurance?.maxWage || 0)} شهرياً · إعفاء شخصي {money(data?.rules?.personalExemption || 0)} سنوياً · صندوق الشهداء 0.05%.</div>
    </div></div>
  );
}
