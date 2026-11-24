/** 3.43.0 screens: customer/supplier set-off, recipes (ingredients and cost of a dish), the bank file of a payment run. */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, useFetch, Money, money, Loading, Empty, Modal, Field, Input, NumInput, Picker, productFetcher, Tabs, useAction, useToast, useCompanyContext, fmtDate, confirmDlg, today } from "../lib";

// ─── set-off between what a party owes us and what we owe it ─────────────
export function SetoffPage() {
  const { can } = useCompanyContext();
  const cand = useFetch<any>("/setoffs/candidates");
  const list = useFetch<any>("/setoffs");
  const [tab, setTab] = useState("cand");
  const [open, setOpen] = useState<any>(null);
  const { run, busy } = useAction();
  const W = can("accounting.write");
  const reload = () => { cand.reload(); list.reload(); };
  return (
    <div className="grid" data-setoff>
      <div className="alert small">المقاصة لمن هو عميل ومورد معاً: يُخصم ما له عندنا كمورد مما عليه كعميل بقيد واحد (من ح/ الموردين إلى ح/ العملاء) دون حركة نقدية، وتُسدَّد به الفواتير المفتوحة في الجانبين بالأقدم استحقاقاً. يلزم أن يكون الطرف سجلاً واحداً بتصنيفي «عميل» و«مورد».</div>
      <Tabs tabs={[{ key: "cand", label: `يمكن مقاصتهم${cand.data ? ` (${cand.data.rows.length})` : ""}` }, { key: "done", label: "المقاصات المسجلة" }]} value={tab} onChange={setTab} />
      {tab === "cand" && <div className="card">{!cand.data ? <Loading /> : !cand.data.rows.length ? <Empty text="لا يوجد طرف له فواتير مفتوحة كعميل وكمورد في الوقت نفسه" /> : <div className="table-wrap"><table className="tbl" data-setoff-cand>
        <thead><tr><th>الطرف</th><th className="n">عليه كعميل</th><th className="n">له كمورد</th><th className="n">الممكن مقاصته</th><th className="n">الصافي بعدها</th><th /></tr></thead>
        <tbody>{cand.data.rows.map((r: any) => <tr key={r.partnerId}><td><Link to={`/customers/${r.partnerId}`}>{r.name}</Link></td><td className="n"><Money v={r.receivable} /></td><td className="n"><Money v={r.payable} /></td><td className="n"><b><Money v={r.max} /></b></td>
          <td className="n">{r.net >= 0 ? <>عليه <Money v={r.net} /></> : <>له <Money v={-r.net} /></>}</td>
          <td>{W && <button className="btn sm primary" data-setoff-open onClick={() => setOpen(r)}>مقاصة</button>}</td></tr>)}</tbody></table></div>}</div>}
      {tab === "done" && <div className="card">{!list.data ? <Loading /> : !list.data.rows.length ? <Empty text="لم تُسجَّل مقاصات بعد" /> : <div className="table-wrap"><table className="tbl" data-setoff-list>
        <thead><tr><th>الرقم</th><th>التاريخ</th><th>الطرف</th><th className="n">المبلغ</th><th>القيد</th><th>الفواتير</th><th>الحالة</th><th /></tr></thead>
        <tbody>{list.data.rows.map((r: any) => <tr key={r.id}><td className="num"><b>{r.number}</b></td><td className="dt">{fmtDate(r.date)}</td><td>{r.partnerName}</td><td className="n"><Money v={r.amount} /></td>
          <td>{r.journalId ? <Link to={`/journals/${r.journalId}`}>{r.journalNumber}</Link> : "—"}</td>
          <td className="small">{(r.allocations || []).map((a: any) => <span key={a.invoiceId + a.side} style={{ marginInlineEnd: 8 }}><Link to={`/doc/${a.invoiceId}`}>{a.number}</Link> <span className="muted num">{money(a.amount)}</span></span>)}</td>
          <td>{r.status === "POSTED" ? <span className="badge green">مرحّلة</span> : <span className="badge">ملغاة</span>}</td>
          <td>{W && r.status === "POSTED" && <button className="btn sm ghost danger" disabled={busy} data-setoff-cancel onClick={() => { if (confirmDlg(`إلغاء المقاصة ${r.number}؟ يُعكس قيدها وتعود الفواتير مفتوحة.`)) run(async () => { await api(`/setoffs/${r.id}/cancel`, { body: {} }); reload(); }, "أُلغيت المقاصة"); }}>إلغاء</button>}</td></tr>)}</tbody></table></div>}</div>}
      {open && <SetoffModal row={open} onClose={(done) => { setOpen(null); if (done) { reload(); setTab("done"); } }} />}
    </div>
  );
}

