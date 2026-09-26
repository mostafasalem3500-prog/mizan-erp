import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ImportModal } from "./Import";
import { api, q, useFetch, Money, money, Loading, Empty, Badge, Modal, Field, Input, Select, NumInput, useAction, useToast, useCompanyContext, ExportBtn, PrintBtn, useDebounce, DateRange, monthStart, today, TAX_AR, fmtDate, fileToDataUrl, Picker, productFetcher, confirmDlg, JTYPE_AR } from "../lib";

// ─── partners ──────────────────────────────────────────────────────────────
export function PartnersPage({ role }: { role: "CUSTOMER" | "SUPPLIER" }) {
  const { can } = useCompanyContext();
  const [search, setSearch] = useState("");
  const dq = useDebounce(search);
  const [edit, setEdit] = useState<any>(null);
  const [stmt, setStmt] = useState<any>(null);
  const [imp, setImp] = useState(false);
  const { data, loading, reload } = useFetch(`/partners${q({ role, q: dq, limit: 500, active: "all" })}`);
  const label = role === "CUSTOMER" ? "العملاء" : "الموردون";
  return (
    <div className="card">
      <div className="card-h"><h3>{label} <span className="muted small">({data?.length || 0})</span></h3><div className="row">{can("partners.write") && <button className="btn sm" onClick={() => setImp(true)}>⬆ استيراد Excel</button>}{can("partners.write") && <button className="btn primary sm" onClick={() => setEdit({})}>＋ {role === "CUSTOMER" ? "عميل جديد" : "مورد جديد"}</button>}</div></div>
      <div className="card-b">
        <div className="toolbar"><div className="search"><span className="ic">🔍</span><Input placeholder="بحث" value={search} onChange={(e) => setSearch(e.target.value)} /></div><div className="grow" />{data && <ExportBtn name={label} rows={() => data.map((p: any) => ({ الكود: p.code, الاسم: p.name, النوع: p.kind === "COMPANY" ? "منشأة" : "فرد", "الرقم الضريبي": p.vatNumber, الجوال: p.phone, المدينة: p.city, "حد الائتمان": p.creditLimit, "أيام السداد": p.paymentTerms, الرصيد: p.balance }))} />}</div>
        {loading && !data ? <Loading /> : !data?.length ? <Empty /> : (
          <div className="table-wrap"><table className="tbl"><thead><tr><th>الكود</th><th>الاسم</th><th>النوع</th><th>الرقم الضريبي</th><th>الجوال</th><th>المدينة</th><th>شروط السداد</th><th className="n">الرصيد</th><th /></tr></thead>
            <tbody>{data.map((p: any) => <tr key={p.id} className={p.isActive ? "" : "muted"}>
              <td>{p.code}</td><td><b>{p.name}</b>{!p.isActive && <span className="badge gray" style={{ marginInlineStart: 6 }}>موقوف</span>}{p.isDemo && <span className="badge amber" style={{ marginInlineStart: 4 }}>تجريبي</span>}</td><td>{p.kind === "COMPANY" ? "منشأة" : "فرد"}</td><td className="num">{p.vatNumber}</td><td className="num">{p.phone}</td><td>{p.city}</td><td>{p.paymentTerms ? `${p.paymentTerms} يوم` : "نقدي"}</td>
              <td className="n"><Money v={p.balance} sign /></td>
              <td className="row" style={{ gap: 4 }}><button className="btn sm" onClick={() => setStmt(p)}>كشف حساب</button>{can("partners.write") && <button className="btn sm ghost" onClick={() => setEdit(p)}>تعديل</button>}</td>
            </tr>)}</tbody></table></div>
        )}
      </div>
      {edit && <PartnerEditor role={role} p={edit} onClose={(s) => { setEdit(null); if (s) reload(); }} />}
      {stmt && <StatementModal partner={stmt} role={role} onClose={() => setStmt(null)} />}
      {imp && <ImportModal kind="partners" role={role} onClose={(d) => { setImp(false); if (d) reload(); }} />}
    </div>
  );
}

