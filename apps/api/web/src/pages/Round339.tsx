/** 3.39.0 screens: payroll remittances (both editions); Egypt — solidarity contribution, legal reserve, simplified regime, salary-tax report. */
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api, q, useFetch, Money, money, Loading, Empty, Select, useAction, useToast, useCompanyContext, fmtDate, useBase, ExportBtn, confirmDlg } from "../lib";
import { PayModal } from "./Round23";
import { CFG } from "../shared/country";

const years = () => Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i));
const pct = (r: number) => `${(r * 100).toFixed(2).replace(/\.?0+$/, "")}%`;

export function RemittancesPage() {
  const { can } = useCompanyContext();
  const base = useBase();
  const [year, setYear] = useState("");
  const { data, loading, reload } = useFetch<any>(`/payroll/remittances${q({ year })}`, [year]);
  const [pay, setPay] = useState<any>(null);
  const { run, busy } = useAction();
  const toast = useToast();
  if (loading && !data) return <Loading />;
  if (!data) return <Empty />;
  const EG = CFG.country === "EG";
  const open = data.rows.flatMap((r: any) => r.items.filter((i: any) => i.outstanding > 0));
  const late = open.filter((i: any) => i.late);
  return (
    <div className="grid">
      <div className="grid c3">
        <div className="card kpi"><div className="label">لم يُورَّد بعد</div><div className="value num">{money(open.reduce((a: number, i: any) => a + i.outstanding, 0))}</div><div className="small muted">{open.length} توريد</div></div>
        <div className="card kpi"><div className="label">متأخر عن موعده</div><div className={"value num " + (late.length ? "neg-val" : "")}>{money(late.reduce((a: number, i: any) => a + i.outstanding, 0))}</div><div className="small muted">{late.length ? `${late.length} توريد متأخر` : "لا يوجد متأخر"}</div></div>
        <div className="card kpi"><div className="label">الرصيد الدائن في الأستاذ</div><div className="value num">{money(Object.values(data.balances).reduce((a: number, v: any) => a + Number(v), 0))}</div><div className="small muted">{Object.entries(data.balances).map(([k, v]: any) => `${data.kinds[k]}: ${money(v)}`).join(" · ")}</div></div>
      </div>
      <div className="card"><div className="card-h"><div><h3>توريد استقطاعات الرواتب</h3><div className="small muted">{EG ? "التأمينات الاجتماعية (حصة العامل وصاحب العمل) تُورَّد للهيئة القومية للتأمين الاجتماعي، وضريبة كسب العمل وصندوق الشهداء لمصلحة الضرائب — كلاهما حتى يوم 15 من الشهر التالي" : "اشتراكات التأمينات الاجتماعية (حصة الموظف والمنشأة) تُسدَّد حتى يوم 15 من الشهر التالي"}</div></div>
        <div className="row"><Select value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 150 }}><option value="">آخر 24 شهراً</option>{years().map((y) => <option key={y}>{y}</option>)}</Select>
          <ExportBtn name="توريد استقطاعات الرواتب" rows={() => data.rows.flatMap((r: any) => r.items.map((i: any) => ({ الشهر: r.period, النوع: i.kindAr, المستحق: i.accrued, المورَّد: i.paid, المتبقي: i.outstanding, "موعد التوريد": i.due })))} /></div></div>
        {!data.rows.length ? <Empty text="لا توجد مسيرات رواتب مرحّلة في هذه المدة" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>شهر المسير</th><th>النوع</th><th className="n">المستحق</th><th className="n">المورَّد</th><th className="n">المتبقي</th><th>موعد التوريد</th><th /></tr></thead>
          <tbody>{data.rows.flatMap((r: any) => r.items.map((i: any) => <tr key={r.period + i.kind}><td><b>{r.period}</b></td><td>{i.kindAr}{i.kind === "SALARY_TAX" && <div className="small muted">ضريبة {money(i.parts.salaryTax)} + شهداء {money(i.parts.martyrs)}</div>}</td><td className="n"><Money v={i.accrued} /></td><td className="n"><Money v={i.paid} /></td><td className="n"><b><Money v={i.outstanding} /></b></td>
            <td>{fmtDate(i.due)} {i.outstanding > 0 ? (i.late ? <span className="badge red">متأخر {-i.days} يوم</span> : i.days <= 7 ? <span className="badge amber">خلال {i.days} يوم</span> : null) : <span className="badge green">مورَّد</span>}</td>
            <td>{can("accounting.write") && i.outstanding > 0 && <button className="btn sm primary" onClick={() => setPay({ ...i, period: r.period })}>توريد</button>}</td></tr>))}</tbody></table></div>}
      </div>
      {data.remittances.length > 0 && <div className="card"><div className="card-h"><h3>سجل التوريدات</h3></div><div className="table-wrap"><table className="tbl compact"><thead><tr><th>الرقم</th><th>التاريخ</th><th>النوع</th><th>الشهر</th><th className="n">المبلغ</th><th>من حساب</th><th>القيد</th><th /></tr></thead>
        <tbody>{data.remittances.map((r: any) => <tr key={r.id}><td>{r.number}</td><td className="dt">{fmtDate(r.date)}</td><td>{data.kinds[r.kind]}</td><td>{r.period}</td><td className="n"><Money v={r.amount} /></td><td>{r.accountName}</td><td>{r.journalId && <Link to={`${base}/journals/${r.journalId}`}>{r.journalNumber}</Link>}</td>
          <td>{can("accounting.write") && <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { if (!confirmDlg(`إلغاء التوريد ${r.number}؟ سيُعكس قيده.`)) return; await api(`/payroll/remittances/${r.id}/cancel`, { body: {} }); toast("تم إلغاء التوريد", "ok"); reload(); })}>إلغاء</button>}</td></tr>)}</tbody></table></div></div>}
      {pay && <PayModal title={`توريد ${pay.kindAr} عن شهر ${pay.period}`} max={pay.outstanding} onSubmit={(b) => api("/payroll/remittances", { body: { kind: pay.kind, period: pay.period, accountId: b.accountId, date: b.date, reference: b.reference } })} onClose={(sv) => { setPay(null); if (sv) reload(); }} />}
    </div>
  );
}

