/** Currencies & exchange rates. The ledger is always in SAR; documents may carry a foreign currency + the rate used. */
import { Db } from "../db/pool";
import { bad, r2, r4, r6, D, num, isDate, today } from "../lib/core";

export const BASE = "SAR";
export const DEFAULT_CURRENCIES: [string, string, string, number, number][] = [
  ["SAR", "ريال سعودي", "ر.س", 1, 2], ["USD", "دولار أمريكي", "$", 3.75, 2], ["EUR", "يورو", "€", 4.05, 2], ["GBP", "جنيه إسترليني", "£", 4.75, 2],
  ["AED", "درهم إماراتي", "د.إ", 1.0209, 2], ["KWD", "دينار كويتي", "د.ك", 12.2, 3], ["BHD", "دينار بحريني", "د.ب", 9.95, 3], ["QAR", "ريال قطري", "ر.ق", 1.03, 2],
  ["OMR", "ريال عماني", "ر.ع", 9.74, 3], ["EGP", "جنيه مصري", "ج.م", 0.078, 2], ["INR", "روبية هندية", "₹", 0.045, 2], ["CNY", "يوان صيني", "¥", 0.52, 2], ["TRY", "ليرة تركية", "₺", 0.11, 2],
];

export async function seedCurrencies(t: Db, companyId: string) {
  await t.insertMany("currencies", DEFAULT_CURRENCIES.map(([code, nameAr, symbol, rate, decimals]) => ({ companyId, code, nameAr, symbol, rate, decimals })));
}

export async function listCurrencies(t: Db, companyId: string) {
  return t.rows(`SELECT * FROM currencies WHERE company_id=$1 ORDER BY code='SAR' DESC, code`, [companyId]);
}

export async function getCurrency(t: Db, companyId: string, code: string) {
  const c = String(code || BASE).toUpperCase();
  if (c === BASE) return { code: BASE, nameAr: "ريال سعودي", symbol: "ر.س", rate: 1, decimals: 2, isActive: true };
  const row = await t.maybe(`SELECT * FROM currencies WHERE company_id=$1 AND code=$2`, [companyId, c]);
  if (!row) throw bad(`العملة ${c} غير معرفة — أضفها من الإعدادات`);
  return row;
}

/** Rate for a date: latest historical rate on/before the date, else the current rate. */
export async function rateFor(t: Db, companyId: string, code: string, date?: string) {
  const c = String(code || BASE).toUpperCase();
  if (c === BASE) return 1;
  const d = date && isDate(date) ? date : today();
  const h = await t.maybe(`SELECT rate FROM exchange_rates WHERE company_id=$1 AND code=$2 AND date <= $3 ORDER BY date DESC LIMIT 1`, [companyId, c, d]);
  if (h) return Number(h.rate);
  return Number((await getCurrency(t, companyId, c)).rate);
}

export async function upsertCurrency(t: Db, companyId: string, b: any) {
  const code = String(b.code || "").toUpperCase().trim();
  if (!/^[A-Z]{3}$/.test(code)) throw bad("رمز العملة يجب أن يكون 3 أحرف (ISO)");
  if (code === BASE) throw bad("الريال السعودي هو العملة الأساسية ولا يُعدَّل");
  const rate = r6(num(b.rate));
  if (rate <= 0) throw bad("سعر الصرف يجب أن يكون أكبر من صفر");
  const row = await t.maybe(`SELECT * FROM currencies WHERE company_id=$1 AND code=$2`, [companyId, code]);
  const data = { nameAr: b.nameAr || row?.nameAr || code, symbol: b.symbol || row?.symbol || code, rate, decimals: [0, 2, 3].includes(Number(b.decimals)) ? Number(b.decimals) : row?.decimals ?? 2, isActive: b.isActive === undefined ? row?.isActive ?? true : b.isActive !== false, updatedAt: new Date() };
  const out = row ? await t.update("currencies", { id: row.id }, data) : await t.insert("currencies", { companyId, code, ...data });
  // keep a dated history so old documents can be re-valued consistently
  await t.exec(`INSERT INTO exchange_rates(company_id, code, date, rate) VALUES ($1,$2,$3,$4) ON CONFLICT (company_id, code, date) DO UPDATE SET rate=EXCLUDED.rate`, [companyId, code, isDate(b.date) ? b.date : today(), rate]);
  return out;
}

export const toBase = (fc: number, rate: number) => r2(D(fc).times(rate));
export const toFc = (base: number, rate: number) => r2(D(base).div(rate));
export const fcUnitToBase = (fc: number, rate: number) => r4(D(fc).times(rate));
