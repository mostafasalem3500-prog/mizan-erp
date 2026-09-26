import React, { useEffect, useState } from "react";
import { api, q, useFetch, Money, money, Loading, Empty, Badge, Modal, Field, Input, Select, NumInput, Picker, partnerFetcher, accountFetcher, useAction, useToast, useCompanyContext, ExportBtn, PrintBtn, useDebounce, DateRange, monthStart, today, fmtDate, METHOD_AR, TAX_AR, confirmDlg } from "../lib";

// ─── payments (receipt / payment vouchers) ─────────────────────────────────
export function PaymentsPage({ direction }: { direction: "IN" | "OUT" }) {
  const { can } = useCompanyContext();
  const [search, setSearch] = useState("");
  const dq = useDebounce(search);
  const [from, setFrom] = useState(monthStart().slice(0, 4) + "-01-01");
  const [to, setTo] = useState(today());
  const [edit, setEdit] = useState(false);
  const [view, setView] = useState<any>(null);
  const { data, loading, reload } = useFetch(`/payments${q({ direction, q: dq, from, to, limit: 500 })}`);
  const { run } = useAction();
  const title = direction === "IN" ? "سندات القبض" : "سندات الصرف";
  return (
    <div className="card">
      <div className="card-h"><h3>{title}</h3>{can("payments.write") && <button className="btn primary sm" onClick={() => setEdit(true)}>＋ {direction === "IN" ? "سند قبض" : "سند صرف"}</button>}</div>
      <div className="card-b">
        <div className="toolbar"><div className="search"><span className="ic">🔍</span><Input placeholder="بحث" value={search} onChange={(e) => setSearch(e.target.value)} /></div><DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} /><div className="grow" />{data && <ExportBtn name={title} rows={() => data.map((p: any) => ({ الرقم: p.number, التاريخ: p.date, الطرف: p.partnerName, الطريقة: METHOD_AR[p.method], الحساب: p.accountName, المبلغ: p.amount, المخصص: p.allocated, المرجع: p.reference, الحالة: p.status }))} />}</div>
        {loading && !data ? <Loading /> : !data?.length ? <Empty /> : <div className="table-wrap"><table className="tbl"><thead><tr><th>الرقم</th><th>التاريخ</th><th>الطرف</th><th>الطريقة</th><th>الصندوق/البنك</th><th className="n">المبلغ</th><th className="n">المخصص للفواتير</th><th>المرجع</th><th>الحالة</th><th /></tr></thead>
          <tbody>{data.map((p: any) => <tr key={p.id} className={p.status === "CANCELLED" ? "muted" : ""}><td><b>{p.number}</b></td><td>{fmtDate(p.date)}</td><td>{p.partnerName}</td><td>{METHOD_AR[p.method]}</td><td>{p.accountName}</td><td className="n"><Money v={p.amount} /></td><td className="n"><Money v={p.allocated} /></td><td className="num">{p.reference}</td><td><Badge s={p.status} /></td>
            <td className="row" style={{ gap: 4 }}><button className="btn sm" onClick={() => setView(p)}>🖨</button>{p.status === "POSTED" && can("payments.write") && <button className="btn sm ghost" onClick={() => run(async () => { if (confirmDlg(`إلغاء السند ${p.number}؟ سيُنشأ قيد عكسي وتُلغى التخصيصات.`)) { await api(`/payments/${p.id}/cancel`, { body: {} }); reload(); } }, "تم الإلغاء")}>إلغاء</button>}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={5}>الإجمالي</td><td className="n"><Money v={data.filter((p: any) => p.status === "POSTED").reduce((a: number, p: any) => a + Number(p.amount), 0)} /></td><td colSpan={4} /></tr></tfoot></table></div>}
      </div>
      {edit && <PaymentEditor direction={direction} onClose={(s) => { setEdit(false); if (s) reload(); }} />}
      {view && <VoucherPrint p={view} direction={direction} onClose={() => setView(null)} />}
    </div>
  );
}

function PaymentEditor({ direction, onClose }: { direction: "IN" | "OUT"; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [partner, setPartner] = useState<any>(null);
  const [account, setAccount] = useState<any>(null);
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState<string>("");
  const [method, setMethod] = useState("CASH");
  const [ref, setRef] = useState("");
  const [notes, setNotes] = useState("");
  const [open, setOpen] = useState<any[]>([]);
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [auto, setAuto] = useState(true);
  useEffect(() => { if (partner) api(`/payments/open-invoices/${partner.id}?direction=${direction}`).then(setOpen); else setOpen([]); setAlloc({}); }, [partner]);
  const allocated = Object.values(alloc).reduce((a, b) => a + (b || 0), 0);
  const amt = Number(amount || 0);
  const autoFill = () => { let rest = amt; const a: Record<string, number> = {}; for (const i of open) { const d = Math.min(Number(i.due), rest); if (d <= 0) break; a[i.id] = Math.round(d * 100) / 100; rest -= d; } setAlloc(a); };
  useEffect(() => { if (auto) autoFill(); }, [amount, open, auto]);
  return (
    <Modal title={direction === "IN" ? "سند قبض جديد" : "سند صرف جديد"} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !partner || !account || amt <= 0} onClick={() => run(async () => { await api("/payments", { body: { direction, partnerId: partner.id, accountId: account.id, date, amount: amt, method, reference: ref, notes, allocations: Object.entries(alloc).filter(([, v]) => v > 0).map(([invoiceId, amount]) => ({ invoiceId, amount })) } }); onClose(true); }, "تم تسجيل السند وترحيل القيد")}>حفظ وترحيل</button></>}>
      <div className="form-grid">
        <Field label={direction === "IN" ? "العميل" : "المورد"} span2><Picker value={partner} onChange={setPartner} fetcher={partnerFetcher(direction === "IN" ? "CUSTOMER" : "SUPPLIER")} label={(p: any) => `${p.name} — الرصيد ${money(p.balance)}`} autoFocus /></Field>
        <Field label="التاريخ"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="المبلغ"><NumInput value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="طريقة الدفع"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{["CASH", "BANK", "CARD", "CHEQUE"].map((m) => <option key={m} value={m}>{METHOD_AR[m]}</option>)}</Select></Field>
        <Field label="الصندوق / البنك"><Picker value={account} onChange={setAccount} fetcher={accountFetcher((a) => a.isCashBank)} label={(a: any) => `${a.code} ${a.nameAr}`} /></Field>
        <Field label="المرجع (حوالة/شيك)"><Input value={ref} onChange={(e) => setRef(e.target.value)} dir="ltr" /></Field>
        <Field label="بيان"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {partner && (
        <div className="mt">
          <div className="row between"><h3>تخصيص المبلغ على الفواتير المفتوحة</h3><label className="check"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> تخصيص تلقائي (الأقدم أولاً)</label></div>
          {!open.length ? <div className="muted mt">لا توجد فواتير مفتوحة — سيُسجل المبلغ كدفعة مقدمة على الحساب.</div> : (
            <table className="tbl compact mt"><thead><tr><th>الفاتورة</th><th>التاريخ</th><th>الاستحقاق</th><th className="n">الإجمالي</th><th className="n">المتبقي</th><th>المخصص</th></tr></thead>
              <tbody>{open.map((i) => <tr key={i.id}><td>{i.number}</td><td>{fmtDate(i.date)}</td><td>{fmtDate(i.dueDate)}</td><td className="n"><Money v={i.total} /></td><td className="n"><Money v={i.due} /></td><td><NumInput value={alloc[i.id] || ""} max={Number(i.due)} onChange={(e) => { setAuto(false); setAlloc({ ...alloc, [i.id]: Math.min(Number(i.due), Number(e.target.value) || 0) }); }} style={{ width: 120 }} /></td></tr>)}</tbody>
              <tfoot><tr><td colSpan={5}>المخصص / المبلغ</td><td className={allocated > amt + 0.001 ? "neg-val" : ""}><Money v={allocated} /> / <Money v={amt} /></td></tr></tfoot></table>
          )}
        </div>
      )}
    </Modal>
  );
}

