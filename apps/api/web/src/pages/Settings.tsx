import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, q, useFetch, Money, money, Loading, Empty, Badge, Modal, Field, Input, Select, NumInput, useAction, useToast, useCompanyContext, fmtDate, fmtDT, fileToDataUrl, confirmDlg, ZATCA_AR, session } from "../lib";

const TABS = [{ key: "company", label: "بيانات المنشأة" }, { key: "invoice", label: "الفاتورة والطباعة" }, { key: "users", label: "المستخدمون والصلاحيات" }, { key: "license", label: "الاشتراك والترخيص" }, { key: "demo", label: "البيانات التجريبية" }, { key: "audit", label: "سجل التدقيق" }];

export function SettingsPage() {
  const { tab = "company" } = useParams();
  const nav = useNavigate();
  return (
    <div className="grid">
      <div className="tabs">{TABS.map((t) => <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => nav(`/settings/${t.key}`)}>{t.label}</button>)}</div>
      {tab === "company" && <CompanyForm />}
      {tab === "invoice" && <InvoiceSettings />}
      {tab === "users" && <Users />}
      {tab === "license" && <License />}
      {tab === "demo" && <DemoData />}
      {tab === "audit" && <Audit />}
    </div>
  );
}

function CompanyForm() {
  const { me, reload, can } = useCompanyContext();
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ ...me.company });
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <div className="card"><div className="card-h"><h3>بيانات المنشأة</h3></div><div className="card-b">
      <div className="form-grid">
        <Field label="الاسم بالعربية" span2><Input value={f.nameAr || ""} onChange={s("nameAr")} /></Field>
        <Field label="الاسم بالإنجليزية"><Input value={f.nameEn || ""} onChange={s("nameEn")} dir="ltr" /></Field>
        <Field label="الرقم الضريبي" hint="15 رقماً — مطلوب للفوترة الإلكترونية"><Input value={f.vatNumber || ""} onChange={s("vatNumber")} dir="ltr" /></Field>
        <Field label="السجل التجاري"><Input value={f.crNumber || ""} onChange={s("crNumber")} dir="ltr" /></Field>
        <Field label="الهاتف"><Input value={f.phone || ""} onChange={s("phone")} dir="ltr" /></Field>
        <Field label="البريد"><Input value={f.email || ""} onChange={s("email")} dir="ltr" /></Field>
        <Field label="الموقع"><Input value={f.website || ""} onChange={s("website")} dir="ltr" /></Field>
        <Field label="الشارع"><Input value={f.street || ""} onChange={s("street")} /></Field>
        <Field label="رقم المبنى"><Input value={f.buildingNo || ""} onChange={s("buildingNo")} dir="ltr" /></Field>
        <Field label="الرقم الإضافي"><Input value={f.additionalNo || ""} onChange={s("additionalNo")} dir="ltr" /></Field>
        <Field label="الحي"><Input value={f.district || ""} onChange={s("district")} /></Field>
        <Field label="المدينة"><Input value={f.city || ""} onChange={s("city")} /></Field>
        <Field label="الرمز البريدي"><Input value={f.postalCode || ""} onChange={s("postalCode")} dir="ltr" /></Field>
        <Field label="بداية السنة المالية (شهر)"><Select value={f.fiscalYearStart} onChange={s("fiscalYearStart")}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</Select></Field>
        <Field label="خيارات المخزون"><label className="check"><input type="checkbox" checked={!!f.allowNegativeStock} onChange={s("allowNegativeStock")} /> السماح بالبيع بالسالب (رصيد مخزون سالب)</label></Field>
        <Field label="التسعير"><label className="check"><input type="checkbox" checked={!!f.pricesIncludeVat} onChange={s("pricesIncludeVat")} /> أسعار البيع شاملة الضريبة (للتجزئة)</label></Field>
        <Field label="الشعار"><div className="row"><label className="btn sm">رفع شعار<input type="file" accept="image/*" hidden onChange={async (e) => { const file = e.target.files?.[0]; if (file) setF({ ...f, logo: await fileToDataUrl(file, 400) }); }} /></label>{f.logo && <><img src={f.logo} style={{ height: 40 }} alt="" /><button className="btn ghost sm" onClick={() => setF({ ...f, logo: null })}>✕</button></>}</div></Field>
      </div>
      {can("settings.write") && <button className="btn primary mt" disabled={busy} onClick={() => run(async () => { await api("/settings", { method: "PUT", body: f }); reload(); }, "تم الحفظ")}>حفظ</button>}
    </div></div>
  );
}

