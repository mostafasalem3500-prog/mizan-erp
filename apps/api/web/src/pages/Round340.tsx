/** 3.40.0 screens: clearing reconciliation (card terminals, Salla, Zid), e-store order profit, reversing a posted return. */
import React, { useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, q, useFetch, Money, money, Loading, Empty, Modal, Field, Input, NumInput, Select, Picker, accountFetcher, Tabs, useAction, useToast, useCompanyContext, fmtDate, useBase, ExportBtn, confirmDlg, today } from "../lib";
import { readSheet } from "../shared/sheet";
import { CFG } from "../shared/country";

// ─── reversing a posted sales return ─────────────────────────────────────
export function ReverseReturnModal({ doc, onClose }: { doc: any; onClose: (dn?: any) => void }) {
  const refunded = Array.isArray(doc.tenders) && doc.tenders.length > 0;
  const walkin = doc.partnerName === "عميل نقدي" || doc.partner?.code === "WALKIN";
  const [reason, setReason] = useState("");
  const [collect, setCollect] = useState(refunded ? "SAME" : "AR");
  const { run, busy } = useAction();
  return (
    <Modal narrow title={`إلغاء المرتجع ${doc.number}`} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>تراجع</button><button className="btn danger" data-reverse-save disabled={busy || reason.trim().length < 3} onClick={() => run(async () => { const dn = await api(`/invoices/${doc.id}/reverse-return`, { body: { reason, collect } }); onClose(dn); }, "أُلغي المرتجع بإشعار مدين")}>إلغاء المرتجع</button></>}>
      <div className="alert info small">المرتجع المرحّل مستند ضريبي لا يُحذف. يُلغى أثره بـ<b>إشعار مدين</b> على الفاتورة نفسها بالبنود نفسها: تخرج البضاعة من المخزون مرة أخرى، ويُرد حساب مردودات المبيعات وضريبة المخرجات، ويعود المبلغ ({money(doc.total)}) مستحقاً على العميل أو يُحصَّل فوراً.</div>
      <div className="grid mt">
        <Field label="سبب الإلغاء"><Input data-reverse-reason autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: سُجّل المرتجع بالخطأ على فاتورة أخرى" /></Field>
        <Field label="كيف يُستعاد المبلغ من العميل؟"><Select data-reverse-collect value={collect} onChange={(e) => setCollect(e.target.value)}>
          {refunded && <option value="SAME">بنفس طريقة رد المبلغ ({doc.tenders.map((t: any) => (t.method === "CASH" ? "نقداً" : "شبكة")).join(" + ")})</option>}
          {!walkin && <option value="AR">يُقيَّد على حساب العميل (آجل)</option>}
          <option value="CASH">نقداً في الصندوق</option>
          <option value="CARD">بالشبكة</option>
        </Select></Field>
      </div>
    </Modal>
  );
}

