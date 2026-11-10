/**
 * AI accounting assistant (top plan). The model can look things up and PROPOSE a plan; it has no tool that posts.
 * A proposal is dry-run inside a rolled-back transaction (so the user sees the real journal entry), stored as
 * `pending`, and only the user's «تأكيد» (confirmPlan) executes it — with the user's own permissions.
 */
import { Db, db, tx } from "../db/pool";
import { AppError, bad, num, today, isDate, r2 } from "../lib/core";
import { can } from "../lib/auth";
import { COUNTRY, IS_EG, validPartnerTaxId } from "../lib/country";
import { createExpense } from "./expenses";
import { createPayment } from "./payments";
import { manualJournal } from "./misc";
import { nextCode } from "../routes/master";
import { systemPrompt, TOOLS } from "./aiRules";
import { mockLlm } from "./aiMock";
import { localAgent } from "./aiLocal";
import { VAT_RATE, BASE_CURRENCY, CFG } from "../lib/country";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL = () => process.env.AI_MODEL || "claude-sonnet-5-5";
const MAX_FILE = 5 * 1024 * 1024;
const FILE_MIME = /^(image\/(png|jpe?g|webp|gif)|application\/pdf|text\/plain|text\/csv)$/;
type Auth = { userId: string; userName: string; role: string | null; superAdmin: boolean };

// ─── access ────────────────────────────────────────────────────────────────
export function aiAccess(company: any, auth: { superAdmin: boolean }) {
  const mock = process.env.AI_MOCK === "1";
  const key = process.env.ANTHROPIC_API_KEY || company?.ai?.apiKey || (mock ? "mock" : null);
  const plans = (process.env.AI_PLANS || "ENTERPRISE").split(",").map((s) => s.trim());
  const trial = company?.plan === "TRIAL";
  const entitled = !!auth.superAdmin || plans.includes(company?.plan) || company?.ai?.addon === true || trial;
  return {
    // the built-in agent always works; `key` only unlocks the advanced model for what the agent cannot do
    entitled, trial: trial && !auth.superAdmin && company?.ai?.addon !== true, configured: true, advanced: !!key, key,
    keySource: process.env.ANTHROPIC_API_KEY ? "server" : company?.ai?.apiKey ? "company" : mock ? "mock" : null,
    plans, trialTurns: Number(process.env.AI_TRIAL_TURNS || 15), monthlyTurns: Number(process.env.AI_MONTHLY_TURNS || 600),
  };
}
const month = () => today().slice(0, 7);
async function usage(companyId: string) {
  const m = await db.maybe(`SELECT turns FROM ai_usage WHERE company_id=$1 AND month=$2`, [companyId, month()]);
  const all = await db.one(`SELECT COALESCE(SUM(turns),0)::int t FROM ai_usage WHERE company_id=$1`, [companyId]);
  return { month: Number(m?.turns || 0), total: Number(all.t) };
}
export async function aiStatus(company: any, auth: Auth) {
  const a = aiAccess(company, auth);
  const u = await usage(company.id);
  return {
    entitled: a.entitled, configured: true, advanced: a.advanced, keySource: a.keySource, trial: a.trial, plan: company.plan, plans: a.plans,
    used: a.trial ? u.total : u.month, limit: a.trial ? a.trialTurns : a.monthlyTurns, model: a.keySource === "mock" ? "mock" : MODEL(),
    hasCompanyKey: !!company?.ai?.apiKey,
  };
}
export async function saveAiKey(companyId: string, apiKey: string | null) {
  if (apiKey && !/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(apiKey)) throw bad("مفتاح Anthropic API غير صحيح (يبدأ بـ sk-ant-)");
  await db.exec(`UPDATE companies SET ai = CASE WHEN $2::text IS NULL THEN ai - 'apiKey' ELSE jsonb_set(ai, '{apiKey}', to_jsonb($2::text)) END WHERE id=$1`, [companyId, apiKey]);
}

// ─── model call ────────────────────────────────────────────────────────────
async function callLlm(key: string, body: any): Promise<{ content: any[]; stop_reason: string; usage?: { input_tokens: number; output_tokens: number } }> {
  if (key === "mock") return mockLlm(body);
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: AbortSignal.timeout(120000),
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
  } catch (e: any) { throw new AppError(502, "تعذّر الاتصال بخدمة الذكاء الاصطناعي — تحقق من الإنترنت وحاول مجدداً", "AI_UNREACHABLE"); }
  if (!res.ok) {
    const j: any = await res.json().catch(() => ({}));
    const msg = j?.error?.message || res.statusText;
    if (res.status === 401) throw new AppError(502, "مفتاح الذكاء الاصطناعي غير صالح — راجع المفتاح في إعدادات المساعد", "AI_KEY");
    if (res.status === 429 || res.status === 529) throw new AppError(503, "خدمة الذكاء الاصطناعي مشغولة الآن — حاول بعد قليل", "AI_BUSY");
    throw new AppError(502, `خطأ من خدمة الذكاء الاصطناعي: ${msg}`, "AI_ERROR");
  }
  return (await res.json()) as any;
}

