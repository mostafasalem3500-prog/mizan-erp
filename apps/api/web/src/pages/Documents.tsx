import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { amountToArabicWords } from "../shared/tafqeet";
import { api, q, useFetch, Money, money, Loading, Empty, Badge, KIND_AR, STATUS_AR, ZATCA_AR, TAX_AR, fmtDate, fmtDT, today, Modal, Field, Input, Select, NumInput, Picker, partnerFetcher, productFetcher, accountFetcher, useAction, useToast, useCompanyContext, ExportBtn, PrintBtn, useDebounce, confirmDlg, METHOD_AR } from "../lib";

const KIND_TITLE: Record<string, Record<string, string>> = {
  SALE: { QUOTATION: "عرض سعر", ORDER: "أمر بيع", INVOICE: "فاتورة ضريبية", CREDIT_NOTE: "إشعار دائن", DEBIT_NOTE: "إشعار مدين" },
  PURCHASE: { QUOTATION: "طلب عرض سعر", ORDER: "أمر شراء", INVOICE: "فاتورة مشتريات", CREDIT_NOTE: "مرتجع مشتريات (إشعار دائن)", DEBIT_NOTE: "إشعار مدين للمورد" },
};

// ─── list ──────────────────────────────────────────────────────────────────
export function DocumentsPage({ direction, kinds, title }: { direction: "SALE" | "PURCHASE"; kinds: string[]; title: string }) {
  const nav = useNavigate();
  const { can, me } = useCompanyContext();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [pay, setPay] = useState("");
  const [page, setPage] = useState(0);
  const dq = useDebounce(search);
  const [editor, setEditor] = useState<{ kind: string; id?: string } | null>(null);
  const { data, loading, reload } = useFetch(`/invoices${q({ direction, kind: kinds.join(","), q: dq, status, paymentStatus: pay, limit: 50, offset: page * 50 })}`);
  const writePerm = direction === "SALE" ? "sales.write" : "purchases.write";
  useEffect(() => setPage(0), [dq, status, pay]);
  return (
    <div className="card">
      <div className="card-h">
        <h3>{title} <span className="muted small">{data ? `(${data.total})` : ""}</span></h3>
        <div className="row">
          {can(writePerm) && kinds.map((k) => (k === "CREDIT_NOTE" || k === "DEBIT_NOTE") ? null : <button key={k} className="btn primary sm" onClick={() => setEditor({ kind: k })}>＋ {KIND_TITLE[direction][k]}</button>)}
          {kinds.includes("CREDIT_NOTE") && <span className="hint">يُنشأ الإشعار الدائن من داخل الفاتورة الأصلية</span>}
        </div>
      </div>
      <div className="card-b">
        <div className="toolbar">
          <div className="search"><span className="ic">🔍</span><Input placeholder="بحث بالرقم أو الاسم" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">كل الحالات</option><option value="DRAFT">مسودة</option><option value="POSTED">مرحّل</option><option value="CONVERTED">محوّل</option></Select>
          {kinds.includes("INVOICE") && <Select value={pay} onChange={(e) => setPay(e.target.value)}><option value="">كل حالات السداد</option><option value="UNPAID">غير مسدد</option><option value="PARTIAL">جزئي</option><option value="PAID">مسدد</option></Select>}
          <div className="grow" />
          {data && <ExportBtn name={title} rows={() => data.rows.map((r: any) => ({ الرقم: r.number, النوع: KIND_AR[r.kind], الطرف: r.partnerName, التاريخ: r.date, الاستحقاق: r.dueDate, الحالة: STATUS_AR[r.status], "قبل الضريبة": r.taxable, الضريبة: r.vatTotal, الإجمالي: r.total, المسدد: r.amountPaid }))} />}
        </div>
        {loading && !data ? <Loading /> : !data?.rows.length ? <Empty /> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>الرقم</th><th>التاريخ</th><th>{direction === "SALE" ? "العميل" : "المورد"}</th><th>النوع</th><th className="n">قبل الضريبة</th><th className="n">الضريبة</th><th className="n">الإجمالي</th><th className="n">المتبقي</th><th>الحالة</th>{direction === "SALE" && kinds.includes("INVOICE") && <th>الهيئة</th>}</tr></thead>
            <tbody>{data.rows.map((r: any) => (
              <tr key={r.id} className="clickable" onClick={() => r.status === "DRAFT" && (r.kind === "QUOTATION" || r.kind === "ORDER" || r.kind === "INVOICE") ? setEditor({ kind: r.kind, id: r.id }) : nav(`/doc/${r.id}`)}>
                <td><b>{r.number}</b>{r.channel === "POS" && <span className="badge gray" style={{ marginInlineStart: 4 }}>POS</span>}{r.isDemo && <span className="badge amber" style={{ marginInlineStart: 4 }}>تجريبي</span>}</td>
                <td>{fmtDate(r.date)}</td><td>{r.partnerName}</td><td>{KIND_AR[r.kind]}</td>
                <td className="n"><Money v={r.taxable} /></td><td className="n"><Money v={r.vatTotal} /></td><td className="n"><b><Money v={r.total} /></b></td>
                <td className="n">{r.kind === "INVOICE" && r.status === "POSTED" ? <Money v={Number(r.total) - Number(r.amountPaid)} blankZero /> : ""}</td>
                <td><Badge s={r.status} /> {r.kind === "INVOICE" && r.status === "POSTED" && <Badge s={r.paymentStatus} />}</td>
                {direction === "SALE" && kinds.includes("INVOICE") && <td>{r.zatcaStatus && <Badge s={r.zatcaStatus} map={ZATCA_AR} />}</td>}
              </tr>))}
            </tbody>
            <tfoot><tr><td colSpan={6}>الإجمالي (المرحّل، صافي الإشعارات)</td><td className="n"><Money v={data.sum} /></td><td colSpan={3} /></tr></tfoot>
          </table></div>
        )}
        {data && data.total > 50 && <div className="row mt"><button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>السابق</button><span className="muted">{page + 1} / {Math.ceil(data.total / 50)}</span><button className="btn sm" disabled={(page + 1) * 50 >= data.total} onClick={() => setPage(page + 1)}>التالي</button></div>}
      </div>
      {editor && <DocEditor direction={direction} kind={editor.kind} id={editor.id} onClose={(saved) => { setEditor(null); if (saved) reload(); }} />}
    </div>
  );
}

// ─── editor ────────────────────────────────────────────────────────────────
type Line = { key: number; product: any | null; account?: any | null; description: string; qty: number; unitPrice: number; discountPct: number; taxCode: string; uom?: { id: string; name: string; factor: number; salePrice?: number | null; purchasePrice?: number | null } | null };
const newLine = (): Line => ({ key: Math.random(), product: null, description: "", qty: 1, unitPrice: 0, discountPct: 0, taxCode: "S", uom: null });