function SetoffModal({ row, onClose }: { row: any; onClose: (done?: boolean) => void }) {
  const [amount, setAmount] = useState<any>(row.max);
  const [date, setDate] = useState(today());
  const [memo, setMemo] = useState("");
  const [pv, setPv] = useState<any>(null);
  const { run, busy } = useAction();
  useEffect(() => { let on = true; const h = setTimeout(() => { api("/setoffs/preview", { body: { partnerId: row.partnerId, amount: Number(amount) || 0 } }).then((r) => on && setPv(r)).catch(() => on && setPv(null)); }, 250); return () => { on = false; clearTimeout(h); }; }, [amount, row.partnerId]);
  const amt = Number(amount) || 0, bad = !(amt > 0) || amt > row.max + 0.001;
  return (
    <Modal title={`مقاصة — ${row.name}`} onClose={() => onClose()} wide footer={<><div className="grow" /><button className="btn" onClick={() => onClose()}>إلغاء</button>
      <button className="btn primary" disabled={busy || bad} data-setoff-post onClick={() => run(async () => { await api("/setoffs", { body: { partnerId: row.partnerId, amount: amt, date, memo } }); onClose(true); }, "رُحّلت المقاصة")}>ترحيل المقاصة</button></>}>
      <div className="form-grid">
        <Field label="مبلغ المقاصة" hint={bad ? `الممكن حتى ${money(row.max)}` : `الأقل من: عليه ${money(row.receivable)} وله ${money(row.payable)}`}><NumInput value={amount} onChange={(e: any) => setAmount(e.target.value)} data-setoff-amount /></Field>
        <Field label="التاريخ"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="البيان"><Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="اختياري" /></Field>
      </div>
      {pv && !bad && <>
        <div className="card-h mt"><h3>القيد الذي سيُسجَّل</h3></div>
        <div className="table-wrap"><table className="tbl" data-setoff-entry><thead><tr><th>الحساب</th><th className="n">مدين</th><th className="n">دائن</th></tr></thead>
          <tbody><tr><td>الموردون — {row.name}</td><td className="n"><Money v={amt} /></td><td className="n" /></tr><tr><td>العملاء — {row.name}</td><td className="n" /><td className="n"><Money v={amt} /></td></tr></tbody></table></div>
        <div className="card-h mt"><h3>الفواتير التي تُسدَّد بها</h3></div>
        <div className="table-wrap"><table className="tbl"><thead><tr><th>الجانب</th><th>الفاتورة</th><th className="n">المبلغ</th></tr></thead>
          <tbody>{pv.allocations.map((a: any) => <tr key={a.invoiceId + a.side}><td>{a.side === "AR" ? "مبيعات (عليه)" : "مشتريات (له)"}</td><td className="num">{a.number}</td><td className="n"><Money v={a.amount} /></td></tr>)}</tbody></table></div>
        <div className="small muted mt" data-setoff-after>بعد المقاصة: يبقى عليه كعميل <b>{money(pv.after.receivable)}</b>، ويبقى له كمورد <b>{money(pv.after.payable)}</b>.</div>
      </>}
    </Modal>
  );
}

