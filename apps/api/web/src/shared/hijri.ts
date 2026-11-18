/**
 * Hijri (Umm al-Qura) date beside the Gregorian one — the calendar of Saudi official dealings. The browser's own
 * calendar data does the conversion (Intl, islamic-umalqura); where it is missing the date is simply left out.
 */
import { isEn } from "../i18n";

const FMT = new Map<string, Intl.DateTimeFormat | null>();
function fmt(style: "long" | "short", lang: "ar" | "en"): Intl.DateTimeFormat | null {
  const key = style + lang;
  if (FMT.has(key)) return FMT.get(key)!;
  let f: Intl.DateTimeFormat | null = null;
  try {
    f = new Intl.DateTimeFormat(lang === "en" ? "en-GB-u-ca-islamic-umalqura" : "ar-SA-u-ca-islamic-umalqura-nu-latn",
      style === "long" ? { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" } : { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
    if (f.resolvedOptions().calendar !== "islamic-umalqura") f = null;
  } catch { f = null; }
  FMT.set(key, f);
  return f;
}
/**
 * «2026-11-18» → «27 جمادى الأولى 1448 هـ» (long) or «27/05/1448 هـ» (short); "" when the date is not valid.
 * Printed invoices pass "ar" (they keep Arabic); screens follow the interface language.
 */
export function hijri(d: any, style: "long" | "short" = "long", lang: "ar" | "en" = isEn() ? "en" : "ar"): string {
  const s = String(d || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const f = fmt(style, lang); if (!f) return "";
  const t = f.format(new Date(s + "T12:00:00Z")).replace(/\s*(هـ|AH)$/, "");
  return lang === "en" ? `${t} AH` : `${t} هـ`;
}
