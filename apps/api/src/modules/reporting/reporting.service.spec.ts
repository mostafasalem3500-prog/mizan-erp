import {
  ReportingService,
  AccountTypeLookup,
  AccountType,
  GeneralLedgerRepository,
  LedgerLineRow,
} from "./reporting.service";
import { AccountingQueryService, AccountingQueryRepository, TrialBalanceLine } from "../accounting/accounting-query.service";
import { AccountsService } from "../accounts/accounts.service";

const ACCOUNT_TYPES: Record<string, AccountType> = {
  cash: "ASSET",
  card_clearing: "ASSET",
  accounts_receivable: "ASSET",
  inventory: "ASSET",
  vat_input: "ASSET",
  accounts_payable: "LIABILITY",
  vat_output: "LIABILITY",
  opening_balance_equity: "EQUITY",
  sales: "REVENUE",
  sales_returns: "REVENUE",
  cogs: "COST_OF_SALES",
  general_expense: "EXPENSE",
};

function makeAccountTypeLookup(): AccountTypeLookup {
  return { getAccountType: jest.fn().mockImplementation(async (_org: string, accountId: string) => ACCOUNT_TYPES[accountId] ?? null) };
}

function makeAccountingQueryService(lines: TrialBalanceLine[]) {
  const repo: AccountingQueryRepository = {
    getTrialBalanceForPeriod: jest.fn().mockResolvedValue(lines),
  };
  return new AccountingQueryService(repo);
}

function makeLedgerRepo(lines: LedgerLineRow[]): GeneralLedgerRepository {
  return { getLedgerLines: jest.fn().mockResolvedValue(lines) };
}

function makeAccountsService(): AccountsService {
  const codeToId: Record<string, string> = { "1100": "cash", "1110": "bank" };
  return { getAccountIdByCode: jest.fn().mockImplementation(async (_o: string, code: string) => codeToId[code]) } as unknown as AccountsService;
}

describe("ReportingService — General Ledger", () => {
  test("computes a running balance line by line in order", async () => {
    const ledgerLines: LedgerLineRow[] = [
      { journalEntryId: "je-1", sourceEvent: "PURCHASE_BILL_POSTED", debit: "1000.00", credit: "0.00" },
      { journalEntryId: "je-2", sourceEvent: "INVENTORY_ISSUED", debit: "0.00", credit: "100.00" },
      { journalEntryId: "je-3", sourceEvent: "PURCHASE_BILL_POSTED", debit: "500.00", credit: "0.00" },
    ];
    const service = new ReportingService(
      makeAccountingQueryService([]),
      makeAccountTypeLookup(),
      makeLedgerRepo(ledgerLines),
      makeAccountsService(),
    );

    const gl = await service.getGeneralLedger("org-1", "period-1", "inventory");

    expect(gl.map((l) => l.runningBalance)).toEqual(["1000.0000", "900.0000", "1400.0000"]);
  });
});

describe("ReportingService — Profit & Loss", () => {
  test("classifies accounts correctly and nets Sales Returns against Sales", async () => {
    const lines: TrialBalanceLine[] = [
      { accountId: "sales", accountCode: "sales", accountName: "sales", totalDebit: "0.00", totalCredit: "1000.00" },
      { accountId: "sales_returns", accountCode: "sales_returns", accountName: "sales_returns", totalDebit: "50.00", totalCredit: "0.00" },
      { accountId: "cogs", accountCode: "cogs", accountName: "cogs", totalDebit: "400.00", totalCredit: "0.00" },
      { accountId: "general_expense", accountCode: "general_expense", accountName: "general_expense", totalDebit: "100.00", totalCredit: "0.00" },
      { accountId: "cash", accountCode: "cash", accountName: "cash", totalDebit: "1450.00", totalCredit: "0.00" }, // ASSET — must be ignored by P&L
    ];
    const service = new ReportingService(
      makeAccountingQueryService(lines),
      makeAccountTypeLookup(),
      makeLedgerRepo([]),
      makeAccountsService(),
    );

    const pnl = await service.getProfitAndLoss("org-1", "period-1");

    expect(pnl.revenue).toBe("950.0000"); // 1000 - 50 returns
    expect(pnl.costOfSales).toBe("400.0000");
    expect(pnl.grossProfit).toBe("550.0000");
    expect(pnl.operatingExpenses).toBe("100.0000");
    expect(pnl.netIncome).toBe("450.0000"); // 550 - 100
  });
});

