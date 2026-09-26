import { StatementsService } from "./statements.service";
import { SalesService } from "../sales/sales.service";
import { PurchasesService } from "../purchases/purchases.service";
import { PaymentsService } from "../payments/payments.service";

describe("StatementsService", () => {
  test("customer statement: totalInvoiced - totalPaid = balance", async () => {
    const sales = {
      listInvoicesForCustomer: jest.fn().mockResolvedValue([
        { id: "inv-1", total: "1150.00" },
        { id: "inv-2", total: "230.00" },
      ]),
    } as unknown as SalesService;
    const purchases = {} as unknown as PurchasesService;
    const payments = {
      listCustomerPayments: jest.fn().mockResolvedValue([{ id: "pay-1", amount: "500.00" }]),
    } as unknown as PaymentsService;

    const service = new StatementsService(sales, purchases, payments);
    const statement = await service.getCustomerStatement("org-1", "cust-1");

    expect(statement.totalInvoiced).toBe("1380.00");
    expect(statement.totalPaid).toBe("500.00");
    expect(statement.balance).toBe("880.00");
    expect(statement.lines).toHaveLength(3);
  });

  test("supplier statement: fully paid results in a zero balance", async () => {
    const sales = {} as unknown as SalesService;
    const purchases = {
      listBillsForSupplier: jest.fn().mockResolvedValue([{ id: "bill-1", total: "1150.00" }]),
    } as unknown as PurchasesService;
    const payments = {
      listSupplierPayments: jest.fn().mockResolvedValue([{ id: "pay-1", amount: "1150.00" }]),
    } as unknown as PaymentsService;

    const service = new StatementsService(sales, purchases, payments);
    const statement = await service.getSupplierStatement("org-1", "sup-1");

    expect(statement.balance).toBe("0.00");
  });

  test("a customer with no invoices and no payments has a zero balance and no lines", async () => {
    const sales = { listInvoicesForCustomer: jest.fn().mockResolvedValue([]) } as unknown as SalesService;
    const purchases = {} as unknown as PurchasesService;
    const payments = { listCustomerPayments: jest.fn().mockResolvedValue([]) } as unknown as PaymentsService;

    const service = new StatementsService(sales, purchases, payments);
    const statement = await service.getCustomerStatement("org-1", "cust-new");

    expect(statement.lines).toHaveLength(0);
    expect(statement.balance).toBe("0.00");
  });
});
