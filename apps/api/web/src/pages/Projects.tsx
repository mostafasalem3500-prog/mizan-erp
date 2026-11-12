/** Cost centres and projects: the list with filters and totals, one centre in detail, and the editor. */
import React, { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CUR } from "../shared/country";
import { api, q, useFetch, useAction, useToast, useCompanyContext, Modal, Field, Input, Select, NumInput, Empty, Loading, Money, money, fmtDate, today, confirmDlg, DateRange, ExportBtn, PrintBtn, Picker, partnerFetcher, BarChart } from "../lib";

const KIND_AR: Record<string, string> = { CENTER: "مركز تكلفة", PROJECT: "مشروع" };
const ST_AR: Record<string, [string, string]> = { ACTIVE: ["نشط", "green"], ON_HOLD: ["متوقف", "amber"], DONE: ["منتهٍ", "gray"] };
const pct = (v: number | null) => (v === null || v === undefined ? "—" : `${v}%`);
const SRC: Record<string, string> = { SALES: "فاتورة مبيعات", POS: "نقطة بيع", PURCHASE: "فاتورة مشتريات", EXPENSE: "مصروف", MANUAL: "قيد يدوي", PAYROLL: "رواتب", SALES_RETURN: "مرتجع مبيعات", PURCHASE_RETURN: "مرتجع مشتريات", DEPRECIATION: "إهلاك", ALLOCATION: "توزيع تكاليف", PAYMENT: "سند" };
const docLink = (l: any) => (l.sourceType === "INVOICE" && l.sourceId ? `/doc/${l.sourceId}` : null);

