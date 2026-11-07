/**
 * Offline licences for the desktop (local-database) edition.
 * Key = "MZD-" + base64url(JSON payload) + "." + base64url(Ed25519 signature)
 * Signed in the cloud with LICENSE_SIGNING_KEY (32-byte hex, never shipped); verified anywhere with the public key below.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { randomBytes } from "crypto";

export const LICENSE_PUBLIC_KEY = "2e3cc4051759fbd8d3d7f2b3ae14493aebc9a09387e616a17293dab4fcee7bc0";

export interface DesktopLicense { plan: string; months: number; maxUsers: number; nonce: string; issuedAt: string; note?: string | null; deviceId?: string | null }

/** Device fingerprint as shown by the desktop app: XXXX-XXXX-XXXX-XXXX (hex). */
export const DEVICE_ID_RE = /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;
export const normalizeDeviceId = (v: any) => String(v || "").trim().toUpperCase().replace(/\s+/g, "");

export const isDesktopLocal = () => process.env.MIZAN_EDITION === "desktop-local";
/** The fingerprint of the PC this server runs on (set by the desktop shell), or null on the cloud. */
export const currentDeviceId = () => (isDesktopLocal() ? normalizeDeviceId(process.env.MIZAN_DEVICE_ID) || null : null);

const b64u = (b: Uint8Array | Buffer) => Buffer.from(b).toString("base64url");

export function signDesktopLicense(p: Omit<DesktopLicense, "nonce" | "issuedAt">): string {
  const sk = process.env.LICENSE_SIGNING_KEY;
  if (!sk || !/^[0-9a-f]{64}$/i.test(sk)) throw new Error("مفتاح توقيع التراخيص (LICENSE_SIGNING_KEY) غير مضبوط على الخادم");
  const deviceId = p.deviceId ? normalizeDeviceId(p.deviceId) : null;
  if (deviceId && !DEVICE_ID_RE.test(deviceId)) throw new Error("معرّف الجهاز غير صحيح — الصيغة XXXX-XXXX-XXXX-XXXX كما يظهر في البرنامج");
  const payload: DesktopLicense = { ...p, deviceId, nonce: randomBytes(6).toString("hex"), issuedAt: new Date().toISOString().slice(0, 10) };
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const sig = ed25519.sign(body, Buffer.from(sk, "hex"));
  return `MZD-${b64u(body)}.${b64u(sig)}`;
}

/** Returns the licence payload when the key is authentic, otherwise null. */
export function verifyDesktopLicense(key: string): DesktopLicense | null {
  const m = /^MZD-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(key || "").trim());
  if (!m) return null;
  try {
    const body = Buffer.from(m[1], "base64url");
    const ok = ed25519.verify(Buffer.from(m[2], "base64url"), body, Buffer.from(LICENSE_PUBLIC_KEY, "hex"));
    if (!ok) return null;
    const p = JSON.parse(body.toString("utf8"));
    if (!p.plan || !p.months) return null;
    return p;
  } catch {
    return null;
  }
}