export function EgCompliancePage() {
  const { can, company } = useCompanyContext();
  const base = useBase();
  const [year, setYear] = useState(String(new Date().getFullYear() - 1));
  const rules = useFetch<any>("/tax/eg/rules", []);
  const sol = useFetch<any>(`/tax/solidarity${q({ year })}`, [year]);
  const lr = useFetch<any>(`/tax/legal-reserve${q({ year })}`, [year]);
  const it = useFetch<any>(`/tax/income-tax${q({ year })}`, [year]);
  const [pay, setPay] = useState(false);
  const { run, busy } = useAction();
  const toast = useToast();
  // an establishment that started this year has nothing in last year: open on the current one
  const moved = React.useRef(false);
  React.useEffect(() => { if (!moved.current && sol.data && sol.data.year === year && year !== String(new Date().getFullYear()) && !sol.data.revenue && !sol.data.posted) { moved.current = true; setYear(String(new Date().getFullYear())); } else if (sol.data) moved.current = true; }, [sol.data]);
  if (!rules.data || !sol.data || !lr.data || !it.data) return <Loading />;
  const R = rules.data, S = sol.data, L = lr.data, sim = it.data.simplified;
  const W = can("accounting.write");
  const lim = R.insurance;
  return (
    <div className="grid">
      <div className="card"><div className="card-h"><div><h3>🇪🇬 الالتزامات السنوية للمنشأة المصرية</h3><div className="small muted">ما يُحتسب مرة في السنة مع إقرار ضريبة الدخل. الأرقام من دفاترك، والنسب من القانون كما هو مسجّل في البرنامج — راجعها مع محاسبك القانوني قبل السداد.</div></div>
        <Select value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 110 }}>{years().map((y) => <option key={y}>{y}</option>)}</Select></div></div>

      <div className="card"><div className="card-h"><div><h3>النظام الضريبي المبسط للمشروعات الصغيرة (القانون 6 لسنة 2025)</h3><div className="small muted">للمشروعات التي لا يتجاوز حجم أعمالها السنوي 20 مليون جنيه، بطلب يُقدَّم لمصلحة الضرائب. الضريبة نسبة من حجم الأعمال بدل 22.5% من الربح، وإقرار القيمة المضافة كل ثلاثة أشهر.</div></div>
        <span className={"badge " + (sim.enabled ? "green" : "gray")}>{sim.enabled ? "مفعَّل لهذه المنشأة" : "غير مفعَّل"}</span></div>
        <div className="card-b">
          <div className="mini-kpis mb">
            <div><span>حجم الأعمال في {year}</span><b><Money v={sim.turnover} /></b></div>
            <div><span>النسبة المنطبقة</span><b>{sim.eligible ? pct(sim.rate) : "—"}</b></div>
            <div><span>الضريبة بالنظام المبسط</span><b>{sim.eligible ? <Money v={sim.tax} /> : "غير مؤهل"}</b></div>
            <div><span>الضريبة بالنظام العام (22.5% من الربح)</span><b><Money v={Math.max(0, it.data.profitBeforeTax) * it.data.rate} /></b></div>
          </div>
          <div className="table-wrap"><table className="tbl compact"><thead><tr><th>حجم الأعمال السنوي</th><th className="n">الضريبة من حجم الأعمال</th></tr></thead>
            <tbody>{R.simplified.brackets.map(([limit, rate]: [number, number], i: number) => <tr key={i} className={sim.eligible && sim.rate === rate ? "hl" : ""}><td>{i === 0 ? `أقل من ${money(limit)}` : `من ${money(R.simplified.brackets[i - 1][0])} إلى ${i === R.simplified.brackets.length - 1 ? "" : "أقل من "}${money(limit)}`}</td><td className="n">{pct(rate)}</td></tr>)}</tbody></table></div>
          <div className="small muted mt">{sim.enabled ? "شاشة «ضريبة الدخل» تحتسب الضريبة من حجم الأعمال." : "للتفعيل بعد قبول طلبك لدى المصلحة: "}<Link to={`${base}/settings`}>الإعدادات ← النظام الضريبي</Link>{!sim.eligible && " — حجم أعمال هذه السنة تجاوز الحد، فلا ينطبق النظام المبسط عليها."}</div>
        </div>
      </div>

      <div className="grid c2">
        <div className="card"><div className="card-h"><div><h3>المساهمة التكافلية (التأمين الصحي الشامل)</h3><div className="small muted">2.5 في الألف من إجمالي إيرادات السنة — تُسدَّد لمصلحة الضرائب مع إقرار ضريبة الدخل</div></div></div>
          <div className="card-b">
            <div className="mini-kpis mb">
              <div><span>إجمالي الإيرادات</span><b><Money v={S.revenue} /></b><small className="muted">مبيعات {money(S.sales)} + إيرادات أخرى {money(S.otherIncome)}</small></div>
              <div><span>المساهمة</span><b className="neg-val"><Money v={S.posted ? S.posted.amount : S.amount} /></b></div>
              <div><span>موعد السداد</span><b>{fmtDate(S.dueDate)}</b></div>
            </div>
            {S.posted ? <div className="alert ok small">✓ مرحّلة بالقيد <Link to={`${base}/journals/${S.posted.id}`}>{S.posted.number}</Link> — المسدد {money(S.paid)} من {money(S.posted.amount)}{" "}
              {W && S.due > 0 && <button className="btn sm primary" onClick={() => setPay(true)}>سداد</button>}{" "}
              {W && !(S.paid > 0) && <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { if (!confirmDlg("إلغاء ترحيل المساهمة التكافلية؟")) return; await api("/tax/solidarity/cancel", { body: { year } }); toast("تم الإلغاء", "ok"); sol.reload(); })}>إلغاء</button>}</div>
              : W && <button className="btn primary" disabled={busy || !(S.amount > 0)} onClick={() => run(async () => { if (!confirmDlg(`ترحيل المساهمة التكافلية ${money(S.amount)} لسنة ${year}؟`)) return; await api("/tax/solidarity", { body: { year } }); toast("تم الترحيل", "ok"); sol.reload(); })}>ترحيل المساهمة</button>}
            <div className="small muted mt">القيد: من ح/ المساهمة التكافلية (مصروف) إلى ح/ المساهمة التكافلية المستحقة. قانون 2026 جعل تحصيلها لمصلحة الضرائب؛ معاملتها في الوعاء الضريبي (واجبة الخصم أم لا) راجعها مع محاسبك وأضفها في تسويات ضريبة الدخل إن لزم.</div>
          </div>
        </div>
        <div className="card"><div className="card-h"><div><h3>الاحتياطي القانوني</h3><div className="small muted">5% من صافي ربح السنة حتى يبلغ الاحتياطي نصف رأس المال (قانون الشركات 159 لسنة 1981)</div></div></div>
          <div className="card-b">
            <div className="mini-kpis mb">
              <div><span>صافي ربح {year}</span><b><Money v={L.netProfit} /></b></div>
              <div><span>رأس المال</span><b><Money v={L.capital} /></b><small className="muted">الحد: {money(L.cap)}</small></div>
              <div><span>الاحتياطي الحالي</span><b><Money v={L.reserve} /></b></div>
              <div><span>المطلوب تكوينه</span><b><Money v={L.posted ? L.posted.amount : L.amount} /></b></div>
            </div>
            {L.posted ? <div className="alert ok small">✓ مكوَّن بالقيد <Link to={`${base}/journals/${L.posted.id}`}>{L.posted.number}</Link>{" "}
              {W && <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { if (!confirmDlg("إلغاء تكوين الاحتياطي القانوني؟")) return; await api("/tax/legal-reserve/cancel", { body: { year } }); toast("تم الإلغاء", "ok"); lr.reload(); })}>إلغاء</button>}</div>
              : !(L.netProfit > 0) ? <div className="alert small">لا يُكوَّن احتياطي في سنة بلا ربح.</div>
              : !(L.amount > 0) ? <div className="alert ok small">الاحتياطي بلغ نصف رأس المال — لا يلزم تكوين جديد.</div>
              : W && <button className="btn primary" disabled={busy} onClick={() => run(async () => { if (!confirmDlg(`تكوين احتياطي قانوني ${money(L.amount)} من أرباح ${year}؟`)) return; await api("/tax/legal-reserve", { body: { year } }); toast("تم تكوين الاحتياطي", "ok"); lr.reload(); })}>تكوين الاحتياطي</button>}
            <div className="small muted mt">القيد: من ح/ الأرباح المبقاة إلى ح/ الاحتياطي القانوني.{!L.closed && " يُفضَّل تكوينه بعد إقفال السنة وترحيل ضريبة الدخل."} يخص شركات الأموال (المساهمة وذات المسؤولية المحدودة)؛ المنشأة الفردية غير ملزمة به.</div>
          </div>
        </div>
      </div>

      <div className="card"><div className="card-h"><div><h3>الأرقام السارية في البرنامج</h3><div className="small muted">تتغير بقرارات سنوية — إذا صدر قرار جديد فأخبر الدعم لتحديثها</div></div></div>
        <div className="table-wrap"><table className="tbl compact"><tbody>
          <tr><td>ضريبة القيمة المضافة — السعر العام</td><td className="n">{CFG.vatRate}%</td></tr>
          <tr><td>ضريبة الدخل على الأشخاص الاعتبارية</td><td className="n">{pct(it.data.rate)}</td></tr>
          <tr><td>الإعفاء الشخصي السنوي في ضريبة كسب العمل</td><td className="n">{money(R.exemption)}</td></tr>
          <tr><td>التأمينات الاجتماعية — العامل / صاحب العمل</td><td className="n">{pct(lim.employee)} / {pct(lim.employer)}</td></tr>
          {Object.entries(lim.byYear).map(([y, v]: any) => <tr key={y} className={Number(y) === lim.year ? "hl" : ""}><td>أجر الاشتراك التأميني {y} — الحد الأدنى / الأقصى</td><td className="n">{money(v.minWage)} / {money(v.maxWage)}</td></tr>)}
          <tr><td>المساهمة التكافلية</td><td className="n">{(R.solidarityRate * 1000).toFixed(1)} في الألف</td></tr>
        </tbody></table></div>
      </div>
      {pay && <PayModal title={`سداد المساهمة التكافلية ${year}`} max={S.due} onSubmit={(b) => api("/tax/solidarity/pay", { body: { year, accountId: b.accountId, date: b.date, reference: b.reference } })} onClose={(sv) => { setPay(false); if (sv) sol.reload(); }} />}
      <span hidden>{company?.id}</span>
    </div>
  );
}

