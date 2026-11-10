/**
 * Main menu: a few top-level modules, each opening to its screens — the layout accountants know from Qoyod, Daftra,
 * Odoo, Zoho Books and QuickBooks (sales · purchases · expenses · inventory · cash & banks · accounting · payroll ·
 * taxes · final accounts · reports · settings), with direct «＋ new» shortcuts and a menu filter.
 */
import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { CFG } from "./shared/country";

export type NavItem = { to: string; label: string; perm: string; sa?: boolean; eg?: boolean; company?: boolean; action?: boolean };
export type NavGroup = { key: string; ic: string; label: string; to?: string; perm?: string; items?: NavItem[] };

export const NAV_TREE: NavGroup[] = [
  { key: "home", ic: "▦", label: "لوحة المؤشرات", to: "/", perm: "dashboard.read" },
  { key: "pos", ic: "🛒", label: "نقطة البيع", to: "/pos", perm: "pos.use" },
  { key: "sales", ic: "🧾", label: "المبيعات", items: [
    { to: "/sales/invoices?new=INVOICE", label: "فاتورة مبيعات جديدة", perm: "sales.write", action: true },
    { to: "/sales/invoices", label: "فواتير المبيعات", perm: "sales.read" },
    { to: "/sales/quotations", label: "عروض الأسعار وأوامر البيع", perm: "sales.read" },
    { to: "/sales/credit-notes", label: "الإشعارات الدائنة والمرتجعات", perm: "sales.read" },
    { to: "/customers", label: "العملاء", perm: "partners.read" },
    { to: "/receipts", label: "سندات القبض", perm: "payments.read" },
    { to: "/collections", label: "التحصيل والمتابعة", perm: "sales.read" },
    { to: "/price-lists", label: "قوائم الأسعار", perm: "products.read" },
    { to: "/promotions", label: "العروض والخصومات", perm: "sales.read" },
    { to: "/loyalty", label: "نقاط الولاء", perm: "sales.read" },
  ] },
  { key: "purchases", ic: "📦", label: "المشتريات", items: [
    { to: "/purchases/invoices?new=INVOICE", label: "فاتورة مشتريات جديدة", perm: "purchases.write", action: true },
    { to: "/purchases/invoices", label: "فواتير المشتريات", perm: "purchases.read" },
    { to: "/purchases/orders", label: "أوامر الشراء", perm: "purchases.read" },
    { to: "/purchases/returns", label: "مرتجعات المشتريات", perm: "purchases.read" },
    { to: "/suppliers", label: "الموردون", perm: "partners.read" },
    { to: "/vouchers", label: "سندات الصرف", perm: "payments.read" },
  ] },
  { key: "expenses", ic: "🧮", label: "المصروفات", items: [
    { to: "/expenses?new=1", label: "تسجيل مصروف", perm: "expenses.write", action: true },
    { to: "/expenses", label: "سجل المصروفات", perm: "expenses.read" },
    { to: "/recurring", label: "المصروفات والقيود الدورية", perm: "accounting.read", company: true },
    { to: "/reports/expenses", label: "تحليل المصروفات", perm: "reports.read", company: true },
    { to: "/reports/cost-centers", label: "مراكز التكلفة", perm: "reports.read", company: true },
  ] },
  { key: "inventory", ic: "🏬", label: "المخزون", items: [
    { to: "/products", label: "الأصناف والخدمات", perm: "products.read" },
    { to: "/inventory", label: "تقييم المخزون", perm: "inventory.read" },
    { to: "/inventory?tab=adj", label: "الجرد والتسويات والتحويلات", perm: "inventory.read" },
    { to: "/inventory?tab=wh", label: "المستودعات", perm: "inventory.read" },
    { to: "/inventory/count-sheet", label: "ورقة الجرد وملخص العمليات", perm: "inventory.read" },
    { to: "/lots", label: "الدفعات والصلاحية", perm: "inventory.read" },
    { to: "/reorder", label: "إعادة الطلب", perm: "inventory.read" },
    { to: "/labels", label: "ملصقات الباركود", perm: "products.read" },
  ] },
  { key: "cash", ic: "🏦", label: "النقدية والبنوك", items: [
    { to: "/treasury", label: "الخزائن والحسابات البنكية", perm: "payments.read" },
    { to: "/cheques", label: "الشيكات", perm: "payments.read", company: true },
    { to: "/bank", label: "التسوية البنكية", perm: "accounting.read", company: true },
  ] },
  { key: "gl", ic: "📒", label: "المحاسبة العامة", items: [
    { to: "/journals?new=manual", label: "قيد يومية جديد", perm: "accounting.write", action: true },
    { to: "/journals", label: "القيود اليومية", perm: "accounting.read" },
    { to: "/accounts", label: "دليل الحسابات", perm: "accounting.read", company: true },
    { to: "/assets", label: "الأصول الثابتة والإهلاك", perm: "assets.read", company: true },
    { to: "/budgets", label: "الموازنات التقديرية", perm: "reports.read", company: true },
    { to: "/periods", label: "السنوات والفترات المالية", perm: "accounting.read", company: true },
  ] },
  { key: "payroll", ic: "👔", label: "الرواتب والموظفون", items: [
    { to: "/payroll", label: "مسيرات الرواتب", perm: "accounting.read", company: true },
    { to: "/payroll/employees", label: "الموظفون", perm: "accounting.read", company: true },
    { to: "/payroll/leaves", label: "الإجازات", perm: "accounting.read", company: true },
    { to: "/payroll/loans", label: "السلف", perm: "accounting.read", company: true },
    { to: "/payroll/provisions", label: "مخصصات نهاية الخدمة والإجازات", perm: "accounting.read", company: true },
    { to: "/payroll/settlements", label: "التصفية النهائية", perm: "accounting.read", company: true },
  ] },
  { key: "tax", ic: "٪", label: "الضرائب والزكاة", items: [
    { to: "/vat", label: "ضريبة القيمة المضافة والإقرار", perm: "vat.read", company: true },
    { to: "/zatca", label: "الفوترة الإلكترونية (ZATCA)", perm: "settings.read", sa: true, company: true },
    { to: "/eta", label: "الفاتورة والإيصال الإلكتروني", perm: "settings.read", eg: true, company: true },
    { to: "/tax/wht", label: "ضريبة الاستقطاع (غير المقيمين)", perm: "vat.read", sa: true, company: true },
    { to: "/tax/form41", label: "الخصم تحت حساب الضريبة (نموذج 41)", perm: "vat.read", eg: true, company: true },
    { to: "/zakat", label: "احتساب الزكاة الشرعية", perm: "accounting.read", sa: true, company: true },
    { to: "/tax/income-tax", label: "ضريبة الدخل (22.5%)", perm: "accounting.read", eg: true, company: true },
  ] },
  { key: "final", ic: "📚", label: "الحسابات الختامية", items: [
    { to: "/final-accounts", label: "كل القوائم", perm: "reports.read", company: true },
    { to: "/final-accounts?tab=bs", label: "قائمة المركز المالي (الميزانية)", perm: "reports.read", company: true },
    { to: "/final-accounts?tab=is", label: "قائمة الدخل", perm: "reports.read", company: true },
    { to: "/final-accounts?tab=eq", label: "التغيرات في حقوق الملكية", perm: "reports.read", company: true },
    { to: "/final-accounts?tab=cf", label: "التدفقات النقدية", perm: "reports.read", company: true },
    { to: "/final-accounts?tab=chk", label: "ترابط القوائم", perm: "reports.read", company: true },
    { to: "/periods?tab=close", label: "فحص وإقفال السنة", perm: "accounting.read", company: true },
  ] },
  { key: "reports", ic: "📊", label: "التقارير", items: [
    { to: "/reports-center", label: "مركز التقارير (كل التقارير)", perm: "reports.read" },
    { to: "/reports/trial-balance", label: "ميزان المراجعة", perm: "reports.read" },
    { to: "/reports/income", label: "قائمة الدخل لفترة", perm: "reports.read" },
    { to: "/reports/income-compare", label: "قائمة دخل مقارنة", perm: "reports.read" },
    { to: "/reports/balance-sheet", label: "الميزانية العمومية بتاريخ", perm: "reports.read" },
    { to: "/reports/cash-flow", label: "التدفقات النقدية", perm: "reports.read" },
    { to: "/reports/statements", label: "كشوف الحسابات", perm: "reports.read" },
    { to: "/reports/aging", label: "أعمار الديون", perm: "reports.read" },
    { to: "/reports/sales", label: "تحليل المبيعات", perm: "reports.read" },
    { to: "/reports/salespersons", label: "المندوبون", perm: "reports.read", company: true },
    { to: "/reports/branches", label: "مقارنة الفروع", perm: "reports.read" },
    { to: "/reports/budget", label: "الموازنة مقابل الفعلي", perm: "reports.read", company: true },
    { to: "/analysis", label: "التحليل المالي والمؤشرات", perm: "reports.read", company: true },
    { to: "/reports/integrity", label: "فحص التطابق", perm: "reports.read", company: true },
  ] },
  { key: "settings", ic: "⚙", label: "الإعدادات", items: [
    { to: "/settings", label: "بيانات المنشأة", perm: "settings.read", company: true },
    { to: "/settings/invoice", label: "الفاتورة والطباعة", perm: "settings.read", company: true },
    { to: "/settings/branches", label: "الفروع والمستودعات", perm: "settings.read", company: true },
    { to: "/settings/users", label: "المستخدمون والصلاحيات", perm: "settings.read", company: true },
    { to: "/settings/currencies", label: "العملات", perm: "settings.read", company: true },
    { to: "/settings/integrations", label: "التكامل والربط (API)", perm: "settings.read", company: true },
    { to: "/settings/salla", label: "متجر سلة", perm: "settings.read", sa: true, company: true },
    { to: "/settings/zid", label: "متجر زد", perm: "settings.read", sa: true, company: true },
    { to: "/settings/license", label: "الاشتراك والترخيص", perm: "settings.read", company: true },
    { to: "/settings/backup", label: "النسخ الاحتياطي", perm: "settings.read", company: true },
    { to: "/settings/audit", label: "سجل التدقيق", perm: "settings.read", company: true },
    { to: "/settings/demo", label: "البيانات التجريبية", perm: "settings.read", company: true },
  ] },
];

