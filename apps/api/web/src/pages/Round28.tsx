/** Round 28 screens: promotions (offers), customer loyalty points, document attachments, light/dark theme. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { CFG, CUR } from "../shared/country";
import { api, session, useFetch, Modal, Field, Input, Select, NumInput, Money, money, Loading, Empty, useAction, useToast, useCompanyContext, fmtDate, fmtDT, confirmDlg, ExportBtn } from "../lib";

const KIND_AR: Record<string, string> = { PERCENT: "خصم بنسبة %", FIXED_PRICE: "سعر خاص", BUY_X_GET_Y: "اشترِ X واحصل على Y مجاناً" };
const SCOPE_AR: Record<string, string> = { ALL: "كل الأصناف", PRODUCTS: "أصناف محددة", CATEGORIES: "تصنيفات محددة" };
const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export function promoSummary(p: any) {
  const v = p.kind === "PERCENT" ? `${Number(p.value)}%` : p.kind === "FIXED_PRICE" ? `بسعر ${money(p.value)}` : `اشترِ ${Number(p.buyQty)} واحصل على ${Number(p.getQty)} مجاناً`;
  const when = [p.dateFrom && `من ${fmtDate(p.dateFrom)}`, p.dateTo && `حتى ${fmtDate(p.dateTo)}`, p.days?.length ? p.days.map((d: number) => DAYS[d]).join("، ") : null, p.timeFrom && `${p.timeFrom}–${p.timeTo}`].filter(Boolean).join(" · ");
  return { v, when };
}

function status(p: any) {
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  if (!p.isActive) return <span className="badge gray">موقوف</span>;
  if (p.dateTo && String(p.dateTo).slice(0, 10) < today) return <span className="badge gray">منتهٍ</span>;
  if (p.dateFrom && String(p.dateFrom).slice(0, 10) > today) return <span className="badge blue">مجدول</span>;
  return <span className="badge green">ساري</span>;
}

// ─── promotions ────────────────────────────────────────────────────────────
export function PromotionsPage() {
  const { can } = useCompanyContext();
  const { data, loading, reload } = useFetch<any[]>("/promotions");
  const [edit, setEdit] = useState<any>(null);
  const totals = useMemo(() => (data || []).reduce((a, p) => ({ uses: a.uses + Number(p.uses), disc: a.disc + Number(p.discountGiven), sales: a.sales + Number(p.sales) }), { uses: 0, disc: 0, sales: 0 }), [data]);
  if (loading && !data) return <Loading />;
  return (
    <div className="grid">
      <div className="kpis">
        <div className="card kpi"><div className="label">العروض السارية</div><div className="value">{(data || []).filter((p) => p.isActive).length}</div></div>
        <div className="card kpi"><div className="label">فواتير استفادت من العروض</div><div className="value">{totals.uses}</div></div>
        <div className="card kpi accent"><div className="label">قيمة الخصومات الممنوحة</div><div className="value"><Money v={totals.disc} /></div></div>
        <div className="card kpi"><div className="label">مبيعات الأصناف المشمولة</div><div className="value"><Money v={totals.sales} /></div></div>
      </div>
      <div className="card">
        <div className="card-h"><h3>العروض والخصومات</h3><div className="row">{data && <ExportBtn name="العروض" rows={() => data.map((p) => ({ العرض: p.name, النوع: KIND_AR[p.kind], القيمة: promoSummary(p).v, النطاق: SCOPE_AR[p.scope], الفترة: promoSummary(p).when, "عدد الفواتير": p.uses, "الخصم الممنوح": Number(p.discountGiven), المبيعات: Number(p.sales) }))} />}{can("settings.write") && <button className="btn primary sm" onClick={() => setEdit({})}>＋ عرض جديد</button>}</div></div>
        <div className="card-b"><p className="muted small" style={{ margin: 0 }}>تُطبَّق العروض تلقائياً في نقطة البيع (حتى دون اتصال)، وبزر «تطبيق العروض» في فواتير المبيعات. يُطبَّق أفضل عرض على كل صنف، ويُجمع مع خصم السطر وخصم الفاتورة. الخصم يُخفّض الإيراد والضريبة المستحقة.</p></div>
        {!data?.length ? <Empty text="لا توجد عروض — أضف عرضاً: خصم نسبة، سعر خاص، أو اشترِ X واحصل على Y" /> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>العرض</th><th>النوع</th><th>النطاق</th><th>الفترة / الأيام / الساعات</th><th>القنوات</th><th>الحالة</th><th className="n">الفواتير</th><th className="n">الخصم الممنوح</th><th></th></tr></thead>
            <tbody>{data.map((p) => { const s = promoSummary(p); return (
              <tr key={p.id}><td><b>{p.name}</b>{p.minTotal > 0 && <div className="small muted">لفاتورة {money(p.minTotal)} فأكثر</div>}{p.minQty > 0 && <div className="small muted">لكمية {Number(p.minQty)} فأكثر</div>}</td>
                <td>{s.v}</td><td className="small">{SCOPE_AR[p.scope]}{p.scope === "PRODUCTS" ? ` (${p.productIds.length})` : p.scope === "CATEGORIES" ? ` (${p.categoryIds.length})` : ""}</td>
                <td className="small">{s.when || "دائم"}</td><td className="small">{(p.channels || []).map((c: string) => (c === "POS" ? "نقطة البيع" : "الفواتير")).join("، ")}</td>
                <td>{status(p)}</td><td className="n">{p.uses}</td><td className="n"><Money v={p.discountGiven} /></td>
                <td>{can("settings.write") && <button className="btn sm ghost" onClick={() => setEdit(p)}>تعديل</button>}</td></tr>); })}</tbody>
          </table></div>)}
      </div>
      {edit && <PromotionEditor p={edit} onClose={(s) => { setEdit(null); if (s) reload(); }} />}
    </div>
  );
}

function PromotionEditor({ p, onClose }: { p: any; onClose: (saved?: boolean) => void }) {
  const { run, busy } = useAction();
  const toast = useToast();
  const products = useFetch<any>("/products?limit=2000");
  const cats = useFetch<any[]>("/categories");
  const [f, setF] = useState<any>({ kind: "PERCENT", scope: "ALL", value: 10, buyQty: 2, getQty: 1, channels: ["POS", "SALES"], days: [], productIds: [], categoryIds: [], isActive: true, priority: 0, ...p, dateFrom: p.dateFrom ? String(p.dateFrom).slice(0, 10) : "", dateTo: p.dateTo ? String(p.dateTo).slice(0, 10) : "" });
  const [ps, setPs] = useState("");
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const toggle = (k: string, v: any) => setF({ ...f, [k]: (f[k] || []).includes(v) ? f[k].filter((x: any) => x !== v) : [...(f[k] || []), v] });
  const plist = ((products.data?.rows || products.data || []) as any[]).filter((x) => !ps || (x.name + " " + (x.sku || "") + " " + (x.barcode || "")).toLowerCase().includes(ps.toLowerCase()));
  const save = () => run(async () => { const body = { ...f, dateFrom: f.dateFrom || null, dateTo: f.dateTo || null, timeFrom: f.timeFrom || null, timeTo: f.timeTo || null }; p.id ? await api(`/promotions/${p.id}`, { method: "PUT", body }) : await api("/promotions", { body }); onClose(true); }, "تم حفظ العرض");
  return (
    <Modal wide title={p.id ? `تعديل العرض: ${p.name}` : "عرض جديد"} onClose={() => onClose()} footer={<>
      {p.id && <button className="btn danger sm" onClick={() => run(async () => { if (!confirmDlg("حذف العرض؟")) return; const r = await api(`/promotions/${p.id}`, { method: "DELETE" }); if (r.message) toast(r.message); onClose(true); })}>حذف</button>}
      <div className="grow" /><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy} onClick={save}>حفظ</button></>}>
      <div className="form-grid">
        <div className="span3 form-sec">العرض</div>
        <Field label="اسم العرض *" span2><Input autoFocus value={f.name || ""} onChange={s("name")} placeholder="مثال: خصم نهاية الأسبوع" /></Field>
        <Field label="الحالة"><label className="check"><input type="checkbox" checked={!!f.isActive} onChange={s("isActive")} /> فعّال</label></Field>
        <Field label="نوع العرض"><Select value={f.kind} onChange={s("kind")}>{Object.entries(KIND_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        {f.kind === "PERCENT" && <Field label="نسبة الخصم %"><NumInput value={f.value} onChange={s("value")} /></Field>}
        {f.kind === "FIXED_PRICE" && <Field label={`السعر الخاص للوحدة (${CUR()})`} hint={CFG.vatRate ? "بنفس طريقة تسعير الأصناف (شامل/غير شامل الضريبة)" : undefined}><NumInput value={f.value} onChange={s("value")} /></Field>}
        {f.kind === "BUY_X_GET_Y" && <><Field label="اشترِ (كمية)"><NumInput value={f.buyQty} onChange={s("buyQty")} /></Field><Field label="واحصل مجاناً على"><NumInput value={f.getQty} onChange={s("getQty")} /></Field></>}
        <Field label="حد أدنى للكمية في السطر"><NumInput value={f.minQty || ""} onChange={s("minQty")} placeholder="0" /></Field>
        <Field label={`حد أدنى لقيمة الفاتورة (${CUR()})`}><NumInput value={f.minTotal || ""} onChange={s("minTotal")} placeholder="0" /></Field>
        <Field label="الأولوية" hint="عند تساوي الخصم يُقدَّم الأعلى"><NumInput value={f.priority} onChange={s("priority")} /></Field>

        <div className="span3 form-sec">الأصناف المشمولة</div>
        <Field label="النطاق"><Select value={f.scope} onChange={s("scope")}>{Object.entries(SCOPE_AR).filter(([k]) => !(f.kind === "FIXED_PRICE" && k === "ALL")).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        {f.scope === "CATEGORIES" && <Field label={`التصنيفات (${f.categoryIds.length})`} span2><div className="chips">{(cats.data || []).map((c: any) => <label key={c.id} className={"chip" + (f.categoryIds.includes(c.id) ? " on" : "")}><input type="checkbox" checked={f.categoryIds.includes(c.id)} onChange={() => toggle("categoryIds", c.id)} /> {c.name}</label>)}</div></Field>}
        {f.scope === "PRODUCTS" && <Field label={`الأصناف (${f.productIds.length} محدد)`} span2>
          <Input placeholder="بحث بالاسم أو الرمز أو الباركود" value={ps} onChange={(e) => setPs(e.target.value)} />
          <div className="pick-list">{plist.slice(0, 300).map((x: any) => <label key={x.id} className="check"><input type="checkbox" checked={f.productIds.includes(x.id)} onChange={() => toggle("productIds", x.id)} /> {x.name} <span className="muted small num">{x.sku} · {money(x.salePrice)}</span></label>)}</div>
        </Field>}

        <div className="span3 form-sec">متى يسري</div>
        <Field label="من تاريخ"><Input type="date" value={f.dateFrom} onChange={s("dateFrom")} /></Field>
        <Field label="إلى تاريخ"><Input type="date" value={f.dateTo} onChange={s("dateTo")} /></Field>
        <Field label="ساعات العرض (اختياري)"><div style={{ display: "flex", gap: 6, alignItems: "center" }}><Input type="time" value={f.timeFrom || ""} onChange={s("timeFrom")} style={{ minWidth: 0 }} /><span>—</span><Input type="time" value={f.timeTo || ""} onChange={s("timeTo")} style={{ minWidth: 0 }} /></div></Field>
        <Field label="أيام الأسبوع (فارغ = كل الأيام)" span2><div className="chips">{DAYS.map((d, i) => <label key={i} className={"chip" + (f.days.includes(i) ? " on" : "")}><input type="checkbox" checked={f.days.includes(i)} onChange={() => toggle("days", i)} /> {d}</label>)}</div></Field>
        <Field label="يطبق في"><div className="row"><label className="check"><input type="checkbox" checked={f.channels.includes("POS")} onChange={() => toggle("channels", "POS")} /> نقطة البيع</label><label className="check"><input type="checkbox" checked={f.channels.includes("SALES")} onChange={() => toggle("channels", "SALES")} /> فواتير المبيعات</label></div></Field>
        <Field label="ملاحظات" span3><Input value={f.notes || ""} onChange={s("notes")} /></Field>
      </div>
    </Modal>
  );
}

// ─── loyalty ───────────────────────────────────────────────────────────────
export function LoyaltyPage() {
  const { can } = useCompanyContext();
  const { data, loading, reload } = useFetch<any>("/loyalty");
  const { run, busy } = useAction();
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (data) setF(data.settings); }, [data]);
  if (loading && !data) return <Loading />;
  if (!data || !f) return null;
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const example = Math.floor(100 * Number(f.earnRate || 0));
  return (
    <div className="grid">
      <div className="kpis">
        <div className="card kpi"><div className="label">العملاء الأعضاء</div><div className="value">{data.members}</div></div>
        <div className="card kpi"><div className="label">نقاط مكتسبة</div><div className="value num">{Number(data.earned).toLocaleString("en")}</div></div>
        <div className="card kpi"><div className="label">نقاط مستبدلة</div><div className="value num">{Number(data.redeemed).toLocaleString("en")}</div><div className="small muted">قيمتها <Money v={data.redeemedValue} /></div></div>
        <div className="card kpi accent"><div className="label">رصيد النقاط القائم</div><div className="value num">{Number(data.outstanding).toLocaleString("en")}</div><div className="small muted">قيمته <Money v={data.outstandingValue} /> {CUR()}</div></div>
      </div>
      <div className="card"><div className="card-h"><h3>إعدادات برنامج نقاط الولاء</h3>{f.enabled ? <span className="badge green">مفعّل</span> : <span className="badge gray">غير مفعّل</span>}</div>
        <div className="card-b">
          <div className="form-grid">
            <Field label="البرنامج"><label className="check"><input type="checkbox" checked={!!f.enabled} onChange={s("enabled")} disabled={!can("settings.write")} /> تفعيل نقاط الولاء للعملاء المسجلين</label></Field>
            <Field label={`النقاط المكتسبة لكل 1 ${CFG.words.one}`}><NumInput value={f.earnRate} onChange={s("earnRate")} /></Field>
            <Field label={`قيمة النقطة عند الاستبدال (${CUR()})`}><NumInput value={f.pointValue} onChange={s("pointValue")} /></Field>
            <Field label="أقل عدد نقاط للاستبدال"><NumInput value={f.minRedeem} onChange={s("minRedeem")} /></Field>
            <Field label="أقصى نسبة من الفاتورة تُدفع بالنقاط %"><NumInput value={f.maxRedeemPct} onChange={s("maxRedeemPct")} /></Field>
            <Field label="صلاحية النقاط (أشهر، 0 = بلا انتهاء)"><NumInput value={f.expiryMonths} onChange={s("expiryMonths")} /></Field>
          </div>
          <div className="alert info small mt">مثال: فاتورة بـ 100 {CFG.words.one} تكسب العميل <b>{example}</b> نقطة قيمتها <b>{money(example * Number(f.pointValue || 0))}</b>. — النقاط تُكتسب عند ترحيل أي فاتورة مبيعات لعميل مسجل (ليس «عميل نقدي») وتُعكس عند المرتجع، وتُستبدل في نقطة البيع كخصم على الفاتورة يُخفّض الإيراد والضريبة (معاملة الهيئة لنقاط البائع نفسه).</div>
          {can("settings.write") && <button className="btn primary mt" disabled={busy} onClick={() => run(async () => { await api("/loyalty/settings", { method: "PUT", body: f }); reload(); }, "تم الحفظ")}>حفظ الإعدادات</button>}
        </div>
      </div>
      <div className="card"><div className="card-h"><h3>أرصدة العملاء</h3>{data.customers.length > 0 && <ExportBtn name="نقاط الولاء" rows={() => data.customers.map((c: any) => ({ العميل: c.name, الجوال: c.phone, "النقاط المكتسبة": Number(c.earned || 0), الرصيد: Number(c.balance), القيمة: Number(c.balance) * Number(f.pointValue), "آخر حركة": fmtDate(c.lastAt) }))} />}</div>
        {!data.customers.length ? <Empty text="لا توجد نقاط بعد — تُكتسب تلقائياً بعد تفعيل البرنامج" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>العميل</th><th>الجوال</th><th className="n">المكتسب</th><th className="n">الرصيد</th><th className="n">القيمة</th><th>آخر حركة</th></tr></thead>
          <tbody>{data.customers.map((c: any) => <tr key={c.id}><td><a href={`/customers/${c.id}`}>{c.name}</a></td><td className="num">{c.phone}</td><td className="n num">{Number(c.earned || 0)}</td><td className="n num"><b>{Number(c.balance)}</b></td><td className="n"><Money v={Number(c.balance) * Number(f.pointValue)} /></td><td className="small">{fmtDate(c.lastAt)}</td></tr>)}</tbody></table></div>}
      </div>
    </div>
  );
}

const LK_AR: Record<string, string> = { EARN: "اكتساب", REDEEM: "استبدال", REVERSE: "عكس مرتجع", ADJUST: "تعديل يدوي", EXPIRE: "انتهاء صلاحية" };
/** Card on the customer profile: balance, value, history, manual adjustment. */
export function CustomerLoyaltyCard({ partnerId }: { partnerId: string }) {
  const { can } = useCompanyContext();
  const { data, reload } = useFetch<any>(`/partners/${partnerId}/loyalty`);
  const { run, busy } = useAction();
  const [adj, setAdj] = useState(false);
  const [pts, setPts] = useState(""); const [note, setNote] = useState("");
  if (!data || (!data.settings.enabled && !data.ledger.length)) return null;
  return (
    <div className="card"><div className="card-h"><h3>⭐ نقاط الولاء</h3>{can("settings.write") && <button className="btn sm" onClick={() => setAdj(true)}>تعديل الرصيد</button>}</div>
      <div className="card-b row" style={{ gap: 24 }}>
        <div><div className="muted small">الرصيد</div><b className="num" style={{ fontSize: 22 }}>{data.balance}</b> نقطة</div>
        <div><div className="muted small">القيمة</div><b><Money v={data.value} /></b> {CUR()}</div>
        {data.expiringSoon > 0 && <div className="badge amber">{data.expiringSoon} نقطة تنتهي في {fmtDate(data.expiringOn)}</div>}
        {!data.canRedeem && data.settings.enabled && <div className="muted small">الاستبدال من {data.settings.minRedeem} نقطة</div>}
      </div>
      {data.ledger.length > 0 && <div className="table-wrap"><table className="tbl compact"><thead><tr><th>التاريخ</th><th>الحركة</th><th>المستند</th><th className="n">النقاط</th><th>ملاحظة</th></tr></thead>
        <tbody>{data.ledger.slice(0, 50).map((l: any) => <tr key={l.id}><td className="small">{fmtDT(l.createdAt)}</td><td>{LK_AR[l.kind] || l.kind}</td><td className="num small">{l.number || "—"}</td><td className={"n num " + (Number(l.points) < 0 ? "neg-val" : "pos-val")}>{Number(l.points) > 0 ? "+" : ""}{Number(l.points)}</td><td className="small">{l.note}</td></tr>)}</tbody></table></div>}
      {adj && <Modal narrow title="تعديل رصيد النقاط" onClose={() => setAdj(false)} footer={<><button className="btn" onClick={() => setAdj(false)}>إلغاء</button><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api(`/partners/${partnerId}/loyalty/adjust`, { body: { points: Number(pts), note } }); setAdj(false); setPts(""); setNote(""); reload(); }, "تم")}>حفظ</button></>}>
        <Field label="النقاط (+ إضافة / − خصم)"><NumInput autoFocus value={pts} onChange={(e) => setPts(e.target.value)} /></Field>
        <Field label="السبب *"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: تعويض عميل، نقل رصيد من بطاقة سابقة" /></Field>
      </Modal>}
    </div>
  );
}

