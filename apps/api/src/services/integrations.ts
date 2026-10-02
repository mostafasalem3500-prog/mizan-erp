/** API keys (hashed) and signed outgoing webhooks. */
import { createHash, createHmac, randomBytes } from "crypto";
import { db } from "../db/pool";
import { bad } from "../lib/core";

export const EVENTS: Record<string, string> = {
  "invoice.posted": "ترحيل فاتورة/إشعار (بيع أو شراء)",
  "pos.sale": "عملية بيع في نقطة البيع",
  "payment.created": "سند قبض/صرف",
  "partner.created": "إضافة عميل/مورد",
  "order.received": "طلب وارد عبر الواجهة البرمجية",
};

export const hashKey = (k: string) => createHash("sha256").update(k).digest("hex");

export async function createApiKey(companyId: string, name: string, scopes: string[], user: string) {
  const key = "mzn_live_" + randomBytes(24).toString("base64url");
  const sc = scopes.filter((s) => ["read", "write"].includes(s));
  const row = await db.insert("api_keys", { companyId, name: name || "مفتاح", prefix: key.slice(0, 14), keyHash: hashKey(key), scopes: sc.length ? sc : ["read"], createdBy: user });
  return { ...row, key }; // shown once
}

export async function resolveApiKey(key: string) {
  if (!key || !key.startsWith("mzn_")) return null;
  const row = await db.maybe(`SELECT k.*, c.status AS company_status, c.subscription_ends_at FROM api_keys k JOIN companies c ON c.id=k.company_id WHERE k.key_hash=$1 AND k.is_active`, [hashKey(key)]);
  if (row) db.exec(`UPDATE api_keys SET last_used_at=now() WHERE id=$1`, [row.id]).catch(() => undefined);
  return row;
}

export function newWebhookSecret() { return "whsec_" + randomBytes(18).toString("base64url"); }

export function validateWebhookUrl(url: string) {
  let u: URL;
  try { u = new URL(url); } catch { throw bad("رابط غير صحيح"); }
  if (u.protocol !== "https:" && process.env.NODE_ENV === "production") throw bad("يجب أن يكون الرابط https");
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname) && process.env.NODE_ENV === "production") throw bad("لا يُسمح بالعناوين الداخلية");
  return u.toString();
}

async function deliver(hook: any, event: string, body: any, deliveryId?: string) {
  const payload = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", hook.secret).update(`${ts}.${payload}`).digest("hex");
  let status = 0, text = "", ok = false;
  try {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(hook.url, { method: "POST", headers: { "Content-Type": "application/json", "X-Mizan-Event": event, "X-Mizan-Timestamp": String(ts), "X-Mizan-Signature": `sha256=${sig}`, "User-Agent": "Mizan-ERP-Webhooks/1" }, body: payload, signal: ctrl.signal });
    clearTimeout(timer);
    status = r.status; text = (await r.text()).slice(0, 500); ok = r.ok;
  } catch (e: any) { text = String(e?.message || e).slice(0, 500); }
  if (deliveryId) await db.exec(`UPDATE webhook_deliveries SET status=$2, response=$3, ok=$4, attempts=attempts+1 WHERE id=$1`, [deliveryId, status, text, ok]);
  else await db.insert("webhook_deliveries", { webhookId: hook.id, event, payload: body, status, response: text, ok, attempts: 1 });
  return { status, ok, response: text };
}

/** Fire-and-forget: deliver to every active hook subscribed to the event; one retry after 30s on failure. */
export function emit(companyId: string, event: string, data: any) {
  (async () => {
    const hooks = await db.rows(`SELECT * FROM webhooks WHERE company_id=$1 AND is_active AND events ? $2`, [companyId, event]);
    for (const h of hooks) {
      const body = { id: randomBytes(8).toString("hex"), event, createdAt: new Date().toISOString(), data };
      const r = await deliver(h, event, body);
      if (!r.ok) setTimeout(async () => {
        const d = await db.maybe(`SELECT id FROM webhook_deliveries WHERE webhook_id=$1 AND payload->>'id'=$2`, [h.id, body.id]);
        if (d) deliver(h, event, body, d.id).catch(() => undefined);
      }, 30000);
    }
  })().catch((e) => console.error("[webhooks]", e?.message));
}

export async function testWebhook(hook: any) {
  return deliver(hook, "ping", { id: randomBytes(8).toString("hex"), event: "ping", createdAt: new Date().toISOString(), data: { message: "اختبار من ميزان ERP" } });
}

export async function redeliver(deliveryId: string, companyId: string) {
  const d = await db.one(`SELECT d.*, w.url, w.secret, w.company_id FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id WHERE d.id=$1 AND w.company_id=$2`, [deliveryId, companyId], "غير موجود");
  return deliver({ id: d.webhookId, url: d.url, secret: d.secret }, d.event, d.payload, d.id);
}

/** Compact invoice payload for webhooks / API. */
export function invoiceDto(inv: any) {
  return {
    id: inv.id, number: inv.number, direction: inv.direction, kind: inv.kind, channel: inv.channel, status: inv.status, date: inv.date, dueDate: inv.dueDate,
    partner: { id: inv.partnerId, name: inv.partnerName, vatNumber: inv.partnerVat }, currency: inv.currency || "SAR", exchangeRate: Number(inv.exchangeRate || 1),
    subtotal: Number(inv.subtotal), discount: Number(inv.discountTotal), taxable: Number(inv.taxable), vat: Number(inv.vatTotal), total: Number(inv.total), paid: Number(inv.amountPaid), paymentStatus: inv.paymentStatus,
    zatcaStatus: inv.zatcaStatus, externalRef: inv.externalRef || null, publicUrl: inv.shareToken ? `/p/${inv.shareToken}` : null,
    lines: (inv.lines || []).map((l: any) => ({ productId: l.productId, sku: l.sku, description: l.description, qty: Number(l.qty), uom: l.uom || l.unit || null, unitPrice: Number(l.unitPrice), discountPct: Number(l.discountPct), taxCode: l.taxCode, net: Number(l.netAmount), vat: Number(l.vatAmount), total: Number(l.total) })),
  };
}