function InvoiceSettings() {
  const { me, reload, can } = useCompanyContext();
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ invoiceFooter: me.company.invoiceFooter || "", invoiceTerms: me.company.invoiceTerms || "" });
  return (
    <div className="card"><div className="card-h"><h3>الفاتورة والطباعة</h3></div><div className="card-b">
      <div className="grid">
        <Field label="شروط وملاحظات تظهر أسفل الفاتورة"><textarea className="input" value={f.invoiceTerms} onChange={(e) => setF({ ...f, invoiceTerms: e.target.value })} placeholder="مثال: البضاعة المباعة لا تُرد ولا تُستبدل بعد 3 أيام" /></Field>
        <Field label="تذييل الفاتورة والإيصال الحراري"><Input value={f.invoiceFooter} onChange={(e) => setF({ ...f, invoiceFooter: e.target.value })} placeholder="شكراً لتعاملكم معنا" /></Field>
        <div className="alert info">الفاتورة الضريبية تُطبع بصيغة A4 كاملة أو إيصال حراري 80 مم، وتحمل رمز QR وفق متطلبات الهيئة تلقائياً. الشعار والعنوان الوطني يُضبطان من تبويب بيانات المنشأة.</div>
      </div>
      {can("settings.write") && <button className="btn primary mt" disabled={busy} onClick={() => run(async () => { await api("/settings", { method: "PUT", body: f }); reload(); }, "تم الحفظ")}>حفظ</button>}
    </div></div>
  );
}

function Users() {
  const { me, can } = useCompanyContext();
  const { data, reload } = useFetch("/users");
  const { run, busy } = useAction();
  const [add, setAdd] = useState(false);
  const [f, setF] = useState<any>({ email: "", fullName: "", password: "", role: "ACCOUNTANT" });
  return (
    <div className="card"><div className="card-h"><h3>المستخدمون <span className="muted small">({data?.length || 0} / {me.company.maxUsers})</span></h3>{can("users.write") && <button className="btn primary sm" onClick={() => setAdd(true)}>＋ مستخدم</button>}</div>
      <div className="card-b">
        <div className="alert info small">الأدوار: <b>المالك/مدير النظام</b> كل الصلاحيات · <b>محاسب</b> كل العمليات دون إدارة المستخدمين · <b>مندوب مبيعات</b> عروض وفواتير وتحصيل · <b>كاشير</b> نقطة البيع فقط · <b>أمين مستودع</b> أصناف ومخزون واستلام · <b>مشاهد/مدقق</b> قراءة فقط.</div>
        {!data ? <Loading /> : <table className="tbl"><thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>آخر دخول</th><th>الحالة</th><th /></tr></thead><tbody>{data.map((u: any) => <tr key={u.id}><td><b>{u.fullName}</b></td><td dir="ltr">{u.email}</td><td>{can("users.write") && u.role !== "OWNER" ? <Select value={u.role} onChange={(e) => run(async () => { await api(`/users/${u.id}`, { method: "PUT", body: { role: e.target.value } }); reload(); })} style={{ width: 160 }}>{Object.entries(me.roles).filter(([k]) => k !== "OWNER").map(([k, v]: any) => <option key={k} value={k}>{v}</option>)}</Select> : me.roles[u.role]}</td><td className="small">{fmtDT(u.lastLoginAt)}</td><td><Badge s={u.isActive ? "ACTIVE" : "CANCELLED"} map={{ ACTIVE: "نشط", CANCELLED: "موقوف" }} /></td><td className="row" style={{ gap: 4 }}>{can("users.write") && u.role !== "OWNER" && <><button className="btn sm ghost" onClick={() => run(async () => { const p = prompt("كلمة مرور جديدة (8 أحرف على الأقل)"); if (p) await api(`/users/${u.id}`, { method: "PUT", body: { password: p } }); }, "تم التغيير")}>كلمة المرور</button><button className="btn sm ghost" onClick={() => run(async () => { await api(`/users/${u.id}`, { method: "PUT", body: { isActive: !u.isActive } }); reload(); })}>{u.isActive ? "إيقاف" : "تفعيل"}</button><button className="btn sm ghost" onClick={() => run(async () => { if (confirmDlg("إزالة المستخدم من المنشأة؟")) { await api(`/users/${u.id}`, { method: "DELETE" }); reload(); } })}>إزالة</button></>}</td></tr>)}</tbody></table>}
      </div>
      {add && <Modal narrow title="إضافة مستخدم" onClose={() => setAdd(false)} footer={<><button className="btn" onClick={() => setAdd(false)}>إلغاء</button><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api("/users", { body: f }); setAdd(false); reload(); }, "تمت الإضافة")}>إضافة</button></>}>
        <div className="grid"><Field label="الاسم"><Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field><Field label="البريد الإلكتروني"><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} dir="ltr" /></Field><Field label="كلمة المرور" hint="إن كان البريد مسجلاً مسبقاً في ميزان تُتجاهل"><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} dir="ltr" /></Field><Field label="الدور"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{Object.entries(me.roles).filter(([k]) => k !== "OWNER").map(([k, v]: any) => <option key={k} value={k}>{v}</option>)}</Select></Field></div>
      </Modal>}
    </div>
  );
}

