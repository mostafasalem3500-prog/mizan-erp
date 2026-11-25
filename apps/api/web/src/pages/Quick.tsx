/**
 * «سجّل عملية» — data entry for someone who is not an accountant: say what happened in plain words, the program
 * opens the right form or records the entry itself. And «التقرير اليومي» — the day at a glance with what needs attention.
 */
import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CUR } from "../shared/country";
import { api, useFetch, Money, money, Loading, Empty, Modal, Field, Input, NumInput, Picker, accountFetcher, useAction, useCompanyContext, today, PrintBtn } from "../lib";
import { EntryPreview } from "./EntryPreview";

type Tile = { ic: string; t: string; d: string; to?: string; kind?: string; perm?: string; entry: string };
const GROUPS: { title: string; hint: string; tiles: Tile[] }[] = [
  { title: "دخل مال أو بعت", hint: "مبيعات وتحصيل", tiles: [
    { ic: "🧾", t: "بعت بضاعة أو خدمة لعميل", d: "فاتورة مبيعات — نقداً أو بالآجل", to: "/sales/invoices?new=INVOICE", perm: "sales.write", entry: "العميل أو الصندوق مدين ← المبيعات والضريبة دائنة، ويخرج الصنف من المخزون بتكلفته" },
    { ic: "🛒", t: "بيع سريع من الكاشير", d: "نقطة البيع بالوردية", to: "/pos", perm: "pos.use", entry: "الصندوق مدين ← المبيعات والضريبة دائنة" },
    { ic: "💰", t: "استلمت مبلغاً من عميل", d: "سند قبض يسدّد فواتيره", to: "/receipts?new=1", perm: "payments.write", entry: "الصندوق أو البنك مدين ← حساب العميل دائن" },
    { ic: "↩", t: "العميل أرجع بضاعة", d: "إشعار دائن مرتبط بالفاتورة", to: "/sales/credit-notes", perm: "sales.write", entry: "يُعكس الإيراد والضريبة ويعود الصنف إلى المخزون" },
    { ic: "✨", t: "إيراد آخر غير المبيعات", d: "تعويض، خصم مكتسب، إيراد عرضي", kind: "OTHER_INCOME", perm: "payments.write", entry: "الصندوق أو البنك مدين ← إيرادات أخرى دائنة" },
  ] },
  { title: "خرج مال أو اشتريت", hint: "مشتريات ومصروفات", tiles: [
    { ic: "📦", t: "اشتريت بضاعة من مورد", d: "فاتورة مشتريات تدخل المخزون", to: "/purchases/invoices?new=INVOICE", perm: "purchases.write", entry: "المخزون وضريبة المدخلات مدينان ← المورد أو الصندوق دائن" },
    { ic: "🧮", t: "دفعت مصروفاً", d: "إيجار، كهرباء، صيانة، نثريات…", to: "/expenses?new=1", perm: "expenses.write", entry: "حساب المصروف وضريبة المدخلات مدينان ← الصندوق أو البنك دائن" },
    { ic: "💸", t: "دفعت لمورد من مستحقاته", d: "سند صرف يسدّد فواتيره", to: "/vouchers?new=1", perm: "payments.write", entry: "حساب المورد مدين ← الصندوق أو البنك دائن" },
    { ic: "🏦", t: "رسوم أو عمولة بنكية", d: "خصمها البنك من الحساب", kind: "BANK_FEES", perm: "payments.write", entry: "مصروف العمولات البنكية مدين ← البنك دائن" },
    { ic: "🏗", t: "اشتريت أصلاً (سيارة، جهاز، أثاث)", d: "يُسجَّل أصلاً ويُهلك شهرياً", to: "/assets", perm: "accounting.write", entry: "الأصل الثابت مدين ← البنك أو المورد دائن — ليس مصروفاً" },
  ] },
  { title: "المالك والتمويل", hint: "ليست إيراداً ولا مصروفاً", tiles: [
    { ic: "👤", t: "المالك سحب مبلغاً لنفسه", d: "مسحوبات شخصية", kind: "OWNER_DRAW", perm: "payments.write", entry: "جاري المالك مدين ← الصندوق أو البنك دائن" },
    { ic: "➕", t: "المالك وضع مالاً في المنشأة", d: "تمويل مؤقت يُردّ له", kind: "OWNER_FUND", perm: "payments.write", entry: "الصندوق أو البنك مدين ← جاري المالك دائن" },
    { ic: "🏛", t: "زيادة رأس المال", d: "مبلغ دائم من الملاك", kind: "CAPITAL", perm: "payments.write", entry: "البنك مدين ← رأس المال دائن" },
    { ic: "📥", t: "استلمنا قرضاً", d: "من بنك أو جهة تمويل", kind: "LOAN_IN", perm: "payments.write", entry: "البنك مدين ← القروض دائنة" },
    { ic: "📤", t: "سددنا قسط قرض", d: "أصل القرض فقط", kind: "LOAN_PAY", perm: "payments.write", entry: "القروض مدينة ← البنك دائن" },
    { ic: "🎁", t: "وزّعنا أرباحاً على الملاك", d: "من الأرباح المبقاة", kind: "DIVIDENDS", perm: "payments.write", entry: "الأرباح المبقاة مدينة ← البنك دائن" },
  ] },
  { title: "نقدية، مخزون، موظفون", hint: "حركات داخلية", tiles: [
    { ic: "⇄", t: "نقلت مالاً بين الصندوق والبنك", d: "إيداع نقدي أو سحب للصندوق", to: "/treasury", perm: "payments.write", entry: "الحساب المستلِم مدين ← الحساب المحوِّل دائن" },
    { ic: "📋", t: "جردت المخزون أو وجدت تالفاً", d: "تسوية الكميات الفعلية", to: "/inventory?tab=adj", perm: "inventory.write", entry: "الفرق يُسجَّل على أرباح أو خسائر المخزون" },
    { ic: "👔", t: "صرفت الرواتب", d: "مسير رواتب الشهر", to: "/payroll", perm: "accounting.write", entry: "مصروف الرواتب مدين ← الرواتب المستحقة ثم البنك دائن" },
    { ic: "📒", t: "عملية أخرى ليست هنا", d: "قيد يومية يدوي، أو اسأل المساعد", to: "/journals?new=manual", perm: "accounting.write", entry: "تحدد أنت الحسابات المدينة والدائنة" },
  ] },
];