function calc(l: Line, incl: boolean) {
  const rate = l.taxCode === "S" || l.taxCode === "IM" ? 15 : 0;
  const gross = l.qty * l.unitPrice * (1 - l.discountPct / 100);
  let net = gross, vat = gross * rate / 100;
  if (incl && rate) { net = gross / (1 + rate / 100); vat = gross - net; }
  return { net: Math.round(net * 100) / 100, vat: Math.round(vat * 100) / 100, rcVat: l.taxCode === "RC" ? Math.round(gross * 15) / 100 : 0 };
}

export function DocEditor({ direction, kind, id, onClose, originId, prefill }: { direction: "SALE" | "PURCHASE"; kind: string; id?: string; onClose: (saved?: boolean) => void; originId?: string; prefill?: any }) {
  const { me } = useCompanyContext();
  const toast = useToast();
  const nav = useNavigate();
  const { run, busy } = useAction();
  const [partner, setPartner] = useState<any>(null);
  const [date, setDate] = useState(today());
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [supplierRef, setSupplierRef] = useState("");
  const [reason, setReason] = useState("");
  const [incl, setIncl] = useState(direction === "SALE" && !!me.company.pricesIncludeVat);
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [loaded, setLoaded] = useState(!id);
  const [newPartner, setNewPartner] = useState(false);
  const isSale = direction === "SALE";
  const isNote = kind === "CREDIT_NOTE" || kind === "DEBIT_NOTE";
  const { data: currencies } = useFetch("/currencies");
  const [currency, setCurrency] = useState("SAR");
  const [rate, setRate] = useState<number>(1);
  const [priceList, setPriceList] = useState<any>(null);
  const fc = currency !== "SAR";
  const sym = (currencies || []).find((c: any) => c.code === currency)?.symbol || currency;
  // partner defaults: currency (foreign suppliers/customers) and price list (customers)
  useEffect(() => {
    if (!partner || id || isNote) return;
    const cur = partner.currency && partner.currency !== "SAR" ? partner.currency : "SAR";
    setCurrency(cur);
    if (cur !== "SAR") api(`/currencies/${cur}/rate${q({ date })}`).then((r) => setRate(Number(r.rate))).catch(() => undefined); else setRate(1);
    if (isSale && partner.priceListId) api(`/price-lists/${partner.priceListId}`).then(setPriceList).catch(() => setPriceList(null)); else setPriceList(null);
  }, [partner?.id]);
  const changeCurrency = async (cur: string) => { setCurrency(cur); if (cur === "SAR") setRate(1); else try { const r = await api(`/currencies/${cur}/rate${q({ date })}`); setRate(Number(r.rate)); } catch {} };
  useEffect(() => {
    if (prefill) { setPartner(prefill.partner); setLines(prefill.lines); setReason(prefill.reason || ""); setLoaded(true); return; }
    if (!id) return;
    api(`/invoices/${id}`).then((d) => {
      setPartner(d.partner || { id: d.partnerId, name: d.partnerName });
      setDate(d.date); setDueDate(d.dueDate || ""); setNotes(d.notes || ""); setSupplierRef(d.supplierRef || ""); setReason(d.reason || "");
      setCurrency(d.currency || "SAR"); setRate(Number(d.exchangeRate) || 1);
      if (d.priceListId) api(`/price-lists/${d.priceListId}`).then(setPriceList).catch(() => undefined);
      setLines(d.lines.map((l: any) => ({ key: Math.random(), product: l.productId ? { id: l.productId, name: l.description, sku: l.sku, unit: l.unit, uoms: [] } : null, account: l.accountId ? { id: l.accountId } : null, description: l.description, qty: Number(l.qty), unitPrice: Number(l.fcUnitPrice ?? l.unitPrice), discountPct: Number(l.discountPct), taxCode: l.taxCode, uom: l.uomId ? { id: l.uomId, name: l.uom, factor: Number(l.factor) } : null })));
      setLoaded(true);
    }).catch((e) => toast(e.message, "err"));
  }, [id]);
  const totals = useMemo(() => {
    let net = 0, vat = 0, rc = 0, customs = 0;
    for (const l of lines) { const c = calc(l, incl); net += c.net; vat += c.vat; rc += c.rcVat; if (!isSale && l.taxCode === "IM") customs += c.vat; }
    return { net: Math.round(net * 100) / 100, vat: Math.round(vat * 100) / 100, total: Math.round((net + vat - customs) * 100) / 100, rc, customs: Math.round(customs * 100) / 100 };
  }, [lines, incl]);
  const upd = (k: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const listPrice = (p: any, qty = 1) => {
    if (!priceList || !isSale) return null;
    if (priceList.kind === "DISCOUNT") return Math.round(Number(p.salePrice) * (1 - Number(priceList.discountPct) / 100) * 10000) / 10000;
    const items = (priceList.items || []).filter((i: any) => i.productId === p.id && Number(i.minQty) <= qty).sort((a: any, b: any) => Number(a.minQty) - Number(b.minQty));
    return items.length ? Number(items[items.length - 1].price) : null;
  };
  const unitPriceFor = (p: any, u: any | null) => {
    const base = isSale ? listPrice(p) ?? Number(p.salePrice) : Number(p.purchasePrice) || Number(p.avgCost) || 0;
    const packed = u ? (isSale ? (u.salePrice !== null && u.salePrice !== undefined ? Number(u.salePrice) : base * Number(u.factor)) : (u.purchasePrice !== null && u.purchasePrice !== undefined ? Number(u.purchasePrice) : base * Number(u.factor))) : base;
    return fc ? Math.round((packed / rate) * 10000) / 10000 : Math.round(packed * 10000) / 10000;
  };
  const pickProduct = (k: number, p: any, u: any | null = null) => {
    if (!p) return upd(k, { product: null, uom: null });
    upd(k, { product: p, uom: u, description: p.name + (u ? ` — ${u.name}` : ""), unitPrice: unitPriceFor(p, u), taxCode: isSale || p.taxCode !== "S" ? p.taxCode : "S" });
  };
  const body = () => ({ direction, kind, date, dueDate: dueDate || null, partnerId: partner?.id, notes, supplierRef: supplierRef || null, reason: reason || null, originId: originId || null, pricesIncludeVat: incl, currency, exchangeRate: fc ? rate : 1, priceListId: priceList?.id || null,
    lines: lines.filter((l) => l.product || l.description).map((l) => ({ productId: l.product?.id || null, accountId: l.account?.id || null, description: l.description, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct, taxCode: l.taxCode, uomId: l.uom?.id || null })) });
  const save = (post: boolean) => run(async () => {
    if (!partner) throw new Error(isSale ? "اختر العميل" : "اختر المورد");
    const d = id ? await api(`/invoices/${id}`, { method: "PUT", body: body() }) : await api("/invoices", { body: body() });
    if (post) {
      if (!confirmDlg(`ترحيل ${KIND_TITLE[direction][kind]} بإجمالي ${money(totals.total)} ر.س؟ لا يمكن تعديل المستند بعد الترحيل.`)) { onClose(true); return; }
      await postWithCreditCheck(d.id, me.role === "OWNER" || me.role === "ADMIN" || me.superAdmin);
      toast("تم الترحيل وإنشاء القيد المحاسبي", "ok");
      onClose(true);
      nav(`/doc/${d.id}`);
    } else { toast("تم الحفظ كمسودة", "ok"); onClose(true); }
  });
  const barcodeAdd = async (code: string) => {
    const r = await api(`/products${q({ barcode: code, limit: 1 })}`);
    if (r[0]) { const u = (r[0].uoms || []).find((x: any) => x.barcode === code) || null; const empty = lines.find((l) => !l.product && !l.description); if (empty) pickProduct(empty.key, r[0], u); else { const l = newLine(); setLines((ls) => [...ls, l]); setTimeout(() => pickProduct(l.key, r[0], u), 0); } } else toast("لا يوجد صنف بهذا الباركود", "err");
  };
  if (!loaded) return <Modal title="..." onClose={onClose}><Loading /></Modal>;
  return (
    <Modal wide title={`${id ? "تعديل" : "إنشاء"} ${KIND_TITLE[direction][kind]}`} onClose={() => onClose()} footer={<>
      <div className="grow row"><span className="muted">قبل الضريبة</span><b><Money v={totals.net} /></b><span className="muted">الضريبة</span><b><Money v={totals.vat} /></b>{totals.rc > 0 && <span className="muted small">احتساب عكسي: {money(totals.rc * (fc ? rate : 1))} ر.س</span>}{totals.customs > 0 && <span className="muted small">منها ضريبة استيراد تُسدد للجمارك: {money(totals.customs * (fc ? rate : 1))} ر.س</span>}<span className="muted">{totals.customs > 0 ? "المستحق للمورد" : "الإجمالي"}</span><b style={{ fontSize: 18, color: "var(--primary)" }}><Money v={totals.total} /> {fc ? sym : ""}</b>{fc && <span className="muted small">= {money(totals.total * rate)} ر.س @ {rate}</span>}</div>
      <button className="btn" onClick={() => onClose()}>إلغاء</button>
      <button className="btn" disabled={busy} onClick={() => save(false)}>حفظ مسودة</button>
      {(kind === "INVOICE" || isNote) && <button className="btn primary" disabled={busy} onClick={() => save(true)}>حفظ وترحيل ✓</button>}
      {(kind === "QUOTATION" || kind === "ORDER") && <button className="btn primary" disabled={busy} onClick={() => save(false)}>حفظ</button>}
    </>}>
      <div className="form-grid">
        <Field label={isSale ? "العميل" : "المورد"} span2>
          <Picker value={partner} onChange={setPartner} fetcher={partnerFetcher(isSale ? "CUSTOMER" : "SUPPLIER")} label={(p: any) => `${p.name}${p.vatNumber ? " · " + p.vatNumber : ""}`} placeholder="ابحث بالاسم أو الجوال أو الرقم الضريبي" autoFocus={!id} allowClear={!isNote} onCreate={() => setNewPartner(true)} />
        </Field>
        <Field label="التاريخ"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {kind !== "QUOTATION" && <Field label="تاريخ الاستحقاق"><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>}
        {!isSale && <Field label="رقم فاتورة المورد"><Input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} dir="ltr" /></Field>}
        {isNote && <Field label="سبب الإشعار (إلزامي للهيئة)" span2><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: إرجاع بضاعة / خطأ في السعر" /></Field>}
        <Field label="العملة"><div className="row" style={{ gap: 6 }}><Select value={currency} disabled={isNote} onChange={(e) => changeCurrency(e.target.value)} style={{ width: 110 }}>{(currencies || [{ code: "SAR" }]).filter((c: any) => c.isActive !== false).map((c: any) => <option key={c.code} value={c.code}>{c.code}</option>)}</Select>{fc && <NumInput title="سعر الصرف: ريال لكل وحدة" value={rate} disabled={isNote} onChange={(e) => setRate(Number(e.target.value) || 0)} style={{ width: 100 }} />}</div></Field>
        <Field label="خيارات"><label className="check"><input type="checkbox" checked={incl} onChange={(e) => setIncl(e.target.checked)} /> الأسعار شاملة الضريبة</label>{priceList && <div className="small" style={{ color: "var(--primary)" }}>قائمة الأسعار: {priceList.name}{priceList.kind === "DISCOUNT" ? ` (خصم ${priceList.discountPct}%)` : ""}</div>}</Field>
        {isSale && <Field label="مسح باركود"><Input placeholder="امسح أو اكتب ثم Enter" dir="ltr" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const v = (e.target as HTMLInputElement).value.trim(); if (v) { barcodeAdd(v); (e.target as HTMLInputElement).value = ""; } } }} /></Field>}
      </div>
      <div className="table-wrap mt"><table className="tbl compact">
        <thead><tr><th style={{ width: "34%" }}>الصنف / البيان</th><th style={{ width: 90 }}>الكمية</th><th style={{ width: 120 }}>السعر{fc ? ` (${sym})` : ""}</th><th style={{ width: 80 }}>خصم %</th><th style={{ width: 140 }}>الضريبة</th><th className="n">الصافي</th><th className="n">الضريبة</th><th className="n">الإجمالي</th><th /></tr></thead>
        <tbody>{lines.map((l) => { const c = calc(l, incl); return (
          <tr key={l.key}>
            <td>
              {isNote || (kind === "INVOICE" && !isSale && !l.product && l.description) ? null : null}
              <Picker value={l.product} onChange={(p) => pickProduct(l.key, p)} fetcher={productFetcher} label={(p: any) => `${p.name}${p.sku ? " (" + p.sku + ")" : ""}`} placeholder="ابحث عن صنف (أو اكتب بياناً حراً أدناه)" renderItem={(p: any) => <div className="row between"><span>{p.name} <span className="muted small">{p.sku}</span></span><span className="num small">{money(isSale ? p.salePrice : p.purchasePrice)}{p.type === "STOCK" ? ` · متاح ${Number(p.qty)}` : ""}</span></div>} />
              <Input style={{ marginTop: 4 }} placeholder="البيان" value={l.description} onChange={(e) => upd(l.key, { description: e.target.value })} />
              {!isSale && !l.product && <div style={{ marginTop: 4 }}><Picker value={l.account || null} onChange={(a) => upd(l.key, { account: a })} fetcher={accountFetcher((a) => a.type === "EXPENSE" || a.type === "ASSET")} label={(a: any) => `${a.code} ${a.nameAr}`} placeholder="حساب المصروف/الأصل (للبنود غير المخزنية)" /></div>}
            </td>
            <td><NumInput value={l.qty} min={0} onChange={(e) => { const qty = Number(e.target.value); const lp = l.product && !l.uom && priceList?.kind === "FIXED" ? listPrice(l.product, qty) : null; upd(l.key, { qty, ...(lp !== null && lp !== undefined ? { unitPrice: fc ? Math.round((lp / rate) * 10000) / 10000 : lp } : {}) }); }} />
              {l.product && (l.product.uoms?.length > 0 || l.uom) && <Select style={{ marginTop: 4 }} value={l.uom?.id || ""} onChange={(e) => { const u = (l.product.uoms || []).find((x: any) => x.id === e.target.value) || null; if (!u && e.target.value) return; pickProduct(l.key, l.product, u); }}><option value="">{l.product.unit || "وحدة"}</option>{(l.product.uoms || []).map((u: any) => <option key={u.id} value={u.id}>{u.name} ({Number(u.factor)})</option>)}{l.uom && !(l.product.uoms || []).some((u: any) => u.id === l.uom!.id) && <option value={l.uom.id}>{l.uom.name} ({l.uom.factor})</option>}</Select>}</td>
            <td><NumInput value={l.unitPrice} min={0} onChange={(e) => upd(l.key, { unitPrice: Number(e.target.value) })} /></td>
            <td><NumInput value={l.discountPct} min={0} max={100} onChange={(e) => upd(l.key, { discountPct: Number(e.target.value) })} /></td>
            <td><Select value={l.taxCode} onChange={(e) => upd(l.key, { taxCode: e.target.value })}>{(isSale ? ["S", "Z", "X", "E", "O"] : ["S", "IM", "RC", "Z", "E", "O"]).map((t) => <option key={t} value={t}>{TAX_AR[t]}</option>)}</Select></td>
            <td className="n"><Money v={c.net} /></td><td className="n"><Money v={c.vat} /></td><td className="n"><b><Money v={c.net + c.vat} /></b></td>
            <td><button className="btn ghost sm" onClick={() => setLines((ls) => ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [newLine()])}>✕</button></td>
          </tr>); })}
        </tbody>
      </table></div>
      <div className="row mt"><button className="btn sm" onClick={() => setLines((ls) => [...ls, newLine()])}>＋ سطر</button></div>
      <Field label="ملاحظات"><textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {newPartner && <QuickPartner role={isSale ? "CUSTOMER" : "SUPPLIER"} onClose={(p) => { setNewPartner(false); if (p) setPartner(p); }} />}
    </Modal>
  );
}

