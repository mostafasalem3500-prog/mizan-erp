import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import { api, q, useFetch, money, Money, Loading, Modal, Field, Input, NumInput, Select, Picker, partnerFetcher, useAction, useToast, useCompanyContext, useLocalState, fmtDT, METHOD_AR, Badge, confirmDlg } from "../lib";
import { Thermal, QuickPartner } from "./Documents";

type CartLine = { product: any; qty: number; unitPrice: number; discountPct: number };
const EMOJI: Record<string, string> = { "مواد غذائية": "🍚", "مشروبات": "🥤", "منظفات": "🧴", "قرطاسية": "📎", "إلكترونيات": "🔌", "خدمات": "🛠" };

export function PosPage() {
  const nav = useNavigate();
  const toast = useToast();
  const { me, can } = useCompanyContext();
  const { run, busy } = useAction();
  const sess = useFetch("/pos/session");
  const cats = useFetch("/categories");
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("all");
  const [cart, setCart] = useLocalState<CartLine[]>("mz_pos_cart", []);
  const [held, setHeld] = useLocalState<{ id: number; at: string; cart: CartLine[]; partner: any }[]>("mz_pos_held", []);
  const [partner, setPartner] = useState<any>(null);
  const [ticketDisc, setTicketDisc] = useState(0);
  const [payOpen, setPayOpen] = useState(false);
  const [done, setDone] = useState<any>(null);
  const [openCash, setOpenCash] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [newPartner, setNewPartner] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const products = useFetch(`/products${q({ limit: 1000 })}`);
  const incl = !!me.company.pricesIncludeVat;
  const list = useMemo(() => (products.data || []).filter((p: any) => (cat === "all" || p.categoryId === cat) && (!search || p.name.includes(search) || p.sku?.toLowerCase().includes(search.toLowerCase()) || p.barcode === search)), [products.data, cat, search]);

  const add = (p: any) => setCart((c) => { const i = c.findIndex((l) => l.product.id === p.id); if (i >= 0) { const n = [...c]; n[i] = { ...n[i], qty: n[i].qty + 1 }; return n; } return [...c, { product: p, qty: 1, unitPrice: Number(p.salePrice), discountPct: 0 }]; });
  const setQty = (id: string, qty: number) => setCart((c) => (qty <= 0 ? c.filter((l) => l.product.id !== id) : c.map((l) => (l.product.id === id ? { ...l, qty } : l))));
  const totals = useMemo(() => {
    let net = 0, vat = 0;
    for (const l of cart) {
      const rate = l.product.taxCode === "S" ? 15 : 0;
      const disc = 100 - (100 - l.discountPct) * (100 - ticketDisc) / 100;
      const gross = l.qty * l.unitPrice * (1 - disc / 100);
      let n = gross, v = gross * rate / 100;
      if (incl && rate) { n = gross / 1.15; v = gross - n; }
      net += Math.round(n * 100) / 100; vat += Math.round(v * 100) / 100;
    }
    return { net: Math.round(net * 100) / 100, vat: Math.round(vat * 100) / 100, total: Math.round((net + vat) * 100) / 100, count: cart.reduce((a, l) => a + l.qty, 0) };
  }, [cart, ticketDisc, incl]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "F5") { e.preventDefault(); if (cart.length) setPayOpen(true); }
      if (e.key === "F8") { e.preventDefault(); hold(); }
      if (e.key === "Escape" && !payOpen) { setSearch(""); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const v = search.trim();
    if (!v) return;
    const exact = (products.data || []).find((p: any) => p.barcode === v || p.sku?.toLowerCase() === v.toLowerCase());
    if (exact) { add(exact); setSearch(""); } else if (list.length === 1) { add(list[0]); setSearch(""); } else toast("لم يُعثر على صنف مطابق", "err");
  };
  const hold = () => { if (!cart.length) return; setHeld((h) => [...h, { id: Date.now(), at: new Date().toISOString(), cart, partner }]); setCart([]); setPartner(null); toast("تم تعليق الطلب", "ok"); };
  const resume = (h: any) => { if (cart.length && !confirmDlg("استبدال السلة الحالية؟")) return; setCart(h.cart); setPartner(h.partner); setHeld((x) => x.filter((y) => y.id !== h.id)); };
  const session = sess.data?.session;

  if (sess.loading || products.loading) return <Loading />;
  if (!session) {
    return (
      <div className="auth"><div className="form"><div className="box card"><div className="card-b">
        <div className="row mb"><button className="btn sm" onClick={() => nav("/")}>← الرئيسية</button><h2>فتح وردية نقطة البيع</h2></div>
        <p className="muted">الكاشير: <b>{me.user.fullName}</b> · المنشأة: {me.company.nameAr}</p>
        <Field label="النقدية الافتتاحية في الدرج (ر.س)"><NumInput autoFocus value={openCash} onChange={(e) => setOpenCash(e.target.value)} placeholder="0" /></Field>
        <button className="btn primary lg block mt" disabled={busy} onClick={() => run(async () => { await api("/pos/session/open", { body: { openingCash: Number(openCash || 0) } }); sess.reload(); }, "تم فتح الوردية")}>فتح الوردية وبدء البيع</button>
        <div className="hint mt">لا يمكن البيع بدون وردية مفتوحة. ستُحسب النقدية المتوقعة عند الإغلاق تلقائياً.</div>
      </div></div></div></div>
    );
  }
  return (
    <div className="pos">
      <div className="catalog">
        <div className="cat-head">
          <button className="btn sm" onClick={() => nav("/")}>← النظام</button>
          <div className="search grow" style={{ minWidth: 220 }}><span className="ic">🔍</span><input ref={searchRef} className="input" placeholder="بحث / باركود (F2)" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={onSearchKey} autoFocus /></div>
          <span className="badge teal">وردية {session.number} · {session.orders} طلب</span>
          <button className="btn sm" onClick={() => setReturnOpen(true)}>↩ مرتجع</button>
          {held.length > 0 && <div className="row" style={{ gap: 4 }}>{held.map((h) => <button key={h.id} className="btn sm accent" onClick={() => resume(h)}>▶ معلق ({h.cart.length})</button>)}</div>}
          <button className="btn sm" onClick={() => setCloseOpen(true)}>إغلاق الوردية</button>
        </div>
        <div className="cats">
          <button className={cat === "all" ? "active" : ""} onClick={() => setCat("all")}>الكل</button>
          {(cats.data || []).map((c: any) => <button key={c.id} className={cat === c.id ? "active" : ""} onClick={() => setCat(c.id)} style={cat === c.id && c.color ? { background: c.color, borderColor: c.color } : {}}>{EMOJI[c.name] || "•"} {c.name}</button>)}
        </div>
        <div className="items">
          {list.map((p: any) => {
            const out = p.type === "STOCK" && Number(p.qty) <= 0 && !me.company.allowNegativeStock;
            return (
              <div key={p.id} className={"item" + (out ? " out" : "")} onClick={() => !out && add(p)}>
                <div className="img" style={p.categoryColor ? { background: p.categoryColor + "22", color: p.categoryColor } : {}}>{p.image ? <img src={p.image} alt="" /> : EMOJI[p.category] || "📦"}</div>
                <div className="name">{p.name}</div>
                <div className="row between"><span className="price num">{money(p.salePrice)}</span>{p.type === "STOCK" && <span className="stock num">{Number(p.qty)}</span>}</div>
              </div>);
          })}
          {!list.length && <div className="empty" style={{ gridColumn: "1/-1" }}>لا توجد أصناف — أضف أصنافاً من شاشة الأصناف</div>}
        </div>
      </div>
      <div className="cart">
        <div className="cart-h">
          <div className="grow"><Picker value={partner} onChange={setPartner} fetcher={partnerFetcher("CUSTOMER")} label={(p: any) => p.name} placeholder="عميل نقدي (اختياري: اختر عميلاً)" onCreate={() => setNewPartner(true)} /></div>
          <button className="btn ghost sm" title="تعليق الطلب (F8)" onClick={hold}>⏸</button>
          <button className="btn ghost sm" title="إفراغ السلة" onClick={() => cart.length && confirmDlg("إفراغ السلة؟") && setCart([])}>🗑</button>
        </div>
        <div className="cart-lines">
          {cart.map((l) => (
            <div className="line" key={l.product.id}>
              <div><b>{l.product.name}</b><div className="small muted num">{money(l.unitPrice)} × {l.qty}{l.discountPct ? ` − ${l.discountPct}%` : ""}</div></div>
              <div className="row" style={{ gap: 6 }}>
                <div className="qty"><button onClick={() => setQty(l.product.id, l.qty - 1)}>−</button><input value={l.qty} onChange={(e) => setQty(l.product.id, Number(e.target.value) || 0)} /><button onClick={() => setQty(l.product.id, l.qty + 1)}>＋</button></div>
                <b className="num" style={{ minWidth: 70, textAlign: "end" }}>{money(l.qty * l.unitPrice * (1 - l.discountPct / 100))}</b>
                <button className="btn ghost sm" onClick={() => { const v = prompt("خصم % على هذا السطر", String(l.discountPct)); if (v !== null) setCart((c) => c.map((x) => (x.product.id === l.product.id ? { ...x, discountPct: Math.min(100, Math.max(0, Number(v) || 0)) } : x))); }}>%</button>
              </div>
            </div>))}
          {!cart.length && <div className="empty">اضغط على صنف لإضافته للسلة<br /><span className="small">اختصارات: <span className="kbd">F2</span> بحث · <span className="kbd">F5</span> دفع · <span className="kbd">F8</span> تعليق</span></div>}
        </div>
        <div className="totals">
          <div className="t"><span>الأصناف</span><span className="num">{totals.count}</span></div>
          <div className="t"><span>قبل الضريبة</span><span className="num">{money(totals.net)}</span></div>
          <div className="t"><span>الضريبة 15%</span><span className="num">{money(totals.vat)}</span></div>
          <div className="t"><span>خصم على الفاتورة %</span><input className="input num" style={{ width: 70, minHeight: 28, padding: "2px 6px" }} value={ticketDisc} onChange={(e) => setTicketDisc(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} /></div>
          <div className="t grand"><span>الإجمالي</span><span className="num">{money(totals.total)}</span></div>
        </div>
        <div className="pay"><button className="btn primary lg block" disabled={!cart.length || busy} onClick={() => setPayOpen(true)}>الدفع (F5)</button></div>
      </div>
      {payOpen && <PayModal total={totals.total} partner={partner} onClose={() => setPayOpen(false)} onPay={(tenders) => run(async () => {
        const inv = await api("/pos/sale", { body: { sessionId: session.id, partnerId: partner?.id || null, discountPct: ticketDisc, lines: cart.map((l) => ({ productId: l.product.id, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct })), tenders } });
        setPayOpen(false); setCart([]); setPartner(null); setTicketDisc(0); setDone(inv); sess.reload(); products.reload();
      })} />}
      {done && <ReceiptModal inv={done} onClose={() => { setDone(null); searchRef.current?.focus(); }} />}
      {closeOpen && <CloseModal session={session} onClose={(closed) => { setCloseOpen(false); if (closed) { sess.reload(); } }} />}
      {returnOpen && <ReturnModal session={session} onClose={(r) => { setReturnOpen(false); if (r) { sess.reload(); products.reload(); setDone(r); } }} />}
      {newPartner && <QuickPartner role="CUSTOMER" onClose={(p) => { setNewPartner(false); if (p) setPartner(p); }} />}
    </div>
  );
}

function PayModal({ total, partner, onClose, onPay }: { total: number; partner: any; onClose: () => void; onPay: (t: any[]) => void }) {
  const [method, setMethod] = useState<"CASH" | "CARD" | "MIXED" | "CREDIT">("CASH");
  const [cash, setCash] = useState<string>("");
  const [card, setCard] = useState<string>("");
  const cashN = Number(cash || 0), cardN = Number(card || 0);
  const paid = method === "CASH" ? (cashN || total) : method === "CARD" ? total : method === "MIXED" ? cashN + cardN : total;
  const change = method === "CASH" ? Math.max(0, cashN - total) : method === "MIXED" ? Math.max(0, cashN + cardN - total) : 0;
  const short = method === "MIXED" ? Math.max(0, total - cashN - cardN) : 0;
  const submit = () => {
    if (method === "CASH") onPay([{ method: "CASH", amount: cashN >= total ? cashN : total }]);
    else if (method === "CARD") onPay([{ method: "CARD", amount: total }]);
    else if (method === "MIXED") { if (short > 0) return; onPay([{ method: "CASH", amount: cashN }, { method: "CARD", amount: cardN }]); }
    else onPay([{ method: "CREDIT", amount: null }]);
  };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); });
  const quick = [total, Math.ceil(total / 10) * 10, Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <Modal narrow title={<>الدفع — <span className="num">{money(total)}</span> ر.س</>} onClose={onClose} footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary lg" disabled={method === "MIXED" && short > 0 || (method === "CREDIT" && !partner)} onClick={submit}>تأكيد الدفع (Enter)</button></>}>
      <div className="pay">
        <div className="methods">
          {(["CASH", "CARD", "MIXED", "CREDIT"] as const).map((m) => <button key={m} className={method === m ? "active" : ""} onClick={() => setMethod(m)}>{m === "MIXED" ? "مختلط" : METHOD_AR[m]}</button>)}
        </div>
        {(method === "CASH" || method === "MIXED") && <Field label="المبلغ النقدي المستلم"><NumInput autoFocus value={cash} onChange={(e) => setCash(e.target.value)} placeholder={money(total)} style={{ fontSize: 22, textAlign: "center" }} /></Field>}
        {method === "CASH" && <div className="row" style={{ gap: 6 }}>{quick.map((v) => <button key={v} className="btn sm" onClick={() => setCash(String(v))}>{money(v)}</button>)}</div>}
        {method === "MIXED" && <Field label="مبلغ الشبكة / البطاقة"><NumInput value={card} onChange={(e) => setCard(e.target.value)} style={{ fontSize: 22, textAlign: "center" }} /></Field>}
        {method === "CARD" && <div className="alert info">سيُسجل المبلغ كاملاً على حساب تسوية مدى/البطاقات.</div>}
        {method === "CREDIT" && (partner ? <div className="alert warn">سيُسجل المبلغ على حساب العميل <b>{partner.name}</b> (آجل) ويُسدد لاحقاً بسند قبض.</div> : <div className="alert err">البيع الآجل يتطلب اختيار عميل مسجل أولاً.</div>)}
        {change > 0 && <div className="alert ok" style={{ fontSize: 18, textAlign: "center" }}>الباقي للعميل: <b className="num">{money(change)}</b></div>}
        {short > 0 && <div className="alert err">المتبقي غير المدفوع: <b className="num">{money(short)}</b></div>}
      </div>
    </Modal>
  );
}

