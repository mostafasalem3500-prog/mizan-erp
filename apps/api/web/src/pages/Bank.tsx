import React, { useEffect, useMemo, useState } from "react";
import { api, q, useFetch, Money, money, Loading, Empty, Field, Input, NumInput, Select, useAction, useToast, useCompanyContext, ExportBtn, PrintBtn, today, fmtDate, JTYPE_AR, confirmDlg, SearchBox, FilterInfo, matches } from "../lib";
import { AccountLedger } from "./Statements";
import { BankStatementPanel } from "./Pricing";

export function BankPage() {
  const { can } = useCompanyContext();
  const accounts = useFetch("/accounts");
  const banks = useMemo(() => (accounts.data?.rows || []).filter((a: any) => a.isCashBank && !a.isGroup && a.isActive), [accounts.data]);
  const [accId, setAccId] = useState("");
  const [to, setTo] = useState(today());
  const [stmt, setStmt] = useState("");
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const { run, busy } = useAction();
  const toast = useToast();
  useEffect(() => { if (!accId && banks.length) setAccId(banks[0].id); }, [banks]);
  const { data, loading, reload } = useFetch(accId ? `/bank/${accId}/lines${q({ to })}` : null);
  useEffect(() => setSel({}), [data]);
  const [text, setText] = useState("");
  const [cl, setCl] = useState("");
  const [dir, setDir] = useState("");
  const [ledger, setLedger] = useState(false);
  const rows = (data?.rows || []).filter((r: any) => matches(r, text, ["number", "memo", "description", "reference", (x) => JTYPE_AR[x.type], (x) => String(Number(x.debit) || Number(x.credit))]) && (!cl || (cl === "open" ? !r.clearedDate : !!r.clearedDate)) && (!dir || (dir === "in" ? Number(r.debit) > 0 : Number(r.credit) > 0)));
  const selectedIds = Object.keys(sel).filter((k) => sel[k]);
  const stmtN = Number(stmt || 0);
  const projected = data ? data.clearedBalance + (data.rows.filter((r: any) => sel[r.id] && !r.clearedDate).reduce((a: number, r: any) => a + Number(r.debit) - Number(r.credit), 0)) : 0;
  const mark = (cleared: boolean) => run(async () => { await api(`/bank/${accId}/clear`, { body: { lineIds: selectedIds, cleared, date: to } }); reload(); }, cleared ? "تم تأشير الحركات كمطابقة لكشف البنك" : "تم إلغاء التأشير");
  return (
    <div className="grid">
      <div className="card"><div className="card-b">
        <div className="form-grid">
          <Field label="حساب البنك / الصندوق"><Select value={accId} onChange={(e) => setAccId(e.target.value)}>{banks.map((b: any) => <option key={b.id} value={b.id}>{b.code} {b.nameAr}</option>)}</Select></Field>
          <Field label="حتى تاريخ كشف الحساب"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="الرصيد حسب كشف البنك"><NumInput value={stmt} onChange={(e) => setStmt(e.target.value)} placeholder="0.00" /></Field>
        </div>
        {data && (
          <div className="grid c4 mt">
            <div className="card kpi"><div className="label">رصيد الدفاتر</div><div className="value"><Money v={data.bookBalance} /></div></div>
            <div className="card kpi success"><div className="label">الحركات المطابقة (المؤشّرة)</div><div className="value"><Money v={projected} /></div><div className="sub">{selectedIds.length ? `شامل ${selectedIds.length} حركة محددة` : ""}</div></div>
            <div className="card kpi accent"><div className="label">حركات لم تظهر في البنك بعد</div><div className="value"><Money v={data.bookBalance - projected} /></div><div className="sub">شيكات لم تُصرف / إيداعات بالطريق</div></div>
            <div className={"card kpi " + (stmt !== "" && Math.abs(stmtN - projected) < 0.005 ? "success" : "danger")}><div className="label">الفرق مع كشف البنك</div><div className="value"><Money v={stmt === "" ? 0 : stmtN - projected} /></div><div className="sub">{stmt === "" ? "أدخل رصيد الكشف" : Math.abs(stmtN - projected) < 0.005 ? "مطابق ✓" : "راجع الحركات غير المؤشّرة أو رسوماً بنكية غير مسجلة"}</div></div>
          </div>
        )}
      </div></div>
      <BankStatementPanel accountId={accId} onChanged={reload} />
      <div className="card">
        <div className="card-h"><h3>حركات الحساب</h3><div className="row">
          {can("accounting.write") && <><button className="btn sm" disabled={!selectedIds.length || busy} onClick={() => mark(true)}>✓ تأشير المحدد كمطابق</button><button className="btn sm ghost" disabled={!selectedIds.length || busy} onClick={() => mark(false)}>إلغاء التأشير</button>
            <button className="btn primary sm" disabled={busy || stmt === "" || !data} onClick={() => run(async () => { if (!confirmDlg(`اعتماد التسوية بتاريخ ${to} برصيد كشف ${money(stmtN)}؟`)) return; await api(`/bank/${accId}/reconcile`, { body: { date: to, statementBalance: stmtN } }); reload(); }, "تم اعتماد التسوية البنكية")}>اعتماد التسوية</button></>}
          {accId && <button className="btn sm" onClick={() => setLedger(true)}>📄 كشف الحساب</button>}<PrintBtn />{data && <ExportBtn name="التسوية البنكية" rows={() => data.rows.map((r: any) => ({ التاريخ: r.date, القيد: r.number, النوع: JTYPE_AR[r.type], البيان: r.description || r.memo, المرجع: r.reference, مدين: r.debit, دائن: r.credit, مطابق: r.clearedDate ? "نعم" : "" }))} />}
        </div></div>
        {data && data.rows.length > 0 && <div className="card-b no-print" style={{ paddingBottom: 0 }}><div className="toolbar"><SearchBox value={text} onChange={setText} placeholder="بحث بالقيد / البيان / المرجع / المبلغ" /><Select value={cl} onChange={(e) => setCl(e.target.value)}><option value="">المطابق والمعلّق</option><option value="open">المعلّق فقط</option><option value="done">المطابق فقط</option></Select><Select value={dir} onChange={(e) => setDir(e.target.value)}><option value="">إيداع وسحب</option><option value="in">الإيداعات</option><option value="out">السحوبات</option></Select><FilterInfo shown={rows.length} total={data.rows.length} active={!!(text || cl || dir)} onClear={() => { setText(""); setCl(""); setDir(""); }} /></div></div>}
        {loading || !data ? <Loading /> : !rows.length ? <Empty text={data.rows.length ? "لا نتائج مطابقة" : undefined} /> : (
          <div className="table-wrap"><table className="tbl compact"><thead><tr><th><input type="checkbox" onChange={(e) => { const all: Record<string, boolean> = {}; if (e.target.checked) rows.forEach((r: any) => { if (!r.clearedDate) all[r.id] = true; }); setSel(all); }} /></th><th>التاريخ</th><th>القيد</th><th>النوع</th><th>البيان</th><th>المرجع</th><th className="n">إيداع</th><th className="n">سحب</th><th>مطابق</th></tr></thead>
            <tbody>{rows.map((r: any) => <tr key={r.id} className={r.clearedDate ? "" : "bold"} style={r.clearedDate ? { opacity: 0.65 } : {}}>
              <td><input type="checkbox" checked={!!sel[r.id]} onChange={(e) => setSel({ ...sel, [r.id]: e.target.checked })} /></td>
              <td className="dt">{fmtDate(r.date)}</td><td>{r.number}</td><td className="small">{JTYPE_AR[r.type]}</td><td>{r.description || r.memo}</td><td className="num">{r.reference}</td>
              <td className="n"><Money v={r.debit} blankZero /></td><td className="n"><Money v={r.credit} blankZero /></td><td>{r.clearedDate ? <span className="badge green">{fmtDate(r.clearedDate)}</span> : <span className="badge amber">معلّق</span>}</td>
            </tr>)}</tbody></table></div>
        )}
      </div>
      {ledger && banks.find((b: any) => b.id === accId) && <AccountLedger account={banks.find((b: any) => b.id === accId)} onClose={() => setLedger(false)} />}
      {data?.history?.length > 0 && <div className="card"><div className="card-h"><h3>تسويات معتمدة سابقاً</h3></div><div className="table-wrap"><table className="tbl compact"><thead><tr><th>تاريخ الكشف</th><th className="n">رصيد الكشف</th><th className="n">الرصيد المطابق</th><th className="n">الفرق</th><th>بواسطة</th></tr></thead><tbody>{data.history.map((h: any) => <tr key={h.id}><td className="dt">{fmtDate(h.statementDate)}</td><td className="n"><Money v={h.statementBalance} /></td><td className="n"><Money v={h.clearedBalance} /></td><td className={"n " + (Number(h.difference) ? "neg-val" : "pos-val")}><Money v={h.difference} /></td><td>{h.createdBy}</td></tr>)}</tbody></table></div></div>}
    </div>
  );
}