describe("ReportingService — Balance Sheet identity (proof, not assumption)", () => {
  test("Assets = Liabilities + Equity + Net Income holds for a realistic posted-style trial balance", async () => {
    // Mirrors the actual live e2e scenario from Sprint 6-7-8: buy 100@10
    // (Dr Inventory 1000 + VAT Input 150 / Cr AP 1150), sell 10@20 STANDARD
    // for cash (Dr Cash 230 / Cr Sales 200 + VAT Output 30), COGS 100
    // (Dr COGS 100 / Cr Inventory 100).
    const lines: TrialBalanceLine[] = [
      { accountId: "inventory", accountCode: "inventory", accountName: "inventory", totalDebit: "1000.00", totalCredit: "100.00" },
      { accountId: "vat_input", accountCode: "vat_input", accountName: "vat_input", totalDebit: "150.00", totalCredit: "0.00" },
      { accountId: "accounts_payable", accountCode: "accounts_payable", accountName: "accounts_payable", totalDebit: "0.00", totalCredit: "1150.00" },
      { accountId: "cash", accountCode: "cash", accountName: "cash", totalDebit: "230.00", totalCredit: "0.00" },
      { accountId: "sales", accountCode: "sales", accountName: "sales", totalDebit: "0.00", totalCredit: "200.00" },
      { accountId: "vat_output", accountCode: "vat_output", accountName: "vat_output", totalDebit: "0.00", totalCredit: "30.00" },
      { accountId: "cogs", accountCode: "cogs", accountName: "cogs", totalDebit: "100.00", totalCredit: "0.00" },
    ];
    const service = new ReportingService(
      makeAccountingQueryService(lines),
      makeAccountTypeLookup(),
      makeLedgerRepo([]),
      makeAccountsService(),
    );

    const bs = await service.getBalanceSheet("org-1", "period-1");

    // Net income = (Sales 200 - COGS 100) = 100.00
    expect(bs.netIncomeNotYetClosed).toBe("100.0000");
    // Assets: Inventory (1000-100=900) + VAT Input 150 + Cash 230 = 1280
    expect(bs.totalAssets).toBe("1280.0000");
    // Liabilities: AP 1150 + VAT Output 30 = 1180
    expect(bs.totalLiabilities).toBe("1180.0000");
    expect(bs.totalEquity).toBe("0.0000"); // no opening balance equity posted in this scenario
    // 1180 + 0 + 100 = 1280 — matches totalAssets exactly
    expect(bs.totalLiabilitiesEquityAndIncome).toBe("1280.0000");
    expect(bs.isBalanced).toBe(true);
  });

  test("stays balanced even with an Opening Balance Equity line present", async () => {
    const lines: TrialBalanceLine[] = [
      { accountId: "inventory", accountCode: "inventory", accountName: "inventory", totalDebit: "500.00", totalCredit: "0.00" },
      { accountId: "opening_balance_equity", accountCode: "opening_balance_equity", accountName: "opening_balance_equity", totalDebit: "0.00", totalCredit: "500.00" },
    ];
    const service = new ReportingService(
      makeAccountingQueryService(lines),
      makeAccountTypeLookup(),
      makeLedgerRepo([]),
      makeAccountsService(),
    );

    const bs = await service.getBalanceSheet("org-1", "period-1");

    expect(bs.totalAssets).toBe("500.0000");
    expect(bs.totalEquity).toBe("500.0000");
    expect(bs.netIncomeNotYetClosed).toBe("0.0000");
    expect(bs.isBalanced).toBe(true);
  });
});

describe("ReportingService — Cash Flow Statement (Sprint 21)", () => {
  test("classifies ASSET_ACQUIRED as investing and everything else touching cash/bank as operating", async () => {
    const cashLines: LedgerLineRow[] = [
      { journalEntryId: "je-1", sourceEvent: "POS_SALE_COMPLETED", debit: "230.00", credit: "0.00" },
      { journalEntryId: "je-2", sourceEvent: "EXPENSE_POSTED", debit: "0.00", credit: "115.00" },
    ];
    const bankLines: LedgerLineRow[] = [
      { journalEntryId: "je-3", sourceEvent: "ASSET_ACQUIRED", debit: "0.00", credit: "12000.00" },
    ];
    const ledgerRepo: GeneralLedgerRepository = {
      getLedgerLines: jest.fn().mockImplementation(async (_org: string, _period: string, accountId: string) =>
        accountId === "cash" ? cashLines : bankLines,
      ),
    };
    const service = new ReportingService(
      makeAccountingQueryService([]),
      makeAccountTypeLookup(),
      ledgerRepo,
      makeAccountsService(),
    );

    const cf = await service.getCashFlowStatement("org-1", "period-1");

    expect(cf.operatingActivities).toBe("115.0000"); // 230 - 115
    expect(cf.investingActivities).toBe("-12000.0000");
    expect(cf.financingActivities).toBe("0.0000");
    expect(cf.netChangeInCash).toBe("-11885.0000");
  });

  test("a BANK_TRANSFER between Cash and Bank nets to exactly zero automatically", async () => {
    const cashLines: LedgerLineRow[] = [{ journalEntryId: "je-1", sourceEvent: "BANK_TRANSFER", debit: "0.00", credit: "500.00" }];
    const bankLines: LedgerLineRow[] = [{ journalEntryId: "je-1", sourceEvent: "BANK_TRANSFER", debit: "500.00", credit: "0.00" }];
    const ledgerRepo: GeneralLedgerRepository = {
      getLedgerLines: jest.fn().mockImplementation(async (_org: string, _period: string, accountId: string) =>
        accountId === "cash" ? cashLines : bankLines,
      ),
    };
    const service = new ReportingService(
      makeAccountingQueryService([]),
      makeAccountTypeLookup(),
      ledgerRepo,
      makeAccountsService(),
    );

    const cf = await service.getCashFlowStatement("org-1", "period-1");

    expect(cf.netChangeInCash).toBe("0.0000");
  });

  test("no cash activity at all results in a zeroed statement, not an error", async () => {
    const ledgerRepo: GeneralLedgerRepository = { getLedgerLines: jest.fn().mockResolvedValue([]) };
    const service = new ReportingService(
      makeAccountingQueryService([]),
      makeAccountTypeLookup(),
      ledgerRepo,
      makeAccountsService(),
    );

    const cf = await service.getCashFlowStatement("org-1", "period-1");

    expect(cf.netChangeInCash).toBe("0.0000");
    expect(cf.operatingActivities).toBe("0.0000");
  });
});
