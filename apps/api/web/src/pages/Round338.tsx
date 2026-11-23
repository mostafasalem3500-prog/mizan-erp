/**
 * 3.38 screens: modifiers & service charge (from Foodics), supplier payment runs (SAP F110 / Dynamics vendor payment
 * proposal), 13-week cash flow forecast (Dynamics cash flow forecasting), smart auditor (journal analytics), and the
 * modifier picker used by the POS and the account suggestion used by the expense form.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, q, useFetch, useAction, Money, money, Loading, Empty, Modal, Field, Input, NumInput, Select, Picker, partnerFetcher, today, fmtDate, fmtDT, confirmDlg, useCompanyContext } from "../lib";

const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ───────────────────────── modifiers & service charge ─────────────────────────
const blankGroup = () => ({ name: "", minSelect: 0, maxSelect: 1, options: [{ name: "", price: 0 }], productIds: [] as string[], categoryIds: [] as string[], isActive: true });
export function ModifiersPage() {
  const groups = useFetch<any[]>("/modifiers");
  const cats = useFetch<any[]>("/categories");
  const products = useFetch<any[]>(`/products${q({ limit: 1000 })}`);
  const rest = useFetch<any>("/pos/restaurant");
  const [edit, setEdit] = useState<any>(null);
  const { run, busy } = useAction();
  const pname = (id: string) => (products.data || []).find((p: any) => p.id === id)?.name || "—";
  const cname = (id: string) => (cats.data || []).find((c: any) => c.id === id)?.name || "—";
  return (
    <div className="grid" data-modifiers>
      <div className="card">
        <div className="card-h"><div><h3>الإضافات والخيارات</h3>
          <div className="small muted">خيارات تُختار مع الصنف في نقطة البيع: الحجم، الإضافات المسعّرة، «بدون بصل». المجموعة لها حد أدنى (1 = إلزامي) وحد أقصى، وتُربط بأصناف أو بتصنيف كامل. سعر الخيار يُضاف لسعر الصنف فيدخل الإيراد والضريبة والفاتورة، ويظهر في تذكرة المطبخ.</div></div>
          <button className="btn primary" data-new-group onClick={() => setEdit(blankGroup())}>＋ مجموعة جديدة</button></div>
        <div className="card-b">
          {!groups.data ? <Loading /> : !groups.data.length ? <Empty text="لا توجد مجموعات إضافات بعد" /> : <div className="table-wrap"><table className="tbl" data-groups>
            <thead><tr><th>المجموعة</th><th>الاختيار</th><th>الخيارات</th><th>تُطبَّق على</th><th>الحالة</th><th></th></tr></thead>
            <tbody>{groups.data.map((g) => <tr key={g.id}><td><b>{g.name}</b></td>
              <td className="small">{g.minSelect > 0 ? <span className="badge amber">إلزامي</span> : <span className="badge">اختياري</span>} {g.minSelect === g.maxSelect ? `${g.maxSelect}` : `${g.minSelect}–${g.maxSelect}`}</td>
              <td className="small">{g.options.map((o: any) => `${o.name}${Number(o.price) ? ` (+${money(o.price)})` : ""}`).join("، ")}</td>
              <td className="small">{[...g.categoryIds.map((c: string) => `📁 ${cname(c)}`), ...g.productIds.map(pname)].join("، ") || <span className="muted">غير مربوطة</span>}</td>
              <td>{g.isActive ? <span className="badge green">فعّالة</span> : <span className="badge">موقوفة</span>}</td>
              <td><button className="btn sm ghost" onClick={() => setEdit({ ...g })}>تعديل</button><button className="btn sm ghost" onClick={() => confirmDlg(`حذف «${g.name}»؟`) && run(async () => { await api(`/modifiers/${g.id}`, { method: "DELETE" }); groups.reload(); }, "حُذفت المجموعة")}>حذف</button></td></tr>)}</tbody></table></div>}
        </div>
      </div>
      {rest.data && <ServiceChargeCard settings={rest.data.settings} onSaved={rest.reload} />}
      {edit && <GroupEditor g={edit} cats={cats.data || []} products={products.data || []} busy={busy} onClose={() => setEdit(null)}
        onSave={(g) => run(async () => { const body = { ...g, options: g.options.filter((o: any) => String(o.name || "").trim()) }; if (g.id) await api(`/modifiers/${g.id}`, { method: "PUT", body }); else await api("/modifiers", { body }); setEdit(null); groups.reload(); }, "حُفظت المجموعة")} />}
    </div>
  );
}
function GroupEditor({ g: g0, cats, products, busy, onClose, onSave }: { g: any; cats: any[]; products: any[]; busy: boolean; onClose: () => void; onSave: (g: any) => void }) {
  const [g, setG] = useState<any>(g0);
  const [find, setFind] = useState("");
  const set = (k: string, v: any) => setG((x: any) => ({ ...x, [k]: v }));
  const setOpt = (i: number, k: string, v: any) => set("options", g.options.map((o: any, j: number) => (j === i ? { ...o, [k]: v } : o)));
  const toggle = (k: "productIds" | "categoryIds", id: string) => set(k, g[k].includes(id) ? g[k].filter((x: string) => x !== id) : [...g[k], id]);
  const shown = products.filter((p) => !find || p.name.includes(find) || String(p.sku || "").includes(find)).slice(0, 60);
  return (
    <Modal title={g.id ? `تعديل «${g0.name}»` : "مجموعة إضافات جديدة"} onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>إلغاء</button><button className="btn primary" disabled={busy} data-save-group onClick={() => onSave(g)}>حفظ</button></>}>
      <div className="form-grid">
        <Field label="اسم المجموعة"><Input value={g.name} onChange={(e) => set("name", e.target.value)} placeholder="الحجم، الإضافات، درجة الطهي…" autoFocus data-group-name /></Field>
        <Field label="أقل عدد يُختار" hint="0 = اختياري، 1 = يجب اختيار خيار"><NumInput value={g.minSelect} onChange={(e) => set("minSelect", Number(e.target.value))} data-min /></Field>
        <Field label="أكثر عدد يُختار"><NumInput value={g.maxSelect} onChange={(e) => set("maxSelect", Number(e.target.value))} data-max /></Field>
        <Field label="الحالة"><Select value={g.isActive ? "1" : "0"} onChange={(e) => set("isActive", e.target.value === "1")}><option value="1">فعّالة</option><option value="0">موقوفة</option></Select></Field>
      </div>
      <h4 className="mt">الخيارات</h4>
      <div className="table-wrap"><table className="tbl compact" data-options><thead><tr><th>الخيار</th><th className="n" style={{ width: 130 }}>السعر الإضافي</th><th></th></tr></thead>
        <tbody>{g.options.map((o: any, i: number) => <tr key={i}><td><Input value={o.name} onChange={(e) => setOpt(i, "name", e.target.value)} placeholder="كبير، جبن إضافي…" aria-label={`اسم الخيار ${i + 1}`} /></td>
          <td className="n"><NumInput value={o.price} onChange={(e) => setOpt(i, "price", e.target.value)} aria-label={`سعر الخيار ${i + 1}`} /></td>
          <td><button className="btn sm ghost" disabled={g.options.length < 2} onClick={() => set("options", g.options.filter((_: any, j: number) => j !== i))}>✕</button></td></tr>)}</tbody></table></div>
      <button className="btn sm mt" data-add-option onClick={() => set("options", [...g.options, { name: "", price: 0 }])}>＋ خيار</button>
      <h4 className="mt">تُطبَّق على</h4>
      <div className="small muted mb">تصنيف كامل (كل أصنافه)، أو أصناف بعينها.</div>
      <div className="chips mb">{cats.map((c) => <label key={c.id} className={"chip" + (g.categoryIds.includes(c.id) ? " on" : "")}><input type="checkbox" checked={g.categoryIds.includes(c.id)} onChange={() => toggle("categoryIds", c.id)} /> 📁 {c.name}</label>)}</div>
      <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="ابحث عن صنف…" aria-label="بحث الأصناف" />
      <div className="chips mt" data-products>{shown.map((p) => <label key={p.id} className={"chip" + (g.productIds.includes(p.id) ? " on" : "")}><input type="checkbox" checked={g.productIds.includes(p.id)} onChange={() => toggle("productIds", p.id)} /> {p.name}</label>)}</div>
    </Modal>
  );
}
const TYPES: Record<string, string> = { DINE_IN: "محلي (على طاولة)", TAKEAWAY: "سفري", DELIVERY: "توصيل" };
function ServiceChargeCard({ settings, onSaved }: { settings: any; onSaved: () => void }) {
  const [s, setS] = useState<any>(settings.serviceCharge || { pct: 0, types: ["DINE_IN"], minGuests: 0, label: "رسوم الخدمة" });
  const { run, busy } = useAction();
  return (
    <div className="card" data-service-charge><div className="card-h"><div><h3>رسوم الخدمة</h3>
      <div className="small muted">نسبة تُضاف تلقائياً إلى فاتورة الطلبات المختارة (المحلية عادةً) من صافي الأصناف بعد الخصم، كسطر مستقل خاضع للضريبة يُقيَّد في «إيرادات الخدمات». يمكن للكاشير الإعفاء منها في الطلب ويُكتب الإعفاء على الفاتورة.</div></div></div>
      <div className="card-b"><div className="form-grid">
        <Field label="النسبة %" hint="0 = بلا رسوم خدمة"><NumInput value={s.pct} onChange={(e) => setS({ ...s, pct: e.target.value })} data-svc-pct /></Field>
        <Field label="الاسم على الفاتورة"><Input value={s.label} onChange={(e) => setS({ ...s, label: e.target.value })} /></Field>
        <Field label="من عدد ضيوف" hint="0 = كل الطلبات"><NumInput value={s.minGuests} onChange={(e) => setS({ ...s, minGuests: e.target.value })} /></Field>
        <Field label="أنواع الطلبات"><div className="chips">{Object.entries(TYPES).map(([k, v]) => <label key={k} className={"chip" + (s.types.includes(k) ? " on" : "")}><input type="checkbox" checked={s.types.includes(k)} onChange={() => setS({ ...s, types: s.types.includes(k) ? s.types.filter((x: string) => x !== k) : [...s.types, k] })} /> {v}</label>)}</div></Field>
      </div>
      {settings.mode === "RETAIL" && <div className="alert info small mt">رسوم الخدمة تخص طلبات المطعم والمقهى — اختر نوع النشاط من إعدادات نقطة البيع.</div>}
      <button className="btn primary mt" disabled={busy} data-svc-save onClick={() => run(async () => { await api("/pos/restaurant/settings", { method: "PUT", body: { serviceCharge: { ...s, pct: Number(s.pct), minGuests: Number(s.minGuests) } } }); onSaved(); }, "حُفظت رسوم الخدمة")}>حفظ</button></div></div>
  );
}

/** Chooses the options of a product's groups before it goes into the cart (POS). */
export type Mod = { groupId: string; optionId: string; name: string; price: number };
export const groupsOf = (groups: any[], p: any) => (groups || []).filter((g) => g.isActive !== false && (g.productIds.includes(p.id) || (p.categoryId && g.categoryIds.includes(p.categoryId))));
export function ModifierPicker({ product, groups, onClose, onPick }: { product: any; groups: any[]; onClose: () => void; onPick: (mods: Mod[]) => void }) {
  const [sel, setSel] = useState<Record<string, string[]>>(() => Object.fromEntries(groups.map((g) => [g.id, g.minSelect === 1 && g.maxSelect === 1 && g.options[0] ? [g.options[0].id] : []])));
  const pick = (g: any, id: string) => setSel((s) => { const cur = s[g.id] || []; if (cur.includes(id)) return { ...s, [g.id]: cur.filter((x) => x !== id) }; if (g.maxSelect === 1) return { ...s, [g.id]: [id] }; return cur.length >= g.maxSelect ? s : { ...s, [g.id]: [...cur, id] }; });
  const missing = groups.filter((g) => (sel[g.id] || []).length < g.minSelect);
  const mods: Mod[] = groups.flatMap((g) => (sel[g.id] || []).map((id) => { const o = g.options.find((x: any) => x.id === id); return { groupId: g.id, optionId: id, name: o.name, price: Number(o.price) }; }));
  const extra = mods.reduce((a, m) => a + m.price, 0);
  return (
    <Modal title={product.name} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>إلغاء</button><button className="btn primary" data-mod-add disabled={missing.length > 0} onClick={() => onPick(mods)}>إضافة — {money(Number(product.salePrice) + extra)}</button></>}>
      <div data-mod-picker>{groups.map((g) => <div key={g.id} className="mb">
        <div className="row" style={{ justifyContent: "space-between" }}><b>{g.name}</b><span className="small muted">{g.minSelect > 0 ? "إلزامي" : "اختياري"}{g.maxSelect > 1 ? ` — حتى ${g.maxSelect}` : ""}</span></div>
        <div className="chips mt">{g.options.map((o: any) => { const on = (sel[g.id] || []).includes(o.id); return <button key={o.id} type="button" className={"chip" + (on ? " on" : "")} aria-pressed={on} onClick={() => pick(g, o.id)}>{o.name}{Number(o.price) ? ` +${money(o.price)}` : ""}</button>; })}</div>
      </div>)}
      {missing.length > 0 && <div className="small muted">اختر من: {missing.map((g) => g.name).join("، ")}</div>}</div>
    </Modal>
  );
}

