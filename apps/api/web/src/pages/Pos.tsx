import { CUR, CFG } from "../shared/country";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import { api, q, useFetch, money, Money, Loading, Modal, Field, Input, NumInput, Select, Picker, partnerFetcher, useAction, useToast, useCompanyContext, useLocalState, fmtDT, METHOD_AR, Badge, confirmDlg, matches } from "../lib";
import { Thermal, QuickPartner } from "./Documents";
import { RestaurantHome, OrderBar, KitchenTicket, PreBill, MoveModal, SplitModal, NoteModal } from "./Restaurant";
import { ProductImagesModal } from "./ProductImages";
import { applyPromotions, combinePct } from "../shared/promoEngine";
import { ModifierPicker, groupsOf, type Mod } from "./Round338";

// unitPrice includes the chosen add-ons (modsPrice); the server is sent the price before them and the option ids
type CartLine = { product: any; qty: number; unitPrice: number; discountPct: number; note?: string; uom?: { id: string; name: string; factor: number; salePrice?: number | null } | null; mods?: Mod[]; modsPrice?: number };
const lineKey = (l: { product: any; uom?: any; mods?: Mod[] }) => l.product.id + ":" + (l.uom?.id || "") + (l.mods?.length ? ":" + l.mods.map((m) => m.optionId).sort().join("+") : "");
const modsText = (l: CartLine) => (l.mods?.length ? l.mods.map((m) => m.name + (m.price ? ` +${m.price}` : "")).join("، ") : "");
const EMOJI: Record<string, string> = { "مواد غذائية": "🍚", "مشروبات": "🥤", "منظفات": "🧴", "قرطاسية": "📎", "إلكترونيات": "🔌", "خدمات": "🛠" };

