/** Allowance for doubtful debts: a provision matrix over the ageing of customer balances. */
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, q, useFetch, useAction, Money, Loading, Empty, Field, Input, NumInput, today, fmtDate, fmtDT, confirmDlg } from "../lib";

export function EclPage() {
  const [asOf, setAsOf] = useState(today());
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [d, setD] = useState<any>(null);
  const runs = useFetch<any[]>("/ecl/runs");
  const { run, busy } = useAction();
  const seq = useRef(0); // typing fires one request per key: only the latest answer is shown
  const load = (r = rates) => { const n = ++seq.current; return api(`/ecl${q({ asOf, rates: r ? JSON.stringify(r) : undefined })}`).then((x) => { if (n !== seq.current) return; setD(x); if (!r) setRates(x.rates); }).catch(() => undefined); };
  useEffect(() => { load(); }, [asOf]);
  const setRate = (b: string, v: string) => { const r = { ...(rates || {}), [b]: Number(v) }; setRates(r); load(r); };
  return (
    <div className="grid" data-ecl>
      <div className="card">
        <div className="card-h"><div><h3>مخصص الديون المشكوك في تحصيلها</h3>
          <div className="small muted">الخسائر الائتمانية المتوقعة بمصفوفة الأعمار: رصيد كل شريحة من أعمار ديون العملاء × نسبة خسارة متوقعة. يُعدَّل المخصص إلى المبلغ المطلوب بقيد تسوية واحد.</div></div>
          <Field label="كما في"><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={{ width: 170 }} /></Field></div>
        <div className="card-b">
          {!d ? <Loading /> : <>
            <div className="table-wrap"><table className="tbl" data-matrix>
              <thead><tr><th>عمر الدين</th><th className="n">الرصيد</th><th className="n" style={{ width: 130 }}>نسبة الخسارة %</th><th className="n">المخصص المطلوب</th></tr></thead>
              <tbody>{d.bands.map((b: any) => <tr key={b.band}><td>{b.label}</td><td className="n"><Money v={b.balance} /></td>
                <td className="n"><NumInput value={rates?.[b.band] ?? b.rate} onChange={(e) => setRate(b.band, e.target.value)} aria-label={`نسبة ${b.label}`} style={{ width: 90 }} /></td><td className="n"><Money v={b.provision} /></td></tr>)}</tbody>
              <tfoot><tr><th>الإجمالي</th><th className="n"><Money v={d.receivables} /></th><th className="n">{d.coverage}%</th><th className="n"><Money v={d.required} /></th></tr></tfoot>
            </table></div>
            <div className="grid c3 mt">
              <div className="card kpi"><div className="label">المخصص المطلوب</div><div className="value"><Money v={d.required} /></div></div>
              <div className="card kpi"><div className="label">رصيد المخصص في الدفاتر</div><div className="value"><Money v={d.existing} /></div><div className="sub">كما في {fmtDate(d.asOf)}</div></div>
              <div className={"card kpi " + (d.adjustment > 0 ? "accent" : d.adjustment < 0 ? "success" : "")}><div className="label">{d.adjustment > 0 ? "زيادة المخصص" : d.adjustment < 0 ? "تخفيض المخصص" : "لا فرق"}</div><div className="value"><Money v={Math.abs(d.adjustment)} /></div></div>
            </div>
            {d.lines.length > 0 ? <div className="mt" data-ecl-entry>
              <div className="small muted mb">قيد التسوية الذي سيُسجَّل بتاريخ {fmtDate(d.asOf)}:</div>
              <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الحساب</th><th className="n">مدين</th><th className="n">دائن</th></tr></thead>
                <tbody>{d.lines.map((l: any, i: number) => <tr key={i}><td>{l.code} {l.nameAr}</td><td className="n">{l.debit ? <Money v={l.debit} /> : ""}</td><td className="n">{l.credit ? <Money v={l.credit} /> : ""}</td></tr>)}</tbody></table></div>
              <button className="btn primary mt" disabled={busy} data-ecl-post onClick={() => confirmDlg("ترحيل قيد تسوية المخصص؟") && run(async () => { await api("/ecl/post", { body: { asOf, rates } }); runs.reload(); await load(); }, "رُحّل قيد المخصص")}>ترحيل قيد التسوية</button>
            </div> : <div className="alert info small mt">المخصص في الدفاتر يساوي المطلوب — لا يلزم قيد.{d.receivables === 0 ? " لا توجد ذمم عملاء مفتوحة في هذا التاريخ." : ""}</div>}
            <div className="small muted mt">النسب تقدير من الإدارة بحسب تجربة التحصيل؛ تُحفظ مع كل ترحيل وتصبح النسب الافتراضية للمرة القادمة. الدين الذي ثبت تعذّر تحصيله يُعدَم بإشعار دائن أو قيد على المخصص.</div>
          </>}
        </div>
      </div>
      {d?.customers?.length > 0 && <div className="card"><div className="card-h"><h3>أكبر العملاء في المخصص</h3></div><div className="card-b">
        <div className="table-wrap"><table className="tbl compact"><thead><tr><th>العميل</th><th className="n">الرصيد المفتوح</th><th className="n">نصيبه من المخصص</th></tr></thead>
          <tbody>{d.customers.slice(0, 15).map((c: any, i: number) => <tr key={i}><td>{c.name}</td><td className="n"><Money v={c.total} /></td><td className="n"><Money v={c.provision} /></td></tr>)}</tbody></table></div></div></div>}
      <div className="card"><div className="card-h"><h3>التقديرات السابقة</h3></div><div className="card-b">
        {!runs.data ? <Loading /> : !runs.data.length ? <Empty text="لم يُرحَّل أي تقدير بعد" /> : <div className="table-wrap"><table className="tbl compact" data-ecl-runs>
          <thead><tr><th>كما في</th><th className="n">الذمم</th><th className="n">المطلوب</th><th className="n">كان في الدفاتر</th><th className="n">التسوية</th><th>القيد</th><th>بواسطة</th></tr></thead>
          <tbody>{runs.data.map((r: any) => <tr key={r.id}><td className="dt">{fmtDate(r.asOf)}</td><td className="n"><Money v={r.receivables} /></td><td className="n"><Money v={r.required} /></td><td className="n"><Money v={r.existing} /></td><td className="n"><Money v={r.adjustment} /></td>
            <td>{r.entryId ? <><Link to={`/journals/${r.entryId}`} className="num">{r.entryNumber}</Link>{r.reversedBy && <span className="badge"> معكوس</span>}</> : "—"}</td><td className="small">{r.createdBy}<div className="muted">{fmtDT(r.createdAt)}</div></td></tr>)}</tbody></table></div>}
      </div></div>
    </div>
  );
}