function PartnerEditor({ role, p, onClose }: { role: string; p: any; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const toast = useToast();
  const [f, setF] = useState<any>({ kind: "COMPANY", country: "SA", paymentTerms: 0, creditLimit: 0, isCustomer: role === "CUSTOMER", isSupplier: role === "SUPPLIER", isActive: true, ...p });
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <Modal title={p.id ? `تعديل: ${p.name}` : role === "CUSTOMER" ? "عميل جديد" : "مورد جديد"} onClose={() => onClose()} footer={<>
      {p.id && <button className="btn danger sm" onClick={() => run(async () => { if (!confirmDlg("حذف / إيقاف؟")) return; const r = await api(`/partners/${p.id}`, { method: "DELETE" }); if (r.message) toast(r.message); onClose(true); })}>حذف</button>}
      <div className="grow" /><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy} onClick={() => run(async () => { p.id ? await api(`/partners/${p.id}`, { method: "PUT", body: f }) : await api("/partners", { body: f }); onClose(true); }, "تم الحفظ")}>حفظ</button></>}>
      <div className="form-grid">
        <Field label="الاسم" span2><Input autoFocus value={f.name || ""} onChange={s("name")} /></Field>
        <Field label="النوع"><Select value={f.kind} onChange={s("kind")}><option value="COMPANY">منشأة</option><option value="INDIVIDUAL">فرد</option></Select></Field>
        <Field label="الكود (تلقائي)"><Input value={f.code || ""} onChange={s("code")} dir="ltr" /></Field>
        <Field label="الرقم الضريبي" hint="15 رقماً يبدأ وينتهي بـ 3"><Input value={f.vatNumber || ""} onChange={s("vatNumber")} dir="ltr" /></Field>
        <Field label="السجل التجاري"><Input value={f.crNumber || ""} onChange={s("crNumber")} dir="ltr" /></Field>
        <Field label="الجوال"><Input value={f.phone || ""} onChange={s("phone")} dir="ltr" /></Field>
        <Field label="البريد"><Input value={f.email || ""} onChange={s("email")} dir="ltr" /></Field>
        <Field label="الشارع"><Input value={f.street || ""} onChange={s("street")} /></Field>
        <Field label="رقم المبنى"><Input value={f.buildingNo || ""} onChange={s("buildingNo")} dir="ltr" /></Field>
        <Field label="الحي"><Input value={f.district || ""} onChange={s("district")} /></Field>
        <Field label="المدينة"><Input value={f.city || ""} onChange={s("city")} /></Field>
        <Field label="الرمز البريدي"><Input value={f.postalCode || ""} onChange={s("postalCode")} dir="ltr" /></Field>
        <Field label="الدولة"><Input value={f.country || "SA"} onChange={s("country")} dir="ltr" /></Field>
        <Field label="أيام السداد (0 = نقدي)"><NumInput value={f.paymentTerms} onChange={s("paymentTerms")} /></Field>
        <Field label="حد الائتمان"><NumInput value={f.creditLimit} onChange={s("creditLimit")} /></Field>
        <Field label="التصنيف"><div className="row"><label className="check"><input type="checkbox" checked={!!f.isCustomer} onChange={s("isCustomer")} /> عميل</label><label className="check"><input type="checkbox" checked={!!f.isSupplier} onChange={s("isSupplier")} /> مورد</label>{p.id && <label className="check"><input type="checkbox" checked={!!f.isActive} onChange={s("isActive")} /> نشط</label>}</div></Field>
        <Field label="ملاحظات" span3><textarea className="input" value={f.notes || ""} onChange={s("notes")} /></Field>
      </div>
    </Modal>
  );
}