function License() {
  const { me, reload } = useCompanyContext();
  const { run, busy } = useAction();
  const [key, setKey] = useState("");
  const s = me.subscription;
  const PLAN: Record<string, string> = { TRIAL: "تجريبية مجانية", BASIC: "الأساسية", PRO: "الاحترافية", ENTERPRISE: "المؤسسات" };
  return (
    <div className="grid c2">
      <div className="card"><div className="card-h"><h3>الاشتراك الحالي</h3></div><div className="card-b stat-list">
        <div className="item"><span>الخطة</span><b>{PLAN[me.company.plan] || me.company.plan}</b></div>
        <div className="item"><span>الحالة</span><b>{s.readOnly ? <span className="badge red">{s.reason === "SUSPENDED" ? "موقوف" : "منتهٍ — قراءة فقط"}</span> : <span className="badge green">نشط</span>}</b></div>
        <div className="item"><span>ينتهي في</span><b>{me.company.subscriptionEndsAt ? fmtDate(me.company.subscriptionEndsAt) : "غير محدود"}{s.daysLeft !== null && ` (${s.daysLeft} يوم)`}</b></div>
        <div className="item"><span>الحد الأقصى للمستخدمين</span><b>{me.company.maxUsers}</b></div>
      </div></div>
      <div className="card"><div className="card-h"><h3>تفعيل مفتاح ترخيص</h3></div><div className="card-b">
        <p className="muted">أدخل مفتاح الترخيص (السيريال) الذي حصلت عليه من مزود النظام. يمدد المفتاح الاشتراك تلقائياً من تاريخ انتهاء الاشتراك الحالي.</p>
        <Field label="مفتاح الترخيص"><Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="MZN-PRO-XXXXX-XXXXX-XXXXX-XXXXX" dir="ltr" style={{ fontFamily: "monospace", letterSpacing: 1 }} /></Field>
        <button className="btn primary mt" disabled={busy || key.length < 10} onClick={() => run(async () => { await api("/auth/activate-license", { body: { key } }); setKey(""); reload(); }, "تم تفعيل الترخيص بنجاح")}>تفعيل</button>
      </div></div>
    </div>
  );
}