// ───────────────────────── supplier payment runs ─────────────────────────
const RUN_ST: Record<string, [string, string]> = { DRAFT: ["مسودة", ""], APPROVED: ["معتمدة", "blue"], POSTED: ["مرحّلة", "green"], CANCELLED: ["ملغاة", "red"] };
const RunBadge = ({ s }: { s: string }) => <span className={"badge " + (RUN_ST[s]?.[1] || "")}>{RUN_ST[s]?.[0] || s}</span>;
export function PaymentRunsPage() {
  const runs = useFetch<any[]>("/payment-runs");
  const accounts = useFetch<any>("/accounts");
  const cashBank = (accounts.data?.rows || []).filter((a: any) => a.isCashBank && !a.isGroup && a.isActive !== false);
  const [dueUntil, setDueUntil] = useState(addDays(today(), 7));
  const [partner, setPartner] = useState<any>(null);
  const [prop, setProp] = useState<any>(null);
  const [pick, setPick] = useState<Record<string, number | null>>({});
  const [accountId, setAccountId] = useState("");
  const [payDate, setPayDate] = useState(today());
  const [open, setOpen] = useState<string | null>(null);
  const { run, busy } = useAction();
  useEffect(() => { if (!accountId && cashBank.length) setAccountId((cashBank.find((a: any) => a.systemKey === "BANK") || cashBank[0]).id); }, [cashBank.length]);
  const propose = () => run(async () => { const r = await api(`/payment-runs/propose${q({ dueUntil, partnerId: partner?.id })}`); setProp(r); setPick(Object.fromEntries(r.suppliers.flatMap((s: any) => s.invoices.map((i: any) => [i.invoiceId, i.duplicateOf ? null : i.amount])))); }); // a possible duplicate starts unticked
  const chosen = prop ? prop.suppliers.flatMap((s: any) => s.invoices.filter((i: any) => pick[i.invoiceId] !== null && pick[i.invoiceId] !== undefined && Number(pick[i.invoiceId]) > 0).map((i: any) => ({ invoiceId: i.invoiceId, amount: Number(pick[i.invoiceId]) }))) : [];
  const total = chosen.reduce((a: number, l: any) => a + l.amount, 0);
  return (
    <div className="grid" data-payment-runs>
      <div className="card"><div className="card-h"><div><h3>مقترح سداد الموردين</h3>
        <div className="small muted">يجمع فواتير الموردين المستحقة حتى تاريخ تختاره لكل مورد، فتحذف أو تخفّض ما لا تريد سداده الآن، ثم تحفظ الدفعة. يعتمدها مالك أو مدير غير من أعدّها، ثم تُرحَّل فيصدر سند صرف واحد لكل مورد من البنك المختار مخصصاً على فواتيره.</div></div></div>
        <div className="card-b">
          <div className="form-grid">
            <Field label="الفواتير المستحقة حتى"><Input type="date" value={dueUntil} onChange={(e) => setDueUntil(e.target.value)} data-due-until /></Field>
            <Field label="مورد محدد (اختياري)"><Picker value={partner} onChange={setPartner} fetcher={partnerFetcher("SUPPLIER")} label={(p: any) => p.name} placeholder="كل الموردين" /></Field>
            <Field label=" "><button className="btn" disabled={busy} data-propose onClick={propose}>اقترح الفواتير</button></Field>
          </div>
          {prop && (!prop.suppliers.length ? <Empty text="لا توجد فواتير موردين مستحقة حتى هذا التاريخ" /> : <>
            {prop.duplicates > 0 && <div className="alert err small mt" data-dup-alert>{prop.duplicates === 1 ? "فاتورة واحدة تحمل" : `${prop.duplicates} فواتير تحمل`} رقم فاتورة مورد مسجلاً من قبل لنفس المورد — لم تُحدَّد للسداد. راجعها قبل أن تُدفع مرتين.</div>}
            {prop.foreignLeftOut > 0 && <div className="alert info small mt">{prop.foreignLeftOut} فاتورة بعملة أجنبية لم تُقترح — تُسدَّد بسند صرف بسعر يومها.</div>}
            {prop.suppliers.map((s: any) => <div key={s.partnerId} className="mt" data-prop-supplier>
              <div className="row" style={{ justifyContent: "space-between" }}><b>{s.partnerName}</b><span className="small">{s.wht && <span className="badge amber">ضريبة استقطاع تُخصم عند الصرف</span>} {s.openCredit > 0 && <span className="badge">إشعارات دائنة مفتوحة <Money v={s.openCredit} /></span>}</span></div>
              <div className="table-wrap"><table className="tbl compact"><thead><tr><th></th><th>الفاتورة</th><th>رقم المورد</th><th>الاستحقاق</th><th className="n">المتبقي</th><th className="n" style={{ width: 140 }}>يُسدَّد الآن</th></tr></thead>
                <tbody>{s.invoices.map((i: any) => { const on = pick[i.invoiceId] !== null && pick[i.invoiceId] !== undefined; return <tr key={i.invoiceId} className={on ? "" : "muted"}>
                  <td><input type="checkbox" checked={on} aria-label={`سداد ${i.number}`} onChange={() => setPick({ ...pick, [i.invoiceId]: on ? null : i.amount })} /></td>
                  <td><Link to={`/doc/${i.invoiceId}`} className="num">{i.number}</Link>{i.duplicateOf && <div><span className="badge red" data-dup>مكررة محتملة — نفس الرقم في {i.duplicateOf}</span></div>}</td><td className="small">{i.supplierRef || "—"}</td>
                  <td className="dt">{fmtDate(i.dueDate)}{i.overdueDays > 0 && <span className="badge red"> متأخرة {i.overdueDays} يوم</span>}</td><td className="n"><Money v={i.amount} /></td>
                  <td className="n">{on ? <NumInput value={pick[i.invoiceId] as any} onChange={(e) => setPick({ ...pick, [i.invoiceId]: e.target.value as any })} aria-label={`مبلغ ${i.number}`} /> : "—"}</td></tr>; })}</tbody></table></div></div>)}
            <div className="form-grid mt">
              <Field label="يُسدَّد من"><Select value={accountId} onChange={(e) => setAccountId(e.target.value)} data-run-account>{cashBank.map((a: any) => <option key={a.id} value={a.id}>{a.code} {a.nameAr}</option>)}</Select></Field>
              <Field label="تاريخ السداد"><Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></Field>
              <Field label="الإجمالي"><div className="value num" style={{ fontSize: 20 }} data-run-total><Money v={total} /></div><div className="small muted">{chosen.length} فاتورة</div></Field>
            </div>
            <button className="btn primary mt" disabled={busy || !chosen.length || !accountId} data-save-run onClick={() => run(async () => { const r = await api("/payment-runs", { body: { accountId, payDate, dueUntil, lines: chosen } }); setProp(null); runs.reload(); setOpen(r.id); }, "حُفظت الدفعة — بانتظار الاعتماد")}>حفظ الدفعة للاعتماد</button>
          </>)}
        </div></div>
      <div className="card"><div className="card-h"><h3>دفعات السداد</h3></div><div className="card-b">
        {!runs.data ? <Loading /> : !runs.data.length ? <Empty text="لا توجد دفعات بعد" /> : <div className="table-wrap"><table className="tbl" data-runs>
          <thead><tr><th>الرقم</th><th>تاريخ السداد</th><th>من حساب</th><th className="n">الموردون</th><th className="n">الفواتير</th><th className="n">الإجمالي</th><th>الحالة</th><th>أعدّها / اعتمدها</th></tr></thead>
          <tbody>{runs.data.map((r) => <tr key={r.id} className="clickable" onClick={() => setOpen(r.id)}><td className="num"><b>{r.number}</b></td><td className="dt">{fmtDate(r.payDate)}</td><td>{r.accountName}</td><td className="n">{r.suppliers}</td><td className="n">{r.invoices}</td><td className="n"><Money v={r.total} /></td><td><RunBadge s={r.status} /></td><td className="small">{r.createdBy}{r.approvedBy && <div className="muted">✔ {r.approvedBy}</div>}</td></tr>)}</tbody></table></div>}
      </div></div>
      {open && <RunModal id={open} onClose={() => { setOpen(null); runs.reload(); }} />}
    </div>
  );
}
function RunModal({ id, onClose }: { id: string; onClose: () => void }) {
  const r = useFetch<any>(`/payment-runs/${id}`);
  const { me } = useCompanyContext();
  const { run, busy } = useAction();
  const act = (path: string, msg: string, ask?: string) => (!ask || confirmDlg(ask)) && run(async () => { await api(`/payment-runs/${id}/${path}`, { body: {} }); r.reload(); }, msg);
  const d = r.data;
  return (
    <Modal title={d ? <>دفعة السداد {d.number} <RunBadge s={d.status} /></> : "دفعة السداد"} onClose={onClose} wide footer={d && <>
      {d.status === "DRAFT" && <button className="btn primary" disabled={busy} data-run-approve onClick={() => act("approve", "اعتُمدت الدفعة", `اعتماد سداد ${money(d.total)} لـ${d.suppliers.length} موردين؟`)}>اعتماد</button>}
      {d.status === "APPROVED" && <><button className="btn ghost" disabled={busy} onClick={() => act("reopen", "أُعيدت مسودة")}>إعادة مسودة</button><button className="btn primary" disabled={busy} data-run-post onClick={() => act("post", "رُحّلت الدفعة وصدرت سندات الصرف", `ترحيل الدفعة وإصدار ${d.suppliers.length} سند صرف من ${d.accountName}؟`)}>ترحيل وإصدار السندات</button></>}
      {d.status !== "CANCELLED" && <button className="btn ghost danger" disabled={busy} onClick={() => act("cancel", "أُلغيت الدفعة", d.status === "POSTED" ? "إلغاء الدفعة يلغي سندات الصرف التي صدرت منها بقيود عكسية. متابعة؟" : "إلغاء الدفعة؟")}>إلغاء الدفعة</button>}
      <button className="btn ghost" onClick={() => window.print()}>طباعة</button></>}>
      {!d ? <Loading /> : <div className="print-doc" data-run-detail>
        <div className="grid c3">
          <div className="card kpi"><div className="label">الإجمالي</div><div className="value"><Money v={d.total} /></div><div className="sub">{d.suppliers.length} موردين</div></div>
          <div className="card kpi"><div className="label">يُسدَّد من</div><div className="value" style={{ fontSize: 16 }}>{d.accountCode} {d.accountName}</div><div className="sub">بتاريخ {fmtDate(d.payDate)}</div></div>
          <div className={"card kpi " + (d.shortfall > 0 ? "danger" : "")}><div className="label">رصيد الحساب الآن</div><div className="value"><Money v={d.accountBalance} /></div>{d.shortfall > 0 && <div className="sub">لا يكفي — ينقص <Money v={d.shortfall} /></div>}</div>
        </div>
        <div className="small muted mt">أعدّها {d.createdBy} — {fmtDT(d.createdAt)}{d.approvedBy && ` · اعتمدها ${d.approvedBy} — ${fmtDT(d.approvedAt)}`}{d.postedAt && ` · رُحّلت ${fmtDT(d.postedAt)}`}</div>
        {d.status === "DRAFT" && d.createdBy === me.user?.fullName && <div className="alert info small mt">الاعتماد لمالك أو مدير آخر غير من أعدّ الدفعة (فصل المهام)، إلا إذا لم يكن في المنشأة غيرك.</div>}
        {d.suppliers.map((s: any) => <div key={s.partnerId} className="mt">
          <div className="row" style={{ justifyContent: "space-between" }}><b>{s.partnerName}</b><span className="num"><Money v={s.total} />{s.paymentNumber && <> · سند <b>{s.paymentNumber}</b>{s.wht > 0 && <> · استقطاع <Money v={s.wht} /> · صافي <Money v={s.netPaid} /></>}{s.paymentStatus === "CANCELLED" && <span className="badge red"> ملغى</span>}</>}</span></div>
          <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الفاتورة</th><th>رقم المورد</th><th>الاستحقاق</th><th className="n">المبلغ</th></tr></thead>
            <tbody>{s.invoices.map((i: any) => <tr key={i.id}><td><Link to={`/doc/${i.invoiceId}`} className="num">{i.number}</Link>{i.duplicateOf && <div><span className="badge red" data-dup>مكررة محتملة — نفس الرقم في {i.duplicateOf}</span></div>}</td><td className="small">{i.supplierRef || "—"}</td><td className="dt">{fmtDate(i.dueDate)}</td><td className="n"><Money v={i.amount} /></td></tr>)}</tbody></table></div></div>)}
      </div>}
    </Modal>
  );
}