export function StatementModal({ partner, role, onClose }: { partner: any; role: string; onClose: () => void }) {
  const [from, setFrom] = useState(monthStart().slice(0, 4) + "-01-01");
  const [to, setTo] = useState(today());
  const { data } = useFetch(`/reports/statement/${partner.id}${q({ role, from, to })}`);
  return (
    <Modal wide title={`كشف حساب: ${partner.name}`} onClose={onClose} footer={<><PrintBtn />{data && <ExportBtn name={`كشف حساب ${partner.name}`} rows={() => data.rows.map((r: any) => ({ التاريخ: r.date, القيد: r.number, البيان: r.memo, مدين: r.debit, دائن: r.credit, الرصيد: r.balance }))} />}<button className="btn" onClick={onClose}>إغلاق</button></>}>
      <div className="no-print mb"><DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} /></div>
      {!data ? <Loading /> : (
        <div className="print-doc" style={{ padding: 0 }}>
          <div className="print-only"><h2>كشف حساب {role === "CUSTOMER" ? "عميل" : "مورد"}: {partner.name}</h2><div>من {from} إلى {to}</div></div>
          <table className="tbl compact"><thead><tr><th>التاريخ</th><th>المرجع</th><th>البيان</th><th className="n">مدين</th><th className="n">دائن</th><th className="n">الرصيد</th></tr></thead>
            <tbody>
              <tr className="group"><td colSpan={5}>رصيد أول المدة</td><td className="n"><Money v={data.opening} /></td></tr>
              {data.rows.map((r: any, i: number) => <tr key={i}><td>{fmtDate(r.date)}</td><td>{r.reference || r.number}</td><td>{r.memo}</td><td className="n"><Money v={r.debit} blankZero /></td><td className="n"><Money v={r.credit} blankZero /></td><td className="n"><Money v={r.balance} /></td></tr>)}
            </tbody>
            <tfoot><tr><td colSpan={5}>رصيد آخر المدة {role === "CUSTOMER" ? "(مستحق على العميل)" : "(مستحق للمورد)"}</td><td className="n"><Money v={data.closing} /></td></tr></tfoot>
          </table>
        </div>
      )}
    </Modal>
  );
}

