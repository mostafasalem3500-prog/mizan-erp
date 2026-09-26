import React, { useMemo, useState } from "react";
import { api, q, useFetch, Money, money, Loading, Empty, Badge, Modal, Field, Input, Select, NumInput, Picker, accountFetcher, partnerFetcher, useAction, useToast, useCompanyContext, ExportBtn, PrintBtn, useDebounce, DateRange, monthStart, today, fmtDate, JTYPE_AR, TYPE_AR, confirmDlg } from "../lib";

// ─── chart of accounts ─────────────────────────────────────────────────────
export function AccountsPage() {
  const { can } = useCompanyContext();
  const { data, loading, reload } = useFetch("/accounts");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [edit, setEdit] = useState<any>(null);
  const [ledger, setLedger] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [openAll, setOpenAll] = useState(false);
  const tree = useMemo(() => {
    if (!data) return [];
    const rows = data.rows;
    const byParent = new Map<string | null, any[]>();
    for (const r of rows) (byParent.get(r.parentId || null) || byParent.set(r.parentId || null, []).get(r.parentId || null)!).push(r);
    const out: any[] = [];
    const walk = (pid: string | null, depth: number) => { for (const r of byParent.get(pid) || []) { out.push({ ...r, depth }); if (r.isGroup && (open[r.id] || openAll || search)) walk(r.id, depth + 1); } };
    walk(null, 0);
    return search ? rows.filter((r: any) => r.code.startsWith(search) || r.nameAr.includes(search)).map((r: any) => ({ ...r, depth: r.level - 1 })) : out;
  }, [data, open, search, openAll]);
  return (
    <div className="card">
      <div className="card-h"><h3>دليل الحسابات</h3><div className="row"><button className="btn sm" onClick={() => setOpenAll((v) => !v)}>{openAll ? "طي الكل" : "توسيع الكل"}</button>{data && <ExportBtn name="دليل الحسابات" rows={() => data.rows.map((a: any) => ({ الرقم: a.code, الاسم: a.nameAr, English: a.nameEn, النوع: TYPE_AR[a.type], التصنيف: data.subtypes[a.subtype], المستوى: a.level, "رئيسي؟": a.isGroup ? "نعم" : "", الرصيد: a.balance }))} />}{can("accounting.write") && <button className="btn primary sm" onClick={() => setEdit({})}>＋ حساب جديد</button>}</div></div>
      <div className="card-b">
        <div className="toolbar"><div className="search"><span className="ic">🔍</span><Input placeholder="بحث بالرقم أو الاسم" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
        {loading && !data ? <Loading /> : (
          <div className="table-wrap"><table className="tbl"><thead><tr><th>الحساب</th><th>النوع</th><th>التصنيف</th><th className="n">الرصيد (مدين +/دائن −)</th><th /></tr></thead>
            <tbody>{tree.map((a: any) => (
              <tr key={a.id} className={a.isGroup ? "group" : ""}>
                <td style={{ paddingInlineStart: 12 + a.depth * 22 }}>{a.isGroup ? <span className="tree-toggle" onClick={() => setOpen({ ...open, [a.id]: !open[a.id] })}>{open[a.id] || openAll ? "▾" : "▸"}</span> : <span className="tree-toggle" />}<span className="num" style={{ marginInlineEnd: 8, color: "var(--muted)" }}>{a.code}</span>{a.nameAr}{a.systemKey && <span className="badge teal small" style={{ marginInlineStart: 6 }}>نظامي</span>}{!a.isActive && <span className="badge gray" style={{ marginInlineStart: 6 }}>موقوف</span>}{a.isCashBank && <span className="badge blue" style={{ marginInlineStart: 6 }}>نقدية/بنك</span>}</td>
                <td>{TYPE_AR[a.type]}</td><td className="small muted">{data.subtypes[a.subtype]}</td><td className="n"><Money v={a.balance} sign /></td>
                <td className="row" style={{ gap: 4 }}>{!a.isGroup && <button className="btn sm" onClick={() => setLedger(a)}>الأستاذ</button>}{can("accounting.write") && <button className="btn sm ghost" onClick={() => setEdit(a)}>تعديل</button>}{can("accounting.write") && a.isGroup && <button className="btn sm ghost" onClick={() => setEdit({ parentId: a.id, parent: a })}>＋ فرعي</button>}</td>
              </tr>))}
            </tbody></table></div>
        )}
      </div>
      {edit && <AccountEditor a={edit} subtypes={data.subtypes} onClose={(s) => { setEdit(null); if (s) reload(); }} />}
      {ledger && <LedgerModal account={ledger} onClose={() => setLedger(null)} />}
    </div>
  );
}

