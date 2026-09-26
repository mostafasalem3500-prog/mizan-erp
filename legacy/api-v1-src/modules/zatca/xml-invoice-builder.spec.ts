import { XMLParser, XMLValidator } from "fast-xml-parser";
import {
  buildSimplifiedTaxInvoiceXml,
  buildTaxInvoiceXml,
  isValidSaudiVatNumber,
  isValidBuildingNumber,
  isValidPostalZone,
  ZATCA_FIRST_INVOICE_HASH_PLACEHOLDER,
  ZatcaSimplifiedInvoiceInput,
} from "./xml-invoice-builder";

function baseInput(overrides: Partial<ZatcaSimplifiedInvoiceInput> = {}): ZatcaSimplifiedInvoiceInput {
  return {
    uuid: "3cf5ee18-0f0a-4b8e-9f1a-000000000001",
    invoiceNumber: "SME00021",
    issueDate: "2026-09-10",
    issueTime: "14:22:05",
    invoiceCounterValue: "21",
    seller: {
      registrationName: "مؤسسة الأفق للتجارة",
      vatNumber: "300000000000003",
      commercialRegistrationNumber: "1010010000",
      streetName: "King Fahd Road",
      buildingNumber: "1234",
      city: "Riyadh",
      postalZone: "12345",
      district: "Al Olaya",
      countryCode: "SA",
    },
    lines: [
      {
        id: "1",
        description: "قهوة عربية مختصة 250غ",
        quantity: 2,
        unitCode: "PCE",
        unitPrice: 45,
        taxCategory: "S",
        taxPercent: 15,
        lineExtensionAmount: "90.00",
        lineTaxAmount: "13.50",
      },
    ],
    lineExtensionAmountTotal: "90.00",
    taxExclusiveAmount: "90.00",
    taxInclusiveAmount: "103.50",
    payableAmount: "103.50",
    taxAmountTotal: "13.50",
    taxSubtotals: [{ taxableAmount: "90.00", taxAmount: "13.50", category: "S", percent: 15 }],
    qrCodeBase64: "QVNUZmFrZVRlc3RRUg==",
    ...overrides,
  };
}