// ───────────────────────── cash flow forecast ─────────────────────────
export function CashForecastPage() {
  const [weeks, setWeeks] = useState(13);
  const [rate, setRate] = useState(100);
  const [sales, setSales] = useState(false);
  const [d, setD] = useState<any>(null);
  const [week, setWeek] = useState<any>(null);
  const seq = useRef(0);
  useEffect(() => { const n = ++seq.current; api(`/reports/cash-forecast${q({ weeks, overdueRate: rate, cashSales: sales ? 1 : undefined })}`).then((x) => n === seq.current && setD(x)).catch(() => undefined); }, [weeks, rate, sales]);
  const max = d ? Math.max(1, ...d.buckets.map((b: any) => Math.max(b.inflow, b.outflow))) : 1; // bars compare the weeks' movements; the balance is the number under each bar
  return (
    <div className="grid" data-forecast>
      <div className="card"><div className="card-h"><div><h3>توقع التدفق النقدي</h3>
        <div className="small muted">رصيد الصناديق والبنوك اليوم، ثم كل أسبوع ما يُتوقع دخوله وخروجه من الدفاتر: فواتير العملاء والموردين بتواريخ استحقاقها، الشيكات، دفعات السداد المعتمدة، الرواتب (متوسط آخر المسيرات)، دفعات الإيجار، المصروفات الدورية، وضريبة القيمة المضافة في موعد إقرارها. المتأخر يُحسب في الأسبوع الأول.</div></div></div>
        <div className="card-b"><div className="form-grid">
          <Field label="عدد الأسابيع"><Select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>{[4, 8, 13, 26].map((w) => <option key={w} value={w}>{w}</option>)}</Select></Field>
          <Field label="نسبة تحصيل المتأخر %" hint="من فواتير العملاء التي تجاوزت استحقاقها"><NumInput value={rate} onChange={(e) => setRate(Number(e.target.value))} data-overdue-rate /></Field>
          <Field label=" "><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={sales} onChange={(e) => setSales(e.target.checked)} data-cash-sales /> إضافة متوسط مبيعات نقطة البيع الأسبوعية (آخر 8 أسابيع)</label></Field>
        </div>
        {!d ? <Loading /> : <>
          <div className="grid c4 mt">
            <div className="card kpi"><div className="label">الرصيد اليوم</div><div className="value"><Money v={d.opening} /></div></div>
            <div className="card kpi success"><div className="label">الداخل المتوقع</div><div className="value"><Money v={d.totals.inflow} /></div></div>
            <div className="card kpi accent"><div className="label">الخارج المتوقع</div><div className="value"><Money v={d.totals.outflow} /></div></div>
            <div className={"card kpi " + (d.lowest.closing < 0 ? "danger" : "")}><div className="label">أدنى رصيد</div><div className="value"><Money v={d.lowest.closing} /></div><div className="sub">الأسبوع {d.lowest.week} ({fmtDate(d.lowest.from)})</div></div>
          </div>
          {d.warnings.map((w: string, i: number) => <div key={i} className={"alert small mt " + (i === 0 && d.firstNegative ? "err" : "info")}>{w}</div>)}
          <div className="fc-chart mt" role="img" aria-label="الرصيد المتوقع أسبوعاً بأسبوع" data-fc-chart>{d.buckets.map((b: any) => <button key={b.week} type="button" className="fc-col" onClick={() => setWeek(b)} title={`الأسبوع ${b.week}: داخل ${money(b.inflow)} — خارج ${money(b.outflow)} — الرصيد ${money(b.closing)}`}>
            <span className="fc-bars"><i className="in" style={{ height: `${(b.inflow / max) * 100}%` }} /><i className="out" style={{ height: `${(b.outflow / max) * 100}%` }} /></span>
            <span className={"fc-bal num" + (b.closing < 0 ? " neg" : "")}>{Math.round(b.closing).toLocaleString("en")}</span><span className="small muted">أ{b.week}</span></button>)}</div>
          <div className="small muted"><span className="fc-key in" /> داخل <span className="fc-key out" /> خارج — والرقم تحت كل عمود رصيد آخر الأسبوع. اضغط عموداً لتفاصيله.</div>
          <div className="table-wrap mt"><table className="tbl compact" data-fc-table>
            <thead><tr><th>الأسبوع</th><th className="n">أول الأسبوع</th><th className="n">العملاء</th><th className="n">شيكات واردة</th>{d.assumptions.cashSales && <th className="n">مبيعات نقدية</th>}<th className="n">الموردون</th><th className="n">شيكات صادرة</th><th className="n">الرواتب</th><th className="n">الإيجار</th><th className="n">دورية</th><th className="n">الضريبة</th><th className="n">آخر الأسبوع</th></tr></thead>
            <tbody>{d.buckets.map((b: any) => <tr key={b.week} className={"clickable" + (b.closing < 0 ? " warn-row" : "")} onClick={() => setWeek(b)}><td className="dt">{b.week} · {fmtDate(b.from)}</td><td className="n"><Money v={b.opening} /></td>
              <td className="n"><Money v={b.in.ar} blankZero /></td><td className="n"><Money v={b.in.cheques} blankZero /></td>{d.assumptions.cashSales && <td className="n"><Money v={b.in.cashSales} blankZero /></td>}
              <td className="n"><Money v={b.out.ap} blankZero /></td><td className="n"><Money v={b.out.cheques} blankZero /></td><td className="n"><Money v={b.out.payroll} blankZero /></td><td className="n"><Money v={b.out.leases} blankZero /></td><td className="n"><Money v={b.out.recurring} blankZero /></td><td className="n"><Money v={b.out.vat} blankZero /></td><td className="n"><b><Money v={b.closing} /></b></td></tr>)}</tbody></table></div>
          <details className="fold mt"><summary>الصناديق والبنوك ({d.accounts.length})</summary><div className="table-wrap"><table className="tbl compact"><tbody>{d.accounts.map((a: any) => <tr key={a.code}><td>{a.code} {a.name}</td><td className="n"><Money v={a.balance} /></td></tr>)}</tbody></table></div></details>
          <div className="small muted mt">توقع من الدفاتر وليس وعداً: {d.assumptions.payrollRuns > 0 ? <>الرواتب بمتوسط آخر {d.assumptions.payrollRuns} مسيرات، </> : <>لا مسيرات رواتب مرحّلة فلا رواتب في التوقع، </>}والمبالغ دون ضريبة دفعات الإيجار، والعملاء الذين لم يحلّ استحقاقهم يُفترض أنهم يسددون في موعدهم.</div>
        </>}</div></div>
      {week && <Modal title={`الأسبوع ${week.week}: ${fmtDate(week.from)} — ${fmtDate(week.to)}`} onClose={() => setWeek(null)} wide>
        <div className="grid c3"><div className="card kpi success"><div className="label">داخل</div><div className="value"><Money v={week.inflow} /></div></div><div className="card kpi accent"><div className="label">خارج</div><div className="value"><Money v={week.outflow} /></div></div><div className="card kpi"><div className="label">الرصيد آخر الأسبوع</div><div className="value"><Money v={week.closing} /></div></div></div>
        {!week.items.length ? <Empty text="لا حركات متوقعة في هذا الأسبوع" /> : <div className="table-wrap mt"><table className="tbl compact" data-week-items><thead><tr><th>التاريخ</th><th>البند</th><th className="n">داخل</th><th className="n">خارج</th></tr></thead>
          <tbody>{week.items.map((x: any, i: number) => <tr key={i}><td className="dt">{fmtDate(x.date)}</td><td>{x.to ? <Link to={x.to}>{x.label}</Link> : x.label}{x.kind.endsWith("OVERDUE") && <span className="badge red"> متأخر</span>}</td><td className="n">{x.dir === "IN" ? <Money v={x.amount} /> : ""}</td><td className="n">{x.dir === "OUT" ? <Money v={x.amount} /> : ""}</td></tr>)}</tbody></table></div>}
      </Modal>}
    </div>
  );
}

