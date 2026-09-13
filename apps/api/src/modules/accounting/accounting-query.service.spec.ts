import { AccountingQueryService, AccountingQueryRepository } from "./accounting-query.service";

describe("AccountingQueryService — Trial Balance", () => {
  test("exposes persisted journal summaries from the repository", async () => {
    const entries = [{ id: "je-1", sourceEvent: "POS_SALE_COMPLETED", postedAt: "2026-09-13T10:00:00Z", isReversal: false, totalDebit: "115.0000", totalCredit: "115.0000" }];
    const repo: AccountingQueryRepository = {
      getTrialBalanceForPeriod: jest.fn().mockResolvedValue([]),
      listJournalEntriesForPeriod: jest.fn().mockResolvedValue(entries),
    };
    await expect(new AccountingQueryService(repo).listJournalEntries("org-1", "p1")).resolves.toEqual(entries);
  });
  test("sums debit and credit across accounts and reports balanced when they match", async () => {
    const repo: AccountingQueryRepository = {
      listJournalEntriesForPeriod: jest.fn().mockResolvedValue([]),
      getTrialBalanceForPeriod: jest.fn().mockResolvedValue([
        { accountId: "cash", accountCode: "1100", accountName: "Cash", totalDebit: "1150.00", totalCredit: "0.00" },
        { accountId: "sales", accountCode: "4100", accountName: "Sales", totalDebit: "0.00", totalCredit: "1000.00" },
        { accountId: "vat_output", accountCode: "2200", accountName: "VAT Output", totalDebit: "0.00", totalCredit: "150.00" },
      ]),
    };
    const service = new AccountingQueryService(repo);

    const result = await service.getTrialBalance("org-1", "period-1");

    expect(result.totalDebit).toBe("1150.0000");
    expect(result.totalCredit).toBe("1150.0000");
    expect(result.isBalanced).toBe(true);
    expect(result.lines).toHaveLength(3);
  });

  test("flags isBalanced=false without throwing when totals genuinely disagree (e.g. data corruption)", async () => {
    const repo: AccountingQueryRepository = {
      listJournalEntriesForPeriod: jest.fn().mockResolvedValue([]),
      getTrialBalanceForPeriod: jest.fn().mockResolvedValue([
        { accountId: "cash", accountCode: "1100", accountName: "Cash", totalDebit: "100.00", totalCredit: "0.00" },
        { accountId: "sales", accountCode: "4100", accountName: "Sales", totalDebit: "0.00", totalCredit: "90.00" },
      ]),
    };
    const service = new AccountingQueryService(repo);

    const result = await service.getTrialBalance("org-1", "period-1");
    expect(result.isBalanced).toBe(false);
  });

  test("handles decimals with fractional cents correctly (no float drift across many lines)", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => ({
      accountId: `acc-${i}`,
      accountCode: String(1000 + i),
      accountName: `Account ${i}`,
      totalDebit: "0.01",
      totalCredit: "0.00",
    }));
    const repo: AccountingQueryRepository = {
      listJournalEntriesForPeriod: jest.fn().mockResolvedValue([]),
      getTrialBalanceForPeriod: jest.fn().mockResolvedValue(lines),
    };
    const service = new AccountingQueryService(repo);

    const result = await service.getTrialBalance("org-1", "period-1");
    expect(result.totalDebit).toBe("0.5000"); // 50 * 0.01 — would drift under naive float addition
  });
});
