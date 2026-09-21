import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AccountingPostingEngine } from "../accounting/accounting-posting-engine";
import { CustomersService } from "../customers/customers.service";
import { calculateDocumentTax, type TaxCode } from "../tax/tax-engine";

export interface SalesInvoiceLineInput {
  description: string;
  quantity: number;
  unitPrice: number;
  taxCode: TaxCode;
  taxExemptionReasonCode?: string;
  taxExemptionReason?: string;
}

export interface CreateSalesInvoiceInput {
  organizationId: string;
  branchId?: string;
  periodId: string;
  customerId: string;
  lines: SalesInvoiceLineInput[];
  idempotencyKey?: string;
}

export interface SalesInvoiceRecord {
  id: string;
  organizationId: string;
  customerId: string;
  periodId: string;
  lines: SalesInvoiceLineInput[];
  subtotal: string;
  taxTotal: string;
  total: string;
  journalEntryId: string;
  issueDate: string; // ISO timestamp — spec band 95/Aging needs this
  paidAmount: string; // Sprint 19: running total applied via PaymentsService.recordCustomerPayment(invoiceId=...)
}

/**
 * Where the GL posting lands — spec band 20: never hardcode account codes
 * in source; this comes from organization settings, not a constant here.
 * Phase 0 stand-in until Settings/COA lookup exists.
 */
export interface SalesGLAccountMapping {
  accountsReceivableAccountId: string;
  salesRevenueAccountId: string;
  vatOutputAccountId: string;
}

export interface SalesRepository {
  getGLAccountMapping(organizationId: string): Promise<SalesGLAccountMapping>;
  saveInvoice(record: SalesInvoiceRecord): Promise<SalesInvoiceRecord>;
  findInvoice(organizationId: string, invoiceId: string): Promise<SalesInvoiceRecord | null>;
  listInvoicesForCustomer(organizationId: string, customerId: string): Promise<SalesInvoiceRecord[]>;
  listAllInvoices(organizationId: string): Promise<SalesInvoiceRecord[]>;
}

@Injectable()
export class SalesService {
  constructor(
    private readonly postingEngine: AccountingPostingEngine,
    private readonly customersService: CustomersService,
    private readonly repo: SalesRepository,
  ) {}

  /**
   * Simple Mode per spec band 22: Invoice -> Payment, no Quotation/SO/
   * Delivery workflow. This is NOT the full Canonical Invoice Model (bands
   * 60-84) — no snapshot, no template, no ZATCA submission. It exists to
   * prove Sales posts through AccountingPostingEngine like every other
   * module must (band 14), not to be the finished Invoice Engine.
   */
  async createInvoice(input: CreateSalesInvoiceInput): Promise<SalesInvoiceRecord> {
    if (input.lines.length === 0) {
      throw new BadRequestException("An invoice must have at least one line");
    }

    const customer = await this.customersService.getCustomer(input.organizationId, input.customerId);
    if (!customer) {
      throw new NotFoundException(`Customer ${input.customerId} not found`);
    }

    const tax = calculateDocumentTax(input.lines);

    const glMapping = await this.repo.getGLAccountMapping(input.organizationId);

    const journalEntry = await this.postingEngine.post({
      organizationId: input.organizationId,
      branchId: input.branchId,
      periodId: input.periodId,
      sourceEvent: "SALE_INVOICE_POSTED",
      reference: `Sales invoice for customer ${input.customerId}`,
      idempotencyKey: input.idempotencyKey,
      lines: [
        { accountId: glMapping.accountsReceivableAccountId, debit: tax.total },
        { accountId: glMapping.salesRevenueAccountId, credit: tax.subtotal },
        ...(Number(tax.taxTotal) > 0
          ? [{ accountId: glMapping.vatOutputAccountId, credit: tax.taxTotal }]
          : []),
      ],
    });

    return this.repo.saveInvoice({
      id: journalEntry.id, // Phase 0: invoice id piggybacks on the journal entry id; a real invoices table gets its own id + journalEntryId FK
      organizationId: input.organizationId,
      customerId: input.customerId,
      periodId: input.periodId,
      lines: input.lines,
      subtotal: tax.subtotal,
      taxTotal: tax.taxTotal,
      total: tax.total,
      journalEntryId: journalEntry.id,
      issueDate: new Date().toISOString(),
      paidAmount: "0.00",
    });
  }

  async getInvoice(organizationId: string, invoiceId: string): Promise<SalesInvoiceRecord | null> {
    return this.repo.findInvoice(organizationId, invoiceId);
  }

  async listInvoicesForCustomer(organizationId: string, customerId: string): Promise<SalesInvoiceRecord[]> {
    return this.repo.listInvoicesForCustomer(organizationId, customerId);
  }

  async listAllInvoices(organizationId: string): Promise<SalesInvoiceRecord[]> {
    return this.repo.listAllInvoices(organizationId);
  }

  /**
   * Applies part or all of a payment to a specific invoice (Sprint 19 —
   * Payment Application). Rejects a payment that would push paidAmount
   * past the invoice total — an invoice can be fully paid but never
   * overpaid through this path (a real overpayment/credit scenario is a
   * separate, deliberately out-of-scope feature).
   */
  async applyPayment(organizationId: string, invoiceId: string, amount: number): Promise<SalesInvoiceRecord> {
    const invoice = await this.repo.findInvoice(organizationId, invoiceId);
    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }
    const newPaid = Number(invoice.paidAmount) + amount;
    if (newPaid > Number(invoice.total) + 0.005) {
      throw new BadRequestException(
        `Applying ${amount.toFixed(2)} would overpay invoice ${invoiceId}: total ${invoice.total}, already paid ${invoice.paidAmount}`,
      );
    }
    return this.repo.saveInvoice({ ...invoice, paidAmount: newPaid.toFixed(2) });
  }
}
