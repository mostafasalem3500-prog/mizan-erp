import { NotFoundException } from "@nestjs/common";
import { ReceiptsService } from "./receipts.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { PosService } from "../pos/pos.service";
import { SalesService } from "../sales/sales.service";

function makeOrgService(org: any = { id: "org-1", legalNameAr: "مؤسسة الاختبار", vatNumber: "300000000000003" }) {
  return { getOrganization: jest.fn().mockResolvedValue(org) } as unknown as OrganizationsService;
}

describe("ReceiptsService — POS receipt", () => {
  test("composes seller, lines, totals, and a real QR data URL from a real POS sale", async () => {
    const pos = {
      getSale: jest.fn().mockResolvedValue({
        id: "sale-1234567890",
        lines: [{ description: "Coffee", quantity: 2, unitPrice: 45, taxCode: "STANDARD" }],
        tenders: [{ method: "CASH", amount: 103.5 }],
        subtotal: "90.00",
        taxTotal: "13.50",
        total: "103.50",
        soldAt: "2026-09-10T01:00:00.000Z",
      }),
    } as unknown as PosService;
    const sales = {} as unknown as SalesService;

    const service = new ReceiptsService(makeOrgService(), pos, sales);
    const receipt = await service.getPosReceipt("org-1", "sale-1234567890");

    expect(receipt.sellerName).toBe("مؤسسة الاختبار");
    expect(receipt.sellerVatNumber).toBe("300000000000003");
    expect(receipt.documentNumber).toBe("sale-123");
    expect(receipt.lines).toEqual([{ description: "Coffee", quantity: 2, unitPrice: 45, lineTotal: "90.00" }]);
    expect(receipt.total).toBe("103.50");
    expect(receipt.issuedAt).toBe("2026-09-10T01:00:00.000Z");
    expect(receipt.paymentSummary).toContain("نقدًا");
    expect(receipt.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  test("describes a mixed cash+card payment correctly", async () => {
    const pos = {
      getSale: jest.fn().mockResolvedValue({
        id: "sale-2",
        lines: [{ description: "Item", quantity: 1, unitPrice: 100, taxCode: "ZERO" }],
        tenders: [
          { method: "CASH", amount: 50 },
          { method: "CARD", amount: 50 },
        ],
        subtotal: "100.00",
        taxTotal: "0.00",
        total: "100.00",
        soldAt: "2026-09-10T01:00:00.000Z",
      }),
    } as unknown as PosService;

    const service = new ReceiptsService(makeOrgService(), pos, {} as unknown as SalesService);
    const receipt = await service.getPosReceipt("org-1", "sale-2");

    expect(receipt.paymentSummary).toContain("مختلط");
  });

  test("throws NotFoundException for a sale that doesn't exist", async () => {
    const pos = { getSale: jest.fn().mockResolvedValue(null) } as unknown as PosService;
    const service = new ReceiptsService(makeOrgService(), pos, {} as unknown as SalesService);

    await expect(service.getPosReceipt("org-1", "ghost")).rejects.toThrow(NotFoundException);
  });
});

describe("ReceiptsService — Sales invoice receipt", () => {
  test("composes an invoice receipt and reports 'on account' when unpaid", async () => {
    const sales = {
      getInvoice: jest.fn().mockResolvedValue({
        id: "invoice-1234567890",
        lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, taxCode: "STANDARD" }],
        subtotal: "1000.00",
        taxTotal: "150.00",
        total: "1150.00",
        issueDate: "2026-09-10T00:00:00.000Z",
        paidAmount: "0.00",
      }),
    } as unknown as SalesService;

    const service = new ReceiptsService(makeOrgService(), {} as unknown as PosService, sales);
    const receipt = await service.getSalesInvoiceReceipt("org-1", "invoice-1234567890");

    expect(receipt.paymentSummary).toBe("آجل — على الحساب");
    expect(receipt.total).toBe("1150.00");
    expect(receipt.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  test("reports a partial payment correctly", async () => {
    const sales = {
      getInvoice: jest.fn().mockResolvedValue({
        id: "invoice-2",
        lines: [{ description: "X", quantity: 1, unitPrice: 100, taxCode: "ZERO" }],
        subtotal: "100.00",
        taxTotal: "0.00",
        total: "100.00",
        issueDate: "2026-09-10T00:00:00.000Z",
        paidAmount: "40.00",
      }),
    } as unknown as SalesService;

    const service = new ReceiptsService(makeOrgService(), {} as unknown as PosService, sales);
    const receipt = await service.getSalesInvoiceReceipt("org-1", "invoice-2");

    expect(receipt.paymentSummary).toContain("مدفوع جزئيًا");
  });

  test("throws NotFoundException for an invoice that doesn't exist", async () => {
    const sales = { getInvoice: jest.fn().mockResolvedValue(null) } as unknown as SalesService;
    const service = new ReceiptsService(makeOrgService(), {} as unknown as PosService, sales);

    await expect(service.getSalesInvoiceReceipt("org-1", "ghost")).rejects.toThrow(NotFoundException);
  });
});

describe("ReceiptsService — xmlInvoice generation (Sprint 30)", () => {
  const fullOrg = {
    id: "org-1",
    legalNameAr: "مؤسسة الاختبار",
    vatNumber: "300000000000003",
    crNumber: "1010010000",
    streetName: "King Fahd Road",
    buildingNumber: "1234",
    city: "Riyadh",
    postalZone: "12345",
    district: "Al Olaya",
    countryCode: "SA",
  };

  test("includes a well-formed xmlInvoice when the organization has full address data", async () => {
    const pos = {
      getSale: jest.fn().mockResolvedValue({
        id: "sale-1234567890",
        lines: [{ description: "Coffee", quantity: 2, unitPrice: 45, taxCode: "STANDARD" }],
        tenders: [{ method: "CASH", amount: 103.5 }],
        subtotal: "90.00",
        taxTotal: "13.50",
        total: "103.50",
        soldAt: "2026-09-10T01:00:00.000Z",
      }),
    } as unknown as PosService;

    const service = new ReceiptsService(makeOrgService(fullOrg), pos, {} as unknown as SalesService);
    const receipt = await service.getPosReceipt("org-1", "sale-1234567890");

    expect(receipt.xmlInvoice).toBeDefined();
    expect(receipt.xmlInvoice).toContain("<cbc:InvoiceTypeCode name=\"0200000\">388</cbc:InvoiceTypeCode>");
    expect(receipt.xmlInvoice).toContain("<cbc:RegistrationName>مؤسسة الاختبار</cbc:RegistrationName>");
    expect(receipt.xmlInvoice).toContain('<cbc:TaxInclusiveAmount currencyID="SAR">103.50</cbc:TaxInclusiveAmount>');
  });

  test("omits xmlInvoice (rather than emitting incomplete XML) when the organization is missing address fields", async () => {
    const pos = {
      getSale: jest.fn().mockResolvedValue({
        id: "sale-1234567890",
        lines: [{ description: "Coffee", quantity: 2, unitPrice: 45, taxCode: "STANDARD" }],
        tenders: [{ method: "CASH", amount: 103.5 }],
        subtotal: "90.00",
        taxTotal: "13.50",
        total: "103.50",
        soldAt: "2026-09-10T01:00:00.000Z",
      }),
    } as unknown as PosService;

    // makeOrgService() default has no address fields
    const service = new ReceiptsService(makeOrgService(), pos, {} as unknown as SalesService);
    const receipt = await service.getPosReceipt("org-1", "sale-1234567890");

    expect(receipt.xmlInvoice).toBeUndefined();
  });

  test("maps OUT_OF_SCOPE tax code to ZATCA category 'O' at 0%", async () => {
    const pos = {
      getSale: jest.fn().mockResolvedValue({
        id: "sale-2",
        lines: [{ description: "Out of scope item", quantity: 1, unitPrice: 100, taxCode: "OUT_OF_SCOPE" }],
        tenders: [{ method: "CASH", amount: 100 }],
        subtotal: "100.00",
        taxTotal: "0.00",
        total: "100.00",
        soldAt: "2026-09-10T01:00:00.000Z",
      }),
    } as unknown as PosService;

    const service = new ReceiptsService(makeOrgService(fullOrg), pos, {} as unknown as SalesService);
    const receipt = await service.getPosReceipt("org-1", "sale-2");

    expect(receipt.xmlInvoice).toContain("<cbc:ID>O</cbc:ID>");
  });

  test("includes xmlInvoice for a sales invoice receipt too", async () => {
    const sales = {
      getInvoice: jest.fn().mockResolvedValue({
        id: "invoice-1234567890",
        lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, taxCode: "STANDARD" }],
        subtotal: "1000.00",
        taxTotal: "150.00",
        total: "1150.00",
        issueDate: "2026-09-10T00:00:00.000Z",
        paidAmount: "0.00",
      }),
    } as unknown as SalesService;

    const service = new ReceiptsService(makeOrgService(fullOrg), {} as unknown as PosService, sales);
    const receipt = await service.getSalesInvoiceReceipt("org-1", "invoice-1234567890");

    expect(receipt.xmlInvoice).toBeDefined();
    expect(receipt.xmlInvoice).toContain('<cbc:TaxInclusiveAmount currencyID="SAR">1150.00</cbc:TaxInclusiveAmount>');
  });
});
