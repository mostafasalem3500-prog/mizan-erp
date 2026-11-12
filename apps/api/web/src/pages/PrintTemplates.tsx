/** Print templates: a gallery of ready invoice designs in every size, and an editor that changes any of them. */
import React, { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { CUR, CFG } from "../shared/country";
import { api, useFetch, useAction, useToast, useCompanyContext, Modal, Field, Input, Select, NumInput, Loading, confirmDlg } from "../lib";
import { InvoicePaper } from "./InvoicePaper";
import { PRESETS, Tpl, TplOpts, TplConfig, TplSize, SIZE_AR, STYLE_AR, cleanConfig, cleanOpts, isRoll, sampleDoc } from "../shared/printTemplates";

const COLORS = ["#0f766e", "#1d4ed8", "#111827", "#7c2d12", "#0e7490", "#6d28d9", "#be123c", "#15803d", "#b45309", "#374151"];
const SCALE: Record<TplSize, number> = { A4: 0.32, A5: 0.44, T80: 0.62, T58: 0.74 };
const WIDTH: Record<TplSize, number> = { A4: 800, A5: 560, T80: 330, T58: 245 };

function Thumb({ tpl, doc, qr, scale }: { tpl: Tpl; doc: any; qr: string; scale?: number }) {
  const k = scale ?? SCALE[tpl.opts.size];
  return <div className="tpl-thumb" style={{ height: isRoll(tpl.opts.size) ? 320 : 330 }} aria-hidden><div style={{ width: WIDTH[tpl.opts.size], transform: `scale(${k})` }}><InvoicePaper d={doc} qr={qr} tpl={tpl} docTitle={isRoll(tpl.opts.size) ? "فاتورة ضريبية مبسطة" : "فاتورة ضريبية"} /></div></div>;
}

export function PrintTemplatesPage() {
  const { me, can } = useCompanyContext();
  const toast = useToast();
  const { run, busy } = useAction();
  const { data, loading, reload } = useFetch<any>("/print-templates");
  const [size, setSize] = useState<"" | TplSize>("");
  const [edit, setEdit] = useState<Tpl | null>(null);
  const [qr, setQr] = useState("");
  const W = can("settings.write");
  useEffect(() => { QRCode.toDataURL("Mizan ERP sample invoice", { margin: 0, width: 140 }).then(setQr); }, []);
  const cfg: TplConfig = useMemo(() => cleanConfig(data), [data]);
  const doc = useMemo(() => sampleDoc(me.company, CFG.vatRate, CUR()), [me.company]);
  const save = (next: TplConfig, msg: string) => run(async () => { await api("/print-templates", { method: "PUT", body: next }); reload(); }, msg);
  if (loading && !data) return <Loading />;
  const all = [...cfg.items.map((t) => ({ ...t, builtin: false })), ...PRESETS].filter((t) => !size || t.opts.size === size);
  const isDefault = (t: Tpl) => (isRoll(t.opts.size) ? (cfg.defaults.pos || "t80-standard") : (cfg.defaults.doc || "a4-classic")) === t.id;
  return (
    <div className="grid">
      <div className="card"><div className="card-h"><div><h3>قوالب الفواتير والإيصالات</h3><div className="small muted">{PRESETS.length} قالباً جاهزاً بمقاسات A4 و A5 والحراري 80مم و58مم. اختر القالب الافتراضي، أو خصّص أي قالب (الألوان، ما يظهر وما يُخفى، النصوص) واحفظه باسمك.</div></div>
        <div className="row" role="group" aria-label="المقاس">{([["", "الكل"], ["A4", "A4"], ["A5", "A5"], ["T80", "حراري 80مم"], ["T58", "حراري 58مم"]] as [any, string][]).map(([k, l]) => <button key={k} className={"btn sm" + (size === k ? " primary" : "")} onClick={() => setSize(k)}>{l}</button>)}</div></div></div>
      <div className="tpl-grid">{all.map((t) => (
        <div key={t.id} className={"card tpl-card" + (isDefault(t) ? " on" : "")} data-id={t.id}>
          <Thumb tpl={t} doc={doc} qr={qr} />
          <div className="tpl-meta">
            <div className="row between"><b>{t.name}</b><span className="badge">{SIZE_AR[t.opts.size]}</span></div>
            <div className="small muted">{t.builtin ? t.note : `قالبك · ${STYLE_AR[t.opts.style]}`}{isDefault(t) && <span className="badge green" style={{ marginInlineStart: 6 }}>{isRoll(t.opts.size) ? "افتراضي للإيصالات" : "افتراضي للفواتير"}</span>}</div>
            {W && <div className="row" style={{ gap: 6 }}>
              {!isDefault(t) && <button className="btn sm" disabled={busy} onClick={() => save({ ...cfg, defaults: { ...cfg.defaults, [isRoll(t.opts.size) ? "pos" : "doc"]: t.id } }, `«${t.name}» أصبح القالب الافتراضي ${isRoll(t.opts.size) ? "للإيصالات" : "للفواتير"}`)}>★ اجعله الافتراضي</button>}
              <button className="btn sm primary" onClick={() => setEdit(t.builtin ? { id: "", name: `${t.name} — معدّل`, opts: { ...t.opts } } : t)}>{t.builtin ? "🎨 تخصيص" : "✎ تعديل"}</button>
              {!t.builtin && <button className="btn sm ghost" disabled={busy} onClick={() => { if (!confirmDlg(`حذف القالب «${t.name}»؟`)) return; save({ defaults: { doc: cfg.defaults.doc === t.id ? undefined : cfg.defaults.doc, pos: cfg.defaults.pos === t.id ? undefined : cfg.defaults.pos }, items: cfg.items.filter((x) => x.id !== t.id) }, "حُذف القالب"); }}>حذف</button>}
            </div>}
          </div>
        </div>))}</div>
      {edit && <Editor tpl={edit} doc={doc} qr={qr} busy={busy} onClose={() => setEdit(null)} onSave={(t, makeDefault) => {
        const id = t.id || `my-${Date.now().toString(36)}`; const item = { id, name: t.name.trim() || "قالبي", opts: cleanOpts(t.opts) };
        const items = cfg.items.some((x) => x.id === id) ? cfg.items.map((x) => (x.id === id ? item : x)) : [...cfg.items, item];
        if (items.length > 30) return toast("الحد 30 قالباً خاصاً — احذف قالباً أولاً", "err");
        save({ defaults: makeDefault ? { ...cfg.defaults, [isRoll(item.opts.size) ? "pos" : "doc"]: id } : cfg.defaults, items }, "حُفظ القالب").then(() => setEdit(null));
      }} />}
    </div>
  );
}

function Editor({ tpl, doc, qr, busy, onClose, onSave }: { tpl: Tpl; doc: any; qr: string; busy: boolean; onClose: () => void; onSave: (t: Tpl, makeDefault: boolean) => void }) {
  const [t, setT] = useState<Tpl>(tpl);
  const [def, setDef] = useState(false);
  const o = t.opts, roll = isRoll(o.size);
  const set = (p: Partial<TplOpts>) => setT((x) => ({ ...x, opts: { ...x.opts, ...p } }));
  const Chk = ({ k, label }: { k: keyof TplOpts; label: string }) => <label className="check"><input type="checkbox" checked={!!o[k]} onChange={(e) => set({ [k]: e.target.checked } as any)} /> {label}</label>;
  const Txt = ({ k, label, rows, ph }: { k: keyof TplOpts; label: string; rows?: number; ph?: string }) => <Field label={label}>{rows ? <textarea className="input" rows={rows} value={String(o[k])} placeholder={ph} onChange={(e) => set({ [k]: e.target.value } as any)} /> : <Input value={String(o[k])} placeholder={ph} onChange={(e) => set({ [k]: e.target.value } as any)} />}</Field>;
  const print = () => { document.body.classList.add("tpl-printing"); const done = () => { document.body.classList.remove("tpl-printing"); window.removeEventListener("afterprint", done); }; window.addEventListener("afterprint", done); window.print(); };
  return (
    <Modal wide title={tpl.id ? `تعديل القالب: ${tpl.name}` : "تخصيص قالب"} onClose={onClose} footer={<><label className="check"><input type="checkbox" checked={def} onChange={(e) => setDef(e.target.checked)} /> اجعله الافتراضي {roll ? "للإيصالات" : "للفواتير"}</label><div className="grow" /><button className="btn" onClick={print}>🖨 طباعة تجريبية</button><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" disabled={busy || !t.name.trim()} onClick={() => onSave(t, def)}>حفظ القالب</button></>}>
      <div className="tpl-edit">
        <div className="tpl-controls">
          <Field label="اسم القالب"><Input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} maxLength={50} /></Field>
          <details open><summary>المقاس والنمط</summary>
            <div className="form-grid"><Field label="المقاس"><Select value={o.size} onChange={(e) => set({ size: e.target.value as TplSize })}>{(Object.keys(SIZE_AR) as TplSize[]).map((k) => <option key={k} value={k}>{SIZE_AR[k]}</option>)}</Select></Field>
              {!roll && <Field label="النمط"><Select value={o.style} onChange={(e) => set({ style: e.target.value as any })}>{Object.entries(STYLE_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>}
              <Field label="حجم الخط"><Select value={o.font} onChange={(e) => set({ font: e.target.value as any })}><option value="S">صغير</option><option value="M">متوسط</option><option value="L">كبير</option></Select></Field></div>
            {!roll && <Field label="اللون الرئيسي"><div className="row" style={{ gap: 6 }}>{COLORS.map((c) => <button key={c} type="button" className={"swatch" + (o.accent === c ? " on" : "")} style={{ background: c }} title={c} aria-label={`اللون ${c}`} onClick={() => set({ accent: c })} />)}<input type="color" value={o.accent} aria-label="لون مخصص" onChange={(e) => set({ accent: e.target.value })} /></div></Field>}
            {!roll && <div className="row"><Chk k="english" label="العناوين بالعربية والإنجليزية" /><Chk k="watermark" label="علامة «مسودة» على غير المرحّل" /></div>}
            {o.style === "letterhead" && !roll && <Field label="هامش علوي لترويسة الورق (مم)"><NumInput value={o.topMargin} onChange={(e) => set({ topMargin: Number(e.target.value) })} /></Field>}
          </details>
          <details><summary>الشعار وبيانات المنشأة</summary>
            <div className="row"><Chk k="logo" label="الشعار" /><Chk k="companyAddress" label="العنوان" /><Chk k="companyContact" label="الهاتف والبريد" /><Chk k="companyCr" label="السجل التجاري" /></div>
            <div className="form-grid"><Field label="ارتفاع الشعار (بكسل)"><NumInput value={o.logoSize} onChange={(e) => set({ logoSize: Number(e.target.value) })} /></Field>
              {!roll && <Field label="محاذاة بيانات المنشأة"><Select value={o.logoPos} onChange={(e) => set({ logoPos: e.target.value as any })}><option value="start">يمين</option><option value="center">وسط</option><option value="end">يسار</option></Select></Field>}</div>
            <div className="small muted">الرقم الضريبي ورمز QR يظهران دائماً لأنهما إلزاميان في الفاتورة الضريبية. الشعار يُرفع من «بيانات المنشأة».</div>
          </details>
          <details><summary>العميل والجدول</summary>
            <div className="row">{!roll && <Chk k="customerAddress" label="عنوان العميل" />}<Chk k="customerContact" label="هاتف العميل" /><Chk k="colSku" label="رمز الصنف" />{!roll && <><Chk k="colUnit" label="الوحدة" /><Chk k="colDiscount" label="عمود الخصم" /></>}<Chk k="colTax" label={roll ? "ضريبة كل سطر" : "عمودا الضريبة والإجمالي"} />{roll && <><Chk k="unitPrice" label="سعر الوحدة تحت الصنف" /><Chk k="cashier" label="اسم الكاشير" /></>}</div>
            {!roll && <div className="form-grid"><Field label="حدود الجدول"><Select value={o.borders} onChange={(e) => set({ borders: e.target.value as any })}><option value="full">كاملة</option><option value="rows">بين السطور فقط</option><option value="none">بلا حدود</option></Select></Field><Field label="تظليل"><label className="check"><input type="checkbox" checked={o.striped} onChange={(e) => set({ striped: e.target.checked })} /> سطور متبادلة اللون</label></Field></div>}
          </details>
          <details><summary>الإجماليات والتذييل</summary>
            <div className="row">{!roll && <><Chk k="words" label="المبلغ كتابةً" /><Chk k="paid" label="المسدد والمتبقي" /><Chk k="terms" label="الشروط" /><Chk k="bank" label="بيانات التحويل البنكي" /><Chk k="signatures" label="خانتا التوقيع" /></>}<Chk k="notes" label="ملاحظات الفاتورة" /><Chk k="footer" label="التذييل" /></div>
          </details>
          <details><summary>النصوص</summary>
            <Txt k="title" label="عنوان المستند (اتركه فارغاً للعنوان النظامي)" ph="فاتورة ضريبية" />
            <Txt k="headerNote" label="سطر تحت الترويسة" ph="مثال: الأسعار تشمل التوصيل" />
            {!roll && <Txt k="termsText" label="الشروط والأحكام (فارغ = نص إعدادات الفاتورة)" rows={3} />}
            {!roll && o.bank && <Txt k="bankText" label="بيانات التحويل البنكي" rows={3} ph={"البنك: …\nالآيبان: SA…"} />}
            <Txt k="footerText" label="التذييل (فارغ = نص إعدادات الفاتورة)" rows={2} />
            {!roll && o.signatures && <div className="form-grid"><Txt k="sign1" label="التوقيع الأول" /><Txt k="sign2" label="التوقيع الثاني" /></div>}
            {roll && <Txt k="thanks" label="عبارة الشكر أسفل الإيصال" />}
          </details>
        </div>
        <div className="tpl-preview"><div className="tpl-print"><InvoicePaper d={doc} qr={qr} tpl={{ ...t, id: t.id || "preview", opts: cleanOpts(o) }} docTitle={roll ? "فاتورة ضريبية مبسطة" : "فاتورة ضريبية"} /></div></div>
      </div>
    </Modal>
  );
}