export function PosPage() {
  const nav = useNavigate();
  const toast = useToast();
  const { me, can } = useCompanyContext();
  const { run, busy } = useAction();
  const sess = useFetch("/pos/session");
  // zero-stock items the cashier already confirmed selling in this ticket
  const oversellOk = React.useRef<Record<string, boolean>>({});
  const canOversell = me.company?.accounting?.pos?.oversell !== "BLOCK";
  const cats = useFetch("/categories");
  const uiF = useFetch<any>("/pos/ui");
  // category tree: a main category shows its sub categories, and selecting it shows everything below it
  const catList: any[] = ((cats.data as any[]) || []).filter((c: any) => c.isActive !== false);
  const catIds = new Set(catList.map((c: any) => c.id));
  const under = (id: string): Set<string> => { const out = new Set([id]); let grew = true; while (grew) { grew = false; for (const c of catList) if (c.parentId && out.has(c.parentId) && !out.has(c.id)) { out.add(c.id); grew = true; } } return out; };
  const ui = uiF.data?.ui || {}, topIds: string[] = uiF.data?.top || [];
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("all");
  const [cart, setCart] = useLocalState<CartLine[]>("mz_pos_cart", []);
  const [held, setHeld] = useLocalState<{ id: number; at: string; cart: CartLine[]; partner: any }[]>("mz_pos_held", []);
  const [partner, setPartner] = useState<any>(null);
  const [ticketDisc, setTicketDisc] = useState(0);
  // ── restaurant / café: an order that stays open on a table until it is paid ──
  const restF = useFetch<any>("/pos/restaurant");
  const mode: string = restF.data?.settings?.mode || "RETAIL";
  const [order, setOrder] = useLocalState<any>("mz_pos_order", null);
  const [splitting, setSplitting] = useState(false);
  const [ticket, setTicket] = useState<any>(null);
  const [bill, setBill] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [noteFor, setNoteFor] = useState<CartLine | null>(null);
  const [savedSig, setSavedSig] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [done, setDone] = useState<any>(null);
  const [queue, setQueue] = useLocalState<any[]>("mz_pos_queue", []);
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [syncErrors, setSyncErrors] = useState<{ ref: string; msg: string }[]>([]);
  const [openCash, setOpenCash] = useState("");
  const posWh = useFetch<any[]>("/warehouse-options");
  const [posWhId, setPosWhId] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [newPartner, setNewPartner] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const products = useFetch(`/products${q({ limit: 1000, use: "sale" })}`);
  // items sold through a recipe hold no stock themselves: the server says how many can still be made from what was produced
  const availF = useFetch<Record<string, { left: number | null; prep?: string }>>("/pos/availability");
  const avail = availF.data || {};
  useEffect(() => { const h = setInterval(() => { if (navigator.onLine) availF.reload(); }, 60000); return () => clearInterval(h); }, []);
  // offers and loyalty settings are cached so the POS keeps applying them while offline
  const promosF = useFetch<any[]>("/promotions/live");
  const loyF = useFetch<any>("/loyalty/settings");
  const cached = (k: string, v: any) => { if (v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} return v; } try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
  const promos: any[] = cached("mz_pos_promos", promosF.data) || [];
  const modsF = useFetch<any[]>("/modifiers/live");
  const modGroups: any[] = cached("mz_pos_mods", modsF.data) || [];
  const [picking, setPicking] = useState<{ p: any; uom: any } | null>(null);
  const [waiveSvc, setWaiveSvc] = useState(false);
  const loyalty: any = cached("mz_pos_loyalty", loyF.data);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const iv = setInterval(() => setClock(Date.now()), 60000); return () => clearInterval(iv); }, []);
  const incl = !!me.company.pricesIncludeVat;
  // image mode: pick products in the catalog and upload/replace their pictures
  const [imgMode, setImgMode] = useState(false);
  const [imgSel, setImgSel] = useState<Record<string, boolean>>({});
  const [imgMissing, setImgMissing] = useState(false);
  const [imgEdit, setImgEdit] = useState<any[] | null>(null);
  const canImg = can("products.write");
  const catSet = useMemo(() => (cat !== "all" && cat !== "top" ? under(cat) : null), [cat, cats.data]);
  const list = useMemo(() => (cat === "top" ? topIds.map((id) => (products.data || []).find((p: any) => p.id === id)).filter(Boolean) : (products.data || [])).filter((p: any) => (search || imgMode || Number(p.salePrice) > 0) && (cat === "all" || cat === "top" || (catSet ? catSet.has(p.categoryId) : p.categoryId === cat)) && (!search || matches(p, search, ["name", "sku", "barcode"]) || p.barcode === search) && (!imgMode || !imgMissing || !p.image)), [products.data, cat, search, imgMode, imgMissing, topIds.length, catSet]);
  const imgChosen = (products.data || []).filter((p: any) => imgSel[p.id]);

  // customer price list (fixed prices / % discount) — applied when the customer is chosen and on every add
  const [priceList, setPriceList] = useState<any>(null);
  useEffect(() => { if (partner?.priceListId) api(`/price-lists/${partner.priceListId}`).then(setPriceList).catch(() => setPriceList(null)); else setPriceList(null); }, [partner?.priceListId]);
  const priceFor = (p: any, qty = 1, pl = priceList, uom: any = null) => {
    if (uom) return uom.salePrice !== null && uom.salePrice !== undefined ? Number(uom.salePrice) : Math.round(priceFor(p, 1, pl) * Number(uom.factor) * 100) / 100;
    if (!pl) return Number(p.salePrice);
    if (pl.kind === "DISCOUNT") return Math.round(Number(p.salePrice) * (1 - Number(pl.discountPct) / 100) * 100) / 100;
    const items = (pl.items || []).filter((i: any) => i.productId === p.id && Number(i.minQty) <= qty).sort((a: any, b: any) => Number(a.minQty) - Number(b.minQty));
    return items.length ? Number(items[items.length - 1].price) : Number(p.salePrice);
  };
  useEffect(() => { setCart((c) => c.map((l) => ({ ...l, unitPrice: priceFor(l.product, l.qty, priceList, l.uom) + (l.modsPrice || 0) }))); }, [priceList]);
  const addLine = (p: any, uom: any = null, mods: Mod[] = []) => setCart((c) => { const mp = Math.round(mods.reduce((a, m) => a + m.price, 0) * 100) / 100; const k = lineKey({ product: p, uom, mods }); const i = c.findIndex((l) => lineKey(l) === k); if (i >= 0) { const n = [...c]; n[i] = { ...n[i], qty: n[i].qty + 1, unitPrice: priceFor(p, n[i].qty + 1, priceList, uom) + mp }; return n; } return [...c, { product: p, uom, qty: 1, unitPrice: priceFor(p, 1, priceList, uom) + mp, discountPct: 0, mods, modsPrice: mp }]; });
  // a product with add-on groups opens its picker first (size, extras…)
  const add = (p: any, uom: any = null) => (groupsOf(modGroups, p).length ? setPicking({ p, uom }) : addLine(p, uom));
  const setUom = (key: string, uomId: string) => setCart((c) => c.map((l) => { if (lineKey(l) !== key) return l; const u = (l.product.uoms || []).find((x: any) => x.id === uomId) || null; return { ...l, uom: u, unitPrice: priceFor(l.product, l.qty, priceList, u) + (l.modsPrice || 0) }; }));
  const setQty = (key: string, qty: number) => setCart((c) => (qty <= 0 ? c.filter((l) => lineKey(l) !== key) : c.map((l) => (lineKey(l) === key ? { ...l, qty, unitPrice: priceList?.kind === "FIXED" && !l.uom ? priceFor(l.product, qty) + (l.modsPrice || 0) : l.unitPrice } : l))));
  const hits = useMemo(() => applyPromotions(promos, cart.map((l) => ({ productId: l.product.id, categoryId: l.product.categoryId, qty: l.qty, unitPrice: l.unitPrice })), new Date(clock), "POS"), [cart, promos, clock]);
  const hitOf = (l: CartLine) => hits[cart.indexOf(l)] || null;
  const lineDisc = (l: CartLine) => combinePct(l.discountPct, hitOf(l)?.pct || 0, ticketDisc);
  const totals = useMemo(() => {
    let net = 0, vat = 0, promo = 0;
    for (const l of cart) {
      const rate = l.product.taxCode === "S" ? CFG.vatRate : 0;
      const disc = lineDisc(l);
      promo += l.qty * l.unitPrice * ((hitOf(l)?.pct || 0) / 100);
      const gross = l.qty * l.unitPrice * (1 - disc / 100);
      let n = gross, v = gross * rate / 100;
      if (incl && rate) { n = gross / (1 + rate / 100); v = gross - n; }
      net += Math.round(n * 100) / 100; vat += Math.round(v * 100) / 100;
    }
    // service charge of a restaurant order: a % of the net of the goods, taxable (the server adds the same line)
    let service = 0;
    const svc = restF.data?.settings?.serviceCharge;
    if (order && svc && svc.pct > 0 && svc.types.includes(order.type) && (!svc.minGuests || Number(order.guests) >= svc.minGuests) && !waiveSvc && cart.length) {
      service = Math.round(net * svc.pct) / 100; const sv = Math.round(service * CFG.vatRate) / 100; net += service; vat += sv;
    }
    return { net: Math.round(net * 100) / 100, vat: Math.round(vat * 100) / 100, total: Math.round((net + vat) * 100) / 100, count: cart.reduce((a, l) => a + l.qty, 0), promo: Math.round(promo * 100) / 100, service, serviceLabel: svc ? `${svc.label} ${svc.pct}%` : "", serviceOn: !!(order && svc && svc.pct > 0 && svc.types.includes(order.type) && (!svc.minGuests || Number(order.guests) >= svc.minGuests)) };
  }, [cart, ticketDisc, incl, hits, order, waiveSvc, restF.data]);

  // ── offline: queued sales are replayed in order with an idempotent clientRef ──
  const syncQueue = async () => {
    if (syncing || !navigator.onLine) return;
    const pending = (JSON.parse(localStorage.getItem("mz_pos_queue") || "[]") as any[]);
    if (!pending.length) return;
    setSyncing(true);
    const errs: { ref: string; msg: string }[] = [];
    let remaining = [...pending];
    for (const item of pending) {
      try {
        await api("/pos/sale", { body: item.body });
        remaining = remaining.filter((x) => x.body.clientRef !== item.body.clientRef);
        setQueue(remaining);
      } catch (e: any) {
        if (e.code === "OFFLINE" || e.status === 0) break; // still offline — keep everything
        if (e.status === 401) break;
        errs.push({ ref: item.body.clientRef, msg: e.message }); // business error (stock/session): needs the cashier
        remaining = remaining.filter((x) => x.body.clientRef !== item.body.clientRef);
        setQueue(remaining);
      }
    }
    setSyncErrors((prev) => [...prev, ...errs]);
    setSyncing(false);
    if (pending.length !== remaining.length) { sess.reload(); products.reload(); toast(`تمت مزامنة ${pending.length - remaining.length} عملية بيع`, "ok"); }
  };
  useEffect(() => {
    const on = () => { setOnline(true); syncQueue(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    const iv = setInterval(() => { if (navigator.onLine && (JSON.parse(localStorage.getItem("mz_pos_queue") || "[]") as any[]).length) syncQueue(); }, 20000);
    syncQueue();
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); clearInterval(iv); };
  }, []);
  /** builds a local invoice-like object so the receipt can be shown/printed while offline */
  const localReceipt = (body: any, lines: CartLine[], tenders: any[]) => {
    const rows = lines.map((l, i) => { const rate = l.product.taxCode === "S" ? CFG.vatRate : 0; const disc = lineDisc(l); const gross = l.qty * l.unitPrice * (1 - disc / 100); let net = gross, vat = gross * rate / 100; if (incl && rate) { net = gross / 1.15; vat = gross - net; } return { id: String(i), description: l.product.name + (l.uom ? ` — ${l.uom.name}` : "") + (l.mods?.length ? ` (${modsText(l)})` : ""), qty: l.qty, unitPrice: l.unitPrice, netAmount: Math.round(net * 100) / 100, vatAmount: Math.round(vat * 100) / 100, total: Math.round((net + vat) * 100) / 100, taxRate: rate }; });
    const taxable = rows.reduce((a, r) => a + r.netAmount, 0), vatTotal = rows.reduce((a, r) => a + r.vatAmount, 0);
    return { id: body.clientRef, offline: true, number: `OFFLINE-${body.clientRef.slice(0, 8).toUpperCase()}`, kind: "INVOICE", direction: "SALE", invoiceType: "SIMPLIFIED", issuedAt: body.issuedAt, partnerName: partner?.name || "عميل نقدي", createdBy: me.user.fullName, lines: rows, taxable, vatTotal, total: taxable + vatTotal, discountTotal: 0, tenders: tenders.map((t) => ({ ...t, amount: t.amount ?? Math.max(0, taxable + vatTotal - tenders.reduce((x: number, y: any) => x + (y.amount ?? 0), 0)) })), company: { nameAr: me.company.nameAr, nameEn: me.company.nameEn, vatNumber: me.company.vatNumber, phone: me.company.phone, street: me.company.street, city: me.company.city, logo: me.company.logo, invoiceFooter: me.company.invoiceFooter }, cashChange: 0 };
  };

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
    const packOf = (products.data || []).find((p: any) => (p.uoms || []).some((u: any) => u.barcode === v));
    if (packOf) { add(packOf, packOf.uoms.find((u: any) => u.barcode === v)); setSearch(""); } else if (exact) { add(exact); setSearch(""); } else if (list.length === 1) { add(list[0]); setSearch(""); } else toast("لم يُعثر على صنف مطابق", "err");
  };
  const hold = () => { if (!cart.length) return; setHeld((h) => [...h, { id: Date.now(), at: new Date().toISOString(), cart, partner }]); setCart([]); setPartner(null); toast("تم تعليق الطلب", "ok"); };
  const resume = (h: any) => { if (cart.length && !confirmDlg("استبدال السلة الحالية؟")) return; setCart(h.cart); setPartner(h.partner); setHeld((x) => x.filter((y) => y.id !== h.id)); };
  const orderLines = (c: CartLine[]) => c.map((l) => ({ key: lineKey(l), productId: l.product.id, name: l.product.name, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct, uomId: l.uom?.id || null, uomName: l.uom?.name || null, note: l.note || "", mods: (l.mods || []).map((m) => ({ optionId: m.optionId, name: m.name, price: m.price })) }));
  const sigOf = (c: CartLine[]) => JSON.stringify(orderLines(c));
  const cartOf = (o: any): CartLine[] => (o.lines || []).map((l: any) => { const p = (products.data || []).find((x: any) => x.id === l.productId); if (!p) return null; const u = l.uomId ? (p.uoms || []).find((x: any) => x.id === l.uomId) || null : null; const mods: Mod[] = (l.mods || []).map((m: any) => ({ groupId: "", optionId: m.optionId, name: m.name, price: Number(m.price) })); return { product: p, uom: u, qty: Number(l.qty), unitPrice: Number(l.unitPrice), discountPct: Number(l.discountPct) || 0, note: l.note || "", mods, modsPrice: Math.round(mods.reduce((a, m) => a + m.price, 0) * 100) / 100 }; }).filter(Boolean) as CartLine[];
  const openOrder = (o: any) => { const c = cartOf(o); setOrder(o); setCart(c); setSavedSig(sigOf(c)); setPartner(null); setTicketDisc(0); setSplitting(false); };
  const saveOrder = async (c = cart) => { if (!order || splitting) return order; const o = await api(`/pos/orders/${order.id}`, { method: "PUT", body: { lines: orderLines(c), partnerId: partner?.id || null } }); setSavedSig(sigOf(c)); setOrder(o); return o; };
  const leaveOrder = () => run(async () => { if (!splitting) await saveOrder(); setOrder(null); setCart([]); setPartner(null); setSplitting(false); restF.reload(); });
  const sendKitchen = () => run(async () => { const r = await api(`/pos/orders/${order.id}/send`, { body: { lines: orderLines(cart) } }); setOrder(r.order); setSavedSig(sigOf(cart)); if (r.ticket) setTicket(r.ticket); else toast("لا جديد لإرساله للمطبخ", "info"); });
  const endSplit = () => run(async () => { openOrder(await api(`/pos/orders/${order.id}`)); });
  // the open order follows the cart (a moment after the last change), so another device sees the table as it is
  useEffect(() => {
    if (!order || splitting || !products.data || sigOf(cart) === savedSig) return;
    const tm = setTimeout(() => { if (navigator.onLine) saveOrder().catch(() => undefined); }, 900);
    return () => clearTimeout(tm);
  }, [cart, order?.id, splitting, savedSig]);
  // an order kept from the last visit: take its lines from the server, not from the old cart
  useEffect(() => { if (order && products.data && !savedSig) api(`/pos/orders/${order.id}`).then((o) => (o.status === "OPEN" ? openOrder(o) : (setOrder(null), setCart([])))).catch(() => { setOrder(null); setCart([]); }); }, [!!products.data]);
  const dirtyKitchen = !!order && cart.some((l) => { const s = (order.lines || []).find((x: any) => x.key === lineKey(l)); return !s || Number(s.sentQty) !== l.qty; });
  const showHome = mode !== "RETAIL" && !order && !!restF.data;
  const session = sess.data?.session;

  if ((sess.loading && !sess.data) || (products.loading && !products.data)) return <Loading />;
  if (!session) {
    return (
      <div className="auth"><div className="form"><div className="box card"><div className="card-b">
        <div className="row mb"><button className="btn sm" onClick={() => nav("/")}>← الرئيسية</button><h1 style={{ fontSize: 20, margin: 0 }}>فتح وردية نقطة البيع</h1></div>
        <p className="muted">الكاشير: <b>{me.user.fullName}</b> · المنشأة: {me.company.nameAr}</p>
        {(posWh.data?.length || 0) > 1 && <Field label="المستودع / الفرع"><Select value={posWhId} onChange={(e) => setPosWhId(e.target.value)}><option value="">تلقائي{posWh.data![0]?.mine ? " — مستودع فرعي" : ""}</option>{posWh.data!.map((w: any) => <option key={w.id} value={w.id}>{w.name}{w.branchName ? ` — ${w.branchName}` : ""}</option>)}</Select></Field>}
        <Field label={`النقدية الافتتاحية في الدرج (${CUR()})`}><NumInput autoFocus value={openCash} onChange={(e) => setOpenCash(e.target.value)} placeholder="0" /></Field>
        <button className="btn primary lg block mt" disabled={busy} onClick={() => run(async () => { await api("/pos/session/open", { body: { openingCash: Number(openCash || 0), warehouseId: posWhId || undefined } }); sess.reload(); }, "تم فتح الوردية")}>فتح الوردية وبدء البيع</button>
        <div className="hint mt">لا يمكن البيع بدون وردية مفتوحة. ستُحسب النقدية المتوقعة عند الإغلاق تلقائياً.</div>
      </div></div></div></div>
    );
  }
  return (
    <div className={"pos" + (showHome ? " pos-home" : "") + ` tile-${ui.tile || "M"}` + (ui.cats === "SIDE" ? " cats-side" : "") + (ui.images === false ? " no-img" : "")} style={ui.accent ? ({ "--primary": ui.accent, "--primary-2": ui.accent, "--primary-soft": ui.accent + "1f" } as any) : undefined}><h1 className="sr-only">نقطة البيع</h1>
      {showHome && <RestaurantHome data={restF.data} reload={restF.reload} session={session} online={online} busy={busy} onOpen={openOrder} onClose={() => setCloseOpen(true)} onReturn={() => setReturnOpen(true)} />}
      <div className="catalog" hidden={showHome}>
        <div className="cat-head">
          <button className="btn sm" onClick={() => nav("/")}>← النظام</button>
          <div className="search grow" style={{ minWidth: 220 }}><span className="ic">🔍</span><input ref={searchRef} className="input" placeholder="بحث / باركود (F2)" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={onSearchKey} autoFocus /></div>
          <span className="badge teal">وردية {session.number} · {session.orders} طلب</span>
          {!online && <span className="badge red">غير متصل</span>}
          <button className="btn sm" onClick={() => setReturnOpen(true)}>↩ مرتجع</button>
          {canImg && <button className={"btn sm" + (imgMode ? " primary" : "")} title="رفع وتغيير صور الأصناف" onClick={() => { setImgMode((m) => !m); setImgSel({}); }}>🖼 {imgMode ? "إنهاء الصور" : "صور الأصناف"}</button>}
          {held.length > 0 && <div className="row" style={{ gap: 4 }}>{held.map((h) => <button key={h.id} className="btn sm accent" onClick={() => resume(h)}>▶ معلق ({h.cart.length})</button>)}</div>}
          <button className="btn sm" onClick={() => setCloseOpen(true)}>إغلاق الوردية</button>
        </div>
        <div className="cats">
          <button className={cat === "all" ? "active" : ""} onClick={() => setCat("all")}>الكل <span className="cnt">{(products.data || []).filter((p: any) => Number(p.salePrice) > 0).length}</span></button>
          {topIds.length > 0 && ui.topFirst !== false && <button className={"top" + (cat === "top" ? " active" : "")} data-pos-top onClick={() => setCat("top")}>⭐ الأكثر مبيعاً</button>}
          {catList.filter((c: any) => !c.parentId || !catIds.has(c.parentId)).map((c: any) => { const on = cat === c.id || (catSet && under(c.id).has(cat)); const ids = under(c.id); return <button key={c.id} className={on ? "active" : ""} data-pos-cat={c.name} onClick={() => setCat(c.id)} style={on && c.color ? { background: c.color, borderColor: c.color } : c.color ? { borderInlineStart: `4px solid ${c.color}` } : {}}>{c.icon || EMOJI[c.name] || "•"} {c.name} <span className="cnt">{(products.data || []).filter((p: any) => ids.has(p.categoryId) && Number(p.salePrice) > 0).length}</span></button>; })}
        </div>
        {(() => { if (cat === "all" || cat === "top") return null; const sel = catList.find((c: any) => c.id === cat); if (!sel) return null; const parent = catList.some((c: any) => c.parentId === sel.id) ? sel : catList.find((c: any) => c.id === sel.parentId); if (!parent) return null; const kids = catList.filter((c: any) => c.parentId === parent.id); if (!kids.length) return null;
          return <div className="subcats" data-pos-subcats><button className={cat === parent.id ? "active" : ""} onClick={() => setCat(parent.id)}>كل {parent.name}</button>{kids.map((k: any) => <button key={k.id} className={cat === k.id ? "active" : ""} data-pos-subcat={k.name} onClick={() => setCat(k.id)}>{k.icon || ""} {k.name}</button>)}</div>; })()}
        <div className="items">
          {list.map((p: any) => {
            const rc = avail[p.id];
            const out = rc ? rc.left !== null && rc.left <= 0 : p.saleClass === "RECIPE" ? false : p.type === "STOCK" && Number(p.qty) <= 0 && !me.company.allowNegativeStock;
            return (
              <div key={p.id} className={"item" + (out && !imgMode ? " out" : "") + (imgMode ? " sel-mode" + (imgSel[p.id] ? " sel" : "") : "")} data-pos-item={p.sku} title={out && !imgMode ? (rc ? `نفد «${rc.prep}» المنتَج مسبقاً — أدخل طبخة جديدة أو بِع بعد التأكيد` : canOversell ? "الرصيد المسجل صفر — اضغط للبيع بعد التأكيد" : "الرصيد صفر") : undefined} onClick={() => { if (imgMode) return setImgSel((x) => ({ ...x, [p.id]: !x[p.id] })); if (!out) return add(p); if (!canOversell) return toast(`الرصيد المسجل للصنف «${p.name}» صفر، والمنشأة تمنع البيع بلا رصيد`, "err"); if (oversellOk.current[p.id] || confirmDlg(rc ? `نفد «${rc.prep}» المنتَج مسبقاً، فلا يكفي لصنف «${p.name}».\n\nهل هو موجود فعلاً وتريد البيع؟ سيظهر رصيد «${rc.prep}» بالسالب حتى تُسجَّل الطبخة.` : `الرصيد المسجل للصنف «${p.name}» صفر.\n\nهل البضاعة موجودة فعلاً أمامك وتريد بيعها؟ سيُسجَّل التخطي باسمك ويظهر الصنف بالسالب حتى يُسجَّل الوارد.`)) { oversellOk.current[p.id] = true; add(p); } }}>
                {imgMode && <input type="checkbox" className="sel-ck" checked={!!imgSel[p.id]} readOnly />}
                <div className="img" style={p.categoryColor ? { background: p.categoryColor + "22", color: p.categoryColor } : {}}>{p.image ? <img src={p.image} alt="" loading="lazy" /> : EMOJI[p.category] || "📦"}</div>
                {imgMode && <button className="btn sm img-edit" title="صورة هذا الصنف" onClick={(e) => { e.stopPropagation(); setImgEdit([p]); }}>{p.image ? "✎ تغيير" : "＋ صورة"}</button>}
                <div className="name">{p.name}</div>
                <div className="row between"><span className="price num">{money(p.salePrice)}</span>{rc ? (rc.left !== null && <span className={"stock num" + (rc.left <= 0 ? " sold-out" : rc.left <= 10 ? " few" : "")} data-pos-left={rc.left}>{rc.left <= 0 ? "نفد" : `باقي ${rc.left}`}</span>) : p.type === "STOCK" && <span className="stock num">{Number(p.qty)}</span>}</div>
              </div>);
          })}
          {!list.length && <div className="empty" style={{ gridColumn: "1/-1" }}>{imgMode && imgMissing ? "كل الأصناف الظاهرة لها صور ✓" : "لا توجد أصناف — أضف أصنافاً من شاشة الأصناف"}</div>}
        </div>
        {imgMode && (
          <div className="img-bar">
            <b>وضع الصور</b><span className="muted small">اضغط على الأصناف لتحديدها ثم ارفع صورها</span>
            <span className="badge teal">محدد {imgChosen.length}</span>
            <button className="btn sm" onClick={() => setImgSel((x) => { const n = { ...x }; list.forEach((p: any) => { n[p.id] = true; }); return n; })}>تحديد الظاهر ({list.length})</button>
            {imgChosen.length > 0 && <button className="btn sm ghost" onClick={() => setImgSel({})}>إلغاء التحديد</button>}
            <label className="check small"><input type="checkbox" checked={imgMissing} onChange={(e) => setImgMissing(e.target.checked)} /> بدون صورة فقط</label>
            <div className="grow" />
            <button className="btn primary sm" disabled={!imgChosen.length} onClick={() => setImgEdit(imgChosen)}>⬆ رفع صور المحدد ({imgChosen.length})</button>
            <button className="btn sm" onClick={() => { setImgMode(false); setImgSel({}); }}>إنهاء</button>
          </div>
        )}
      </div>
      <div className="cart" hidden={showHome}>
        {order && <OrderBar order={order} dirty={dirtyKitchen} busy={busy} splitting={splitting} onBack={leaveOrder} onSend={sendKitchen} onBill={() => setBill(true)} onMove={() => run(async () => { await saveOrder(); await restF.reload(); setMoveOpen(true); })} onSplit={() => run(async () => { await saveOrder(); setSplitOpen(true); })} onEndSplit={endSplit}
          onCancel={() => { const sent = (order.lines || []).some((l: any) => Number(l.sentQty) > 0); const reason = sent ? prompt("سبب إلغاء الطلب (أُرسلت أصناف للمطبخ)") : confirmDlg("إلغاء الطلب وتفريغ الطاولة؟") ? "" : null; if (reason === null) return; run(async () => { await api(`/pos/orders/${order.id}/cancel`, { body: { reason } }); setOrder(null); setCart([]); setSplitting(false); restF.reload(); }, "أُلغي الطلب"); }} />}
        <div className="cart-h">
          <div className="grow"><Picker value={partner} onChange={setPartner} fetcher={partnerFetcher("CUSTOMER")} label={(p: any) => p.name} placeholder="عميل نقدي (اختياري: اختر عميلاً)" onCreate={() => setNewPartner(true)} />{priceList && <div className="small" style={{ color: "var(--primary)" }}>قائمة الأسعار: {priceList.name}</div>}</div>
          {!order && <button className="btn ghost sm" title="تعليق الطلب (F8)" onClick={hold}>⏸</button>}
          <button className="btn ghost sm" title="إفراغ السلة" onClick={() => cart.length && confirmDlg("إفراغ السلة؟") && setCart([])}>🗑</button>
        </div>
        <div className="cart-lines">
          {cart.map((l) => (
            <div className="line" key={lineKey(l)}>
              <div><b>{l.product.name}</b>{l.uom && <span className="badge blue" style={{ marginInlineStart: 6 }}>{l.uom.name} ×{Number(l.uom.factor)}</span>}<div className="small muted num">{money(l.unitPrice)} × {l.qty}{l.discountPct ? ` − ${l.discountPct}%` : ""}</div>{l.mods?.length ? <div className="line-mods" data-line-mods>＋ {modsText(l)}</div> : null}{hitOf(l) && <span className="promo-tag" title="عرض مطبّق تلقائياً">🎁 {hitOf(l)!.name} −{Math.round(hitOf(l)!.pct * 10) / 10}%</span>}{l.note && <div className="line-note">← {l.note}</div>}
                {l.product.uoms?.length > 0 && <select className="input" style={{ padding: "2px 6px", fontSize: 12, width: "auto", marginTop: 2 }} value={l.uom?.id || ""} onChange={(e) => setUom(lineKey(l), e.target.value)}><option value="">{l.product.unit || "حبة"}</option>{l.product.uoms.map((u: any) => <option key={u.id} value={u.id}>{u.name} ({Number(u.factor)})</option>)}</select>}</div>
              <div className="row" style={{ gap: 6 }}>
                <div className="qty"><button onClick={() => setQty(lineKey(l), l.qty - 1)}>−</button><input value={l.qty} onChange={(e) => setQty(lineKey(l), Number(e.target.value) || 0)} /><button onClick={() => setQty(lineKey(l), l.qty + 1)}>＋</button></div>
                <b className="num" style={{ minWidth: 70, textAlign: "end" }}>{money(l.qty * l.unitPrice * (1 - combinePct(l.discountPct, hitOf(l)?.pct || 0) / 100))}</b>
                {mode !== "RETAIL" && <button className="btn ghost sm" title="ملاحظة للمطبخ" aria-label="ملاحظة للمطبخ" onClick={() => setNoteFor(l)}>📝</button>}
                <button className="btn ghost sm" onClick={() => { const v = prompt("خصم % على هذا السطر", String(l.discountPct)); if (v !== null) setCart((c) => c.map((x) => (lineKey(x) === lineKey(l) ? { ...x, discountPct: Math.min(100, Math.max(0, Number(v) || 0)) } : x))); }}>%</button>
              </div>
            </div>))}
          {!cart.length && <div className="empty">اضغط على صنف لإضافته للسلة<br /><span className="small">اختصارات: <span className="kbd">F2</span> بحث · <span className="kbd">F5</span> دفع · <span className="kbd">F8</span> تعليق</span></div>}
        </div>
        <div className="totals">
          <div className="t"><span>الأصناف</span><span className="num">{totals.count}</span></div>
          <div className="t"><span>قبل الضريبة</span><span className="num">{money(totals.net)}</span></div>
          {totals.promo > 0 && <div className="t" style={{ color: "var(--accent)" }}><span>🎁 خصم العروض</span><span className="num">−{money(totals.promo)}</span></div>}
          {totals.serviceOn && <div className="t" data-service-line><span>{totals.serviceLabel} <label className="small muted" style={{ cursor: "pointer" }}><input type="checkbox" checked={waiveSvc} onChange={(e) => setWaiveSvc(e.target.checked)} data-waive-svc /> إعفاء</label></span><span className="num">{waiveSvc ? "—" : money(totals.service)}</span></div>}
          <div className="t"><span>الضريبة {CFG.vatRate}%</span><span className="num">{money(totals.vat)}</span></div>
          <div className="t"><span>خصم على الفاتورة %</span><input className="input num" style={{ width: 70, minHeight: 28, padding: "2px 6px" }} value={ticketDisc} onChange={(e) => setTicketDisc(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} /></div>
          <div className="t grand"><span>الإجمالي</span><span className="num">{money(totals.total)}</span></div>
        </div>
        <div className="pay"><button className="btn primary lg block" disabled={!cart.length || busy} onClick={() => setPayOpen(true)}>الدفع (F5)</button></div>
      </div>
      {payOpen && <PayModal total={totals.total} partner={partner} loyalty={loyalty} online={online} onClose={() => setPayOpen(false)} onPay={(tenders, redeemPoints) => run(async () => {
        const body = { sessionId: session.id, partnerId: partner?.id || null, discountPct: ticketDisc, redeemPoints: redeemPoints || undefined, lines: cart.map((l) => ({ productId: l.product.id, qty: l.qty, unitPrice: Math.round((l.unitPrice - (l.modsPrice || 0)) * 100) / 100, discountPct: l.discountPct, uomId: l.uom?.id || null, ...(l.mods?.length ? { modifiers: l.mods.map((m) => m.optionId) } : {}) })), tenders, clientRef: crypto.randomUUID(), issuedAt: new Date().toISOString(), ...(cart.some((l) => oversellOk.current[l.product.id]) ? { allowOversell: true } : {}), ...(order ? { orderId: order.id, waiveServiceCharge: waiveSvc || undefined, paidLines: splitting ? cart.map((l) => ({ key: lineKey(l), qty: l.qty })) : undefined } : {}) };
        const paidOrder = order, wasSplit = splitting;
        const finish = (inv: any) => {
          oversellOk.current = {};
          setPayOpen(false); setCart([]); setPartner(null); setTicketDisc(0); setWaiveSvc(false); setDone(paidOrder && !inv.tableName ? { ...inv, tableName: paidOrder.tableName, orderType: paidOrder.type, orderNo: paidOrder.number } : inv);
          if (!paidOrder) return;
          setSplitting(false);
          // a split leaves the rest on the table: open it again; otherwise the table is free
          if (wasSplit && inv.orderClosed === false) api(`/pos/orders/${paidOrder.id}`).then(openOrder).catch(() => setOrder(null)); else setOrder(null);
          restF.reload();
        };
        if (!navigator.onLine) { setQueue((q) => [...q, { body }]); finish(localReceipt(body, cart, tenders)); toast("لا يوجد اتصال — حُفظت العملية وستُرحّل تلقائياً عند عودة الاتصال", "info"); return; }
        try {
          let inv: any;
          try { inv = await api("/pos/sale", { body }); }
          catch (e: any) {
            // not enough recorded stock: the cashier may confirm and sell anyway (unless the establishment blocks it)
            if (e.code !== "INSUFFICIENT_STOCK" || me.company?.accounting?.pos?.oversell === "BLOCK") throw e;
            if (!confirmDlg(`${e.message}\n\nالرصيد المسجل لا يكفي. هل البضاعة موجودة فعلاً أمامك وتريد إتمام البيع؟ سيُسجَّل التخطي باسمك ويظهر الصنف بالسالب حتى يُسجَّل الوارد.`)) throw e;
            inv = await api("/pos/sale", { body: { ...body, allowOversell: true } });
            toast("تم البيع مع تخطي الرصيد — بلّغ المحاسب لتسجيل الوارد", "info");
          }
          finish(inv); sess.reload(); products.reload(); availF.reload();
        } catch (e: any) {
          if (e.code !== "OFFLINE") throw e;
          setQueue((q) => [...q, { body }]); finish(localReceipt(body, cart, tenders)); toast("انقطع الاتصال — حُفظت العملية وستُرحّل تلقائياً", "info");
        }
      })} />}
      {(queue.length > 0 || !online || syncErrors.length > 0) && (
        <div style={{ position: "fixed", bottom: 12, insetInlineStart: 12, zIndex: 60, maxWidth: 380, gap: 8 }} className="grid">
          {!online && <div className="alert warn" style={{ margin: 0 }}>⚠ غير متصل بالإنترنت — البيع مستمر محلياً ويُرحّل تلقائياً عند عودة الاتصال</div>}
          {queue.length > 0 && <div className="alert info row between" style={{ margin: 0 }}><span>{queue.length} عملية بانتظار المزامنة {syncing && <span className="spinner" style={{ verticalAlign: "middle" }} />}</span><button className="btn sm" disabled={syncing || !online} onClick={syncQueue}>مزامنة الآن</button></div>}
          {syncErrors.map((e) => <div key={e.ref} className="alert err row between" style={{ margin: 0 }}><span className="small">تعذّر ترحيل عملية {e.ref.slice(0, 8)}: {e.msg}</span><button className="btn sm ghost" onClick={() => setSyncErrors((s) => s.filter((x) => x.ref !== e.ref))}>✕</button></div>)}
        </div>
      )}
      {ticket && <KitchenTicket ticket={ticket} onClose={() => setTicket(null)} />}
      {picking && <ModifierPicker product={picking.p} groups={groupsOf(modGroups, picking.p)} onClose={() => setPicking(null)} onPick={(mods) => { addLine(picking.p, picking.uom, mods); setPicking(null); }} />}
      {bill && order && <PreBill order={order} company={me.company} totals={totals} lines={[...cart.map((l) => ({ name: l.product.name + (l.mods?.length ? ` (${modsText(l)})` : ""), qty: l.qty, total: l.qty * l.unitPrice * (1 - lineDisc(l) / 100) })), ...(totals.service ? [{ name: totals.serviceLabel, qty: 1, total: incl ? totals.service * (1 + CFG.vatRate / 100) : totals.service }] : [])]} onClose={() => setBill(false)} />}
      {moveOpen && order && restF.data && <MoveModal order={order} data={restF.data} onClose={() => setMoveOpen(false)} onDone={(o) => { setMoveOpen(false); openOrder(o); restF.reload(); toast(o.tableName ? `الطلب الآن على ${o.tableName}` : "تم", "ok"); }} />}
      {splitOpen && order && <SplitModal guests={order.guests} lines={cart.map((l) => ({ key: lineKey(l), name: l.product.name, qty: l.qty, unit: l.unitPrice * (1 - l.discountPct / 100) }))} onClose={() => setSplitOpen(false)} onPick={(m) => { setSplitOpen(false); setSplitting(true); setCart(cart.filter((l) => m[lineKey(l)] > 0).map((l) => ({ ...l, qty: m[lineKey(l)] }))); }} />}
      {noteFor && <NoteModal name={noteFor.product.name} value={noteFor.note || ""} quick={restF.data?.settings?.quickNotes || []} onClose={() => setNoteFor(null)} onSave={(v) => { const k = lineKey(noteFor); setCart((c) => c.map((x) => (lineKey(x) === k ? { ...x, note: v } : x))); setNoteFor(null); }} />}
      {done && <ReceiptModal inv={done} onClose={() => { setDone(null); searchRef.current?.focus(); }} />}
      {closeOpen && <CloseModal session={session} onClose={(closed) => { setCloseOpen(false); if (closed) { sess.reload(); } }} />}
      {returnOpen && <ReturnModal session={session} onClose={(r) => { setReturnOpen(false); if (r) { sess.reload(); products.reload(); setDone(r); } }} />}
      {imgEdit && <ProductImagesModal products={imgEdit} onClose={(changed) => { setImgEdit(null); if (changed) { products.reload(); setImgSel({}); } }} />}
      {newPartner && <QuickPartner role="CUSTOMER" onClose={(p) => { setNewPartner(false); if (p) setPartner(p); }} />}
    </div>
  );
}

