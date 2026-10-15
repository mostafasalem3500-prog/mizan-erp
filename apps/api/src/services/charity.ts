/**
 * Round 16 — charity / non-profit association module.
 * Runs on the same ledger as the core program: every voucher posts through the engine.
 *   • سند قبض (تبرع/دعم/مساهمة)  : Dr cash/bank            Cr donation revenue (43xx)
 *   • سند صرف (نقدي/شيك/تحويل)    : Dr program/aid expense   Cr cash/bank
 *   • طلب صرف (FIN-001)           : workflow only (submitted → reviewed → approved → paid by a voucher)
 *   • مسير المصروفات              : a batch of disbursements posted together
 */
import { Db } from "../db/pool";
import { bad, conflict, notFound, r2, D, num, isDate, today } from "../lib/core";
import { post, reverse, nextNumber } from "../accounting/engine";

// ─── chart of accounts additions (idempotent; created on first use) ─────────
const CHARITY_ACCOUNTS: [string, string, string, "REVENUE" | "EXPENSE" | "ASSET", string, string | null][] = [
  ["110390", "العهد المالية المؤقتة", "Temporary Cash Custody", "ASSET", "CURRENT_ASSET", "CH_CUSTODY"],
  ["43", "إيرادات الجمعية (التبرعات والمنح)", "Association Revenue (Donations & Grants)", "REVENUE", "OTHER_INCOME", null],
  ["4301", "تبرعات نقدية عامة", "General Cash Donations", "REVENUE", "OTHER_INCOME", "DON_GENERAL"],
  ["4302", "دعم مالي ومنح", "Financial Support & Grants", "REVENUE", "OTHER_INCOME", "DON_GRANTS"],
  ["4303", "مساهمات تأسيسية", "Founding Contributions", "REVENUE", "OTHER_INCOME", "DON_FOUNDING"],
  ["4304", "إيرادات البرامج والأنشطة", "Program & Activity Revenue", "REVENUE", "OTHER_INCOME", "DON_PROGRAMS"],
  ["4305", "الزكاة المستلمة", "Zakat Received", "REVENUE", "OTHER_INCOME", "DON_ZAKAT"],
  ["4306", "تبرعات مقيدة لمشاريع", "Restricted Project Donations", "REVENUE", "OTHER_INCOME", "DON_RESTRICTED"],
  ["4307", "اشتراكات الأعضاء", "Membership Fees", "REVENUE", "OTHER_INCOME", "DON_MEMBERSHIP"],
  ["4308", "تبرعات عينية", "In-kind Donations", "REVENUE", "OTHER_INCOME", "DON_INKIND"],
  ["4309", "إيرادات الكفالات", "Sponsorship Income", "REVENUE", "OTHER_INCOME", "DON_SPONSOR"],
  ["110391", "مخزون التبرعات العينية", "In-kind Donations Stock", "ASSET", "CURRENT_ASSET", "CH_INKIND_STOCK"],
  ["55", "مصروفات البرامج والمساعدات", "Program Services & Aid", "EXPENSE", "EXPENSE", null],
  ["5501", "مساعدات نقدية للمستفيدين", "Cash Aid to Beneficiaries", "EXPENSE", "EXPENSE", "CH_AID"],
  ["5502", "مصروفات البرامج والمشاريع", "Program & Project Expenses", "EXPENSE", "EXPENSE", "CH_PROGRAMS"],
  ["5503", "مكافآت المتطوعين", "Volunteer Rewards", "EXPENSE", "EXPENSE", "CH_VOLUNTEERS"],
  ["5504", "مصروفات الأنشطة والفعاليات", "Activities & Events", "EXPENSE", "EXPENSE", "CH_EVENTS"],
  ["5505", "مساعدات عينية مشتراة", "In-kind Aid Purchased", "EXPENSE", "EXPENSE", "CH_INKIND"],
  ["5506", "مساعدات عينية موزعة من التبرعات", "Distributed In-kind Aid", "EXPENSE", "EXPENSE", "CH_INKIND_DIST"],
  ["5507", "كفالات مصروفة للمستفيدين", "Sponsorships Paid", "EXPENSE", "EXPENSE", "CH_SPONSOR_PAID"],
];

export const SOURCE_AR: Record<string, string> = { CASH_DONATION: "تبرع نقدي", SUPPORT: "دعم مالي / منحة", FOUNDING: "مساهمة تأسيسية", PROGRAM: "إيرادات برامج", ZAKAT: "زكاة", MEMBERSHIP: "اشتراك عضوية", SPONSORSHIP: "كفالة", REFUND: "استرداد مبلغ", OTHER: "أخرى" };
const SOURCE_KEY: Record<string, string> = { CASH_DONATION: "DON_GENERAL", SUPPORT: "DON_GRANTS", FOUNDING: "DON_FOUNDING", PROGRAM: "DON_PROGRAMS", ZAKAT: "DON_ZAKAT", MEMBERSHIP: "DON_MEMBERSHIP", SPONSORSHIP: "DON_SPONSOR", REFUND: "OTHER_INCOME", OTHER: "OTHER_INCOME" };
const CAPACITY_KEY: Record<string, string> = { BENEFICIARY: "CH_AID", VOLUNTEER: "CH_VOLUNTEERS", EMPLOYEE: "CH_PROGRAMS", SUPPLIER: "CH_PROGRAMS", OTHER: "CH_PROGRAMS" };
const METHODS = ["CASH", "TRANSFER", "CHEQUE", "CARD"];
const PAYER_TYPES = ["INDIVIDUAL", "ENTITY", "COMPANY", "OTHER"];
const CAPACITIES = ["VOLUNTEER", "EMPLOYEE", "SUPPLIER", "BENEFICIARY", "OTHER"];

/** Identity taken from the association's own forms; editable from «إعدادات الجمعية». */
export const DEFAULT_ASSOCIATION = { name: "جمعية ريادة العطاء لخدمة الإنسان بالعسيلة", licenseNo: "1000888600", logo: "/charity/logo.png" };

