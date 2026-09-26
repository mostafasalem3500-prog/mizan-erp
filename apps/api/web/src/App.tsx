import React, { useEffect, useState } from "react";
import { Routes, Route, NavLink, useNavigate, useLocation, Navigate } from "react-router-dom";
import { api, session, AppCtx, useToast, Input, Field, useAction, Modal, Select } from "./lib";
import { Dashboard } from "./pages/Dashboard";
import { DocumentsPage, DocumentView, PublicInvoice } from "./pages/Documents";
import { PosPage } from "./pages/Pos";
import { PartnersPage, ProductsPage, InventoryPage } from "./pages/Master";
import { PaymentsPage, ExpensesPage, AssetsPage } from "./pages/Money";
import { AccountsPage, JournalsPage, PeriodsPage } from "./pages/Accounting";
import { BankPage } from "./pages/Bank";
import { ChequesPage, RecurringPage } from "./pages/Round3";
import { ReportsPage, VatPage } from "./pages/Reports";
import { SettingsPage, ZatcaPage, AdminPage } from "./pages/Settings";

const NAV = [
  { group: "الرئيسية" },
  { to: "/", ic: "▦", label: "لوحة المؤشرات", perm: "dashboard.read" },
  { to: "/pos", ic: "🛒", label: "نقطة البيع", perm: "pos.use" },
  { group: "المبيعات" },
  { to: "/sales/invoices", ic: "🧾", label: "فواتير المبيعات", perm: "sales.read" },
  { to: "/sales/quotations", ic: "📝", label: "عروض الأسعار والأوامر", perm: "sales.read" },
  { to: "/sales/credit-notes", ic: "↩", label: "الإشعارات الدائنة", perm: "sales.read" },
  { to: "/customers", ic: "👥", label: "العملاء", perm: "partners.read" },
  { to: "/receipts", ic: "💵", label: "سندات القبض", perm: "payments.read" },
  { group: "المشتريات" },
  { to: "/purchases/invoices", ic: "📦", label: "فواتير المشتريات", perm: "purchases.read" },
  { to: "/purchases/orders", ic: "📋", label: "أوامر الشراء", perm: "purchases.read" },
  { to: "/purchases/returns", ic: "↪", label: "مرتجعات المشتريات", perm: "purchases.read" },
  { to: "/suppliers", ic: "🏭", label: "الموردون", perm: "partners.read" },
  { to: "/vouchers", ic: "💸", label: "سندات الصرف", perm: "payments.read" },
  { to: "/expenses", ic: "🧮", label: "المصروفات", perm: "expenses.read" },
  { group: "المخزون" },
  { to: "/products", ic: "🏷", label: "الأصناف", perm: "products.read" },
  { to: "/inventory", ic: "🏬", label: "المستودعات والجرد", perm: "inventory.read" },
  { group: "المحاسبة" },
  { to: "/accounts", ic: "🌳", label: "دليل الحسابات", perm: "accounting.read" },
  { to: "/journals", ic: "📒", label: "القيود اليومية", perm: "accounting.read" },
  { to: "/cheques", ic: "🧾", label: "الشيكات", perm: "payments.read" },
  { to: "/bank", ic: "🏦", label: "التسوية البنكية", perm: "accounting.read" },
  { to: "/recurring", ic: "🔁", label: "القيود الدورية", perm: "accounting.read" },
  { to: "/assets", ic: "🏢", label: "الأصول الثابتة", perm: "assets.read" },
  { to: "/periods", ic: "📅", label: "السنوات والفترات", perm: "accounting.read" },
  { to: "/vat", ic: "٪", label: "ضريبة القيمة المضافة", perm: "vat.read" },
  { to: "/reports", ic: "📊", label: "التقارير", perm: "reports.read" },
  { group: "الإعدادات" },
  { to: "/zatca", ic: "🔐", label: "الفوترة الإلكترونية", perm: "settings.read" },
  { to: "/settings", ic: "⚙", label: "إعدادات المنشأة", perm: "settings.read" },
];

