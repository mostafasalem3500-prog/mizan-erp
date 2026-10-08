import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, useFetch, Money, money, Loading, Empty, Badge, Modal, Field, Input, useAction, useToast, useCompanyContext, PrintBtn, fmtDate, fmtDT, confirmDlg } from "../lib";

// ─── Settings tab: API keys, webhooks, docs ────────────────────────────────
export function IntegrationsTab() {
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const toast = useToast();
  const { data, reload } = useFetch("/integrations");
  const [newKey, setNewKey] = useState<any>(null);
  const [keyForm, setKeyForm] = useState<any>(null);
  const [hookForm, setHookForm] = useState<any>(null);
  const [deliveries, setDeliveries] = useState<any>(null);
  const base = location.origin;
  if (!data) return <Loading />;
  const copy = (t: string) => { navigator.clipboard?.writeText(t); toast("تم النسخ", "ok"); };
  return (
    <div className="grid">
      <div className="card"><div className="card-h"><div><h3>مفاتيح الواجهة البرمجية (API)</h3><div className="small muted">لربط متجرك الإلكتروني أو موقعك أو أي نظام آخر بميزان: قراءة الأصناف والمخزون والعملاء، وإرسال الطلبات لتصبح فواتير مرحّلة تلقائياً</div></div>{can("settings.write") && <button className="btn primary sm" onClick={() => setKeyForm({ name: "", write: true })}>＋ مفتاح جديد</button>}</div>
        {!data.keys.length ? <Empty text="لا توجد مفاتيح" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الاسم</th><th>المفتاح</th><th>الصلاحية</th><th>آخر استخدام</th><th>أُنشئ</th><th>الحالة</th><th /></tr></thead>
          <tbody>{data.keys.map((k: any) => <tr key={k.id} className={k.isActive ? "" : "muted"}><td><b>{k.name}</b></td><td className="num" dir="ltr">{k.prefix}…</td><td>{k.scopes.includes("write") ? "قراءة وكتابة" : "قراءة فقط"}</td><td>{k.lastUsedAt ? fmtDT(k.lastUsedAt) : "—"}</td><td className="dt">{fmtDate(k.createdAt)} · {k.createdBy}</td><td><Badge s={k.isActive ? "ACTIVE" : "CANCELLED"} map={{ ACTIVE: "فعّال", CANCELLED: "ملغى" }} /></td><td>{k.isActive && can("settings.write") && <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { if (confirmDlg(`إلغاء المفتاح «${k.name}»؟ ستتوقف الأنظمة المرتبطة به فوراً.`)) { await api(`/integrations/keys/${k.id}/revoke`, { body: {} }); reload(); } })}>إلغاء</button>}</td></tr>)}</tbody></table></div>}
      </div>

      <div className="card"><div className="card-h"><div><h3>إشعارات Webhooks</h3><div className="small muted">يرسل ميزان طلب POST موقّعاً (HMAC-SHA256) إلى رابطك عند وقوع الأحداث المختارة، مع إعادة محاولة تلقائية عند الفشل</div></div>{can("settings.write") && <button className="btn primary sm" onClick={() => setHookForm({ url: "", events: ["invoice.posted"] })}>＋ Webhook</button>}</div>
        {!data.webhooks.length ? <Empty text="لا توجد Webhooks" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الرابط</th><th>الأحداث</th><th>آخر إرسال</th><th>المفتاح السري</th><th /></tr></thead>
          <tbody>{data.webhooks.map((w: any) => <tr key={w.id} className={w.isActive ? "" : "muted"}><td className="num small" dir="ltr" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>{w.url}</td><td className="small">{w.events.map((e: string) => data.events[e] || e).join("، ")}</td><td>{w.last ? <><Badge s={w.last.ok ? "POSTED" : "FAILED"} map={{ POSTED: `نجح ${w.last.status}`, FAILED: `فشل ${w.last.status || ""}` }} /><div className="small muted">{fmtDT(w.last.at)}</div></> : "—"}</td><td><button className="btn sm ghost" onClick={() => copy(w.secret)}>نسخ</button></td>
            <td className="row" style={{ gap: 4 }}><button className="btn sm" onClick={() => setDeliveries(w)}>السجل</button>{can("settings.write") && <><button className="btn sm" disabled={busy} onClick={() => run(async () => { const r = await api(`/integrations/webhooks/${w.id}/test`, { body: {} }); toast(r.ok ? `نجح الاختبار (${r.status})` : `فشل: ${r.status || ""} ${r.response || ""}`, r.ok ? "ok" : "err"); reload(); })}>اختبار</button><button className="btn sm ghost" onClick={() => run(async () => { await api(`/integrations/webhooks/${w.id}`, { method: "PUT", body: { isActive: !w.isActive } }); reload(); })}>{w.isActive ? "إيقاف" : "تفعيل"}</button><button className="btn sm ghost" onClick={() => run(async () => { if (confirmDlg("حذف الـ Webhook؟")) { await api(`/integrations/webhooks/${w.id}`, { method: "DELETE" }); reload(); } })}>حذف</button></>}</td></tr>)}</tbody></table></div>}
      </div>

      <div className="card"><div className="card-h"><h3>دليل الربط السريع</h3></div><div className="card-b">
        <div className="small" style={{ lineHeight: 1.9 }}>
          <div>العنوان الأساسي: <code dir="ltr">{base}/api/v1</code> — أرسل المفتاح في الترويسة <code dir="ltr">X-API-Key: mzn_live_…</code> أو <code dir="ltr">Authorization: Bearer mzn_live_…</code> (حد 120 طلباً/دقيقة).</div>
          <table className="tbl compact mt" dir="ltr" style={{ textAlign: "left" }}><tbody>
            {[["GET", "/me", "بيانات المنشأة والمفتاح"], ["GET", "/products?q=&sku=&limit=&offset=", "الأصناف مع السعر والمخزون والعبوات"], ["GET", "/stock", "الأرصدة حسب المستودع"], ["GET", "/partners?q=&role=CUSTOMER", "العملاء/الموردون"], ["POST", "/partners", "إضافة عميل (يُطابَق بالجوال/البريد)"], ["POST", "/orders", "طلب ← فاتورة مرحّلة (مع سداد اختياري)، idempotent بـ externalRef"], ["GET", "/invoices?from=&to=&externalRef=", "قائمة المستندات"], ["GET", "/invoices/:id", "تفاصيل مستند"], ["POST", "/payments", "سند قبض/صرف"]].map(([m, path, d]) => <tr key={path}><td><b>{m}</b></td><td><code>{path}</code></td><td dir="rtl" style={{ textAlign: "right" }}>{d}</td></tr>)}
          </tbody></table>
          <div className="mt"><b>مثال طلب من متجر:</b></div>
          <pre dir="ltr" style={{ background: "#0f1f1e", color: "#d1fae5", padding: 12, borderRadius: 8, overflow: "auto", fontSize: 12 }}>{`curl -X POST ${base}/api/v1/orders \\
  -H "X-API-Key: mzn_live_..." -H "Content-Type: application/json" \\
  -d '{"externalRef":"STORE-1045",
       "customer":{"name":"نورة","phone":"0551234567","email":"n@example.com","city":"الرياض"},
       "lines":[{"sku":"BV-001","qty":2},{"barcode":"6281000000401","qty":1}],
       "shipping":25,
       "payment":{"method":"CARD","amount":120.75,"reference":"PAY-77"}}'`}</pre>
          <div><b>التحقق من توقيع Webhook:</b> احسب <code dir="ltr">HMAC_SHA256(secret, timestamp + "." + body)</code> وقارنه بالترويسة <code dir="ltr">X-Mizan-Signature: sha256=…</code> مع <code dir="ltr">X-Mizan-Timestamp</code> و<code dir="ltr">X-Mizan-Event</code>.</div>
          <div className="mt">الأحداث المتاحة: {Object.entries(data.events).map(([k, v]: any) => <span key={k} className="badge blue" style={{ margin: 2 }}>{k} — {v}</span>)}</div>
        </div>
      </div></div>

      {keyForm && <Modal narrow title="مفتاح API جديد" onClose={() => setKeyForm(null)} footer={<><button className="btn" onClick={() => setKeyForm(null)}>إلغاء</button><button className="btn primary" disabled={busy || !keyForm.name} onClick={() => run(async () => { const k = await api("/integrations/keys", { body: { name: keyForm.name, scopes: keyForm.write ? ["read", "write"] : ["read"] } }); setKeyForm(null); setNewKey(k); reload(); })}>إنشاء</button></>}>
        <div className="grid"><Field label="اسم المفتاح (الجهة المرتبطة)"><Input autoFocus value={keyForm.name} onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })} placeholder="مثال: متجر سلة، موقع الشركة" /></Field><label className="check"><input type="checkbox" checked={keyForm.write} onChange={(e) => setKeyForm({ ...keyForm, write: e.target.checked })} /> السماح بالكتابة (إنشاء طلبات وعملاء وسندات)</label></div>
      </Modal>}
      {newKey && <Modal narrow title="انسخ المفتاح الآن" onClose={() => setNewKey(null)} footer={<button className="btn primary" onClick={() => setNewKey(null)}>تم</button>}>
        <div className="alert warn">لن يظهر هذا المفتاح مرة أخرى — احفظه في مكان آمن.</div>
        <div className="row"><code dir="ltr" style={{ wordBreak: "break-all", flex: 1, background: "#f1f5f4", padding: 8, borderRadius: 6 }}>{newKey.key}</code><button className="btn sm" onClick={() => copy(newKey.key)}>نسخ</button></div>
      </Modal>}
      {hookForm && <Modal narrow title="Webhook جديد" onClose={() => setHookForm(null)} footer={<><button className="btn" onClick={() => setHookForm(null)}>إلغاء</button><button className="btn primary" disabled={busy || !hookForm.url || !hookForm.events.length} onClick={() => run(async () => { await api("/integrations/webhooks", { body: hookForm }); setHookForm(null); reload(); }, "تمت الإضافة")}>حفظ</button></>}>
        <div className="grid"><Field label="رابط الاستقبال (https)"><Input autoFocus dir="ltr" value={hookForm.url} onChange={(e) => setHookForm({ ...hookForm, url: e.target.value })} placeholder="https://example.com/webhooks/mizan" /></Field>
          <Field label="الأحداث">{Object.entries(data.events).map(([k, v]: any) => <label key={k} className="check" style={{ display: "flex" }}><input type="checkbox" checked={hookForm.events.includes(k)} onChange={(e) => setHookForm({ ...hookForm, events: e.target.checked ? [...hookForm.events, k] : hookForm.events.filter((x: string) => x !== k) })} /> {v} <span className="muted small" dir="ltr">({k})</span></label>)}</Field></div>
      </Modal>}
      {deliveries && <DeliveriesModal hook={deliveries} onClose={() => setDeliveries(null)} />}
    </div>
  );
}