export function SalaryTaxReportPage() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [quarter, setQuarter] = useState("");
  const { data, loading } = useFetch<any>(`/tax/salary-tax-report${q({ year, quarter })}`, [year, quarter]);
  if (loading && !data) return <Loading />;
  if (!data) return <Empty />;
  const annual = !data.quarter, T = data.totals;
  return (
    <div className="card"><div className="card-h"><div><h3>تقرير ضريبة المرتبات (كسب العمل)</h3><div className="small muted">{annual ? `التسوية السنوية: الضريبة المستحقة على دخل السنة الفعلي مقابل ما استقطعه المسير شهرياً — تُقدَّم حتى ${fmtDate(data.due)}` : `أرقام النموذج الربع سنوي (نموذج 4) لكل موظف — يُقدَّم حتى ${fmtDate(data.due)}`}</div></div>
      <div className="row"><Select value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 100 }}>{years().map((y) => <option key={y}>{y}</option>)}</Select>
        <Select value={quarter} onChange={(e) => setQuarter(e.target.value)} style={{ width: 170 }}><option value="">السنة كاملة (تسوية)</option>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>الربع {n}</option>)}</Select>
        <ExportBtn name={`ضريبة المرتبات ${year}${quarter ? " ر" + quarter : ""}`} rows={() => data.rows.map((r: any) => ({ الكود: r.code, الموظف: r.name, الأشهر: r.months, "إجمالي الأجر": r.gross, "حصة العامل في التأمينات": r.insurance, "خصومات وغياب": r.cuts, "الوعاء": r.taxable, "الضريبة المستقطعة": r.tax, "صندوق الشهداء": r.martyrs, ...(annual ? { "الضريبة المستحقة": r.taxDue, "الفرق": r.difference } : {}), الصافي: r.net }))} /></div></div>
      {!data.rows.length ? <Empty text="لا توجد مسيرات رواتب مرحّلة في هذه المدة" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الموظف</th><th className="n">الأشهر</th><th className="n">إجمالي الأجر</th><th className="n">التأمينات (العامل)</th><th className="n">الوعاء</th><th className="n">الضريبة المستقطعة</th><th className="n">صندوق الشهداء</th>{annual && <><th className="n">الضريبة المستحقة</th><th className="n">الفرق</th></>}</tr></thead>
        <tbody>{data.rows.map((r: any) => <tr key={r.employeeId}><td><b>{r.name}</b><div className="small muted">{r.code}</div></td><td className="n">{r.months}</td><td className="n"><Money v={r.gross} /></td><td className="n"><Money v={r.insurance} /></td><td className="n"><Money v={r.taxable} /></td><td className="n"><Money v={r.tax} /></td><td className="n"><Money v={r.martyrs} /></td>{annual && <><td className="n"><Money v={r.taxDue} /></td><td className={"n " + (Math.abs(r.difference) > 0.5 ? (r.difference > 0 ? "neg-val" : "pos-val") : "")}><Money v={r.difference} /></td></>}</tr>)}</tbody>
        <tfoot><tr><th>الإجمالي ({data.rows.length} موظف)</th><th /><th className="n"><Money v={T.gross} /></th><th className="n"><Money v={T.insurance} /></th><th className="n"><Money v={T.taxable} /></th><th className="n"><Money v={T.tax} /></th><th className="n"><Money v={T.martyrs} /></th>{annual && <><th className="n"><Money v={T.taxDue} /></th><th className="n"><Money v={T.difference} /></th></>}</tr></tfoot></table></div>}
      <div className="card-b small muted">{annual ? "فرق موجب = ضريبة لم تُستقطع وتُسدَّد مع التسوية؛ فرق سالب = استُقطع أكثر من المستحق ويُرد للموظف. " : ""}الأرقام من المسيرات المرحّلة فقط. تقديم النموذج نفسه يتم على منظومة مصلحة الضرائب.</div>
    </div>
  );
}