function AccountEditor({ a, subtypes, onClose }: { a: any; subtypes: Record<string, string>; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({ code: a.parent ? a.parent.code + (a.parent.level === 1 ? "1" : a.parent.level === 2 ? "01" : "01") : "", nameAr: "", nameEn: "", subtype: a.parent?.subtype || "", isGroup: false, isCashBank: false, isActive: true, ...a });
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <Modal narrow title={a.id ? `تعديل ${a.code}` : a.parent ? `حساب فرعي تحت ${a.parent.code} ${a.parent.nameAr}` : "حساب جديد"} onClose={() => onClose()} footer={<>
      {a.id && !a.isSystem && <button className="btn danger sm" onClick={() => run(async () => { if (!confirmDlg("حذف الحساب؟")) return; await api(`/accounts/${a.id}`, { method: "DELETE" }); onClose(true); })}>حذف</button>}
      <div className="grow" /><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy} onClick={() => run(async () => { a.id ? await api(`/accounts/${a.id}`, { method: "PUT", body: f }) : await api("/accounts", { body: { ...f, parentId: a.parentId } }); onClose(true); }, "تم الحفظ")}>حفظ</button></>}>
      <div className="grid">
        <Field label="رقم الحساب"><Input value={f.code} onChange={s("code")} dir="ltr" /></Field>
        <Field label="الاسم بالعربية"><Input value={f.nameAr} onChange={s("nameAr")} autoFocus /></Field>
        <Field label="الاسم بالإنجليزية"><Input value={f.nameEn || ""} onChange={s("nameEn")} dir="ltr" /></Field>
        <Field label="التصنيف في القوائم المالية"><Select value={f.subtype} onChange={s("subtype")}><option value="">—</option>{Object.entries(subtypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        {!a.id && <label className="check"><input type="checkbox" checked={f.isGroup} onChange={s("isGroup")} /> حساب رئيسي (تجميعي، لا يقبل قيوداً)</label>}
        <label className="check"><input type="checkbox" checked={!!f.isCashBank} onChange={s("isCashBank")} /> حساب نقدية / بنك (يظهر في سندات القبض والصرف)</label>
        {a.id && <label className="check"><input type="checkbox" checked={!!f.isActive} onChange={s("isActive")} /> نشط</label>}
      </div>
    </Modal>
  );
}

export function LedgerModal({ account, onClose }: { account: any; onClose: () => void }) {
  const [from, setFrom] = useState(today().slice(0, 4) + "-01-01");
  const [to, setTo] = useState(today());
  const { data } = useFetch(`/reports/ledger${q({ accountId: account.id, from, to })}`);
  return (
    <Modal wide title={`دفتر الأستاذ: ${account.code} ${account.nameAr}`} onClose={onClose} footer={<><PrintBtn />{data && <ExportBtn name={`أستاذ ${account.code}`} rows={() => data.rows.map((r: any) => ({ التاريخ: r.date, القيد: r.number, النوع: JTYPE_AR[r.type], البيان: r.description || r.memo, الطرف: r.partnerName, مدين: r.debit, دائن: r.credit, الرصيد: r.balance }))} />}<button className="btn" onClick={onClose}>إغلاق</button></>}>
      <div className="no-print mb"><DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} /></div>
      {!data ? <Loading /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>التاريخ</th><th>القيد</th><th>النوع</th><th>البيان</th><th>الطرف</th><th className="n">مدين</th><th className="n">دائن</th><th className="n">الرصيد</th></tr></thead>
        <tbody><tr className="group"><td colSpan={7}>رصيد أول المدة</td><td className="n"><Money v={data.opening} sign /></td></tr>{data.rows.map((r: any, i: number) => <tr key={i}><td>{fmtDate(r.date)}</td><td>{r.number}</td><td className="small">{JTYPE_AR[r.type]}</td><td>{r.description || r.memo}</td><td>{r.partnerName}</td><td className="n"><Money v={r.debit} blankZero /></td><td className="n"><Money v={r.credit} blankZero /></td><td className="n"><Money v={r.balance} sign /></td></tr>)}</tbody>
        <tfoot><tr><td colSpan={5}>الإجمالي / رصيد آخر المدة</td><td className="n"><Money v={data.totalDebit} /></td><td className="n"><Money v={data.totalCredit} /></td><td className="n"><Money v={data.closing} sign /></td></tr></tfoot></table></div>}
    </Modal>
  );
}

