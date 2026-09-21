import { BadRequestException, Injectable } from "@nestjs/common";
import { AccountingPostingEngine } from "../accounting/accounting-posting-engine";
import { AccountsService } from "../accounts/accounts.service";
import { calculateDocumentTax, type TaxCode } from "../tax/tax-engine";

export interface RecordExpenseInput {
  organizationId: string;
  periodId: string;
  /** Chart of Accounts code for the expense category, e.g. "6100" General Expense (spec band 24 — expense account is chosen, not hardcoded). */
  expenseAccountCode: string;
  /** Chart of Accounts code for how it was paid — "1100" Cash, "1110" Bank, or "2100" Accounts Payable if unpaid. */
  paymentAccountCode: string;
  amount: number;
  taxCode: TaxCode;
  taxExemptionReasonCode?: string;
  taxExemptionReason?: string;
  description: string;
  idempotencyKey?: string;
}

export interface ExpenseRecord {
  id: string;
  organizationId: string;
  periodId: string;
  expenseAccountCode: string;
  paymentAccountCode: string;
  amount: string;
  taxCode: TaxCode;
  taxAmount: string;
  total: string;
  description: string;
  journalEntryId: string;
}

export interface ExpensesRepository {
  save(record: ExpenseRecord): Promise<ExpenseRecord>;
  findById(organizationId: string, expenseId: string): Promise<ExpenseRecord | null>;
  listAll(organizationId: string): Promise<ExpenseRecord[]>;
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
    const tax = calculateDocumentTax([{ description: input.description, quantity: 1, unitPrice: input.amount, taxCode: input.taxCode, taxExemptionReasonCode: input.taxExemptionReasonCode, taxExemptionReason: input.taxExemptionReason }]);

    const expenseAccountId = await this.accountsService.getAccountIdByCode(input.organizationId, input.expenseAccountCode);
    const paymentAccountId = await this.accountsService.getAccountIdByCode(input.organizationId, input.paymentAccountCode);
    const vatInputAccountId =
      Number(tax.taxTotal) > 0 ? await this.accountsService.getAccountIdByCode(input.organizationId, "1400") : undefined;

    const entry = await this.postingEngine.post({
      organizationId: input.organizationId,
      periodId: input.periodId,
      sourceEvent: "EXPENSE_POSTED",
      reference: input.description,
      idempotencyKey: input.idempotencyKey,
      lines: [
        { accountId: expenseAccountId, debit: tax.subtotal },
        ...(vatInputAccountId ? [{ accountId: vatInputAccountId, debit: tax.taxTotal }] : []),
        { accountId: paymentAccountId, credit: tax.total },
      ],
    });

    return this.repo.save({
      id: entry.id,
      organizationId: input.organizationId,
      periodId: input.periodId,
      expenseAccountCode: input.expenseAccountCode,
      paymentAccountCode: input.paymentAccountCode,
      amount: tax.subtotal,
      taxCode: input.taxCode,
      taxAmount: tax.taxTotal,
      total: tax.total,
      description: input.description,
      journalEntryId: entry.id,
    });
  }

  async getExpense(organizationId: string, expenseId: string): Promise<ExpenseRecord | null> {
    return this.repo.findById(organizationId, expenseId);
  }

  async listAll(organizationId: string): Promise<ExpenseRecord[]> {
    return this.repo.listAll(organizationId);
  }
}
