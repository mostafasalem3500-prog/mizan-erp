/**
 * End-to-end self-test against ZATCA's developer portal (no real OTP needed: the portal accepts 123345).
 * Generates a throw-away key + CSR, obtains a compliance CSID, then builds, signs and submits the six
 * document types required for onboarding (standard / simplified × invoice / credit note / debit note)
 * to the compliance-check endpoint, and finally requests a (test) production CSID.
 * Nothing here touches the company's real e-invoicing configuration, counters or invoices.
 */
import { randomUUID } from "crypto";
import { buildInvoiceXml, UblInvoice, UblParty } from "./ubl";
import { generateKeyPair, generateCsr, signInvoice, certificateInfo } from "./crypto";
import { issueComplianceCsid, complianceCheck, issueProductionCsid, ZATCA_BASE } from "./api";

const FIRST_PIH = "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==";
const SANDBOX_OTP = "123345";
const r2 = (n: number) => Math.round(n * 100) / 100;
const digits = (v: any, n: number) => (new RegExp(`^\\d{${n}}$`).test(String(v || "")) ? String(v) : null);

export interface SelfTestDoc { name: string; typeCode: string; simplified: boolean; httpStatus?: number; status: string; ok: boolean; errors: string[]; warnings: string[]; info?: number; }
export interface SelfTestResult { ok: boolean; environment: string; startedAt: string; finishedAt?: string; usedCompanyData: boolean; notes: string[]; steps: { name: string; ok: boolean; detail?: string }[]; docs: SelfTestDoc[]; }

const msgs = (arr: any) => (Array.isArray(arr) ? arr.map((m: any) => `${m.code || ""} ${m.message || ""}`.trim()).filter(Boolean) : []);

