/** 3.47.0 categories: a tree of main and sub categories with icon, colour and order, their items, and how each sells. */
import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, useFetch, useAction, useToast, useCompanyContext, Modal, Field, Input, Select, Money, money, Loading, Empty, confirmDlg, today, DateRange } from "../lib";

export const CAT_ICONS = ["🍔", "🌯", "🍕", "🥗", "🍰", "☕", "🥤", "🧃", "🍦", "🍞", "🍚", "🥩", "🐟", "🧀", "🥫", "🍬", "🧴", "🧹", "📎", "📚", "💻", "📱", "🎧", "🔌", "🖨", "👕", "👟", "💊", "🧸", "🛠", "🚚", "🎁", "🌿", "⭐", "📦"];
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

/** Options of a category <select>, indented by level. */
export function CategoryOptions({ cats, exclude }: { cats: any[]; exclude?: string }) {
  return <>{cats.filter((c) => c.id !== exclude).map((c) => <option key={c.id} value={c.id}>{"   ".repeat(c.depth || 0)}{c.depth ? "↳ " : ""}{c.icon ? c.icon + " " : ""}{c.name}</option>)}</>;
}

export function CategoryEditor({ c, cats, onClose }: { c: any; cats: any[]; onClose: (saved?: any) => void }) {
  const [f, setF] = useState<any>({ name: "", color: "#0f766e", icon: "", isActive: true, ...c, parentId: c.parentId || "" });
  const { run, busy } = useAction();
  const below = useMemo(() => { const out = new Set<string>(); const walk = (id: string) => cats.filter((x) => x.parentId === id).forEach((x) => { out.add(x.id); walk(x.id); }); if (c.id) walk(c.id); return out; }, [cats, c.id]);
  return (
    <Modal narrow title={c.id ? `تعديل التصنيف: ${c.name}` : "تصنيف جديد"} onClose={() => onClose()} footer={<><div className="grow" /><button className="btn" onClick={() => onClose()}>إلغاء</button>
      <button className="btn primary" disabled={busy || !String(f.name || "").trim()} data-cat-save onClick={() => run(async () => { const body = { name: f.name, color: f.color, icon: f.icon || null, parentId: f.parentId || null, isActive: f.isActive }; const r = c.id ? await api(`/categories/${c.id}`, { method: "PUT", body }) : await api("/categories", { body }); onClose(r); }, "حُفظ التصنيف")}>حفظ</button></>}>
      <div className="form-grid">
        <Field label="اسم التصنيف" span2><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-cat-name /></Field>
        <Field label="تحت التصنيف" hint="اتركه فارغاً لتصنيف رئيسي"><Select value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })} data-cat-parent><option value="">— تصنيف رئيسي —</option><CategoryOptions cats={cats.filter((x) => !below.has(x.id) && (x.depth || 0) < 2)} exclude={c.id} /></Select></Field>
        <Field label="اللون"><div className="row" style={{ gap: 8 }}><input type="color" value={f.color || "#0f766e"} onChange={(e) => setF({ ...f, color: e.target.value })} aria-label="لون التصنيف" /><span className="badge" style={{ background: (f.color || "#0f766e") + "22", boxShadow: `inset 3px 0 0 ${f.color}`, color: "var(--text)" }}>{f.icon} {f.name || "معاينة"}</span></div></Field>
        <Field label="الأيقونة" span2 hint="تظهر على زر التصنيف في نقطة البيع"><div className="icon-pick" data-cat-icons>{CAT_ICONS.map((x) => <button key={x} type="button" className={f.icon === x ? "on" : ""} onClick={() => setF({ ...f, icon: f.icon === x ? "" : x })} aria-label={x}>{x}</button>)}</div></Field>
        <Field label="الحالة"><label className="check"><input type="checkbox" checked={f.isActive !== false} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> يظهر في نقطة البيع</label></Field>
      </div>
    </Modal>
  );
}