function VoucherPrint({ p, direction, onClose }: { p: any; direction: string; onClose: () => void }) {
  const { me } = useCompanyContext();
  return (
    <Modal title={`${direction === "IN" ? "سند قبض" : "سند صرف"} ${p.number}`} onClose={onClose} footer={<><PrintBtn /><button className="btn" onClick={onClose}>إغلاق</button></>}>
      <div className="print-doc">
        <div className="head"><div><h2>{me.company.nameAr}</h2><div className="small">{me.company.vatNumber && <>الرقم الضريبي: {me.company.vatNumber}</>}</div></div><div><h2 style={{ color: "var(--primary)" }}>{direction === "IN" ? "سند قبض" : "سند صرف"}</h2><div>رقم: <b className="num">{p.number}</b></div><div>التاريخ: <span className="num">{fmtDate(p.date)}</span></div></div></div>
        <table><tbody>
          <tr><td style={{ width: 160 }}>{direction === "IN" ? "استلمنا من السيد/السادة" : "صرفنا إلى السيد/السادة"}</td><td><b>{p.partnerName}</b></td></tr>
          <tr><td>مبلغاً وقدره</td><td><b className="num" style={{ fontSize: 18 }}>{money(p.amount)} ريال سعودي</b></td></tr>
          <tr><td>طريقة الدفع</td><td>{METHOD_AR[p.method]} — {p.accountName}{p.reference && <> — مرجع: <span className="num">{p.reference}</span></>}</td></tr>
          <tr><td>وذلك عن</td><td>{p.notes || (p.allocations?.length ? "سداد فواتير" : "دفعة على الحساب")}</td></tr>
        </tbody></table>
        <div className="row between mt" style={{ marginTop: 40 }}><div>المحاسب: ____________</div><div>المستلم: ____________</div><div>المدير: ____________</div></div>
      </div>
    </Modal>
  );
}

