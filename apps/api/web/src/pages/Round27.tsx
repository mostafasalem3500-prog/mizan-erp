import { CFG } from "../shared/country";
/** Round 27 — final accounts (الحسابات الختامية) and the year-end closing checklist. */
import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, useFetch, Money, money, Loading, Empty, Modal, PrintBtn, exportExcel, useAction, useToast, confirmDlg, useCompanyContext } from "../lib";

type Row = { code: string; name: string; cur: number; prev: number };
type Sec = { subtype: string; name: string; items: Row[]; cur: number; prev: number };

const Num = ({ v, neg }: { v: number; neg?: boolean }) => {
  const x = neg ? -v : v;
  return <span className={"num" + (x < 0 ? " neg-val" : "")}>{x < 0 ? `(${money(-x)})` : money(x)}</span>;
};

/** Comparative statement table: sections with account lines, subtotals and totals. */
function Stmt({ head, blocks, prevLabel, curLabel }: { head?: string; prevLabel: string; curLabel: string; blocks: ({ sections?: Sec[]; neg?: boolean } | { total: string; v: number[]; strong?: boolean; neg?: boolean })[] }) {
  return (
    <table className="tbl fin-stmt">
      <thead><tr><th style={{ width: 90 }}>رقم الحساب</th><th>{head || "البيان"}</th><th className="num">{curLabel}</th><th className="num">{prevLabel}</th></tr></thead>
      <tbody>
        {blocks.map((b: any, i) => b.total ? (
          <tr key={i} className={b.strong ? "fin-total" : "fin-sub"}><td /><td>{b.total}</td><td className="num"><Num v={b.v[0]} neg={b.neg} /></td><td className="num"><Num v={b.v[1]} neg={b.neg} /></td></tr>
        ) : (b.sections as Sec[]).map((s) => (
          <React.Fragment key={s.subtype + i}>
            <tr className="fin-sec"><td /><td colSpan={3}><b>{s.name}</b></td></tr>
            {s.items.map((r) => <tr key={r.code}><td className="muted small" dir="ltr">{r.code}</td><td style={{ paddingInlineStart: 22 }}>{r.name}</td><td className="num"><Num v={r.cur} neg={b.neg} /></td><td className="num muted"><Num v={r.prev} neg={b.neg} /></td></tr>)}
            {s.items.length > 1 && <tr className="fin-sub-s"><td /><td style={{ paddingInlineStart: 22 }}>إجمالي {s.name}</td><td className="num"><Num v={s.cur} neg={b.neg} /></td><td className="num muted"><Num v={s.prev} neg={b.neg} /></td></tr>}
          </React.Fragment>
        )))}
      </tbody>
    </table>
  );
}

const flat = (title: string, blocks: any[]) => {
  const out: any[] = [];
  for (const b of blocks) {
    if (b.total) out.push({ القائمة: title, "رقم الحساب": "", البيان: b.total, "السنة الحالية": b.neg ? -b.v[0] : b.v[0], "السنة السابقة": b.neg ? -b.v[1] : b.v[1] });
    else for (const s of b.sections as Sec[]) for (const r of s.items) out.push({ القائمة: title, "رقم الحساب": r.code, البيان: `${s.name} — ${r.name}`, "السنة الحالية": b.neg ? -r.cur : r.cur, "السنة السابقة": b.neg ? -r.prev : r.prev });
  }
  return out;
};