export function QuickPartner({ role, onClose }: { role: "CUSTOMER" | "SUPPLIER"; onClose: (p?: any) => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ name: "", phone: "", vatNumber: "", kind: "INDIVIDUAL", city: "" });
  return (
    <Modal narrow title={role === "CUSTOMER" ? "عميل جديد" : "مورد جديد"} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy} onClick={() => run(async () => { const p = await api("/partners", { body: { ...f, isCustomer: role === "CUSTOMER", isSupplier: role === "SUPPLIER" } }); onClose(p); })}>حفظ</button></>}>
      <div className="grid">
        <Field label="الاسم"><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="النوع"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="INDIVIDUAL">فرد</option><option value="COMPANY">منشأة</option></Select></Field>
        <Field label="الجوال"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} dir="ltr" /></Field>
        <Field label="الرقم الضريبي" hint="مطلوب للفاتورة الضريبية القياسية (B2B)"><Input value={f.vatNumber} onChange={(e) => setF({ ...f, vatNumber: e.target.value })} dir="ltr" /></Field>
        <Field label="المدينة"><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

// ─── view / print ──────────────────────────────────────────────────────────
export function DocumentView() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { can } = useCompanyContext();
  const { data: d, loading, reload } = useFetch(id ? `/invoices/${id}` : null);
  const [qr, setQr] = useState("");
  const [layout, setLayout] = useState<"a4" | "thermal">("a4");
  const [cn, setCn] = useState<any>(null);
  const [pay, setPay] = useState(false);
  const [landed, setLanded] = useState(false);
  const [customs, setCustoms] = useState(false);
  const mail = useFetch("/mail/status");
  const { run, busy } = useAction();
  useEffect(() => { if (d?.qr) QRCode.toDataURL(d.qr, { margin: 0, width: 140 }).then(setQr); else setQr(""); }, [d?.qr]);
  if (loading || !d) return <Loading />;
  const isSale = d.direction === "SALE";
  const title = KIND_TITLE[d.direction][d.kind];
  const c = d.company;
  const remaining = Number(d.total) - Number(d.amountPaid);
  const post = () => run(async () => { if (!confirmDlg("ترحيل المستند؟")) return; await postWithCreditCheck(d.id, can("users.write")); reload(); }, "تم الترحيل");
  const convert = (kind: string) => run(async () => { const r = await api(`/invoices/${d.id}/convert`, { body: { kind } }); nav(`/doc/${r.id}`); }, "تم التحويل");
  const del = () => run(async () => { if (!confirmDlg("حذف المسودة؟")) return; await api(`/invoices/${d.id}`, { method: "DELETE" }); nav(-1); }, "تم الحذف");
  const creditNote = () => run(async () => { const draft = await api(`/invoices/${d.id}/credit-note`, { body: {} }); setCn(draft); });
  const resend = () => run(async () => { const r = await api(`/zatca/submit/${d.id}`, { body: {} }); toast(`نتيجة الهيئة: ${ZATCA_AR[r.status] || r.status}`, r.status === "REPORTED" || r.status === "CLEARED" ? "ok" : "err"); reload(); });
  return (
    <div className="grid">
      <div className="row no-print">
        <button className="btn sm" onClick={() => nav(-1)}>← رجوع</button>
        <h2>{title} {d.number}</h2>
        <Badge s={d.status} />{d.kind === "INVOICE" && d.status === "POSTED" && <Badge s={d.paymentStatus} />}{d.zatcaStatus && <Badge s={d.zatcaStatus} map={ZATCA_AR} />}
        <div className="grow" />
        {d.status === "DRAFT" && (d.kind === "QUOTATION" || d.kind === "ORDER") && can(isSale ? "sales.write" : "purchases.write") && <><button className="btn primary sm" onClick={() => convert(d.kind === "QUOTATION" ? "ORDER" : "INVOICE")}>تحويل إلى {d.kind === "QUOTATION" ? "أمر" : "فاتورة"} →</button>{d.kind === "QUOTATION" && <button className="btn sm" onClick={() => convert("INVOICE")}>تحويل إلى فاتورة مباشرة</button>}</>}
        {d.status === "DRAFT" && d.kind !== "QUOTATION" && d.kind !== "ORDER" && <button className="btn primary sm" disabled={busy} onClick={post}>ترحيل ✓</button>}
        {d.status === "DRAFT" && <button className="btn danger sm" onClick={del}>حذف</button>}
        {d.status === "POSTED" && d.kind === "INVOICE" && remaining > 0.001 && can("payments.write") && <button className="btn accent sm" onClick={() => setPay(true)}>{isSale ? "تسجيل تحصيل" : "تسجيل سداد"}</button>}
        {d.status === "POSTED" && d.kind === "INVOICE" && can(isSale ? "sales.write" : "purchases.write") && <button className="btn sm" onClick={creditNote}>↩ {isSale ? "إشعار دائن / مرتجع" : "مرتجع مشتريات"}</button>}
        {!isSale && d.status === "POSTED" && d.kind === "INVOICE" && can("purchases.write") && d.lines.some((l: any) => l.productId) && <button className="btn sm" onClick={() => setLanded(true)}>🚢 تكاليف استيراد</button>}
        {!isSale && d.status === "POSTED" && Number(d.customsVat) > 0 && !d.customsPaidJournalId && can("payments.write") && <button className="btn accent sm" onClick={() => setCustoms(true)}>سداد ضريبة الجمارك ({money(d.customsVat)})</button>}
        {isSale && d.status === "POSTED" && ["PENDING", "FAILED", "NOT_ONBOARDED", "REJECTED"].includes(d.zatcaStatus) && <button className="btn sm" onClick={resend}>إرسال للهيئة</button>}
        {isSale && d.xml && <a className="btn sm" href={`/api/zatca/xml/${d.id}?token=${localStorage.getItem("mz_token")}`}>XML</a>}
        <Select value={layout} onChange={(e) => setLayout(e.target.value as any)} style={{ width: 130 }}><option value="a4">A4</option><option value="thermal">حراري 80مم</option></Select>
        <PrintBtn />
        {isSale && (d.status === "POSTED" || d.kind === "QUOTATION" || d.kind === "ORDER") && <ShareBtn d={d} />}
        {isSale && mail.data?.configured && (d.status === "POSTED" || d.kind === "QUOTATION" || d.kind === "ORDER") && can("sales.write") && <button className="btn sm" disabled={busy} onClick={() => run(async () => { const to = prompt("إرسال المستند بالبريد إلى:", d.partner?.email || ""); if (!to) return; await api(`/invoices/${d.id}/email`, { body: { to } }); }, "تم إرسال البريد")}>✉ بريد</button>}
      </div>
      {layout === "thermal" ? <Thermal d={d} qr={qr} /> : <InvoiceA4 d={d} qr={qr} />}
      <div className="grid c2 no-print">
        {d.journal?.length > 0 && <div className="card"><div className="card-h"><h3>القيد المحاسبي</h3></div><div className="table-wrap"><table className="tbl compact"><thead><tr><th>الحساب</th><th className="n">مدين</th><th className="n">دائن</th></tr></thead><tbody>{d.journal.map((l: any, i: number) => <tr key={i}><td>{l.code} {l.nameAr}<div className="small muted">{l.description}</div></td><td className="n"><Money v={l.debit} blankZero /></td><td className="n"><Money v={l.credit} blankZero /></td></tr>)}</tbody></table></div></div>}
        <div className="grid">
          {d.payments?.length > 0 && <div className="card"><div className="card-h"><h3>السدادات المرتبطة</h3></div><div className="table-wrap"><table className="tbl compact"><tbody>{d.payments.map((p: any) => <tr key={p.id}><td>{p.number}</td><td>{fmtDate(p.date)}</td><td>{METHOD_AR[p.method]}</td><td className="n"><Money v={p.allocated} />{p.fcAllocated && <div className="small muted">{money(p.fcAllocated)} {p.currency} @ {Number(p.exchangeRate)}{Number(p.fxDiff) ? ` · فرق صرف ${money(p.fxDiff)}` : ""}</div>}</td></tr>)}</tbody></table></div></div>}
          {d.landedCosts?.length > 0 && <div className="card"><div className="card-h"><h3>تكاليف الاستيراد المحمّلة</h3></div><div className="table-wrap"><table className="tbl compact"><tbody>{d.landedCosts.map((l: any) => <tr key={l.id}><td>{l.number}</td><td>{fmtDate(l.date)}</td><td><Badge s={l.status} /></td><td className="n"><Money v={l.total} /></td></tr>)}</tbody></table></div></div>}
          {d.related?.length > 0 && <div className="card"><div className="card-h"><h3>مستندات مرتبطة</h3></div><div className="table-wrap"><table className="tbl compact"><tbody>{d.related.map((r: any) => <tr key={r.id}><td><Link to={`/doc/${r.id}`}>{r.number}</Link></td><td>{KIND_AR[r.kind]}</td><td><Badge s={r.status} /></td><td className="n"><Money v={r.total} /></td></tr>)}</tbody></table></div></div>}
          {isSale && d.zatcaResponse && <div className="card"><div className="card-h"><h3>استجابة هيئة الزكاة والضريبة</h3></div><div className="card-b small" dir="ltr" style={{ fontFamily: "monospace", whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto" }}>{JSON.stringify(d.zatcaResponse, null, 1)}</div></div>}
        </div>
      </div>
      {cn && <DocEditor direction={d.direction} kind="CREDIT_NOTE" id={cn.id} originId={d.id} onClose={(s) => { setCn(null); if (s) reload(); }} />}
      {pay && <QuickPayment doc={d} onClose={(s) => { setPay(false); if (s) reload(); }} />}
      {landed && <LandedCostModal doc={d} onClose={(s) => { setLanded(false); if (s) reload(); }} />}
      {customs && <PayCustomsModal doc={d} onClose={(s) => { setCustoms(false); if (s) reload(); }} />}
    </div>
  );
}

function PayCustomsModal({ doc, onClose }: { doc: any; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [account, setAccount] = useState<any>(null);
  const [date, setDate] = useState(today());
  return (
    <Modal narrow title="سداد ضريبة الاستيراد للجمارك" onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !account} onClick={() => run(async () => { await api(`/invoices/${doc.id}/pay-customs`, { body: { accountId: account.id, date } }); onClose(true); }, "تم قيد سداد ضريبة الجمارك")}>تأكيد</button></>}>
      <div className="grid"><div className="stat-list"><div className="item"><span>ضريبة القيمة المضافة على الاستيراد (البند 8 في الإقرار)</span><b><Money v={doc.customsVat} /></b></div></div><Field label="من حساب"><Picker value={account} onChange={setAccount} fetcher={accountFetcher((a) => a.isCashBank)} label={(a: any) => `${a.code} ${a.nameAr}`} /></Field><Field label="التاريخ"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field></div>
    </Modal>
  );
}

function LandedCostModal({ doc, onClose }: { doc: any; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [costs, setCosts] = useState<any[]>([{ key: 1, description: "شحن", amount: "", account: null }, { key: 2, description: "جمارك وتخليص", amount: "", account: null }]);
  const [method, setMethod] = useState("VALUE");
  const [date, setDate] = useState(today());
  const [preview, setPreview] = useState<any>(null);
  const body = () => ({ invoiceId: doc.id, date, method, costs: costs.filter((c) => Number(c.amount) > 0).map((c) => ({ description: c.description, amount: Number(c.amount), accountId: c.account?.id || null })) });
  const upd = (k: number, patch: any) => { setCosts((cs) => cs.map((c) => (c.key === k ? { ...c, ...patch } : c))); setPreview(null); };
  return (
    <Modal wide title={`تحميل تكاليف استيراد على ${doc.number}`} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn" disabled={busy} onClick={() => run(async () => setPreview(await api("/landed-costs/preview", { body: body() })))}>معاينة التوزيع</button><button className="btn primary" disabled={busy || !preview} onClick={() => run(async () => { const r = await api("/landed-costs", { body: body() }); await api(`/landed-costs/${r.id}/post`, { body: {} }); onClose(true); }, "تم تحميل التكاليف على المخزون وترحيل القيد")}>ترحيل</button></>}>
      <div className="alert info">سجّل فواتير الشحن والجمارك أولاً كمصروف على حساب «مصروفات شحن وجمارك وتخليص (تُحمَّل على المخزون)»، ثم حمّلها هنا على أصناف الفاتورة فترتفع تكلفة الوحدة. الكميات المباعة قبل التحميل تُحمَّل على تكلفة المبيعات مباشرة.</div>
      <div className="form-grid"><Field label="التاريخ"><Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setPreview(null); }} /></Field><Field label="أساس التوزيع"><Select value={method} onChange={(e) => { setMethod(e.target.value); setPreview(null); }}><option value="VALUE">حسب قيمة الأسطر</option><option value="QTY">حسب الكمية</option></Select></Field></div>
      <table className="tbl compact mt"><thead><tr><th>البيان</th><th style={{ width: 160 }}>المبلغ (ر.س)</th><th>الحساب الدائن (افتراضي: حساب التحميل)</th><th /></tr></thead>
        <tbody>{costs.map((c) => <tr key={c.key}><td><Input value={c.description} onChange={(e) => upd(c.key, { description: e.target.value })} /></td><td><NumInput value={c.amount} onChange={(e) => upd(c.key, { amount: e.target.value })} /></td><td><Picker value={c.account} onChange={(a) => upd(c.key, { account: a })} fetcher={accountFetcher((a) => a.type === "EXPENSE" || a.isCashBank || a.type === "LIABILITY")} label={(a: any) => `${a.code} ${a.nameAr}`} placeholder="5104 مصروفات شحن وجمارك (افتراضي)" /></td><td><button className="btn ghost sm" onClick={() => setCosts((cs) => cs.filter((x) => x.key !== c.key))}>✕</button></td></tr>)}</tbody></table>
      <button className="btn sm mt" onClick={() => setCosts((cs) => [...cs, { key: Date.now(), description: "", amount: "", account: null }])}>＋ سطر</button>
      {preview && <div className="mt"><div className="row between"><h3>التوزيع</h3><span>إجمالي {money(preview.total)} — للمخزون <b>{money(preview.toInventory)}</b> · لتكلفة المبيعات <b>{money(preview.toCogs)}</b></span></div>
        <table className="tbl compact mt"><thead><tr><th>الصنف</th><th className="n">الكمية المشتراة</th><th className="n">المتبقي بالمخزون</th><th className="n">النصيب</th><th className="n">للمخزون</th><th className="n">لتكلفة المبيعات</th><th className="n">تكلفة الوحدة بعد التحميل</th></tr></thead>
          <tbody>{preview.allocation.map((a: any) => <tr key={a.lineId}><td>{a.description}</td><td className="n">{a.qty}</td><td className="n">{a.onHand}</td><td className="n"><Money v={a.share} /></td><td className="n"><Money v={a.toInventory} /></td><td className="n"><Money v={a.toCogs} blankZero /></td><td className="n">{a.newUnitCost !== null ? money(a.newUnitCost) : "—"}</td></tr>)}</tbody></table></div>}
    </Modal>
  );
}

