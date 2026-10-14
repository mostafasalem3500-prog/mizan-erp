/** A4 ready-made forms for associations: definitions, renderer, data mappers and printing. */
import React, { useEffect, useState } from "react";
import { amountToArabicWords } from "../shared/tafqeet";
import { fmtDate, money, Modal } from "../lib";

export type Field = { k: string; label: string; span?: 1 | 2 | 3; kind?: "amount" | "words" | "date" | "para" | "ltr" | "money" };
export type Col = { k: string; label: string; w?: string; n?: boolean };
export type Section = { id: string; title: string; fields?: Field[]; checks?: { k: string; options: string[]; multi?: boolean; label?: string }[]; text?: string; sign?: boolean; thumb?: boolean; noteLines?: number; table?: { k: string; cols: Col[]; rows: number }; after?: boolean };
export type Tpl = { key: string; code: string; title: string; subtitle?: string; sections: Section[]; signatures: string[]; note: string; seal?: boolean; pageBreak?: string };

export const DEFAULT_NAME = "جمعية ريادة العطاء لخدمة الإنسان بالعسيلة الأهلية";
export const DEFAULT_LICENSE = "1000888600";
export const ROLES: Record<string, string> = { preparer: "المُعِد / المحاسب", cashier: "أمين الصندوق", finance: "المدير المالي", authority: "صاحب الصلاحية", requester: "مقدم الطلب", receiver: "مستلم المبلغ", executive: "المدير التنفيذي", procurement: "مسؤول المشتريات", committee: "المستلم / ممثل الإدارة المستفيدة", custodian: "صاحب العهدة", volunteer: "المتطوع المستلِم للمبلغ", programLead: "مسؤول البرنامج / المبادرة" };

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
    key: "ack", code: "FIN-006", title: "إيصال استلام مبلغ مالي", subtitle: "يُسلَّم للمسلِّم إثباتاً لاستلام الجمعية للمبلغ",
    sections: [
      { id: "info", title: "", fields: [{ k: "number", label: "رقم الإيصال", kind: "ltr" }, { k: "date", label: "التاريخ", kind: "date" }, { k: "journalNo", label: "رقم القيد المالي", kind: "ltr" }] },
      { id: "payer", title: "أولًا: بيانات المسلِّم", fields: [{ k: "payer", label: "اسم المسلِّم", span: 3 }, { k: "idNo", label: "رقم الهوية الوطنية / السجل التجاري", span: 2, kind: "ltr" }, { k: "phone", label: "رقم التواصل", kind: "ltr" }] },
      { id: "amount", title: "ثانيًا: بيانات المبلغ المستلَم", fields: [{ k: "payer", label: "استلمت الجمعية من السيد / الجهة", span: 3 }, ...amount(), { k: "purpose", label: "وذلك مقابل", span: 3 }] },
      { id: "method", title: "طريقة الاستلام", checks: [{ k: "method", options: ["نقدًا", "تحويل بنكي", "شيك بنكي", "أخرى"] }], fields: [{ k: "ref", label: "رقم مرجع العملية إن وجد", span: 2, kind: "ltr" }] },
      { id: "ack", title: "ثالثًا: الإقرار بالاستلام", text: "تقر {association} باستلام المبلغ الموضح أعلاه، ويُعد هذا الإيصال إثباتًا للاستلام في حدود المبلغ والغرض المبينين فيه، على أن تُستكمل إجراءات التوثيق والقيد المالي وفق الأنظمة واللوائح المعتمدة لدى الجمعية." },
    ],
    signatures: ["receiver", "finance", "authority"],
    note: "يُحفظ أصل الإيصال ضمن السجلات المالية للجمعية، وتُرفق به المستندات المؤيدة للاستلام عند الاقتضاء.",
    seal: true,
  },
  {
    key: "purchase", code: "FIN-007", title: "نموذج طلب شراء", subtitle: "لا يُعد أمر شراء ولا يرتب التزاماً مالياً قبل الاعتماد",
    sections: [
      { id: "info", title: "", fields: [{ k: "number", label: "رقم الطلب", kind: "ltr" }, { k: "date", label: "تاريخ الطلب", kind: "date" }, { k: "department", label: "الإدارة / القسم الطالب" }, { k: "requester", label: "اسم مقدم الطلب", span: 2 }, { k: "jobTitle", label: "المسمى الوظيفي" }] },
      { id: "items", title: "أولًا: تفاصيل الأصناف المطلوبة", table: { k: "items", rows: 5, cols: [{ k: "#", label: "م", w: "5%" }, { k: "name", label: "اسم الصنف / الخدمة", w: "27%" }, { k: "spec", label: "المواصفات المطلوبة", w: "28%" }, { k: "qty", label: "الكمية", w: "10%", n: true }, { k: "price", label: "سعر الوحدة", w: "13%", n: true }, { k: "total", label: "الإجمالي", w: "17%", n: true }] }, fields: [{ k: "subtotal", label: "إجمالي قيمة الطلب (ريال)", kind: "money" }, { k: "vat", label: "ضريبة القيمة المضافة إن وجدت", kind: "money" }, { k: "amount", label: "الإجمالي النهائي (ريال)", kind: "amount" }, { k: "amountWords", label: "المبلغ كتابةً", span: 3, kind: "words" }] },
      { id: "just", title: "ثانيًا: مبررات طلب الشراء", fields: [{ k: "purpose", label: "الغرض من الشراء", span: 3 }, { k: "project", label: "اسم البرنامج / المشروع المرتبط بالطلب", span: 2 }, { k: "needDate", label: "تاريخ الحاجة إلى الأصناف", kind: "date" }, { k: "funding", label: "مصدر التمويل / بند الميزانية", span: 3 }], checks: [{ k: "urgency", label: "مدى الحاجة", options: ["عاجل", "عادي"] }] },
      { id: "supplier", title: "ثالثًا: بيانات المورد عند توفرها", fields: [{ k: "supplier", label: "اسم المورد" }, { k: "supplierVat", label: "الرقم الضريبي إن وجد", kind: "ltr" }, { k: "quoteNo", label: "رقم عرض السعر", kind: "ltr" }, { k: "quoteDate", label: "تاريخ عرض السعر", kind: "date" }], checks: [{ k: "quotes", multi: true, options: ["مرفق عرض سعر", "مرفق أكثر من عرض سعر وفق السياسة المعتمدة"] }] },
      { id: "decl", title: "رابعًا: إقرار مقدم الطلب", text: "أقر بأن الأصناف أو الخدمات الموضحة في هذا الطلب لازمة لأعمال الجمعية أو برامجها، وأن البيانات والكميات والمواصفات المدرجة صحيحة بحسب الحاجة الفعلية، وأن الطلب لم يُقدَّم بقصد تجزئة المشتريات أو تجاوز الصلاحيات المالية. وأتعهد بعدم إصدار أمر شراء أو الالتزام المالي مع المورد قبل الحصول على الموافقات اللازمة وفق اللائحة المالية والإجراءات المعتمدة لدى الجمعية.", sign: true },
      { id: "review", title: "خامسًا: المراجعة والاعتماد", checks: [{ k: "procReview", label: "مسؤول المشتريات", options: ["تمت مراجعة الطلب", "يحتاج إلى استكمال عروض الأسعار"] }, { k: "finReview", label: "المسؤول المالي", options: ["يوجد اعتماد مالي متاح", "لا يوجد اعتماد مالي متاح"] }, { k: "execDecision", label: "المدير التنفيذي", options: ["موافق", "غير موافق"] }, { k: "decision", label: "صاحب الصلاحية", options: ["معتمد", "غير معتمد"] }], fields: [{ k: "budgetLine", label: "بند الميزانية", span: 2 }, { k: "approvedAmount", label: "المبلغ المعتمد (ريال)", kind: "money" }], noteLines: 1 },
      { id: "fin", title: "سادسًا: خاص بالإدارة المالية والمشتريات", fields: [{ k: "poNumber", label: "رقم أمر الشراء", kind: "ltr" }, { k: "approvedSupplier", label: "اسم المورد المعتمد" }, { k: "poDate", label: "تاريخ إصدار أمر الشراء", kind: "date" }, { k: "receivedDate", label: "تاريخ استلام الأصناف / الخدمة", kind: "date" }, { k: "receivingNo", label: "رقم محضر الاستلام", kind: "ltr" }, { k: "invoiceNo", label: "رقم الفاتورة", kind: "ltr" }] },
    ],
    signatures: ["requester", "procurement", "finance", "executive", "authority"],
    pageBreak: "decl",
    note: "ملاحظة تنظيمية: طلب الشراء ليس أمر شراء نهائيًا، ولا يترتب عليه التزام مالي تجاه المورد إلا بعد استكمال الموافقات والتعاقد أو إصدار أمر الشراء من صاحب الصلاحية، وفق اللوائح والإجراءات المالية المعتمدة لدى الجمعية.",
    seal: true,
  },
  {
    key: "receiving", code: "FIN-008", title: "محضر استلام مشتريات وتوريدات", subtitle: "إثبات الفحص والمطابقة قبل تسجيل الفاتورة والصرف",
    sections: [
      { id: "info", title: "", fields: [{ k: "number", label: "رقم المحضر", kind: "ltr" }, { k: "date", label: "التاريخ", kind: "date" }, { k: "poNumber", label: "رقم أمر الشراء", kind: "ltr" }, { k: "prNumber", label: "رقم طلب الشراء", kind: "ltr" }, { k: "department", label: "اسم الإدارة / القسم المستفيد", span: 2 }] },
      { id: "supplier", title: "أولًا: بيانات المورد", fields: [{ k: "supplier", label: "اسم المورد / المؤسسة", span: 2 }, { k: "supplierCr", label: "رقم السجل التجاري إن وجد", kind: "ltr" }, { k: "supplierVat", label: "الرقم الضريبي إن وجد", kind: "ltr" }, { k: "invoiceNo", label: "رقم الفاتورة", kind: "ltr" }, { k: "invoiceDate", label: "تاريخ الفاتورة", kind: "date" }] },
      { id: "items", title: "ثانيًا: بيان الأصناف المستلمة", table: { k: "items", rows: 5, cols: [{ k: "#", label: "م", w: "5%" }, { k: "name", label: "اسم الصنف / الخدمة", w: "22%" }, { k: "spec", label: "المواصفات", w: "20%" }, { k: "qtyReq", label: "الكمية المطلوبة", w: "11%", n: true }, { k: "qtyRec", label: "الكمية المستلمة", w: "11%", n: true }, { k: "condition", label: "حالة الصنف", w: "12%" }, { k: "notes", label: "ملاحظات", w: "19%" }] } },
      { id: "result", title: "ثالثًا: نتيجة الفحص والاستلام", text: "بعد فحص المشتريات ومطابقتها مع أمر الشراء والفاتورة والمواصفات المعتمدة، تبيّن ما يلي:", checks: [{ k: "results", multi: true, options: ["تم الاستلام كاملًا وبحالة سليمة ومطابقة للمواصفات", "تم الاستلام جزئيًا", "توجد أصناف غير مطابقة للمواصفات", "توجد أصناف تالفة أو بها نقص"] }], fields: [{ k: "shortage", label: "تفاصيل النقص أو الملاحظات إن وجدت", span: 3, kind: "para" }, { k: "action", label: "الإجراء المتخذ", span: 3 }] },
      { id: "value", title: "رابعًا: القيمة المالية للمشتريات", fields: [{ k: "subtotal", label: "إجمالي القيمة قبل الضريبة", kind: "money" }, { k: "vat", label: "ضريبة القيمة المضافة إن وجدت", kind: "money" }, { k: "total", label: "إجمالي القيمة شامل الضريبة", kind: "money" }, { k: "due", label: "المبلغ المستحق وفق المستندات المعتمدة (ريال)", span: 3, kind: "money" }] },
      { id: "decl", title: "خامسًا: إقرار لجنة الاستلام", text: "نقر نحن الموقعين أدناه بأن المشتريات الموضحة في هذا المحضر قد تم فحصها والتحقق من كمياتها وحالتها ومطابقتها لأمر الشراء والمواصفات المتفق عليها، وقد تم إثبات أي نقص أو تلف أو اختلاف في هذا المحضر، وذلك تمهيدًا لاستكمال الإجراءات الإدارية والمالية وفق اللوائح المعتمدة لدى الجمعية. ولا يُعد توقيع هذا المحضر وحده اعتمادًا نهائيًا للصرف ما لم تُستكمل بقية المستندات والإجراءات المطلوبة." },
      { id: "docs", title: "سابعًا: المستندات المرفقة", checks: [{ k: "docs", multi: true, options: ["أمر الشراء المعتمد", "فاتورة المورد", "عرض السعر المعتمد", "شهادة الضمان أو مستندات الأصناف", "صور المشتريات", "مستندات إضافية"] }] },
    ],
    signatures: ["committee", "procurement", "finance", "executive"],
    note: "يُحفظ أصل المحضر ضمن ملف المشتريات، وتُرفق به المستندات المؤيدة لإثبات الاستلام والمطابقة قبل استكمال إجراءات تسجيل الفاتورة والصرف.",
    seal: true,
  },
  {
    key: "refund", code: "FIN-009", title: "نموذج طلب استرداد مبلغ مالي", subtitle: "لا يُنفذ إلا بعد التحقق من الأحقية واعتماد الصرف",
    sections: [
      { id: "info", title: "", fields: [{ k: "number", label: "رقم الطلب", kind: "ltr" }, { k: "date", label: "التاريخ", kind: "date" }, { k: "journalNo", label: "رقم القيد المحاسبي", kind: "ltr" }] },
      { id: "req", title: "أولًا: بيانات مقدم الطلب", fields: [{ k: "requester", label: "اسم مقدم الطلب", span: 2 }, { k: "idNo", label: "رقم الهوية الوطنية / السجل التجاري", kind: "ltr" }, { k: "department", label: "القسم / الإدارة", span: 2 }, { k: "phone", label: "رقم التواصل", kind: "ltr" }] },
      { id: "amount", title: "ثانيًا: تفاصيل المبلغ المطلوب استرداده", fields: [...amount(), { k: "origDate", label: "تاريخ دفع المبلغ الأصلي", kind: "date" }, { k: "origRef", label: "رقم مرجع العملية الأصلية", span: 2, kind: "ltr" }], checks: [{ k: "origMethod", label: "طريقة الدفع الأصلية", options: ["نقدًا", "تحويل بنكي", "شيك", "أخرى"] }, { k: "reasonCode", label: "سبب طلب الاسترداد", options: ["سداد مبلغ بالزيادة", "تكرار عملية الدفع", "إلغاء طلب أو عملية شراء", "إعادة مبلغ غير مستحق", "سبب آخر"] }] },
      { id: "detail", title: "شرح تفصيلي لسبب الاسترداد", fields: [{ k: "reasonText", label: "", span: 3, kind: "para" }] },
      { id: "bank", title: "ثالثًا: بيانات إعادة المبلغ", fields: [{ k: "beneficiary", label: "اسم المستفيد من الاسترداد", span: 2 }, { k: "bank", label: "اسم البنك" }, { k: "holder", label: "اسم صاحب الحساب" }, { k: "iban", label: "رقم الآيبان", span: 2, kind: "ltr" }], checks: [{ k: "refundMethod", label: "طريقة الاسترداد المطلوبة", options: ["تحويل بنكي", "شيك", "أخرى"] }] },
      { id: "docs", title: "رابعًا: المستندات المؤيدة للطلب", checks: [{ k: "docs", multi: true, options: ["إيصال أو سند الدفع الأصلي", "فاتورة أو مستند العملية", "إثبات التحويل البنكي", "مستند يوضح سبب الاسترداد", "مستندات أخرى"] }] },
      { id: "decl", title: "خامسًا: إقرار مقدم الطلب", text: "أقر بصحة البيانات والمعلومات الواردة في هذا الطلب، وأن المبلغ المطلوب استرداده مرتبط بالعملية الموضحة أعلاه، وأتعهد بتقديم المستندات المؤيدة عند الطلب. وأوافق على خضوع الطلب للمراجعة والتحقق من أحقية الاسترداد قبل اعتماده وتنفيذه وفق اللوائح المالية والصلاحيات المعتمدة لدى الجمعية.", sign: true },
      { id: "review", title: "سادسًا: المراجعة والاعتماد", checks: [{ k: "finReview", label: "مراجعة المسؤول المالي", options: ["مستوفٍ للشروط والمستندات", "يحتاج إلى استكمال", "غير مستحق للاسترداد"] }, { k: "decision", label: "اعتماد صاحب الصلاحية", options: ["موافق", "غير موافق"] }], fields: [{ k: "approvedAmount", label: "المبلغ الذي تمت الموافقة عليه (ريال)", kind: "money" }, { k: "reviewNote", label: "ملاحظات المراجعة", span: 2 }] },
      { id: "fin", title: "سابعًا: خاص بالإدارة المالية", fields: [{ k: "executedDate", label: "تاريخ تنفيذ الاسترداد", kind: "date" }, { k: "executedAmount", label: "المبلغ المسترد فعليًا", kind: "money" }, { k: "executedRef", label: "رقم مرجع العملية", kind: "ltr" }, { k: "disbursementNo", label: "رقم سند الصرف", kind: "ltr" }], checks: [{ k: "executedMethod", label: "طريقة الاسترداد", options: ["تحويل بنكي", "شيك", "أخرى"] }] },
    ],
    signatures: ["requester", "finance", "authority"],
    pageBreak: "docs",
    note: "لا يُعد تقديم هذا النموذج موافقة نهائية على الاسترداد، ولا يُنفذ أي مبلغ إلا بعد التحقق من أحقية الطلب والمستندات المؤيدة واعتماد الصرف وفق الصلاحيات المالية المعتمدة لدى الجمعية.",
    seal: true,
  },
  {
    key: "custodyReq", code: "FIN-010", title: "نموذج طلب عهدة مالية", subtitle: "لا يُعد إذناً بالصرف قبل استكمال الاعتمادات",
    sections: [
      { id: "info", title: "", fields: [{ k: "number", label: "رقم الطلب", kind: "ltr" }, { k: "date", label: "التاريخ", kind: "date" }, { k: "department", label: "القسم / الإدارة" }, { k: "holder", label: "اسم مقدم الطلب", span: 2 }, { k: "jobTitle", label: "المسمى الوظيفي" }] },
      { id: "data", title: "أولًا: بيانات العهدة المطلوبة", fields: [...amount(), { k: "purpose", label: "الغرض من طلب العهدة", span: 3 }, { k: "project", label: "اسم البرنامج / المشروع المرتبط بالعهدة", span: 2 }, { k: "funding", label: "مصدر التمويل" }, { k: "neededDate", label: "تاريخ استلام العهدة المطلوب", kind: "date" }, { k: "settleDue", label: "تاريخ التسوية المتوقع", kind: "date" }], checks: [{ k: "method", label: "طريقة الصرف", options: ["تحويل بنكي", "شيك", "نقدًا وفق الضوابط المعتمدة"] }] },
      { id: "just", title: "ثانيًا: مبررات طلب العهدة", fields: [{ k: "justification", label: "", span: 3, kind: "para" }] },
      { id: "decl", title: "ثالثًا: إقرار طالب العهدة", text: "أقر أنا مقدم الطلب الموضحة بياناتي أعلاه بأن العهدة المالية المطلوبة ستُستخدم حصريًا في الأغراض المعتمدة لصالح {association}، وأتعهد بالمحافظة على المبلغ والمستندات المتعلقة به، وعدم استخدامه لأي غرض شخصي أو خارج نطاق التكليف المعتمد. كما أتعهد بتقديم المستندات المؤيدة لجميع المصروفات الفعلية، وإعادة المبلغ المتبقي غير المصروف، وتسوية العهدة خلال المدة المحددة ووفق اللائحة المالية والصلاحيات المعتمدة لدى الجمعية.", sign: true },
      { id: "review", title: "رابعًا: المراجعة والاعتماد", checks: [{ k: "finReview", label: "مراجعة المسؤول المالي", options: ["تمت المراجعة", "إعادة الطلب لاستكمال البيانات"] }, { k: "execDecision", label: "اعتماد المدير التنفيذي", options: ["موافق", "غير موافق"] }, { k: "decision", label: "اعتماد صاحب الصلاحية", options: ["معتمد", "غير معتمد"] }], fields: [{ k: "approvedAmount", label: "المبلغ المعتمد (ريال)", kind: "money" }, { k: "reviewNote", label: "ملاحظات", span: 2 }] },
      { id: "fin", title: "خامسًا: خاص بالإدارة المالية بعد الصرف", fields: [{ k: "disbursementNo", label: "رقم سند الصرف", kind: "ltr" }, { k: "disbursedDate", label: "تاريخ الصرف", kind: "date" }, { k: "disbursedAmount", label: "المبلغ المصروف فعليًا", kind: "money" }, { k: "ref", label: "رقم مرجع التحويل / الشيك", span: 3, kind: "ltr" }] },
    ],
    signatures: ["requester", "finance", "executive", "authority"],
    note: "لا يُعد هذا الطلب إذنًا بالصرف إلا بعد استكمال المراجعة والحصول على الاعتمادات اللازمة وفق الصلاحيات واللائحة المالية المعتمدة لدى الجمعية.",
    seal: true,
  },
  {
    key: "custodySettle", code: "FIN-011", title: "نموذج تسوية عهدة مالية", subtitle: "بيان المصروفات المؤيدة وإعادة المتبقي",
    sections: [
      { id: "info", title: "", fields: [{ k: "formNo", label: "رقم النموذج", kind: "ltr" }, { k: "number", label: "رقم العهدة", kind: "ltr" }, { k: "settleDate", label: "التاريخ", kind: "date" }] },
      { id: "holder", title: "أولًا: بيانات صاحب العهدة", fields: [{ k: "holder", label: "اسم الموظف / المسؤول", span: 2 }, { k: "idNo", label: "رقم الهوية الوطنية", kind: "ltr" }, { k: "department", label: "القسم / الإدارة" }, { k: "project", label: "اسم البرنامج / المشروع", span: 2 }, { k: "purpose", label: "الغرض من العهدة", span: 2 }, { k: "disbursedDate", label: "تاريخ استلام العهدة", kind: "date" }] },
      { id: "lines", title: "ثانيًا: بيان تسوية العهدة", fields: [{ k: "disbursedAmount", label: "قيمة العهدة المستلمة (ريال)", kind: "amount" }], table: { k: "lines", rows: 10, cols: [{ k: "#", label: "م", w: "5%" }, { k: "date", label: "تاريخ المصروف", w: "15%" }, { k: "description", label: "بيان المصروف والغرض منه", w: "45%" }, { k: "docNo", label: "رقم الفاتورة / المستند", w: "17%" }, { k: "amount", label: "المبلغ بالريال", w: "18%", n: true }] }, after: true },
      { id: "totals", title: "", fields: [{ k: "spent", label: "إجمالي المصروفات المؤيدة بالمستندات", kind: "money" }, { k: "returned", label: "المبلغ المتبقي من العهدة", kind: "money" }, { k: "extra", label: "المبلغ الواجب استكماله لصاحب العهدة", kind: "money" }] },
      { id: "result", title: "ثالثًا: نتيجة التسوية", checks: [{ k: "result", options: ["تمت التسوية بالكامل", "يوجد مبلغ متبقٍ واجب إعادته إلى الجمعية", "يوجد مبلغ مستحق لصاحب العهدة بعد المراجعة والاعتماد", "التسوية غير مكتملة وتحتاج إلى استيفاء مستندات"] }], fields: [{ k: "returned", label: "المبلغ المعاد إلى الجمعية", kind: "money" }, { k: "receiptRef", label: "رقم سند القبض / مرجع الإيداع", kind: "ltr" }, { k: "returnDate", label: "تاريخ إعادة المبلغ", kind: "date" }] },
      { id: "decl", title: "رابعًا: إقرار صاحب العهدة", text: "أقر أنا الموضحة بياناتي أعلاه بأن المصروفات المدرجة في هذا النموذج قد صُرفت للأغراض المعتمدة للعهدة، وأن البيانات والمبالغ الموضحة صحيحة بحسب علمي، وأنني أرفقت المستندات المؤيدة للمصروفات، وأتعهد بإعادة أي مبلغ متبقٍ غير مصروف إلى حساب الجمعية أو صندوقها وفق الإجراءات المالية المعتمدة. وأتحمل مسؤولية صحة المستندات والبيانات المقدمة، وأوافق على خضوع هذه التسوية للمراجعة المالية والتحقق من سلامة المصروفات واعتمادها وفق اللوائح والصلاحيات المعتمدة لدى الجمعية.", sign: true },
      { id: "review", title: "خامسًا: المراجعة والاعتماد", checks: [{ k: "finReview", label: "مراجعة المسؤول المالي", options: ["تمت المطابقة والمراجعة", "توجد ملاحظات تستوجب المعالجة"] }, { k: "decision", label: "اعتماد صاحب الصلاحية", options: ["اعتماد التسوية", "إعادة لاستكمال المتطلبات"] }], noteLines: 1 },
      { id: "docs", title: "سادسًا: المستندات المرفقة", checks: [{ k: "docs", multi: true, options: ["أصل الفواتير والمستندات المؤيدة", "إثبات إعادة المبلغ المتبقي", "سند القبض عند إعادة المتبقي", "مستندات إضافية مرتبطة بالعهدة"] }] },
    ],
    signatures: ["custodian", "finance", "executive", "authority"],
    pageBreak: "result",
    note: "تنبيه مالي: لا تُعد العهدة مسوّاة نهائيًا إلا بعد مراجعة المصروفات والمستندات المؤيدة، والتحقق من إعادة المتبقي إن وجد، واعتماد التسوية من صاحب الصلاحية وفق اللائحة المالية المعتمدة لدى الجمعية.",
    seal: true,
  },
  {
    key: "volunteer", code: "FIN-012", title: "إقرار استلام مستحقات متطوع", subtitle: "بدل مصروفات فعلية أو تعويض أو مكافأة معتمدة",
    sections: [
      { id: "info", title: "", fields: [{ k: "number", label: "رقم الإقرار", kind: "ltr" }, { k: "date", label: "التاريخ", kind: "date" }] },
      { id: "vol", title: "أولًا: بيانات المتطوع", fields: [{ k: "beneficiary", label: "اسم المتطوع رباعيًا", span: 2 }, { k: "idNo", label: "رقم الهوية الوطنية", kind: "ltr" }, { k: "phone", label: "رقم الجوال", kind: "ltr" }, { k: "program", label: "اسم البرنامج / المبادرة التطوعية", span: 2 }, { k: "periodFrom", label: "الفترة التطوعية من", kind: "date" }, { k: "periodTo", label: "إلى", kind: "date" }] },
      { id: "amount", title: "ثانيًا: تفاصيل المبلغ المستلَم", text: "أقر أنا المتطوع الموضحة بياناتي أعلاه بأنني استلمت من {association} مبلغًا وقدره:", fields: [...amount(), { k: "reason", label: "وذلك مقابل", span: 3 }, { k: "ref", label: "رقم مرجع التحويل / الشيك إن وجد", span: 2, kind: "ltr" }, { k: "date", label: "تاريخ الاستلام", kind: "date" }], checks: [{ k: "method", label: "طريقة الاستلام", options: ["تحويل بنكي", "شيك", "نقدًا وفق الإجراءات المعتمدة"] }] },
      { id: "decl", title: "ثالثًا: إقرار المتطوع", text: "أقر بصحة بياناتي الموضحة أعلاه وباستلام المبلغ المحدد في هذا الإقرار فعلًا، وأؤكد أن توقيعي يثبت استلام المبلغ المبين فقط، وفق الغرض والمستندات المعتمدة لدى الجمعية، دون أن يُعد هذا الإقرار تنازلًا عن أي حق نظامي آخر. وأتعهد بتقديم أي مستندات لازمة لإثبات الاستلام عند طلب الجمعية، مع علمي بأن جميع الإجراءات المالية تخضع للأنظمة واللوائح المعتمدة.", sign: true },
      { id: "att", title: "المرفقات", text: "صورة الهوية عند الحاجة وبما يتوافق مع ضوابط حماية البيانات، وإثبات التحويل أو صورة الشيك أو مستند القبض، وأمر الصرف المعتمد." },
    ],
    signatures: ["volunteer", "programLead", "finance", "authority"],
    note: "تنبيه تنظيمي: الأصل في التطوع أنه عمل دون مقابل مالي. إذا كان المبلغ بدل مصروفات فعلية أو تعويضًا معتمدًا أو مكافأة مصرحًا بها، فيجب توضيح طبيعته والغرض منه وتوثيق أساس الصرف قبل توقيع الإقرار.",
    seal: true,
  },
];
export const TPL = Object.fromEntries(TEMPLATES.map((t) => [t.key, t])) as Record<string, Tpl>;