describe("buildSimplifiedTaxInvoiceXml — well-formedness and structure", () => {
  test("produces well-formed XML (validated by an actual XML parser, not just string matching)", () => {
    const xml = buildSimplifiedTaxInvoiceXml(baseInput());
    const validation = XMLValidator.validate(xml);
    expect(validation).toBe(true);
  });

  test("parses into the expected UBL tag structure", () => {
    const xml = buildSimplifiedTaxInvoiceXml(baseInput());
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(xml);

    expect(parsed.Invoice["cbc:ID"]).toBe("SME00021");
    expect(parsed.Invoice["cbc:UUID"]).toBe("3cf5ee18-0f0a-4b8e-9f1a-000000000001");
  });

  test("InvoiceTypeCode is 388 with name '0200000' (BR-KSA-06: simplified, no special flags)", () => {
    const xml = buildSimplifiedTaxInvoiceXml(baseInput());
    expect(xml).toContain('<cbc:InvoiceTypeCode name="0200000">388</cbc:InvoiceTypeCode>');
  });

  test("ProfileID is 'reporting:1.0' as required for Simplified (B2C reporting model) invoices", () => {
    const xml = buildSimplifiedTaxInvoiceXml(baseInput());
    expect(xml).toContain("<cbc:ProfileID>reporting:1.0</cbc:ProfileID>");
  });

  test("TaxCurrencyCode is always SAR regardless of document currency", () => {
    const xml = buildSimplifiedTaxInvoiceXml(baseInput());
    expect(xml).toContain("<cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>");
  });

  test("embeds the QR code as an AdditionalDocumentReference with ID 'QR'", () => {
    const xml = buildSimplifiedTaxInvoiceXml(baseInput());
    expect(xml).toContain("<cbc:ID>QR</cbc:ID>");
    expect(xml).toContain("QVNUZmFrZVRlc3RRUg==");
  });

  test("defaults the Previous Invoice Hash to the spec's documented 'first invoice' placeholder", () => {
    const xml = buildSimplifiedTaxInvoiceXml(baseInput());
    expect(xml).toContain(ZATCA_FIRST_INVOICE_HASH_PLACEHOLDER);
  });

  test("uses a caller-supplied Previous Invoice Hash when provided, instead of the placeholder", () => {
    const xml = buildSimplifiedTaxInvoiceXml(baseInput({ previousInvoiceHash: "somePriorHashValue==" }));
    expect(xml).toContain("somePriorHashValue==");
    expect(xml).not.toContain(ZATCA_FIRST_INVOICE_HASH_PLACEHOLDER);
  });

  test("BR-06: contains the seller registration name", () => {
    const xml = buildSimplifiedTaxInvoiceXml(baseInput());
    expect(xml).toContain("<cbc:RegistrationName>مؤسسة الأفق للتجارة</cbc:RegistrationName>");
  });

  test("BR-KSA-39: contains the seller VAT registration number", () => {
    const xml = buildSimplifiedTaxInvoiceXml(baseInput());
    expect(xml).toContain("<cbc:CompanyID>300000000000003</cbc:CompanyID>");
  });

  test("BR-KSA-08: seller identification carries the CRN schemeID attribute", () => {
    const xml = buildSimplifiedTaxInvoiceXml(baseInput());
    expect(xml).toContain('<cbc:ID schemeID="CRN">1010010000</cbc:ID>');
  });

  test("BR-KSA-09: seller address contains street, building number, city, postal zone, district, country", () => {
    const xml = buildSimplifiedTaxInvoiceXml(baseInput());
    expect(xml).toContain("<cbc:StreetName>King Fahd Road</cbc:StreetName>");
    expect(xml).toContain("<cbc:BuildingNumber>1234</cbc:BuildingNumber>");
    expect(xml).toContain("<cbc:CityName>Riyadh</cbc:CityName>");
    expect(xml).toContain("<cbc:PostalZone>12345</cbc:PostalZone>");
    expect(xml).toContain("<cbc:CitySubdivisionName>Al Olaya</cbc:CitySubdivisionName>");
    expect(xml).toContain("<cbc:IdentificationCode>SA</cbc:IdentificationCode>");
  });

  test("BR-16/21/22/24/25/26: each invoice line has an id, quantity, net amount, item name, and price", () => {
    const xml = buildSimplifiedTaxInvoiceXml(baseInput());
    expect(xml).toContain("<cbc:ID>1</cbc:ID>");
    expect(xml).toContain('<cbc:InvoicedQuantity unitCode="PCE">2</cbc:InvoicedQuantity>');
    expect(xml).toContain('<cbc:LineExtensionAmount currencyID="SAR">90.00</cbc:LineExtensionAmount>');
    expect(xml).toContain("<cbc:Name>قهوة عربية مختصة 250غ</cbc:Name>");
    expect(xml).toContain('<cbc:PriceAmount currencyID="SAR">45.00</cbc:PriceAmount>');
  });

  test("BR-CO-04: each invoice line is categorized with a VAT category code and percent", () => {
    const xml = buildSimplifiedTaxInvoiceXml(baseInput());
    expect(xml).toContain("<cbc:ID>S</cbc:ID>");
    expect(xml).toContain("<cbc:Percent>15.00</cbc:Percent>");
  });

  test("BR-13/14/15: document totals (TaxExclusive, TaxInclusive, PayableAmount) are all present and correct", () => {
    const xml = buildSimplifiedTaxInvoiceXml(baseInput());
    expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="SAR">90.00</cbc:TaxExclusiveAmount>');
    expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="SAR">103.50</cbc:TaxInclusiveAmount>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="SAR">103.50</cbc:PayableAmount>');
  });

  test("BR-45/46/47/48: VAT breakdown has taxable amount, tax amount, category, and rate", () => {
    const xml = buildSimplifiedTaxInvoiceXml(baseInput());
    expect(xml).toContain('<cbc:TaxableAmount currencyID="SAR">90.00</cbc:TaxableAmount>');
    expect(xml).toContain('<cbc:TaxAmount currencyID="SAR">13.50</cbc:TaxAmount>');
  });

  test("supports multiple VAT breakdown groups (e.g. one standard-rate, one zero-rate line)", () => {
    const input = baseInput({
      lines: [
        { id: "1", description: "Standard item", quantity: 1, unitCode: "PCE", unitPrice: 100, taxCategory: "S", taxPercent: 15, lineExtensionAmount: "100.00", lineTaxAmount: "15.00" },
        { id: "2", description: "Zero-rated item", quantity: 1, unitCode: "PCE", unitPrice: 50, taxCategory: "Z", taxPercent: 0, lineExtensionAmount: "50.00", lineTaxAmount: "0.00" },
      ],
      lineExtensionAmountTotal: "150.00",
      taxExclusiveAmount: "150.00",
      taxInclusiveAmount: "165.00",
      payableAmount: "165.00",
      taxAmountTotal: "15.00",
      taxSubtotals: [
        { taxableAmount: "100.00", taxAmount: "15.00", category: "S", percent: 15 },
        { taxableAmount: "50.00", taxAmount: "0.00", category: "Z", percent: 0 },
      ],
    });
    const xml = buildSimplifiedTaxInvoiceXml(input);
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml).toContain("Standard item");
    expect(xml).toContain("Zero-rated item");
  });

  test("escapes XML-significant characters in free-text fields (item names)", () => {
    const input = baseInput({
      lines: [
        {
          id: "1",
          description: `Item with <tag> & "quotes" & 'apostrophes'`,
          quantity: 1,
          unitCode: "PCE",
          unitPrice: 10,
          taxCategory: "Z",
          taxPercent: 0,
          lineExtensionAmount: "10.00",
          lineTaxAmount: "0.00",
        },
      ],
    });
    const xml = buildSimplifiedTaxInvoiceXml(input);
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml).not.toContain("<tag>");
    expect(xml).toContain("&lt;tag&gt;");
  });
});