function DeliveriesModal({ hook, onClose }: { hook: any; onClose: () => void }) {
  const { run, busy } = useAction();
  const { data, reload } = useFetch(`/integrations/webhooks/${hook.id}/deliveries`);
  const [view, setView] = useState<any>(null);
  return (
    <Modal wide title="سجل إرسال الإشعارات" onClose={onClose}>
      {!data ? <Loading /> : !data.length ? <Empty text="لم يُرسل شيء بعد" /> : <div className="table-wrap" style={{ maxHeight: 420 }}><table className="tbl compact"><thead><tr><th>الوقت</th><th>الحدث</th><th>الحالة</th><th>المحاولات</th><th>الرد</th><th /></tr></thead>
        <tbody>{data.map((d: any) => <tr key={d.id}><td>{fmtDT(d.createdAt)}</td><td className="num" dir="ltr">{d.event}</td><td><Badge s={d.ok ? "POSTED" : "FAILED"} map={{ POSTED: `${d.status}`, FAILED: `فشل ${d.status || ""}` }} /></td><td className="n">{d.attempts}</td><td className="small" dir="ltr" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{d.response}</td><td className="row" style={{ gap: 4 }}><button className="btn sm" onClick={() => setView(d)}>المحتوى</button><button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { await api(`/integrations/deliveries/${d.id}/redeliver`, { body: {} }); reload(); })}>إعادة</button></td></tr>)}</tbody></table></div>}
      {view && <pre dir="ltr" style={{ background: "#f1f5f4", padding: 10, borderRadius: 8, maxHeight: 300, overflow: "auto", fontSize: 11 }}>{JSON.stringify(view.payload, null, 2)}</pre>}
    </Modal>
  );
}

