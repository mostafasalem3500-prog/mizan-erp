/** Customer / supplier form. Saudi edition: everything a ZATCA tax invoice needs (VAT number or buyer ID, national address, contacts). */
import React, { useMemo, useState } from "react";
import { CFG } from "../shared/country";
import { api, useFetch, Modal, Field, Input, Select, NumInput, useAction, useToast, confirmDlg } from "../lib";

const has = (v: any) => String(v ?? "").trim() !== "";
const dg = (v: any) => String(v ?? "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[\s-]/g, "");
const ID_HINT: Record<string, RegExp> = { CRN: /^\d{10}$/, "700": /^7\d{9}$/, NAT: /^1\d{9}$/, IQA: /^2\d{9}$/ };
const FALLBACK_IDS: Record<string, { ar: string; hint?: string }> = { CRN: { ar: "السجل التجاري", hint: "10 أرقام" }, "700": { ar: "الرقم الموحد (700)" }, NAT: { ar: "الهوية الوطنية" }, IQA: { ar: "الإقامة" }, GCC: { ar: "هوية خليجية" }, PAS: { ar: "جواز السفر" }, MOM: { ar: "ترخيص وزارة الشؤون البلدية" }, MLS: { ar: "ترخيص وزارة الموارد البشرية" }, SAG: { ar: "ترخيص وزارة الاستثمار" }, OTH: { ar: "أخرى" } };
const NOT_REG = ["منشأة غير ملزمة بالتسجيل (إيرادات دون حد التسجيل)", "جهة حكومية", "جهة غير ربحية غير مسجلة", "عميل خارج المملكة", "أخرى"];

/** Same rules as the server (lib/partnerRules.ts) — shown live while typing. */
export function partnerCheck(f: any) {
  const errors: Record<string, string> = {}, missing: string[] = [];
  const local = !f.country || String(f.country).toUpperCase() === "SA";
  const t = f.idType || "CRN";
  const idv = t === "CRN" ? f.crNumber : f.idNumber;
  if (has(f.vatNumber) && !/^3\d{13}3$/.test(dg(f.vatNumber))) errors.vatNumber = "15 رقماً يبدأ وينتهي بـ 3";
  if (has(idv) && ID_HINT[t] && !ID_HINT[t].test(dg(idv))) errors.idValue = "صيغة الرقم غير صحيحة";
  if (local && has(f.buildingNo) && !/^\d{4}$/.test(dg(f.buildingNo))) errors.buildingNo = "4 أرقام";
  if (local && has(f.additionalNo) && !/^\d{4}$/.test(dg(f.additionalNo))) errors.additionalNo = "4 أرقام";
  if (local && has(f.postalCode) && !/^\d{5}$/.test(dg(f.postalCode))) errors.postalCode = "5 أرقام";
  if (has(f.phone) && !/^(05\d{8}|\+?9665\d{8}|5\d{8}|01\d{7}|9200\d{5}|800\d{7}|\+?\d{9,15})$/.test(dg(f.phone))) errors.phone = "مثال 05XXXXXXXX";
  if (has(f.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(f.email).trim())) errors.email = "بريد غير صحيح";
  if (!has(f.vatNumber) && !has(idv)) missing.push("الرقم الضريبي أو هوية المشتري");
  if (!has(f.vatNumber) && has(idv) && f.kind === "COMPANY" && !has(f.vatExemptReason)) missing.push("سبب عدم التسجيل في الضريبة");
  for (const [k, ar] of [["street", "الشارع"], ["buildingNo", "رقم المبنى"], ["district", "الحي"], ["city", "المدينة"], ["postalCode", "الرمز البريدي"]]) if (!has(f[k])) missing.push(ar);
  if (!has(f.phone)) missing.push("الجوال");
  return { errors, missing, ready: !Object.keys(errors).length && !missing.length };
}

const Sec = ({ children }: { children: React.ReactNode }) => <div className="span3 form-sec">{children}</div>;

export function PartnerEditor({ role, p, onClose }: { role: string; p: any; onClose: (saved?: any) => void }) {
  const { run, busy } = useAction();
  const toast = useToast();
  const { data: currencies } = useFetch("/currencies");
  const { data: priceLists } = useFetch("/price-lists");
  const EG = CFG.country === "EG";
  const meta = useFetch<any>(EG ? null : "/partners/meta");
  const whtTypes = useFetch<any>(role === "SUPPLIER" || p.isSupplier ? (EG ? "/tax/eg-wht/types" : "/tax/wht/types") : null);
  const [f, setF] = useState<any>({ kind: "COMPANY", country: CFG.country, paymentTerms: 0, creditLimit: 0, isCustomer: role === "CUSTOMER", isSupplier: role === "SUPPLIER", isActive: true, idType: "", ...p });
  const [notReg, setNotReg] = useState<boolean>(!!p.vatExemptReason);
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const idType = f.idType || (f.kind === "INDIVIDUAL" ? "NAT" : "CRN");
  const idKey = idType === "CRN" ? "crNumber" : "idNumber";
  const chk = useMemo(() => (EG ? { errors: {} as Record<string, string>, missing: [] as string[], ready: true } : partnerCheck({ ...f, idType })), [f, idType, EG]);
  const isCustomer = !!f.isCustomer;
  const strictCo = !EG && isCustomer && f.kind === "COMPANY";
  const local = !f.country || String(f.country).toUpperCase() === "SA";
  const idTypes = meta.data?.idTypes || FALLBACK_IDS;
  const err = (k: string) => (chk.errors as any)[k];
  const lbl = (t: string, req?: boolean) => (req ? `${t} *` : t);
  const save = () => run(async () => {
    const body = { ...f, idType: EG ? f.idType : idType, vatExemptReason: notReg ? f.vatExemptReason || null : null, vatNumber: notReg ? null : f.vatNumber };
    const row = p.id ? await api(`/partners/${p.id}`, { method: "PUT", body }) : await api("/partners", { body });
    onClose(row || true);
  }, "تم الحفظ");
  return (
    <Modal wide title={p.id ? `تعديل: ${p.name}` : role === "CUSTOMER" ? "عميل جديد" : "مورد جديد"} onClose={() => onClose()} footer={<>
      {p.id && <button className="btn danger sm" onClick={() => run(async () => { if (!confirmDlg("حذف / إيقاف؟")) return; const r = await api(`/partners/${p.id}`, { method: "DELETE" }); if (r.message) toast(r.message); onClose(true); })}>حذف</button>}
      <div className="grow" /><button className="btn" onClick={() => onClose()}>إلغاء</button><button className="btn primary" disabled={busy} onClick={save}>حفظ</button></>}>
      {!EG && isCustomer && <div className={"alert small " + (chk.ready ? "ok" : f.kind === "COMPANY" ? "warn" : "info")} style={{ marginBottom: 12 }}>
        {chk.ready ? "✓ البيانات مكتملة للفاتورة الضريبية القياسية (B2B) وفق متطلبات هيئة الزكاة والضريبة والجمارك."
          : f.kind === "COMPANY" ? <>عميل منشأة — الفاتورة الضريبية القياسية تتطلب: <b>{chk.missing.join("، ")}</b>{Object.keys(chk.errors).length > 0 && " — وصحّح الحقول المعلَّمة بالأحمر"}.</>
          : <>عميل فرد: يكفي الاسم والجوال للفاتورة المبسطة. أكمل العنوان الوطني والهوية إن احتاج فاتورة ضريبية قياسية.</>}
      </div>}
      <div className="form-grid">
        <Sec>البيانات الأساسية</Sec>
        <Field label={lbl("الاسم (كما في السجل)", true)} span2><Input autoFocus value={f.name || ""} onChange={s("name")} /></Field>
        <Field label="النوع"><Select value={f.kind} onChange={s("kind")}><option value="COMPANY">منشأة / شركة</option><option value="INDIVIDUAL">فرد</option></Select></Field>
        <Field label="الاسم بالإنجليزية" span2><Input value={f.nameEn || ""} onChange={s("nameEn")} dir="ltr" /></Field>
        <Field label="الكود (تلقائي)"><Input value={f.code || ""} onChange={s("code")} dir="ltr" /></Field>

        <Sec>{EG ? "البيانات الضريبية" : "الضريبة والهوية"}</Sec>
        {EG ? <>
          <Field label={CFG.taxIdLabel} hint="9 أرقام للشركات، أو الرقم القومي 14 رقماً للأفراد"><Input value={f.vatNumber || ""} onChange={s("vatNumber")} dir="ltr" /></Field>
          <Field label="السجل التجاري"><Input value={f.crNumber || ""} onChange={s("crNumber")} dir="ltr" /></Field>
          <Field label="نوع المتعامل في الفاتورة الإلكترونية"><Select value={f.etaType || ""} onChange={s("etaType")}><option value="">تلقائي (من البيانات)</option><option value="B">شركة / منشأة (B)</option><option value="P">شخص طبيعي (P)</option><option value="F">أجنبي (F)</option></Select></Field>
          <Field label="الرقم القومي / رقم الهوية" hint="مطلوب للأفراد في فواتير 50,000 جنيه فأكثر"><Input value={f.idNumber || ""} onChange={s("idNumber")} dir="ltr" /></Field>
        </> : <>
          {!notReg && <Field label={lbl(CFG.taxIdLabel, strictCo)} hint={err("vatNumber") || CFG.taxIdHint}><Input className={err("vatNumber") ? "invalid" : ""} value={f.vatNumber || ""} onChange={s("vatNumber")} dir="ltr" maxLength={15} placeholder="3XXXXXXXXXXXXX3" /></Field>}
          <Field label="التسجيل في ضريبة القيمة المضافة" span2={notReg}><label className="check"><input type="checkbox" checked={notReg} onChange={(e) => setNotReg(e.target.checked)} /> العميل غير مسجل في الضريبة (يُعرَّف بالهوية)</label>
            {notReg && <Select value={f.vatExemptReason || ""} onChange={s("vatExemptReason")} style={{ marginTop: 6 }}><option value="">— السبب{strictCo ? " *" : ""} —</option>{NOT_REG.map((r) => <option key={r} value={r}>{r}</option>)}</Select>}</Field>
          <Field label={lbl("نوع هوية المشتري", strictCo && notReg)} hint="رمز الهوية في الفاتورة الإلكترونية"><Select value={idType} onChange={s("idType")}>{Object.entries(idTypes).map(([k, v]: any) => <option key={k} value={k}>{v.ar} ({k})</option>)}</Select></Field>
          <Field label={lbl(`رقم ${idTypes[idType]?.ar || "الهوية"}`, strictCo && notReg)} hint={err("idValue") || idTypes[idType]?.hint || undefined}><Input className={err("idValue") ? "invalid" : ""} value={f[idKey] || ""} onChange={s(idKey)} dir="ltr" /></Field>
          {idType !== "CRN" && f.kind === "COMPANY" && <Field label="السجل التجاري (اختياري)"><Input value={f.crNumber || ""} onChange={s("crNumber")} dir="ltr" /></Field>}
        </>}

        <Sec>العنوان {EG ? "" : "الوطني"}</Sec>
        <Field label="الدولة">{EG ? <Input value={f.country || CFG.country} onChange={s("country")} dir="ltr" /> : <Select value={local ? "SA" : "XX"} onChange={(e) => setF({ ...f, country: e.target.value === "SA" ? "SA" : "" })}><option value="SA">المملكة العربية السعودية</option><option value="XX">دولة أخرى</option></Select>}</Field>
        {!EG && !local && <Field label="رمز الدولة (ISO)" hint="مثال AE, EG, US"><Input value={f.country || ""} onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase().slice(0, 2) })} dir="ltr" maxLength={2} /></Field>}
        {EG ? <Field label="المحافظة"><Input value={f.governate || ""} onChange={s("governate")} list="eg-gov" /><datalist id="eg-gov">{["القاهرة", "الجيزة", "الإسكندرية", "القليوبية", "الشرقية", "الدقهلية", "الغربية", "المنوفية", "البحيرة", "دمياط", "بورسعيد", "الإسماعيلية", "السويس", "أسيوط", "سوهاج", "قنا", "الأقصر", "أسوان"].map((g) => <option key={g} value={g} />)}</datalist></Field>
          : local && <Field label="المنطقة"><Select value={f.region || ""} onChange={s("region")}><option value="">—</option>{(meta.data?.regions || []).map((r: string) => <option key={r} value={r}>{r}</option>)}</Select></Field>}
        <Field label={lbl("المدينة", strictCo)}><Input value={f.city || ""} onChange={s("city")} /></Field>
        <Field label={lbl("الحي", strictCo)}><Input value={f.district || ""} onChange={s("district")} /></Field>
        <Field label={lbl("اسم الشارع", strictCo)}><Input value={f.street || ""} onChange={s("street")} /></Field>
        <Field label={lbl("رقم المبنى", strictCo)} hint={err("buildingNo") || (local && !EG ? "4 أرقام" : undefined)}><Input className={err("buildingNo") ? "invalid" : ""} value={f.buildingNo || ""} onChange={s("buildingNo")} dir="ltr" maxLength={local && !EG ? 4 : 20} /></Field>
        {!EG && <Field label="الرقم الإضافي" hint={err("additionalNo") || "4 أرقام"}><Input className={err("additionalNo") ? "invalid" : ""} value={f.additionalNo || ""} onChange={s("additionalNo")} dir="ltr" maxLength={4} /></Field>}
        <Field label={lbl("الرمز البريدي", strictCo)} hint={err("postalCode") || (local && !EG ? "5 أرقام" : undefined)}><Input className={err("postalCode") ? "invalid" : ""} value={f.postalCode || ""} onChange={s("postalCode")} dir="ltr" maxLength={local && !EG ? 5 : 10} /></Field>

        <Sec>التواصل</Sec>
        <Field label={lbl("الجوال", !EG && isCustomer)} hint={err("phone")}><Input className={err("phone") ? "invalid" : ""} value={f.phone || ""} onChange={s("phone")} dir="ltr" placeholder="05XXXXXXXX" inputMode="tel" /></Field>
        <Field label="هاتف آخر / الثابت"><Input value={f.phone2 || ""} onChange={s("phone2")} dir="ltr" inputMode="tel" /></Field>
        <Field label="البريد الإلكتروني" hint={err("email") || "تُرسل إليه الفواتير وكشف الحساب"}><Input className={err("email") ? "invalid" : ""} value={f.email || ""} onChange={s("email")} dir="ltr" type="email" /></Field>
        {f.kind === "COMPANY" && <Field label="الشخص المسؤول"><Input value={f.contactPerson || ""} onChange={s("contactPerson")} /></Field>}

        <Sec>شروط التعامل</Sec>
        <Field label="أيام السداد (0 = نقدي)"><NumInput value={f.paymentTerms} onChange={s("paymentTerms")} /></Field>
        <Field label="حد الائتمان"><NumInput value={f.creditLimit} onChange={s("creditLimit")} /></Field>
        <Field label="عملة التعامل" hint="الفواتير والسندات لهذا الطرف تُنشأ بها افتراضياً"><Select value={f.currency || CFG.currency} onChange={s("currency")}>{(currencies || [{ code: CFG.currency, nameAr: CFG.currencyAr }]).filter((c: any) => c.isActive !== false).map((c: any) => <option key={c.code} value={c.code}>{c.code} — {c.nameAr}</option>)}</Select></Field>
        <Field label="قائمة الأسعار" hint="تُطبَّق في فواتير البيع ونقطة البيع"><Select value={f.priceListId || ""} onChange={s("priceListId")}><option value="">— السعر الأساسي —</option>{(priceLists || []).filter((l: any) => l.isActive).map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="التصنيف"><div className="row"><label className="check"><input type="checkbox" checked={!!f.isCustomer} onChange={s("isCustomer")} /> عميل</label><label className="check"><input type="checkbox" checked={!!f.isSupplier} onChange={s("isSupplier")} /> مورد</label>{p.id && <label className="check"><input type="checkbox" checked={!!f.isActive} onChange={s("isActive")} /> نشط</label>}</div></Field>
        {EG && !!f.isSupplier && <Field label="الخصم تحت حساب الضريبة (الافتراضي في سندات الصرف)" hint="يُخصم من المدفوعات للمورد ويورَّد بنموذج 41 (للتعاملات فوق 300 جنيه)"><Select value={f.whtType || ""} onChange={s("whtType")}><option value="">— لا يُخصم —</option>{Object.entries(whtTypes.data?.types || {}).map(([k, v]: any) => <option key={k} value={k}>{v.ar} — {(v.rate * 100).toFixed(1).replace(/\.0$/, "")}%</option>)}</Select></Field>}
        {!EG && !!f.isSupplier && <Field label="الإقامة الضريبية" hint="المورد غير المقيم تُستقطع من مدفوعاته ضريبة الاستقطاع (المادة 68 من نظام ضريبة الدخل)"><label className="check"><input type="checkbox" checked={!!f.isNonResident} onChange={(e) => setF({ ...f, isNonResident: e.target.checked, country: e.target.checked && (f.country || "SA") === "SA" ? "" : f.country })} /> مورد غير مقيم في المملكة</label></Field>}
        {!EG && !!f.isSupplier && !!f.isNonResident && <Field label="نوع الدفعات الافتراضي (نسبة الاستقطاع)"><Select value={f.whtType || ""} onChange={s("whtType")}><option value="">— يُحدد في كل سند —</option>{Object.entries(whtTypes.data || {}).map(([k, v]: any) => <option key={k} value={k}>{v.ar} — {(v.rate * 100).toFixed(0)}%</option>)}</Select></Field>}
        <Field label="ملاحظات" span3><textarea className="input" value={f.notes || ""} onChange={s("notes")} /></Field>
      </div>
    </Modal>
  );
}

/** «+ عميل جديد» from an invoice or the POS opens the same full form; returns the saved partner. */
export function QuickPartner({ role, onClose }: { role: "CUSTOMER" | "SUPPLIER"; onClose: (p?: any) => void }) {
  return <PartnerEditor role={role} p={{ kind: role === "CUSTOMER" ? "INDIVIDUAL" : "COMPANY" }} onClose={(r) => onClose(r && typeof r === "object" ? r : undefined)} />;
}
