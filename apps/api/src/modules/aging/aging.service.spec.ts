import { AgingService } from "./aging.service";
import { SalesService } from "../sales/sales.service";
import { PurchasesService } from "../purchases/purchases.service";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

describe("AgingService — Receivable Aging (spec band 95)", () => {
  test("buckets invoices correctly into 0-30/31-60/61-90/90+ by age", async () => {
    const sales = {
      listAllInvoices: jest.fn().mockResolvedValue([
        { id: "inv-1", customerId: "cust-1", issueDate: daysAgo(10), total: "100.00", paidAmount: "0.00" },
        { id: "inv-2", customerId: "cust-1", issueDate: daysAgo(45), total: "200.00", paidAmount: "0.00" },
        { id: "inv-3", customerId: "cust-2", issueDate: daysAgo(75), total: "300.00", paidAmount: "0.00" },
        { id: "inv-4", customerId: "cust-2", issueDate: daysAgo(120), total: "400.00", paidAmount: "0.00" },
      ]),
    } as unknown as SalesService;
    const purchases = {} as unknown as PurchasesService;

    const service = new AgingService(sales, purchases);
    const result = await service.getReceivableAging("org-1");

    expect(result.bucketTotals.CURRENT_0_30).toBe("100.00");
    expect(result.bucketTotals.DAYS_31_60).toBe("200.00");
    expect(result.bucketTotals.DAYS_61_90).toBe("300.00");
    expect(result.bucketTotals.DAYS_90_PLUS).toBe("400.00");
    expect(result.totalOutstanding).toBe("1000.00");
    expect(result.lines).toHaveLength(4);
  });

  test("excludes fully-paid invoices from the aging entirely", async () => {
    const sales = {
      listAllInvoices: jest.fn().mockResolvedValue([
        { id: "inv-1", customerId: "cust-1", issueDate: daysAgo(100), total: "500.00", paidAmount: "500.00" },
        { id: "inv-2", customerId: "cust-1", issueDate: daysAgo(5), total: "100.00", paidAmount: "0.00" },
      ]),
    } as unknown as SalesService;
    const purchases = {} as unknown as PurchasesService;

    const service = new AgingService(sales, purchases);
    const result = await service.getReceivableAging("org-1");

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].referenceId).toBe("inv-2");
    expect(result.totalOutstanding).toBe("100.00");
  });

  test("ages a partially-paid invoice on its REMAINING balance, not the original total", async () => {
    const sales = {
      listAllInvoices: jest.fn().mockResolvedValue([
        { id: "inv-1", customerId: "cust-1", issueDate: daysAgo(40), total: "1000.00", paidAmount: "700.00" },
      ]),
    } as unknown as SalesService;
    const purchases = {} as unknown as PurchasesService;

    const service = new AgingService(sales, purchases);
    const result = await service.getReceivableAging("org-1");

    expect(result.lines[0].outstandingBalance).toBe("300.00");
    expect(result.lines[0].bucket).toBe("DAYS_31_60");
  });

  test("an invoice issued today lands in CURRENT_0_30 with ageDays 0", async () => {
    const sales = {
      listAllInvoices: jest.fn().mockResolvedValue([
        { id: "inv-1", customerId: "cust-1", issueDate: new Date().toISOString(), total: "50.00", paidAmount: "0.00" },
      ]),
    } as unknown as SalesService;
    const purchases = {} as unknown as PurchasesService;

    const service = new AgingService(sales, purchases);
    const result = await service.getReceivableAging("org-1");

    expect(result.lines[0].ageDays).toBe(0);
    expect(result.lines[0].bucket).toBe("CURRENT_0_30");
  });

  test("returns an empty result with all-zero buckets when there is no outstanding activity", async () => {
    const sales = { listAllInvoices: jest.fn().mockResolvedValue([]) } as unknown as SalesService;
    const purchases = {} as unknown as PurchasesService;

    const service = new AgingService(sales, purchases);
    const result = await service.getReceivableAging("org-1");

    expect(result.lines).toHaveLength(0);
    expect(result.totalOutstanding).toBe("0.00");
    expect(result.bucketTotals.CURRENT_0_30).toBe("0.00");
  });
});

describe("AgingService — Payable Aging", () => {
  test("buckets supplier bills the same way as customer invoices", async () => {
    const sales = {} as unknown as SalesService;
    const purchases = {
      listAllBills: jest.fn().mockResolvedValue([
        { id: "bill-1", supplierId: "sup-1", issueDate: daysAgo(95), total: "1000.00", paidAmount: "0.00" },
      ]),
    } as unknown as PurchasesService;

    const service = new AgingService(sales, purchases);
    const result = await service.getPayableAging("org-1");

    expect(result.bucketTotals.DAYS_90_PLUS).toBe("1000.00");
    expect(result.lines[0].partyId).toBe("sup-1");
  });
});