function QuickPayment({ doc, onClose }: { doc: any; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const isSale = doc.direction === "SALE";
  const remaining = Math.round((Number(doc.total) - Number(doc.amountPaid)) * 100) / 100;
  const [amount, setAmount] = useState(remaining);
  const [account, setAccount] = useState<any>(null);
  const [date, setDate] = useState(today());
  const [ref, setRef] = useState("");
  return (
    <Modal narrow title={isSale ? "تسجيل تحصيل" : "تسجيل سداد"} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !account} onClick={() => run(async () => { await api("/payments", { body: { direction: isSale ? "IN" : "OUT", partnerId: doc.partnerId, date, amount, accountId: account.id, reference: ref, allocations: [{ invoiceId: doc.id, amount: Math.min(amount, remaining) }] } }); onClose(true); }, "تم تسجيل السند")}>حفظ</button></>}>
      <div className="grid">
        <Field label="المبلغ"><NumInput value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
        <Field label="الصندوق / البنك"><Picker value={account} onChange={setAccount} fetcher={accountFetcher((a) => a.isCashBank)} label={(a: any) => `${a.code} ${a.nameAr}`} /></Field>
        <Field label="التاريخ"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="مرجع"><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="رقم الحوالة / الشيك" /></Field>
      </div>
    </Modal>
  );
}

