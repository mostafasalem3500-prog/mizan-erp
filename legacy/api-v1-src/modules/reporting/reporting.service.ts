import { Injectable } from "@nestjs/common";
import { AccountingQueryService } from "../accounting/accounting-query.service";
import { AccountsService } from "../accounts/accounts.service";

export type AccountType =
  | "ASSET"
  | "LIABILITY"
  | "EQUITY"
  | "REVENUE"
  | "COST_OF_SALES"
  | "EXPENSE"
  | "OTHER_INCOME"
  | "OTHER_EXPENSE";

/**
 * Classifies a GL account id into its AccountType for statement grouping.
 * Phase 0 has no Chart-of-Accounts CRUD module yet (band 19-20) — this is
 * a lookup interface so the classification lives in a Repository, not a
 * hardcoded switch statement in the report logic itself.
 */
export interface AccountTypeLookup {
  getAccountType(organizationId: string, accountId: string): Promise<AccountType | null>;
}

export interface LedgerLineRow {
  journalEntryId: string;
  sourceEvent: string;
  reference?: string;
  debit: string;
  credit: string;
}

export interface GeneralLedgerLine extends LedgerLineRow {
  runningBalance: string;
}

export interface GeneralLedgerRepository {
  /** Chronological order (insertion order is acceptable for Phase 0 — no explicit posting-sequence column yet). */
  getLedgerLines(organizationId: string, periodId: string, accountId: string): Promise<LedgerLineRow[]>;
}

export interface ProfitAndLossResult {
  revenue: string;
  costOfSales: string;
  grossProfit: string;
  operatingExpenses: string;
  otherIncome: string;
  otherExpenses: string;
  netIncome: string;
}

export interface BalanceSheetSection {
  accountId: string;
  balance: string;
}

export interface CashFlowResult {
  operatingActivities: string;
  investingActivities: string;
  financingActivities: string;
  netChangeInCash: string;
}

export interface BalanceSheetResult {
  assets: BalanceSheetSection[];
  liabilities: BalanceSheetSection[];
  equity: BalanceSheetSection[];
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  /**
   * Current-period net income not yet closed to Retained Earnings (no
   * period-closing pipeline exists yet — band 18 covers period status,
   * not the closing entries themselves). Shown as its own line so the
   * sheet balances honestly instead of silently folding it into Equity.
   */
  netIncomeNotYetClosed: string;
  totalLiabilitiesEquityAndIncome: string;
  isBalanced: boolean;
}

function toCents(decimalStr: string): bigint {
  const [whole, frac = ""] = decimalStr.split(".");
  const paddedFrac = (frac + "0000").slice(0, 4);
  const sign = whole.startsWith("-") ? -1n : 1n;
  const wholeAbs = whole.replace("-", "") || "0";
  return sign * (BigInt(wholeAbs) * 10000n + BigInt(paddedFrac));
}