// ─── journals ──────────────────────────────────────────────────────────────
export function JournalsPage() {
  const { can } = useCompanyContext();
  const toast = useToast();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const dq = useDebounce(search);
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState<"manual" | "opening" | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { data, loading, reload } = useFetch(`/journals${q({ from, to, type, search: dq, limit: 100, offset: page * 100 })}`);
  const { run } = useAction();
  return (
    <div className="card">
      <div className="card-h"><h3>دفتر اليومية <span className="muted small">({data?.total || 0} قيد)</span></h3>{can("accounting.write") && <div className="row"><button className="btn sm" onClick={() => setEdit("opening")}>قيد أرصدة افتتاحية</button><button className="btn primary sm" onClick={() => setEdit("manual")}>＋ قيد يدوي</button></div>}</div>
      <div className="card-b">
        <div className="toolbar"><DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); setPage(0); }} /><Select value={type} onChange={(e) => { setType(e.target.value); setPage(0); }}><option value="">كل الأنواع</option>{Object.entries(JTYPE_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select><div className="search"><span className="ic">🔍</span><Input placeholder="بحث" value={search} onChange={(e) => setSearch(e.target.value)} /></div><div className="grow" /><PrintBtn />{data && <ExportBtn name="دفتر اليومية" rows={() => data.rows.flatMap((e: any) => e.lines.map((l: any) => ({ القيد: e.number, التاريخ: e.date, النوع: JTYPE_AR[e.type], البيان: e.memo, الحساب: `${l.code} ${l.nameAr}`, "بيان السطر": l.description, مدين: l.debit, دائن: l.credit })))} />}</div>
        {loading && !data ? <Loading /> : !data?.rows.length ? <Empty /> : (
          <div className="table-wrap"><table className="tbl compact"><thead><tr><th style={{ width: 24 }} /><th>الرقم</th><th>التاريخ</th><th>النوع</th><th>البيان</th><th>المرجع</th><th className="n">المبلغ</th><th>الحالة</th><th /></tr></thead>
            <tbody>{data.rows.map((e: any) => <React.Fragment key={e.id}>
              <tr className="clickable" onClick={() => setExpanded({ ...expanded, [e.id]: !expanded[e.id] })}><td>{expanded[e.id] ? "▾" : "▸"}</td><td><b>{e.number}</b></td><td>{fmtDate(e.date)}</td><td><span className="badge gray">{JTYPE_AR[e.type]}</span></td><td>{e.memo}</td><td>{e.reference}</td><td className="n"><Money v={e.totalDebit} /></td><td>{e.reversedBy ? <span className="badge red">معكوس</span> : e.reversalOf ? <span className="badge amber">عكسي</span> : <Badge s={e.status} />}</td>
                <td>{can("accounting.write") && e.status === "POSTED" && !e.reversedBy && !["CLOSING", "REVERSAL"].includes(e.type) && <button className="btn sm ghost" onClick={(ev) => { ev.stopPropagation(); run(async () => { if (confirmDlg(`عكس القيد ${e.number}؟ (ينشئ قيداً مضاداً بتاريخ اليوم)`)) { await api(`/journals/${e.id}/reverse`, { body: {} }); reload(); } }, "تم عكس القيد"); }}>عكس</button>}</td></tr>
              {expanded[e.id] && e.lines.map((l: any) => <tr key={l.id} className="sub"><td /><td colSpan={3}>{l.code} {l.nameAr}{l.partnerName && <span className="muted"> — {l.partnerName}</span>}</td><td colSpan={2} className="small">{l.description}</td><td className="n"><span className="small muted">مدين</span> <Money v={l.debit} blankZero /> <span className="small muted">دائن</span> <Money v={l.credit} blankZero /></td><td colSpan={2} /></tr>)}
            </React.Fragment>)}</tbody></table></div>
        )}
        {data && data.total > 100 && <div className="row mt"><button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>السابق</button><span className="muted">{page + 1} / {Math.ceil(data.total / 100)}</span><button className="btn sm" disabled={(page + 1) * 100 >= data.total} onClick={() => setPage(page + 1)}>التالي</button></div>}
      </div>
      {edit && <JournalEditor mode={edit} onClose={(s) => { setEdit(null); if (s) reload(); }} />}
    </div>
  );
}

