# Mizan ERP | ميزان — Phase 0

هذا مستودع بداية (Greenfield) بُني وفق `docs/` أدناه استجابةً لمواصفة "MIZAN ERP — Final Master Prompt". هذه الجلسة أخرجت المشروع لأول مرة إلى بنية تحتية حقيقية خارج بيئة العمل: **GitHub + Railway + PostgreSQL حقيقي + أول هجرة Prisma فعلية**.

## أهم إنجاز: أول قاعدة بيانات PostgreSQL حقيقية في تاريخ المشروع

- مستودع GitHub حقيقي: `mostafasalem3500-prog/mizan-erp`.
- مشروع Railway حقيقي مع PostgreSQL 16 يعمل فعليًا.
- **أول هجرة Prisma حقيقية طُبِّقت فعليًا** — 15 جدولًا حقيقيًا (`organizations`, `journal_entries`, إلخ) أُنشئت في Postgres حقيقي، مُتحقَّقًا منها حيًا في سجلات Railway.
- **إثبات حاسم**: تحميل محركات Prisma الثنائية نجح بالكامل على Railway — الحجب طوال الجلسات السابقة كان خاصًا ببيئة العمل تلك فقط، وليس قيدًا في المشروع.

## محرك الترحيل أصبح متوافقًا حرفيًا مع Prisma الحقيقي

اكتُشِف أن `tx.idempotencyKey.find(...)` استدعاء مُخترَع غير موجود في Prisma الحقيقي — أُعيد كتابته بـ`findUnique` الصحيحة. مفتاح تفعيل آمن `USE_REAL_PRISMA_ACCOUNTING` جاهز لكن **معطَّل عمدًا** حتى الآن.

## اكتشاف معماري مهم قبل أي تفعيل

`AccountsService.getAccountIdByCode()` (تعتمد عليها كل الوحدات) لا تزال تقرأ من الذاكرة. تفعيل محرك الترحيل الحقيقي الآن سيُسبِّب فشل Foreign Key Violation عند كتابة `journal_entry_lines.accountId`. كُتِبت `prisma-seed.ts` (زرع حقيقي كامل) استعدادًا، لكن التفعيل الآمن يتطلب أولًا تحويل `AccountsRepository`/`OrganizationsRepository`/`PeriodsRepository` إلى Prisma حقيقي أيضًا.

## الكود — النتيجة الفعلية لـ `npm test`: 27 Test Suites، 212 اختبارًا (+7 جديدة)

## حدود صادقة لا تزال قائمة

- منطق التطبيق لا يزال يقرأ/يكتب عبر `InMemoryDatabase` — الجداول الحقيقية موجودة وفارغة، لا "مرئية" للتطبيق بعد.
- لا ختم تشفيري ZATCA حقيقي، لا PIH متسلسل حقيقي.

## التشغيل المحلي

```bash
cd apps/api
npm install
npm test                 # 212/212 اختبارًا
npx tsc --noEmit          # نظيف بالكامل
```

## الخطوة التالية

راجع `docs/MVP_ROADMAP.md`.
