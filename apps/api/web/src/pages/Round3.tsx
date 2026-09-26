import React, { useEffect, useState } from "react";
import { api, q, useFetch, Money, money, Loading, Empty, Badge, Modal, Field, Input, Select, NumInput, Picker, partnerFetcher, accountFetcher, useAction, useToast, useCompanyContext, ExportBtn, PrintBtn, today, fmtDate, confirmDlg, JTYPE_AR } from "../lib";

// ─── cheques ───────────────────────────────────────────────────────────────
const CH_STATUS: Record<string, string> = { PENDING: "قيد الانتظار", DEPOSITED: "مودع للتحصيل", CLEARED: "محصّل / مصروف", BOUNCED: "مرتجع (بدون رصيد)", CANCELLED: "ملغى" };
const chColor = (s: string) => ({ PENDING: "amber", DEPOSITED: "blue", CLEARED: "green", BOUNCED: "red", CANCELLED: "gray" } as any)[s] || "gray";

export function ChequesPage() {
  const { can } = useCompanyContext();
  const [dir, setDir] = useState("");
  const [status, setStatus] = useState("");
  const [add, setAdd] = useState<"IN" | "OUT" | null>(null);
  const [act, setAct] = useState<{ c: any; mode: "deposit" | "clear" } | null>(null);
  const { data, loading, reload } = useFetch(`/cheques${q({ direction: dir, status })}`);
  const { run, busy } = useAction();
  const sum = (d: string, s: string[]) => (data?.summary || []).filter((x: any) => x.direction === d && s.includes(x.status)).reduce((a: number, x: any) => a + Number(x.amount), 0);
  return (
    <div className="grid">
      <div className="grid c4">
        <div className="card kpi success"><div className="label">شيكات مستلمة قيد التحصيل</div><div className="value"><Money v={sum("IN", ["PENDING", "DEPOSITED"])} /></div></div>
        <div className="card kpi danger"><div className="label">شيكات صادرة لم تُصرف بعد</div><div className="value"><Money v={sum("OUT", ["PENDING"])} /></div></div>
        <div className="card kpi accent"><div className="label">مستحقة خلال 7 أيام</div><div className="value">{data?.dueSoon.length || 0}</div><div className="sub">{data?.dueSoon.slice(0, 3).map((x: any) => `${x.chequeNo} (${fmtDate(x.dueDate)})`).join(" · ")}</div></div>
        <div className="card kpi"><div className="label">شيكات مرتجعة</div><div className="value"><Money v={sum("IN", ["BOUNCED"])} /></div></div>
      </div>
      <div className="card">
        <div className="card-h"><h3>سجل الشيكات</h3><div className="row">
          <Select value={dir} onChange={(e) => setDir(e.target.value)}><option value="">مستلمة وصادرة</option><option value="IN">شيكات مستلمة (عملاء)</option><option value="OUT">شيكات صادرة (موردون)</option></Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">كل الحالات</option>{Object.entries(CH_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          {can("payments.write") && <><button className="btn primary sm" onClick={() => setAdd("IN")}>＋ شيك مستلم</button><button className="btn sm" onClick={() => setAdd("OUT")}>＋ شيك صادر</button></>}
          {data && <ExportBtn name="الشيكات" rows={() => data.rows.map((c: any) => ({ الاتجاه: c.direction === "IN" ? "مستلم" : "صادر", "رقم الشيك": c.chequeNo, البنك: c.bankName, الطرف: c.partnerName, المبلغ: c.amount, "تاريخ الاستلام": c.receivedDate, الاستحقاق: c.dueDate, الحالة: CH_STATUS[c.status], السند: c.voucherNumber }))} />}
        </div></div>
        {loading && !data ? <Loading /> : !data.rows.length ? <Empty text="لا توجد شيكات مسجلة" /> : (
          <div className="table-wrap"><table className="tbl"><thead><tr><th>النوع</th><th>رقم الشيك</th><th>البنك</th><th>الطرف</th><th className="n">المبلغ</th><th>الاستلام</th><th>الاستحقاق</th><th>السند</th><th>الحالة</th><th /></tr></thead>
            <tbody>{data.rows.map((c: any) => { const overdue = ["PENDING", "DEPOSITED"].includes(c.status) && c.dueDate < today(); return (
              <tr key={c.id}><td>{c.direction === "IN" ? <span className="badge green">مستلم</span> : <span className="badge red">صادر</span>}</td><td className="num"><b>{c.chequeNo}</b></td><td>{c.bankName}</td><td>{c.partnerName}</td><td className="n"><Money v={c.amount} /></td><td>{fmtDate(c.receivedDate)}</td><td className={overdue ? "neg-val bold" : ""}>{fmtDate(c.dueDate)}</td><td className="small">{c.voucherNumber}</td><td><span className={"badge " + chColor(c.status)}>{CH_STATUS[c.status]}</span></td>
                <td className="row" style={{ gap: 4 }}>{can("payments.write") && ["PENDING", "DEPOSITED"].includes(c.status) && <>
                  {c.direction === "IN" && c.status === "PENDING" && <button className="btn sm ghost" onClick={() => setAct({ c, mode: "deposit" })}>إيداع</button>}
                  <button className="btn sm primary" onClick={() => setAct({ c, mode: "clear" })}>{c.direction === "IN" ? "تحصيل" : "صرف"}</button>
                  <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { if (confirmDlg(c.direction === "IN" ? "تسجيل الشيك كمرتجع (بدون رصيد)؟ سيُعاد فتح فواتير العميل." : "إلغاء الشيك الصادر؟")) { await api(`/cheques/${c.id}/bounce`, { body: { cancelled: c.direction === "OUT" } }); reload(); } })}>{c.direction === "IN" ? "مرتجع" : "إلغاء"}</button>
                </>}</td></tr>); })}</tbody></table></div>
        )}
      </div>
      {add && <ChequeForm direction={add} onClose={(s) => { setAdd(null); if (s) reload(); }} />}
      {act && <ChequeAction c={act.c} mode={act.mode} onClose={(s) => { setAct(null); if (s) reload(); }} />}
    </div>
  );
}