function DemoData() {
  const { me, reload, can } = useCompanyContext();
  const { run, busy } = useAction();
  const st = useFetch("/demo/status");
  const job = st.data?.demoJob;
  useEffect(() => { if (job && !job.done && !job.error) { const t = setTimeout(() => st.reload(), 1500); return () => clearTimeout(t); } if (job?.done && !me.company.demoLoaded) reload(); }, [job]);
  return (
    <div className="card"><div className="card-h"><h3>البيانات التجريبية</h3></div><div className="card-b">
      <p>تحمّل مجموعة بيانات واقعية لستة أشهر (عملاء وموردون وأصناف، مشتريات ومبيعات وورديات نقاط بيع، مصروفات وسندات، أصول وإهلاك، وإقرار ضريبي) تمر كلها عبر المحرك المحاسبي لتظهر كل التقارير بأرقام كاملة. كل سجل يُوسم <span className="badge amber">تجريبي</span> ويمكن حذفه بالكامل لاحقاً دون المساس ببياناتك الحقيقية.</p>
      {job && !job.done && !job.error && <div className="mt"><div className="row between small"><span>{job.step}</span><span>{job.pct}%</span></div><div className="progress mt"><div style={{ width: job.pct + "%" }} /></div></div>}
      {job?.error && <div className="alert err mt">{job.step}</div>}
      {st.data && can("settings.write") && <div className="row mt">
        {!st.data.demoLoaded ? <button className="btn primary" disabled={busy || (job && !job.done && !job.error)} onClick={() => run(async () => { await api("/demo/load", { body: {} }); st.reload(); })}>تحميل البيانات التجريبية</button>
          : <button className="btn danger" disabled={busy} onClick={() => run(async () => { if (!confirmDlg("حذف كل البيانات التجريبية (المستندات والقيود والأصناف والعملاء الموسومة تجريبي)؟")) return; await api("/demo/purge", { body: {} }); st.reload(); reload(); }, "تم حذف البيانات التجريبية")}>حذف البيانات التجريبية نهائياً</button>}
      </div>}
    </div></div>
  );
}

function Audit() {
  const { data } = useFetch("/audit?limit=300");
  return <div className="card"><div className="card-h"><h3>سجل التدقيق</h3></div>{!data ? <Loading /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الوقت</th><th>المستخدم</th><th>الإجراء</th><th>الكيان</th><th>التفاصيل</th></tr></thead><tbody>{data.map((a: any) => <tr key={a.id}><td className="small num">{fmtDT(a.createdAt)}</td><td>{a.userName}</td><td><span className="badge gray">{a.action}</span></td><td>{a.entity}</td><td className="small muted" dir="ltr">{a.details ? JSON.stringify(a.details).slice(0, 120) : ""}</td></tr>)}</tbody></table></div>}</div>;
}

