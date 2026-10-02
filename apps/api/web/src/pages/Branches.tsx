import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, useFetch, Money, Loading, Empty, Badge, Modal, Field, Input, Select, Picker, accountFetcher, useAction, useToast, useCompanyContext, fmtDT, confirmDlg } from "../lib";

/* ───────────── branches & warehouses ───────────── */
export function BranchesTab() {
  const { can } = useCompanyContext();
  const br = useFetch<any[]>("/branches");
  const wh = useFetch<any[]>("/warehouses");
  const { run, busy } = useAction();
  const [edit, setEdit] = useState<any>(null);
  const w = can("settings.write");
  const reload = () => { br.reload(); wh.reload(); };
  if (!br.data || !wh.data) return <Loading />;
  return (
    <div className="grid">
      <div className="card">
        <div className="card-h"><h3>الفروع <span className="muted small">({br.data.length})</span></h3>{w && <button className="btn primary sm" onClick={() => setEdit({ code: "", name: "", city: "", phone: "", address: "", createWarehouse: true })}>＋ فرع جديد</button>}</div>
        <div className="card-b"><div className="alert info small">الفرع <b>بُعد محاسبي</b>: كل قيد يُسجَّل على فرع واحد — من مستودع المستند، أو الفرع المختار، أو الفرع الافتراضي للمستخدم، وإلا فالفرع الرئيسي. بذلك تحصل على ميزان مراجعة وقائمة دخل وميزانية لكل فرع، ومجموع الفروع يساوي أرقام المنشأة دائماً. التحويل المخزني بين مستودعات فرعين يُقيَّد تلقائياً عبر حساب «جاري الفروع».</div></div>
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>الرمز</th><th>الفرع</th><th>المدينة</th><th>الهاتف</th><th className="n">المستودعات</th><th className="n">المستخدمون</th><th className="n">القيود</th><th>الحالة</th><th /></tr></thead>
          <tbody>{br.data.map((b: any) => <tr key={b.id}>
            <td className="num">{b.code}</td><td><b>{b.name}</b> {b.isMain && <span className="badge teal">رئيسي</span>}{b.address && <div className="small muted">{b.address}</div>}</td><td>{b.city || "—"}</td><td dir="ltr">{b.phone || ""}</td>
            <td className="n">{b.warehouses}</td><td className="n">{b.users}</td><td className="n">{b.entries}</td>
            <td><Badge s={b.isActive ? "ACTIVE" : "CANCELLED"} map={{ ACTIVE: "نشط", CANCELLED: "موقوف" }} /></td>
            <td className="row" style={{ gap: 4 }}>{w && <>
              <button className="btn sm ghost" onClick={() => setEdit({ ...b })}>تعديل</button>
              {!b.isMain && <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { if (confirmDlg(`جعل «${b.name}» الفرع الرئيسي؟ القيود العامة (الإقرار الضريبي، الإقفال) تُسجل على الفرع الرئيسي.`)) { await api(`/branches/${b.id}`, { method: "PUT", body: { isMain: true } }); reload(); } })}>جعله رئيسياً</button>}
              {!b.isMain && <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { await api(`/branches/${b.id}`, { method: "PUT", body: { isActive: !b.isActive } }); reload(); })}>{b.isActive ? "إيقاف" : "تفعيل"}</button>}
              {!b.isMain && !b.entries && <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { if (confirmDlg(`حذف الفرع «${b.name}»؟ تنتقل مستودعاته إلى الفرع الرئيسي.`)) { await api(`/branches/${b.id}`, { method: "DELETE" }); reload(); } }, "تم الحذف")}>حذف</button>}
            </>}</td>
          </tr>)}</tbody>
        </table></div>
      </div>

      <div className="card">
        <div className="card-h"><h3>المستودعات وارتباطها بالفروع</h3></div>
        <div className="table-wrap"><table className="tbl compact">
          <thead><tr><th>الرمز</th><th>المستودع</th><th>الفرع</th><th /></tr></thead>
          <tbody>{wh.data.map((x: any) => <tr key={x.id}>
            <td className="num">{x.code}</td><td>{x.name} {x.isDefault && <span className="badge teal">افتراضي</span>}</td>
            <td>{w ? <Select value={x.branchId || ""} style={{ width: 220 }} onChange={(e) => run(async () => { await api(`/warehouses/${x.id}`, { method: "PUT", body: { branchId: e.target.value } }); reload(); }, "تم ربط المستودع بالفرع")}>{br.data!.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select> : x.branchName}</td>
            <td>{w && !x.isDefault && <button className="btn sm ghost" onClick={() => run(async () => { await api(`/warehouses/${x.id}`, { method: "PUT", body: { isDefault: true } }); reload(); })}>جعله افتراضياً</button>}</td>
          </tr>)}</tbody>
        </table></div>
        <div className="card-b small muted">مبيعات ومشتريات أي مستودع تُسجَّل على فرعه. المستخدم الذي له «فرع افتراضي» (من تبويب المستخدمين) يبيع افتراضياً من مستودع فرعه، وكذلك وردية نقطة البيع.</div>
      </div>

      {edit && <Modal narrow title={edit.id ? `تعديل ${edit.name}` : "فرع جديد"} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>إلغاء</button><button className="btn primary" disabled={busy} onClick={() => run(async () => {
        if (edit.id) await api(`/branches/${edit.id}`, { method: "PUT", body: { name: edit.name, code: edit.code, city: edit.city, phone: edit.phone, address: edit.address } });
        else await api("/branches", { body: edit });
        setEdit(null); reload();
      }, "تم الحفظ")}>حفظ</button></>}>
        <div className="grid c2">
          <Field label="رمز الفرع"><Input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} dir="ltr" placeholder="JED" /></Field>
          <Field label="اسم الفرع"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="فرع جدة" /></Field>
          <Field label="المدينة"><Input value={edit.city || ""} onChange={(e) => setEdit({ ...edit, city: e.target.value })} /></Field>
          <Field label="الهاتف"><Input value={edit.phone || ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} dir="ltr" /></Field>
          <Field label="العنوان" span2><Input value={edit.address || ""} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
        </div>
        {!edit.id && <label className="check mt"><input type="checkbox" checked={edit.createWarehouse !== false} onChange={(e) => setEdit({ ...edit, createWarehouse: e.target.checked })} /> إنشاء مستودع خاص بالفرع تلقائياً</label>}
      </Modal>}
    </div>
  );
}