function ChequeForm({ direction, onClose }: { direction: "IN" | "OUT"; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [partner, setPartner] = useState<any>(null);
  const [f, setF] = useState<any>({ chequeNo: "", bankName: "", amount: "", receivedDate: today(), dueDate: today(), notes: "" });
  const [open, setOpen] = useState<any[]>([]);
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  useEffect(() => { if (partner) api(`/payments/open-invoices/${partner.id}?direction=${direction}`).then(setOpen); else setOpen([]); setAlloc({}); }, [partner]);
  useEffect(() => { let rest = Number(f.amount || 0); const a: Record<string, number> = {}; for (const i of open) { const d = Math.min(Number(i.due), rest); if (d <= 0) break; a[i.id] = Math.round(d * 100) / 100; rest -= d; } setAlloc(a); }, [f.amount, open]);
  return (
    <Modal title={direction === "IN" ? "تسجيل شيك مستلم من عميل" : "تسجيل شيك صادر لمورد"} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !partner || !f.chequeNo || !Number(f.amount)} onClick={() => run(async () => { await api("/cheques", { body: { direction, partnerId: partner.id, ...f, amount: Number(f.amount), allocations: Object.entries(alloc).filter(([, v]) => v > 0).map(([invoiceId, amount]) => ({ invoiceId, amount })) } }); onClose(true); }, "تم تسجيل الشيك وقيده")}>تسجيل</button></>}>
      <div className="form-grid">
        <Field label={direction === "IN" ? "العميل" : "المورد"} span2><Picker value={partner} onChange={setPartner} fetcher={partnerFetcher(direction === "IN" ? "CUSTOMER" : "SUPPLIER")} label={(p: any) => `${p.name} — الرصيد ${money(p.balance)}`} autoFocus /></Field>
        <Field label="رقم الشيك"><Input value={f.chequeNo} onChange={s("chequeNo")} dir="ltr" /></Field>
        <Field label="البنك المسحوب عليه"><Input value={f.bankName} onChange={s("bankName")} /></Field>
        <Field label="المبلغ"><NumInput value={f.amount} onChange={s("amount")} /></Field>
        <Field label={direction === "IN" ? "تاريخ الاستلام" : "تاريخ الإصدار"}><Input type="date" value={f.receivedDate} onChange={s("receivedDate")} /></Field>
        <Field label="تاريخ الاستحقاق"><Input type="date" value={f.dueDate} onChange={s("dueDate")} /></Field>
        <Field label="ملاحظات" span2><Input value={f.notes} onChange={s("notes")} /></Field>
      </div>
      <div className="alert info small mt">{direction === "IN" ? "القيد: من حـ/ أوراق القبض إلى حـ/ العميل، وعند التحصيل: من حـ/ البنك إلى حـ/ أوراق القبض." : "القيد: من حـ/ المورد إلى حـ/ أوراق الدفع، وعند الصرف: من حـ/ أوراق الدفع إلى حـ/ البنك."}</div>
      {open.length > 0 && <table className="tbl compact mt"><thead><tr><th>الفاتورة</th><th>الاستحقاق</th><th className="n">المتبقي</th><th>المخصص</th></tr></thead><tbody>{open.map((i) => <tr key={i.id}><td>{i.number}</td><td>{fmtDate(i.dueDate)}</td><td className="n"><Money v={i.due} /></td><td><NumInput value={alloc[i.id] || ""} onChange={(e) => setAlloc({ ...alloc, [i.id]: Math.min(Number(i.due), Number(e.target.value) || 0) })} style={{ width: 120 }} /></td></tr>)}</tbody></table>}
    </Modal>
  );
}

