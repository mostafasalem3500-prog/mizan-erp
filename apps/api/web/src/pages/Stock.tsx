import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, q, useFetch, Money, money, Loading, Empty, Field, Input, Select, NumInput, useAction, useToast, useCompanyContext, ExportBtn, useLocalState, fmtDate } from "../lib";
import { barcodeSvg } from "../shared/barcode";

// ─── Barcode labels ────────────────────────────────────────────────────────
const SIZES: Record<string, { w: number; h: number; name: string; cols?: number }> = {
  "38x25": { w: 38, h: 25, name: "38×25 مم (رول)" }, "50x30": { w: 50, h: 30, name: "50×30 مم (رول)" }, "58x40": { w: 58, h: 40, name: "58×40 مم (رول)" }, "100x50": { w: 100, h: 50, name: "100×50 مم (كرتون)" },
  a4: { w: 63.5, h: 38.1, name: "ورقة A4 — 21 ملصق (3×7)", cols: 3 },
};
export function LabelsPage() {
  const { me } = useCompanyContext();
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("");
  const cats = useFetch("/categories");
  const { data: products } = useFetch(`/products${q({ q: search, categoryId: cat, limit: 500 })}`, [search, cat]);
  const [sel, setSel] = useState<Record<string, number>>({}); // key = productId|uomId → copies
  const [opt, setOpt] = useLocalState("mz_label_opts", { size: "50x30", showPrice: true, showName: true, showCompany: false, showSku: false });
  const size = SIZES[opt.size] || SIZES["50x30"];
  const items = useMemo(() => {
    const out: { key: string; name: string; sku: string; barcode: string; price: number; copies: number; uom?: string }[] = [];
    for (const p of products || []) {
      const base = sel[p.id + "|"]; if (base) out.push({ key: p.id + "|", name: p.name, sku: p.sku, barcode: p.barcode || p.sku, price: Number(p.salePrice), copies: base });
      for (const u of p.uoms || []) { const c = sel[p.id + "|" + u.id]; if (c) out.push({ key: p.id + "|" + u.id, name: p.name, sku: p.sku, barcode: u.barcode || `${p.sku}-${u.name}`, price: u.salePrice !== null && u.salePrice !== undefined ? Number(u.salePrice) : Number(p.salePrice) * Number(u.factor), copies: c, uom: `${u.name} (${Number(u.factor)})` }); }
    }
    return out;
  }, [sel, products]);
  const total = items.reduce((a, i) => a + i.copies, 0);
  const setCopies = (key: string, n: number) => setSel((s) => { const x = { ...s }; if (n > 0) x[key] = n; else delete x[key]; return x; });
  const print = () => {
    const labels = items.flatMap((i) => Array.from({ length: i.copies }, () => i));
    const css = size.cols
      ? `@page{size:A4;margin:10mm 7mm} body{margin:0} .sheet{display:grid;grid-template-columns:repeat(${size.cols},${size.w}mm);grid-auto-rows:${size.h}mm;gap:0 2mm}`
      : `@page{size:${size.w}mm ${size.h}mm;margin:0} body{margin:0} .sheet .lbl{page-break-after:always}`;
    const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>ملصقات</title><style>${css} .lbl{width:${size.w}mm;height:${size.h}mm;box-sizing:border-box;padding:1.5mm;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Arial,sans-serif;overflow:hidden;text-align:center} .nm{font-size:${size.h < 30 ? 7 : 9}pt;font-weight:700;line-height:1.1;max-height:2.3em;overflow:hidden} .pr{font-size:${size.h < 30 ? 8 : 11}pt;font-weight:700} .co{font-size:6pt;color:#333} svg{width:${Math.min(size.w - 4, 60)}mm;height:auto}</style></head><body><div class="sheet">${labels.map((l) => `<div class="lbl">${opt.showCompany ? `<div class="co">${me.company.nameAr}</div>` : ""}${opt.showName ? `<div class="nm">${l.name}${l.uom ? ` — ${l.uom}` : ""}</div>` : ""}${barcodeSvg(l.barcode, { height: 30, module: 1 })}${opt.showSku && l.barcode !== l.sku ? `<div class="co">${l.sku}</div>` : ""}${opt.showPrice ? `<div class="pr">${money(l.price)} ر.س</div>` : ""}</div>`).join("")}</div><script>window.onload=()=>{window.print()}</script></body></html>`;
    const w = window.open("", "_blank"); if (!w) return; w.document.write(html); w.document.close();
  };
  return (
    <div className="grid c2">
      <div className="card">
        <div className="card-h"><h3>الأصناف</h3><div className="row"><Select value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 160 }}><option value="">كل التصنيفات</option>{(cats.data || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select><Input placeholder="بحث" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 180 }} /><button className="btn sm" onClick={() => { const all: Record<string, number> = { ...sel }; (products || []).forEach((p: any) => { all[p.id + "|"] = all[p.id + "|"] || 1; }); setSel(all); }}>تحديد الكل</button><button className="btn sm ghost" onClick={() => setSel({})}>مسح</button></div></div>
        {!products ? <Loading /> : <div className="table-wrap" style={{ maxHeight: "65vh" }}><table className="tbl compact"><thead><tr><th>الصنف</th><th>الباركود</th><th className="n">السعر</th><th style={{ width: 90 }}>نسخ</th></tr></thead>
          <tbody>{products.map((p: any) => <React.Fragment key={p.id}><tr><td><b>{p.name}</b><span className="small muted"> {p.sku}</span></td><td className="num small">{p.barcode || p.sku}</td><td className="n"><Money v={p.salePrice} /></td><td><NumInput value={sel[p.id + "|"] || ""} placeholder="0" onChange={(e) => setCopies(p.id + "|", Number(e.target.value) || 0)} /></td></tr>
            {(p.uoms || []).map((u: any) => <tr key={u.id} className="sub"><td style={{ paddingInlineStart: 24 }}>↳ {u.name} × {Number(u.factor)}</td><td className="num small">{u.barcode || <span className="muted">بدون باركود — يُولَّد من الرمز</span>}</td><td className="n"><Money v={u.salePrice !== null && u.salePrice !== undefined ? u.salePrice : Number(p.salePrice) * Number(u.factor)} /></td><td><NumInput value={sel[p.id + "|" + u.id] || ""} placeholder="0" onChange={(e) => setCopies(p.id + "|" + u.id, Number(e.target.value) || 0)} /></td></tr>)}</React.Fragment>)}</tbody></table></div>}
      </div>
      <div className="grid">
        <div className="card"><div className="card-h"><h3>إعداد الملصق</h3></div><div className="card-b">
          <div className="form-grid">
            <Field label="مقاس الملصق" span2><Select value={opt.size} onChange={(e) => setOpt({ ...opt, size: e.target.value })}>{Object.entries(SIZES).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}</Select></Field>
            <Field label="المحتوى" span2><div className="row" style={{ flexWrap: "wrap" }}><label className="check"><input type="checkbox" checked={opt.showName} onChange={(e) => setOpt({ ...opt, showName: e.target.checked })} /> الاسم</label><label className="check"><input type="checkbox" checked={opt.showPrice} onChange={(e) => setOpt({ ...opt, showPrice: e.target.checked })} /> السعر</label><label className="check"><input type="checkbox" checked={opt.showSku} onChange={(e) => setOpt({ ...opt, showSku: e.target.checked })} /> الرمز</label><label className="check"><input type="checkbox" checked={opt.showCompany} onChange={(e) => setOpt({ ...opt, showCompany: e.target.checked })} /> اسم المنشأة</label></div></Field>
          </div>
          <div className="row mt"><button className="btn primary" disabled={!total} onClick={print}>🖨 طباعة {total} ملصق</button><span className="muted small">باركود EAN-13 للأكواد الصحيحة من 13 رقماً، وإلا Code128 — يقرؤه أي ماسح ويعيد القيمة المخزنة نفسها.</span></div>
        </div></div>
        <div className="card"><div className="card-h"><h3>معاينة</h3></div><div className="card-b" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {!items.length ? <Empty text="حدد عدد النسخ بجانب الصنف" /> : items.slice(0, 6).map((l) => <div key={l.key} style={{ width: size.w * 3.4, minHeight: size.h * 3.4, border: "1px dashed #bbb", padding: 6, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", fontSize: 11 }}>{opt.showCompany && <div className="small muted">{me.company.nameAr}</div>}{opt.showName && <b style={{ fontSize: 11 }}>{l.name}{l.uom ? ` — ${l.uom}` : ""}</b>}<div style={{ width: "85%" }} dangerouslySetInnerHTML={{ __html: barcodeSvg(l.barcode, { height: 30 }) }} />{opt.showSku && l.barcode !== l.sku && <div className="small muted">{l.sku}</div>}{opt.showPrice && <b>{money(l.price)} ر.س</b>}</div>)}
        </div></div>
      </div>
    </div>
  );
}

// ─── Reorder suggestions ───────────────────────────────────────────────────
export function ReorderPage() {
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const toast = useToast();
  const [all, setAll] = useState(false);
  const { data, reload } = useFetch(`/inventory/reorder${q({ all: all ? 1 : 0 })}`, [all]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [sup, setSup] = useState<Record<string, string>>({});
  const suppliers = useFetch("/partners?role=SUPPLIER&limit=500");
  useEffect(() => { if (data) { setQty(Object.fromEntries(data.map((r: any) => [r.id, r.suggested]))); setSup(Object.fromEntries(data.map((r: any) => [r.id, r.supplierId || ""]))); } }, [data]);
  const [created, setCreated] = useState<any[] | null>(null);
  if (!data) return <Loading />;
  const chosen = data.filter((r: any) => (qty[r.id] || 0) > 0);
  const value = chosen.reduce((a: number, r: any) => a + (qty[r.id] || 0) * Number(r.price || 0), 0);
  return (
    <div className="grid">
      {created && <div className="alert ok">تم إنشاء {created.length} أمر شراء (مسودة): {created.map((c) => <Link key={c.id} to={`/doc/${c.id}`} style={{ marginInlineStart: 8 }}>{c.number} — {c.partnerName}</Link>)}</div>}
      <div className="card">
        <div className="card-h"><div><h3>اقتراحات إعادة الطلب</h3><div className="small muted">الأصناف التي وصلت حد إعادة الطلب، مع الكمية المقترحة لتغطية ~6 أسابيع من المبيعات (آخر 90 يوماً) أو ضعف الحد، وآخر مورد وسعر شراء</div></div>
          <div className="row"><label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> عرض كل الأصناف المباعة</label><ExportBtn name="اقتراحات إعادة الطلب" rows={() => data.map((r: any) => ({ الرمز: r.sku, الصنف: r.name, الرصيد: r.qty, "حد الطلب": r.reorderLevel, "مبيعات شهرية": r.monthlySales, "قيد الطلب": r.onOrder, المقترح: qty[r.id] || 0, المورد: r.supplierName, السعر: r.price }))} />
            {can("purchases.write") && <button className="btn primary sm" disabled={busy || !chosen.length} onClick={() => run(async () => { const r = await api("/inventory/reorder/orders", { body: { items: chosen.map((x: any) => ({ productId: x.id, qty: qty[x.id], supplierId: sup[x.id] || null, price: x.price })) } }); setCreated(r); reload(); }, "تم إنشاء أوامر الشراء")}>إنشاء أوامر شراء ({chosen.length} صنف — {money(value)} ر.س)</button>}</div></div>
        {!data.length ? <Empty text="لا توجد أصناف تحتاج إعادة طلب 🎉" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الصنف</th><th className="n">الرصيد</th><th className="n">حد الطلب</th><th className="n">مبيعات شهرية</th><th className="n">قيد الطلب</th><th style={{ width: 110 }}>الكمية المقترحة</th><th>المورد</th><th className="n">آخر سعر</th><th className="n">القيمة</th></tr></thead>
          <tbody>{data.map((r: any) => <tr key={r.id} className={Number(r.qty) <= 0 ? "bold" : ""}><td><b>{r.name}</b><span className="small muted"> {r.sku} · {r.unit}</span></td><td className={"n " + (Number(r.qty) <= Number(r.reorderLevel) ? "neg-val" : "")}>{Number(r.qty)}</td><td className="n">{Number(r.reorderLevel)}</td><td className="n">{r.monthlySales}</td><td className="n">{Number(r.onOrder) || ""}</td><td><NumInput value={qty[r.id] ?? ""} onChange={(e) => setQty({ ...qty, [r.id]: Number(e.target.value) || 0 })} /></td>
            <td><Select value={sup[r.id] || ""} onChange={(e) => setSup({ ...sup, [r.id]: e.target.value })} style={{ minWidth: 160 }}><option value="">— اختر —</option>{(suppliers.data || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>{r.lastDate && <div className="small muted">آخر شراء {fmtDate(r.lastDate)}</div>}</td><td className="n"><Money v={r.price} /></td><td className="n"><Money v={(qty[r.id] || 0) * Number(r.price || 0)} /></td></tr>)}</tbody></table></div>}
      </div>
    </div>
  );
}