/** Small selector used in the users table. */
export function BranchSelect({ value, onChange, allowEmpty = true, emptyLabel = "— بدون (الرئيسي) —", style }: { value: string | null; onChange: (v: string) => void; allowEmpty?: boolean; emptyLabel?: string; style?: React.CSSProperties }) {
  const br = useFetch<any[]>("/branches");
  if (!br.data) return null;
  return <Select value={value || ""} onChange={(e) => onChange(e.target.value)} style={style}>{allowEmpty && <option value="">{emptyLabel}</option>}{br.data.filter((b: any) => b.isActive || b.id === value).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>;
}

/** Optional branch field for vouchers — rendered only when the company has more than one branch. */
export function BranchField({ value, onChange, hint = "تلقائي: فرع المستندات المسددة أو فرعك الافتراضي" }: { value: string; onChange: (v: string) => void; hint?: string }) {
  const br = useFetch<any[]>("/branches");
  if (!br.data || br.data.length < 2) return null;
  return <Field label="الفرع" hint={hint}><Select value={value} onChange={(e) => onChange(e.target.value)}><option value="">تلقائي</option>{br.data.filter((b: any) => b.isActive).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>;
}

/* ───────────── Salla store connector ───────────── */
const EV_ST: Record<string, string> = { DONE: "تم", IGNORED: "تجاهل", FAILED: "فشل", RECEIVED: "مستلم" };
const EV_AR: Record<string, string> = { "order.created": "طلب جديد", "order.updated": "تحديث طلب", "order.status.updated": "تغيير حالة طلب", "order.refunded": "استرجاع طلب", "order.cancelled": "إلغاء طلب", "order.deleted": "حذف طلب", "product.created": "صنف جديد", "product.updated": "تحديث صنف", "order.create": "طلب جديد", "order.status.update": "تغيير حالة طلب", "order.payment_status.update": "تغيير حالة الدفع", "product.create": "صنف جديد", "product.update": "تحديث صنف" };

export function SallaTab() { return <StoreTab platform="salla" />; }
export function ZidTab() { return <StoreTab platform="zid" />; }

export function StoreTab({ platform }: { platform: "salla" | "zid" }) {
  const base = `/integrations/${platform}`;
  const pn = platform === "zid" ? "زد" : "سلة";
  const isZid = platform === "zid";
  const { can } = useCompanyContext();
  const toast = useToast();
  const nav = useNavigate();
  const { data: v, reload, setData } = useFetch<any>(base, [platform]);
  const wh = useFetch<any[]>("/warehouses");
  const { run, busy } = useAction();
  const [secret, setSecret] = useState<string | null>(null);
  const w = can("settings.write");
  if (!v || !wh.data) return <Loading />;
  const c = v.connection;
  const save = (body: any, msg = "تم الحفظ") => run(async () => setData(await api(base, { body })), msg);
  const copy = (t: string) => { navigator.clipboard?.writeText(t); toast("تم النسخ", "ok"); };

  if (!c) return (
    <div className="card"><div className="card-b" style={{ textAlign: "center", padding: 36 }}>
      <div style={{ fontSize: 42 }}>🛍️</div>
      <h2 style={{ margin: "8px 0" }}>اربط متجرك على {pn} بميزان</h2>
      <p className="muted" style={{ maxWidth: 620, margin: "0 auto 18px" }}>كل طلب في متجرك يتحول تلقائياً إلى فاتورة ضريبية مرحّلة بقيدها المحاسبي وتكلفة البضاعة وخصم المخزون. الطلبات المدفوعة إلكترونياً تُسدَّد في «حساب تسوية المتجر»، والدفع عند الاستلام يبقى على العميل حتى يكتمل التوصيل، والإلغاء يُصدر إشعاراً دائناً تلقائياً.</p>
      {w ? <button className="btn primary lg" disabled={busy} onClick={() => save({ enabled: true, autoPost: true }, "تم إنشاء رابط الربط")}>تفعيل ربط {pn}</button> : <div className="muted">يتطلب صلاحية الإعدادات</div>}
    </div></div>
  );

  return (
    <div className="grid">
      <div className="grid c4">
        <div className="card kpi"><div className="icon">🛒</div><div className="label">طلبات {pn} المرحّلة</div><div className="value">{v.stats.orders}</div><div className="sub">إجمالي <Money v={v.stats.total} /></div></div>
        <div className="card kpi info"><div className="icon">⏳</div><div className="label">مستحق على العملاء (دفع عند الاستلام)</div><div className="value"><Money v={v.stats.open} /></div><div className="sub">يُحصَّل عند اكتمال التوصيل</div></div>
        <div className="card kpi success"><div className="icon">🏦</div><div className="label">رصيد حساب تسوية المتجر</div><div className="value"><Money v={v.clearing?.balance || 0} /></div><div className="sub">{v.clearing?.code} — تُصفّى عند تحويل {pn} لحسابك البنكي</div></div>
        <div className="card kpi accent"><div className="icon">📡</div><div className="label">آخر حدث</div><div className="value" style={{ fontSize: 14, lineHeight: 1.6 }}>{c.lastEventAt ? fmtDT(c.lastEventAt) : "لم يصل بعد"}</div><div className="sub">{c.enabled ? <span className="badge green">الربط نشط</span> : <span className="badge red">موقوف</span>}</div></div>
      </div>

      <div className="grid c2">
        <div className="card"><div className="card-h"><h3>خطوات الربط في لوحة {pn}</h3></div><div className="card-b">
          {isZid ? <ol style={{ margin: 0, paddingInlineStart: 18, lineHeight: 2 }}>
            <li>من تطبيقك في <b>بوابة شركاء زد</b> (أو واجهة <span dir="ltr">Create a Webhook</span>) أنشئ اشتراكاً لكل حدث، ويكون <span dir="ltr">target_url</span> هو الرابط التالي مضافاً إليه اسم الحدث:
              <div className="row mt" style={{ gap: 6 }}><Input readOnly value={c.webhookUrl + "?event=order.create"} dir="ltr" style={{ fontFamily: "monospace", fontSize: 12 }} onFocus={(e) => e.target.select()} /><button className="btn sm" onClick={() => copy(c.webhookUrl + "?event=order.create")}>نسخ</button></div></li>
            <li>الأحداث: <span className="small" dir="ltr">{v.supportedEvents.join(" · ")}</span> — غيّر قيمة <span dir="ltr">event=</span> لكل اشتراك.</li>
            <li>إن ضبطت «رمز التحقق» أدناه أضفه للرابط: <span dir="ltr" className="small">&amp;secret=…</span> (زد لا يوقّع الطلبات، فالرابط السري هو الحماية الأساسية).</li>
            <li>جرّب بزر «طلب تجريبي» ثم تابع سجل الأحداث.</li>
          </ol> : <ol style={{ margin: 0, paddingInlineStart: 18, lineHeight: 2 }}>
            <li>في لوحة تحكم سلة افتح <b>الإعدادات ← الربط الفني ← Webhooks</b> (أو من حساب شركاء سلة لتطبيقك).</li>
            <li>أضف رابط الاستقبال التالي:
              <div className="row mt" style={{ gap: 6 }}><Input readOnly value={c.webhookUrl} dir="ltr" style={{ fontFamily: "monospace", fontSize: 12 }} onFocus={(e) => e.target.select()} /><button className="btn sm" onClick={() => copy(c.webhookUrl)}>نسخ</button></div></li>
            <li>اختر الأحداث: <span className="small" dir="ltr">{v.supportedEvents.join(" · ")}</span></li>
            <li>اختر <b>Signature</b> كاستراتيجية أمان وانسخ «السر» من سلة إلى الحقل أدناه (اختياري لكنه موصى به).</li>
            <li>جرّب بزر «طلب تجريبي» ثم تابع سجل الأحداث.</li>
          </ol>}
          {w && <div className="row mt" style={{ gap: 6 }}>
            <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { if (confirmDlg(`توليد رابط جديد؟ الرابط الحالي سيتوقف ويجب تحديثه في ${pn}.`)) setData(await api(`${base}/rotate`, { body: {} })); }, "تم توليد رابط جديد")}>توليد رابط جديد</button>
            <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { if (confirmDlg(`إلغاء ربط ${pn}؟ المستندات المسجلة تبقى كما هي.`)) { await api(base, { method: "DELETE" }); reload(); } })}>إلغاء الربط</button>
          </div>}
        </div></div>

        <div className="card"><div className="card-h"><h3>إعدادات الاستقبال</h3></div><div className="card-b">
          <div className="grid c2">
            <Field label="اسم المتجر"><Input defaultValue={c.storeName || ""} disabled={!w} onBlur={(e) => e.target.value !== (c.storeName || "") && save({ storeName: e.target.value })} placeholder={`متجري على ${pn}`} /></Field>
            <Field label={isZid ? "رمز التحقق (اختياري)" : "سر التوقيع (Webhook Secret)"} hint={c.secret ? (isZid ? "محفوظ — يجب أن يحمله الرابط ?secret=" : "محفوظ — يُتحقق من توقيع كل طلب") : "بدون سر يُعتمد على سرية الرابط فقط"}><div className="row" style={{ gap: 6 }}><Input type="password" value={secret ?? (c.secret ? "••••••••" : "")} disabled={!w} onFocus={() => secret === null && setSecret("")} onChange={(e) => setSecret(e.target.value)} dir="ltr" />{secret !== null && <button className="btn sm primary" onClick={() => { save({ secret }); setSecret(null); }}>حفظ</button>}</div></Field>
            <Field label="المستودع الذي تُصرف منه طلبات المتجر"><Select value={c.warehouseId || ""} disabled={!w} onChange={(e) => save({ warehouseId: e.target.value })}>{wh.data.map((x: any) => <option key={x.id} value={x.id}>{x.name}{x.branchName ? ` — ${x.branchName}` : ""}</option>)}</Select></Field>
            <Field label="حساب تسوية المدفوعات الإلكترونية"><Picker value={c.depositAccountId ? { id: c.depositAccountId, code: v.clearing?.code, nameAr: v.clearing?.nameAr } : v.clearing} onChange={(a: any) => a && save({ depositAccountId: a.id })} fetcher={accountFetcher((a: any) => a.isCashBank)} label={(a: any) => `${a.code} ${a.nameAr}`} /></Field>
            <Field label="متى تُرحَّل الفاتورة"><Select value={c.autoPost ? c.postOnStatus : "never"} disabled={!w} onChange={(e) => save(e.target.value === "never" ? { autoPost: false } : { autoPost: true, postOnStatus: e.target.value })}>
              <option value="created">فور استلام الطلب (موصى به)</option><option value="completed">عند اكتمال/توصيل الطلب (مسودة حتى ذلك)</option><option value="never">لا تُرحَّل — مسودات للمراجعة اليدوية</option></Select></Field>
            <Field label="خيارات"><label className="check"><input type="checkbox" checked={c.createProducts} disabled={!w} onChange={(e) => save({ createProducts: e.target.checked })} /> إنشاء الأصناف غير المعرفة تلقائياً (حسب SKU)</label><label className="check"><input type="checkbox" checked={c.enabled} disabled={!w} onChange={(e) => save({ enabled: e.target.checked })} /> الربط نشط</label></Field>
          </div>
          <div className="small muted mt">تُطابق الأصناف برمز SKU أو الباركود. الأسعار في {pn} تُعامل كشاملة للضريبة ما لم يرسل المتجر السعر قبل الضريبة. الشحن ورسوم الدفع عند الاستلام تُضاف كبنود خاضعة للضريبة، وكوبونات الخصم توزَّع على البنود.</div>
          {w && <div className="row mt" style={{ gap: 6 }}>
            <button className="btn sm" disabled={busy} onClick={() => run(async () => { const r = await api(`${base}/test`, { body: {} }); setData(r.view); toast(r.result.message, r.result.status === "FAILED" ? "err" : "ok"); })}>طلب تجريبي (مسودة)</button>
            <button className="btn sm primary" disabled={busy} onClick={() => run(async () => { if (!confirmDlg("سيتم إنشاء وترحيل فاتورة فعلية مدفوعة بطلب تجريبي. متابعة؟")) return; const r = await api(`${base}/test`, { body: { post: true } }); setData(r.view); toast(r.result.message, r.result.status === "FAILED" ? "err" : "ok"); })}>طلب تجريبي مرحّل</button>
          </div>}
        </div></div>
      </div>

      <PayoutsCard base={base} pn={pn} v={v} onDone={reload} />

      <div className="card"><div className="card-h"><h3>سجل الأحداث الواردة من {pn}</h3><button className="btn sm ghost" onClick={reload}>تحديث</button></div>
        {!v.events.length ? <Empty text="لم يصل أي حدث بعد — جرّب طلباً تجريبياً" /> : <div className="table-wrap"><table className="tbl compact">
          <thead><tr><th>الوقت</th><th>الحدث</th><th>طلب {pn}</th><th>النتيجة</th><th>المستند</th><th /></tr></thead>
          <tbody>{v.events.map((e: any) => <tr key={e.id}>
            <td className="small">{fmtDT(e.createdAt)}</td>
            <td>{EV_AR[e.event] || e.event}{e.isTest && <span className="badge amber" style={{ marginInlineStart: 4 }}>تجريبي</span>}{e.attempts > 1 && <span className="small muted"> ×{e.attempts}</span>}</td>
            <td className="num">{e.reference || e.sallaId || "—"}</td>
            <td><Badge s={e.status} map={EV_ST} /> <span className="small">{e.message}</span></td>
            <td>{e.invoiceId ? <a onClick={() => nav(`/doc/${e.invoiceId}`)} style={{ cursor: "pointer" }}>{e.invoiceNumber || "فتح"}</a> : "—"}{e.creditNoteNumber && <> · <span className="small">{e.creditNoteNumber}</span></>}</td>
            <td>{w && e.status === "FAILED" && <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { const r = await api(`${base}/events/${e.id}/retry`, { body: {} }); toast(r.message, r.status === "FAILED" ? "err" : "ok"); reload(); })}>إعادة المعالجة</button>}</td>
          </tr>)}</tbody>
        </table></div>}
      </div>
    </div>
  );
}

