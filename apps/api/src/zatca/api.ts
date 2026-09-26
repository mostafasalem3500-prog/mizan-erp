/** ZATCA Fatoora API client (compliance CSID, production CSID, reporting, clearance). */
import { cleanCert } from "./crypto";

export const ZATCA_BASE: Record<string, string> = {
  SANDBOX: "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal",
  SIMULATION: "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation",
  PRODUCTION: "https://gw-fatoora.zatca.gov.sa/e-invoicing/core",
};

function auth(cert: string, secret: string) {
  const basic = Buffer.from(`${Buffer.from(cleanCert(cert)).toString("base64")}:${secret}`).toString("base64");
  return { Authorization: `Basic ${basic}` };
}

async function call(url: string, headers: Record<string, string>, body: any) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "Accept-Version": "V2", "Accept-Language": "ar", ...headers },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export async function issueComplianceCsid(env: string, csr: string, otp: string) {
  const r = await call(`${ZATCA_BASE[env]}/compliance`, { OTP: otp }, { csr: Buffer.from(csr).toString("base64") });
  if (r.status !== 200) throw new Error(`فشل إصدار شهادة الامتثال (${r.status}): ${JSON.stringify(r.data).slice(0, 400)}`);
  const cert = Buffer.from(r.data.binarySecurityToken, "base64").toString();
  return { cert: `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----`, secret: r.data.secret as string, requestId: String(r.data.requestID) };
}

export async function issueProductionCsid(env: string, complianceCert: string, secret: string, complianceRequestId: string) {
  const r = await call(`${ZATCA_BASE[env]}/production/csids`, auth(complianceCert, secret), { compliance_request_id: complianceRequestId });
  if (r.status !== 200) throw new Error(`فشل إصدار شهادة الإنتاج (${r.status}): ${JSON.stringify(r.data).slice(0, 400)}`);
  const cert = Buffer.from(r.data.binarySecurityToken, "base64").toString();
  return { cert: `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----`, secret: r.data.secret as string, requestId: String(r.data.requestID) };
}

export async function complianceCheck(env: string, cert: string, secret: string, signedXml: string, hash: string, uuid: string) {
  return call(`${ZATCA_BASE[env]}/compliance/invoices`, auth(cert, secret), { invoiceHash: hash, uuid, invoice: Buffer.from(signedXml).toString("base64") });
}

/** Simplified invoices → reporting; standard invoices → clearance. */
export async function submit(env: string, cert: string, secret: string, simplified: boolean, signedXml: string, hash: string, uuid: string) {
  const path = simplified ? "/invoices/reporting/single" : "/invoices/clearance/single";
  const hdr = { ...auth(cert, secret), "Clearance-Status": simplified ? "0" : "1" };
  return call(`${ZATCA_BASE[env]}${path}`, hdr, { invoiceHash: hash, uuid, invoice: Buffer.from(signedXml).toString("base64") });
}
