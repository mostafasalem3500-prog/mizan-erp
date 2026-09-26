> **ملاحظة (الإصدار 2):** هذا المستند يخص الإصدار الأول (NestJS/Prisma) المحفوظ في `legacy/`. البنية الحالية موثقة في `README.md`.

# ARCHITECTURE.md — Mizan ERP

## 1. القرار التقني (مع التبرير)

| الطبقة | الاختيار | السبب |
|---|---|---|
| Frontend | Next.js + TypeScript + Tailwind + shadcn/ui | RTL عربي، SSR للتقارير الثقيلة، نظام مكونات ناضج |
| Backend | NestJS — Modular Monolith | يدعم فصل Modules بحدود واضحة (Accounting/POS/ZATCA) دون تعقيد Microservices في مرحلة لا تحتاجه؛ DI مناسب لعزل Accounting Posting Engine كخدمة مركزية يستدعيها الجميع |
| Database | PostgreSQL | NUMERIC دقيق للأموال، Row Level Security جاهزة لعزل المستأجرين، نضج في Constraints/Transactions |
| ORM | **Prisma** (القرار الموثق) | تمت المقارنة مع Drizzle: Drizzle أفضل في التحكم اليدوي بالـSQL المعقد ويقارب أداء SQL الخام، لكن Prisma يتفوق في: Migrations منظمة وقابلة للمراجعة (`prisma migrate`)، Type Safety تلقائي من Schema واحد يقرأه كل الفريق، ونضج التوثيق لفريق ينفذ Multi-Tenant + Accounting بحجم هذا المشروع. القرار: **Prisma للنموذج والـMigrations، مع Raw SQL (`$queryRaw`) صراحة لأي استعلام محاسبي مركّب لا يعبّر عنه Prisma Client جيدًا (مثل Trial Balance متعدد المستويات)**. تُعاد المراجعة إذا ظهرت قيود حقيقية في القيود المحاسبية المعقدة. |
| Validation | Zod (على حدود API) | يشترك مع TypeScript types ويمنع تسرب بيانات غير محققة إلى Accounting Engine |
| Storage | S3-Compatible | للمرفقات والشعارات وPDF/XML المؤرشفة |
| Queue | BullMQ | يُفعَّل فقط عند الحاجة الفعلية (مثل إرسالات ZATCA غير المتزامنة وإعادة المحاولة) — لا يُستخدم للمسار الحرج للترحيل المحاسبي المتزامن |
| Desktop | Tauri (لاحقًا، بعد التأكد) | Client خفيف يتصل بنفس الـServer — لا يكرر منطق المحاسبة |
| Deployment | Docker، بلا منطق خاص بمزود سحابي | يسمح بالنشر على Railway/VPS/On-Premise دون تغيير كود |

## 2. خريطة الوحدات (Module Map)

```
apps/api/src/modules/
  auth/            organizations/     users/            permissions/
  accounting/      sales/             purchases/        expenses/
  inventory/       pos/               banking/          projects/
  contracting/     agriculture/       assets/            tax/
  invoice-studio/  zatca/             reports/           notifications/
  audit/           subscriptions/
```

قاعدة صارمة: **الوحدات التشغيلية (sales, pos, purchases, expenses, assets) لا تكتب مباشرة إلى `journal_entries`**. كل واحدة تنشر Accounting Event عبر `AccountingPostingEngine` فقط (راجع القسم 4).

## 3. البنية المعمارية لقاعدة البيانات (ERD مختصر — المستوى الأول)

```
organizations 1─* branches
organizations 1─* organization_users ─* users
organizations 1─* roles ─* role_permissions ─* permissions
organizations 1─* accounts (Chart of Accounts, self-referencing tree)
organizations 1─* fiscal_years 1─* accounting_periods
organizations 1─* journal_entries 1─* journal_entry_lines ─* accounts
organizations 1─* customers / suppliers
organizations 1─* products ─* product_variants
organizations 1─* warehouses 1─* inventory_movements ─* products
organizations 1─* invoice_documents 1─* invoice_lines
invoice_documents 1─1 invoice_totals / invoice_tax_totals
invoice_documents 1─* zatca_documents 1─* zatca_submissions 1─* zatca_submission_attempts
organizations 1─* pos_terminals 1─* pos_shifts 1─* pos_sales
branches 1─* invoice_sequences (atomic counters per org+branch+doc_type+fiscal_year)
```

