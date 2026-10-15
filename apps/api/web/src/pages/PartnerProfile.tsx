/** Customer / supplier profile: KPIs, tabs (invoices, quotations, payments, statement) and every action from one place. */
import React, { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, q, useFetch, Money, money, Loading, Empty, Badge, Modal, Field, Input, Select, NumInput, useAction, useCompanyContext, today, fmtDate, KIND_AR, STATUS_AR, SearchBox, matches, useSorted, Th, exportExcel, PdfBtn, useBase, confirmDlg, METHOD_AR } from "../lib";
import { DocEditor } from "./Documents";
import { PartnerEditor } from "./Master";
import { PaymentEditor } from "./Money";
import { PartnerStatement } from "./Statements";

export function PartnerProfilePage({ role }: { role: "CUSTOMER" | "SUPPLIER" }) {
  const { id } = useParams();
  const nav = useNavigate(); const base = useBase();
  const { can } = useCompanyContext();
  const { data, loading, reload } = useFetch(`/partners/${id}/profile${q({ role })}`);
  const [tab, setTab] = useState("invoices");
  const [text, setText] = useState("");
  const [editor, setEditor] = useState<any>(null);
  const [pay, setPay] = useState(false);
  const [edit, setEdit] = useState(false);
  const [opening, setOpening] = useState(false);
  const [settings, setSettings] = useState<string | null>(null);
  const [pickInv, setPickInv] = useState<null | "return" | "credit">(null);
  const [stmt, setStmt] = useState(false);
  const { run, busy } = useAction();
  const isC = role === "CUSTOMER";
  const dir = isC ? "SALE" : "PURCHASE";
  const W = isC ? "sales.write" : "purchases.write";
  const docs = useMemo(() => (data?.documents || []).filter((d: any) => (tab === "quotes" ? ["QUOTATION", "ORDER"].includes(d.kind) : tab === "notes" ? ["CREDIT_NOTE", "DEBIT_NOTE"].includes(d.kind) : d.kind === "INVOICE") && matches(d, text, ["number", "salesperson", "status"])), [data, tab, text]);
  const pays = useMemo(() => (data?.payments || []).filter((x: any) => matches(x, text, ["number", "reference", "accountName"])), [data, text]);
  const sD = useSorted(docs), sP = useSorted(pays);
  if (loading && !data) return <Loading />;
  if (!data) return <Empty text="الطرف غير موجود" />;
  const p = data.partner, k = data.kpis;
  const invoices = (data.documents || []).filter((d: any) => d.kind === "INVOICE" && d.status === "POSTED");
  const act = (label: string, onClick: () => void, perm = W, primary = false) => can(perm) ? <button className={"btn sm" + (primary ? " primary" : "")} onClick={onClick}>{label}</button> : null;
  const newDoc = (kind: string) => { if (!p.isActive) return alert(`${isC ? "العميل" : "المورد"} موقوف — أعد تفعيله أولاً`); setEditor({ kind, prefill: { partner: p } }); };
  const fromInvoice = (invId: string, mode: "return" | "credit") => run(async () => { const draft = await api(`/invoices/${invId}/credit-note`, { body: mode === "credit" ? { financial: true } : {} }); setPickInv(null); setEditor({ kind: "CREDIT_NOTE", id: draft.id, originId: invId }); });
  const tabs = [{ k: "invoices", l: `الفواتير (${(data.documents || []).filter((d: any) => d.kind === "INVOICE").length})` }, ...(isC ? [{ k: "quotes", l: `عروض الأسعار (${(data.documents || []).filter((d: any) => ["QUOTATION", "ORDER"].includes(d.kind)).length})` }] : []), { k: "notes", l: "الإشعارات والمرتجعات" }, { k: "payments", l: `المدفوعات (${data.payments.length})` }, { k: "statement", l: "كشف الحساب" }, { k: "openings", l: "الأرصدة الافتتاحية" }];
  return (
    <div className="grid">
      <div className="card"><div className="card-b">
        <div className="profile-h">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div className="avatar">{p.name.slice(0, 1)}</div>
            <div>
              <h2>{p.name} <span className="small muted num">{p.code}</span> {p.isActive ? <span className="badge green">نشط</span> : <span className="badge red">موقوف</span>}</h2>
              <div className="meta">
                {p.phone && <span>📞 <span className="num">{p.phone}</span></span>}{p.vatNumber && <span>الرقم الضريبي <span className="num">{p.vatNumber}</span></span>}{p.city && <span>📍 {p.city}</span>}
                <span>فترة السداد: <b>{p.paymentTerms ? `${p.paymentTerms} يوم` : "نقدي"}</b></span>
                {isC && <span>حد الائتمان: <b>{Number(p.creditLimit) ? money(p.creditLimit) : "بدون"}</b></span>}
                {isC && <span>المندوب: <b>{p.salesperson || "—"}</b></span>}
              </div>
            </div>
          </div>
          <div className="row no-print"><button className="btn sm" onClick={() => nav(-1)}>← رجوع</button><PdfBtn name={`ملف ${p.name}`} /></div>
        </div>
        <div className="action-bar mt no-print">
          {act("🧾 إنشاء فاتورة", () => newDoc("INVOICE"), W, true)}
          {isC && act("📝 إنشاء عرض سعر", () => newDoc("QUOTATION"))}
          {isC && act("↩ إشعار دائن (خصم/تسوية)", () => setPickInv("credit"))}
          {act(isC ? "📦 فاتورة مرتجع" : "📦 مرتجع مشتريات", () => setPickInv("return"))}
          {act(isC ? "💵 إضافة مدفوعات (تحصيل)" : "💸 إضافة مدفوعات (سداد)", () => setPay(true), "payments.write")}
          {act("⚖ رصيد افتتاحي", () => setOpening(true), "accounting.write")}
          {isC && act("👤 تعيين مندوب", () => setSettings("salesperson"), "partners.write")}
          {act("📅 فترة السداد", () => setSettings("terms"), "partners.write")}
          {act("✏ تعديل", () => setEdit(true), "partners.write")}
          {act(p.isActive ? `⛔ وقف ${isC ? "العميل" : "المورد"}` : "✅ إعادة التفعيل", () => confirmDlg(p.isActive ? `وقف ${p.name}؟ لن يمكن إصدار فواتير أو عروض أسعار جديدة له (تبقى المرتجعات والتحصيل متاحة).` : `إعادة تفعيل ${p.name}؟`) && run(async () => { await api(`/partners/${p.id}/settings`, { method: "PUT", body: { isActive: !p.isActive } }); reload(); }, "تم"), "partners.write")}
        </div>
      </div></div>

      <div className="mini-kpis">
        <div><span>الرصيد الحالي</span><b className={data.balance < 0 ? "neg-val" : ""}><Money v={data.balance} /></b><span>{isC ? (data.balance >= 0 ? "مدين (له علينا مطالبة)" : "دائن (دفعات مقدمة)") : data.balance >= 0 ? "دائن (مستحق له)" : "مدين"}</span></div>
        <div><span>فواتير مفتوحة</span><b><Money v={k.openAmount} /></b><span>{k.openCount} فاتورة</span></div>
        <div><span>متأخر السداد</span><b className={k.overdue > 0 ? "neg-val" : ""}><Money v={k.overdue} /></b></div>
        <div><span>{isC ? "إجمالي المبيعات" : "إجمالي المشتريات"}</span><b><Money v={k.total} /></b><span>هذه السنة <Money v={k.ytd} /></span></div>
        {isC && <div><span>مجمل الربح</span><b><Money v={k.profit} /></b></div>}
        {isC && <div><span>عروض أسعار مفتوحة</span><b className="num">{k.openQuotes}</b></div>}
        <div><span>آخر فاتورة</span><b className="num" style={{ fontSize: 15 }}>{fmtDate(k.lastInvoice) || "—"}</b></div>
      </div>

      <div className="card">
        <div className="card-b">
          <div className="tabs-bar">{tabs.map((t) => <button key={t.k} className={tab === t.k ? "on" : ""} onClick={() => setTab(t.k)}>{t.l}</button>)}</div>
          {tab !== "statement" && tab !== "openings" && <div className="toolbar"><SearchBox value={text} onChange={setText} placeholder="بحث بالرقم أو المرجع" /><div className="grow" />
            <button className="btn sm" onClick={() => exportExcel(tab === "payments" ? pays.map((x: any) => ({ الرقم: x.number, التاريخ: fmtDate(x.date), المبلغ: Number(x.amount), المخصص: Number(x.allocated), الطريقة: METHOD_AR[x.method] || x.method, الحساب: x.accountName, المرجع: x.reference })) : docs.map((d: any) => ({ النوع: KIND_AR[d.kind], الرقم: d.number, التاريخ: fmtDate(d.date), الاستحقاق: fmtDate(d.dueDate), الإجمالي: Number(d.total), المسدد: Number(d.amountPaid), المتبقي: Number(d.remaining), الحالة: STATUS_AR[d.status] })), `${p.name}-${tab}`)}>⬇ Excel</button></div>}
          {tab === "statement" ? <div className="row"><button className="btn primary" onClick={() => setStmt(true)}>📄 فتح كشف الحساب التفصيلي</button><span className="muted small">بالفترة والفرع، مع الأرصدة الافتتاحية والجارية، والطباعة وPDF وExcel</span></div>
          : tab === "openings" ? (
            !data.openings.length ? <Empty text="لا توجد أرصدة افتتاحية مسجلة" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>القيد</th><th>التاريخ</th><th>البيان</th><th className="n">المبلغ</th><th>الحالة</th><th /></tr></thead>
              <tbody>{data.openings.map((o: any) => <tr key={o.id}><td className="num">{o.number}</td><td className="dt">{fmtDate(o.date)}</td><td>{o.memo}</td><td className="n"><Money v={o.amount} /></td><td><Badge s={o.status} /></td><td>{can("accounting.write") && <button className="btn sm ghost" disabled={busy} onClick={() => confirmDlg("إلغاء هذا الرصيد الافتتاحي بقيد عكسي؟") && run(async () => { await api(`/partners/openings/${o.id}/cancel`, { body: {} }); reload(); }, "تم الإلغاء")}>إلغاء</button>}</td></tr>)}</tbody></table></div>
          ) : tab === "payments" ? (
            !pays.length ? <Empty text="لا توجد مدفوعات" /> : <div className="table-wrap"><table className="tbl"><thead><tr><Th k="number" s={sP}>الرقم</Th><Th k="date" s={sP}>التاريخ</Th><th>الطريقة</th><th>الحساب</th><Th k="amount" s={sP} n>المبلغ</Th><th className="n">المخصص للفواتير</th><th>المرجع</th><th>الحالة</th></tr></thead>
              <tbody>{sP.sorted.map((x: any) => <tr key={x.id} className="clickable" onClick={() => nav(`/${isC ? "receipts" : "vouchers"}?q=${encodeURIComponent(x.number)}`)}><td className="num">{x.number}</td><td className="dt">{fmtDate(x.date)}</td><td>{METHOD_AR[x.method] || x.method}</td><td className="small">{x.accountName}</td><td className="n"><b><Money v={x.amount} /></b></td><td className="n"><Money v={x.allocated} /></td><td className="small">{x.reference}</td><td><Badge s={x.status} /></td></tr>)}</tbody></table></div>
          ) : !docs.length ? <Empty text="لا توجد مستندات" /> : (
            <div className="table-wrap"><table className="tbl"><thead><tr><Th k="number" s={sD}>الرقم</Th><Th k="kind" s={sD}>النوع</Th><Th k="date" s={sD}>التاريخ</Th><Th k="dueDate" s={sD}>الاستحقاق</Th><Th k="total" s={sD} n>الإجمالي</Th><Th k="remaining" s={sD} n>المتبقي</Th>{isC && <Th k="profit" s={sD} n>الربح</Th>}<th>الحالة</th></tr></thead>
              <tbody>{sD.sorted.map((d: any) => <tr key={d.id} className="clickable" onClick={() => d.status === "DRAFT" && d.kind !== "CREDIT_NOTE" ? setEditor({ kind: d.kind, id: d.id }) : nav(`${base}/doc/${d.id}`)}>
                <td className="num">{d.number}</td><td>{KIND_AR[d.kind]}</td><td className="dt">{fmtDate(d.date)}</td><td className={"dt " + (d.kind === "INVOICE" && d.status === "POSTED" && Number(d.remaining) > 0.005 && String(d.dueDate).slice(0, 10) < today() ? "neg-val" : "")}>{fmtDate(d.dueDate)}</td>
                <td className="n"><Money v={d.total} /></td><td className="n">{d.kind === "INVOICE" && d.status === "POSTED" ? <Money v={d.remaining} /> : "—"}</td>{isC && <td className="n">{d.status === "POSTED" && d.kind === "INVOICE" ? <Money v={d.profit} /> : "—"}</td>}
                <td><Badge s={d.status} />{d.kind === "INVOICE" && d.status === "POSTED" && <> <Badge s={d.paymentStatus} /></>}</td>
              </tr>)}</tbody></table></div>
          )}
        </div>
      </div>

      {editor && <DocEditor direction={dir} kind={editor.kind} id={editor.id} originId={editor.originId} prefill={editor.prefill} onClose={(s) => { setEditor(null); if (s) reload(); }} />}
      {pay && <PaymentEditor direction={isC ? "IN" : "OUT"} partner={p} onClose={(s) => { setPay(false); if (s) reload(); }} />}
      {edit && <PartnerEditor role={role} p={p} onClose={(s) => { setEdit(false); if (s) reload(); }} />}
      {opening && <OpeningModal p={p} role={role} onClose={(s) => { setOpening(false); if (s) { reload(); setTab("openings"); } }} />}
      {settings && <SettingsModal p={p} mode={settings} onClose={(s) => { setSettings(null); if (s) reload(); }} />}
      {pickInv && <Modal narrow title={pickInv === "credit" ? "إشعار دائن — اختر الفاتورة" : "مرتجع — اختر الفاتورة الأصلية"} onClose={() => setPickInv(null)}>
        {!invoices.length ? <Empty text="لا توجد فواتير مرحّلة" /> : <div className="stat-list">{invoices.map((d: any) => <button key={d.id} className="item" style={{ border: 0, cursor: "pointer", font: "inherit" }} disabled={busy} onClick={() => fromInvoice(d.id, pickInv)}><span className="num">{d.number} · {fmtDate(d.date)}</span><b><Money v={d.total} /></b></button>)}</div>}
        <div className="small muted mt">{pickInv === "credit" ? "إشعار دائن مالي (خصم أو تسوية سعر) يُقيّد على «مردودات ومسموحات المبيعات» دون إرجاع بضاعة." : "تُنسخ الكميات المتبقية من الفاتورة وتُعاد للمخزون بتكلفتها؛ عدّل الكميات قبل الترحيل."}</div>
      </Modal>}
      {stmt && <PartnerStatement partner={p} role={role} onClose={() => setStmt(false)} />}
    </div>
  );
}

