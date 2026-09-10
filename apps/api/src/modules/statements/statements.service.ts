import { Injectable } from "@nestjs/common";
import { SalesService } from "../sales/sales.service";
import { PurchasesService } from "../purchases/purchases.service";
import { PaymentsService } from "../payments/payments.service";

export interface StatementLine {
  type: "INVOICE" | "PAYMENT";
  referenceId: string;
  amount: string; // invoices are positive (owed), payments are negative (reduces balance)
}

export interface StatementResult {
  lines: StatementLine[];
  totalInvoiced: string;
  totalPaid: string;
  balance: string;
}

/**
 * Scope note (spec band 21/95): this is NOT a full aged customer ledger —
 * there's no per-invoice payment application (which invoice a given
 * payment settles), no due dates, and no aging buckets yet (that's
 * Receivable/Payable Aging, a separate future report). This answers the
 * simpler, still-genuinely-useful question: "how much has this customer
 * been invoiced in total, how much have they paid in total, and what's
 * the net balance?" — built from real stored Sales/Purchases/Payments
 * records, not a placeholder.
 */
@Injectable()
export class StatementsService {
  constructor(
    private readonly salesService: SalesService,
    private readonly purchasesService: PurchasesService,
    private readonly paymentsService: PaymentsService,
  ) {}

  async getCustomerStatement(organizationId: string, customerId: string): Promise<StatementResult> {
    const lines: StatementLine[] = [];
    let totalInvoiced = 0;

    const invoices = await this.salesService.listInvoicesForCustomer(organizationId, customerId);
    for (const invoice of invoices) {
      lines.push({ type: "INVOICE", referenceId: invoice.id, amount: invoice.total });
      totalInvoiced += Number(invoice.total);
    }

    const payments = await this.paymentsService.listCustomerPayments(organizationId, customerId);
    let totalPaid = 0;
    for (const payment of payments) {
      lines.push({ type: "PAYMENT", referenceId: payment.id, amount: `-${payment.amount}` });
      totalPaid += Number(payment.amount);
    }

    return {
      lines,
      totalInvoiced: totalInvoiced.toFixed(2),
      totalPaid: totalPaid.toFixed(2),
      balance: (totalInvoiced - totalPaid).toFixed(2),
    };
  }

  async getSupplierStatement(organizationId: string, supplierId: string): Promise<StatementResult> {
    const lines: StatementLine[] = [];
    let totalInvoiced = 0;

    const bills = await this.purchasesService.listBillsForSupplier(organizationId, supplierId);
    for (const bill of bills) {
      lines.push({ type: "INVOICE", referenceId: bill.id, amount: bill.total });
      totalInvoiced += Number(bill.total);
    }

    const payments = await this.paymentsService.listSupplierPayments(organizationId, supplierId);
    let totalPaid = 0;
    for (const payment of payments) {
      lines.push({ type: "PAYMENT", referenceId: payment.id, amount: `-${payment.amount}` });
      totalPaid += Number(payment.amount);
    }

    return {
      lines,
      totalInvoiced: totalInvoiced.toFixed(2),
      totalPaid: totalPaid.toFixed(2),
      balance: (totalInvoiced - totalPaid).toFixed(2),
    };
  }
}