// ─── expenses ──────────────────────────────────────────────────────────────
export function ExpensesPage() {
  const { can } = useCompanyContext();
  const [search, setSearch] = useState("");
  const dq = useDebounce(search);
  const [from, setFrom] = useState(monthStart().slice(0, 4) + "-01-01");
  const [to, setTo] = useState(today());
  const [edit, setEdit] = useState(false);
  const { data, loading, reload } = useFetch(`/expenses${q({ q: dq, from, to, limit: 500 })}`);
  const { run } = useAction();
  return (
    <div className="card">
      <div className="card-h"><h3>المصروفات</h3>{can("expenses.write") && <button className="btn primary sm" onClick={() => setEdit(true)}>＋ مصروف جديد</button>}</div>
      <div className="card-b">
        <div className="toolbar"><div className="search"><span className="ic">🔍</span><Input placeholder="بحث" value={search} onChange={(e) => setSearch(e.target.value)} /></div><DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} /><div className="grow" />{data && <ExportBtn name="المصروفات" rows={() => data.map((e: any) => ({ الرقم: e.number, التاريخ: e.date, الحساب: `${e.accountCode} ${e.accountName}`, البيان: e.description, المستفيد: e.payee, "المبلغ": e.amount, الضريبة: e.vatAmount, الإجمالي: e.total, "طريقة الدفع": e.payAccountName || "آجل", الحالة: e.status }))} />}</div>
        {loading && !data ? <Loading /> : !data?.length ? <Empty /> : <div className="table-wrap"><table className="tbl"><thead><tr><th>الرقم</th><th>التاريخ</th><th>حساب المصروف</th><th>البيان</th><th>المستفيد</th><th className="n">قبل الضريبة</th><th className="n">الضريبة</th><th className="n">الإجمالي</th><th>الدفع</th><th /></tr></thead>
          <tbody>{data.map((e: any) => <tr key={e.id} className={e.status === "CANCELLED" ? "muted" : ""}><td>{e.number}</td><td>{fmtDate(e.date)}</td><td>{e.accountName}</td><td>{e.description}</td><td>{e.payee || e.partnerName}</td><td className="n"><Money v={e.amount} /></td><td className="n"><Money v={e.vatAmount} /></td><td className="n"><b><Money v={e.total} /></b></td><td>{e.payAccountName || <span className="badge amber">آجل — {e.partnerName}</span>}</td><td>{e.status === "POSTED" && can("expenses.write") && <button className="btn sm ghost" onClick={() => run(async () => { if (confirmDlg("إلغاء المصروف بقيد عكسي؟")) { await api(`/expenses/${e.id}/cancel`, { body: {} }); reload(); } })}>إلغاء</button>}{e.status === "CANCELLED" && <Badge s="CANCELLED" />}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={5}>الإجمالي</td><td className="n"><Money v={data.filter((e: any) => e.status === "POSTED").reduce((a: number, e: any) => a + Number(e.amount), 0)} /></td><td className="n"><Money v={data.filter((e: any) => e.status === "POSTED").reduce((a: number, e: any) => a + Number(e.vatAmount), 0)} /></td><td className="n"><Money v={data.filter((e: any) => e.status === "POSTED").reduce((a: number, e: any) => a + Number(e.total), 0)} /></td><td colSpan={2} /></tr></tfoot></table></div>}
      </div>
      {edit && <ExpenseEditor onClose={(s) => { setEdit(false); if (s) reload(); }} />}
    </div>
  );
}

function ExpenseEditor({ onClose }: { onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ date: today(), description: "", payee: "", amount: "", taxCode: "S", amountIncludesVat: false, supplierRef: "", supplierVat: "" });
  const [account, setAccount] = useState<any>(null);
  const [pay, setPay] = useState<any>(null);
  const [credit, setCredit] = useState(false);
  const [partner, setPartner] = useState<any>(null);
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const amt = Number(f.amount || 0);
  const rate = f.taxCode === "S" ? 0.15 : 0;
  const net = f.amountIncludesVat && rate ? amt / 1.15 : amt;
  const vat = net * rate;
  return (
    <Modal title="تسجيل مصروف" onClose={() => onClose()} footer={<><span className="grow muted">الصافي <b><Money v={net} /></b> · الضريبة <b><Money v={vat} /></b> · الإجمالي <b><Money v={net + vat} /></b></span><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !account || amt <= 0 || (!credit && !pay) || (credit && !partner)} onClick={() => run(async () => { await api("/expenses", { body: { ...f, amount: amt, accountId: account.id, payAccountId: credit ? null : pay.id, partnerId: credit ? partner.id : null } }); onClose(true); }, "تم تسجيل المصروف")}>حفظ وترحيل</button></>}>
      <div className="form-grid">
        <Field label="حساب المصروف" span2><Picker value={account} onChange={setAccount} fetcher={accountFetcher((a) => a.type === "EXPENSE")} label={(a: any) => `${a.code} ${a.nameAr}`} autoFocus /></Field>
        <Field label="التاريخ"><Input type="date" value={f.date} onChange={s("date")} /></Field>
        <Field label="البيان" span2><Input value={f.description} onChange={s("description")} placeholder="مثال: فاتورة كهرباء شهر 9" /></Field>
        <Field label="المستفيد"><Input value={f.payee} onChange={s("payee")} /></Field>
        <Field label="المبلغ"><NumInput value={f.amount} onChange={s("amount")} /></Field>
        <Field label="الضريبة"><Select value={f.taxCode} onChange={s("taxCode")}>{["S", "Z", "E", "O", "RC"].map((t) => <option key={t} value={t}>{TAX_AR[t]}</option>)}</Select></Field>
        <Field label=" "><label className="check"><input type="checkbox" checked={f.amountIncludesVat} onChange={s("amountIncludesVat")} /> المبلغ شامل الضريبة</label></Field>
        <Field label="رقم فاتورة المورد"><Input value={f.supplierRef} onChange={s("supplierRef")} dir="ltr" /></Field>
        <Field label="الرقم الضريبي للمورد" hint="لخصم ضريبة المدخلات يلزم فاتورة ضريبية صحيحة"><Input value={f.supplierVat} onChange={s("supplierVat")} dir="ltr" /></Field>
        <Field label="طريقة الدفع"><Select value={credit ? "CREDIT" : "NOW"} onChange={(e) => setCredit(e.target.value === "CREDIT")}><option value="NOW">دفع فوري (نقدي / بنك)</option><option value="CREDIT">آجل على حساب مورد</option></Select></Field>
        {credit ? <Field label="المورد" span2><Picker value={partner} onChange={setPartner} fetcher={partnerFetcher("SUPPLIER")} label={(p: any) => p.name} /></Field> : <Field label="من حساب" span2><Picker value={pay} onChange={setPay} fetcher={accountFetcher((a) => a.isCashBank)} label={(a: any) => `${a.code} ${a.nameAr}`} /></Field>}
      </div>
    </Modal>
  );
}

