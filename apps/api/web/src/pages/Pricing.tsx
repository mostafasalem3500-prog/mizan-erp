import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { api, q, useFetch, Money, money, Loading, Empty, Badge, Modal, Field, Input, Select, NumInput, Picker, productFetcher, useAction, useToast, useCompanyContext, ExportBtn, today, fmtDate, confirmDlg, JTYPE_AR } from "../lib";

// ─── Price lists ───────────────────────────────────────────────────────────
export function PriceListsPage() {
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const list = useFetch("/price-lists");
  const [edit, setEdit] = useState<any>(null);
  return (
    <div className="card"><div className="card-h"><div><h3>قوائم الأسعار</h3><div className="small muted">أسعار ثابتة لكل صنف (مع شرائح كمية) أو نسبة خصم على سعر البيع — تُربط بالعميل فتُطبَّق في الفواتير ونقطة البيع</div></div>{can("products.write") && <button className="btn primary sm" onClick={() => setEdit({})}>＋ قائمة جديدة</button>}</div>
      {!list.data ? <Loading /> : !list.data.length ? <Empty text="لا توجد قوائم أسعار" /> : <div className="table-wrap"><table className="tbl"><thead><tr><th>الاسم</th><th>النوع</th><th className="n">الأصناف</th><th className="n">العملاء المرتبطون</th><th>الحالة</th><th /></tr></thead>
        <tbody>{list.data.map((l: any) => <tr key={l.id}><td><b>{l.name}</b></td><td>{l.kind === "DISCOUNT" ? `خصم ${Number(l.discountPct)}% على سعر البيع` : "أسعار ثابتة"}</td><td className="n">{l.itemsCount}</td><td className="n">{l.partnersCount}</td><td><Badge s={l.isActive ? "ACTIVE" : "CANCELLED"} map={{ ACTIVE: "نشطة", CANCELLED: "موقوفة" }} /></td><td className="row" style={{ gap: 4 }}>{can("products.write") && <><button className="btn sm" onClick={() => setEdit(l)}>تعديل</button><button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { if (confirmDlg(`حذف القائمة «${l.name}»؟ سيُفك ارتباط العملاء بها.`)) { await api(`/price-lists/${l.id}`, { method: "DELETE" }); list.reload(); } })}>حذف</button></>}</td></tr>)}</tbody></table></div>}
      {edit && <PriceListEditor id={edit.id} onClose={(s) => { setEdit(null); if (s) list.reload(); }} />}
    </div>
  );
}

