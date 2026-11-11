/**
 * The built-in accounting agent: runs inside the server with no external service. It is not a language model — it is
 * a rule engine (Arabic phrase parsing + the knowledge in aiKnowledge.ts) that speaks the same protocol as the
 * advanced model (text, or tool calls: search_partners / get_entry / account_balance / propose), so everything
 * downstream — preview of the real entry, confirmation, posting — is shared. When a request is beyond it, it returns
 * `escalate` and the caller may hand the turn to the advanced model.
 */
import { EXPENSE_KINDS, GUIDES, TOPICS, ABOUT, PROBLEMS, LESSON_KEYS, ExpenseKind } from "./aiKnowledge";
import { LESSONS } from "../shared/lessons";

export type LocalCtx = { accounts: any[]; cash: any[]; today: string; vatRate: number; currency: string };
type Out = { content: any[]; stop_reason: string; usage: { input_tokens: number; output_tokens: number }; escalate?: string; suggest?: string[] };

const usage = { input_tokens: 0, output_tokens: 0 };
const say = (t: string, suggest?: string[]): Out => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn", usage, ...(suggest?.length ? { suggest: suggest.slice(0, 4) } : {}) });
const call = (name: string, input: any): Out => ({ content: [{ type: "tool_use", id: `lt_${Date.now().toString(36)}${Math.round(Math.random() * 1e6).toString(36)}`, name, input }], stop_reason: "tool_use", usage });
const giveUp = (why: string): Out => ({ content: [], stop_reason: "end_turn", usage, escalate: why });