export function FinalAccountsPage({ charity = false }: { charity?: boolean }) {
  const { me } = useCompanyContext();
  const [sp] = useSearchParams();
  const [fy, setFy] = useState(sp.get("fy") || "");
  const [tab, setTab] = useState("all");
  const { data: d, loading } = useFetch<any>(`/reports/final-accounts${fy ? `?fiscalYearId=${fy}` : ""}`, [fy]);
  const L = charity
    ? { bs: "قائمة المركز المالي", is: "قائمة الأنشطة", eq: "قائمة التغيرات في صافي الأصول", cf: "قائمة التدفقات النقدية", net: "صافي الفائض (العجز)", equity: "صافي الأصول (الأموال)", sales: "الإيرادات" }
    : { bs: "قائمة المركز المالي (الميزانية العمومية)", is: "قائمة الدخل", eq: "قائمة التغيرات في حقوق الملكية", cf: "قائمة التدفقات النقدية", net: "صافي الربح (الخسارة)", equity: "حقوق الملكية", sales: "صافي المبيعات" };
  if (loading && !d) return <Loading />;
  if (!d) return <Empty text="تعذّر تحميل الحسابات الختامية" />;
  const cur = `${d.fiscalYear.name}`, prev = `${d.prior.name}`;
  const B = d.balanceSheet, T = B.totals, I = d.incomeStatement, IT = I.totals;
  const bsBlocks = [
    { sections: B.currentAssets }, { total: "إجمالي الأصول المتداولة", v: T.currentAssets },
    { sections: B.fixedAssets }, { total: "صافي الأصول الثابتة", v: T.fixedAssets },
    { total: "إجمالي الأصول", v: T.assets, strong: true },
    { sections: B.currentLiab }, { total: "إجمالي الخصوم المتداولة", v: T.currentLiab },
    { sections: B.ltLiab }, { total: "إجمالي الخصوم غير المتداولة", v: T.ltLiab },
    { total: "إجمالي الخصوم", v: T.liab, strong: true },
    { sections: B.equity }, { total: charity ? "الفائض (العجز) غير المقفل" : "صافي ربح (خسارة) غير مقفل", v: T.currentResult },
    { total: `إجمالي ${L.equity}`, v: T.equity, strong: true },
    { total: `إجمالي الخصوم و${L.equity}`, v: T.liabEquity, strong: true },
  ];
  const isBlocks = [
    { sections: I.sales }, ...(I.returns.length ? [{ sections: I.returns }] : []), { total: L.sales, v: IT.netSales },
    ...(I.cogs.length ? [{ sections: I.cogs, neg: true }, { total: "مجمل الربح", v: IT.gross, strong: true }] : []),
    { sections: I.opex, neg: true }, { total: charity ? "النتيجة قبل الإيرادات والمصروفات الأخرى" : "الربح التشغيلي", v: IT.operating },
    { sections: I.otherIncome }, { sections: I.otherExp, neg: true },
    ...(I.zakat.length ? [{ total: "صافي الربح قبل الزكاة", v: IT.beforeZakat }, { sections: I.zakat, neg: true }] : []),
    { total: L.net, v: IT.net, strong: true },
  ];
  const E = d.equity;
  const cfD = d.cashFlow.direct, cfI = d.cashFlow.indirect;
  const passed = d.checks.filter((c: any) => c.ok).length;
  const xls = () => exportExcel([...flat(L.bs, bsBlocks), ...flat(L.is, isBlocks),
    ...[{ label: "الرصيد أول السنة", ...E.opening }, ...E.rows, { label: "الرصيد آخر السنة", ...E.closing }].map((r: any) => ({ القائمة: L.eq, "رقم الحساب": "", البيان: r.label, "رأس المال": r.capital, "الأرباح المبقاة": r.retained, "حقوق ملكية أخرى": r.other, "نتيجة غير مقفلة": r.result, الإجمالي: r.total })),
    ...d.checks.map((c: any) => ({ القائمة: "ترابط القوائم", البيان: c.name, "السنة الحالية": c.a, "السنة السابقة": c.b, النتيجة: c.ok ? "مطابق" : "غير مطابق" }))], `الحسابات الختامية ${cur}`, "القوائم");
  const show = (k: string) => tab === "all" || tab === k;
  const H = ({ t }: { t: string }) => <div className="card-h"><h3>{t}</h3><span className="small muted">للسنة المنتهية في {d.fiscalYear.to} مع المقارنة بـ {d.prior.to}</span></div>;
  return (
    <div className="grid">
      <div className="card no-print"><div className="card-h"><h3>📚 الحسابات الختامية والقوائم المالية</h3><div className="row">
        <select className="input" style={{ width: 170 }} value={fy || d.fiscalYear.id} onChange={(e) => setFy(e.target.value)}>{d.years.map((y: any) => <option key={y.id} value={y.id}>السنة المالية {y.name}{y.status === "CLOSED" ? " (مقفلة)" : ""}</option>)}</select>
        <button className="btn sm" onClick={xls}>⬇ Excel</button><PrintBtn pdfName={`الحسابات الختامية ${cur}`} />
      </div></div>
        <div className="card-b">
          <div className="tabs" style={{ marginBottom: 0 }}>{[["all", "كل القوائم"], ["bs", "المركز المالي"], ["is", charity ? "الأنشطة" : "الدخل"], ["eq", charity ? "صافي الأصول" : "حقوق الملكية"], ["cf", "التدفقات النقدية"], ["chk", `ترابط القوائم ${passed}/${d.checks.length}`]].map(([k, t]) => <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{t}</button>)}</div>
        </div>
      </div>
      <div className="print-doc fin-doc" style={{ maxWidth: "none", padding: 0, margin: 0, background: "transparent" }}>
        <div className="print-only"><h2 style={{ margin: 0 }}>{me.company.nameAr}</h2><div>الحسابات الختامية للسنة المالية {cur} ({d.fiscalYear.from} – {d.fiscalYear.to}) — المبالغ بال{CFG.currencyAr}</div><hr /></div>
        <div className="mini-kpis fin-kpis">
          <div><span>{L.net}</span><b className={IT.net[0] < 0 ? "neg-val" : "pos-val"}><Money v={IT.net[0]} /></b><small className="muted">السابقة: {money(IT.net[1])}</small></div>
          <div><span>إجمالي الأصول</span><b><Money v={T.assets[0]} /></b><small className="muted">السابقة: {money(T.assets[1])}</small></div>
          <div><span>{L.equity}</span><b><Money v={T.equity[0]} /></b><small className="muted">السابقة: {money(T.equity[1])}</small></div>
          <div><span>النقدية آخر السنة</span><b><Money v={cfD.closing} /></b><small className="muted">أول السنة: {money(cfD.opening)}</small></div>
          <div><span>حالة السنة</span><b>{d.fiscalYear.status === "CLOSED" ? "🔒 مقفلة" : "🔓 مفتوحة"}</b><small className="muted">{d.fiscalYear.status === "CLOSED" ? "قيد الإقفال مرحّل" : "النتيجة لم تُرحَّل بعد"}</small></div>
          <div className={d.ok ? "fin-ok" : "fin-bad"}><span>ترابط القوائم</span><b>{d.ok ? "✓ مترابطة" : "✗ يوجد فرق"}</b><small>{passed} من {d.checks.length} فحصاً</small></div>
        </div>

        {show("bs") && <div className="card mt fin-card"><H t={L.bs} /><div className="card-b table-wrap"><Stmt prevLabel={prev} curLabel={cur} blocks={bsBlocks} /></div></div>}
        {show("is") && <div className="card mt fin-card"><H t={L.is} /><div className="card-b table-wrap"><Stmt prevLabel={prev} curLabel={cur} blocks={isBlocks} />
          {!charity && <div className="small muted mt">هامش مجمل الربح {IT.grossMargin[0]}% (السابقة {IT.grossMargin[1]}%) · هامش صافي الربح {IT.netMargin[0]}% (السابقة {IT.netMargin[1]}%)</div>}</div></div>}
        {show("eq") && <div className="card mt fin-card"><H t={L.eq} /><div className="card-b table-wrap">
          <table className="tbl fin-stmt"><thead><tr><th>البيان</th><th className="num">رأس المال</th><th className="num">{charity ? "صافي الأصول المتراكمة" : "الأرباح المبقاة"}</th><th className="num">{charity ? "أموال أخرى" : "حقوق ملكية أخرى"}</th><th className="num">نتيجة غير مقفلة</th><th className="num">الإجمالي</th></tr></thead>
            <tbody>
              <tr className="fin-sub"><td>الرصيد في {d.prior.to}</td>{["capital", "retained", "other", "result", "total"].map((k) => <td key={k} className="num"><Num v={E.opening[k]} /></td>)}</tr>
              {E.rows.map((r: any, i: number) => <tr key={i} className={r.kind === "net" ? "fin-net" : ""}><td>{r.label}</td>{["capital", "retained", "other", "result", "total"].map((k) => <td key={k} className="num">{r[k] ? <Num v={r[k]} /> : <span className="muted">—</span>}</td>)}</tr>)}
              <tr className="fin-total"><td>الرصيد في {d.fiscalYear.to}</td>{["capital", "retained", "other", "result", "total"].map((k) => <td key={k} className="num"><Num v={E.closing[k]} /></td>)}</tr>
            </tbody></table>
          <div className="small muted mt">الرصيد الختامي يطابق إجمالي {L.equity} في المركز المالي ({money(T.equity[0])})، والافتتاحي يطابق رصيد نهاية السنة السابقة ({money(T.equity[1])}).</div>
        </div></div>}
        {show("cf") && <div className="grid c2 mt">
          <div className="card fin-card"><div className="card-h"><h3>{L.cf} — الطريقة غير المباشرة</h3></div><div className="card-b table-wrap">
            <table className="tbl fin-stmt"><tbody>
              <tr className="fin-sec"><td colSpan={2}><b>الأنشطة التشغيلية</b></td></tr>
              <tr><td>{L.net}</td><td className="num"><Num v={cfI.netIncome} /></td></tr>
              {cfI.adjustments.map((x: any) => <tr key={x.name}><td style={{ paddingInlineStart: 22 }}>يُضاف: {x.name}</td><td className="num"><Num v={x.amount} /></td></tr>)}
              {cfI.workingCapital.map((x: any) => <tr key={x.name}><td style={{ paddingInlineStart: 22 }}>{x.name}</td><td className="num"><Num v={x.amount} /></td></tr>)}
              <tr className="fin-sub"><td>صافي النقد من الأنشطة التشغيلية</td><td className="num"><Num v={cfI.totals.operating} /></td></tr>
              <tr className="fin-sec"><td colSpan={2}><b>الأنشطة الاستثمارية</b></td></tr>
              {cfI.investing.map((x: any) => <tr key={x.code}><td style={{ paddingInlineStart: 22 }}>{x.name}</td><td className="num"><Num v={x.amount} /></td></tr>)}
              <tr className="fin-sub"><td>صافي النقد من الأنشطة الاستثمارية</td><td className="num"><Num v={cfI.totals.investing} /></td></tr>
              <tr className="fin-sec"><td colSpan={2}><b>الأنشطة التمويلية</b></td></tr>
              {cfI.financing.map((x: any) => <tr key={x.code}><td style={{ paddingInlineStart: 22 }}>{x.name}</td><td className="num"><Num v={x.amount} /></td></tr>)}
              <tr className="fin-sub"><td>صافي النقد من الأنشطة التمويلية</td><td className="num"><Num v={cfI.totals.financing} /></td></tr>
              <tr className="fin-sub"><td>صافي التغير في النقدية</td><td className="num"><Num v={cfI.net} /></td></tr>
              <tr><td>النقدية أول السنة</td><td className="num"><Num v={cfD.opening} /></td></tr>
              <tr className="fin-total"><td>النقدية آخر السنة</td><td className="num"><Num v={cfD.opening + cfI.net} /></td></tr>
            </tbody></table></div></div>
          <div className="card fin-card"><div className="card-h"><h3>{L.cf} — الطريقة المباشرة</h3></div><div className="card-b table-wrap">
            <table className="tbl fin-stmt"><tbody>
              {(["operating", "investing", "financing"] as const).map((k) => <React.Fragment key={k}>
                <tr className="fin-sec"><td colSpan={2}><b>{{ operating: "الأنشطة التشغيلية", investing: "الأنشطة الاستثمارية", financing: "الأنشطة التمويلية" }[k]}</b></td></tr>
                {cfD[k].map((x: any, i: number) => <tr key={i}><td style={{ paddingInlineStart: 22 }}>{x.amount >= 0 ? "مقبوضات" : "مدفوعات"}: {x.name}</td><td className="num"><Num v={x.amount} /></td></tr>)}
                <tr className="fin-sub"><td>الصافي</td><td className="num"><Num v={cfD.totals[k]} /></td></tr>
              </React.Fragment>)}
              <tr className="fin-sub"><td>صافي التغير في النقدية</td><td className="num"><Num v={cfD.net} /></td></tr>
              <tr><td>النقدية أول السنة</td><td className="num"><Num v={cfD.opening} /></td></tr>
              <tr className="fin-total"><td>النقدية آخر السنة</td><td className="num"><Num v={cfD.closing} /></td></tr>
            </tbody></table>
            <div className="small muted mt">قد يختلف التوزيع بين الأنشطة في الطريقتين (مثل شراء أصل على الحساب ثم سداده)، لكن صافي التغير في النقدية يجب أن يتطابق.</div>
          </div></div>
        </div>}
        {show("chk") && <div className="card mt fin-card"><div className="card-h"><h3>ترابط القوائم المالية مع بعضها ومع الأستاذ العام</h3><span className={d.ok ? "badge green" : "badge red"}>{passed}/{d.checks.length}</span></div><div className="card-b table-wrap">
          <table className="tbl"><thead><tr><th style={{ width: 30 }} /><th>الفحص</th><th className="num">القيمة الأولى</th><th className="num">القيمة المقابلة</th></tr></thead>
            <tbody>{d.checks.map((c: any) => <tr key={c.key} className={c.ok ? "" : "row-danger"}><td>{c.ok ? "✅" : "❌"}</td><td>{c.name}{c.note && <div className="small muted">{c.note}</div>}</td><td className="num">{typeof c.a === "number" ? money(c.a) : c.a ?? "—"}</td><td className="num">{typeof c.b === "number" ? money(c.b) : c.b ?? "—"}</td></tr>)}</tbody></table>
        </div></div>}
      </div>
    </div>
  );
}

