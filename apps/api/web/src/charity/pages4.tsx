/** Round 23 — charity: zakat fund statement & policy, and the social case study (دراسة الحالة). */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, useFetch, Money, money, Loading, Empty, Modal, Field, Input, Select, NumInput, useAction, useCompanyContext, today, fmtDate, PeriodFilter, yearStart, PrintBtn } from "../lib";
import { useCharity } from "./CharityApp";

const VERDICT: Record<string, { ar: string; cls: string }> = {
  FAQIR: { ar: "فقير — مستحق للزكاة", cls: "#fde8e8|#9b1c1c" },
  MISKEEN: { ar: "مسكين — مستحق للزكاة", cls: "#fff4e0|#9a5b00" },
  NOT_ZAKAT: { ar: "غير مستحق للزكاة", cls: "#edf1f8|#475569" },
};
export function VerdictBadge({ a }: { a: any }) {
  if (!a?.verdict) return <span className="small muted">بلا دراسة</span>;
  const [bg, fg] = VERDICT[a.verdict].cls.split("|");
  const expired = a.validUntil && String(a.validUntil).slice(0, 10) < today();
  return <span className="badge" title={`نصيب الفرد ${money(a.perCapita)} · الأولوية ${a.score}/100${a.validUntil ? " · سارية حتى " + fmtDate(a.validUntil) : ""}`} style={{ background: expired ? "#f1f5f9" : bg, color: expired ? "#94a3b8" : fg }}>{VERDICT[a.verdict].ar.split(" — ")[0]} · {a.score}{expired ? " (منتهية)" : ""}</span>;
}

