import { BadRequestException } from "@nestjs/common";
import { Injectable } from "@nestjs/common";
import { AccountingPostingEngine } from "../accounting/accounting-posting-engine";
import { AccountsService } from "../accounts/accounts.service";

export interface BankTransferInput {
  organizationId: string;
  periodId: string;
  fromAccountCode: string; // e.g. "1100" Cash
  toAccountCode: string; // e.g. "1110" Bank
  amount: number;
  description?: string;
  idempotencyKey?: string;
}

@Injectable()
export class BankingService {
  constructor(
    private readonly postingEngine: AccountingPostingEngine,
    private readonly accountsService: AccountsService,
  ) {}

  /** Dr toAccount / Cr fromAccount — spec band 51 (Transfer between Bank Accounts/Cashboxes). */
  async transfer(input: BankTransferInput) {
    if (input.amount <= 0) {
      throw new BadRequestException("Transfer amount must be positive");
    }
    if (input.fromAccountCode === input.toAccountCode) {
      throw new BadRequestException("Cannot transfer an account to itself");
    }

    const fromAccountId = await this.accountsService.getAccountIdByCode(input.organizationId, input.fromAccountCode);
    const toAccountId = await this.accountsService.getAccountIdByCode(input.organizationId, input.toAccountCode);

    return this.postingEngine.post({
      organizationId: input.organizationId,
      periodId: input.periodId,
      sourceEvent: "BANK_TRANSFER",
      reference: input.description ?? `Transfer ${input.fromAccountCode} -> ${input.toAccountCode}`,
      idempotencyKey: input.idempotencyKey,
      lines: [
        { accountId: toAccountId, debit: input.amount.toFixed(2) },
        { accountId: fromAccountId, credit: input.amount.toFixed(2) },
      ],
    });
  }
}