// ─── fixed assets ──────────────────────────────────────────────────────────
export function AssetsPage() {
  const { can } = useCompanyContext();
  const { data, loading, reload } = useFetch("/assets");
  const [edit, setEdit] = useState(false);
  const [view, setView] = useState<any>(null);
  const { run, busy } = useAction();
  const toast = useToast();
  const CAT: Record<string, string> = { ACTIVE: "نشط", FULLY_DEPRECIATED: "مهلك بالكامل", DISPOSED: "مستبعد" };
  return (
    <div className="card">
      <div className="card-h"><h3>الأصول الثابتة</h3><div className="row">{can("assets.write") && <><button className="btn sm" disabled={busy} onClick={() => run(async () => { const r = await api("/assets/depreciate", { body: { through: today() } }); toast(r.length ? `تم ترحيل ${r.length} قيد إهلاك` : "لا يوجد إهلاك مستحق", "ok"); reload(); })}>تشغيل الإهلاك الشهري حتى اليوم</button><button className="btn primary sm" onClick={() => setEdit(true)}>＋ أصل جديد</button></>}</div></div>
      <div className="card-b">
        {loading && !data ? <Loading /> : !data?.length ? <Empty text="لا توجد أصول مسجلة" /> : <div className="table-wrap"><table className="tbl"><thead><tr><th>الكود</th><th>الأصل</th><th>الفئة</th><th>تاريخ الشراء</th><th className="n">التكلفة</th><th className="n">القيمة التخريدية</th><th>العمر (شهر)</th><th className="n">إهلاك شهري</th><th className="n">مجمع الإهلاك</th><th className="n">القيمة الدفترية</th><th>الحالة</th><th /></tr></thead>
          <tbody>{data.map((a: any) => <tr key={a.id}><td>{a.code}</td><td><b>{a.name}</b></td><td>{a.category}</td><td>{fmtDate(a.acquisitionDate)}</td><td className="n"><Money v={a.cost} /></td><td className="n"><Money v={a.salvageValue} /></td><td className="num">{a.usefulLifeMonths}</td><td className="n"><Money v={a.monthly} /></td><td className="n"><Money v={a.accumulated} /></td><td className="n"><b><Money v={a.nbv} /></b></td><td><Badge s={a.status} map={CAT} /></td><td><button className="btn sm" onClick={() => setView(a)}>تفاصيل</button></td></tr>)}</tbody>
          <tfoot><tr><td colSpan={4}>الإجمالي</td><td className="n"><Money v={data.filter((a: any) => a.status !== "DISPOSED").reduce((x: number, a: any) => x + Number(a.cost), 0)} /></td><td colSpan={3} /><td className="n"><Money v={data.filter((a: any) => a.status !== "DISPOSED").reduce((x: number, a: any) => x + Number(a.accumulated), 0)} /></td><td className="n"><Money v={data.filter((a: any) => a.status !== "DISPOSED").reduce((x: number, a: any) => x + Number(a.nbv), 0)} /></td><td colSpan={2} /></tr></tfoot></table></div>}
      </div>
      {edit && <AssetEditor onClose={(s) => { setEdit(false); if (s) reload(); }} />}
      {view && <AssetView a={view} onClose={(s) => { setView(null); if (s) reload(); }} />}
    </div>
  );
}

