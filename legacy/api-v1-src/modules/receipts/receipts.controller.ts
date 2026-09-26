import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ReceiptsService } from "./receipts.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";

@Controller("api/v1/organizations/:organizationId")
@UseGuards(JwtAuthGuard, TenantGuard)
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Get("pos/sales/:saleId/receipt")
  async posReceipt(@Param("organizationId") organizationId: string, @Param("saleId") saleId: string) {
    return this.receiptsService.getPosReceipt(organizationId, saleId);
  }

  @Get("sales/invoices/:invoiceId/receipt")
  async salesInvoiceReceipt(@Param("organizationId") organizationId: string, @Param("invoiceId") invoiceId: string) {
    return this.receiptsService.getSalesInvoiceReceipt(organizationId, invoiceId);
  }
}