function ChequeAction({ c, mode, onClose }: { c: any; mode: "deposit" | "clear"; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [bank, setBank] = useState<any>(null);
  const [date, setDate] = useState(today());
  return (
    <Modal narrow title={mode === "deposit" ? `إيداع الشيك ${c.chequeNo} للتحصيل` : c.direction === "IN" ? `تحصيل الشيك ${c.chequeNo}` : `صرف الشيك ${c.chequeNo}`} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !bank} onClick={() => run(async () => { await api(`/cheques/${c.id}/${mode}`, { body: { bankAccountId: bank.id, date } }); onClose(true); }, mode === "deposit" ? "تم الإيداع" : "تم القيد")}>تأكيد</button></>}>
      <div className="grid"><Field label="حساب البنك"><Picker value={bank} onChange={setBank} fetcher={accountFetcher((a) => a.isCashBank && a.subtype === "BANK")} label={(a: any) => `${a.code} ${a.nameAr}`} /></Field>{mode === "clear" && <Field label="التاريخ"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>}<div className="stat-list"><div className="item"><span>المبلغ</span><b><Money v={c.amount} /></b></div><div className="item"><span>الطرف</span><b>{c.partnerName}</b></div></div></div>
    </Modal>
  );
}

// ─── recurring templates ───────────────────────────────────────────────────
const FREQ: Record<string, string> = { WEEKLY: "أسبوعي", MONTHLY: "شهري", QUARTERLY: "ربع سنوي", YEARLY: "سنوي" };
const RKIND: Record<string, string> = { EXPENSE: "مصروف", JOURNAL: "قيد يومية", SALE_INVOICE: "فاتورة مبيعات (مسودة)" };