export function InvoiceA4({ d, qr, publicView }: { d: any; qr: string; publicView?: boolean }) {
  const isSale = d.direction === "SALE";
  const title = KIND_TITLE[d.direction][d.kind];
  const c = d.company;
  const remaining = Number(d.total) - Number(d.amountPaid);
  const docTitle = isSale ? (d.kind === "INVOICE" ? (d.invoiceType === "SIMPLIFIED" ? "فاتورة ضريبية مبسطة" : "فاتورة ضريبية") : title) : title;
  const showVat = d.lines.some((l: any) => Number(l.vatAmount) > 0);
  const fc = d.currency && d.currency !== "SAR";
  const fx = (v: any) => money(Number(v) / Number(d.exchangeRate || 1));
  return (
        <div className="card print-doc">
          <div className="head">
            <div>
              {c.logo && <img src={c.logo} style={{ height: 60, marginBottom: 6 }} alt="" />}
              <h2>{c.nameAr}</h2>{c.nameEn && <div className="muted">{c.nameEn}</div>}
              <div className="small">{[c.buildingNo, c.street, c.district, c.city, c.postalCode].filter(Boolean).join("، ")}</div>
              <div className="small">{c.vatNumber && <>الرقم الضريبي: <span className="num">{c.vatNumber}</span></>}{c.crNumber && <> · س.ت: <span className="num">{c.crNumber}</span></>}</div>
              <div className="small">{c.phone && <>هاتف: <span className="num">{c.phone}</span></>}{c.email && <> · {c.email}</>}</div>
            </div>
            <div style={{ textAlign: "start" }}>
              <h2 style={{ color: "var(--primary)" }}>{docTitle}</h2>
              <table style={{ border: "none", marginTop: 6 }}><tbody>
                <tr><td style={{ border: "none" }} className="muted">الرقم</td><td style={{ border: "none" }}><b className="num">{d.number}</b></td></tr>
                <tr><td style={{ border: "none" }} className="muted">التاريخ</td><td style={{ border: "none" }} className="num">{fmtDate(d.date)} {new Date(d.issuedAt).toTimeString().slice(0, 5)}</td></tr>
                {d.dueDate && d.kind === "INVOICE" && <tr><td style={{ border: "none" }} className="muted">الاستحقاق</td><td style={{ border: "none" }} className="num">{fmtDate(d.dueDate)}</td></tr>}
                {d.origin && <tr><td style={{ border: "none" }} className="muted">مرجع الفاتورة</td><td style={{ border: "none" }} className="num">{d.origin.number}</td></tr>}
                {d.supplierRef && <tr><td style={{ border: "none" }} className="muted">فاتورة المورد</td><td style={{ border: "none" }} className="num">{d.supplierRef}</td></tr>}
                {fc && <tr><td style={{ border: "none" }} className="muted">العملة</td><td style={{ border: "none" }} className="num">{d.currency} — سعر الصرف {Number(d.exchangeRate)}</td></tr>}
              </tbody></table>
            </div>
            {qr && <img src={qr} alt="QR" style={{ width: 120, height: 120 }} />}
          </div>
          <div className="grid c2 mb">
            <div><div className="muted small">{isSale ? "العميل" : "المورد"}</div><b>{d.partnerName}</b>{d.partner && <div className="small">{[d.partner.buildingNo, d.partner.street, d.partner.district, d.partner.city].filter(Boolean).join("، ")}{d.partner.vatNumber && <> · الرقم الضريبي: <span className="num">{d.partner.vatNumber}</span></>}{d.partner.phone && <> · <span className="num">{d.partner.phone}</span></>}</div>}</div>
            {d.reason && <div><div className="muted small">سبب الإشعار</div>{d.reason}</div>}
          </div>
          <table><thead><tr><th>#</th><th>البيان</th><th>الكمية</th><th>سعر الوحدة</th>{d.lines.some((l: any) => Number(l.discountPct)) && <th>خصم</th>}<th>المبلغ قبل الضريبة</th>{showVat && <><th>الضريبة</th><th>الإجمالي</th></>}</tr></thead>
            <tbody>{d.lines.map((l: any, i: number) => <tr key={l.id}><td className="num">{i + 1}</td><td>{l.description}{l.sku && <span className="muted small num" style={{ marginInlineStart: 4 }}>{l.sku}</span>}</td><td className="num">{Number(l.qty)} {l.uom || l.unit || ""}{l.uom && Number(l.factor) > 1 ? <span className="small muted"> (= {Number(l.qty) * Number(l.factor)} {l.unit})</span> : null}</td><td className="num">{fc ? <>{money(l.fcUnitPrice ?? Number(l.unitPrice) / Number(d.exchangeRate))} {d.currency}<div className="small muted">{money(l.unitPrice)} ر.س</div></> : money(l.unitPrice)}</td>{d.lines.some((x: any) => Number(x.discountPct)) && <td className="num">{Number(l.discountPct) ? l.discountPct + "%" : ""}</td>}<td className="num">{money(l.netAmount)}</td>{showVat && <><td className="num">{money(l.vatAmount)} ({Number(l.taxRate)}%)</td><td className="num">{money(l.total)}</td></>}</tr>)}</tbody>
          </table>
          <div className="row mt" style={{ alignItems: "flex-start", justifyContent: "space-between" }}>
            <div className="small muted" style={{ maxWidth: 380 }}>{d.notes && <div>ملاحظات: {d.notes}</div>}{c.invoiceTerms && <div>{c.invoiceTerms}</div>}{d.tenders?.length > 0 && <div>طريقة الدفع: {d.tenders.map((t: any) => `${METHOD_AR[t.method] || t.method} ${money(t.amount)}`).join(" + ")}</div>}</div>
            <table style={{ width: 300 }}><tbody>
              <tr><td>الإجمالي قبل الخصم</td><td className="num">{money(d.subtotal)}</td></tr>
              {Number(d.discountTotal) > 0 && <tr><td>الخصم</td><td className="num">{money(d.discountTotal)}</td></tr>}
              <tr><td>الإجمالي الخاضع للضريبة</td><td className="num">{money(d.taxable)}</td></tr>
              <tr><td>ضريبة القيمة المضافة 15%</td><td className="num">{money(d.vatTotal)}</td></tr>
              {Number(d.customsVat) > 0 && <tr><td className="small">منها ضريبة استيراد تُسدد للجمارك (لا تُدفع للمورد)</td><td className="num">−{money(d.customsVat)}</td></tr>}
              <tr style={{ fontWeight: 700, fontSize: 15 }}><td>{Number(d.customsVat) > 0 ? "المستحق للمورد" : "الإجمالي شامل الضريبة"}</td><td className="num">{money(d.total)} ر.س</td></tr>
              {fc && <tr style={{ fontWeight: 700 }}><td>الإجمالي بعملة المستند</td><td className="num">{money(d.fcTotal ?? fx(d.total))} {d.currency}</td></tr>}
              <tr><td colSpan={2} className="small" style={{ background: "#f8fafa" }}>{amountToArabicWords(Number(d.total))}</td></tr>
              {d.kind === "INVOICE" && d.status === "POSTED" && Number(d.amountPaid) > 0 && <><tr><td>المسدد</td><td className="num">{money(d.amountPaid)}</td></tr><tr><td>المتبقي</td><td className="num">{money(remaining)}</td></tr></>}
            </tbody></table>
          </div>
          {c.invoiceFooter && <div className="small muted mt" style={{ textAlign: "center", borderTop: "1px solid #ddd", paddingTop: 8 }}>{c.invoiceFooter}</div>}
        </div>
  );
}

