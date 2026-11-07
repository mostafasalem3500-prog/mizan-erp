/** Country edition config, loaded from /api/config before the app renders (the same web build serves every country server). */
export const CFG = {
  country: "SA" as "SA" | "EG", countryAr: "المملكة العربية السعودية", appName: "ميزان ERP",
  vatRate: 15, currency: "SAR", currencyAr: "ريال سعودي", currencySymbol: "ر.س",
  words: { one: "ريال", two: "ريالان", plural: "ريالات", acc: "ريالاً", sub: "هللة", subTwo: "هللتان", subPlural: "هللات" },
  taxAuthority: "هيئة الزكاة والضريبة والجمارك", taxIdLabel: "الرقم الضريبي", taxIdPattern: "^3\\d{13}3$", taxIdHint: "15 رقماً يبدأ وينتهي بـ 3",
  /** charity-association interface enabled on this server; desktop = the embedded server of the desktop app (data on this PC) */
  charity: false, desktop: false,
  modules: { zatca: true, zakat: true, saWht: true, egWht: false, eta: false, egPayroll: false, incomeTax: false, salla: true, wps: true } as Record<string, boolean>,
};
export const IS_EG = () => CFG.country === "EG";
/** Currency symbol / VAT helpers that read the live config. */
export const CUR = () => CFG.currencySymbol;
export const VATF = () => CFG.vatRate / 100;

export async function loadConfig() {
  const KEY = "mz_cfg";
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    if (r.ok) { const c = await r.json(); Object.assign(CFG, c); try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {} return; }
  } catch {}
  try { const c = localStorage.getItem(KEY); if (c) Object.assign(CFG, JSON.parse(c)); } catch {}
}
