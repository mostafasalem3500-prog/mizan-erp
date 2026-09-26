/**
 * Stamps a posted sales invoice/credit/debit note:
 *   phase 1 → phase-1 QR only.
 *   phase 2 → ICV counter, PIH chain, UBL XML, hash, signature, phase-2 QR,
 *             then reporting (simplified) or clearance (standard) when a certificate exists.
 * Runs inside the posting transaction so ICV/PIH are strictly sequential.
 */
import { Db } from "../db/pool";
import { buildInvoiceXml, UblInvoice } from "./ubl";
import { phase1Qr, signInvoice, invoiceHash } from "./crypto";
import { submit } from "./api";
import { tx } from "../db/pool";
import { r2, D } from "../lib/core";

export async function ensureZatcaConfig(t: Db, companyId: string) {
  let cfg = await t.maybe(`SELECT * FROM zatca_configs WHERE company_id=$1`, [companyId]);
  if (!cfg) cfg = await t.insert("zatca_configs", { companyId });
  return cfg;
}

function tsOf(inv: any) {
  const d = new Date(inv.issuedAt);
  return { date: inv.date, time: d.toISOString().slice(11, 19) };
}

export function invoiceToUbl(company: any, inv: any, lines: any[], cfg: any, origin?: any): UblInvoice {
  const { date, time } = tsOf(inv);
  const method = inv.tenders?.length ? (inv.tenders.some((x: any) => x.method !== "CASH") ? "48" : "10") : "30";
  return {
    number: inv.number,
    uuid: inv.uuid,
    issueDate: date,
    issueTime: time,
    typeCode: inv.kind === "CREDIT_NOTE" ? "381" : inv.kind === "DEBIT_NOTE" ? "383" : "388",
    simplified: inv.invoiceType === "SIMPLIFIED",
    icv: inv.icv || 0,
    pih: inv.pih || cfg.lastHash,
    supplier: {
      name: company.nameAr, vat: company.vatNumber, cr: company.crNumber, street: company.street, buildingNo: company.buildingNo,
      additionalNo: company.additionalNo, district: company.district, city: company.city, postalCode: company.postalCode, country: company.country,
    },
    customer: inv.partner
      ? { name: inv.partner.name, vat: inv.partner.vatNumber, cr: inv.partner.crNumber, street: inv.partner.street, buildingNo: inv.partner.buildingNo, district: inv.partner.district, city: inv.partner.city, postalCode: inv.partner.postalCode, country: inv.partner.country }
      : inv.invoiceType === "SIMPLIFIED" ? null : { name: inv.partnerName || "عميل", vat: inv.partnerVat },
    billingReference: origin?.number || null,
    reason: inv.reason,
    paymentMeans: method,
    lines: lines.map((l, i) => ({
      id: i + 1, name: l.description, qty: Number(l.qty), unitPrice: Number(l.qty) ? r2(D(l.netAmount).div(l.qty)) : 0,
      discount: 0, net: Number(l.netAmount), vat: Number(l.vatAmount), taxCode: l.taxCode === "X" ? "Z" : l.taxCode, rate: Number(l.taxRate),
    })),
    subtotal: Number(inv.taxable),
    taxable: Number(inv.taxable),
    vatTotal: Number(inv.vatTotal),
    total: Number(inv.total),
  };
}

