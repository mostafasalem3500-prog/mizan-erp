import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, money, KIND_AR, useCompanyContext } from "../lib";

const ICON: Record<string, string> = { doc: "🧾", partner: "👤", product: "🏷", payment: "💵", page: "↗" };
const GROUP: Record<string, string> = { doc: "المستندات", partner: "العملاء والموردون", product: "الأصناف", payment: "السندات", page: "انتقال سريع" };

const PAGES: { title: string; to: string; perm: string; keys: string }[] = [
  { title: "فاتورة مبيعات جديدة", to: "/sales/invoices", perm: "sales.write", keys: "بيع فاتورة جديد" },
  { title: "نقطة البيع", to: "/pos", perm: "pos.use", keys: "كاشير pos" },
  { title: "فاتورة مشتريات", to: "/purchases/invoices", perm: "purchases.read", keys: "شراء مورد" },
  { title: "سندات القبض", to: "/receipts", perm: "payments.read", keys: "قبض تحصيل" },
  { title: "سندات الصرف", to: "/vouchers", perm: "payments.read", keys: "صرف دفع" },
  { title: "المصروفات", to: "/expenses", perm: "expenses.read", keys: "مصروف" },
  { title: "الأصناف", to: "/products", perm: "products.read", keys: "صنف منتج مخزون" },
  { title: "ميزان المراجعة", to: "/reports/trial-balance", perm: "reports.read", keys: "تقرير ميزان" },
  { title: "قائمة الدخل", to: "/reports/income", perm: "reports.read", keys: "أرباح تقرير" },
  { title: "مقارنة الفروع", to: "/reports/branches", perm: "reports.read", keys: "فروع فرع" },
  { title: "أعمار الديون", to: "/reports/aging", perm: "reports.read", keys: "ذمم متأخرة" },
  { title: "ضريبة القيمة المضافة", to: "/vat", perm: "vat.read", keys: "اقرار ضريبة" },
  { title: "متجر سلة", to: "/settings/salla", perm: "settings.read", keys: "سلة salla متجر" },
  { title: "متجر زد", to: "/settings/zid", perm: "settings.read", keys: "زد zid متجر" },
  { title: "الفوترة الإلكترونية", to: "/zatca", perm: "settings.read", keys: "هيئة زاتكا zatca فاتورة" },
];

/** Ctrl+K / "/" command palette: search documents, partners, products, vouchers and jump to screens. */
export function GlobalSearch() {
  const { can, me } = useCompanyContext();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<any[]>([]);
  const [hl, setHl] = useState(0);
  const [loading, setLoading] = useState(false);
  const inp = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); }
      else if (e.key === "/" && !typing) { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (open) { setQ(""); setRes([]); setHl(0); setTimeout(() => inp.current?.focus(), 30); } }, [open]);

  const pages = PAGES.filter((p) => can(p.perm) && !(me.lockedBranch && ["/vat", "/zatca", "/settings/salla", "/settings/zid"].includes(p.to)) && (!q || p.title.includes(q) || p.keys.toLowerCase().includes(q.toLowerCase()))).slice(0, q ? 4 : 8).map((p) => ({ type: "page", id: p.to, title: p.title, to: p.to }));
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => api(`/search?q=${encodeURIComponent(q.trim())}`).then((r) => alive && (setRes(r.results), setHl(0))).catch(() => undefined).finally(() => alive && setLoading(false)), 220);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  const items = [...res, ...pages];
  const go = (it: any) => { setOpen(false); nav(it.to); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHl((h) => Math.min(items.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHl((h) => Math.max(0, h - 1)); }
    else if (e.key === "Enter" && items[hl]) { e.preventDefault(); go(items[hl]); }
    else if (e.key === "Escape") setOpen(false);
  };

  let lastGroup = "";
  return (
    <>
      <button className="btn sm ghost search-trigger" onClick={() => setOpen(true)} title="بحث شامل (Ctrl+K)"><span>🔍</span><span className="hide-sm">بحث…</span><kbd className="hide-sm">Ctrl K</kbd></button>
      {open && (
        <div className="cmdk-backdrop" onMouseDown={() => setOpen(false)}>
          <div className="cmdk" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="بحث شامل">
            <div className="cmdk-input"><span>🔍</span><input ref={inp} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} placeholder="ابحث برقم فاتورة، عميل، جوال، رقم ضريبي، صنف، باركود، سند…" />{loading && <span className="spinner" style={{ width: 16, height: 16 }} />}</div>
            <div className="cmdk-list">
              {!items.length && <div className="empty small">{q.trim().length < 2 ? "اكتب حرفين على الأقل" : "لا نتائج"}</div>}
              {items.map((it, i) => {
                const g = GROUP[it.type];
                const head = g !== lastGroup ? (lastGroup = g, <div key={"g" + i} className="cmdk-group">{g}</div>) : null;
                return (
                  <React.Fragment key={it.type + it.id}>
                    {head}
                    <div className={"cmdk-item" + (i === hl ? " active" : "")} onMouseEnter={() => setHl(i)} onClick={() => go(it)}>
                      <span className="ic">{ICON[it.type]}</span>
                      <div className="grow"><b>{it.title}</b>{it.type === "doc" && <span className="badge gray" style={{ marginInlineStart: 6 }}>{(it.direction === "PURCHASE" ? "شراء · " : "") + (KIND_AR[it.kind] || it.kind)}</span>}{it.sub && <div className="small muted">{it.sub}</div>}</div>
                      {it.amount !== undefined && <span className="num small">{money(it.amount)}</span>}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
            <div className="cmdk-foot small muted">↑↓ للتنقل · Enter للفتح · Esc للإغلاق</div>
          </div>
        </div>
      )}
    </>
  );
}
