import { BadRequestException, Injectable } from "@nestjs/common";
import { AccountingPostingEngine } from "../accounting/accounting-posting-engine";
import { AccountsService } from "../accounts/accounts.service";

const TAX_RATE_BY_CODE: Record<string, number> = { STANDARD: 0.15, ZERO: 0, EXEMPT: 0, OUT_OF_SCOPE: 0 };

export interface RecordExpenseInput {
  organizationId: string;
  periodId: string;
  /** Chart of Accounts code for the expense category, e.g. "6100" General Expense (spec band 24 — expense account is chosen, not hardcoded). */
  expenseAccountCode: string;
  /** Chart of Accounts code for how it was paid — "1100" Cash, "1110" Bank, or "2100" Accounts Payable if unpaid. */
  paymentAccountCode: string;
  amount: number;
  taxCode: keyof typeof TAX_RATE_BY_CODE;
  description: string;
  idempotencyKey?: string;
}

export interface ExpenseRecord {
  id: string;
  organizationId: string;
  expenseAccountCode: string;
  paymentAccountCode: string;
  amount: string;
  taxAmount: string;
  total: string;
  description: string;
  journalEntryId: string;
}

export interface ExpensesRepository {
  save(record: ExpenseRecord): Promise<ExpenseRecord>;
  findById(organizationId: string, expenseId: string): Promise<ExpenseRecord | null>;
}

function round2(v: number): string {
  return v.toFixed(2);
}

@Injectable()
export class ExpensesService {
  constructor(
    private readonly postingEngine: AccountingPostingEngine,
    private readonly accountsService: AccountsService,
    private readonly repo: ExpensesRepository,
  ) {}

  /** Dr Expense Account + VAT Input (if applicable) / Cr Payment Account (spec band 24 -> automatic posting). */
  async recordExpense(input: RecordExpenseInput): Promise<ExpenseRecord> {
    if (input.amount <= 0) {
      throw new BadRequestException("Expense amount must be positive");
    }
    const rate = TAX_RATE_BY_CODE[input.taxCode];
    if (rate === undefined) {
      throw new BadRequestException(`Unknown tax code "${input.taxCode}"`);
    }

    const taxAmount = input.amount * rate;
    const total = input.amount + taxAmount;

    const expenseAccountId = await this.accountsService.getAccountIdByCode(input.organizationId, input.expenseAccountCode);
    const paymentAccountId = await this.accountsService.getAccountIdByCode(input.organizationId, input.paymentAccountCode);
    const vatInputAccountId =
      taxAmount > 0 ? await this.accountsService.getAccountIdByCode(input.organizationId, "1400") : undefined;

    const entry = await this.postingEngine.post({
      organizationId: input.organizationId,
      periodId: input.periodId,
      sourceEvent: "EXPENSE_POSTED",
      reference: input.description,
      idempotencyKey: input.idempotencyKey,
      lines: [
        { accountId: expenseAccountId, debit: round2(input.amount) },
        ...(vatInputAccountId ? [{ accountId: vatInputAccountId, debit: round2(taxAmount) }] : []),
        { accountId: paymentAccountId, credit: round2(total) },
      ],
    });

    return this.repo.save({
      id: entry.id,
      organizationId: input.organizationId,
      expenseAccountCode: input.expenseAccountCode,
      paymentAccountCode: input.paymentAccountCode,
      amount: round2(input.amount),
      taxAmount: round2(taxAmount),
      total: round2(total),
      description: input.description,
      journalEntryId: entry.id,
    });
  }

  async getExpense(organizationId: string, expenseId: string): Promise<ExpenseRecord | null> {
    return this.repo.findById(organizationId, expenseId);
  }
}