// ─── case study ────────────────────────────────────────────────────────────
export function CaseStudyModal({ p, onClose }: { p: any; onClose: (saved?: boolean) => void }) {
  const { run, busy } = useAction();
  const meta = useFetch<any>("/charity/zakat/meta");
  const list = useFetch<any[]>(`/charity/beneficiaries/${p.id}/cases`);
  const { settings } = useCharity();
  const [f, setF] = useState<any>({ date: today(), members: p.beneficiaryInfo?.familySize || 1, income: 0, housing: "RENT", rent: 0, debtMonthly: 0, debtsTotal: 0, flags: [] as string[], needs: "", researcher: "", recommendation: "", incomeSources: "" });
  const [a, setA] = useState<any>(null);
  const [view, setView] = useState<any>(null);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  useEffect(() => { const t = setTimeout(() => api("/charity/case-assess", { body: f }).then(setA).catch(() => undefined), 250); return () => clearTimeout(t); }, [f.members, f.income, f.housing, f.rent, f.debtMonthly, f.debtsTotal, f.flags.join(",")]);
  const pol = meta.data?.policy;
  const save = () => run(async () => { await api(`/charity/beneficiaries/${p.id}/cases`, { body: { ...f, incomeSources: String(f.incomeSources || "").split(/[،,]/).map((x: string) => x.trim()).filter(Boolean) } }); list.reload(); onClose(true); }, "تم حفظ دراسة الحالة وتحديث تصنيف المستفيد");
  return (
    <Modal wide title={`دراسة حالة اجتماعية — ${p.name}`} onClose={() => onClose()} footer={<><div className="grow" /><button className="btn" onClick={() => onClose()}>إغلاق</button><button className="btn primary" disabled={busy} onClick={save}>حفظ الدراسة</button></>}>
      <div className="grid c3">
        <Field label="تاريخ الدراسة"><Input type="date" value={f.date} onChange={set("date")} /></Field>
        <Field label="عدد أفراد الأسرة"><NumInput value={f.members} onChange={set("members")} /></Field>
        <Field label="إجمالي الدخل الشهري للأسرة (ريال)"><NumInput value={f.income} onChange={set("income")} /></Field>
        <Field label="مصادر الدخل" hint="افصل بفاصلة: راتب، ضمان اجتماعي، حساب المواطن…"><Input value={f.incomeSources} onChange={set("incomeSources")} /></Field>
        <Field label="السكن"><Select value={f.housing} onChange={set("housing")}><option value="RENT">إيجار</option><option value="OWN">ملك</option><option value="FAMILY">مع الأقارب</option><option value="OTHER">أخرى</option></Select></Field>
        {f.housing === "RENT" && <Field label="الإيجار الشهري"><NumInput value={f.rent} onChange={set("rent")} /></Field>}
        <Field label="أقساط ديون شهرية"><NumInput value={f.debtMonthly} onChange={set("debtMonthly")} /></Field>
        <Field label="إجمالي الديون القائمة"><NumInput value={f.debtsTotal} onChange={set("debtsTotal")} /></Field>
        <Field label="الباحث الاجتماعي"><Input value={f.researcher} onChange={set("researcher")} /></Field>
        <Field label="ظروف خاصة" span3><div className="row" style={{ flexWrap: "wrap", gap: 10 }}>{Object.entries(meta.data?.flags || {}).map(([k, v]: any) => <label key={k} className="check"><input type="checkbox" checked={f.flags.includes(k)} onChange={(e) => setF({ ...f, flags: e.target.checked ? [...f.flags, k] : f.flags.filter((x: string) => x !== k) })} /> {v.ar}</label>)}</div></Field>
        <Field label="الاحتياجات" span3><Input value={f.needs} onChange={set("needs")} placeholder="سلة غذائية، سداد إيجار، أجهزة منزلية، علاج…" /></Field>
        <Field label="توصية الباحث" span3><Input value={f.recommendation} onChange={set("recommendation")} /></Field>
      </div>
      {a && <div className="stat-list mt" style={{ maxWidth: 620 }}>
        <div className="item"><span>نصيب الفرد الشهري = (الدخل − الإيجار − أقساط الديون) ÷ الأفراد</span><b><Money v={a.perCapita} /></b></div>
        <div className="item"><span>التصنيف {pol ? `(حد الفقير ${money(pol.faqirLine)} · حد المسكين ${money(pol.miskeenLine)})` : ""}</span><b><VerdictBadge a={{ ...a, validUntil: null }} /> {VERDICT[a.verdict]?.ar}</b></div>
        <div className="item"><span>درجة الاحتياج / الأولوية</span><b>{a.score}/100 — {a.priority}</b></div>
      </div>}
      {(list.data?.length || 0) > 0 && <><h4 className="mt">الدراسات السابقة</h4><div className="table-wrap"><table className="tbl compact"><thead><tr><th>الرقم</th><th>التاريخ</th><th className="n">الأفراد</th><th className="n">الدخل</th><th className="n">نصيب الفرد</th><th>التصنيف</th><th>سارية حتى</th><th /></tr></thead>
        <tbody>{list.data!.map((c: any) => <tr key={c.id}><td>{c.number}</td><td className="dt">{fmtDate(c.date)}</td><td className="n">{c.members}</td><td className="n"><Money v={c.income} /></td><td className="n"><Money v={c.perCapita} /></td><td><VerdictBadge a={c} /></td><td className="dt">{fmtDate(c.validUntil)}</td><td><button className="btn sm" onClick={() => setView(c)}>طباعة</button></td></tr>)}</tbody></table></div></>}
      {view && <CasePrint c={view} p={p} settings={settings} flags={meta.data?.flags || {}} onClose={() => setView(null)} />}
    </Modal>
  );
}

