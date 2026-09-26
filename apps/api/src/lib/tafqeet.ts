/** Arabic number-to-words (تفقيط) for SAR amounts: "فقط ألف ومئتان وخمسون ريالاً وخمس وسبعون هللة لا غير" */
const ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];
// [singular, dual, plural(3-10), plural(11+)]
const SCALES: [string, string, string, string][] = [
  ["", "", "", ""],
  ["ألف", "ألفان", "آلاف", "ألفاً"],
  ["مليون", "مليونان", "ملايين", "مليوناً"],
  ["مليار", "ملياران", "مليارات", "ملياراً"],
];

function under1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100), r = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (r) {
    if (r < 20) parts.push(ONES[r]);
    else {
      const o = r % 10, t = Math.floor(r / 10);
      parts.push(o ? `${ONES[o]} و${TENS[t]}` : TENS[t]);
    }
  }
  return parts.join(" و");
}

export function intToArabic(n: number): string {
  if (n === 0) return "صفر";
  const groups: string[] = [];
  let scale = 0;
  while (n > 0 && scale < SCALES.length) {
    const g = n % 1000;
    if (g) {
      const s = SCALES[scale];
      let text: string;
      if (scale === 0) text = under1000(g);
      else if (g === 1) text = s[0];
      else if (g === 2) text = s[1];
      else if (g >= 3 && g <= 10) text = `${under1000(g)} ${s[2]}`;
      else text = `${under1000(g)} ${s[3]}`;
      groups.unshift(text);
    }
    n = Math.floor(n / 1000);
    scale++;
  }
  return groups.join(" و");
}

export function amountToArabicWords(amount: number, currency = "ريال", currencyDual = "ريالان", currencyPlural = "ريالات", currencyAcc = "ريالاً"): string {
  const abs = Math.abs(amount);
  const whole = Math.floor(abs + 1e-9);
  const frac = Math.round((abs - whole) * 100);
  const r = whole % 100;
  let main: string;
  if (whole === 0) main = `صفر ${currency}`;
  else if (whole === 1) main = `${currency} واحد`;
  else if (whole === 2) main = currencyDual;
  else main = `${intToArabic(whole)} ${r >= 3 && r <= 10 ? currencyPlural : r >= 11 ? currencyAcc : currency}`;
  let out = main;
  if (frac) {
    const fr = frac % 100;
    const sub = frac === 1 ? "هللة واحدة" : frac === 2 ? "هللتان" : `${intToArabic(frac)} ${fr >= 3 && fr <= 10 ? "هللات" : "هللة"}`;
    out += ` و${sub}`;
  }
  return `فقط ${out} لا غير${amount < 0 ? " (بالسالب)" : ""}`;
}
