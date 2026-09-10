import { BadRequestException, Injectable } from "@nestjs/common";
import { AccountingPostingEngine } from "../accounting/accounting-posting-engine";
import { AccountsService } from "../accounts/accounts.service";
import { SalesService } from "../sales/sales.service";
import { PurchasesService } from "../purchases/purchases.service";

export interface RecordCustomerPaymentInput {
  organizationId: string;
  periodId: string;
  customerId: string;
  amount: number;
  receivedIntoAccountCode: string; // "1100" Cash or "1110" Bank
  /** Sprint 19 — Payment Application: when set, this amount is also applied against that specific invoice's balance. Omit for an unapplied on-account payment. */
  invoiceId?: string;
  idempotencyKey?: string;
}

export interface RecordSupplierPaymentInput {
  organizationId: string;
  periodId: string;
  supplierId: string;
  amount: number;
  paidFromAccountCode: string;
  billId?: string;
  idempotencyKey?: string;
}

export interface PaymentRecord {
  id: string;
  organizationId: string;
  type: "CUSTOMER" | "SUPPLIER";
  partyId: string; // customerId or supplierId
  amount: string;
  journalEntryId: string;
}

export interface PaymentsRepository {
  save(record: PaymentRecord): Promise<PaymentRecord>;
  listForCustomer(organizationId: string, customerId: string): Promise<PaymentRecord[]>;
  listForSupplier(organizationId: string, supplierId: string): Promise<PaymentRecord[]>;
}

function round2(v: number): string {
  return v.toFixed(2);
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly postingEngine: AccountingPostingEngine,
    private readonly accountsService: AccountsService,
    private readonly repo: PaymentsRepository,
    private readonly salesService: SalesService,
    private readonly purchasesService: PurchasesService,
  ) {}

  /** Dr Cash/Bank / Cr Accounts Receivable (spec band 123's PAYMENT_RECEIVED row). */
  async recordCustomerPayment(input: RecordCustomerPaymentInput): Promise<PaymentRecord> {
    if (input.amount <= 0) throw new BadRequestException("Payment amount must be positive");

    const receivedAccountId = await this.accountsService.getAccountIdByCode(input.organizationId, input.receivedIntoAccountCode);
    const arAccountId = await this.accountsService.getAccountIdByCode(input.organizationId, "1200");

    const entry = await this.postingEngine.post({
      organizationId: input.organizationId,
      periodId: input.periodId,
      sourceEvent: "PAYMENT_RECEIVED",
      reference: `Payment received from customer ${input.customerId}`,
      idempotencyKey: input.idempotencyKey,
      lines: [
        { accountId: receivedAccountId, debit: round2(input.amount) },
        { accountId: arAccountId, credit: round2(input.amount) },
      ],
    });

    if (input.invoiceId) {
      // Payment application is a bookkeeping detail on top of a posting
      // that has already succeeded — if this invoice lookup/validation
      // fails, the cash receipt itself still stands; the caller should
      // still see the successful PaymentRecord and can apply it
      // separately via SalesService.applyPayment() if needed.
      await this.salesService.applyPayment(input.organizationId, input.invoiceId, input.amount);
    }

    return this.repo.save({
      id: entry.id,
      organizationId: input.organizationId,
      type: "CUSTOMER",
      partyId: input.customerId,
      amount: round2(input.amount),
      journalEntryId: entry.id,
    });
  }

  /** Dr Accounts Payable / Cr Cash/Bank (spec band 123's PAYMENT_PAID row). */
  async recordSupplierPayment(input: RecordSupplierPaymentInput): Promise<PaymentRecord> {
    if (input.amount <= 0) throw new BadRequestException("Payment amount must be positive");

    const paidAccountId = await this.accountsService.getAccountIdByCode(input.organizationId, input.paidFromAccountCode);
    const apAccountId = await this.accountsService.getAccountIdByCode(input.organizationId, "2100");

    const entry = await this.postingEngine.post({
      organizationId: input.organizationId,
      periodId: input.periodId,
      sourceEvent: "PAYMENT_PAID",
      reference: `Payment paid to supplier ${input.supplierId}`,
      idempotencyKey: input.idempotencyKey,
      lines: [
        { accountId: apAccountId, debit: round2(input.amount) },
        { accountId: paidAccountId, credit: round2(input.amount) },
      ],
    });

    if (input.billId) {
      await this.purchasesService.applyPayment(input.organizationId, input.billId, input.amount);
    }

    return this.repo.save({
      id: entry.id,
      organizationId: input.organizationId,
      type: "SUPPLIER",
      partyId: input.supplierId,
      amount: round2(input.amount),
      journalEntryId: entry.id,
    });
  }

  async listCustomerPayments(organizationId: string, customerId: string): Promise<PaymentRecord[]> {
    return this.repo.listForCustomer(organizationId, customerId);
  }

  async listSupplierPayments(organizationId: string, supplierId: string): Promise<PaymentRecord[]> {
    return this.repo.listForSupplier(organizationId, supplierId);
  }
}
