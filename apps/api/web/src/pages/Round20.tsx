/** Round 20 screens: product profile, treasury (cash & bank accounts), journal entry page, inventory count sheet & operations summary. */
import React, { useContext, useMemo, useState } from "react";
import { ChCtx } from "../charity/CharityApp";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, q, useFetch, Money, money, Loading, Empty, Badge, Modal, Field, Input, Select, NumInput, Picker, useAction, useCompanyContext, today, fmtDate, fmtDT, SearchBox, matches, useSorted, Th, exportExcel, PdfBtn, PrintBtn, useBase, confirmDlg, JTYPE_AR, sourceLink, TAX_AR, PeriodFilter, monthStart } from "../lib";
import { ProductEditor, AdjustmentModal, StockCardModal } from "./Master";
import { AccountLedger } from "./Statements";
import { amountToArabicWords } from "../shared/tafqeet";

// ─── product profile ───────────────────────────────────────────────────────
export function ProductProfilePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useCompanyContext();
  const { data, loading, reload } = useFetch(`/products/${id}/profile`);
  const cats = useFetch<any[]>("/categories");
  const whs = useFetch<any[]>("/warehouses");
  const [tab, setTab] = useState("info");
  const [edit, setEdit] = useState<any>(null);
  const [op, setOp] = useState<string | null>(null);
  const { run, busy } = useAction();
  if (loading && !data) return <Loading />;
  if (!data) return <Empty text="الصنف غير موجود" />;
  const p = data.product;
  const stockable = p.type === "STOCK";
  return (
    <div className="grid">
      <div className="card"><div className="card-b">
        <div className="profile-h">
          <div className="row" style={{ alignItems: "flex-start" }}>
            {p.hasImage ? <img src={`/api/media/products/${p.id}?v=${p.imageUpdatedAt || ""}`} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 12, border: "1px solid var(--border)" }} /> : <div className="avatar">📦</div>}
            <div>
              <h2>{p.name} <span className="small muted num">{p.sku}</span> {p.isActive ? <span className="badge green">نشط</span> : <span className="badge red">موقوف</span>} {!stockable && <span className="badge blue">خدمة</span>}</h2>
              <div className="meta"><span>التصنيف: <b>{p.category || "—"}</b></span><span>الوحدة: <b>{p.unit}</b></span>{p.barcode && <span>الباركود <b className="num">{p.barcode}</b></span>}<span>الضريبة: <b>{TAX_AR[p.taxCode] || p.taxCode}</b></span></div>
            </div>
          </div>
          <div className="row no-print"><button className="btn sm" onClick={() => nav(-1)}>← رجوع</button><PdfBtn name={`صنف ${p.sku}`} /></div>
        </div>
        <div className="action-bar mt no-print">
          {can("products.write") && <button className="btn sm primary" onClick={() => api(`/products${q({ q: p.sku, limit: 5 })}`).then((r: any[]) => setEdit(r.find((x) => x.id === p.id) || { ...p }))}>✏ تعديل</button>}
          {stockable && can("inventory.write") && <><button className="btn sm" onClick={() => setOp("TRANSFER")}>⇄ نقل المخزون</button><button className="btn sm" onClick={() => setOp("COUNT")}>＋ إضافة عملية: جرد / تسوية</button><button className="btn sm" onClick={() => setOp("DAMAGE")}>🗑 إتلاف / صرف تالف</button><button className="btn sm" onClick={() => setOp("OPENING")}>رصيد افتتاحي</button></>}
          {can("products.write") && <button className="btn sm ghost" disabled={busy} onClick={() => confirmDlg(`حذف الصنف «${p.name}»؟ إن كانت له حركات سيُوقف بدلاً من حذفه حفاظاً على السجلات.`) && run(async () => { const r = await api(`/products/${p.id}`, { method: "DELETE" }); if (r.deactivated) { alert(r.message); reload(); } else nav("/products"); })}>حذف</button>}
        </div>
      </div></div>

      <div className="mini-kpis">
        <div><span>الرصيد الحالي</span><b className="num">{Number(data.totals.qty)}</b><span>{p.unit}</span></div>
        <div><span>قيمة المخزون</span><b><Money v={data.totals.value} /></b><span>متوسط التكلفة <Money v={data.totals.avgCost} /></span></div>
        <div><span>سعر البيع</span><b><Money v={p.salePrice} /></b><span>سعر الشراء الافتراضي <Money v={p.purchasePrice} /></span></div>
        <div><span>مبيعات هذه السنة</span><b><Money v={data.sales.revenue} /></b><span>{data.sales.qty} {p.unit}</span></div>
        <div><span>ربح المبيعات هذه السنة</span><b className={data.sales.profit < 0 ? "neg-val" : ""}><Money v={data.sales.profit} /></b><span>{data.sales.revenue ? ((data.sales.profit / data.sales.revenue) * 100).toFixed(1) + "%" : ""}</span></div>
        <div><span>حد إعادة الطلب</span><b className={Number(data.totals.qty) <= Number(p.reorderLevel) && Number(p.reorderLevel) > 0 ? "neg-val num" : "num"}>{Number(p.reorderLevel) || "—"}</b></div>
      </div>

      <div className="card"><div className="card-b">
        <div className="tabs-bar"><button className={tab === "info" ? "on" : ""} onClick={() => setTab("info")}>معلومات المنتج</button>{stockable && <button className={tab === "moves" ? "on" : ""} onClick={() => setTab("moves")}>حركة المخزون</button>}</div>
        {tab === "info" ? (
          <div className="grid c2">
            <div className="stat-list">
              <div className="item"><span>الاسم بالإنجليزية</span><b>{p.nameEn || "—"}</b></div>
              <div className="item"><span>النوع</span><b>{stockable ? "صنف مخزني" : "خدمة"}</b></div>
              <div className="item"><span>تتبع الدفعات والصلاحية</span><b>{p.trackLots ? `نعم${p.shelfLifeDays ? ` (${p.shelfLifeDays} يوم)` : ""}` : "لا"}</b></div>
              <div className="item"><span>آخر شراء</span><b>{data.lastBuy ? <Link to={`/doc/${data.lastBuy.id}`}>{data.lastBuy.number} · {fmtDate(data.lastBuy.date)} · {data.lastBuy.supplier} · {money(data.lastBuy.unitPrice)}</Link> : "—"}</b></div>
              <div className="item"><span>آخر بيع</span><b>{fmtDate(data.sales.lastSale) || "—"}</b></div>
              {data.uoms.length > 0 && <div className="item"><span>العبوات</span><b>{data.uoms.map((u: any) => `${u.name} (${Number(u.factor)})`).join("، ")}</b></div>}
            </div>
            <div>
              <h4 className="mb" style={{ marginBottom: 8 }}>الرصيد حسب المستودع</h4>
              {!data.stock.length ? <Empty text="لا يوجد رصيد" /> : <table className="tbl compact"><thead><tr><th>المستودع</th><th className="n">الكمية</th><th className="n">متوسط التكلفة</th><th className="n">القيمة</th></tr></thead>
                <tbody>{data.stock.map((s: any) => <tr key={s.warehouseId}><td>{s.warehouse}</td><td className="n">{Number(s.qty)}</td><td className="n"><Money v={s.avgCost} /></td><td className="n"><Money v={s.value} /></td></tr>)}</tbody>
                <tfoot><tr><td>الإجمالي</td><td className="n">{Number(data.totals.qty)}</td><td /><td className="n"><Money v={data.totals.value} /></td></tr></tfoot></table>}
            </div>
          </div>
        ) : <StockMoves p={p} />}
      </div></div>
      {edit && <ProductEditor p={edit} categories={cats.data || []} onClose={(s) => { setEdit(null); if (s) reload(); }} />}
      {op && whs.data && <AdjustmentModal kind={op} warehouses={whs.data} product={p} onClose={(s) => { setOp(null); if (s) reload(); }} />}
    </div>
  );
}