// ─── products ──────────────────────────────────────────────────────────────
export function ProductsPage() {
  const { can } = useCompanyContext();
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("");
  const dq = useDebounce(search);
  const [edit, setEdit] = useState<any>(null);
  const [card, setCard] = useState<any>(null);
  const [cats, setCats] = useState(false);
  const [imp, setImp] = useState(false);
  const categories = useFetch("/categories");
  const { data, loading, reload } = useFetch(`/products${q({ q: dq, categoryId: cat, limit: 1000, active: "all" })}`);
  return (
    <div className="card">
      <div className="card-h"><h3>الأصناف والخدمات <span className="muted small">({data?.length || 0})</span></h3><div className="row">{can("products.write") && <><button className="btn sm" onClick={() => setImp(true)}>⬆ استيراد Excel</button><button className="btn sm" onClick={() => setCats(true)}>التصنيفات</button><button className="btn primary sm" onClick={() => setEdit({})}>＋ صنف جديد</button></>}</div></div>
      <div className="card-b">
        <div className="toolbar">
          <div className="search"><span className="ic">🔍</span><Input placeholder="بحث بالاسم / الرمز / الباركود" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <Select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">كل التصنيفات</option>{(categories.data || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <div className="grow" />{data && <ExportBtn name="الأصناف" rows={() => data.map((p: any) => ({ الرمز: p.sku, الباركود: p.barcode, الاسم: p.name, التصنيف: p.category, النوع: p.type === "STOCK" ? "مخزني" : "خدمة", الوحدة: p.unit, "سعر البيع": p.salePrice, "سعر الشراء": p.purchasePrice, "متوسط التكلفة": p.avgCost, الكمية: p.qty, "قيمة المخزون": p.stockValue, الضريبة: TAX_AR[p.taxCode] }))} />}
        </div>
        {loading && !data ? <Loading /> : !data?.length ? <Empty /> : (
          <div className="table-wrap"><table className="tbl"><thead><tr><th>الرمز</th><th>الصنف</th><th>التصنيف</th><th>الوحدة</th><th className="n">سعر البيع</th><th className="n">متوسط التكلفة</th><th className="n">الكمية</th><th className="n">قيمة المخزون</th><th>الضريبة</th><th /></tr></thead>
            <tbody>{data.map((p: any) => <tr key={p.id} className={p.isActive ? "" : "muted"}>
              <td className="num">{p.sku}<div className="small muted num">{p.barcode}</div></td>
              <td><div className="row" style={{ gap: 8 }}>{p.image && <img src={p.image} style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover" }} alt="" />}<div><b>{p.name}</b>{p.type === "SERVICE" && <span className="badge blue" style={{ marginInlineStart: 6 }}>خدمة</span>}{!p.isActive && <span className="badge gray" style={{ marginInlineStart: 6 }}>موقوف</span>}</div></div></td>
              <td>{p.category && <span className="badge" style={p.categoryColor ? { background: p.categoryColor + "22", color: p.categoryColor } : {}}>{p.category}</span>}</td><td>{p.unit}</td>
              <td className="n"><Money v={p.salePrice} /></td><td className="n">{p.type === "STOCK" ? <Money v={p.avgCost} /> : ""}</td>
              <td className={"n " + (p.type === "STOCK" && Number(p.qty) <= Number(p.reorderLevel) ? "neg-val" : "")}>{p.type === "STOCK" ? Number(p.qty) : "—"}</td>
              <td className="n">{p.type === "STOCK" ? <Money v={p.stockValue} /> : ""}</td><td className="small">{TAX_AR[p.taxCode]}</td>
              <td className="row" style={{ gap: 4 }}>{p.type === "STOCK" && <button className="btn sm" onClick={() => setCard(p)}>كرت الصنف</button>}{can("products.write") && <button className="btn sm ghost" onClick={() => setEdit(p)}>تعديل</button>}</td>
            </tr>)}</tbody></table></div>
        )}
      </div>
      {edit && <ProductEditor p={edit} categories={categories.data || []} onClose={(s) => { setEdit(null); if (s) reload(); }} />}
      {card && <StockCardModal p={card} onClose={() => setCard(null)} />}
      {cats && <CategoriesModal onClose={() => { setCats(false); categories.reload(); reload(); }} />}
      {imp && <ImportModal kind="products" onClose={(d) => { setImp(false); if (d) { reload(); categories.reload(); } }} />}
    </div>
  );
}

function ProductEditor({ p, categories, onClose }: { p: any; categories: any[]; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const toast = useToast();
  const [f, setF] = useState<any>({ type: "STOCK", unit: "حبة", taxCode: "S", salePrice: 0, purchasePrice: 0, reorderLevel: 0, isActive: true, ...p });
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <Modal title={p.id ? `تعديل: ${p.name}` : "صنف جديد"} onClose={() => onClose()} footer={<>
      {p.id && <button className="btn danger sm" onClick={() => run(async () => { if (!confirmDlg("حذف الصنف؟")) return; const r = await api(`/products/${p.id}`, { method: "DELETE" }); if (r.message) toast(r.message); onClose(true); })}>حذف</button>}
      <div className="grow" /><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy} onClick={() => run(async () => { p.id ? await api(`/products/${p.id}`, { method: "PUT", body: f }) : await api("/products", { body: f }); onClose(true); }, "تم الحفظ")}>حفظ</button></>}>
      <div className="form-grid">
        <Field label="اسم الصنف" span2><Input autoFocus value={f.name || ""} onChange={s("name")} /></Field>
        <Field label="النوع"><Select value={f.type} onChange={s("type")} disabled={!!p.id}><option value="STOCK">صنف مخزني</option><option value="SERVICE">خدمة</option></Select></Field>
        <Field label="الرمز SKU (تلقائي)"><Input value={f.sku || ""} onChange={s("sku")} dir="ltr" /></Field>
        <Field label="الباركود"><Input value={f.barcode || ""} onChange={s("barcode")} dir="ltr" /></Field>
        <Field label="التصنيف"><Select value={f.categoryId || ""} onChange={s("categoryId")}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="الوحدة"><Input value={f.unit} onChange={s("unit")} list="units" /><datalist id="units"><option value="حبة" /><option value="كرتون" /><option value="كيلو" /><option value="لتر" /><option value="علبة" /><option value="كيس" /><option value="متر" /><option value="خدمة" /></datalist></Field>
        <Field label="سعر البيع"><NumInput value={f.salePrice} onChange={s("salePrice")} /></Field>
        <Field label="سعر الشراء الافتراضي"><NumInput value={f.purchasePrice} onChange={s("purchasePrice")} /></Field>
        <Field label="الضريبة"><Select value={f.taxCode} onChange={s("taxCode")}>{["S", "Z", "E", "O"].map((t) => <option key={t} value={t}>{TAX_AR[t]}</option>)}</Select></Field>
        {f.type === "STOCK" && <Field label="حد إعادة الطلب"><NumInput value={f.reorderLevel} onChange={s("reorderLevel")} /></Field>}
        {f.type === "STOCK" && !p.id && <Field label="رصيد افتتاحي (كمية)" hint="يُقيّم بسعر الشراء ويُرحّل كرصيد افتتاحي"><NumInput value={f.openingQty || ""} onChange={s("openingQty")} /></Field>}
        <Field label="الصورة"><div className="row"><label className="btn sm">اختيار صورة<input type="file" accept="image/*" hidden onChange={async (e) => { const file = e.target.files?.[0]; if (file) setF({ ...f, image: await fileToDataUrl(file, 300) }); }} /></label>{f.image && <><img src={f.image} style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover" }} alt="" /><button className="btn ghost sm" onClick={() => setF({ ...f, image: null })}>✕</button></>}</div></Field>
        {p.id && <Field label="الحالة"><label className="check"><input type="checkbox" checked={!!f.isActive} onChange={s("isActive")} /> نشط (يظهر في البيع)</label></Field>}
      </div>
    </Modal>
  );
}

function CategoriesModal({ onClose }: { onClose: () => void }) {
  const { data, reload } = useFetch("/categories");
  const { run } = useAction();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#0f766e");
  return (
    <Modal narrow title="تصنيفات الأصناف" onClose={onClose}>
      <div className="row mb"><Input placeholder="اسم التصنيف" value={name} onChange={(e) => setName(e.target.value)} /><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /><button className="btn primary sm" onClick={() => run(async () => { await api("/categories", { body: { name, color } }); setName(""); reload(); })}>إضافة</button></div>
      <table className="tbl compact"><tbody>{(data || []).map((c: any) => <tr key={c.id}><td><span className="badge" style={{ background: c.color + "22", color: c.color }}>{c.name}</span></td><td className="muted">{c.count} صنف</td><td><button className="btn ghost sm" onClick={() => run(async () => { if (confirmDlg("حذف التصنيف؟ (الأصناف تبقى بدون تصنيف)")) { await api(`/categories/${c.id}`, { method: "DELETE" }); reload(); } })}>✕</button></td></tr>)}</tbody></table>
    </Modal>
  );
}

export function StockCardModal({ p, onClose }: { p: any; onClose: () => void }) {
  const [from, setFrom] = useState(today().slice(0, 4) + "-01-01");
  const [to, setTo] = useState(today());
  const { data } = useFetch(`/inventory/card/${p.id}${q({ from, to })}`);
  const SRC: Record<string, string> = { SALE: "بيع", SALE_RETURN: "مرتجع بيع", PURCHASE: "شراء", PURCHASE_RETURN: "مرتجع شراء", ADJUSTMENT: "تسوية جرد", OPENING: "رصيد افتتاحي", TRANSFER: "تحويل", POS: "نقطة بيع" };
  return (
    <Modal wide title={`كرت الصنف: ${p.name} (${p.sku})`} onClose={onClose} footer={<><PrintBtn />{data && <ExportBtn name={`كرت صنف ${p.sku}`} rows={() => data.rows.map((r: any) => ({ التاريخ: r.date, الحركة: SRC[r.sourceType], المرجع: r.reference, المستودع: r.warehouse, الكمية: r.qty, "تكلفة الوحدة": r.unitCost, القيمة: r.value, "رصيد الكمية": r.balanceQty, "رصيد القيمة": r.balanceVal }))} />}<button className="btn" onClick={onClose}>إغلاق</button></>}>
      <div className="no-print mb"><DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} /></div>
      {!data ? <Loading /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>التاريخ</th><th>الحركة</th><th>المرجع</th><th>المستودع</th><th className="n">وارد</th><th className="n">صادر</th><th className="n">تكلفة الوحدة</th><th className="n">القيمة</th><th className="n">رصيد الكمية</th><th className="n">رصيد القيمة</th><th className="n">متوسط التكلفة</th></tr></thead>
        <tbody>{data.rows.map((r: any) => <tr key={r.id}><td>{fmtDate(r.date)}</td><td>{SRC[r.sourceType]}</td><td>{r.reference}</td><td>{r.warehouse}</td><td className="n pos-val">{Number(r.qty) > 0 ? Number(r.qty) : ""}</td><td className="n neg-val">{Number(r.qty) < 0 ? -Number(r.qty) : ""}</td><td className="n"><Money v={r.unitCost} /></td><td className="n"><Money v={r.value} sign /></td><td className="n">{Number(r.balanceQty)}</td><td className="n"><Money v={r.balanceVal} /></td><td className="n">{Number(r.balanceQty) > 0 ? money(Number(r.balanceVal) / Number(r.balanceQty)) : ""}</td></tr>)}</tbody></table></div>}
    </Modal>
  );
}