function PriceListEditor({ id, onClose }: { id?: string; onClose: (s?: boolean) => void }) {
  const { run, busy } = useAction();
  const toast = useToast();
  const [f, setF] = useState<any>({ name: "", kind: "FIXED", discountPct: 0, isActive: true });
  const [items, setItems] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(!id);
  const [prod, setProd] = useState<any>(null);
  useEffect(() => { if (!id) return; api(`/price-lists/${id}`).then((d) => { setF({ name: d.name, kind: d.kind, discountPct: Number(d.discountPct), isActive: d.isActive }); setItems(d.items.map((i: any) => ({ key: Math.random(), productId: i.productId, name: i.name, sku: i.sku, salePrice: Number(i.salePrice), minQty: Number(i.minQty), price: Number(i.price) }))); setLoaded(true); }).catch((e) => toast(e.message, "err")); }, [id]);
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const add = (p: any) => { if (!p) return; setItems((it) => [...it, { key: Math.random(), productId: p.id, name: p.name, sku: p.sku, salePrice: Number(p.salePrice), minQty: 1, price: Number(p.salePrice) }]); setProd(null); };
  const upd = (k: number, patch: any) => setItems((it) => it.map((i) => (i.key === k ? { ...i, ...patch } : i)));
  const importExcel = (file: File) => {
    const r = new FileReader();
    r.onload = () => run(async () => {
      const wb = XLSX.read(r.result, { type: "array" });
      const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      let n = 0;
      for (const row of rows) {
        const sku = String(row["الرمز"] ?? row["SKU"] ?? row["sku"] ?? "").trim(); const price = Number(row["السعر"] ?? row["price"] ?? row["Price"]); const minQty = Number(row["الحد الأدنى"] ?? row["min_qty"] ?? 1) || 1;
        if (!sku || !(price >= 0)) continue;
        const found = await api(`/products${q({ barcode: sku, limit: 1 })}`);
        if (found[0]) { setItems((it) => [...it.filter((x) => !(x.productId === found[0].id && x.minQty === minQty)), { key: Math.random(), productId: found[0].id, name: found[0].name, sku: found[0].sku, salePrice: Number(found[0].salePrice), minQty, price }]); n++; }
      }
      toast(`تم استيراد ${n} سطر`, "ok");
    });
    r.readAsArrayBuffer(file);
  };
  if (!loaded) return <Modal title="..." onClose={() => onClose()}><Loading /></Modal>;
  return (
    <Modal wide title={id ? `تعديل قائمة: ${f.name}` : "قائمة أسعار جديدة"} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy || !f.name} onClick={() => run(async () => { const body = { ...f, items: items.map((i) => ({ productId: i.productId, minQty: i.minQty, price: i.price })) }; id ? await api(`/price-lists/${id}`, { method: "PUT", body }) : await api("/price-lists", { body }); onClose(true); }, "تم الحفظ")}>حفظ</button></>}>
      <div className="form-grid">
        <Field label="الاسم" span2><Input autoFocus value={f.name} onChange={s("name")} placeholder="مثال: جملة، موزعون، عملاء مميزون" /></Field>
        <Field label="النوع"><Select value={f.kind} onChange={s("kind")}><option value="FIXED">أسعار ثابتة لكل صنف</option><option value="DISCOUNT">نسبة خصم على سعر البيع</option></Select></Field>
        {f.kind === "DISCOUNT" ? <Field label="نسبة الخصم %"><NumInput value={f.discountPct} onChange={s("discountPct")} /></Field> : <Field label="إضافة صنف"><Picker value={prod} onChange={add} fetcher={productFetcher} label={(p: any) => p.name} placeholder="ابحث عن صنف لإضافته..." /></Field>}
        <Field label="الحالة"><label className="check"><input type="checkbox" checked={!!f.isActive} onChange={s("isActive")} /> نشطة</label></Field>
      </div>
      {f.kind === "FIXED" && <>
        <div className="row mt"><label className="btn sm">⬆ استيراد من Excel (الرمز، السعر، الحد الأدنى)<input type="file" hidden accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && importExcel(e.target.files[0])} /></label><ExportBtn name={f.name || "قائمة أسعار"} rows={() => items.map((i) => ({ الرمز: i.sku, الصنف: i.name, "سعر البيع الأساسي": i.salePrice, السعر: i.price, "الحد الأدنى": i.minQty }))} /><span className="muted small">الأسطر المتكررة لنفس الصنف بحدود كمية مختلفة = شرائح كمية</span></div>
        {!items.length ? <Empty text="أضف أصنافاً للقائمة" /> : <div className="table-wrap mt" style={{ maxHeight: 420 }}><table className="tbl compact"><thead><tr><th>الصنف</th><th className="n">سعر البيع الأساسي</th><th style={{ width: 130 }}>من كمية</th><th style={{ width: 150 }}>السعر</th><th className="n">الفرق</th><th /></tr></thead>
          <tbody>{items.map((i) => <tr key={i.key}><td>{i.name}<span className="small muted"> {i.sku}</span></td><td className="n"><Money v={i.salePrice} /></td><td><NumInput value={i.minQty} onChange={(e) => upd(i.key, { minQty: Number(e.target.value) || 1 })} /></td><td><NumInput value={i.price} onChange={(e) => upd(i.key, { price: Number(e.target.value) || 0 })} /></td><td className={"n " + (i.price < i.salePrice ? "neg-val" : "pos-val")}>{i.salePrice ? Math.round(((i.price - i.salePrice) / i.salePrice) * 100) + "%" : ""}</td><td><button className="btn ghost sm" onClick={() => setItems((it) => it.filter((x) => x.key !== i.key))}>✕</button></td></tr>)}</tbody></table></div>}
      </>}
    </Modal>
  );
}

