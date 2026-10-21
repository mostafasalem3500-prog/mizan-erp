/** Round 23 — Saudi zakat base assessment and withholding tax (non-residents). */
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, q, useFetch, Money, money, Loading, Empty, Badge, Modal, Field, Input, Select, NumInput, Picker, accountFetcher, useAction, useCompanyContext, PrintBtn, today, fmtDate, confirmDlg, useBase } from "../lib";

const r2 = (v: number) => Math.round(v * 100) / 100;

function PayModal({ title, max, onSubmit, onClose }: { title: string; max: number; onSubmit: (b: any) => Promise<any>; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const [account, setAccount] = useState<any>(null);
  const [amount, setAmount] = useState<string>(String(max || ""));
  const [date, setDate] = useState(today());
  const [reference, setReference] = useState("");
  return (
    <Modal narrow title={title} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !account} onClick={() => run(async () => { await onSubmit({ accountId: account.id, amount: Number(amount), date, reference }); onClose(true); }, "تم السداد وترحيل القيد")}>سداد وترحيل</button></>}>
      <div className="grid">
        <Field label="من حساب البنك / الصندوق"><Picker value={account} onChange={setAccount} fetcher={accountFetcher((a) => a.isCashBank)} label={(a: any) => `${a.code} ${a.nameAr}`} autoFocus /></Field>
        <Field label="المبلغ" hint={max ? `المتبقي ${money(max)}` : undefined}><NumInput value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="تاريخ السداد"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="رقم السداد / المرجع"><Input value={reference} onChange={(e) => setReference(e.target.value)} dir="ltr" placeholder="رقم فاتورة سداد" /></Field>
      </div>
    </Modal>
  );
}