export async function ensureCharity(t: Db, companyId: string) {
  const have = await t.rows(`SELECT code, id FROM accounts WHERE company_id=$1 AND code = ANY($2)`, [companyId, ["4", "5", "1103", ...CHARITY_ACCOUNTS.map((a) => a[0])]]);
  const ids: Record<string, string> = Object.fromEntries(have.map((a: any) => [a.code, a.id]));
  if (CHARITY_ACCOUNTS.some(([code]) => !ids[code])) {
    for (const [code, nameAr, nameEn, type, subtype, key] of CHARITY_ACCOUNTS) {
      if (ids[code]) continue;
      const parentCode = code.length === 2 ? code[0] : code.slice(0, code.length - 2);
      if (!ids[parentCode]) continue;
      const keyTaken = key ? await t.maybe(`SELECT id FROM accounts WHERE company_id=$1 AND system_key=$2`, [companyId, key]) : null;
      const a = await t.insert("accounts", {
        companyId, code, nameAr, nameEn, type, subtype, parentId: ids[parentCode], level: code.length === 2 ? 2 : code.length === 4 ? 3 : 4,
        isGroup: code.length === 2, isSystem: !!key || code.length === 2, systemKey: keyTaken ? null : key, isCashBank: false,
      });
      ids[code] = a.id;
    }
  }
  const s = await t.maybe(`SELECT company_id FROM charity_settings WHERE company_id=$1`, [companyId]);
  if (!s) {
    const c = await t.one(`SELECT name_ar, phone, email, city FROM companies WHERE id=$1`, [companyId]);
    await t.exec(`INSERT INTO charity_settings(company_id, association_name, license_no, phone, email, address) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [companyId, DEFAULT_ASSOCIATION.name, DEFAULT_ASSOCIATION.licenseNo, c.phone, c.email, c.city]);
  }
}

export async function acct(t: Db, companyId: string, id: string | null | undefined, key: string | null, label: string, opts: { cash?: boolean; type?: string } = {}) {
  let a: any = null;
  if (id) a = await t.maybe(`SELECT * FROM accounts WHERE id=$1 AND company_id=$2`, [id, companyId]);
  else if (key) a = await t.maybe(`SELECT * FROM accounts WHERE system_key=$1 AND company_id=$2`, [key, companyId]);
  if (!a) throw bad(`${label}: الحساب غير موجود`);
  if (a.isGroup || !a.isActive) throw bad(`${label}: يجب اختيار حساب فرعي نشط`);
  if (opts.cash && !a.isCashBank) throw bad(`${label}: يجب أن يكون حساب صندوق أو بنك`);
  if (opts.type && a.type !== opts.type) throw bad(`${label}: نوع الحساب غير مناسب`);
  return a;
}

export async function project(t: Db, companyId: string, id: any) {
  if (!id) return null;
  return t.one(`SELECT * FROM charity_projects WHERE id=$1 AND company_id=$2`, [id, companyId], "المشروع / البرنامج غير موجود");
}

async function partner(t: Db, companyId: string, id: any) {
  if (!id) return null;
  return t.one(`SELECT * FROM partners WHERE id=$1 AND company_id=$2`, [id, companyId], "الطرف غير موجود");
}

const date = (v: any) => (isDate(v) ? v : today());
const pick = <T extends string>(v: any, list: T[], def: T): T => (list.includes(v) ? v : def);

// ─── settings ──────────────────────────────────────────────────────────────
export async function getSettings(t: Db, companyId: string) {
  await ensureCharity(t, companyId);
  const s = await t.one(`SELECT * FROM charity_settings WHERE company_id=$1`, [companyId]);
  const c = await t.one(`SELECT name_ar, name_en, logo, vat_number, cr_number, phone, email, city, district, street FROM companies WHERE id=$1`, [companyId]);
  return { ...s, logoUrl: s.logo || DEFAULT_ASSOCIATION.logo, logoIsDefault: !s.logo, company: c };
}

export async function saveSettings(t: Db, companyId: string, b: any) {
  await ensureCharity(t, companyId);
  const obj = (v: any) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const txt = (v: any, n = 300) => (v === undefined ? undefined : v === null ? null : String(v).slice(0, n));
  const upd: any = {};
  for (const k of ["associationName", "licenseNo", "authority", "phone", "email", "address"]) if (b[k] !== undefined) upd[k] = txt(b[k]);
  if (b.signatories !== undefined) upd.signatories = JSON.stringify(obj(b.signatories));
  if (b.templates !== undefined) { const s = JSON.stringify(obj(b.templates)); if (s.length > 200_000) throw bad("إعدادات القوالب كبيرة جداً"); upd.templates = s; }
  if (b.theme !== undefined) upd.theme = JSON.stringify(obj(b.theme));
  if (b.defaultUi !== undefined) upd.defaultUi = !!b.defaultUi;
  upd.updatedAt = new Date();
  await t.update("charity_settings", { companyId }, upd);
  if (b.logo !== undefined) {
    if (b.logo && (!/^data:image\/(png|jpe?g|webp|svg\+xml);base64,/.test(String(b.logo)) || String(b.logo).length > 400_000)) throw bad("الشعار يجب أن يكون صورة لا تتجاوز 300 كيلوبايت");
    await t.exec(`UPDATE charity_settings SET logo=$1 WHERE company_id=$2`, [b.logo || null, companyId]);
  }
  return getSettings(t, companyId);
}

// ─── projects / programs ───────────────────────────────────────────────────
export async function listProjects(t: Db, companyId: string) {
  return t.rows(
    `SELECT p.*,
       COALESCE((SELECT SUM(amount) FROM charity_receipts r WHERE r.project_id=p.id AND r.status='POSTED'),0) received,
       COALESCE((SELECT SUM(amount) FROM charity_disbursements d WHERE d.project_id=p.id AND d.status='POSTED'),0) spent,
       COALESCE((SELECT SUM(amount) FROM charity_budget_lines b WHERE b.project_id=p.id AND b.kind='EXPENSE' AND b.year=EXTRACT(YEAR FROM now())::int),0) budget
     FROM charity_projects p WHERE p.company_id=$1 ORDER BY p.status, p.code`,
    [companyId],
  );
}

export async function saveProject(t: Db, companyId: string, b: any, id?: string) {
  const name = String(b.name || "").trim();
  if (!name) throw bad("اسم المشروع / البرنامج مطلوب");
  const data: any = {
    name, kind: pick(b.kind, ["PROGRAM", "PROJECT", "CAMPAIGN", "ENDOWMENT"], "PROGRAM"), restricted: !!b.restricted, target: r2(num(b.target)),
    startDate: isDate(b.startDate) ? b.startDate : null, endDate: isDate(b.endDate) ? b.endDate : null,
    status: pick(b.status, ["ACTIVE", "CLOSED"], "ACTIVE"), description: b.description || null,
  };
  if (id) {
    const p = await project(t, companyId, id);
    if (p.costCenterId) await t.exec(`UPDATE cost_centers SET name=$1 WHERE id=$2`, [name, p.costCenterId]);
    return t.update("charity_projects", { id, companyId }, data);
  }
  const n = await t.one(`SELECT COUNT(*)::int + 1 n FROM charity_projects WHERE company_id=$1`, [companyId]);
  let code = String(b.code || "").trim() || `PRJ-${String(n.n).padStart(3, "0")}`;
  while (!b.code && (await t.maybe(`SELECT 1 FROM charity_projects WHERE company_id=$1 AND code=$2`, [companyId, code]))) code = `PRJ-${String(Number(code.slice(4)) + 1).padStart(3, "0")}`;
  // every project gets a cost center so the standard reports (P&L by cost center, budgets) work per project
  let cc = await t.maybe(`SELECT id FROM cost_centers WHERE company_id=$1 AND code=$2`, [companyId, code]);
  if (!cc) cc = await t.insert("cost_centers", { companyId, code, name });
  return t.insert("charity_projects", { companyId, code, ...data, costCenterId: cc.id }).catch((e) => { if (e.code === "23505") throw conflict("رمز المشروع مستخدم مسبقاً"); throw e; });
}

// ─── donors & beneficiaries ────────────────────────────────────────────────
async function nextPartnerCode(t: Db, companyId: string, prefix: string) {
  for (;;) {
    const r = await t.one(`INSERT INTO sequences(company_id, key, next) VALUES ($1,$2,2) ON CONFLICT (company_id, key) DO UPDATE SET next=sequences.next+1 RETURNING next-1 AS n`, [companyId, `CODE-${prefix}`]);
    const code = `${prefix}-${String(r.n).padStart(4, "0")}`;
    if (!(await t.maybe(`SELECT 1 FROM partners WHERE company_id=$1 AND code=$2`, [companyId, code]))) return code;
  }
}

export async function listPeople(t: Db, companyId: string, role: "DONOR" | "BENEFICIARY", q: any) {
  const flag = role === "DONOR" ? "is_donor" : "is_beneficiary";
  const params: any[] = [companyId];
  let where = `p.company_id=$1 AND p.${flag}`;
  if (q.q) { params.push(`%${String(q.q).trim()}%`); where += ` AND (p.name ILIKE $${params.length} OR p.code ILIKE $${params.length} OR p.phone ILIKE $${params.length} OR p.id_number ILIKE $${params.length})`; }
  const lim = Math.min(Number(q.limit) || 2000, 5000);
  if (role === "DONOR") {
    return t.rows(
      `SELECT p.*, COALESCE(x.total,0) total, COALESCE(x.cnt,0)::int count, x.last_date, COALESCE(x.ytd,0) ytd
       FROM partners p LEFT JOIN (SELECT partner_id, SUM(amount) total, COUNT(*) cnt, MAX(date) last_date, SUM(amount) FILTER (WHERE date >= date_trunc('year', now())) ytd
         FROM charity_receipts WHERE company_id=$1 AND status='POSTED' GROUP BY partner_id) x ON x.partner_id=p.id
       WHERE ${where} ORDER BY COALESCE(x.total,0) DESC, p.name LIMIT ${lim}`, params);
  }
  return t.rows(
    `SELECT p.*, COALESCE(x.total,0) total, COALESCE(x.cnt,0)::int count, x.last_date
     FROM partners p LEFT JOIN (SELECT partner_id, SUM(amount) total, COUNT(*) cnt, MAX(date) last_date
       FROM charity_disbursements WHERE company_id=$1 AND status='POSTED' GROUP BY partner_id) x ON x.partner_id=p.id
     WHERE ${where} ORDER BY p.name LIMIT ${lim}`, params);
}

export async function savePerson(t: Db, companyId: string, role: "DONOR" | "BENEFICIARY", b: any, id?: string) {
  const name = String(b.name || "").trim();
  if (!name) throw bad("الاسم مطلوب");
  const data: any = {
    name, phone: b.phone || null, email: b.email || null, city: b.city || null, district: b.district || null, notes: b.notes || null,
    idNumber: b.idNumber || null, crNumber: b.crNumber || null, kind: b.donorType === "INDIVIDUAL" || role === "BENEFICIARY" ? "INDIVIDUAL" : "COMPANY",
  };
  if (role === "DONOR") data.donorType = pick(b.donorType, PAYER_TYPES, "INDIVIDUAL");
  if (role === "BENEFICIARY") data.beneficiaryInfo = JSON.stringify({ category: b.category || null, familySize: num(b.familySize) || null, iban: b.iban || null, bankName: b.bankName || null, status: b.benefStatus || "ACTIVE" });
  if (id) {
    await partner(t, companyId, id);
    return t.update("partners", { id, companyId }, { ...data, ...(role === "DONOR" ? { isDonor: true } : { isBeneficiary: true }) });
  }
  const code = await nextPartnerCode(t, companyId, role === "DONOR" ? "DN" : "BN");
  return t.insert("partners", { companyId, code, ...data, isCustomer: false, isSupplier: false, isDonor: role === "DONOR", isBeneficiary: role === "BENEFICIARY" });
}

export async function donorHistory(t: Db, companyId: string, id: string) {
  const p = await partner(t, companyId, id);
  const receipts = await t.rows(`SELECT r.*, pr.name project_name FROM charity_receipts r LEFT JOIN charity_projects pr ON pr.id=r.project_id WHERE r.company_id=$1 AND r.partner_id=$2 ORDER BY r.date DESC, r.number DESC`, [companyId, id]);
  const disbursements = await t.rows(`SELECT d.*, pr.name project_name FROM charity_disbursements d LEFT JOIN charity_projects pr ON pr.id=d.project_id WHERE d.company_id=$1 AND d.partner_id=$2 ORDER BY d.date DESC, d.number DESC`, [companyId, id]);
  const byYear = await t.rows(`SELECT EXTRACT(YEAR FROM date)::int AS year, SUM(amount) total, COUNT(*)::int count FROM charity_receipts WHERE company_id=$1 AND partner_id=$2 AND status='POSTED' GROUP BY 1 ORDER BY 1 DESC`, [companyId, id]);
  return { partner: p, receipts, disbursements, byYear };
}

// ─── receipts (سند قبض) ─────────────────────────────────────────────────────
export async function listReceipts(t: Db, companyId: string, q: any) {
  const params: any[] = [companyId];
  const w = ["r.company_id=$1"];
  const add = (sql: string, v: any) => { params.push(v); w.push(sql.replace("?", `$${params.length}`)); };
  if (isDate(q.from)) add("r.date >= ?", q.from);
  if (isDate(q.to)) add("r.date <= ?", q.to);
  if (q.source) add("r.source = ?", q.source);
  if (q.method) add("r.method = ?", q.method);
  if (q.projectId) add("r.project_id = ?", q.projectId);
  if (q.partnerId) add("r.partner_id = ?", q.partnerId);
  if (q.status) add("r.status = ?", q.status);
  return t.rows(
    `SELECT r.*, pr.name project_name, ca.name_ar cash_account_name, ra.name_ar revenue_account_name, je.number journal_number
     FROM charity_receipts r LEFT JOIN charity_projects pr ON pr.id=r.project_id JOIN accounts ca ON ca.id=r.cash_account_id JOIN accounts ra ON ra.id=r.revenue_account_id
     LEFT JOIN journal_entries je ON je.id=r.journal_id
     WHERE ${w.join(" AND ")} ORDER BY r.date DESC, r.number DESC LIMIT 5000`, params);
}

export async function createReceipt(t: Db, companyId: string, user: string, b: any) {
  await ensureCharity(t, companyId);
  const amount = r2(num(b.amount));
  if (!(amount > 0)) throw bad("المبلغ يجب أن يكون أكبر من صفر");
  const d = date(b.date);
  const source = pick(b.source, Object.keys(SOURCE_AR), "CASH_DONATION");
  const method = pick(b.method, METHODS, "CASH");
  const p = await partner(t, companyId, b.partnerId);
  const payerName = String(b.payerName || p?.name || "").trim();
  if (!payerName) throw bad("اسم الدافع / المتبرع مطلوب");
  const pr = await project(t, companyId, b.projectId);
  const cash = await acct(t, companyId, b.cashAccountId, method === "CASH" ? "CASH" : "BANK", "حساب الصندوق / البنك", { cash: true });
  const restricted = !!b.restricted || !!pr?.restricted;
  const rev = await acct(t, companyId, b.revenueAccountId, restricted && !b.revenueAccountId ? "DON_RESTRICTED" : SOURCE_KEY[source], "حساب الإيراد");
  if (rev.isCashBank) throw bad("حساب الإيراد لا يمكن أن يكون صندوقاً أو بنكاً");
  if (method !== "CASH" && !b.refNo && method !== "CARD") throw bad("رقم المرجع / الحوالة / الشيك مطلوب لغير النقدي");
  const number = await nextNumber(t, companyId, "DON", d);
  const memo = `${SOURCE_AR[source]} — ${payerName}${b.purpose ? " — " + b.purpose : ""}`;
  const row = await t.insert("charity_receipts", {
    companyId, number, date: d, partnerId: p?.id || null, payerName, payerIdNo: b.payerIdNo || p?.idNumber || p?.crNumber || null, payerPhone: b.payerPhone || p?.phone || null,
    payerType: pick(b.payerType, PAYER_TYPES, p?.donorType || "INDIVIDUAL"), source, purpose: b.purpose || null, projectId: pr?.id || null, restricted, amount, method,
    cashAccountId: cash.id, revenueAccountId: rev.id, bankName: b.bankName || null, refNo: b.refNo || null, depositDate: isDate(b.depositDate) ? b.depositDate : null,
    notes: b.notes || null, isDemo: !!b.isDemo, createdBy: user,
    sponsorshipId: b.sponsorshipId || null, periodsCount: b.periodsCount || null, periodLabel: b.periodLabel || null,
  });
  const je = await post(t, companyId, {
    date: d, type: "DONATION", sourceType: "CHARITY_RECEIPT", sourceId: row.id, reference: number, memo, createdBy: user, isDemo: !!b.isDemo,
    lines: [
      { account: cash.id, debit: amount, description: memo },
      { account: rev.id, credit: amount, partnerId: p?.id || null, costCenterId: pr?.costCenterId || null, description: memo },
    ],
  });
  await t.exec(`UPDATE charity_receipts SET journal_id=$1 WHERE id=$2`, [je!.id, row.id]);
  return { ...row, journalId: je!.id };
}

export async function cancelReceipt(t: Db, companyId: string, user: string, id: string, reason?: string) {
  const r = await t.one(`SELECT * FROM charity_receipts WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "السند غير موجود");
  if (r.status === "CANCELLED") throw bad("السند ملغى مسبقاً");
  if (r.journalId) await reverse(t, companyId, r.journalId, today() < String(r.date).slice(0, 10) ? r.date : today(), `إلغاء سند قبض ${r.number}${reason ? " — " + reason : ""}`, user);
  await t.exec(`UPDATE charity_receipts SET status='CANCELLED', notes=COALESCE(notes,'') || $2 WHERE id=$1`, [id, reason ? ` [إلغاء: ${reason}]` : ""]);
  return { ok: true };
}

// ─── disbursements (سند صرف) ────────────────────────────────────────────────
export async function listDisbursements(t: Db, companyId: string, q: any) {
  const params: any[] = [companyId];
  const w = ["d.company_id=$1"];
  const add = (sql: string, v: any) => { params.push(v); w.push(sql.replace("?", `$${params.length}`)); };
  if (isDate(q.from)) add("d.date >= ?", q.from);
  if (isDate(q.to)) add("d.date <= ?", q.to);
  if (q.kind) add("d.kind = ?", q.kind);
  if (q.capacity) add("d.capacity = ?", q.capacity);
  if (q.projectId) add("d.project_id = ?", q.projectId);
  if (q.partnerId) add("d.partner_id = ?", q.partnerId);
  if (q.status) add("d.status = ?", q.status);
  if (q.batchId) add("d.batch_id = ?", q.batchId);
  return t.rows(
    `SELECT d.*, pr.name project_name, ea.name_ar expense_account_name, pa.name_ar pay_account_name, rq.number request_number, b.number batch_number, je.number journal_number
     FROM charity_disbursements d LEFT JOIN charity_projects pr ON pr.id=d.project_id JOIN accounts ea ON ea.id=d.expense_account_id JOIN accounts pa ON pa.id=d.pay_account_id
     LEFT JOIN charity_requests rq ON rq.id=d.request_id LEFT JOIN charity_batches b ON b.id=d.batch_id LEFT JOIN journal_entries je ON je.id=d.journal_id
     WHERE ${w.join(" AND ")} ORDER BY d.date DESC, d.number DESC LIMIT 5000`, params);
}

export async function createDisbursement(t: Db, companyId: string, user: string, b: any) {
  await ensureCharity(t, companyId);
  const amount = r2(num(b.amount));
  if (!(amount > 0)) throw bad("المبلغ يجب أن يكون أكبر من صفر");
  const d = date(b.date);
  const kind = pick(b.kind, ["CASH", "CHEQUE", "TRANSFER"], "CASH");
  const capacity = pick(b.capacity, CAPACITIES, "BENEFICIARY");
  const p = await partner(t, companyId, b.partnerId);
  const name = String(b.beneficiaryName || p?.name || "").trim();
  if (!name) throw bad("اسم المستفيد / المستلم مطلوب");
  const reason = String(b.reason || "").trim();
  if (!reason) throw bad("سبب الصرف مطلوب");
  let rq: any = null;
  if (b.requestId) {
    rq = await t.one(`SELECT * FROM charity_requests WHERE id=$1 AND company_id=$2 FOR UPDATE`, [b.requestId, companyId], "طلب الصرف غير موجود");
    if (rq.status !== "APPROVED") throw bad(`طلب الصرف ${rq.number} غير معتمد — لا يمكن صرفه`);
    if (amount > r2(rq.amount)) throw bad(`المبلغ أكبر من المعتمد في الطلب (${r2(rq.amount)})`);
  }
  const pr = await project(t, companyId, b.projectId || rq?.projectId);
  const exp = await acct(t, companyId, b.expenseAccountId || rq?.expenseAccountId, CAPACITY_KEY[capacity], "حساب المصروف");
  if (exp.isCashBank) throw bad("حساب المصروف لا يمكن أن يكون صندوقاً أو بنكاً");
  const pay = await acct(t, companyId, b.payAccountId, kind === "CASH" ? "CASH" : "BANK", "حساب الصرف (الصندوق / البنك)", { cash: true });
  if (kind !== "CASH" && !b.refNo && !b.batchId) throw bad("رقم الشيك / مرجع التحويل مطلوب");
  if (b.iban && !/^SA\d{22}$/.test(String(b.iban).replace(/\s/g, "").toUpperCase())) throw bad("رقم الآيبان يجب أن يبدأ بـ SA ويتكون من 24 خانة");
  const number = await nextNumber(t, companyId, "DSB", d);
  const memo = `صرف ${kind === "CASH" ? "نقدي" : kind === "CHEQUE" ? "بشيك" : "بتحويل"} — ${name} — ${reason}`;
  const row = await t.insert("charity_disbursements", {
    companyId, number, date: d, kind, partnerId: p?.id || null, beneficiaryName: name, beneficiaryIdNo: b.beneficiaryIdNo || p?.idNumber || p?.crNumber || null,
    beneficiaryPhone: b.beneficiaryPhone || p?.phone || null, capacity, department: b.department || null, amount, reason, projectId: pr?.id || null,
    budgetLine: b.budgetLine || rq?.budgetLine || null, expenseAccountId: exp.id, payAccountId: pay.id, requestId: rq?.id || null, batchId: b.batchId || null,
    bankName: b.bankName || null, accountHolder: b.accountHolder || null, iban: b.iban ? String(b.iban).replace(/\s/g, "").toUpperCase() : null, refNo: b.refNo || null,
    execDate: isDate(b.execDate) ? b.execDate : null, docs: JSON.stringify(Array.isArray(b.docs) ? b.docs.slice(0, 20) : []), notes: b.notes || null, isDemo: !!b.isDemo, createdBy: user,
    programName: b.programName || null, periodFrom: isDate(b.periodFrom) ? b.periodFrom : null, periodTo: isDate(b.periodTo) ? b.periodTo : null, sourceType: b.sourceType || null, sourceId: b.sourceId || null,
  });
  const je = await post(t, companyId, {
    date: d, type: "CHARITY_DISB", sourceType: "CHARITY_DISB", sourceId: row.id, reference: number, memo, createdBy: user, isDemo: !!b.isDemo,
    lines: [
      { account: exp.id, debit: amount, partnerId: p?.id || null, costCenterId: pr?.costCenterId || null, description: memo },
      { account: pay.id, credit: amount, description: memo },
    ],
  });
  await t.exec(`UPDATE charity_disbursements SET journal_id=$1 WHERE id=$2`, [je!.id, row.id]);
  if (rq) await t.exec(`UPDATE charity_requests SET status='PAID', disbursement_id=$1 WHERE id=$2`, [row.id, rq.id]);
  return { ...row, journalId: je!.id };
}

export async function cancelDisbursement(t: Db, companyId: string, user: string, id: string, reason?: string) {
  const r = await t.one(`SELECT * FROM charity_disbursements WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "السند غير موجود");
  if (r.status === "CANCELLED") throw bad("السند ملغى مسبقاً");
  if (r.sourceType === "CUSTODY") {
    const c = await t.maybe(`SELECT status, number FROM charity_custody WHERE id=$1`, [r.sourceId]);
    if (c && c.status !== "DISBURSED") throw bad(`العهدة ${c.number} تمت تسويتها — لا يمكن إلغاء سند صرفها`);
    if (c) await t.exec(`UPDATE charity_custody SET status='APPROVED', disbursed_amount=NULL, disbursed_date=NULL, disburse_journal_id=NULL WHERE id=$1`, [r.sourceId]);
  }
  if (r.sourceType === "REFUND") await t.exec(`UPDATE charity_forms SET status='APPROVED', disbursement_id=NULL WHERE id=$1`, [r.sourceId]);
  if (r.journalId) await reverse(t, companyId, r.journalId, today() < String(r.date).slice(0, 10) ? r.date : today(), `إلغاء سند صرف ${r.number}${reason ? " — " + reason : ""}`, user);
  await t.exec(`UPDATE charity_disbursements SET status='CANCELLED' WHERE id=$1`, [id]);
  if (r.requestId) await t.exec(`UPDATE charity_requests SET status='APPROVED', disbursement_id=NULL WHERE id=$1 AND disbursement_id=$2`, [r.requestId, id]);
  return { ok: true };
}

// ─── payment requests (FIN-001) ────────────────────────────────────────────
export async function listRequests(t: Db, companyId: string, q: any) {
  const params: any[] = [companyId];
  const w = ["r.company_id=$1"];
  if (q.status) { params.push(q.status); w.push(`r.status=$${params.length}`); }
  if (isDate(q.from)) { params.push(q.from); w.push(`r.date >= $${params.length}`); }
  if (isDate(q.to)) { params.push(q.to); w.push(`r.date <= $${params.length}`); }
  return t.rows(
    `SELECT r.*, pr.name project_name, ea.name_ar expense_account_name, d.number disbursement_number
     FROM charity_requests r LEFT JOIN charity_projects pr ON pr.id=r.project_id LEFT JOIN accounts ea ON ea.id=r.expense_account_id LEFT JOIN charity_disbursements d ON d.id=r.disbursement_id
     WHERE ${w.join(" AND ")} ORDER BY r.date DESC, r.number DESC LIMIT 5000`, params);
}

export async function saveRequest(t: Db, companyId: string, user: string, b: any, id?: string) {
  await ensureCharity(t, companyId);
  const amount = r2(num(b.amount));
  if (!(amount > 0)) throw bad("المبلغ المطلوب يجب أن يكون أكبر من صفر");
  const requester = String(b.requester || user || "").trim();
  const name = String(b.beneficiaryName || "").trim();
  const purpose = String(b.purpose || "").trim();
  if (!name) throw bad("اسم الجهة / الشخص المستفيد مطلوب");
  if (!purpose) throw bad("الغرض من الصرف مطلوب");
  const pr = await project(t, companyId, b.projectId);
  if (b.expenseAccountId) await acct(t, companyId, b.expenseAccountId, null, "بند الصرف");
  const data: any = {
    requester, department: b.department || null, partnerId: b.partnerId || null, beneficiaryName: name, beneficiaryIdNo: b.beneficiaryIdNo || null, purpose,
    projectId: pr?.id || null, budgetLine: b.budgetLine || null, expenseAccountId: b.expenseAccountId || null, method: pick(b.method, ["TRANSFER", "CHEQUE", "CASH"], "TRANSFER"),
    amount, justification: b.justification || null, attachments: JSON.stringify(Array.isArray(b.attachments) ? b.attachments.slice(0, 20) : []),
  };
  if (id) {
    const r = await t.one(`SELECT * FROM charity_requests WHERE id=$1 AND company_id=$2`, [id, companyId], "الطلب غير موجود");
    if (!["DRAFT", "SUBMITTED", "REJECTED"].includes(r.status)) throw bad("لا يمكن تعديل طلب تمت مراجعته أو اعتماده");
    return t.update("charity_requests", { id, companyId }, { ...data, status: b.status === "DRAFT" ? "DRAFT" : "SUBMITTED" });
  }
  const d = date(b.date);
  const number = await nextNumber(t, companyId, "FRQ", d);
  return t.insert("charity_requests", { companyId, number, date: d, ...data, status: b.status === "DRAFT" ? "DRAFT" : "SUBMITTED", isDemo: !!b.isDemo, createdBy: user });
}

export async function actRequest(t: Db, companyId: string, user: string, id: string, action: string, b: any) {
  const r = await t.one(`SELECT * FROM charity_requests WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "الطلب غير موجود");
  const set = (o: any) => t.update("charity_requests", { id, companyId }, o);
  switch (action) {
    case "review":
      if (!["SUBMITTED", "REVIEWED"].includes(r.status)) throw bad("الطلب ليس بانتظار المراجعة");
      return set({ status: "REVIEWED", review: JSON.stringify(b.review && typeof b.review === "object" ? b.review : {}), reviewedBy: user, reviewedAt: new Date(), decisionNote: b.note ?? r.decisionNote });
    case "approve":
      if (!["SUBMITTED", "REVIEWED"].includes(r.status)) throw bad("لا يمكن اعتماد الطلب في حالته الحالية");
      return set({ status: "APPROVED", approvedBy: user, approvedAt: new Date(), decisionNote: b.note ?? r.decisionNote });
    case "reject":
      if (["PAID", "APPROVED"].includes(r.status) && r.disbursementId) throw bad("تم صرف الطلب — ألغِ سند الصرف أولاً");
      return set({ status: "REJECTED", approvedBy: user, approvedAt: new Date(), decisionNote: b.note || "مرفوض" });
    case "reopen":
      if (r.status !== "REJECTED" && r.status !== "DRAFT") throw bad("لا يمكن إعادة فتح الطلب");
      return set({ status: "SUBMITTED" });
    case "delete":
      if (!["DRAFT", "SUBMITTED", "REJECTED"].includes(r.status)) throw bad("لا يمكن حذف طلب معتمد أو مصروف");
      await t.exec(`DELETE FROM charity_requests WHERE id=$1`, [id]);
      return { ok: true };
    default:
      throw bad("إجراء غير معروف");
  }
}

// ─── expense runs (مسير المصروفات) ───────────────────────────────────────────
export async function listBatches(t: Db, companyId: string) {
  return t.rows(`SELECT b.*, pr.name project_name, jsonb_array_length(b.lines) lines_count FROM charity_batches b LEFT JOIN charity_projects pr ON pr.id=b.project_id WHERE b.company_id=$1 ORDER BY b.date DESC, b.number DESC`, [companyId]);
}

function cleanLines(lines: any[]) {
  if (!Array.isArray(lines)) return [];
  return lines.filter((l) => l && (l.name || l.partnerId) && num(l.amount) > 0).slice(0, 1000).map((l) => ({
    partnerId: l.partnerId || null, name: String(l.name || "").trim(), idNo: l.idNo || null, phone: l.phone || null, capacity: pick(l.capacity, CAPACITIES, "BENEFICIARY"),
    iban: l.iban ? String(l.iban).replace(/\s/g, "").toUpperCase() : null, bankName: l.bankName || null, amount: r2(num(l.amount)), reason: l.reason || null,
  }));
}

export async function saveBatch(t: Db, companyId: string, user: string, b: any, id?: string) {
  await ensureCharity(t, companyId);
  const title = String(b.title || "").trim();
  if (!title) throw bad("عنوان المسير مطلوب");
  const lines = cleanLines(b.lines);
  for (const l of lines) if (l.iban && !/^SA\d{22}$/.test(l.iban)) throw bad(`آيبان غير صحيح للمستفيد «${l.name}»`);
  const pr = await project(t, companyId, b.projectId);
  const data: any = {
    title, projectId: pr?.id || null, payAccountId: b.payAccountId || null, expenseAccountId: b.expenseAccountId || null, kind: pick(b.kind, ["CASH", "CHEQUE", "TRANSFER"], "TRANSFER"),
    lines: JSON.stringify(lines), total: r2(lines.reduce((a, l) => a + l.amount, 0)), notes: b.notes || null, date: date(b.date),
  };
  if (id) {
    const x = await t.one(`SELECT * FROM charity_batches WHERE id=$1 AND company_id=$2`, [id, companyId], "المسير غير موجود");
    if (x.status !== "DRAFT") throw bad("لا يمكن تعديل مسير مرحّل");
    return t.update("charity_batches", { id, companyId }, data);
  }
  const number = await nextNumber(t, companyId, "BAT", data.date);
  return t.insert("charity_batches", { companyId, number, ...data, status: "DRAFT", isDemo: !!b.isDemo, createdBy: user });
}

export async function postBatch(t: Db, companyId: string, user: string, id: string) {
  const x = await t.one(`SELECT * FROM charity_batches WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "المسير غير موجود");
  if (x.status !== "DRAFT") throw bad("المسير مرحّل مسبقاً");
  const lines: any[] = x.lines || [];
  if (!lines.length) throw bad("المسير لا يحتوي على بنود");
  if (!x.payAccountId) throw bad("اختر حساب الصرف (الصندوق / البنك) للمسير");
  let i = 0;
  for (const l of lines) {
    i++;
    await createDisbursement(t, companyId, user, {
      date: x.date, kind: x.kind, partnerId: l.partnerId, beneficiaryName: l.name, beneficiaryIdNo: l.idNo, beneficiaryPhone: l.phone, capacity: l.capacity,
      amount: l.amount, reason: l.reason || x.title, projectId: x.projectId, expenseAccountId: x.expenseAccountId, payAccountId: x.payAccountId,
      iban: l.iban, bankName: l.bankName, accountHolder: l.name, refNo: `${x.number}/${i}`, batchId: x.id, isDemo: x.isDemo,
    });
  }
  return t.update("charity_batches", { id, companyId }, { status: "POSTED", postedBy: user, postedAt: new Date() });
}

export async function cancelBatch(t: Db, companyId: string, user: string, id: string) {
  const x = await t.one(`SELECT * FROM charity_batches WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "المسير غير موجود");
  if (x.status === "DRAFT") { await t.exec(`DELETE FROM charity_batches WHERE id=$1`, [id]); return { ok: true, deleted: true }; }
  if (x.status !== "POSTED") throw bad("المسير ملغى مسبقاً");
  const ds = await t.rows(`SELECT id FROM charity_disbursements WHERE batch_id=$1 AND status='POSTED'`, [id]);
  for (const d of ds) await cancelDisbursement(t, companyId, user, d.id, `إلغاء المسير ${x.number}`);
  await t.exec(`UPDATE charity_batches SET status='CANCELLED' WHERE id=$1`, [id]);
  return { ok: true };
}

// ─── estimated budget (الموازنة التقديرية) ──────────────────────────────────
export async function budget(t: Db, companyId: string, year: number) {
  await ensureCharity(t, companyId);
  const y = Number(year) || new Date().getFullYear();
  const lines = await t.rows(
    `SELECT b.*, a.code account_code, a.name_ar account_name, pr.name project_name, pr.cost_center_id,
       COALESCE((SELECT SUM(CASE WHEN b.kind='REVENUE' THEN l.credit-l.debit ELSE l.debit-l.credit END) FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
          WHERE l.account_id=b.account_id AND e.status='POSTED' AND e.company_id=$1 AND EXTRACT(YEAR FROM e.date)=$2 AND e.type <> 'CLOSING'
            AND (pr.cost_center_id IS NULL OR l.cost_center_id=pr.cost_center_id)),0) actual
     FROM charity_budget_lines b JOIN accounts a ON a.id=b.account_id LEFT JOIN charity_projects pr ON pr.id=b.project_id
     WHERE b.company_id=$1 AND b.year=$2 ORDER BY b.kind DESC, a.code, b.name`, [companyId, y]);
  const out = lines.map((l: any) => ({ ...l, amount: r2(l.amount), actual: r2(l.actual), variance: r2(D(l.amount).minus(l.actual)), pct: Number(l.amount) ? r2((Number(l.actual) / Number(l.amount)) * 100) : null }));
  const tot = (k: string) => ({ budget: r2(out.filter((l) => l.kind === k).reduce((a, l) => a + l.amount, 0)), actual: r2(out.filter((l) => l.kind === k).reduce((a, l) => a + l.actual, 0)) });
  const months = await t.rows(
    `SELECT EXTRACT(MONTH FROM e.date)::int m, SUM(CASE WHEN a.type='REVENUE' THEN l.credit-l.debit ELSE 0 END) rev, SUM(CASE WHEN a.type='EXPENSE' THEN l.debit-l.credit ELSE 0 END) exp
     FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id
     WHERE e.company_id=$1 AND e.status='POSTED' AND EXTRACT(YEAR FROM e.date)=$2 AND e.type <> 'CLOSING' AND l.account_id IN (SELECT account_id FROM charity_budget_lines WHERE company_id=$1 AND year=$2)
     GROUP BY 1 ORDER BY 1`, [companyId, y]);
  return { year: y, lines: out, revenue: tot("REVENUE"), expense: tot("EXPENSE"), months };
}

export async function saveBudgetLine(t: Db, companyId: string, b: any, id?: string) {
  const name = String(b.name || "").trim();
  const a = await acct(t, companyId, b.accountId, null, "الحساب");
  if (!["REVENUE", "EXPENSE"].includes(a.type)) throw bad("اختر حساب إيراد أو مصروف");
  const pr = await project(t, companyId, b.projectId);
  const data: any = { year: Number(b.year) || new Date().getFullYear(), kind: a.type, name: name || a.nameAr, accountId: a.id, projectId: pr?.id || null, amount: r2(num(b.amount)), notes: b.notes || null };
  if (id) return t.update("charity_budget_lines", { id, companyId }, data);
  return t.insert("charity_budget_lines", { companyId, ...data });
}

export async function copyBudget(t: Db, companyId: string, from: number, to: number, growthPct: number, fromActual: boolean) {
  const src = (await budget(t, companyId, from)).lines;
  if (!src.length) throw bad(`لا توجد موازنة لسنة ${from}`);
  await t.exec(`DELETE FROM charity_budget_lines WHERE company_id=$1 AND year=$2`, [companyId, to]);
  for (const l of src) await t.insert("charity_budget_lines", { companyId, year: to, kind: l.kind, name: l.name, accountId: l.accountId, projectId: l.projectId, amount: r2(D(fromActual ? l.actual : l.amount).times(1 + growthPct / 100)), notes: l.notes });
  return { ok: true, count: src.length };
}

// ─── daily cash-in (تحصيل دخول الأموال اليومية) ─────────────────────────────
export async function daily(t: Db, companyId: string, day: string) {
  const d = date(day);
  const charity = await t.rows(
    `SELECT 'CHARITY' AS src, r.id, r.number, r.date, r.payer_name AS party, r.source, r.method, r.amount, a.name_ar account_name, a.id account_id, r.created_by, r.created_at
     FROM charity_receipts r JOIN accounts a ON a.id=r.cash_account_id WHERE r.company_id=$1 AND r.date=$2 AND r.status='POSTED'`, [companyId, d]);
  const general = await t.rows(
    `SELECT 'RECEIPT' AS src, p.id, p.number, p.date, COALESCE(pt.name,'—') AS party, 'GENERAL' AS source, p.method, p.amount, a.name_ar account_name, a.id account_id, p.created_by, p.created_at
     FROM payments p JOIN accounts a ON a.id=p.account_id LEFT JOIN partners pt ON pt.id=p.partner_id WHERE p.company_id=$1 AND p.date=$2 AND p.direction='IN' AND p.status='POSTED'`, [companyId, d]);
  const rows = [...charity, ...general].sort((a: any, b: any) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const norm = (m: string) => (m === "BANK" ? "TRANSFER" : m);
  const byMethod: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byAccount: Record<string, { name: string; amount: number }> = {};
  for (const r of rows) {
    byMethod[norm(r.method)] = r2((byMethod[norm(r.method)] || 0) + Number(r.amount));
    bySource[r.source] = r2((bySource[r.source] || 0) + Number(r.amount));
    byAccount[r.accountId] = { name: r.accountName, amount: r2((byAccount[r.accountId]?.amount || 0) + Number(r.amount)) };
  }
  const total = r2(rows.reduce((a: number, r: any) => a + Number(r.amount), 0));
  const closing = await t.maybe(`SELECT * FROM charity_day_closings WHERE company_id=$1 AND date=$2`, [companyId, d]);
  const last7 = await t.rows(
    `SELECT g::date AS date, COALESCE((SELECT SUM(amount) FROM charity_receipts WHERE company_id=$1 AND date=g::date AND status='POSTED'),0)
       + COALESCE((SELECT SUM(amount) FROM payments WHERE company_id=$1 AND date=g::date AND direction='IN' AND status='POSTED'),0) AS total,
       EXISTS(SELECT 1 FROM charity_day_closings c WHERE c.company_id=$1 AND c.date=g::date) AS closed
     FROM generate_series($2::date - 13, $2::date, '1 day') g ORDER BY 1 DESC`, [companyId, d]);
  return { date: d, rows, total, byMethod, bySource, byAccount: Object.values(byAccount), expectedCash: byMethod.CASH || 0, closing, last14: last7 };
}

export async function closeDay(t: Db, companyId: string, user: string, b: any) {
  const d = date(b.date);
  if (await t.maybe(`SELECT 1 FROM charity_day_closings WHERE company_id=$1 AND date=$2`, [companyId, d])) throw conflict("تم إقفال هذا اليوم مسبقاً");
  const x = await daily(t, companyId, d);
  const counted = r2(num(b.countedCash));
  const diff = r2(counted - x.expectedCash);
  if (diff !== 0) {
    const cash = await acct(t, companyId, b.cashAccountId, "CASH", "حساب الصندوق", { cash: true });
    await post(t, companyId, {
      date: d, type: "MANUAL", sourceType: "CHARITY_DAY", reference: `إقفال ${d}`, memo: `${diff < 0 ? "عجز" : "زيادة"} صندوق عند إقفال تحصيل يوم ${d}`, createdBy: user,
      lines: diff < 0 ? [{ key: "CASH_DIFF", debit: -diff }, { account: cash.id, credit: -diff }] : [{ account: cash.id, debit: diff }, { key: "CASH_DIFF", credit: diff }],
    });
  }
  return t.insert("charity_day_closings", { companyId, date: d, totals: JSON.stringify({ byMethod: x.byMethod, bySource: x.bySource, total: x.total, count: x.rows.length }), expectedCash: x.expectedCash, countedCash: counted, difference: diff, notes: b.notes || null, closedBy: user });
}

// ─── archive (أرشيف الفواتير والمستندات) ────────────────────────────────────
export async function archive(t: Db, companyId: string, q: any) {
  const params: any[] = [companyId];
  const dateW = (col: string) => {
    let s = "";
    if (isDate(q.from)) { params.push(q.from); s += ` AND ${col} >= $${params.length}`; }
    if (isDate(q.to)) { params.push(q.to); s += ` AND ${col} <= $${params.length}`; }
    return s;
  };
  const parts: string[] = [];
  const want = (k: string) => !q.type || String(q.type).split(",").includes(k);
  if (want("INVOICE")) parts.push(`SELECT 'INVOICE' t, i.id, i.number, i.date, COALESCE(i.partner_name, pt.name, '—') party, i.total amount, i.status, i.kind sub, i.direction dir, i.created_at FROM invoices i LEFT JOIN partners pt ON pt.id=i.partner_id WHERE i.company_id=$1 AND i.number IS NOT NULL${dateW("i.date")}`);
  if (want("DONATION")) parts.push(`SELECT 'DONATION', r.id, r.number, r.date, r.payer_name, r.amount, r.status, r.source, r.method, r.created_at FROM charity_receipts r WHERE r.company_id=$1${dateW("r.date")}`);
  if (want("DISB")) parts.push(`SELECT 'DISB', d.id, d.number, d.date, d.beneficiary_name, d.amount, d.status, d.kind, d.capacity, d.created_at FROM charity_disbursements d WHERE d.company_id=$1${dateW("d.date")}`);
  if (want("REQUEST")) parts.push(`SELECT 'REQUEST', r.id, r.number, r.date, r.beneficiary_name, r.amount, r.status, r.method, NULL, r.created_at FROM charity_requests r WHERE r.company_id=$1${dateW("r.date")}`);
  if (want("PAYMENT")) parts.push(`SELECT 'PAYMENT', p.id, p.number, p.date, COALESCE(pt.name,'—'), p.amount, p.status, p.method, p.direction, p.created_at FROM payments p LEFT JOIN partners pt ON pt.id=p.partner_id WHERE p.company_id=$1${dateW("p.date")}`);
  if (want("EXPENSE")) parts.push(`SELECT 'EXPENSE', e.id, e.number, e.date, COALESCE(e.payee,'—'), e.total, e.status, NULL, NULL, e.created_at FROM expenses e WHERE e.company_id=$1${dateW("e.date")}`);
  if (want("CUSTODY")) parts.push(`SELECT 'CUSTODY', c.id, c.number, c.date, c.holder_name, COALESCE(c.disbursed_amount, c.amount), c.status, c.method, NULL, c.created_at FROM charity_custody c WHERE c.company_id=$1${dateW("c.date")}`);
  if (want("FORM")) parts.push(`SELECT 'FORM', f.id, f.number, f.date, f.party, f.amount, f.status, f.kind, NULL, f.created_at FROM charity_forms f WHERE f.company_id=$1${dateW("f.date")}`);
  if (want("INKIND")) parts.push(`SELECT 'INKIND', k.id, k.number, k.date, k.party_name, k.total, k.status, k.kind, NULL, k.created_at FROM charity_inkind_docs k WHERE k.company_id=$1${dateW("k.date")}`);
  if (!parts.length) return [];
  let where = "";
  if (q.q) { params.push(`%${String(q.q).trim()}%`); where += ` WHERE (x.number ILIKE $${params.length} OR x.party ILIKE $${params.length})`; }
  if (q.status) { params.push(q.status); where += `${where ? " AND" : " WHERE"} x.status=$${params.length}`; }
  return t.rows(`SELECT * FROM (${parts.join(" UNION ALL ")}) x${where} ORDER BY x.date DESC, x.created_at DESC LIMIT ${Math.min(Number(q.limit) || 1500, 5000)}`, params);
}

// ─── dashboard ─────────────────────────────────────────────────────────────
export async function dashboard(t: Db, companyId: string, q: any) {
  await ensureCharity(t, companyId);
  const to = isDate(q.to) ? q.to : today();
  const from = isDate(q.from) ? q.from : to.slice(0, 4) + "-01-01";
  const P = [companyId, from, to];
  const k = await t.one(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM charity_receipts WHERE company_id=$1 AND status='POSTED' AND date BETWEEN $2 AND $3),0) received,
       COALESCE((SELECT COUNT(*) FROM charity_receipts WHERE company_id=$1 AND status='POSTED' AND date BETWEEN $2 AND $3),0)::int receipts_count,
       COALESCE((SELECT SUM(amount) FROM charity_disbursements WHERE company_id=$1 AND status='POSTED' AND date BETWEEN $2 AND $3),0) spent,
       COALESCE((SELECT COUNT(*) FROM charity_disbursements WHERE company_id=$1 AND status='POSTED' AND date BETWEEN $2 AND $3),0)::int disb_count,
       COALESCE((SELECT SUM(amount) FROM charity_receipts WHERE company_id=$1 AND status='POSTED' AND date=$3),0) today_in,
       COALESCE((SELECT SUM(amount) FROM charity_receipts WHERE company_id=$1 AND status='POSTED' AND date >= date_trunc('month', $3::date)),0) month_in,
       (SELECT COUNT(*) FROM partners WHERE company_id=$1 AND is_donor)::int donors,
       (SELECT COUNT(*) FROM partners WHERE company_id=$1 AND is_beneficiary)::int beneficiaries,
       (SELECT COUNT(DISTINCT partner_id) FROM charity_disbursements WHERE company_id=$1 AND status='POSTED' AND date BETWEEN $2 AND $3)::int served,
       (SELECT COUNT(*) FROM charity_requests WHERE company_id=$1 AND status IN ('SUBMITTED','REVIEWED'))::int pending_requests,
       COALESCE((SELECT SUM(amount) FROM charity_requests WHERE company_id=$1 AND status IN ('SUBMITTED','REVIEWED')),0) pending_amount,
       (SELECT COUNT(*) FROM charity_requests WHERE company_id=$1 AND status='APPROVED')::int approved_unpaid,
       (SELECT COUNT(*) FROM charity_projects WHERE company_id=$1 AND status='ACTIVE')::int active_projects,
       COALESCE((SELECT SUM(disbursed_amount) FROM charity_custody WHERE company_id=$1 AND status='DISBURSED'),0) custody_open,
       (SELECT COUNT(*) FROM charity_custody WHERE company_id=$1 AND status='DISBURSED')::int custody_count,
       (SELECT COUNT(*) FROM charity_custody WHERE company_id=$1 AND status='DISBURSED' AND settle_due < CURRENT_DATE)::int custody_overdue,
       (SELECT COUNT(*) FROM charity_custody WHERE company_id=$1 AND status IN ('REQUESTED','REVIEWED'))::int custody_pending,
       (SELECT COUNT(*) FROM charity_forms WHERE company_id=$1 AND kind='PURCHASE' AND status IN ('SUBMITTED','REVIEWED'))::int purchases_pending,
       (SELECT COUNT(*) FROM charity_forms WHERE company_id=$1 AND kind='PURCHASE' AND status IN ('APPROVED','ORDERED'))::int purchases_open,
       (SELECT COUNT(*) FROM charity_forms WHERE company_id=$1 AND kind='REFUND' AND status IN ('SUBMITTED','REVIEWED','APPROVED'))::int refunds_pending,
       (SELECT COUNT(*) FROM charity_sponsorships WHERE company_id=$1 AND status='ACTIVE')::int sponsorships_active,
       COALESCE((SELECT SUM(amount/frequency) FROM charity_sponsorships WHERE company_id=$1 AND status='ACTIVE'),0) sponsorships_monthly,
       COALESCE((SELECT SUM(value) FROM charity_inkind_items WHERE company_id=$1),0) inkind_value,
       COALESCE((SELECT SUM(total) FROM charity_inkind_docs WHERE company_id=$1 AND kind='OUT' AND status='POSTED' AND date BETWEEN $2 AND $3),0) inkind_distributed,
       (SELECT COUNT(*) FROM charity_volunteers WHERE company_id=$1 AND status='ACTIVE')::int volunteers,
       COALESCE((SELECT SUM(hours) FROM charity_volunteer_hours WHERE company_id=$1 AND date BETWEEN $2 AND $3),0) volunteer_hours`, P);
  const cash = await t.rows(
    `SELECT a.id, a.code, a.name_ar, COALESCE(SUM(l.debit-l.credit),0) balance FROM accounts a LEFT JOIN journal_lines l ON l.account_id=a.id
       LEFT JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED'
     WHERE a.company_id=$1 AND a.is_cash_bank AND a.is_active AND (e.id IS NOT NULL OR l.id IS NULL) GROUP BY a.id ORDER BY a.code`, [companyId]);
  const bySource = await t.rows(`SELECT source k, SUM(amount) amount, COUNT(*)::int count FROM charity_receipts WHERE company_id=$1 AND status='POSTED' AND date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 2 DESC`, P);
  const byMethod = await t.rows(`SELECT method k, SUM(amount) amount FROM charity_receipts WHERE company_id=$1 AND status='POSTED' AND date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 2 DESC`, P);
  const byCapacity = await t.rows(`SELECT capacity k, SUM(amount) amount, COUNT(*)::int count FROM charity_disbursements WHERE company_id=$1 AND status='POSTED' AND date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 2 DESC`, P);
  const projects = (await listProjects(t, companyId)).filter((p: any) => p.status === "ACTIVE").slice(0, 8);
  const topDonors = await t.rows(`SELECT r.partner_id, MAX(r.payer_name) name, SUM(r.amount) amount, COUNT(*)::int count FROM charity_receipts r WHERE r.company_id=$1 AND r.status='POSTED' AND r.date BETWEEN $2 AND $3 GROUP BY r.partner_id, CASE WHEN r.partner_id IS NULL THEN r.payer_name END ORDER BY 3 DESC LIMIT 8`, P);
  const months = await t.rows(
    `SELECT to_char(m, 'YYYY-MM') ym,
       COALESCE((SELECT SUM(amount) FROM charity_receipts WHERE company_id=$1 AND status='POSTED' AND date_trunc('month', date)=m),0) received,
       COALESCE((SELECT SUM(amount) FROM charity_disbursements WHERE company_id=$1 AND status='POSTED' AND date_trunc('month', date)=m),0) spent
     FROM generate_series(date_trunc('month', $2::date) - interval '11 months', date_trunc('month', $2::date), interval '1 month') m ORDER BY m`, [companyId, to]);
  const pending = await t.rows(`SELECT id, number, date, beneficiary_name, purpose, amount, status FROM charity_requests WHERE company_id=$1 AND status IN ('SUBMITTED','REVIEWED','APPROVED') ORDER BY date LIMIT 8`, [companyId]);
  const b = await budget(t, companyId, Number(to.slice(0, 4)));
  return { from, to, kpis: { ...k, net: r2(D(k.received).minus(k.spent)) }, cash, cashTotal: r2(cash.reduce((a: number, c: any) => a + Number(c.balance), 0)), bySource, byMethod, byCapacity, projects, topDonors, months, pending, budget: { revenue: b.revenue, expense: b.expense } };
}

// ─── statement of activities (قائمة الأنشطة) ───────────────────────────────
export async function activities(t: Db, companyId: string, q: any) {
  const to = isDate(q.to) ? q.to : today();
  const from = isDate(q.from) ? q.from : to.slice(0, 4) + "-01-01";
  const rows = await t.rows(
    `SELECT a.code, a.name_ar, a.type, SUM(CASE WHEN a.type='REVENUE' THEN l.credit-l.debit ELSE l.debit-l.credit END) amount
     FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id
     WHERE e.company_id=$1 AND e.status='POSTED' AND e.type <> 'CLOSING' AND e.date BETWEEN $2 AND $3 AND a.type IN ('REVENUE','EXPENSE')
     GROUP BY a.code, a.name_ar, a.type HAVING SUM(l.debit-l.credit) <> 0 ORDER BY a.code`, [companyId, from, to]);
  const restricted = await t.one(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE restricted),0) restricted, COALESCE(SUM(amount) FILTER (WHERE NOT restricted),0) unrestricted FROM charity_receipts WHERE company_id=$1 AND status='POSTED' AND date BETWEEN $2 AND $3`, [companyId, from, to]);
  const rev = rows.filter((r: any) => r.type === "REVENUE").map((r: any) => ({ ...r, amount: r2(r.amount) }));
  const exp = rows.filter((r: any) => r.type === "EXPENSE").map((r: any) => ({ ...r, amount: r2(r.amount), group: r.code.startsWith("55") ? "PROGRAM" : r.code.startsWith("52") ? "ADMIN" : "OTHER" }));
  const sumR = r2(rev.reduce((a: number, r: any) => a + r.amount, 0));
  const sumE = r2(exp.reduce((a: number, r: any) => a + r.amount, 0));
  const prog = r2(exp.filter((e: any) => e.group === "PROGRAM").reduce((a: number, r: any) => a + r.amount, 0));
  const byProject = await t.rows(
    `SELECT p.code, p.name, p.restricted,
       COALESCE((SELECT SUM(amount) FROM charity_receipts r WHERE r.project_id=p.id AND r.status='POSTED' AND r.date BETWEEN $2 AND $3),0) received,
       COALESCE((SELECT SUM(amount) FROM charity_disbursements d WHERE d.project_id=p.id AND d.status='POSTED' AND d.date BETWEEN $2 AND $3),0) spent,
       COALESCE((SELECT SUM(amount) FROM charity_receipts r WHERE r.project_id=p.id AND r.status='POSTED' AND r.date <= $3),0)
         - COALESCE((SELECT SUM(amount) FROM charity_disbursements d WHERE d.project_id=p.id AND d.status='POSTED' AND d.date <= $3),0) balance
     FROM charity_projects p WHERE p.company_id=$1 ORDER BY p.code`, [companyId, from, to]);
  return { from, to, revenues: rev, expenses: exp, totalRevenue: sumR, totalExpense: sumE, net: r2(sumR - sumE), programRatio: sumE ? r2((prog / sumE) * 100) : 0, programExpense: prog, restricted: { restricted: r2(restricted.restricted), unrestricted: r2(restricted.unrestricted) }, byProject };
}