function ReceiptModal({ inv, onClose }: { inv: any; onClose: () => void }) {
  const [qr, setQr] = useState("");
  const { me } = useCompanyContext();
  const [full, setFull] = useState<any>(null);
  useEffect(() => { api(`/invoices/${inv.id}`).then(setFull); if (inv.qr) QRCode.toDataURL(inv.qr, { margin: 0, width: 120 }).then(setQr); }, [inv.id]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); });
  return (
    <Modal narrow title={<>{inv.kind === "CREDIT_NOTE" ? "مرتجع" : "فاتورة"} {inv.number} ✓ {inv.cashChange > 0 && <span className="badge green">الباقي {money(inv.cashChange)}</span>}</>} onClose={onClose} footer={<><button className="btn" onClick={() => window.print()}>🖨 طباعة (حراري)</button><button className="btn primary" onClick={onClose}>بيع جديد (Enter)</button></>}>
      {full ? <Thermal d={full} qr={qr} /> : <Loading />}
    </Modal>
  );
}

function CloseModal({ session, onClose }: { session: any; onClose: (closed?: boolean) => void }) {
  const { run, busy } = useAction();
  const [counted, setCounted] = useState("");
  const [result, setResult] = useState<any>(null);
  const [report, setReport] = useState<any>(null);
  const expected = Number(session.openingCash) + Number(session.cashSales);
  useEffect(() => { api(`/pos/session/${session.id}/report`).then(setReport); }, []);
  if (result) return (
    <Modal narrow title="تقرير إغلاق الوردية" onClose={() => onClose(true)} footer={<><button className="btn" onClick={() => window.print()}>🖨 طباعة</button><button className="btn primary" onClick={() => onClose(true)}>إغلاق</button></>}>
      <div className="thermal card">
        <div className="c" style={{ fontWeight: 700 }}>تقرير وردية {result.number}</div>
        <div>الكاشير: {result.userName}</div><div>فتح: <span className="num">{fmtDT(result.openedAt)}</span></div><div>إغلاق: <span className="num">{fmtDT(result.closedAt)}</span></div>
        <table style={{ marginTop: 6 }}><tbody>
          <tr><td>عدد الطلبات</td><td className="c num">{result.ordersCount}</td></tr>
          <tr><td>نقدية افتتاحية</td><td className="c num">{money(result.openingCash)}</td></tr>
          <tr><td>مبيعات نقدية (صافي)</td><td className="c num">{money(result.cashSales)}</td></tr>
          <tr><td>مبيعات شبكة/بطاقة</td><td className="c num">{money(result.cardSales)}</td></tr>
          <tr><td>مرتجعات</td><td className="c num">{money(result.returnsTotal)}</td></tr>
          <tr><td>النقدية المتوقعة</td><td className="c num">{money(result.expectedCash)}</td></tr>
          <tr><td>النقدية المعدودة</td><td className="c num">{money(result.countedCash)}</td></tr>
          <tr style={{ fontWeight: 700 }}><td>الفرق (زيادة/عجز)</td><td className={"c num " + (Number(result.difference) < 0 ? "neg-val" : "pos-val")}>{money(result.difference)}</td></tr>
        </tbody></table>
        {report && <table style={{ marginTop: 6 }}><thead><tr><th style={{ textAlign: "start" }}>الصنف</th><th>الكمية</th><th>الإجمالي</th></tr></thead><tbody>{report.products.map((p: any) => <tr key={p.description}><td>{p.description}</td><td className="c num">{Number(p.qty)}</td><td className="c num">{money(p.total)}</td></tr>)}</tbody></table>}
      </div>
    </Modal>
  );
  return (
    <Modal narrow title={`إغلاق الوردية ${session.number}`} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || counted === ""} onClick={() => run(async () => { const r = await api("/pos/session/close", { body: { sessionId: session.id, countedCash: Number(counted) } }); setResult(r); }, "تم إغلاق الوردية")}>إغلاق الوردية</button></>}>
      <div className="stat-list">
        <div className="item"><span>الطلبات</span><b className="num">{session.orders}</b></div>
        <div className="item"><span>نقدية افتتاحية</span><b className="num">{money(session.openingCash)}</b></div>
        <div className="item"><span>مبيعات نقدية (بعد المرتجعات)</span><b className="num">{money(session.cashSales)}</b></div>
        <div className="item"><span>مبيعات شبكة / بطاقة</span><b className="num">{money(session.cardSales)}</b></div>
        <div className="item"><span>النقدية المتوقعة في الدرج</span><b className="num" style={{ color: "var(--primary)" }}>{money(expected)}</b></div>
      </div>
      <Field label="النقدية المعدودة فعلياً"><NumInput autoFocus value={counted} onChange={(e) => setCounted(e.target.value)} style={{ fontSize: 22, textAlign: "center" }} /></Field>
      {counted !== "" && <div className={"alert " + (Math.abs(Number(counted) - expected) < 0.01 ? "ok" : "warn")}>الفرق: <b className="num">{money(Number(counted) - expected)}</b> — يُرحّل تلقائياً إلى حساب عجز/زيادة الصندوق، وتُورَّد مبيعات الوردية النقدية للصندوق الرئيسي.</div>}
    </Modal>
  );
}