// ─── ZATCA ─────────────────────────────────────────────────────────────────
export function ZatcaPage() {
  const { me, can } = useCompanyContext();
  const toast = useToast();
  const { data: z, reload } = useFetch("/zatca");
  const { run, busy } = useAction();
  const [otp, setOtp] = useState("");
  const [csr, setCsr] = useState("");
  const [imp, setImp] = useState(false);
  const [keys, setKeys] = useState<any>({ privateKey: "", csr: "", complianceCert: "", complianceSecret: "", productionCert: "", productionSecret: "" });
  const pending = useFetch(`/invoices${q({ direction: "SALE", status: "POSTED", limit: 50, zatca: "PENDING" })}`);
  if (!z) return <Loading />;
  const w = can("settings.write");
  return (
    <div className="grid">
      <div className="grid c2">
        <div className="card"><div className="card-h"><h3>إعداد الفوترة الإلكترونية (ZATCA)</h3></div><div className="card-b">
          <div className="form-grid">
            <Field label="المرحلة"><Select value={z.phase} disabled={!w} onChange={(e) => run(async () => { await api("/zatca", { method: "PUT", body: { phase: Number(e.target.value), environment: z.environment } }); reload(); })}><option value={1}>المرحلة الأولى — إصدار فواتير مع QR</option><option value={2}>المرحلة الثانية — الربط والتكامل مع منصة فاتورة</option></Select></Field>
            <Field label="بيئة الهيئة"><Select value={z.environment} disabled={!w} onChange={(e) => run(async () => { await api("/zatca", { method: "PUT", body: { phase: z.phase, environment: e.target.value } }); reload(); })}><option value="SANDBOX">Sandbox (بوابة المطورين)</option><option value="SIMULATION">Simulation (محاكاة)</option><option value="PRODUCTION">Production (الإنتاج الفعلي)</option></Select></Field>
            <Field label="اسم الفرع (للشهادة)"><Input defaultValue={z.branchName || ""} onBlur={(e) => w && api("/zatca", { method: "PUT", body: { phase: z.phase, branchName: e.target.value } })} /></Field>
            <Field label="النشاط"><Input defaultValue={z.industry || ""} onBlur={(e) => w && api("/zatca", { method: "PUT", body: { phase: z.phase, industry: e.target.value } })} placeholder="Retail / Trading / Restaurant" dir="ltr" /></Field>
          </div>
          <div className="stat-list mt">
            <div className="item"><span>الرقم الضريبي للمنشأة</span><b className="num">{me.company.vatNumber || <span className="neg-val">غير مُدخل — أدخله من إعدادات المنشأة</span>}</b></div>
            <div className="item"><span>معرّف الجهاز (EGS UUID)</span><b className="num small">{z.egsUuid}</b></div>
            <div className="item"><span>عداد الفواتير (ICV)</span><b className="num">{z.icvCounter}</b></div>
            <div className="item"><span>المفتاح الخاص و CSR</span><b>{z.hasKey && z.csr ? <span className="badge green">جاهز</span> : <span className="badge gray">لم يُنشأ</span>}</b></div>
            <div className="item"><span>شهادة الامتثال (CCSID)</span><b>{z.hasCompliance ? <span className="badge green">صادرة</span> : <span className="badge gray">—</span>}</b></div>
            <div className="item"><span>شهادة الإنتاج (PCSID)</span><b>{z.hasProduction ? <span className="badge green">صادرة — {fmtDate(z.onboardedAt)}</span> : <span className="badge gray">—</span>}</b></div>
          </div>
        </div></div>
        <div className="card"><div className="card-h"><h3>خطوات الربط (المرحلة الثانية)</h3></div><div className="card-b">
          <ol style={{ paddingInlineStart: 18, display: "grid", gap: 10 }}>
            <li><b>توليد المفتاح وطلب الشهادة (CSR)</b> — يُولّد زوج مفاتيح secp256k1 على الخادم وفق مواصفة الهيئة.<div className="row mt">{w && <button className="btn sm" disabled={busy} onClick={() => run(async () => { if (z.hasKey && !confirmDlg("سيُستبدل المفتاح الحالي وتُلغى الشهادات — متابعة؟")) return; const r = await api("/zatca/csr", { body: {} }); setCsr(r.csr); reload(); }, "تم توليد CSR")}>توليد المفاتيح و CSR</button>}{w && <button className="btn sm ghost" onClick={() => setImp(true)}>أو استيراد مفاتيح جاهزة</button>}</div>{csr && <textarea className="input mt" dir="ltr" readOnly value={csr} style={{ fontSize: 10, fontFamily: "monospace", height: 90 }} />}</li>
            <li><b>الحصول على رمز OTP</b> من بوابة فاتورة (fatoora.zatca.gov.sa) ← إدارة الحلول والأجهزة ← ربط جهاز جديد.</li>
            <li><b>إصدار شهادة الامتثال</b> بإرسال CSR مع OTP.<div className="row mt"><Input placeholder="OTP (6 أرقام)" value={otp} onChange={(e) => setOtp(e.target.value)} dir="ltr" style={{ width: 140 }} />{w && <button className="btn sm primary" disabled={busy || !otp || !z.csr} onClick={() => run(async () => { await api("/zatca/compliance-csid", { body: { otp } }); reload(); }, "تم إصدار شهادة الامتثال")}>إصدار CCSID</button>}</div></li>
            <li><b>فحص الامتثال</b>: أصدر فاتورة ضريبية مبسطة وأخرى قياسية وإشعاراً دائناً ومديناً، ثم من صفحة كل مستند اضغط "إرسال للهيئة" — في بيئة الامتثال تُفحص الفواتير دون تسجيلها.</li>
            <li><b>إصدار شهادة الإنتاج</b> بعد اجتياز الفحص.<div className="mt">{w && <button className="btn sm primary" disabled={busy || !z.hasCompliance} onClick={() => run(async () => { await api("/zatca/production-csid", { body: {} }); reload(); }, "تم إصدار شهادة الإنتاج — الربط مكتمل")}>إصدار PCSID</button>}</div></li>
          </ol>
          <div className="alert info mt small">بعد الربط تُوقّع كل فاتورة بيع تلقائياً (XML UBL 2.1، هاش متسلسل PIH، عداد ICV، توقيع ECDSA، وQR بتسع خانات) وتُرسل للهيئة فور الترحيل: المبسطة عبر <b>الإبلاغ</b> خلال 24 ساعة، والقياسية عبر <b>الاعتماد</b> اللحظي. الفواتير الصادرة قبل الربط تحمل حالة "بانتظار الربط" وتُوقّع وتُرسل بضغطة زر بعد اكتماله.</div>
        </div></div>
      </div>
      <div className="card"><div className="card-h"><h3>حالة الفواتير لدى الهيئة</h3><div className="row">{z.stats.map((s: any) => <span key={s.status} className="row" style={{ gap: 4 }}><Badge s={s.status} map={ZATCA_AR} /><b>{s.c}</b></span>)}{w && z.phase === 2 && <button className="btn sm primary" disabled={busy} onClick={() => run(async () => { const r = await api("/zatca/submit-pending", { body: {} }); toast(`أُرسلت ${r.length} فاتورة — ناجحة: ${r.filter((x: any) => ["REPORTED", "CLEARED"].includes(x.status)).length}`, "ok"); reload(); pending.reload(); })}>إرسال كل الفواتير المعلقة</button>}</div></div>
        {pending.data && pending.data.rows.length > 0 && <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الفاتورة</th><th>التاريخ</th><th>العميل</th><th className="n">الإجمالي</th><th>الحالة</th></tr></thead><tbody>{pending.data.rows.map((i: any) => <tr key={i.id}><td>{i.number}</td><td>{fmtDate(i.date)}</td><td>{i.partnerName}</td><td className="n"><Money v={i.total} /></td><td><Badge s={i.zatcaStatus} map={ZATCA_AR} /></td></tr>)}</tbody></table></div>}
      </div>
      {imp && <Modal title="استيراد مفاتيح وشهادات (من أداة الهيئة الرسمية)" onClose={() => setImp(false)} footer={<><button className="btn" onClick={() => setImp(false)}>إلغاء</button><button className="btn primary" onClick={() => run(async () => { await api("/zatca/import-keys", { body: keys }); setImp(false); reload(); }, "تم الاستيراد")}>حفظ</button></>}>
        <div className="grid">{[["privateKey", "المفتاح الخاص (EC PRIVATE KEY)"], ["csr", "طلب الشهادة CSR"], ["complianceCert", "شهادة الامتثال (اختياري)"], ["complianceSecret", "Secret شهادة الامتثال"], ["productionCert", "شهادة الإنتاج (اختياري)"], ["productionSecret", "Secret شهادة الإنتاج"]].map(([k, l]) => <Field key={k} label={l}><textarea className="input" dir="ltr" style={{ fontFamily: "monospace", fontSize: 11, minHeight: 50 }} value={keys[k]} onChange={(e) => setKeys({ ...keys, [k]: e.target.value })} /></Field>)}</div>
      </Modal>}
    </div>
  );
}