export async function runZatcaSelfTest(company: any, opts: { env?: "SANDBOX" | "SIMULATION"; otp?: string } = {}): Promise<SelfTestResult> {
  const env = opts.env || "SANDBOX";
  const res: SelfTestResult = { ok: false, environment: env, startedAt: new Date().toISOString(), usedCompanyData: true, notes: [], steps: [], docs: [] };
  const step = (name: string, ok: boolean, detail?: string) => res.steps.push({ name, ok, detail });

  // seller data: the company's own when it is complete and well-formed, otherwise documented sample values
  const vatOk = /^3\d{13}3$/.test(String(company.vatNumber || ""));
  if (!vatOk) { res.usedCompanyData = false; res.notes.push("الرقم الضريبي للمنشأة غير مكتمل أو بصيغة غير صحيحة — استُخدم رقم اختبار 399999999900003"); }
  const supplier: UblParty = {
    name: company.nameAr || "Mizan Test", vat: vatOk ? company.vatNumber : "399999999900003", cr: digits(company.crNumber, 10) || "1010010000",
    street: company.street || "شارع الملك فهد", buildingNo: digits(company.buildingNo, 4) || "1234", additionalNo: digits(company.additionalNo, 4) || "5678",
    district: company.district || "العزيزية", city: company.city || "مكة المكرمة", postalCode: digits(company.postalCode, 5) || "24243", country: "SA",
  };
  if (!digits(company.buildingNo, 4) || !digits(company.postalCode, 5)) res.notes.push("رقم المبنى (4 أرقام) أو الرمز البريدي (5 أرقام) غير مكتمل في بيانات المنشأة — استُخدمت قيم اختبار؛ أكملها قبل الربط الفعلي");
  const buyerVat = supplier.vat === "311111111111113" ? "322222222222223" : "311111111111113"; // must differ from the seller (BR-CUSTOM-VALIDATION-01)
  const buyer: UblParty = { name: "شركة العميل التجريبي", vat: buyerVat, cr: "1010000000", street: "طريق الملك عبدالعزيز", buildingNo: "2222", additionalNo: "1111", district: "الروضة", city: "جدة", postalCode: "23435", country: "SA" };

  try {
    // 1) key + CSR
    const key = await generateKeyPair();
    const egs = randomUUID();
    const csr = await generateCsr(key, {
      commonName: `Mizan-SelfTest-${egs.slice(0, 8)}`, serial: `1-Mizan|2-2.0|3-${egs}`, vat: supplier.vat!, orgName: supplier.name,
      branchName: "Main", location: `${supplier.buildingNo} ${supplier.street} ${supplier.city}`, industry: "Trading", production: false, env, invoiceTypes: "1100",
    });
    step("توليد المفتاح الخاص وطلب الشهادة (CSR)", true, "secp256k1 / " + (env === "SANDBOX" ? "TSTZATCA-Code-Signing" : "PREZATCA-Code-Signing"));

    // 2) compliance CSID
    let comp: { cert: string; secret: string; requestId: string };
    try {
      comp = await issueComplianceCsid(env, csr, opts.otp || SANDBOX_OTP);
      const info = certificateInfo(comp.cert);
      step("إصدار شهادة الامتثال (Compliance CSID)", true, `requestID ${comp.requestId} — صالحة حتى ${info.validTo}`);
    } catch (e: any) {
      step("إصدار شهادة الامتثال (Compliance CSID)", false, e.message);
      throw e;
    }

    // 3) the six onboarding documents, chained by ICV / PIH exactly like real invoices
    const now = new Date();
    const date = now.toISOString().slice(0, 10), time = now.toISOString().slice(11, 19);
    const lines = [
      { id: 1, name: "صنف اختبار — كرتون مياه", qty: 2, unitPrice: 50, discount: 0, net: 100, vat: 15, taxCode: "S", rate: 15 },
      { id: 2, name: "صنف اختبار — خدمة توصيل", qty: 1, unitPrice: 30, discount: 0, net: 30, vat: 4.5, taxCode: "S", rate: 15 },
    ];
    const taxable = r2(lines.reduce((a, l) => a + l.net, 0)), vat = r2(lines.reduce((a, l) => a + l.vat, 0));
    const DOCS: { name: string; typeCode: "388" | "381" | "383"; simplified: boolean }[] = [
      { name: "فاتورة ضريبية (قياسية)", typeCode: "388", simplified: false },
      { name: "إشعار دائن (قياسي)", typeCode: "381", simplified: false },
      { name: "إشعار مدين (قياسي)", typeCode: "383", simplified: false },
      { name: "فاتورة ضريبية مبسطة", typeCode: "388", simplified: true },
      { name: "إشعار دائن (مبسط)", typeCode: "381", simplified: true },
      { name: "إشعار مدين (مبسط)", typeCode: "383", simplified: true },
    ];
    let pih = FIRST_PIH;
    for (const [i, d] of DOCS.entries()) {
      const ubl: UblInvoice = {
        number: `SELFTEST-${i + 1}`, uuid: randomUUID(), issueDate: date, issueTime: time, typeCode: d.typeCode, simplified: d.simplified,
        icv: i + 1, pih, supplier, customer: d.simplified ? null : buyer,
        billingReference: d.typeCode === "388" ? null : "SELFTEST-1", reason: d.typeCode === "388" ? null : d.typeCode === "381" ? "إرجاع بضاعة" : "تعديل سعر",
        paymentMeans: d.simplified ? "10" : "30", lines, subtotal: taxable, taxable, vatTotal: vat, total: r2(taxable + vat),
      };
      const doc: SelfTestDoc = { name: d.name, typeCode: d.typeCode, simplified: d.simplified, status: "", ok: false, errors: [], warnings: [] };
      try {
        const signed = signInvoice(buildInvoiceXml(ubl), comp.cert, key, { sellerName: supplier.name, vat: supplier.vat!, timestamp: `${date}T${time}`, total: ubl.total.toFixed(2), vatTotal: vat.toFixed(2) });
        pih = signed.hash;
        const r = await complianceCheck(env, comp.cert, comp.secret, signed.xml, signed.hash, ubl.uuid);
        const v = r.data?.validationResults || {};
        doc.httpStatus = r.status;
        doc.status = String(r.data?.reportingStatus || r.data?.clearanceStatus || v.status || r.data?.message || r.status);
        doc.errors = msgs(v.errorMessages);
        doc.warnings = msgs(v.warningMessages);
        doc.info = Array.isArray(v.infoMessages) ? v.infoMessages.length : 0;
        if (!v.errorMessages && r.status >= 400) doc.errors.push(JSON.stringify(r.data).slice(0, 300));
        doc.ok = (r.status === 200 || r.status === 202) && !doc.errors.length;
      } catch (e: any) {
        doc.status = "EXCEPTION";
        doc.errors.push(e.message);
      }
      res.docs.push(doc);
    }
    const passed = res.docs.filter((d) => d.ok).length;
    step("فحص الامتثال للمستندات الستة", passed === res.docs.length, `${passed}/${res.docs.length} مقبولة`);

    // 4) production CSID (only meaningful once all six passed)
    if (passed === res.docs.length) {
      try {
        const prod = await issueProductionCsid(env, comp.cert, comp.secret, comp.requestId);
        step("إصدار شهادة الإنتاج (Production CSID)", true, `requestID ${prod.requestId}`);
      } catch (e: any) {
        step("إصدار شهادة الإنتاج (Production CSID)", false, e.message);
      }
    }
  } catch (e: any) {
    if (!res.steps.some((s) => !s.ok)) step("خطأ غير متوقع", false, e.message);
  }
  res.ok = res.steps.length > 0 && res.steps.every((s) => s.ok);
  res.finishedAt = new Date().toISOString();
  res.notes.push(`الخادم: ${ZATCA_BASE[env]}`);
  return res;
}