export type Ov = { title?: string; code?: string; subtitle?: string; note?: string; hidden?: string[]; texts?: Record<string, string>; extra?: string[]; seal?: boolean; scale?: number; copy2?: boolean; onePage?: boolean };

/** Merge saved per-template overrides with the definition. */
export function resolveTpl(key: string, ov: Ov = {}): Tpl & { extra: string[]; scale: number; copy2: boolean; onePage: boolean } {
  const base = TPL[key];
  const sections = base.sections.filter((s) => !(ov.hidden || []).includes(s.id)).map((s) => (s.text !== undefined && ov.texts?.[s.id] !== undefined ? { ...s, text: ov.texts[s.id] } : s));
  return { ...base, title: ov.title || base.title, code: ov.code ?? base.code, subtitle: ov.subtitle ?? base.subtitle, note: ov.note ?? base.note, seal: ov.seal ?? base.seal ?? true, sections, extra: (ov.extra || []).filter(Boolean), scale: ov.scale || 1, copy2: !!ov.copy2, pageBreak: ov.onePage ? undefined : base.pageBreak, onePage: !!ov.onePage };
}

// ─── data mappers (records → template values) ──────────────────────────────
const PAYER_AR: Record<string, string> = { INDIVIDUAL: "فرد", ENTITY: "جهة مانحة", COMPANY: "شركة", OTHER: "أخرى" };
const SRC_AR: Record<string, string> = { CASH_DONATION: "تبرع نقدي", SUPPORT: "دعم مالي / منحة", FOUNDING: "مساهمة تأسيسية", PROGRAM: "إيرادات برامج", ZAKAT: "زكاة", REFUND: "استرداد مبلغ", MEMBERSHIP: "أخرى", OTHER: "أخرى" };
const MTH_AR: Record<string, string> = { CASH: "نقدي", TRANSFER: "تحويل بنكي", CHEQUE: "شيك", CARD: "تحويل بنكي" };
const CAP_AR: Record<string, string> = { VOLUNTEER: "متطوع", EMPLOYEE: "موظف", SUPPLIER: "مورد", BENEFICIARY: "مستفيد", OTHER: "أخرى" };