function StockMoves({ p }: { p: any }) {
  const [from, setFrom] = useState(today().slice(0, 4) + "-01-01");
  const [to, setTo] = useState(today());
  const { data } = useFetch(`/inventory/card/${p.id}${q({ from, to })}`);
  const SRC: Record<string, string> = { SALE: "بيع", SALE_RETURN: "مرتجع بيع", PURCHASE: "شراء", PURCHASE_RETURN: "مرتجع شراء", ADJUSTMENT: "جرد / تسوية / إتلاف", OPENING: "رصيد افتتاحي", TRANSFER: "تحويل", POS: "نقطة بيع", INVOICE: "فاتورة", LANDED: "تكاليف استيراد", PURCHASE_REVISION: "عكس شراء (تعديل فاتورة)", PURCHASE_REV_COST: "فرق سعر تعديل شراء" };
  return <>
    <div className="toolbar"><PeriodFilter from={from} to={to} onChange={(f, t) => { setFrom(f || "2000-01-01"); setTo(t || today()); }} /><div className="grow" />{data && <button className="btn sm" onClick={() => exportExcel(data.rows.map((r: any) => ({ التاريخ: fmtDate(r.date), الحركة: SRC[r.sourceType] || r.sourceType, المرجع: r.reference, المستودع: r.warehouse, الكمية: Number(r.qty), "تكلفة الوحدة": Number(r.unitCost), القيمة: Number(r.value), "الرصيد": Number(r.balanceQty) })), `حركة ${p.sku}`)}>⬇ Excel</button>}</div>
    {!data ? <Loading /> : !data.rows.length ? <Empty text="لا توجد حركات في الفترة" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>التاريخ</th><th>الحركة</th><th>المرجع</th><th>المستودع</th><th className="n">وارد</th><th className="n">صادر</th><th className="n">تكلفة الوحدة</th><th className="n">الرصيد</th></tr></thead>
      <tbody>{data.rows.map((r: any) => <tr key={r.id}><td className="dt">{fmtDate(r.date)}</td><td>{SRC[r.sourceType] || r.sourceType}</td><td className="num">{r.sourceType === "SALE" || r.sourceType === "PURCHASE" || r.sourceType === "INVOICE" ? <Link to={`/sales/invoices?q=${encodeURIComponent(r.reference || "")}`}>{r.reference}</Link> : r.reference}</td><td className="small">{r.warehouse}</td><td className="n pos-val">{Number(r.qty) > 0 ? Number(r.qty) : ""}</td><td className="n neg-val">{Number(r.qty) < 0 ? -Number(r.qty) : ""}</td><td className="n"><Money v={r.unitCost} /></td><td className="n"><b>{Number(r.balanceQty)}</b></td></tr>)}</tbody></table></div>}
  </>;
}

