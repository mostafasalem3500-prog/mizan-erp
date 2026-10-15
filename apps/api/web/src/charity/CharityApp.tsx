/** Separate interface for charities / non-profit associations, served at /charity on the same ledger. */
import React, { createContext, useContext, useEffect, useState } from "react";
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from "react-router-dom";
import { api, AppCtx, BaseCtx, useFetch } from "../lib";
import { DocumentsPage, DocumentView } from "../pages/Documents";
import { PayrollPage } from "../pages/Payroll";
import { CollectionsPage } from "../pages/Collections";
import { CharityDashboard, ReceiptsPage, DisbursementsPage, RequestsPage, BatchesPage, DailyPage, ArchivePage, ProjectsPage, PeoplePage, BudgetPage, ActivitiesPage } from "./pages";
import { TemplatesCenter, CharitySettingsPage, BlankFormsPage } from "./TemplatesCenter";
import { CustodyPage, PurchasesPage, RefundsPage } from "./pages2";
import { SponsorshipsPage, InkindPage, VolunteersPage } from "./pages3";
import { TreasuryPage, JournalView } from "../pages/Round20";
import "./charity.css";

export const ChCtx = createContext<{ settings: any; reload: () => void; projects: any[]; reloadProjects: () => void }>({ settings: null, reload: () => undefined, projects: [], reloadProjects: () => undefined });
export const useCharity = () => useContext(ChCtx);

export const CH_NAV: any[] = [
  { group: "الرئيسية" },
  { to: "/charity", ic: "▦", label: "لوحة المؤشرات", perm: "payments.read" },
  { group: "الإيرادات والتبرعات" },
  { to: "/charity/receipts", ic: "💚", label: "سندات القبض والتبرعات", perm: "payments.read" },
  { to: "/charity/donors", ic: "🤝", label: "العملاء المتبرعون", perm: "partners.read" },
  { to: "/charity/collections", ic: "📞", label: "التحصيل", perm: "sales.read" },
  { to: "/charity/sponsorships", ic: "🤲", label: "الكفالات", perm: "payments.read" },
  { to: "/charity/inkind", ic: "📦", label: "التبرعات العينية", perm: "payments.read" },
  { to: "/charity/daily", ic: "📥", label: "تحصيل دخول الأموال اليومية", perm: "payments.read" },
  { to: "/charity/quotations", ic: "📝", label: "عروض الأسعار", perm: "sales.read" },
  { group: "المصروفات" },
  { to: "/charity/expenses", ic: "💸", label: "المصروفات (سندات الصرف)", perm: "payments.read" },
  { to: "/charity/requests", ic: "📋", label: "طلبات الصرف", perm: "payments.read" },
  { to: "/charity/batches", ic: "🧾", label: "مسير المصروفات", perm: "payments.read" },
  { to: "/charity/beneficiaries", ic: "👪", label: "المستفيدون", perm: "partners.read" },
  { to: "/charity/volunteers", ic: "🙋", label: "المتطوعون وساعات التطوع", perm: "payments.read" },
  { to: "/charity/payroll", ic: "👔", label: "الرواتب", perm: "accounting.read", companyOnly: true },
  { group: "المشتريات والعهد" },
  { to: "/charity/purchases", ic: "🛍", label: "طلبات الشراء ومحاضر الاستلام", perm: "payments.read" },
  { to: "/charity/custody", ic: "💼", label: "العهد المالية", perm: "payments.read" },
  { to: "/charity/refunds", ic: "↩", label: "طلبات الاسترداد", perm: "payments.read" },
  { group: "التخطيط والرقابة" },
  { to: "/charity/treasury", ic: "🏦", label: "الحسابات البنكية والخزائن", perm: "payments.read" },
  { to: "/charity/projects", ic: "🎯", label: "المشاريع والبرامج", perm: "payments.read" },
  { to: "/charity/budget", ic: "📊", label: "الموازنة التقديرية", perm: "reports.read", companyOnly: true },
  { to: "/charity/reports", ic: "📈", label: "قائمة الأنشطة والتقارير", perm: "reports.read" },
  { to: "/charity/archive", ic: "🗄", label: "أرشيف الفواتير والمستندات", perm: "payments.read" },
  { group: "النماذج والإعدادات" },
  { to: "/charity/templates", ic: "🖨", label: "القوالب الجاهزة A4", perm: "payments.read" },
  { to: "/charity/blank-forms", ic: "📄", label: "النماذج الفارغة للطباعة", perm: "payments.read" },
  { to: "/charity/settings", ic: "⚙", label: "إعدادات الجمعية", perm: "settings.read", companyOnly: true },
];

