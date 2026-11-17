/** The public REST API (/api/v1) described as OpenAPI 3.1, and a plain HTML page rendered from the same description. */
import { EVENTS } from "./integrations";
import { CFG } from "../lib/country";

const q = (name: string, description: string, schema: any = { type: "string" }) => ({ name, in: "query", required: false, description, schema });
const json = (schema: any) => ({ content: { "application/json": { schema } } });
const ok = (description: string, schema: any = { type: "object" }) => ({ "200": { description, ...json(schema) }, "401": { $ref: "#/components/responses/Unauthorized" }, "400": { $ref: "#/components/responses/BadRequest" } });
const list = (item: string) => ({ type: "object", properties: { data: { type: "array", items: { $ref: `#/components/schemas/${item}` } } } });

export function openapi(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: `${CFG.appName || "Mizan ERP"} API`, version: "1.0.0",
      description: "واجهة برمجية لربط المتاجر الإلكترونية والمواقع والأنظمة الأخرى بميزان: الأصناف والمخزون، العملاء، إنشاء الطلبات والفواتير، وتسجيل السداد. المفاتيح تُنشأ من «الإعدادات ← الربط والتكامل» وتخص منشأة واحدة. كل الطلبات والردود JSON، والتواريخ YYYY-MM-DD، والمبالغ بعملة المنشأة.",
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ bearer: [] }],
    tags: [{ name: "عام" }, { name: "الأصناف والمخزون" }, { name: "العملاء" }, { name: "الطلبات والفواتير" }, { name: "السداد" }],
    paths: {
      "/me": { get: { tags: ["عام"], summary: "المنشأة وصلاحيات المفتاح", description: "للتحقق من أن المفتاح يعمل.", responses: ok("المنشأة والمفتاح") } },
      "/products": { get: { tags: ["الأصناف والمخزون"], summary: "قائمة الأصناف مع الرصيد والعبوات", parameters: [q("q", "بحث بالاسم أو الرمز أو الباركود"), q("sku", "رمز صنف محدد"), q("limit", "حتى 1000 (الافتراضي 200)", { type: "integer" }), q("offset", "للتنقل بين الصفحات", { type: "integer" })], responses: ok("الأصناف", list("Product")) } },
      "/stock": { get: { tags: ["الأصناف والمخزون"], summary: "أرصدة المخزون لكل صنف ومستودع", responses: ok("الأرصدة", { type: "object", properties: { data: { type: "array", items: { type: "object", properties: { sku: { type: "string" }, name: { type: "string" }, warehouse: { type: "string" }, qty: { type: "number" } } } } } }) } },
      "/partners": {
        get: { tags: ["العملاء"], summary: "العملاء والموردون", parameters: [q("q", "بحث بالاسم أو الجوال أو البريد أو الرقم الضريبي"), q("role", "CUSTOMER أو SUPPLIER", { type: "string", enum: ["CUSTOMER", "SUPPLIER"] })], responses: ok("الأطراف", list("Partner")) },
        post: { tags: ["العملاء"], summary: "إنشاء عميل (أو إرجاع الموجود بالجوال أو البريد نفسه)", description: "يتطلب مفتاحاً بصلاحية الكتابة.", requestBody: { required: true, ...json({ $ref: "#/components/schemas/CustomerInput" }) }, responses: ok("العميل", { $ref: "#/components/schemas/Partner" }) },
      },
      "/orders": { post: { tags: ["الطلبات والفواتير"], summary: "إنشاء طلب أو فاتورة مبيعات من قناة خارجية", description: "يُنشئ فاتورة مرحّلة (الافتراضي) أو أمراً أو عرض سعر. الإرسال مرتين بالمرجع الخارجي نفسه `externalRef` لا يكرر المستند. البنود تُعرَّف بالصنف `productId` أو `sku` أو `barcode` (ومنها باركود العبوة)، أو ببيان حر. يتطلب مفتاحاً بصلاحية الكتابة.", requestBody: { required: true, ...json({ $ref: "#/components/schemas/OrderInput" }) }, responses: ok("المستند المُنشأ", { $ref: "#/components/schemas/Invoice" }) } },
      "/invoices": { get: { tags: ["الطلبات والفواتير"], summary: "قائمة الفواتير", parameters: [q("direction", "SALE أو PURCHASE", { type: "string", enum: ["SALE", "PURCHASE"] }), q("from", "من تاريخ", { type: "string", format: "date" }), q("to", "إلى تاريخ", { type: "string", format: "date" }), q("externalRef", "المرجع الخارجي للطلب")], responses: ok("الفواتير", { type: "object", properties: { data: { type: "array", items: { type: "object" } } } }) } },
      "/invoices/{id}": { get: { tags: ["الطلبات والفواتير"], summary: "فاتورة واحدة ببنودها", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: ok("الفاتورة", { $ref: "#/components/schemas/Invoice" }) } },
      "/payments": { post: { tags: ["السداد"], summary: "تسجيل سند قبض أو صرف", description: "يُخصم من فواتير الطرف المفتوحة الأقدم فالأقدم. يتطلب مفتاحاً بصلاحية الكتابة.", requestBody: { required: true, ...json({ $ref: "#/components/schemas/PaymentInput" }) }, responses: ok("السند") } },
    },
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "مفتاح الواجهة البرمجية في ترويسة Authorization: Bearer <key> (أو الترويسة X-API-Key)." } },
      responses: {
        Unauthorized: { description: "المفتاح مفقود أو غير صحيح", ...json({ $ref: "#/components/schemas/Error" }) },
        BadRequest: { description: "بيانات غير صحيحة — الرسالة تذكر السبب", ...json({ $ref: "#/components/schemas/Error" }) },
      },
      schemas: {
        Error: { type: "object", properties: { message: { type: "string", description: "سبب الرفض بالعربية" }, code: { type: "string" } } },
        Product: { type: "object", properties: { id: { type: "string", format: "uuid" }, sku: { type: "string" }, barcode: { type: ["string", "null"] }, name: { type: "string" }, nameEn: { type: ["string", "null"] }, type: { type: "string", enum: ["STOCK", "SERVICE"] }, unit: { type: ["string", "null"] }, salePrice: { type: "number" }, taxCode: { type: "string" }, category: { type: ["string", "null"] }, stock: { type: "number" }, priceIncludesVat: { type: "boolean" }, packs: { type: "array", items: { type: "object", properties: { name: { type: "string" }, factor: { type: "number" }, barcode: { type: ["string", "null"] }, salePrice: { type: ["number", "null"] } } } } } },
        Partner: { type: "object", properties: { id: { type: "string", format: "uuid" }, code: { type: "string" }, name: { type: "string" }, phone: { type: ["string", "null"] }, email: { type: ["string", "null"] }, vatNumber: { type: ["string", "null"] }, city: { type: ["string", "null"] }, isCustomer: { type: "boolean" }, isSupplier: { type: "boolean" } } },
        CustomerInput: { type: "object", description: "الاسم أو الجوال مطلوب", properties: { name: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, vatNumber: { type: "string" }, city: { type: "string" } } },
        OrderLine: { type: "object", properties: { productId: { type: "string", format: "uuid" }, sku: { type: "string" }, barcode: { type: "string" }, description: { type: "string", description: "مطلوب إن لم يُحدَّد صنف" }, qty: { type: "number", default: 1 }, unitPrice: { type: "number", description: "الافتراضي سعر بيع الصنف" }, discountPct: { type: "number" }, taxCode: { type: "string", description: "الافتراضي رمز ضريبة الصنف (S أساسية)" } } },
        OrderInput: { type: "object", required: ["lines"], properties: { externalRef: { type: "string", description: "رقم الطلب في نظامك — يمنع التكرار" }, kind: { type: "string", enum: ["INVOICE", "ORDER", "QUOTATION"], default: "INVOICE" }, post: { type: "boolean", default: true, description: "false يبقي الفاتورة مسودة" }, date: { type: "string", format: "date" }, customerId: { type: "string", format: "uuid" }, customer: { $ref: "#/components/schemas/CustomerInput" }, lines: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/OrderLine" } }, shipping: { type: "number", description: "رسوم الشحن تُضاف بنداً" }, shippingLabel: { type: "string" }, notes: { type: "string" }, payment: { type: "object", description: "سداد مع الطلب", properties: { amount: { type: "number" }, method: { type: "string", enum: ["CASH", "CARD", "BANK"] }, accountCode: { type: "string", description: "رمز حساب الصندوق أو البنك" } } } } },
        PaymentInput: { type: "object", required: ["partnerId", "amount"], properties: { partnerId: { type: "string", format: "uuid" }, direction: { type: "string", enum: ["IN", "OUT"], default: "IN" }, amount: { type: "number" }, date: { type: "string", format: "date" }, method: { type: "string", default: "BANK" }, accountCode: { type: "string" }, reference: { type: "string" }, notes: { type: "string" } } },
        Invoice: { type: "object", properties: { id: { type: "string", format: "uuid" }, number: { type: "string" }, direction: { type: "string" }, kind: { type: "string" }, status: { type: "string", enum: ["DRAFT", "POSTED"] }, date: { type: "string", format: "date" }, dueDate: { type: ["string", "null"] }, partner: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, vatNumber: { type: ["string", "null"] } } }, currency: { type: "string" }, subtotal: { type: "number" }, discount: { type: "number" }, taxable: { type: "number" }, vat: { type: "number" }, total: { type: "number" }, paid: { type: "number" }, paymentStatus: { type: "string" }, externalRef: { type: ["string", "null"] }, publicUrl: { type: ["string", "null"], description: "رابط عرض الفاتورة للعميل" }, lines: { type: "array", items: { type: "object" } } } },
      },
    },
    "x-webhooks-events": EVENTS,
  };
}

