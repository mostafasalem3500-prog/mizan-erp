/** 3.43.0 screens: customer/supplier set-off, recipes (ingredients and cost of a dish), the bank file of a payment run. */
import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
  const [sp, setSp] = useSearchParams();
  const tab = ["preps", "batches", "eng", "guide", "cost"].includes(sp.get("tab") || "") ? String(sp.get("tab")) : "list";
  const setTab = (k: string) => setSp(k === "list" ? {} : { tab: k });
  const [days, setDays] = useState(30);
  const eng = useFetch<any>(tab === "eng" ? `/recipes/engineering?days=${days}` : null, [tab, days]);
  const preps = useFetch<any>(tab === "preps" ? "/preps" : null, [tab]);
  const batches = useFetch<any>(tab === "batches" ? "/prep-batches" : null, [tab]);
  const [cook, setCook] = useState<any>(null);
  const { run, busy } = useAction();
  const toast = useToast();
  const IW = can("inventory.write");
  const reloadAll = () => { reload(); preps.reload(); batches.reload(); };
  const W = can("products.write");
  const KL: Record<string, [string, string]> = { STAR: ["⭐ نجم", "green"], PLOWHORSE: ["🐎 يُباع بهامش ضعيف", "amber"], PUZZLE: ["🧩 هامش جيد قليل البيع", "blue"], DOG: ["⚠ ضعيف", "red"], NEW: ["بلا مبيعات", ""] };
  return (
    <div className="grid" data-recipes>
      {(tab === "list" || tab === "preps") && <>
      <div className="alert small">الوصفة تربط الطبق أو الباقة (صنف غير مخزني) بمكوناته المخزنية. عند بيعه من نقطة البيع أو الفاتورة تُخصم المكونات من المخزون، وتكلفة المبيعات هي تكلفة ما خُصم — فيظهر ربح الطبق الحقيقي. المكونات يمكن أن تنزل بالسالب حتى لا يتوقف البيع، وتظهر في تنبيه الأرصدة السالبة.</div>
      {W && <div className="card"><div className="row" style={{ alignItems: "flex-end", gap: 8 }}>
        <div style={{ minWidth: 280, flex: 1 }}><Field label="فتح وصفة صنف (طبق أو تحضيرة)"><Picker value={pick} onChange={setPick} fetcher={productFetcher} label={(p: any) => `${p.sku || ""} ${p.name}`} placeholder="ابحث عن الطبق أو الباقة" /></Field></div>
        <button className="btn primary" disabled={!pick} data-recipe-new onClick={() => { setEdit(pick); setPick(null); }}>＋ فتح الوصفة</button></div></div>}
      </>}
      <Tabs tabs={[{ key: "list", label: "الوصفات" }, { key: "preps", label: "التحضيرات" }, { key: "batches", label: "الطبخات (التصنيع)" }, { key: "cost", label: "تقرير تكاليف الطعام" }, { key: "eng", label: "هندسة القائمة" }, { key: "guide", label: "كيف تُحسب التكلفة؟" }]} value={tab} onChange={setTab} />
      {tab === "cost" && <FoodCostReport onOpen={(r) => setEdit({ id: r.productId, name: r.name })} />}
      {tab === "preps" && <div className="card" data-preps>{!preps.data ? <Loading /> : !preps.data.rows.length ? <Empty text="لا تحضيرات بعد — التحضيرة صنف مخزني له وصفة (مثل الشاورما المطبوخة أو الثومية). افتح وصفتها من الأعلى، أو حمّل مثال الشاورما من تبويب «كيف تُحسب التكلفة؟»" /> : <div className="table-wrap"><table className="tbl" data-prep-list>
        <thead><tr><th>التحضيرة</th><th>الطريقة</th><th className="n">وزن المدخلات</th><th className="n">الناتج</th><th className="n">نسبة الناتج</th><th className="n">تكلفة الوحدة</th><th className="n">الرصيد</th><th /></tr></thead>
        <tbody>{preps.data.rows.map((r: any) => <tr key={r.productId} className="clickable" onClick={() => setEdit({ id: r.productId, name: r.name })}><td><b>{r.name}</b></td><td><span className={"badge " + (r.method === "BATCH" ? "teal" : "blue")} data-prep-method={r.method}>{r.method === "BATCH" ? "طبخة (تصنيع)" : "خصم مباشر"}</span></td><td className="n">{r.inputTotal}</td><td className="n">{r.outputQty} {r.unit}</td><td className="n">{r.yieldPct}%</td><td className="n"><Money v={r.cost} /></td><td className="n">{r.method === "BATCH" ? r.onHand : "—"}</td>
          <td onClick={(e) => e.stopPropagation()}>{IW && r.method === "BATCH" && <button className="btn sm primary" data-prep-cook onClick={() => setCook(r)}>طبخة جديدة</button>}</td></tr>)}</tbody></table></div>}</div>}
      {tab === "batches" && <div className="card" data-batches-tab>{!batches.data ? <Loading /> : !batches.data.rows.length ? <Empty text="لا طبخات بعد — من تبويب «التحضيرات» اضغط «طبخة جديدة» على تحضيرة بطريقة الطبخة" /> : <div className="table-wrap"><table className="tbl" data-batch-list>
        <thead><tr><th>الرقم</th><th>التاريخ</th><th>التحضيرة</th><th className="n">المدخلات</th><th className="n">المتوقع</th><th className="n">الناتج الفعلي</th><th className="n">الفرق</th><th className="n">النسبة</th><th className="n">التكلفة</th><th className="n">تكلفة الوحدة</th><th>الحالة</th><th /></tr></thead>
        <tbody>{batches.data.rows.map((r: any) => <tr key={r.id}><td className="num"><b>{r.number}</b></td><td className="dt">{fmtDate(r.date)}</td><td>{r.name}</td><td className="n">{r.inputQty}</td><td className="n">{r.expectedQty}</td><td className="n">{r.outputQty} {r.unit}</td><td className="n"><span className={r.variance < -0.0005 ? "neg-val" : ""}>{r.variance}</span></td><td className="n">{r.yieldPct}%</td><td className="n"><Money v={r.cost} /></td><td className="n"><Money v={r.unitCost} /></td>
          <td>{r.status === "POSTED" ? <span className="badge green">مرحّلة</span> : <span className="badge">ملغاة</span>}</td>
          <td>{IW && r.status === "POSTED" && <button className="btn sm ghost danger" disabled={busy} data-batch-cancel onClick={() => { if (confirmDlg(`إلغاء الطبخة ${r.number}؟ تعود المكونات للمخزون ويخرج منها الناتج (يلزم أن يكون ما زال في المخزون).`)) run(async () => { await api(`/prep-batches/${r.id}/cancel`, { body: {} }); reloadAll(); }, "أُلغيت الطبخة"); }}>إلغاء</button>}</td></tr>)}</tbody></table></div>}</div>}
      {tab === "guide" && <div className="card" data-cost-guide>
        <div className="card-h"><h3>تكاليف المطاعم والمقاهي: من المادة الخام إلى الطبق</h3></div>
        <p>مثال الشاورما يمر بثلاث مراحل، وكل مرحلة لها وصفتها:</p>
        <ol className="small" style={{ lineHeight: 1.9 }}>
          <li><b>الوصفة الأولية (التتبيلة):</b> 10 كجم صدور دجاج + 0.5 بهارات + 1 زبادي + 0.5 زيت = <b>12 كجم مدخلات</b> بتكلفة 233 ← 12 كجم شاورما متبّلة.</li>
          <li><b>الوصفة النهائية (المطبوخة):</b> 12 كجم متبّلة تعطي <b>7.8 كجم مطبوخة</b> (نسبة الناتج 65%) ← تكلفة الكيلو المطبوخ 233 ÷ 7.8 = 29.87.</li>
          <li><b>المنتج النهائي (الساندوتش):</b> 120 جم شاورما مطبوخة (وصفة) + 30 جم ثومية (وصفة) + رغيف خبز + 20 جم مخلل (مواد خام) ← تكلفة الساندوتش ≈ 4.52.</li>
        </ol>
        <p>ولكل تحضيرة تختار واحدة من طريقتين:</p>
        <div className="grid c2">
          <div className="alert small"><b>١) طريقة الطبخة (التصنيع)</b><br />تسجّل «طبخة» بوزن المدخلات الفعلي والناتج الفعلي: تخرج المواد الخام من المخزون وتدخل التحضيرة بتكلفتها. البيع يخصم من التحضيرة. تظهر <b>نسبة الناتج الحقيقية</b> والفرق عن المعيار، وتكلفة الساندوتش تتبع ما خرج فعلاً. تناسب السيخ والصوصات التي تُحضَّر بكميات.</div>
          <div className="alert small"><b>٢) طريقة الخصم المباشر</b><br />لا تسجّل طبخات. عند بيع الساندوتش يُفكّ إلى مواده الخام بنسبة الناتج المعيارية وتُخصم مباشرة (120 جم مطبوخة = 154 جم دجاج خام…). أبسط في التشغيل، لكن الهالك الفعلي لا يظهر إلا عند الجرد.</div>
        </div>
        <p className="small muted">في الطريقتين القيد واحد عند البيع: من ح/ تكلفة البضاعة المباعة إلى ح/ المخزون. الطبخة نفسها لا قيد لها لأن القيمة تنتقل داخل المخزون من المواد الخام إلى التحضيرة.</p>
        {W && <button className="btn primary" disabled={busy} data-load-example onClick={() => { if (confirmDlg("تحميل مثال الشاورما؟ يضيف أصنافاً ومورداً وفاتورة مشتريات وطبخة مُعلَّمة كبيانات تجريبية (تُحذف من الإعدادات ← البيانات التجريبية).")) run(async () => { await api("/preps/example", { body: {} }); reloadAll(); setTab("preps"); }, "حُمّل مثال الشاورما"); }}>تحميل مثال الشاورما بأرقامه</button>}
      </div>}
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
      {edit && <RecipeModal product={edit} canWrite={W} onClose={(ch) => { setEdit(null); if (ch) reloadAll(); }} />}
      {cook && <BatchModal prep={cook} onClose={(done) => { setCook(null); if (done) { reloadAll(); setTab("batches"); } }} />}
    </div>
  );
}

