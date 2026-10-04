/**
 * Pure-JavaScript ZATCA cryptography (no OpenSSL CLI, no native secp256k1):
 *   • secp256k1 key generation / PEM (SEC1 "EC PRIVATE KEY") encode & decode
 *   • ECDSA-SHA256 signing of the invoice hash (same bytes the OpenSSL path produced)
 *   • PKCS#10 CSR with the ZATCA extensions (template name + SAN dirName), DER-encoded by hand
 * Works identically on the Linux server, Windows desktop (Electron/BoringSSL lacks secp256k1) and macOS.
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";

// ─── minimal DER encoder ────────────────────────────────────────────────────
const len = (n: number): Buffer => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
const tlv = (tag: number, content: Buffer) => Buffer.concat([Buffer.from([tag]), len(content.length), content]);
const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
const int = (n: number | Buffer) => {
  let b = typeof n === "number" ? Buffer.from([n]) : n;
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
};
const oid = (s: string) => {
  const p = s.split(".").map(Number);
  const out: number[] = [p[0] * 40 + p[1]];
  for (const v of p.slice(2)) {
    const stack: number[] = [];
    let x = v;
    stack.unshift(x & 0x7f);
    while ((x = Math.floor(x / 128)) > 0) stack.unshift((x & 0x7f) | 0x80);
    out.push(...stack);
  }
  return tlv(0x06, Buffer.from(out));
};
const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, "utf8"));
const printable = (s: string) => tlv(0x13, Buffer.from(s, "ascii"));
const octet = (b: Buffer) => tlv(0x04, b);
const bitstr = (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
const ctx = (n: number, content: Buffer, constructed = true) => tlv((constructed ? 0xa0 : 0x80) | n, content);

const OID = {
  ecPublicKey: "1.2.840.10045.2.1", secp256k1: "1.3.132.0.10", ecdsaSha256: "1.2.840.10045.4.3.2",
  CN: "2.5.4.3", OU: "2.5.4.11", O: "2.5.4.10", C: "2.5.4.6", SN: "2.5.4.4", UID: "0.9.2342.19200300.100.1.1",
  title: "2.5.4.12", registeredAddress: "2.5.4.26", businessCategory: "2.5.4.15",
  extensionRequest: "1.2.840.113549.1.9.14", subjectAltName: "2.5.29.17", certTemplateName: "1.3.6.1.4.1.311.20.2",
};
const rdn = (type: string, value: Buffer) => set(seq(oid(type), value));

// ─── minimal DER reader (enough for SEC1 / PKCS#8 private keys) ────────────
function readTlv(b: Buffer, off: number) {
  const tag = b[off];
  let l = b[off + 1], hl = 2;
  if (l & 0x80) { const n = l & 0x7f; l = 0; for (let i = 0; i < n; i++) l = (l << 8) | b[off + 2 + i]; hl = 2 + n; }
  return { tag, start: off + hl, end: off + hl + l };
}
function children(b: Buffer, start: number, end: number) {
  const out: { tag: number; start: number; end: number }[] = [];
  for (let o = start; o < end; ) { const t = readTlv(b, o); out.push(t); o = t.end; }
  return out;
}

const pemBody = (pem: string) => Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
const toPem = (label: string, der: Buffer) => `-----BEGIN ${label}-----\n${der.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----`;

/** 32-byte secp256k1 private scalar from a SEC1 ("EC PRIVATE KEY") or PKCS#8 ("PRIVATE KEY") PEM, or a bare base64 SEC1 body. */
export function privateKeyFromPem(pem: string): Uint8Array {
  let der = pemBody(pem);
  let top = readTlv(der, 0);
  let kids = children(der, top.start, top.end);
  // PKCS#8: SEQ { INT 0, SEQ algId, OCTET STRING (SEC1) }
  if (kids.length >= 3 && kids[1].tag === 0x30 && kids[2].tag === 0x04) {
    der = der.subarray(kids[2].start, kids[2].end);
    top = readTlv(der, 0);
    kids = children(der, top.start, top.end);
  }
  const oct = kids.find((k) => k.tag === 0x04);
  if (!oct) throw new Error("صيغة المفتاح الخاص غير مدعومة");
  let key = der.subarray(oct.start, oct.end);
  if (key.length > 32) key = key.subarray(key.length - 32);
  if (key.length < 32) key = Buffer.concat([Buffer.alloc(32 - key.length), key]);
  return new Uint8Array(key);
}

/** New secp256k1 key as SEC1 PEM (same format `openssl ecparam -name secp256k1 -genkey -noout` writes). */
export function generateKeyPairPem(): string {
  const priv = secp256k1.utils.randomPrivateKey();
  const pub = Buffer.from(secp256k1.getPublicKey(priv, false));
  const der = seq(int(1), octet(Buffer.from(priv)), ctx(0, oid(OID.secp256k1)), ctx(1, bitstr(pub)));
  return toPem("EC PRIVATE KEY", der);
}

/** ECDSA-SHA256 over the raw bytes of the base64 invoice hash, DER signature in base64 (as crypto.createSign("sha256") produced). */
export function signHashPure(hashB64: string, privateKeyPem: string): string {
  const digest = sha256(Buffer.from(hashB64, "base64"));
  const sig = secp256k1.sign(digest, privateKeyFromPem(privateKeyPem));
  return Buffer.from(sig.toDERRawBytes()).toString("base64");
}

export interface PureCsrProps {
  commonName: string; serial: string; vat: string; orgName: string; branchName: string;
  location: string; industry: string; template: string; invoiceTypes?: string;
}

/** PKCS#10 CSR mirroring the OpenSSL config ZATCA documents (template-name extension + SAN dirName). */
export function generateCsrPure(privateKeyPem: string, p: PureCsrProps): string {
  const priv = privateKeyFromPem(privateKeyPem);
  const pub = Buffer.from(secp256k1.getPublicKey(priv, false));
  const subject = seq(rdn(OID.CN, utf8(p.commonName)), rdn(OID.OU, utf8(p.branchName)), rdn(OID.O, utf8(p.orgName)), rdn(OID.C, printable("SA")));
  const spki = seq(seq(oid(OID.ecPublicKey), oid(OID.secp256k1)), bitstr(pub));
  const dirName = seq(
    rdn(OID.SN, utf8(p.serial)), rdn(OID.UID, utf8(p.vat)), rdn(OID.title, utf8(p.invoiceTypes || "1100")),
    rdn(OID.registeredAddress, utf8(p.location)), rdn(OID.businessCategory, utf8(p.industry)),
  );
  const san = seq(ctx(4, dirName)); // GeneralNames { directoryName [4] }
  const extensions = seq(
    seq(oid(OID.certTemplateName), octet(utf8(p.template))),
    seq(oid(OID.subjectAltName), octet(san)),
  );
  const attributes = ctx(0, seq(oid(OID.extensionRequest), set(extensions)));
  const info = seq(int(0), subject, spki, attributes);
  const sig = secp256k1.sign(sha256(info), priv);
  const csr = seq(info, seq(oid(OID.ecdsaSha256)), bitstr(Buffer.from(sig.toDERRawBytes())));
  return toPem("CERTIFICATE REQUEST", csr);
}
