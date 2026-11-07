/**
 * Country edition. One codebase, one deployment per country: set MIZAN_COUNTRY=EG on the Egypt server.
 * Everything that differs by tax system (VAT rate, base currency, words on documents, payroll rules,
 * which modules are offered) reads from here.
 */
export type CountryCode = "SA" | "EG";
export const COUNTRY: CountryCode = String(process.env.MIZAN_COUNTRY || "SA").toUpperCase() === "EG" ? "EG" : "SA";
export const IS_EG = COUNTRY === "EG";

const SA = {
  code: "SA" as CountryCode, nameAr: "المملكة العربية السعودية", appName: "ميزان ERP",
  vatRate: 15, currency: "SAR", currencyAr: "ريال سعودي", currencySymbol: "ر.س",
  words: { one: "ريال", two: "ريالان", plural: "ريالات", acc: "ريالاً", sub: "هللة", subTwo: "هللتان", subPlural: "هللات" },
  taxAuthority: "هيئة الزكاة والضريبة والجمارك", taxIdLabel: "الرقم الضريبي", taxIdPattern: "^3\\d{13}3$", taxIdHint: "15 رقماً يبدأ وينتهي بـ 3",
  crLabel: "السجل التجاري", phonePrefix: "966",
  modules: { zatca: true, zakat: true, saWht: true, egWht: false, eta: false, egPayroll: false, incomeTax: false, salla: true, wps: true },
};
const EG: typeof SA = {
  code: "EG", nameAr: "جمهورية مصر العربية", appName: "ميزان ERP مصر",
  vatRate: 14, currency: "EGP", currencyAr: "جنيه مصري", currencySymbol: "ج.م",
  words: { one: "جنيه", two: "جنيهان", plural: "جنيهات", acc: "جنيهاً", sub: "قرش", subTwo: "قرشان", subPlural: "قروش" },
  taxAuthority: "مصلحة الضرائب المصرية", taxIdLabel: "رقم التسجيل الضريبي", taxIdPattern: "^\\d{9}$", taxIdHint: "9 أرقام",
  crLabel: "السجل التجاري", phonePrefix: "20",
  modules: { zatca: false, zakat: false, saWht: false, egWht: true, eta: true, egPayroll: true, incomeTax: true, salla: false, wps: false },
};
export const CFG = IS_EG ? EG : SA;
export const VAT_RATE = CFG.vatRate;
/** VAT as a fraction (0.15 / 0.14). */
export const VAT_F = VAT_RATE / 100;
export const BASE_CURRENCY = CFG.currency;

/** The desktop app's embedded server (data on this PC). */
export const IS_DESKTOP = process.env.MIZAN_EDITION === "desktop-local";
/** The charity-association interface (/charity) is a separate product: off unless the server opts in (never in the desktop or Egypt editions). */
export const CHARITY = process.env.MIZAN_CHARITY === "1" && !IS_EG && !IS_DESKTOP;

/** Public, non-secret configuration the web app loads before rendering. */
export const publicConfig = () => ({ charity: CHARITY, desktop: IS_DESKTOP, country: CFG.code, countryAr: CFG.nameAr, appName: CFG.appName, vatRate: CFG.vatRate, currency: CFG.currency, currencyAr: CFG.currencyAr, currencySymbol: CFG.currencySymbol, words: CFG.words, taxAuthority: CFG.taxAuthority, taxIdLabel: CFG.taxIdLabel, taxIdPattern: CFG.taxIdPattern, taxIdHint: CFG.taxIdHint, modules: CFG.modules });

/** Company / supplier tax ID check for the edition (SA: 15 digits 3…3; EG: 9-digit tax registration number). */
export const validTaxId = (s: any) => new RegExp(CFG.taxIdPattern).test(String(s || ""));
/** Customer IDs: in Egypt an individual buyer may be identified by the 14-digit national ID instead. */
export const validPartnerTaxId = (s: any) => validTaxId(s) || (IS_EG && /^\d{14}$/.test(String(s || "")));
export const TAX_ID_MSG = `${CFG.taxIdLabel} يجب أن يكون ${CFG.taxIdHint}`;
