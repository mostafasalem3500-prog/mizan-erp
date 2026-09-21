import { Injectable } from "@nestjs/common";
import { SalesService } from "../sales/sales.service";
import { PurchasesService } from "../purchases/purchases.service";
import { ExpensesService } from "../expenses/expenses.service";
import { PosService } from "../pos/pos.service";
import { AccountingQueryService } from "../accounting/accounting-query.service";
import { AccountsService } from "../accounts/accounts.service";
import { calculateDocumentTax, fromHalalas, toHalalas, type TaxCode } from "./tax-engine";

type Bucket = Record<TaxCode, { taxableMinor: number; taxMinor: number }>;

function emptyBucket(): Bucket {
  return {
    STANDARD: { taxableMinor: 0, taxMinor: 0 },
    ZERO: { taxableMinor: 0, taxMinor: 0 },
    EXEMPT: { taxableMinor: 0, taxMinor: 0 },
    OUT_OF_SCOPE: { taxableMinor: 0, taxMinor: 0 },
  };
}

function addLines(bucket: Bucket, lines: Array<{ description: string; quantity: number; unitPrice: number; taxCode: TaxCode; taxExemptionReasonCode?: string; taxExemptionReason?: string }>) {
  if (!lines.length) return;
  const tax = calculateDocumentTax(lines);
  for (const category of tax.categories) {
    bucket[category.code].taxableMinor += toHalalas(Number(category.taxableAmount));
    bucket[category.code].taxMinor += toHalalas(Number(category.taxAmount));
  }
}

function serialize(bucket: Bucket) {
  return (Object.keys(bucket) as TaxCode[]).map((code) => ({
    code,
    taxableAmount: fromHalalas(bucket[code].taxableMinor),
    taxAmount: fromHalalas(bucket[code].taxMinor),
  }));
}

@Injectable()
export class VatReportingService {
  constructor(
    private readonly sales: SalesService,
    private readonly purchases: PurchasesService,
    private readonly expenses: ExpensesService,
    private readonly pos: PosService,
    private readonly accounting: AccountingQueryService,
    private readonly accounts: AccountsService,
  ) {}

  /**
   * Working-paper summary, not an electronic VAT-return submission.
   * It reconciles source documents by tax category to the VAT control
   * accounts for one accounting period, so differences are visible before
   * a user prepares the official ZATCA return.
   */
  async getPeriodSummary(organizationId: string, periodId: string) {
    const [salesInvoices, purchaseBills, expenses, posSales, trialBalance, outputAccountId, inputAccountId] = await Promise.all([
      this.sales.listAllInvoices(organizationId),
      this.purchases.listAllBills(organizationId),
      this.expenses.listAll(organizationId),
      this.pos.searchSales(organizationId),
      this.accounting.getTrialBalance(organizationId, periodId),
      this.accounts.getAccountIdByCode(organizationId, "2200"),
      this.accounts.getAccountIdByCode(organizationId, "1400"),
    ]);

    const output = emptyBucket();
    const input = emptyBucket();
    const periodSales = salesInvoices.filter((document) => document.periodId === periodId);
    const periodPurchases = purchaseBills.filter((document) => document.periodId === periodId);
    const periodExpenses = expenses.filter((document) => document.periodId === periodId);
    const periodPos = posSales.filter((document) => document.periodId === periodId);

    for (const invoice of periodSales) addLines(output, invoice.lines);
    for (const sale of periodPos) {
      addLines(output, sale.lines.map((line, index) => ({ ...line, quantity: sale.remainingQuantities[index] ?? line.quantity })));
    }
    for (const bill of periodPurchases) {
      addLines(input, bill.lines.map((line) => ({ ...line, unitPrice: line.unitCost })));
    }
    for (const expense of periodExpenses) {
      addLines(input, [{ description: expense.description, quantity: 1, unitPrice: Number(expense.amount), taxCode: expense.taxCode }]);
    }

    const outputVatMinor = output.STANDARD.taxMinor;
    const inputVatMinor = input.STANDARD.taxMinor;
    const outputLedger = trialBalance.lines.find((line) => line.accountId === outputAccountId);
    const inputLedger = trialBalance.lines.find((line) => line.accountId === inputAccountId);
    const glOutputMinor = outputLedger ? toHalalas(Number(outputLedger.totalCredit) - Number(outputLedger.totalDebit)) : 0;
    const glInputMinor = inputLedger ? toHalalas(Number(inputLedger.totalDebit) - Number(inputLedger.totalCredit)) : 0;
    const outputDifference = outputVatMinor - glOutputMinor;
    const inputDifference = inputVatMinor - glInputMinor;

    const unassigned = {
      salesInvoices: salesInvoices.filter((d) => !d.periodId).length,
      purchaseBills: purchaseBills.filter((d) => !d.periodId).length,
      expenses: expenses.filter((d) => !d.periodId).length,
    };

    return {
      periodId,
      currency: "SAR",
      sales: serialize(output),
      purchases: serialize(input),
      totals: {
        outputVat: fromHalalas(outputVatMinor),
        recoverableInputVat: fromHalalas(inputVatMinor),
        netVatPayable: fromHalalas(outputVatMinor - inputVatMinor),
      },
      reconciliation: {
        outputVatLedger: fromHalalas(glOutputMinor),
        inputVatLedger: fromHalalas(glInputMinor),
        outputDifference: fromHalalas(outputDifference),
        inputDifference: fromHalalas(inputDifference),
        isReconciled: outputDifference === 0 && inputDifference === 0,
      },
      sourceDocuments: {
        salesInvoices: periodSales.length,
        posSales: periodPos.length,
        purchaseBills: periodPurchases.length,
        expenses: periodExpenses.length,
      },
      legacyDocumentsWithoutPeriod: unassigned,
      phaseReadiness: {
        phase1Generation: true,
        phase2XmlStructure: true,
        phase2CryptographicStamping: false,
        phase2LiveClearanceReporting: false,
      },
      noticeAr: "ملخص عمل داخلي للمراجعة والمصالحة، وليس إقرارًا ضريبيًا مقدمًا إلى هيئة الزكاة والضريبة والجمارك.",
    };
  }
}

