/**
 * Month-end close cockpit, journals awaiting approval, bank reconciliation rules & statement, cost allocation, break-even.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, q, useFetch, useAction, useToast, useCompanyContext, useNewParam, useTabParam, Modal, Field, Input, Select, NumInput, Picker, accountFetcher, Money, money, Empty, Loading, DateRange, ExportBtn, PrintBtn, today, fmtDate, fmtDT, monthStart, yearStart, confirmDlg, JTYPE_AR } from "../lib";

const LV: Record<string, [string, string]> = { ok: ["✓", "pos-val"], warn: ["⚠", "lv-warn"], block: ["⛔", "neg-val"], info: ["ℹ", "muted"] };

// ─── month-end close ─────────────────────────────────────────────────────
export function ClosingPage() {
  const { can, me } = useCompanyContext();
  const toast = useToast();
  const { run, busy } = useAction();
  const [pid, setPid] = useState("");
  const { data: d, loading, reload } = useFetch<any>(`/closing${q({ periodId: pid || undefined })}`, [pid]);
  if (loading && !d) return <Loading />;
  if (!d?.period) return <Empty text="لا توجد فترات مالية بعد — تُنشأ مع أول قيد" />;
  const p = d.period; const W = can("accounting.write"); const boss = ["OWNER", "ADMIN"].includes(me.role) || me.superAdmin;
  const lock = (force = false) => run(async () => {
    if (!confirmDlg(force ? `قفل ${p.name} مع وجود ${d.blockers} بند مانع؟ يُسجَّل التجاوز في سجل التدقيق.` : `قفل ${p.name}؟ لن يُقبل بعدها أي إدخال أو تعديل بتاريخ هذا الشهر.`)) return;
    await api(`/closing/${p.id}/lock`, { body: { force } }); toast(`تم قفل ${p.name}`); reload();
  });
  return (
    <div className="grid closing">
      <div className="card"><div className="card-b">
        <div className="row" style={{ gap: 12, alignItems: "flex-end" }}>
          <Field label="الشهر"><Select value={p.id} onChange={(e) => setPid(e.target.value)} style={{ minWidth: 220 }}>{d.periods.map((x: any) => <option key={x.id} value={x.id}>{x.name}{x.status === "LOCKED" ? " 🔒" : x.hasEntries ? "" : " (بلا قيود)"}</option>)}</Select></Field>
          <div className="grow"><div className="row between small"><span>{p.from} → {p.to} · {d.totals.entries} قيداً · إيرادات <b className="num">{money(d.totals.revenue)}</b> · مصروفات <b className="num">{money(d.totals.expense)}</b> · النتيجة <b className={"num " + (d.totals.net < 0 ? "neg-val" : "pos-val")}>{money(d.totals.net)}</b></span><b>{d.progress}%</b></div><div className="learn-prog"><div style={{ width: d.progress + "%" }} /></div></div>
          {p.status === "LOCKED" ? <><span className="badge green">🔒 مقفل</span>{W && boss && <button className="btn sm" disabled={busy} onClick={() => run(async () => { if (!confirmDlg(`إعادة فتح ${p.name}؟`)) return; await api(`/closing/${p.id}/lock`, { body: { lock: false } }); reload(); })}>إعادة فتح</button>}</>
            : W && <><button className="btn primary" disabled={busy || d.blockers > 0} title={d.blockers ? "عالج البنود المانعة أولاً" : ""} onClick={() => lock()}>🔒 قفل الشهر</button>{d.blockers > 0 && boss && <button className="btn sm ghost" disabled={busy} onClick={() => lock(true)}>قفل مع التجاوز</button>}</>}
        </div>
        {!p.ended && p.status !== "LOCKED" && <div className="alert info small mt">هذا الشهر لم ينتهِ بعد — القائمة تعرض وضعه حتى اليوم.</div>}
        {p.yearStatus === "CLOSED" && <div className="alert info small mt">السنة المالية {p.year} مقفلة.</div>}
      </div></div>
      <div className="grid cols-2">
        <div className="card"><div className="card-h"><h3>فحوص تلقائية</h3><span className="small muted">{d.blockers ? <b className="neg-val">{d.blockers} مانع</b> : "لا موانع"}{d.warnings ? ` · ${d.warnings} تنبيه` : ""}</span></div><div className="card-b" style={{ padding: 0 }}>
          {d.items.map((i: any) => <div key={i.key} className={"close-row lv-" + i.level}><span className={"close-ic " + LV[i.level][1]}>{LV[i.level][0]}</span><div className="grow"><div>{i.label}</div>{i.detail && <div className="small muted">{i.detail}</div>}</div>{i.to && i.level !== "ok" && <Link className="btn sm" to={i.to}>معالجة ←</Link>}</div>)}
        </div></div>
        <div className="card"><div className="card-h"><h3>خطوات يراجعها المحاسب</h3><span className="small muted">{d.manual.filter((m: any) => m.done).length}/{d.manual.length}</span></div><div className="card-b" style={{ padding: 0 }}>
          {d.manual.map((m: any) => <label key={m.key} className="close-row"><input type="checkbox" checked={m.done} disabled={!W || busy || p.status === "LOCKED"} onChange={(e) => run(async () => { await api(`/closing/${p.id}/tasks/${m.key}`, { method: "PUT", body: { done: e.target.checked } }); reload(); })} /><div className="grow"><div>{m.label}</div>{m.done && m.doneBy && <div className="small muted">{m.doneBy} · {fmtDT(m.doneAt)}</div>}</div></label>)}
          <div className="close-row small muted">بعد قفل آخر شهر في السنة: <Link to="/periods?tab=close">فحص وإقفال السنة المالية ←</Link></div>
        </div></div>
      </div>
    </div>
  );
}

// ─── journals awaiting approval ──────────────────────────────────────────
const ST: Record<string, [string, string]> = { SUBMITTED: ["بانتظار الاعتماد", "amber"], DRAFT: ["مسودة", ""], REJECTED: ["مرفوض", "red"], POSTED: ["مرحّل", "green"] };
export function JournalApprovalsPage() {
  const { can, me, reload: reloadMe } = useCompanyContext();
  const toast = useToast();
  const { run, busy } = useAction();
  const [tab, setTab] = useTabParam("SUBMITTED");
  const { data, loading, reload } = useFetch<any>(`/journal-drafts${q({ status: tab })}`, [tab]);
  const [edit, setEdit] = useState<any>(null);
  useNewParam(() => setEdit({}));
  const W = can("accounting.write");
  const act = (d: any, action: string, body: any = {}, msg = "تم") => run(async () => { const r = await api(`/journal-drafts/${d.id}/${action}`, { body }); toast(r?.number ? `رُحّل القيد ${r.number}${r.reversal ? ` وعكسه ${r.reversal}` : ""}` : msg); reload(); });
  const c = data?.counts || {};
  return (
    <div className="grid">
      <div className="card"><div className="card-b row" style={{ gap: 10 }}>
        <div className="grow"><b>اعتماد القيود (الفصل بين المهام)</b><div className="small muted">{data?.approval ? "مفعّل: القيد اليدوي يُحفظ ثم يعتمده مستخدم آخر قبل ترحيله؛ المحاسب لا يرحّل مباشرة." : "غير مفعّل: يمكن لمن أعدّ القيد ترحيله مباشرة. المسودات هنا للمراجعة قبل الترحيل."}</div></div>
        {can("settings.write") && data && <button className="btn sm" disabled={busy} onClick={() => run(async () => { await api("/accounting-settings", { method: "PUT", body: { journalApproval: !data.approval } }); reload(); reloadMe(); })}>{data.approval ? "إيقاف الاعتماد" : "تفعيل الاعتماد"}</button>}
        {W && <button className="btn primary sm" onClick={() => setEdit({})}>＋ قيد للمراجعة</button>}
      </div></div>
      <div className="tabs">{[["SUBMITTED", `بانتظار الاعتماد${c.submitted ? ` (${c.submitted})` : ""}`], ["DRAFT", `مسودات${c.draft ? ` (${c.draft})` : ""}`], ["REJECTED", `مرفوضة${c.rejected ? ` (${c.rejected})` : ""}`], ["POSTED", "مرحّلة"]].map(([k, l]) => <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {loading && !data ? <Loading /> : !data?.rows.length ? <div className="card"><Empty text={tab === "SUBMITTED" ? "لا توجد قيود بانتظار الاعتماد ✓" : "لا توجد قيود"} /></div> : data.rows.map((d: any) => (
        <div className="card" key={d.id}><div className="card-h"><div><b>{d.memo || "قيد يومية"}</b> <span className={"badge " + ST[d.status][1]}>{ST[d.status][0]}</span><div className="small muted"><span className="num">{fmtDate(d.date)}</span>{d.reference ? ` · مرجع ${d.reference}` : ""} · أعدّه {d.createdName}{d.reverseOn ? <> · يُعكس تلقائياً في <span className="num">{fmtDate(d.reverseOn)}</span></> : null}{d.decidedName ? ` · ${d.status === "REJECTED" ? "رفضه" : "اعتمده"} ${d.decidedName}` : ""}</div>{d.rejectReason && <div className="small neg-val">سبب الرفض: {d.rejectReason}</div>}</div>
          {W && <div className="row">
            {d.status === "SUBMITTED" && <><button className="btn primary sm" disabled={busy || (data.approval && d.createdBy === data.me)} title={data.approval && d.createdBy === data.me ? "يعتمده مستخدم غير الذي أعدّه" : ""} onClick={() => act(d, "approve")}>✓ اعتماد وترحيل</button><button className="btn sm" disabled={busy} onClick={() => { const reason = window.prompt("سبب الرفض:"); if (reason) act(d, "reject", { reason }, "تم الرفض"); }}>رفض</button>{d.createdBy === data.me && <button className="btn sm ghost" disabled={busy} onClick={() => act(d, "withdraw", {}, "سُحب للتعديل")}>سحب</button>}</>}
            {(d.status === "DRAFT" || d.status === "REJECTED") && <><button className="btn sm" onClick={() => setEdit(d)}>تعديل</button><button className="btn primary sm" disabled={busy} onClick={() => act(d, "submit", {}, "أُرسل للاعتماد")}>إرسال للاعتماد</button>{!data.approval && <button className="btn sm" disabled={busy} onClick={() => act(d, "approve")}>ترحيل الآن</button>}<button className="btn sm ghost" disabled={busy} onClick={() => { if (confirmDlg("حذف المسودة؟")) act(d, "delete", {}, "حُذفت"); }}>حذف</button></>}
            {d.status === "POSTED" && d.entryId && <Link className="btn sm" to={`/journals/${d.entryId}`}>فتح القيد</Link>}
          </div>}</div>
          <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الحساب</th><th>البيان</th><th className="n">مدين</th><th className="n">دائن</th></tr></thead><tbody>{d.lines.map((l: any, i: number) => <tr key={i}><td>{l.account}</td><td className="small">{l.description}</td><td className="n"><Money v={l.debit} blankZero /></td><td className="n"><Money v={l.credit} blankZero /></td></tr>)}</tbody><tfoot><tr><td colSpan={2}>الإجمالي</td><td className="n"><Money v={d.total} /></td><td className="n"><Money v={d.total} /></td></tr></tfoot></table></div>
        </div>))}
      {edit && <DraftEditor draft={edit} onClose={(s) => { setEdit(null); if (s) reload(); }} />}
    </div>
  );
}
function DraftEditor({ draft, onClose }: { draft: any; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const accounts = useFetch<any>("/accounts");
  const cc = useFetch<any[]>("/cost-centers");
  const [f, setF] = useState<any>({ date: fmtDate(draft.date) || today(), memo: draft.memo || "", reference: draft.reference || "", reverseOn: fmtDate(draft.reverseOn) || "" });
  const [lines, setLines] = useState<any[]>(() => (draft.lines?.length ? draft.lines.map((l: any, i: number) => ({ key: i + 1, accountId: l.accountId, debit: l.debit || "", credit: l.credit || "", costCenterId: l.costCenterId || "", description: l.description || "" })) : [{ key: 1, accountId: "", debit: "", credit: "", costCenterId: "", description: "" }, { key: 2, accountId: "", debit: "", credit: "", costCenterId: "", description: "" }]));
  const list = useMemo(() => (accounts.data?.rows || []).filter((a: any) => !a.isGroup && a.isActive), [accounts.data]);
  const pick = (idv: string) => list.find((a: any) => a.id === idv) || null;
  const upd = (k: number, p: any) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));
  const td = lines.reduce((a, l) => a + Number(l.debit || 0), 0), tc = lines.reduce((a, l) => a + Number(l.credit || 0), 0);
  const save = (submit: boolean) => run(async () => { const body = { ...f, reverseOn: f.reverseOn || undefined, submit, lines: lines.filter((l) => l.accountId).map((l) => ({ accountId: l.accountId, debit: Number(l.debit || 0), credit: Number(l.credit || 0), costCenterId: l.costCenterId || undefined, description: l.description })) }; if (draft.id) await api(`/journal-drafts/${draft.id}`, { method: "PUT", body }); else await api("/journal-drafts", { body }); onClose(true); }, submit ? "أُرسل للاعتماد" : "حُفظت المسودة");
  const okBal = Math.abs(td - tc) < 0.005 && td > 0;
  return (
    <Modal wide title={draft.id ? "تعديل قيد للمراجعة" : "قيد للمراجعة (لا يُرحَّل الآن)"} onClose={() => onClose()} footer={<><span className="grow row"><span className="muted">مدين</span><b><Money v={td} /></b><span className="muted">دائن</span><b><Money v={tc} /></b>{!okBal && td + tc > 0 && <span className="badge red">غير متوازن: {money(td - tc)}</span>}</span><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn" disabled={busy || !okBal} onClick={() => save(false)}>حفظ مسودة</button><button className="btn primary" disabled={busy || !okBal} onClick={() => save(true)}>حفظ وإرسال للاعتماد</button></>}>
      <div className="form-grid"><Field label="التاريخ"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field><Field label="البيان" span2><Input autoFocus value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} /></Field><Field label="المرجع"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field><Field label="عكس تلقائي بتاريخ" hint="لقيود الاستحقاق"><Input type="date" min={f.date} value={f.reverseOn} onChange={(e) => setF({ ...f, reverseOn: e.target.value })} /></Field></div>
      <table className="tbl compact mt"><thead><tr><th style={{ width: "32%" }}>الحساب</th><th style={{ width: 120 }}>مدين</th><th style={{ width: 120 }}>دائن</th><th>مركز التكلفة</th><th>البيان</th><th /></tr></thead>
        <tbody>{lines.map((l) => <tr key={l.key}><td><Picker value={pick(l.accountId)} onChange={(a: any) => upd(l.key, { accountId: a?.id || "" })} fetcher={accountFetcher()} label={(a: any) => `${a.code} ${a.nameAr}`} /></td><td><NumInput value={l.debit} onChange={(e) => upd(l.key, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} /></td><td><NumInput value={l.credit} onChange={(e) => upd(l.key, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} /></td><td><Select value={l.costCenterId} onChange={(e) => upd(l.key, { costCenterId: e.target.value })}><option value="">—</option>{(cc.data || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></td><td><Input value={l.description} onChange={(e) => upd(l.key, { description: e.target.value })} /></td><td>{lines.length > 2 && <button className="btn ghost sm" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button>}</td></tr>)}</tbody></table>
      <button className="btn sm mt" onClick={() => setLines((ls) => [...ls, { key: Date.now(), accountId: "", debit: "", credit: "", costCenterId: "", description: "" }])}>＋ سطر</button>
    </Modal>
  );
}

// ─── bank: rules and the reconciliation statement ────────────────────────
export function BankRulesBtn({ onChanged }: { onChanged: () => void }) {
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const { data, reload } = useFetch<any[]>(open ? "/bank-rules" : null, [open]);
  const [f, setF] = useState<any>(null);
  const blank = { name: "", contains: "", direction: "OUT", account: null, taxCode: "O" };
  const W = can("accounting.write");
  return <>
    <button className="btn sm" onClick={() => setOpen(true)}>⚙ قواعد التسوية</button>
    {open && <Modal wide title="قواعد التسوية البنكية" onClose={() => { setOpen(false); setF(null); onChanged(); }}>
      <p className="small muted" style={{ marginTop: 0 }}>القاعدة تتعرف على سطر الكشف من كلمات في بيانه (مثل «عمولة» أو «رسوم») وتسجّله على الحساب المحدد وتطابقه بضغطة — للرسوم البنكية، الفوائد، عمولات نقاط البيع، والاشتراكات المتكررة. افصل البدائل بفاصلة.</p>
      {!data ? <Loading /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>القاعدة</th><th>إذا احتوى البيان</th><th>الاتجاه</th><th>يُسجَّل على</th><th>الضريبة</th><th /></tr></thead><tbody>
        {data.map((r) => <tr key={r.id} style={r.isActive ? {} : { opacity: .5 }}><td><b>{r.name}</b></td><td>{r.contains}</td><td>{r.direction === "IN" ? "إيداع" : r.direction === "OUT" ? "سحب" : "الاتجاهان"}</td><td>{r.accountCode} {r.accountName}</td><td>{r.taxCode || "—"}</td><td className="row" style={{ gap: 4 }}>{W && <><button className="btn sm" onClick={() => setF({ ...r, account: { id: r.accountId, code: r.accountCode, nameAr: r.accountName, type: r.accountType } })}>تعديل</button><button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { if (!confirmDlg(`حذف قاعدة «${r.name}»؟`)) return; await api(`/bank-rules/${r.id}`, { method: "DELETE" }); reload(); })}>حذف</button></>}</td></tr>)}
        {!data.length && <tr><td colSpan={6}><Empty text="لا توجد قواعد بعد" /></td></tr>}</tbody></table></div>}
      {W && (f ? <div className="form-grid mt" style={{ background: "var(--surface-2)", padding: 12, borderRadius: 10 }}>
        <Field label="اسم القاعدة"><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="رسوم بنكية" /></Field>
        <Field label="إذا احتوى بيان البنك على" hint="كلمة أو أكثر؛ البدائل بفاصلة"><Input value={f.contains} onChange={(e) => setF({ ...f, contains: e.target.value })} placeholder="عمولة، رسوم" /></Field>
        <Field label="الاتجاه"><Select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}><option value="OUT">سحب (خصم من الحساب)</option><option value="IN">إيداع</option><option value="ANY">الاتجاهان</option></Select></Field>
        <Field label="يُسجَّل على حساب" span2><Picker value={f.account} onChange={(a: any) => setF({ ...f, account: a })} fetcher={accountFetcher((a) => !a.isCashBank)} label={(a: any) => `${a.code} ${a.nameAr}`} /></Field>
        {f.account?.type === "EXPENSE" && <Field label="الضريبة" hint="المبلغ في الكشف شامل"><Select value={f.taxCode || "O"} onChange={(e) => setF({ ...f, taxCode: e.target.value })}><option value="S">خاضع (تُستخرج الضريبة)</option><option value="O">خارج النطاق / بلا ضريبة</option><option value="E">معفى</option></Select></Field>}
        <div className="row" style={{ alignItems: "flex-end", gap: 6 }}><button className="btn primary" disabled={busy || !f.name || !f.contains || !f.account} onClick={() => run(async () => { const body = { name: f.name, contains: f.contains, direction: f.direction, accountId: f.account.id, taxCode: f.taxCode, isActive: f.isActive !== false }; if (f.id) await api(`/bank-rules/${f.id}`, { method: "PUT", body }); else await api("/bank-rules", { body }); setF(null); reload(); }, "حُفظت القاعدة")}>حفظ</button><button className="btn" onClick={() => setF(null)}>إلغاء</button></div>
      </div> : <button className="btn primary sm mt" onClick={() => setF(blank)}>＋ قاعدة جديدة</button>)}
    </Modal>}
  </>;
}
export function BankReportBtn({ accountId, to, statementBalance }: { accountId: string; to: string; statementBalance: string }) {
  const { me } = useCompanyContext();
  const [open, setOpen] = useState(false);
  const { data: r } = useFetch<any>(open && accountId ? `/bank/${accountId}/report${q({ to, statementBalance: statementBalance === "" ? undefined : statementBalance })}` : null, [open, accountId, to, statementBalance]);
  const List = ({ title, rows, total, sign }: { title: string; rows: any[]; total: number; sign: string }) => <>
    <tr className="fin-sec"><td colSpan={3}><b>{sign} {title}</b></td><td className="n"><b><Money v={total} /></b></td></tr>
    {rows.map((x) => <tr key={x.id}><td className="dt">{fmtDate(x.date)}</td><td>{x.number || x.reference || ""}</td><td className="small">{x.memo || x.description}</td><td className="n"><Money v={Math.abs(Number(x.amount ?? (Number(x.debit) || Number(x.credit))))} /></td></tr>)}
    {!rows.length && <tr><td colSpan={4} className="muted small">لا يوجد</td></tr>}
  </>;
  return <>
    <button className="btn sm" disabled={!accountId} onClick={() => setOpen(true)}>📑 مذكرة التسوية</button>
    {open && <Modal wide title="مذكرة تسوية البنك" onClose={() => setOpen(false)} footer={<><PrintBtn pdfName="مذكرة تسوية البنك" /><button className="btn" onClick={() => setOpen(false)}>إغلاق</button></>}>
      {!r ? <Loading /> : <div className="print-doc">
        <div className="row between"><div><h3 style={{ margin: 0 }}>مذكرة تسوية البنك</h3><div className="small muted">{me.company.nameAr} · {r.account.code} {r.account.nameAr}{r.account.iban ? ` · ${r.account.iban}` : ""} · حتى {r.to}</div></div><span className={"badge " + (r.reconciled ? "green" : r.difference === null ? "" : "red")}>{r.reconciled ? "مطابق ✓" : r.difference === null ? "أدخل رصيد الكشف" : `فرق ${money(r.difference)}`}</span></div>
        <table className="tbl compact mt fin-stmt"><tbody>
          <tr className="fin-net"><td colSpan={3}>الرصيد حسب كشف البنك{r.statementBalanceFrom === "statement" ? " (من آخر سطر مستورد)" : ""}</td><td className="n">{r.statementBalance === null ? "—" : <Money v={r.statementBalance} />}</td></tr>
          <List title="إيداعات بالطريق (في الدفاتر ولم تظهر في البنك)" rows={r.depositsInTransit.rows} total={r.depositsInTransit.total} sign="+" />
          <List title="مدفوعات وشيكات لم تُصرف بعد" rows={r.outstandingPayments.rows} total={r.outstandingPayments.total} sign="−" />
          <tr className="fin-net"><td colSpan={3}>رصيد البنك المعدَّل</td><td className="n">{r.adjustedBank === null ? "—" : <Money v={r.adjustedBank} />}</td></tr>
          <tr><td colSpan={4} style={{ height: 10 }} /></tr>
          <tr className="fin-net"><td colSpan={3}>الرصيد حسب الدفاتر</td><td className="n"><Money v={r.bookBalance} /></td></tr>
          <List title="حركات في كشف البنك لم تُسجَّل في الدفاتر (رسوم، فوائد، تحويلات)" rows={r.bankOnly.rows} total={r.bankOnly.total} sign="±" />
          <tr className="fin-net"><td colSpan={3}>رصيد الدفاتر المعدَّل</td><td className="n"><Money v={r.adjustedBook} /></td></tr>
          <tr className="fin-net"><td colSpan={3}>الفرق</td><td className={"n " + (r.reconciled ? "pos-val" : "neg-val")}>{r.difference === null ? "—" : <Money v={r.difference} />}</td></tr>
        </tbody></table>
        {r.lastReconciliation && <div className="small muted mt">آخر تسوية معتمدة: {fmtDate(r.lastReconciliation.statementDate)} برصيد {money(r.lastReconciliation.statementBalance)} — {r.lastReconciliation.createdBy}</div>}
        <div className="row between mt small" style={{ gap: 40 }}><span>أعدّها: ........................</span><span>راجعها: ........................</span><span>التاريخ: ........................</span></div>
      </div>}
    </Modal>}
  </>;
}

// ─── cost allocation ─────────────────────────────────────────────────────
export function CostAllocationsPage() {
  const { can } = useCompanyContext();
  const toast = useToast();
  const { run, busy } = useAction();
  const { data, loading, reload } = useFetch<any>("/cost-allocations");
  const [edit, setEdit] = useState<any>(null);
  const [runOf, setRunOf] = useState<any>(null);
  useNewParam(() => setEdit({ name: "", sourceCc: "", targets: [{ costCenterId: "", pct: "" }, { costCenterId: "", pct: "" }] }));
  const W = can("accounting.write"); const ccs = data?.costCenters || [];
  return (
    <div className="grid">
      <div className="card"><div className="card-b row" style={{ gap: 10 }}>
        <div className="grow"><b>توزيع التكاليف المشتركة</b><div className="small muted">انقل مصروفات مركز تكلفة (كالإدارة العامة) أو المصروفات غير الموزعة إلى الفروع والأقسام بنسب تحددها. قيد التوزيع لا يغيّر إجمالي أي حساب — يغيّر مركز التكلفة فقط.</div></div>
        <Link className="btn sm" to="/reports/cost-centers">📊 ربحية مراكز التكلفة</Link>
        {W && <button className="btn primary sm" disabled={ccs.length < 2} title={ccs.length < 2 ? "أضف مركزي تكلفة على الأقل" : ""} onClick={() => setEdit({ name: "", sourceCc: "", targets: [{ costCenterId: "", pct: "" }, { costCenterId: "", pct: "" }] })}>＋ قاعدة توزيع</button>}
      </div></div>
      {loading && !data ? <Loading /> : !data?.rows.length ? <div className="card"><Empty text={ccs.length < 2 ? "أضف مراكز التكلفة أولاً من المصروفات ← مراكز التكلفة، ثم أنشئ قاعدة توزيع" : "لا توجد قواعد توزيع بعد"} /></div> : data.rows.map((a: any) => (
        <div className="card" key={a.id} style={a.isActive ? {} : { opacity: .6 }}><div className="card-h"><div><b>{a.name}</b><div className="small muted">من: {a.sourceName || "المصروفات غير الموزعة على مركز"} ← {a.targets.map((t: any) => `${t.name} ${t.pct}%`).join(" · ")}</div></div>
          {W && <div className="row"><button className="btn primary sm" onClick={() => setRunOf(a)}>▶ تنفيذ لفترة</button><button className="btn sm" onClick={() => setEdit({ ...a, sourceCc: a.sourceCc || "" })}>تعديل</button><button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { if (!confirmDlg(`حذف «${a.name}»؟`)) return; await api(`/cost-allocations/${a.id}`, { method: "DELETE" }); reload(); })}>حذف</button></div>}</div>
          {a.runs.length > 0 && <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الفترة</th><th className="n">المبلغ الموزَّع</th><th>القيد</th><th>نفّذه</th></tr></thead><tbody>{a.runs.map((r: any) => <tr key={r.id}><td className="num">{fmtDate(r.from)} → {fmtDate(r.to)}</td><td className="n"><Money v={r.amount} /></td><td>{r.journalId ? <Link to={`/journals/${r.journalId}`}>{r.number}</Link> : "—"}{r.reversed && <span className="badge red" style={{ marginInlineStart: 6 }}>معكوس</span>}</td><td className="small">{r.by}</td></tr>)}</tbody></table></div>}
        </div>))}
      {edit && <Modal title={edit.id ? "تعديل قاعدة التوزيع" : "قاعدة توزيع جديدة"} onClose={() => setEdit(null)} footer={<><span className="grow">المجموع: <b className={Math.abs(edit.targets.reduce((s: number, t: any) => s + Number(t.pct || 0), 0) - 100) < 0.01 ? "pos-val" : "neg-val"}>{edit.targets.reduce((s: number, t: any) => s + Number(t.pct || 0), 0)}%</b></span><button className="btn" onClick={() => setEdit(null)}>إلغاء</button><button className="btn primary" disabled={busy} onClick={() => run(async () => { const body = { name: edit.name, sourceCc: edit.sourceCc || null, targets: edit.targets.filter((t: any) => t.costCenterId), isActive: true }; if (edit.id) await api(`/cost-allocations/${edit.id}`, { method: "PUT", body }); else await api("/cost-allocations", { body }); setEdit(null); reload(); }, "حُفظت القاعدة")}>حفظ</button></>}>
        <div className="form-grid"><Field label="اسم القاعدة" span2><Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="توزيع مصروفات الإدارة على الفروع" /></Field>
          <Field label="المصدر"><Select value={edit.sourceCc} onChange={(e) => setEdit({ ...edit, sourceCc: e.target.value })}><option value="">المصروفات غير الموزعة على مركز</option>{ccs.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field></div>
        <table className="tbl compact mt"><thead><tr><th>مركز التكلفة المستفيد</th><th style={{ width: 130 }}>النسبة %</th><th /></tr></thead><tbody>{edit.targets.map((t: any, i: number) => <tr key={i}><td><Select value={t.costCenterId} onChange={(e) => setEdit({ ...edit, targets: edit.targets.map((x: any, j: number) => (j === i ? { ...x, costCenterId: e.target.value } : x)) })}><option value="">—</option>{ccs.filter((c: any) => c.id !== edit.sourceCc).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></td><td><NumInput value={t.pct} onChange={(e) => setEdit({ ...edit, targets: edit.targets.map((x: any, j: number) => (j === i ? { ...x, pct: e.target.value } : x)) })} /></td><td>{edit.targets.length > 1 && <button className="btn ghost sm" onClick={() => setEdit({ ...edit, targets: edit.targets.filter((_: any, j: number) => j !== i) })}>✕</button>}</td></tr>)}</tbody></table>
        <button className="btn sm mt" onClick={() => setEdit({ ...edit, targets: [...edit.targets, { costCenterId: "", pct: "" }] })}>＋ مركز</button>
      </Modal>}
      {runOf && <AllocRun alloc={runOf} onClose={(s) => { setRunOf(null); if (s) { reload(); toast("تم ترحيل قيد التوزيع"); } }} />}
    </div>
  );
}
function AllocRun({ alloc, onClose }: { alloc: any; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [from, setFrom] = useState(monthStart()); const [to, setTo] = useState(today());
  const { data: p, error } = useFetch<any>(`/cost-allocations/${alloc.id}/preview${q({ from, to })}`, [from, to]);
  return (
    <Modal wide title={`تنفيذ: ${alloc.name}`} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !p?.accounts.length} onClick={() => run(async () => { await api(`/cost-allocations/${alloc.id}/run`, { body: { from, to } }); onClose(true); })}>ترحيل قيد التوزيع بتاريخ {to}</button></>}>
      <DateRange from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} />
      {error ? <div className="alert err mt">{error}</div> : !p ? <Loading /> : !p.accounts.length ? <div className="alert info mt">لا توجد مصروفات على «{p.allocation.sourceName}» في هذه الفترة — ربما وُزّعت من قبل.</div> : <>
        <div className="kpis mt"><div className="card kpi accent"><div className="label">إجمالي ما سيُوزَّع</div><div className="value num">{money(p.total)}</div><div className="small muted">من {p.allocation.sourceName}</div></div>{p.targets.map((t: any) => <div className="card kpi" key={t.costCenterId}><div className="label">{t.name} ({t.pct}%)</div><div className="value num">{money(t.amount)}</div></div>)}</div>
        <div className="table-wrap mt" style={{ maxHeight: 300 }}><table className="tbl compact"><thead><tr><th>الحساب</th><th className="n">المبلغ</th>{p.targets.map((t: any) => <th key={t.costCenterId} className="n">{t.name}</th>)}</tr></thead><tbody>{p.accounts.map((a: any) => <tr key={a.id}><td>{a.code} {a.name}</td><td className="n"><Money v={a.amount} /></td>{a.shares.map((s: any) => <td key={s.costCenterId} className="n"><Money v={s.amount} /></td>)}</tr>)}</tbody></table></div>
      </>}
    </Modal>
  );
}

// ─── break-even (cost-volume-profit) ─────────────────────────────────────
const BH: Record<string, string> = { VARIABLE: "متغيرة", FIXED: "ثابتة", MIXED: "مختلطة (نصفان)" };
export function CvpPage() {
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const [from, setFrom] = useState(yearStart()); const [to, setTo] = useState(today());
  const [target, setTarget] = useState("");
  const { data: v, loading, reload } = useFetch<any>(`/reports/cvp${q({ from, to, targetProfit: target || undefined })}`, [from, to, target]);
  const W = can("accounting.write");
  const K = ({ l, val, sub, tone }: { l: string; val: React.ReactNode; sub?: React.ReactNode; tone?: string }) => <div className={"card kpi " + (tone || "")}><div className="label">{l}</div><div className="value num">{val}</div>{sub && <div className="small muted">{sub}</div>}</div>;
  return (
    <div className="grid">
      <div className="card no-print"><div className="card-b row" style={{ gap: 10 }}><DateRange from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} /><Field label="ربح مستهدف للفترة"><NumInput value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0" style={{ width: 150 }} /></Field><div className="grow" />{v && <ExportBtn name="تحليل التعادل" rows={() => v.costs.map((c: any) => ({ الرمز: c.code, الحساب: c.name, السلوك: BH[c.behavior], المبلغ: c.amount, متغير: c.variable, ثابت: c.fixed }))} />}<PrintBtn pdfName="تحليل التعادل" /></div></div>
      {loading && !v ? <Loading /> : !v ? <Empty /> : <div className="print-doc grid">
        <div className="kpis">
          <K l="الإيرادات" val={money(v.sales)} tone="accent" />
          <K l="التكاليف المتغيرة" val={money(v.variable)} sub="تتغير مع حجم البيع" />
          <K l="هامش المساهمة" val={<span className={v.contribution < 0 ? "neg-val" : ""}>{money(v.contribution)}</span>} sub={`${v.cmRatio}% من الإيرادات`} />
          <K l="التكاليف الثابتة" val={money(v.fixed)} sub="تُدفع ولو لم تبع" />
          <K l="الربح التشغيلي" val={<span className={v.profit < 0 ? "neg-val" : "pos-val"}>{money(v.profit)}</span>} />
          <K l="نقطة التعادل (مبيعات الفترة)" val={v.breakEven === null ? "—" : money(v.breakEven)} sub={v.breakEven === null ? "هامش المساهمة سالب: كل بيع يزيد الخسارة" : `شهرياً ${money(v.breakEvenMonthly)} · يومياً ${money(v.breakEvenDaily)}`} tone="accent" />
          <K l="هامش الأمان" val={v.safety === null ? "—" : <span className={v.safety < 0 ? "neg-val" : "pos-val"}>{v.safety}%</span>} sub={v.safety === null ? "" : v.safety < 0 ? "المبيعات دون نقطة التعادل" : "ما يمكن أن تهبطه المبيعات قبل الخسارة"} />
          {target && <K l={`مبيعات تحقق ربح ${money(v.targetProfit)}`} val={v.salesForTarget === null ? "—" : money(v.salesForTarget)} sub={v.salesForTarget && v.sales ? `${Math.round((v.salesForTarget / v.sales) * 100)}% من مبيعات الفترة` : ""} />}
        </div>
        <div className="card"><div className="card-b"><div className="ins-list small">
          {v.breakEven !== null ? <>تغطي المنشأة تكاليفها الثابتة عندما تبلغ مبيعاتها <b className="num">{money(v.breakEven)}</b> في الفترة ({v.days} يوماً). كل 100 من المبيعات تترك <b>{v.cmRatio}</b> لتغطية الثابت ثم للربح.{v.operatingLeverage ? <> الرافعة التشغيلية <b>{v.operatingLeverage}</b>: زيادة المبيعات 10% ترفع الربح نحو {Math.round(v.operatingLeverage * 10)}%.</> : null}</> : "هامش المساهمة سالب أو لا توجد مبيعات: راجع التسعير أو تصنيف التكاليف."}
        </div></div></div>
        <div className="card"><div className="card-h"><h3>تصنيف التكاليف</h3><span className="small muted">الافتراضي: تكلفة المبيعات متغيرة والباقي ثابت — عدّل ما يخص نشاطك</span></div>
          <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الحساب</th><th>السلوك</th><th className="n">المبلغ</th><th className="n">متغير</th><th className="n">ثابت</th></tr></thead><tbody>
            {v.costs.map((c: any) => <tr key={c.id}><td>{c.code} {c.name}</td><td>{W ? <Select value={c.behavior} disabled={busy} style={{ width: 160 }} className="no-print" onChange={(e) => run(async () => { await api(`/accounts/${c.id}/cost-behavior`, { method: "PUT", body: { behavior: e.target.value } }); reload(); })}>{Object.entries(BH).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select> : BH[c.behavior]}<span className="print-only">{BH[c.behavior]}</span></td><td className="n"><Money v={c.amount} /></td><td className="n"><Money v={c.variable} blankZero /></td><td className="n"><Money v={c.fixed} blankZero /></td></tr>)}
            {!v.costs.length && <tr><td colSpan={5}><Empty text="لا توجد تكاليف في الفترة" /></td></tr>}</tbody>
            <tfoot><tr><td colSpan={2}>الإجمالي</td><td className="n"><Money v={v.variable + v.fixed} /></td><td className="n"><Money v={v.variable} /></td><td className="n"><Money v={v.fixed} /></td></tr></tfoot></table></div></div>
      </div>}
    </div>
  );
}
void JTYPE_AR; void useEffect;
