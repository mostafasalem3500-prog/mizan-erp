import { BadRequestException } from "@nestjs/common";

/** ZATCA/EN16931 VAT categories used by Mizan's operational documents. */
export type TaxCode = "STANDARD" | "ZERO" | "EXEMPT" | "OUT_OF_SCOPE";
export type ZatcaVatCategory = "S" | "Z" | "E" | "O";

export const TAX_DEFINITIONS: Record<TaxCode, { rateBps: number; zatcaCategory: ZatcaVatCategory; labelAr: string }> = {
  STANDARD: { rateBps: 1500, zatcaCategory: "S", labelAr: "خاضع للنسبة الأساسية 15%" },
  ZERO: { rateBps: 0, zatcaCategory: "Z", labelAr: "خاضع لنسبة صفر" },
  EXEMPT: { rateBps: 0, zatcaCategory: "E", labelAr: "معفى من الضريبة" },
  OUT_OF_SCOPE: { rateBps: 0, zatcaCategory: "O", labelAr: "خارج نطاق الضريبة" },
};

export interface TaxableLineInput {
  description: string;
  quantity: number;
  unitPrice: number;
  taxCode: TaxCode;
  /** Required by the ZATCA XML rules for applicable zero-rated/exempt cases. */
  taxExemptionReasonCode?: string;
  taxExemptionReason?: string;
}

export interface CalculatedTaxLine extends TaxableLineInput {
  netAmount: string;
  taxAmount: string;
  grossAmount: string;
  zatcaCategory: ZatcaVatCategory;
  taxPercent: string;
}

export interface TaxCategoryTotal {
  code: TaxCode;
  zatcaCategory: ZatcaVatCategory;
  labelAr: string;
  taxableAmount: string;
  taxAmount: string;
  taxPercent: string;
}

export interface TaxCalculation {
  lines: CalculatedTaxLine[];
  categories: TaxCategoryTotal[];
  subtotal: string;
  taxTotal: string;
  total: string;
  warnings: string[];
}

/** Convert a decimal amount to integer halalas at the legal invoice precision boundary. */
export function toHalalas(value: number): number {
  if (!Number.isFinite(value)) throw new BadRequestException("Monetary amount must be a finite number");
  return Math.round((value + Math.sign(value || 1) * Number.EPSILON) * 100);
}

export function fromHalalas(value: number): string {
  return (value / 100).toFixed(2);
}

/**
 * One shared tax calculation for Sales, POS, Purchases and Expenses.
 * VAT is rounded per document line to halalas, then category/document totals
 * are the exact sum of those rounded lines. This keeps the invoice, GL and
 * VAT return reconcilable and avoids binary floating-point drift.
 */
export function calculateDocumentTax(lines: TaxableLineInput[]): TaxCalculation {
  if (lines.length === 0) throw new BadRequestException("A taxable document must have at least one line");

  let subtotalMinor = 0;
  let taxTotalMinor = 0;
  const warnings: string[] = [];
  const categoryMinor = new Map<TaxCode, { taxable: number; tax: number }>();

  const calculatedLines = lines.map((line) => {
    if (!line.description?.trim()) throw new BadRequestException("Line description is required");
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new BadRequestException(`Line "${line.description}" must have a positive quantity`);
    }
    if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
      throw new BadRequestException(`Line "${line.description}" must have a valid non-negative price`);
    }
    const definition = TAX_DEFINITIONS[line.taxCode];
    if (!definition) throw new BadRequestException(`Unknown tax code "${line.taxCode}"`);

    const netMinor = toHalalas(line.quantity * line.unitPrice);
    const taxMinor = Math.round((netMinor * definition.rateBps) / 10_000);
    const current = categoryMinor.get(line.taxCode) ?? { taxable: 0, tax: 0 };
    current.taxable += netMinor;
    current.tax += taxMinor;
    categoryMinor.set(line.taxCode, current);
    subtotalMinor += netMinor;
    taxTotalMinor += taxMinor;

    if ((line.taxCode === "ZERO" || line.taxCode === "EXEMPT") && !line.taxExemptionReasonCode) {
      warnings.push(`السطر «${line.description}» يحتاج رمز سبب ${line.taxCode === "ZERO" ? "النسبة الصفرية" : "الإعفاء"} قبل توليد XML للمرحلة الثانية.`);
    }

    return {
      ...line,
      netAmount: fromHalalas(netMinor),
      taxAmount: fromHalalas(taxMinor),
      grossAmount: fromHalalas(netMinor + taxMinor),
      zatcaCategory: definition.zatcaCategory,
      taxPercent: (definition.rateBps / 100).toFixed(2),
    };
  });

  const categories = (["STANDARD", "ZERO", "EXEMPT", "OUT_OF_SCOPE"] as TaxCode[])
    .filter((code) => categoryMinor.has(code))
    .map((code) => {
      const definition = TAX_DEFINITIONS[code];
      const amount = categoryMinor.get(code)!;
      return {
        code,
        zatcaCategory: definition.zatcaCategory,
        labelAr: definition.labelAr,
        taxableAmount: fromHalalas(amount.taxable),
        taxAmount: fromHalalas(amount.tax),
        taxPercent: (definition.rateBps / 100).toFixed(2),
      };
    });

  return {
    lines: calculatedLines,
    categories,
    subtotal: fromHalalas(subtotalMinor),
    taxTotal: fromHalalas(taxTotalMinor),
    total: fromHalalas(subtotalMinor + taxTotalMinor),
    warnings: [...new Set(warnings)],
  };
}

