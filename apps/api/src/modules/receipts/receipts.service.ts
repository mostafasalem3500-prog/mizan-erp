import { Injectable, NotFoundException } from "@nestjs/common";
import * as QRCode from "qrcode";
import { randomUUID } from "crypto";
import { OrganizationsService, OrganizationRow } from "../organizations/organizations.service";
import { PosService } from "../pos/pos.service";
import { SalesService } from "../sales/sales.service";
import { buildPhase1QR } from "../zatca/qr-encoder";
import { buildSimplifiedTaxInvoiceXml, ZatcaInvoiceLine, ZatcaVatCategory } from "../zatca/xml-invoice-builder";

export interface ReceiptLine {
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: string;
}

export interface ReceiptData {
  sellerName: string;
  sellerVatNumber?: string;
  documentNumber: string;
  issuedAt: string;
  lines: ReceiptLine[];
  subtotal: string;
  taxTotal: string;
  total: string;
  paymentSummary: string;
  /** Base64 PNG data URL — a real Phase-1 ZATCA QR, not a placeholder image. */
  qrCodeDataUrl: string;
  /**
   * A real ZATCA-structured UBL 2.1 XML draft (Sprint 30) — see
   * xml-invoice-builder.ts for exact scope and limitations. `undefined`
   * only when the organization is missing the address fields the XML
   * requires (street/building/city/postal/district) — Phase 0
   * organizations created before Sprint 30, or via paths that don't
   * collect a full address yet, won't have these.
   */
  xmlInvoice?: string;
  customer?: { name: string; vatNumber?: string; phone?: string; address?: string };
  sellerAddress?: string;
  sellerPhone?: string;
  sellerEmail?: string;
  invoiceFooter?: string;
}

const TAX_CODE_TO_ZATCA_CATEGORY: Record<string, ZatcaVatCategory> = {
  STANDARD: "S",
  ZERO: "Z",
  EXEMPT: "E",
  OUT_OF_SCOPE: "O",
};

function round2(v: number): string {
  return v.toFixed(2);
}