function PayModal({ total: gross, partner, loyalty, online, onClose, onPay }: { total: number; partner: any; loyalty: any; online: boolean; onClose: () => void; onPay: (t: any[], redeemPoints?: number) => void }) {
  const [method, setMethod] = useState<"CASH" | "CARD" | "MIXED" | "CREDIT">("CASH");
  const [cash, setCash] = useState<string>("");
  const [card, setCard] = useState<string>("");
  // loyalty points: shown for a registered customer while online (the balance is checked by the server)
  const member = !!(loyalty?.enabled && partner && partner.code !== "WALKIN" && online);
  const [lp, setLp] = useState<any>(null);
  const [usePts, setUsePts] = useState("");
  useEffect(() => { if (member) api(`/partners/${partner.id}/loyalty`).then(setLp).catch(() => setLp(null)); }, [member, partner?.id]);
  const maxPts = lp ? Math.max(0, Math.min(Math.floor(lp.balance), Math.floor((gross * loyalty.maxRedeemPct) / 100 / loyalty.pointValue))) : 0;
  const pts = Math.min(maxPts, Math.max(0, Math.floor(Number(usePts) || 0)));
  const ptsOk = pts === 0 || pts >= (loyalty?.minRedeem || 0);
  const ptsValue = ptsOk ? Math.round(pts * (loyalty?.pointValue || 0) * 100) / 100 : 0;
  const total = Math.round((gross - ptsValue) * 100) / 100;
  const cashN = Number(cash || 0), cardN = Number(card || 0);
  const change = method === "CASH" ? Math.max(0, cashN - total) : method === "MIXED" ? Math.max(0, cashN + cardN - total) : 0;
  const short = method === "MIXED" && card !== "" ? Math.max(0, total - cashN - cardN) : 0;
  // «remainder» tenders (amount null) let the server settle the exact total, so a rounding cent never blocks the sale
  const [ref, setRef] = useState("");
  const cardRef = ref.trim() ? { ref: ref.trim() } : {};
  const submit = () => {
    if (!ptsOk) return;
    const r = pts > 0 ? pts : undefined;
    if (method === "CASH") onPay([{ method: "CASH", amount: cashN > total ? cashN : null }], r);
    else if (method === "CARD") onPay([{ method: "CARD", amount: null, ...cardRef }], r);
    else if (method === "MIXED") { if (short > 0) return; onPay(cashN >= total ? [{ method: "CASH", amount: cashN }] : [{ method: "CASH", amount: cashN }, { method: "CARD", amount: null, ...cardRef }], r); }
    else onPay([{ method: "CREDIT", amount: null }], r);
  };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Enter" && !(e.target as HTMLElement)?.dataset?.pts) { e.preventDefault(); submit(); } }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); });
  const quick = [total, Math.ceil(total / 10) * 10, Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <Modal narrow title={<>الدفع — <span className="num">{money(total)}</span> {CUR()}</>} onClose={onClose} footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary lg" disabled={(method === "MIXED" && short > 0) || (method === "CREDIT" && !partner) || !ptsOk} onClick={submit}>تأكيد الدفع (Enter)</button></>}>
      <div className="pay">
        {member && lp && <div className="alert info small" style={{ margin: 0 }}>
          ⭐ رصيد <b>{partner.name}</b>: <b className="num">{lp.balance}</b> نقطة (<Money v={lp.value} />){lp.balance >= loyalty.minRedeem ? <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <span>استبدال</span><NumInput data-pts="1" value={usePts} onChange={(e) => setUsePts(e.target.value)} placeholder="0" style={{ width: 90 }} /><span>نقطة</span>
            <button className="btn sm" onClick={() => setUsePts(String(maxPts))}>الحد الأقصى ({maxPts})</button>
            {pts > 0 && ptsOk && <b className="num">− {money(ptsValue)}</b>}
          </div> : <div className="muted">الاستبدال من {loyalty.minRedeem} نقطة</div>}
          {!ptsOk && <div style={{ color: "var(--danger)" }}>أقل عدد للاستبدال {loyalty.minRedeem} نقطة</div>}
        </div>}
        <div className="methods">
          {(["CASH", "CARD", "MIXED", "CREDIT"] as const).map((m) => <button key={m} className={method === m ? "active" : ""} onClick={() => setMethod(m)}>{m === "MIXED" ? "مختلط" : METHOD_AR[m]}</button>)}
        </div>
        {(method === "CASH" || method === "MIXED") && <Field label="المبلغ النقدي المستلم"><NumInput autoFocus value={cash} onChange={(e) => setCash(e.target.value)} placeholder={money(total)} style={{ fontSize: 22, textAlign: "center" }} /></Field>}
        {method === "CASH" && <div className="row" style={{ gap: 6 }}>{quick.map((v) => <button key={v} className="btn sm" onClick={() => setCash(String(v))}>{money(v)}</button>)}</div>}
        {method === "MIXED" && <Field label="مبلغ الشبكة / البطاقة"><NumInput value={card} onChange={(e) => setCard(e.target.value)} placeholder={money(Math.max(0, total - cashN))} style={{ fontSize: 22, textAlign: "center" }} /></Field>}
        {method === "CARD" && <div className="alert info">سيُسجل المبلغ كاملاً على حساب تسوية مدى/البطاقات.</div>}
        {(method === "CARD" || method === "MIXED") && <Field label="رقم العملية على جهاز الشبكة (اختياري)" hint="رقم الموافقة أو المرجع من إيصال الجهاز — تُطابَق به العملية مع كشف البنك"><Input data-pts="1" data-card-ref value={ref} onChange={(e) => setRef(e.target.value)} dir="ltr" maxLength={40} /></Field>}
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
  useEffect(() => { if (inv.offline) { setFull(inv); return; } api(`/invoices/${inv.id}`).then(setFull).catch(() => setFull(inv)); if (inv.qr) QRCode.toDataURL(inv.qr, { margin: 0, width: 120 }).then(setQr); }, [inv.id]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); });
  return (
    <Modal narrow title={<>{inv.kind === "CREDIT_NOTE" ? "مرتجع" : "فاتورة"} {inv.offline ? "محفوظة محلياً" : inv.number} ✓ {inv.cashChange > 0 && <span className="badge green">الباقي {money(inv.cashChange)}</span>}</>} onClose={onClose} footer={<><button className="btn" onClick={() => window.print()}>🖨 طباعة (حراري)</button><button className="btn primary" onClick={onClose}>بيع جديد (Enter)</button></>}>
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
