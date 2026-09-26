import { Body, Controller, Get, Headers, Param, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { PurchasesService, CreatePurchaseBillInput } from "./purchases.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";
import { PermissionsGuard, RequirePermissions } from "../common/permissions.guard";
import { AuditAction, AuditInterceptor } from "../common/audit.interceptor";

@Controller("api/v1/organizations/:organizationId/purchases/bills")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Post()
  @RequirePermissions("journal.post") // Phase 0 stand-in — a dedicated purchases.* permission belongs in the real Permissions sheet
  @AuditAction("purchase.post")
  async create(
    @Param("organizationId") organizationId: string,
    @Body() body: Omit<CreatePurchaseBillInput, "organizationId">,
    @Headers("idempotency-key") idempotencyKeyHeader?: string,
  ) {
    return this.purchasesService.createBill({
      ...body,
      organizationId,
      idempotencyKey: idempotencyKeyHeader ?? body.idempotencyKey,
    });
  }

  @Get(":billId")
  @RequirePermissions("invoice.view")
  async get(@Param("organizationId") organizationId: string, @Param("billId") billId: string) {
    return this.purchasesService.getBill(organizationId, billId);
  }
}
