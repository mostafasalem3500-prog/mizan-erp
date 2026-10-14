/** A4 ready-made forms for associations: definitions, renderer, data mappers and printing. */
import React, { useEffect, useState } from "react";
import { amountToArabicWords } from "../shared/tafqeet";
import { fmtDate, money, Modal } from "../lib";

export type Field = { k: string; label: string; span?: 1 | 2 | 3; kind?: "amount" | "words" | "date" | "para" | "ltr" };
export type Section = { id: string; title: string; fields?: Field[]; checks?: { k: string; options: string[]; multi?: boolean; label?: string }[]; text?: string; sign?: boolean; thumb?: boolean; noteLines?: number };
export type Tpl = { key: string; code: string; title: string; subtitle?: string; sections: Section[]; signatures: string[]; note: string; seal?: boolean };

export const ROLES: Record<string, string> = { preparer: "المُعِد / المحاسب", cashier: "أمين الصندوق", finance: "المدير المالي", authority: "صاحب الصلاحية", requester: "مقدم الطلب", receiver: "المستلم" };

const amount = (k = "amount"): Field[] => [{ k, label: "المبلغ رقماً (ريال)", kind: "amount" }, { k: k + "Words", label: "المبلغ كتابةً", span: 2, kind: "words" }];

export const TEMPLATES: Tpl[] = [
  {
    key: "request", code: "FIN-001", title: "نموذج طلب صرف مالي", subtitle: "يُعبأ من الجهة الطالبة ويُرفع للإدارة المالية قبل أي صرف",
    sections: [
      { id: "info", title: "بيانات الطلب", fields: [{ k: "number", label: "رقم الطلب", kind: "ltr" }, { k: "date", label: "تاريخ الطلب", kind: "date" }, { k: "requester", label: "اسم مقدم الطلب" }, { k: "department", label: "الإدارة / القسم" }] },
      { id: "pay", title: "بيانات الصرف", fields: [{ k: "beneficiary", label: "الجهة / الشخص المستفيد", span: 2 }, { k: "idNo", label: "رقم الهوية / السجل", kind: "ltr" }, { k: "purpose", label: "الغرض من الصرف", span: 3 }, { k: "project", label: "المشروع / البرنامج" }, { k: "budgetLine", label: "بند الموازنة", span: 2 }], checks: [{ k: "method", label: "طريقة الصرف المقترحة", options: ["تحويل بنكي", "شيك", "نقدي"] }] },
      { id: "amount", title: "المبلغ المطلوب", fields: amount() },
      { id: "just", title: "مبررات الطلب", fields: [{ k: "justification", label: "", span: 3, kind: "para" }] },
      { id: "att", title: "المرفقات", checks: [{ k: "attachments", multi: true, options: ["عرض سعر", "فاتورة", "عقد / اتفاقية", "قرار / محضر اعتماد", "صورة هوية المستفيد", "دراسة حالة", "أخرى"] }] },
      { id: "decl", title: "إقرار مقدم الطلب", text: "أقر بأن البيانات الواردة في هذا الطلب صحيحة، وأن الصرف لغرض يخدم أهداف الجمعية وفي حدود البند المعتمد، وألتزم بتقديم المستندات المؤيدة للصرف.", sign: true },
      { id: "review", title: "مراجعة الإدارة المالية", checks: [{ k: "review", multi: true, options: ["توفر الاعتماد في الموازنة", "اكتمال المستندات", "صحة التوجيه المحاسبي", "ضمن حدود الصلاحيات"] }], noteLines: 1 },
      { id: "approve", title: "اعتماد صاحب الصلاحية", checks: [{ k: "decision", options: ["موافق", "موافق بتعديل", "غير موافق"] }], noteLines: 1 },
    ],
    signatures: ["requester", "finance", "authority"],
    note: "هذا النموذج طلبٌ للصرف ولا يُعد إثباتاً لعملية الصرف، ويُرفق بسند الصرف عند التنفيذ.",
  },
  {
    key: "cash", code: "FIN-002", title: "سند صرف نقدي", subtitle: "يُستخدم لإثبات صرف مبلغ نقدي من صندوق الجمعية",
    sections: [
      { id: "info", title: "بيانات السند", fields: [{ k: "number", label: "رقم السند", kind: "ltr" }, { k: "date", label: "التاريخ", kind: "date" }, { k: "requestNo", label: "رقم طلب الصرف المعتمد", kind: "ltr" }] },
      { id: "benef", title: "بيانات المستلم", fields: [{ k: "beneficiary", label: "اسم المستلم", span: 2 }, { k: "idNo", label: "رقم الهوية", kind: "ltr" }, { k: "phone", label: "رقم الجوال", kind: "ltr" }], checks: [{ k: "capacity", label: "الصفة", options: ["متطوع", "موظف", "مورد", "مستفيد", "أخرى"] }] },
      { id: "amount", title: "المبلغ", fields: [...amount(), { k: "reason", label: "سبب الصرف", span: 3 }, { k: "project", label: "المشروع / البرنامج" }, { k: "budgetLine", label: "بند الموازنة", span: 2 }] },
      { id: "fund", title: "", text: "تم صرف المبلغ المذكور أعلاه نقداً من صندوق الجمعية." },
      { id: "decl", title: "إقرار الاستلام", text: "أقر أنا الموقع أدناه بأنني استلمت المبلغ المذكور أعلاه نقداً كاملاً غير منقوص، وذلك للغرض الموضح، وتبرأ ذمة الجمعية منه.", sign: true, thumb: true },
      { id: "docs", title: "المستندات المؤيدة", checks: [{ k: "docs", multi: true, options: ["طلب صرف معتمد", "فاتورة / إيصال", "صورة الهوية", "كشف حضور / تكليف", "أخرى"] }] },
    ],
    signatures: ["cashier", "finance", "authority"],
    note: "ملاحظة محاسبية: يُقيد السند من حساب المصروف المختص إلى حساب الصندوق، ويُحفظ مع مستنداته المؤيدة.",
  },
  {
    key: "voucher", code: "FIN-003", title: "سند صرف مالي", subtitle: "للصرف بشيك أو تحويل بنكي",
    sections: [
      { id: "info", title: "بيانات السند", fields: [{ k: "number", label: "رقم السند", kind: "ltr" }, { k: "date", label: "التاريخ", kind: "date" }, { k: "requestNo", label: "رقم طلب الصرف", kind: "ltr" }] },
      { id: "benef", title: "بيانات المستفيد", fields: [{ k: "beneficiary", label: "اسم المستفيد", span: 2 }, { k: "idNo", label: "رقم الهوية / السجل التجاري", kind: "ltr" }, { k: "department", label: "الإدارة / القسم المستفيد" }, { k: "project", label: "المشروع / البرنامج", span: 2 }] },
      { id: "amount", title: "المبلغ", fields: [...amount(), { k: "reason", label: "سبب الصرف", span: 3 }] },
      { id: "bank", title: "بيانات الصرف", checks: [{ k: "method", label: "طريقة الصرف", options: ["شيك", "تحويل بنكي"] }], fields: [{ k: "bank", label: "اسم البنك" }, { k: "holder", label: "اسم صاحب الحساب", span: 2 }, { k: "iban", label: "رقم الآيبان (IBAN)", span: 2, kind: "ltr" }, { k: "ref", label: "رقم الشيك / مرجع التحويل", kind: "ltr" }, { k: "execDate", label: "تاريخ التنفيذ", kind: "date" }] },
      { id: "docs", title: "المستندات المؤيدة", checks: [{ k: "docs", multi: true, options: ["طلب صرف معتمد", "فاتورة", "عقد", "صورة الهوية / السجل", "شهادة الآيبان", "أخرى"] }] },
      { id: "decl", title: "إقرار", text: "نقر بأن عملية الصرف تمت وفق الأنظمة واللوائح المالية للجمعية وبعد استيفاء المستندات المطلوبة." },
    ],
    signatures: ["preparer", "finance", "authority"],
    note: "",
    seal: true,
  },
  {
    key: "cheque", code: "FIN-004", title: "سند صرف شيك أو تحويل بنكي", subtitle: "إشعار تنفيذ صرف عبر البنك",
    sections: [
      { id: "info", title: "بيانات السند", fields: [{ k: "number", label: "رقم السند", kind: "ltr" }, { k: "date", label: "التاريخ", kind: "date" }, { k: "requestNo", label: "رقم طلب الصرف", kind: "ltr" }] },
      { id: "bank", title: "بيانات الشيك / التحويل", checks: [{ k: "method", label: "نوع العملية", options: ["شيك", "تحويل بنكي"] }], fields: [{ k: "ref", label: "رقم الشيك / المرجع", kind: "ltr" }, { k: "execDate", label: "تاريخ الشيك / التحويل", kind: "date" }, { k: "payFrom", label: "من حساب الجمعية لدى" }, { k: "bank", label: "بنك المستفيد" }, { k: "iban", label: "آيبان المستفيد", span: 2, kind: "ltr" }] },
      { id: "benef", title: "المستفيد", fields: [{ k: "beneficiary", label: "يُصرف لأمر", span: 2 }, { k: "idNo", label: "رقم الهوية / السجل", kind: "ltr" }, { k: "holder", label: "اسم صاحب الحساب", span: 3 }] },
      { id: "amount", title: "المبلغ", fields: [...amount(), { k: "reason", label: "وذلك مقابل", span: 3 }, { k: "project", label: "المشروع / البرنامج", span: 3 }] },
      { id: "decl", title: "استلام الشيك (عند الصرف بشيك)", text: "استلمت الشيك الموضح أعلاه بحالة سليمة.", sign: true },
    ],
    signatures: ["preparer", "finance", "authority"],
    note: "",
    seal: true,
  },
  {
    key: "receipt", code: "FIN-005", title: "سند قبض مالي", subtitle: "لإثبات استلام الجمعية لمبلغ مالي",
    sections: [
      { id: "info", title: "بيانات السند", fields: [{ k: "number", label: "رقم السند", kind: "ltr" }, { k: "date", label: "التاريخ", kind: "date" }, { k: "project", label: "المشروع / البرنامج" }] },
      { id: "payer", title: "بيانات الدافع", fields: [{ k: "payer", label: "استلمنا من", span: 2 }, { k: "idNo", label: "رقم الهوية / السجل", kind: "ltr" }], checks: [{ k: "payerType", label: "صفة الدافع", options: ["فرد", "جهة مانحة", "شركة", "أخرى"] }] },
      { id: "amount", title: "المبلغ", fields: [...amount(), { k: "purpose", label: "وذلك عن / الغرض", span: 3 }], checks: [{ k: "source", label: "مصدر المبلغ", options: ["تبرع نقدي", "دعم مالي / منحة", "مساهمة تأسيسية", "إيرادات برامج", "زكاة", "استرداد مبلغ", "أخرى"] }] },
      { id: "method", title: "طريقة الاستلام", checks: [{ k: "method", options: ["نقدي", "تحويل بنكي", "شيك"] }], fields: [{ k: "bank", label: "البنك" }, { k: "ref", label: "رقم الحوالة / الشيك", kind: "ltr" }, { k: "depositDate", label: "تاريخ الإيداع", kind: "date" }] },
    ],
    signatures: ["cashier", "finance", "authority"],
    note: "لا يُعتد بهذا السند إلا بعد التحصيل الفعلي للمبلغ وختمه بختم الجمعية. الشيكات تحت التحصيل.",
    seal: true,
  },
  {
    key: "ack", code: "FIN-006", title: "إيصال استلام مبلغ مالي", subtitle: "يُسلَّم للدافع إقراراً باستلام المبلغ",
    sections: [
      { id: "info", title: "", fields: [{ k: "number", label: "رقم الإيصال", kind: "ltr" }, { k: "date", label: "التاريخ", kind: "date" }] },
      { id: "payer", title: "بيانات المُسلِّم", fields: [{ k: "payer", label: "اسم المُسلِّم", span: 2 }, { k: "idNo", label: "رقم الهوية", kind: "ltr" }, { k: "phone", label: "رقم الجوال", kind: "ltr" }] },
      { id: "amount", title: "المبلغ", fields: [...amount(), { k: "purpose", label: "الغرض", span: 3 }, { k: "ref", label: "رقم المرجع", kind: "ltr" }], checks: [{ k: "method", label: "طريقة الاستلام", options: ["نقدي", "تحويل بنكي", "شيك"] }] },
      { id: "ack", title: "إقرار الاستلام", text: "تقر الجمعية باستلام المبلغ المذكور أعلاه، وتتعهد باستخدامه في الغرض المحدد وفق أنظمتها ولوائحها المعتمدة. شاكرين لكم دعمكم وجزاكم الله خيراً." },
    ],
    signatures: ["receiver", "finance", "authority"],
    note: "",
    seal: true,
  },
];
export const TPL = Object.fromEntries(TEMPLATES.map((t) => [t.key, t])) as Record<string, Tpl>;

