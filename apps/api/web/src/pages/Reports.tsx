import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, q, useFetch, Money, money, Loading, Empty, Badge, Modal, Field, Input, Select, Picker, accountFetcher, partnerFetcher, useAction, useToast, useCompanyContext, ExportBtn, PrintBtn, DateRange, monthStart, today, yearStart, addMonths, fmtDate, confirmDlg } from "../lib";
import { StatementModal } from "./Master";

const TABS = [
  { key: "trial-balance", label: "ميزان المراجعة" }, { key: "income", label: "قائمة الدخل" }, { key: "balance-sheet", label: "الميزانية العمومية" }, { key: "cash-flow", label: "التدفقات النقدية" },
  { key: "aging", label: "أعمار الديون" }, { key: "sales", label: "تحليل المبيعات" }, { key: "expenses", label: "تحليل المصروفات" }, { key: "salespersons", label: "المندوبون" }, { key: "statements", label: "كشوف الحسابات" }, { key: "integrity", label: "فحص التطابق" },
];

export function ReportsPage() {
  const { tab = "trial-balance" } = useParams();
  const nav = useNavigate();
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  return (
    <div className="grid">
      <div className="tabs no-print">{TABS.map((t) => <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => nav(`/reports/${t.key}`)}>{t.label}</button>)}</div>
      {tab !== "integrity" && tab !== "statements" && <div className="row no-print"><DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} /></div>}
      {tab === "trial-balance" && <TrialBalance from={from} to={to} />}
      {tab === "income" && <Income from={from} to={to} />}
      {tab === "balance-sheet" && <BalanceSheet to={to} />}
      {tab === "cash-flow" && <CashFlow from={from} to={to} />}
      {tab === "aging" && <Aging to={to} />}
      {tab === "sales" && <SalesAnalysis from={from} to={to} />}
      {tab === "expenses" && <ExpensesAnalysis from={from} to={to} />}
      {tab === "salespersons" && <Salespersons from={from} to={to} />}
      {tab === "statements" && <Statements />}
      {tab === "integrity" && <Integrity />}
    </div>
  );
}

function Head({ title, sub, rows, name }: { title: string; sub: string; rows?: any[]; name?: string }) {
  const { me } = useCompanyContext();
  return <div className="card-h"><div><h3>{title}</h3><div className="small muted">{me.company.nameAr} · {sub}</div></div><div className="row no-print"><PrintBtn />{rows && <ExportBtn name={name || title} rows={rows} />}</div></div>;
}

function TrialBalance({ from, to }: { from: string; to: string }) {
  const [all, setAll] = useState(false);
  const { data } = useFetch(`/reports/trial-balance${q({ from, to, all: all ? 1 : 0 })}`);
  if (!data) return <Loading />;
  return (
    <div className="card">
      <Head title="ميزان المراجعة" sub={`من ${from} إلى ${to}`} rows={data.rows.map((r: any) => ({ الحساب: r.code, الاسم: r.nameAr, "افتتاحي مدين": r.openingDr, "افتتاحي دائن": r.openingCr, "حركة مدين": r.debit, "حركة دائن": r.credit, "ختامي مدين": r.closingDr, "ختامي دائن": r.closingCr }))} />
      <div className="card-b"><label className="check no-print"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> إظهار الحسابات الصفرية</label>{!data.balanced && <div className="alert err mt">تحذير: الميزان غير متوازن!</div>}</div>
      <div className="table-wrap"><table className="tbl compact"><thead><tr><th rowSpan={2}>الحساب</th><th colSpan={2} style={{ textAlign: "center" }}>رصيد أول المدة</th><th colSpan={2} style={{ textAlign: "center" }}>حركة الفترة</th><th colSpan={2} style={{ textAlign: "center" }}>رصيد آخر المدة</th></tr><tr><th className="n">مدين</th><th className="n">دائن</th><th className="n">مدين</th><th className="n">دائن</th><th className="n">مدين</th><th className="n">دائن</th></tr></thead>
        <tbody>{data.rows.map((r: any) => <tr key={r.id}><td><span className="num muted">{r.code}</span> {r.nameAr}</td><td className="n"><Money v={r.openingDr} blankZero /></td><td className="n"><Money v={r.openingCr} blankZero /></td><td className="n"><Money v={r.debit} blankZero /></td><td className="n"><Money v={r.credit} blankZero /></td><td className="n"><Money v={r.closingDr} blankZero /></td><td className="n"><Money v={r.closingCr} blankZero /></td></tr>)}</tbody>
        <tfoot><tr><td>الإجمالي {data.balanced && <span className="badge green">متوازن ✓</span>}</td><td className="n"><Money v={data.totals.openingDr} /></td><td className="n"><Money v={data.totals.openingCr} /></td><td className="n"><Money v={data.totals.debit} /></td><td className="n"><Money v={data.totals.credit} /></td><td className="n"><Money v={data.totals.closingDr} /></td><td className="n"><Money v={data.totals.closingCr} /></td></tr></tfoot></table></div>
    </div>
  );
}