function AssetEditor({ onClose }: { onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ name: "", category: "", acquisitionDate: today(), cost: "", vatAmount: "", salvageValue: 0, usefulLifeMonths: 60, noJournal: false, accumulated: 0 });
  const [assetAcc, setAssetAcc] = useState<any>(null);
  const [depAcc, setDepAcc] = useState<any>(null);
  const [expAcc, setExpAcc] = useState<any>(null);
  const [pay, setPay] = useState<any>(null);
  const [partner, setPartner] = useState<any>(null);
  const [credit, setCredit] = useState(false);
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  useEffect(() => { if (f.cost && !f.vatAmount && !f.noJournal) setF((x: any) => ({ ...x, vatAmount: (Number(x.cost) * 0.15).toFixed(2) })); }, [f.cost]);
  return (
    <Modal title="تسجيل أصل ثابت" onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !f.name || !f.cost} onClick={() => run(async () => { await api("/assets", { body: { ...f, cost: Number(f.cost), vatAmount: Number(f.vatAmount || 0), salvageValue: Number(f.salvageValue || 0), usefulLifeMonths: Number(f.usefulLifeMonths), accumulated: Number(f.accumulated || 0), assetAccountId: assetAcc?.id, accDepAccountId: depAcc?.id, depExpAccountId: expAcc?.id, payAccountId: credit || f.noJournal ? null : pay?.id, partnerId: credit ? partner?.id : null } }); onClose(true); }, "تم تسجيل الأصل")}>حفظ</button></>}>
      <div className="form-grid">
        <Field label="اسم الأصل" span2><Input autoFocus value={f.name} onChange={s("name")} /></Field>
        <Field label="الفئة"><Input value={f.category} onChange={s("category")} list="acat" /><datalist id="acat"><option value="سيارات" /><option value="أثاث" /><option value="أجهزة ومعدات" /><option value="حاسب آلي" /><option value="مباني" /></datalist></Field>
        <Field label="تاريخ الشراء / بدء الاستخدام"><Input type="date" value={f.acquisitionDate} onChange={s("acquisitionDate")} /></Field>
        <Field label="التكلفة (بدون ضريبة)"><NumInput value={f.cost} onChange={s("cost")} /></Field>
        <Field label="القيمة التخريدية"><NumInput value={f.salvageValue} onChange={s("salvageValue")} /></Field>
        <Field label="العمر الإنتاجي (بالأشهر)"><NumInput value={f.usefulLifeMonths} onChange={s("usefulLifeMonths")} /></Field>
        <Field label="حساب الأصل"><Picker value={assetAcc} onChange={setAssetAcc} fetcher={accountFetcher((a) => a.subtype === "FIXED_ASSET")} label={(a: any) => `${a.code} ${a.nameAr}`} placeholder="افتراضي: الأجهزة والمعدات" /></Field>
        <Field label="حساب مجمع الإهلاك"><Picker value={depAcc} onChange={setDepAcc} fetcher={accountFetcher((a) => a.subtype === "ACC_DEPRECIATION")} label={(a: any) => `${a.code} ${a.nameAr}`} placeholder="افتراضي" /></Field>
        <Field label="حساب مصروف الإهلاك"><Picker value={expAcc} onChange={setExpAcc} fetcher={accountFetcher((a) => a.type === "EXPENSE")} label={(a: any) => `${a.code} ${a.nameAr}`} placeholder="افتراضي: مصروف الإهلاك" /></Field>
        <Field label=" " span3><label className="check"><input type="checkbox" checked={f.noJournal} onChange={s("noJournal")} /> أصل قائم قبل بدء النظام (بدون قيد شراء — يُدرج ضمن الأرصدة الافتتاحية)</label></Field>
        {f.noJournal ? <Field label="مجمع الإهلاك السابق"><NumInput value={f.accumulated} onChange={s("accumulated")} /></Field> : <>
          <Field label="ضريبة المدخلات على الشراء"><NumInput value={f.vatAmount} onChange={s("vatAmount")} /></Field>
          <Field label="السداد"><Select value={credit ? "CREDIT" : "NOW"} onChange={(e) => setCredit(e.target.value === "CREDIT")}><option value="NOW">نقدي / بنك</option><option value="CREDIT">آجل على مورد</option></Select></Field>
          {credit ? <Field label="المورد"><Picker value={partner} onChange={setPartner} fetcher={partnerFetcher("SUPPLIER")} label={(p: any) => p.name} /></Field> : <Field label="من حساب"><Picker value={pay} onChange={setPay} fetcher={accountFetcher((a) => a.isCashBank)} label={(a: any) => `${a.code} ${a.nameAr}`} /></Field>}
        </>}
      </div>
    </Modal>
  );
}

