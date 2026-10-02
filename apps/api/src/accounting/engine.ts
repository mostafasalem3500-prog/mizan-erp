/**
 * The posting engine — the ONLY writer of journal_entries / journal_lines.
 * Guarantees (enforced here and again by a deferred DB trigger):
 *   • debit == credit to the halala, at least two non-zero lines
 *   • only active, non-group accounts of the same company
 *   • the entry date falls in an OPEN period of an OPEN fiscal year
 *   • immutable once posted — corrections via reverse()
 */
import { Db } from "../db/pool";
import { AppError, bad, conflict, r2, D, AR_MONTHS, monthEnd } from "../lib/core";
import { SAUDI_COA, TYPE_BY_CLASS } from "./coa";
import { currentCtx } from "../lib/context";

export interface Line {
  account?: string; // account id
  key?: string; // system key (AR, VAT_OUT, …)
  debit?: number;
  credit?: number;
  partnerId?: string | null;
  costCenterId?: string | null;
  description?: string | null;
}

export interface PostInput {
  date: string;
  type: string;
  sourceType?: string;
  sourceId?: string;
  reference?: string | null;
  memo?: string | null;
  branchId?: string | null;
  lines: Line[];
  isDemo?: boolean;
  createdBy?: string;
  allowClosed?: boolean; // year-end closing entry
  status?: "POSTED" | "DRAFT";
}

// ─── sequences ─────────────────────────────────────────────────────────────
export async function nextNumber(t: Db, companyId: string, prefix: string, date: string, pad = 5): Promise<string> {
  const year = date.slice(0, 4);
  const key = `${prefix}-${year}`;
  const r = await t.one(
    `INSERT INTO sequences(company_id, key, next) VALUES ($1,$2,2)
     ON CONFLICT (company_id, key) DO UPDATE SET next = sequences.next + 1
     RETURNING next - 1 AS n`,
    [companyId, key],
  );
  return `${prefix}-${year}-${String(r.n).padStart(pad, "0")}`;
}

