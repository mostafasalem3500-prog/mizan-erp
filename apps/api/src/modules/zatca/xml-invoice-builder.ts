/**
 * Sprint 30 — the first real step toward ZATCA Phase 2 XML (spec bands
 * 60-91 / Invoice Studio). Built directly from ZATCA's own "Electronic
 * Invoice XML Implementation Standard v1.2" (fetched and read in this
 * session), not from general UBL knowledge — every tag path and business
 * rule ID referenced below (BR-*, BR-KSA-*) is cited so future work can
 * check this against the source document again.
 *
 * SCOPE — what this covers and what it deliberately does NOT:
 * - Covers exactly one document: a Simplified Tax Invoice (BT-3=388,
 *   KSA-2 subtype "02") for a domestic, non-export, non-summary,
 *   non-third-party, non-nominal, non-self-billed sale — i.e. the
 *   ordinary POS/Sales Simple Mode transaction this codebase already
 *   posts. InvoiceTypeCode name is therefore always "0200000"
 *   (BR-KSA-06: NN=02, P=0, N=0, E=0, S=0, B=0).
 * - Covers VAT categories S (standard), Z (zero-rated), E (exempt), and
 *   O (not subject to VAT) — the four TAX_RATE_BY_CODE values already
 *   used by Sales/POS (STANDARD/ZERO/EXEMPT/OUT_OF_SCOPE).
 * - Does NOT cover: credit/debit notes, allowances/charges (BG-20/21),
 *   prepayments, export invoices, summary invoices — none of these
 *   exist in Simple Mode. Sprint 31 added the full (non-simplified) Tax
 *   Invoice variant with buyer details via buildTaxInvoiceXml() —
 *   see that function's own comment for what changes.
 * - Does NOT include the cryptographic stamp (cac:Signature, BR-KSA-28
 *   through 30) or a real chained Previous Invoice Hash (BR-KSA-26) —
 *   both require a genuine ZATCA CSID from the onboarding flow, which
 *   this Phase 0 build has never had credentials to complete. The
 *   Previous Invoice Hash field is populated with the spec's own
 *   documented placeholder for "no prior invoice" (BR-KSA-26's example:
 *   base64-encoded SHA-256 of the character "0"), independently
 *   recomputed and verified byte-for-byte against the spec's stated
 *   value before being hardcoded here — not a chain of real prior
 *   invoice hashes, since this build has no persistent invoice ledger.
 *
 * This is a document GENERATOR, not a validator — it does not run the
 * schematron rules against its own output. Treat its output as a
 * structural draft to be validated against ZATCA's actual XSD/
 * schematron files before ever being used for real submission.
 */

export type ZatcaVatCategory = "S" | "Z" | "E" | "O";

export interface ZatcaInvoiceLine {
  id: string; // BT-126, sequential line identifier
  description: string; // BT-153, cac:Item/cbc:Name
  quantity: number; // BT-129
  unitCode: string; // e.g. "PCE" — UN/ECE Rec 20 unit of measure code
  unitPrice: number; // BT-146, cac:Price/cbc:PriceAmount
  taxCategory: ZatcaVatCategory; // BT-151
  taxPercent: number; // BT-152 — 0 for Z/E, the real rate for S
  lineExtensionAmount: string; // BT-131, pre-computed by the caller (Simple Mode: quantity * unitPrice, no allowances/charges)
  lineTaxAmount: string; // KSA-11 — VAT amount for this line
}

export interface ZatcaSellerInfo {
  registrationName: string; // BT-27
  vatNumber: string; // BT-31 — must be 15 digits, first and last "3" (BR-KSA-40)
  commercialRegistrationNumber?: string; // BT-29, schemeID="CRN" (BR-KSA-08)
  streetName: string; // BT-35
  buildingNumber: string; // KSA-17 — must be exactly 4 digits (BR-KSA-37)
  city: string; // BT-37
  postalZone: string; // BT-38 — must be exactly 5 digits (BR-KSA-66)
  district: string; // KSA-3
  countryCode: string; // BT-40 — ISO 3166-1 alpha-2, "SA" for domestic
}

export interface ZatcaBuyerInfo {
  registrationName: string; // BT-44 — mandatory for a (non-simplified) Tax Invoice, BR-KSA-42
  vatNumber?: string; // BT-48 — 15 digits, first/last "3" if present (BR-KSA-44), required unless another buyer ID scheme is used
  streetName: string; // BT-50 — required for Tax Invoice (BR-10)
  buildingNumber?: string; // KSA-18 — required if buyer country is SA (BR-KSA-63)
  city: string; // BT-52
  postalZone?: string; // BT-53 — required, 5 digits, if buyer country is SA (BR-KSA-67)
  district?: string; // KSA-4 — required if buyer country is SA (BR-KSA-63)
  countryCode: string; // BT-55 — ISO 3166-1 alpha-2
}