function fromCents(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 10000n;
  const frac = (abs % 10000n).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

@Injectable()
export class ReportingService {
  constructor(
    private readonly accountingQueryService: AccountingQueryService,
    private readonly accountTypeLookup: AccountTypeLookup,
    private readonly ledgerRepo: GeneralLedgerRepository,
    private readonly accountsService: AccountsService,
  ) {}

  /** Spec band 95/99 — a real ledger listing with a running balance, not just the aggregated Trial Balance total. */
  async getGeneralLedger(organizationId: string, periodId: string, accountId: string): Promise<GeneralLedgerLine[]> {
    const lines = await this.ledgerRepo.getLedgerLines(organizationId, periodId, accountId);
    let running = 0n;
    return lines.map((line) => {
      running += toCents(line.debit) - toCents(line.credit);
      return { ...line, runningBalance: fromCents(running) };
    });
  }

  async getProfitAndLoss(organizationId: string, periodId: string): Promise<ProfitAndLossResult> {
    const trialBalance = await this.accountingQueryService.getTrialBalance(organizationId, periodId);

    let revenue = 0n;
    let costOfSales = 0n;
    let operatingExpenses = 0n;
    let otherIncome = 0n;
    let otherExpenses = 0n;

    for (const line of trialBalance.lines) {
      const type = await this.accountTypeLookup.getAccountType(organizationId, line.accountId);
      const debit = toCents(line.totalDebit);
      const credit = toCents(line.totalCredit);

      switch (type) {
        case "REVENUE":
          revenue += credit - debit; // natural credit balance; a Sales Returns line nets out correctly here too
          break;
        case "COST_OF_SALES":
          costOfSales += debit - credit;
          break;
        case "EXPENSE":
          operatingExpenses += debit - credit;
          break;
        case "OTHER_INCOME":
          otherIncome += credit - debit;
          break;
        case "OTHER_EXPENSE":
          otherExpenses += debit - credit;
          break;
        default:
          break; // ASSET/LIABILITY/EQUITY lines don't belong on the P&L
      }
    }

    const grossProfit = revenue - costOfSales;
    const netIncome = grossProfit - operatingExpenses + otherIncome - otherExpenses;

    return {
      revenue: fromCents(revenue),
      costOfSales: fromCents(costOfSales),
      grossProfit: fromCents(grossProfit),
      operatingExpenses: fromCents(operatingExpenses),
      otherIncome: fromCents(otherIncome),
      otherExpenses: fromCents(otherExpenses),
      netIncome: fromCents(netIncome),
    };
  }

  /**
   * Assets = Liabilities + Equity + (current-period Net Income, not yet
   * closed). This identity holds precisely because every posted entry
   * satisfies Debit=Credit (AccountingPostingEngine's own invariant) — see
   * the "balance sheet identity" test for a concrete proof against real
   * postings rather than an assumed formula.
   */
  async getBalanceSheet(organizationId: string, periodId: string): Promise<BalanceSheetResult> {
    const trialBalance = await this.accountingQueryService.getTrialBalance(organizationId, periodId);
    const netIncome = await this.getProfitAndLoss(organizationId, periodId);

    const assets: BalanceSheetSection[] = [];
    const liabilities: BalanceSheetSection[] = [];
    const equity: BalanceSheetSection[] = [];
    let totalAssets = 0n;
    let totalLiabilities = 0n;
    let totalEquity = 0n;

    for (const line of trialBalance.lines) {
      const type = await this.accountTypeLookup.getAccountType(organizationId, line.accountId);
      const debit = toCents(line.totalDebit);
      const credit = toCents(line.totalCredit);

      if (type === "ASSET") {
        const balance = debit - credit;
        assets.push({ accountId: line.accountId, balance: fromCents(balance) });
        totalAssets += balance;
      } else if (type === "LIABILITY") {
        const balance = credit - debit;
        liabilities.push({ accountId: line.accountId, balance: fromCents(balance) });
        totalLiabilities += balance;
      } else if (type === "EQUITY") {
        const balance = credit - debit;
        equity.push({ accountId: line.accountId, balance: fromCents(balance) });
        totalEquity += balance;
      }
    }

    const netIncomeCents = toCents(netIncome.netIncome);
    const totalLiabilitiesEquityAndIncome = totalLiabilities + totalEquity + netIncomeCents;

    return {
      assets,
      liabilities,
      equity,
      totalAssets: fromCents(totalAssets),
      totalLiabilities: fromCents(totalLiabilities),
      totalEquity: fromCents(totalEquity),
      netIncomeNotYetClosed: netIncome.netIncome,
      totalLiabilitiesEquityAndIncome: fromCents(totalLiabilitiesEquityAndIncome),
      isBalanced: totalAssets === totalLiabilitiesEquityAndIncome,
    };
  }

  /**
   * Direct-method Cash Flow Statement (spec band 95), derived from the
   * combined Cash (1100) + Bank (1110) ledger — treating both as one
   * "cash and cash equivalents" pool means a BANK_TRANSFER between them
   * nets to exactly zero automatically (it debits one and credits the
   * other by the same amount), without needing to special-case it.
   * Categorization is by sourceEvent: ASSET_ACQUIRED is Investing,
   * everything else that touches cash is Operating — this Phase 0 build
   * has no financing activity (loans, owner draws) yet, so that category
   * is always zero rather than omitted, so the shape stays stable once one exists.
   */
  async getCashFlowStatement(organizationId: string, periodId: string): Promise<CashFlowResult> {
    const cashAccountId = await this.accountsService.getAccountIdByCode(organizationId, "1100");
    const bankAccountId = await this.accountsService.getAccountIdByCode(organizationId, "1110");

    const [cashLines, bankLines] = await Promise.all([
      this.ledgerRepo.getLedgerLines(organizationId, periodId, cashAccountId),
      this.ledgerRepo.getLedgerLines(organizationId, periodId, bankAccountId),
    ]);

    let operating = 0n;
    let investing = 0n;
    const financing = 0n; // no financing-activity source events exist yet in this Phase 0 build

    for (const line of [...cashLines, ...bankLines]) {
      const net = toCents(line.debit) - toCents(line.credit);
      if (line.sourceEvent === "ASSET_ACQUIRED") {
        investing += net;
      } else {
        operating += net;
      }
    }

    const netChange = operating + investing + financing;

    return {
      operatingActivities: fromCents(operating),
      investingActivities: fromCents(investing),
      financingActivities: fromCents(financing),
      netChangeInCash: fromCents(netChange),
    };
  }
}