function JournalEditor({ mode, onClose }: { mode: "manual" | "opening"; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [date, setDate] = useState(today());
  const [memo, setMemo] = useState(mode === "opening" ? "الأرصدة الافتتاحية" : "");
  const [ref, setRef] = useState("");
  const [lines, setLines] = useState<any[]>([{ key: 1, account: null, debit: "", credit: "", partner: null, description: "" }, { key: 2, account: null, debit: "", credit: "", partner: null, description: "" }]);
  const td = lines.reduce((a, l) => a + Number(l.debit || 0), 0), tc = lines.reduce((a, l) => a + Number(l.credit || 0), 0);
  const upd = (k: number, p: any) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));
  return (
    <Modal wide title={mode === "opening" ? "قيد الأرصدة الافتتاحية" : "قيد يومية يدوي"} onClose={() => onClose()} footer={<><span className="grow row"><span className="muted">مدين</span><b><Money v={td} /></b><span className="muted">دائن</span><b><Money v={tc} /></b>{mode === "manual" && Math.abs(td - tc) > 0.004 && <span className="badge red">غير متوازن: {money(td - tc)}</span>}{mode === "opening" && Math.abs(td - tc) > 0.004 && <span className="badge amber">الفرق {money(td - tc)} يُرحّل لحساب الأرصدة الافتتاحية</span>}</span><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || (mode === "manual" && Math.abs(td - tc) > 0.004) || td + tc === 0} onClick={() => run(async () => { const body = { date, memo, reference: ref, lines: lines.filter((l) => l.account).map((l) => ({ accountId: l.account.id, debit: Number(l.debit || 0), credit: Number(l.credit || 0), partnerId: l.partner?.id, description: l.description })) }; await api(mode === "opening" ? "/journals/opening" : "/journals", { body }); onClose(true); }, "تم ترحيل القيد")}>ترحيل</button></>}>
      <div className="form-grid"><Field label="التاريخ"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field><Field label="البيان" span2><Input value={memo} onChange={(e) => setMemo(e.target.value)} autoFocus /></Field><Field label="المرجع"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field></div>
      {mode === "opening" && <div className="alert info mt">أدخل أرصدة الحسابات كما في ميزان المراجعة السابق (الأصول مدين، الخصوم ورأس المال دائن). أرصدة العملاء والموردين يمكن تفصيلها بتحديد الطرف في كل سطر ليظهر في كشوف حساباتهم. الأرصدة الافتتاحية للمخزون تُدخل من شاشة الجرد لضمان تطابق كرت الصنف.</div>}
      <table className="tbl compact mt"><thead><tr><th style={{ width: "34%" }}>الحساب</th><th>الطرف (للعملاء/الموردين)</th><th style={{ width: 130 }}>مدين</th><th style={{ width: 130 }}>دائن</th><th>البيان</th><th /></tr></thead>
        <tbody>{lines.map((l) => <tr key={l.key}><td><Picker value={l.account} onChange={(a) => upd(l.key, { account: a })} fetcher={accountFetcher()} label={(a: any) => `${a.code} ${a.nameAr}`} /></td><td>{(l.account?.systemKey === "AR" || l.account?.systemKey === "AP") && <Picker value={l.partner} onChange={(p) => upd(l.key, { partner: p })} fetcher={partnerFetcher(l.account?.systemKey === "AR" ? "CUSTOMER" : "SUPPLIER")} label={(p: any) => p.name} />}</td><td><NumInput value={l.debit} onChange={(e) => upd(l.key, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} /></td><td><NumInput value={l.credit} onChange={(e) => upd(l.key, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} /></td><td><Input value={l.description} onChange={(e) => upd(l.key, { description: e.target.value })} /></td><td><button className="btn ghost sm" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button></td></tr>)}</tbody></table>
      <button className="btn sm mt" onClick={() => setLines((ls) => [...ls, { key: Date.now(), account: null, debit: "", credit: "", partner: null, description: "" }])}>＋ سطر</button>
    </Modal>
  );
}