function Section({ s, sign = 1 }: { s: any; sign?: number }) {
  return <>{s.sections.map((sec: any) => <React.Fragment key={sec.subtype}><tr className="group"><td>{sec.name}</td><td className="n"><Money v={sec.total} /></td></tr>{sec.items.map((i: any) => <tr key={i.code} className="sub"><td><span className="num muted">{i.code}</span> {i.name}</td><td className="n"><Money v={i.amount} /></td></tr>)}</React.Fragment>)}</>;
}

function Income({ from, to }: { from: string; to: string }) {
  const { data: d } = useFetch(`/reports/income${q({ from, to })}`);
  if (!d) return <Loading />;
  const T = ({ label, v, big }: { label: string; v: number; big?: boolean }) => <tr style={big ? { fontWeight: 700, fontSize: 15, background: "var(--primary-soft)" } : { fontWeight: 600 }}><td>{label}</td><td className="n"><Money v={v} sign={big} /></td></tr>;
  return (
    <div className="card"><Head title="قائمة الدخل" sub={`عن الفترة من ${from} إلى ${to}`} />
      <div className="table-wrap"><table className="tbl compact"><tbody>
        <Section s={d.sales} /><Section s={d.returns} /><T label="صافي المبيعات" v={d.netSales} />
        <Section s={d.cogs} /><T label={`مجمل الربح (${d.grossMargin}%)`} v={d.grossProfit} big />
        <Section s={d.opex} /><T label="الربح التشغيلي" v={d.operating} big />
        <Section s={d.otherIncome} /><Section s={d.otherExp} /><T label="الربح قبل الزكاة" v={d.beforeZakat} />
        <Section s={d.zakat} /><T label={`صافي الربح / (الخسارة) — هامش ${d.netMargin}%`} v={d.net} big />
      </tbody></table></div>
    </div>
  );
}

function BalanceSheet({ to }: { to: string }) {
  const { data: d } = useFetch(`/reports/balance-sheet${q({ to })}`);
  if (!d) return <Loading />;
  return (
    <div className="card"><Head title="قائمة المركز المالي (الميزانية العمومية)" sub={`كما في ${to}`} />
      {!d.balanced && <div className="alert err">الميزانية غير متوازنة — راجع فحص التطابق</div>}
      <div className="grid c2" style={{ gap: 0 }}>
        <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الأصول</th><th className="n">المبلغ</th></tr></thead><tbody><Section s={d.currentAssets} /><tr style={{ fontWeight: 600 }}><td>إجمالي الأصول المتداولة</td><td className="n"><Money v={d.currentAssets.total} /></td></tr><Section s={d.fixedAssets} /><tr style={{ fontWeight: 600 }}><td>صافي الأصول غير المتداولة</td><td className="n"><Money v={d.fixedAssets.total} /></td></tr></tbody><tfoot><tr><td>إجمالي الأصول</td><td className="n"><Money v={d.totalAssets} /></td></tr></tfoot></table></div>
        <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الخصوم وحقوق الملكية</th><th className="n">المبلغ</th></tr></thead><tbody><Section s={d.currentLiab} /><Section s={d.ltLiab} /><tr style={{ fontWeight: 600 }}><td>إجمالي الخصوم</td><td className="n"><Money v={d.totalLiab} /></td></tr><Section s={d.equity} /><tr className="sub"><td>نتيجة الفترة الجارية (غير مقفلة)</td><td className="n"><Money v={d.currentResult} sign /></td></tr><tr style={{ fontWeight: 600 }}><td>إجمالي حقوق الملكية</td><td className="n"><Money v={d.totalEquity} /></td></tr></tbody><tfoot><tr><td>إجمالي الخصوم وحقوق الملكية {d.balanced && <span className="badge green">متوازنة ✓</span>}</td><td className="n"><Money v={d.totalLiabEquity} /></td></tr></tfoot></table></div>
      </div>
    </div>
  );
}