export function RecurringPage() {
  const { can } = useCompanyContext();
  const { data, loading, reload } = useFetch("/recurring");
  const { run, busy } = useAction();
  const toast = useToast();
  const [add, setAdd] = useState(false);
  return (
    <div className="card">
      <div className="card-h"><div><h3>القيود والمستندات الدورية</h3><div className="small muted">إيجار شهري، رواتب، اشتراكات، فواتير عقود… تُنشأ تلقائياً في موعدها (كل ساعة يفحص النظام المستحق) أو بضغطة زر.</div></div><div className="row">{can("accounting.write") && <><button className="btn sm" disabled={busy} onClick={() => run(async () => { const r = await api("/recurring/run", { body: {} }); toast(r.length ? `تم تنفيذ ${r.length} عملية` : "لا يوجد مستحق اليوم", "ok"); reload(); })}>تنفيذ المستحق الآن</button><button className="btn primary sm" onClick={() => setAdd(true)}>＋ قالب جديد</button></>}</div></div>
      {loading && !data ? <Loading /> : !data.length ? <Empty text="لا توجد قوالب دورية" /> : <div className="table-wrap"><table className="tbl"><thead><tr><th>الاسم</th><th>النوع</th><th>التكرار</th><th>التنفيذ القادم</th><th>آخر تنفيذ</th><th className="n">عدد المرات</th><th className="n">المبلغ</th><th>الحالة</th><th /></tr></thead>
        <tbody>{data.map((t: any) => <tr key={t.id}><td><b>{t.name}</b></td><td>{RKIND[t.kind]}</td><td>{FREQ[t.frequency]}</td><td className={t.isActive && t.nextDate <= today() ? "neg-val bold" : ""}>{fmtDate(t.nextDate)}</td><td>{fmtDate(t.lastRun) || "—"}</td><td className="n">{t.runs}</td><td className="n">{t.kind === "EXPENSE" ? <Money v={t.payload.amount} /> : t.kind === "JOURNAL" ? <Money v={(t.payload.lines || []).reduce((a: number, l: any) => a + Number(l.debit || 0), 0)} /> : ""}</td><td><Badge s={t.isActive ? "ACTIVE" : "CANCELLED"} map={{ ACTIVE: "نشط", CANCELLED: "موقوف" }} /></td>
          <td className="row" style={{ gap: 4 }}>{can("accounting.write") && <><button className="btn sm ghost" onClick={() => run(async () => { const r = await api(`/recurring/${t.id}/run-now`, { body: {} }); toast(`تم إنشاء ${r.number || "المستند"}`, "ok"); reload(); })}>تنفيذ الآن</button><button className="btn sm ghost" onClick={() => run(async () => { await api(`/recurring/${t.id}`, { method: "PUT", body: { isActive: !t.isActive } }); reload(); })}>{t.isActive ? "إيقاف" : "تفعيل"}</button><button className="btn sm ghost" onClick={() => run(async () => { if (confirmDlg("حذف القالب؟")) { await api(`/recurring/${t.id}`, { method: "DELETE" }); reload(); } })}>حذف</button></>}</td></tr>)}</tbody></table></div>}
      {add && <RecurringForm onClose={(s) => { setAdd(false); if (s) reload(); }} />}
    </div>
  );
}