function ReturnModal({ session, onClose }: { session: any; onClose: (r?: any) => void }) {
  const { run, busy } = useAction();
  const toast = useToast();
  const [num, setNum] = useState("");
  const [inv, setInv] = useState<any>(null);
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("إرجاع بضاعة");
  const find = () => run(async () => {
    const r = await api(`/invoices${q({ q: num.trim(), direction: "SALE", kind: "INVOICE", status: "POSTED", limit: 1 })}`);
    if (!r.rows[0]) throw new Error("لم يُعثر على الفاتورة");
    const full = await api(`/invoices/${r.rows[0].id}`);
    setInv(full); setQtys({});
  });
  return (
    <Modal title="مرتجع من فاتورة" onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !inv || !Object.values(qtys).some((v) => v > 0)} onClick={() => run(async () => { const r = await api("/pos/return", { body: { sessionId: session.id, originId: inv.id, reason, lines: Object.entries(qtys).filter(([, v]) => v > 0).map(([productId, qty]) => ({ productId, qty })) } }); toast("تم تسجيل المرتجع وإرجاع المبلغ", "ok"); onClose(r); })}>تنفيذ المرتجع</button></>}>
      <div className="row"><Input autoFocus placeholder="رقم الفاتورة (مثال POS-2026-00012)" value={num} onChange={(e) => setNum(e.target.value)} onKeyDown={(e) => e.key === "Enter" && find()} dir="ltr" /><button className="btn" onClick={find}>بحث</button></div>
      {inv && (
        <div className="mt">
          <div className="row between"><b>{inv.number}</b><span className="muted">{fmtDT(inv.issuedAt)} · {inv.partnerName}</span><Badge s={inv.paymentStatus} /></div>
          <table className="tbl compact mt"><thead><tr><th>الصنف</th><th>المباع</th><th>الكمية المرتجعة</th><th className="n">المبلغ</th></tr></thead>
            <tbody>{inv.lines.filter((l: any) => l.productId).map((l: any) => <tr key={l.id}><td>{l.description}</td><td className="num">{Number(l.qty)}</td><td><NumInput value={qtys[l.productId] || ""} min={0} max={Number(l.qty)} onChange={(e) => setQtys({ ...qtys, [l.productId]: Math.min(Number(l.qty), Number(e.target.value) || 0) })} style={{ width: 90 }} /></td><td className="n"><Money v={(qtys[l.productId] || 0) * Number(l.total) / Number(l.qty)} /></td></tr>)}</tbody></table>
          <Field label="السبب"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="hint">يُرد المبلغ بنفس طريقة الدفع الأصلية (الشبكة أولاً ثم النقد)، ويعود الصنف للمخزون بتكلفته وقت البيع.</div>
        </div>
      )}
    </Modal>
  );
}