// ─── Partner portal link button (used in partner list / statement) ────────
export function PortalLinkBtn({ partner }: { partner: any }) {
  const { run, busy } = useAction();
  const toast = useToast();
  const [link, setLink] = useState<string | null>(null);
  const make = () => run(async () => { const r = await api(`/partners/${partner.id}/portal`, { body: {} }); setLink(location.origin + r.path); });
  const wa = () => { if (!link) return; let ph = String(partner.phone || "").replace(/\D/g, ""); if (ph.startsWith("05")) ph = "966" + ph.slice(1); window.open(`https://wa.me/${ph}?text=${encodeURIComponent(`مرحباً ${partner.name}، يمكنكم الاطلاع على كشف حسابكم وفواتيركم لدينا عبر الرابط:\n${link}`)}`, "_blank"); };
  if (!link) return <button className="btn sm" disabled={busy} onClick={make} title="رابط خاص يعرض للعميل كشف حسابه وفواتيره">🔗 بوابة العميل</button>;
  return <span className="row" style={{ gap: 4 }}><button className="btn sm" onClick={() => { navigator.clipboard?.writeText(link); toast("تم نسخ رابط البوابة", "ok"); }}>نسخ الرابط</button>{partner.phone && <button className="btn sm" onClick={wa}>واتساب</button>}<button className="btn sm ghost" onClick={() => run(async () => { if (confirmDlg("إلغاء الرابط الحالي؟ سيتوقف عن العمل.")) { await api(`/partners/${partner.id}/portal`, { method: "DELETE" }); setLink(null); } }, "تم إلغاء الرابط")}>إلغاء</button></span>;
}