// ─── fiscal years & periods ────────────────────────────────────────────────
export function PeriodsPage() {
  const { can, me } = useCompanyContext();
  const { data, loading, reload } = useFetch("/fiscal-years");
  const { run, busy } = useAction();
  const toast = useToast();
  if (loading || !data) return <Loading />;
  return (
    <div className="grid c2">
      <div className="card"><div className="card-h"><h3>السنوات المالية</h3></div><div className="card-b">
        <div className="alert info">تبدأ السنة المالية في شهر {me.company.fiscalYearStart} (يُضبط من إعدادات المنشأة). تُنشأ السنة وفتراتها الشهرية تلقائياً عند أول قيد.</div>
        <table className="tbl"><thead><tr><th>السنة</th><th>من</th><th>إلى</th><th>الحالة</th><th /></tr></thead><tbody>{data.years.map((y: any) => <tr key={y.id}><td><b>{y.name}</b></td><td>{fmtDate(y.startDate)}</td><td>{fmtDate(y.endDate)}</td><td><Badge s={y.status} /></td><td>{can("accounting.write") && (y.status === "OPEN" ? <button className="btn sm danger" disabled={busy} onClick={() => run(async () => { if (!confirmDlg(`إقفال السنة ${y.name}؟ سيُنشأ قيد إقفال يرحّل صافي الربح/الخسارة إلى الأرباح المبقاة وتُقفل كل الفترات.`)) return; const r = await api(`/fiscal-years/${y.id}/close`, { body: {} }); toast(`تم الإقفال — صافي النتيجة ${money(r.netIncome)}`, "ok"); reload(); })}>إقفال السنة</button> : <button className="btn sm" disabled={busy} onClick={() => run(async () => { if (confirmDlg("إعادة فتح السنة وحذف قيد الإقفال؟")) { await api(`/fiscal-years/${y.id}/reopen`, { body: {} }); reload(); } })}>إعادة فتح</button>)}</td></tr>)}</tbody></table>
      </div></div>
      <div className="card"><div className="card-h"><h3>الفترات الشهرية</h3></div><div className="card-b">
        <div className="hint mb">قفل الفترة يمنع أي ترحيل بتاريخ داخلها (لمنع التعديل بعد تقديم الإقرار الضريبي مثلاً).</div>
        <table className="tbl compact"><thead><tr><th>الفترة</th><th>من</th><th>إلى</th><th>الحالة</th><th /></tr></thead><tbody>{data.periods.map((p: any) => <tr key={p.id}><td>{p.name}</td><td>{fmtDate(p.startDate)}</td><td>{fmtDate(p.endDate)}</td><td><Badge s={p.status} /></td><td>{can("accounting.write") && data.years.find((y: any) => y.id === p.fiscalYearId)?.status === "OPEN" && <button className="btn sm ghost" onClick={() => run(async () => { await api(`/periods/${p.id}`, { method: "PUT", body: { status: p.status === "OPEN" ? "LOCKED" : "OPEN" } }); reload(); })}>{p.status === "OPEN" ? "قفل" : "فتح"}</button>}</td></tr>)}</tbody></table>
      </div></div>
    </div>
  );
}
