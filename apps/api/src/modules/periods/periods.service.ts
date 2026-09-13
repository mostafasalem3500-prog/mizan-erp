import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AccountingPostingEngine, PostingLineInput } from "../accounting/accounting-posting-engine";
import { AccountingQueryService } from "../accounting/accounting-query.service";
import { AccountsService } from "../accounts/accounts.service";

export type PeriodStatus = "OPEN" | "SOFT_CLOSED" | "CLOSED" | "LOCKED";

export interface PeriodRow {
  id: string;
  organizationId: string;
  status: PeriodStatus;
  startDate: string;
  endDate: string;
}

export interface CreatePeriodInput {
  organizationId: string;
  startDate: string; // ISO date
  endDate: string; // ISO date
}

export interface PeriodsRepository {
  listForOrganization(organizationId: string): Promise<PeriodRow[]>;
  create(input: CreatePeriodInput): Promise<PeriodRow>;
  findById(organizationId: string, periodId: string): Promise<PeriodRow | null>;
  updateStatus(organizationId: string, periodId: string, status: PeriodStatus): Promise<PeriodRow>;
}

/**
 * Spec band 18. Read side lists periods so a UI can offer a picker
 * instead of requiring the period id to be known in advance. The write
 * side (Sprint 31) closes a real usability gap: until now, exactly one
 * period was ever seeded per organization at creation time, with no way
 * to open a new one — meaning any business using this build past its
 * first period's end date would have nowhere to post new transactions.
 */
@Injectable()
export class PeriodsService {
  constructor(
    private readonly repo: PeriodsRepository,
    private readonly queryService?: AccountingQueryService,
    private readonly accountsService?: AccountsService,
    private readonly postingEngine?: AccountingPostingEngine,
  ) {}

  async listPeriods(organizationId: string): Promise<PeriodRow[]> {
    return this.repo.listForOrganization(organizationId);
  }

  async createPeriod(input: CreatePeriodInput): Promise<PeriodRow> {
    const start = new Date(input.startDate);
    const end = new Date(input.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException("startDate and endDate must be valid dates");
    }
    if (end <= start) {
      throw new BadRequestException("endDate must be after startDate");
    }

    const existing = await this.repo.listForOrganization(input.organizationId);
    const overlaps = existing.some((p) => {
      const pStart = new Date(p.startDate);
      const pEnd = new Date(p.endDate);
      return start < pEnd && end > pStart; // standard interval-overlap check
    });
    if (overlaps) {
      throw new BadRequestException("The new period's date range overlaps an existing period for this organization");
    }

    return this.repo.create(input);
  }

  async softClosePeriod(organizationId: string, periodId: string): Promise<PeriodRow> {
    const period = await this.requirePeriod(organizationId, periodId);
    if (period.status !== "OPEN") throw new BadRequestException(`Only an OPEN period can be soft-closed; current status is ${period.status}`);
    const trialBalance = await this.requireAccountingServices().queryService.getTrialBalance(organizationId, periodId);
    if (!trialBalance.isBalanced) throw new BadRequestException("Trial balance is not balanced; period cannot be closed");
    return this.repo.updateStatus(organizationId, periodId, "SOFT_CLOSED");
  }

  async reopenPeriod(organizationId: string, periodId: string): Promise<PeriodRow> {
    const period = await this.requirePeriod(organizationId, periodId);
    if (period.status !== "SOFT_CLOSED") throw new BadRequestException(`Only a SOFT_CLOSED period can be reopened; current status is ${period.status}`);
    return this.repo.updateStatus(organizationId, periodId, "OPEN");
  }

  async closePeriod(organizationId: string, periodId: string): Promise<{ period: PeriodRow; closingJournalEntryId?: string; closedBalances: number }> {
    const period = await this.requirePeriod(organizationId, periodId);
    if (!["OPEN", "SOFT_CLOSED"].includes(period.status)) {
      throw new BadRequestException(`Period cannot be closed from status ${period.status}`);
    }
    const { queryService, accountsService, postingEngine } = this.requireAccountingServices();
    const trialBalance = await queryService.getTrialBalance(organizationId, periodId);
    if (!trialBalance.isBalanced) throw new BadRequestException("Trial balance is not balanced; period cannot be closed");

    const accounts = await accountsService.listAccounts(organizationId);
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    const temporaryTypes = new Set(["REVENUE", "COST_OF_SALES", "EXPENSE", "OTHER_INCOME", "OTHER_EXPENSE"]);
    const closingLines: PostingLineInput[] = [];
    let debitMinor = 0n;
    let creditMinor = 0n;

    for (const line of trialBalance.lines) {
      const account = accountById.get(line.accountId);
      if (!account || !temporaryTypes.has(account.type)) continue;
      const balance = toScaled(line.totalDebit) - toScaled(line.totalCredit);
      if (balance > 0n) {
        const credit = fromScaled(balance);
        closingLines.push({ accountId: line.accountId, credit, description: `إقفال ${account.nameAr}` });
        creditMinor += balance;
      } else if (balance < 0n) {
        const debit = fromScaled(-balance);
        closingLines.push({ accountId: line.accountId, debit, description: `إقفال ${account.nameAr}` });
        debitMinor += -balance;
      }
    }

    let closingJournalEntryId: string | undefined;
    if (closingLines.length) {
      const retainedEarningsId = await accountsService.getAccountIdByCode(organizationId, "3200");
      if (debitMinor > creditMinor) {
        closingLines.push({ accountId: retainedEarningsId, credit: fromScaled(debitMinor - creditMinor), description: "ترحيل نتيجة الفترة إلى الأرباح المبقاة" });
      } else if (creditMinor > debitMinor) {
        closingLines.push({ accountId: retainedEarningsId, debit: fromScaled(creditMinor - debitMinor), description: "ترحيل نتيجة الفترة إلى الأرباح المبقاة" });
      }
      const entry = await postingEngine.post({
        organizationId,
        periodId,
        sourceEvent: "PERIOD_CLOSED",
        sourceDocId: periodId,
        reference: `قيد إقفال الفترة ${period.startDate.slice(0, 10)} — ${period.endDate.slice(0, 10)}`,
        idempotencyKey: `period-close-${periodId}`,
        lines: closingLines,
      });
      closingJournalEntryId = entry.id;
    }

    const closed = await this.repo.updateStatus(organizationId, periodId, "CLOSED");
    return { period: closed, closingJournalEntryId, closedBalances: closingLines.length ? closingLines.length - 1 : 0 };
  }

  private async requirePeriod(organizationId: string, periodId: string): Promise<PeriodRow> {
    const period = await this.repo.findById(organizationId, periodId);
    if (!period) throw new NotFoundException(`Accounting period ${periodId} not found`);
    return period;
  }

  private requireAccountingServices() {
    if (!this.queryService || !this.accountsService || !this.postingEngine) {
      throw new Error("Accounting period lifecycle services are not configured");
    }
    return { queryService: this.queryService, accountsService: this.accountsService, postingEngine: this.postingEngine };
  }
}

function toScaled(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  const sign = whole.startsWith("-") ? -1n : 1n;
  return sign * (BigInt(whole.replace("-", "") || "0") * 10000n + BigInt((fraction + "0000").slice(0, 4)));
}

function fromScaled(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 10000n}.${(absolute % 10000n).toString().padStart(4, "0")}`;
}
