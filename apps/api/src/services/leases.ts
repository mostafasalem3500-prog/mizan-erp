/**
 * Leases as a lessee — IFRS 16 (endorsed by SOCPA in Saudi Arabia) / Egyptian Accounting Standard 49.
 *
 * At commencement the present value of the lease payments, discounted at the incremental borrowing rate, is a lease
 * liability; the right-of-use asset is that amount plus initial direct costs:
 *     Dr right-of-use asset / Cr lease liability (+ Cr bank for direct costs)
 * Every month end:   Dr right-of-use depreciation / Cr accumulated depreciation   (straight line over the term)
 *                    Dr interest on lease liabilities / Cr lease liability        (effective interest)
 * Every payment:     Dr lease liability (+ Dr input VAT) / Cr bank
 * Payments fall at the start (in advance) or the end (in arrears) of each payment period of 1, 3, 6 or 12 months.
 * Leases of 12 months or less use the short-term exemption: the payments are an expense (or a prepaid schedule).
 */
import { Db } from "../db/pool";
import { bad, conflict, isDate, today, addMonths, r2, num } from "../lib/core";
import { post, nextNumber, reverse } from "../accounting/engine";
import { IS_EG } from "../lib/country";

/**
 * Reporting framework of a Saudi establishment: IFRS for SMEs (default — Section 20 keeps operating leases as an
 * expense) or full IFRS (IFRS 16 right-of-use model). Egypt: Egyptian Accounting Standards (EAS 49 applies).
 */
export async function framework(t: Db, C: string): Promise<"EAS" | "IFRS" | "IFRS_SMES"> {
  if (IS_EG) return "EAS";
  const r = await t.one(`SELECT accounting->>'framework' f FROM companies WHERE id=$1`, [C]);
  return r.f === "IFRS" ? "IFRS" : "IFRS_SMES";
}
export async function setFramework(t: Db, C: string, f: string) {
  if (IS_EG) throw bad("النسخة المصرية تطبق معايير المحاسبة المصرية");
  if (!["IFRS", "IFRS_SMES"].includes(f)) throw bad("اختر الإطار: IFRS الكاملة أو IFRS للمنشآت الصغيرة والمتوسطة");
  await t.exec(`UPDATE companies SET accounting = jsonb_set(COALESCE(accounting,'{}'::jsonb), '{framework}', to_jsonb($2::text)) WHERE id=$1`, [C, f]);
  return { framework: f };
}