export const fromReceipt = (r: any) => ({ journalNo: r.journalNumber, number: r.number, date: fmtDate(r.date), project: r.projectName, payer: r.payerName, idNo: r.payerIdNo, phone: r.payerPhone, payerType: PAYER_AR[r.payerType], amount: r.amount, purpose: r.purpose, source: SRC_AR[r.source], method: MTH_AR[r.method], bank: r.bankName, ref: r.refNo, depositDate: fmtDate(r.depositDate) });
export const fromDisb = (d: any) => ({ number: d.number, date: fmtDate(d.date), requestNo: d.requestNumber || d.batchNumber, beneficiary: d.beneficiaryName, idNo: d.beneficiaryIdNo, phone: d.beneficiaryPhone, capacity: CAP_AR[d.capacity], department: d.department, amount: d.amount, reason: d.reason, project: d.projectName, budgetLine: d.budgetLine || d.expenseAccountName, method: d.kind === "CHEQUE" ? "شيك" : d.kind === "TRANSFER" ? "تحويل بنكي" : "نقدي", bank: d.bankName, holder: d.accountHolder, iban: d.iban, ref: d.refNo, execDate: fmtDate(d.execDate || d.date), payFrom: d.payAccountName, docs: d.docs || [], program: d.programName || d.projectName, periodFrom: fmtDate(d.periodFrom), periodTo: fmtDate(d.periodTo) });
const DEC = (st: string, yes: string, no: string) => (["APPROVED", "DISBURSED", "SETTLED", "ORDERED", "RECEIVED", "PAID"].includes(st) ? yes : st === "REJECTED" ? no : "");
const RES_AR: Record<string, string> = { FULL: "تمت التسوية بالكامل", RETURNED: "يوجد مبلغ متبقٍ واجب إعادته إلى الجمعية", EXTRA: "يوجد مبلغ مستحق لصاحب العهدة بعد المراجعة والاعتماد" };
export const fromCustody = (c: any) => {
  const st = c.settlement || {};
  return {
    number: c.number, date: fmtDate(c.date), department: c.department, holder: c.holderName, jobTitle: c.jobTitle, idNo: c.idNo, amount: c.amount, purpose: c.purpose, project: c.projectName,
    funding: c.funding, neededDate: fmtDate(c.neededDate), settleDue: fmtDate(c.settleDue), method: MTH_AR[c.method], justification: c.justification,
    finReview: ["REVIEWED", "APPROVED", "DISBURSED", "SETTLED"].includes(c.status) ? "تمت المراجعة" : "", decision: DEC(c.status, "معتمد", "غير معتمد"), execDecision: DEC(c.status, "موافق", "غير موافق"),
    approvedAmount: c.approvedAmount, reviewNote: c.reviewNote, disbursementNo: c.disbursementNumber, disbursedDate: fmtDate(c.disbursedDate), disbursedAmount: c.disbursedAmount, ref: c.refNo,
    formNo: c.status === "SETTLED" ? `STL-${c.number}` : "", settleDate: fmtDate(st.date), lines: (st.lines || []).map((l: any) => ({ ...l, date: fmtDate(l.date) })), spent: st.spent, returned: st.returned, extra: st.extra,
    result: RES_AR[st.result] || "", receiptRef: st.receiptRef, returnDate: st.returned ? fmtDate(st.date) : "", decisionNote: st.note || c.reviewNote,
    docs: c.status === "SETTLED" ? ["أصل الفواتير والمستندات المؤيدة", ...(st.returned ? ["إثبات إعادة المبلغ المتبقي"] : [])] : [],
    signName: c.holderName,
  };
};
export const fromForm = (f: any) => {
  const d = f.data || {}, rv = f.review || {};
  const base: any = { ...d, number: f.number, date: fmtDate(f.date), project: f.projectName || d.project, approvedAmount: rv.approvedAmount, reviewNote: rv.reviewNote, decisionNote: rv.decisionNote || rv.reviewNote };
  if (f.kind === "PURCHASE") return { ...base, amount: d.total, signName: d.requester, procReview: rv.procReview ? "تمت مراجعة الطلب" : "", finReview: rv.finReview ? "يوجد اعتماد مالي متاح" : "", execDecision: DEC(f.status, "موافق", "غير موافق"), decision: DEC(f.status, "معتمد", "غير معتمد"), poDate: fmtDate(d.poDate), needDate: fmtDate(d.needDate), quoteDate: fmtDate(d.quoteDate), receivedDate: fmtDate(d.receivedDate) };
  if (f.kind === "RECEIVING") return { ...base, prNumber: f.parentNumber || d.prNumber, invoiceDate: fmtDate(d.invoiceDate) };
  return { ...base, amount: f.amount, signName: d.requester, origDate: fmtDate(d.origDate), origMethod: MTH_AR[d.origMethod] || d.origMethod, refundMethod: MTH_AR[d.refundMethod] || d.refundMethod, finReview: rv.reviewNote !== undefined || ["APPROVED", "PAID"].includes(f.status) ? (f.status === "REJECTED" ? "غير مستحق للاسترداد" : "مستوفٍ للشروط والمستندات") : "", decision: DEC(f.status, "موافق", "غير موافق"), executedDate: fmtDate(d.executedDate), executedMethod: d.executedRef ? MTH_AR[d.refundMethod] || "تحويل بنكي" : "", disbursementNo: d.disbursementNo || f.disbursementNumber };
};
export const fromRequest = (r: any) => ({ number: r.number, date: fmtDate(r.date), requester: r.requester, department: r.department, beneficiary: r.beneficiaryName, idNo: r.beneficiaryIdNo, purpose: r.purpose, project: r.projectName, budgetLine: r.budgetLine || r.expenseAccountName, method: MTH_AR[r.method], amount: r.amount, justification: r.justification, attachments: r.attachments || [], review: Object.entries(r.review || {}).filter(([, v]) => v).map(([k]) => k), decision: r.status === "APPROVED" || r.status === "PAID" ? "موافق" : r.status === "REJECTED" ? "غير موافق" : "", decisionNote: r.decisionNote });