function CashFlow({ from, to }: { from: string; to: string }) {
  const { data: d } = useFetch(`/reports/cash-flow${q({ from, to })}`);
  if (!d) return <Loading />;
  const Sec = ({ title, items, total }: any) => <><tr className="group"><td>{title}</td><td className="n"><Money v={total} sign /></td></tr>{items.map((i: any, k: number) => <tr key={k} className="sub"><td>{i.name}</td><td className="n"><Money v={i.amount} sign /></td></tr>)}</>;
  return (
    <div className="card"><Head title="قائمة التدفقات النقدية (الطريقة المباشرة)" sub={`من ${from} إلى ${to}`} />
      <div className="table-wrap"><table className="tbl compact"><tbody>
        <tr style={{ fontWeight: 600 }}><td>النقدية أول المدة</td><td className="n"><Money v={d.opening} /></td></tr>
        <Sec title="التدفقات من الأنشطة التشغيلية" items={d.operating} total={d.totals.operating} />
        <Sec title="التدفقات من الأنشطة الاستثمارية" items={d.investing} total={d.totals.investing} />
        <Sec title="التدفقات من الأنشطة التمويلية" items={d.financing} total={d.totals.financing} />
        <tr style={{ fontWeight: 700 }}><td>صافي التغير في النقدية</td><td className="n"><Money v={d.net} sign /></td></tr>
        <tr style={{ fontWeight: 700, background: "var(--primary-soft)" }}><td>النقدية آخر المدة</td><td className="n"><Money v={d.closing} /></td></tr>
      </tbody></table></div>
    </div>
  );
}

function Aging({ to }: { to: string }) {
  const [role, setRole] = useState("CUSTOMER");
  const { data: d } = useFetch(`/reports/aging${q({ to, role })}`);
  if (!d) return <Loading />;
  const B = ["current", "d30", "d60", "d90", "d120"], BL = ["غير مستحق", "1-30 يوم", "31-60", "61-90", "أكثر من 90"];
  return (
    <div className="card"><Head title={`أعمار الديون — ${role === "CUSTOMER" ? "العملاء" : "الموردون"}`} sub={`كما في ${to}`} rows={d.rows.map((r: any) => ({ الطرف: r.name, ...Object.fromEntries(B.map((b, i) => [BL[i], r[b]])), الإجمالي: r.total }))} />
      <div className="card-b no-print"><Select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: 200 }}><option value="CUSTOMER">ذمم العملاء</option><option value="SUPPLIER">ذمم الموردين</option></Select></div>
      {!d.rows.length ? <Empty text="لا توجد أرصدة مفتوحة" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الطرف</th>{BL.map((b) => <th key={b} className="n">{b}</th>)}<th className="n">الإجمالي</th></tr></thead>
        <tbody>{d.rows.map((r: any) => <React.Fragment key={r.partnerId}><tr><td><b>{r.name}</b></td>{B.map((b) => <td key={b} className={"n " + (b === "d120" && r[b] ? "neg-val" : "")}><Money v={r[b]} blankZero /></td>)}<td className="n"><b><Money v={r.total} /></b></td></tr>{r.invoices.map((i: any) => <tr key={i.number} className="sub"><td>{i.number} — {fmtDate(i.date)} (استحقاق {fmtDate(i.dueDate)}, {i.days > 0 ? `متأخر ${i.days} يوم` : "غير مستحق"})</td><td colSpan={5} /><td className="n"><Money v={i.due} /></td></tr>)}</React.Fragment>)}</tbody>
        <tfoot><tr><td>الإجمالي</td>{B.map((b) => <td key={b} className="n"><Money v={d.totals[b]} /></td>)}<td className="n"><Money v={d.totals.total} /></td></tr></tfoot></table></div>}
    </div>
  );
}

