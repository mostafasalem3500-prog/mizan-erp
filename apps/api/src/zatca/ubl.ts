/**
 * UBL 2.1 XML for ZATCA e-invoices (standard & simplified; invoice / credit / debit note).
 * Layout follows the ZATCA XML Implementation Standard v1.2 and the widely-used
 * zatca-xml-js reference so the hash/signature path matches the ZATCA SDK.
 */
const esc = (v: any) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const f2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export interface UblParty {
  name: string;
  vat?: string | null;
  cr?: string | null;
  street?: string | null;
  buildingNo?: string | null;
  additionalNo?: string | null;
  district?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

export interface UblLine {
  id: number;
  name: string;
  qty: number;
  unitPrice: number; // tax-exclusive net unit price after discount
  discount: number; // line discount amount (tax exclusive)
  net: number;
  vat: number;
  taxCode: string; // S Z E O
  rate: number;
}

export interface UblInvoice {
  number: string;
  uuid: string;
  issueDate: string; // YYYY-MM-DD
  issueTime: string; // HH:mm:ss
  typeCode: "388" | "381" | "383";
  simplified: boolean;
  icv: number;
  pih: string;
  supplier: UblParty;
  customer?: UblParty | null;
  billingReference?: string | null;
  reason?: string | null;
  paymentMeans: string; // 10 cash, 30 credit, 42 bank, 48 card
  lines: UblLine[];
  subtotal: number; // Σ net + discount (line extension before doc-level)
  taxable: number;
  vatTotal: number;
  total: number;
  prepaid?: number;
}

const EXEMPT_REASON: Record<string, { code: string; text: string }> = {
  Z: { code: "VATEX-SA-32", text: "Export of goods" },
  E: { code: "VATEX-SA-29", text: "Financial services mentioned in Article 29 of the VAT Regulations" },
  O: { code: "VATEX-SA-OOS", text: "Not subject to VAT" },
};

function party(p: UblParty, isSupplier: boolean) {
  const idBlock = p.cr
    ? `
      <cac:PartyIdentification>
        <cbc:ID schemeID="CRN">${esc(p.cr)}</cbc:ID>
      </cac:PartyIdentification>`
    : "";
  const taxBlock = p.vat
    ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(p.vat)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>`
    : `
      <cac:PartyTaxScheme>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>`;
  return `
    <cac:Party>${idBlock}
      <cac:PostalAddress>
        <cbc:StreetName>${esc(p.street || "-")}</cbc:StreetName>
        <cbc:BuildingNumber>${esc(p.buildingNo || "0000")}</cbc:BuildingNumber>
        <cbc:PlotIdentification>${esc(p.additionalNo || "0000")}</cbc:PlotIdentification>
        <cbc:CitySubdivisionName>${esc(p.district || "-")}</cbc:CitySubdivisionName>
        <cbc:CityName>${esc(p.city || "-")}</cbc:CityName>
        <cbc:PostalZone>${esc(p.postalCode || "00000")}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>${esc(p.country || "SA")}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>${taxBlock}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(p.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>`;
}

export function buildInvoiceXml(inv: UblInvoice): string {
  const typeName = inv.simplified ? "0200000" : "0100000";
  const billing = inv.billingReference
    ? `
    <cac:BillingReference>
        <cac:InvoiceDocumentReference>
            <cbc:ID>${esc(inv.billingReference)}</cbc:ID>
        </cac:InvoiceDocumentReference>
    </cac:BillingReference>`
    : "";
  const customer = inv.customer
    ? `
    <cac:AccountingCustomerParty>${party(inv.customer, false)}
    </cac:AccountingCustomerParty>`
    : `
    <cac:AccountingCustomerParty>
    </cac:AccountingCustomerParty>`;
  const note = inv.typeCode !== "388" && inv.reason ? `
        <cbc:InstructionNote>${esc(inv.reason)}</cbc:InstructionNote>` : "";

  // tax subtotals grouped by category+rate
  const groups = new Map<string, { code: string; rate: number; taxable: number; vat: number }>();
  for (const l of inv.lines) {
    const k = `${l.taxCode}:${l.rate}`;
    const g = groups.get(k) || { code: l.taxCode, rate: l.rate, taxable: 0, vat: 0 };
    g.taxable += l.net;
    g.vat += l.vat;
    groups.set(k, g);
  }
  const subtotals = [...groups.values()]
    .map((g) => {
      const ex = g.code !== "S" ? EXEMPT_REASON[g.code] || EXEMPT_REASON.O : null;
      return `
        <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="SAR">${f2(g.taxable)}</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="SAR">${f2(g.vat)}</cbc:TaxAmount>
            <cac:TaxCategory>
                <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5305">${g.code}</cbc:ID>
                <cbc:Percent>${f2(g.rate)}</cbc:Percent>${ex ? `
                <cbc:TaxExemptionReasonCode>${ex.code}</cbc:TaxExemptionReasonCode>
                <cbc:TaxExemptionReason>${ex.text}</cbc:TaxExemptionReason>` : ""}
                <cac:TaxScheme>
                    <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5153">VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:TaxCategory>
        </cac:TaxSubtotal>`;
    })
    .join("");

  const lines = inv.lines
    .map(
      (l) => `
    <cac:InvoiceLine>
        <cbc:ID>${l.id}</cbc:ID>
        <cbc:InvoicedQuantity unitCode="PCE">${l.qty}</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID="SAR">${f2(l.net)}</cbc:LineExtensionAmount>${l.discount > 0 ? `
        <cac:AllowanceCharge>
            <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
            <cbc:AllowanceChargeReason>discount</cbc:AllowanceChargeReason>
            <cbc:Amount currencyID="SAR">${f2(l.discount)}</cbc:Amount>
            <cac:TaxCategory>
                <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5305">${l.taxCode}</cbc:ID>
                <cbc:Percent>${f2(l.rate)}</cbc:Percent>
                <cac:TaxScheme>
                    <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5153">VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:TaxCategory>
        </cac:AllowanceCharge>` : ""}
        <cac:TaxTotal>
            <cbc:TaxAmount currencyID="SAR">${f2(l.vat)}</cbc:TaxAmount>
            <cbc:RoundingAmount currencyID="SAR">${f2(l.net + l.vat)}</cbc:RoundingAmount>
        </cac:TaxTotal>
        <cac:Item>
            <cbc:Name>${esc(l.name)}</cbc:Name>
            <cac:ClassifiedTaxCategory>
                <cbc:ID>${l.taxCode}</cbc:ID>
                <cbc:Percent>${f2(l.rate)}</cbc:Percent>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:ClassifiedTaxCategory>
        </cac:Item>
        <cac:Price>
            <cbc:PriceAmount currencyID="SAR">${(Math.round(l.unitPrice * 10000) / 10000).toString()}</cbc:PriceAmount>
        </cac:Price>
    </cac:InvoiceLine>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"><ext:UBLExtensions>SET_UBL_EXTENSIONS_STRING</ext:UBLExtensions>

    <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
    <cbc:ID>${esc(inv.number)}</cbc:ID>
    <cbc:UUID>${inv.uuid}</cbc:UUID>
    <cbc:IssueDate>${inv.issueDate}</cbc:IssueDate>
    <cbc:IssueTime>${inv.issueTime}</cbc:IssueTime>
    <cbc:InvoiceTypeCode name="${typeName}">${inv.typeCode}</cbc:InvoiceTypeCode>
    <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
    <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>${billing}
    <cac:AdditionalDocumentReference>
        <cbc:ID>ICV</cbc:ID>
        <cbc:UUID>${inv.icv}</cbc:UUID>
    </cac:AdditionalDocumentReference>
    <cac:AdditionalDocumentReference>
        <cbc:ID>PIH</cbc:ID>
        <cac:Attachment>
            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${inv.pih}</cbc:EmbeddedDocumentBinaryObject>
        </cac:Attachment>
    </cac:AdditionalDocumentReference>
    <cac:AdditionalDocumentReference>
        <cbc:ID>QR</cbc:ID>
        <cac:Attachment>
            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">SET_QR_CODE_DATA</cbc:EmbeddedDocumentBinaryObject>
        </cac:Attachment>
    </cac:AdditionalDocumentReference>
    <cac:Signature>
        <cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID>
        <cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod>
    </cac:Signature>
    <cac:AccountingSupplierParty>${party(inv.supplier, true)}
    </cac:AccountingSupplierParty>${customer}
    <cac:Delivery>
        <cbc:ActualDeliveryDate>${inv.issueDate}</cbc:ActualDeliveryDate>
    </cac:Delivery>
    <cac:PaymentMeans>
        <cbc:PaymentMeansCode>${inv.paymentMeans}</cbc:PaymentMeansCode>${note}
    </cac:PaymentMeans>
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="SAR">${f2(inv.vatTotal)}</cbc:TaxAmount>${subtotals}
    </cac:TaxTotal>
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="SAR">${f2(inv.vatTotal)}</cbc:TaxAmount>
    </cac:TaxTotal>
    <cac:LegalMonetaryTotal>
        <cbc:LineExtensionAmount currencyID="SAR">${f2(inv.taxable)}</cbc:LineExtensionAmount>
        <cbc:TaxExclusiveAmount currencyID="SAR">${f2(inv.taxable)}</cbc:TaxExclusiveAmount>
        <cbc:TaxInclusiveAmount currencyID="SAR">${f2(inv.total)}</cbc:TaxInclusiveAmount>
        <cbc:AllowanceTotalAmount currencyID="SAR">0.00</cbc:AllowanceTotalAmount>
        <cbc:PrepaidAmount currencyID="SAR">${f2(inv.prepaid || 0)}</cbc:PrepaidAmount>
        <cbc:PayableAmount currencyID="SAR">${f2(inv.total - (inv.prepaid || 0))}</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>${lines}
</Invoice>`;
}
