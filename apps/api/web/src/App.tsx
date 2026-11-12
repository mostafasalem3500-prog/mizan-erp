import React, { useEffect, useState } from "react";
import { Routes, Route, NavLink, useNavigate, useLocation, Navigate } from "react-router-dom";
import { api, session, AppCtx, useToast, Input, Field, useAction, Modal, Select } from "./lib";
import { GlobalSearch } from "./pages/Search";
const CharityApp = React.lazy(() => import("./charity/CharityApp").then((m) => ({ default: m.CharityApp })));
const charityDefault = async () => (CFG.charity ? (await import("./charity/CharityApp")).charityDefault() : false);
import { CFG } from "./shared/country";
import { SideNav, useNav } from "./nav";
import { Dashboard } from "./pages/Dashboard"; // the landing screen ships with the shell
import { setSheetMeta } from "./shared/sheet";
import { ThemeToggle } from "./pages/Round28";
import { LearnPage, TasksPage, HelpButton, TasksBadge, FavStar, NetBar, OfflineNote, useShortcuts } from "./pages/Learn";
import { DEFAULT_LOGO, DEFAULT_NAME, DEFAULT_LICENSE } from "./charity/ctx";

/** Each screen is its own chunk, fetched the first time it is opened — the shell stays small. */
const LOADERS = new Set<() => Promise<any>>();
/** Once the shell is up, fetch the other screens one by one while the browser is idle — opening a screen then never waits. */
function warmScreens() {
  if ((navigator as any).connection?.saveData) return;
  const list = [...LOADERS]; LOADERS.clear();
  const idle: (f: () => void) => void = (window as any).requestIdleCallback ? (f) => (window as any).requestIdleCallback(f, { timeout: 3000 }) : (f) => setTimeout(f, 300);
  const next = () => { const l = list.shift(); if (l) idle(() => l().catch(() => undefined).finally(next)); };
  setTimeout(next, 1500);
}
const lz = <M extends Record<string, any>>(load: () => Promise<M>, name: keyof M & string) => (LOADERS.add(load), React.lazy(() => load().then((m) => ({ default: m[name] as React.ComponentType<any> })).catch((e) => {
  // a new version was deployed while this tab was open: its old chunks are gone — reload once to pick up the new ones
  const k = "mz-chunk-reload"; const last = Number(sessionStorage.getItem(k) || 0);
  if (Date.now() - last > 30000) { sessionStorage.setItem(k, String(Date.now())); window.location.reload(); return new Promise<never>(() => undefined); }
  throw e;
})));
const Wait = <div className="empty" style={{ paddingTop: 80 }}><span className="spinner" /></div>;
const DocumentsPage = lz(() => import("./pages/Documents"), "DocumentsPage");
const DocumentView = lz(() => import("./pages/Documents"), "DocumentView");
const PublicInvoice = lz(() => import("./pages/Documents"), "PublicInvoice");
const PosPage = lz(() => import("./pages/Pos"), "PosPage");
const PartnersPage = lz(() => import("./pages/Master"), "PartnersPage");
const ProductsPage = lz(() => import("./pages/Master"), "ProductsPage");
const InventoryPage = lz(() => import("./pages/Master"), "InventoryPage");
const PaymentsPage = lz(() => import("./pages/Money"), "PaymentsPage");
const ExpensesPage = lz(() => import("./pages/Money"), "ExpensesPage");
const AssetsPage = lz(() => import("./pages/Money"), "AssetsPage");
const AccountsPage = lz(() => import("./pages/Accounting"), "AccountsPage");
const JournalsPage = lz(() => import("./pages/Accounting"), "JournalsPage");
const PeriodsPage = lz(() => import("./pages/Accounting"), "PeriodsPage");
const BankPage = lz(() => import("./pages/Bank"), "BankPage");
const ChequesPage = lz(() => import("./pages/Round3"), "ChequesPage");
const RecurringPage = lz(() => import("./pages/Round3"), "RecurringPage");
const PayrollPage = lz(() => import("./pages/Payroll"), "PayrollPage");
const BudgetsPage = lz(() => import("./pages/Budgets"), "BudgetsPage");
const PriceListsPage = lz(() => import("./pages/Pricing"), "PriceListsPage");
const LabelsPage = lz(() => import("./pages/Stock"), "LabelsPage");
const ReorderPage = lz(() => import("./pages/Stock"), "ReorderPage");
const CollectionsPage = lz(() => import("./pages/Collections"), "CollectionsPage");
const CustomerPortal = lz(() => import("./pages/Integrations"), "CustomerPortal");
const LotsPage = lz(() => import("./pages/Lots"), "LotsPage");
const ReportsPage = lz(() => import("./pages/Reports"), "ReportsPage");
const VatPage = lz(() => import("./pages/Reports"), "VatPage");
const SettingsPage = lz(() => import("./pages/Settings"), "SettingsPage");
const ProjectsPage = lz(() => import("./pages/Projects"), "ProjectsPage");
const ProjectDetailPage = lz(() => import("./pages/Projects"), "ProjectDetailPage");
const KitchenPage = lz(() => import("./pages/Restaurant"), "KitchenPage");
const PosSetupPage = lz(() => import("./pages/Restaurant"), "PosSetupPage");
const PrintTemplatesPage = lz(() => import("./pages/PrintTemplates"), "PrintTemplatesPage");
const ZatcaPage = lz(() => import("./pages/Settings"), "ZatcaPage");
const AdminPage = lz(() => import("./pages/Settings"), "AdminPage");
const ReportCenterPage = lz(() => import("./pages/ReportCenter"), "ReportCenterPage");
const PartnerProfilePage = lz(() => import("./pages/PartnerProfile"), "PartnerProfilePage");
const ProductProfilePage = lz(() => import("./pages/Round20"), "ProductProfilePage");
const TreasuryPage = lz(() => import("./pages/Round20"), "TreasuryPage");
const JournalView = lz(() => import("./pages/Round20"), "JournalView");
const CountSheetPage = lz(() => import("./pages/Round20"), "CountSheetPage");
const ZakatPage = lz(() => import("./pages/Round23"), "ZakatPage");
const WhtPage = lz(() => import("./pages/Round23"), "WhtPage");
const FinancialAnalysisPage = lz(() => import("./pages/Round25"), "FinancialAnalysisPage");
const FinalAccountsPage = lz(() => import("./pages/Round27"), "FinalAccountsPage");
const EtaPage = lz(() => import("./pages/Egypt"), "EtaPage");
const Form41Page = lz(() => import("./pages/Egypt"), "Form41Page");
const IncomeTaxPage = lz(() => import("./pages/Egypt"), "IncomeTaxPage");
const AiAssistantPage = lz(() => import("./pages/Ai"), "AiAssistantPage");
const InsightsPage = lz(() => import("./pages/Insights"), "InsightsPage");
const DigestPage = lz(() => import("./pages/DigestArchive"), "DigestPage");
const ArchivePage = lz(() => import("./pages/DigestArchive"), "ArchivePage");
const ClosingPage = lz(() => import("./pages/Round31"), "ClosingPage");
const JournalApprovalsPage = lz(() => import("./pages/Round31"), "JournalApprovalsPage");
const CostAllocationsPage = lz(() => import("./pages/Round31"), "CostAllocationsPage");
const CvpPage = lz(() => import("./pages/Round31"), "CvpPage");
const PromotionsPage = lz(() => import("./pages/Round28"), "PromotionsPage");
const LoyaltyPage = lz(() => import("./pages/Round28"), "LoyaltyPage");

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

