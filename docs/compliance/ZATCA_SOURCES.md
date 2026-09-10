# ZATCA_SOURCES.md
سجل المصادر الرسمية المعتمدة للفوترة الإلكترونية — يجب تحديثه عند أي تغيير رسمي، ويُحظر ترحيل أي منطق فوترة إلى الكود قبل تسجيله هنا أولًا.

> آخر مراجعة لهذا الملف: 2026-09-09 (تحديث ثانٍ — تم تنزيل ومطابقة المحتوى الفعلي لثلاث من الوثائق الأربع الحرجة، وليس فقط صفحاتها)
> القاعدة: أي تعارض بين هذا الملف وأي كود أو مكتبة GitHub أو مقال أو ذاكرة الذكاء الاصطناعي → **المصدر الرسمي هو الفيصل**.

## 1. اللوائح والمراحل

| # | الوثيقة/الصفحة | الرابط الرسمي | ما تؤكده |
|---|---|---|---|
| 1 | Roll-out phases | https://zatca.gov.sa/en/E-Invoicing/Introduction/Pages/Roll-out-phases.aspx | Phase 1 (Generation) نافذة من 4 ديسمبر 2021. Phase 2 (Integration) تُطرح على موجات، إخطار كل موجة قبل 6 أشهر على الأقل |
| 2 | Phase 2 — Prepare your business | https://zatca.gov.sa/en/E-Invoicing/PreparingYourBusiness/Phase2/Pages/default.aspx | تفاصيل الاستعداد لمرحلة الربط |
| 3 | خبر معايير الموجات | https://zatca.gov.sa/en/Pages/news_1426.aspx | الفرق الرسمي بين متطلبات المرحلتين |

## 2. الوثائق التقنية الحرجة — **تم تنزيلها ومطابقة محتواها فعليًا بتاريخ 2026-09-09**

| الوثيقة | الإصدار | تاريخ الإصدار | الرابط الرسمي المباشر (PDF/XLSX) | حالة المطابقة |
|---|---|---|---|---|
| Electronic Invoice XML Implementation Standard | **1.2** | **2023-05-19** | https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_XML_Implementation_Standard_%20vF.pdf | تم تنزيل النص الكامل (72 صفحة) ومطابقته — يغطي قواعد العمل (BR/BR-CO/BR-S/BR-Z/BR-E/BR-O/BR-CL/BR-DEC)، القواعد الخاصة بالسعودية (BR-KSA وفروعها)، معادلات الحساب، أكواد أنواع الفاتورة، أكواد فئات الضريبة وأسباب الإعفاء |
| Electronic Invoice Security Features Implementation Standards | **1.2** | **2023-05-19** | https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards_vF.pdf | تم تنزيل النص الكامل (27 صفحة) — يغطي عملية إصدار/تجديد/إلغاء الشهادة الرقمية، بنية CSR (RDNs)، خوارزميات التشفير (SHA-256، ECDSA P-256)، بنية QR (9 Tags TLV)، بروتوكول OAuth2 للمصادقة |
| Electronic Invoice Data Dictionary | 19 May 2023 (نفس تاريخ الإصدار أعلاه) | 2023-05-19 | https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_EInvoice_Data_Dictionary%20vF.xlsx | ملف XLSX — الرابط الرسمي مسجل ومؤكد من الصفحة الرسمية، لكن لم يُستخرج محتواه بعد (أداة الجلب الحالية تستخرج نصوص PDF فقط). المرجع البديل المؤقت: قسم "Data Dictionary Structure" وجداول BT/KSA الواردة داخل XML Implementation Standard أعلاه، والتي تغطي معظم الحقول الجوهرية. لا يُعتمد كبديل نهائي — يجب استخراج الـXLSX فعليًا قبل اعتماد Compliance Matrix نهائي بالكامل |
| E-invoicing Detailed Technical Guideline | v2 | Nov 2022 | https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-invoicing-Detailed-Technical-Guideline.pdf | تم الاطلاع على المحتوى العام (نموذج Clearance/Reporting) |
| Detailed Guidelines for E-Invoicing (Fatoora) | v2 | May 2023 | https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-Invoicing_Detailed__Guideline.pdf | تم الاطلاع على متطلبات QR للفاتورة المبسطة ومهلة الـ24 ساعة |

صفحات المصدر الرسمية لهذه الوثائق (وتاريخ آخر تحديث للصفحة نفسها كما يظهر عليها):
- E-Invoice specifications: https://zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/Pages/E-Invoice-specifications.aspx (Last Update: 12 Jan 2026)
- Security requirements: https://zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/Pages/Security-Requirements.aspx (Last Update: 10 Aug 2026)
- Knowledge Base Library (الأدلة العامة): https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Pages/default.aspx (Last Update: 10 Aug 2026)