export type Ov = { title?: string; code?: string; subtitle?: string; note?: string; hidden?: string[]; texts?: Record<string, string>; extra?: string[]; seal?: boolean; scale?: number; copy2?: boolean };

/** Merge saved per-template overrides with the definition. */
export function resolveTpl(key: string, ov: Ov = {}): Tpl & { extra: string[]; scale: number; copy2: boolean } {
  const base = TPL[key];
  const sections = base.sections.filter((s) => !(ov.hidden || []).includes(s.id)).map((s) => (s.text !== undefined && ov.texts?.[s.id] !== undefined ? { ...s, text: ov.texts[s.id] } : s));
  return { ...base, title: ov.title || base.title, code: ov.code ?? base.code, subtitle: ov.subtitle ?? base.subtitle, note: ov.note ?? base.note, seal: ov.seal ?? base.seal ?? true, sections, extra: (ov.extra || []).filter(Boolean), scale: ov.scale || 1, copy2: !!ov.copy2 };
}

// ─── data mappers (records → template values) ──────────────────────────────
const PAYER_AR: Record<string, string> = { INDIVIDUAL: "فرد", ENTITY: "جهة مانحة", COMPANY: "شركة", OTHER: "أخرى" };
const SRC_AR: Record<string, string> = { CASH_DONATION: "تبرع نقدي", SUPPORT: "دعم مالي / منحة", FOUNDING: "مساهمة تأسيسية", PROGRAM: "إيرادات برامج", ZAKAT: "زكاة", REFUND: "استرداد مبلغ", MEMBERSHIP: "أخرى", OTHER: "أخرى" };
const MTH_AR: Record<string, string> = { CASH: "نقدي", TRANSFER: "تحويل بنكي", CHEQUE: "شيك", CARD: "تحويل بنكي" };
const CAP_AR: Record<string, string> = { VOLUNTEER: "متطوع", EMPLOYEE: "موظف", SUPPLIER: "مورد", BENEFICIARY: "مستفيد", OTHER: "أخرى" };