export const SAMPLE: Record<string, any> = {
  request: { number: "FRQ-2026-00012", date: "2026-10-14", requester: "منسق البرامج", department: "إدارة البرامج", beneficiary: "أسرة مستفيدة (ملف 245)", idNo: "1012345678", purpose: "شراء سلال غذائية لشهر أكتوبر", project: "مشروع السلة الغذائية", budgetLine: "مساعدات عينية", method: "تحويل بنكي", amount: 4500, justification: "حسب دراسة الحالة المعتمدة واحتياج الأسر المسجلة.", attachments: ["عرض سعر", "دراسة حالة"] },
  cash: { number: "DSB-2026-00031", date: "2026-10-14", requestNo: "FRQ-2026-00012", beneficiary: "محمد عبدالله", idNo: "1098765432", phone: "0550000000", capacity: "متطوع", amount: 300, reason: "مكافأة مشاركة في توزيع السلال", project: "مشروع السلة الغذائية", budgetLine: "مكافآت المتطوعين", docs: ["طلب صرف معتمد", "كشف حضور / تكليف"] },
  voucher: { number: "DSB-2026-00032", date: "2026-10-14", requestNo: "FRQ-2026-00012", beneficiary: "مؤسسة التموين المتحدة", idNo: "1010101010", department: "إدارة البرامج", project: "مشروع السلة الغذائية", amount: 4500, reason: "قيمة سلال غذائية", method: "تحويل بنكي", bank: "مصرف الراجحي", holder: "مؤسسة التموين المتحدة", iban: "SA0380000000608010167519", ref: "TRX-88231", execDate: "2026-10-14", docs: ["طلب صرف معتمد", "فاتورة"] },
  cheque: { number: "DSB-2026-00033", date: "2026-10-14", requestNo: "FRQ-2026-00013", method: "شيك", ref: "000451", execDate: "2026-10-15", payFrom: "البنك الأهلي السعودي", bank: "بنك الرياض", iban: "SA4420000001234567891234", beneficiary: "مؤسسة الصيانة", idNo: "1010202020", holder: "مؤسسة الصيانة", amount: 2300, reason: "صيانة مقر الجمعية", project: "المصاريف الإدارية" },
  receipt: { number: "DON-2026-00087", date: "2026-10-14", project: "مشروع السلة الغذائية", payer: "شركة داعمة للخير", idNo: "1010303030", payerType: "شركة", amount: 25000, purpose: "دعم مشروع السلة الغذائية", source: "دعم مالي / منحة", method: "تحويل بنكي", bank: "البنك الأهلي السعودي", ref: "TRX-55120", depositDate: "2026-10-14" },
  purchase: { number: "PRQ-2026-00004", date: "2026-10-14", department: "إدارة البرامج", requester: "منسق البرامج", jobTitle: "منسق", items: [{ name: "سلة غذائية متكاملة", spec: "أرز 10كجم، سكر، زيت، تمر", qty: 50, price: 180, total: 9000 }, { name: "خدمة نقل وتوزيع", spec: "شاحنة لمدة يومين", qty: 1, price: 800, total: 800 }], subtotal: 9800, vat: 1470, amount: 11270, purpose: "توزيع سلال رمضان على الأسر المسجلة", project: "مشروع السلة الغذائية", urgency: "عاجل", needDate: "2026-10-25", funding: "تبرعات مقيدة — مشروع السلة", supplier: "مؤسسة التموين المتحدة", supplierVat: "300000000000003", quoteNo: "Q-1182", quoteDate: "2026-10-12", quotes: ["مرفق أكثر من عرض سعر وفق السياسة المعتمدة"] },
  receiving: { number: "GRN-2026-00003", date: "2026-10-20", poNumber: "PO-2026-031", prNumber: "PRQ-2026-00004", department: "إدارة البرامج", supplier: "مؤسسة التموين المتحدة", supplierCr: "1010101010", supplierVat: "300000000000003", invoiceNo: "INV-5521", invoiceDate: "2026-10-20", items: [{ name: "سلة غذائية متكاملة", spec: "حسب العرض المعتمد", qtyReq: 50, qtyRec: 48, condition: "سليم", notes: "نقص سلتين" }, { name: "خدمة نقل وتوزيع", spec: "يومان", qtyReq: 1, qtyRec: 1, condition: "منفذة", notes: "" }], results: ["تم الاستلام جزئيًا"], shortage: "نقص عدد 2 سلة غذائية، تعهد المورد بتوريدها خلال 3 أيام.", action: "خصم قيمة النقص من الفاتورة لحين التوريد", subtotal: 9440, vat: 1416, total: 10856, due: 10856, docs: ["أمر الشراء المعتمد", "فاتورة المورد", "عرض السعر المعتمد"] },
  refund: { number: "RFD-2026-00002", date: "2026-10-14", journalNo: "JV-2026-00412", requester: "عبدالله محمد", idNo: "1012345678", department: "—", phone: "0550000000", amount: 500, origDate: "2026-10-10", origMethod: "تحويل بنكي", origRef: "TRX-77120", reasonCode: "تكرار عملية الدفع", reasonText: "تم تحويل مبلغ التبرع مرتين بالخطأ في نفس اليوم.", beneficiary: "عبدالله محمد", bank: "مصرف الراجحي", holder: "عبدالله محمد", iban: "SA0380000000608010167519", refundMethod: "تحويل بنكي", docs: ["إثبات التحويل البنكي", "إيصال أو سند الدفع الأصلي"] },
  custodyReq: { number: "CST-2026-00007", date: "2026-10-14", department: "إدارة البرامج", holder: "خالد عبدالرحمن", jobTitle: "منسق ميداني", amount: 3000, purpose: "مصروفات ميدانية لتوزيع السلال (نقل، تحميل، مستلزمات)", project: "مشروع السلة الغذائية", funding: "تبرعات مقيدة", neededDate: "2026-10-16", settleDue: "2026-10-30", method: "نقدًا وفق الضوابط المعتمدة", justification: "تعذر الصرف المباشر للموردين الصغار في مواقع التوزيع." },
  custodySettle: { formNo: "STL-CST-2026-00007", number: "CST-2026-00007", settleDate: "2026-10-28", holder: "خالد عبدالرحمن", idNo: "1098765432", department: "إدارة البرامج", project: "مشروع السلة الغذائية", purpose: "مصروفات ميدانية لتوزيع السلال", disbursedDate: "2026-10-16", disbursedAmount: 3000, lines: [{ date: "2026-10-17", description: "أجور تحميل وتنزيل", docNo: "R-102", amount: 900 }, { date: "2026-10-18", description: "مياه وتمر للمتطوعين", docNo: "F-5512", amount: 650 }, { date: "2026-10-19", description: "أكياس وأدوات تغليف", docNo: "F-5530", amount: 820 }], spent: 2370, returned: 630, extra: 0, result: "يوجد مبلغ متبقٍ واجب إعادته إلى الجمعية", receiptRef: "DON-2026-00120", returnDate: "2026-10-28", docs: ["أصل الفواتير والمستندات المؤيدة", "سند القبض عند إعادة المتبقي"] },
  volunteer: { number: "DSB-2026-00045", date: "2026-10-14", beneficiary: "سعد علي محمد القحطاني", idNo: "1087654321", phone: "0560000000", program: "مبادرة إفطار صائم", periodFrom: "2026-03-01", periodTo: "2026-03-30", amount: 600, reason: "بدل مواصلات فعلية معتمدة خلال فترة المبادرة", method: "تحويل بنكي", ref: "TRX-99120" },
  ack: { journalNo: "JV-2026-00433", number: "DON-2026-00088", date: "2026-10-14", payer: "فاعل خير", idNo: "1000000000", phone: "0500000000", amount: 1000, purpose: "تبرع عام", ref: "", method: "نقدي" },
};

