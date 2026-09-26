import { BadRequestException } from "@nestjs/common";
import { calculateDocumentTax } from "./tax-engine";

describe("TaxEngine", () => {
  test("rounds VAT per line to halalas and returns an exact category reconciliation", () => {
    const result = calculateDocumentTax([
      { description: "A", quantity: 1, unitPrice: 37.5, taxCode: "STANDARD" },
      { description: "B", quantity: 1, unitPrice: 10, taxCode: "STANDARD" },
    ]);
    expect(result.subtotal).toBe("47.50");
    expect(result.taxTotal).toBe("7.13");
    expect(result.total).toBe("54.63");
    expect(result.categories).toEqual([
      expect.objectContaining({ code: "STANDARD", taxableAmount: "47.50", taxAmount: "7.13", zatcaCategory: "S" }),
    ]);
  });

  test("separates standard, zero, exempt and out-of-scope categories", () => {
    const result = calculateDocumentTax([
      { description: "Standard", quantity: 1, unitPrice: 100, taxCode: "STANDARD" },
      { description: "Zero", quantity: 1, unitPrice: 20, taxCode: "ZERO", taxExemptionReasonCode: "VATEX-SA-32" },
      { description: "Exempt", quantity: 1, unitPrice: 30, taxCode: "EXEMPT", taxExemptionReasonCode: "VATEX-SA-29" },
      { description: "Outside", quantity: 1, unitPrice: 40, taxCode: "OUT_OF_SCOPE" },
    ]);
    expect(result.categories.map((c) => c.code)).toEqual(["STANDARD", "ZERO", "EXEMPT", "OUT_OF_SCOPE"]);
    expect(result.taxTotal).toBe("15.00");
    expect(result.total).toBe("205.00");
    expect(result.warnings).toHaveLength(0);
  });

  test("flags missing ZATCA reason codes without changing correct accounting totals", () => {
    const result = calculateDocumentTax([{ description: "Export", quantity: 1, unitPrice: 100, taxCode: "ZERO" }]);
    expect(result.total).toBe("100.00");
    expect(result.warnings[0]).toMatch(/رمز سبب/);
  });

  test("rejects invalid quantity, price and unknown codes", () => {
    expect(() => calculateDocumentTax([{ description: "Bad", quantity: 0, unitPrice: 1, taxCode: "STANDARD" }])).toThrow(BadRequestException);
    expect(() => calculateDocumentTax([{ description: "Bad", quantity: 1, unitPrice: -1, taxCode: "STANDARD" }])).toThrow(BadRequestException);
    expect(() => calculateDocumentTax([{ description: "Bad", quantity: 1, unitPrice: 1, taxCode: "WRONG" as any }])).toThrow(BadRequestException);
  });
});