export function Thermal({ d, qr }: { d: any; qr: string }) {
  const c = d.company;
  return (
    <div className="thermal card">
      <div className="c">{c.logo && <img src={c.logo} style={{ height: 40 }} alt="" />}<div style={{ fontWeight: 700, fontSize: 14 }}>{c.nameAr}</div><div>{c.nameEn}</div><div>{[c.street, c.city].filter(Boolean).join("، ")}</div>{c.phone && <div className="num">{c.phone}</div>}{c.vatNumber && <div>الرقم الضريبي: <span className="num">{c.vatNumber}</span></div>}</div>
      <div className="c" style={{ margin: "6px 0", fontWeight: 700 }}>{d.invoiceType === "SIMPLIFIED" ? "فاتورة ضريبية مبسطة" : "فاتورة ضريبية"}{d.kind === "CREDIT_NOTE" ? " — إشعار دائن" : ""}</div>
      <div>رقم: <span className="num">{d.number}</span></div>
      <div>التاريخ: <span className="num">{fmtDT(d.issuedAt)}</span></div>
      {d.partnerName && d.partnerName !== "عميل نقدي" && <div>العميل: {d.partnerName}</div>}
      {d.createdBy && <div>الكاشير: {d.createdBy}</div>}
      <table style={{ marginTop: 6 }}><thead><tr><th style={{ textAlign: "start" }}>الصنف</th><th>الكمية</th><th>الإجمالي</th></tr></thead>
        <tbody>{d.lines.map((l: any) => <tr key={l.id}><td>{l.description}{l.uom && <span style={{ fontSize: 10 }}> ({l.uom})</span>}<div style={{ fontSize: 10 }} className="num">{money(l.unitPrice)} × {Number(l.qty)}</div></td><td className="c num">{Number(l.qty)}</td><td className="c num">{money(l.total)}</td></tr>)}</tbody></table>
      <div style={{ marginTop: 6 }}>
        <div className="row between"><span>الإجمالي قبل الضريبة</span><span className="num">{money(d.taxable)}</span></div>
        {Number(d.discountTotal) > 0 && <div className="row between"><span>الخصم</span><span className="num">{money(d.discountTotal)}</span></div>}
        <div className="row between"><span>ضريبة القيمة المضافة 15%</span><span className="num">{money(d.vatTotal)}</span></div>
        <div className="row between" style={{ fontWeight: 700, fontSize: 15, borderTop: "1px solid #000", paddingTop: 3 }}><span>الإجمالي</span><span className="num">{money(d.total)} ر.س</span></div>
        {d.tenders?.map((t: any, i: number) => <div key={i} className="row between"><span>{METHOD_AR[t.method] || t.method}</span><span className="num">{money(t.amount)}</span></div>)}
      </div>
      {qr && <div className="c" style={{ marginTop: 8 }}><img src={qr} style={{ width: 110 }} alt="QR" /></div>}
      {c.invoiceFooter && <div className="c" style={{ marginTop: 6 }}>{c.invoiceFooter}</div>}
      <div className="c" style={{ marginTop: 4, fontSize: 10 }}>شكراً لتسوقكم معنا</div>
    </div>
  );
}