export function ProjectsPage() {
  const { can } = useCompanyContext();
  const nav = useNavigate();
  const [f, setF] = useState<any>({ from: `${today().slice(0, 4)}-01-01`, to: today(), kind: "", status: "", q: "", parentId: "" });
  const { data, loading, reload } = useFetch<any>(`/projects${q(f)}`, [JSON.stringify(f)]);
  const [edit, setEdit] = useState<any>(null);
  const W = can("accounting.write");
  const t = data?.totals;
  const rowsX = () => (data?.rows || []).map((r: any) => ({ الرمز: r.code, الاسم: r.name, النوع: KIND_AR[r.kind], "يتبع": r.parentName || "", العميل: r.partnerName || "", الحالة: ST_AR[r.status]?.[0], "قيمة العقد": r.contractValue, الإيرادات: r.revenue, "تكلفة المبيعات": r.cogs, المصروفات: r.expenses, "إجمالي التكلفة": r.cost, الربح: r.profit, "الهامش %": r.margin ?? "", الموازنة: r.budget, "المستهلك من الموازنة %": r.budgetUsed ?? "", "مشتريات مخزون": r.stock }));
  return (
    <div className="grid print-doc stmt">
      <div className="card no-print"><div className="card-h"><div><h3>مراكز التكلفة والمشاريع</h3><div className="small muted">كل مركز أو مشروع بإيراداته وتكاليفه وربحه من القيود المرحّلة. المركز الأب يعرض إجمالي ما تحته.</div></div>
        <div className="row">{W && <><button className="btn primary sm" onClick={() => setEdit({ kind: "PROJECT", status: "ACTIVE" })}>＋ مشروع</button><button className="btn sm" onClick={() => setEdit({ kind: "CENTER", status: "ACTIVE" })}>＋ مركز تكلفة</button></>}<ExportBtn name={`المشاريع ومراكز التكلفة ${f.from} ${f.to}`} rows={rowsX} /><PrintBtn pdfName="المشاريع ومراكز التكلفة" /></div></div>
        <div className="card-b row" style={{ alignItems: "flex-end", gap: 10 }}>
          <DateRange from={f.from} to={f.to} onChange={(from, to) => setF({ ...f, from, to })} />
          <Field label="النوع"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} style={{ width: 150 }}><option value="">الكل</option><option value="PROJECT">المشاريع</option><option value="CENTER">مراكز التكلفة</option></Select></Field>
          <Field label="الحالة"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} style={{ width: 130 }}><option value="">الكل</option>{Object.entries(ST_AR).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</Select></Field>
          <Field label="مركز إجمالي"><Select value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })} style={{ width: 200 }}><option value="">كل المراكز</option>{(data?.options || []).filter((o: any) => (data?.options || []).some((x: any) => x.parentId === o.id)).map((o: any) => <option key={o.id} value={o.id}>{o.code} — {o.name}</option>)}</Select></Field>
          <Field label="بحث بالاسم أو الرمز أو العميل"><Input type="search" value={f.q} placeholder="اسم مشروع، رمز، عميل، مسؤول…" onChange={(e) => setF({ ...f, q: e.target.value })} style={{ width: 240 }} /></Field>
        </div></div>
      {loading && !data ? <Loading /> : !data ? <Empty /> : <>
        <div className="grid c4">
          <div className="card kpi"><div className="label">الإيرادات</div><div className="value"><Money v={t.revenue} /></div><div className="sub">{t.count} مركز ومشروع</div></div>
          <div className="card kpi danger"><div className="label">التكاليف</div><div className="value"><Money v={t.cost} /></div><div className="sub">تكلفة مبيعات {money(t.cogs)} · مصروفات {money(t.expenses)}</div></div>
          <div className={"card kpi " + (t.profit >= 0 ? "success" : "danger")}><div className="label">الربح</div><div className="value"><Money v={t.profit} /></div><div className="sub">الهامش {pct(t.margin)}</div></div>
          <div className="card kpi info"><div className="label">قيمة عقود المشاريع</div><div className="value"><Money v={t.contractValue} /></div><div className="sub">موازنات {money(t.budget)}</div></div>
        </div>
        <div className="card"><div className="card-h"><h3>{f.kind === "PROJECT" ? "المشاريع" : f.kind === "CENTER" ? "مراكز التكلفة" : "المراكز والمشاريع"} <span className="small muted">({f.from} — {f.to})</span></h3></div>
          {!data.rows.length ? <Empty text={f.q || f.kind || f.status || f.parentId ? "لا نتائج مطابقة للفلاتر" : "لا مراكز تكلفة ولا مشاريع بعد — أنشئ أول مشروع بزر «＋ مشروع»"} /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الرمز</th><th>الاسم</th><th>النوع</th><th>العميل</th><th>الحالة</th><th className="n">الإيرادات</th><th className="n">التكاليف</th><th className="n">الربح</th><th className="n">الهامش</th><th className="n">الموازنة</th><th className="no-print"></th></tr></thead>
            <tbody>{data.rows.map((r: any) => <tr key={r.id} className={r.overBudget ? "row-warn" : ""} style={{ cursor: "pointer" }} onClick={() => nav(`/projects/${r.id}${q({ from: f.from, to: f.to })}`)}>
              <td className="num">{r.code}</td><td><b>{r.name}</b>{r.parentName && <div className="small muted">يتبع: {r.parentName}</div>}{r.children > 0 && <span className="badge blue" style={{ marginInlineStart: 6 }}>إجمالي {r.children}</span>}</td><td>{KIND_AR[r.kind]}</td><td>{r.partnerName || <span className="muted">—</span>}</td><td><span className={"badge " + ST_AR[r.status]?.[1]}>{ST_AR[r.status]?.[0]}</span></td>
              <td className="n num">{money(r.revenue)}{r.invoicedPct !== null && <div className="small muted">{r.invoicedPct}% من العقد</div>}</td><td className="n num">{money(r.cost)}</td><td className={"n num " + (r.profit < 0 ? "neg-val" : r.profit > 0 ? "pos-val" : "")}>{money(r.profit)}</td><td className="n num">{pct(r.margin)}</td>
              <td className="n">{r.budget ? <><div className="bar" title={`${money(r.cost)} من ${money(r.budget)}`}><i style={{ width: `${Math.min(100, r.budgetUsed)}%`, background: r.overBudget ? "var(--danger)" : undefined }} /></div><span className={"small num " + (r.overBudget ? "neg-val" : "muted")}>{r.budgetUsed}%</span></> : <span className="muted">—</span>}</td>
              <td className="no-print" onClick={(e) => e.stopPropagation()}>{W && <button className="btn sm ghost" title="تعديل" aria-label={`تعديل ${r.name}`} onClick={() => setEdit(r)}>✎</button>}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={5}>الإجمالي {f.parentId || f.q || f.kind || f.status ? "(حسب الفلاتر)" : ""}</td><td className="n num">{money(t.revenue)}</td><td className="n num">{money(t.cost)}</td><td className="n num">{money(t.profit)}</td><td className="n num">{pct(t.margin)}</td><td className="n num">{t.budget ? money(t.budget) : ""}</td><td className="no-print"></td></tr></tfoot></table></div>}
          {(data.unassigned.revenue !== 0 || data.unassigned.cost !== 0) && <div className="card-b small muted">غير موزّع على أي مركز في الفترة: إيرادات {money(data.unassigned.revenue)} · تكاليف {money(data.unassigned.cost)}. اختر المركز أو المشروع في الفاتورة أو المصروف أو سطر القيد ليدخل هنا.</div>}
        </div></>}
      {edit && <CentreEditor row={edit} options={data?.options || []} onClose={(s) => { setEdit(null); if (s) reload(); }} />}
    </div>
  );
}