// ─── inventory: valuation, warehouses, adjustments ─────────────────────────
export function InventoryPage() {
  const { can } = useCompanyContext();
  const [tab, setTab] = useState("valuation");
  const val = useFetch(`/inventory/valuation`);
  const wh = useFetch("/warehouses");
  const adj = useFetch("/inventory/adjustments");
  const [newAdj, setNewAdj] = useState<string | null>(null);
  const { run } = useAction();
  const [whName, setWhName] = useState("");
  return (
    <div className="grid">
      <div className="tabs"><button className={tab === "valuation" ? "active" : ""} onClick={() => setTab("valuation")}>تقييم المخزون</button><button className={tab === "adj" ? "active" : ""} onClick={() => setTab("adj")}>الجرد والتسويات والتحويلات</button><button className={tab === "wh" ? "active" : ""} onClick={() => setTab("wh")}>المستودعات</button></div>
      {tab === "valuation" && <div className="card"><div className="card-h"><h3>تقييم المخزون (متوسط مرجح)</h3><div className="row">{val.data && <span className={"badge " + (val.data.matches ? "green" : "red")}>{val.data.matches ? "مطابق لحساب المخزون ✓" : `فرق مع الحساب: ${money(val.data.total - val.data.glBalance)}`}</span>}<PrintBtn />{val.data && <ExportBtn name="تقييم المخزون" rows={() => val.data.rows.map((r: any) => ({ الرمز: r.sku, الصنف: r.name, التصنيف: r.category, المستودع: r.warehouse, الكمية: r.qty, "متوسط التكلفة": r.avgCost, "القيمة": r.value, "قيمة البيع": r.retail }))} />}</div></div>
        {!val.data ? <Loading /> : <div className="table-wrap"><table className="tbl"><thead><tr><th>الرمز</th><th>الصنف</th><th>التصنيف</th><th>المستودع</th><th className="n">الكمية</th><th className="n">متوسط التكلفة</th><th className="n">قيمة التكلفة</th><th className="n">قيمة البيع</th><th className="n">هامش متوقع</th></tr></thead>
          <tbody>{val.data.rows.map((r: any) => <tr key={r.id + r.warehouseId}><td className="num">{r.sku}</td><td>{r.name}</td><td>{r.category}</td><td>{r.warehouse}</td><td className={"n " + (Number(r.qty) <= Number(r.reorderLevel) ? "neg-val" : "")}>{Number(r.qty)}</td><td className="n"><Money v={r.avgCost} /></td><td className="n"><Money v={r.value} /></td><td className="n"><Money v={r.retail} /></td><td className="n"><Money v={r.retail - r.value} sign /></td></tr>)}</tbody>
          <tfoot><tr><td colSpan={6}>الإجمالي</td><td className="n"><Money v={val.data.total} /></td><td className="n"><Money v={val.data.rows.reduce((a: number, r: any) => a + r.retail, 0)} /></td><td /></tr></tfoot></table></div>}</div>}
      {tab === "adj" && <div className="card"><div className="card-h"><h3>الجرد والتسويات</h3>{can("inventory.write") && <div className="row"><button className="btn primary sm" onClick={() => setNewAdj("COUNT")}>＋ جرد فعلي</button><button className="btn sm" onClick={() => setNewAdj("OPENING")}>＋ أرصدة افتتاحية</button><button className="btn sm" onClick={() => setNewAdj("TRANSFER")}>＋ تحويل بين مستودعات</button></div>}</div>
        {!adj.data ? <Loading /> : !adj.data.length ? <Empty /> : <div className="table-wrap"><table className="tbl"><thead><tr><th>الرقم</th><th>التاريخ</th><th>النوع</th><th>المستودع</th><th>الأصناف</th><th className="n">أثر القيمة</th><th>ملاحظات</th></tr></thead><tbody>{adj.data.map((a: any) => <tr key={a.id}><td>{a.number}</td><td>{fmtDate(a.date)}</td><td>{{ COUNT: "جرد", OPENING: "رصيد افتتاحي", TRANSFER: "تحويل" }[a.kind as string]}</td><td>{a.warehouse}</td><td className="small">{a.lines.map((l: any) => `${l.name} (${l.qty > 0 ? "+" : ""}${l.qty})`).join("، ")}</td><td className="n"><Money v={a.totalValue} sign /></td><td>{a.notes}</td></tr>)}</tbody></table></div>}</div>}
      {tab === "wh" && <div className="card"><div className="card-h"><h3>المستودعات</h3></div><div className="card-b">
        <table className="tbl compact"><tbody>{(wh.data || []).map((w: any) => <tr key={w.id}><td>{w.code}</td><td>{w.name} {w.isDefault && <span className="badge teal">افتراضي</span>}</td><td>{!w.isDefault && can("inventory.write") && <button className="btn ghost sm" onClick={() => run(async () => { await api(`/warehouses/${w.id}`, { method: "PUT", body: { isDefault: true } }); wh.reload(); })}>جعله افتراضياً</button>}</td></tr>)}</tbody></table>
        {can("inventory.write") && <div className="row mt"><Input placeholder="اسم مستودع جديد" value={whName} onChange={(e) => setWhName(e.target.value)} /><button className="btn primary sm" onClick={() => run(async () => { await api("/warehouses", { body: { code: "WH" + ((wh.data?.length || 0) + 1), name: whName } }); setWhName(""); wh.reload(); })}>إضافة</button></div>}
      </div></div>}
      {newAdj && <AdjustmentModal kind={newAdj} warehouses={wh.data || []} onClose={(s) => { setNewAdj(null); if (s) { adj.reload(); val.reload(); setTab("adj"); } }} />}
    </div>
  );
}

