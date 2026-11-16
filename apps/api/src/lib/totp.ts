/** Time-based one-time passwords (RFC 6238, HMAC-SHA1, 6 digits, 30 s) as used by Google Authenticator, Microsoft Authenticator, Authy… */
import crypto from "crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(buf: Buffer) {
  let bits = 0, value = 0, out = "";
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function unbase32(s: string) {
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of s.toUpperCase().replace(/[^A-Z2-7]/g, "")) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newSecret = () => base32(crypto.randomBytes(20));
export function totp(secret: string, at = Date.now(), step = 30) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / step)));
  const h = crypto.createHmac("sha1", unbase32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String(((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, "0");
}
/** Accepts the current code and the one before/after it (clock drift of up to 30 s). */
export function verifyTotp(secret: string, code: string, at = Date.now()) {
  const c = String(code || "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\D/g, "");
  if (c.length !== 6 || !secret) return false;
  return [-1, 0, 1].some((w) => { const x = totp(secret, at + w * 30000); return x.length === c.length && crypto.timingSafeEqual(Buffer.from(x), Buffer.from(c)); });
}
export const otpUri = (secret: string, account: string, issuer: string) => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
export const hashCode = (c: string) => crypto.createHash("sha256").update(c.replace(/[\s-]/g, "").toUpperCase()).digest("hex");
export const newRecoveryCodes = () => Array.from({ length: 8 }, () => { const x = base32(crypto.randomBytes(5)); return `${x.slice(0, 4)}-${x.slice(4, 8)}`; });
