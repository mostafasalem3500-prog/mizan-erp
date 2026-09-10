import { BadRequestException, NotFoundException } from "@nestjs/common";
import { SalesService, SalesRepository, SalesGLAccountMapping } from "./sales.service";
import { CustomersService } from "../customers/customers.service";

function makeCustomersService(exists: boolean) {
  return {
    getCustomer: jest.fn().mockResolvedValue(exists ? { id: "cust-1", organizationId: "org-1", name: "Acme" } : null),
  } as unknown as CustomersService;
}

function makePostingEngine() {
  const calls: any[] = [];
  return {
    engine: {
      post: jest.fn().mockImplementation(async (req: any) => {
        calls.push(req);
        return { id: `je-${calls.length}`, ...req, lines: req.lines };
      }),
    },
    calls,
  };
}

function makeRepo(): SalesRepository {
  const glMapping: SalesGLAccountMapping = {
    accountsReceivableAccountId: "accounts_receivable",
    salesRevenueAccountId: "sales",
    vatOutputAccountId: "vat_output",
  };
  const invoices = new Map<string, any>();
  return {
    getGLAccountMapping: jest.fn().mockResolvedValue(glMapping),
    saveInvoice: jest.fn().mockImplementation(async (record) => { invoices.set(record.id, record); return record; }),
    findInvoice: jest.fn().mockImplementation(async (_org: string, id: string) => invoices.get(id) ?? null),
    listInvoicesForCustomer: jest.fn().mockResolvedValue([]),
    listAllInvoices: jest.fn().mockResolvedValue([]),
  };
}

describe("SalesService", () => {
  test("computes subtotal/tax/total correctly for a standard-rated line and posts Dr AR / Cr Sales+VAT", async () => {
    const { engine, calls } = makePostingEngine();
    const repo = makeRepo();
    const service = new SalesService(engine as any, makeCustomersService(true), repo);

    const invoice = await service.createInvoice({
      organizationId: "org-1",
      periodId: "period-1",
      customerId: "cust-1",
      lines: [{ description: "Consulting", quantity: 2, unitPrice: 500, taxCode: "STANDARD" }],
    });

    expect(invoice.subtotal).toBe("1000.00");
    expect(invoice.taxTotal).toBe("150.00");
    expect(invoice.total).toBe("1150.00");

    const posted = calls[0];
    expect(posted.sourceEvent).toBe("SALE_INVOICE_POSTED");
    expect(posted.lines).toEqual([
      { accountId: "accounts_receivable", debit: "1150.00" },
      { accountId: "sales", credit: "1000.00" },
      { accountId: "vat_output", credit: "150.00" },
    ]);
  });

  test("omits the VAT line entirely for a zero-rated invoice (no 0.00 line cluttering the entry)", async () => {
    const { engine, calls } = makePostingEngine();
    const repo = makeRepo();
    const service = new SalesService(engine as any, makeCustomersService(true), repo);

    await service.createInvoice({
      organizationId: "org-1",
      periodId: "period-1",
      customerId: "cust-1",
      lines: [{ description: "Export sale", quantity: 1, unitPrice: 200, taxCode: "ZERO" }],
    });

    expect(calls[0].lines).toEqual([
      { accountId: "accounts_receivable", debit: "200.00" },
      { accountId: "sales", credit: "200.00" },
    ]);
  });

  test("sums multiple lines with mixed tax codes correctly", async () => {
    const { engine, calls } = makePostingEngine();
    const repo = makeRepo();
    const service = new SalesService(engine as any, makeCustomersService(true), repo);

    const invoice = await service.createInvoice({
      organizationId: "org-1",
      periodId: "period-1",
      customerId: "cust-1",
      lines: [
        { description: "Taxable item", quantity: 1, unitPrice: 100, taxCode: "STANDARD" },
        { description: "Exempt item", quantity: 1, unitPrice: 50, taxCode: "EXEMPT" },
      ],
    });

    expect(invoice.subtotal).toBe("150.00");
    expect(invoice.taxTotal).toBe("15.00"); // only the standard-rated line contributes VAT
    expect(invoice.total).toBe("165.00");
  });

  test("rejects an invoice with zero lines", async () => {
    const service = new SalesService(makePostingEngine().engine as any, makeCustomersService(true), makeRepo());

    await expect(
      service.createInvoice({ organizationId: "org-1", periodId: "period-1", customerId: "cust-1", lines: [] }),
    ).rejects.toThrow(BadRequestException);
  });

  test("rejects a line with zero or negative quantity", async () => {
    const service = new SalesService(makePostingEngine().engine as any, makeCustomersService(true), makeRepo());

    await expect(
      service.createInvoice({
        organizationId: "org-1",
        periodId: "period-1",
        customerId: "cust-1",
        lines: [{ description: "Bad line", quantity: 0, unitPrice: 10, taxCode: "STANDARD" }],
      }),
    ).rejects.toThrow(/positive quantity/);
  });

  test("rejects an invoice for a customer that doesn't exist in this organization", async () => {
    const service = new SalesService(makePostingEngine().engine as any, makeCustomersService(false), makeRepo());

    await expect(
      service.createInvoice({
        organizationId: "org-1",
        periodId: "period-1",
        customerId: "does-not-exist",
        lines: [{ description: "X", quantity: 1, unitPrice: 10, taxCode: "STANDARD" }],
      }),
    ).rejects.toThrow(NotFoundException);
  });

  test("passes idempotencyKey straight through to the posting engine", async () => {
    const { engine, calls } = makePostingEngine();
    const service = new SalesService(engine as any, makeCustomersService(true), makeRepo());

    await service.createInvoice({
      organizationId: "org-1",
      periodId: "period-1",
      customerId: "cust-1",
      idempotencyKey: "invoice-retry-1",
      lines: [{ description: "X", quantity: 1, unitPrice: 10, taxCode: "STANDARD" }],
    });

    expect(calls[0].idempotencyKey).toBe("invoice-retry-1");
  });
});

describe("SalesService — applyPayment (Sprint 19)", () => {
  test("applies a partial payment and updates paidAmount", async () => {
    const repo = makeRepo();
    const service = new SalesService(makePostingEngine().engine as any, makeCustomersService(true), repo);

    const invoice = await service.createInvoice({
      organizationId: "org-1", periodId: "period-1", customerId: "cust-1",
      lines: [{ description: "X", quantity: 1, unitPrice: 100, taxCode: "STANDARD" }],
    });

    const updated = await service.applyPayment("org-1", invoice.id, 60);
    expect(updated.paidAmount).toBe("60.00");
  });

  test("rejects a payment that would overpay the invoice", async () => {
    const repo = makeRepo();
    const service = new SalesService(makePostingEngine().engine as any, makeCustomersService(true), repo);

    const invoice = await service.createInvoice({
      organizationId: "org-1", periodId: "period-1", customerId: "cust-1",
      lines: [{ description: "X", quantity: 1, unitPrice: 100, taxCode: "ZERO" }],
    });

    await expect(service.applyPayment("org-1", invoice.id, 150)).rejects.toThrow(/overpay/);
  });

  test("rejects applying a payment to an invoice that doesn't exist", async () => {
    const service = new SalesService(makePostingEngine().engine as any, makeCustomersService(true), makeRepo());
    await expect(service.applyPayment("org-1", "ghost-invoice", 10)).rejects.toThrow(NotFoundException);
  });
});