// ─── attachments ──────────────────────────────────────────────────────────
const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} م.ب` : `${Math.max(1, Math.round(b / 1024))} ك.ب`);
const ICON = (m: string) => (m.startsWith("image/") ? "🖼" : m === "application/pdf" ? "📄" : m.includes("sheet") || m.includes("excel") || m.includes("csv") ? "📊" : m.includes("word") ? "📝" : "📎");
function readB64(file: File): Promise<string> { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); }); }
async function openFile(id: string, name: string, download = false) {
  const r = await fetch(`/api/attachments/file/${id}${download ? "?download=1" : ""}`, { headers: { Authorization: `Bearer ${session.token}` } });
  if (!r.ok) throw new Error("تعذّر فتح المرفق");
  const url = URL.createObjectURL(await r.blob());
  if (download) { const a = document.createElement("a"); a.href = url; a.download = name; a.click(); } else window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Files attached to a document: drag & drop, camera on phones, preview, download, delete. */
export function Attachments({ entity, id, canWrite = true }: { entity: string; id: string; canWrite?: boolean }) {
  const { data, reload } = useFetch<any[]>(id ? `/attachments/${entity}/${id}` : null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const inp = useRef<HTMLInputElement>(null);
  const upload = async (files: FileList | File[]) => {
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        if (f.size > 8 * 1024 * 1024) { toast(`«${f.name}» أكبر من 8 ميجابايت`, "err"); continue; }
        await api(`/attachments/${entity}/${id}`, { body: { name: f.name, mime: f.type || "application/octet-stream", data: await readB64(f) } });
      }
      reload();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <div className={"attach no-print" + (over ? " over" : "")} onDragOver={(e) => { if (!canWrite) return; e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); if (canWrite && e.dataTransfer.files.length) upload(e.dataTransfer.files); }}>
      <div className="row between"><b>📎 المرفقات {data?.length ? `(${data.length})` : ""}</b>{canWrite && <><button className="btn sm" disabled={busy} onClick={() => inp.current?.click()}>{busy ? "جارٍ الرفع…" : "＋ إرفاق ملف"}</button><input ref={inp} type="file" multiple hidden accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip" onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ""; }} /></>}</div>
      {!data?.length ? <div className="muted small">{canWrite ? "اسحب الملفات هنا أو اضغط «إرفاق ملف» — فاتورة المورد، الإيصال، العقد… (حتى 8 ميجابايت)" : "لا توجد مرفقات"}</div> : (
        <div className="attach-list">{data.map((a) => <div key={a.id} className="attach-item">
          <span className="ic">{ICON(a.mime)}</span><a onClick={() => openFile(a.id, a.name).catch((e) => toast(e.message, "err"))} title="فتح">{a.name}</a>
          <span className="muted small">{fmtSize(a.size)} · {a.createdBy} · {fmtDate(a.createdAt)}</span>
          <button className="btn ghost sm" title="تنزيل" onClick={() => openFile(a.id, a.name, true).catch((e) => toast(e.message, "err"))}>⬇</button>
          {canWrite && <button className="btn ghost sm" title="حذف" onClick={async () => { if (!confirmDlg(`حذف «${a.name}»؟`)) return; try { await api(`/attachments/file/${a.id}`, { method: "DELETE" }); reload(); } catch (e: any) { toast(e.message, "err"); } }}>🗑</button>}
        </div>)}</div>)}
    </div>
  );
}

// ─── theme ─────────────────────────────────────────────────────────────────
const THEME_KEY = "mz_theme";
export function applyTheme(t?: string) {
  const v = t || (() => { try { return localStorage.getItem(THEME_KEY) || "auto"; } catch { return "auto"; } })();
  const dark = v === "dark" || (v === "auto" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  return v;
}
export function ThemeToggle() {
  const [v, setV] = useState(() => applyTheme());
  const next = v === "auto" ? "dark" : v === "dark" ? "light" : "auto";
  return <button className="btn sm ghost" title={`المظهر: ${v === "auto" ? "تلقائي (حسب النظام)" : v === "dark" ? "داكن" : "فاتح"} — اضغط للتبديل`} onClick={() => { try { localStorage.setItem(THEME_KEY, next); } catch {} setV(applyTheme(next)); }}>{v === "dark" ? "🌙" : v === "light" ? "☀️" : "🌓"}</button>;
}
