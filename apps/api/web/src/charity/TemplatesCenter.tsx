/** Templates center (A4 forms editor with live preview) and association settings. */
import React, { useEffect, useRef, useState } from "react";
import { api, Field, Input, Select, useAction, useCompanyContext, fileToDataUrl } from "../lib";
import { useCharity, CH_NAV } from "./CharityApp";
import { A4, TEMPLATES, TPL, ROLES, SAMPLE, printA4, Ov } from "./templates";

export function TemplatesCenter() {
  const { settings, reload } = useCharity();
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const [key, setKey] = useState("request");
  const [mode, setMode] = useState<"sample" | "blank">("sample");
  const [all, setAll] = useState<Record<string, Ov>>(settings?.templates || {});
  const [theme, setTheme] = useState<any>(settings?.theme || {});
  const [dirty, setDirty] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setAll(settings?.templates || {}); setTheme(settings?.theme || {}); }, [settings]);
  const ov: Ov = all[key] || {};
  const base = TPL[key];
  const setOv = (patch: Partial<Ov>) => { setAll({ ...all, [key]: { ...ov, ...patch } }); setDirty(true); };
  const preview = { ...settings, templates: all, theme };
  const write = can("settings.write");
  const save = () => run(async () => { await api("/charity/settings", { method: "PUT", body: { templates: all, theme } }); reload(); setDirty(false); }, "تم حفظ إعدادات القوالب");
  return (
    <div className="ch-tpl">
      <div className="list">
        <div className="small muted" style={{ marginBottom: 8 }}>القوالب الجاهزة (A4)</div>
        {TEMPLATES.map((t) => { const o = all[t.key] || {}; return <button key={t.key} className={key === t.key ? "on" : ""} onClick={() => setKey(t.key)}><b>{o.title || t.title}</b><small>{o.code ?? t.code} · {t.sections.length} أقسام</small></button>; })}
        <div className="card card-b small muted mt">كل قالب يُطبع فارغاً للتعبئة اليدوية، أو معبأً تلقائياً من السند عند الضغط على «طباعة» في شاشات القبض والصرف والطلبات. الشعار واسم الجمعية ورقم الترخيص وأسماء المعتمدين تُضبط من إعدادات الجمعية.</div>
      </div>

      <div className="card ed"><div className="card-h"><h3>تخصيص القالب</h3>{dirty && <span className="badge amber">تغييرات غير محفوظة</span>}</div><div className="card-b grid">
        <Field label="عنوان النموذج"><Input value={ov.title ?? base.title} disabled={!write} onChange={(e) => setOv({ title: e.target.value })} /></Field>
        <div className="grid c2">
          <Field label="رمز النموذج"><Input value={ov.code ?? base.code} disabled={!write} onChange={(e) => setOv({ code: e.target.value })} dir="ltr" /></Field>
          <Field label="حجم الخط"><Select value={ov.scale || 1} disabled={!write} onChange={(e) => setOv({ scale: Number(e.target.value) })}><option value={0.9}>صغير</option><option value={1}>عادي</option><option value={1.08}>كبير</option></Select></Field>
        </div>
        <Field label="العنوان الفرعي"><Input value={ov.subtitle ?? base.subtitle ?? ""} disabled={!write} onChange={(e) => setOv({ subtitle: e.target.value })} /></Field>
        <Field label="أقسام النموذج (إظهار / إخفاء)"><div className="stat-list">{base.sections.map((s) => <label key={s.id} className="item"><span>{s.title || "نص الإثبات"}</span><input type="checkbox" disabled={!write} checked={!(ov.hidden || []).includes(s.id)} onChange={(e) => setOv({ hidden: e.target.checked ? (ov.hidden || []).filter((x) => x !== s.id) : [...(ov.hidden || []), s.id] })} /></label>)}</div></Field>
        {base.sections.filter((s) => s.text !== undefined).map((s) => <Field key={s.id} label={`نص: ${s.title || "الإثبات"}`}><textarea className="input" rows={3} disabled={!write} value={ov.texts?.[s.id] ?? s.text} onChange={(e) => setOv({ texts: { ...(ov.texts || {}), [s.id]: e.target.value } })} /></Field>)}
        <Field label="حقول إضافية (حقل في كل سطر)" hint="تظهر في قسم «بيانات إضافية»"><textarea className="input" rows={2} disabled={!write} value={(ov.extra || []).join("\n")} onChange={(e) => setOv({ extra: e.target.value.split("\n") })} /></Field>
        <Field label="ملاحظة أسفل النموذج"><textarea className="input" rows={2} disabled={!write} value={ov.note ?? base.note} onChange={(e) => setOv({ note: e.target.value })} /></Field>
        <div className="row"><label className="row" style={{ gap: 6 }}><input type="checkbox" disabled={!write} checked={ov.seal ?? base.seal ?? true} onChange={(e) => setOv({ seal: e.target.checked })} />مكان الختم</label><label className="row" style={{ gap: 6 }}><input type="checkbox" disabled={!write} checked={!!ov.copy2} onChange={(e) => setOv({ copy2: e.target.checked })} />طباعة نسختين (أصل + نسخة)</label></div>
        <h4 className="mt">الهوية البصرية (لكل القوالب)</h4>
        <div className="grid c2">
          <Field label="اللون الرئيسي"><Input type="color" disabled={!write} value={theme.color || "#1f6f4a"} onChange={(e) => { setTheme({ ...theme, color: e.target.value }); setDirty(true); }} /></Field>
          <Field label="اللون الثانوي"><Input type="color" disabled={!write} value={theme.accent || "#b7862b"} onChange={(e) => { setTheme({ ...theme, accent: e.target.value }); setDirty(true); }} /></Field>
        </div>
        <Field label="نص التذييل (اختياري)"><Input disabled={!write} value={theme.footer || ""} onChange={(e) => { setTheme({ ...theme, footer: e.target.value }); setDirty(true); }} placeholder="مثال: العنوان الوطني أو الموقع الإلكتروني" /></Field>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" disabled={!write} checked={!theme.hideLogo} onChange={(e) => { setTheme({ ...theme, hideLogo: !e.target.checked }); setDirty(true); }} />إظهار الشعار</label>
        <div className="row mt">
          {write && <button className="btn primary" disabled={busy || !dirty} onClick={save}>حفظ</button>}
          {write && (all[key] && Object.keys(all[key]).length > 0) && <button className="btn ghost" onClick={() => { const n = { ...all }; delete n[key]; setAll(n); setDirty(true); }}>استعادة الافتراضي</button>}
        </div>
      </div></div>

      <div>
        <div className="toolbar">
          <div className="row" style={{ gap: 4 }}><button className={"btn sm" + (mode === "sample" ? " primary" : "")} onClick={() => setMode("sample")}>معاينة ببيانات تجريبية</button><button className={"btn sm" + (mode === "blank" ? " primary" : "")} onClick={() => setMode("blank")}>نموذج فارغ للتعبئة</button></div>
          <div className="grow" />
          <button className="btn primary" onClick={() => printA4(ref.current)}>🖨 طباعة A4</button>
        </div>
        <div className="a4-stage scaled"><div className="a4-wrap" ref={ref}><A4 tplKey={key} settings={preview} data={SAMPLE[key]} blank={mode === "blank"} /></div></div>
      </div>
    </div>
  );
}