const split = (to: string) => { const [path, qs = ""] = to.split("?"); return { path, params: new URLSearchParams(qs) }; };
const norm = (s: string) => s.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").toLowerCase();

/** How well a menu entry matches the open page: exact path + its ?tab wins, then the longest parent path. −1 = no match. */
function score(to: string, pathname: string, search: string) {
  const { path, params } = split(to);
  if (params.has("new")) return -1;
  const cur = new URLSearchParams(search);
  if (path === pathname) {
    for (const [k, v] of params) if (cur.get(k) !== v) return -1;
    if (!params.has("tab") && cur.get("tab")) return 500; // another entry owns this tab
    return 1000 + [...params].length;
  }
  if (path !== "/" && pathname.startsWith(path + "/") && ![...params].length) return path.length;
  return -1;
}

/** Visible tree for this user, and the entry that matches the current page. */
export function useNav(can: (p: string) => boolean, lockedBranch: boolean) {
  const loc = useLocation();
  const tree = NAV_TREE.map((g) => {
    if (g.to) return can(g.perm!) ? g : null;
    const items = g.items!.filter((i) => !(i.sa && CFG.country !== "SA") && !(i.eg && CFG.country !== "EG") && can(i.perm) && !(lockedBranch && i.company));
    return items.some((i) => !i.action) ? { ...g, items } : null;
  }).filter(Boolean) as NavGroup[];
  const active = (() => {
    let best: { g: NavGroup; i?: NavItem; s: number } | null = null;
    for (const g of tree) {
      if (g.to) { const s = score(g.to, loc.pathname, loc.search); if (s > (best?.s ?? -1)) best = { g, s }; continue; }
      for (const i of g.items!) { const s = score(i.to, loc.pathname, loc.search); if (s > (best?.s ?? -1)) best = { g, i, s }; }
    }
    return best;
  })();
  return { tree, active };
}