function SalesAnalysis({ from, to }: { from: string; to: string }) {
  const { data: d } = useFetch(`/reports/sales${q({ from, to })}`);
  if (!d) return <Loading />;
  return (
    <div className="grid c2">
      <div className="card"><Head title="المبيعات حسب الصنف" sub={`${from} — ${to}`} rows={d.byProduct.map((r: any) => ({ الرمز: r.sku, الصنف: r.name, التصنيف: r.category, الكمية: r.qty, المبيعات: r.net, التكلفة: r.cost, الربح: r.profit }))} />
        <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الصنف</th><th className="n">الكمية</th><th className="n">المبيعات</th><th className="n">التكلفة</th><th className="n">الربح</th><th className="n">الهامش</th></tr></thead><tbody>{d.byProduct.map((r: any) => <tr key={r.sku}><td>{r.name}<div className="small muted">{r.category}</div></td><td className="n">{Number(r.qty)}</td><td className="n"><Money v={r.net} /></td><td className="n"><Money v={r.cost} /></td><td className="n"><Money v={r.profit} sign /></td><td className="n">{Number(r.net) ? Math.round((r.profit / r.net) * 100) + "%" : ""}</td></tr>)}</tbody></table></div></div>
      <div className="grid">
        <div className="card"><Head title="المبيعات حسب العميل" sub={`${from} — ${to}`} rows={d.byCustomer.map((r: any) => ({ العميل: r.name, الفواتير: r.invoices, الإجمالي: r.total }))} /><div className="table-wrap"><table className="tbl compact"><thead><tr><th>العميل</th><th className="n">عدد الفواتير</th><th className="n">الإجمالي</th></tr></thead><tbody>{d.byCustomer.map((r: any) => <tr key={r.name}><td>{r.name}</td><td className="n">{r.invoices}</td><td className="n"><Money v={r.total} /></td></tr>)}</tbody></table></div></div>
        <div className="card"><Head title="المبيعات اليومية" sub={`${from} — ${to}`} rows={d.byDay.map((r: any) => ({ التاريخ: r.date, الفواتير: r.count, الإجمالي: r.total }))} /><div className="table-wrap" style={{ maxHeight: 400 }}><table className="tbl compact"><thead><tr><th>اليوم</th><th className="n">الفواتير</th><th className="n">الإجمالي</th></tr></thead><tbody>{d.byDay.map((r: any) => <tr key={r.date}><td>{fmtDate(r.date)}</td><td className="n">{r.count}</td><td className="n"><Money v={r.total} /></td></tr>)}</tbody></table></div></div>
      </div>
    </div>
  );
}

function ExpensesAnalysis({ from, to }: { from: string; to: string }) {
  const { data: d } = useFetch(`/reports/expenses-by-account${q({ from, to })}`);
  if (!d) return <Loading />;
  return (
    <div className="grid c2">
      <div className="card"><Head title="المصروفات حسب الحساب" sub={`${from} — ${to}`} rows={d.byAccount.map((r: any) => ({ الحساب: r.code, الاسم: r.nameAr, المبلغ: r.amount }))} />
        <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الحساب</th><th className="n">المبلغ</th><th className="n">النسبة</th></tr></thead><tbody>{d.byAccount.map((r: any) => <tr key={r.code}><td><span className="num muted">{r.code}</span> {r.nameAr}</td><td className="n"><Money v={r.amount} /></td><td className="n">{d.total ? Math.round((r.amount / d.total) * 100) + "%" : ""}</td></tr>)}</tbody><tfoot><tr><td>الإجمالي</td><td className="n"><Money v={d.total} /></td><td /></tr></tfoot></table></div></div>
      <div className="card"><Head title="المصروفات حسب مركز التكلفة" sub={`${from} — ${to}`} rows={d.byCostCenter.map((r: any) => ({ "مركز التكلفة": r.costCenter, المبلغ: r.amount }))} />
        <div className="table-wrap"><table className="tbl compact"><thead><tr><th>مركز التكلفة</th><th className="n">المبلغ</th></tr></thead><tbody>{d.byCostCenter.map((r: any) => <tr key={r.costCenter}><td>{r.costCenter}</td><td className="n"><Money v={r.amount} /></td></tr>)}</tbody></table></div></div>
    </div>
  );
}