function AssetView({ a, onClose }: { a: any; onClose: (s?: boolean) => void }) {
  const { data } = useFetch(`/assets/${a.id}`);
  const { run, busy } = useAction();
  const [proceeds, setProceeds] = useState("");
  const [acc, setAcc] = useState<any>(null);
  return (
    <Modal title={`${a.code} — ${a.name}`} onClose={() => onClose()}>
      <div className="stat-list mb"><div className="item"><span>التكلفة</span><b><Money v={a.cost} /></b></div><div className="item"><span>مجمع الإهلاك</span><b><Money v={a.accumulated} /></b></div><div className="item"><span>القيمة الدفترية</span><b><Money v={a.nbv} /></b></div></div>
      <h3>جدول الإهلاك المرحّل</h3>
      {!data ? <Loading /> : <table className="tbl compact"><thead><tr><th>الفترة</th><th className="n">المبلغ</th><th>القيد</th></tr></thead><tbody>{data.depreciations.map((d: any) => <tr key={d.id}><td>{d.periodEnd.slice(0, 7)}</td><td className="n"><Money v={d.amount} /></td><td>{d.number}</td></tr>)}{!data.depreciations.length && <tr><td colSpan={3} className="muted">لم يُرحّل إهلاك بعد</td></tr>}</tbody></table>}
      {a.status !== "DISPOSED" && <div className="card mt"><div className="card-b"><h3>استبعاد / بيع الأصل</h3><div className="form-grid mt"><Field label="متحصلات البيع"><NumInput value={proceeds} onChange={(e) => setProceeds(e.target.value)} /></Field><Field label="إلى حساب"><Picker value={acc} onChange={setAcc} fetcher={accountFetcher((x) => x.isCashBank)} label={(x: any) => `${x.code} ${x.nameAr}`} /></Field></div><button className="btn danger sm mt" disabled={busy} onClick={() => run(async () => { if (!confirmDlg("استبعاد الأصل وترحيل الربح/الخسارة؟")) return; await api(`/assets/${a.id}/dispose`, { body: { proceeds: Number(proceeds || 0), accountId: acc?.id, date: today() } }); onClose(true); }, "تم الاستبعاد")}>استبعاد الأصل</button></div></div>}
    </Modal>
  );
}
