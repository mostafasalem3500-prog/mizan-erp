import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, q, useFetch, Money, money, Loading, Empty, Badge, Modal, Field, Input, Select, NumInput, Picker, accountFetcher, useAction, useCompanyContext, ExportBtn, PrintBtn, today, fmtDate, confirmDlg, DateRange } from "../lib";

const M = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const BS: Record<string, string> = { DRAFT: "مسودة", APPROVED: "معتمدة" };

export function BudgetsPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const list = useFetch("/budgets");
  const [add, setAdd] = useState(false);
  if (id) return <BudgetEditor id={id} onBack={() => { nav("/budgets"); list.reload(); }} />;
  return (
    <div className="grid">
      <div className="card"><div className="card-h"><div><h3>الموازنات التقديرية</h3><div className="small muted">خطة سنوية للإيرادات والمصروفات بالشهر، ومقارنتها بالفعلي من الأستاذ العام</div></div>{can("accounting.write") && <button className="btn primary sm" onClick={() => setAdd(true)}>＋ موازنة جديدة</button>}</div>
        {!list.data ? <Loading /> : !list.data.length ? <Empty text="لا توجد موازنات — أنشئ موازنة من الأرقام الفعلية للسنة الماضية أو ابدأ من الصفر" /> : <div className="table-wrap"><table className="tbl"><thead><tr><th>الاسم</th><th>السنة</th><th className="n">البنود</th><th>الحالة</th><th>أُنشئت</th><th /></tr></thead>
          <tbody>{list.data.map((b: any) => <tr key={b.id}><td><b>{b.name}</b><div className="small muted">{b.notes}</div></td><td>{b.year}</td><td className="n">{b.linesCount}</td><td><Badge s={b.status} map={BS} /></td><td className="dt">{fmtDate(b.createdAt)}</td><td className="row" style={{ gap: 4 }}><button className="btn sm primary" onClick={() => nav(`/budgets/${b.id}`)}>فتح</button><button className="btn sm" onClick={() => nav(`/reports/budget?budgetId=${b.id}`)}>الموازنة مقابل الفعلي</button>{can("accounting.write") && <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { if (confirmDlg(`حذف الموازنة «${b.name}»؟`)) { await api(`/budgets/${b.id}`, { method: "DELETE" }); list.reload(); } })}>حذف</button>}</td></tr>)}</tbody></table></div>}
      </div>
      {add && <NewBudget onClose={(created) => { setAdd(false); if (created) nav(`/budgets/${created.id}`); }} />}
    </div>
  );
}

function NewBudget({ onClose }: { onClose: (b?: any) => void }) {
  const { run, busy } = useAction();
  const y = Number(today().slice(0, 4));
  const [f, setF] = useState<any>({ name: `موازنة ${y + 1}`, year: y + 1, source: "ACTUAL", sourceYear: y, growthPct: 10, notes: "" });
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal narrow title="موازنة جديدة" onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !f.name} onClick={() => run(async () => onClose(await api("/budgets", { body: f })), "تم إنشاء الموازنة")}>إنشاء</button></>}>
      <div className="grid">
        <div className="form-grid"><Field label="الاسم" span2><Input autoFocus value={f.name} onChange={s("name")} /></Field><Field label="السنة"><NumInput value={f.year} onChange={s("year")} /></Field></div>
        <Field label="طريقة البناء"><Select value={f.source} onChange={s("source")}><option value="ACTUAL">من الأرقام الفعلية لسنة سابقة (+ نسبة نمو)</option><option value="ACCOUNTS">كل حسابات الإيرادات والمصروفات بقيم صفرية</option><option value="EMPTY">فارغة — أضيف البنود يدوياً</option></Select></Field>
        {f.source === "ACTUAL" && <div className="form-grid"><Field label="سنة المصدر"><NumInput value={f.sourceYear} onChange={s("sourceYear")} /></Field><Field label="نسبة النمو %"><NumInput value={f.growthPct} onChange={s("growthPct")} /></Field></div>}
        <Field label="ملاحظات"><Input value={f.notes} onChange={s("notes")} /></Field>
      </div>
    </Modal>
  );
}