// ─── Public customer portal page (/c/:token) ───────────────────────────────
export function CustomerPortal() {
  const { token } = useParams();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api(`/public/portal/${token}`).then(setD).catch((e) => setErr(e.message)); }, [token]);
  if (err) return <div className="empty" style={{ paddingTop: 80 }}>{err}</div>;
  if (!d) return <Loading />;
  const c = d.company;
  const dueTotal = d.open.reduce((a: number, i: any) => a + Number(i.due), 0);
  return (
    <div style={{ padding: 16, maxWidth: 960, margin: "0 auto" }} className="grid">
      <div className="card"><div className="card-b row between" style={{ alignItems: "center" }}>
        <div className="row">{c.logo ? <img src={c.logo} style={{ height: 52 }} alt="" /> : <img src="/favicon.svg" width={40} alt="" />}<div><h2 style={{ margin: 0 }}>{c.nameAr}</h2><div className="small muted">{[c.city, c.phone, c.email].filter(Boolean).join(" · ")}{c.vatNumber ? ` · الرقم الضريبي ${c.vatNumber}` : ""}</div></div></div>
        <div style={{ textAlign: "start" }}><div className="small muted">{d.role === "CUSTOMER" ? "بوابة العميل" : "بوابة المورد"}</div><b style={{ fontSize: 18 }}>{d.partner.name}</b></div>
      </div></div>
      <div className="grid c3">
        <div className="card kpi"><div className="label">الرصيد الحالي</div><div className="value"><Money v={d.statement.closing} /></div><div className="sub">ر.س</div></div>
        <div className="card kpi info"><div className="label">فواتير مفتوحة</div><div className="value">{d.open.length}</div><div className="sub">بإجمالي {money(dueTotal)} ر.س</div></div>
        <div className={"card kpi " + (d.overdue > 0 ? "danger" : "success")}><div className="label">متأخر عن موعده</div><div className="value"><Money v={d.overdue} /></div></div>
      </div>
      {!!d.open.length && <div className="card"><div className="card-h"><h3>الفواتير المستحقة</h3></div><div className="table-wrap"><table className="tbl compact"><thead><tr><th>الفاتورة</th><th>التاريخ</th><th>الاستحقاق</th><th className="n">الإجمالي</th><th className="n">المتبقي</th><th /></tr></thead>
        <tbody>{d.open.map((i: any) => <tr key={i.number}><td><b>{i.number}</b></td><td className="dt">{fmtDate(i.date)}</td><td className={String(i.dueDate).slice(0, 10) < new Date().toISOString().slice(0, 10) ? "neg-val" : ""}>{fmtDate(i.dueDate)}</td><td className="n"><Money v={i.total} /></td><td className="n"><b><Money v={i.due} /></b></td><td><a className="btn sm" href={`/p/${i.shareToken}`} target="_blank" rel="noreferrer">عرض / طباعة</a></td></tr>)}</tbody></table></div></div>}
      <div className="card"><div className="card-h"><div><h3>كشف الحساب</h3><div className="small muted">من {fmtDate(d.from)} حتى اليوم</div></div><PrintBtn /></div>
        <div className="table-wrap"><table className="tbl compact"><thead><tr><th>التاريخ</th><th>المستند</th><th>البيان</th><th className="n">مدين</th><th className="n">دائن</th><th className="n">الرصيد</th></tr></thead>
          <tbody><tr><td colSpan={5}>رصيد أول المدة</td><td className="n"><Money v={d.statement.opening} /></td></tr>{d.statement.rows.map((r: any, i: number) => <tr key={i}><td className="dt">{fmtDate(r.date)}</td><td>{r.number}</td><td>{r.memo}</td><td className="n"><Money v={r.debit} blankZero /></td><td className="n"><Money v={r.credit} blankZero /></td><td className="n"><Money v={r.balance} /></td></tr>)}</tbody>
          <tfoot><tr><td colSpan={5}>الرصيد</td><td className="n"><Money v={d.statement.closing} /></td></tr></tfoot></table></div></div>
      {!!d.recent.length && <div className="card no-print"><div className="card-h"><h3>آخر المستندات</h3></div><div className="table-wrap"><table className="tbl compact"><tbody>{d.recent.map((r: any) => <tr key={r.number}><td>{r.number}</td><td className="dt">{fmtDate(r.date)}</td><td className="n"><Money v={r.total} /></td><td><Badge s={r.paymentStatus} /></td><td><a className="btn sm ghost" href={`/p/${r.shareToken}`} target="_blank" rel="noreferrer">عرض</a></td></tr>)}</tbody></table></div></div>}
      <div className="small muted no-print" style={{ textAlign: "center" }}>صادر عبر نظام ميزان ERP — للاستفسار تواصل مع {c.nameAr}{c.phone ? ` ${c.phone}` : ""}</div>
    </div>
  );
}