function AdjustmentModal({ kind, warehouses, onClose }: { kind: string; warehouses: any[]; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [date, setDate] = useState(today());
  const [wh, setWh] = useState(warehouses[0]?.id || "");
  const [to, setTo] = useState(warehouses[1]?.id || "");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<{ key: number; product: any; qty: number; unitCost: number }[]>([{ key: 1, product: null, qty: 0, unitCost: 0 }]);
  const title = { COUNT: "جرد فعلي (تسوية الرصيد إلى الكمية المعدودة)", OPENING: "أرصدة افتتاحية للمخزون", TRANSFER: "تحويل بين المستودعات" }[kind];
  return (
    <Modal wide title={title} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api("/inventory/adjustments", { body: { kind, date, warehouseId: wh, toWarehouse: to, notes, lines: lines.filter((l) => l.product).map((l) => ({ productId: l.product.id, qty: l.qty, unitCost: l.unitCost })) } }); onClose(true); }, "تم الترحيل")}>ترحيل</button></>}>
      <div className="form-grid">
        <Field label="التاريخ"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={kind === "TRANSFER" ? "من مستودع" : "المستودع"}><Select value={wh} onChange={(e) => setWh(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
        {kind === "TRANSFER" && <Field label="إلى مستودع"><Select value={to} onChange={(e) => setTo(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>}
        <Field label="ملاحظات" span2><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <table className="tbl compact mt"><thead><tr><th style={{ width: "50%" }}>الصنف</th><th>{kind === "COUNT" ? "الكمية المعدودة" : "الكمية"}</th>{kind !== "TRANSFER" && <th>تكلفة الوحدة</th>}<th /></tr></thead>
        <tbody>{lines.map((l) => <tr key={l.key}><td><Picker value={l.product} onChange={(p: any) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, product: p, unitCost: p ? Number(p.avgCost || p.purchasePrice) : 0 } : x)))} fetcher={async (s) => (await productFetcher(s)).filter((p: any) => p.type === "STOCK")} label={(p: any) => `${p.name} (متاح ${Number(p.qty)})`} /></td><td><NumInput value={l.qty} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: Number(e.target.value) } : x)))} /></td>{kind !== "TRANSFER" && <td><NumInput value={l.unitCost} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, unitCost: Number(e.target.value) } : x)))} /></td>}<td><button className="btn ghost sm" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button></td></tr>)}</tbody></table>
      <button className="btn sm mt" onClick={() => setLines((ls) => [...ls, { key: Date.now(), product: null, qty: 0, unitCost: 0 }])}>＋ سطر</button>
      {kind === "COUNT" && <div className="hint mt">الفروق تُرحّل تلقائياً: الزيادة إلى «أرباح فروقات الجرد» والعجز إلى «عجز وتالف المخزون».</div>}
    </Modal>
  );
}