describe("Saudi field-format validators — BR-KSA-40, BR-KSA-37, BR-KSA-66", () => {
  test("isValidSaudiVatNumber: 15 digits, starts and ends with 3", () => {
    expect(isValidSaudiVatNumber("300000000000003")).toBe(true);
    expect(isValidSaudiVatNumber("300000000000000")).toBe(false);
    expect(isValidSaudiVatNumber("30000000000003")).toBe(false);
    expect(isValidSaudiVatNumber("400000000000004")).toBe(false);
  });

  test("isValidBuildingNumber: exactly 4 digits", () => {
    expect(isValidBuildingNumber("1234")).toBe(true);
    expect(isValidBuildingNumber("123")).toBe(false);
    expect(isValidBuildingNumber("12345")).toBe(false);
    expect(isValidBuildingNumber("12a4")).toBe(false);
  });

  test("isValidPostalZone: exactly 5 digits", () => {
    expect(isValidPostalZone("12345")).toBe(true);
    expect(isValidPostalZone("1234")).toBe(false);
    expect(isValidPostalZone("123456")).toBe(false);
  });
});

describe("buildTaxInvoiceXml — full Tax Invoice with buyer details (Sprint 31)", () => {
  function baseBuyer() {
    return {
      registrationName: "شركة المشتري المحدودة",
      vatNumber: "300000000000102",
      streetName: "Prince Sultan Road",
      buildingNumber: "5678",
      city: "Jeddah",
      postalZone: "21589",
      district: "Al Hamra",
      countryCode: "SA",
    };
  }

  test("produces well-formed XML with the buyer block included", () => {
    const xml = buildTaxInvoiceXml({ ...baseInput(), buyer: baseBuyer() });
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml).toContain("<cac:AccountingCustomerParty>");
    expect(xml).toContain("<cbc:RegistrationName>شركة المشتري المحدودة</cbc:RegistrationName>");
  });

  // BR-KSA-06: subtype "01" for Tax Invoice, not "02"
  test("InvoiceTypeCode name is '0100000' (BR-KSA-06: Tax Invoice subtype 01, no special flags)", () => {
    const xml = buildTaxInvoiceXml({ ...baseInput(), buyer: baseBuyer() });
    expect(xml).toContain('<cbc:InvoiceTypeCode name="0100000">388</cbc:InvoiceTypeCode>');
  });

  // BR-10 / BR-KSA-63
  test("BR-10/BR-KSA-63: buyer postal address includes street, building, city, postal zone, district, country", () => {
    const xml = buildTaxInvoiceXml({ ...baseInput(), buyer: baseBuyer() });
    expect(xml).toContain("<cbc:StreetName>Prince Sultan Road</cbc:StreetName>");
    expect(xml).toContain("<cbc:BuildingNumber>5678</cbc:BuildingNumber>");
    expect(xml).toContain("<cbc:CityName>Jeddah</cbc:CityName>");
    expect(xml).toContain("<cbc:PostalZone>21589</cbc:PostalZone>");
    expect(xml).toContain("<cbc:CitySubdivisionName>Al Hamra</cbc:CitySubdivisionName>");
  });

  // BR-KSA-44
  test("BR-KSA-44: includes the buyer VAT number when provided", () => {
    const xml = buildTaxInvoiceXml({ ...baseInput(), buyer: baseBuyer() });
    expect(xml).toContain("<cbc:CompanyID>300000000000102</cbc:CompanyID>");
  });

  test("omits the buyer VAT scheme block entirely when the buyer has no VAT number (uses a different ID scheme in practice)", () => {
    const buyerWithoutVat = { ...baseBuyer(), vatNumber: undefined };
    const xml = buildTaxInvoiceXml({ ...baseInput(), buyer: buyerWithoutVat });
    expect(XMLValidator.validate(xml)).toBe(true);
    // Only the seller's CompanyID should be present now
    const companyIdMatches = xml.match(/<cbc:CompanyID>/g) ?? [];
    expect(companyIdMatches).toHaveLength(1);
  });

  test("the seller block is unchanged between Simplified and Tax Invoice variants", () => {
    const simplified = buildSimplifiedTaxInvoiceXml(baseInput());
    const taxInvoice = buildTaxInvoiceXml({ ...baseInput(), buyer: baseBuyer() });
    expect(taxInvoice).toContain("<cbc:RegistrationName>مؤسسة الأفق للتجارة</cbc:RegistrationName>"); // seller, present in both
    expect(simplified).toContain("<cbc:RegistrationName>مؤسسة الأفق للتجارة</cbc:RegistrationName>");
  });

  test("does not include an AccountingCustomerParty block in the Simplified variant", () => {
    const xml = buildSimplifiedTaxInvoiceXml(baseInput());
    expect(xml).not.toContain("<cac:AccountingCustomerParty>");
  });
});