// ─── treasury ──────────────────────────────────────────────────────────────
export function TreasuryPage() {
  const { can } = useCompanyContext();
  const base = useBase();
  const { data, loading, reload } = useFetch("/treasury");
  const [text, setText] = useState("");
  const [showOff, setShowOff] = useState(false);
  const [xfer, setXfer] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const [ledger, setLedger] = useState<any>(null);
  const [tab, setTab] = useState("accounts");
  const { run, busy } = useAction();
  const accs = useMemo(() => (data?.accounts || []).filter((a: any) => (showOff || a.isActive) && matches(a, text, ["code", "nameAr", "bankName", "iban"])), [data, text, showOff]);
  const tr = useMemo(() => (data?.transfers || []).filter((x: any) => matches(x, text, ["number", "fromName", "toName", "reference", "memo"])), [data, text]);
  const s = useSorted(accs);
  const total = (data?.accounts || []).filter((a: any) => a.isActive).reduce((a: number, x: any) => a + Number(x.balance), 0);
  const cash = (data?.accounts || []).filter((a: any) => a.isActive && a.subtype === "CASH").reduce((a: number, x: any) => a + Number(x.balance), 0);
  return (
    <div className="card">
      <div className="card-h"><h3>الحسابات البنكية والخزائن</h3><div className="row">
        <PdfBtn name="الحسابات البنكية والخزائن" />
        {can("accounting.write") && <button className="btn sm" onClick={() => setEdit({ kind: "BANK" })}>＋ حساب بنكي</button>}
        {can("accounting.write") && <button className="btn sm" onClick={() => setEdit({ kind: "CASH" })}>＋ خزينة / صندوق</button>}
        {can("payments.write") && <button className="btn primary" onClick={() => setXfer({})}>⇄ تحويل بين الحسابات</button>}
      </div></div>
      <div className="card-b">
        <div className="mini-kpis mb"><div><span>إجمالي النقدية</span><b><Money v={total} /></b></div><div><span>الخزائن والصناديق</span><b><Money v={cash} /></b></div><div><span>البنوك والمحافظ</span><b><Money v={total - cash} /></b></div><div><span>عدد الحسابات النشطة</span><b className="num">{(data?.accounts || []).filter((a: any) => a.isActive).length}</b></div></div>
        <div className="tabs-bar"><button className={tab === "accounts" ? "on" : ""} onClick={() => setTab("accounts")}>الحسابات</button><button className={tab === "transfers" ? "on" : ""} onClick={() => setTab("transfers")}>التحويلات ({data?.transfers?.length || 0})</button></div>
        <div className="toolbar"><SearchBox value={text} onChange={setText} placeholder="اسم الحساب أو البنك أو الآيبان" />{tab === "accounts" && <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />إظهار المعطّلة</label>}</div>
      </div>
      {loading && !data ? <Loading /> : tab === "accounts" ? (!accs.length ? <Empty /> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><Th k="code" s={s}>الرمز</Th><Th k="nameAr" s={s}>الحساب</Th><th>البنك / الآيبان</th><th className="n">وارد الشهر</th><th className="n">منصرف الشهر</th><Th k="balance" s={s} n>الرصيد</Th><Th k="lastDate" s={s}>آخر حركة</Th><th /></tr></thead>
          <tbody>{s.sorted.map((a: any) => <tr key={a.id} style={!a.isActive ? { opacity: .55 } : undefined}>
            <td className="num">{a.code}</td><td><b>{a.nameAr}</b> <span className="badge gray">{a.subtype === "CASH" ? "خزينة" : "بنك"}</span>{!a.isActive && <span className="badge red" style={{ marginInlineStart: 4 }}>معطّل</span>}</td>
            <td className="small">{a.bankName}{a.iban && <div className="num muted">{a.iban}</div>}</td>
            <td className="n pos-val"><Money v={a.monthIn} /></td><td className="n neg-val"><Money v={a.monthOut} /></td><td className="n"><b><Money v={a.balance} sign /></b></td><td className="dt">{fmtDate(a.lastDate)}</td>
            <td className="row" style={{ gap: 4 }}>
              <button className="btn sm primary" onClick={() => setLedger(a)}>المعاملات</button>
              {can("payments.write") && a.isActive && <button className="btn sm" onClick={() => setXfer({ fromAccountId: a.id })}>تحويل</button>}
              {can("accounting.write") && <button className="btn sm" onClick={() => setEdit(a)}>تعديل</button>}
              {can("accounting.write") && <button className="btn sm ghost" disabled={busy} onClick={() => confirmDlg(a.isActive ? `تعطيل «${a.nameAr}»؟ يُشترط أن يكون رصيده صفراً.` : `إعادة تفعيل «${a.nameAr}»؟`) && run(async () => { await api(`/treasury/accounts/${a.id}`, { method: "PUT", body: { isActive: !a.isActive } }); reload(); }, "تم")}>{a.isActive ? "تعطيل" : "تفعيل"}</button>}
            </td>
          </tr>)}</tbody>
        </table></div>
      )) : (!tr.length ? <Empty text="لا توجد تحويلات" /> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>الرقم</th><th>التاريخ</th><th>من</th><th>إلى</th><th className="n">المبلغ</th><th className="n">الرسوم + الضريبة</th><th>المرجع</th><th>القيد</th><th /></tr></thead>
          <tbody>{tr.map((x: any) => <tr key={x.id} style={x.status !== "POSTED" ? { opacity: .55 } : undefined}><td className="num">{x.number}</td><td className="dt">{fmtDate(x.date)}</td><td>{x.fromName}</td><td>{x.toName}</td><td className="n"><b><Money v={x.amount} /></b></td><td className="n"><Money v={Number(x.fee) + Number(x.feeVat)} blankZero /></td><td className="small">{x.reference}{x.memo && <div className="muted">{x.memo}</div>}</td><td>{x.journalId && <Link to={`${base}/journals/${x.journalId}`}>{x.journalNumber}</Link>}</td>
            <td>{x.status === "POSTED" ? can("accounting.write") && <button className="btn sm ghost" disabled={busy} onClick={() => confirmDlg(`إلغاء التحويل ${x.number} بقيد عكسي؟`) && run(async () => { await api(`/treasury/transfers/${x.id}/cancel`, { body: {} }); reload(); }, "تم الإلغاء")}>إلغاء</button> : <span className="badge red">ملغى</span>}</td></tr>)}</tbody>
        </table></div>
      ))}
      {xfer && data && <TransferModal init={xfer} accounts={data.accounts.filter((a: any) => a.isActive)} onClose={(ok) => { setXfer(null); if (ok) reload(); }} />}
      {edit && <CashAccountModal a={edit} onClose={(ok) => { setEdit(null); if (ok) reload(); }} />}
      {ledger && <AccountLedger account={{ ...ledger, nameAr: ledger.nameAr }} onClose={() => setLedger(null)} />}
    </div>
  );
}