export interface ZatcaSimplifiedInvoiceInput {
  uuid: string; // KSA-1 — BR-KSA-03
  invoiceNumber: string; // BT-1
  issueDate: string; // YYYY-MM-DD — BR-KSA-F-01
  issueTime: string; // hh:mm:ss — BR-KSA-70
  invoiceCounterValue: string; // KSA-16 — digits only, BR-KSA-33/34
  seller: ZatcaSellerInfo;
  lines: ZatcaInvoiceLine[];
  lineExtensionAmountTotal: string; // BT-106
  taxExclusiveAmount: string; // BT-109
  taxInclusiveAmount: string; // BT-112
  payableAmount: string; // BT-115
  taxAmountTotal: string; // BT-110, in SAR (BR-KSA-EN16931-02: tax currency is always SAR)
  taxSubtotals: Array<{ taxableAmount: string; taxAmount: string; category: ZatcaVatCategory; percent: number }>;
  /** Base64 of the TLV QR bytes (same payload verified in qr-encoder.ts) — embedded per BR-KSA-27. */
  qrCodeBase64: string;
  /**
   * Base64-encoded SHA-256 of the previous invoice's canonical XML
   * (BR-KSA-26). Defaults to the spec's own documented "first invoice"
   * placeholder — see the module-level comment above for why a real
   * chain isn't implemented yet.
   */
  previousInvoiceHash?: string;
}

/** BR-KSA-26's documented placeholder for the very first invoice — base64(SHA-256("0")), independently verified in this session. */
export const ZATCA_FIRST_INVOICE_HASH_PLACEHOLDER =
  "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==";

/** Escapes the five XML-significant characters — every free-text field (names, descriptions) must pass through this. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildInvoiceLineXml(line: ZatcaInvoiceLine): string {
  return `  <cac:InvoiceLine>
    <cbc:ID>${xmlEscape(line.id)}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${xmlEscape(line.unitCode)}">${line.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="SAR">${line.lineExtensionAmount}</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="SAR">${line.lineTaxAmount}</cbc:TaxAmount>
      <cbc:RoundingAmount currencyID="SAR">${round2Add(line.lineExtensionAmount, line.lineTaxAmount)}</cbc:RoundingAmount>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>${xmlEscape(line.description)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${line.taxCategory}</cbc:ID>
        <cbc:Percent>${line.taxPercent.toFixed(2)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="SAR">${line.unitPrice.toFixed(2)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
}

function round2Add(a: string, b: string): string {
  return (Number(a) + Number(b)).toFixed(2); // KSA-12 = BT-131 + KSA-11 (BR-KSA-51)
}

function buildTaxSubtotalXml(sub: ZatcaSimplifiedInvoiceInput["taxSubtotals"][number]): string {
  return `    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="SAR">${sub.taxableAmount}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="SAR">${sub.taxAmount}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${sub.category}</cbc:ID>
        <cbc:Percent>${sub.percent.toFixed(2)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`;
}

/**
 * Builds a ZATCA-compliant Simplified Tax Invoice as UBL 2.1 XML.
 * See the module-level comment for exact scope and known limitations.
 */
export function buildSimplifiedTaxInvoiceXml(input: ZatcaSimplifiedInvoiceInput): string {
  return buildInvoiceXmlCore(input, "02", undefined);
}

/**
 * Sprint 31 — builds a full (non-simplified) Tax Invoice, the B2B
 * counterpart to buildSimplifiedTaxInvoiceXml(). Per BR-KSA-06 the
 * subtype changes to "01", and per BR-10/BR-KSA-42/BR-KSA-63 the buyer's
 * registration name and postal address become mandatory (they are
 * explicitly NOT required — and omitted — for the Simplified variant).
 * Everything else (seller block, lines, VAT breakdown, QR, PIH
 * placeholder, all the same documented limitations) is identical to the
 * Simplified builder; only the type code and buyer block differ, per
 * the spec itself (chapter 5.2's table: both share the same UBL
 * "Invoice" message type and the same set of mandatory seller/line/
 * total fields — Tax Invoice adds the buyer block on top).
 */
export function buildTaxInvoiceXml(input: ZatcaSimplifiedInvoiceInput & { buyer: ZatcaBuyerInfo }): string {
  return buildInvoiceXmlCore(input, "01", input.buyer);
}

