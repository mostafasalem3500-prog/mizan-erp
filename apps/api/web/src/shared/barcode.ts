/** Tiny barcode encoders → SVG (Code128 auto B/C, EAN-13). No dependencies. */

const CODE128 = [
  "11011001100","11001101100","11001100110","10010011000","10010001100","10001001100","10011001000","10011000100","10001100100","11001001000",
  "11001000100","11000100100","10110011100","10011011100","10011001110","10111001100","10011101100","10011100110","11001110010","11001011100",
  "11001001110","11011100100","11001110100","11101101110","11101001100","11100101100","11100100110","11101100100","11100110100","11100110010",
  "11011011000","11011000110","11000110110","10100011000","10001011000","10001000110","10110001000","10001101000","10001100010","11010001000",
  "11000101000","11000100010","10110111000","10110001110","10001101110","10111011000","10111000110","10001110110","11101110110","11010001110",
  "11000101110","11011101000","11011100010","11011101110","11101011000","11101000110","11100010110","11101101000","11101100010","11100011010",
  "11101111010","11001000010","11110001010","10100110000","10100001100","10010110000","10010000110","10000101100","10000100110","10110010000",
  "10110000100","10011010000","10011000010","10000110100","10000110010","11000010010","11001010000","11110111010","11000010100","10001111010",
  "10100111100","10010111100","10010011110","10111100100","10011110100","10011110010","11110100100","11110010100","11110010010","11011011110",
  "11011110110","11110110110","10101111000","10100011110","10001011110","10111101000","10111100010","11110101000","11110100010","10111011110",
  "10111101110","11101011110","11110101110","11010000100","11010010000","11010011100","1100011101011",
];

export function code128(text: string): string | null {
  if (!text || /[^\x20-\x7e]/.test(text)) return null;
  const codes: number[] = [];
  let i = 0, setC = false;
  const digitsAhead = (k: number) => { let n = 0; while (k + n < text.length && /\d/.test(text[k + n])) n++; return n; };
  // start in C when 4+ digits ahead, else B
  if (digitsAhead(0) >= 4) { codes.push(105); setC = true; } else codes.push(104);
  while (i < text.length) {
    if (setC) {
      if (digitsAhead(i) >= 2) { codes.push(Number(text.substr(i, 2))); i += 2; continue; }
      codes.push(100); setC = false; // switch to B
    } else {
      if (digitsAhead(i) >= 4 || (digitsAhead(i) >= 2 && i + digitsAhead(i) === text.length && digitsAhead(i) % 2 === 0)) { codes.push(99); setC = true; continue; }
      codes.push(text.charCodeAt(i) - 32); i++;
    }
  }
  let sum = codes[0];
  for (let k = 1; k < codes.length; k++) sum += codes[k] * k;
  codes.push(sum % 103, 106);
  return codes.map((c) => CODE128[c]).join("");
}

const EAN_L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
const EAN_G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
const EAN_R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
const EAN_PARITY = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];

export function ean13Check(d12: string) { let s = 0; for (let i = 0; i < 12; i++) s += Number(d12[i]) * (i % 2 ? 3 : 1); return String((10 - (s % 10)) % 10); }
export function ean13(text: string): string | null {
  // only a full 13-digit code with a valid check digit is drawn as EAN-13 — anything else is Code128 so a scan returns exactly the stored value
  if (!/^\d{13}$/.test(text)) return null;
  const d = text;
  if (ean13Check(text.slice(0, 12)) !== text[12]) return null;
  const parity = EAN_PARITY[Number(d[0])];
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === "L" ? EAN_L : EAN_G)[Number(d[i])];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += EAN_R[Number(d[i])];
  return bits + "101";
}

/** SVG string for a barcode; EAN-13 when the value is a valid 13-digit code, otherwise Code128. */
export function barcodeSvg(value: string, opts: { height?: number; module?: number; text?: boolean; width?: number } = {}) {
  const v = String(value || "").trim();
  const bits = ean13(v) || code128(v);
  if (!bits) return "";
  const module = opts.module ?? 1, h = opts.height ?? 40;
  const w = bits.length * module + 2 * 4 * module; // quiet zones
  const rects: string[] = [];
  let x = 4 * module;
  for (let i = 0; i < bits.length; ) {
    if (bits[i] === "1") { let n = 1; while (bits[i + n] === "1") n++; rects.push(`<rect x="${x}" y="0" width="${n * module}" height="${h}"/>`); x += n * module; i += n; } else { x += module; i++; }
  }
  const label = opts.text === false ? "" : `<text x="${w / 2}" y="${h + 9}" font-size="8" font-family="monospace" text-anchor="middle">${v}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h + (opts.text === false ? 0 : 11)}" ${opts.width ? `width="${opts.width}"` : ""} preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges"><g fill="#000">${rects.join("")}</g>${label}</svg>`;
}