export function CentreEditor({ row, options, onClose }: { row: any; options: any[]; onClose: (saved?: boolean) => void }) {
  const { run, busy } = useAction();
  const toast = useToast();
  const [f, setF] = useState<any>({ code: "", name: "", parentId: "", contractValue: "", budget: "", startDate: "", endDate: "", manager: "", notes: "", ...row, partner: row.partnerId ? { id: row.partnerId, name: row.partnerName } : null });
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const prj = f.kind === "PROJECT";
  return <Modal title={row.id ? `تعديل ${KIND_AR[f.kind]}: ${row.name}` : prj ? "مشروع جديد" : "مركز تكلفة جديد"} onClose={() => onClose()} footer={<>
    {row.id && <button className="btn ghost" disabled={busy} onClick={() => confirmDlg(`حذف «${row.name}»؟`) && run(async () => { await api(`/projects/${row.id}`, { method: "DELETE" }); onClose(true); }, "حُذف")}>حذف</button>}<div className="grow" />
    <button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !String(f.name).trim()} onClick={() => run(async () => { await api(row.id ? `/projects/${row.id}` : "/projects", { method: row.id ? "PUT" : "POST", body: { ...f, partnerId: f.partner?.id || null } }); onClose(true); }, "حُفظ")}>حفظ</button></>}>
    <div className="form-grid">
      <Field label="الاسم *" span2><Input autoFocus value={f.name} onChange={s("name")} placeholder={prj ? "مثال: تشطيب فيلا حي الياسمين" : "مثال: فرع جدة، قسم الصيانة"} /></Field>
      <Field label="الرمز" hint="يُولَّد تلقائياً إن تُرك فارغاً"><Input value={f.code} onChange={s("code")} dir="ltr" /></Field>
      <Field label="النوع"><Select value={f.kind} onChange={s("kind")}><option value="PROJECT">مشروع</option><option value="CENTER">مركز تكلفة</option></Select></Field>
      <Field label="يتبع مركزاً إجمالياً" hint="مثل «إجمالي المشاريع»: يجمع أرقام ما تحته"><Select value={f.parentId || ""} onChange={s("parentId")}><option value="">— لا يتبع —</option>{options.filter((o) => o.id !== row.id).map((o) => <option key={o.id} value={o.id}>{o.code} — {o.name}</option>)}</Select></Field>
      <Field label="الحالة"><Select value={f.status} onChange={s("status")}>{Object.entries(ST_AR).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</Select></Field>
      {prj && <><Field label="العميل" span2><Picker value={f.partner} onChange={(p: any) => setF({ ...f, partner: p })} fetcher={partnerFetcher("CUSTOMER")} label={(p: any) => p.name} placeholder="عميل المشروع (اختياري)" /></Field>
        <Field label={`قيمة العقد (${CUR()})`} hint="قبل الضريبة: لمتابعة نسبة ما فُوتر"><NumInput value={f.contractValue} onChange={s("contractValue")} /></Field></>}
      <Field label={`موازنة التكاليف (${CUR()})`} hint="ينبّه عند تجاوزها"><NumInput value={f.budget} onChange={s("budget")} /></Field>
      <Field label="تاريخ البداية"><Input type="date" value={f.startDate || ""} onChange={s("startDate")} /></Field><Field label="تاريخ النهاية"><Input type="date" value={f.endDate || ""} onChange={s("endDate")} /></Field>
      <Field label="المسؤول"><Input value={f.manager || ""} onChange={s("manager")} /></Field><Field label="ملاحظات" span2><Input value={f.notes || ""} onChange={s("notes")} /></Field>
    </div>
    <p className="small muted">بعد الحفظ اختر هذا {prj ? "المشروع" : "المركز"} في فاتورة المبيعات أو المشتريات، في المصروف، في سطر القيد اليدوي، أو في ملف الموظف — فتدخل أرقامه هنا تلقائياً.</p>
  </Modal>;
}