function BudgetEditor({ id, onBack }: { id: string; onBack: () => void }) {
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const { data, reload, setData } = useFetch(`/budgets/${id}`);
  const [lines, setLines] = useState<any[]>([]);
  const [dirty, setDirty] = useState(false);
  const [addAcc, setAddAcc] = useState<any>(null);
  const [fill, setFill] = useState(false);
  useEffect(() => { if (data) { setLines(data.lines.map((l: any) => ({ ...l }))); setDirty(false); } }, [data]);
  if (!data) return <Loading />;
  const editable = data.status === "DRAFT" && can("accounting.write");
  const set = (i: number, m: number, v: string) => { const L = [...lines]; L[i] = { ...L[i], months: L[i].months.map((x: number, k: number) => (k === m ? Number(v) || 0 : x)) }; setLines(L); setDirty(true); };
  const spread = (i: number, annual: number) => { const per = Math.round((annual / 12) * 100) / 100; const arr = Array(12).fill(per); arr[11] = Math.round((annual - per * 11) * 100) / 100; const L = [...lines]; L[i] = { ...L[i], months: arr }; setLines(L); setDirty(true); };
  const total = (l: any) => l.months.reduce((a: number, x: number) => a + Number(x || 0), 0);
  const rev = lines.filter((l) => l.type === "REVENUE"), exp = lines.filter((l) => l.type === "EXPENSE");
  const sum = (arr: any[]) => arr.reduce((a, l) => a + total(l), 0);
  const save = () => run(async () => { const r = await api(`/budgets/${id}/lines`, { method: "PUT", body: { lines: lines.map((l) => ({ accountId: l.accountId, costCenterId: l.costCenterId, months: l.months })) } }); setData(r); }, "تم حفظ الموازنة");
  const row = (l: any, i: number) => (
    <tr key={l.accountId + (l.costCenterId || "")}>
      <td style={{ position: "sticky", insetInlineStart: 0, background: "var(--card)", minWidth: 190 }}><span className="num muted">{l.code}</span> {l.nameAr}{l.costCenter && <div className="small muted">{l.costCenter}</div>}</td>
      {l.months.map((v: number, m: number) => <td key={m} className="n" style={{ padding: 2 }}>{editable ? <input className="input num" style={{ width: 86, padding: "4px 6px" }} value={v || ""} placeholder="0" onChange={(e) => set(i, m, e.target.value)} onFocus={(e) => e.target.select()} /> : <Money v={v} blankZero />}</td>)}
      <td className="n"><b><Money v={total(l)} /></b></td>
      <td>{editable && <div className="row" style={{ gap: 2 }}><button className="btn sm ghost" title="توزيع مبلغ سنوي بالتساوي" onClick={() => { const a = prompt("المبلغ السنوي للتوزيع على 12 شهراً:", String(total(l) || "")); if (a !== null) spread(i, Number(a) || 0); }}>÷12</button><button className="btn sm ghost" onClick={() => { setLines(lines.filter((_, k) => k !== i)); setDirty(true); }}>✕</button></div>}</td>
    </tr>
  );
  const group = (title: string, arr: any[]) => <React.Fragment key={title}>
    <tr className="group"><td colSpan={15}>{title}</td></tr>
    {arr.map((l) => row(l, lines.indexOf(l)))}
    <tr style={{ fontWeight: 600 }}><td>إجمالي {title}</td>{Array.from({ length: 12 }).map((_, m) => <td key={m} className="n"><Money v={arr.reduce((a, l) => a + Number(l.months[m] || 0), 0)} blankZero /></td>)}<td className="n"><Money v={sum(arr)} /></td><td /></tr>
  </React.Fragment>;
  return (
    <div className="grid">
      <div className="card">
        <div className="card-h"><div className="row"><button className="btn sm" onClick={onBack}>→ الموازنات</button><div><h3>{data.name} — {data.year}</h3><div className="small muted"><Badge s={data.status} map={BS} /> · صافي الموازنة: <b><Money v={sum(rev) - sum(exp)} sign /></b></div></div></div>
          <div className="row no-print">
            {editable && <><button className="btn sm" onClick={() => setFill(true)}>تعبئة من الفعلي</button><Picker value={addAcc} onChange={(a) => { if (a && !lines.some((l) => l.accountId === a.id && !l.costCenterId)) { setLines([...lines, { accountId: a.id, code: a.code, nameAr: a.nameAr, type: a.type, months: Array(12).fill(0) }]); setDirty(true); } setAddAcc(null); }} fetcher={accountFetcher((a) => a.type === "REVENUE" || a.type === "EXPENSE")} label={(a: any) => `${a.code} ${a.nameAr}`} placeholder="＋ إضافة حساب..." /></>}
            <ExportBtn name={data.name} rows={() => lines.map((l) => ({ الحساب: l.code, الاسم: l.nameAr, ...Object.fromEntries(l.months.map((v: number, m: number) => [M[m], v])), الإجمالي: total(l) }))} />
            {editable && <button className="btn primary sm" disabled={busy || !dirty} onClick={save}>حفظ</button>}
            {can("accounting.write") && <button className="btn sm" disabled={busy} onClick={() => run(async () => { if (dirty && !confirmDlg("توجد تعديلات غير محفوظة — المتابعة بدون حفظ؟")) return; setData(await api(`/budgets/${id}/status`, { body: { status: data.status === "DRAFT" ? "APPROVED" : "DRAFT" } })); }, data.status === "DRAFT" ? "تم اعتماد الموازنة" : "أُعيدت إلى مسودة")}>{data.status === "DRAFT" ? "اعتماد" : "إعادة إلى مسودة"}</button>}
          </div></div>
        {!lines.length ? <Empty text="أضف حسابات الإيرادات والمصروفات من الحقل أعلاه، أو استخدم «تعبئة من الفعلي»" /> : <div className="table-wrap" style={{ maxHeight: "70vh" }}><table className="tbl compact"><thead><tr><th style={{ position: "sticky", insetInlineStart: 0, background: "var(--card)" }}>الحساب</th>{M.map((m) => <th key={m} className="n">{m}</th>)}<th className="n">السنة</th><th /></tr></thead>
          <tbody>{group("الإيرادات", rev)}{group("المصروفات", exp)}<tr style={{ fontWeight: 700, background: "var(--primary-soft)" }}><td>صافي الربح المخطط</td>{Array.from({ length: 12 }).map((_, m) => <td key={m} className="n"><Money v={rev.reduce((a, l) => a + Number(l.months[m] || 0), 0) - exp.reduce((a, l) => a + Number(l.months[m] || 0), 0)} sign blankZero /></td>)}<td className="n"><Money v={sum(rev) - sum(exp)} sign /></td><td /></tr></tbody></table></div>}
      </div>
      {fill && <FillModal id={id} year={data.year} onClose={(ok) => { setFill(false); if (ok) reload(); }} />}
    </div>
  );
}

