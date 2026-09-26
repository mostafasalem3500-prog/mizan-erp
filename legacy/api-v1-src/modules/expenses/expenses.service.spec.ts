import { BadRequestException } from "@nestjs/common";
import { ExpensesService, ExpensesRepository, ExpenseRecord } from "./expenses.service";
import { AccountsService } from "../accounts/accounts.service";

function makeAccounts() {
  const codeToId: Record<string, string> = { "6100": "acc-expense", "1100": "acc-cash", "2100": "acc-ap", "1400": "acc-vat-input" };
  return { getAccountIdByCode: jest.fn().mockImplementation(async (_o: string, code: string) => codeToId[code]) } as unknown as AccountsService;
}

function makeEngine() {
  const calls: any[] = [];
  return { engine: { post: jest.fn().mockImplementation(async (r: any) => { calls.push(r); return { id: `je-${calls.length}`, ...r }; }) }, calls };
}

function makeRepo(): ExpensesRepository {
  return { save: jest.fn().mockImplementation(async (r: ExpenseRecord) => r), findById: jest.fn().mockResolvedValue(null), listAll: jest.fn().mockResolvedValue([]) };
}

describe("ExpensesService (spec band 24)", () => {
  test("posts Dr Expense + VAT Input / Cr Payment Account for a standard-rated expense paid in cash", async () => {
    const { engine, calls } = makeEngine();
    const service = new ExpensesService(engine as any, makeAccounts(), makeRepo());

    const expense = await service.recordExpense({
      organizationId: "org-1", periodId: "period-1",
      expenseAccountCode: "6100", paymentAccountCode: "1100",
      amount: 100, taxCode: "STANDARD", description: "Office supplies",
    });

    expect(expense.total).toBe("115.00");
    expect(calls[0].lines).toEqual([
      { accountId: "acc-expense", debit: "100.00" },
      { accountId: "acc-vat-input", debit: "15.00" },
      { accountId: "acc-cash", credit: "115.00" },
    ]);
  });

  test("omits the VAT Input line for a zero-rated expense", async () => {
    const { engine, calls } = makeEngine();
    const service = new ExpensesService(engine as any, makeAccounts(), makeRepo());

    await service.recordExpense({
      organizationId: "org-1", periodId: "period-1",
      expenseAccountCode: "6100", paymentAccountCode: "2100",
      amount: 50, taxCode: "ZERO", description: "Bank charge",
    });

    expect(calls[0].lines).toEqual([
      { accountId: "acc-expense", debit: "50.00" },
      { accountId: "acc-ap", credit: "50.00" },
    ]);
  });

  test("rejects a zero or negative amount", async () => {
    const service = new ExpensesService(makeEngine().engine as any, makeAccounts(), makeRepo());
    await expect(
      service.recordExpense({ organizationId: "org-1", periodId: "period-1", expenseAccountCode: "6100", paymentAccountCode: "1100", amount: 0, taxCode: "ZERO", description: "X" }),
    ).rejects.toThrow(BadRequestException);
  });
});