/** Platform transfers: clearing → bank net of commission (+VAT on it). */
function PayoutsCard({ base, pn, v, onDone }: { base: string; pn: string; v: any; onDone: () => void }) {
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const [f, setF] = useState<any>(null);
  const w = can("payments.write");
  const fees = Number(f?.fees || 0), feeVat = f?.feeVat === "" || f?.feeVat === undefined ? Math.round(fees * 15) / 100 : Number(f.feeVat), net = Number(f?.net || 0);
  return (
    <div className="card"><div className="card-h"><div><h3>تحويلات {pn} إلى البنك</h3><div className="small muted">عند تحويل {pn} لرصيدك: يُخفَّض حساب تسوية المتجر بالإجمالي، ويُسجَّل الصافي في البنك والعمولة كمصروف (5304) وضريبتها كضريبة مدخلات قابلة للخصم.</div></div>
      {w && <button className="btn primary sm" onClick={() => setF({ date: new Date().toISOString().slice(0, 10), net: "", fees: "", feeVat: "", reference: "", bank: null })}>＋ تسجيل تحويل</button>}</div>
      {!v.payouts?.length ? <div className="card-b muted small">لا توجد تحويلات مسجلة. رصيد حساب التسوية الحالي: <Money v={v.clearing?.balance || 0} /></div> : <div className="table-wrap"><table className="tbl compact">
        <thead><tr><th>الرقم</th><th>التاريخ</th><th>المرجع</th><th className="n">الإجمالي</th><th className="n">العمولة</th><th className="n">ضريبة العمولة</th><th className="n">الصافي للبنك</th><th>البنك</th><th>الحالة</th><th /></tr></thead>
        <tbody>{v.payouts.map((p: any) => <tr key={p.id}><td className="num">{p.number}</td><td>{String(p.date).slice(0, 10)}</td><td>{p.reference || "—"}</td><td className="n"><Money v={p.gross} /></td><td className="n"><Money v={p.fees} /></td><td className="n"><Money v={p.feeVat} /></td><td className="n"><b><Money v={p.net} /></b></td><td>{p.bankName}</td><td><Badge s={p.status} /></td>
          <td>{w && p.status === "POSTED" && <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { if (confirmDlg(`إلغاء التحويل ${p.number} وعكس قيده؟`)) { await api(`${base}/payouts/${p.id}/cancel`, { body: {} }); onDone(); } }, "تم الإلغاء")}>إلغاء</button>}</td></tr>)}</tbody>
      </table></div>}
      {f && <Modal narrow title={`تسجيل تحويل من ${pn}`} onClose={() => setF(null)} footer={<><span className="grow small muted">الإجمالي المخصوم من حساب التسوية: <b><Money v={Math.round((net + fees + feeVat) * 100) / 100} /></b></span><button className="btn" onClick={() => setF(null)}>إلغاء</button><button className="btn primary" disabled={busy || !f.bank || net <= 0} onClick={() => run(async () => { await api(`${base}/payouts`, { body: { date: f.date, net, fees, feeVat: f.feeVat === "" ? undefined : feeVat, bankAccountId: f.bank.id, reference: f.reference } }); setF(null); onDone(); }, "تم ترحيل التحويل")}>ترحيل</button></>}>
        <div className="grid c2">
          <Field label="التاريخ"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="مرجع التحويل / الدفعة"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          <Field label="المبلغ الواصل للبنك"><Input type="number" value={f.net} onChange={(e) => setF({ ...f, net: e.target.value })} /></Field>
          <Field label="العمولة والرسوم (قبل الضريبة)"><Input type="number" value={f.fees} onChange={(e) => setF({ ...f, fees: e.target.value })} /></Field>
          <Field label="ضريبة العمولة" hint="فارغ = 15% من العمولة"><Input type="number" value={f.feeVat} placeholder={(Math.round(fees * 15) / 100).toFixed(2)} onChange={(e) => setF({ ...f, feeVat: e.target.value })} /></Field>
          <Field label="البنك المستلم"><Picker value={f.bank} onChange={(a: any) => setF({ ...f, bank: a })} fetcher={accountFetcher((a: any) => a.isCashBank && a.systemKey !== "ESTORE_CLEARING")} label={(a: any) => `${a.code} ${a.nameAr}`} /></Field>
        </div>
      </Modal>}
    </div>
  );
}
