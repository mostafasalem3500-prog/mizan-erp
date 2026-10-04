/**
 * ZATCA cryptographic stamp: invoice hash (SHA-256 over the C14N11-canonicalised
 * invoice with UBLExtensions / cac:Signature / QR reference removed), ECDSA
 * secp256k1 signature, XAdES signed properties, and the TLV QR code.
 * Follows ZATCA Security Features Implementation Standard v1.2.
 */
import { createHash, X509Certificate } from "crypto";
import { DOMParser } from "@xmldom/xmldom";
import { XmlCanonicalizer } from "xmldsigjs";
import { Certificate } from "@fidm/x509";
import { generateKeyPairPem, generateCsrPure, signHashPure } from "./pure";

export const TLV = (tags: (string | Buffer)[]): Buffer =>
  Buffer.concat(
    tags.map((tag, i) => {
      const v = Buffer.isBuffer(tag) ? tag : Buffer.from(tag, "utf8");
      return Buffer.concat([Buffer.from([i + 1, v.byteLength]), v]);
    }),
  );

/** Phase-1 QR (tags 1-5) */
export function phase1Qr(sellerName: string, vat: string, timestamp: string, total: string, vatTotal: string) {
  return TLV([sellerName, vat, timestamp, total, vatTotal]).toString("base64");
}

export function pureInvoiceString(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const root = doc.documentElement!;
  const remove = (n: any) => n && n.parentNode && n.parentNode.removeChild(n);
  remove(root.getElementsByTagName("ext:UBLExtensions")[0]);
  for (const s of Array.from(root.getElementsByTagName("cac:Signature"))) {
    if ((s as any).parentNode === root) remove(s);
  }
  for (const r of Array.from(root.getElementsByTagName("cac:AdditionalDocumentReference"))) {
    const id = (r as any).getElementsByTagName("cbc:ID")[0];
    if (id && id.textContent === "QR") remove(r);
  }
  return new XmlCanonicalizer(false, false).Canonicalize(root as any);
}

export function invoiceHash(xml: string): string {
  return createHash("sha256").update(pureInvoiceString(xml), "utf8").digest("base64");
}

export const cleanCert = (s: string) => s.replace(/-----BEGIN CERTIFICATE-----/g, "").replace(/-----END CERTIFICATE-----/g, "").replace(/\s+/g, "");
export const cleanKey = (s: string) => s.replace(/-----BEGIN EC PRIVATE KEY-----/g, "").replace(/-----END EC PRIVATE KEY-----/g, "").replace(/\s+/g, "");

export function certificateInfo(certPem: string) {
  const body = cleanCert(certPem);
  const wrapped = `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----`;
  const c = Certificate.fromPEM(Buffer.from(wrapped));
  let issuer: string, serial: string, validTo: string;
  try {
    const x = new X509Certificate(wrapped);
    issuer = x.issuer.split("\n").reverse().join(", ");
    serial = BigInt(`0x${x.serialNumber}`).toString(10);
    validTo = x.validTo;
  } catch {
    // runtimes without secp256k1 in their TLS library (Electron/BoringSSL): same strings from the pure-JS parser
    const SHORT: Record<string, string> = { "0.9.2342.19200300.100.1.25": "DC", "1.2.840.113549.1.9.1": "emailAddress", "0.9.2342.19200300.100.1.1": "UID" };
    issuer = c.issuer.attributes.map((a: any) => `${a.shortName || SHORT[a.oid] || a.oid}=${a.value}`).reverse().join(", ");
    serial = BigInt(`0x${c.serialNumber}`).toString(10);
    validTo = c.validTo.toUTCString();
  }
  return {
    body,
    hash: Buffer.from(createHash("sha256").update(body).digest("hex")).toString("base64"),
    issuer,
    serial,
    publicKey: c.publicKeyRaw,
    signature: c.signature,
    validTo,
  };
}

/** ECDSA-SHA256 over the invoice hash — pure JS so it also runs where the TLS library lacks secp256k1. */
export function signHash(hashB64: string, privateKeyPem: string): string {
  const pem = privateKeyPem.includes("-----BEGIN") ? privateKeyPem : `-----BEGIN EC PRIVATE KEY-----\n${cleanKey(privateKeyPem)}\n-----END EC PRIVATE KEY-----`;
  return signHashPure(hashB64, pem);
}

const signedPropsForHash = (t: string, h: string, iss: string, sn: string) =>
  `<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">
                                    <xades:SignedSignatureProperties>
                                        <xades:SigningTime>${t}</xades:SigningTime>
                                        <xades:SigningCertificate>
                                            <xades:Cert>
                                                <xades:CertDigest>
                                                    <ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                                    <ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${h}</ds:DigestValue>
                                                </xades:CertDigest>
                                                <xades:IssuerSerial>
                                                    <ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${iss}</ds:X509IssuerName>
                                                    <ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${sn}</ds:X509SerialNumber>
                                                </xades:IssuerSerial>
                                            </xades:Cert>
                                        </xades:SigningCertificate>
                                    </xades:SignedSignatureProperties>
                                </xades:SignedProperties>`;