export function CategoriesPage() {
  const { can } = useCompanyContext();
  const W = can("products.write");
  const nav = useNavigate();
  const toast = useToast();
  const { run, busy } = useAction();
  const cats = useFetch<any[]>("/categories");
  const [range, setRange] = useState({ from: addDays(today(), -29), to: today() });
  const stats = useFetch<any>(can("reports.read") ? `/categories/stats?from=${range.from}&to=${range.to}` : null, [range.from, range.to]);
  const [edit, setEdit] = useState<any>(null);
  const [merge, setMerge] = useState<any>(null);
  const [move, setMove] = useState<any>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const reload = () => { cats.reload(); stats.reload(); };
  const list = cats.data || [];
  const S = new Map((stats.data?.rows || []).map((r: any) => [r.id, r]));
  const maxRev = Math.max(1, ...(stats.data?.rows || []).filter((r: any) => !r.parentId).map((r: any) => r.revenue));
  const shown = (c: any) => { let pid = c.parentId, n = 0; while (pid && n++ < 6) { if (!open[pid]) return false; pid = list.find((x) => x.id === pid)?.parentId; } return true; };
  const visible = list.filter(shown);
  const siblings = (c: any) => list.filter((x) => (x.parentId || null) === (c.parentId || null));
  const moveBy = (c: any, d: number) => run(async () => { const sib = siblings(c); const i = sib.findIndex((x) => x.id === c.id); const j = i + d; if (j < 0 || j >= sib.length) return; const ids = sib.map((x) => x.id); [ids[i], ids[j]] = [ids[j], ids[i]]; await api("/categories/reorder", { method: "PUT", body: { ids } }); reload(); });
  const top = (stats.data?.rows || []).filter((r: any) => !r.parentId).sort((a: any, b: any) => b.revenue - a.revenue);
  return (
    <div className="grid" data-categories>
      <div className="card"><div className="row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        {W && <button className="btn primary" data-cat-new onClick={() => setEdit({})}>＋ تصنيف جديد</button>}
        <button className="btn ghost" onClick={() => setOpen(Object.fromEntries(list.map((c) => [c.id, !Object.values(open).some(Boolean)])))}>{Object.values(open).some(Boolean) ? "طيّ الكل" : "فتح الكل"}</button>
        <div className="grow" />
        {can("reports.read") && <><span className="small muted">أداء الفترة:</span><DateRange from={range.from} to={range.to} onChange={(f, t) => setRange({ from: f, to: t })} /></>}
      </div></div>
      {top.length > 1 && <div className="card" data-cat-share><div className="card-h"><h3>حصة التصنيفات الرئيسية من المبيعات</h3><span className="small muted">{money(stats.data.totalRevenue)} في الفترة</span></div>
        <div className="card-b"><div className="share-bar">{top.filter((r: any) => r.revenue > 0).map((r: any) => <span key={r.id} title={`${r.name}: ${r.sharePct}%`} style={{ flex: r.revenue, background: r.color || "var(--primary)" }}>{r.sharePct >= 7 ? `${r.icon || ""} ${r.name} ${Math.round(r.sharePct)}%` : ""}</span>)}</div></div></div>}
      <div className="card">{cats.loading && !cats.data ? <Loading /> : !list.length ? <Empty text="لا توجد تصنيفات بعد — أضف تصنيفاً رئيسياً ثم تصنيفات فرعية تحته" /> :
        <div className="table-wrap"><table className="tbl" data-cat-tree>
          <thead><tr><th>التصنيف</th><th className="n">الأصناف</th>{stats.data && <><th style={{ width: "22%" }}>المبيعات</th><th className="n">الربح</th><th className="n">الهامش</th><th className="n">قيمة المخزون</th></>}<th className="no-print" /></tr></thead>
          <tbody>{visible.map((c) => { const r: any = S.get(c.id); return <tr key={c.id} data-cat-row={c.name} className={c.isActive === false ? "muted" : ""}>
            <td><div className="row" style={{ gap: 6, paddingInlineStart: (c.depth || 0) * 22 }}>
              {c.children ? <button className="btn sm ghost tree-tg" aria-label={open[c.id] ? "طيّ" : "فتح"} aria-expanded={!!open[c.id]} data-cat-toggle onClick={() => setOpen({ ...open, [c.id]: !open[c.id] })}>{open[c.id] ? "▾" : "◂"}</button> : <span style={{ width: 28 }} />}
              <span className="cat-chip" style={{ background: (c.color || "#64748b") + "22", boxShadow: `inset 3px 0 0 ${c.color || "#64748b"}` }}>{c.icon && <span aria-hidden="true">{c.icon}</span>} <b>{c.name}</b></span>
              {c.children > 0 && <span className="small muted">{c.children} فرعي</span>}{c.isActive === false && <span className="badge">مخفي في نقطة البيع</span>}</div></td>
            <td className="n"><Link to={`/inventory?cat=${c.id}`}>{c.total}</Link>{c.total !== c.count && <span className="small muted"> ({c.count} مباشرة)</span>}</td>
            {stats.data && <><td>{r && r.revenue ? <div className="row" style={{ gap: 8 }}><div className="mini-bar"><i style={{ width: `${Math.min(100, (Math.abs(r.revenue) / maxRev) * 100)}%`, background: c.color || "var(--primary)" }} /></div><span className="num small"><Money v={r.revenue} /></span></div> : <span className="muted">—</span>}</td>
              <td className="n">{r?.revenue ? <Money v={r.profit} /> : "—"}</td><td className="n">{r?.marginPct === null || r?.marginPct === undefined ? "—" : <span className={r.marginPct < 15 ? "neg-val" : ""}>{r.marginPct}%</span>}</td><td className="n">{r?.stockValue ? <Money v={r.stockValue} /> : "—"}</td></>}
            <td className="no-print"><div className="row" style={{ gap: 4, justifyContent: "flex-end", flexWrap: "nowrap" }}>
              {can("reports.read") && <button className="btn sm ghost" title="اسأل المساعد" onClick={() => nav(`/ai?q=${encodeURIComponent(`مبيعات هذا الشهر حسب الصنف`)}`)}>✨</button>}
              {W && <><button className="btn sm ghost" title="أعلى" disabled={busy} onClick={() => moveBy(c, -1)} data-cat-up>↑</button><button className="btn sm ghost" title="أسفل" disabled={busy} onClick={() => moveBy(c, 1)} data-cat-down>↓</button>
                <button className="btn sm ghost" onClick={() => setEdit(c)} data-cat-edit>تعديل</button><button className="btn sm ghost" onClick={() => setEdit({ parentId: c.id, color: c.color })} title="تصنيف فرعي تحته" data-cat-sub>＋ فرعي</button>
                <button className="btn sm ghost" onClick={() => setMove(c)} data-cat-move>نقل أصناف</button><button className="btn sm ghost" onClick={() => setMerge(c)} data-cat-merge>دمج</button>
                <button className="btn sm ghost danger" onClick={() => { if (confirmDlg(`حذف «${c.name}»؟ أصنافه وتصنيفاته الفرعية تنتقل إلى ${c.parentId ? "التصنيف الأعلى" : "بلا تصنيف"}.`)) run(async () => { await api(`/categories/${c.id}`, { method: "DELETE" }); reload(); }, "حُذف التصنيف"); }}>حذف</button></>}
            </div></td></tr>; })}
            {stats.data && (stats.data.uncategorised.revenue !== 0 || stats.data.uncategorised.stockValue !== 0) && <tr className="muted"><td><span style={{ paddingInlineStart: 34 }}>بلا تصنيف</span></td><td className="n">—</td><td><span className="num small"><Money v={stats.data.uncategorised.revenue} /></span></td><td className="n"><Money v={stats.data.uncategorised.profit} /></td><td className="n">—</td><td className="n"><Money v={stats.data.uncategorised.stockValue} /></td><td /></tr>}
          </tbody></table></div>}</div>
      <div className="small muted">الأرقام في التصنيف الرئيسي تشمل كل ما تحته. حذف تصنيف لا يحذف أصنافه؛ تنتقل للتصنيف الأعلى. وفي نقطة البيع يظهر الرئيسي، وعند اختياره تظهر فروعه.</div>
      {edit && <CategoryEditor c={edit} cats={list} onClose={(r) => { setEdit(null); if (r) { reload(); if (r.parentId) setOpen((o) => ({ ...o, [r.parentId]: true })); } }} />}
      {merge && <Modal narrow title={`دمج «${merge.name}» في تصنيف آخر`} onClose={() => setMerge(null)} footer={<><div className="grow" /><button className="btn" onClick={() => setMerge(null)}>إلغاء</button><button className="btn primary" disabled={busy || !merge.into} data-cat-merge-go onClick={() => run(async () => { const r = await api(`/categories/${merge.id}/merge`, { body: { into: merge.into } }); toast(`نُقل ${r.items} صنف إلى «${r.into}»`); setMerge(null); reload(); })}>دمج</button></>}>
        <p className="small">تنتقل أصناف «{merge.name}» وتصنيفاته الفرعية إلى التصنيف المختار، ثم يُحذف.</p>
        <Field label="ادمجه في"><Select value={merge.into || ""} onChange={(e) => setMerge({ ...merge, into: e.target.value })} data-cat-into><option value="">— اختر —</option><CategoryOptions cats={list} exclude={merge.id} /></Select></Field>
      </Modal>}
      {move && <MoveProducts from={move} cats={list} onClose={(d) => { setMove(null); if (d) reload(); }} />}
    </div>
  );
}