const FREQ = [1, 3, 6, 12];
const iso = (d: any) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
const addDays = (d: string, n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export interface LeaseTerms { startDate: string; months: number; payment: number; frequency: number; timing: "ADVANCE" | "ARREARS"; annualRate: number; directCosts: number }

/** Payment k (0-based) falls `offset` months after commencement. */
const offsetOf = (k: number, f: number, timing: string) => (timing === "ADVANCE" ? k * f : (k + 1) * f);

/** The whole schedule: present value, right-of-use cost, and month by month interest, payments, depreciation. */
export function leaseSchedule(x: LeaseTerms) {
  const i = Math.pow(1 + x.annualRate / 100, 1 / 12) - 1;
  const P = x.months / x.frequency;
  const pays = Array.from({ length: P }, (_, k) => ({ n: k + 1, offset: offsetOf(k, x.frequency, x.timing), amount: x.payment }));
  const pv = r2(pays.reduce((s, p) => s + p.amount / Math.pow(1 + i, p.offset), 0));
  const rou = r2(pv + x.directCosts);
  const dep = r2(rou / x.months);
  let L = pv, depDone = 0, intTotal = 0;
  const months: any[] = [];
  for (let m = 1; m <= x.months; m++) {
    const end = addDays(addMonths(x.startDate, m), -1); // the lease month ends the day before its anniversary
    const opening = L;
    const adv = x.timing === "ADVANCE";
    const startPay = adv ? pays.filter((p) => p.offset === m - 1).reduce((s, p) => s + p.amount, 0) : 0; // in advance: at the start of the month
    const base = opening - startPay;
    let interest = r2(base * i);
    const endPay = adv ? 0 : pays.filter((p) => p.offset === m).reduce((s, p) => s + p.amount, 0); // in arrears: at the end of the month
    let closing = r2(base + interest - endPay);
    if (m === x.months) { interest = r2(interest - closing); closing = 0; } // the rounding of the whole term lands in the last month
    const d = m === x.months ? r2(rou - depDone) : dep;
    depDone = r2(depDone + d); intTotal = r2(intTotal + interest);
    months.push({ n: m, periodEnd: end, opening: r2(opening), payments: r2(startPay + endPay), interest, closing, depreciation: d, nbv: r2(rou - depDone) });
    L = closing;
  }
  const due = pays.map((p) => ({ n: p.n, date: addMonths(x.startDate, p.offset), amount: p.amount }));
  return { monthlyRate: i, pv, rou, depreciation: dep, totalPayments: r2(x.payment * P), totalInterest: intTotal, payments: due, months };
}

function terms(b: any): LeaseTerms {
  if (!isDate(b.startDate)) throw bad("تاريخ بداية العقد غير صحيح");
  const months = Math.trunc(num(b.months)), payment = r2(num(b.payment)), frequency = Math.trunc(num(b.frequency || 1)), annualRate = num(b.annualRate), directCosts = r2(num(b.directCosts || 0));
  if (months >= 1 && months <= 12) throw bad("عقد مدته 12 شهراً أو أقل: يُعامل كمصروف إيجار (إعفاء العقود قصيرة الأجل في المعيار) — سجّله كمصروف أو كجدول مدفوع مقدماً");
  if (!(months >= 13 && months <= 600)) throw bad("مدة العقد بين 13 و600 شهر");
  if (!(payment > 0)) throw bad("قيمة الدفعة يجب أن تكون أكبر من صفر");
  if (!FREQ.includes(frequency)) throw bad("دورية السداد: شهري أو ربع سنوي أو نصف سنوي أو سنوي");
  if (months % frequency) throw bad(`مدة العقد (${months} شهراً) يجب أن تقبل القسمة على دورية السداد (${frequency})`);
  if (!(annualRate >= 0 && annualRate < 100)) throw bad("معدل الخصم السنوي بين 0 و100%");
  if (directCosts < 0) throw bad("التكاليف المباشرة لا تكون سالبة");
  return { startDate: b.startDate, months, payment, frequency, timing: b.timing === "ARREARS" ? "ARREARS" : "ADVANCE", annualRate, directCosts };
}

async function keys(t: Db, C: string) {
  const rows = await t.rows(`SELECT id, code, name_ar, system_key FROM accounts WHERE company_id=$1 AND system_key IN ('ROU_ASSET','ROU_ACC_DEP','LEASE_LIABILITY','ROU_DEPRECIATION','LEASE_INTEREST','VAT_IN','OTHER_INCOME')`, [C]);
  const k: Record<string, any> = Object.fromEntries(rows.map((r) => [r.systemKey, r]));
  for (const x of ["ROU_ASSET", "ROU_ACC_DEP", "LEASE_LIABILITY", "ROU_DEPRECIATION", "LEASE_INTEREST"]) if (!k[x]) throw bad("حسابات عقود الإيجار غير موجودة في الدليل");
  k.LOSS = await t.maybe(`SELECT id FROM accounts WHERE company_id=$1 AND code='5403' AND NOT is_group`, [C]);
  return k;
}
async function cashAccount(t: Db, C: string, id: string | null | undefined, what: string) {
  if (!id) throw bad(`${what} مطلوب`);
  const a = await t.maybe(`SELECT id, is_cash_bank, is_group, is_active FROM accounts WHERE id=$1 AND company_id=$2`, [id, C]);
  if (!a || !a.isCashBank || a.isGroup || !a.isActive) throw bad(`${what}: اختر صندوقاً أو حساباً بنكياً`);
  return a;
}

export function previewLease(b: any) {
  const x = terms(b);
  const s = leaseSchedule(x);
  const first12 = s.months.slice(0, 12);
  return { ...x, pv: s.pv, rou: s.rou, depreciation: s.depreciation, totalPayments: s.totalPayments, totalInterest: s.totalInterest, firstYear: { interest: r2(first12.reduce((a, m) => a + m.interest, 0)), depreciation: r2(first12.reduce((a, m) => a + m.depreciation, 0)) }, payments: s.payments.length };
}

export async function createLease(t: Db, C: string, user: string, b: any) {
  if ((await framework(t, C)) === "IFRS_SMES") throw bad("المنشأة مضبوطة على IFRS للمنشآت الصغيرة والمتوسطة: عقد الإيجار التشغيلي يُسجَّل مصروفاً بالقسط الثابت (القسم 20). نموذج حق الاستخدام لمن يطبق IFRS 16 الكاملة — غيّر الإطار أولاً إن كانت منشأتك تطبقها");
  const x = terms(b);
  const name = String(b.name || "").trim().slice(0, 200);
  if (!name) throw bad("اكتب وصف العقد (مثال: إيجار المعرض الرئيسي 5 سنوات)");
  const k = await keys(t, C);
  const s = leaseSchedule(x);
  if (b.partnerId && !(await t.maybe(`SELECT 1 FROM partners WHERE id=$1 AND company_id=$2`, [b.partnerId, C]))) throw bad("المؤجر غير موجود");
  if (b.costCenterId && !(await t.maybe(`SELECT 1 FROM cost_centers WHERE id=$1 AND company_id=$2`, [b.costCenterId, C]))) throw bad("مركز التكلفة غير موجود");
  const pay = b.payAccountId ? await cashAccount(t, C, b.payAccountId, "حساب السداد") : null;
  if (x.directCosts > 0 && !pay) throw bad("التكاليف المباشرة الأولية تُدفع من صندوق أو بنك — اختر حساب السداد");
  const number = await nextNumber(t, C, "LSE", x.startDate);
  const memo = `بداية عقد إيجار ${number} — ${name}`;
  const lines: any[] = [{ account: k.ROU_ASSET.id, debit: s.rou, description: memo, costCenterId: b.costCenterId || null }, { account: k.LEASE_LIABILITY.id, credit: s.pv, description: memo, partnerId: b.partnerId || null }];
  if (x.directCosts > 0) lines.push({ account: pay!.id, credit: x.directCosts, description: `تكاليف مباشرة أولية — ${name}` });
  const e = await post(t, C, { date: x.startDate, type: "LEASE", sourceType: "LEASE", reference: number, memo, branchId: b.branchId || null, isDemo: !!b.isDemo, createdBy: user, lines });
  const row = await t.insert("leases", {
    companyId: C, number, name, partnerId: b.partnerId || null, startDate: x.startDate, months: x.months, payment: x.payment, frequency: x.frequency, timing: x.timing,
    annualRate: x.annualRate, directCosts: x.directCosts, liability0: s.pv, rouCost: s.rou, payAccountId: pay?.id || null, costCenterId: b.costCenterId || null,
    branchId: b.branchId || null, auto: b.auto !== false, startEntryId: e!.id, notes: b.notes || null, isDemo: !!b.isDemo, createdBy: user,
  });
  await t.exec(`UPDATE journal_entries SET source_id=$2 WHERE id=$1`, [e!.id, row.id]);
  return { ...row, startEntryNumber: e!.number, pv: s.pv, rou: s.rou };
}

/** Book figures of a lease from what has been posted: liability, accumulated depreciation, next items due. */
async function figures(t: Db, l: any) {
  const p = await t.one(`SELECT COALESCE(SUM(interest),0) i, COALESCE(SUM(depreciation),0) d, COALESCE(SUM(payment),0) p, COUNT(*) FILTER (WHERE kind='PAYMENT')::int np FROM lease_posts WHERE lease_id=$1`, [l.id]);
  const liability = r2(Number(l.liability0) + Number(p.i) - Number(p.p)), accDep = r2(Number(p.d));
  return { liability, accDep, nbv: r2(Number(l.rouCost) - accDep), interestPosted: r2(Number(p.i)), paid: r2(Number(p.p)), paymentsRecorded: p.np };
}
const termsOf = (l: any): LeaseTerms => ({ startDate: iso(l.startDate), months: l.months, payment: Number(l.payment), frequency: l.frequency, timing: l.timing, annualRate: Number(l.annualRate), directCosts: Number(l.directCosts) });

export async function listLeases(t: Db, C: string) {
  const rows = await t.rows(`SELECT l.*, p.name partner_name FROM leases l LEFT JOIN partners p ON p.id=l.partner_id WHERE l.company_id=$1 ORDER BY l.status, l.start_date DESC`, [C]);
  const td = today();
  const out: any[] = [];
  for (const l of rows) {
    const f = await figures(t, l), s = leaseSchedule(termsOf(l));
    const dueMonths = l.status === "ACTIVE" ? s.months.filter((m) => m.n > l.postedMonths && m.periodEnd <= td).length : 0;
    const duePayments = l.status === "ACTIVE" ? s.payments.filter((p) => p.n > f.paymentsRecorded && p.date <= td) : [];
    out.push({ ...l, startDate: iso(l.startDate), endDate: addDays(addMonths(iso(l.startDate), l.months), -1), ...f, dueMonths, duePayments: duePayments.length, dueAmount: r2(duePayments.reduce((a, p) => a + p.amount, 0)), nextPayment: s.payments.find((p) => p.n > f.paymentsRecorded) || null });
  }
  const active = out.filter((l: any) => l.status === "ACTIVE");
  return { rows: out, totals: { liability: r2(active.reduce((a: number, l: any) => a + l.liability, 0)), nbv: r2(active.reduce((a: number, l: any) => a + l.nbv, 0)), dueMonths: active.reduce((a: number, l: any) => a + l.dueMonths, 0), duePayments: active.reduce((a: number, l: any) => a + l.duePayments, 0) } };
}

export async function getLease(t: Db, C: string, id: string) {
  const l = await t.maybe(`SELECT l.*, p.name partner_name FROM leases l LEFT JOIN partners p ON p.id=l.partner_id WHERE l.company_id=$1 AND l.id=$2`, [C, id]);
  if (!l) throw bad("العقد غير موجود");
  const s = leaseSchedule(termsOf(l));
  const posts = await t.rows(`SELECT lp.kind, lp.n, lp.date, lp.payment, lp.vat, e.id entry_id, e.number FROM lease_posts lp JOIN journal_entries e ON e.id=lp.entry_id WHERE lp.lease_id=$1`, [id]);
  const pm = new Map(posts.map((p: any) => [`${p.kind}${p.n}`, p]));
  const f = await figures(t, l);
  const start = await t.maybe(`SELECT id, number FROM journal_entries WHERE id=$1`, [l.startEntryId]);
  return {
    ...l, startDate: iso(l.startDate), endDate: addDays(addMonths(iso(l.startDate), l.months), -1), ...f, startEntry: start, pv: Number(l.liability0), rou: Number(l.rouCost),
    totalPayments: s.totalPayments, totalInterest: s.totalInterest, monthlyRate: s.monthlyRate,
    months: s.months.map((m) => { const p: any = pm.get(`MONTH${m.n}`); return { ...m, posted: !!p, entryId: p?.entryId || null, entryNumber: p?.number || null }; }),
    payments: s.payments.map((x) => { const p: any = pm.get(`PAYMENT${x.n}`); return { ...x, paid: !!p, paidOn: p ? iso(p.date) : null, vat: p ? Number(p.vat) : 0, entryId: p?.entryId || null, entryNumber: p?.number || null }; }),
  };
}

/** Posts every month that has ended up to `through`: depreciation and interest, one entry a month. */
export async function runLeases(t: Db, C: string, user: string, through = today(), onlyId?: string, opts: { autoOnly?: boolean } = {}) {
  if (!isDate(through)) throw bad("التاريخ غير صحيح");
  const list = await t.rows(`SELECT * FROM leases WHERE company_id=$1 AND status='ACTIVE'${onlyId ? " AND id=$2" : ""}${opts.autoOnly ? " AND auto" : ""} ORDER BY start_date FOR UPDATE`, onlyId ? [C, onlyId] : [C]);
  if (!list.length) return [];
  const k = await keys(t, C);
  const done: any[] = [];
  for (const l of list) {
    const s = leaseSchedule(termsOf(l));
    let posted = l.postedMonths;
    for (const m of s.months.slice(posted)) {
      if (m.periodEnd > through) break;
      const memo = `${l.number} ${l.name} — ${m.periodEnd.slice(0, 7)} (${m.n}/${l.months})`;
      const lines: any[] = [
        { account: k.ROU_DEPRECIATION.id, debit: m.depreciation, costCenterId: l.costCenterId || null, description: `إهلاك حق الاستخدام — ${memo}` }, { account: k.ROU_ACC_DEP.id, credit: m.depreciation, description: `إهلاك حق الاستخدام — ${memo}` },
      ];
      if (m.interest > 0) lines.push({ account: k.LEASE_INTEREST.id, debit: m.interest, costCenterId: l.costCenterId || null, description: `فائدة التزام الإيجار — ${memo}` }, { account: k.LEASE_LIABILITY.id, credit: m.interest, partnerId: l.partnerId || null, description: `فائدة التزام الإيجار — ${memo}` });
      else if (m.interest < 0) lines.push({ account: k.LEASE_LIABILITY.id, debit: -m.interest, partnerId: l.partnerId || null, description: `فرق تقريب الفائدة — ${memo}` }, { account: k.LEASE_INTEREST.id, credit: -m.interest, description: `فرق تقريب الفائدة — ${memo}` });
      // last month: the fully depreciated asset leaves the books (cost against accumulated depreciation)
      if (m.n === l.months) lines.push({ account: k.ROU_ACC_DEP.id, debit: Number(l.rouCost), description: `انتهاء العقد ${l.number} — استبعاد أصل حق الاستخدام المستهلك` }, { account: k.ROU_ASSET.id, credit: Number(l.rouCost), description: `انتهاء العقد ${l.number} — استبعاد أصل حق الاستخدام المستهلك` });
      const e = await post(t, C, { date: m.periodEnd, type: "LEASE", sourceType: "LEASE", sourceId: l.id, reference: l.number, memo: `عقد إيجار: ${memo}`, branchId: l.branchId || null, isDemo: l.isDemo, createdBy: user, lines });
      await t.insert("lease_posts", { companyId: C, leaseId: l.id, kind: "MONTH", n: m.n, date: m.periodEnd, interest: m.interest, depreciation: m.depreciation, entryId: e!.id });
      posted++;
      done.push({ number: l.number, name: l.name, period: m.periodEnd, depreciation: m.depreciation, interest: m.interest, entry: e!.number });
    }
    if (posted !== l.postedMonths) await t.exec(`UPDATE leases SET posted_months=$2 WHERE id=$1`, [l.id, posted]);
    await settleIfDone(t, l.id);
  }
  return done;
}

/** A lease is over when every month is posted and every payment recorded. */
async function settleIfDone(t: Db, id: string) {
  const l = await t.one(`SELECT * FROM leases WHERE id=$1`, [id]);
  const np = await t.one(`SELECT COUNT(*)::int c FROM lease_posts WHERE lease_id=$1 AND kind='PAYMENT'`, [id]);
  if (l.status === "ACTIVE" && l.postedMonths >= l.months && np.c >= l.months / l.frequency) await t.exec(`UPDATE leases SET status='ENDED', ended_on=$2 WHERE id=$1`, [id, addDays(addMonths(iso(l.startDate), l.months), -1)]);
}

/** Records the next unpaid lease payment (the amount of the contract, plus input VAT when invoiced with VAT). */
export async function payLease(t: Db, C: string, user: string, id: string, b: any) {
  const l = await t.maybe(`SELECT * FROM leases WHERE company_id=$1 AND id=$2 FOR UPDATE`, [C, id]);
  if (!l) throw bad("العقد غير موجود");
  if (l.status !== "ACTIVE") throw bad("العقد منتهٍ");
  const s = leaseSchedule(termsOf(l));
  const n = (await t.one(`SELECT COUNT(*)::int c FROM lease_posts WHERE lease_id=$1 AND kind='PAYMENT'`, [id])).c + 1;
  const due = s.payments.find((p) => p.n === n);
  if (!due) throw bad("كل دفعات العقد مسجّلة");
  const date = isDate(b?.date) ? b.date : due.date;
  if (date < iso(l.startDate)) throw bad("تاريخ السداد قبل بداية العقد");
  const acc = await cashAccount(t, C, b?.payAccountId || l.payAccountId, "حساب السداد");
  const vat = r2(num(b?.vat || 0));
  if (vat < 0) throw bad("الضريبة لا تكون سالبة");
  const k = await keys(t, C);
  if (vat > 0 && !k.VAT_IN) throw bad("حساب ضريبة المدخلات غير موجود");
  const memo = `دفعة ${n}/${s.payments.length} لعقد الإيجار ${l.number} — ${l.name} (مستحقة ${due.date})`;
  const lines: any[] = [{ account: k.LEASE_LIABILITY.id, debit: due.amount, partnerId: l.partnerId || null, description: memo }];
  if (vat > 0) lines.push({ account: k.VAT_IN.id, debit: vat, description: `ضريبة مدخلات — ${memo}` });
  lines.push({ account: acc.id, credit: r2(due.amount + vat), partnerId: l.partnerId || null, description: memo });
  const e = await post(t, C, { date, type: "LEASE", sourceType: "LEASE", sourceId: l.id, reference: l.number, memo, branchId: l.branchId || null, isDemo: l.isDemo, createdBy: user, lines });
  await t.insert("lease_posts", { companyId: C, leaseId: id, kind: "PAYMENT", n, date, payment: due.amount, vat, entryId: e!.id });
  await settleIfDone(t, id);
  return { n, amount: due.amount, vat, entryId: e!.id, entryNumber: e!.number };
}

/**
 * Early termination at a month end: the months up to that date are posted first, then the right-of-use asset and the
 * liability leave the books; the difference is a gain (other income) or a loss.
 */
export async function terminateLease(t: Db, C: string, user: string, id: string, b: any) {
  const l = await t.maybe(`SELECT * FROM leases WHERE company_id=$1 AND id=$2 FOR UPDATE`, [C, id]);
  if (!l) throw bad("العقد غير موجود");
  if (l.status !== "ACTIVE") throw bad("العقد منتهٍ");
  const date = isDate(b?.date) ? b.date : today();
  if (date < iso(l.startDate)) throw bad("تاريخ الإنهاء قبل بداية العقد");
  const s = leaseSchedule(termsOf(l));
  const lastMonth = [...s.months].reverse().find((m) => m.periodEnd <= date);
  if (!lastMonth) throw bad("أنهِ العقد في نهاية شهر بعد الشهر الأول، أو احذفه إن لم يبدأ");
  if (lastMonth.n >= l.months) throw bad("العقد بلغ نهايته — لا يلزم إنهاء مبكر");
  await runLeases(t, C, user, lastMonth.periodEnd, id);
  // payments that fell due up to the termination date stay owed to the lessor: they are recorded first
  const np = (await t.one(`SELECT COUNT(*)::int c FROM lease_posts WHERE lease_id=$1 AND kind='PAYMENT'`, [id])).c;
  const unpaid = s.payments.filter((p) => p.n > np && p.date <= lastMonth.periodEnd);
  if (unpaid.length) throw bad(`سجّل الدفعات المستحقة حتى ${lastMonth.periodEnd} أولاً (${unpaid.length}) — تبقى ديناً للمؤجر ولا تُلغى بإنهاء العقد`);
  const f = await figures(t, l);
  const k = await keys(t, C);
  const end = lastMonth.periodEnd;
  const gain = r2(f.liability - f.nbv); // liability released minus carrying amount of the asset
  const memo = `إنهاء مبكر لعقد الإيجار ${l.number} — ${l.name} في ${end}`;
  const lines: any[] = [];
  if (f.liability) lines.push({ account: k.LEASE_LIABILITY.id, debit: f.liability, partnerId: l.partnerId || null, description: memo });
  if (f.accDep) lines.push({ account: k.ROU_ACC_DEP.id, debit: f.accDep, description: memo });
  lines.push({ account: k.ROU_ASSET.id, credit: Number(l.rouCost), description: memo });
  if (gain > 0) lines.push({ account: (k.OTHER_INCOME || k.LEASE_INTEREST).id, credit: gain, description: `ربح إنهاء عقد الإيجار ${l.number}` });
  if (gain < 0) lines.push({ account: (k.LOSS || k.LEASE_INTEREST).id, debit: -gain, description: `خسارة إنهاء عقد الإيجار ${l.number}` });
  const e = await post(t, C, { date: end, type: "LEASE", sourceType: "LEASE", sourceId: l.id, reference: l.number, memo, branchId: l.branchId || null, isDemo: l.isDemo, createdBy: user, lines });
  await t.exec(`UPDATE leases SET status='TERMINATED', ended_on=$2, end_entry_id=$3 WHERE id=$1`, [id, end, e!.id]);
  return { date: end, liability: f.liability, nbv: f.nbv, gain, entryId: e!.id, entryNumber: e!.number };
}

/** A lease with nothing posted after commencement can be deleted: its opening entry is reversed. */
export async function deleteLease(t: Db, C: string, user: string, id: string) {
  const l = await t.maybe(`SELECT * FROM leases WHERE company_id=$1 AND id=$2 FOR UPDATE`, [C, id]);
  if (!l) throw bad("العقد غير موجود");
  const n = await t.one(`SELECT COUNT(*)::int c FROM lease_posts WHERE lease_id=$1`, [id]);
  if (n.c) throw conflict("للعقد أشهر أو دفعات مرحّلة — اعكسها من دفتر اليومية أو أنهِ العقد مبكراً");
  if (l.startEntryId) await reverse(t, C, l.startEntryId, iso(l.startDate), `حذف عقد الإيجار ${l.number}`, user);
  await t.exec(`DELETE FROM leases WHERE id=$1`, [id]);
  return { ok: true };
}

/** Reversing a lease entry from the journal: a month (latest first) or a payment (latest first) goes back to the schedule. */
export async function leaseUnpostOnReverse(t: Db, C: string, entryId: string) {
  const l = await t.maybe(`SELECT id, number FROM leases WHERE company_id=$1 AND (start_entry_id=$2 OR end_entry_id=$2)`, [C, entryId]);
  if (l) throw conflict(`هذا قيد بداية أو إنهاء عقد الإيجار ${l.number} — احذف العقد من شاشة عقود الإيجار بدل عكس القيد`);
  const p = await t.maybe(`SELECT lp.*, le.number FROM lease_posts lp JOIN leases le ON le.id=lp.lease_id WHERE lp.entry_id=$1 AND lp.company_id=$2`, [entryId, C]);
  if (!p) return;
  const last = await t.one(`SELECT MAX(n) n FROM lease_posts WHERE lease_id=$1 AND kind=$2`, [p.leaseId, p.kind]);
  if (Number(last.n) !== p.n) throw conflict(`هذا ${p.kind === "MONTH" ? "قيد شهر" : "قيد دفعة"} من عقد الإيجار ${p.number} — اعكس الأحدث أولاً`);
  await t.exec(`DELETE FROM lease_posts WHERE id=$1`, [p.id]);
  await t.exec(`UPDATE leases SET posted_months=(SELECT COUNT(*) FROM lease_posts WHERE lease_id=$1 AND kind='MONTH'), status=CASE WHEN status='ENDED' THEN 'ACTIVE' ELSE status END, ended_on=CASE WHEN status='ENDED' THEN NULL ELSE ended_on END WHERE id=$1`, [p.leaseId]);
}

/** For the notes to the financial statements: carrying amounts, the year's charges, and undiscounted payments by maturity. */
export async function leaseDisclosure(t: Db, C: string, from: string, to: string) {
  const ls = await t.rows(`SELECT * FROM leases WHERE company_id=$1 AND start_date <= $2`, [C, to]);
  if (!ls.length) return null;
  const charges = await t.one(`SELECT COALESCE(SUM(lp.interest),0) i, COALESCE(SUM(lp.depreciation),0) d, COALESCE(SUM(lp.payment),0) p FROM lease_posts lp JOIN leases l ON l.id=lp.lease_id WHERE l.company_id=$1 AND lp.date BETWEEN $2 AND $3`, [C, from, to]);
  const mat = { y1: 0, y5: 0, over5: 0 };
  let liability = 0, nbv = 0;
  for (const l of ls) {
    if (l.status !== "ACTIVE") continue;
    const s = leaseSchedule(termsOf(l));
    const done = await t.one(`SELECT COALESCE(SUM(interest) FILTER (WHERE date <= $2),0) i, COALESCE(SUM(depreciation) FILTER (WHERE date <= $2),0) d, COALESCE(SUM(payment) FILTER (WHERE date <= $2),0) p, COUNT(*) FILTER (WHERE kind='PAYMENT' AND date <= $2)::int np FROM lease_posts WHERE lease_id=$1`, [l.id, to]);
    liability += Number(l.liability0) + Number(done.i) - Number(done.p); nbv += Number(l.rouCost) - Number(done.d);
    for (const p of s.payments.filter((x) => x.n > done.np)) {
      const yrs = (Date.parse(p.date) - Date.parse(to)) / (365.25 * 86400000);
      if (yrs <= 1) mat.y1 += p.amount; else if (yrs <= 5) mat.y5 += p.amount; else mat.over5 += p.amount;
    }
  }
  return { count: ls.filter((l: any) => l.status === "ACTIVE").length, liability: r2(liability), nbv: r2(nbv), interest: r2(Number(charges.i)), depreciation: r2(Number(charges.d)), paid: r2(Number(charges.p)), maturity: { y1: r2(mat.y1), y5: r2(mat.y5), over5: r2(mat.over5) } };
}

/** Establishments with lease months the scheduler should post (not while their demo data is loading). */
export async function companiesWithDueLeases(t: Db, DEMO_LOADING: string) {
  const rows = await t.rows(`SELECT DISTINCT l.company_id FROM leases l JOIN companies c ON c.id=l.company_id WHERE l.status='ACTIVE' AND l.auto AND c.status='ACTIVE' AND NOT ${DEMO_LOADING}`);
  return rows.map((r: any) => r.companyId);
}