// ─── super admin ───────────────────────────────────────────────────────────
export function AdminPage() {
  const { data, reload } = useFetch("/admin/overview");
  const { run, busy } = useAction();
  const toast = useToast();
  const [f, setF] = useState<any>({ plan: "PRO", months: 12, maxUsers: 10, count: 1, note: "" });
  const [made, setMade] = useState<any[]>([]);
  if (!data) return <Loading />;
  return (
    <div className="grid">
      <div className="grid c3">
        <div className="card kpi"><div className="label">المنشآت المسجلة</div><div className="value">{data.companies.length}</div></div>
        <div className="card kpi info"><div className="label">المستخدمون</div><div className="value">{data.usersCount}</div></div>
        <div className="card kpi accent"><div className="label">مفاتيح ترخيص غير مستخدمة</div><div className="value">{data.keys.filter((k: any) => !k.activatedAt).length}</div></div>
      </div>
      <div className="card"><div className="card-h"><h3>إصدار مفاتيح ترخيص (سيريال)</h3></div><div className="card-b">
        <div className="form-grid"><Field label="الخطة"><Select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}><option value="BASIC">BASIC — أساسية</option><option value="PRO">PRO — احترافية</option><option value="ENTERPRISE">ENTERPRISE — مؤسسات</option></Select></Field><Field label="المدة (أشهر)"><NumInput value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} /></Field><Field label="عدد المستخدمين"><NumInput value={f.maxUsers} onChange={(e) => setF({ ...f, maxUsers: e.target.value })} /></Field><Field label="عدد المفاتيح"><NumInput value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} /></Field><Field label="ملاحظة (العميل/الموزع)" span2><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field></div>
        <button className="btn primary mt" disabled={busy} onClick={() => run(async () => { const r = await api("/admin/license-keys", { body: f }); setMade(r); reload(); }, "تم الإصدار")}>إصدار</button>
        {made.length > 0 && <div className="alert ok mt" dir="ltr" style={{ fontFamily: "monospace" }}>{made.map((k) => <div key={k.id}>{k.key}</div>)}</div>}
      </div></div>
      <div className="card"><div className="card-h"><h3>المنشآت</h3></div><div className="table-wrap"><table className="tbl compact"><thead><tr><th>المنشأة</th><th>الرقم الضريبي</th><th>الخطة</th><th>ينتهي</th><th>المستخدمون</th><th>الفواتير</th><th>آخر نشاط</th><th>الحالة</th><th /></tr></thead>
        <tbody>{data.companies.map((c: any) => <tr key={c.id}><td><b>{c.nameAr}</b><div className="small muted">{c.email} · {c.phone}</div></td><td className="num">{c.vatNumber}</td><td>{c.plan}</td><td>{fmtDate(c.subscriptionEndsAt) || "∞"}</td><td>{c.users} / {c.maxUsers}</td><td>{c.invoices}</td><td className="small">{fmtDT(c.lastActivity)}</td><td><Badge s={c.status} map={{ ACTIVE: "نشط", SUSPENDED: "موقوف" }} /></td>
          <td className="row" style={{ gap: 4 }}><button className="btn sm ghost" onClick={() => run(async () => { const m = prompt("تمديد بعدد الأشهر", "12"); if (m) { await api(`/admin/companies/${c.id}/extend`, { body: { months: Number(m), plan: c.plan === "TRIAL" ? "PRO" : undefined } }); reload(); } }, "تم التمديد")}>تمديد</button><button className="btn sm ghost" onClick={() => run(async () => { await api(`/admin/companies/${c.id}/status`, { body: { status: c.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" } }); reload(); })}>{c.status === "ACTIVE" ? "إيقاف" : "تفعيل"}</button><button className="btn sm ghost" onClick={() => run(async () => { const r = await api("/auth/switch", { body: { companyId: c.id } }); session.token = r.token; location.href = "/"; })}>دخول</button></td></tr>)}</tbody></table></div></div>
      <div className="card"><div className="card-h"><h3>مفاتيح الترخيص</h3></div><div className="table-wrap"><table className="tbl compact"><thead><tr><th>المفتاح</th><th>الخطة</th><th>الأشهر</th><th>المستخدمون</th><th>ملاحظة</th><th>المنشأة</th><th>فُعّل في</th></tr></thead><tbody>{data.keys.map((k: any) => <tr key={k.id} className={k.activatedAt ? "muted" : ""}><td dir="ltr" style={{ fontFamily: "monospace" }}>{k.key}</td><td>{k.plan}</td><td>{k.months}</td><td>{k.maxUsers}</td><td>{k.note}</td><td>{k.companyName}</td><td className="small">{fmtDT(k.activatedAt)}</td></tr>)}</tbody></table></div></div>
    </div>
  );
}
