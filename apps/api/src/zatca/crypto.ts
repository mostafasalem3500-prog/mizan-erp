/**
 * ZATCA cryptographic stamp: invoice hash (SHA-256 over the C14N11-canonicalised
 * invoice with UBLExtensions / cac:Signature / QR reference removed), ECDSA
 * secp256k1 signature, XAdES signed properties, and the TLV QR code.
 * Follows ZATCA Security Features Implementation Standard v1.2.
 */
import { createHash, createSign, X509Certificate } from "crypto";
import { DOMParser } from "@xmldom/xmldom";
import { XmlCanonicalizer } from "xmldsigjs";
import { Certificate } from "@fidm/x509";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

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
  const x = new X509Certificate(wrapped);
  const c = Certificate.fromPEM(Buffer.from(wrapped));
  return {
    body,
    hash: Buffer.from(createHash("sha256").update(body).digest("hex")).toString("base64"),
    issuer: x.issuer.split("\n").reverse().join(", "),
    serial: BigInt(`0x${x.serialNumber}`).toString(10),
    publicKey: c.publicKeyRaw,
    signature: c.signature,
    validTo: x.validTo,
  };
}

export function signHash(hashB64: string, privateKeyPem: string): string {
  const body = cleanKey(privateKeyPem);
  const pem = `-----BEGIN EC PRIVATE KEY-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END EC PRIVATE KEY-----`;
  const s = createSign("sha256");
  s.update(Buffer.from(hashB64, "base64"));
  return s.sign(pem).toString("base64");
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
  const signed = xml
    .replace("<ext:UBLExtensions>SET_UBL_EXTENSIONS_STRING</ext:UBLExtensions>\n    \n    <cbc:ProfileID>", `\n    ${ext}\n    <cbc:ProfileID>`)
    .replace("SET_QR_CODE_DATA", qr);
  return { xml: signed, hash, qr, signature };
}

// ─── key pair + CSR (requires the openssl CLI) ─────────────────────────────
function openssl(args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("openssl", args);
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", (e) => reject(new Error("openssl غير متوفر على الخادم: " + e.message)));
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err || `openssl exited ${code}`))));
    if (input) p.stdin.write(input);
    p.stdin.end();
  });
}

export async function generateKeyPair(): Promise<string> {
  const out = await openssl(["ecparam", "-name", "secp256k1", "-genkey", "-noout"]);
  if (!out.includes("BEGIN EC PRIVATE KEY")) throw new Error("فشل توليد المفتاح الخاص");
  return out.trim();
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
  invoiceTypes?: string; // TSCZ e.g. 1100
}

export async function generateCsr(privateKeyPem: string, p: CsrProps): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mizan-csr-"));
  const keyFile = path.join(dir, "k.pem");
  const cnfFile = path.join(dir, "csr.cnf");
  const cnf = `[req]
prompt = no
utf8 = no
distinguished_name = dn
req_extensions = v3_req
[v3_req]
1.3.6.1.4.1.311.20.2 = ASN1:UTF8String:${p.production ? "ZATCA-Code-Signing" : "TSTZATCA-Code-Signing"}
subjectAltName = dirName:dir_sect
[dir_sect]
SN = ${p.serial}
UID = ${p.vat}
title = ${p.invoiceTypes || "1100"}
registeredAddress = ${p.location}
businessCategory = ${p.industry}
[dn]
commonName = ${p.commonName}
organizationalUnitName = ${p.branchName}
organizationName = ${p.orgName}
countryName = SA
`;
  try {
    fs.writeFileSync(keyFile, privateKeyPem, { mode: 0o600 });
    fs.writeFileSync(cnfFile, cnf);
    const out = await openssl(["req", "-new", "-sha256", "-key", keyFile, "-config", cnfFile]);
    if (!out.includes("BEGIN CERTIFICATE REQUEST")) throw new Error("فشل إنشاء طلب الشهادة (CSR)");
    return out.trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