export const fromReceipt = (r: any) => ({ number: r.number, date: fmtDate(r.date), project: r.projectName, payer: r.payerName, idNo: r.payerIdNo, phone: r.payerPhone, payerType: PAYER_AR[r.payerType], amount: r.amount, purpose: r.purpose, source: SRC_AR[r.source], method: MTH_AR[r.method], bank: r.bankName, ref: r.refNo, depositDate: fmtDate(r.depositDate) });
export const fromDisb = (d: any) => ({ number: d.number, date: fmtDate(d.date), requestNo: d.requestNumber || d.batchNumber, beneficiary: d.beneficiaryName, idNo: d.beneficiaryIdNo, phone: d.beneficiaryPhone, capacity: CAP_AR[d.capacity], department: d.department, amount: d.amount, reason: d.reason, project: d.projectName, budgetLine: d.budgetLine || d.expenseAccountName, method: d.kind === "CHEQUE" ? "شيك" : d.kind === "TRANSFER" ? "تحويل بنكي" : "نقدي", bank: d.bankName, holder: d.accountHolder, iban: d.iban, ref: d.refNo, execDate: fmtDate(d.execDate || d.date), payFrom: d.payAccountName, docs: d.docs || [] });
export const fromRequest = (r: any) => ({ number: r.number, date: fmtDate(r.date), requester: r.requester, department: r.department, beneficiary: r.beneficiaryName, idNo: r.beneficiaryIdNo, purpose: r.purpose, project: r.projectName, budgetLine: r.budgetLine || r.expenseAccountName, method: MTH_AR[r.method], amount: r.amount, justification: r.justification, attachments: r.attachments || [], review: Object.entries(r.review || {}).filter(([, v]) => v).map(([k]) => k), decision: r.status === "APPROVED" || r.status === "PAID" ? "موافق" : r.status === "REJECTED" ? "غير موافق" : "", decisionNote: r.decisionNote });