export function SideNav({ can, lockedBranch, extra }: { can: (p: string) => boolean; lockedBranch: boolean; extra?: React.ReactNode }) {
  const { tree, active } = useNav(can, lockedBranch);
  const [open, setOpen] = useState<string | null>(active?.g.key || null);
  const [q, setQ] = useState("");
  useEffect(() => { if (active?.g.items) setOpen(active.g.key); }, [active?.g.key]);
  const nq = norm(q.trim());
  return (
    <nav>
      <div className="nav-search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث في القائمة…" aria-label="بحث في القائمة" />{q && <button onClick={() => setQ("")} aria-label="مسح">✕</button>}</div>
      {tree.map((g) => {
        if (g.to) return nq && !norm(g.label).includes(nq) ? null : <Link key={g.key} to={g.to} className={"nav-top" + (active?.g.key === g.key ? " active" : "")}><span className="ic">{g.ic}</span>{g.label}</Link>;
        // matching screens; a hit on the module name alone lists the whole module
        const hits = nq ? g.items!.filter((i) => norm(i.label).includes(nq)) : g.items!;
        const items = nq && !hits.length && norm(g.label).includes(nq) ? g.items! : hits;
        if (nq && !items.length) return null;
        const isOpen = nq ? true : open === g.key;
        return (
          <div key={g.key} className={"nav-group" + (isOpen ? " open" : "") + (active?.g.key === g.key ? " current" : "")}>
            <button className="nav-top" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : g.key)}><span className="ic">{g.ic}</span><span className="grow">{g.label}</span><span className="chev">‹</span></button>
            <div className="nav-sub">{items.map((i) => <Link key={i.to} to={i.to} className={(i.action ? "action" : "") + (active?.i?.to === i.to ? " active" : "")}>{i.action ? "＋ " : ""}{i.label}</Link>)}</div>
          </div>);
      })}
      {extra}
    </nav>
  );
}