function TransferModal({ init, accounts, onClose }: { init: any; accounts: any[]; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ fromAccountId: init.fromAccountId || accounts[0]?.id || "", toAccountId: accounts.find((a) => a.id !== (init.fromAccountId || accounts[0]?.id))?.id || "", amount: "", fee: "", feeVat: false, date: today(), reference: "", memo: "" });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e?.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e });
  const from = accounts.find((a) => a.id === f.fromAccountId);
  const fee = Number(f.fee || 0), vat = f.feeVat ? Math.round(fee * 15) / 100 : 0;
  return (
    <Modal title="تحويل بين الحسابات" onClose={() => onClose()} footer={<><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api("/treasury/transfers", { body: f }); onClose(true); }, "تم التحويل وترحيل القيد")}>تحويل وترحيل</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <div className="grid c2">
        <Field label="من حساب"><Select value={f.fromAccountId} onChange={set("fromAccountId")}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.nameAr} ({money(a.balance)})</option>)}</Select></Field>
        <Field label="إلى حساب"><Select value={f.toAccountId} onChange={set("toAccountId")}>{accounts.filter((a) => a.id !== f.fromAccountId).map((a) => <option key={a.id} value={a.id}>{a.nameAr}</option>)}</Select></Field>
        <Field label="المبلغ"><NumInput value={f.amount} onChange={set("amount")} /></Field>
        <Field label="التاريخ"><Input type="date" value={f.date} onChange={set("date")} /></Field>
        <Field label="رسوم التحويل البنكية (اختياري)"><NumInput value={f.fee} onChange={set("fee")} /></Field>
        <Field label=" "><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.feeVat} onChange={set("feeVat")} />الرسوم خاضعة لضريبة 15% (مدخلات)</label></Field>
        <Field label="المرجع (رقم الحوالة / الإيداع)"><Input value={f.reference} onChange={set("reference")} dir="ltr" /></Field>
        <Field label="البيان"><Input value={f.memo} onChange={set("memo")} /></Field>
      </div>
      <div className="alert info small mt">القيد: من ح/ {accounts.find((a) => a.id === f.toAccountId)?.nameAr || "…"} {money(f.amount || 0)}{fee ? ` + عمولات ومصروفات بنكية ${money(fee)}` : ""}{vat ? ` + ضريبة مدخلات ${money(vat)}` : ""} — إلى ح/ {from?.nameAr} {money(Number(f.amount || 0) + fee + vat)}. لا يُسمح بتجاوز رصيد الحساب المحوِّل.</div>
    </Modal>
  );
}