function PageTitle({ can, lockedBranch }: { can: (p: string) => boolean; lockedBranch: boolean }) {
  const { active } = useNav(can, lockedBranch);
  const loc = useLocation();
  useShortcuts(active?.g.items?.find((i) => i.action)?.to || null);
  const label = active?.i?.label || active?.g.label || "";
  // the menu entry itself when it is a plain screen; otherwise the open address (a profile, a report…)
  const to = active?.i && !active.i.action && active.s >= 1000 ? active.i.to : active?.g.to && active.s >= 1000 ? active.g.to : null;
  // the browser tab and history carry the screen's name
  useEffect(() => { if (label) document.title = `${label} — ${CFG.appName || "ميزان ERP"}`; }, [label]);
  return <><h1 className="title">{active?.i ? <><span className="crumb">{active.g.label} ‹ </span>{active.i.label}</> : label}</h1><FavStar to={to} label={label} /></>;
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
  useEffect(() => { if (me?.company) warmScreens(); }, [!!me?.company]);
  if (loc.pathname.startsWith("/p/")) return <React.Suspense fallback={Wait}><Routes><Route path="/p/:token" element={<PublicInvoice />} /></Routes></React.Suspense>;
  if (loc.pathname.startsWith("/c/")) return <React.Suspense fallback={Wait}><Routes><Route path="/c/:token" element={<CustomerPortal />} /></Routes></React.Suspense>;
  if (loading) return <div className="empty" style={{ paddingTop: 120 }}><span className="spinner" /></div>;
  if (!me) return <Routes><Route path="/register" element={<AuthPage mode="register" onDone={reload} />} /><Route path="*" element={<AuthPage mode="login" onDone={reload} />} /></Routes>;
  const can = (p: string) => canRole(me.role, p, me.superAdmin);
  setSheetMeta(me.company ? { company: me.company.nameAr, taxId: me.company.vatNumber, taxLabel: CFG.taxIdLabel } : {});
  if (!me.company) return <AppCtx.Provider value={{ me, reload, can }}><NoCompany /></AppCtx.Provider>;
  const logout = () => { session.token = null; setMe(null); nav(loc.pathname.startsWith("/charity") ? "/charity" : "/login"); };
  if (loc.pathname === "/charity" || loc.pathname.startsWith("/charity/")) return CFG.charity ? <AppCtx.Provider value={{ me, reload, can }}><React.Suspense fallback={<div className="empty" style={{ paddingTop: 120 }}><span className="spinner" /></div>}><CharityApp onLogout={logout} /></React.Suspense></AppCtx.Provider> : <Navigate to="/" replace />;
  const isPos = loc.pathname === "/pos";
  return (
    <AppCtx.Provider value={{ me, reload, can }}>
      {isPos ? (
        <React.Suspense fallback={Wait}><PosPage /></React.Suspense>
      ) : (
        <div className="app">
          <a className="skip-link" href="#content">تخطَّ إلى المحتوى</a>
          <aside className={"sidebar" + (menu ? " open" : "")}>
            <div className="brand"><img src="/favicon.svg" alt="" /> {CFG.appName}{CFG.desktop && <span className="badge" title="قاعدة البيانات على هذا الجهاز" style={{ marginInlineStart: 6, fontSize: 11 }}>💻 محلي</span>}</div>
            <div className="company"><b>{me.company.nameAr}</b><span>{me.roles?.[me.role] || me.role} · {me.user.fullName}</span>{me.branch && <span title={me.lockedBranch ? "صلاحيتك مقيدة بهذا الفرع" : "الفرع الافتراضي"}>{me.lockedBranch ? "🔒 " : "🏬 "}{me.branch.name}</span>}</div>
            <SideNav can={can} lockedBranch={!!me.lockedBranch} extra={<>
              {CFG.charity && can("payments.read") && <NavLink to="/charity" className="nav-top" style={{ marginTop: 10, background: "rgba(183,134,43,.18)", color: "#f3e3bd" }}><span className="ic">💚</span>واجهة الجمعيات الخيرية</NavLink>}
              {me.superAdmin && <NavLink to="/admin" className="nav-top"><span className="ic">🛡</span>إدارة النظام والتراخيص</NavLink>}
            </>} />
            <div className="foot">
              <SubscriptionLine me={me} />
              <div className="small" style={{ opacity: .6 }} title="رقم الإصدار المعروض الآن">الإصدار {(window as any).MIZAN_VERSION}</div>
              <button className="btn sm ghost" style={{ color: "#fff", marginTop: 6 }} onClick={() => { session.token = null; setMe(null); nav("/login"); }}>تسجيل الخروج</button>
            </div>
          </aside>
          <div className="main">
            <div className="topbar" role="banner">
              <button className="btn sm burger" aria-label="القائمة الرئيسية" onClick={() => setMenu((m) => !m)}>☰</button>
              <NavLink to="/" end className="btn sm home-btn" title="الرجوع إلى الشاشة الرئيسية (Alt + D)"><span aria-hidden>🏠</span><span className="home-t"> الرئيسية</span></NavLink>
              <PageTitle can={can} lockedBranch={!!me.lockedBranch} />
              <div className="grow" />
              <GlobalSearch />
              <HelpButton />
              <TasksBadge />
              <ThemeToggle />
              <CompanySwitcher me={me} onSwitched={reload} />
              <NavLink to="/pos" className="btn primary sm">🛒 نقطة البيع</NavLink>
            </div>
            <NetBar /><OfflineNote />
            <div className="content" id="content" role="main" tabIndex={-1}>
              <React.Suspense fallback={Wait}><Routes>
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
                <Route path="/customers/:id" element={<PartnerProfilePage role="CUSTOMER" />} />
                <Route path="/suppliers/:id" element={<PartnerProfilePage role="SUPPLIER" />} />
                <Route path="/receipts" element={<PaymentsPage direction="IN" />} />
                <Route path="/vouchers" element={<PaymentsPage direction="OUT" />} />
                <Route path="/expenses" element={<ExpensesPage />} />
                <Route path="/products" element={<ProductsPage />} />
                <Route path="/products/:id" element={<ProductProfilePage />} />
                <Route path="/treasury" element={<TreasuryPage />} />
                <Route path="/journals/:id" element={<JournalView />} />
                <Route path="/inventory/count-sheet" element={<CountSheetPage />} />
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/lots" element={<LotsPage />} />
                <Route path="/reorder" element={<ReorderPage />} />
                <Route path="/labels" element={<LabelsPage />} />
                <Route path="/accounts" element={<AccountsPage />} />
                <Route path="/journals" element={<JournalsPage />} />
                <Route path="/assets" element={<AssetsPage />} />
                <Route path="/bank" element={<BankPage />} />
                <Route path="/cheques" element={<ChequesPage />} />
                <Route path="/recurring" element={<RecurringPage />} />
                <Route path="/payroll" element={<PayrollPage />} />
                <Route path="/payroll/:tab" element={<PayrollPage />} />
                <Route path="/periods" element={<PeriodsPage />} />
                <Route path="/vat" element={<VatPage />} />
                <Route path="/tax/wht" element={<WhtPage />} />
                <Route path="/zakat" element={<ZakatPage />} />
                <Route path="/eta" element={<EtaPage />} />
                <Route path="/tax/form41" element={<Form41Page />} />
                <Route path="/tax/income-tax" element={<IncomeTaxPage />} />
                <Route path="/analysis" element={<FinancialAnalysisPage />} />
                <Route path="/final-accounts" element={<FinalAccountsPage />} />
                <Route path="/price-lists" element={<PriceListsPage />} />
                <Route path="/promotions" element={<PromotionsPage />} />
                <Route path="/ai" element={<AiAssistantPage />} />
                <Route path="/insights" element={<InsightsPage />} />
                <Route path="/digest" element={<DigestPage />} />
                <Route path="/archive" element={<ArchivePage />} />
                <Route path="/learn" element={<LearnPage />} />
                <Route path="/closing" element={<ClosingPage />} />
                <Route path="/journal-approvals" element={<JournalApprovalsPage />} />
                <Route path="/cost-allocations" element={<CostAllocationsPage />} />
                <Route path="/cvp" element={<CvpPage />} />
                <Route path="/tasks" element={<TasksPage />} />
                <Route path="/loyalty" element={<LoyaltyPage />} />
                <Route path="/collections" element={<CollectionsPage />} />
                <Route path="/budgets" element={<BudgetsPage />} />
                <Route path="/budgets/:id" element={<BudgetsPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/reports/:tab" element={<ReportsPage />} />
                <Route path="/reports-center" element={<ReportCenterPage />} />
                <Route path="/reports-center/:key" element={<ReportCenterPage />} />
                <Route path="/zatca" element={<ZatcaPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/settings/templates" element={<PrintTemplatesPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/:id" element={<ProjectDetailPage />} />
                <Route path="/pos/kitchen" element={<KitchenPage />} />
                <Route path="/pos/setup" element={<PosSetupPage />} />
                <Route path="/settings/:tab" element={<SettingsPage />} />
                <Route path="/admin" element={me.superAdmin ? <AdminPage /> : <Navigate to="/" />} />
                <Route path="*" element={<Navigate to="/" />} />
              </Routes></React.Suspense>
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
  if (s.readOnly) return <div style={{ color: "#fca5a5" }}>⚠ {s.reason === "SUSPENDED" ? "الحساب موقوف" : s.reason === "DEVICE" ? "الترخيص لجهاز آخر — قراءة فقط" : "انتهى الاشتراك — قراءة فقط"}</div>;
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
  const loc = useLocation();
  const charity = !!CFG.charity && loc.pathname.startsWith("/charity");
  useEffect(() => { if (!charity) return; document.title = DEFAULT_NAME; const l = document.querySelector<HTMLLinkElement>('link[rel~="icon"]'); const h = l?.href, ty = l?.type; if (l) { l.href = DEFAULT_LOGO; l.type = "image/png"; } return () => { document.title = "ميزان ERP"; if (l && h) { l.href = h; l.type = ty || ""; } }; }, [charity]);
  const submit = (e: React.FormEvent) => { e.preventDefault(); run(async () => { const r = await api(mode === "login" ? "/auth/login" : "/auth/register", { body: f }); session.token = r.token; const target = charity ? loc.pathname : (await charityDefault()) ? "/charity" : "/"; onDone(); nav(target); }); };
  return (
    <div className={"auth" + (charity ? " ch-auth" : "")}>
      {charity ? <div className="art">
        <div className="ch-auth-id"><img src={DEFAULT_LOGO} alt={DEFAULT_NAME} /><h1>{DEFAULT_NAME}</h1><div style={{ opacity: .85 }}>ترخيص رقم {DEFAULT_LICENSE}</div></div>
        <ul>
          <li>✔ سندات القبض والصرف والتبرعات والكفالات</li>
          <li>✔ المستفيدون والمتطوعون والمشاريع والميزانية</li>
          <li>✔ العهد والمشتريات وطلبات الصرف والمسيّرات</li>
          <li>✔ نماذج A4 رسمية بشعار الجمعية — مطبوعة أو فارغة</li>
          <li>✔ قيود محاسبية آلية وقائمة الأنشطة</li>
        </ul>
      </div> : <div className="art">
        <div className="row"><img src="/favicon.svg" width={54} alt="" /><h1>{CFG.appName}</h1></div>
        {CFG.country === "EG" ? <p style={{ fontSize: 17, opacity: .95 }}>نظام محاسبي سحابي متكامل للشركات المصرية: محاسبة عامة، مبيعات ومشتريات، نقاط بيع، مخزون، رواتب وتأمينات، وتقارير مالية — متوافق مع ضريبة القيمة المضافة 14% ومنظومة الفاتورة والإيصال الإلكتروني.</p> : CFG.desktop ? <p style={{ fontSize: 17, opacity: .95 }}>نسخة سطح المكتب — تعمل على هذا الجهاز دون إنترنت، وبياناتك محفوظة عليه فقط. محاسبة عامة، مبيعات ومشتريات، نقاط بيع، مخزون، أصول، وتقارير مالية — متوافقة مع ضريبة القيمة المضافة والفوترة الإلكترونية (المرحلتان الأولى والثانية).</p> : <p style={{ fontSize: 17, opacity: .95 }}>نظام محاسبي سحابي متكامل للمنشآت السعودية: محاسبة عامة، مبيعات ومشتريات، نقاط بيع، مخزون، أصول، وتقارير مالية — متوافق مع ضريبة القيمة المضافة والفوترة الإلكترونية (المرحلتان الأولى والثانية).</p>}
        <ul>
          {CFG.country === "EG" ? <><li>✔ دليل حسابات مصري جاهز وقيود آلية لكل عملية</li><li>✔ الفاتورة والإيصال الإلكتروني (مصلحة الضرائب) والخصم تحت حساب الضريبة (نموذج 41)</li><li>✔ رواتب بالتأمينات (قانون 148) وضريبة كسب العمل</li></> : <><li>✔ دليل حسابات سعودي جاهز وقيود آلية لكل عملية</li>
          <li>✔ فواتير ضريبية مع QR وربط مع منصة فاتورة (ZATCA)</li></>}
          <li>✔ نقطة بيع سريعة بالورديات ومتعددة طرق الدفع</li>
          <li>✔ مخزون بالمتوسط المرجح وكرت صنف وجرد</li>
          <li>✔ ميزان مراجعة، قائمة دخل، ميزانية، تدفقات نقدية، أعمار ديون، إقرار ضريبي</li>
          <li>✔ متعدد الشركات والمستخدمين مع صلاحيات وسجل تدقيق</li>
        </ul>
      </div>}
      <div className="form">
        <form className="box card" onSubmit={submit}>
          <div className="card-b">
            {charity && <div className="ch-auth-m"><img src={DEFAULT_LOGO} alt="" /><b>{DEFAULT_NAME}</b></div>}<h2 className="mb">{mode === "login" ? "تسجيل الدخول" : "إنشاء حساب جديد"}</h2>
            {CFG.desktop && !charity && <div className="alert info small">💻 <b>الوضع المحلي:</b> قاعدة البيانات على هذا الجهاز — الحسابات هنا مستقلة عن حسابات السحابة. {mode === "login" ? "أول مرة؟ أنشئ حساب منشأتك من «إنشاء حساب جديد»." : ""}</div>}
            {charity && <div className="alert info small">الدخول إلى منصة {DEFAULT_NAME} — بحساب ميزان ERP نفسه</div>}
            <div className="grid">
              {mode === "register" && <>
                <Field label="الاسم الكامل"><Input required value={f.fullName} onChange={set("fullName")} /></Field>
                <Field label="اسم المنشأة"><Input required value={f.companyName} onChange={set("companyName")} /></Field>
                <Field label={`${CFG.taxIdLabel} (اختياري)`}><Input value={f.vatNumber} onChange={set("vatNumber")} placeholder={CFG.country === "EG" ? "9 أرقام" : "3xxxxxxxxxxxxx3"} dir="ltr" /></Field>
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