function MoveProducts({ from, cats, onClose }: { from: any; cats: any[]; onClose: (done?: boolean) => void }) {
  const { data } = useFetch<any[]>(`/products?categoryId=${from.id}&limit=2000&active=all`);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [to, setTo] = useState("");
  const [find, setFind] = useState("");
  const { run, busy } = useAction();
  const rows = (data || []).filter((p) => !find || `${p.name} ${p.sku}`.includes(find));
  const n = Object.values(sel).filter(Boolean).length;
  return (
    <Modal title={`نقل أصناف من «${from.name}»`} onClose={() => onClose()} footer={<><span className="small muted">{n} محدد</span><div className="grow" /><Select value={to} onChange={(e) => setTo(e.target.value)} data-move-to><option value="">— إلى التصنيف —</option><option value="none">بلا تصنيف</option><CategoryOptions cats={cats} /></Select>
      <button className="btn primary" disabled={busy || !n || !to} data-move-go onClick={() => run(async () => { await api("/categories/move-products", { body: { productIds: Object.keys(sel).filter((k) => sel[k]), categoryId: to === "none" ? null : to } }); onClose(true); }, `نُقل ${n} صنف`)}>نقل</button></>}>
      <div className="row mb" style={{ gap: 8 }}><Input placeholder="بحث" value={find} onChange={(e) => setFind(e.target.value)} /><button className="btn sm ghost" onClick={() => setSel(Object.fromEntries(rows.map((p) => [p.id, true])))}>تحديد الكل</button><button className="btn sm ghost" onClick={() => setSel({})}>إلغاء التحديد</button></div>
      {!data ? <Loading /> : !rows.length ? <Empty text="لا أصناف في هذا التصنيف" /> : <div className="table-wrap"><table className="tbl compact" data-move-list><tbody>{rows.map((p) => <tr key={p.id} className="clickable" onClick={() => setSel({ ...sel, [p.id]: !sel[p.id] })}><td style={{ width: 30 }}><input type="checkbox" checked={!!sel[p.id]} readOnly aria-label={p.name} /></td><td>{p.name}</td><td className="muted small">{p.sku}</td><td className="small">{p.category}</td></tr>)}</tbody></table></div>}
    </Modal>
  );
}