function RecurringForm({ onClose }: { onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [kind, setKind] = useState("EXPENSE");
  const [f, setF] = useState<any>({ name: "", frequency: "MONTHLY", nextDate: today().slice(0, 8) + "01", endDate: "" });
  const [exp, setExp] = useState<any>({ description: "", payee: "", amount: "", taxCode: "S", amountIncludesVat: false });
  const [account, setAccount] = useState<any>(null);
  const [pay, setPay] = useState<any>(null);
  const [partner, setPartner] = useState<any>(null);
  const [credit, setCredit] = useState(false);
  const [lines, setLines] = useState<any[]>([{ key: 1, account: null, debit: "", credit: "", description: "" }, { key: 2, account: null, debit: "", credit: "", description: "" }]);
  const [memo, setMemo] = useState("");
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const se = (k: string) => (e: any) => setExp({ ...exp, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const payload = () => {
    if (kind === "EXPENSE") return { ...exp, amount: Number(exp.amount), accountId: account?.id, payAccountId: credit ? null : pay?.id, partnerId: credit ? partner?.id : null };
    if (kind === "JOURNAL") return { memo, lines: lines.filter((l) => l.account).map((l) => ({ accountId: l.account.id, debit: Number(l.debit || 0), credit: Number(l.credit || 0), description: l.description })) };
    return { partnerId: partner?.id, lines: lines.filter((l) => l.description).map((l) => ({ description: l.description, qty: 1, unitPrice: Number(l.debit || 0), taxCode: "S" })) };
  };
  return (
    <Modal wide title="قالب دوري جديد" onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !f.name} onClick={() => run(async () => { await api("/recurring", { body: { ...f, kind, endDate: f.endDate || null, payload: payload() } }); onClose(true); }, "تم حفظ القالب")}>حفظ</button></>}>
      <div className="form-grid">
        <Field label="اسم القالب" span2><Input autoFocus value={f.name} onChange={s("name")} placeholder="مثال: إيجار المعرض الشهري" /></Field>
        <Field label="النوع"><Select value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(RKIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="التكرار"><Select value={f.frequency} onChange={s("frequency")}>{Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="أول تنفيذ"><Input type="date" value={f.nextDate} onChange={s("nextDate")} /></Field>
        <Field label="ينتهي في (اختياري)"><Input type="date" value={f.endDate} onChange={s("endDate")} /></Field>
      </div>
      <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "14px 0" }} />
      {kind === "EXPENSE" && <div className="form-grid">
        <Field label="حساب المصروف" span2><Picker value={account} onChange={setAccount} fetcher={accountFetcher((a) => a.type === "EXPENSE")} label={(a: any) => `${a.code} ${a.nameAr}`} /></Field>
        <Field label="المبلغ"><NumInput value={exp.amount} onChange={se("amount")} /></Field>
        <Field label="الضريبة"><Select value={exp.taxCode} onChange={se("taxCode")}><option value="S">خاضع 15%</option><option value="E">معفى</option><option value="O">خارج النطاق</option></Select></Field>
        <Field label="البيان" span2><Input value={exp.description} onChange={se("description")} /></Field>
        <Field label="المستفيد"><Input value={exp.payee} onChange={se("payee")} /></Field>
        <Field label="الدفع"><Select value={credit ? "CREDIT" : "NOW"} onChange={(e) => setCredit(e.target.value === "CREDIT")}><option value="NOW">نقدي / بنك</option><option value="CREDIT">آجل على مورد</option></Select></Field>
        {credit ? <Field label="المورد" span2><Picker value={partner} onChange={setPartner} fetcher={partnerFetcher("SUPPLIER")} label={(p: any) => p.name} /></Field> : <Field label="من حساب" span2><Picker value={pay} onChange={setPay} fetcher={accountFetcher((a) => a.isCashBank)} label={(a: any) => `${a.code} ${a.nameAr}`} /></Field>}
      </div>}
      {kind === "JOURNAL" && <>
        <Field label="بيان القيد"><Input value={memo} onChange={(e) => setMemo(e.target.value)} /></Field>
        <table className="tbl compact mt"><thead><tr><th style={{ width: "40%" }}>الحساب</th><th>مدين</th><th>دائن</th><th>البيان</th><th /></tr></thead><tbody>{lines.map((l) => <tr key={l.key}><td><Picker value={l.account} onChange={(a) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, account: a } : x)))} fetcher={accountFetcher()} label={(a: any) => `${a.code} ${a.nameAr}`} /></td><td><NumInput value={l.debit} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, debit: e.target.value } : x)))} /></td><td><NumInput value={l.credit} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, credit: e.target.value } : x)))} /></td><td><Input value={l.description} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, description: e.target.value } : x)))} /></td><td><button className="btn ghost sm" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button></td></tr>)}</tbody></table>
        <button className="btn sm mt" onClick={() => setLines((ls) => [...ls, { key: Date.now(), account: null, debit: "", credit: "", description: "" }])}>＋ سطر</button>
      </>}
      {kind === "SALE_INVOICE" && <>
        <Field label="العميل"><Picker value={partner} onChange={setPartner} fetcher={partnerFetcher("CUSTOMER")} label={(p: any) => p.name} /></Field>
        <table className="tbl compact mt"><thead><tr><th>البيان (خدمة/اشتراك)</th><th>المبلغ قبل الضريبة</th><th /></tr></thead><tbody>{lines.map((l) => <tr key={l.key}><td><Input value={l.description} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, description: e.target.value } : x)))} placeholder="مثال: اشتراك صيانة شهري" /></td><td><NumInput value={l.debit} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, debit: e.target.value } : x)))} /></td><td><button className="btn ghost sm" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button></td></tr>)}</tbody></table>
        <button className="btn sm mt" onClick={() => setLines((ls) => [...ls, { key: Date.now(), account: null, debit: "", credit: "", description: "" }])}>＋ سطر</button>
        <div className="hint mt">تُنشأ الفاتورة كمسودة في موعدها لمراجعتها وترحيلها من شاشة فواتير المبيعات.</div>
      </>}
    </Modal>
  );
}