// ─── renderer ──────────────────────────────────────────────────────────────
export function A4({ tplKey, settings, data, blank }: { tplKey: string; settings: any; data?: any; blank?: boolean }) {
  const ov: Ov = settings?.templates?.[tplKey] || {};
  const t = resolveTpl(tplKey, ov);
  const theme = settings?.theme || {};
  const color = theme.color || "#1f6f4a";
  const accent = theme.accent || "#b7862b";
  const d = blank ? {} : data || {};
  const name = settings?.associationName || DEFAULT_NAME;
  const logo = theme.hideLogo ? null : settings?.company?.logo;
  const sig = settings?.signatories || {};
  const val = (f: Field) => {
    if (f.kind === "words") { const a = Number(d.amount || 0); return a ? amountToArabicWords(a) : ""; }
    const v = d[f.k];
    if (v === undefined || v === null || v === "") return "";
    if (f.kind === "amount" || f.kind === "money") return Number(v) || Number(v) === 0 ? money(v) : String(v);
    return String(v);
  };
  const norm = (x: any) => String(x ?? "").replace(/[ًٌٍ]/g, "").replace(/ وفق .*$/, "").replace(/ بنكي$/, "").trim().replace(/ا$/, "").replace(/ي$/, "");
  const isOn = (k: string, o: string) => { const v = d[k]; return Array.isArray(v) ? v.some((x) => x === o || norm(x) === norm(o)) : v !== undefined && v !== null && v !== "" && (v === o || norm(v) === norm(o)); };
  const fill = (txt: string) => txt.replace(/\{association\}/g, name || "الجمعية");
  const signName = d.signName ?? d.requester ?? d.holder ?? d.beneficiary ?? "";
  const table = (tb: NonNullable<Section["table"]>) => {
    const items: any[] = Array.isArray(d[tb.k]) ? d[tb.k] : [];
    const n = Math.max(tb.rows, items.length);
    return (
      <table className="a4-tbl"><thead><tr>{tb.cols.map((c) => <th key={c.k} style={{ width: c.w }}>{c.label}</th>)}</tr></thead>
        <tbody>{Array.from({ length: n }).map((_, i) => { const it = items[i]; return <tr key={i}>{tb.cols.map((c) => <td key={c.k} className={c.n ? "n" : ""}>{c.k === "#" ? i + 1 : it ? (c.n && it[c.k] !== "" && it[c.k] !== undefined && it[c.k] !== null ? (c.k === "price" || c.k === "total" || c.k === "amount" ? money(it[c.k]) : String(it[c.k])) : String(it[c.k] ?? "")) : ""}</td>)}</tr>; })}</tbody>
      </table>
    );
  };
  const grid = (s: Section) => s.fields && (
    <div className="a4-grid">
      {s.fields.map((f, i) => (
        <div key={f.k + i} className={"a4-f s" + (f.span || 1) + (f.kind === "para" ? " para" : "") + (f.kind === "amount" ? " amt" : "")}>
          {f.label && <label>{f.label}</label>}
          <div className={"a4-v" + (f.kind === "ltr" || f.kind === "amount" || f.kind === "money" ? " ltr" : "")}>{val(f)}</div>
        </div>
      ))}
    </div>
  );
  const bi = t.pageBreak ? t.sections.findIndex((x) => x.id === t.pageBreak) : -1;
  const parts = bi > 0 ? [t.sections.slice(0, bi), t.sections.slice(bi)] : [t.sections];
  const sec = (s: Section) => (
    <section key={s.id} className="a4-sec">
      {s.title && <h4>{s.title}</h4>}
      {s.text && <p className="a4-text">{fill(s.text)}</p>}
      {s.checks?.map((c) => (
        <div key={c.k} className="a4-checks">{c.label && <label>{c.label}:</label>}{c.options.map((o) => <span key={o} className={"a4-cb" + (isOn(c.k, o) ? " on" : "")}><i>{isOn(c.k, o) ? "✓" : ""}</i>{o}</span>)}</div>
      ))}
      {s.after ? <>{grid(s)}{s.table && table(s.table)}</> : <>{s.table && table(s.table)}{grid(s)}</>}
      {s.noteLines ? <div className="a4-note-line">ملاحظات: <span>{s.id === "approve" || s.id === "review" ? d.decisionNote || "" : ""}</span></div> : null}
      {s.sign && <div className="a4-sign-inline"><div><label>الاسم</label><span>{signName}</span></div><div><label>التوقيع</label><span /></div>{s.thumb && <div className="a4-thumb">البصمة</div>}<div><label>التاريخ</label><span>{d.date || ""}</span></div></div>}
    </section>
  );
  const page = (copy: string | undefined, secs: Section[], pi: number, pn: number) => {
    const last = pi === pn - 1;
    return (
      <div key={(copy || "") + pi} className={"a4" + (pi > 0 ? " cont" : "") + (t.onePage ? " one" : "")} style={{ ["--a4c" as any]: color, ["--a4a" as any]: accent, fontSize: `${12.5 * t.scale}px` }}>
        {pi === 0 ? (
          <header className="a4-h">
            <div className="a4-org">
              {logo ? <img src={logo} alt="" /> : <div className="a4-logo-ph">{name.slice(0, 1)}</div>}
              <div>
                <b>{name}</b>
                {(settings?.licenseNo || DEFAULT_LICENSE) && <span>مسجلة لدى {settings?.authority || "المركز الوطني لتنمية القطاع غير الربحي"} برقم ترخيص ({settings.licenseNo})</span>}
                {(settings?.address || settings?.phone) && <span className="a4-contact">{[settings?.address, settings?.phone && "هاتف: " + settings.phone, settings?.email].filter(Boolean).join(" · ")}</span>}
              </div>
            </div>
            <div className="a4-title">
              <h1>{t.title}</h1>
              {t.subtitle && <p>{t.subtitle}</p>}
              <div className="a4-meta">{t.code && <span className="a4-code">{t.code}</span>}{copy && <span className="a4-copy">{copy}</span>}{pn > 1 && <span className="a4-copy">صفحة 1 من {pn}</span>}</div>
            </div>
          </header>
        ) : (
          <header className="a4-h mini"><b>{name}</b><span>{t.title}{d.number ? ` — ${d.number}` : ""}</span><div className="a4-meta">{t.code && <span className="a4-code">{t.code}</span>}{copy && <span className="a4-copy">{copy}</span>}<span className="a4-copy">صفحة {pi + 1} من {pn}</span></div></header>
        )}
        <div className="a4-body">
          {secs.map(sec)}
          {last && t.extra.length > 0 && <section className="a4-sec"><h4>بيانات إضافية</h4><div className="a4-grid">{t.extra.map((e) => <div key={e} className="a4-f s3"><label>{e}</label><div className="a4-v">{d.extra?.[e] || ""}</div></div>)}</div></section>}
          {!last && <div className="a4-cont">يتبع في الصفحة التالية ←</div>}
        </div>
        {last ? (
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
            <div className="a4-foot">{name}{(settings?.licenseNo || DEFAULT_LICENSE) ? ` — ترخيص رقم ${settings.licenseNo}` : ""}{theme.footer ? ` — ${theme.footer}` : ""}</div>
          </footer>
        ) : <div className="a4-foot">{name}{(settings?.licenseNo || DEFAULT_LICENSE) ? ` — ترخيص رقم ${settings.licenseNo}` : ""}</div>}
      </div>
    );
  };
  const doc = (copy?: string) => parts.map((secs, pi) => page(copy, secs, pi, parts.length));
  return t.copy2 ? <>{doc("الأصل")}{doc("نسخة")}</> : <>{doc()}</>;
}

