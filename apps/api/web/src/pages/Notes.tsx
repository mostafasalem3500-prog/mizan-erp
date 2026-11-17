/** «إيضاحات القوائم المالية» and «القوائم المجمّعة لعدة منشآت». */
import React, { useState } from "react";
import { CUR } from "../shared/country";
import { useFetch, Money, Loading, Empty, DateRange, PrintBtn, ExportBtn, today, yearStart, useCompanyContext } from "../lib";

const TYPE_AR: Record<string, string> = { ASSET: "الأصول", LIABILITY: "الخصوم", EQUITY: "حقوق الملكية", REVENUE: "الإيرادات", EXPENSE: "المصروفات" };

export function NotesPage() {
  const [f, setF] = useState({ from: yearStart(), to: today() });
  const { data: d, loading } = useFetch<any>(`/reports/notes?from=${f.from}&to=${f.to}`, [f.from, f.to]);
  const Rows = ({ rows, total }: { rows: any[]; total: number }) => !rows.length ? <div className="muted small">لا أرصدة في هذا البند.</div> : (
    <div className="table-wrap"><table className="tbl compact"><tbody>{rows.map((r, i) => <tr key={i}><td>{r.code ? <span className="num muted">{r.code} </span> : null}{r.name}</td><td className="n" style={{ width: 170 }}><Money v={r.amount} /></td></tr>)}</tbody>
      <tfoot><tr><th>الإجمالي</th><th className="n"><Money v={total} /></th></tr></tfoot></table></div>);
  const Age = ({ a }: { a: any }) => <div className="table-wrap" style={{ marginTop: 8 }}><table className="tbl compact" data-ageing><thead><tr><th>أعمار الأرصدة المفتوحة</th><th className="n">لم تستحق</th><th className="n">1–30 يوماً</th><th className="n">31–60</th><th className="n">61–90</th><th className="n">أكثر من 90</th><th className="n">الإجمالي</th></tr></thead>
    <tbody><tr><td>حسب تاريخ الاستحقاق</td><td className="n"><Money v={a.notDue} /></td><td className="n"><Money v={a.d1_30} /></td><td className="n"><Money v={a.d31_60} /></td><td className="n"><Money v={a.d61_90} /></td><td className="n"><Money v={a.over90} /></td><td className="n"><b><Money v={a.total} /></b></td></tr></tbody></table></div>;
  return (
    <div className="grid print-doc stmt">
      <div className="card no-print"><div className="card-h"><div><h3>إيضاحات القوائم المالية</h3><div className="small muted">تُبنى من الدفاتر: السياسات المطبَّقة فعلاً في البرنامج، وتفاصيل البنود الرئيسية. ما يخص الإدارة وحدها مُعلَّم «يُستكمل من الإدارة».</div></div><div className="row"><PrintBtn /></div></div>
        <div className="card-b"><DateRange from={f.from} to={f.to} onChange={(from, to) => setF({ from, to })} /></div></div>
      {loading && !d ? <Loading /> : !d ? <Empty /> : <div className="card"><div className="card-b" data-notes>
        <div style={{ textAlign: "center", marginBottom: 14 }}><h2 style={{ margin: 0 }}>{d.company.name}</h2><div>إيضاحات حول القوائم المالية</div><div className="muted small">عن الفترة من {d.from} إلى {d.to} — المبالغ بـ{d.currency}</div></div>
        {d.notes.map((x: any) => <section key={x.no} className="note" style={{ marginBottom: 18, breakInside: "avoid" }}>
          <h3 style={{ marginBottom: 6 }}>{x.no}. {x.title}</h3>
          {x.text?.map((p: string, i: number) => <p key={i} style={{ margin: "4px 0" }}>{p}</p>)}
          {x.rows && <Rows rows={x.rows} total={x.total} />}
          {x.ageing && <Age a={x.ageing} />}
          {x.ppe && (!x.ppe.length ? <div className="muted small">لا أصول ثابتة مسجَّلة.</div> : <div className="table-wrap"><table className="tbl compact" data-ppe><thead><tr><th>الفئة</th><th className="n">التكلفة أول الفترة</th><th className="n">إضافات</th><th className="n">التكلفة آخر الفترة</th><th className="n">مجمع الإهلاك أول الفترة</th><th className="n">إهلاك الفترة</th><th className="n">مجمع الإهلاك آخر الفترة</th><th className="n">صافي القيمة الدفترية</th></tr></thead>
            <tbody>{x.ppe.map((r: any) => <tr key={r.category}><td>{r.category}</td><td className="n"><Money v={r.costOpen} /></td><td className="n"><Money v={r.additions} blankZero /></td><td className="n"><Money v={r.costClose} /></td><td className="n"><Money v={r.depOpen} /></td><td className="n"><Money v={r.charge} blankZero /></td><td className="n"><Money v={r.depClose} /></td><td className="n"><b><Money v={r.netBook} /></b></td></tr>)}</tbody>
            <tfoot><tr><th colSpan={7}>صافي القيمة الدفترية</th><th className="n"><Money v={x.total} /></th></tr></tfoot></table></div>)}
          {x.todo && <div className="alert warn small" style={{ marginTop: 6 }} data-todo-note>✎ يُستكمل من الإدارة: {x.todo}</div>}
        </section>)}
      </div></div>}
    </div>
  );
}