// ─── zakat ─────────────────────────────────────────────────────────────────
export function ZakatReport({ from, to }: { from: string; to: string }) {
  const { can } = useCompanyContext();
  const [cal, setCal] = useState("gregorian");
  const { data: d, reload } = useFetch(`/reports/zakat${q({ from, to, calendar: cal })}`);
  const { run, busy } = useAction();
  const [amt, setAmt] = useState("");
  useEffect(() => { if (d) setAmt(String(d.zakat)); }, [d?.zakat]);
  if (!d) return <Loading />;
  return (
    <div className="card">
      <div className="card-h"><div><h3>تقدير الوعاء الزكوي والزكاة المستحقة</h3><div className="small muted">كما في {d.to} — نتيجة الفترة من {d.from}</div></div><div className="row no-print"><Select value={cal} onChange={(e) => setCal(e.target.value)} style={{ width: 200 }}><option value="gregorian">سنة ميلادية (2.577%)</option><option value="hijri">سنة هجرية (2.5%)</option></Select><PrintBtn /></div></div>
      <div className="table-wrap"><table className="tbl compact"><tbody>
        {d.lines.map((l: any, i: number) => <tr key={i} style={l.bold ? { fontWeight: 700, background: "var(--surface-2)" } : {}}><td>{l.label}</td><td className="n"><Money v={l.amount} sign={!l.bold} /></td></tr>)}
        <tr style={{ fontWeight: 700 }}><td>الوعاء الزكوي المعتمد (الأعلى من الطريقتين)</td><td className="n"><Money v={d.base} /></td></tr>
        <tr style={{ fontWeight: 700, fontSize: 15, background: "var(--primary-soft)" }}><td>الزكاة المستحقة ({(d.rate * 100).toFixed(3)}%)</td><td className="n"><Money v={d.zakat} /></td></tr>
        <tr><td>مخصص الزكاة المسجل في الدفاتر</td><td className="n"><Money v={d.provisionBooked} /></td></tr>
      </tbody></table></div>
      <div className="card-b">
        <div className="alert warn small">{d.disclaimer}</div>
        {can("accounting.write") && <div className="row no-print"><span>تسجيل مخصص الزكاة:</span><NumInput value={amt} onChange={(e) => setAmt(e.target.value)} style={{ width: 160 }} /><button className="btn primary sm" disabled={busy || !Number(amt)} onClick={() => run(async () => { if (!confirmDlg(`ترحيل قيد مخصص الزكاة بمبلغ ${money(Number(amt))} بتاريخ ${d.to}؟`)) return; await api("/reports/zakat/provision", { body: { amount: Number(amt), date: d.to } }); reload(); }, "تم ترحيل مخصص الزكاة")}>ترحيل القيد (مصروف الزكاة / مخصص الزكاة)</button></div>}
      </div>
    </div>
  );
}
