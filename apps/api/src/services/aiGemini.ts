/**
 * Google Gemini as the advanced model. The rest of the assistant speaks one protocol (text / tool_use / tool_result
 * blocks); this file translates a request to Gemini's generateContent and the answer back, so nothing else changes.
 */
import { AppError } from "../lib/core";

const BASE = () => (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
/** Tried in order: a model the key cannot use (not found, or its free quota is spent) falls through to the next. */
export const GEMINI_MODELS = () => (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || "gemini-3.8-flash,gemini-2.5-flash,gemini-2.0-flash").split(",").map((s) => s.trim()).filter(Boolean);
export const isGeminiKey = (k: string) => /^AIza[0-9A-Za-z_\-]{30,}$/.test(k) || /^AQ\.[0-9A-Za-z_\-]{20,}$/.test(k);
const working = new Map<string, string>(); // key tail → the model that answered last
export const geminiModelOf = (key: string) => working.get(key.slice(-8)) || GEMINI_MODELS()[0];

/** JSON Schema → the OpenAPI subset Gemini accepts for function parameters. */
function schema(s: any): any {
  if (!s || typeof s !== "object") return undefined;
  const out: any = { type: String(s.type || "string").toUpperCase() };
  if (s.description) out.description = s.description;
  if (Array.isArray(s.enum)) out.enum = s.enum;
  if (out.type === "OBJECT") {
    const props = Object.entries(s.properties || {});
    if (!props.length) return { type: "STRING", description: s.description || "JSON" };
    out.properties = Object.fromEntries(props.map(([k, v]) => [k, schema(v)]));
    if (Array.isArray(s.required) && s.required.length) out.required = s.required;
  }
  if (out.type === "ARRAY") out.items = schema(s.items) || { type: "STRING" };
  return out;
}
function toContents(messages: any[]) {
  const names = new Map<string, { name: string; gid?: string }>();
  const out: any[] = [];
  for (const m of messages) {
    const parts: any[] = [];
    for (const b of m.content || []) {
      if (b.type === "text") { if (b.text) parts.push({ text: b.text, ...(b.sig ? { thoughtSignature: b.sig } : {}) }); }
      else if (b.type === "image" || b.type === "document") parts.push({ inlineData: { mimeType: b.source.media_type, data: b.source.data } });
      else if (b.type === "tool_use") { names.set(b.id, { name: b.name, gid: b.gid }); parts.push({ functionCall: { name: b.name, args: b.input || {}, ...(b.gid ? { id: b.gid } : {}) }, ...(b.sig ? { thoughtSignature: b.sig } : {}) }); }
      else if (b.type === "tool_result") {
        const ref = names.get(b.tool_use_id); let res: any = b.content;
        try { res = JSON.parse(b.content); } catch { /* plain text */ }
        parts.push({ functionResponse: { name: ref?.name || "tool", ...(ref?.gid ? { id: ref.gid } : {}), response: res && typeof res === "object" && !Array.isArray(res) ? res : { result: res } } });
      }
    }
    if (parts.length) out.push({ role: m.role === "assistant" ? "model" : "user", parts });
  }
  return out;
}
const rid = () => `gm_${Date.now().toString(36)}${Math.round(Math.random() * 1e6).toString(36)}`;

async function once(key: string, model: string, payload: any) {
  let res: Response;
  try {
    res = await fetch(`${BASE()}/models/${encodeURIComponent(model)}:generateContent`, { method: "POST", signal: AbortSignal.timeout(120000), headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(payload) });
  } catch { throw new AppError(502, "تعذّر الاتصال بخدمة Gemini — تحقق من الإنترنت وحاول مجدداً", "AI_UNREACHABLE"); }
  const j: any = await res.json().catch(() => ({}));
  return { status: res.status, j };
}
/** One model turn. `body` is the request the assistant builds for any provider: { system, tools, messages, max_tokens }. */
export async function callGemini(key: string, body: any): Promise<{ content: any[]; stop_reason: string; usage: { input_tokens: number; output_tokens: number }; model: string }> {
  const sys = (Array.isArray(body.system) ? body.system.map((s: any) => s.text).join("\n") : String(body.system || "")).trim();
  const tools = (body.tools || []).map((t: any) => { const p = schema(t.input_schema); return { name: t.name, description: t.description, ...(p && p.type === "OBJECT" ? { parameters: p } : {}) }; });
  const payload: any = { contents: toContents(body.messages || []), generationConfig: { maxOutputTokens: body.max_tokens || 2500, temperature: 0.2 } };
  if (sys) payload.systemInstruction = { parts: [{ text: sys }] };
  if (tools.length) { payload.tools = [{ functionDeclarations: tools }]; payload.toolConfig = { functionCallingConfig: { mode: "AUTO" } }; }
  const order = [...new Set([geminiModelOf(key), ...GEMINI_MODELS()])];
  let last: { status: number; j: any } | null = null;
  for (const model of order) {
    const r = await once(key, model, payload); last = r;
    if (r.status === 404 || r.status === 429) continue; // this model is not available to the key, or its quota is spent: try the next
    if (r.status !== 200) break;
    working.set(key.slice(-8), model);
    const cand = r.j?.candidates?.[0];
    if (!cand) { const why = r.j?.promptFeedback?.blockReason; throw new AppError(502, why ? `رفضت خدمة Gemini الطلب (${why})` : "لم تُرجع خدمة Gemini رداً — حاول مجدداً", "AI_ERROR"); }
    const content: any[] = [];
    for (const p of cand.content?.parts || []) {
      if (p.thought) continue; // a thought summary, not part of the answer
      if (p.functionCall) content.push({ type: "tool_use", id: rid(), name: p.functionCall.name, input: p.functionCall.args || {}, ...(p.functionCall.id ? { gid: p.functionCall.id } : {}), ...(p.thoughtSignature ? { sig: p.thoughtSignature } : {}) });
      else if (typeof p.text === "string" && p.text) content.push({ type: "text", text: p.text, ...(p.thoughtSignature ? { sig: p.thoughtSignature } : {}) });
    }
    const uses = content.some((b) => b.type === "tool_use");
    if (!content.length) content.push({ type: "text", text: cand.finishReason === "MAX_TOKENS" ? "الرد أطول من الحد المسموح — اطلب جزءاً أصغر." : cand.finishReason && cand.finishReason !== "STOP" ? `توقف النموذج قبل أن يجيب (${cand.finishReason}). أعد صياغة الطلب.` : "…" });
    const u = r.j.usageMetadata || {};
    return { content, stop_reason: uses ? "tool_use" : "end_turn", usage: { input_tokens: Number(u.promptTokenCount || 0), output_tokens: Number(u.candidatesTokenCount || 0) + Number(u.thoughtsTokenCount || 0) }, model };
  }
  const msg = String(last?.j?.error?.message || ""), st = last?.status || 0;
  if (st === 429) throw new AppError(503, "بلغ مفتاح Gemini حدّ الاستخدام المجاني الآن (عدد الطلبات في الدقيقة أو اليوم) — انتظر قليلاً أو استخدم المساعد المدمج", "AI_BUSY");
  if (st === 400 && /api key|API_KEY/i.test(msg) || st === 401 || st === 403) throw new AppError(502, "مفتاح Gemini غير صالح أو غير مفعّل لهذه الخدمة — أنشئ مفتاحاً من Google AI Studio وراجع إعدادات المساعد", "AI_KEY");
  if (st === 404) throw new AppError(502, `لا يوجد نموذج Gemini متاح لهذا المفتاح من القائمة (${order.join("، ")})`, "AI_ERROR");
  if (st === 503 || st === 500) throw new AppError(503, "خدمة Gemini مشغولة الآن — حاول بعد قليل", "AI_BUSY");
  throw new AppError(502, `خطأ من خدمة Gemini: ${msg || st}`, "AI_ERROR");
}
/** A one-word call to learn whether the key works before it is stored. */
export async function verifyGeminiKey(key: string): Promise<{ verified: boolean; model?: string; note?: string }> {
  try { const r = await callGemini(key, { messages: [{ role: "user", content: [{ type: "text", text: "أجب بكلمة واحدة: جاهز" }] }], max_tokens: 200 }); return { verified: true, model: r.model }; }
  catch (e: any) {
    if (e?.code === "AI_KEY") throw e;
    return { verified: false, note: e?.code === "AI_BUSY" ? "حُفظ المفتاح، لكن حدّه المجاني مستنفد الآن — جرّب لاحقاً." : e?.code === "AI_UNREACHABLE" ? "حُفظ المفتاح دون تحقق: الخادم لم يصل إلى خدمة Gemini (لا إنترنت؟)." : `حُفظ المفتاح، لكن الاختبار لم ينجح: ${e?.message || ""}` };
  }
}
