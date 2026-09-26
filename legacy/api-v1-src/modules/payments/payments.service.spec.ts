import { BadRequestException } from "@nestjs/common";
import { PaymentsService, PaymentsRepository, PaymentRecord } from "./payments.service";
import { AccountsService } from "../accounts/accounts.service";
import { SalesService } from "../sales/sales.service";
import { PurchasesService } from "../purchases/purchases.service";

function makeAccounts() {
  const codeToId: Record<string, string> = { "1100": "acc-cash", "1200": "acc-ar", "2100": "acc-ap" };
  return { getAccountIdByCode: jest.fn().mockImplementation(async (_o: string, code: string) => codeToId[code]) } as unknown as AccountsService;
}
function makeEngine() {
  const calls: any[] = [];
  return { engine: { post: jest.fn().mockImplementation(async (r: any) => { calls.push(r); return { id: `je-${calls.length}`, ...r }; }) }, calls };
}
function makeRepo(): PaymentsRepository {
  const records: PaymentRecord[] = [];
  return {
    save: jest.fn().mockImplementation(async (r: PaymentRecord) => { records.push(r); return r; }),
    listForCustomer: jest.fn().mockImplementation(async (org: string, id: string) => records.filter((r) => r.organizationId === org && r.type === "CUSTOMER" && r.partyId === id)),
    listForSupplier: jest.fn().mockImplementation(async (org: string, id: string) => records.filter((r) => r.organizationId === org && r.type === "SUPPLIER" && r.partyId === id)),
  };
}

function makeSales(overrides: Partial<Record<string, any>> = {}) {
  return { applyPayment: jest.fn().mockResolvedValue(undefined), ...overrides } as unknown as SalesService;
}
function makePurchases(overrides: Partial<Record<string, any>> = {}) {
  return { applyPayment: jest.fn().mockResolvedValue(undefined), ...overrides } as unknown as PurchasesService;
}

describe("PaymentsService", () => {
  test("customer payment posts Dr Cash / Cr Accounts Receivable", async () => {
    const { engine, calls } = makeEngine();
    const service = new PaymentsService(engine as any, makeAccounts(), makeRepo(), makeSales(), makePurchases());

    await service.recordCustomerPayment({ organizationId: "org-1", periodId: "period-1", customerId: "cust-1", amount: 500, receivedIntoAccountCode: "1100" });

    expect(calls[0].sourceEvent).toBe("PAYMENT_RECEIVED");
    expect(calls[0].lines).toEqual([{ accountId: "acc-cash", debit: "500.00" }, { accountId: "acc-ar", credit: "500.00" }]);
  });

  test("supplier payment posts Dr Accounts Payable / Cr Cash", async () => {
    const { engine, calls } = makeEngine();
    const service = new PaymentsService(engine as any, makeAccounts(), makeRepo(), makeSales(), makePurchases());

    await service.recordSupplierPayment({ organizationId: "org-1", periodId: "period-1", supplierId: "sup-1", amount: 300, paidFromAccountCode: "1100" });

    expect(calls[0].sourceEvent).toBe("PAYMENT_PAID");
    expect(calls[0].lines).toEqual([{ accountId: "acc-ap", debit: "300.00" }, { accountId: "acc-cash", credit: "300.00" }]);
  });

  test("rejects a non-positive payment amount for both customer and supplier payments", async () => {
    const service = new PaymentsService(makeEngine().engine as any, makeAccounts(), makeRepo(), makeSales(), makePurchases());
    await expect(service.recordCustomerPayment({ organizationId: "org-1", periodId: "period-1", customerId: "c", amount: 0, receivedIntoAccountCode: "1100" })).rejects.toThrow(BadRequestException);
    await expect(service.recordSupplierPayment({ organizationId: "org-1", periodId: "period-1", supplierId: "s", amount: -5, paidFromAccountCode: "1100" })).rejects.toThrow(BadRequestException);
  });

  test("lists payments filtered by customer, separate from supplier payments", async () => {
    const repo = makeRepo();
    const service = new PaymentsService(makeEngine().engine as any, makeAccounts(), repo, makeSales(), makePurchases());

    await service.recordCustomerPayment({ organizationId: "org-1", periodId: "period-1", customerId: "cust-1", amount: 100, receivedIntoAccountCode: "1100" });
    await service.recordSupplierPayment({ organizationId: "org-1", periodId: "period-1", supplierId: "sup-1", amount: 50, paidFromAccountCode: "1100" });

    const customerPayments = await service.listCustomerPayments("org-1", "cust-1");
    expect(customerPayments).toHaveLength(1);
    expect(customerPayments[0].amount).toBe("100.00");
  });
});

describe("PaymentsService — Payment Application (Sprint 19)", () => {
  test("customer payment with invoiceId applies the payment to that invoice via SalesService", async () => {
    const { engine } = makeEngine();
    const sales = makeSales();
    const service = new PaymentsService(engine as any, makeAccounts(), makeRepo(), sales, makePurchases());

    await service.recordCustomerPayment({
      organizationId: "org-1", periodId: "period-1", customerId: "cust-1",
      amount: 500, receivedIntoAccountCode: "1100", invoiceId: "inv-1",
    });

    expect(sales.applyPayment).toHaveBeenCalledWith("org-1", "inv-1", 500);
  });

  test("customer payment WITHOUT invoiceId does not call applyPayment (on-account payment)", async () => {
    const { engine } = makeEngine();
    const sales = makeSales();
    const service = new PaymentsService(engine as any, makeAccounts(), makeRepo(), sales, makePurchases());

    await service.recordCustomerPayment({
      organizationId: "org-1", periodId: "period-1", customerId: "cust-1",
      amount: 500, receivedIntoAccountCode: "1100",
    });

    expect(sales.applyPayment).not.toHaveBeenCalled();
  });

  test("supplier payment with billId applies the payment to that bill via PurchasesService", async () => {
    const { engine } = makeEngine();
    const purchases = makePurchases();
    const service = new PaymentsService(engine as any, makeAccounts(), makeRepo(), makeSales(), purchases);

    await service.recordSupplierPayment({
      organizationId: "org-1", periodId: "period-1", supplierId: "sup-1",
      amount: 300, paidFromAccountCode: "1100", billId: "bill-1",
    });

    expect(purchases.applyPayment).toHaveBeenCalledWith("org-1", "bill-1", 300);
  });
});
