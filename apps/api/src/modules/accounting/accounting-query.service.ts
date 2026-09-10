import { Injectable } from "@nestjs/common";

export interface TrialBalanceLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  totalDebit: string;
  totalCredit: string;
}

/**
 * Everything the read side needs — deliberately separate from
 * PrismaClientLike in accounting-posting-engine.ts, because trial-balance
 * aggregation is a raw/grouped query (band 12: "raw SQL for complex
 * accounting queries") rather than a simple create/update, and mixing the
 * two concerns in one interface would blur write-path vs. read-path
 * responsibilities.
 */
export interface AccountingQueryRepository {
  /**
   * One row per account that has at least one posted line in the given
   * period, with debit/credit already summed — the SQL-level grouping is
   * the repository's job (raw query against journal_entry_lines joined to
   * accounts joined to journal_entries filtered by organization + period),
   * not something this service re-derives from raw rows.
   */
  getTrialBalanceForPeriod(organizationId: string, periodId: string): Promise<TrialBalanceLine[]>;
}

export interface TrialBalanceResult {
  lines: TrialBalanceLine[];
  totalDebit: string;
  totalCredit: string;
  isBalanced: boolean;
}

@Injectable()
export class AccountingQueryService {
  constructor(private readonly repo: AccountingQueryRepository) {}

  async getTrialBalance(organizationId: string, periodId: string): Promise<TrialBalanceResult> {
    const lines = await this.repo.getTrialBalanceForPeriod(organizationId, periodId);

    let totalDebitCents = 0n;
    let totalCreditCents = 0n;

    for (const line of lines) {
      totalDebitCents += toCents(line.totalDebit);
      totalCreditCents += toCents(line.totalCredit);
    }

    return {
      lines,
      totalDebit: fromCents(totalDebitCents),
      totalCredit: fromCents(totalCreditCents),
      // The trial balance summing to zero is a consequence of the posting
      // engine's Debit=Credit invariant (bands 14-15) holding for every
      // entry that fed into it — this flag is a sanity check on the report
      // itself, not a substitute for that invariant.
      isBalanced: totalDebitCents === totalCreditCents,
    };
  }
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