const LV: Record<string, { ic: string; c: string; t: string }> = { ok: { ic: "✅", c: "", t: "جاهز" }, warn: { ic: "⚠️", c: "row-warn", t: "تنبيه" }, block: { ic: "⛔", c: "row-danger", t: "مانع" } };

/** Year-end closing checklist + closing-entry preview; closes the year when nothing blocks it. */
export function CloseYearModal({ year, onClose }: { year: any; onClose: (done?: boolean) => void }) {
  const { data: d, loading } = useFetch<any>(`/fiscal-years/${year.id}/close-check`);
  const { run, busy } = useAction();
  const toast = useToast();
  const doClose = () => run(async () => {
    const w = d.summary.warn;
    if (!confirmDlg(`إقفال السنة ${year.name}؟\nسيُنشأ قيد إقفال يرحّل ${d.preview.netIncome >= 0 ? "صافي الربح" : "صافي الخسارة"} ${money(Math.abs(d.preview.netIncome))} إلى الأرباح المبقاة، وتُقفل كل فترات السنة.${w ? `\nيوجد ${w} تنبيه لم يُعالج.` : ""}`)) return;
    const r = await api(`/fiscal-years/${year.id}/close`, { body: {} });
    toast(`تم إقفال ${year.name} — صافي النتيجة ${money(r.netIncome)}، وفُتحت السنة ${r.nextYear?.name || ""}`, "ok");
    onClose(true);
  });
  return (
    <Modal wide title={`إقفال السنة المالية ${year.name} — قائمة التحقق`} onClose={() => onClose()} footer={<>
      <Link className="btn" to={`/final-accounts?fy=${year.id}`} onClick={() => onClose()}>📚 الحسابات الختامية</Link><div className="grow" />
      <button className="btn" onClick={() => onClose()}>إلغاء</button>
      <button className="btn danger" disabled={busy || !d?.canClose} onClick={doClose}>🔒 إقفال السنة</button></>}>
      {loading || !d ? <Loading /> : <>
        <div className={"alert " + (d.summary.block ? "err" : d.summary.warn ? "warn" : "ok")}>
          {d.summary.block ? `يوجد ${d.summary.block} مانع يجب معالجته قبل الإقفال.` : d.summary.warn ? `لا موانع للإقفال، لكن يوجد ${d.summary.warn} تنبيه يُستحسن معالجته (قد يغيّر صافي الربح).` : "كل البنود جاهزة — يمكن إقفال السنة."}
        </div>
        <table className="tbl mt"><thead><tr><th style={{ width: 30 }} /><th>البند</th><th>التفاصيل</th><th /></tr></thead>
          <tbody>{d.items.map((i: any) => <tr key={i.key} className={LV[i.level].c}><td title={LV[i.level].t}>{LV[i.level].ic}</td><td><b>{i.label}</b></td><td className="small">{i.detail || <span className="muted">—</span>}</td><td>{i.level !== "ok" && i.to && <Link className="btn sm ghost" to={i.to} onClick={() => onClose()}>معالجة</Link>}</td></tr>)}</tbody></table>
        <h4 className="mt">معاينة قيد الإقفال ({d.preview.lines.length} سطر)</h4>
        {d.preview.lines.length ? <div className="table-wrap" style={{ maxHeight: 300, overflow: "auto" }}><table className="tbl compact"><thead><tr><th>الحساب</th><th className="num">مدين</th><th className="num">دائن</th></tr></thead>
          <tbody>{d.preview.lines.map((l: any, i: number) => <tr key={i} className={i === d.preview.lines.length - 1 ? "fin-total" : ""}><td><span className="muted small" dir="ltr">{l.code}</span> {l.name}</td><td className="num">{l.debit ? money(l.debit) : ""}</td><td className="num">{l.credit ? money(l.credit) : ""}</td></tr>)}
            <tr className="fin-sub"><td>الإجمالي</td><td className="num">{money(d.preview.debit)}</td><td className="num">{money(d.preview.credit)}</td></tr></tbody></table></div>
          : <div className="muted small">لا توجد أرصدة إيرادات أو مصروفات في السنة.</div>}
        <div className="small muted mt">صافي {d.preview.netIncome >= 0 ? "الربح" : "الخسارة"} المرحّل إلى الأرباح المبقاة: <b>{money(Math.abs(d.preview.netIncome))}</b>. يمكن إعادة فتح السنة لاحقاً (ما لم تُقفل سنة بعدها) فيُحذف قيد الإقفال.</div>
      </>}
    </Modal>
  );
}