export function ProjectDetailPage() {
  const { id } = useParams();
  const { can } = useCompanyContext();
  const sp = new URLSearchParams(location.search);
  const [f, setF] = useState<any>({ from: sp.get("from") || `${today().slice(0, 4)}-01-01`, to: sp.get("to") || today(), type: "", q: "" });
  const { data: d, loading, reload } = useFetch<any>(`/projects/${id}${q(f)}`, [id, JSON.stringify(f)]);
  const opts = useFetch<any>("/projects?from=2999-01-01&to=2999-01-01");
  const [edit, setEdit] = useState(false);
  if (loading && !d) return <Loading />;
  if (!d) return <Empty text="المركز غير موجود" />;
  const c = d.centre, g = d.figures;
  const rowsX = () => d.lines.map((l: any) => ({ التاريخ: l.date, القيد: l.number, المصدر: SRC[l.entryType] || l.entryType, المرجع: l.reference || "", الحساب: `${l.code} ${l.account}`, البيان: l.description || l.memo || "", الطرف: l.partner || "", المركز: l.centre, مدين: l.debit, دائن: l.credit }));
  return (
    <div className="grid print-doc stmt">
      <div className="card"><div className="card-h"><div><h3>{c.name} <span className="badge">{KIND_AR[c.kind]}</span> <span className={"badge " + ST_AR[c.status]?.[1]}>{ST_AR[c.status]?.[0]}</span></h3>
        <div className="small muted"><span className="num">{c.code}</span>{c.partnerName && <> · العميل: {c.partnerId ? <Link to={`/customers/${c.partnerId}`}>{c.partnerName}</Link> : c.partnerName}</>}{c.manager && <> · المسؤول: {c.manager}</>}{c.startDate && <> · من {fmtDate(c.startDate)}</>}{c.endDate && <> إلى {fmtDate(c.endDate)}</>}{c.includes > 0 && <> · <b>يشمل {c.includes} مركزاً تابعاً</b></>}</div>{c.notes && <div className="small">{c.notes}</div>}</div>
        <div className="row no-print"><Link className="btn sm" to="/projects">← كل المراكز والمشاريع</Link>{can("accounting.write") && <button className="btn sm" onClick={() => setEdit(true)}>✎ تعديل</button>}<ExportBtn name={`${c.code} ${c.name} ${f.from} ${f.to}`} rows={rowsX} /><PrintBtn pdfName={`${c.code} ${c.name}`} /></div></div></div>
      <div className="grid c4">
        <div className="card kpi"><div className="label">الإيرادات</div><div className="value"><Money v={g.revenue} /></div>{g.invoicedPct !== null && <div className="sub">{g.invoicedPct}% من العقد {money(c.contractValue)} · الباقي {money(g.toInvoice)}</div>}</div>
        <div className="card kpi danger"><div className="label">التكاليف</div><div className="value"><Money v={g.cost} /></div><div className="sub">تكلفة مبيعات {money(g.cogs)} · مصروفات {money(g.expenses)}</div></div>
        <div className={"card kpi " + (g.profit >= 0 ? "success" : "danger")}><div className="label">الربح</div><div className="value"><Money v={g.profit} /></div><div className="sub">الهامش {pct(g.margin)}</div></div>
        <div className={"card kpi " + (g.budgetLeft !== null && g.budgetLeft < 0 ? "danger" : "info")}><div className="label">موازنة التكاليف</div>{c.budget ? <><div className="value"><Money v={g.budgetLeft} /></div><div className="sub">{g.budgetLeft < 0 ? "تجاوز الموازنة" : "متبقٍّ"} · استُهلك {g.budgetUsed}% من {money(c.budget)}</div></> : <div className="value muted" style={{ fontSize: 16 }}>لم تُحدَّد</div>}{g.stock !== 0 && <div className="sub">مشتريات مخزون للمركز: {money(g.stock)}</div>}</div>
      </div>
      <div className="card no-print"><div className="card-b row" style={{ alignItems: "flex-end", gap: 10 }}>
        <DateRange from={f.from} to={f.to} onChange={(from, to) => setF({ ...f, from, to })} />
        <Field label="نوع الحركة"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} style={{ width: 190 }}><option value="">الإيرادات والتكاليف</option><option value="REVENUE">الإيرادات فقط</option><option value="COGS">تكلفة المبيعات</option><option value="EXPENSE">المصروفات</option><option value="OTHER">حركات أخرى (نقد، ذمم، مخزون)</option><option value="ALL">كل الحركات</option></Select></Field>
        <Field label="بحث في البيان أو الحساب أو رقم المستند"><Input type="search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="مثال: إسمنت، INV-2026…" style={{ width: 260 }} /></Field>
      </div></div>
      <div className="grid c2">
        <div className="card"><div className="card-h"><h3>حسب الحساب</h3></div><div className="table-wrap" style={{ maxHeight: 320 }}><table className="tbl compact"><thead><tr><th>الحساب</th><th>النوع</th><th className="n">المبلغ</th></tr></thead><tbody>{d.accounts.map((a: any) => <tr key={a.code}><td><span className="num muted">{a.code}</span> {a.name}</td><td>{a.type === "REVENUE" ? "إيراد" : a.subtype === "COGS" ? "تكلفة مبيعات" : "مصروف"}</td><td className={"n num " + (a.type === "REVENUE" ? "pos-val" : "")}>{money(a.amount)}</td></tr>)}{!d.accounts.length && <tr><td colSpan={3} className="muted">لا حركة في الفترة</td></tr>}</tbody></table></div></div>
        <div className="card"><div className="card-h"><h3>الإيراد والتكلفة شهرياً</h3></div><div className="card-b">{d.months.length ? <><BarChart data={d.months} keys={["revenue", "cost"]} labels={(x: any) => x.m.slice(5)} /><div className="row small muted mt"><span>■ إيراد</span><span style={{ color: "var(--accent)" }}>■ تكلفة</span></div></> : <div className="empty">لا حركة في الفترة</div>}</div></div>
      </div>
      <div className="card"><div className="card-h"><h3>الحركات <span className="small muted">({d.lineCount}{d.truncated ? " — يُعرض أحدث 500" : ""})</span></h3></div>
        {!d.lines.length ? <Empty text="لا حركات مطابقة" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>التاريخ</th><th>القيد</th><th>المصدر</th><th>الحساب</th><th>البيان</th>{c.includes > 0 && <th>المركز</th>}<th className="n">مدين</th><th className="n">دائن</th></tr></thead>
          <tbody>{d.lines.map((l: any, i: number) => <tr key={i}><td className="num">{fmtDate(l.date)}</td><td className="num">{docLink(l) ? <Link to={docLink(l)!}>{l.reference || l.number}</Link> : l.number}</td><td>{SRC[l.entryType] || l.entryType}</td><td><span className="num muted">{l.code}</span> {l.account}</td><td className="small">{l.description || l.memo}{l.partner && <span className="muted"> — {l.partner}</span>}</td>{c.includes > 0 && <td className="small">{l.centre}</td>}<td className="n num">{l.debit ? money(l.debit) : ""}</td><td className="n num">{l.credit ? money(l.credit) : ""}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={c.includes > 0 ? 6 : 5}>الإجمالي ({d.lineCount} حركة)</td><td className="n num">{money(d.lineTotals.debit)}</td><td className="n num">{money(d.lineTotals.credit)}</td></tr></tfoot></table></div>}</div>
      {edit && <CentreEditor row={{ ...c }} options={opts.data?.options || []} onClose={(s) => { setEdit(false); if (s) reload(); }} />}
    </div>
  );
}