// ─── zakat ─────────────────────────────────────────────────────────────────
export function ZakatPage() {
  const { me, can } = useCompanyContext();
  const base = useBase();
  const { run, busy } = useAction();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [method, setMethod] = useState("GREGORIAN");
  const [basis, setBasis] = useState("END");
  const { data, loading, reload } = useFetch(`/zakat/compute${q({ year, method, basis })}`);
  const [items, setItems] = useState<any[]>([]);
  const [profit, setProfit] = useState(0);
  const [view, setView] = useState<string | null>(null);
  useEffect(() => { if (data) { setItems(data.items.map((i: any, k: number) => ({ ...i, k }))); setProfit(data.adjustedProfit); } }, [data]);
  const rate = method === "HIJRI" ? 0.025 : 0.025776;
  const sum = useMemo(() => {
    const adds = r2(items.filter((i) => i.group === "ADD").reduce((a, i) => a + Number(i.amount || 0), 0));
    const deds = r2(items.filter((i) => i.group === "DEDUCT").reduce((a, i) => a + Number(i.amount || 0), 0));
    const raw = r2(adds - deds); const b = r2(Math.max(raw, profit, 0));
    return { adds, deds, raw, base: b, floor: b > raw, zakat: r2(b * rate) };
  }, [items, profit, rate]);
  const upd = (k: number, patch: any) => setItems((xs) => xs.map((x) => (x.k === k ? { ...x, ...patch } : x)));
  const postIt = () => run(async () => {
    if (!confirmDlg(`ترحيل مخصص الزكاة ${money(sum.zakat)} ر.س للفترة ${data.from} – ${data.to}؟ (من ح/ الزكاة الشرعية إلى ح/ مخصص الزكاة)`)) return;
    const r = await api("/zakat", { body: { from: data.from, to: data.to, method, items, adjustedProfit: profit } });
    setView(r.id); reload();
  }, "تم ترحيل مخصص الزكاة");
  const posted = data?.history?.find((z: any) => z.status === "POSTED" && String(z.periodFrom).slice(0, 10) === data.from && String(z.periodTo).slice(0, 10) === data.to);
  const years = Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - i));
  return (
    <div className="grid">
      <div className="card"><div className="card-h"><h3>🕌 احتساب وعاء الزكاة الشرعية</h3><div className="row no-print">
        <Select value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 100 }}>{years.map((y) => <option key={y}>{y}</option>)}</Select>
        <Select value={method} onChange={(e) => setMethod(e.target.value)} style={{ width: 200 }}><option value="GREGORIAN">سنة ميلادية — 2.5776%</option><option value="HIJRI">سنة هجرية — 2.5%</option></Select>
        <Select value={basis} onChange={(e) => setBasis(e.target.value)} style={{ width: 230 }}><option value="END">حقوق الملكية: رصيد آخر السنة</option><option value="START">حقوق الملكية: رصيد أول السنة</option></Select>
        <PrintBtn pdfName={`وعاء الزكاة ${year}`} />
      </div></div>
        {loading && !data ? <Loading /> : data && <div className="card-b print-doc" style={{ maxWidth: "none" }}>
          <div className="print-only"><h2 style={{ margin: 0 }}>{me.company.nameAr}</h2><div className="small">احتساب وعاء الزكاة للفترة {data.from} – {data.to} · {method === "HIJRI" ? "سنة هجرية 2.5%" : "سنة ميلادية 2.5776%"}</div><hr /></div>
          <div className="alert info small mb no-print">تقدير مبسّط وفق اللائحة التنفيذية لجباية الزكاة: الوعاء = مصادر التمويل (حقوق الملكية والمخصصات المرحّلة والقروض طويلة الأجل وصافي الربح المعدّل) ناقصاً الأصول المقتناة للاستخدام (صافي الممتلكات والمعدات)، ولا يقل عن صافي الربح المعدّل. كل البنود قابلة للتعديل ويمكن إضافة بنود يدوية (استثمارات، دفعات مقدمة لأصول، تعديلات المصروفات غير الجائزة…) — الرقم النهائي هو المعتمد في الإقرار المقدَّم للهيئة.</div>
          <div className="grid c2">
            {(["ADD", "DEDUCT"] as const).map((g) => <div key={g}><h4 style={{ margin: "0 0 6px" }}>{g === "ADD" ? "➕ يُضاف إلى الوعاء" : "➖ يُحسم من الوعاء"}</h4>
              <div className="table-wrap"><table className="tbl compact"><thead><tr><th>البند</th><th>الأساس</th><th className="n" style={{ width: 150 }}>المبلغ</th><th className="no-print" /></tr></thead>
                <tbody>{items.filter((i) => i.group === g).map((i) => <tr key={i.k}><td>{i.key === "manual" ? <Input value={i.label} onChange={(e) => upd(i.k, { label: e.target.value })} /> : i.label}</td><td className="small muted">{i.basis}</td><td className="n"><span className="print-only">{money(i.amount)}</span><NumInput className="no-print" value={i.amount} onChange={(e) => upd(i.k, { amount: Number(e.target.value) })} /></td><td className="no-print"><button className="btn ghost sm" onClick={() => setItems((xs) => xs.filter((x) => x.k !== i.k))}>✕</button></td></tr>)}
                  {!items.some((i) => i.group === g) && <tr><td colSpan={4} className="muted">لا توجد بنود</td></tr>}</tbody>
                <tfoot><tr><td colSpan={2}>الإجمالي</td><td className="n"><Money v={g === "ADD" ? sum.adds : sum.deds} /></td><td className="no-print" /></tr></tfoot></table></div>
              <button className="btn sm mt no-print" onClick={() => setItems((xs) => [...xs, { group: g, key: "manual", label: g === "ADD" ? "بند إضافة يدوي" : "بند حسم يدوي", amount: 0, basis: "تعديل يدوي", k: Date.now() }])}>＋ بند يدوي</button>
            </div>)}
          </div>
          {items.filter((i) => i.group === "INFO").map((i) => <div key={i.k} className="alert warn small mt">{i.label}: {money(i.amount)}</div>)}
          <div className="stat-list mt" style={{ maxWidth: 560 }}>
            <div className="item"><span>صافي الربح المعدّل للسنة (الحد الأدنى للوعاء)</span><b><span className="print-only">{money(profit)}</span><NumInput className="no-print" value={profit} onChange={(e) => setProfit(Number(e.target.value))} style={{ width: 150 }} /></b></div>
            <div className="item"><span>الإضافات − الحسميات</span><b><Money v={sum.raw} /></b></div>
            <div className="item"><span>الوعاء الزكوي{sum.floor ? " (رُفع إلى صافي الربح المعدّل)" : ""}</span><b><Money v={sum.base} /></b></div>
            <div className="item"><span>الزكاة المستحقة ({(rate * 100).toFixed(4)}%)</span><b style={{ fontSize: 18, color: "var(--primary)" }}><Money v={sum.zakat} /> ر.س</b></div>
          </div>
          {posted && <div className="alert warn small mt no-print">يوجد احتساب مرحّل لهذه الفترة ({posted.number} — زكاة {money(posted.zakat)}). لإعادة الاحتساب ألغِ الاحتساب السابق أولاً من السجل (ما لم يُسدَّد منه شيء).</div>}
          {can("accounting.write") && <div className="row mt no-print"><button className="btn primary" disabled={busy || !(sum.zakat > 0) || !!posted} onClick={postIt}>ترحيل مخصص الزكاة ✓</button><span className="small muted">قيد: من ح/ الزكاة الشرعية (5401) إلى ح/ مخصص الزكاة (210203) بتاريخ {data.to}</span></div>}
        </div>}
      </div>
      {data?.history?.length > 0 && <div className="card no-print"><div className="card-h"><h3>سجل احتساب الزكاة</h3></div><div className="table-wrap"><table className="tbl compact"><thead><tr><th>الرقم</th><th>الفترة</th><th className="n">الوعاء</th><th className="n">الزكاة</th><th className="n">المسدد</th><th>القيد</th><th>الحالة</th><th /></tr></thead>
        <tbody>{data.history.map((z: any) => <tr key={z.id}><td>{z.number}</td><td className="small">{fmtDate(z.periodFrom)} – {fmtDate(z.periodTo)}</td><td className="n"><Money v={z.base} /></td><td className="n"><Money v={z.zakat} /></td><td className="n"><Money v={z.paid} /></td><td>{z.journalId && <Link to={`${base}/journals/${z.journalId}`}>{z.journalNumber}</Link>}</td><td><Badge s={z.status} /></td><td><button className="btn sm" onClick={() => setView(z.id)}>عرض</button></td></tr>)}</tbody></table></div></div>}
      {view && <ZakatView id={view} onClose={(s) => { setView(null); if (s) reload(); }} />}
    </div>
  );
}