// ─── look-up tools ─────────────────────────────────────────────────────────
// nested replace() rather than translate(): also correct on a database that is not UTF8-encoded
const AR = (col: string) => `replace(replace(replace(replace(replace(lower(${col}),'أ','ا'),'إ','ا'),'آ','ا'),'ة','ه'),'ى','ي')`;
const arNorm = (s: string) => String(s || "").toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
async function searchPartners(t: Db, companyId: string, q: string, role?: string) {
  const n = arNorm(q); if (!n) return [];
  // whole phrase first, then every word (so «شركة المياه الوطنية» finds «المياه الوطنية»)
  const words = n.split(" ").filter((w) => w.length > 1 && !["شركه", "مؤسسه", "موسسه", "ال"].includes(w));
  const roleSql = role === "SUPPLIER" ? "AND is_supplier" : role === "CUSTOMER" ? "AND is_customer" : "";
  const run = (cond: string, params: any[]) => t.rows(`SELECT id, code, name, kind, vat_number, phone, city, is_supplier, is_customer, is_active FROM partners WHERE company_id=$1 AND code<>'WALKIN' ${roleSql} AND (${cond}) ORDER BY is_active DESC, name LIMIT 8`, [companyId, ...params]);
  let rows = await run(`${AR("name")} LIKE $2 OR vat_number = $3 OR phone LIKE $2 OR lower(COALESCE(name_en,'')) LIKE $2`, [`%${n}%`, q.replace(/\s/g, "")]);
  if (!rows.length && words.length) rows = await run(words.map((_, i) => `${AR("name")} LIKE $${i + 2}`).join(" AND "), words.map((w) => `%${w}%`));
  return rows;
}
async function runTool(t: Db, company: any, name: string, input: any) {
  const C = company.id;
  if (name === "search_partners") {
    const rows = await searchPartners(t, C, String(input.query || ""), input.role);
    return rows.length ? { found: rows.length, partners: rows } : { found: 0, note: "لا يوجد طرف مطابق — إن كان مطلوباً فأضف create_partner في الخطة" };
  }
  if (name === "search_accounts") {
    const n = arNorm(input.query);
    const rows = await t.rows(`SELECT id, code, name_ar, type, is_cash_bank FROM accounts WHERE company_id=$1 AND NOT is_group AND is_active AND (${AR("name_ar")} LIKE $2 OR code LIKE $3) ${input.type ? "AND type=$4" : ""} ORDER BY code LIMIT 15`, [C, `%${n}%`, `${n}%`, ...(input.type ? [input.type] : [])]);
    return { found: rows.length, accounts: rows };
  }
  if (name === "account_balance") {
    if (!UUID.test(input.accountId || "")) return { error: "accountId غير صحيح" };
    const a = await t.maybe(`SELECT code, name_ar FROM accounts WHERE id=$1 AND company_id=$2`, [input.accountId, C]);
    if (!a) return { error: "الحساب غير موجود" };
    const to = isDate(input.to) ? input.to : today();
    const b = await t.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id=$1 AND e.status='POSTED' AND e.date <= $2`, [input.accountId, to]);
    return { account: `${a.code} ${a.nameAr}`, to, balance: Number(b.b), side: Number(b.b) >= 0 ? "مدين" : "دائن" };
  }
  if (name === "get_entry") {
    const q = String(input.number || "").trim(); if (!q) return { error: "رقم القيد مطلوب" };
    const e = await t.maybe(`SELECT * FROM journal_entries WHERE company_id=$1 AND (number ILIKE $2 OR reference ILIKE $2 OR memo ILIKE $3) ORDER BY (number ILIKE $2) DESC, date DESC LIMIT 1`, [C, q, `%${q}%`]);
    if (!e) return { error: "لم يُعثر على قيد بهذا الرقم" };
    return { number: e.number, date: e.date, type: e.type, status: e.status, memo: e.memo, reference: e.reference, lines: await entryLines(t, e.id) };
  }
  return { error: "أداة غير معروفة" };
}
const entryLines = (t: Db, entryId: string) =>
  t.rows(`SELECT a.code, a.name_ar account, l.debit, l.credit, p.name partner, l.description FROM journal_lines l JOIN accounts a ON a.id=l.account_id LEFT JOIN partners p ON p.id=l.partner_id WHERE l.entry_id=$1 ORDER BY l.sort, l.credit, l.id`, [entryId])
    .then((ls) => ls.map((l: any) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) })));

// ─── the plan: validate / preview / execute ───────────────────────────────
class Rollback extends Error { constructor(public data: any) { super("rollback"); } }
const PERM: Record<string, string> = { create_partner: "partners.write", expense: "expenses.write", journal: "accounting.write", payment: "payments.write" };
const TYPE_AR: Record<string, string> = { create_partner: "إنشاء طرف", expense: "مصروف", journal: "قيد يومية", payment: "سند" };

async function executePlan(t: Db, company: any, auth: Auth, actions: any[], dry: boolean) {
  const C = company.id, U = auth.userName;
  if (!Array.isArray(actions) || !actions.length) throw bad("الخطة فارغة");
  if (actions.length > 12) throw bad("الخطة تتجاوز 12 إجراءً — قسّمها");
  const refs: Record<string, string> = {};
  const out: any[] = [];
  const partnerOf = async (a: any, required: boolean) => {
    const id = a.partnerId || (a.partnerRef ? refs[a.partnerRef] : null);
    if (!id) { if (required) throw bad("حدد الطرف (partnerId أو partnerRef)"); return null; }
    if (!UUID.test(id)) throw bad("معرّف الطرف غير صحيح — استخدم id من search_partners أو partnerRef");
    return t.one(`SELECT id, name, vat_number FROM partners WHERE id=$1 AND company_id=$2`, [id, C], "الطرف غير موجود");
  };
  const acc = async (id: any, what: string) => {
    if (!UUID.test(String(id || ""))) throw bad(`${what}: معرّف الحساب غير صحيح — استخدم id من دليل الحسابات`);
    return t.one(`SELECT id, code, name_ar, type, is_cash_bank FROM accounts WHERE id=$1 AND company_id=$2 AND NOT is_group`, [id, C], `${what}: الحساب غير موجود`);
  };
  for (const [i, a] of actions.entries()) {
    const perm = PERM[a?.type];
    if (!perm) throw bad(`الإجراء ${i + 1}: نوع غير مدعوم`);
    if (!auth.superAdmin && !can(auth.role, perm)) throw new AppError(403, `صلاحيات المستخدم لا تسمح بـ «${TYPE_AR[a.type]}»`, "FORBIDDEN");
    const date = a.date || today();
    if (a.type !== "create_partner" && !isDate(date)) throw bad(`الإجراء ${i + 1}: التاريخ غير صحيح`);
    if (a.type === "create_partner") {
      const name = String(a.name || "").trim();
      if (!name) throw bad("اسم الطرف مطلوب");
      const vat = a.vatNumber ? String(a.vatNumber).replace(/\s/g, "") : null;
      if (vat && !validPartnerTaxId(vat)) throw bad(`الرقم الضريبي «${vat}» غير صحيح — اتركه فارغاً إن لم يكن مؤكداً`);
      const supplier = a.role !== "CUSTOMER";
      // never duplicate: same VAT number, or the same name
      const dup = await t.maybe(`SELECT id, name, code FROM partners WHERE company_id=$1 AND (($2::text IS NOT NULL AND vat_number=$2) OR ${AR("name")} = $3) LIMIT 1`, [C, vat, arNorm(name)]);
      if (dup) {
        if (supplier) await t.exec(`UPDATE partners SET is_supplier=true WHERE id=$1 AND NOT is_supplier`, [dup.id]); else await t.exec(`UPDATE partners SET is_customer=true WHERE id=$1 AND NOT is_customer`, [dup.id]);
        if (a.ref) refs[a.ref] = dup.id;
        out.push({ type: a.type, existing: true, id: dup.id, title: `${supplier ? "المورد" : "العميل"} «${dup.name}» موجود مسبقاً (${dup.code}) — سيُستخدم كما هو` });
        continue;
      }
      const code = dry ? `TMP-${Math.random().toString(36).slice(2, 8)}` : await nextCode(C, supplier ? "S" : "C");
      const p = await t.insert("partners", { companyId: C, code, name, kind: a.kind === "INDIVIDUAL" ? "INDIVIDUAL" : "COMPANY", isSupplier: supplier, isCustomer: !supplier, vatNumber: vat, crNumber: a.crNumber || null, phone: a.phone || null, city: a.city || null, country: COUNTRY, notes: "أُنشئ بواسطة المساعد الذكي" });
      if (a.ref) refs[a.ref] = p.id;
      out.push({ type: a.type, id: p.id, link: `/${supplier ? "suppliers" : "customers"}/${p.id}`, title: `إنشاء ${supplier ? "مورد" : "عميل"} جديد: ${name}${vat ? ` — الرقم الضريبي ${vat}` : ""}`, number: dry ? null : code });
    } else if (a.type === "expense") {
      const account = await acc(a.accountId, "حساب المصروف");
      const pay = a.payAccountId ? await acc(a.payAccountId, "حساب السداد") : null;
      const partner = await partnerOf(a, !pay);
      const e = await createExpense(t, C, U, { date, accountId: account.id, payee: a.payee || partner?.name || null, partnerId: partner?.id || null, supplierVat: a.supplierVat || partner?.vatNumber || null, supplierRef: a.supplierRef || null, description: String(a.description || "").trim() || "مصروف", amount: num(a.amount), amountIncludesVat: !!a.amountIncludesVat, taxCode: a.taxCode || "S", payAccountId: pay?.id || null });
      out.push({ type: a.type, id: e.id, entity: "expense", link: "/expenses", number: dry ? null : e.number, title: `مصروف: ${e.description} — ${account.nameAr}${partner ? ` — ${partner.name}` : ""} — ${pay ? `مدفوع من ${pay.nameAr}` : "آجل على المورد"}`, date, net: Number(e.amount), vat: Number(e.vatAmount), total: Number(e.total), lines: await entryLines(t, e.journalId) });
    } else if (a.type === "journal") {
      const ls = Array.isArray(a.lines) ? a.lines : [];
      if (ls.length < 2) throw bad("القيد يحتاج سطرين على الأقل");
      const lines: any[] = [];
      for (const l of ls) { await acc(l.accountId, "سطر القيد"); const p = l.partnerId || l.partnerRef ? await partnerOf(l, true) : null; lines.push({ accountId: l.accountId, debit: r2(num(l.debit)), credit: r2(num(l.credit)), partnerId: p?.id || null, description: l.description || null }); }
      const dr = r2(lines.reduce((x, l) => x + l.debit, 0)), cr = r2(lines.reduce((x, l) => x + l.credit, 0));
      if (dr !== cr || !dr) throw bad(`القيد غير متوازن: مدين ${dr} ≠ دائن ${cr}`);
      const e: any = await manualJournal(t, C, U, { date, memo: a.memo || a.description || "قيد يومية", reference: a.reference || undefined, lines });
      out.push({ type: a.type, id: e.id, entity: "journal", link: `/journals/${e.id}`, number: dry ? null : e.number, title: `قيد يومية: ${a.memo || a.description || ""}`, date, total: dr, lines: await entryLines(t, e.id) });
    } else if (a.type === "payment") {
      const account = await acc(a.accountId, "حساب الصندوق/البنك");
      if (!account.isCashBank) throw bad("السند يحتاج حساب صندوق أو بنك");
      const partner = await partnerOf(a, true);
      const dir = a.direction === "IN" ? "IN" : "OUT";
      const pmt: any = await createPayment(t, C, U, { direction: dir, partnerId: partner!.id, date, amount: num(a.amount), method: a.method || "CASH", accountId: account.id, reference: a.reference || null, notes: a.notes || a.description || null });
      out.push({ type: a.type, id: pmt.id, entity: "payment", link: dir === "IN" ? "/receipts" : "/vouchers", number: dry ? null : pmt.number, title: `${dir === "IN" ? "سند قبض من" : "سند صرف إلى"} ${partner!.name} — ${account.nameAr}`, date, total: Number(pmt.amount), lines: pmt.journalId ? await entryLines(t, pmt.journalId) : [] });
    }
  }
  return out;
}

/** Runs the plan and rolls everything back: returns exactly what would be posted, or throws the validation error. */
async function previewPlan(company: any, auth: Auth, actions: any[]) {
  try { await tx(async (t) => { throw new Rollback(await executePlan(t, company, auth, actions, true)); }); } catch (e: any) { if (e instanceof Rollback) return e.data as any[]; throw e; }
  return [];
}

// ─── conversations ─────────────────────────────────────────────────────────
function pushUser(messages: any[], blocks: any[]) {
  const last = messages[messages.length - 1];
  if (last?.role === "user") last.content = [...(Array.isArray(last.content) ? last.content : [{ type: "text", text: String(last.content) }]), ...blocks];
  else messages.push({ role: "user", content: blocks });
}
/** Model history → API messages: only the newest attachments are sent as files, older ones become a note. */
async function hydrate(companyId: string, messages: any[]) {
  let start = Math.max(0, messages.length - 40);
  while (start > 0 && !(messages[start].role === "user" && messages[start].content.some((b: any) => b.type === "text" || b.type === "file_ref") && !messages[start].content.some((b: any) => b.type === "tool_result"))) start--;
  const slice = messages.slice(start);
  let lastFiles = -1;
  slice.forEach((m, i) => { if (m.role === "user" && m.content.some((b: any) => b.type === "file_ref")) lastFiles = i; });
  const out: any[] = [];
  for (const [i, m] of slice.entries()) {
    const content: any[] = [];
    for (const b of m.content) {
      if (b.type !== "file_ref") { content.push(b); continue; }
      const f = i === lastFiles ? await db.maybe(`SELECT name, mime, data FROM attachments WHERE id=$1 AND company_id=$2`, [b.id, companyId]) : null;
      if (!f) content.push({ type: "text", text: `[مرفق سابق: ${b.name}]` });
      else if (f.mime.startsWith("image/")) content.push({ type: "image", source: { type: "base64", media_type: f.mime === "image/jpg" ? "image/jpeg" : f.mime, data: f.data.toString("base64") } });
      else if (f.mime === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data.toString("base64") } });
      else content.push({ type: "text", text: `[ملف ${f.name}]\n${f.data.toString("utf8").slice(0, 20000)}` });
    }
    out.push({ role: m.role, content });
  }
  return out;
}

export async function listConversations(companyId: string, userId: string) {
  return db.rows(`SELECT id, title, updated_at, (pending IS NOT NULL) has_pending FROM ai_conversations WHERE company_id=$1 AND user_id=$2 ORDER BY updated_at DESC LIMIT 50`, [companyId, userId]);
}
export async function getConversation(companyId: string, userId: string, id: string) {
  if (!UUID.test(id)) throw new AppError(404, "المحادثة غير موجودة", "NOT_FOUND");
  const c = await db.one(`SELECT id, title, view, pending, updated_at FROM ai_conversations WHERE id=$1 AND company_id=$2 AND user_id=$3`, [id, companyId, userId], "المحادثة غير موجودة");
  return c;
}
export async function deleteConversation(companyId: string, userId: string, id: string) {
  if (!UUID.test(id)) return;
  await db.exec(`DELETE FROM attachments WHERE company_id=$1 AND entity='ai' AND entity_id=$2`, [companyId, id]);
  await db.exec(`DELETE FROM ai_conversations WHERE id=$1 AND company_id=$2 AND user_id=$3`, [id, companyId, userId]);
}
const save = (c: any) => db.exec(`UPDATE ai_conversations SET title=$2, messages=$3::jsonb, view=$4::jsonb, pending=$5::jsonb, user_turns=$6, tokens_in=$7, tokens_out=$8, updated_at=now() WHERE id=$1`,
  [c.id, c.title, JSON.stringify(c.messages), JSON.stringify(c.view), c.pending ? JSON.stringify(c.pending) : null, c.userTurns, c.tokensIn, c.tokensOut]);

export async function chat(company: any, auth: Auth, input: { conversationId?: string; text?: string; engine?: string; files?: { name: string; mime: string; data: string; qr?: any }[] }) {
  const a = aiAccess(company, auth);
  if (!a.entitled) throw new AppError(402, "المساعد الذكي متاح في الباقة الأعلى (المؤسسات) — رقِّ اشتراكك لتفعيله", "AI_PLAN");
  const u = await usage(company.id);
  // limits apply to the advanced model only; the built-in agent is unmetered
  const advancedLeft = a.advanced && (a.trial ? u.total < a.trialTurns : u.month < a.monthlyTurns);
  const text = String(input.text || "").trim().slice(0, 6000);
  const files = (input.files || []).slice(0, 5);
  const wantAdvanced = input.engine === "advanced";
  if (wantAdvanced && !a.advanced) throw new AppError(400, "النموذج المتقدم غير مفعّل: أضف مفتاح API من إعدادات المساعد", "AI_NOT_CONFIGURED");
  if (wantAdvanced && !advancedLeft) throw new AppError(a.trial ? 402 : 429, a.trial ? `انتهت رسائل تجربة النموذج المتقدم (${a.trialTurns}) — المساعد المدمج ما زال متاحاً` : "بلغت الحد الشهري لرسائل النموذج المتقدم — المساعد المدمج ما زال متاحاً", a.trial ? "AI_PLAN" : "AI_LIMIT");
  if (!text && !files.length) throw bad("اكتب رسالة أو أرفق ملفاً");

  // validate the files before anything is stored
  const ready: { name: string; mime: string; buf: Buffer; qr: any }[] = [];
  for (const f of files) {
    const mime = String(f.mime || "").toLowerCase();
    if (!FILE_MIME.test(mime)) throw bad(`«${f.name}»: المساعد يقرأ الصور وملفات PDF والنص/CSV فقط`);
    const m = String(f.data || "").match(/^(?:data:[^;]+;base64,)?([A-Za-z0-9+/=\s]+)$/);
    const buf = m ? Buffer.from(m[1], "base64") : Buffer.alloc(0);
    if (!buf.length) throw bad(`«${f.name}»: ملف فارغ أو غير صالح`);
    if (buf.length > MAX_FILE) throw bad(`«${f.name}»: الحد الأقصى للمرفق 5 ميجابايت`);
    // the browser reads the ZATCA QR on a tax-invoice image (seller, VAT number, time, total, VAT): pass it on as text
    const q = f.qr && typeof f.qr === "object" ? { seller: String(f.qr.seller || "").slice(0, 120), vat: String(f.qr.vat || "").replace(/\D/g, "").slice(0, 15), date: /^\d{4}-\d{2}-\d{2}/.test(String(f.qr.date || "")) ? String(f.qr.date).slice(0, 10) : "", total: num(f.qr.total), vatAmount: num(f.qr.vatAmount) } : null;
    ready.push({ name: String(f.name || "مرفق").slice(0, 160), mime, buf, qr: q && q.total > 0 ? q : null });
  }

  let c: any = input.conversationId
    ? await db.one(`SELECT * FROM ai_conversations WHERE id=$1 AND company_id=$2 AND user_id=$3`, [UUID.test(input.conversationId) ? input.conversationId : "00000000-0000-0000-0000-000000000000", company.id, auth.userId], "المحادثة غير موجودة")
    : await db.insert("ai_conversations", { companyId: company.id, userId: auth.userId, userName: auth.userName, title: (text || files[0]?.name || "محادثة").slice(0, 60) });
  c.messages = c.messages || []; c.view = c.view || []; c.tokensIn = Number(c.tokensIn || 0); c.tokensOut = Number(c.tokensOut || 0);

  const blocks: any[] = [], viewFiles: any[] = [];
  for (const f of ready) {
    const row = await db.one(`INSERT INTO attachments (company_id, entity, entity_id, name, mime, size, data, created_by) VALUES ($1,'ai',$2,$3,$4,$5,$6,$7) RETURNING id`, [company.id, c.id, f.name, f.mime, f.buf.length, f.buf, auth.userName]);
    blocks.push({ type: "file_ref", id: row.id, name: f.name, mime: f.mime });
    if (f.qr) blocks.push({ type: "text", text: `[QR]${JSON.stringify(f.qr)}` });
    viewFiles.push({ id: row.id, name: f.name, mime: f.mime, qr: !!f.qr });
  }
  if (c.pending) { // a new message instead of confirming: the old plan is dropped
    c.pending = null;
    c.view.forEach((v: any) => { if (v.plan && v.plan.status === "pending") v.plan.status = "superseded"; });
    blocks.push({ type: "text", text: "[النظام] لم يؤكد المستخدم الخطة السابقة؛ أُلغيت. رسالته الجديدة:" });
  }
  blocks.push({ type: "text", text: text || "حلّل المرفق واقترح القيد المناسب." });
  pushUser(c.messages, blocks);
  c.view.push({ role: "user", text, files: viewFiles, at: new Date().toISOString() });

  const accounts = await db.rows(`SELECT id, code, name_ar, type, system_key FROM accounts WHERE company_id=$1 AND NOT is_group AND is_active ORDER BY code LIMIT 400`, [company.id]);
  const cash = await db.rows(`SELECT id, code, name_ar, system_key FROM accounts WHERE company_id=$1 AND is_cash_bank AND NOT is_group AND is_active ORDER BY code`, [company.id]);
  const system = [{ type: "text", text: systemPrompt({ company, accounts, cash, today: today(), userName: auth.userName, role: auth.role || "" }), cache_control: { type: "ephemeral" } }];

  const lctx = { accounts, cash, today: today(), vatRate: VAT_RATE, currency: CFG.currencySymbol || BASE_CURRENCY };
  // who answers: the built-in agent first; the advanced model when asked for, when it already leads this exchange,
  // or when the agent says the request is beyond it (and a key exists)
  const lastA = [...c.view].reverse().find((v: any) => v.role !== "user");
  let engine: "local" | "advanced" = wantAdvanced || (advancedLeft && lastA?.role === "assistant" && lastA.engine === "advanced" && !/^\s*$/.test(text)) ? "advanced" : "local";
  // an attachment the built-in agent cannot read (no QR found by the browser) goes to the advanced model when there is one
  if (advancedLeft && ready.some((f) => !f.qr)) engine = "advanced";
  let reply = "", plan: any = null, dIn = 0, dOut = 0;
  try {
    for (let step = 0; step < 8; step++) {
      const hist = await hydrate(company.id, c.messages);
      let r: any = engine === "local" ? await localAgent({ messages: hist }, lctx) : null;
      if (r?.escalate) {
        if (advancedLeft && step === 0) { engine = "advanced"; r = null; }
        else if (r.escalate === "complex") r.content = [{ type: "text", text: "هذا طلب مركّب (عدة خطوات أو توزيع أو تحليل) يتجاوز ما أعالجه بالقواعد المدمجة. قسّمه إلى عمليات بسيطة أسجّلها واحدة واحدة، أو فعّل النموذج المتقدم بمفتاح API من إعدادات المساعد ليتولاه كاملاً." }];
        else if (!r.content.length) r.content = [{ type: "text", text: r.escalate === "attachment"
          ? "لم أجد في المرفق رمز QR ضريبياً أستطيع قراءته. المساعد المدمج يقرأ رمز QR في صور الفواتير الضريبية فقط؛ قراءة نص الفاتورة أو ملفات PDF تحتاج النموذج المتقدم" + (a.advanced ? " (بلغت حدّه الآن)." : " (يُفعَّل بمفتاح API من إعدادات المساعد).") + "\nاكتب لي بيانات الفاتورة: النوع، المبلغ وهل هو شامل الضريبة، المورد، وطريقة السداد."
          : "لم أفهم المطلوب تماماً. جرّب صيغة مثل:\n- «فاتورة كهرباء 460 ريال شامل الضريبة من المورد … من البنك»\n- «سددنا للمورد … 5,000 من البنك»\n- «إيداع نقدي في البنك 10,000»\n- «اشرح القيد JV-2026-00012» أو «كيف أعالج المصروفات المدفوعة مقدماً؟»" + (a.advanced ? "" : "\nالعمليات المركّبة يتولاها النموذج المتقدم عند تفعيله بمفتاح API.") }];
      }
      if (!r) r = await callLlm(a.key!, { model: MODEL(), max_tokens: 2500, system, tools: TOOLS, messages: hist });
      dIn += r.usage?.input_tokens || 0; dOut += r.usage?.output_tokens || 0;
      c.messages.push({ role: "assistant", content: r.content });
      const txt = r.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
      if (txt) reply = reply ? `${reply}\n\n${txt}` : txt;
      const uses = r.content.filter((b: any) => b.type === "tool_use");
      if (r.stop_reason !== "tool_use" || !uses.length) break;
      const results: any[] = [];
      for (const tu of uses) {
        let result: any, isErr = false;
        try {
          if (tu.name === "propose") {
            const preview = await previewPlan(company, auth, tu.input?.actions);
            plan = { status: "pending", summary: String(tu.input?.summary || ""), actions: tu.input.actions, preview };
            result = { ok: true, note: "عُرضت الخطة على المستخدم مع القيود الفعلية وهي بانتظار تأكيده. لا تكرر تفاصيل القيد؛ اكتب شرحاً موجزاً فقط.", preview: preview.map((p) => ({ title: p.title, total: p.total, vat: p.vat })) };
          } else result = await runTool(db, company, tu.name, tu.input || {});
        } catch (e: any) { isErr = true; result = { error: e?.message || "خطأ" }; if (tu.name === "propose") plan = null; }
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result), ...(isErr ? { is_error: true } : {}) });
      }
      c.messages.push({ role: "user", content: results });
    }
  } catch (e) {
    // keep the history consistent for the next attempt: drop the unanswered user turn
    const open = (m: any) => m.role !== "assistant" || m.content.some((b: any) => b.type === "tool_use");
    while (c.messages.length && open(c.messages[c.messages.length - 1])) c.messages.pop();
    c.view.pop();
    await save(c);
    throw e;
  }
  // the history must not end on a tool_result with no assistant answer (step limit)
  if (c.messages[c.messages.length - 1].role === "user") c.messages.push({ role: "assistant", content: [{ type: "text", text: reply || "…" }] });
  if (plan) c.pending = { summary: plan.summary, actions: plan.actions, at: new Date().toISOString() };
  c.view.push({ role: "assistant", text: reply || (plan ? "هذه الخطة المقترحة — راجعها ثم أكّد." : "…"), plan: plan ? { status: "pending", summary: plan.summary, preview: plan.preview } : undefined, engine, at: new Date().toISOString() });
  c.userTurns = Number(c.userTurns || 0) + 1; c.tokensIn += dIn; c.tokensOut += dOut;
  await save(c);
  if (engine === "advanced") await db.exec(`INSERT INTO ai_usage (company_id, month, turns, tokens_in, tokens_out) VALUES ($1,$2,1,$3,$4) ON CONFLICT (company_id, month) DO UPDATE SET turns=ai_usage.turns+1, tokens_in=ai_usage.tokens_in+$3, tokens_out=ai_usage.tokens_out+$4`, [company.id, month(), dIn, dOut]);
  return { id: c.id, title: c.title, view: c.view, pending: !!c.pending, engine };
}

/** The user pressed «تأكيد»: execute the stored plan for real, attach the conversation's files to the first document. */
export async function confirmPlan(company: any, auth: Auth, id: string) {
  const out = await tx(async (t) => {
    const c: any = await t.one(`SELECT * FROM ai_conversations WHERE id=$1 AND company_id=$2 AND user_id=$3 FOR UPDATE`, [UUID.test(id) ? id : "00000000-0000-0000-0000-000000000000", company.id, auth.userId], "المحادثة غير موجودة");
    if (!c.pending) throw bad("لا توجد خطة بانتظار التأكيد");
    const results = await executePlan(t, company, auth, c.pending.actions, false);
    const doc = results.find((r) => r.entity);
    if (doc) await t.exec(`UPDATE attachments SET entity=$3, entity_id=$4 WHERE company_id=$1 AND entity='ai' AND entity_id=$2`, [company.id, c.id, doc.entity, doc.id]);
    const done = results.map((r) => `${r.title}${r.number ? ` (${r.number})` : ""}`).join(" · ");
    pushUser(c.messages, [{ type: "text", text: `[النظام] أكّد المستخدم الخطة ونُفّذت ورُحّلت بنجاح: ${done}` }]);
    c.messages.push({ role: "assistant", content: [{ type: "text", text: "تم التنفيذ والترحيل." }] });
    for (const v of c.view) if (v.plan?.status === "pending") { v.plan.status = "done"; v.plan.preview = results; }
    c.view.push({ role: "system", text: "✅ تم التنفيذ والترحيل", results: results.map((r) => ({ title: r.title, number: r.number, link: r.link })), at: new Date().toISOString() });
    await t.exec(`UPDATE ai_conversations SET messages=$2::jsonb, view=$3::jsonb, pending=NULL, updated_at=now() WHERE id=$1`, [c.id, JSON.stringify(c.messages), JSON.stringify(c.view)]);
    await t.insert("audit_logs", { companyId: company.id, userId: auth.userId, userName: auth.userName, action: "AI_EXECUTE", entity: "ai_conversation", entityId: c.id, details: { results: results.map((r) => ({ type: r.type, number: r.number, id: r.id })) } });
    return { id: c.id, title: c.title, view: c.view, pending: false, results };
  });
  return out;
}

export async function cancelPlan(company: any, auth: Auth, id: string) {
  const c: any = await db.one(`SELECT * FROM ai_conversations WHERE id=$1 AND company_id=$2 AND user_id=$3`, [UUID.test(id) ? id : "00000000-0000-0000-0000-000000000000", company.id, auth.userId], "المحادثة غير موجودة");
  if (!c.pending) return { id: c.id, title: c.title, view: c.view, pending: false };
  pushUser(c.messages, [{ type: "text", text: "[النظام] ألغى المستخدم الخطة ولم يُرحَّل شيء." }]);
  c.messages.push({ role: "assistant", content: [{ type: "text", text: "تم الإلغاء." }] });
  for (const v of c.view) if (v.plan?.status === "pending") v.plan.status = "cancelled";
  c.view.push({ role: "system", text: "أُلغيت الخطة — لم يُرحَّل شيء", at: new Date().toISOString() });
  c.pending = null;
  c.userTurns = Number(c.userTurns || 0); c.tokensIn = Number(c.tokensIn || 0); c.tokensOut = Number(c.tokensOut || 0);
  await save(c);
  return { id: c.id, title: c.title, view: c.view, pending: false };
}