export function RecipeModal({ product, canWrite, onClose }: { product: any; canWrite: boolean; onClose: (changed?: boolean) => void }) {
  const { data } = useFetch<any>(`/products/${product.id}/recipe`);
  const [lines, setLines] = useState<any[] | null>(null);
  const [add, setAdd] = useState<any>(null);
  const [target, setTarget] = useState<any>(65);
  const variants = useFetch<any>(`/products/${product.id}/variant-costs`);
  const [output, setOutput] = useState<any>("");
  const [method, setMethod] = useState("BATCH");
  const { run, busy } = useAction();
  const toast = useToast();
  useEffect(() => { if (data && lines === null) { setLines(data.lines.map((l: any) => ({ ...l }))); if (data.isPrep && data.lines.length) { setOutput(data.outputQty); setMethod(data.method || "BATCH"); } } }, [data]);
  if (!data || lines === null) return <Modal title={`وصفة — ${product.name}`} onClose={() => onClose()}><Loading /></Modal>;
  const inSum = (lines || []).reduce((a, l) => a + (Number(l.qty) || 0), 0);
  const used = (l: any) => (Number(l.qty) || 0) * (1 + (Number(l.wastePct) || 0) / 100);
  const cost = lines.reduce((a, l) => a + used(l) * Number(l.unitCost || 0), 0);
  const tg = Math.min(95, Math.max(0, Number(target) || 0)), suggested = cost > 0 ? cost / (1 - tg / 100) : 0;
  const price = Number(data.salePrice || 0);
  return (
    <Modal title={`وصفة — ${data.name}`} onClose={() => onClose()} wide footer={<><div className="grow" /><button className="btn" onClick={() => onClose()}>إغلاق</button>
      {canWrite && data.canHaveRecipe && <button className="btn primary" disabled={busy || lines.some((l) => !(Number(l.qty) > 0)) || (data.isPrep && lines.length > 0 && !(Number(output) > 0))} data-recipe-save onClick={() => run(async () => { await api(`/products/${product.id}/recipe`, { method: "PUT", body: { lines: lines.map((l) => ({ componentId: l.componentId, qty: Number(l.qty), wastePct: Number(l.wastePct) || 0 })), outputQty: Number(output) || 0, method } }); onClose(true); }, "حُفظت الوصفة")}>حفظ الوصفة</button>}</>}>
      {<>
        {data.isPrep && <div data-prep-head><div className="alert small" style={{ marginBottom: 10 }}>هذا صنف مخزني، فوصفته <b>تحضيرة</b>: اكتب مكونات <b>الطبخة الواحدة كاملة</b> (بالوزن)، ثم كم تعطي من هذا الصنف. نسبة الناتج تُحسب من وزن المدخلات.</div>
          <div className="form-grid">
            <Field label={`ناتج الطبخة (${data.unit || ""})`} hint={inSum > 0 && Number(output) > 0 ? `وزن المدخلات ${Math.round(inSum * 1000) / 1000} ← نسبة الناتج ${Math.round((Number(output) / inSum) * 1000) / 10}%` : "كم تعطي هذه المكونات بعد التحضير"}><NumInput value={output} disabled={!canWrite} onChange={(e: any) => setOutput(e.target.value)} data-prep-output /></Field>
            <Field label="أو نسبة الناتج %" hint="تُحسب الناتج من وزن المدخلات"><NumInput value={inSum > 0 && Number(output) > 0 ? Math.round((Number(output) / inSum) * 1000) / 10 : ""} disabled={!canWrite || !(inSum > 0)} onChange={(e: any) => setOutput(Math.round(inSum * (Number(e.target.value) || 0) * 100) / 10000)} data-prep-yield /></Field>
            <Field label="طريقة التكلفة" hint={method === "BATCH" ? "تُسجَّل طبخات تُدخل الصنف للمخزون، والبيع يخصم منه" : "لا يُخزَّن: البيع يخصم مواده الخام مباشرة بنسبة الناتج"}><select className="input" value={method} disabled={!canWrite} onChange={(e) => setMethod(e.target.value)} data-prep-method-select><option value="BATCH">الطبخة (التصنيع)</option><option value="DIRECT">الخصم المباشر</option></select></Field>
          </div></div>}
        {canWrite && <div className="row" style={{ alignItems: "flex-end", gap: 8, marginBottom: 10 }}>
          <div style={{ minWidth: 260, flex: 1 }}><Field label="إضافة مكوّن (صنف مخزني)"><Picker value={add} onChange={(p: any) => { if (!p) return; if (p.type !== "STOCK") { toast("المكوّن يجب أن يكون صنفاً مخزنياً", "err"); return; } if (p.id === product.id || lines.some((l) => l.componentId === p.id)) { toast("المكوّن موجود في الوصفة", "err"); return; } setLines([...lines, { componentId: p.id, name: p.name, sku: p.sku, unit: p.unit, qty: 1, wastePct: 0, unitCost: Number(p.avgCost || p.purchasePrice || 0), onHand: Number(p.qty || 0) }]); setAdd(null); }} fetcher={productFetcher} label={(p: any) => `${p.sku || ""} ${p.name}`} placeholder="ابحث عن المكوّن" /></Field></div></div>}
        {!lines.length ? <Empty text="لا مكونات بعد" /> : <div className="table-wrap"><table className="tbl" data-recipe-lines>
          <thead><tr><th>المكوّن</th><th className="n">{data.isPrep ? "الكمية في الطبخة" : "الكمية لكل وحدة مباعة"}</th><th>الوحدة</th><th className="n">هالك %</th><th className="n">تكلفة الوحدة</th><th className="n">التكلفة</th><th className="n">الرصيد</th><th /></tr></thead>
          <tbody>{lines.map((l, i) => <tr key={l.componentId}><td>{l.name}{l.kind && l.kind !== "RAW" && <span className={"badge " + (l.kind === "PREP_BATCH" ? "teal" : "blue")} style={{ marginInlineStart: 6 }}>{l.kind === "PREP_BATCH" ? "تحضيرة: طبخة" : "تحضيرة: خصم مباشر"}</span>}</td><td className="n"><NumInput style={{ width: 110 }} value={l.qty} disabled={!canWrite} onChange={(e: any) => setLines(lines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} data-recipe-qty /></td><td>{l.unit}</td><td className="n"><NumInput style={{ width: 80 }} value={l.wastePct ?? 0} disabled={!canWrite} onChange={(e: any) => setLines(lines.map((x, j) => j === i ? { ...x, wastePct: e.target.value } : x))} data-recipe-waste /></td><td className="n"><Money v={l.unitCost} /></td><td className="n"><Money v={used(l) * Number(l.unitCost || 0)} /></td><td className="n">{l.onHand}</td>
            <td>{canWrite && <button className="btn sm ghost danger" onClick={() => setLines(lines.filter((_, j) => j !== i))}>حذف</button>}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={5}>{data.isPrep ? "تكلفة الطبخة" : "تكلفة الوصفة"}</td><td className="n" data-recipe-cost><Money v={cost} /></td><td colSpan={2} /></tr>
            {data.isPrep && Number(output) > 0 && <tr><td colSpan={5}>تكلفة الوحدة ({data.unit}) = تكلفة الطبخة ÷ الناتج</td><td className="n" data-prep-unitcost><Money v={cost / Number(output)} /></td><td colSpan={2} /></tr>}</tfoot></table></div>}
        {!data.isPrep && <div className="small muted mt">سعر البيع {money(price)}{price > 0 && <> — الهامش <b>{money(price - cost)}</b> ({Math.round(((price - cost) / price) * 1000) / 10}%)</>}. التكلفة بمتوسط تكلفة المخزون الحالي، وعند البيع تُحتسب بتكلفة ما يُخصم فعلاً.</div>}
        {!data.isPrep && variants.data?.rows?.length > 0 && <div data-variant-costs><div className="card-h mt"><h3>تكلفة كل حجم وكل إضافة</h3></div>
          <div className="table-wrap"><table className="tbl compact"><thead><tr><th>المجموعة</th><th>الخيار</th><th>يخصم</th><th className="n">التكلفة</th><th className="n">السعر</th><th className="n">الهامش</th><th style={{ width: 150 }}>نسبة التكلفة</th></tr></thead>
            <tbody>{variants.data.rows.map((v: any, i: number) => <tr key={i}><td className="muted">{v.group}</td><td><b>{v.option}</b></td><td className="small">{v.kind === "SIZE" ? `الوصفة × ${v.factor}` : ""}{v.component ? `${v.kind === "SIZE" ? " + " : ""}${v.componentQty} ${v.component}` : v.kind === "ADDON" ? "—" : ""}</td><td className="n"><Money v={v.cost} /></td><td className="n"><Money v={v.price} /></td><td className="n"><Money v={v.margin} /></td><td><PctBar v={v.costPct} target={30} /></td></tr>)}</tbody></table></div>
          <div className="small muted">الحجم = تكلفة الوصفة × معامله، وسعره = سعر الصنف + سعره الإضافي. الإضافة تُحسب بمكوّنها وحده. تُضبط من «الإضافات ورسوم الخدمة».</div></div>}
        {!data.isPrep && cost > 0 && <div className="row mt" style={{ gap: 8, alignItems: "center" }} data-recipe-suggest><span className="small">لهامش مستهدف</span><NumInput style={{ width: 80 }} value={target} onChange={(e: any) => setTarget(e.target.value)} data-recipe-target /><span className="small">% يكون سعر البيع قبل الضريبة <b data-recipe-price>{money(suggested)}</b>{price > 0 && <> ({suggested > price + 0.005 ? `أعلى من الحالي بـ ${money(suggested - price)}` : `الحالي يحققه`})</>}</span></div>}
      </>}
    </Modal>
  );
}

// ─── food-cost report ────────────────────────────────────────────────────
/** A thin bar for a cost percentage: green under the target, amber near it, red above. */
export function PctBar({ v, target }: { v: number | null; target: number }) {
  if (v === null || v === undefined) return <span className="muted">—</span>;
  const lvl = v <= target ? "good" : v <= target + 8 ? "watch" : "high";
  return <div className={"pct-bar " + lvl} title={`${v}%`}><span style={{ width: Math.min(100, Math.max(2, v)) + "%" }} /><i style={{ insetInlineStart: Math.min(100, target) + "%" }} /><b className="num">{v}%</b></div>;
}
function FoodCostReport({ onOpen }: { onOpen: (r: any) => void }) {
  const { can } = useCompanyContext();
  const [range, setRange] = useState({ from: today().slice(0, 8) + "01", to: today() });
  const { data, reload } = useFetch<any>(`/restaurant/food-cost?from=${range.from}&to=${range.to}`, [range.from, range.to]);
  const { run } = useAction();
  const [view, setView] = useState("dishes");
  if (!data) return <div className="card"><Loading /></div>;
  const T = data.totals, lvl = T.costPct === null ? "none" : T.costPct <= data.target ? "good" : T.costPct <= data.target + 8 ? "watch" : "high";
  const maxDay = Math.max(1, ...data.days.map((d: any) => d.revenue));
  const maxIng = Math.max(1, ...data.ingredients.map((d: any) => d.soldValue + d.cookedValue + d.lostValue));
  return (
    <div className="grid" data-food-cost>
      <div className="card"><div className="row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <Field label="من"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
        <Field label="إلى"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
        <Field label="النسبة المستهدفة لتكلفة الطعام %"><NumInput style={{ width: 110 }} defaultValue={data.target} disabled={!can("settings.write")} data-fc-target onBlur={(e: any) => { const v = Number(e.target.value); if (v && v !== data.target) run(async () => { await api("/restaurant/food-cost-target", { method: "PUT", body: { target: v } }); reload(); }, "حُفظت النسبة المستهدفة"); }} /></Field>
        <div className="grow" /><button className="btn ghost" onClick={() => window.print()}>طباعة</button>
      </div></div>
      <div className="fc-hero">
        <div className={"fc-gauge " + lvl} data-fc-gauge>
          <svg viewBox="0 0 120 70" aria-hidden="true"><path d="M10 60 A50 50 0 0 1 110 60" className="trk" /><path d="M10 60 A50 50 0 0 1 110 60" className="val" style={{ strokeDasharray: `${Math.min(100, T.costPct || 0) * 1.571} 400` }} /></svg>
          <div className="fc-gauge-v"><b className="num">{T.costPct === null ? "—" : T.costPct + "%"}</b><span>تكلفة الطعام من المبيعات</span><small>المستهدف {data.target}% — {lvl === "good" ? "ضمن المستهدف ✓" : lvl === "watch" ? "قريبة من الحد" : lvl === "high" ? "أعلى من المستهدف" : "لا مبيعات"}</small></div>
        </div>
        <div className="fc-kpis">
          <div className="fc-kpi"><span>مبيعات الأطباق</span><b className="num">{money(T.revenue)}</b></div>
          <div className="fc-kpi"><span>تكلفة ما خرج من المخزن</span><b className="num">{money(T.cost)}</b></div>
          <div className="fc-kpi good"><span>مجمل ربح الأطباق</span><b className="num">{money(T.profit)}</b></div>
          <div className={"fc-kpi" + (T.waste > 0 ? " high" : "")}><span>هالك وتسويات مخزون</span><b className="num">{money(T.waste)}</b><small>{T.wastePct === null ? "" : `${T.wastePct}% من المبيعات — مع الهالك ${T.costWithWastePct}%`}</small></div>
          <div className="fc-kpi"><span>الطبخات</span><b className="num">{T.batches}</b><small>{T.yieldVsStandardPct === null ? "لا طبخات في الفترة" : `الناتج ${T.yieldVsStandardPct}% من المعياري`}</small></div>
          <div className="fc-kpi"><span>أصناف مباعة</span><b className="num">{T.dishes}</b></div>
        </div>
      </div>
      {data.days.length > 1 && <div className="card"><div className="card-h"><h3>المبيعات والتكلفة يومياً</h3></div>
        <div className="fc-days" data-fc-days>{data.days.map((d: any) => <div key={d.date} className="fc-day" title={`${fmtDate(d.date)} — مبيعات ${money(d.revenue)}، تكلفة ${money(d.cost)} (${d.costPct ?? "—"}%)`}><div className="col"><span className="rev" style={{ height: (d.revenue / maxDay) * 100 + "%" }} /><span className="cst" style={{ height: (d.cost / maxDay) * 100 + "%" }} /></div><small className="num">{d.date.slice(8)}</small></div>)}</div>
        <div className="small muted"><span className="fc-dot rev" /> المبيعات <span className="fc-dot cst" /> التكلفة</div></div>}
      <Tabs tabs={[{ key: "dishes", label: `الأصناف والأحجام (${data.dishes.length})` }, { key: "cats", label: "التصنيفات" }, { key: "ing", label: `المكونات وأين ذهبت (${data.ingredients.length})` }]} value={view} onChange={setView} />
      {view === "dishes" && <div className="card">{!data.dishes.length ? <Empty text="لا مبيعات لأصناف لها وصفة في هذه الفترة" /> : <div className="table-wrap"><table className="tbl" data-fc-dishes>
        <thead><tr><th>الصنف</th><th>الحجم / الإضافات</th><th className="n">المباع</th><th className="n">سعر الوحدة</th><th className="n">تكلفة الوحدة</th><th className="n">المبيعات</th><th className="n">التكلفة</th><th className="n">الربح</th><th style={{ width: 170 }}>نسبة التكلفة</th></tr></thead>
        <tbody>{data.dishes.map((r: any, i: number) => <tr key={i} className="clickable" onClick={() => onOpen(r)}><td><b>{r.name}</b><div className="small muted">{r.category}</div></td><td>{r.variant || <span className="muted">—</span>}</td><td className="n">{r.qty}</td><td className="n">{r.unitPrice === null ? "—" : <Money v={r.unitPrice} />}</td><td className="n">{r.unitCost === null ? "—" : <Money v={r.unitCost} />}</td><td className="n"><Money v={r.revenue} /></td><td className="n"><Money v={r.cost} /></td><td className="n"><Money v={r.profit} /></td><td><PctBar v={r.costPct} target={data.target} /></td></tr>)}</tbody>
        <tfoot><tr><td colSpan={5}>الإجمالي</td><td className="n"><Money v={T.revenue} /></td><td className="n"><Money v={T.cost} /></td><td className="n"><Money v={T.profit} /></td><td><PctBar v={T.costPct} target={data.target} /></td></tr></tfoot></table></div>}</div>}
      {view === "cats" && <div className="card">{!data.categories.length ? <Empty /> : <div className="table-wrap"><table className="tbl" data-fc-cats>
        <thead><tr><th>التصنيف</th><th className="n">المبيعات</th><th className="n">التكلفة</th><th className="n">الربح</th><th style={{ width: 200 }}>نسبة التكلفة</th></tr></thead>
        <tbody>{data.categories.map((r: any) => <tr key={r.category}><td><b>{r.category}</b></td><td className="n"><Money v={r.revenue} /></td><td className="n"><Money v={r.cost} /></td><td className="n"><Money v={r.profit} /></td><td><PctBar v={r.costPct} target={data.target} /></td></tr>)}</tbody></table></div>}</div>}
      {view === "ing" && <div className="card">{!data.ingredients.length ? <Empty text="لا حركة على المكونات في هذه الفترة" /> : <><div className="table-wrap"><table className="tbl" data-fc-ing>
        <thead><tr><th>المكوّن</th><th className="n">المشترى</th><th className="n">خرج للبيع</th><th className="n">دخل في طبخات</th><th className="n">هالك وتسويات</th><th className="n">الرصيد الآن</th><th className="n">قيمة المستهلك</th><th style={{ width: 160 }}>توزيعه</th></tr></thead>
        <tbody>{data.ingredients.map((r: any) => { const tot = r.soldValue + r.cookedValue + r.lostValue; return <tr key={r.productId}><td><b>{r.name}</b> <span className="small muted">{r.unit}</span></td><td className="n">{r.boughtQty || "—"}</td><td className="n">{r.soldQty || "—"}</td><td className="n">{r.cookedQty || (r.madeQty ? <span className="pos-val">+{r.madeQty}</span> : "—")}</td><td className="n">{r.lostQty ? <span className="neg-val">{r.lostQty}</span> : "—"}</td><td className="n">{r.onHand < 0 ? <span className="neg-val">{r.onHand}</span> : r.onHand}</td><td className="n"><Money v={tot} /></td>
          <td><div className="fc-split" title={`بيع ${money(r.soldValue)} · طبخات ${money(r.cookedValue)} · هالك ${money(r.lostValue)}`} style={{ width: Math.max(4, (tot / maxIng) * 100) + "%" }}><span className="s" style={{ flex: r.soldValue }} /><span className="k" style={{ flex: r.cookedValue }} /><span className="l" style={{ flex: r.lostValue }} /></div></td></tr>; })}</tbody></table></div>
        <div className="small muted mt"><span className="fc-dot s" /> خرج للبيع <span className="fc-dot k" /> دخل في طبخات <span className="fc-dot l" /> هالك وتسويات — الأرقام من كرت الصنف في المخزن.</div></>}</div>}
    </div>
  );
}

// ─── a production batch (طبخة) ──────────────────────────────────────────
function BatchModal({ prep, onClose }: { prep: any; onClose: (done?: boolean) => void }) {
  const [input, setInput] = useState<any>(prep.inputTotal);
  const [out, setOut] = useState<any>("");
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [pv, setPv] = useState<any>(null);
  const { run, busy } = useAction();
  useEffect(() => { let on = true; const h = setTimeout(() => { api("/prep-batches/preview", { body: { productId: prep.productId, inputQty: Number(input) || 0, outputQty: out === "" ? undefined : Number(out) } }).then((r) => on && setPv(r)).catch(() => on && setPv(null)); }, 250); return () => { on = false; clearTimeout(h); }; }, [input, out, prep.productId]);
  const bad = !(Number(input) > 0) || (out !== "" && !(Number(out) > 0));
  return (
    <Modal title={`طبخة جديدة — ${prep.name}`} onClose={() => onClose()} wide footer={<><div className="grow" /><button className="btn" onClick={() => onClose()}>إلغاء</button>
      <button className="btn primary" disabled={busy || bad || !pv} data-batch-post onClick={() => run(async () => { await api("/prep-batches", { body: { productId: prep.productId, inputQty: Number(input), outputQty: out === "" ? undefined : Number(out), date, notes } }); onClose(true); }, "رُحّلت الطبخة")}>ترحيل الطبخة</button></>}>
      <div className="form-grid">
        <Field label="وزن المدخلات الإجمالي" hint={`الوصفة المعيارية ${prep.inputTotal} ← ${prep.outputQty} ${prep.unit || ""}. اكتب الوزن الذي ستحضّره فتتناسب المكونات معه`}><NumInput value={input} onChange={(e: any) => setInput(e.target.value)} data-batch-input /></Field>
        <Field label={`الناتج الفعلي (${prep.unit || ""})`} hint={pv ? `المتوقع بالمعادلة ${pv.expectedQty} (نسبة الناتج ${pv.standardYieldPct}%). اتركه فارغاً إن طابق` : ""}><NumInput value={out} onChange={(e: any) => setOut(e.target.value)} placeholder={pv ? String(pv.expectedQty) : ""} data-batch-output /></Field>
        <Field label="التاريخ"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="ملاحظات"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" /></Field>
      </div>
      {pv && !bad && <>
        <div className="card-h mt"><h3>ما يخرج من المخزون</h3></div>
        <div className="table-wrap"><table className="tbl" data-batch-lines><thead><tr><th>المادة</th><th className="n">الكمية</th><th>الوحدة</th><th className="n">الرصيد</th><th className="n">التكلفة</th></tr></thead>
          <tbody>{pv.lines.map((l: any) => <tr key={l.componentId}><td>{l.name}{l.short && <span className="badge red" style={{ marginInlineStart: 6 }}>الرصيد لا يكفي</span>}</td><td className="n">{l.qty}</td><td>{l.unit}</td><td className="n">{l.onHand}</td><td className="n"><Money v={l.cost} /></td></tr>)}</tbody>
          <tfoot><tr><td colSpan={4}>تكلفة الطبخة</td><td className="n" data-batch-cost><Money v={pv.cost} /></td></tr></tfoot></table></div>
        <div className="small mt" data-batch-summary>يدخل المخزون <b>{pv.outputQty} {pv.unit}</b> بتكلفة <b>{money(pv.unitCost)}</b> للوحدة — نسبة الناتج <b>{pv.yieldPct}%</b>{Math.abs(pv.outputQty - pv.expectedQty) > 0.0005 && <> (المعياري {pv.standardYieldPct}% بتكلفة {money(pv.standardUnitCost)})</>}. لا قيد محاسبي: القيمة تنتقل داخل المخزون.</div>
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