/** Shrinks the font of any page that would spill onto a second A4 sheet (e.g. many extra fields). */
function fitPages(root: HTMLElement) {
  root.style.cssText = "position:absolute;left:-99999px;top:0;display:block";
  const max = 1118; // 297mm at 96dpi, minus a hair for rounding
  root.querySelectorAll<HTMLElement>(".a4").forEach((pg) => {
    pg.style.minHeight = "0";
    for (let i = 0; i < 10 && pg.scrollHeight > max; i++) {
      const fs = parseFloat(getComputedStyle(pg).fontSize) || 12.5;
      const floor = pg.classList.contains("one") ? 8.5 : 10;
      if (fs <= floor + 0.1) break;
      pg.style.fontSize = `${Math.max(floor, fs * Math.max(0.88, (max / pg.scrollHeight) * 0.99))}px`;
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
  const empty = !data || !Object.keys(data).length;
  const [blank, setBlank] = useState(empty);
  const [copies, setCopies] = useState(1);
  const ref = React.useRef<HTMLDivElement>(null);
  useEffect(() => setK(tplKey), [tplKey]);
  return (
    <Modal title={`طباعة: ${resolveTpl(k, settings?.templates?.[k]).title}${blank ? " — نموذج فارغ" : ""}`} onClose={onClose} wide footer={<>
      {choices && choices.length > 1 && <select className="input" style={{ width: 230 }} value={k} onChange={(e) => setK(e.target.value)}>{choices.map((c) => <option key={c} value={c}>{resolveTpl(c, settings?.templates?.[c]).title}</option>)}</select>}
      <div className="row" style={{ gap: 4 }}>
        <button className={"btn sm" + (!blank ? " primary" : "")} disabled={empty} onClick={() => setBlank(false)}>معبأ بالبيانات</button>
        <button className={"btn sm" + (blank ? " primary" : "")} onClick={() => setBlank(true)}>فارغ للتعبئة اليدوية</button>
      </div>
      {blank && <label className="row small" style={{ gap: 4 }}>عدد النسخ <input className="input" type="number" min={1} max={50} value={copies} onChange={(e) => setCopies(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} style={{ width: 64 }} /></label>}
      <button className="btn primary" onClick={() => printA4(ref.current)}>🖨 طباعة A4</button><button className="btn" onClick={onClose}>إغلاق</button>
    </>}>
      <div className="a4-stage"><div ref={ref} className="a4-wrap">{settings ? Array.from({ length: blank ? copies : 1 }).map((_, i) => <A4 key={i} tplKey={k} settings={settings} data={blank ? {} : data} blank={blank} />) : null}</div></div>
    </Modal>
  );
}