const signedPropsFinal = (t: string, h: string, iss: string, sn: string) =>
  `<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">
                                    <xades:SignedSignatureProperties>
                                        <xades:SigningTime>${t}</xades:SigningTime>
                                        <xades:SigningCertificate>
                                            <xades:Cert>
                                                <xades:CertDigest>
                                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                                    <ds:DigestValue>${h}</ds:DigestValue>
                                                </xades:CertDigest>
                                                <xades:IssuerSerial>
                                                    <ds:X509IssuerName>${iss}</ds:X509IssuerName>
                                                    <ds:X509SerialNumber>${sn}</ds:X509SerialNumber>
                                                </xades:IssuerSerial>
                                            </xades:Cert>
                                        </xades:SigningCertificate>
                                    </xades:SignedSignatureProperties>
                                </xades:SignedProperties>`;

const extension = (ih: string, sph: string, sig: string, cert: string, sp: string) => `<ext:UBLExtensions>
        <ext:UBLExtension>
            <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>
            <ext:ExtensionContent>
                <sig:UBLDocumentSignatures xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2" xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2">
                    <sac:SignatureInformation>
                        <cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>
                        <sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>
                        <ds:Signature Id="signature" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
                            <ds:SignedInfo>
                                <ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:CanonicalizationMethod>
                                <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"></ds:SignatureMethod>
                                <ds:Reference Id="invoiceSignedData" URI="">
                                    <ds:Transforms>
                                        <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                            <ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath>
                                        </ds:Transform>
                                        <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                            <ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath>
                                        </ds:Transform>
                                        <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                            <ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath>
                                        </ds:Transform>
                                        <ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:Transform>
                                    </ds:Transforms>
                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>
                                    <ds:DigestValue>${ih}</ds:DigestValue>
                                </ds:Reference>
                                <ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties">
                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>
                                    <ds:DigestValue>${sph}</ds:DigestValue>
                                </ds:Reference>
                            </ds:SignedInfo>
                            <ds:SignatureValue>${sig}</ds:SignatureValue>
                            <ds:KeyInfo>
                                <ds:X509Data>
                                    <ds:X509Certificate>${cert}</ds:X509Certificate>
                                </ds:X509Data>
                            </ds:KeyInfo>
                            <ds:Object>
                            <xades:QualifyingProperties Target="signature" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#">
                                ${sp}
                            </xades:QualifyingProperties>
                            </ds:Object>
                        </ds:Signature>
                    </sac:SignatureInformation>
                </sig:UBLDocumentSignatures>
            </ext:ExtensionContent>
        </ext:UBLExtension>
    </ext:UBLExtensions>`;

export interface SignResult {
  xml: string;
  hash: string;
  qr: string;
  signature: string;
}

/** Signs an unsigned invoice XML (built by ubl.ts) and embeds signature + phase-2 QR. */
export function signInvoice(xml: string, certPem: string, privateKeyPem: string, qrFields: { sellerName: string; vat: string; timestamp: string; total: string; vatTotal: string }): SignResult {
  const hash = invoiceHash(xml);
  const cert = certificateInfo(certPem);
  const signature = signHash(hash, privateKeyPem);
  const qr = TLV([qrFields.sellerName, qrFields.vat, qrFields.timestamp, qrFields.total, qrFields.vatTotal, hash, Buffer.from(signature), cert.publicKey, cert.signature]).toString("base64");
  const now = new Date();
  const ts = now.toISOString().slice(0, 19) + "Z";
  const spHash = Buffer.from(createHash("sha256").update(signedPropsForHash(ts, cert.hash, cert.issuer, cert.serial), "utf8").digest("hex")).toString("base64");
  const ext = extension(hash, spHash, signature, cert.body, signedPropsFinal(ts, cert.hash, cert.issuer, cert.serial));
  // Final layout mirrors the reference: UBLExtensions on its own indented line so that
  // stripping it (ZATCA-side XPath transform) leaves the same whitespace the hash was computed on.
  // Only the placeholder element is swapped, so every text node around it is untouched and the
  // hash ZATCA recomputes (UBLExtensions stripped, C14N11) equals the one computed on the unsigned XML.
  const placeholder = "<ext:UBLExtensions>SET_UBL_EXTENSIONS_STRING</ext:UBLExtensions>";
  if (!xml.includes(placeholder) || !xml.includes("SET_QR_CODE_DATA")) throw new Error("قالب XML غير صالح للتوقيع (العناصر البديلة مفقودة)");
  const signed = xml.replace(placeholder, ext).replace("SET_QR_CODE_DATA", qr);
  return { xml: signed, hash, qr, signature };
}

// ─── key pair + CSR (pure JS — no OpenSSL CLI needed on the server or the desktop app) ──
export async function generateKeyPair(): Promise<string> {
  return generateKeyPairPem();
}

export interface CsrProps {
  commonName: string; // EGS custom id
  serial: string; // 1-Mizan|2-2.0|3-<uuid>
  vat: string;
  orgName: string;
  branchName: string;
  location: string;
  industry: string;
  production: boolean;
  env?: string; // SANDBOX (developer portal) | SIMULATION | PRODUCTION — picks the certificate template
  invoiceTypes?: string; // TSCZ e.g. 1100
}

export async function generateCsr(privateKeyPem: string, p: CsrProps): Promise<string> {
  const template = p.production || p.env === "PRODUCTION" ? "ZATCA-Code-Signing" : p.env === "SIMULATION" ? "PREZATCA-Code-Signing" : "TSTZATCA-Code-Signing";
  return generateCsrPure(privateKeyPem, { ...p, template });
}