function QuickForm({ tile, onClose }: { tile: Tile; onClose: (saved?: any) => void }) {
  const { run, busy } = useAction();
  const kinds = useFetch<any[]>("/quick-entry/kinds");
  const k = (kinds.data || []).find((x) => x.kind === tile.kind);
  const [acc, setAcc] = useState<any>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [prev, setPrev] = useState<any>(null);
  const body = () => ({ kind: tile.kind, amount: Number(amount), date, note, accountId: acc?.id });
  const ok = !!acc && Number(amount) > 0;
  const out = k?.dir === "OUT";
  return (
    <Modal title={tile.t} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn" disabled={busy || !ok} onClick={() => run(async () => setPrev(await api("/quick-entry/preview", { body: body() })))}>معاينة القيد</button><button className="btn primary" disabled={busy || !ok} onClick={() => run(async () => onClose(await api("/quick-entry", { body: body() })), "تم التسجيل وترحيل القيد")}>تسجيل ✓</button></>}>
      <div className="alert info small mb" data-quick-why>{k?.why || tile.entry}<div className="muted" style={{ marginTop: 4 }}>القيد: {tile.entry}.</div></div>
      <div className="form-grid">
        <Field label={`المبلغ (${CUR()}) *`}><NumInput autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="التاريخ"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={out ? "خرج المبلغ من *" : "دخل المبلغ في *"} span2 hint="الصندوق أو الحساب البنكي"><Picker value={acc} onChange={setAcc} fetcher={accountFetcher((a) => a.isCashBank)} label={(a: any) => `${a.code} ${a.nameAr}`} /></Field>
        <Field label="ملاحظة (اختياري)" span3><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: رقم الحوالة، اسم الشريك…" /></Field>
      </div>
      {prev && <Modal wide title="معاينة القيد" onClose={() => setPrev(null)} footer={<><div className="grow" /><button className="btn" onClick={() => setPrev(null)}>رجوع</button></>}><EntryPreview prev={prev} /></Modal>}
    </Modal>
  );
}