export function CharityApp({ onLogout }: { onLogout: () => void }) {
  const { me, can } = useContext(AppCtx);
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const st = useFetch("/charity/settings");
  const pr = useFetch<any[]>("/charity/projects");
  useEffect(() => setMenu(false), [loc.pathname]);
  useEffect(() => { document.title = (st.data?.associationName || "الجمعية") + " — ميزان"; return () => { document.title = "ميزان ERP"; }; }, [st.data?.associationName]);
  const s = st.data;
  const labels: Record<string, string> = s?.theme?.labels || {};
  const items = CH_NAV.filter((n) => n.group || (can(n.perm) && !(me.lockedBranch && n.companyOnly)));
  const cur = items.find((n) => n.to === loc.pathname) || items.find((n) => n.to && n.to !== "/charity" && loc.pathname.startsWith(n.to + "/"));
  return (
    <BaseCtx.Provider value="/charity">
      <ChCtx.Provider value={{ settings: s, reload: st.reload, projects: pr.data || [], reloadProjects: pr.reload }}>
        <div className="app charity-app">
          <aside className={"sidebar" + (menu ? " open" : "")}>
            <div className="brand">
              <div className="ch-logo">{s?.company?.logo ? <img src={s.company.logo} alt="" /> : <div className="ph">{(s?.associationName || me.company.nameAr).slice(0, 1)}</div>}<span className="ch-name">{s?.associationName || me.company.nameAr}</span></div>
              <small>{s?.licenseNo ? `ترخيص رقم ${s.licenseNo}` : "واجهة الجمعيات الخيرية"}</small>
            </div>
            <nav>
              {items.map((n, i) => n.group ? <div key={i} className="group">{n.group}</div> : <NavLink key={n.to} to={n.to} end={n.to === "/charity"}><span className="ic">{n.ic}</span>{labels[n.to] || n.label}</NavLink>)}
            </nav>
            <div className="foot">
              <div>{me.user.fullName} · {me.roles?.[me.role] || me.role}</div>
              <a className="ch-switch" href="/" onClick={(e) => { e.preventDefault(); nav("/"); }}>⇄ البرنامج المحاسبي الأساسي</a>
              <button className="btn sm ghost" style={{ color: "#fff" }} onClick={onLogout}>تسجيل الخروج</button>
            </div>
          </aside>
          <div className="main">
            <div className="topbar">
              <button className="btn sm burger" onClick={() => setMenu((m) => !m)}>☰</button>
              <div className="title">{cur ? labels[cur.to] || cur.label : loc.pathname.startsWith("/charity/doc/") ? "عرض المستند" : ""}</div>
              <div className="grow" />
              {can("payments.write") && <><NavLink className="btn sm" to="/charity/receipts?new=1">＋ سند قبض</NavLink><NavLink className="btn sm primary" to="/charity/expenses?new=1">＋ سند صرف</NavLink></>}
            </div>
            <div className="content">
              {!s ? <div className="empty"><span className="spinner" /></div> : (
                <Routes>
                  <Route path="/charity" element={<CharityDashboard />} />
                  <Route path="/charity/receipts" element={<ReceiptsPage />} />
                  <Route path="/charity/donors" element={<PeoplePage role="DONOR" />} />
                  <Route path="/charity/beneficiaries" element={<PeoplePage role="BENEFICIARY" />} />
                  <Route path="/charity/collections" element={<CollectionsPage />} />
                  <Route path="/charity/daily" element={<DailyPage />} />
                  <Route path="/charity/quotations" element={<DocumentsPage direction="SALE" kinds={["QUOTATION", "ORDER"]} title="عروض الأسعار" />} />
                  <Route path="/charity/doc/:id" element={<DocumentView />} />
                  <Route path="/charity/expenses" element={<DisbursementsPage />} />
                  <Route path="/charity/requests" element={<RequestsPage />} />
                  <Route path="/charity/batches" element={<BatchesPage />} />
                  <Route path="/charity/payroll" element={<PayrollPage />} />
                  <Route path="/charity/payroll/:tab" element={<PayrollPage />} />
                  <Route path="/charity/sponsorships" element={<SponsorshipsPage />} />
                  <Route path="/charity/inkind" element={<InkindPage />} />
                  <Route path="/charity/volunteers" element={<VolunteersPage />} />
                  <Route path="/charity/purchases" element={<PurchasesPage />} />
                  <Route path="/charity/custody" element={<CustodyPage />} />
                  <Route path="/charity/refunds" element={<RefundsPage />} />
                  <Route path="/charity/treasury" element={<TreasuryPage />} />
                  <Route path="/charity/journals/:id" element={<JournalView />} />
                  <Route path="/charity/projects" element={<ProjectsPage />} />
                  <Route path="/charity/budget" element={<BudgetPage />} />
                  <Route path="/charity/reports" element={<ActivitiesPage />} />
                  <Route path="/charity/archive" element={<ArchivePage />} />
                  <Route path="/charity/templates" element={<TemplatesCenter />} />
                  <Route path="/charity/blank-forms" element={<BlankFormsPage />} />
                  <Route path="/charity/settings" element={<CharitySettingsPage />} />
                  <Route path="*" element={<Navigate to="/charity" />} />
                </Routes>
              )}
            </div>
          </div>
        </div>
      </ChCtx.Provider>
    </BaseCtx.Provider>
  );
}

/** Opens the charity interface on login when the association chose it as default. */
export async function charityDefault(): Promise<boolean> {
  try { const s = await api("/charity/settings"); return !!s.defaultUi; } catch { return false; }
}