// ─── Currencies (settings tab) ─────────────────────────────────────────────
export function CurrenciesTab() {
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const list = useFetch("/currencies");
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [add, setAdd] = useState<any>(null);
  return (
    <div className="card"><div className="card-h"><div><h3>العملات وأسعار الصرف</h3><div className="small muted">الدفاتر بالريال دائماً؛ الفاتورة أو السند بعملة أخرى يُقيَّد بالمعادل بالريال عند سعر الصرف المدخل، والفرق عند السداد يذهب لأرباح/خسائر فروق العملة</div></div>{can("settings.write") && <button className="btn primary sm" onClick={() => setAdd({ code: "", nameAr: "", symbol: "", rate: "", decimals: 2 })}>＋ عملة</button>}</div>
      {!list.data ? <Loading /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الرمز</th><th>الاسم</th><th>الرمز المختصر</th><th className="n">ريال لكل وحدة</th><th className="n">وحدة لكل ريال</th><th>آخر تحديث</th><th>الحالة</th><th /></tr></thead>
        <tbody>{list.data.map((c: any) => <tr key={c.code} className={c.isActive ? "" : "muted"}><td><b className="num">{c.code}</b></td><td>{c.nameAr}</td><td>{c.symbol}</td><td className="n">{c.code === "SAR" ? "1" : <NumInput style={{ width: 120 }} value={edit[c.code] ?? Number(c.rate)} onChange={(e) => setEdit({ ...edit, [c.code]: e.target.value })} />}</td><td className="n num">{Number(c.rate) ? (1 / Number(c.rate)).toFixed(4) : ""}</td><td>{fmtDate(c.updatedAt)}</td><td>{c.code !== "SAR" && <Badge s={c.isActive ? "ACTIVE" : "CANCELLED"} map={{ ACTIVE: "نشطة", CANCELLED: "موقوفة" }} />}</td>
          <td className="row" style={{ gap: 4 }}>{c.code !== "SAR" && can("settings.write") && <><button className="btn sm primary" disabled={busy || edit[c.code] === undefined || Number(edit[c.code]) === Number(c.rate)} onClick={() => run(async () => { await api(`/currencies/${c.code}`, { method: "PUT", body: { ...c, rate: Number(edit[c.code]) } }); list.reload(); }, "تم تحديث السعر")}>حفظ</button><button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { await api(`/currencies/${c.code}`, { method: "PUT", body: { ...c, isActive: !c.isActive } }); list.reload(); })}>{c.isActive ? "إيقاف" : "تفعيل"}</button></>}</td></tr>)}</tbody></table></div>}
      {add && <Modal narrow title="عملة جديدة" onClose={() => setAdd(null)} footer={<><button className="btn" onClick={() => setAdd(null)}>إلغاء</button><button className="btn primary" disabled={busy || add.code.length !== 3 || !Number(add.rate)} onClick={() => run(async () => { await api("/currencies", { body: add }); setAdd(null); list.reload(); }, "تمت الإضافة")}>إضافة</button></>}>
        <div className="grid"><Field label="الرمز (ISO)"><Input value={add.code} onChange={(e) => setAdd({ ...add, code: e.target.value.toUpperCase() })} dir="ltr" maxLength={3} placeholder="JOD" /></Field><Field label="الاسم"><Input value={add.nameAr} onChange={(e) => setAdd({ ...add, nameAr: e.target.value })} /></Field><Field label="الرمز المختصر"><Input value={add.symbol} onChange={(e) => setAdd({ ...add, symbol: e.target.value })} /></Field><Field label="ريال لكل وحدة"><NumInput value={add.rate} onChange={(e) => setAdd({ ...add, rate: e.target.value })} /></Field><Field label="الخانات العشرية"><Select value={add.decimals} onChange={(e) => setAdd({ ...add, decimals: Number(e.target.value) })}><option value={2}>2</option><option value={3}>3</option><option value={0}>0</option></Select></Field></div>
      </Modal>}
    </div>
  );
}

// ─── Bank statement import & matching ──────────────────────────────────────
const COLS: [string, string][] = [["date", "التاريخ"], ["description", "البيان"], ["reference", "المرجع"], ["credit", "إيداع (دائن)"], ["debit", "سحب (مدين)"], ["amount", "المبلغ بإشارة (+/−)"], ["balance", "الرصيد"]];
const guess = (h: string) => { const x = h.toLowerCase(); if (/date|تاريخ/.test(x)) return "date"; if (/desc|narr|detail|بيان|وصف|تفاصيل/.test(x)) return "description"; if (/ref|مرجع|رقم/.test(x)) return "reference"; if (/credit|deposit|دائن|إيداع|ايداع|وارد/.test(x)) return "credit"; if (/debit|withdraw|مدين|سحب|صادر/.test(x)) return "debit"; if (/balance|رصيد/.test(x)) return "balance"; if (/amount|مبلغ/.test(x)) return "amount"; return ""; };