function Salespersons({ from, to }: { from: string; to: string }) {
  const { data: d } = useFetch(`/reports/salespersons${q({ from, to })}`);
  if (!d) return <Loading />;
  return (
    <div className="card"><Head title="المبيعات حسب المندوب / الكاشير" sub={`${from} — ${to}`} rows={d.map((r: any) => ({ المندوب: r.salesperson, الفواتير: r.invoices, "تذاكر POS": r.posTickets, الإجمالي: r.total, "مجمل الربح": r.grossProfit }))} />
      {!d.length ? <Empty /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>المستخدم</th><th className="n">عدد الفواتير</th><th className="n">منها نقاط بيع</th><th className="n">إجمالي المبيعات</th><th className="n">مجمل الربح</th><th className="n">الهامش</th></tr></thead><tbody>{d.map((r: any) => <tr key={r.salesperson}><td><b>{r.salesperson}</b></td><td className="n">{r.invoices}</td><td className="n">{r.posTickets}</td><td className="n"><Money v={r.total} /></td><td className="n"><Money v={r.grossProfit} sign /></td><td className="n">{Number(r.total) ? Math.round((r.grossProfit / (r.total / 1.15)) * 100) + "%" : ""}</td></tr>)}</tbody></table></div>}
    </div>
  );
}

function Statements() {
  const [role, setRole] = useState<"CUSTOMER" | "SUPPLIER">("CUSTOMER");
  const [p, setP] = useState<any>(null);
  return (
    <div className="card"><div className="card-b"><div className="form-grid"><Field label="النوع"><Select value={role} onChange={(e) => { setRole(e.target.value as any); setP(null); }}><option value="CUSTOMER">عميل</option><option value="SUPPLIER">مورد</option></Select></Field><Field label="الطرف" span2><Picker value={p} onChange={setP} fetcher={partnerFetcher(role)} label={(x: any) => `${x.name} — الرصيد ${money(x.balance)}`} /></Field></div>
      {p && <StatementModal partner={p} role={role} onClose={() => setP(null)} />}
    </div></div>
  );
}

function Integrity() {
  const { data: d, reload } = useFetch("/reports/integrity");
  if (!d) return <Loading />;
  return (
    <div className="card"><Head title="فحص تطابق الحسابات" sub="مقارنة آلية بين الدفاتر الفرعية والأستاذ العام" />
      <div className="card-b">
        <div className={"alert " + (d.ok ? "ok" : "err")}>{d.ok ? "كل الفحوص ناجحة — الدفاتر متطابقة بالهللة ✓" : "توجد فروق تحتاج مراجعة"}</div>
        <div className="ok-list card">{d.checks.map((c: any, i: number) => <div key={i} className="item"><span style={{ fontSize: 20 }}>{c.ok ? "✅" : "❌"}</span><div className="grow">{c.name}{c.note && <div className="small muted">{c.note}</div>}</div><span className="num">{money(c.a)}</span><span className="muted">=</span><span className="num">{money(c.b)}</span>{!c.ok && <span className="badge red">فرق {money(c.a - c.b)}</span>}</div>)}</div>
        <button className="btn sm mt no-print" onClick={reload}>إعادة الفحص</button>
      </div>
    </div>
  );
}