/**
 * Composes a printable receipt/invoice from real posted data — the
 * "linking" step connecting the standalone invoice preview to actual
 * organization records and transactions. Still NOT the Canonical Invoice
 * Model / Invoice Studio (spec bands 60-91): no saved template, no PDF/A-3
 * embedding, no cryptographic stamp (Phase 2 QR tags 6-9, which need a
 * real CSID from ZATCA onboarding this Phase 0 build has never had). What
 * IS real: the organization name/VAT, the transaction's actual lines and
 * totals, and a QR whose TLV encoding was verified byte-for-byte against
 * the official spec.
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly posService: PosService,
    private readonly salesService: SalesService,
  ) {}

  async getPosReceipt(organizationId: string, saleId: string): Promise<ReceiptData> {
    const sale = await this.posService.getSale(organizationId, saleId);
    if (!sale) {
      throw new NotFoundException(`POS sale ${saleId} not found`);
    }
    const org = await this.organizationsService.getOrganization(organizationId);
    const customer = sale.customerId ? await this.posService.getCustomer(organizationId, sale.customerId) : null;

    const lines: ReceiptLine[] = sale.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineTotal: round2(l.quantity * l.unitPrice),
    }));

    const cashTendered = sale.tenders.filter((t) => t.method === "CASH").reduce((s, t) => s + t.amount, 0);
    const cardTendered = sale.tenders.filter((t) => t.method !== "CASH").reduce((s, t) => s + t.amount, 0);
    const paymentSummary =
      cashTendered > 0 && cardTendered > 0
        ? `مختلط — نقدًا ${round2(cashTendered)} + شبكة ${round2(cardTendered)}`
        : cashTendered > 0
          ? `نقدًا — ${sale.total} ر.س`
          : `شبكة — ${sale.total} ر.س`;

    return {
      sellerName: org?.legalNameAr ?? "منظمة غير معروفة",
      sellerVatNumber: org?.vatNumber,
      documentNumber: sale.invoiceNumber ?? sale.id.slice(0, 8),
      issuedAt: sale.soldAt,
      lines,
      subtotal: sale.subtotal,
      taxTotal: sale.taxTotal,
      total: sale.total,
      paymentSummary,
      qrCodeDataUrl: await this.buildQrDataUrl(org?.legalNameAr ?? "", org?.vatNumber ?? "", sale.soldAt, sale.total, sale.taxTotal),
      xmlInvoice: this.buildXmlInvoice(
        org,
        sale.id,
        sale.soldAt,
        sale.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxCode: l.taxCode })),
        sale.subtotal,
        sale.taxTotal,
        sale.total,
      ),
      customer: customer ? {
        name: customer.name,
        vatNumber: customer.vatNumber,
        phone: customer.phone,
        address: [customer.buildingNumber, customer.streetName, customer.district, customer.city, customer.postalZone].filter(Boolean).join("، "),
      } : undefined,
      sellerAddress: org ? [org.buildingNumber, org.streetName, org.district, org.city, org.postalZone].filter(Boolean).join("، ") : undefined,
      sellerPhone: org?.phone,
      sellerEmail: org?.email,
      invoiceFooter: org?.invoiceFooter,
    };
  }

  async getSalesInvoiceReceipt(organizationId: string, invoiceId: string): Promise<ReceiptData> {
    const invoice = await this.salesService.getInvoice(organizationId, invoiceId);
    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }
    const org = await this.organizationsService.getOrganization(organizationId);

    const lines: ReceiptLine[] = invoice.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineTotal: round2(l.quantity * l.unitPrice),
    }));

    return {
      sellerName: org?.legalNameAr ?? "منظمة غير معروفة",
      sellerVatNumber: org?.vatNumber,
      documentNumber: invoice.id.slice(0, 8),
      issuedAt: invoice.issueDate,
      lines,
      subtotal: invoice.subtotal,
      taxTotal: invoice.taxTotal,
      total: invoice.total,
      paymentSummary: Number(invoice.paidAmount) > 0 ? `مدفوع جزئيًا — ${invoice.paidAmount} من ${invoice.total} ر.س` : "آجل — على الحساب",
      qrCodeDataUrl: await this.buildQrDataUrl(org?.legalNameAr ?? "", org?.vatNumber ?? "", invoice.issueDate, invoice.total, invoice.taxTotal),
      xmlInvoice: this.buildXmlInvoice(
        org,
        invoice.id,
        invoice.issueDate,
        invoice.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxCode: l.taxCode })),
        invoice.subtotal,
        invoice.taxTotal,
        invoice.total,
      ),
    };
  }

  /**
   * Sprint 30 — builds the ZATCA UBL XML draft alongside the existing
   * human-readable receipt. Returns undefined (rather than throwing, or
   * emitting non-compliant XML) when the organization is missing any
   * required address/VAT field — a receipt should never fail to render
   * just because the XML side-feature can't be produced yet.
   *
   * Known, explicitly-accepted gaps for this ad-hoc render (documented
   * here, not hidden): the document UUID is freshly generated on every
   * call rather than stored once and reused; the Invoice Counter Value
   * is a fixed "1" placeholder since this build has no persistent
   * sequential-invoice-number ledger; the Previous Invoice Hash is the
   * spec's own "first invoice" placeholder for the same reason. All are
   * inherited limitations of this being a Phase 0 in-memory build, not
   * new gaps introduced by this feature.
   */
  private buildXmlInvoice(
    org: OrganizationRow | null,
    documentId: string,
    timestamp: string,
    lines: Array<{ description: string; quantity: number; unitPrice: number; taxCode: string }>,
    subtotal: string,
    taxTotal: string,
    total: string,
  ): string | undefined {
    if (!org || !org.vatNumber || !org.streetName || !org.buildingNumber || !org.city || !org.postalZone || !org.district || !org.countryCode) {
      return undefined;
    }

    const date = new Date(timestamp);
    const issueDate = date.toISOString().slice(0, 10);
    const issueTime = date.toISOString().slice(11, 19);

    const zatcaLines: ZatcaInvoiceLine[] = lines.map((l, i) => {
      const category = TAX_CODE_TO_ZATCA_CATEGORY[l.taxCode] ?? "O";
      const rate = category === "S" ? 15 : 0;
      const lineExtensionAmount = round2(l.quantity * l.unitPrice);
      const lineTaxAmount = round2(Number(lineExtensionAmount) * (rate / 100));
      return {
        id: String(i + 1),
        description: l.description,
        quantity: l.quantity,
        unitCode: "PCE",
        unitPrice: l.unitPrice,
        taxCategory: category,
        taxPercent: rate,
        lineExtensionAmount,
        lineTaxAmount,
      };
    });

    const subtotalsByKey = new Map<string, { taxableAmount: number; taxAmount: number; category: ZatcaVatCategory; percent: number }>();
    for (const line of zatcaLines) {
      const key = `${line.taxCategory}:${line.taxPercent}`;
      const existing = subtotalsByKey.get(key) ?? { taxableAmount: 0, taxAmount: 0, category: line.taxCategory, percent: line.taxPercent };
      existing.taxableAmount += Number(line.lineExtensionAmount);
      existing.taxAmount += Number(line.lineTaxAmount);
      subtotalsByKey.set(key, existing);
    }

    return buildSimplifiedTaxInvoiceXml({
      uuid: randomUUID(),
      invoiceNumber: documentId.slice(0, 8),
      issueDate,
      issueTime,
      invoiceCounterValue: "1", // no persistent sequential ledger in this Phase 0 build — see method comment
      seller: {
        registrationName: org.legalNameAr,
        vatNumber: org.vatNumber,
        commercialRegistrationNumber: org.crNumber,
        streetName: org.streetName,
        buildingNumber: org.buildingNumber,
        city: org.city,
        postalZone: org.postalZone,
        district: org.district,
        countryCode: org.countryCode,
      },
      lines: zatcaLines,
      lineExtensionAmountTotal: subtotal,
      taxExclusiveAmount: subtotal,
      taxInclusiveAmount: total,
      payableAmount: total,
      taxAmountTotal: taxTotal,
      taxSubtotals: [...subtotalsByKey.values()].map((s) => ({
        taxableAmount: round2(s.taxableAmount),
        taxAmount: round2(s.taxAmount),
        category: s.category,
        percent: s.percent,
      })),
      qrCodeBase64: buildPhase1QR({
        sellerName: org.legalNameAr,
        vatRegistrationNumber: org.vatNumber,
        invoiceTimestamp: timestamp,
        invoiceTotalWithVat: total,
        vatTotal: taxTotal,
      }),
    });
  }

  private async buildQrDataUrl(
    sellerName: string,
    vatNumber: string,
    timestamp: string,
    total: string,
    vatTotal: string,
  ): Promise<string> {
    const tlvBase64 = buildPhase1QR({
      sellerName,
      vatRegistrationNumber: vatNumber,
      invoiceTimestamp: timestamp,
      invoiceTotalWithVat: total,
      vatTotal,
    });
    return QRCode.toDataURL(tlvBase64, { margin: 1, width: 180 });
  }
}