const esc = (s: any) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
/** A readable page for developers, built from the description above — no scripts, so it works under the site's content policy. */
export function apiDocsHtml(origin: string) {
  const d: any = openapi(origin);
  const schemaRows = (s: any): string => Object.entries(s?.properties || {}).map(([k, v]: any) => `<tr><td><code>${esc(k)}</code>${(s.required || []).includes(k) ? " <b>*</b>" : ""}</td><td>${esc(v.$ref ? v.$ref.split("/").pop() : Array.isArray(v.type) ? v.type[0] : v.type === "array" ? `array<${v.items?.$ref ? v.items.$ref.split("/").pop() : v.items?.type || "object"}>` : v.type || "")}${v.enum ? ` — ${v.enum.map(esc).join(" | ")}` : ""}</td><td>${esc(v.description || "")}${v.default !== undefined ? ` (الافتراضي ${esc(v.default)})` : ""}</td></tr>`).join("");
  const ops = Object.entries(d.paths).flatMap(([path, methods]: any) => Object.entries(methods).map(([m, o]: any) => {
    const body = o.requestBody?.content?.["application/json"]?.schema?.$ref?.split("/").pop();
    return `<section class="op"><h3><span class="m ${m}">${m.toUpperCase()}</span> <code>${esc(path)}</code></h3><p><b>${esc(o.summary)}</b>${o.description ? ` — ${esc(o.description)}` : ""}</p>${o.parameters?.length ? `<table><thead><tr><th>المعامل</th><th>النوع</th><th>الوصف</th></tr></thead><tbody>${o.parameters.map((p: any) => `<tr><td><code>${esc(p.name)}</code>${p.required ? " <b>*</b>" : ""}</td><td>${esc(p.in)} · ${esc(p.schema?.type)}</td><td>${esc(p.description || "")}</td></tr>`).join("")}</tbody></table>` : ""}${body ? `<p>جسم الطلب: <a href="#s-${body}"><code>${body}</code></a></p>` : ""}</section>`;
  })).join("");
  const schemas = Object.entries(d.components.schemas).map(([n, s]: any) => `<section class="op" id="s-${n}"><h3><code>${n}</code></h3>${s.description ? `<p>${esc(s.description)}</p>` : ""}<table><thead><tr><th>الحقل</th><th>النوع</th><th>الوصف</th></tr></thead><tbody>${schemaRows(s)}</tbody></table></section>`).join("");
  const events = Object.entries(EVENTS).map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(v)}</td></tr>`).join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(d.info.title)} — توثيق الواجهة البرمجية</title><meta name="robots" content="noindex">
<style>:root{--bg:#f6f8f8;--card:#fff;--ink:#0f1f1d;--mut:#5b6b69;--line:#dbe3e2;--pri:#0f766e}@media(prefers-color-scheme:dark){:root{--bg:#0b1413;--card:#12201e;--ink:#e6f0ee;--mut:#9fb3b0;--line:#24403c;--pri:#5eead4}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.8 "IBM Plex Sans Arabic",system-ui,sans-serif}main{max-width:980px;margin:0 auto;padding:28px 16px 60px}h1{margin:0 0 6px;font-size:1.7rem}h2{margin:34px 0 10px;font-size:1.25rem;border-bottom:2px solid var(--line);padding-bottom:6px}h3{margin:0 0 6px;font-size:1.02rem}
.op{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:10px 0}code,pre{font-family:ui-monospace,Consolas,monospace;direction:ltr;unicode-bidi:embed}code{background:rgba(127,127,127,.14);padding:1px 6px;border-radius:6px;font-size:.92em}pre{background:#0d1b1a;color:#d6f5ef;padding:14px;border-radius:12px;overflow:auto;text-align:left;font-size:.88rem;line-height:1.6}
table{width:100%;border-collapse:collapse;font-size:.93rem;margin-top:6px}th,td{text-align:start;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mut);font-weight:600}.wrap{overflow-x:auto}
.m{display:inline-block;min-width:54px;text-align:center;color:#fff;border-radius:6px;padding:0 8px;font:700 .8rem/1.9 ui-monospace,monospace}.get{background:#0f766e}.post{background:#1d4ed8}a{color:var(--pri)}p{margin:6px 0}.mut{color:var(--mut)}</style></head>
<body><main><h1>${esc(d.info.title)}</h1><p class="mut">الإصدار ${esc(d.info.version)} — <a href="/api/v1/openapi.json">ملف OpenAPI 3.1 (JSON)</a> لاستيراده في Postman أو أدوات توليد الكود.</p><p>${esc(d.info.description)}</p>
<h2>المصادقة</h2><div class="op"><p>أنشئ مفتاحاً من <b>الإعدادات ← الربط والتكامل ← مفاتيح API</b> (للقراءة فقط أو للقراءة والكتابة)، وأرسله في كل طلب:</p><pre>curl ${esc(origin)}/api/v1/me \\
  -H "Authorization: Bearer YOUR_API_KEY"</pre><p>المفتاح يخص منشأة واحدة ولا يصل إلى غيرها. عند الخطأ يعود الرد برمز الحالة ورسالة تذكر السبب: <code>{"message":"…","code":"…"}</code>.</p></div>
<h2>مثال: طلب من متجر إلكتروني</h2><pre>curl -X POST ${esc(origin)}/api/v1/orders \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{
    "externalRef": "WEB-10231",
    "customer": { "name": "محمد العتيبي", "phone": "0551234567" },
    "lines": [ { "sku": "FD-001", "qty": 2 }, { "barcode": "6291234567890", "qty": 1, "unitPrice": 39.5 } ],
    "shipping": 25,
    "payment": { "amount": 180.5, "method": "CARD" }
  }'</pre>
<h2>المسارات</h2>${ops}<h2>هياكل البيانات</h2><div class="wrap">${schemas}</div>
<h2>الإشعارات (Webhooks)</h2><div class="op"><p>سجّل عنوان استقبال من <b>الإعدادات ← الربط والتكامل</b> ليصلك طلب POST موقَّع عند كل حدث:</p><table><thead><tr><th>الحدث</th><th>متى</th></tr></thead><tbody>${events}</tbody></table></div>
</main></body></html>`;
}