// ─── clearing reconciliation ─────────────────────────────────────────────
const COLS: [string, string, RegExp][] = [
  ["ref", "المرجع (رقم الفاتورة / الطلب / العملية)", /ref|rrn|order|invoice|approval|auth|مرجع|طلب|فاتور|عملي|موافق/i],
  ["date", "تاريخ العملية", /date|تاريخ/i],
  ["gross", "مبلغ العملية", /gross|amount|total|sale|مبلغ|إجمالي|اجمالي|قيمة/i],
  ["fee", "العمولة (قبل الضريبة)", /fee|commission|charge|mdr|عمول|رسوم/i],
  ["feeVat", "ضريبة العمولة", /vat|tax|ضريب/i],
];
const toDate = (v: any) => { if (v instanceof Date) return v.toISOString().slice(0, 10); const s = String(v ?? "").trim(); let m = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/.exec(s); if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`; m = /^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/.exec(s); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null; };
const toNum = (v: any) => { const n = Number(String(v ?? "").replace(/[^\d.\-]/g, "")); return isFinite(n) ? n : 0; };

export function ClearingPage({ fixed }: { fixed?: string }) {
  const { can } = useCompanyContext();
  const base = useBase();
  const [sp, setSp] = useSearchParams();
  const source = fixed || (sp.get("s") === "ZID" ? "ZID" : "SALLA");
  const { data, loading, reload } = useFetch<any>(`/clearing/${source}`, [source]);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState("open");
  const [settle, setSettle] = useState<any>(null);
  const [rule, setRule] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [find, setFind] = useState("");
  const { run, busy } = useAction();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const W = can("payments.write");
  const open = useMemo(() => (data?.open || []).filter((o: any) => !find || `${o.number} ${o.partnerName} ${o.ref || ""} ${o.externalRef || ""}`.toLowerCase().includes(find.toLowerCase())), [data, find]);
  if (loading && !data) return <Loading />;
  if (!data) return <Empty />;
  const picked = data.open.filter((o: any) => sel[o.invoiceId]);
  const pickedSum = picked.reduce((a: number, o: any) => a + o.open, 0);
  const card = source === "CARD";
  const importFile = async (f: File) => {
    const aoa = (await readSheet(f)).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
    if (aoa.length < 2) { toast("الملف فارغ", "err"); return; }
    const head = aoa[0].map((h) => String(h ?? ""));
    const map: Record<string, number> = {};
    for (const [k, , re] of COLS) { const i = head.findIndex((h, j) => re.test(h) && !Object.values(map).includes(j)); if (i >= 0) map[k] = i; }
    setSettle({ file: f.name, head, rows: aoa.slice(1), map });
  };
  return (
    <div className="grid" data-clearing={source}>
      {!fixed && <Tabs tabs={data.sources.filter((s: any) => s.key !== "CARD").map((s: any) => ({ key: s.key, label: s.ar }))} value={source} onChange={(k) => { setSel({}); setSp({ s: k }); }} />}
      <div className="grid c4">
        <div className="card kpi"><div className="label">{card ? "مبيعات شبكة لم تصل البنك" : "مستحق لنا لدى المنصة"}</div><div className="value num" data-open-total>{money(data.openTotal)}</div><div className="small muted">{data.open.length} عملية</div></div>
        <div className="card kpi"><div className="label">تأخر وصولها</div><div className={"value num " + (data.late.n ? "neg-val" : "")}>{money(data.late.total)}</div><div className="small muted">{data.late.n ? `${data.late.n} عملية أقدم من ${card ? 3 : 14} يوماً` : "لا يوجد متأخر"}</div></div>
        <div className="card kpi"><div className="label">رصيد حساب التسوية في الأستاذ</div><div className="value num">{money(data.ledger)}</div><div className={"small " + (Math.abs(data.unexplained) > 0.01 ? "neg-val" : "muted")} data-unexplained>{Math.abs(data.unexplained) > 0.01 ? `فرق غير مفسَّر ${money(data.unexplained)} — حركات على الحساب خارج البيع والتسوية` : "مطابق للعمليات المفتوحة ✓"}{data.shared && data.otherOpen ? ` (يشمل ${money(data.otherOpen)} للمنصة الأخرى)` : ""}</div></div>
        <div className="card kpi"><div className="label">العمولات الفعلية</div><div className="value num">{money(data.totals.fees)}</div><div className="small muted">{data.totals.feePct}% من {money(data.totals.gross)} · القاعدة {data.rule.pct}%{data.rule.fixed ? ` + ${data.rule.fixed}` : ""}{data.rule.cap ? ` بحد ${data.rule.cap}` : ""} {can("settings.write") && <button className="btn sm ghost" data-rule onClick={() => setRule(true)}>تعديل</button>}</div></div>
      </div>
      <div className="card"><div className="card-h"><div><h3>{card ? "تسوية أجهزة الشبكة مع البنك" : `تسوية ${data.sourceAr} مع البنك`}</h3><div className="small muted">{card ? "كل عملية شبكة تبقى في حساب التسوية حتى يودعها البنك. حدّد العمليات التي شملها الإيداع، أو ارفع كشف التسوية من البنك، فتُطابَق عملية عملية وتُخصم عمولة البنك وضريبتها." : "كل طلب مدفوع يبقى مستحقاً على المنصة حتى تحوّله. حدّد الطلبات التي شملها التحويل، أو ارفع كشف التحويل من المنصة، فتُخصم عمولتها لكل طلب ويظهر ربحه الحقيقي."}</div></div>
        <div className="row">
          <input ref={file} type="file" hidden accept=".xlsx,.csv" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) run(() => importFile(f)); }} />
          {W && <button className="btn sm" data-import onClick={() => file.current?.click()}>⬆ رفع كشف التسوية</button>}
          {W && <button className="btn primary sm" data-settle disabled={!picked.length} onClick={() => setSettle({ picked })}>تسوية المحدد ({picked.length}) {picked.length ? money(pickedSum) : ""}</button>}
        </div></div>
        <div className="card-b" style={{ paddingBottom: 0 }}><Tabs tabs={[{ key: "open", label: `عمليات مفتوحة (${data.open.length})` }, { key: "batches", label: `الإيداعات (${data.batches.length})` }, { key: "unmatched", label: `في الكشف وليست في النظام (${data.unmatched.length})` }, { key: "days", label: "حسب اليوم" }]} value={tab} onChange={setTab} /></div>
        {tab === "open" && <>
          <div className="card-b" style={{ paddingBottom: 0 }}><div className="toolbar"><Input placeholder="بحث برقم الفاتورة أو المرجع أو العميل" value={find} onChange={(e) => setFind(e.target.value)} style={{ maxWidth: 320 }} /><ExportBtn name={`عمليات مفتوحة ${data.sourceAr}`} rows={() => open.map((o: any) => ({ الرقم: o.number, التاريخ: o.date, العميل: o.partnerName, المرجع: o.ref || o.externalRef || "", المبلغ: o.open, "العمولة المتوقعة": o.expectedFee, "عمر العملية (يوم)": o.age, المستخدم: o.createdBy }))} /></div></div>
          {!open.length ? <Empty text={data.open.length ? "لا نتائج" : "لا توجد عمليات بانتظار التسوية"} /> : <div className="table-wrap"><table className="tbl compact" data-open><thead><tr><th>{W && <input type="checkbox" aria-label="تحديد الكل" checked={open.length > 0 && open.every((o: any) => sel[o.invoiceId])} onChange={(e) => setSel(e.target.checked ? Object.fromEntries(open.map((o: any) => [o.invoiceId, true])) : {})} />}</th><th>المستند</th><th>التاريخ</th><th>العميل</th><th>المرجع</th><th className="n">المبلغ</th><th className="n">العمولة المتوقعة</th><th className="n">العمر</th><th>المستخدم</th></tr></thead>
            <tbody>{open.map((o: any) => <tr key={o.invoiceId} className={o.late ? "warn-row" : ""}><td>{W && <input type="checkbox" aria-label={`تحديد ${o.number}`} checked={!!sel[o.invoiceId]} onChange={(e) => setSel({ ...sel, [o.invoiceId]: e.target.checked })} />}</td><td><Link to={`${base}/doc/${o.invoiceId}`}>{o.number}</Link>{o.kind === "CREDIT_NOTE" && <span className="badge red">مرتجع</span>}</td><td className="dt">{fmtDate(o.date)}</td><td>{o.partnerName}</td><td dir="ltr" className="small">{o.ref || (o.externalRef || "").split(":").pop()}</td><td className="n"><b><Money v={o.open} /></b>{Math.abs(o.amount - o.open) > 0.005 && <div className="small muted">من {money(o.amount)}</div>}</td><td className="n"><Money v={o.expectedFee} blankZero /></td><td className="n">{o.age} {o.late && <span className="badge amber">متأخر</span>}</td><td className="small">{o.createdBy}</td></tr>)}</tbody></table></div>}
        </>}
        {tab === "batches" && (!data.batches.length ? <Empty text="لم تُسجَّل إيداعات بعد" /> : <div className="table-wrap"><table className="tbl compact" data-batches><thead><tr><th>الرقم</th><th>التاريخ</th><th>المرجع</th><th>البنك</th><th className="n">العمليات</th><th className="n">الإجمالي</th><th className="n">العمولة</th><th className="n">ضريبتها</th><th className="n">الصافي للبنك</th><th>القيد</th><th /></tr></thead>
          <tbody>{data.batches.map((b: any) => <tr key={b.id} className={b.status === "CANCELLED" ? "muted" : ""}><td><button className="btn sm ghost" onClick={() => api(`/clearing-batches/${b.id}`).then(setDetail)}>{b.number}</button>{b.status === "CANCELLED" && <span className="badge gray">ملغاة</span>}</td><td className="dt">{fmtDate(b.date)}</td><td dir="ltr">{b.reference}</td><td>{b.bankName}</td><td className="n">{b.lines}{b.unmatched > 0 && <span className="badge red" title="عمليات في الكشف بلا بيع مسجل">+{b.unmatched}</span>}</td><td className="n"><Money v={b.gross} /></td><td className="n"><Money v={b.fees} /></td><td className="n"><Money v={b.feeVat} /></td><td className="n"><b><Money v={b.net} /></b></td><td>{b.journalId && <Link to={`${base}/journals/${b.journalId}`}>{b.journalNumber}</Link>}</td><td>{W && b.status === "POSTED" && <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { if (!confirmDlg(`إلغاء التسوية ${b.number}؟ سيُعكس قيدها وتعود عملياتها مفتوحة.`)) return; await api(`/clearing-batches/${b.id}/cancel`, { body: {} }); reload(); }, "أُلغيت التسوية")}>إلغاء</button>}</td></tr>)}</tbody></table></div>)}
        {tab === "unmatched" && (!data.unmatched.length ? <Empty text="كل ما في كشوف التسوية له بيع مسجل ✓" /> : <><div className="card-b small muted" style={{ paddingBottom: 0 }}>هذه عمليات دفعها {card ? "البنك" : "المنصة"} ولا يوجد لها بيع في النظام (أو مبلغها مختلف). لم تُرحَّل، فسيظهر فرقها في مطابقة البنك حتى تُسجَّل الفاتورة الناقصة أو يُصحَّح الكشف.</div><div className="table-wrap"><table className="tbl compact" data-unmatched><thead><tr><th>الإيداع</th><th>المرجع</th><th>تاريخ العملية</th><th className="n">المبلغ</th><th className="n">العمولة</th><th>السبب</th><th /></tr></thead>
          <tbody>{data.unmatched.map((u: any) => <tr key={u.id}><td>{u.batchNumber}</td><td dir="ltr">{u.ref}</td><td className="dt">{u.txnDate && fmtDate(u.txnDate)}</td><td className="n"><Money v={u.gross} /></td><td className="n"><Money v={Number(u.fee) + Number(u.feeVat)} blankZero /></td><td className="small">{u.note}</td><td>{W && <button className="btn sm ghost" onClick={() => { const note = prompt("كيف عولجت هذه العملية؟ (مثال: سُجلت الفاتورة رقم …)"); if (note) run(async () => { await api(`/clearing-lines/${u.id}/resolve`, { body: { note } }); reload(); }, "تم"); }}>عولجت</button>}</td></tr>)}</tbody></table></div></>)}
        {tab === "days" && (!data.days.length ? <Empty /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>اليوم</th><th className="n">عدد العمليات</th><th className="n">{card ? "مبيعات الشبكة" : "المحصَّل عبر المنصة"}</th><th className="n">وصل البنك</th><th className="n">لم يصل</th></tr></thead>
          <tbody>{data.days.map((d: any) => <tr key={d.date}><td className="dt">{fmtDate(d.date)}</td><td className="n">{d.n}</td><td className="n"><Money v={d.sold} /></td><td className="n"><Money v={d.sold - d.open} /></td><td className="n">{Math.abs(d.open) > 0.005 ? <b className="neg-val"><Money v={d.open} /></b> : <span className="badge green">مسوّى</span>}</td></tr>)}</tbody></table></div>)}
      </div>
      {settle && <SettleModal source={source} data={data} init={settle} onClose={(r) => { setSettle(null); if (r) { setSel({}); reload(); setTab(r.unmatched ? "unmatched" : "batches"); toast(`تسوية ${r.number}: طوبقت ${r.matched} عملية${r.unmatched ? `، و${r.unmatched} في الكشف بلا بيع مسجل` : ""}`, r.unmatched ? "info" : "ok"); } }} />}
      {rule && <RuleModal source={source} rule={data.rule} card={card} onClose={(s) => { setRule(false); if (s) reload(); }} />}
      {detail && <Modal wide title={`تسوية ${detail.number}`} onClose={() => setDetail(null)}>
        <div className="mini-kpis mb"><div><span>الإجمالي</span><b><Money v={detail.gross} /></b></div><div><span>العمولة</span><b><Money v={detail.fees} /></b></div><div><span>ضريبة العمولة</span><b><Money v={detail.feeVat} /></b></div><div><span>الصافي للبنك</span><b><Money v={detail.net} /></b></div></div>
        <div className="table-wrap"><table className="tbl compact"><thead><tr><th>المستند</th><th>المرجع</th><th>التاريخ</th><th className="n">المبلغ</th><th className="n">العمولة</th><th className="n">ضريبتها</th><th className="n">الصافي</th></tr></thead>
          <tbody>{detail.lines.map((l: any) => <tr key={l.id} className={l.invoiceId ? "" : "warn-row"}><td>{l.invoiceId ? <Link to={`${base}/doc/${l.invoiceId}`}>{l.number}</Link> : <span className="badge red">بلا بيع مسجل</span>}</td><td dir="ltr">{l.ref}</td><td className="dt">{l.txnDate && fmtDate(l.txnDate)}</td><td className="n"><Money v={l.gross} /></td><td className="n"><Money v={l.fee} /></td><td className="n"><Money v={l.feeVat} /></td><td className="n"><Money v={Number(l.gross) - Number(l.fee) - Number(l.feeVat)} /></td></tr>)}</tbody></table></div>
      </Modal>}
    </div>
  );
}

function SettleModal({ source, data, init, onClose }: { source: string; data: any; init: any; onClose: (r?: any) => void }) {
  const { run, busy } = useAction();
  const [bank, setBank] = useState<any>(null);
  const [date, setDate] = useState(today());
  const [reference, setReference] = useState("");
  const [net, setNet] = useState("");
  const [map, setMap] = useState<Record<string, number>>(init.map || {});
  React.useEffect(() => { if (data.rule.bankAccountId) api("/accounts").then((r) => setBank(r.rows.find((a: any) => a.id === data.rule.bankAccountId) || null)).catch(() => undefined); }, []);
  const fromFile = !!init.rows;
  const lines = fromFile
    ? init.rows.map((r: any[]) => ({ ref: map.ref !== undefined ? String(r[map.ref] ?? "").trim() : "", date: map.date !== undefined ? toDate(r[map.date]) : null, gross: map.gross !== undefined ? toNum(r[map.gross]) : 0, ...(map.fee !== undefined ? { fee: toNum(r[map.fee]) } : {}), ...(map.feeVat !== undefined ? { feeVat: toNum(r[map.feeVat]) } : {}) })).filter((l: any) => l.gross)
    : init.picked.map((o: any) => ({ invoiceId: o.invoiceId, gross: o.open }));
  const gross = lines.reduce((a: number, l: any) => a + l.gross, 0);
  const fileFees = fromFile && map.fee !== undefined ? lines.reduce((a: number, l: any) => a + Math.abs(l.fee || 0) + Math.abs(l.feeVat ?? (data.rule.vat ? (l.fee || 0) * CFG.vatRate / 100 : 0)), 0) : null;
  const expFee = lines.reduce((a: number, l: any) => a + (l.gross > 0 ? (Math.min(l.gross * data.rule.pct / 100, data.rule.cap || Infinity) + data.rule.fixed) * (data.rule.vat ? 1 + CFG.vatRate / 100 : 1) : 0), 0);
  const feeIncl = fileFees !== null ? fileFees : net !== "" ? gross - Number(net) : expFee;
  const ok = bank && lines.length > 0 && (!fromFile || (map.gross !== undefined && (map.ref !== undefined || map.date !== undefined)));
  return (
    <Modal wide={fromFile} narrow={!fromFile} title={fromFile ? `كشف التسوية: ${init.file}` : `تسوية ${lines.length} عملية`} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" data-settle-save disabled={busy || !ok} onClick={() => run(async () => { const r = await api(`/clearing/${source}/batches`, { body: { date, bankAccountId: bank.id, reference, net: fileFees === null && net !== "" ? Number(net) : null, lines } }); onClose(r); })}>ترحيل التسوية</button></>}>
      {fromFile && <><div className="small muted mb">حدّد أعمدة الملف. تُطابَق كل عملية برقم الفاتورة أو رقم الطلب أو رقم العملية على الجهاز، وإن لم يوجد مرجع فبالمبلغ والتاريخ معاً.</div>
        <div className="form-grid mb">{COLS.map(([k, label]) => <Field key={k} label={label}><Select data-col={k} value={map[k] ?? ""} onChange={(e) => { const m = { ...map }; if (e.target.value === "") delete m[k]; else m[k] = Number(e.target.value); setMap(m); }}><option value="">—</option>{init.head.map((h: string, i: number) => <option key={i} value={i}>{h || `عمود ${i + 1}`}</option>)}</Select></Field>)}</div></>}
      <div className={fromFile ? "form-grid" : "grid"}>
        <Field label="حساب البنك الذي وصله الإيداع"><div data-bank><Picker value={bank} onChange={setBank} fetcher={accountFetcher((a) => a.isCashBank && !["CARD_CLEARING", "ESTORE_CLEARING", "POS_CASH"].includes(a.systemKey))} label={(a: any) => `${a.code} ${a.nameAr}`} /></div></Field>
        <Field label="تاريخ الإيداع"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="مرجع الإيداع في كشف البنك"><Input dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        {fileFees === null && <Field label="المبلغ الذي وصل البنك فعلاً" hint={`اتركه فارغاً لاحتساب العمولة بالقاعدة (${money(gross - expFee)})`}><NumInput data-net value={net} onChange={(e) => setNet(e.target.value)} placeholder={money(gross - expFee)} /></Field>}
      </div>
      <div className="mini-kpis mt"><div><span>{lines.length} عملية بإجمالي</span><b><Money v={gross} /></b></div><div><span>العمولة شاملة ضريبتها</span><b className="neg-val"><Money v={feeIncl} /></b><small className="muted">{gross ? ((feeIncl / gross) * 100).toFixed(2) : 0}%</small></div><div><span>الصافي للبنك</span><b><Money v={gross - feeIncl} /></b></div></div>
      <div className="small muted mt">القيد: من ح/ البنك (الصافي) + ح/ {source === "CARD" ? "عمولات ومصروفات بنكية" : "عمولات منصات البيع"} + ح/ ضريبة المدخلات، إلى ح/ التسوية (الإجمالي).</div>
    </Modal>
  );
}

function RuleModal({ source, rule, card, onClose }: { source: string; rule: any; card: boolean; onClose: (s?: boolean) => void }) {
  const [f, setF] = useState<any>({ ...rule });
  const [bank, setBank] = useState<any>(null);
  const { run, busy } = useAction();
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <Modal narrow title={card ? "عمولة البنك على عمليات الشبكة" : "عمولة المنصة"} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" data-rule-save disabled={busy} onClick={() => run(async () => { await api(`/clearing/${source}/rule`, { method: "PUT", body: { ...f, bankAccountId: bank?.id || f.bankAccountId || null } }); onClose(true); }, "تم الحفظ")}>حفظ</button></>}>
      <div className="small muted mb">تُستخدم لتقدير العمولة قبل وصول الكشف ولمقارنتها بالفعلي. العمولة الفعلية تؤخذ دائماً من الكشف أو من المبلغ الواصل للبنك.</div>
      <div className="grid">
        <Field label="النسبة %" hint={card && CFG.country !== "EG" ? "مدى 0.8% بحد أقصى 160، والبطاقات الائتمانية حسب عقد البنك" : undefined}><NumInput data-rule-pct value={f.pct} onChange={s("pct")} /></Field>
        <Field label="مبلغ ثابت لكل عملية"><NumInput value={f.fixed} onChange={s("fixed")} /></Field>
        <Field label="حد أقصى للعمولة النسبية (0 = بلا حد)"><NumInput value={f.cap} onChange={s("cap")} /></Field>
        <Field label="الضريبة"><label className="check"><input type="checkbox" checked={!!f.vat} onChange={s("vat")} /> تُضاف ضريبة القيمة المضافة على العمولة (تُخصم كمدخلات)</label></Field>
        <Field label="حساب البنك المعتاد للإيداع"><Picker value={bank} onChange={setBank} fetcher={accountFetcher((a) => a.isCashBank && !["CARD_CLEARING", "ESTORE_CLEARING", "POS_CASH"].includes(a.systemKey))} label={(a: any) => `${a.code} ${a.nameAr}`} placeholder={f.bankAccountId ? "كما هو" : "اختياري"} /></Field>
      </div>
    </Modal>
  );
}

// ─── e-store profit per order and per unit ───────────────────────────────
export function EstoreProfitPage() {
  const base = useBase();
  const [from, setFrom] = useState(today().slice(0, 8) + "01");
  const [to, setTo] = useState(today());
  const [platform, setPlatform] = useState("");
  const [tab, setTab] = useState("orders");
  const { data, loading } = useFetch<any>(`/estore/profit${q({ from, to, platform })}`, [from, to, platform]);
  const T = data?.totals || {};
  return (
    <div className="grid" data-estore-profit>
      <div className="card"><div className="card-h"><div><h3>ربحية المتاجر الإلكترونية — لكل طلب ولكل وحدة</h3><div className="small muted">الإيراد قبل الضريبة − تكلفة البضاعة − عمولة المنصة. العمولة فعلية للطلبات التي سُوّيت مع كشف المنصة، ومقدَّرة بالقاعدة لما لم يُسوَّ بعد. المرتجعات مخصومة.</div></div>
        <div className="row"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /><Select value={platform} onChange={(e) => setPlatform(e.target.value)} style={{ width: 120 }}><option value="">كل المنصات</option><option value="SALLA">سلة</option><option value="ZID">زد</option></Select>
          {data && <ExportBtn name="ربحية المتاجر الإلكترونية" rows={() => (tab === "orders" ? data.orders.map((o: any) => ({ الفاتورة: o.number, التاريخ: o.date, المنصة: o.platformAr, "رقم الطلب": o.order, العميل: o.partnerName, الإيراد: o.revenue, المرتجع: o.returned, التكلفة: o.cogs, العمولة: o.fee, "العمولة فعلية": o.feeActual ? "نعم" : "مقدَّرة", الربح: o.profit, "الهامش %": o.margin, الوحدات: o.units, "ربح الوحدة": o.profitPerUnit })) : data.products.map((p: any) => ({ الصنف: p.name, الرمز: p.sku, الوحدات: p.units, الطلبات: p.orders, الإيراد: p.revenue, التكلفة: p.cogs, "نصيبه من العمولة": p.fee, الربح: p.profit, "الهامش %": p.margin, "ربح الوحدة": p.profitPerUnit })))} />}</div></div>
        {loading && !data ? <Loading /> : !data ? <Empty /> : <>
          <div className="card-b"><div className="mini-kpis">
            <div><span>الطلبات</span><b>{T.orders}</b><small className="muted">{T.units} وحدة</small></div>
            <div><span>الإيراد قبل الضريبة</span><b><Money v={T.revenue} /></b>{T.returned > 0 && <small className="muted">بعد مرتجعات {money(T.returned)}</small>}</div>
            <div><span>تكلفة البضاعة</span><b><Money v={T.cogs} /></b></div>
            <div><span>عمولات المنصات</span><b className="neg-val"><Money v={T.fee} /></b>{T.estimated > 0 && <small className="muted">{T.estimated} طلب بعمولة مقدَّرة</small>}</div>
            <div><span>صافي الربح</span><b className={T.profit < 0 ? "neg-val" : "pos-val"} data-profit-total><Money v={T.profit} /></b><small className="muted">هامش {T.margin}%</small></div>
            <div><span>طلبات خاسرة</span><b className={T.losing ? "neg-val" : ""}>{T.losing}</b></div>
          </div></div>
          <div className="card-b" style={{ paddingTop: 0, paddingBottom: 0 }}><Tabs tabs={[{ key: "orders", label: "لكل طلب" }, { key: "products", label: "لكل صنف ووحدة" }]} value={tab} onChange={setTab} /></div>
          {tab === "orders" ? (!data.orders.length ? <Empty text="لا توجد طلبات متاجر في هذه الفترة" /> : <div className="table-wrap"><table className="tbl compact" data-orders><thead><tr><th>الفاتورة</th><th>التاريخ</th><th>المنصة / الطلب</th><th>العميل</th><th className="n">الإيراد</th><th className="n">التكلفة</th><th className="n">العمولة</th><th className="n">الربح</th><th className="n">الهامش</th><th className="n">الوحدات</th><th className="n">ربح الوحدة</th></tr></thead>
            <tbody>{data.orders.map((o: any) => <tr key={o.id} className={o.profit < 0 ? "warn-row" : ""}><td><Link to={`${base}/doc/${o.id}`}>{o.number}</Link></td><td className="dt">{fmtDate(o.date)}</td><td>{o.platformAr} <span className="small muted" dir="ltr">{o.order}</span></td><td>{o.partnerName}</td><td className="n"><Money v={o.revenue} />{o.returned > 0 && <div className="small muted">مرتجع {money(o.returned)}</div>}</td><td className="n"><Money v={o.cogs} /></td><td className="n"><Money v={o.fee} />{!o.feeActual && <div className="small muted">مقدَّرة</div>}</td><td className={"n " + (o.profit < 0 ? "neg-val" : "")}><b><Money v={o.profit} /></b></td><td className="n">{o.margin}%</td><td className="n">{o.units}</td><td className="n"><Money v={o.profitPerUnit} /></td></tr>)}</tbody></table></div>)
            : (!data.products.length ? <Empty /> : <div className="table-wrap"><table className="tbl compact" data-products><thead><tr><th>الصنف</th><th className="n">الوحدات</th><th className="n">الطلبات</th><th className="n">الإيراد</th><th className="n">التكلفة</th><th className="n">نصيبه من العمولة</th><th className="n">الربح</th><th className="n">الهامش</th><th className="n">ربح الوحدة</th></tr></thead>
              <tbody>{data.products.map((p: any) => <tr key={p.productId} className={p.profit < 0 ? "warn-row" : ""}><td><b>{p.name}</b><div className="small muted" dir="ltr">{p.sku}</div></td><td className="n">{p.units}</td><td className="n">{p.orders}</td><td className="n"><Money v={p.revenue} /></td><td className="n"><Money v={p.cogs} /></td><td className="n"><Money v={p.fee} /></td><td className={"n " + (p.profit < 0 ? "neg-val" : "")}><b><Money v={p.profit} /></b></td><td className="n">{p.margin}%</td><td className="n"><Money v={p.profitPerUnit} /></td></tr>)}</tbody></table></div>)}
          <div className="card-b small muted">{T.shippingNet ? `رسوم الشحن المحصَّلة من العملاء (${money(T.shippingNet)} بعد نصيبها من العمولة) تدخل في ربح الطلب لا في ربح الصنف. ` : ""}ربح الطلب هنا قبل مصروفات التشغيل العامة (رواتب، إيجار، إعلانات). تكلفة الشحن التي تدفعها لشركة الشحن تُسجَّل مصروفاً وتظهر في قائمة الدخل، لا في هذا التقرير. <Link to={`${base}/estore/settlement`}>تسوية المنصات مع البنك ←</Link></div>
        </>}
      </div>
    </div>
  );
}