export const SAMPLE: Record<string, any> = {
  request: { number: "FRQ-2026-00012", date: "2026-10-14", requester: "منسق البرامج", department: "إدارة البرامج", beneficiary: "أسرة مستفيدة (ملف 245)", idNo: "1012345678", purpose: "شراء سلال غذائية لشهر أكتوبر", project: "مشروع السلة الغذائية", budgetLine: "مساعدات عينية", method: "تحويل بنكي", amount: 4500, justification: "حسب دراسة الحالة المعتمدة واحتياج الأسر المسجلة.", attachments: ["عرض سعر", "دراسة حالة"] },
  cash: { number: "DSB-2026-00031", date: "2026-10-14", requestNo: "FRQ-2026-00012", beneficiary: "محمد عبدالله", idNo: "1098765432", phone: "0550000000", capacity: "متطوع", amount: 300, reason: "مكافأة مشاركة في توزيع السلال", project: "مشروع السلة الغذائية", budgetLine: "مكافآت المتطوعين", docs: ["طلب صرف معتمد", "كشف حضور / تكليف"] },
  voucher: { number: "DSB-2026-00032", date: "2026-10-14", requestNo: "FRQ-2026-00012", beneficiary: "مؤسسة التموين المتحدة", idNo: "1010101010", department: "إدارة البرامج", project: "مشروع السلة الغذائية", amount: 4500, reason: "قيمة سلال غذائية", method: "تحويل بنكي", bank: "مصرف الراجحي", holder: "مؤسسة التموين المتحدة", iban: "SA0380000000608010167519", ref: "TRX-88231", execDate: "2026-10-14", docs: ["طلب صرف معتمد", "فاتورة"] },
  cheque: { number: "DSB-2026-00033", date: "2026-10-14", requestNo: "FRQ-2026-00013", method: "شيك", ref: "000451", execDate: "2026-10-15", payFrom: "البنك الأهلي السعودي", bank: "بنك الرياض", iban: "SA4420000001234567891234", beneficiary: "مؤسسة الصيانة", idNo: "1010202020", holder: "مؤسسة الصيانة", amount: 2300, reason: "صيانة مقر الجمعية", project: "المصاريف الإدارية" },
  receipt: { number: "DON-2026-00087", date: "2026-10-14", project: "مشروع السلة الغذائية", payer: "شركة داعمة للخير", idNo: "1010303030", payerType: "شركة", amount: 25000, purpose: "دعم مشروع السلة الغذائية", source: "دعم مالي / منحة", method: "تحويل بنكي", bank: "البنك الأهلي السعودي", ref: "TRX-55120", depositDate: "2026-10-14" },
  ack: { number: "DON-2026-00088", date: "2026-10-14", payer: "فاعل خير", idNo: "1000000000", phone: "0500000000", amount: 1000, purpose: "تبرع عام", ref: "", method: "نقدي" },
};