function FillModal({ id, year, onClose }: { id: string; year: number; onClose: (ok?: boolean) => void }) {
  const { run, busy } = useAction();
  const [sourceYear, setY] = useState(year - 1);
  const [growth, setG] = useState(10);
  return (
    <Modal narrow title="تعبئة الموازنة من الأرقام الفعلية" onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy} onClick={() => run(async () => { if (!confirmDlg("سيتم استبدال كل بنود الموازنة الحالية. متابعة؟")) return; await api(`/budgets/${id}/fill`, { body: { sourceYear, growthPct: growth } }); onClose(true); }, "تمت التعبئة")}>تعبئة</button></>}>
      <div className="form-grid"><Field label="سنة المصدر"><NumInput value={sourceYear} onChange={(e) => setY(Number(e.target.value))} /></Field><Field label="نسبة النمو %"><NumInput value={growth} onChange={(e) => setG(Number(e.target.value))} /></Field></div>
      <div className="hint mt">يُؤخذ صافي حركة كل حساب إيراد/مصروف شهرياً من قيود السنة المصدر ويُضرب في (1 + نسبة النمو).</div>
    </Modal>
  );
}

/** Budget vs actual report (used inside Reports) */
export function BudgetVsActual({ from, to }: { from: string; to: string }) {
  const { me } = useCompanyContext();
  const params = new URLSearchParams(location.search);
  const list = useFetch("/budgets");
  const [id, setId] = useState(params.get("budgetId") || "");
  useEffect(() => { if (!id && list.data?.length) setId(list.data[0].id); }, [list.data]);
  const { data: d } = useFetch(id ? `/reports/budget/${id}${q({ from, to })}` : null, [id, from, to]);
  if (!list.data) return <Loading />;
  if (!list.data.length) return <div className="card"><Empty text="لا توجد موازنات — أنشئ موازنة أولاً من صفحة الموازنات" /></div>;
  const pctCls = (r: any) => (r.variance < 0 ? "neg-val" : r.variance > 0 ? "pos-val" : "");
  const Rows = ({ arr }: { arr: any[] }) => <>{arr.map((r) => <tr key={r.code + (r.costCenter || "")} className={r.unbudgeted ? "muted" : ""}><td><span className="num muted">{r.code}</span> {r.name}{r.costCenter && <span className="small muted"> · {r.costCenter}</span>}{r.unbudgeted && <span className="badge amber" style={{ marginInlineStart: 6 }}>غير مدرج</span>}</td><td className="n"><Money v={r.budget} blankZero /></td><td className="n"><Money v={r.actual} blankZero /></td><td className={"n " + pctCls(r)}><Money v={r.variance} sign /></td><td className="n">{r.pct !== null ? `${r.pct}%` : ""}</td><td className="n muted"><Money v={r.annual} blankZero /></td></tr>)}</>;
  const T = ({ label, x, big }: { label: string; x: any; big?: boolean }) => <tr style={big ? { fontWeight: 700, background: "var(--primary-soft)" } : { fontWeight: 600 }}><td>{label}</td><td className="n"><Money v={x.budget} /></td><td className="n"><Money v={x.actual} /></td><td className={"n " + (x.variance < 0 ? "neg-val" : "pos-val")}><Money v={x.variance} sign /></td><td className="n">{x.budget ? Math.round((x.actual / x.budget) * 100) + "%" : ""}</td><td /></tr>;
  return (
    <div className="card">
      <div className="card-h"><div><h3>الموازنة مقابل الفعلي</h3><div className="small muted">{me.company.nameAr} · {from} — {to}{d && ` · الانحراف الموجب = في صالح المنشأة`}</div></div><div className="row no-print"><Select value={id} onChange={(e) => setId(e.target.value)} style={{ width: 220 }}>{list.data.map((b: any) => <option key={b.id} value={b.id}>{b.name} ({b.year})</option>)}</Select><PrintBtn />{d && <ExportBtn name="الموازنة مقابل الفعلي" rows={d.rows.map((r: any) => ({ الحساب: r.code, الاسم: r.name, الموازنة: r.budget, الفعلي: r.actual, الانحراف: r.variance, "نسبة التحقق %": r.pct }))} />}</div></div>
      {!d ? <Loading /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الحساب</th><th className="n">الموازنة (الفترة)</th><th className="n">الفعلي</th><th className="n">الانحراف</th><th className="n">التحقق %</th><th className="n">موازنة السنة</th></tr></thead>
        <tbody>
          <tr className="group"><td colSpan={6}>الإيرادات</td></tr><Rows arr={d.rows.filter((r: any) => r.type === "REVENUE")} /><T label="إجمالي الإيرادات" x={d.revenue} />
          <tr className="group"><td colSpan={6}>المصروفات</td></tr><Rows arr={d.rows.filter((r: any) => r.type === "EXPENSE")} /><T label="إجمالي المصروفات" x={d.expense} />
          <T label="صافي الربح / (الخسارة)" x={d.net} big />
        </tbody></table></div>}
    </div>
  );
}
