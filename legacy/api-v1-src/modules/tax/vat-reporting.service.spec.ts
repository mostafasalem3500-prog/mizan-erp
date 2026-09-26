import { VatReportingService } from "./vat-reporting.service";

describe("VatReportingService", () => {
  test("groups all four VAT categories and reconciles source tax to the GL", async () => {
    const sales = { listAllInvoices: jest.fn().mockResolvedValue([{ periodId: "p1", lines: [
      { description: "S", quantity: 1, unitPrice: 100, taxCode: "STANDARD" },
      { description: "Z", quantity: 1, unitPrice: 20, taxCode: "ZERO", taxExemptionReasonCode: "VATEX-SA-32" },
    ] }]) };
    const purchases = { listAllBills: jest.fn().mockResolvedValue([{ periodId: "p1", lines: [
      { description: "E", quantity: 1, unitCost: 50, taxCode: "EXEMPT", taxExemptionReasonCode: "VATEX-SA-29" },
      { description: "S", quantity: 1, unitCost: 40, taxCode: "STANDARD" },
    ] }]) };
    const expenses = { listAll: jest.fn().mockResolvedValue([]) };
    const pos = { searchSales: jest.fn().mockResolvedValue([]) };
    const accounting = { getTrialBalance: jest.fn().mockResolvedValue({ lines: [
      { accountId: "out", totalDebit: "0.00", totalCredit: "15.00" },
      { accountId: "in", totalDebit: "6.00", totalCredit: "0.00" },
    ] }) };
    const accounts = { getAccountIdByCode: jest.fn().mockImplementation(async (_org: string, code: string) => code === "2200" ? "out" : "in") };
    const service = new VatReportingService(sales as any, purchases as any, expenses as any, pos as any, accounting as any, accounts as any);

    const result = await service.getPeriodSummary("org", "p1");
    expect(result.totals).toEqual({ outputVat: "15.00", recoverableInputVat: "6.00", netVatPayable: "9.00" });
    expect(result.reconciliation.isReconciled).toBe(true);
    expect(result.sales.find((x) => x.code === "ZERO")?.taxableAmount).toBe("20.00");
    expect(result.purchases.find((x) => x.code === "EXEMPT")?.taxableAmount).toBe("50.00");
  });

  test("nets POS returns using remaining quantities and exposes a GL difference", async () => {
    const sales = { listAllInvoices: jest.fn().mockResolvedValue([]) };
    const purchases = { listAllBills: jest.fn().mockResolvedValue([]) };
    const expenses = { listAll: jest.fn().mockResolvedValue([]) };
    const pos = { searchSales: jest.fn().mockResolvedValue([{ periodId: "p1", lines: [{ description: "S", quantity: 2, unitPrice: 100, taxCode: "STANDARD" }], remainingQuantities: [1] }]) };
    const accounting = { getTrialBalance: jest.fn().mockResolvedValue({ lines: [] }) };
    const accounts = { getAccountIdByCode: jest.fn().mockResolvedValue("missing") };
    const service = new VatReportingService(sales as any, purchases as any, expenses as any, pos as any, accounting as any, accounts as any);
    const result = await service.getPeriodSummary("org", "p1");
    expect(result.totals.outputVat).toBe("15.00");
    expect(result.reconciliation.outputDifference).toBe("15.00");
    expect(result.reconciliation.isReconciled).toBe(false);
  });
});