// ─── renderer ──────────────────────────────────────────────────────────────
export function A4({ tplKey, settings, data, blank }: { tplKey: string; settings: any; data?: any; blank?: boolean }) {
  const ov: Ov = settings?.templates?.[tplKey] || {};
  const t = resolveTpl(tplKey, ov);
  const theme = settings?.theme || {};
  const color = theme.color || "#1f6f4a";
  const accent = theme.accent || "#b7862b";
  const d = blank ? {} : data || {};
  const name = settings?.associationName || settings?.company?.nameAr || "";
  const logo = theme.hideLogo ? null : settings?.company?.logo;
  const sig = settings?.signatories || {};
  const val = (f: Field) => {
    if (f.kind === "words") { const a = Number(d.amount || 0); return a ? amountToArabicWords(a) : ""; }
    const v = d[f.k];
    if (v === undefined || v === null || v === "") return "";
    if (f.kind === "amount") return money(v);
    return String(v);
  };
  const isOn = (k: string, o: string) => { const v = d[k]; return Array.isArray(v) ? v.includes(o) : v === o; };
  const page = (copy?: string) => (
    <div className="a4" style={{ ["--a4c" as any]: color, ["--a4a" as any]: accent, fontSize: `${12.5 * t.scale}px` }}>
      <header className="a4-h">
        <div className="a4-org">
          {logo ? <img src={logo} alt="" /> : <div className="a4-logo-ph">{name.slice(0, 1)}</div>}
          <div>
            <b>{name}</b>
            {settings?.licenseNo && <span>مسجلة لدى {settings?.authority || "المركز الوطني لتنمية القطاع غير الربحي"} برقم ترخيص ({settings.licenseNo})</span>}
            {(settings?.address || settings?.phone) && <span className="a4-contact">{[settings?.address, settings?.phone && "هاتف: " + settings.phone, settings?.email].filter(Boolean).join(" · ")}</span>}
          </div>
        </div>
        <div className="a4-title">
          <h1>{t.title}</h1>
          {t.subtitle && <p>{t.subtitle}</p>}
          <div className="a4-meta">{t.code && <span className="a4-code">{t.code}</span>}{copy && <span className="a4-copy">{copy}</span>}</div>
        </div>
      </header>
      <div className="a4-body">
        {t.sections.map((s) => (
          <section key={s.id} className="a4-sec">
            {s.title && <h4>{s.title}</h4>}
            {s.checks?.map((c) => (
              <div key={c.k} className="a4-checks">{c.label && <label>{c.label}:</label>}{c.options.map((o) => <span key={o} className={"a4-cb" + (isOn(c.k, o) ? " on" : "")}><i>{isOn(c.k, o) ? "✓" : ""}</i>{o}</span>)}</div>
            ))}
            {s.fields && (
              <div className="a4-grid">
                {s.fields.map((f) => (
                  <div key={f.k} className={"a4-f s" + (f.span || 1) + (f.kind === "para" ? " para" : "") + (f.kind === "amount" ? " amt" : "")}>
                    {f.label && <label>{f.label}</label>}
                    <div className={"a4-v" + (f.kind === "ltr" || f.kind === "amount" ? " ltr" : "")}>{val(f)}</div>
                  </div>
                ))}
              </div>
            )}
            {s.text && <p className="a4-text">{s.text}</p>}
            {s.noteLines ? <div className="a4-note-line">ملاحظات: <span>{s.id === "approve" ? d.decisionNote || "" : ""}</span></div> : null}
            {s.sign && <div className="a4-sign-inline"><div><label>الاسم</label><span>{s.id === "decl" && tplKey === "request" ? d.requester || "" : d.beneficiary || ""}</span></div><div><label>التوقيع</label><span /></div>{s.thumb && <div className="a4-thumb">البصمة</div>}<div><label>التاريخ</label><span>{d.date || ""}</span></div></div>}
          </section>
        ))}
        {t.extra.length > 0 && <section className="a4-sec"><h4>بيانات إضافية</h4><div className="a4-grid">{t.extra.map((e) => <div key={e} className="a4-f s3"><label>{e}</label><div className="a4-v">{d.extra?.[e] || ""}</div></div>)}</div></section>}
      </div>
      <footer className="a4-f-sign">
        <div className="a4-sigs">
          {t.signatures.map((r) => (
            <div key={r} className="a4-sig">
              <b>{sig[r]?.title || ROLES[r]}</b>
              <span className="nm">{sig[r]?.name || ""}</span>
              <span className="ln">التوقيع</span>
            </div>
          ))}
          {t.seal && <div className="a4-seal">ختم الجمعية</div>}
        </div>
        {t.note && <p className="a4-note">{t.note}</p>}
        <div className="a4-foot">{name}{settings?.licenseNo ? ` — ترخيص رقم ${settings.licenseNo}` : ""}{theme.footer ? ` — ${theme.footer}` : ""}</div>
      </footer>
    </div>
  );
  return t.copy2 ? <>{page("الأصل")}{page("نسخة")}</> : page();
}