/** posts; on credit-limit rejection lets a manager override after confirmation */
export async function postWithCreditCheck(id: string, canOverride: boolean) {
  try {
    await api(`/invoices/${id}/post`, { body: {} });
  } catch (e: any) {
    if (e.code === "CREDIT_LIMIT" && canOverride && confirmDlg(e.message + "\n\nالترحيل مع تجاوز حد الائتمان؟ (يُسجل في سجل التدقيق)")) {
      await api(`/invoices/${id}/post`, { body: { overrideCreditLimit: true } });
      return;
    }
    throw e;
  }
}

function ShareBtn({ d }: { d: any }) {
  const toast = useToast();
  const url = `${location.origin}/p/${d.shareToken}`;
  const text = encodeURIComponent(`${d.company?.nameAr || ""} — ${KIND_TITLE[d.direction][d.kind]} ${d.number} بمبلغ ${money(d.total)} ر.س\n${url}`);
  return (
    <div className="row" style={{ gap: 4 }}>
      <button className="btn sm" onClick={async () => { try { await navigator.clipboard.writeText(url); toast("تم نسخ رابط الفاتورة", "ok"); } catch { prompt("انسخ الرابط", url); } }}>🔗 رابط</button>
      <a className="btn sm" target="_blank" rel="noreferrer" href={`https://wa.me/${(d.partner?.phone || "").replace(/\D/g, "").replace(/^0/, "966")}?text=${text}`}>واتساب</a>
    </div>
  );
}

/** read-only page for customers (no login) */
export function PublicInvoice() {
  const { token } = useParams();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  const [qr, setQr] = useState("");
  useEffect(() => { api(`/public/invoice/${token}`).then(setD).catch((e) => setErr(e.message)); }, [token]);
  useEffect(() => { if (d?.qr) QRCode.toDataURL(d.qr, { margin: 0, width: 140 }).then(setQr); }, [d?.qr]);
  if (err) return <div className="empty" style={{ paddingTop: 80 }}>{err}</div>;
  if (!d) return <Loading />;
  return (
    <div style={{ padding: 16, maxWidth: 860, margin: "0 auto" }}>
      <div className="row between no-print mb"><div className="row"><img src="/favicon.svg" width={28} alt="" /><b>ميزان ERP</b></div><PrintBtn /></div>
      <InvoiceA4 d={d} qr={qr} publicView />
      <div className="small muted no-print mt" style={{ textAlign: "center" }}>صادر عبر نظام ميزان — mizan-erp</div>
    </div>
  );
}
