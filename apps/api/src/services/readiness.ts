/** Go-live checklist for a company: what is configured, what is still missing, with the screen that fixes it. */
import { Db } from "../db/pool";

export async function readiness(t: Db, companyId: string, company: any) {
  const n = async (sql: string) => Number((await t.one(sql, [companyId])).c);
  const z = await t.maybe(`SELECT phase, (production_cert IS NOT NULL) prod, (compliance_cert IS NOT NULL) comp FROM zatca_configs WHERE company_id=$1`, [companyId]);
  const items = [
    { key: "company", label: "بيانات المنشأة (الاسم والرقم الضريبي والعنوان)", ok: !!(company.vatNumber && company.city && (company.street || company.district)), to: "/settings", hint: "يظهر على الفاتورة الضريبية ومطلوب للهيئة" },
    { key: "logo", label: "شعار المنشأة على الفواتير", ok: !!company.logo, to: "/settings/invoice", optional: true },
    { key: "opening", label: "الأرصدة الافتتاحية (قيد افتتاحي أو أرصدة مخزون)", ok: (await n(`SELECT COUNT(*) c FROM journal_entries WHERE company_id=$1 AND type='OPENING' AND status='POSTED'`)) > 0, to: "/journals", hint: "رأس المال، أرصدة البنوك والصناديق، ذمم العملاء والموردين، المخزون" },
    { key: "products", label: "الأصناف والخدمات", ok: (await n(`SELECT COUNT(*) c FROM products WHERE company_id=$1 AND is_active AND NOT is_demo`)) > 0, to: "/products" },
    { key: "images", label: "صور الأصناف لنقطة البيع", ok: (await n(`SELECT COUNT(*) c FROM products WHERE company_id=$1 AND is_active AND NOT is_demo AND image IS NOT NULL`)) > 0, to: "/products", optional: true },
    { key: "customers", label: "العملاء", ok: (await n(`SELECT COUNT(*) c FROM partners WHERE company_id=$1 AND is_customer AND NOT is_demo`)) > 0, to: "/customers", optional: true },
    { key: "suppliers", label: "الموردون", ok: (await n(`SELECT COUNT(*) c FROM partners WHERE company_id=$1 AND is_supplier AND NOT is_demo`)) > 0, to: "/suppliers", optional: true },
    { key: "bank", label: "حساب بنكي واحد على الأقل بحركات", ok: (await n(`SELECT COUNT(*) c FROM accounts a WHERE a.company_id=$1 AND a.subtype='BANK' AND EXISTS (SELECT 1 FROM journal_lines l WHERE l.account_id=a.id)`)) > 0, to: "/accounts", optional: true },
    { key: "users", label: "مستخدمون بأدوار (كاشير، محاسب…)", ok: (await n(`SELECT COUNT(*) c FROM memberships WHERE company_id=$1 AND is_active`)) > 1, to: "/settings/users", optional: true },
    { key: "vatPeriod", label: "دورية الإقرار الضريبي (شهري/ربع سنوي)", ok: !!company.vatPeriod, to: "/settings" },
    { key: "zatca", label: "الفوترة الإلكترونية — المرحلة الثانية (ربط الجهاز)", ok: !!(z && z.phase === 2 && z.prod), to: "/zatca", hint: z && z.phase === 2 ? (z.comp ? "شهادة الامتثال موجودة — أصدر شهادة الإنتاج" : "ابدأ بإصدار CSR ثم OTP من بوابة فاتورة") : "المرحلة الأولى (QR) مفعّلة تلقائياً", optional: true },
    { key: "demo", label: "حذف البيانات التجريبية قبل التشغيل الفعلي", ok: (await n(`SELECT COUNT(*) c FROM invoices WHERE company_id=$1 AND is_demo`)) === 0, to: "/settings/demo" },
    { key: "backup", label: "نسخة احتياطية أولى", ok: false, to: "/settings/backup", optional: true, manual: true },
  ];
  const required = items.filter((i) => !i.optional);
  return { items, done: required.filter((i) => i.ok).length, total: required.length, ready: required.every((i) => i.ok) };
}