function CashAccountModal({ a, onClose }: { a: any; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ nameAr: a.nameAr || "", bankName: a.bankName || "", iban: a.iban || "", bankAccountNo: a.bankAccountNo || "" });
  const isNew = !a.id;
  const bank = isNew ? a.kind === "BANK" : a.subtype !== "CASH";
  return (
    <Modal narrow title={isNew ? (bank ? "حساب بنكي جديد" : "خزينة / صندوق جديد") : `تعديل ${a.nameAr}`} onClose={() => onClose()} footer={<><button className="btn primary" disabled={busy} onClick={() => run(async () => { if (isNew) await api("/treasury/accounts", { body: { ...f, kind: a.kind } }); else await api(`/treasury/accounts/${a.id}`, { method: "PUT", body: f }); onClose(true); }, "تم الحفظ")}>حفظ</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <Field label="اسم الحساب"><Input value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} /></Field>
      {bank && <><Field label="اسم البنك"><Input value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} /></Field><Field label="رقم الآيبان"><Input value={f.iban} onChange={(e) => setF({ ...f, iban: e.target.value })} dir="ltr" placeholder="SA.." /></Field><Field label="رقم الحساب"><Input value={f.bankAccountNo} onChange={(e) => setF({ ...f, bankAccountNo: e.target.value })} dir="ltr" /></Field></>}
      {isNew && <div className="small muted">يُضاف تحت مجموعة «{bank ? "النقدية لدى البنوك" : "النقدية بالصناديق"}» في دليل الحسابات ويظهر في السندات والتحويلات.</div>}
    </Modal>
  );
}