// ───────────────────────── smart auditor ─────────────────────────
const SEV: Record<string, [string, string]> = { high: ["عالية", "red"], medium: ["متوسطة", "amber"], low: ["منخفضة", "blue"], info: ["معلومة", ""] };
export function AuditorPage() {
  const [from, setFrom] = useState(addDays(today(), -90));
  const [to, setTo] = useState(today());
  const [all, setAll] = useState(false);
  const [kind, setKind] = useState("");
  const [d, setD] = useState<any>(null);
  const [why, setWhy] = useState<any>(null);
  const { run, busy } = useAction();
  const load = () => api(`/auditor${q({ from, to, all: all ? 1 : undefined })}`).then(setD).catch(() => undefined);
  useEffect(() => { load(); }, [from, to, all]);
  const list = useMemo(() => (d?.findings || []).filter((f: any) => !kind || f.kind === kind), [d, kind]);
  return (
    <div className="grid" data-auditor>
      <div className="card"><div className="card-h"><div><h3>المدقق الذكي</h3>
        <div className="small muted">فحوص يجريها المراجع الخارجي على دفتر اليومية، تعمل على دفاترك مباشرة: فواتير ومصروفات وسندات مكررة محتملة، قيود يدوية في العطلة أو ليلاً أو بمبالغ مقرّبة أو على حسابات لها دفاتر مساعدة أو بتواريخ قديمة، مصروفات أعلى كثيراً من معتادها، بيع بأقل من التكلفة، مرتجعات عالية لعميل، صندوق سالب، وتوزيع الأرقام الأولى (قانون بنفورد). كل ملاحظة تقول لماذا ظهرت وأين تنظر؛ وما راجعته وتأكدت منه تعلّمه «مبرَّرة» مع السبب فيختفي.</div></div>
          <div className="row" style={{ gap: 8 }}><Field label="من"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="إلى"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div></div>
        <div className="card-b">{!d ? <Loading /> : <>
          <div className="grid c4">
            <div className={"card kpi " + (d.level === "good" ? "success" : d.level === "critical" ? "danger" : "accent")}><div className="label">مؤشر سلامة القيود</div><div className="value" data-audit-score>{d.score}<span className="small"> / 100</span></div><div className="sub">{d.level === "good" ? "جيد" : d.level === "critical" ? "يحتاج مراجعة عاجلة" : "يحتاج انتباهاً"}</div></div>
            <div className="card kpi"><div className="label">أهمية عالية</div><div className="value">{d.counts.high}</div></div>
            <div className="card kpi"><div className="label">متوسطة / منخفضة</div><div className="value">{d.counts.medium} / {d.counts.low}</div></div>
            <div className="card kpi"><div className="label">ما فُحص</div><div className="value" style={{ fontSize: 16 }}>{d.tested.manualEntries} قيداً يدوياً</div><div className="sub">{d.tested.amounts} مبلغ مشتريات ومصروفات · {d.counts.dismissed} مبرَّرة</div></div>
          </div>
          <div className="chips mt" data-audit-kinds><button type="button" className={"chip" + (!kind ? " on" : "")} onClick={() => setKind("")}>الكل ({d.findings.length})</button>{d.byKind.filter((k: any) => k.count).map((k: any) => <button type="button" key={k.kind} className={"chip" + (kind === k.kind ? " on" : "")} onClick={() => setKind(k.kind)} title={k.why}>{k.title} ({k.count})</button>)}</div>
          <label className="row small mt" style={{ gap: 6 }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> عرض الملاحظات المبرَّرة أيضاً</label>
          {!list.length ? <div className="alert ok mt">لا توجد ملاحظات في هذه الفترة{kind ? " من هذا النوع" : ""}.</div> : <div className="table-wrap mt"><table className="tbl" data-findings>
            <thead><tr><th>الأهمية</th><th>الملاحظة</th><th>التاريخ</th><th className="n">المبلغ</th><th></th></tr></thead>
            <tbody>{list.map((f: any) => <tr key={f.kind + f.ref} className={f.dismissed ? "muted" : ""}><td><span className={"badge " + SEV[f.severity][1]}>{SEV[f.severity][0]}</span></td>
              <td><b>{f.title}</b><div className="small">{f.detail}</div><div className="small muted">{f.why}</div>{f.dismissed && <div className="small">✔ مبرَّرة: {f.dismissed.note} — {f.dismissed.dismissedBy}{(f.dismissed.files || []).map((a: any) => <button key={a.id} className="btn sm ghost" data-dismiss-att title={a.name} onClick={async () => { const r: any = await api(`/attachments/file/${a.id}`, { raw: true }); const b = await r.blob(); window.open(URL.createObjectURL(b), "_blank"); }}>📎 {a.name}</button>)}</div>}</td>
              <td className="dt">{f.date ? fmtDate(f.date) : ""}</td><td className="n">{f.amount !== undefined ? <Money v={f.amount} /> : ""}</td>
              <td className="nowrap">{f.to && <Link className="btn sm ghost" to={f.to}>فتح</Link>}{f.dismissed ? <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { await api("/auditor/undismiss", { body: { kind: f.kind, ref: f.ref } }); await load(); })}>إعادة</button> : <button className="btn sm ghost" data-dismiss onClick={() => setWhy(f)}>مبرَّرة</button>}</td></tr>)}</tbody></table></div>}
          {d.benford.n >= 30 && <details className="fold mt" data-benford><summary>توزيع الأرقام الأولى — قانون بنفورد ({d.benford.n} مبلغاً، متوسط الانحراف {d.benford.mad})</summary>
            <div className="small muted mb">في البيانات المالية الطبيعية يبدأ نحو 30% من المبالغ بالرقم 1 و4.6% فقط بالرقم 9. الانحراف لا يثبت خطأً لكنه يدل أين تبحث. {d.benford.n < 200 && "العينة أقل من 200 مبلغ فالنتيجة إرشادية."}</div>
            <div className="fc-chart" role="img" aria-label="الفعلي مقابل المتوقع لكل رقم">{d.benford.digits.map((x: any) => <div key={x.digit} className="fc-col"><span className="fc-bars"><i className="in" style={{ height: `${x.actual * 3}%` }} /><i className="exp" style={{ height: `${x.expected * 3}%` }} /></span><span className="num small">{x.actual}%</span><b>{x.digit}</b></div>)}</div>
            <div className="small muted"><span className="fc-key in" /> الفعلي <span className="fc-key exp" /> المتوقع</div></details>}
        </>}</div></div>
      {why && <DismissModal f={why} onClose={() => setWhy(null)} onDone={() => { setWhy(null); load(); }} />}
    </div>
  );
}
function DismissModal({ f, onClose, onDone }: { f: any; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const { run, busy } = useAction();
  return <Modal title="ملاحظة مبرَّرة" onClose={onClose} narrow footer={<><button className="btn ghost" onClick={onClose}>إلغاء</button><button className="btn primary" disabled={busy || note.trim().length < 3} data-dismiss-save onClick={() => run(async () => { const r = await api("/auditor/dismiss", { body: { kind: f.kind, ref: f.ref, note } }); if (file && r?.id) { if (file.size > 8 * 1024 * 1024) throw new Error("الملف أكبر من 8 ميجابايت"); const data: string = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(file); }); await api(`/attachments/audit/${r.id}`, { body: { name: file.name, mime: file.type || "application/octet-stream", data } }); } onDone(); }, "حُفظت")}>حفظ</button></>}>
    <div className="small mb"><b>{f.title}</b> — {f.detail}</div>
    <Field label="ما الذي تحققت منه؟"><Input value={note} onChange={(e) => setNote(e.target.value)} autoFocus placeholder="مثال: فاتورتان مختلفتان، راجعت المستند الأصلي" data-dismiss-note /></Field>
    <Field label="مستند مؤيد (اختياري)" hint="صورة أو PDF يثبت ما تحققت منه — ليس شرطاً"><input type="file" data-dismiss-file accept="image/*,application/pdf,.xlsx,.docx,.csv,.txt" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
  </Modal>;
}

/** Suggested expense accounts from the establishment's own history (payee first, then similar descriptions). */
export function AccountSuggest({ payee, partnerId, description, current, onPick }: { payee?: string; partnerId?: string; description?: string; current?: string; onPick: (a: { id: string; code: string; nameAr: string }) => void }) {
  const [s, setS] = useState<any[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    if (!payee && !partnerId && String(description || "").trim().length < 3) { setS([]); return; }
    const tm = setTimeout(() => api(`/expenses/suggest-account${q({ payee, partnerId, description })}`).then((r) => n === seq.current && setS(r.suggestions || [])).catch(() => undefined), 350);
    return () => clearTimeout(tm);
  }, [payee, partnerId, description]);
  const shown = s.filter((x) => x.accountId !== current);
  if (!shown.length) return null;
  return <div className="chips small" data-account-suggest><span className="muted">✨ مقترح:</span>{shown.map((x) => <button type="button" key={x.accountId} className="chip" title={x.reason} onClick={() => onPick({ id: x.accountId, code: x.code, nameAr: x.name })}>{x.code} {x.name}</button>)}</div>;
}