export function CharitySettingsPage() {
  const { settings, reload } = useCharity();
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({});
  const [logo, setLogo] = useState<string | null | undefined>(undefined);
  useEffect(() => { if (settings) setF({ associationName: settings.associationName || "", licenseNo: settings.licenseNo || "", authority: settings.authority || "", phone: settings.phone || "", email: settings.email || "", address: settings.address || "", signatories: settings.signatories || {}, defaultUi: !!settings.defaultUi, labels: settings.theme?.labels || {} }); }, [settings]);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const sig = (r: string, k: string, v: string) => setF({ ...f, signatories: { ...f.signatories, [r]: { ...(f.signatories?.[r] || {}), [k]: v } } });
  const write = can("settings.write");
  const curLogo = logo === undefined ? settings?.company?.logo : logo;
  const save = () => run(async () => { const { labels, ...rest } = f; await api("/charity/settings", { method: "PUT", body: { ...rest, theme: { ...(settings?.theme || {}), labels }, ...(logo !== undefined ? { logo } : {}) } }); setLogo(undefined); reload(); }, "تم حفظ إعدادات الجمعية");
  return (
    <div className="grid c2">
      <div className="card"><div className="card-h"><h3>بيانات الجمعية</h3></div><div className="card-b grid">
        <Field label="اسم الجمعية (يظهر في الواجهة والقوالب)"><Input value={f.associationName || ""} onChange={set("associationName")} disabled={!write} /></Field>
        <div className="grid c2">
          <Field label="رقم الترخيص"><Input value={f.licenseNo || ""} onChange={set("licenseNo")} disabled={!write} dir="ltr" /></Field>
          <Field label="جهة التسجيل / الإشراف"><Input value={f.authority || ""} onChange={set("authority")} disabled={!write} placeholder="المركز الوطني لتنمية القطاع غير الربحي" /></Field>
          <Field label="الهاتف"><Input value={f.phone || ""} onChange={set("phone")} disabled={!write} dir="ltr" /></Field>
          <Field label="البريد الإلكتروني"><Input value={f.email || ""} onChange={set("email")} disabled={!write} dir="ltr" /></Field>
        </div>
        <Field label="العنوان"><Input value={f.address || ""} onChange={set("address")} disabled={!write} /></Field>
        <Field label="الشعار"><div className="row">{curLogo ? <img src={curLogo} alt="" style={{ height: 64, background: "#fff", border: "1px solid var(--border)", borderRadius: 8, padding: 4 }} /> : <span className="muted small">لا يوجد شعار</span>}{write && <label className="btn sm">رفع شعار<input type="file" accept="image/*" hidden onChange={async (e) => { const file = e.target.files?.[0]; if (file) setLogo(await fileToDataUrl(file, 400)); }} /></label>}{write && curLogo && <button className="btn sm ghost" onClick={() => setLogo(null)}>إزالة</button>}</div></Field>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={!!f.defaultUi} onChange={set("defaultUi")} disabled={!write} />فتح واجهة الجمعية تلقائياً بعد تسجيل الدخول</label>
        <div className="alert info small">رابط واجهة الجمعية المستقل: <b dir="ltr">{location.origin}/charity</b> — يستخدم نفس الحسابات والقيود والمستخدمين، ويمكن الانتقال للبرنامج المحاسبي الأساسي في أي وقت.</div>
      </div></div>
      <div className="card"><div className="card-h"><h3>المعتمدون والتوقيعات</h3></div><div className="card-b">
        <div className="small muted mb">تظهر هذه المسميات والأسماء في خانات التوقيع أسفل كل نموذج A4.</div>
        <table className="tbl compact"><thead><tr><th>الدور</th><th>المسمى على النموذج</th><th>الاسم</th></tr></thead><tbody>
          {Object.entries(ROLES).map(([r, def]) => <tr key={r}><td className="small">{def}</td><td><Input value={f.signatories?.[r]?.title || ""} placeholder={def} onChange={(e) => sig(r, "title", e.target.value)} disabled={!write} /></td><td><Input value={f.signatories?.[r]?.name || ""} onChange={(e) => sig(r, "name", e.target.value)} disabled={!write} /></td></tr>)}
        </tbody></table>
      </div></div>
      <div className="card" style={{ gridColumn: "1 / -1" }}><div className="card-h"><h3>أسماء القوائم</h3><span className="small muted">غيّر اسم أي شاشة في القائمة الجانبية بما يناسب جمعيتك (مثال: «سندات الصرف» ← «المصروفات»)</span></div><div className="card-b grid c3">
        {CH_NAV.filter((n) => n.to).map((n) => <Field key={n.to} label={n.label}><Input value={f.labels?.[n.to] || ""} placeholder={n.label} onChange={(e) => setF({ ...f, labels: { ...f.labels, [n.to]: e.target.value } })} disabled={!write} /></Field>)}
      </div></div>
      {write && <div><button className="btn primary lg" disabled={busy} onClick={save}>حفظ الإعدادات</button></div>}
    </div>
  );
}