function buildBuyerPartyXml(buyer: ZatcaBuyerInfo): string {
  const idBlock = buyer.vatNumber
    ? `      <cac:PartyTaxScheme>
        <cbc:CompanyID>${xmlEscape(buyer.vatNumber)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>\n`
    : "";
  return `  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PostalAddress>
        <cbc:StreetName>${xmlEscape(buyer.streetName)}</cbc:StreetName>
        ${buyer.buildingNumber ? `<cbc:BuildingNumber>${xmlEscape(buyer.buildingNumber)}</cbc:BuildingNumber>` : ""}
        <cbc:CityName>${xmlEscape(buyer.city)}</cbc:CityName>
        ${buyer.postalZone ? `<cbc:PostalZone>${xmlEscape(buyer.postalZone)}</cbc:PostalZone>` : ""}
        ${buyer.district ? `<cbc:CitySubdivisionName>${xmlEscape(buyer.district)}</cbc:CitySubdivisionName>` : ""}
        <cac:Country>
          <cbc:IdentificationCode>${xmlEscape(buyer.countryCode)}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
${idBlock}      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${xmlEscape(buyer.registrationName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>`;
}

function buildInvoiceXmlCore(input: ZatcaSimplifiedInvoiceInput, subtype: "01" | "02", buyer: ZatcaBuyerInfo | undefined): string {
  const previousInvoiceHash = input.previousInvoiceHash ?? ZATCA_FIRST_INVOICE_HASH_PLACEHOLDER;
  const linesXml = input.lines.map(buildInvoiceLineXml).join("\n");
  const taxSubtotalsXml = input.taxSubtotals.map(buildTaxSubtotalXml).join("\n");
  const invoiceTypeName = `${subtype}00000`; // BR-KSA-06: NN + 5 flags, all "0" for an ordinary transaction
  const buyerXml = buyer ? `\n${buildBuyerPartyXml(buyer)}` : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${xmlEscape(input.invoiceNumber)}</cbc:ID>
  <cbc:UUID>${xmlEscape(input.uuid)}</cbc:UUID>
  <cbc:IssueDate>${input.issueDate}</cbc:IssueDate>
  <cbc:IssueTime>${input.issueTime}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${invoiceTypeName}">388</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>
  <cac:AdditionalDocumentReference>
    <cbc:ID>ICV</cbc:ID>
    <cbc:UUID>${xmlEscape(input.invoiceCounterValue)}</cbc:UUID>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${previousInvoiceHash}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>QR</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${input.qrCodeBase64}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="CRN">${xmlEscape(input.seller.commercialRegistrationNumber ?? "")}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PostalAddress>
        <cbc:StreetName>${xmlEscape(input.seller.streetName)}</cbc:StreetName>
        <cbc:BuildingNumber>${xmlEscape(input.seller.buildingNumber)}</cbc:BuildingNumber>
        <cbc:CityName>${xmlEscape(input.seller.city)}</cbc:CityName>
        <cbc:PostalZone>${xmlEscape(input.seller.postalZone)}</cbc:PostalZone>
        <cbc:CitySubdivisionName>${xmlEscape(input.seller.district)}</cbc:CitySubdivisionName>
        <cac:Country>
          <cbc:IdentificationCode>${xmlEscape(input.seller.countryCode)}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${xmlEscape(input.seller.vatNumber)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${xmlEscape(input.seller.registrationName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>${buyerXml}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="SAR">${input.taxAmountTotal}</cbc:TaxAmount>
${taxSubtotalsXml}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="SAR">${input.lineExtensionAmountTotal}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="SAR">${input.taxExclusiveAmount}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="SAR">${input.taxInclusiveAmount}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="SAR">${input.payableAmount}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${linesXml}
</Invoice>`;
}

/**
 * Validates a seller's VAT number against BR-KSA-40: exactly 15 digits,
 * first and last digit must be "3". Exported so callers (and tests) can
 * check seller data before attempting to build XML from it, rather than
 * discovering the problem only after generating malformed output.
 */
export function isValidSaudiVatNumber(vatNumber: string): boolean {
  return /^3\d{13}3$/.test(vatNumber);
}

/** Validates BR-KSA-37: the seller building number must be exactly 4 digits. */
export function isValidBuildingNumber(buildingNumber: string): boolean {
  return /^\d{4}$/.test(buildingNumber);
}

/** Validates BR-KSA-66: the seller postal code must be exactly 5 digits. */
export function isValidPostalZone(postalZone: string): boolean {
  return /^\d{5}$/.test(postalZone);
}