// ─── journal entry page ────────────────────────────────────────────────────
export function JournalView() {
  const { id } = useParams();
  const nav = useNavigate(); const base = useBase();
  const { me } = useCompanyContext();
  const ch = useContext(ChCtx).settings;
  const { data: e, loading } = useFetch(`/journals/${id}`);
  if (loading && !e) return <Loading />;
  if (!e) return <Empty text="القيد غير موجود" />;
  const d = (e.lines || []).reduce((a: number, l: any) => a + Number(l.debit), 0), c = (e.lines || []).reduce((a: number, l: any) => a + Number(l.credit), 0);
  const src = sourceLink({ sourceType: e.sourceType, sourceId: e.sourceId, srcNumber: e.reference });
  return (
    <div className="grid">
      <div className="row no-print"><button className="btn sm" onClick={() => nav(-1)}>← رجوع</button><h2>قيد يومية {e.number}</h2><Badge s={e.status} /><div className="grow" />{src && <Link className="btn sm" to={`${base}${src}`}>المستند المصدر</Link>}{e.reversalOf && <Link className="btn sm" to={`${base}/journals/${e.reversalOf}`}>القيد الأصلي</Link>}{e.reversedBy && <Link className="btn sm" to={`${base}/journals/${e.reversedBy}`}>القيد العكسي</Link>}<PrintBtn pdfName={`قيد ${e.number}`} /></div>
      <div className="card print-doc jv-doc">
        <div className="head">{ch && base === "/charity" ? <div className="row"><img className="ch-print-logo" src={ch.logoUrl} alt="" /><div><h2>{ch.associationName}</h2><div className="small">{ch.licenseNo && `ترخيص رقم ${ch.licenseNo}`}</div></div></div> : <div><h2>{me.company.nameAr}</h2><div className="small">{me.company.vatNumber && `الرقم الضريبي ${me.company.vatNumber}`}</div></div>}<div style={{ textAlign: "left" }}><h2>قيد يومية</h2><div className="num">{e.number}</div><div className="small">{fmtDate(e.date)}</div></div></div>
        <div className="grid c3 mb small">
          <div>النوع: <b>{JTYPE_AR[e.type] || e.type}</b></div><div>المرجع: <b className="num">{e.reference || "—"}</b></div><div>الحالة: <b>{e.status === "POSTED" ? "مرحّل" : e.status}</b>{e.reversedBy ? " (معكوس)" : ""}</div>
          <div style={{ gridColumn: "1 / -1" }}>البيان: <b>{e.memo}</b></div>
        </div>
        <table><thead><tr><th>#</th><th>رمز الحساب</th><th>اسم الحساب</th><th>البيان</th><th>الطرف</th><th>مدين</th><th>دائن</th></tr></thead>
          <tbody>{e.lines.map((l: any, i: number) => <tr key={l.id}><td>{i + 1}</td><td className="num">{l.code}</td><td>{l.nameAr}</td><td className="small">{l.description}</td><td className="small">{l.partnerName}</td><td className="num"><Money v={l.debit} blankZero /></td><td className="num"><Money v={l.credit} blankZero /></td></tr>)}</tbody>
          <tfoot><tr><td colSpan={5}>الإجمالي — {amountToArabicWords(d)}</td><td className="num"><Money v={d} /></td><td className="num"><Money v={c} /></td></tr></tfoot></table>
        <div className="small muted mt">أُنشئ بواسطة {e.createdBy || "—"} · {fmtDT(e.createdAt)}</div>
        <div className="jv-sign"><div>المُعِد / المحاسب</div><div>المراجع</div><div>المعتمد</div></div>
      </div>
    </div>
  );
}