// ─── recipes ─────────────────────────────────────────────────────────────
export function RecipesPage() {
  const { can } = useCompanyContext();
  const { data, reload } = useFetch<any>("/recipes");
  const [edit, setEdit] = useState<any>(null);
  const [pick, setPick] = useState<any>(null);
  const [tab, setTab] = useState("list");
  const [days, setDays] = useState(30);
  const eng = useFetch<any>(tab === "eng" ? `/recipes/engineering?days=${days}` : null, [tab, days]);
  const W = can("products.write");
  const KL: Record<string, [string, string]> = { STAR: ["⭐ نجم", "green"], PLOWHORSE: ["🐎 يُباع بهامش ضعيف", "amber"], PUZZLE: ["🧩 هامش جيد قليل البيع", "blue"], DOG: ["⚠ ضعيف", "red"], NEW: ["بلا مبيعات", ""] };
  return (
    <div className="grid" data-recipes>
      <div className="alert small">الوصفة تربط الطبق أو الباقة (صنف غير مخزني) بمكوناته المخزنية. عند بيعه من نقطة البيع أو الفاتورة تُخصم المكونات من المخزون، وتكلفة المبيعات هي تكلفة ما خُصم — فيظهر ربح الطبق الحقيقي. المكونات يمكن أن تنزل بالسالب حتى لا يتوقف البيع، وتظهر في تنبيه الأرصدة السالبة.</div>
      {W && <div className="card"><div className="row" style={{ alignItems: "flex-end", gap: 8 }}>
        <div style={{ minWidth: 280, flex: 1 }}><Field label="وصفة جديدة لصنف"><Picker value={pick} onChange={setPick} fetcher={productFetcher} label={(p: any) => `${p.sku || ""} ${p.name}`} placeholder="ابحث عن الطبق أو الباقة" /></Field></div>
        <button className="btn primary" disabled={!pick} data-recipe-new onClick={() => { setEdit(pick); setPick(null); }}>＋ فتح الوصفة</button></div></div>}
      <Tabs tabs={[{ key: "list", label: "الوصفات" }, { key: "eng", label: "هندسة القائمة" }]} value={tab} onChange={setTab} />
      {tab === "eng" && <div className="card" data-menu-eng>
        <div className="row" style={{ gap: 8, alignItems: "center", marginBottom: 10 }}><span className="small muted">الفترة:</span>{[30, 90, 365].map((d) => <button key={d} className={"btn sm" + (days === d ? " primary" : "")} onClick={() => setDays(d)}>{d === 365 ? "سنة" : `${d} يوماً`}</button>)}
          {eng.data && <span className="small muted">ربح الأطباق <b>{money(eng.data.totals.profit)}</b> — متوسط هامش الوحدة <b>{money(eng.data.totals.avgMargin)}</b></span>}</div>
        {!eng.data ? <Loading /> : !eng.data.rows.length ? <Empty text="لا توجد وصفات بعد" /> : <><div className="table-wrap"><table className="tbl" data-menu-eng-table>
          <thead><tr><th>الصنف</th><th className="n">المباع</th><th className="n">حصته %</th><th className="n">هامش الوحدة</th><th className="n">الربح</th><th>التصنيف</th><th>التوصية</th></tr></thead>
          <tbody>{eng.data.rows.map((r: any) => <tr key={r.productId} className="clickable" onClick={() => setEdit({ id: r.productId, name: r.name })}><td><b>{r.name}</b></td><td className="n">{r.soldQty}</td><td className="n">{r.sharePct}%</td><td className="n">{r.unitMargin === null ? "—" : <Money v={r.unitMargin} />}</td><td className="n"><Money v={r.profit} /></td>
            <td><span className={"badge " + KL[r.klass][1]} data-klass={r.klass}>{KL[r.klass][0]}</span></td><td className="small">{r.advice}</td></tr>)}</tbody></table></div>
          <div className="small muted mt">التصنيف بطريقة هندسة القائمة المعروفة: «رائج» إذا بلغت كميته 70% من الحصة المتساوية، و«مربح» إذا بلغ هامش وحدته متوسط هامش الوحدة المباعة.</div></>}
      </div>}
      {tab === "list" && <div className="card">{!data ? <Loading /> : !data.rows.length ? <Empty text="لا توجد وصفات بعد — اختر صنفاً غير مخزني وأضف مكوناته" /> : <div className="table-wrap"><table className="tbl" data-recipe-list>
        <thead><tr><th>الصنف</th><th className="n">المكونات</th><th className="n">تكلفة الوصفة</th><th className="n">سعر البيع</th><th className="n">الهامش</th><th className="n">%</th><th className="n">يكفي المخزون لـ</th></tr></thead>
        <tbody>{data.rows.map((r: any) => <tr key={r.productId} className="clickable" onClick={() => setEdit({ id: r.productId, name: r.name })}><td><b>{r.name}</b></td><td className="n">{r.components}</td><td className="n"><Money v={r.cost} /></td><td className="n"><Money v={r.salePrice} /></td>
          <td className="n">{r.margin === null ? "—" : <Money v={r.margin} />}</td><td className="n">{r.marginPct === null ? "—" : <span className={r.marginPct < 30 ? "neg-val" : ""}>{r.marginPct}%</span>}</td><td className="n">{r.canMake ?? "—"}</td></tr>)}</tbody></table></div>}</div>}
      {edit && <RecipeModal product={edit} canWrite={W} onClose={(ch) => { setEdit(null); if (ch) reload(); }} />}
    </div>
  );
}