export function CombinedPage() {
  const { me } = useCompanyContext();
  const [f, setF] = useState({ from: yearStart(), to: today() });
  const [sel, setSel] = useState<string[]>([]);
  const { data: d, loading } = useFetch<any>(`/reports/combined?from=${f.from}&to=${f.to}&companies=${sel.join(",")}`, [f.from, f.to, sel.join(",")]);
  const cos: any[] = d?.companies || [];
  const sign = (r: any) => (["LIABILITY", "EQUITY", "REVENUE"].includes(r.type) ? -1 : 1);
  return (
    <div className="grid print-doc stmt">
      <div className="card no-print"><div className="card-h"><div><h3>القوائم المجمّعة لعدة منشآت</h3><div className="small muted">تجمع أرصدة منشآتك حسب رمز الحساب في ميزان واحد. تجميع فقط: الأرصدة والمعاملات بين المنشآت نفسها لا تُستبعد آلياً.</div></div>
        <div className="row"><PrintBtn />{d?.rows?.length > 0 && <ExportBtn name="القوائم المجمعة" rows={() => d.rows.map((r: any) => ({ الرمز: r.code, الحساب: r.name, النوع: TYPE_AR[r.type], ...Object.fromEntries(cos.map((c) => [c.name, sign(r) * (r.per[c.id] || 0)])), الإجمالي: sign(r) * r.total }))} />}</div></div>
        <div className="card-b row" style={{ alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}><DateRange from={f.from} to={f.to} onChange={(from, to) => setF({ from, to })} />
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }} data-cos>{(d?.available || []).map((c: any) => <label key={c.id} className="check"><input type="checkbox" checked={!sel.length || sel.includes(c.id)} onChange={(e) => { const all = (d.available as any[]).map((x) => x.id); const cur = sel.length ? sel : all; const nx = e.target.checked ? [...new Set([...cur, c.id])] : cur.filter((x) => x !== c.id); setSel(nx.length === all.length ? [] : nx.length ? nx : cur); }} /> {c.name}{c.id === me.company.id ? " (الحالية)" : ""}</label>)}</div></div></div>
      {loading && !d ? <Loading /> : !d ? <Empty /> : d.mixedCurrency ? <div className="alert warn">المنشآت المختارة بعملات مختلفة — اختر منشآت بعملة واحدة.</div> : (d.available.length < 2 ? <div className="alert info" data-single>لديك منشأة واحدة. التقرير يفيد عند وجود منشأتين أو أكثر على حسابك (من قائمة المنشآت أعلى القائمة الجانبية ← منشأة جديدة).</div> : null)}
      {d && !d.mixedCurrency && d.rows.length > 0 && <>
        <div className="kpis" data-combined>
          <div className="card kpi"><div className="label">إجمالي الأصول</div><div className="value"><Money v={d.totals.assets} /></div><div className="sub">{cos.length} منشأة</div></div>
          <div className="card kpi"><div className="label">إجمالي الخصوم</div><div className="value"><Money v={d.totals.liabilities} /></div></div>
          <div className="card kpi"><div className="label">حقوق الملكية مع ربح الفترة</div><div className="value"><Money v={d.totals.equityWithProfit} /></div></div>
          <div className="card kpi success"><div className="label">الإيرادات</div><div className="value"><Money v={d.totals.revenue} /></div></div>
          <div className={"card kpi " + (d.totals.profit >= 0 ? "success" : "danger")}><div className="label">صافي الربح المجمّع</div><div className="value"><Money v={d.totals.profit} /></div><div className="sub">{d.totals.balanced ? "الميزانية المجمّعة متوازنة ✓" : "غير متوازنة"}</div></div>
        </div>
        <div className="alert warn small">تنبيه محاسبي: هذا تجميع وليس توحيداً كاملاً — إن كانت بين المنشآت مبيعات أو أرصدة متبادلة فاستبعدها يدوياً قبل الاعتماد على الأرقام.</div>
        <div className="card"><div className="table-wrap"><table className="tbl compact"><thead><tr><th>الرمز</th><th>الحساب</th>{cos.map((c) => <th key={c.id} className="n">{c.name}</th>)}<th className="n">الإجمالي ({CUR()})</th></tr></thead>
          <tbody>{["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"].map((ty) => { const rs = d.rows.filter((r: any) => r.type === ty); if (!rs.length) return null; return <React.Fragment key={ty}>
            <tr className="group"><th colSpan={cos.length + 3}>{TYPE_AR[ty]}</th></tr>
            {rs.map((r: any) => <tr key={r.code}><td className="num">{r.code}</td><td>{r.name}</td>{cos.map((c) => <td key={c.id} className="n"><Money v={sign(r) * (r.per[c.id] || 0)} blankZero /></td>)}<td className="n"><b><Money v={sign(r) * r.total} /></b></td></tr>)}
          </React.Fragment>; })}</tbody></table></div></div>
      </>}
    </div>
  );
}
