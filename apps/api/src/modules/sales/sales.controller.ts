import { Body, Controller, Get, Headers, Param, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { SalesService, CreateSalesInvoiceInput } from "./sales.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";
import { PermissionsGuard, RequirePermissions } from "../common/permissions.guard";
import { AuditAction, AuditInterceptor } from "../common/audit.interceptor";

@Controller("api/v1/organizations/:organizationId/sales/invoices")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post()
  @RequirePermissions("invoice.create", "invoice.post")
  @AuditAction("invoice.post")
  async create(
    @Param("organizationId") organizationId: string,
    @Body() body: Omit<CreateSalesInvoiceInput, "organizationId">,
    @Headers("idempotency-key") idempotencyKeyHeader?: string,
  ) {
    return this.salesService.createInvoice({
      ...body,
      organizationId,
      idempotencyKey: idempotencyKeyHeader ?? body.idempotencyKey,
    });
  }

  @Get(":invoiceId")
  @RequirePermissions("invoice.view")
  async get(@Param("organizationId") organizationId: string, @Param("invoiceId") invoiceId: string) {
    return this.salesService.getInvoice(organizationId, invoiceId);
  }
}