// ─── text helpers ──────────────────────────────────────────────────────────
const digits = (s: string) => s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/٫/g, ".").replace(/٬/g, ",");
export const norm = (s: string) => digits(String(s || "")).replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").toLowerCase().replace(/\s+/g, " ").trim();
/** Without the definite article, so «الإقرار الضريبي» matches the key «اقرار ضريب». */
const bare = (s: string) => s.replace(/(^|[ (|])(?:وال|بال|لل|ال)(?=[\u0621-\u064A]{2})/g, "$1");
const bareRe = new Map<RegExp, RegExp>();
const stripped = (re: RegExp) => { let b = bareRe.get(re); if (!b) { b = new RegExp(bare(norm(re.source).replace(/\\b/g, "")), re.flags.replace("g", "")); bareRe.set(re, b); } return b; };
const hit = (re: RegExp, raw: string, n: string) => re.test(raw) || re.test(n) || stripped(re).test(bare(n));
/** Everyday Gulf and Egyptian wording → the standard words the rules are written in. */
const canon = (n: string) => n
  .replace(/(^| )(وش|ايش|اش|شنو|شو|ايه هو|ايه هي)(?= )/g, "$1ما").replace(/(^| )(ازاي|شلون|كيف اقدر|كيف ممكن|ازاى)(?= )/g, "$1كيف").replace(/(^| )(كام|قد ايه|قديش|اديش)(?= |$)/g, "$1كم")
  .replace(/(^| )(دلوقتي|الحين|هالحين|حاليا|هسه)(?= |$|؟)/g, "$1الان").replace(/(^| )(ابغى|ابغي|ابي|ودي|عايز|عاوز|محتاج|اريد|ارغب|ممكن|لو سمحت|من فضلك|فضلا|رجاء)( ان)?( تعطيني| تعرض لي| تقول لي| توريني| اعرف| اشوف)?(?= )/g, "$1")
  .replace(/(^| )(ليه|علشان ايه|عشان ايش)(?= )/g, "$1لماذا").replace(/(^| )(فلوس|مصاري)(?= |$|؟)/g, "$1نقد").replace(/(^| )(النهارده|انهارده)(?= |$|؟)/g, "$1اليوم").replace(/(^| )(امبارح|مبارح)(?= |$|؟)/g, "$1امس")
  .replace(/(^| )اللي فات(?= |$|؟)/g, "$1الماضي").replace(/(^| )(الجاي|الجايه)(?= |$|؟)/g, "$1القادم").replace(/\s+/g, " ").trim();
const money = (v: number) => v.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS: Record<string, number> = { يناير: 1, فبراير: 2, مارس: 3, ابريل: 4, مايو: 5, يونيو: 6, يوليو: 7, اغسطس: 8, سبتمبر: 9, اكتوبر: 10, نوفمبر: 11, ديسمبر: 12 };
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const shift = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function parseDate(n: string, today: string): string | null {
  let m = n.match(/(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return iso(+m[1], +m[2], +m[3]);
  m = n.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/); if (m) return iso(+m[3], +m[2], +m[1]);
  m = n.match(/(\d{1,2})\s+(يناير|فبراير|مارس|ابريل|مايو|يونيو|يوليو|اغسطس|سبتمبر|اكتوبر|نوفمبر|ديسمبر)(?:\s+(\d{4}))?/); if (m) return iso(m[3] ? +m[3] : +today.slice(0, 4), MONTHS[m[2]], +m[1]);
  if (/اول امس|قبل امس/.test(n)) return shift(today, -2);
  if (/(^| )(امس|البارحه)( |$)/.test(n)) return shift(today, -1);
  if (/(^| )اليوم( |$)/.test(n)) return today;
  return null;
}

/** The amount: the number tied to a currency word or «بقيمة/بمبلغ», else the last free number. Dates, tax IDs, invoice numbers and percentages are ignored. */
function parseAmount(n: string): number | null {
  let s = n.replace(/\d{4}-\d{1,2}-\d{1,2}/g, " ").replace(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/g, " ").replace(/\b\d{9,}\b/g, " ").replace(/\d+(\.\d+)?\s*[%٪]/g, " ")
    .replace(/(رقم(?: ال)?(?:فاتوره|ايصال|سند)?|فاتوره رقم|#)\s*[:：]?\s*[a-z]*-?\d[\d-]*/g, " ").replace(/\d{1,2}\s+(يناير|فبراير|مارس|ابريل|مايو|يونيو|يوليو|اغسطس|سبتمبر|اكتوبر|نوفمبر|ديسمبر)(\s+\d{4})?/g, " ");
  s = s.replace(/(\d),(?=\d{3}\b)/g, "$1");
  const val = (m: RegExpMatchArray) => { let v = parseFloat(m[1]); if (m[2]) v *= /مليون/.test(m[2]) ? 1e6 : 1000; return v; };
  const NUM = "(\\d+(?:\\.\\d+)?)\\s*(الف|الاف|مليون)?";
  const tied = [...s.matchAll(new RegExp(`(?:بقيمه|بمبلغ|مبلغ|قيمتها|قيمته|المبلغ|اجمالي|الاجمالي)\\s*(?:وقدره\\s*)?${NUM}`, "g")), ...s.matchAll(new RegExp(`${NUM}\\s*(?:ريال|ر\\.س|sar|جنيه|ج\\.م)`, "g"))];
  if (tied.length) return val(tied.sort((x, y) => (x.index || 0) - (y.index || 0))[tied.length - 1]);
  const all = [...s.matchAll(new RegExp(NUM, "g"))];
  return all.length ? val(all[all.length - 1]) : null;
}

const STOP = "(?=\\s*(?:،|,|\\.|؛|\\n|$| \\d| بقيم| بمبلغ| مبلغ| بتاريخ| شامل| غير شامل| نقد| كاش| اجل| آجل| دفع| دُفع| سدد| من الصندوق| من البنك| من حساب| بالتحويل| تحويل| رقم| وذلك| عن ))";
function parsePartner(raw: string, role: "SUPPLIER" | "CUSTOMER"): string | null {
  const t = digits(raw).replace(/\s+/g, " ");
  const pats = role === "SUPPLIER"
    ? [`(?:المورد|للمورد|مورد|لدى|لصالح)\\s+(.+?)${STOP}`, `من\\s+((?:شركة|شركه|مؤسسة|مؤسسه|محل|مكتب|مكتبة|مكتبه|مطعم|محطة|محطه|مصنع|ورشة|ورشه|صيدلية|مركز|معرض|بقالة|مطبعة)\\s+.+?)${STOP}`]
    : [`(?:العميل|للعميل|عميل)\\s+(.+?)${STOP}`, `من\\s+((?:شركة|شركه|مؤسسة|مؤسسه|السيد|الأستاذ)\\s+.+?)${STOP}`];
  for (const p of pats) { const m = t.match(new RegExp(p)); if (m && m[1].trim().length > 1) return m[1].trim().replace(/^(?:هو|اسمه|:)\s*/, "").slice(0, 80); }
  return null;
}

// ─── reading the conversation ──────────────────────────────────────────────
const CLARIFY = /أحتاج:|كم المبلغ؟|كم \*\*المبلغ|من أي حساب؟|نوع المصروف|شامل الضريبة؟|السداد\*\*؟|من هو (العميل|المورد)|أين استُلم|من أين دُفع|أيهم تقصد|الاسم الصحيح كاملاً|أي حساب تقصد|أي صنف تقصد|تأكيد وترحيل|تعذّر تجهيز الخطة|راجعها ثم أكّد|لتسجيلها اكتب/;
type Qr = { seller?: string; vat?: string; date?: string; total?: number; vatAmount?: number };
function openTurn(messages: any[]) {
  const texts: string[] = []; let qr: Qr | null = null; let lastAssistant = ""; let unread = 0; let cut = 0; let yesNo: boolean | null = null;
  let start = 0;
  messages.forEach((m, i) => { if (m.role === "user" && m.content.some((b: any) => b.type === "text" && /^\[النظام\] (أكّد|ألغى)/.test(b.text))) start = i; });
  // an answer that asked for nothing closes the exchange; only a question for missing details (or an open plan) keeps it open
  for (let i = start; i < messages.length; i++) { const m = messages[i]; if (m.role !== "assistant" || m.content.some((b: any) => b.type === "tool_use")) continue; const t = m.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" "); if (t && !CLARIFY.test(t)) start = i + 1; }
  for (let i = start; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "assistant") { const t = m.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" "); if (t) lastAssistant = t; continue; }
    for (const b of m.content) {
      if (b.type === "image" || b.type === "document") unread++;
      if (b.type !== "text") continue;
      if (b.text.startsWith("[QR]")) { try { qr = JSON.parse(b.text.slice(4)); unread = Math.max(0, unread - 1); } catch { /* ignore */ } continue; }
      if (/^\[(النظام|مرفق|ملف)/.test(b.text)) { if (/^\[النظام\] لم يؤكد/.test(b.text)) cut = texts.length; continue; }
      if (b.text === "حلّل المرفق واقترح القيد المناسب.") continue;
      // a bare yes/no answers the VAT question that was just asked
      if (/شامل الضريبة؟/.test(lastAssistant)) { const t = norm(b.text); if (/^(نعم|اي|ايوه|اجل|صح|شامله?|yes)(?= |$|،|,)/.test(t)) yesNo = true; else if (/^(لا|غير|no)(?= |$|،|,)/.test(t)) yesNo = false; }
      texts.push(b.text);
    }
  }
  // a message sent instead of confirming: a complete new request starts over, anything else amends the open one
  if (cut && cut < texts.length) { const fresh = texts.slice(cut).join(" "), nf = norm(fresh); if (parseAmount(nf) && (EXPENSE_KINDS.some((k) => k.keys.test(fresh) || k.keys.test(nf)) || /المورد|العميل|ايداع|سحب/.test(nf))) texts.splice(0, cut); }
  return { texts, qr, lastAssistant, unread, yesNo };
}

// ─── analysis of an accounting request ─────────────────────────────────────
type Pay = { mode: "CASH" | "BANK" | "CREDIT" | "CUSTODY"; account?: any } | null;
function pickAccount(ctx: LocalCtx, kind: ExpenseKind) {
  // cost-of-sales and stock accounts are never the target of an expense voucher
  const exp = ctx.accounts.filter((a) => a.type === "EXPENSE" && !["COGS", "INV_LOSS", "LANDED_COST", "PURCHASE_EXPENSE", "DEPRECIATION", "CASH_DIFF", "FX_LOSS"].includes(a.systemKey));
  if (kind.sysKey) { const a = exp.find((x) => x.systemKey === kind.sysKey); if (a) return { account: a, exact: true }; }
  for (const [i, re] of kind.names.entries()) { const a = exp.find((x) => re.test(x.nameAr)); if (a) return { account: a, exact: i === 0 }; }
  const g = exp.find((x) => x.systemKey === "GENERAL_EXPENSE") || exp.find((x) => /عمومية|متنوعة|أخرى/.test(x.nameAr));
  return g ? { account: g, exact: false } : null;
}
function parsePay(n: string, ctx: LocalCtx): Pay {
  const usable = ctx.cash.filter((a) => !["CARD_CLEARING", "ESTORE_CLEARING", "POS_CASH"].includes(a.systemKey));
  // a bank or cash box named in the text wins («من الراجحي»)
  for (const a of usable) { const w = norm(a.nameAr).split(" ").filter((x) => x.length > 2 && !["بنك", "البنك", "مصرف", "حساب", "الصندوق", "صندوق", "الرئيسي", "السعودي", "النقديه"].includes(x)); if (w.some((x) => n.includes(x))) return { mode: /بنك|مصرف/.test(a.nameAr) ? "BANK" : "CASH", account: a }; }
  if (/اجل|على الحساب|لم تدفع|لم يدفع|غير مدفوع|ذمم|بالاجل|لاحقا/.test(n)) return { mode: "CREDIT" };
  if (/عهد/.test(n)) { const a = usable.find((x) => /عهد/.test(x.nameAr)); if (a) return { mode: "CUSTODY", account: a }; }
  if (/بنك|تحويل|حواله|مدى|شبكه|بطاقه|فيزا|اونلاين|سداد اونلاين|شيك/.test(n)) { const a = usable.find((x) => x.systemKey === "BANK") || usable.find((x) => /بنك|مصرف/.test(x.nameAr)); if (a) return { mode: "BANK", account: a }; }
  if (/نقد|كاش|الصندوق|صندوق|cash/.test(n)) { const a = usable.find((x) => x.systemKey === "CASH") || usable.find((x) => /صندوق/.test(x.nameAr)); if (a) return { mode: "CASH", account: a }; }
  return null;
}
function parseVatIncl(n: string): boolean | "NONE" | null {
  if (/بدون ضريب|لا ضريب|غير خاضع|معف|بلا ضريب|المورد غير مسجل|غير مسجل في الضريب|خارج نطاق/.test(n)) return "NONE";
  if (/غير شامل|قبل الضريب|\+\s*(?:ال)?ضريب|زائد (?:ال)?ضريب|مضافا اليه|تضاف (?:ال)?ضريب|بدون احتساب الضريب/.test(n)) return false;
  if (/شامل|مع الضريب|بالضريب|متضمن/.test(n)) return true;
  return null;
}

function analyse(msgs: any[], ctx: LocalCtx) {
  const { texts, qr, lastAssistant, unread, yesNo } = openTurn(msgs);
  const raw = texts.join(" ، ");
  const n = canon(norm(raw));
  const last = canon(norm(texts[texts.length - 1] || ""));
  let kind = EXPENSE_KINDS.find((k) => hit(k.keys, raw, n)) || null;
  const GENERAL = EXPENSE_KINDS.find((k) => k.id === "general")!;
  const guide = GUIDES.find((g) => hit(g.keys, raw, n)) || null;
  // «عام» as an answer, or a small purchase below the capitalisation level → general expenses
  const smallBuy = !!guide && /شراء|اشتر|شرينا/.test(n) && !/بضاع|مخزون|راتب|رواتب/.test(n);
  if (!kind && texts.length > 1 && /(^| )(عام|عامه|متنوع|متنوعه|اخرى|اخري|نثريات)( |$)/.test(last)) kind = GENERAL;
  let incl = parseVatIncl(n);
  if (incl === null && yesNo !== null) incl = yesNo;
  let amount = parseAmount(n);
  let date = parseDate(n, ctx.today);
  let supplier = parsePartner(raw, "SUPPLIER");
  let vatNo = (digits(raw).match(/\b3\d{13}3\b/) || [])[0] || null;
  if (qr) {
    if (qr.total && !amount) { amount = Number(qr.total); if (incl === null) incl = Number(qr.vatAmount) > 0 ? true : "NONE"; }
    if (qr.date && !date) date = String(qr.date).slice(0, 10);
    if (qr.seller && !supplier) supplier = String(qr.seller).trim().slice(0, 80);
    if (qr.vat && !vatNo && /^3\d{13}3$/.test(String(qr.vat))) vatNo = String(qr.vat);
  }
  const invNo = (digits(raw).match(/(?:رقم (?:ال)?فاتور[ةه]|فاتور[ةه] رقم|رقم الايصال|رقم الإيصال)\s*[:：]?\s*([A-Za-z0-9\-\/]{2,30})/) || [])[1] || null;
  if (!kind && smallBuy && amount && amount < 1000) kind = GENERAL;
  return { raw, n, last, texts, qr, unread, kind, incl, amount, date, supplier, vatNo, invNo, pay: parsePay(n, ctx), lastAssistant, guide: smallBuy && amount && amount < 1000 ? null : guide };
}
type An = ReturnType<typeof analyse>;

// ─── intents ───────────────────────────────────────────────────────────────
const isQuestion = (n: string) => /^(كيف|ما |ماهو|ماهي|ما هو|ما هي|لماذا|ليش|هل |متى|اين|وين|اشرح|وضح|فسر|عرف|ما الفرق|ايش|وش |شنو)/.test(n) || /[؟?]\s*$/.test(n);
const wantsRecord = (n: string) => /(^| )(سجل|ادخل|قيد|رحل|اضف|سند|دفعنا|سددنا|استلمنا|قبضنا|صرفنا|اشترينا|شرينا)/.test(n);

function expenseQuestion(a: An, ctx: LocalCtx): string | null {
  const need: string[] = [];
  if (!a.amount || a.amount <= 0) need.push("كم **المبلغ**؟");
  if (a.amount && a.incl === null && a.kind && a.kind.tax !== "O") need.push("هل المبلغ **شامل الضريبة؟** (شامل / غير شامل / بدون ضريبة)");
  if (!a.pay) need.push(`كيف **السداد**؟ (نقداً من الصندوق، من البنك${ctx.cash.filter((c) => /بنك|مصرف/.test(c.nameAr)).length > 1 ? " — اذكر اسم البنك" : ""}، أو آجل على المورد)`);
  else if (a.pay.mode === "CREDIT" && !a.supplier) need.push("المصروف الآجل يحتاج **اسم المورد** — من هو؟");
  return need.length ? need.join("\n") : null;
}

function expensePlan(a: An, ctx: LocalCtx, found: any | null) {
  const kind = a.kind!;
  const acc = pickAccount(ctx, kind)!;
  const none = a.incl === "NONE" || kind.tax === "O";
  // non-deductible / out-of-scope: the whole amount (with any VAT in it) is the expense
  const gross = none && a.incl === false && kind.tax === "O" ? Math.round(a.amount! * (1 + ctx.vatRate / 100) * 100) / 100 : a.amount!;
  const actions: any[] = [];
  if (a.supplier && !found) actions.push({ type: "create_partner", ref: "p1", role: "SUPPLIER", name: a.supplier, ...(a.vatNo ? { vatNumber: a.vatNo } : {}) });
  const desc = `${a.qr || /فاتور/.test(a.n) ? "فاتورة" : "مصروف"} ${kind.ar}`;
  actions.push({
    type: "expense", date: a.date || ctx.today, accountId: acc.account.id, description: desc, amount: gross, amountIncludesVat: none ? false : a.incl === true, taxCode: none ? "O" : "S",
    ...(a.pay!.mode === "CREDIT" ? {} : { payAccountId: a.pay!.account.id }),
    ...(a.supplier ? (found ? { partnerId: found.id } : { partnerRef: "p1" }) : {}),
    ...(a.supplier ? { payee: a.supplier } : {}), ...(a.vatNo ? { supplierVat: a.vatNo } : {}), ...(a.invNo ? { supplierRef: a.invNo } : {}),
  });
  return { summary: `${desc} بمبلغ ${money(gross)} ${ctx.currency}${a.supplier ? ` — ${a.supplier}` : ""}`, actions };
}

function expenseExplain(a: An, ctx: LocalCtx, preview: any[]) {
  const kind = a.kind!; const acc = pickAccount(ctx, kind)!;
  const none = a.incl === "NONE" || kind.tax === "O";
  const lines: string[] = [];
  lines.push(`الحساب: **${acc.account.code} ${acc.account.nameAr}**${acc.exact ? "" : " (لا يوجد حساب مخصص لهذا النوع في دليلك، فاخترت الأقرب — يمكنك إضافة حساب من دليل الحسابات)"}.`);
  if (none) lines.push(kind.tax === "O" ? "الضريبة: لا تُسجَّل ضريبة مدخلات لهذا النوع؛ المبلغ كاملاً على المصروف." : "الضريبة: لا ضريبة مدخلات كما ذكرت.");
  else lines.push(a.incl ? `الضريبة: المبلغ شامل، فاستخرجت ضريبة المدخلات ${ctx.vatRate}% (الصافي = الإجمالي ÷ ${(1 + ctx.vatRate / 100).toFixed(2)}).` : `الضريبة: أضفت ${ctx.vatRate}% ضريبة مدخلات على الصافي.`);
  lines.push(a.pay!.mode === "CREDIT" ? "السداد: آجل — الطرف الدائن حساب الموردين باسم المورد." : `السداد: من **${a.pay!.account.nameAr}**.`);
  if (!a.date) lines.push(`التاريخ: لم تذكره فاستخدمت اليوم (${ctx.today}).`);
  const made = preview.find((p) => /إنشاء مورد/.test(p.title || "")); const existed = preview.find((p) => /موجود مسبقاً/.test(p.title || ""));
  if (made) lines.push(`المورد «${a.supplier}» غير موجود في النظام، فسيُنشأ أولاً${a.vatNo ? " برقمه الضريبي" : " (أكمل بياناته لاحقاً من ملفه)"}.`);
  if (existed) lines.push("المورد موجود مسبقاً وسيُستخدم كما هو.");
  if (!none && !a.vatNo && !a.qr) lines.push("تنبيه: خصم الضريبة يتطلب فاتورة ضريبية باسم المنشأة من مورد مسجل؛ إن لم تكن كذلك فاكتب «بدون ضريبة».");
  if (kind.note) lines.push(`ملاحظة: ${kind.note}`);
  if (a.qr) lines.push("البيانات مقروءة من رمز QR في صورة الفاتورة.");
  return `${lines.join("\n")}\n\nراجع القيد في الخطة ثم اضغط **«تأكيد وترحيل»**، أو اكتب ما تريد تعديله.`;
}

/** Fixed journal templates for everyday non-expense movements. */
function journalIntent(a: An, ctx: LocalCtx) {
  const n = a.n;
  const A = (key: string, re?: RegExp) => ctx.accounts.find((x) => x.systemKey === key) || (re ? ctx.accounts.find((x) => re.test(x.nameAr)) : null);
  const cash = ctx.cash.find((x) => x.systemKey === "CASH") || ctx.cash.find((x) => /صندوق/.test(x.nameAr));
  const bank = (a.pay?.mode === "BANK" && a.pay.account) || ctx.cash.find((x) => x.systemKey === "BANK") || ctx.cash.find((x) => /بنك|مصرف/.test(x.nameAr));
  const payAcc = a.pay?.account || null;
  let t: { memo: string; dr: any; cr: any; why: string; needPay?: boolean } | null = null;
  if (/(ايداع|اودعنا|توريد).*(نقد|الصندوق|كاش).*(بنك|مصرف)|(تحويل|حولنا).*من الصندوق.*(بنك|مصرف)|ايداع نقدي/.test(n)) t = { memo: "إيداع نقدي في البنك", dr: bank, cr: cash, why: "تحويل بين حسابي نقدية: يزيد البنك (مدين) وينقص الصندوق (دائن)، ولا أثر على الأرباح." };
  else if (/(سحب|سحبنا).*(نقد|كاش).*(بنك|مصرف)|(تحويل|حولنا).*من (البنك|المصرف).*(الصندوق|صندوق)|تغذيه الصندوق/.test(n)) t = { memo: "سحب نقدي من البنك للصندوق", dr: cash, cr: bank, why: "تحويل بين حسابي نقدية: يزيد الصندوق (مدين) وينقص البنك (دائن)." };
  else if (/(سحب|سحوبات|مسحوبات|سحبت).*(المالك|شخصي|الشريك|صاحب)|مسحوبات شخصيه/.test(n)) t = { memo: "مسحوبات المالك", dr: A("OWNER_CURRENT", /جاري المالك/), cr: payAcc, why: "المسحوبات الشخصية ليست مصروفاً: تُخصم من جاري المالك (حقوق الملكية).", needPay: true };
  else if (/(ايداع|زياده|اضافه|دفع|سداد).*راس المال|راس مال جديد/.test(n)) t = { memo: "إيداع رأس المال", dr: payAcc, cr: A("CAPITAL", /رأس المال/), why: "رأس المال حق ملكية يزيد في الدائن، ويقابله النقد المودع.", needPay: true };
  else if (/(تمويل|ضخ|اودع|دعم).*(المالك|الشريك)|المالك (اودع|حول|دفع)/.test(n)) t = { memo: "تمويل من المالك", dr: payAcc, cr: A("OWNER_CURRENT", /جاري المالك/), why: "ما يودعه المالك مؤقتاً يُقيَّد في جاري المالك (دائن).", needPay: true };
  else if (/(سداد|سددنا|دفع|دفعنا|تسديد).*(قسط|القرض|قرض)/.test(n)) t = { memo: "سداد قسط قرض", dr: ctx.accounts.find((x) => /قروض/.test(x.nameAr)), cr: payAcc, why: "سداد أصل القرض يخفّض الالتزام (مدين) ويخرج من النقدية (دائن). الفوائد أو الرسوم — إن وجدت — تُسجَّل مصروفاً تمويلياً منفصلاً.", needPay: true };
  else if (/عجز.*(الصندوق|صندوق|نقدي|الكاش)/.test(n)) t = { memo: "عجز في الصندوق", dr: A("CASH_DIFF", /عجز وزيادة/), cr: cash, why: "النقص عند الجرد يُحمَّل على حساب عجز وزيادة الصندوق (مصروف) ويُخفَّض الصندوق ليطابق المعدود. إن تحمّله الموظف يُقيَّد على ذمته بدلاً من المصروف." };
  else if (/(زياده|فائض).*(الصندوق|صندوق|نقدي|الكاش)/.test(n)) t = { memo: "زيادة في الصندوق", dr: cash, cr: A("CASH_DIFF", /عجز وزيادة/), why: "الزيادة عند الجرد تُضاف للصندوق (مدين) وتُقيَّد دائنة في حساب عجز وزيادة الصندوق." };
  else if (/توزيع(ات)? (ال)?ارباح|ارباح موزعه|صرف ارباح/.test(n)) t = { memo: "توزيع أرباح", dr: A("RETAINED", /المبقاة/), cr: payAcc, why: "توزيع الأرباح ليس مصروفاً: يُخصم من الأرباح المبقاة (حقوق الملكية) ويخرج من النقدية.", needPay: true };
  else if (/(استلمنا|حصلنا على|استلام|اخذنا).*(قرض|تمويل بنكي)/.test(n)) t = { memo: "استلام قرض", dr: bank, cr: ctx.accounts.find((x) => /قروض/.test(x.nameAr)), why: "القرض التزام يزيد في الدائن، ويقابله ما دخل البنك." };
  return t;
}

function findTopic(raw: string, n: string) {
  let best: any = null, score = 0;
  for (const t of TOPICS) { const m = (n.match(new RegExp(t.keys.source, "g")) || []).length + (t.keys.test(raw) ? 1 : 0) + (stripped(t.keys).test(bare(n)) ? 1 : 0); if (m > score) { best = t; score = m; } }
  return best;
}

function explainEntry(e: any) {
  if (e.error) return `${e.error}. اكتب رقم القيد أو المستند كما يظهر في البرنامج (مثل JV-2026-00012 أو EXP-2026-00003).`;
  const dr = e.lines.filter((l: any) => l.debit > 0), cr = e.lines.filter((l: any) => l.credit > 0);
  const f = (l: any, v: number) => `ح/ ${l.account}${l.partner ? ` (${l.partner})` : ""} ${money(v)}`;
  const TYPE: Record<string, string> = { EXPENSE: "سند مصروف: المصروف وضريبة مدخلاته في المدين، ومصدر السداد (صندوق/بنك/مورد) في الدائن.", SALE: "فاتورة مبيعات: العميل أو النقدية مدين، والإيراد وضريبة المخرجات دائن؛ ويرافقه قيد تكلفة البضاعة المباعة.", PURCHASE: "فاتورة مشتريات: المخزون وضريبة المدخلات مدين، والمورد دائن.", PAYMENT: "سند قبض/صرف: يحرّك النقدية مقابل رصيد العميل أو المورد.", MANUAL: "قيد يومية يدوي.", OPENING: "قيد أرصدة افتتاحية.", CLOSING: "قيد إقفال: يرحّل نتيجة السنة إلى الأرباح المبقاة.", DEPRECIATION: "قيد إهلاك: مصروف الإهلاك مدين ومجمع الإهلاك دائن.", PAYROLL: "قيد رواتب: الرواتب والبدلات مدين، والمستحقات والتأمينات دائن." };
  return `**القيد ${e.number}** بتاريخ ${String(e.date).slice(0, 10)} — ${e.memo || ""}\n\nمن:\n${dr.map((l: any) => `- ${f(l, l.debit)}`).join("\n")}\nإلى:\n${cr.map((l: any) => `- ${f(l, l.credit)}`).join("\n")}\n\nالمجموع ${money(dr.reduce((x: number, l: any) => x + l.debit, 0))} مدين = ${money(cr.reduce((x: number, l: any) => x + l.credit, 0))} دائن.\n${TYPE[e.type] ? `\n**الشرح:** ${TYPE[e.type]}` : ""}${e.status !== "POSTED" ? `\nالحالة: ${e.status}.` : ""}`;
}

// ─── the agent ─────────────────────────────────────────────────────────────
// ─── questions about the establishment's own data ──────────────────────────
type Per = { from: string; to: string; label: string };
/** Every period named in the sentence, in the order written (two of them make a comparison). */
function periodsIn(n: string, today: string): Per[] {
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  const last = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const month = (yy: number, mm: number, label: string): Per => ({ from: iso(yy, mm, 1), to: yy === y && mm === m ? today : iso(yy, mm, last(yy, mm)), label });
  const q0 = Math.floor((m - 1) / 3) * 3 + 1;
  const M: [RegExp, (x: RegExpExecArray) => Per | null][] = [
    [/اول امس|قبل امس/, () => ({ from: shift(today, -2), to: shift(today, -2), label: "أول أمس" })],
    [/(?:^| )(?:امس|البارحه)(?= |$|؟|\?)/, () => ({ from: shift(today, -1), to: shift(today, -1), label: "أمس" })],
    [/(?:^| )اليوم(?= |$|؟|\?)/, () => ({ from: today, to: today, label: "اليوم" })],
    [/الاسبوع (?:الماضي|السابق|الفائت)/, () => ({ from: shift(today, -13), to: shift(today, -7), label: "الأسبوع السابق" })],
    [/(?:هذا |ه)?الاسبوع|اخر 7|اخر سبع/, () => ({ from: shift(today, -6), to: today, label: "آخر 7 أيام" })],
    [/اخر (\d{1,3}) يوم/, (x) => (+x[1] >= 1 && +x[1] <= 366 ? { from: shift(today, -(+x[1] - 1)), to: today, label: `آخر ${+x[1]} يوماً` } : null)],
    [/الشهر (?:الماضي|السابق|الفائت)/, () => { const yy = m === 1 ? y - 1 : y, mm = m === 1 ? 12 : m - 1; return month(yy, mm, "الشهر الماضي"); }],
    [/(?:السنه|العام) (?:الماضي|السابق|الماضيه|السابقه|الفائت|الفائته)/, () => ({ from: iso(y - 1, 1, 1), to: iso(y - 1, 12, 31), label: `سنة ${y - 1}` })],
    [/(?:سنه|عام|السنه|العام) (20\d{2})/, (x) => ({ from: iso(+x[1], 1, 1), to: +x[1] === y ? today : iso(+x[1], 12, 31), label: `سنة ${x[1]}` })],
    [/(?:هذه |ه)?(?:السنه|العام)(?! المالي)|منذ بدايه السنه|سنوي/, () => ({ from: iso(y, 1, 1), to: today, label: "هذه السنة" })],
    [/الربع (?:الماضي|السابق|الفائت)/, () => { const pq = q0 === 1 ? 10 : q0 - 3, yy = q0 === 1 ? y - 1 : y; return { from: iso(yy, pq, 1), to: iso(yy, pq + 2, last(yy, pq + 2)), label: "الربع السابق" }; }],
    [/الربع (الاول|الثاني|الثالث|الرابع)(?:\s+(20\d{2}))?/, (x) => { const qi = ["الاول", "الثاني", "الثالث", "الرابع"].indexOf(x[1]), st = qi * 3 + 1, yy = x[2] ? +x[2] : st > m ? y - 1 : y, end = iso(yy, st + 2, last(yy, st + 2)); return { from: iso(yy, st, 1), to: end > today ? today : end, label: `الربع ${["الأول", "الثاني", "الثالث", "الرابع"][qi]} ${yy}` }; }],
    [/(?:^| )(?:هذا )?(?:ال)?ربع(?: الحالي| سنوي)?(?= |$|؟|\?)/, () => ({ from: iso(y, q0, 1), to: today, label: "هذا الربع" })],
    [/(?:شهر )?(يناير|فبراير|مارس|ابريل|مايو|يونيو|يوليو|اغسطس|سبتمبر|اكتوبر|نوفمبر|ديسمبر)(?:\s+(20\d{2}))?/, (x) => { const mm = MONTHS[x[1]], yy = x[2] ? +x[2] : mm > m ? y - 1 : y; return month(yy, mm, `${x[1]} ${yy}`); }],
    [/شهر (\d{1,2})(?:\s*[\/\-]\s*(20\d{2}))?(?= |$|؟|\?)/, (x) => (+x[1] >= 1 && +x[1] <= 12 ? month(x[2] ? +x[2] : +x[1] > m ? y - 1 : y, +x[1], `شهر ${+x[1]}/${x[2] ? +x[2] : +x[1] > m ? y - 1 : y}`) : null)],
    [/(?:هذا |ه)الشهر|الشهر الحالي|الشهر الجاري/, () => month(y, m, "هذا الشهر")],
  ];
  const got: { at: number; end: number; rank: number; per: Per }[] = [];
  M.forEach(([re, f], rank) => { const g = new RegExp(re.source, "g"); let x: RegExpExecArray | null; while ((x = g.exec(n))) { const at = x.index, end = at + x[0].length; if (!got.some((o) => at < o.end && end > o.at)) { const per = f(x); if (per) got.push({ at, end, rank, per }); } if (!x[0].length) g.lastIndex++; } });
  return got.sort((a, b) => a.at - b.at).map((o) => o.per);
}
function parsePeriod(n: string, today: string): Per & { explicit: boolean } {
  const all = periodsIn(n, today);
  if (all.length) return { ...all[0], explicit: true };
  return { from: `${today.slice(0, 8)}01`, to: today, label: "هذا الشهر", explicit: false };
}
/** The period of equal length just before this one (a whole month goes back to the whole month before). */
function previousOf(p: Per): Per {
  const wholeMonth = p.from.endsWith("-01") && p.from.slice(0, 7) === p.to.slice(0, 7);
  if (wholeMonth) { const yy = +p.from.slice(0, 4), mm = +p.from.slice(5, 7), py = mm === 1 ? yy - 1 : yy, pm = mm === 1 ? 12 : mm - 1; return { from: iso(py, pm, 1), to: iso(py, pm, new Date(Date.UTC(py, pm, 0)).getUTCDate()), label: "الشهر الذي قبله" }; }
  const days = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86400000) + 1;
  return { from: shift(p.from, -days), to: shift(p.from, -1), label: "الفترة السابقة" };
}
function dataMetric(n: string): string | null {
  if (/(اكثر|اعلي|افضل|اكبر).*(مبيع|صنف|اصناف|منتج|رواج|طلب)|الاكثر مبيعا|الاصناف الرابح/.test(n)) return "top_products";
  if (/(اكبر|افضل|اهم|اكثر).*(عملاء|عميل|زبائن)/.test(n)) return "top_customers";
  if (/(اكبر|اهم|اكثر).*(موردين|مورد)/.test(n)) return "top_suppliers";
  if (/من يدين|مدينون|متاخرات|المتاخرين|ديون العملاء|مستحقات(نا)? (على|عند|لدى) العملاء|ذمم (ال)?مدين|كم لنا|لم يسدد|غير المسدد|اعمار الديون/.test(n)) return "receivables";
  if (/(كم|ماذا|ما) علينا|مستحقات الموردين|ديون الموردين|ذمم (ال)?دائن|ندين|التزاماتنا للموردين/.test(n)) return "payables";
  if (/السيوله|النقد المتوفر|النقديه المتوفره|كم (في|لدينا من) (النقد|الكاش|الصندوق والبنك)|الوضع النقدي|ارصده البنوك|ارصده النقديه/.test(n)) return "cash";
  if (/(اصناف|مخزون|بضاع).*(ناقص|نفد|نافد|منتهي|قارب|قليل|راكد)|نواقص|ماذا اطلب|ما يحتاج طلب|اعاده الطلب|قيمه المخزون|المخزون الراكد/.test(n)) return "stock";
  if (/(صافي|مجمل|اجمالي)? ?(الربح|ربح|ارباح|الارباح|ربحنا|خسار|هامش)/.test(n)) return "profit";
  if (/مصروفات|مصاريف|المصروف/.test(n) && /(كم|ما |اجمالي|مجموع|اعلي|اكبر|اين تذهب|تحليل|ملخص)/.test(n)) return "expenses";
  if (/مشتريات/.test(n) && /(كم|ما |اجمالي|مجموع|ملخص)/.test(n)) return "purchases";
  if (/مبيعات|المبيعات|بعنا|دخل المحل|ايراد/.test(n) && /(كم|ما |اجمالي|مجموع|ملخص|قارن|مقارنه|هل زادت|هل ارتفعت)/.test(n)) return "sales";
  if (/ملخص|وضع (المنشاه|الشركه|المحل|المؤسسه)|كيف (الوضع|الاداء|اداء|حال)|اداء (المنشاه|الشركه|المحل)|نظره عامه|تقرير (اليوم|الشهر|الاسبوع|سريع)|ماذا حدث|اهم الارقام/.test(n)) return "summary";
  return null;
}
const pct = (v: any) => (v === null || v === undefined || v === 0 ? "" : ` (${v > 0 ? "▲" : v < 0 ? "▼" : "="} ${Math.abs(v)}% عن الفترة السابقة)`);
function dataAnswer(r: any, cur: string): string {
  if (r.error) return r.error;
  const k = r.kpis, c = r.change || {}, L = r.label || `${r.period.from} → ${r.period.to}`;
  const list = (rows: any[], f: (x: any) => string) => (rows.length ? rows.map((x, i) => `${i + 1}. ${f(x)}`).join("\n") : "لا توجد بيانات في الفترة.");
  const head = `**${L}** (${r.period.from} إلى ${r.period.to}) — المبالغ قبل الضريبة`;
  switch (r.metric) {
    case "sales": return `${head}\nالمبيعات: **${money(k.sales)}** ${cur}${pct(c.sales)} من ${k.invoices} فاتورة لـ ${k.customers} عميل، ومتوسط الفاتورة ${money(k.avgTicket)}.\nمجمل الربح ${money(k.grossProfit)} (هامش ${k.margin}%).\n[تحليل المبيعات](/insights?tab=sales)`;
    case "profit": return `${head}\nالمبيعات ${money(k.sales)} − تكلفة المبيعات ${money(k.cost)} = **مجمل الربح ${money(k.grossProfit)}** (هامش ${k.margin}%)${pct(c.grossProfit)}\n− المصروفات ${money(k.expenses)} = **صافي الربح التشغيلي ${money(k.netProfit)}** ${cur}${pct(c.netProfit)}\n${k.netProfit < 0 ? "النتيجة خسارة: المصروفات أعلى من مجمل الربح. راجع أكبر بنود المصروفات والأصناف ذات الهامش الضعيف.\n" : ""}هذا ربح تشغيلي تقريبي؛ الرقم المحاسبي النهائي من [قائمة الدخل](/reports/income).`;
    case "expenses": return `${head}\nالمصروفات: **${money(k.expenses)}** ${cur}${pct(c.expenses)} في ${k.expenseCount} سند.\nأكبر البنود:\n${list(r.expByAccount || [], (x) => `${x.k}: ${money(x.v)}`)}\n[تحليل المصروفات](/reports/expenses)`;
    case "purchases": return `${head}\nالمشتريات: **${money(k.purchases)}** ${cur}${pct(c.purchases)} في ${k.purchaseInvoices} فاتورة، والمدفوع للموردين ${money(k.paid)}.\nأكبر الموردين:\n${list(r.topSuppliers || [], (x) => `${x.name}: ${money(x.v)}`)}\n[تحليل المشتريات](/insights?tab=purchases)`;
    case "top_products": return `${head}\n**الأكثر مبيعاً:**\n${list(r.topProducts, (x) => `${x.name}: ${money(x.net)} (${x.qty} وحدة، ربح ${money(x.profit)})`)}\n[كل الأصناف وتحليل ABC](/insights?tab=sales)`;
    case "top_customers": return `${head}\n**أكبر العملاء:**\n${list(r.topCustomers, (x) => `${x.name}: ${money(x.v)} (${x.n} فاتورة)`)}`;
    case "top_suppliers": return `${head}\n**أكبر الموردين:**\n${list(r.topSuppliers, (x) => `${x.name}: ${money(x.v)}`)}`;
    case "receivables": return `**مستحقاتنا على العملاء الآن: ${money(r.receivables.total)} ${cur}** — منها متأخر عن موعده **${money(r.receivables.overdue)}**.\n${list(r.receivables.top, (x) => `${x.name}: ${money(x.open)}${x.overdue > 0 ? ` (متأخر ${money(x.overdue)}، أقدمها ${x.maxAge} يوماً)` : ""}`)}\n[التحصيل والمتابعة](/collections) · [أعمار الديون](/reports/aging)`;
    case "payables": return `**مستحقات الموردين علينا الآن: ${money(r.payables.total)} ${cur}** — منها حلّ موعده **${money(r.payables.overdue)}**.\n${list(r.payables.top, (x) => `${x.name}: ${money(x.open)}${x.overdue > 0 ? ` (مستحق ${money(x.overdue)})` : ""}`)}\nالمطلوب سداده خلال 30 يوماً: ${money(r.forecast.outflow30)}.`;
    case "cash": return `**النقدية والبنوك الآن: ${money(r.cash.total)} ${cur}**\n${list(r.cash.accounts || [], (x) => `${x.name}: ${money(x.balance ?? x.v ?? 0)}`)}\nخلال 30 يوماً: تحصيل متوقع ${money(r.forecast.inflow30)} − سداد مستحق ${money(r.forecast.outflow30)} = **سيولة متوقعة ${money(r.forecast.projected)}**${r.forecast.projected < 0 ? " ⚠ عجز متوقع: عجّل التحصيل أو أجّل بعض السداد." : ""}\n[الذمم والسيولة](/insights?tab=money)`;
    case "stock": { const s = r.stock, n = s.counts; return `**المخزون:** القيمة ${money(s.value)} ${cur}.\n- نافد ومطلوب: **${n.outOfStock}**${s.outOfStock.length ? ` (${s.outOfStock.join("، ")})` : ""}\n- عند حد إعادة الطلب: **${n.belowReorder}**${s.belowReorder.length ? ` (${s.belowReorder.join("، ")})` : ""}\n- يكفي أقل من أسبوع: ${n.runningOut} · راكد منذ 90 يوماً: ${n.dead} · دفعات تنتهي قريباً: ${n.expiring}\n[إعادة الطلب وإنشاء أوامر الشراء](/reorder) · [تنبيهات المخزون](/insights?tab=stock)`; }
    default: return `${head}\n- المبيعات: **${money(k.sales)}**${pct(c.sales)} — ${k.invoices} فاتورة\n- مجمل الربح: ${money(k.grossProfit)} (هامش ${k.margin}%)\n- المصروفات: ${money(k.expenses)}${pct(c.expenses)}\n- صافي الربح التشغيلي: **${money(k.netProfit)}**${pct(c.netProfit)}\n- المحصّل من العملاء ${money(k.collected)} · المدفوع للموردين ${money(k.paid)}\n- النقدية والبنوك: ${money(r.cash.total)} · مستحقاتنا ${money(r.receivables.total)} (متأخر ${money(r.receivables.overdue)}) · علينا للموردين ${money(r.payables.total)}\n${(r.insights || []).slice(0, 3).map((x: string) => `• ${x}`).join("\n")}\n[لوحة الإدارة](/insights)`;
  }
}

const CHECK_HINT: [RegExp, string][] = [
  [/غير متوازنة|ميزان المراجعة/, "يوجد قيد مرحّل مدينه لا يساوي دائنه. افتح القيود اليومية وابحث عن القيد غير المتوازن، اعكسه وأعد إدخاله."],
  [/العملاء/, "السبب المعتاد: قيد يدوي على حساب العملاء دون اختيار العميل في السطر، أو مستند عُدّل قيده يدوياً. اعكس القيد اليدوي وسجّل العملية بمستندها (فاتورة، سند قبض، إشعار)."],
  [/الموردين/, "السبب المعتاد: قيد يدوي على حساب الموردين دون اختيار المورد، أو مصروف آجل بلا مورد. اعكسه وسجّل العملية بمستندها (فاتورة مشتريات، سند صرف)."],
  [/المخزون/, "قيد يدوي مباشر على حساب المخزون، أو حركة مخزون بلا قيد. لا تقيّد على حساب المخزون يدوياً: استخدم فواتير الشراء وحركات الجرد والتسوية."],
  [/ضريبة/, "قيد يدوي على حساب الضريبة بلا مستند ضريبي. اعكسه وسجّل الضريبة ضمن الفاتورة أو المصروف حتى تدخل الإقرار."],
  [/الأصول|الإهلاك/, "أصل قُيّد يدوياً على حساب الأصول دون إضافته في سجل الأصول الثابتة (أو العكس). أضف الأصل من شاشة الأصول واعكس القيد اليدوي."],
  [/نهاية الخدمة|الإجازات|سلف/, "قيد يدوي على حساب المخصص أو السلف خارج شاشة الرواتب. اعكسه وسجّله من الرواتب والموظفين."],
];
function checkAnswer(r: any): string {
  if (r.error) return r.error;
  const out: string[] = [];
  const ICON: Record<string, string> = { danger: "⛔", warn: "⚠", info: "ℹ" };
  if (!r.failed.length && !r.issues.length) return `**✓ الدفاتر سليمة.** نجحت كل فحوص التطابق (${r.checksTotal}/${r.checksTotal}): ميزان المراجعة متوازن، والعملاء والموردون والمخزون والضريبة والأصول تطابق الأستاذ العام، ولا توجد مسودات معلّقة ولا أرصدة نقدية أو مخزنية سالبة.\n[تقرير فحص التطابق](/reports/integrity)`;
  out.push(`**نتيجة فحص الدفاتر:** نجح ${r.checksPassed} من ${r.checksTotal} فحص تطابق${r.issues.length ? `، ووجدت ${r.issues.length === 1 ? "ملاحظة واحدة" : r.issues.length === 2 ? "ملاحظتين" : `${r.issues.length} ملاحظات`}` : ""}.`);
  for (const f of r.failed) { const hint = CHECK_HINT.find(([re]) => re.test(f.name)); out.push(`⛔ **${f.name}**\nالقيمتان: ${money(Number(f.a))} مقابل ${money(Number(f.b))} — الفرق **${money(Math.abs(f.diff))}**.\nالعلاج: ${hint ? hint[1] : "افتح تقرير فحص التطابق لمعرفة مصدر الفرق."}`); }
  for (const i of r.issues) out.push(`${ICON[i.level] || "•"} **${i.title}**${i.detail ? `\n${i.detail}` : ""}\nالعلاج: ${i.fix}${i.link ? ` [فتح الشاشة](${i.link})` : ""}`);
  if (r.failed.length) out.push("[تقرير فحص التطابق الكامل](/reports/integrity)");
  return out.join("\n\n");
}
function partnerAnswer(r: any, cur: string): string {
  if (r.error) return r.error;
  if (!r.found) return "لم أجد عميلاً أو مورداً بهذا الاسم. اكتب الاسم كما هو مسجل، أو جزءاً منه.";
  if (r.candidates) return `وجدت أكثر من اسم مطابق: ${r.candidates.join("، ")}.\nأيهم تقصد؟`;
  const lines: string[] = [];
  if (r.isCustomer || r.receivable) lines.push(r.receivable > 0.005 ? `**${r.name}** مدين لنا بـ **${money(r.receivable)} ${cur}**.` : r.receivable < -0.005 ? `**${r.name}** له رصيد دائن **${money(-r.receivable)} ${cur}** (دفع مقدماً أو أكثر مما عليه).` : `**${r.name}**: لا رصيد عليه كعميل.`);
  if (r.isSupplier || r.payable) lines.push(r.payable > 0.005 ? `علينا له كمورد **${money(r.payable)} ${cur}**.` : r.payable < -0.005 ? `له عندنا رصيد مدين كمورد ${money(-r.payable)} (دفعنا أكثر مما علينا).` : r.isSupplier ? "لا رصيد له كمورد." : "");
  if (r.openCount) lines.push(`فواتير مفتوحة: ${r.openCount} بإجمالي ${money(r.openTotal)}${r.overdue > 0 ? `، منها **متأخر ${money(r.overdue)}**` : ""}:\n${r.open.map((o: any) => `- ${o.number} — تستحق ${o.due} — ${money(o.rest)}`).join("\n")}`);
  if (r.creditLimit > 0 && r.receivable > r.creditLimit) lines.push(`⚠ تجاوز حد الائتمان (${money(r.creditLimit)}).`);
  lines.push(`[فتح الملف وكشف الحساب](/${r.isSupplier && !r.isCustomer ? "suppliers" : "customers"}/${r.id})`);
  return lines.filter(Boolean).join("\n");
}
/** «كيف أضيف عميلاً؟» → the lesson of that screen, from the same text the learning centre shows. */
function lessonFor(raw: string, n: string, eg: boolean) {
  const hitKey = LESSON_KEYS.find((k) => hit(k.keys, raw, n));
  if (!hitKey) return null;
  const ok = (l: any) => !(l.sa && eg) && !(l.eg && !eg);
  return LESSONS.find((l) => ok(l) && (l.id === hitKey.id || l.id === `${hitKey.id}-eg`) && (!eg || l.id.endsWith("-eg") || !LESSONS.some((x) => x.id === `${hitKey.id}-eg`))) || null;
}
const lessonAnswer = (l: any) => `**${l.title}**\n${l.steps.map((st: string, i: number) => `${i + 1}. ${st}`).join("\n")}${l.entry ? `\n\n**القيد الذي ينشئه البرنامج:** ${l.entry}` : ""}${l.tips?.length ? `\n\n${l.tips.map((t: string) => `💡 ${t}`).join("\n")}` : ""}\n\n${l.go ? `[${l.go.label}](${l.go.to}) · ` : ""}[الدرس في مركز التعلّم](/learn?s=${l.section}&l=${l.id})`;

// ─── the analyst: ratios, comparisons, one item, VAT, payroll, the management report ──────────────────────────
const GRADE: Record<string, string> = { good: "🟢 جيد", ok: "🟡 مقبول", weak: "🔴 ضعيف", na: "—" };
const rv = (r: any) => (r.value === null ? "—" : r.unit === "%" ? `${r.value}%` : r.unit === "d" ? `${Math.round(r.value)} يوماً` : r.unit === "x" ? `${r.value} مرة` : String(r.value));
const scoreWord = (v: number | null) => (v === null ? "غير محسوبة" : v >= 75 ? "جيدة" : v >= 50 ? "متوسطة" : "تحتاج معالجة");
function analysisAnswer(r: any, cur: string, label?: string): string {
  if (r.error) return r.error;
  const f = r.figures, P = `${r.period.from} إلى ${r.period.to}`;
  const shown = r.ratios.filter((x: any) => x.value !== null);
  return [`**التحليل المالي — ${label || "الفترة"}** (${P})`,
    `**الصحة المالية: ${r.score === null ? "—" : `${r.score} / 100`} (${scoreWord(r.score)})** — من ${shown.filter((x: any) => x.grade !== "na").length} مؤشراً محسوباً من الدفاتر المرحّلة.`,
    shown.length ? `| المؤشر | القيمة | التقييم | المرجع |\n|---|---|---|---|\n${shown.map((x: any) => `| ${x.name} | ${rv(x)} | ${GRADE[x.grade]} | ${x.bench} |`).join("\n")}` : "لا توجد قيود مرحّلة كافية في هذه الفترة لحساب المؤشرات.",
    `**الأرقام الأساسية (${cur}):** المبيعات ${money(f.sales)} · مجمل الربح ${money(f.grossProfit)} · صافي الربح ${money(f.net)}\nالنقد والبنوك ${money(f.cash)} · العملاء ${money(f.receivables)} · المخزون ${money(f.inventory)} · الموردون ${money(f.payables)}\nرأس المال العامل ${money(f.workingCapital)} · إجمالي الأصول ${money(f.totalAssets)} · حقوق الملكية ${money(f.equity)}`,
    `**التوصيات:**\n${r.actions.map((x: string, i: number) => `${i + 1}. ${x}`).join("\n")}`,
    `${r.balanced ? "" : "⚠ الميزانية غير متوازنة — اكتب «افحص الدفاتر» قبل الاعتماد على هذه الأرقام.\n"}[قائمة الدخل](/reports/income) · [الميزانية العمومية](/reports/balance-sheet) · [لوحة الإدارة](/insights)`].join("\n\n");
}
const chg = (a: number, b: number) => (Math.abs(b) < 0.005 ? (Math.abs(a) < 0.005 ? "=" : "جديد") : `${a >= b ? "▲" : "▼"} ${Math.abs(Math.round(((a - b) / Math.abs(b)) * 1000) / 10)}%`);
function compareAnswer(r: any, cur: string): string {
  if (r.error) return r.error;
  const A = r.a, B = r.b, a = A.kpis, b = B.kpis;
  const rows: [string, number, number, boolean?][] = [["المبيعات", a.sales, b.sales], ["مجمل الربح", a.grossProfit, b.grossProfit], ["هامش الربح %", a.margin, b.margin, true], ["المصروفات", a.expenses, b.expenses], ["صافي الربح التشغيلي", a.netProfit, b.netProfit], ["عدد الفواتير", a.invoices, b.invoices, true], ["متوسط الفاتورة", a.avgTicket, b.avgTicket], ["المشتريات", a.purchases, b.purchases], ["المحصّل من العملاء", a.collected, b.collected]];
  const cell = (v: number, plain?: boolean) => (plain ? String(v) : money(v));
  const table = `| البند | ${A.label} | ${B.label} | التغيّر |\n|---|---|---|---|\n${rows.map(([n, x, y, plain]) => `| ${n} | ${cell(x, plain)} | ${cell(y, plain)} | ${plain && n.includes("%") ? `${x - y >= 0 ? "+" : "−"}${Math.abs(Math.round((x - y) * 10) / 10)} نقطة` : chg(x, y)} |`).join("\n")}`;
  const notes: string[] = [];
  const dS = b.sales ? (a.sales - b.sales) / Math.abs(b.sales) : 0, dE = b.expenses ? (a.expenses - b.expenses) / Math.abs(b.expenses) : 0;
  if (!a.sales && !b.sales) notes.push("لا مبيعات مرحّلة في الفترتين.");
  else {
    notes.push(a.sales >= b.sales ? `المبيعات ${b.sales ? `ارتفعت ${Math.abs(Math.round(dS * 100))}%` : "بدأت في الفترة الأولى"}${a.invoices !== b.invoices ? ` (${a.invoices} فاتورة مقابل ${b.invoices})` : ""}.` : `المبيعات انخفضت ${Math.abs(Math.round(dS * 100))}%${a.invoices < b.invoices ? ` لأن عدد الفواتير نزل من ${b.invoices} إلى ${a.invoices}` : a.avgTicket < b.avgTicket ? " لأن متوسط الفاتورة أقل" : ""}.`);
    if (Math.abs(a.margin - b.margin) >= 1) notes.push(a.margin > b.margin ? `الهامش تحسّن من ${b.margin}% إلى ${a.margin}%.` : `الهامش تراجع من ${b.margin}% إلى ${a.margin}% — راجع الخصومات وتكلفة الشراء.`);
    if (b.expenses && dE > dS + 0.05 && dE > 0) notes.push(`المصروفات زادت ${Math.round(dE * 100)}% أي أسرع من المبيعات${A.topExpense ? ` (أكبر بند: ${A.topExpense.k})` : ""}.`);
    notes.push(a.netProfit >= b.netProfit ? `صافي الربح التشغيلي أفضل بـ ${money(a.netProfit - b.netProfit)} ${cur}.` : `صافي الربح التشغيلي أقل بـ ${money(b.netProfit - a.netProfit)} ${cur}.`);
  }
  return `**مقارنة ${A.label} مع ${B.label}** — المبالغ قبل الضريبة\n(${A.from} إلى ${A.to}) مقابل (${B.from} إلى ${B.to})\n\n${table}\n\n**القراءة:**\n${notes.map((x) => `- ${x}`).join("\n")}\n\n[مقارنة قائمة الدخل](/reports/income-compare) · [لوحة الإدارة](/insights)`;
}
function productAnswer(r: any, cur: string, label?: string): string {
  if (r.error) return r.error;
  if (!r.found) return "لم أجد صنفاً بهذا الاسم. اكتب الاسم أو رمز الصنف كما هو مسجل، أو جزءاً منه.";
  if (r.candidates) return `وجدت أكثر من صنف مطابق: ${r.candidates.join("، ")}.\nأي صنف تقصد؟`;
  const L: string[] = [`**${r.name}** (${r.sku})`];
  if (!r.isService) L.push(`- الرصيد الآن: **${r.onHand} ${r.unit || ""}** بتكلفة ${money(r.stockValue)} ${cur} (متوسط التكلفة ${money(r.avgCost)})${r.reorderLevel > 0 && r.onHand <= r.reorderLevel ? ` ⚠ عند حد إعادة الطلب (${r.reorderLevel})` : ""}${r.onHand < 0 ? " ⛔ رصيد سالب: بيع قبل تسجيل الشراء" : ""}`);
  L.push(`- سعر البيع ${money(r.salePrice)}${r.unitMargin !== null ? ` — هامش الوحدة ${r.unitMargin}%${r.unitMargin < 0 ? " ⛔ يُباع بأقل من تكلفته" : ""}` : ""}`);
  L.push(r.soldQty ? `- مبيعات ${label || "الفترة"} (${r.period.from} إلى ${r.period.to}): **${r.soldQty} ${r.unit || ""}** بقيمة ${money(r.soldNet)} وربح ${money(r.soldProfit)} في ${r.invoices} فاتورة` : `- لا مبيعات له في ${label || "الفترة"} (${r.period.from} إلى ${r.period.to})`);
  if (r.daysCover !== null) L.push(`- بمعدل البيع الحالي يكفي الرصيد **${r.daysCover} يوماً**${r.daysCover < 7 ? " — اطلبه الآن" : ""}`);
  if (r.lastPurchase) L.push(`- آخر شراء: ${r.lastPurchase.date} بسعر ${money(r.lastPurchase.price)}${r.lastPurchase.supplier ? ` من ${r.lastPurchase.supplier}` : ""} (${r.lastPurchase.number})`);
  L.push(`[ملف الصنف وكرت الحركة](/products/${r.id})`);
  return L.join("\n");
}
function vatAnswer(r: any, cur: string, label: string | undefined, eg: boolean): string {
  if (r.error) return r.error;
  return `**${eg ? "ضريبة القيمة المضافة" : "موقف ضريبة القيمة المضافة"} — ${label || "الفترة"}** (${r.period.from} إلى ${r.period.to})\n- ضريبة المخرجات (على المبيعات): ${money(r.outputVat)}\n- ضريبة المدخلات (على المشتريات والمصروفات): ${money(r.inputVat)}\n- ${r.net >= 0 ? `**المستحق سداده للهيئة: ${money(r.net)} ${cur}**` : `**رصيد دائن لصالحك: ${money(-r.net)} ${cur}** (يُرحَّل للفترة التالية أو يُسترد)`}\n${r.reconciled ? "✓ الإقرار يطابق حسابات الضريبة في الأستاذ العام." : "⚠ الإقرار لا يطابق حسابات الضريبة في الأستاذ: يوجد قيد يدوي على حساب الضريبة بلا مستند. اكتب «افحص الدفاتر»."}\nالأرقام من المستندات المرحّلة فقط؛ المسودات لا تدخل.\n[الإقرار الضريبي](/vat)`;
}
function hrAnswer(r: any, cur: string): string {
  if (r.error) return r.error;
  const ST: Record<string, string> = { DRAFT: "مسودة", POSTED: "مرحّل", PAID: "مدفوع" };
  return `**الرواتب والموظفون**\n- الموظفون على رأس العمل: **${r.employees}** — إجمالي الأجور الشهرية الثابتة ${money(r.wages)} ${cur}\n${r.lastRun ? `- آخر مسير: ${r.lastRun.period} (${ST[r.lastRun.status] || r.lastRun.status}) — الإجمالي ${money(r.lastRun.gross)}، الاستقطاعات ${money(r.lastRun.deductions)}، **الصافي ${money(r.lastRun.net)}**${r.lastRun.employerCost ? `، حصة المنشأة في التأمينات ${money(r.lastRun.employerCost)}` : ""}` : "- لم يُنشأ مسير رواتب بعد"}\n- السلف القائمة: ${r.loans.count} بمتبقٍّ ${money(r.loans.rest)}${r.openItems ? `\n- حركات إضافي وحسميات لم تدخل مسيراً: ${r.openItems}` : ""}\n[مسيرات الرواتب](/payroll) · [السلف](/payroll/loans)`;
}
function reportAnswer(r: any, cur: string): string {
  if (r.error) return r.error;
  const e = r.exec, k = e.kpis, c = e.change || {}, an = r.analysis, ck = r.check, L = e.label || "الفترة";
  const risks: string[] = [];
  if (k.netProfit < 0) risks.push(`النتيجة التشغيلية خسارة ${money(-k.netProfit)}.`);
  if (e.receivables.overdue > 0) risks.push(`متأخرات العملاء ${money(e.receivables.overdue)} من ${money(e.receivables.total)}${e.receivables.top[0] ? ` — أكبرها ${e.receivables.top[0].name}` : ""}.`);
  if (e.forecast.projected < 0) risks.push(`عجز سيولة متوقع خلال 30 يوماً: ${money(-e.forecast.projected)}.`);
  if (e.stock.counts.outOfStock) risks.push(`${e.stock.counts.outOfStock} صنف نافد ومطلوب${e.stock.outOfStock.length ? ` (${e.stock.outOfStock.slice(0, 3).join("، ")})` : ""}.`);
  if (e.stock.counts.dead) risks.push(`${e.stock.counts.dead} صنف راكد منذ 90 يوماً يجمّد سيولة.`);
  if (ck.failed) risks.push(`فحوص تطابق لم تنجح في الدفاتر: ${ck.failed} — يجب علاجها قبل اعتماد الأرقام.`);
  if (ck.danger) risks.push(`ملاحظات خطرة في الدفاتر (نقدية أو مخزون سالب): ${ck.danger} — اكتب «افحص الدفاتر» للتفاصيل.`);
  const weak = an.ratios.filter((x: any) => x.grade === "weak" && x.value !== null).map((x: any) => `${x.name} ${rv(x)}`);
  return [`**تقرير الإدارة — ${L}** (${e.period.from} إلى ${e.period.to})`,
    `**1. الأداء**\n| البند | القيمة (${cur}) | عن الفترة السابقة |\n|---|---|---|\n| المبيعات | ${money(k.sales)} | ${c.sales ? `${c.sales > 0 ? "▲" : "▼"} ${Math.abs(c.sales)}%` : "—"} |\n| مجمل الربح | ${money(k.grossProfit)} (${k.margin}%) | ${c.grossProfit ? `${c.grossProfit > 0 ? "▲" : "▼"} ${Math.abs(c.grossProfit)}%` : "—"} |\n| المصروفات | ${money(k.expenses)} | ${c.expenses ? `${c.expenses > 0 ? "▲" : "▼"} ${Math.abs(c.expenses)}%` : "—"} |\n| صافي الربح التشغيلي | ${money(k.netProfit)} | ${c.netProfit ? `${c.netProfit > 0 ? "▲" : "▼"} ${Math.abs(c.netProfit)}%` : "—"} |\nعدد الفواتير ${k.invoices} · عدد العملاء ${k.customers} · متوسط الفاتورة ${money(k.avgTicket)}.${e.topProducts[0] ? ` الأكثر مبيعاً: ${e.topProducts.slice(0, 3).map((x: any) => x.name).join("، ")}.` : ""}`,
    `**2. السيولة والذمم**\n- النقد والبنوك: **${money(e.cash.total)}**\n- مستحقاتنا على العملاء: ${money(e.receivables.total)} (متأخر ${money(e.receivables.overdue)})\n- علينا للموردين: ${money(e.payables.total)} (حلّ موعده ${money(e.payables.overdue)})\n- خلال 30 يوماً: تحصيل متوقع ${money(e.forecast.inflow30)} − سداد ${money(e.forecast.outflow30)} = سيولة متوقعة **${money(e.forecast.projected)}**`,
    `**3. المؤشرات المالية** — الصحة المالية ${an.score === null ? "—" : `${an.score}/100`} (${scoreWord(an.score)})\n${weak.length ? `مؤشرات ضعيفة: ${weak.join("، ")}.` : "لا مؤشرات ضعيفة."} نسبة التداول ${rv(an.ratios[0])}، هامش صافي الربح ${rv(an.ratios.find((x: any) => x.key === "nm"))}، فترة التحصيل ${rv(an.ratios.find((x: any) => x.key === "dso"))}.`,
    `**4. الضريبة والدفاتر**\n- ضريبة الفترة: ${r.vat.net >= 0 ? `مستحق ${money(r.vat.net)}` : `رصيد دائن ${money(-r.vat.net)}`} (مخرجات ${money(r.vat.outputVat)} − مدخلات ${money(r.vat.inputVat)})\n- فحص الدفاتر: نجح ${ck.passed} من ${ck.total}${ck.issues ? `، وعدد الملاحظات ${ck.issues}` : "، بلا ملاحظات"}.`,
    `**5. المخاطر**\n${risks.length ? risks.map((x) => `- ${x}`).join("\n") : "- لا مخاطر ظاهرة في هذه الفترة."}`,
    `**6. التوصيات**\n${an.actions.slice(0, 5).map((x: string, i: number) => `${i + 1}. ${x}`).join("\n")}`,
    "أُعدّ هذا التقرير من الدفاتر المرحّلة لحظة السؤال. استخدم زر «طباعة / PDF» أسفل الرد لحفظه.\n[لوحة الإدارة](/insights) · [مركز التقارير](/reports-center)"].join("\n\n");
}
/** What the user is likely to ask next, offered as one-tap chips. */
const NEXT: Record<string, string[]> = {
  sales: ["قارن المبيعات بالشهر الماضي", "ما الأكثر مبيعاً؟", "من أكبر العملاء؟"], profit: ["حلّل الوضع المالي", "أين تذهب المصروفات؟", "قارن الربح بالشهر الماضي"], expenses: ["قارن المصروفات بالشهر الماضي", "كم صافي الربح؟"],
  purchases: ["كم علينا للموردين؟", "ماذا أطلب من المخزون؟"], top_products: ["ماذا أطلب من المخزون؟", "كم صافي الربح؟"], top_customers: ["من لم يسدد؟", "كم المبيعات هذه السنة؟"], top_suppliers: ["كم علينا للموردين؟"],
  receivables: ["كم السيولة المتوفرة؟", "حلّل الوضع المالي"], payables: ["كم السيولة المتوفرة؟", "من لم يسدد؟"], cash: ["من لم يسدد؟", "كم علينا للموردين؟", "حلّل الوضع المالي"], stock: ["ما الأكثر مبيعاً؟", "كم قيمة المشتريات هذا الشهر؟"],
  summary: ["اكتب تقريراً للإدارة", "حلّل الوضع المالي", "افحص الدفاتر"], analysis: ["اكتب تقريراً للإدارة", "من لم يسدد؟", "ماذا أطلب من المخزون؟"], compare: ["حلّل الوضع المالي", "أين تذهب المصروفات؟"],
  report: ["افحص الدفاتر", "قارن هذا الشهر بالشهر الماضي"], vat: ["افحص الدفاتر", "كم المبيعات هذا الربع؟"], hr: ["كم المصروفات هذا الشهر؟"], check: ["حلّل الوضع المالي", "ملخص هذا الشهر"], product: ["ماذا أطلب من المخزون؟", "ما الأكثر مبيعاً؟"],
};
/** The last figures question in the conversation, so «والشهر الماضي؟» and «والمصروفات؟» continue it. */
function lastQuery(msgs: any[]): { name: string; input: any } | null {
  for (let i = msgs.length - 2; i >= 0; i--) { const m = msgs[i]; if (m.role !== "assistant") continue; const u = m.content.find((b: any) => b.type === "tool_use" && ["business_query", "financial_analysis", "compare_periods", "vat_position", "product_info", "management_report"].includes(b.name)); if (u) return { name: u.name, input: u.input || {} }; }
  return null;
}
const wordsOf = (x: string) => bare(canon(norm(x))).split(/[^ء-يa-z0-9]+/).filter((w) => w.length > 2 && !/^(كيف|ماذا|هذا|هذه|التي|الذي|على|الى|عند|هل|انا|اريد|يمكن|عمل|اعمل|طريقه|شرح|في|من|عن|مع|او|ثم|كل|ما)$/.test(w));
/** Nothing matched: the closest lessons and accounting topics, so the user is one tap from an answer. */
function nearest(raw: string, eg: boolean) {
  const q = wordsOf(raw); if (!q.length) return [];
  const score = (text: string) => { const w = wordsOf(text); return q.reduce((a, x) => a + (w.some((y) => y === x) ? 2 : w.some((y) => y.length > 3 && x.length > 3 && (y.startsWith(x.slice(0, 4)) || x.startsWith(y.slice(0, 4)))) ? 1 : 0), 0); };
  const ls = LESSONS.filter((l: any) => !(l.sa && eg) && !(l.eg && !eg)).map((l: any) => ({ kind: "lesson", title: l.title, link: `/learn?s=${l.section}&l=${l.id}`, sc: score(`${l.title} ${l.goal || ""}`) }));
  const ts = TOPICS.map((t: any) => ({ kind: "topic", title: t.title, link: "", sc: score(t.title) }));
  return [...ls, ...ts].filter((x) => x.sc >= 2).sort((a, b) => b.sc - a.sc).slice(0, 4);
}

export async function localAgent(body: { messages: any[] }, ctx: LocalCtx): Promise<Out> {
  const msgs = body.messages;
  const lastMsg = msgs[msgs.length - 1];
  const a = analyse(msgs, ctx);
  const n = a.n;
  // a payment «to the supplier» with no expense named is a voucher against his balance; with one, it is that expense
  const voucher = a.kind ? null : /(سداد|سددنا|دفعنا|دفع|صرفنا|حولنا).*(للمورد|لمورد|مستحقات المورد|دفعه للمورد)/.test(n) ? "OUT" : /(استلمنا|قبضنا|تحصيل|حصلنا|استلام|وصلنا|دفع لنا|سدد لنا|سداد من).*(العميل|عميل)/.test(n) ? "IN" : null;

  // ── a tool just answered ──
  const tr = lastMsg.role === "user" ? lastMsg.content.find((b: any) => b.type === "tool_result") : null;
  if (tr) {
    const prev = msgs[msgs.length - 2].content.find((b: any) => b.type === "tool_use");
    let res: any = {}; try { res = JSON.parse(tr.content); } catch { /* keep {} */ }
    if (prev.name === "get_entry") return say(explainEntry(res));
    if (prev.name === "books_check") return say(checkAnswer(res), NEXT.check);
    if (prev.name === "business_query") return say(dataAnswer(res, ctx.currency), NEXT[res.metric] || NEXT.summary);
    if (prev.name === "partner_balance") return say(partnerAnswer(res, ctx.currency), res.candidates ? res.candidates.slice(0, 4).map((x: string) => `رصيد ${prev.input.role === "SUPPLIER" ? "المورد" : "العميل"} ${x}`) : undefined);
    if (prev.name === "financial_analysis") return say(analysisAnswer(res, ctx.currency, prev.input.label), NEXT.analysis);
    if (prev.name === "compare_periods") return say(compareAnswer(res, ctx.currency), NEXT.compare);
    if (prev.name === "product_info") return say(productAnswer(res, ctx.currency, prev.input.label), res.candidates ? res.candidates.slice(0, 4).map((x: string) => `مبيعات ومخزون صنف ${x}`) : NEXT.product);
    if (prev.name === "vat_position") return say(vatAnswer(res, ctx.currency, prev.input.label, ctx.vatRate === 14), NEXT.vat);
    if (prev.name === "hr_summary") return say(hrAnswer(res, ctx.currency), NEXT.hr);
    if (prev.name === "management_report") return say(reportAnswer(res, ctx.currency), NEXT.report);
    if (prev.name === "account_balance") return say(res.error ? res.error : `رصيد **${res.account}** حتى ${res.to}: **${money(Math.abs(res.balance))}** ${ctx.currency} (${res.side}).`);
    if (prev.name === "propose") {
      if (res.error) return say(`تعذّر تجهيز الخطة: ${res.error}\nصحّح المطلوب أو أعد صياغة الطلب.`);
      if (voucher) return say(`جهّزت ${voucher === "IN" ? "سند القبض" : "سند الصرف"}: يُخصم من رصيد ${voucher === "IN" ? "العميل" : "المورد"} ويُوزَّع على فواتيره المفتوحة الأقدم فالأقدم.\n\nراجع القيد ثم اضغط **«تأكيد وترحيل»**.`);
      const j = journalIntent(a, ctx);
      if (j && !a.kind) return say(`${j.why}\n\nراجع القيد ثم اضغط **«تأكيد وترحيل»**.`);
      return say(expenseExplain(a, ctx, res.preview || []));
    }
    if (prev.name === "search_partners") {
      const list: any[] = res.partners || [];
      const wanted = norm(prev.input.query);
      const exact = list.find((p) => norm(p.name) === wanted) || (a.vatNo ? list.find((p) => p.vatNumber === a.vatNo) : null);
      const found = exact || (list.length === 1 ? list[0] : null);
      if (voucher) {
        if (!found) return say(list.length ? `وجدت أكثر من طرف مطابق: ${list.map((p) => `«${p.name}»`).join("، ")}. أيهم تقصد؟ اكتب الاسم كاملاً.` : `لم أجد ${voucher === "IN" ? "عميلاً" : "مورداً"} باسم «${prev.input.query}». تأكد من الاسم، أو أضفه أولاً من شاشة ${voucher === "IN" ? "العملاء" : "الموردين"}.`);
        return call("propose", { summary: `${voucher === "IN" ? "سند قبض من" : "سند صرف إلى"} ${found.name} بمبلغ ${money(a.amount!)} ${ctx.currency}`, actions: [{ type: "payment", direction: voucher, partnerId: found.id, date: a.date || ctx.today, amount: a.amount, accountId: a.pay!.account.id, method: a.pay!.mode === "BANK" ? "BANK" : "CASH", notes: voucher === "IN" ? "تحصيل من العميل" : "سداد للمورد" }] });
      }
      if (!found && list.length > 1) return say(`وجدت أكثر من مورد قريب من «${prev.input.query}»: ${list.map((p) => `«${p.name}»`).join("، ")}.\nاكتب «المورد» ثم الاسم الصحيح كاملاً، أو اكتب «مورد جديد» لإنشائه.`);
      return call("propose", expensePlan(a, ctx, found));
    }
    return giveUp("tool");
  }

  // ── a new message from the user ──
  if (!a.texts.length && !a.qr) return a.unread ? giveUp("attachment") : say(ABOUT);
  // several steps, allocations, reversals, analysis: beyond fixed rules — the advanced model's job when it is enabled
  if (/(^| )(اعكس|عكس|الغ|الغاء) (ال)?(قيد|سند|فاتوره|مصروف)/.test(n) && !isQuestion(n)) return { ...say("عكس القيد أو إلغاء المستند يتم من شاشته حتى يُعكس أثره كاملاً (الحسابات والمخزون والضريبة):\n- **قيد يدوي:** المحاسبة العامة ← القيود اليومية ← افتح القيد ← **عكس القيد**.\n- **فاتورة مرحّلة:** أصدر لها **إشعاراً دائناً** (مرتجع) من الفاتورة نفسها.\n- **مصروف أو سند:** افتحه من سجله واضغط **إلغاء** فيُعكس قيده تلقائياً.\nلا أعكس المستندات من المحادثة حتى لا يُلغى شيء بالخطأ.\n[القيود اليومية](/journals)", ["كيف أصدر إشعاراً دائناً؟"]), escalate: "reverse" };
  if (/(^| )(وزع|توزيع|بنسبه|نسبه وتناسب|عده فواتير|مجموعه فواتير|كل الفواتير)( |$)| ثم /.test(n) && (a.amount || wantsRecord(n))) return giveUp("complex");
  if (/^(مرحبا|السلام|اهلا|هلا|صباح|مساء|هاي|hi|hello)|ماذا تستطيع|ماذا تفعل|ما الذي تستطيع|ساعدني$|^مساعده$|من انت/.test(n) && !a.amount) return say(ABOUT);

  // the establishment's own figures, a named partner's balance, and a health check of the books
  if (!wantsRecord(n)) {
    const pm = n.match(/(?:رصيد|مديونيه|مستحقات|كم (?:على|علي|ل|عند)|كشف حساب|حساب) ?(?:ال)?(عميل|مورد) (.+?)(?=\s*(?:؟|\?|$| الان| حاليا| اليوم))/);
    if (pm && pm[2].trim().length > 1) return call("partner_balance", { query: pm[2].trim(), role: pm[1] === "عميل" ? "CUSTOMER" : "SUPPLIER" });
    if (/(^| )(افحص|فحص|دقق|تدقيق)( |$)|راجع (دفاتري|حساباتي|القيود|الدفاتر|الحسابات)|هل (دفاتري|حساباتي|القيود|الدفاتر|الحسابات).*(سليم|صحيح|مضبوط|متوازن)|(هل )?(يوجد|توجد|هناك|في) (مشاكل|اخطاء|مشكله|خطا)|غير متوازن|لا يتطابق|لا تتطابق|عدم تطابق|غير متطابق|(يوجد|هناك|في|لماذا) (ال)?فرق|(صندوق|بنك|مخزون|رصيد).*سالب|سالب.*(صندوق|بنك|مخزون)|صحه (الدفاتر|الحسابات)/.test(n) && !a.amount) {
      const pr = PROBLEMS.find((x) => hit(x.keys, a.raw, n));
      if (pr && isQuestion(n) && /(^| )(لماذا|ليش|كيف|ما سبب|ماسبب)/.test(n) && !/دفاتري|حساباتي|عندي|لدي/.test(n)) return say(`**${pr.title}**

${pr.text}

اكتب «افحص الدفاتر» لأبحث عن هذه المشكلة في بياناتك.`);
      return call("books_check", {});
    }
    const eg = ctx.vatRate === 14, per = parsePeriod(n, ctx.today), how = /^(كيف|طريقه|ما هو|ماهو|ما هي|ماهي|ما معني|عرف|اشرح|متي) /.test(n) && !/(كيف|ما) (هو |هي )?(الوضع|الاداء|اداء|حال|وضع)|^كيف (احسن|ازيد|ارفع|اطور)|^ما (هو|هي) (نسبه|فتره|دوران|هامش)/.test(n);
    const prevQ = lastQuery(msgs);
    // a number that is part of a date («سنة 2026»، «آخر 30 يوم»، «شهر 3») is not an amount to record
    const dateNo = !!a.amount && new RegExp(`(سنه|عام|السنه|العام|شهر|اخر|يناير|فبراير|مارس|ابريل|مايو|يونيو|يوليو|اغسطس|سبتمبر|اكتوبر|نوفمبر|ديسمبر|الاول|الثاني|الثالث|الرابع|[\\/\\-]) ?${a.amount}(?!\\d)`).test(n);
    const loose = dataMetric(n) || (/مبيعات|بعنا/.test(n) ? "sales" : /مصروف|مصاريف/.test(n) ? "expenses" : /مشتريات/.test(n) ? "purchases" : /ربح|ارباح|خسار/.test(n) ? "profit" : /مخزون|اصناف/.test(n) ? "stock" : /سيوله|نقد|كاش/.test(n) ? "cash" : /عملاء|مدين/.test(n) ? "receivables" : /موردين|دائن/.test(n) ? "payables" : null);
    if ((!a.amount || dateNo) && !how) {
      // a management report, a financial analysis, a comparison of two periods
      if (/تقرير (ل|الي |الى )?(ال)?(اداره|مدير|ملاك|مالك|شركاء|مجلس)|تقرير (اداري|شامل|مالي|تنفيذي|كامل|مفصل|الاداء)|(اكتب|اعد|جهز|حضر|اعمل|اعطني|سو) (لي )?تقرير|ملخص تنفيذي/.test(n)) return call("management_report", { from: per.from, to: per.to, label: per.label });
      const cmp = /(^| )(قارن|مقارنه|قارني|قارنلي)|الفرق بين|مقابل| ضد /.test(n), pers = periodsIn(n, ctx.today);
      if (cmp && (pers.length || /(^| )(قارن|مقارنه)/.test(n)) && !findTopic(a.raw, n)) { const A = pers[0] || per, B = pers[1] || previousOf(A); return call("compare_periods", { metric: dataMetric(n) || "summary", a: A, b: B }); }
      if (/(حلل|تحليل) (لي )?(ال)?(وضع|مركز|اداء|مالي|ماليه|قوائم|ميزانيه|حسابات|منشاه|شركه|نشاط)|تحليل مالي|النسب الماليه|نسب ماليه|نسبه (ال)?(سيوله|تداول|مديونيه)|الوضع المالي|المركز المالي|الصحه الماليه|صحه (المنشاه|الشركه) الماليه|نقاط (ال)?(ضعف|قوه)|دوران (ال)?مخزون|فتره (ال)?تحصيل|دوره (ال)?نقد|راس المال العامل|العائد علي|كيف (احسن|ازيد|ارفع|اطور) (ال)?(ربح|ارباح|سيوله|اداء)|هل (الشركه|المنشاه|المحل|نشاطي|وضعنا|وضعي) (رابح|ناجح|بخير|جيد|سليم|خسران)/.test(n) || (/(^| )(حلل|تحليل)( |$)/.test(n) && !loose))
        return call("financial_analysis", per.explicit ? { from: per.from, to: per.to, label: per.label } : { from: `${ctx.today.slice(0, 4)}-01-01`, to: ctx.today, label: "منذ بداية السنة" });
      // one item
      const im = n.match(/(?:صنف|الصنف|منتج|المنتج|ماده|الماده|سلعه|السلعه) (.+?)(?=\s*(?:؟|\?|$| هذا | هذه | خلال | في شهر | الشهر | اليوم| امس| الان| اخر | منذ | هذا$| السنه| الاسبوع))/);
      if (im && im[1].trim().length > 1 && /(كم|ما |مبيعات|بعنا|مخزون|رصيد|كميه|سعر|تكلفه|ربح|متوفر|باقي|تحرك|حركه|معلومات|بيانات|تفاصيل)/.test(n) && !/(اكثر|اعلي|افضل|اكبر) /.test(n)) return call("product_info", { query: im[1].trim().replace(/^(اسمه|رقم|رمز|كود) /, ""), from: per.from, to: per.to, label: per.label });
      // VAT position
      if (/(كم|مبلغ|صافي|مقدار|قيمه|احسب|ما ) ?.*(ضريبه القيمه المضافه|الضريبه المستحقه|ضريبه المخرجات|ضريبه المدخلات|(ال)?ضريبه (علينا|المطلوب|التي|اللي))|كم (علينا|ندفع|سندفع|ادفع) (من )?(ال)?(ضريبه|للضريبه|للهيئه|للزكاه والضريبه)|موقف(نا)? (ال)?ضريبي|(الضريبه|ضريبه) (هذا |ه)?(الربع|الشهر) كم/.test(n)) {
        const q0 = Math.floor((+ctx.today.slice(5, 7) - 1) / 3) * 3 + 1;
        return call("vat_position", per.explicit ? { from: per.from, to: per.to, label: per.label } : eg ? { from: per.from, to: per.to, label: "هذا الشهر" } : { from: iso(+ctx.today.slice(0, 4), q0, 1), to: ctx.today, label: "هذا الربع" });
      }
      // payroll
      if (/(كم|اجمالي|مجموع|تكلفه|ملخص|قيمه) (ال)?(رواتب|اجور)|(رواتب|اجور) (هذا |ه)?الشهر كم|عدد (ال)?موظفين|كم (عدد )?(ال)?موظف|(كم|اجمالي|رصيد|مجموع) (ال)?سلف|السلف القائمه/.test(n) && !a.kind) return call("hr_summary", {});
      // a short follow-up continues the last figures question: «والشهر الماضي؟» · «والمصروفات؟»
      const short = n.length <= 42 && /^(و|طيب|وماذا عن|ماذا عن|وكم|نفس|كذلك)/.test(n);
      if (prevQ && short && per.explicit && !dataMetric(n)) {
        if (prevQ.name === "business_query") return call("business_query", { metric: prevQ.input.metric, from: per.from, to: per.to, label: per.label });
        if (prevQ.name === "financial_analysis" || prevQ.name === "vat_position" || prevQ.name === "management_report") return call(prevQ.name, { from: per.from, to: per.to, label: per.label });
        if (prevQ.name === "product_info") return call("product_info", { query: prevQ.input.query, from: per.from, to: per.to, label: per.label });
        if (prevQ.name === "compare_periods") return call("compare_periods", { metric: prevQ.input.metric, a: per, b: previousOf(per) });
      }
      if (/(^| )(حلل|تحليل)( |$)/.test(n) && loose) return call("business_query", { metric: loose, from: per.from, to: per.to, label: per.label });
      if (prevQ && short && loose && prevQ.name !== "compare_periods") { const P = per.explicit ? per : prevQ.input.from && prevQ.input.to ? { from: prevQ.input.from, to: prevQ.input.to, label: prevQ.input.label } : per; return call("business_query", { metric: loose, from: P.from, to: P.to, label: P.label }); }
    }
    const metric = dataMetric(n);
    if (metric && !(a.amount && a.kind) && !/^(كيف|طريقه|ما هو|ماهو|ما هي|ماهي|ما معني|عرف|اشرح) (ا?سجل|ا?دخل|ا?حسب|تسجيل|ادخال|احتساب)/.test(n)) return call("business_query", { metric, from: per.from, to: per.to, label: per.label });
  }

  // explain an existing entry by its number
  const ref = (digits(a.raw).match(/\b([A-Za-z]{2,4}-\d{4}-\d{3,6})\b/) || [])[1];
  if (ref && (/اشرح|وضح|فسر|ما هذا|ماهو|اعرض|تفاصيل/.test(n) || a.texts.length === 1 && n.replace(norm(ref), "").trim().length < 12)) return call("get_entry", { number: ref });

  // balance of an account
  if (/رصيد/.test(n) && !wantsRecord(n) && !/افتتاح/.test(n)) {
    const words = n.replace(/كم|ما هو|ماهو|اعرض|رصيد|حساب|الحالي|الان|اليوم|[؟?]/g, " ").split(" ").filter((w) => w.length > 2);
    const acc = ctx.accounts.concat(ctx.cash).find((x) => words.length && words.every((w) => norm(x.nameAr).includes(w))) || ctx.accounts.concat(ctx.cash).find((x) => words.some((w) => norm(x.nameAr).includes(w)));
    if (acc) return call("account_balance", { accountId: acc.id });
    return say("أي حساب تقصد؟ اكتب اسمه كما في دليل الحسابات (مثل: رصيد الصندوق الرئيسي، رصيد البنك الأهلي). أرصدة العملاء والموردين من ملف كلٍّ منهم.");
  }

  const question = isQuestion(norm(a.texts[0] || "")) && !wantsRecord(n) && !(a.amount && (a.kind || voucher));
  if (question || (!a.amount && !a.kind && !voucher)) {
    const guide = GUIDES.find((g) => hit(g.keys, a.raw, n));
    const topic = findTopic(a.raw, n);
    const lesson = lessonFor(a.raw, n, ctx.vatRate === 14);
    const problem = PROBLEMS.find((x) => hit(x.keys, a.raw, n));
    // a chip offered by the assistant: the exact title of a lesson or a topic
    const title = norm(a.texts[a.texts.length - 1] || "").replace(/^(شرح|كيف) ?: ?/, "");
    const byTitle = LESSONS.find((l: any) => norm(l.title) === title && !(l.sa && ctx.vatRate === 14) && !(l.eg && ctx.vatRate !== 14)); if (byTitle) return say(lessonAnswer(byTitle));
    const topicByTitle = TOPICS.find((t: any) => norm(t.title) === title); if (topicByTitle) return say(`**${topicByTitle.title}**\n\n${topicByTitle.text}`);
    if (problem) return say(`**${problem.title}**\n\n${problem.text}`);
    if (topic) return say(`**${topic.title}**\n\n${topic.text}${lesson ? `\n\n[طريقة التنفيذ في البرنامج: ${lesson.title}](/learn?s=${lesson.section}&l=${lesson.id})` : ""}`);
    if (lesson) return say(lessonAnswer(lesson));
    if (guide) return say(guide.text);
    if (a.kind) { const acc = pickAccount(ctx, a.kind); return say(`**${a.kind.ar}** تُسجَّل مصروفاً على حساب «${acc?.account.nameAr}».\nالقيد: من ح/ ${acc?.account.nameAr}${a.kind.tax === "O" ? "" : " + ح/ ضريبة المدخلات"} إلى ح/ الصندوق أو البنك (أو ح/ الموردين إن كانت آجلة).${a.kind.note ? `\n${a.kind.note}` : ""}\n\nلتسجيلها اكتب المبلغ وطريقة السداد، مثل: «${a.kind.ar} 500 ريال شامل الضريبة نقداً».`); }
    const near = nearest(a.texts[a.texts.length - 1] || a.raw, ctx.vatRate === 14);
    if (near.length) return { ...say(`لم أجد إجابة مطابقة تماماً. أقرب ما عندي:\n${near.map((x) => (x.link ? `- [${x.title}](${x.link})` : `- ${x.title}`)).join("\n")}\nاختر أحدها، أو أعد صياغة السؤال بكلمات أخرى.`, near.map((x) => (x.kind === "lesson" ? `شرح: ${x.title}` : x.title))), escalate: "unknown-question" };
    return giveUp("unknown-question");
  }

  // receipts / payments to a named partner
  if (voucher) {
    const who = parsePartner(a.raw, voucher === "IN" ? "CUSTOMER" : "SUPPLIER");
    const need: string[] = [];
    if (!who) need.push(`من هو ${voucher === "IN" ? "العميل" : "المورد"}؟ (اكتب «${voucher === "IN" ? "العميل" : "المورد"}» ثم الاسم)`);
    if (!a.amount) need.push("كم المبلغ؟");
    if (!a.pay || a.pay.mode === "CREDIT") need.push(voucher === "IN" ? "أين استُلم المبلغ؟ (الصندوق أو البنك)" : "من أين دُفع؟ (الصندوق أو البنك)");
    if (need.length) return say(need.join("\n"));
    return call("search_partners", { query: who, role: voucher === "IN" ? "CUSTOMER" : "SUPPLIER" });
  }

  // things entered on their own screens (assets, payroll, sales, stock purchases)
  if (a.guide) return say(a.guide.text);

  // everyday journals: cash ↔ bank, owner, capital, loan
  const j = journalIntent(a, ctx);
  if (j && !a.kind) {
    if (!a.amount) return say("كم المبلغ؟");
    if (j.needPay && (!a.pay || a.pay.mode === "CREDIT")) return say("من أي حساب؟ (الصندوق أو البنك)");
    if (!j.dr || !j.cr) return giveUp("missing-account");
    return call("propose", { summary: `${j.memo} بمبلغ ${money(a.amount)} ${ctx.currency}`, actions: [{ type: "journal", date: a.date || ctx.today, memo: j.memo, lines: [{ accountId: j.dr.id, debit: a.amount, credit: 0, description: j.memo }, { accountId: j.cr.id, debit: 0, credit: a.amount, description: j.memo }] }] });
  }

  // an expense
  if (!a.kind) {
    if (a.amount && (a.qr || /مصروف|مصاريف|فاتور|ايصال|دفعنا|دفعت|صرفنا|صرفت|سجل/.test(n))) return { ...say((a.qr ? `قرأت من رمز QR: ${a.qr.seller || ""} — الإجمالي ${money(Number(a.qr.total))}${a.qr.vatAmount ? ` (منها ضريبة ${money(Number(a.qr.vatAmount))})` : ""}${a.qr.date ? ` بتاريخ ${String(a.qr.date).slice(0, 10)}` : ""}.\n` : "") + "ما **نوع المصروف** (مثل: كهرباء، إيجار، صيانة، قرطاسية، وقود، ضيافة، رسوم حكومية، دعاية… أو اكتب «عام»)" + (a.pay ? "" : "\nوكيف **السداد**؟ (نقداً، من البنك، أو آجل)")), escalate: "unknown-kind" };
    else return giveUp("unknown");
  }
  if (a.kind.tax === "ASK" && a.incl === null && a.amount) return say("هل المبلغ **شامل الضريبة؟** (شامل / غير شامل / بدون ضريبة)");
  const q = expenseQuestion(a, ctx);
  if (q) return say(`${a.qr ? `قرأت من رمز QR: ${a.qr.seller || ""}${a.qr.total ? ` — الإجمالي ${money(Number(a.qr.total))}` : ""}${a.qr.vatAmount ? ` (منها ضريبة ${money(Number(a.qr.vatAmount))})` : ""}.\n` : ""}لأجهّز قيد **${a.kind.ar}** أحتاج:\n${q}`);
  if (a.supplier && !/^(مورد جديد|جديد)$/.test(norm(a.supplier))) return call("search_partners", { query: a.vatNo || a.supplier, role: "SUPPLIER" });
  return call("propose", expensePlan({ ...a, supplier: null } as An, ctx, null));
}