export async function stampInvoice(t: Db, company: any, invoiceId: string) {
  const inv = await t.one(`SELECT * FROM invoices WHERE id=$1 FOR UPDATE`, [invoiceId]);
  if (inv.direction !== "SALE" || inv.status !== "POSTED") return;
  const cfg = await t.one(`SELECT * FROM zatca_configs WHERE company_id=$1 FOR UPDATE`, [company.id]).catch(async () => ensureZatcaConfig(t, company.id));
  const lines = await t.rows(`SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY sort`, [invoiceId]);
  inv.partner = inv.partnerId ? await t.maybe(`SELECT * FROM partners WHERE id=$1`, [inv.partnerId]) : null;
  const origin = inv.originId ? await t.maybe(`SELECT number FROM invoices WHERE id=$1`, [inv.originId]) : null;
  const { date, time } = tsOf(inv);
  const ts = `${date}T${time}Z`;
  const qrFields = { sellerName: company.nameAr, vat: company.vatNumber || "", timestamp: ts, total: Number(inv.total).toFixed(2), vatTotal: Number(inv.vatTotal).toFixed(2) };

  if (Number(cfg.phase) < 2) {
    const qr = phase1Qr(qrFields.sellerName, qrFields.vat, ts, qrFields.total, qrFields.vatTotal);
    await t.exec(`UPDATE invoices SET qr=$2, zatca_status='NOT_REQUIRED' WHERE id=$1`, [invoiceId, qr]);
    return;
  }

  // phase 2 — sequential counter + hash chain
  const icv = Number(cfg.icvCounter) + 1;
  inv.icv = icv;
  inv.pih = cfg.lastHash;
  const ubl = invoiceToUbl(company, inv, lines, cfg, origin);
  const unsigned = buildInvoiceXml(ubl);
  const cert = cfg.productionCert || cfg.complianceCert;
  const secret = cfg.productionCert ? cfg.productionSecret : cfg.complianceSecret;
  let xml = unsigned, hash: string, qr: string, status: string, response: any = null;
  if (cert && cfg.privateKey) {
    const s = signInvoice(unsigned, cert, cfg.privateKey, qrFields);
    xml = s.xml;
    hash = s.hash;
    qr = s.qr;
    status = "PENDING"; // signed; submitted right after commit (submitInvoice) or from the ZATCA screen
  } else {
    hash = invoiceHash(unsigned);
    qr = phase1Qr(qrFields.sellerName, qrFields.vat, ts, qrFields.total, qrFields.vatTotal);
    status = "NOT_ONBOARDED"; // no certificate yet — signed & submitted later after onboarding
    response = { note: "لم يتم ربط الجهاز بالهيئة بعد — سيتم التوقيع والإرسال بعد الاعتماد" };
  }
  await t.exec(`UPDATE zatca_configs SET icv_counter=$2, last_hash=$3, updated_at=now() WHERE company_id=$1`, [company.id, icv, hash!]);
  await t.exec(
    `UPDATE invoices SET icv=$2, pih=$3, invoice_hash=$4, qr=$5, xml=$6, zatca_status=$7, zatca_response=$8 WHERE id=$1`,
    [invoiceId, icv, cfg.lastHash, hash!, qr!, xml, status, JSON.stringify(response)],
  );
}

/** Submits (or re-submits) a stamped invoice to ZATCA. Runs in its own transaction; safe to retry. */
export async function submitInvoice(company: any, invoiceId: string) {
  return tx(async (t) => {
    const inv = await t.one(`SELECT * FROM invoices WHERE id=$1 AND company_id=$2 FOR UPDATE`, [invoiceId, company.id]);
    const cfg = await t.one(`SELECT * FROM zatca_configs WHERE company_id=$1`, [company.id]);
    if (!inv.xml || !inv.invoiceHash) throw new Error("الفاتورة بلا XML");
    if (["REPORTED", "CLEARED"].includes(inv.zatcaStatus)) return { status: inv.zatcaStatus, response: inv.zatcaResponse };
    const cert = cfg.productionCert || cfg.complianceCert;
    const secret = cfg.productionCert ? cfg.productionSecret : cfg.complianceSecret;
    if (!cert || !cfg.privateKey) throw new Error("لم يتم ربط الجهاز بالهيئة بعد (لا توجد شهادة)");
    let xml = inv.xml;
    if (!xml.includes("<ds:SignatureValue>")) {
      const { date, time } = tsOf(inv);
      const s = signInvoice(xml, cert, cfg.privateKey, { sellerName: company.nameAr, vat: company.vatNumber || "", timestamp: `${date}T${time}Z`, total: Number(inv.total).toFixed(2), vatTotal: Number(inv.vatTotal).toFixed(2) });
      xml = s.xml;
      await t.exec(`UPDATE invoices SET qr=$2, xml=$3 WHERE id=$1`, [invoiceId, s.qr, xml]);
    }
    const simplified = inv.invoiceType === "SIMPLIFIED";
    let status: string, data: any;
    try {
      const r = await submit(cfg.environment, cert, secret, simplified, xml, inv.invoiceHash, inv.uuid);
      data = r.data;
      const st = (r.data?.reportingStatus || r.data?.clearanceStatus || "").toUpperCase();
      status = r.status === 200 ? (st.includes("REPORTED") || st.includes("CLEARED") ? (simplified ? "REPORTED" : "CLEARED") : "WARNING") : r.status === 202 ? "WARNING" : "REJECTED";
      if (!simplified && r.status === 200 && r.data?.clearedInvoice) xml = Buffer.from(r.data.clearedInvoice, "base64").toString();
    } catch (e: any) {
      status = "FAILED";
      data = { error: e.message };
    }
    await t.exec(`UPDATE invoices SET xml=$2, zatca_status=$3, zatca_response=$4 WHERE id=$1`, [invoiceId, xml, status, JSON.stringify(data)]);
    return { status, response: data };
  });
}