function CasePrint({ c, p, settings, flags, onClose }: { c: any; p: any; settings: any; flags: any; onClose: () => void }) {
  return (
    <Modal wide title={`دراسة الحالة ${c.number}`} onClose={onClose} footer={<><div className="grow" /><PrintBtn pdfName={`دراسة حالة ${p.name} ${c.number}`} /><button className="btn" onClick={onClose}>إغلاق</button></>}>
      <div className="print-doc" style={{ padding: 0, maxWidth: "none" }}>
        <div className="head"><div className="row"><img className="ch-print-logo" src={settings?.logoUrl} alt="" /><div><h2>{settings?.associationName}</h2><div className="small">{settings?.licenseNo && `ترخيص رقم ${settings.licenseNo}`}</div></div></div><div style={{ textAlign: "left" }}><h2>دراسة حالة اجتماعية</h2><div className="num">{c.number}</div><div className="small">{fmtDate(c.date)}</div></div></div>
        <table><tbody>
          <tr><th>اسم المستفيد</th><td>{p.name}</td><th>رقم الهوية</th><td className="num">{p.idNumber || "—"}</td></tr>
          <tr><th>عدد أفراد الأسرة</th><td>{c.members}</td><th>الجوال</th><td className="num">{p.phone || "—"}</td></tr>
          <tr><th>الدخل الشهري</th><td>{money(c.income)}</td><th>مصادر الدخل</th><td>{(c.incomeSources || []).join("، ") || "—"}</td></tr>
          <tr><th>السكن</th><td>{{ RENT: "إيجار", OWN: "ملك", FAMILY: "مع الأقارب", OTHER: "أخرى" }[c.housing as string]}{Number(c.rent) ? ` — ${money(c.rent)} شهرياً` : ""}</td><th>الديون</th><td>{money(c.debtsTotal)}{Number(c.debtMonthly) ? ` (قسط ${money(c.debtMonthly)})` : ""}</td></tr>
          <tr><th>ظروف خاصة</th><td colSpan={3}>{(c.flags || []).map((x: string) => flags[x]?.ar || x).join("، ") || "—"}</td></tr>
          <tr><th>الاحتياجات</th><td colSpan={3}>{c.needs || "—"}</td></tr>
          <tr><th>نصيب الفرد</th><td>{money(c.perCapita)}</td><th>التصنيف</th><td><b>{VERDICT[c.verdict]?.ar}</b> — الأولوية {c.score}/100</td></tr>
          <tr><th>توصية الباحث</th><td colSpan={3}>{c.recommendation || "—"}</td></tr>
          <tr><th>صلاحية الدراسة</th><td colSpan={3}>حتى {fmtDate(c.validUntil)}</td></tr>
        </tbody></table>
        <div className="jv-sign"><div>الباحث الاجتماعي{c.researcher ? `: ${c.researcher}` : ""}</div><div>لجنة المساعدات</div><div>المدير التنفيذي</div></div>
      </div>
    </Modal>
  );
}