const ROLE_PERMS: Record<string, string[]> = {
  OWNER: ["*"], ADMIN: ["*"],
  ACCOUNTANT: ["*.read", "sales.write", "purchases.write", "payments.write", "expenses.write", "accounting.write", "inventory.write", "assets.write", "vat.write", "pos.use", "partners.write", "products.write"],
  SALES: ["sales.read", "sales.write", "partners.read", "partners.write", "products.read", "inventory.read", "payments.read", "payments.write", "dashboard.read", "reports.sales"],
  CASHIER: ["pos.use", "products.read", "partners.read", "partners.write", "sales.read", "dashboard.read"],
  STOREKEEPER: ["products.read", "products.write", "inventory.read", "inventory.write", "purchases.read", "partners.read", "dashboard.read"],
  VIEWER: ["*.read"],
};
function canRole(role: string | null, perm: string, superAdmin = false) {
  if (superAdmin) return true;
  const ps = ROLE_PERMS[role || ""] || [];
  return ps.includes("*") || ps.includes(perm) || (perm.endsWith(".read") && ps.includes("*.read"));
}

export function App() {
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(!!session.token);
  const [menu, setMenu] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const reload = () => api("/auth/me").then(setMe).catch(() => { session.token = null; setMe(null); }).finally(() => setLoading(false));
  useEffect(() => { if (session.token) reload(); const h = () => { setMe(null); nav("/login"); }; window.addEventListener("mz-logout", h); return () => window.removeEventListener("mz-logout", h); }, []);
  useEffect(() => setMenu(false), [loc.pathname]);
  if (loc.pathname.startsWith("/p/")) return <Routes><Route path="/p/:token" element={<PublicInvoice />} /></Routes>;
  if (loading) return <div className="empty" style={{ paddingTop: 120 }}><span className="spinner" /></div>;
  if (!me) return <Routes><Route path="/register" element={<AuthPage mode="register" onDone={reload} />} /><Route path="*" element={<AuthPage mode="login" onDone={reload} />} /></Routes>;
  const can = (p: string) => canRole(me.role, p, me.superAdmin);
  if (!me.company) return <AppCtx.Provider value={{ me, reload, can }}><NoCompany /></AppCtx.Provider>;
  const isPos = loc.pathname === "/pos";
  return (
    <AppCtx.Provider value={{ me, reload, can }}>
      {isPos ? (
        <PosPage />
      ) : (
        <div className="app">
          <aside className={"sidebar" + (menu ? " open" : "")}>
            <div className="brand"><img src="/favicon.svg" alt="" /> ميزان ERP</div>
            <div className="company"><b>{me.company.nameAr}</b><span>{me.roles?.[me.role] || me.role} · {me.user.fullName}</span></div>
            <nav>
              {NAV.map((n: any, i) => n.group ? <div key={i} className="group">{n.group}</div> : (can(n.perm) ? <NavLink key={n.to} to={n.to} end={n.to === "/"}><span className="ic">{n.ic}</span>{n.label}</NavLink> : null))}
              {me.superAdmin && <><div className="group">النظام</div><NavLink to="/admin"><span className="ic">🛡</span>إدارة النظام والتراخيص</NavLink></>}
            </nav>
            <div className="foot">
              <SubscriptionLine me={me} />
              <button className="btn sm ghost" style={{ color: "#fff", marginTop: 6 }} onClick={() => { session.token = null; setMe(null); nav("/login"); }}>تسجيل الخروج</button>
            </div>
          </aside>
          <div className="main">
            <div className="topbar">
              <button className="btn sm burger" onClick={() => setMenu((m) => !m)}>☰</button>
              <div className="title">{NAV.find((n: any) => n.to === loc.pathname)?.label || ""}</div>
              <div className="grow" />
              <CompanySwitcher me={me} onSwitched={reload} />
              <NavLink to="/pos" className="btn primary sm">🛒 نقطة البيع</NavLink>
            </div>
            <div className="content">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/sales/invoices" element={<DocumentsPage direction="SALE" kinds={["INVOICE"]} title="فواتير المبيعات" />} />
                <Route path="/sales/quotations" element={<DocumentsPage direction="SALE" kinds={["QUOTATION", "ORDER"]} title="عروض الأسعار وأوامر البيع" />} />
                <Route path="/sales/credit-notes" element={<DocumentsPage direction="SALE" kinds={["CREDIT_NOTE", "DEBIT_NOTE"]} title="الإشعارات الدائنة والمدينة" />} />
                <Route path="/purchases/invoices" element={<DocumentsPage direction="PURCHASE" kinds={["INVOICE"]} title="فواتير المشتريات" />} />
                <Route path="/purchases/orders" element={<DocumentsPage direction="PURCHASE" kinds={["QUOTATION", "ORDER"]} title="أوامر الشراء" />} />
                <Route path="/purchases/returns" element={<DocumentsPage direction="PURCHASE" kinds={["CREDIT_NOTE", "DEBIT_NOTE"]} title="مرتجعات المشتريات" />} />
                <Route path="/doc/:id" element={<DocumentView />} />
                <Route path="/customers" element={<PartnersPage role="CUSTOMER" />} />
                <Route path="/suppliers" element={<PartnersPage role="SUPPLIER" />} />
                <Route path="/receipts" element={<PaymentsPage direction="IN" />} />
                <Route path="/vouchers" element={<PaymentsPage direction="OUT" />} />
                <Route path="/expenses" element={<ExpensesPage />} />
                <Route path="/products" element={<ProductsPage />} />
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/accounts" element={<AccountsPage />} />
                <Route path="/journals" element={<JournalsPage />} />
                <Route path="/assets" element={<AssetsPage />} />
                <Route path="/bank" element={<BankPage />} />
                <Route path="/cheques" element={<ChequesPage />} />
                <Route path="/recurring" element={<RecurringPage />} />
                <Route path="/periods" element={<PeriodsPage />} />
                <Route path="/vat" element={<VatPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/reports/:tab" element={<ReportsPage />} />
                <Route path="/zatca" element={<ZatcaPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/settings/:tab" element={<SettingsPage />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="*" element={<Navigate to="/" />} />
              </Routes>
            </div>
          </div>
        </div>
      )}
    </AppCtx.Provider>
  );
}

function SubscriptionLine({ me }: { me: any }) {
  const s = me.subscription;
  if (!s) return null;
  if (s.readOnly) return <div style={{ color: "#fca5a5" }}>⚠ {s.reason === "SUSPENDED" ? "الحساب موقوف" : "انتهى الاشتراك — قراءة فقط"}</div>;
  if (s.daysLeft !== null && s.daysLeft <= 30) return <div style={{ color: "#fcd34d" }}>{me.company.plan === "TRIAL" ? "تجريبي" : me.company.plan} · متبقٍ {s.daysLeft} يوم</div>;
  return <div>الخطة: {me.company.plan === "TRIAL" ? "تجريبية" : me.company.plan}</div>;
}

function CompanySwitcher({ me, onSwitched }: { me: any; onSwitched: () => void }) {
  const toast = useToast();
  if (!me.companies || me.companies.length < 2) return null;
  return (
    <Select value={me.company.id} style={{ width: 200 }} onChange={async (e) => { try { const r = await api("/auth/switch", { body: { companyId: e.target.value } }); session.token = r.token; onSwitched(); } catch (er: any) { toast(er.message, "err"); } }}>
      {me.companies.map((c: any) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
    </Select>
  );
}

function NoCompany() {
  const { reload } = React.useContext(AppCtx);
  const { run, busy } = useAction();
  const [name, setName] = useState("");
  return (
    <div className="auth"><div className="form"><div className="box card"><div className="card-b">
      <h2>أنشئ منشأتك</h2>
      <p className="muted">لا توجد منشأة مرتبطة بحسابك بعد.</p>
      <Field label="اسم المنشأة"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <button className="btn primary block mt" disabled={busy} onClick={() => run(async () => { const r = await api("/auth/companies", { body: { nameAr: name } }); session.token = r.token; reload(); })}>إنشاء</button>
    </div></div></div></div>
  );
}

function AuthPage({ mode, onDone }: { mode: "login" | "register"; onDone: () => void }) {
  const nav = useNavigate();
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ email: "", password: "", fullName: "", companyName: "", vatNumber: "", phone: "" });
  const [demo, setDemo] = useState<any>(null);
  useEffect(() => { api("/auth/demo-credentials").then(setDemo).catch(() => undefined); }, []);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = (e: React.FormEvent) => { e.preventDefault(); run(async () => { const r = await api(mode === "login" ? "/auth/login" : "/auth/register", { body: f }); session.token = r.token; onDone(); nav("/"); }); };
  return (
    <div className="auth">
      <div className="art">
        <div className="row"><img src="/favicon.svg" width={54} alt="" /><h1>ميزان ERP</h1></div>
        <p style={{ fontSize: 17, opacity: .95 }}>نظام محاسبي سحابي متكامل للمنشآت السعودية: محاسبة عامة، مبيعات ومشتريات، نقاط بيع، مخزون، أصول، وتقارير مالية — متوافق مع ضريبة القيمة المضافة والفوترة الإلكترونية (المرحلتان الأولى والثانية).</p>
        <ul>
          <li>✔ دليل حسابات سعودي جاهز وقيود آلية لكل عملية</li>
          <li>✔ فواتير ضريبية مع QR وربط مع منصة فاتورة (ZATCA)</li>
          <li>✔ نقطة بيع سريعة بالورديات ومتعددة طرق الدفع</li>
          <li>✔ مخزون بالمتوسط المرجح وكرت صنف وجرد</li>
          <li>✔ ميزان مراجعة، قائمة دخل، ميزانية، تدفقات نقدية، أعمار ديون، إقرار ضريبي</li>
          <li>✔ متعدد الشركات والمستخدمين مع صلاحيات وسجل تدقيق</li>
        </ul>
      </div>
      <div className="form">
        <form className="box card" onSubmit={submit}>
          <div className="card-b">
            <h2 className="mb">{mode === "login" ? "تسجيل الدخول" : "إنشاء حساب جديد"}</h2>
            <div className="grid">
              {mode === "register" && <>
                <Field label="الاسم الكامل"><Input required value={f.fullName} onChange={set("fullName")} /></Field>
                <Field label="اسم المنشأة"><Input required value={f.companyName} onChange={set("companyName")} /></Field>
                <Field label="الرقم الضريبي (اختياري)"><Input value={f.vatNumber} onChange={set("vatNumber")} placeholder="3xxxxxxxxxxxxx3" dir="ltr" /></Field>
                <Field label="الجوال"><Input value={f.phone} onChange={set("phone")} dir="ltr" /></Field>
              </>}
              <Field label="البريد الإلكتروني"><Input required type="email" value={f.email} onChange={set("email")} dir="ltr" autoFocus /></Field>
              <Field label="كلمة المرور"><Input required type="password" value={f.password} onChange={set("password")} dir="ltr" /></Field>
              <button className="btn primary lg" disabled={busy}>{mode === "login" ? "دخول" : "إنشاء الحساب وبدء التجربة المجانية"}</button>
              {demo?.email && mode === "login" && <button type="button" className="btn" onClick={() => setF({ ...f, email: demo.email, password: demo.password })}>تعبئة بيانات الحساب التجريبي</button>}
              <div className="muted small" style={{ textAlign: "center" }}>
                {mode === "login" ? <>ليس لديك حساب؟ <a href="/register" onClick={(e) => { e.preventDefault(); nav("/register"); }}>سجّل منشأتك مجاناً</a></> : <>لديك حساب؟ <a href="/login" onClick={(e) => { e.preventDefault(); nav("/login"); }}>سجّل الدخول</a></>}
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