export function BankStatementPanel({ accountId, onChanged }: { accountId: string; onChanged: () => void }) {
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const toast = useToast();
  const { data, reload } = useFetch(accountId ? `/bank/${accountId}/statement` : null, [accountId]);
  const [file, setFile] = useState<{ headers: string[]; rows: any[][] } | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [pick, setPick] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const load = (f: File) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const wb = XLSX.read(r.result, { type: "array", cellDates: false });
        const aoa: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
        const hi = aoa.findIndex((row) => row.filter((c) => String(c).trim()).length >= 3);
        const headers = (aoa[hi] || []).map((h: any) => String(h).trim());
        const rows = aoa.slice(hi + 1).filter((row) => row.some((c) => String(c).trim()));
        const m: Record<string, string> = {}; headers.forEach((h, i) => { const g = guess(h); if (g && !Object.values(m).includes(String(i))) m[g] = String(i); });
        setMap(m); setFile({ headers, rows });
      } catch (e: any) { toast("تعذر قراءة الملف: " + e.message, "err"); }
    };
    r.readAsArrayBuffer(f);
  };
  const doImport = () => run(async () => {
    if (!file || map.date === undefined || (map.amount === undefined && map.credit === undefined && map.debit === undefined)) throw new Error("حدد عمود التاريخ وعمود المبلغ (أو الإيداع/السحب)");
    const cell = (row: any[], k: string) => (map[k] === undefined || map[k] === "" ? undefined : row[Number(map[k])]);
    const rows = file.rows.map((row) => ({ date: cell(row, "date"), description: cell(row, "description"), reference: cell(row, "reference"), credit: cell(row, "credit"), debit: cell(row, "debit"), amount: cell(row, "amount"), balance: cell(row, "balance") }));
    const r = await api(`/bank/${accountId}/statement/import`, { body: { rows, batch: today() } });
    toast(`تم استيراد ${r.inserted} سطر (${r.skipped} مكرر/غير صالح)`, "ok");
    setFile(null); if (fileRef.current) fileRef.current.value = "";
    reload();
  });
  const confirm = (s: any, lineId: string) => run(async () => { await api(`/bank/statement/${s.id}/match`, { body: { journalLineId: lineId } }); reload(); onChanged(); }, "تمت المطابقة");
  if (!accountId) return null;
  const rows = data?.rows || [];
  return (
    <div className="card">
      <div className="card-h"><div><h3>كشف حساب البنك (مستورد)</h3><div className="small muted">استورد كشف البنك (Excel/CSV) وطابق كل سطر مع حركة الدفاتر — المطابقة تؤشّر الحركة تلقائياً في التسوية أعلاه</div></div>
        <div className="row">{data && <span className="small muted">مفتوح: <b>{data.summary.open}</b> · مطابق: <b>{data.summary.matched}</b>{data.summary.lastDate && ` · آخر تاريخ ${fmtDate(data.summary.lastDate)}`}</span>}{can("accounting.write") && <><label className="btn sm">⬆ استيراد كشف<input ref={fileRef} type="file" hidden accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} /></label>{rows.some((r: any) => r.suggestion) && <button className="btn primary sm" disabled={busy} onClick={() => run(async () => { const r = await api(`/bank/${accountId}/statement/match-all`, { body: {} }); toast(`تمت مطابقة ${r.matched} سطر`, "ok"); reload(); onChanged(); })}>✓ مطابقة كل المقترحات ({rows.filter((r: any) => r.suggestion).length})</button>}{!!data?.summary.open && <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { if (confirmDlg("حذف السطور غير المطابقة من الكشف؟")) { await api(`/bank/${accountId}/statement`, { method: "DELETE" }); reload(); } })}>مسح غير المطابق</button>}</>}</div></div>
      {file && <div className="card-b" style={{ background: "var(--primary-soft)" }}>
        <div className="row between"><b>تعيين الأعمدة — {file.rows.length} سطر</b><div className="row"><button className="btn sm" onClick={() => setFile(null)}>إلغاء</button><button className="btn primary sm" disabled={busy} onClick={doImport}>استيراد</button></div></div>
        <div className="form-grid mt">{COLS.map(([k, l]) => <Field key={k} label={l}><Select value={map[k] ?? ""} onChange={(e) => setMap({ ...map, [k]: e.target.value })}><option value="">—</option>{file.headers.map((h, i) => <option key={i} value={i}>{h || `عمود ${i + 1}`}</option>)}</Select></Field>)}</div>
        <div className="table-wrap mt" style={{ maxHeight: 180 }}><table className="tbl compact"><thead><tr>{file.headers.map((h, i) => <th key={i}>{h || `عمود ${i + 1}`}</th>)}</tr></thead><tbody>{file.rows.slice(0, 5).map((r, i) => <tr key={i}>{file.headers.map((_, j) => <td key={j}>{String(r[j] ?? "")}</td>)}</tr>)}</tbody></table></div>
        <div className="hint">تنسيقات التاريخ المدعومة: yyyy-mm-dd، dd/mm/yyyy، وتواريخ Excel. الإيداع = دائن في كشف البنك (مال داخل)، السحب = مدين.</div>
      </div>}
      {!data ? <Loading /> : !rows.length ? <Empty text="لا توجد سطور كشف مفتوحة — استورد كشف الحساب" /> : <div className="table-wrap" style={{ maxHeight: 520 }}><table className="tbl compact"><thead><tr><th>التاريخ</th><th>بيان البنك</th><th>المرجع</th><th className="n">المبلغ</th><th>الحركة المقترحة في الدفاتر</th><th /></tr></thead>
        <tbody>{rows.map((s: any) => <tr key={s.id}><td>{fmtDate(s.date)}</td><td>{s.description}</td><td className="num small">{s.reference}</td><td className={"n " + (Number(s.amount) < 0 ? "neg-val" : "pos-val")}><Money v={s.amount} sign /></td>
          <td>{s.suggestion ? <span>{s.suggestion.number} · {JTYPE_AR[s.suggestion.type]} · {s.suggestion.description || s.suggestion.memo}<span className="small muted"> ({fmtDate(s.suggestion.date)}{s.suggestion.daysApart ? ` — فرق ${s.suggestion.daysApart} يوم` : ""})</span></span> : <span className="muted small">لا يوجد مقترح — اختر يدوياً أو سجّل الحركة (رسوم بنكية/تحصيل)</span>}</td>
          <td className="row" style={{ gap: 4 }}>{can("accounting.write") && <>{s.suggestion && <button className="btn sm primary" disabled={busy} onClick={() => confirm(s, s.suggestion.id)}>✓ مطابقة</button>}<button className="btn sm" onClick={() => setPick(s)}>اختيار</button><button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { await api(`/bank/statement/${s.id}/ignore`, { body: { ignored: true } }); reload(); })}>تجاهل</button></>}</td></tr>)}</tbody></table></div>}
      {pick && <Modal wide title={`مطابقة سطر الكشف: ${money(pick.amount)} — ${pick.description || ""}`} onClose={() => setPick(null)}>
        <div className="table-wrap" style={{ maxHeight: 420 }}><table className="tbl compact"><thead><tr><th>التاريخ</th><th>القيد</th><th>النوع</th><th>البيان</th><th className="n">إيداع</th><th className="n">سحب</th><th /></tr></thead>
          <tbody>{(data.candidates || []).filter((c: any) => (Number(pick.amount) > 0 ? Number(c.debit) : Number(c.credit)) > 0).map((c: any) => <tr key={c.id} className={Math.abs((Number(pick.amount) > 0 ? Number(c.debit) : Number(c.credit)) - Math.abs(Number(pick.amount))) < 0.005 ? "bold" : ""}><td>{fmtDate(c.date)}</td><td>{c.number}</td><td className="small">{JTYPE_AR[c.type]}</td><td>{c.description || c.memo}</td><td className="n"><Money v={c.debit} blankZero /></td><td className="n"><Money v={c.credit} blankZero /></td><td><button className="btn sm primary" disabled={busy || Math.abs((Number(pick.amount) > 0 ? Number(c.debit) : Number(c.credit)) - Math.abs(Number(pick.amount))) >= 0.005} onClick={() => { confirm(pick, c.id); setPick(null); }}>مطابقة</button></td></tr>)}</tbody></table></div>
        <div className="hint mt">تُعرض الحركات غير المطابقة فقط؛ يجب أن يتساوى المبلغ. الرسوم البنكية أو الفوائد غير المسجلة: أنشئها من المصروفات أو قيد يدوي ثم طابقها.</div>
      </Modal>}
    </div>
  );
}