function ZakatView({ id, onClose }: { id: string; onClose: (s?: boolean) => void }) {
  const { me, can } = useCompanyContext();
  const base = useBase();
  const { run, busy } = useAction();
  const { data: z, reload } = useFetch(`/zakat/${id}`);
  const [pay, setPay] = useState(false);
  const [changed, setChanged] = useState(false);
  const due = z ? r2(Number(z.zakat) - Number(z.paid)) : 0;
  return (
    <Modal wide title={`احتساب الزكاة ${z?.number || ""}`} onClose={() => onClose(changed)} footer={<>
      {z?.status === "POSTED" && Number(z.paid) === 0 && can("accounting.write") && <button className="btn danger sm" disabled={busy} onClick={() => run(async () => { if (!confirmDlg("إلغاء الاحتساب وعكس قيد المخصص؟")) return; await api(`/zakat/${id}/cancel`, { body: {} }); onClose(true); }, "تم الإلغاء")}>إلغاء الاحتساب</button>}
      <div className="grow" />{z?.status === "POSTED" && due > 0.001 && can("payments.write") && <button className="btn accent" onClick={() => setPay(true)}>سداد الزكاة للهيئة</button>}<PrintBtn pdfName={`الزكاة ${z?.number || ""}`} /><button className="btn" onClick={() => onClose(changed)}>إغلاق</button></>}>
      {!z ? <Loading /> : <div className="print-doc" style={{ padding: 0, maxWidth: "none" }}>
        <div className="head"><div><h2>{me.company.nameAr}</h2><div className="small">{me.company.vatNumber && `الرقم الضريبي ${me.company.vatNumber}`}</div></div><div style={{ textAlign: "left" }}><h2>إقرار احتساب الزكاة</h2><div className="num">{z.number}</div><div className="small">{fmtDate(z.periodFrom)} – {fmtDate(z.periodTo)} · {z.method === "HIJRI" ? "هجري 2.5%" : "ميلادي 2.5776%"}</div></div></div>
        <table><thead><tr><th>البند</th><th>الأساس</th><th className="n">إضافة</th><th className="n">حسم</th></tr></thead>
          <tbody>{z.items.filter((i: any) => i.group !== "INFO").map((i: any, k: number) => <tr key={k}><td>{i.label}</td><td className="small">{i.basis}</td><td className="n">{i.group === "ADD" ? money(i.amount) : ""}</td><td className="n">{i.group === "DEDUCT" ? money(i.amount) : ""}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={2}>الإجمالي</td><td className="n">{money(z.additions)}</td><td className="n">{money(z.deductions)}</td></tr></tfoot></table>
        <div className="stat-list mt"><div className="item"><span>صافي الربح المعدّل</span><b><Money v={z.adjustedProfit} /></b></div><div className="item"><span>الوعاء الزكوي{z.floorApplied ? " (لا يقل عن صافي الربح المعدّل)" : ""}</span><b><Money v={z.base} /></b></div><div className="item"><span>الزكاة المستحقة</span><b><Money v={z.zakat} /></b></div><div className="item"><span>المسدد / المتبقي</span><b><Money v={z.paid} /> / <Money v={due} /></b></div></div>
        {z.payments?.length > 0 && <><h4 className="mt">السدادات</h4><table><thead><tr><th>التاريخ</th><th>الحساب</th><th>المرجع</th><th>القيد</th><th className="n">المبلغ</th></tr></thead><tbody>{z.payments.map((p: any) => <tr key={p.id}><td>{fmtDate(p.date)}</td><td>{p.accountName}</td><td>{p.reference}</td><td>{p.journalId && <Link to={`${base}/journals/${p.journalId}`} onClick={() => onClose()}>{p.journalNumber}</Link>}</td><td className="n">{money(p.amount)}</td></tr>)}</tbody></table></>}
        <div className="jv-sign"><div>المحاسب</div><div>المدير المالي</div><div>المعتمد</div></div>
      </div>}
      {pay && <PayModal title="سداد الزكاة لهيئة الزكاة والضريبة والجمارك" max={due} onSubmit={(b) => api(`/zakat/${id}/pay`, { body: b })} onClose={(s) => { setPay(false); if (s) { setChanged(true); reload(); } }} />}
    </Modal>
  );
}

// ─── withholding tax ───────────────────────────────────────────────────────
export function WhtPage() {
  const { me, can } = useCompanyContext();
  const base = useBase();
  const { run, busy } = useAction();
  const prev = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
  const [period, setPeriod] = useState(prev);
  const { data, loading, reload } = useFetch(`/tax/wht${q({ period })}`);
  const [file, setFile] = useState(false);
  const overdue = data && !data.filed && data.taxTotal > 0 && today() > data.dueDate;
  return (
    <div className="grid">
      <div className="card"><div className="card-h"><h3>🌍 ضريبة الاستقطاع — المدفوعات لغير المقيمين</h3><div className="row no-print"><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 160 }} /><PrintBtn pdfName={`إقرار الاستقطاع ${period}`} /></div></div>
        {loading && !data ? <Loading /> : data && <div className="card-b print-doc" style={{ maxWidth: "none" }}>
          <div className="print-only"><h2 style={{ margin: 0 }}>{me.company.nameAr}</h2><div className="small">إقرار ضريبة الاستقطاع لشهر {data.period}{me.company.vatNumber ? ` · الرقم الضريبي ${me.company.vatNumber}` : ""}</div><hr /></div>
          <div className="mini-kpis mb"><div><span>إجمالي المبالغ الخاضعة</span><b><Money v={data.baseTotal} /></b></div><div><span>ضريبة الاستقطاع للشهر</span><b className="neg-val"><Money v={data.taxTotal} /></b></div><div><span>موعد التوريد</span><b className={overdue ? "neg-val" : ""}>{fmtDate(data.dueDate)}{overdue ? " (متأخر)" : ""}</b></div><div><span>رصيد الضريبة المستحقة (كل الفترات)</span><b><Money v={data.payableBalance} /></b></div></div>
          {data.filed ? <div className="alert ok small">✓ سُدّدت ضريبة هذا الشهر بالإقرار {data.filed.number} بتاريخ {fmtDate(data.filed.date)} من {data.filed.accountName} — القيد <Link to={`${base}/journals/${data.filed.journalId}`}>{data.filed.journalNumber}</Link>{can("vat.write") && <button className="btn sm ghost no-print" style={{ marginInlineStart: 8 }} disabled={busy} onClick={() => run(async () => { if (!confirmDlg("إلغاء الإقرار وعكس قيد السداد؟")) return; await api(`/tax/wht/${data.filed.id}/cancel`, { body: {} }); reload(); }, "تم الإلغاء")}>إلغاء</button>}</div>
            : data.taxTotal > 0 && can("vat.write") && <div className="row no-print mb"><button className="btn primary" onClick={() => setFile(true)}>تقديم وسداد إقرار {data.period}</button><span className="small muted">يُقدَّم الإقرار وتُسدد الضريبة خلال العشرة أيام الأولى من الشهر التالي لشهر الدفع — قيد: من ح/ ضريبة الاستقطاع المستحقة إلى ح/ البنك</span></div>}
          <h4 style={{ margin: "6px 0" }}>ملخص حسب نوع الدفعة</h4>
          <div className="table-wrap"><table className="tbl compact"><thead><tr><th>نوع الدفعة</th><th className="n">النسبة</th><th className="n">عدد السندات</th><th className="n">المبالغ الخاضعة</th><th className="n">الضريبة</th></tr></thead>
            <tbody>{data.byType.map((g: any) => <tr key={g.type}><td>{g.typeAr}</td><td className="n">{(g.rate * 100).toFixed(0)}%</td><td className="n">{g.count}</td><td className="n"><Money v={g.base} /></td><td className="n"><Money v={g.tax} /></td></tr>)}{!data.byType.length && <tr><td colSpan={5} className="muted">لا توجد مدفوعات لغير مقيمين في هذا الشهر</td></tr>}</tbody>
            <tfoot><tr><td colSpan={3}>الإجمالي</td><td className="n"><Money v={data.baseTotal} /></td><td className="n"><Money v={data.taxTotal} /></td></tr></tfoot></table></div>
          {data.rows.length > 0 && <><h4 style={{ margin: "12px 0 6px" }}>تفاصيل السندات</h4><div className="table-wrap"><table className="tbl compact"><thead><tr><th>السند</th><th>التاريخ</th><th>المستفيد غير المقيم</th><th>الدولة</th><th>النوع</th><th className="n">المبلغ</th><th className="n">المسدد للمستفيد</th><th className="n">الضريبة</th></tr></thead>
            <tbody>{data.rows.map((r: any) => <tr key={r.id}><td>{r.number}</td><td className="dt">{fmtDate(r.date)}</td><td>{r.partnerName}</td><td>{r.country || "—"}</td><td className="small">{data.types[r.whtType]?.ar}{r.whtBorne ? " (تتحملها المنشأة)" : ""}</td><td className="n"><Money v={r.amount} /></td><td className="n"><Money v={r.netPaid} /></td><td className="n"><Money v={r.whtAmount} /></td></tr>)}</tbody></table></div></>}
          <details className="mt no-print"><summary className="small">نسب ضريبة الاستقطاع النظامية</summary><div className="table-wrap mt"><table className="tbl compact"><tbody>{Object.entries(data.types).map(([k, v]: any) => <tr key={k}><td>{v.ar}</td><td className="n">{(v.rate * 100).toFixed(0)}%</td></tr>)}</tbody></table></div><div className="small muted mt">تُطبّق على المدفوعات من مقيم إلى غير مقيم عن خدمات مصدرها المملكة (المادة 68 من نظام ضريبة الدخل والمادة 63 من لائحته). غرامة التأخير 1% عن كل 30 يوماً من الضريبة غير المسددة.</div></details>
        </div>}
      </div>
      {data?.history?.length > 0 && <div className="card no-print"><div className="card-h"><h3>سجل إقرارات الاستقطاع</h3></div><div className="table-wrap"><table className="tbl compact"><thead><tr><th>الرقم</th><th>الشهر</th><th>تاريخ السداد</th><th className="n">الضريبة</th><th>القيد</th><th>الحالة</th></tr></thead>
        <tbody>{data.history.map((h: any) => <tr key={h.id} className="clickable" onClick={() => setPeriod(h.period)}><td>{h.number}</td><td>{h.period}</td><td className="dt">{fmtDate(h.date)}</td><td className="n"><Money v={h.taxTotal} /></td><td>{h.journalNumber}</td><td><Badge s={h.status} /></td></tr>)}</tbody></table></div></div>}
      {file && data && <PayModal title={`سداد ضريبة الاستقطاع لشهر ${data.period}`} max={data.taxTotal} onSubmit={(b) => api("/tax/wht/file", { body: { period: data.period, accountId: b.accountId, date: b.date, reference: b.reference } })} onClose={(s) => { setFile(false); if (s) reload(); }} />}
    </div>
  );
}