function OpeningModal({ p, role, onClose }: { p: any; role: string; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ amount: "", date: today().slice(0, 4) + "-01-01", side: "normal", memo: "" });
  const isC = role === "CUSTOMER";
  return (
    <Modal narrow title={`رصيد افتتاحي — ${p.name}`} onClose={() => onClose()} footer={<><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api(`/partners/${p.id}/opening`, { body: { role, date: f.date, memo: f.memo, amount: Number(f.amount) * (f.side === "normal" ? 1 : -1) } }); onClose(true); }, "تم تسجيل الرصيد الافتتاحي")}>تسجيل وترحيل</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      <Field label="المبلغ"><NumInput value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      <Field label="طبيعة الرصيد"><Select value={f.side} onChange={(e) => setF({ ...f, side: e.target.value })}><option value="normal">{isC ? "مدين — مستحق على العميل" : "دائن — مستحق للمورد"}</option><option value="reverse">{isC ? "دائن — دفعة مقدمة من العميل" : "مدين — دفعة مقدمة للمورد"}</option></Select></Field>
      <Field label="تاريخ الرصيد"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label="بيان (اختياري)"><Input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} /></Field>
      <div className="alert info small mt">القيد: {isC ? "من ح/ العملاء (باسم العميل) إلى ح/ أرصدة افتتاحية" : "من ح/ أرصدة افتتاحية إلى ح/ الموردين (باسم المورد)"} — يظهر في كشف الحساب ويُحصَّل/يُسدَّد بسند بدون تخصيص على فاتورة.</div>
    </Modal>
  );
}