/** Shrinks the font of any page that would spill onto a second A4 sheet (e.g. many extra fields). */
function fitPages(root: HTMLElement) {
  root.style.cssText = "position:absolute;left:-99999px;top:0;display:block";
  const max = 1118; // 297mm at 96dpi, minus a hair for rounding
  root.querySelectorAll<HTMLElement>(".a4").forEach((pg) => {
    pg.style.minHeight = "0";
    for (let i = 0; i < 6 && pg.scrollHeight > max; i++) {
      const fs = parseFloat(getComputedStyle(pg).fontSize) || 12.5;
      pg.style.fontSize = `${Math.max(9, fs * Math.max(0.9, max / pg.scrollHeight))}px`;
    }
    pg.style.minHeight = "";
  });
  root.style.cssText = "";
}

/** Prints only the given element (A4 pages): a clone is placed in a print-only root so nothing else takes page space. */
export function printA4(el: HTMLElement | null) {
  if (!el) return;
  document.getElementById("a4-print-root")?.remove();
  const root = document.createElement("div");
  root.id = "a4-print-root";
  root.innerHTML = el.innerHTML;
  document.body.appendChild(root);
  fitPages(root);
  document.body.classList.add("printing-a4");
  const st = document.createElement("style");
  st.textContent = "@page { size: A4; margin: 0; }";
  document.head.appendChild(st);
  const done = () => { document.body.classList.remove("printing-a4"); root.remove(); st.remove(); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  setTimeout(() => { window.print(); setTimeout(done, 800); }, 60);
}

/** Modal with a filled A4 form and a print button. */
export function PrintModal({ tplKey, data, settings, onClose, choices }: { tplKey: string; data: any; settings: any; onClose: () => void; choices?: string[] }) {
  const [k, setK] = useState(tplKey);
  const ref = React.useRef<HTMLDivElement>(null);
  useEffect(() => setK(tplKey), [tplKey]);
  return (
    <Modal title={`طباعة: ${resolveTpl(k, settings?.templates?.[k]).title}`} onClose={onClose} wide footer={<>
      {choices && choices.length > 1 && <select className="input" style={{ width: 230 }} value={k} onChange={(e) => setK(e.target.value)}>{choices.map((c) => <option key={c} value={c}>{resolveTpl(c, settings?.templates?.[c]).title}</option>)}</select>}
      <button className="btn primary" onClick={() => printA4(ref.current)}>🖨 طباعة A4</button><button className="btn" onClick={onClose}>إغلاق</button>
    </>}>
      <div className="a4-stage"><div ref={ref} className="a4-wrap">{settings ? <A4 tplKey={k} settings={settings} data={data} /> : null}</div></div>
    </Modal>
  );
}