// ─── VAT ───────────────────────────────────────────────────────────────────
export function VatPage() {
  const { can } = useCompanyContext();
  const toast = useToast();
  const { run, busy } = useAction();
  const [from, setFrom] = useState(addMonths(monthStart(), -2));
  const [to, setTo] = useState(today());
  const { data: d, reload } = useFetch(`/reports/vat${q({ from, to })}`);
  const returns = useFetch("/vat/returns");
  const [payId, setPayId] = useState<string | null>(null);
  const [acc, setAcc] = useState<any>(null);
  return (
    <div className="grid">
      <div className="card">
        <div className="card-h"><div><h3>إقرار ضريبة القيمة المضافة</h3><div className="small muted">بصيغة نموذج هيئة الزكاة والضريبة والجمارك</div></div><div className="row no-print"><DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} /><PrintBtn /></div></div>
        {!d ? <Loading /> : <>
          <div className="table-wrap"><table className="tbl compact"><thead><tr><th>#</th><th>البند</th><th className="n">المبلغ (ر.س)</th><th className="n">التعديل</th><th className="n">مبلغ الضريبة</th></tr></thead>
            <tbody>{d.boxes.map((b: any) => <tr key={b.no} className={b.total ? "group" : ""}><td className="num">{b.no}</td><td>{b.label}</td><td className="n"><Money v={b.net} /></td><td className="n">0.00</td><td className="n"><Money v={b.vat} /></td></tr>)}
              <tr><td>12</td><td>إجمالي ضريبة القيمة المضافة المستحقة عن الفترة الحالية</td><td colSpan={2} /><td className="n"><Money v={d.outputVat} /></td></tr>
              <tr><td>13</td><td>إجمالي ضريبة المدخلات القابلة للخصم</td><td colSpan={2} /><td className="n"><Money v={d.inputVat} /></td></tr>
              <tr style={{ fontWeight: 700, fontSize: 15, background: "var(--primary-soft)" }}><td>14</td><td>صافي الضريبة {d.net >= 0 ? "المستحقة للهيئة" : "المستردة (رصيد دائن)"}</td><td colSpan={2} /><td className="n"><Money v={Math.abs(d.net)} /></td></tr>
            </tbody></table></div>
          <div className="card-b">
            <div className={"alert " + (d.reconciled ? "ok" : "warn")}>مطابقة الأستاذ العام: ضريبة المخرجات في الحسابات <b><Money v={d.glOutputVat} /></b> · ضريبة المدخلات <b><Money v={d.glInputVat} /></b> — {d.reconciled ? "مطابقة للمستندات ✓" : "توجد قيود يدوية على حسابات الضريبة، راجعها قبل التقديم"}</div>
            {can("vat.write") && <button className="btn primary no-print" disabled={busy} onClick={() => run(async () => { if (!confirmDlg(`تسجيل تقديم الإقرار عن الفترة ${from} — ${to} وترحيل قيد التسوية (إقفال حسابي المخرجات والمدخلات إلى الضريبة المستحقة)؟`)) return; await api("/vat/returns", { body: { from, to } }); reload(); returns.reload(); }, "تم تسجيل الإقرار وترحيل قيد التسوية")}>تسجيل تقديم الإقرار وترحيل التسوية</button>}
          </div>
        </>}
      </div>
      <div className="card"><div className="card-h"><h3>الإقرارات المقدمة</h3></div>
        {!returns.data ? <Loading /> : !returns.data.length ? <Empty text="لم تُسجل إقرارات بعد" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الفترة</th><th className="n">ضريبة المخرجات</th><th className="n">ضريبة المدخلات</th><th className="n">الصافي</th><th>القيد</th><th>الحالة</th><th /></tr></thead>
          <tbody>{returns.data.map((r: any) => <tr key={r.id}><td>{fmtDate(r.periodFrom)} — {fmtDate(r.periodTo)}</td><td className="n"><Money v={r.data.outputVat} /></td><td className="n"><Money v={r.data.inputVat} /></td><td className="n"><b><Money v={r.netVat} /></b></td><td>{r.journalNumber}</td><td><Badge s={r.status} /></td><td>{r.status === "FILED" && Number(r.netVat) > 0 && can("vat.write") && <button className="btn sm" onClick={() => setPayId(r.id)}>تسجيل السداد</button>}</td></tr>)}</tbody></table></div>}
      </div>
      {payId && <Modal narrow title="سداد الضريبة للهيئة" onClose={() => setPayId(null)} footer={<><button className="btn" onClick={() => setPayId(null)}>إلغاء</button><button className="btn primary" disabled={!acc || busy} onClick={() => run(async () => { await api(`/vat/returns/${payId}/pay`, { body: { accountId: acc.id } }); setPayId(null); returns.reload(); }, "تم تسجيل السداد")}>تأكيد</button></>}><Field label="من حساب"><Picker value={acc} onChange={setAcc} fetcher={accountFetcher((a) => a.isCashBank)} label={(a: any) => `${a.code} ${a.nameAr}`} /></Field></Modal>}
    </div>
  );
}