كل جدول مالي أو تشغيلي يحمل `organization_id`، وعند الحاجة `branch_id` — بلا استثناء (بند 7). التفاصيل الكاملة للأعمدة والفهارس تُدوَّن تدريجيًا في ورقة `07_Database_Tables` بالـWorkbook مع كل مرحلة تنفيذ فعلية، وليس دفعة واحدة قبل كتابة الكود، تفاديًا لانحراف التوثيق عن الـSchema الحقيقي.

**عزل المستأجرين:** يُطبَّق على مستويين متكاملين وليس مستوى واحدًا:
1. فرض `organization_id` في كل Repository Query عبر Prisma Middleware/Extension مركزي (لا اعتماد على أن يتذكر كل مطوّر إضافته يدويًا).
2. تفعيل PostgreSQL Row Level Security كطبقة دفاع ثانية (Defense in Depth) على الجداول المالية الحرجة، مفعّلة عبر `SET app.current_org_id` في بداية كل Request.

## 4. معمارية الترحيل المحاسبي (Accounting Posting Architecture)

```
[Sales | POS | Purchases | Expenses | Assets | Banking]
        │  (Accounting Event: e.g. POS_SALE_COMPLETED)
        ▼
  AccountingPostingEngine.post(event)
        │  — قواعد الترحيل حسب Posting Matrix (ورقة 06)
        │  — DB Transaction واحدة تشمل: القيد + المخزون + الدفع + الضريبة
        ▼
  journal_entries + journal_entry_lines  (Debit = Credit، NUMERIC فقط)
```

فشل أي جزء جوهري (مخزون/دفع/ضريبة) ⇒ Rollback كامل للمعاملة (بند 16). لا يوجد Commit جزئي أبدًا. المستندات المرحّلة غير قابلة للتعديل المباشر — أي تصحيح يتم عبر Credit/Debit Note أو Reversal موثّق (بند 17).

## 5. معمارية POS

```
POS UI (شاشة واحدة) → Sales Domain → Tax Engine → Inventory → AccountingPostingEngine → ZATCA → Receipt
```
لا يملك POS Ledger مستقل ولا ZATCA Engine مستقل — كلاهما يمر عبر نفس المحركات المركزية المستخدمة في المبيعات العادية (بند 32، 94).

## 6. معمارية الفوترة (Invoice + Template)

```
Canonical Invoice Model  ──┬─→ Invoice Calculation Engine → Tax Snapshot → Accounting
                            ├─→ Invoice Template Engine → PDF/A4/Thermal Renderer
                            └─→ ZATCA Mapper → UBL XML → Validation → Submission
```
تغيير القالب البصري لا يغيّر البيانات المحاسبية أو XML أبدًا — الفصل معماري وليس مجرد اتفاق برمجي (بند 66).

## 7. معمارية ZATCA (Adapter مستقلة)

`zatca/` وحدة Adapter بحدود واضحة (`ZatcaInvoiceMapper`, `UBLGenerator`, `XMLValidator`, `SchematronValidator`, `QRService`, `CSRService`, `CSIDService`, `SubmissionService`) تستهلك Canonical Invoice ولا تُعدّل عليه. أي تغيير مستقبلي من ZATCA يُعدَّل داخل هذه الوحدة فقط دون المساس بمحرك المحاسبة أو المخزون أو POS (بند 120).

**حاجز تنفيذي معلن:** لا يبدأ كود هذه الوحدة فعليًا قبل إغلاق الفجوة الموثقة في `docs/GAP_ANALYSIS.md` (تنزيل Data Dictionary وXML Standard وSecurity Standard الرسمية وتسجيل إصداراتها).

## 8. معمارية الأمان

Auth (Session/JWT) → RBAC (roles/permissions) → Tenant Guard (organization_id إلزامي على كل Request) → Audit Interceptor (يسجل كل Posting/Reversal/Return/Discount/Template Change/ZATCA/Permissions/Period Closing/Cash Movement) → Rate Limiting + Security Headers + Secrets مشفّرة خارج المستودع.

## 9. معمارية النشر

صورة Docker واحدة للـAPI وواحدة للـWeb، بلا منطق خاص بأي مزود سحابي، قابلة للتشغيل على Railway/VPS/On-Premise LAN بنفس الـImage. الشهادات ومفاتيح ZATCA الخاصة بكل عميل On-Premise تبقى محلية ولا تُرفع لأي بيئة مشتركة.