function SettingsModal({ p, mode, onClose }: { p: any; mode: string; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const users = useFetch<any[]>(mode === "salesperson" ? "/users" : null);
  const [v, setV] = useState<any>(mode === "salesperson" ? p.salesperson || "" : { paymentTerms: p.paymentTerms || 0, creditLimit: p.creditLimit || 0 });
  return (
    <Modal narrow title={mode === "salesperson" ? "تعيين مندوب المبيعات" : "فترة السداد وحد الائتمان"} onClose={() => onClose()} footer={<><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api(`/partners/${p.id}/settings`, { method: "PUT", body: mode === "salesperson" ? { salesperson: v } : v }); onClose(true); }, "تم الحفظ")}>حفظ</button><button className="btn" onClick={() => onClose()}>إلغاء</button></>}>
      {mode === "salesperson" ? <>
        <Field label="المندوب" hint="يُنسب تلقائياً لكل فاتورة جديدة لهذا العميل ويظهر في تقرير المبيعات حسب المندوب"><Input list="sp-users" value={v} onChange={(e) => setV(e.target.value)} placeholder="اختر مستخدماً أو اكتب اسماً" /></Field>
        <datalist id="sp-users">{(users.data || []).map((u: any) => <option key={u.id} value={u.fullName} />)}</datalist>
      </> : <>
        <Field label="فترة السداد (أيام، 0 = نقدي)" hint="يُحسب منها تاريخ استحقاق الفواتير تلقائياً"><NumInput value={v.paymentTerms} onChange={(e) => setV({ ...v, paymentTerms: e.target.value })} /></Field>
        {(p.isCustomer) && <Field label="حد الائتمان (0 = بلا حد)" hint="يمنع ترحيل فاتورة آجلة تتجاوزه إلا بموافقة المدير"><NumInput value={v.creditLimit} onChange={(e) => setV({ ...v, creditLimit: e.target.value })} /></Field>}
      </>}
    </Modal>
  );
}