// ─── inventory: count sheet & operations summary ───────────────────────────
export function CountSheetPage() {
  const whs = useFetch<any[]>("/warehouses");
  const cats = useFetch<any[]>("/categories");
  const [wh, setWh] = useState(""); const [cat, setCat] = useState(""); const [nz, setNz] = useState(false); const [showSys, setShowSys] = useState(true);
  const { data } = useFetch(`/reports/count-sheet${q({ warehouseId: wh, categoryId: cat, nonzero: nz ? 1 : "" })}`);
  const [from, setFrom] = useState(monthStart()); const [to, setTo] = useState(today());
  const ops = useFetch(`/reports/inventory-ops${q({ from, to, warehouseId: wh })}`);
  return (
    <div className="grid">
      <div className="card"><div className="card-h"><h3>ورقة الجرد</h3><div className="row no-print" style={{ flexWrap: "wrap" }}>
        <Select value={wh} onChange={(e) => setWh(e.target.value)} style={{ width: 180 }}><option value="">كل المستودعات</option>{(whs.data || []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
        <Select value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 160 }}><option value="">كل التصنيفات</option>{(cats.data || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={nz} onChange={(e) => setNz(e.target.checked)} />ذات الرصيد فقط</label>
        <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={showSys} onChange={(e) => setShowSys(e.target.checked)} />إظهار رصيد النظام (أخفِه للجرد الأعمى)</label>
        <PrintBtn pdfName="ورقة الجرد" />
      </div></div>
        {!data ? <Loading /> : <div className="print-doc" style={{ maxWidth: "none" }}>
          <div className="head"><div><h2>ورقة جرد المخزون</h2><div className="small">المستودع: {data.warehouse} · التاريخ: {data.date}</div></div><div className="small" style={{ textAlign: "left" }}>عدد الأصناف: {data.rows.length}</div></div>
          <div className="table-wrap"><table><thead><tr><th>#</th><th>الرمز</th><th>الباركود</th><th>الصنف</th><th>التصنيف</th><th>الوحدة</th>{showSys && <th>رصيد النظام</th>}<th style={{ width: 110 }}>الكمية الفعلية</th><th style={{ width: 90 }}>الفرق</th><th style={{ width: 140 }}>ملاحظات</th></tr></thead>
            <tbody>{data.rows.map((r: any, i: number) => <tr key={i}><td>{i + 1}</td><td className="num">{r.sku}</td><td className="num small">{r.barcode}</td><td>{r.name}</td><td className="small">{r.category}</td><td>{r.unit}</td>{showSys && <td className="num">{Number(r.systemQty)}</td>}<td /><td /><td /></tr>)}</tbody></table></div>
          <div className="jv-sign"><div>أمين المستودع</div><div>لجنة الجرد</div><div>المحاسب</div></div>
        </div>}
      </div>
      <div className="card"><div className="card-h"><h3>ملخص عمليات المخزون</h3><div className="row no-print"><PeriodFilter from={from} to={to} onChange={(a, b) => { setFrom(a || "2000-01-01"); setTo(b || today()); }} /><PdfBtn name="ملخص عمليات المخزون" /></div></div>
        {!ops.data ? <Loading /> : <div className="card-b">
          <div className="mini-kpis mb"><div><span>قيمة أول المدة</span><b><Money v={ops.data.opening} /></b></div><div><span>الوارد</span><b className="pos-val"><Money v={ops.data.inValue} /></b></div><div><span>الصادر</span><b className="neg-val"><Money v={ops.data.outValue} /></b></div><div><span>قيمة آخر المدة</span><b><Money v={ops.data.closing} /></b></div></div>
          <div className="table-wrap"><table className="tbl compact"><thead><tr><th>نوع العملية</th><th className="n">عدد الحركات</th><th className="n">الأصناف</th><th className="n">الكمية</th><th className="n">القيمة</th></tr></thead>
            <tbody>{ops.data.rows.map((r: any, i: number) => <tr key={i}><td>{r.typeAr}</td><td className="n">{r.moves}</td><td className="n">{r.products}</td><td className="n">{r.qty}</td><td className="n"><Money v={r.value} /></td></tr>)}</tbody></table></div>
        </div>}
      </div>
    </div>
  );
}