**ملاحظة مهمة:** رقم الإصدار الفعلي المكتوب داخل مستندي XML Standard وSecurity Features هو 1.2 بتاريخ 2023-05-19، وليس تاريخ 10 أغسطس 2026 — ذلك التاريخ هو تاريخ آخر مراجعة/تحديث لصفحة الويب المستضيفة لا لمحتوى الوثيقة نفسها. لم يصدر منذ 2023-05-19 إصدار أحدث ظاهر على الموقع الرسمي حتى تاريخ هذه المراجعة. هذا التمييز (تاريخ الصفحة ≠ تاريخ إصدار المستند) مهم ويجب عدم الخلط بينهما في أي مراجعة مستقبلية.

## 3. ملخص تقني تم استخلاصه (لأغراض الـWorkbook — انظر الأوراق 13-16 لكامل التفاصيل)

- **أكواد نوع الفاتورة (BT-3):** 388 = فاتورة ضريبية (تُميَّز عبر الخاصية الفرعية KSA-2: "01" ضريبية عادية / "02" مبسطة)، 383 = إشعار مدين، 381 = إشعار دائن، 386 = فاتورة دفعة مقدمة.
- **أكواد فئة الضريبة:** S = خاضع للنسبة الأساسية، Z = خاضع لنسبة صفر، E = معفى، O = خارج نطاق الضريبة — لكل منها أكواد أسباب إعفاء رسمية (مثل VATEX-SA-29, VATEX-SA-32...).
- **بنية رمز QR (المرحلة 2):** 9 حقول TLV مرمزة Base64: (1) اسم البائع، (2) الرقم الضريبي للبائع، (3) الطابع الزمني، (4) إجمالي الفاتورة شامل الضريبة، (5) إجمالي الضريبة، (6) هاش ملف XML، (7) توقيع ECDSA على الهاش، (8) المفتاح العام ECDSA، (9) توقيع ZATCA (للفاتورة المبسطة فقط). الحقول 1-5 سارية منذ 4 ديسمبر 2021، والحقول 6-9 سارية منذ 1 يناير 2023.
- **خوارزميات التشفير الإلزامية:** SHA-256 للتجزئة، ECDSA بمنحنى P-256 للتوقيع، شهادة X.509 v3 صادرة من CA تقنية تابعة لهيئة الزكاة والضريبة والجمارك.
- **قاعدة الأولوية عند التعارض:** قواعد السعودية الخاصة (BR-KSA) تتجاوز معيار EN 16931 عند التعارض، والذي بدوره يتجاوز مواصفات UBL العامة.

## 4. حالة الحجب الحالية على وحدة `zatca`

- **رُفع الحجب جزئيًا**: يمكن الآن البدء بتصميم `ZatcaInvoiceMapper` وبنية QR وCSR اعتمادًا على المحتوى الموثق أعلاه، لأنه مأخوذ من النص الرسمي المباشر وليس من الذاكرة أو مكتبات GitHub.
- **لا يزال قائمًا جزئيًا**: قبل كتابة أي كود إنتاجي فعلي (وليس تصميم/Workbook) لتوليد XML حقيقي، يجب استخراج محتوى Data Dictionary XLSX كاملًا للتأكد من عدم وجود حقول أو قواعد أحدث لم تظهر داخل مستند XML Standard نفسه، ومطابقة القواعد المستخرجة هنا (خصوصًا BR-KSA) حقلًا حقلًا وليس بالاعتماد على العينة الموثقة في هذا الملف فقط.
- التوصية: قبل الشروع في `ZatcaInvoiceMapper` الفعلي، افتح الـXLSX يدويًا (أو عبر بيئة تنفيذ تصل zatca.gov.sa) وقارنه عمودًا بعمود مع ورقة `13_ZATCA_Field_Mapping`.

## 5. قاعدة استخدام GitHub / المكتبات مفتوحة المصدر

لوحظت عدة مكتبات غير رسمية (PHP، Python، Ruby، Go، C#) لتوليد QR/XML الخاص بـZATCA. لا تُعتمد كمرجع قانوني أو تقني نهائي بأي حال — تُستخدم فقط كمساعدة هندسية بعد مراجعة الترخيص والأمان والكود ومطابقة كل مخرج مع الوثائق الرسمية أعلاه (بند 54 من المواصفة).