export function QuickPage() {
  const nav = useNavigate();
  const { can } = useCompanyContext();
  const [form, setForm] = useState<Tile | null>(null);
  const [done, setDone] = useState<any>(null);
  const [q, setQ] = useState("");
  const brief = useFetch<any>(can("reports.read") ? "/brief" : null);
  const nq = (s: string) => s.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
  const show = (t: Tile) => !q.trim() || nq(t.t + " " + t.d).includes(nq(q.trim()));
  return (
    <div className="grid">
      <div className="card"><div className="card-h"><div><h3>سجّل عملية</h3><div className="small muted">اختر ما حدث بكلماتك — البرنامج يفتح النموذج المناسب أو يسجّل القيد بنفسه. لا تحتاج معرفة المدين والدائن.</div></div>
        <div className="row"><Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث: إيجار، قرض، مرتجع…" style={{ width: 230 }} aria-label="بحث في العمليات" /><Link className="btn sm" to="/ai">✨ أو اكتبها للمساعد</Link></div></div>
        {done && <div className="card-b" style={{ paddingBottom: 0 }}><div className="alert ok small" data-quick-done>✓ سُجّلت العملية بالقيد <b className="num">{done.number}</b>. <Link to="/journals">عرض القيود</Link></div></div>}
        <div className="card-b">
          {GROUPS.map((g) => { const ts = g.tiles.filter(show); if (!ts.length) return null; return (
            <section key={g.title} className="quick-sec"><h4>{g.title} <span className="small muted">— {g.hint}</span></h4>
              <div className="quick-grid">{ts.map((t) => { const allowed = !t.perm || can(t.perm); return (
                <button key={t.t} type="button" className="quick-tile" disabled={!allowed} title={allowed ? `القيد: ${t.entry}` : "صلاحيتك لا تسمح بهذه العملية"} onClick={() => (t.kind ? setForm(t) : nav(t.to!))}>
                  <span className="quick-ic" aria-hidden="true">{t.ic}</span><span className="quick-tx"><b>{t.t}</b><span className="small muted">{t.d}</span></span>
                </button>); })}</div>
            </section>); })}
          {!GROUPS.some((g) => g.tiles.some(show)) && <Empty text="لا عملية بهذا الوصف — جرّب كلمة أخرى، أو اكتب ما حدث للمساعد الذكي" />}
        </div></div>
      {brief.data?.todo?.length > 0 && <div className="card"><div className="card-h"><h3>يحتاج متابعتك الآن</h3><Link className="btn sm" to="/daily">التقرير اليومي</Link></div><div className="card-b"><TodoList todo={brief.data.todo} /></div></div>}
      {form && <QuickForm tile={form} onClose={(saved) => { setForm(null); if (saved) { setDone(saved); brief.reload(); } }} />}
    </div>
  );
}

function TodoList({ todo }: { todo: any[] }) {
  return <ul className="todo-list" data-todo>{todo.map((x) => <li key={x.key}><span className={"badge " + (x.level === "high" ? "red" : "amber")}>{x.count}</span><Link to={x.to}>{x.text}</Link>{x.amount ? <span className="muted small"> — <Money v={x.amount} /> {CUR()}</span> : null}</li>)}</ul>;
}