// ─── zakat fund statement & policy ─────────────────────────────────────────
export function ZakatFundPage() {
  const { can } = useCompanyContext();
  const { settings } = useCharity();
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const { data, loading } = useFetch<any>(`/charity/zakat/fund?from=${from}&to=${to}`);
  const meta = useFetch<any>("/charity/zakat/meta");
  const [pol, setPol] = useState<any>(null);
  const { run, busy } = useAction();
  useEffect(() => { if (meta.data?.policy) setPol(meta.data.policy); }, [meta.data]);
  return (
    <div className="grid">
      <div className="card"><div className="card-h"><h3>🕌 كشف صندوق الزكاة</h3><div className="row no-print"><PeriodFilter from={from} to={to} onChange={(a, b) => { setFrom(a || yearStart()); setTo(b || today()); }} /><PrintBtn pdfName="كشف صندوق الزكاة" /></div></div>
        {loading && !data ? <Loading /> : data && <div className="card-b print-doc" style={{ maxWidth: "none" }}>
          <div className="head"><div className="row"><img className="ch-print-logo" src={settings?.logoUrl} alt="" /><div><h2>{settings?.associationName}</h2><div className="small">{settings?.licenseNo && `ترخيص رقم ${settings.licenseNo}`}</div></div></div><div style={{ textAlign: "left" }}><h3>كشف صندوق الزكاة</h3><div className="small">من {fmtDate(data.from)} إلى {fmtDate(data.to)}</div></div></div>
          <div className="mini-kpis mb"><div><span>رصيد أول الفترة</span><b><Money v={data.opening} /></b></div><div><span>الزكاة المحصّلة ({data.receipts} سند)</span><b className="pos-val"><Money v={data.received} /></b></div><div><span>الزكاة المصروفة</span><b className="neg-val"><Money v={data.distributed} /></b></div><div><span>رصيد آخر الفترة</span><b><Money v={data.closing} /></b></div></div>
          <div className={"alert small " + (data.amilinPct > data.amilinCapPct ? "warn" : "info")}>حصة «العاملين عليها» {data.amilinPct}% من الزكاة المحصّلة في الفترة (السقف {data.amilinCapPct}%). رصيد الصندوق المتاح حالياً للصرف: <b>{money(data.totalAvailable)}</b> ر.س.</div>
          <h4 style={{ margin: "8px 0" }}>المصروف حسب مصارف الزكاة الثمانية (التوبة: 60)</h4>
          <div className="table-wrap"><table className="tbl compact"><thead><tr><th>المصرف</th><th className="n">السندات</th><th className="n">المستفيدون</th><th className="n">المبلغ</th><th className="n">النسبة</th></tr></thead>
            <tbody>{data.rows.map((r: any) => <tr key={r.key} className={r.amount ? "" : "muted"}><td>{r.category}</td><td className="n">{r.count}</td><td className="n">{r.people}</td><td className="n"><Money v={r.amount} /></td><td className="n">{r.pct}%</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={3}>الإجمالي</td><td className="n"><Money v={data.distributed} /></td><td className="n">100%</td></tr></tfoot></table></div>
          {data.recent.length > 0 && <><h4 style={{ margin: "12px 0 6px" }}>سندات الصرف من الزكاة</h4><div className="table-wrap"><table className="tbl compact"><thead><tr><th>السند</th><th>التاريخ</th><th>المستفيد</th><th>المصرف</th><th className="n">المبلغ</th></tr></thead>
            <tbody>{data.recent.map((r: any) => <tr key={r.id}><td><Link to="/charity/disbursements">{r.number}</Link></td><td className="dt">{fmtDate(r.date)}</td><td>{r.beneficiaryName}{r.notes?.includes("استثناء") && <span className="badge" style={{ background: "#fff4e0", color: "#9a5b00", marginInlineStart: 4 }}>استثناء</span>}</td><td>{r.categoryAr}</td><td className="n"><Money v={r.amount} /></td></tr>)}</tbody></table></div></>}
          {!data.recent.length && !data.received && <Empty text="لا توجد حركات زكاة في الفترة — سجّل سند قبض بمصدر «زكاة»" />}
          <div className="jv-sign"><div>المحاسب</div><div>المدير المالي</div><div>رئيس مجلس الإدارة</div></div>
        </div>}
      </div>
      {pol && <div className="card no-print"><div className="card-h"><h3>⚙ سياسة الزكاة والمساعدات</h3></div><div className="card-b">
        <div className="grid c3">
          <Field label="حد الفقير — نصيب الفرد الشهري (ريال)"><NumInput disabled={!can("settings.write")} value={pol.faqirLine} onChange={(e) => setPol({ ...pol, faqirLine: Number(e.target.value) })} /></Field>
          <Field label="حد المسكين — نصيب الفرد الشهري (ريال)"><NumInput disabled={!can("settings.write")} value={pol.miskeenLine} onChange={(e) => setPol({ ...pol, miskeenLine: Number(e.target.value) })} /></Field>
          <Field label="سقف «العاملين عليها» من زكاة السنة %" hint="0 = بلا سقف؛ الافتراضي الثُمن 12.5%"><NumInput disabled={!can("settings.write")} value={pol.amilinCapPct} onChange={(e) => setPol({ ...pol, amilinCapPct: Number(e.target.value) })} /></Field>
          <Field label="تنبيه تكرار الصرف خلال (يوم)"><NumInput disabled={!can("settings.write")} value={pol.aidCooldownDays} onChange={(e) => setPol({ ...pol, aidCooldownDays: Number(e.target.value) })} /></Field>
          <Field label="صلاحية دراسة الحالة (يوم)"><NumInput disabled={!can("settings.write")} value={pol.caseValidityDays} onChange={(e) => setPol({ ...pol, caseValidityDays: Number(e.target.value) })} /></Field>
          <Field label="الصرف من الزكاة للفقراء والمساكين"><label className="check"><input type="checkbox" disabled={!can("settings.write")} checked={!!pol.requireCaseForZakat} onChange={(e) => setPol({ ...pol, requireCaseForZakat: e.target.checked })} /> يشترط دراسة حالة سارية تؤهله</label></Field>
        </div>
        {can("settings.write") && <button className="btn primary mt" disabled={busy} onClick={() => run(async () => { setPol(await api("/charity/policy", { method: "PUT", body: pol })); meta.reload(); }, "تم حفظ السياسة")}>حفظ السياسة</button>}
      </div></div>}
    </div>
  );
}