// ─── fiscal years & periods ────────────────────────────────────────────────
export async function ensureFiscalYear(t: Db, companyId: string, date: string) {
  const existing = await t.maybe(
    `SELECT * FROM fiscal_years WHERE company_id=$1 AND $2::date BETWEEN start_date AND end_date`,
    [companyId, date],
  );
  if (existing) return existing;
  const company = await t.one(`SELECT fiscal_year_start FROM companies WHERE id=$1`, [companyId]);
  const startMonth = company.fiscalYearStart || 1;
  let y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (m < startMonth) y -= 1;
  const start = `${y}-${String(startMonth).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(y + 1, startMonth - 1, 1));
  endDate.setUTCDate(0);
  const end = endDate.toISOString().slice(0, 10);
  const name = startMonth === 1 ? String(y) : `${y}/${y + 1}`;
  const fy = await t.insert("fiscal_years", { companyId, name, startDate: start, endDate: end });
  for (let i = 0; i < 12; i++) {
    const ms = new Date(Date.UTC(y, startMonth - 1 + i, 1)).toISOString().slice(0, 10);
    await t.insert("periods", {
      fiscalYearId: fy.id,
      companyId,
      name: `${AR_MONTHS[Number(ms.slice(5, 7)) - 1]} ${ms.slice(0, 4)}`,
      startDate: ms,
      endDate: monthEnd(ms),
    });
  }
  return fy;
}

export async function assertOpenDate(t: Db, companyId: string, date: string, allowClosedYear = false) {
  const fy = await ensureFiscalYear(t, companyId, date);
  if (fy.status !== "OPEN" && !allowClosedYear)
    throw new AppError(409, `السنة المالية ${fy.name} مقفلة — لا يمكن الترحيل بتاريخ ${date}`, "PERIOD_CLOSED");
  const p = await t.maybe(`SELECT * FROM periods WHERE company_id=$1 AND $2::date BETWEEN start_date AND end_date`, [companyId, date]);
  if (p && p.status !== "OPEN" && !allowClosedYear)
    throw new AppError(409, `الفترة المحاسبية (${p.name}) مقفلة — لا يمكن الترحيل بتاريخ ${date}`, "PERIOD_CLOSED");
  return fy;
}

// ─── account resolution ────────────────────────────────────────────────────
export async function accountByKey(t: Db, companyId: string, key: string) {
  const a = await t.maybe(`SELECT * FROM accounts WHERE company_id=$1 AND system_key=$2`, [companyId, key]);
  if (!a) throw bad(`الحساب الافتراضي (${key}) غير معرف في دليل الحسابات`);
  return a;
}

// ─── branches ──────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEAD_OFFICE_TYPES = new Set(["CLOSING", "VAT_SETTLEMENT"]);

export async function mainBranchId(t: Db, companyId: string): Promise<string> {
  const b = await t.maybe(`SELECT id FROM branches WHERE company_id=$1 ORDER BY is_main DESC, code LIMIT 1`, [companyId]);
  if (b) return b.id;
  const nb = await t.insert("branches", { companyId, code: "MAIN", name: "الفرع الرئيسي", isMain: true });
  return nb.id;
}

/**
 * Branch of a document / entry: explicit value → the branch chosen on the request → the user's home branch → main branch.
 * Any id that does not belong to the company (or is inactive) is ignored rather than trusted.
 */
export async function resolveBranch(t: Db, companyId: string, explicit?: string | null): Promise<string> {
  const ctx = currentCtx();
  if (ctx.lockedBranchId) {
    if (explicit && explicit !== ctx.lockedBranchId) throw new AppError(403, "لا يمكنك التسجيل على فرع آخر — صلاحيتك مقيدة بفرعك", "BRANCH_SCOPE");
    return ctx.lockedBranchId;
  }
  for (const id of [explicit, ctx.bodyBranchId, ctx.userBranchId]) {
    if (!id || !UUID_RE.test(id)) continue;
    const b = await t.maybe(`SELECT id FROM branches WHERE id=$1 AND company_id=$2 AND is_active`, [id, companyId]);
    if (b) return b.id;
  }
  return mainBranchId(t, companyId);
}

/** Branch that owns a warehouse (falls back to the request/user/main branch). */
export async function warehouseBranch(t: Db, companyId: string, warehouseId?: string | null): Promise<string> {
  if (warehouseId) {
    const w = await t.maybe(`SELECT branch_id FROM warehouses WHERE id=$1 AND company_id=$2`, [warehouseId, companyId]);
    const locked = currentCtx().lockedBranchId;
    if (locked && w && w.branchId !== locked) throw new AppError(403, "هذا المستودع تابع لفرع آخر — صلاحيتك مقيدة بفرعك", "BRANCH_SCOPE");
    if (w?.branchId) return w.branchId;
  }
  return resolveBranch(t, companyId);
}

// ─── posting ───────────────────────────────────────────────────────────────
export async function post(t: Db, companyId: string, input: PostInput) {
  if (!input.date) throw bad("تاريخ القيد مطلوب");
  const status = input.status || "POSTED";
  if (status === "POSTED") await assertOpenDate(t, companyId, input.date, input.allowClosed);

  // resolve keys → ids
  const keys = [...new Set(input.lines.filter((l) => l.key && !l.account).map((l) => l.key!))];
  const byKey: Record<string, string> = {};
  if (keys.length) {
    const rows = await t.rows(`SELECT id, system_key FROM accounts WHERE company_id=$1 AND system_key = ANY($2)`, [companyId, keys]);
    for (const r of rows) byKey[r.systemKey] = r.id;
    for (const k of keys) if (!byKey[k]) throw bad(`الحساب الافتراضي (${k}) غير معرف في دليل الحسابات`);
  }
  const lines = input.lines
    .map((l) => ({
      accountId: l.account || byKey[l.key!],
      debit: r2(l.debit || 0),
      credit: r2(l.credit || 0),
      partnerId: l.partnerId || null,
      costCenterId: l.costCenterId || null,
      description: l.description || null,
    }))
    .map((l) => {
      // normalise negatives onto the opposite side
      if (l.debit < 0) [l.debit, l.credit] = [0, r2(l.credit - l.debit)];
      if (l.credit < 0) [l.credit, l.debit] = [0, r2(l.debit - l.credit)];
      return l;
    })
    .filter((l) => l.debit !== 0 || l.credit !== 0);

  if (!lines.length) return null; // nothing to post (e.g. zero-value document)
  if (lines.some((l) => !l.accountId)) throw bad("كل سطر في القيد يحتاج حساباً");
  const td = lines.reduce((a, l) => a.plus(l.debit), D(0));
  const tc = lines.reduce((a, l) => a.plus(l.credit), D(0));
  if (!td.equals(tc)) throw bad(`القيد غير متوازن: مدين ${td.toFixed(2)} ≠ دائن ${tc.toFixed(2)}`);
  if (lines.length < 2) throw bad("القيد يحتاج سطرين على الأقل");

  const ids = [...new Set(lines.map((l) => l.accountId))];
  const accs = await t.rows(`SELECT id, is_group, is_active, code, name_ar FROM accounts WHERE company_id=$1 AND id = ANY($2)`, [companyId, ids]);
  if (accs.length !== ids.length) throw bad("أحد الحسابات غير موجود في دليل حسابات المنشأة");
  const grp = accs.find((a) => a.isGroup || !a.isActive);
  if (grp) throw bad(`لا يمكن الترحيل على الحساب ${grp.code} ${grp.nameAr} (حساب رئيسي أو موقوف)`);

  const number = await nextNumber(t, companyId, "JV", input.date);
  const entry = await t.insert("journal_entries", {
    companyId,
    number,
    date: input.date,
    type: input.type,
    status,
    sourceType: input.sourceType || null,
    sourceId: input.sourceId || null,
    reference: input.reference || null,
    memo: input.memo || null,
    branchId: !input.branchId && HEAD_OFFICE_TYPES.has(input.type) ? await mainBranchId(t, companyId) : await resolveBranch(t, companyId, input.branchId),
    totalDebit: td.toFixed(2),
    isDemo: !!input.isDemo,
    createdBy: input.createdBy || null,
    postedAt: status === "POSTED" ? new Date() : null,
  });
  await t.insertMany(
    "journal_lines",
    lines.map((l, i) => ({ entryId: entry.id, companyId, ...l, sort: i })),
  );
  return entry;
}

/** Creates the mirror entry and links both. */
export async function reverse(t: Db, companyId: string, entryId: string, date: string, memo: string, createdBy?: string) {
  const e = await t.one(`SELECT * FROM journal_entries WHERE id=$1 AND company_id=$2 FOR UPDATE`, [entryId, companyId], "القيد غير موجود");
  if (e.status !== "POSTED") throw conflict("لا يمكن عكس قيد غير مرحل");
  if (e.reversedBy) throw conflict(`القيد ${e.number} معكوس مسبقاً`);
  if (e.type === "CLOSING") throw conflict("قيد الإقفال يُلغى من شاشة إقفال السنة المالية");
  const lines = await t.rows(`SELECT * FROM journal_lines WHERE entry_id=$1 ORDER BY sort`, [entryId]);
  const rev = await post(t, companyId, {
    date,
    type: "REVERSAL",
    sourceType: e.sourceType,
    sourceId: e.sourceId,
    reference: e.number,
    branchId: e.branchId,
    memo: memo || `عكس القيد ${e.number}`,
    isDemo: e.isDemo,
    createdBy,
    lines: lines.map((l) => ({ account: l.accountId, debit: l.credit, credit: l.debit, partnerId: l.partnerId, costCenterId: l.costCenterId, description: l.description })),
  });
  await t.exec(`UPDATE journal_entries SET reversed_by=$1 WHERE id=$2`, [rev!.id, entryId]);
  await t.exec(`UPDATE journal_entries SET reversal_of=$1 WHERE id=$2`, [entryId, rev!.id]);
  return rev;
}

// ─── company bootstrap ─────────────────────────────────────────────────────
export async function seedChartOfAccounts(t: Db, companyId: string) {
  const idByCode: Record<string, string> = {};
  const codes = SAUDI_COA.map((r) => r[0]);
  for (const [code, nameAr, nameEn, subtype, opts] of SAUDI_COA) {
    const parentCode = code.length === 1 ? null : code.length === 2 ? code[0] : code.slice(0, code.length - 2);
    const isGroup = codes.some((c) => c !== code && c.startsWith(code) && c.length > code.length);
    const level = code.length === 1 ? 1 : code.length === 2 ? 2 : code.length === 4 ? 3 : 4;
    const a = await t.insert("accounts", {
      companyId,
      code,
      nameAr,
      nameEn,
      type: TYPE_BY_CLASS[code[0]],
      subtype,
      parentId: parentCode ? idByCode[parentCode] : null,
      level,
      isGroup,
      isSystem: !!opts?.key || level <= 2,
      systemKey: opts?.key || null,
      isCashBank: !!opts?.cash,
    });
    idByCode[code] = a.id;
  }
  return idByCode;
}