export function DailyPage() {
  const [date, setDate] = useState(today());
  const { data: d, loading } = useFetch<any>(`/reports/daily?date=${date}`, [date]);
  const brief = useFetch<any>(date === today() ? "/brief" : null, [date]);
  const shift = (k: number) => { const x = new Date(date + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + k); setDate(x.toISOString().slice(0, 10)); };
  const K = ({ label, v, sub, cls }: { label: string; v: number; sub?: string; cls?: string }) => <div className={"card kpi " + (cls || "")}><div className="label">{label}</div><div className="value"><Money v={v} /></div>{sub && <div className="sub">{sub}</div>}</div>;
  return (
    <div className="grid print-doc stmt">
      <div className="card no-print"><div className="card-h"><div><h3>التقرير اليومي</h3><div className="small muted">ما بيع واشتُري وصُرف وحُصّل في يوم واحد، وحركة كل صندوق وبنك.</div></div>
        <div className="row"><button className="btn sm" onClick={() => shift(-1)} aria-label="اليوم السابق">‹ السابق</button><Input type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="التاريخ" style={{ width: 160 }} /><button className="btn sm" disabled={date >= today()} onClick={() => shift(1)} aria-label="اليوم التالي">التالي ›</button><button className="btn sm" disabled={date === today()} onClick={() => setDate(today())}>اليوم</button><PrintBtn /></div></div></div>
      {loading && !d ? <Loading /> : !d ? <Empty /> : <>
        <div className="kpis" data-daily>
          <K label="المبيعات" v={d.sales.total} sub={`${d.sales.count} فاتورة${d.posSales.count ? ` · نقطة البيع ${money(d.posSales.total)}` : ""}${d.salesReturns.count ? ` · مرتجع ${money(d.salesReturns.total)}` : ""}`} cls="success" />
          <K label="مجمل ربح اليوم" v={d.grossProfit} sub={`صافي المبيعات ${money(d.netSales)} قبل الضريبة`} cls={d.grossProfit >= 0 ? "success" : "danger"} />
          <K label="المشتريات" v={d.purchases.total} sub={`${d.purchases.count} فاتورة`} />
          <K label="المصروفات" v={d.expenses.total} sub={`${d.expenses.count} مصروف`} cls="danger" />
          <K label="المقبوض من العملاء" v={d.receipts.total} sub={`${d.receipts.count} سند قبض`} />
          <K label="المدفوع للموردين" v={d.payments.total} sub={`${d.payments.count} سند صرف`} />
        </div>
        <div className="card"><div className="card-h"><h3>حركة الصناديق والبنوك — {d.date}</h3></div>
          {!d.cash.length ? <div className="card-b"><Empty text="لا أرصدة ولا حركة نقدية حتى هذا اليوم" /></div> : <div className="table-wrap"><table className="tbl" data-cash><thead><tr><th>الحساب</th><th className="n">رصيد أول اليوم</th><th className="n">دخل</th><th className="n">خرج</th><th className="n">رصيد آخر اليوم</th></tr></thead>
            <tbody>{d.cash.map((a: any) => <tr key={a.id}><td>{a.code} {a.name}</td><td className="n"><Money v={a.opening} /></td><td className="n"><Money v={a.in} blankZero /></td><td className="n"><Money v={a.out} blankZero /></td><td className="n"><b><Money v={a.closing} /></b></td></tr>)}</tbody>
            <tfoot><tr><th>الإجمالي</th><th className="n"><Money v={d.cashTotal.opening} /></th><th className="n"><Money v={d.cashTotal.in} /></th><th className="n"><Money v={d.cashTotal.out} /></th><th className="n"><Money v={d.cashTotal.closing} /></th></tr></tfoot></table></div>}</div>
        <div className="grid cols-2">
          <div className="card"><div className="card-h"><h3>الأكثر مبيعاً في هذا اليوم</h3></div>{!d.topItems.length ? <div className="card-b"><Empty text="لا مبيعات مرحّلة في هذا اليوم" /></div> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الصنف</th><th className="n">الكمية</th><th className="n">القيمة قبل الضريبة</th></tr></thead><tbody>{d.topItems.map((x: any, i: number) => <tr key={i}><td>{x.name}</td><td className="n num">{x.qty}</td><td className="n"><Money v={x.net} /></td></tr>)}</tbody></table></div>}</div>
          {date === today() && <div className="card no-print"><div className="card-h"><h3>يحتاج متابعتك الآن</h3><Link className="btn sm" to="/quick">＋ سجّل عملية</Link></div><div className="card-b">{brief.data?.todo?.length ? <TodoList todo={brief.data.todo} /> : <div className="alert ok small">✓ لا شيء معلّق يحتاج متابعة الآن.</div>}</div></div>}
        </div>
      </>}
    </div>
  );
}
