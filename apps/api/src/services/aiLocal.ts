/**
 * The built-in accounting agent: runs inside the server with no external service. It is not a language model — it is
 * a rule engine (Arabic phrase parsing + the knowledge in aiKnowledge.ts) that speaks the same protocol as the
 * advanced model (text, or tool calls: search_partners / get_entry / account_balance / propose), so everything
 * downstream — preview of the real entry, confirmation, posting — is shared. When a request is beyond it, it returns
 * `escalate` and the caller may hand the turn to the advanced model.
 */
import { EXPENSE_KINDS, GUIDES, TOPICS, ABOUT, ExpenseKind } from "./aiKnowledge";

export type LocalCtx = { accounts: any[]; cash: any[]; today: string; vatRate: number; currency: string };
type Out = { content: any[]; stop_reason: string; usage: { input_tokens: number; output_tokens: number }; escalate?: string };

const usage = { input_tokens: 0, output_tokens: 0 };
const say = (t: string): Out => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn", usage });
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
type Qr = { seller?: string; vat?: string; date?: string; total?: number; vatAmount?: number };
function openTurn(messages: any[]) {
  const texts: string[] = []; let qr: Qr | null = null; let lastAssistant = ""; let unread = 0; let cut = 0; let yesNo: boolean | null = null;
  let start = 0;
  messages.forEach((m, i) => { if (m.role === "user" && m.content.some((b: any) => b.type === "text" && /^\[النظام\] (أكّد|ألغى)/.test(b.text))) start = i; });
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
  const n = norm(raw);
  const last = norm(texts[texts.length - 1] || "");
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
  if (/(^| )(وزع|توزيع|اعكس|عكس القيد|قارن|حلل|تحليل|بنسبه|نسبه وتناسب|عده فواتير|مجموعه فواتير|كل الفواتير)( |$)| ثم /.test(n)) return giveUp("complex");
  if (/^(مرحبا|السلام|اهلا|هلا|صباح|مساء|هاي|hi|hello)|ماذا تستطيع|ماذا تفعل|ما الذي تستطيع|ساعدني$|^مساعده$|من انت/.test(n) && !a.amount) return say(ABOUT);

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
    if (topic) return say(`**${topic.title}**\n\n${topic.text}`);
    if (guide) return say(guide.text);
    if (a.kind) { const acc = pickAccount(ctx, a.kind); return say(`**${a.kind.ar}** تُسجَّل مصروفاً على حساب «${acc?.account.nameAr}».\nالقيد: من ح/ ${acc?.account.nameAr}${a.kind.tax === "O" ? "" : " + ح/ ضريبة المدخلات"} إلى ح/ الصندوق أو البنك (أو ح/ الموردين إن كانت آجلة).${a.kind.note ? `\n${a.kind.note}` : ""}\n\nلتسجيلها اكتب المبلغ وطريقة السداد، مثل: «${a.kind.ar} 500 ريال شامل الضريبة نقداً».`); }
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