export function RecipeModal({ product, canWrite, onClose }: { product: any; canWrite: boolean; onClose: (changed?: boolean) => void }) {
  const { data } = useFetch<any>(`/products/${product.id}/recipe`);
  const [lines, setLines] = useState<any[] | null>(null);
  const [add, setAdd] = useState<any>(null);
  const [target, setTarget] = useState<any>(65);
  const { run, busy } = useAction();
  const toast = useToast();
  useEffect(() => { if (data && lines === null) setLines(data.lines.map((l: any) => ({ ...l }))); }, [data]);
  if (!data || lines === null) return <Modal title={`وصفة — ${product.name}`} onClose={() => onClose()}><Loading /></Modal>;
  const used = (l: any) => (Number(l.qty) || 0) * (1 + (Number(l.wastePct) || 0) / 100);
  const cost = lines.reduce((a, l) => a + used(l) * Number(l.unitCost || 0), 0);
  const tg = Math.min(95, Math.max(0, Number(target) || 0)), suggested = cost > 0 ? cost / (1 - tg / 100) : 0;
  const price = Number(data.salePrice || 0);
  return (
    <Modal title={`وصفة — ${data.name}`} onClose={() => onClose()} wide footer={<><div className="grow" /><button className="btn" onClick={() => onClose()}>إغلاق</button>
      {canWrite && data.canHaveRecipe && <button className="btn primary" disabled={busy || lines.some((l) => !(Number(l.qty) > 0))} data-recipe-save onClick={() => run(async () => { await api(`/products/${product.id}/recipe`, { method: "PUT", body: { lines: lines.map((l) => ({ componentId: l.componentId, qty: Number(l.qty), wastePct: Number(l.wastePct) || 0 })) } }); onClose(true); }, "حُفظت الوصفة")}>حفظ الوصفة</button>}</>}>
      {!data.canHaveRecipe ? <div className="alert warn">هذا صنف مخزني: يُخصم هو نفسه من المخزون عند البيع. الوصفة تكون لصنف غير مخزني (طبق، مشروب محضَّر، باقة).</div> : <>
        {canWrite && <div className="row" style={{ alignItems: "flex-end", gap: 8, marginBottom: 10 }}>
          <div style={{ minWidth: 260, flex: 1 }}><Field label="إضافة مكوّن (صنف مخزني)"><Picker value={add} onChange={(p: any) => { if (!p) return; if (p.type !== "STOCK") { toast("المكوّن يجب أن يكون صنفاً مخزنياً", "err"); return; } if (p.id === product.id || lines.some((l) => l.componentId === p.id)) { toast("المكوّن موجود في الوصفة", "err"); return; } setLines([...lines, { componentId: p.id, name: p.name, sku: p.sku, unit: p.unit, qty: 1, wastePct: 0, unitCost: Number(p.avgCost || p.purchasePrice || 0), onHand: Number(p.qty || 0) }]); setAdd(null); }} fetcher={productFetcher} label={(p: any) => `${p.sku || ""} ${p.name}`} placeholder="ابحث عن المكوّن" /></Field></div></div>}
        {!lines.length ? <Empty text="لا مكونات بعد" /> : <div className="table-wrap"><table className="tbl" data-recipe-lines>
          <thead><tr><th>المكوّن</th><th className="n">الكمية لكل وحدة مباعة</th><th>الوحدة</th><th className="n">هالك %</th><th className="n">تكلفة الوحدة</th><th className="n">التكلفة</th><th className="n">الرصيد</th><th /></tr></thead>
          <tbody>{lines.map((l, i) => <tr key={l.componentId}><td>{l.name}</td><td className="n"><NumInput style={{ width: 110 }} value={l.qty} disabled={!canWrite} onChange={(e: any) => setLines(lines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} data-recipe-qty /></td><td>{l.unit}</td><td className="n"><NumInput style={{ width: 80 }} value={l.wastePct ?? 0} disabled={!canWrite} onChange={(e: any) => setLines(lines.map((x, j) => j === i ? { ...x, wastePct: e.target.value } : x))} data-recipe-waste /></td><td className="n"><Money v={l.unitCost} /></td><td className="n"><Money v={used(l) * Number(l.unitCost || 0)} /></td><td className="n">{l.onHand}</td>
            <td>{canWrite && <button className="btn sm ghost danger" onClick={() => setLines(lines.filter((_, j) => j !== i))}>حذف</button>}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={5}>تكلفة الوصفة</td><td className="n" data-recipe-cost><Money v={cost} /></td><td colSpan={2} /></tr></tfoot></table></div>}
        <div className="small muted mt">سعر البيع {money(price)}{price > 0 && <> — الهامش <b>{money(price - cost)}</b> ({Math.round(((price - cost) / price) * 1000) / 10}%)</>}. التكلفة بمتوسط تكلفة المخزون الحالي، وعند البيع تُحتسب بتكلفة ما يُخصم فعلاً.</div>
        {cost > 0 && <div className="row mt" style={{ gap: 8, alignItems: "center" }} data-recipe-suggest><span className="small">لهامش مستهدف</span><NumInput style={{ width: 80 }} value={target} onChange={(e: any) => setTarget(e.target.value)} data-recipe-target /><span className="small">% يكون سعر البيع قبل الضريبة <b data-recipe-price>{money(suggested)}</b>{price > 0 && <> ({suggested > price + 0.005 ? `أعلى من الحالي بـ ${money(suggested - price)}` : `الحالي يحققه`})</>}</span></div>}
      </>}
    </Modal>
  );
}

// ─── bank file of an approved payment run ────────────────────────────────
export function BankFileBtn({ runId }: { runId: string }) {
  const { run, busy } = useAction();
  const toast = useToast();
  const get = (fmt: "csv" | "xml") => run(async () => {
    const r = await api(`/payment-runs/${runId}/bank-file`);
    if (!r.count) { toast("لا مورد في الدفعة له آيبان — أضِف الآيبان في بيانات المورد", "err"); return; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([fmt === "xml" ? r.xml : r.csv], { type: fmt === "xml" ? "application/xml" : "text/csv;charset=utf-8" })); a.download = fmt === "xml" ? r.xmlFilename : r.filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(r.missing.length ? `صدر الملف بـ${r.count} تحويل. بلا آيبان: ${r.missing.join("، ")}` : `صدر ملف البنك بـ${r.count} تحويل`);
  });
  return <><button className="btn ghost" disabled={busy} data-run-bankfile onClick={() => get("csv")}>ملف البنك</button><button className="btn ghost" disabled={busy} data-run-bankxml title="المعيار الدولي للتحويلات المجمّعة pain.001" onClick={() => get("xml")}>ملف البنك ISO 20022</button></>;
}
