import { Body, Controller, Get, Headers, Param, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { PosService, PosSellInput } from "./pos.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";
import { PermissionsGuard, RequirePermissions } from "../common/permissions.guard";
import { AuditAction, AuditInterceptor } from "../common/audit.interceptor";

@Controller("api/v1/organizations/:organizationId/pos/sales")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
export class PosController {
  constructor(private readonly posService: PosService) {}

  @Post()
  @RequirePermissions("pos.sell")
  @AuditAction("pos.sell")
  async sell(
    @Param("organizationId") organizationId: string,
    @Body() body: Omit<PosSellInput, "organizationId">,
    @Headers("idempotency-key") idempotencyKeyHeader?: string,
  ) {
    return this.posService.sell({
      ...body,
      organizationId,
      idempotencyKey: idempotencyKeyHeader ?? body.idempotencyKey,
    });
  }

  @Post(":saleId/return")
  @RequirePermissions("pos.return")
  @AuditAction("pos.return")
  async returnSale(
    @Param("organizationId") organizationId: string,
    @Param("saleId") saleId: string,
    @Body("reason") reason: string,
  ) {
    return this.posService.returnSale(organizationId, saleId, reason);
  }

  @Post(":saleId/return-items")
  @RequirePermissions("pos.return")
  @AuditAction("pos.return")
  async returnItems(
    @Param("organizationId") organizationId: string,
    @Param("saleId") saleId: string,
    @Body() body: { reason: string; items: Array<{ lineIndex: number; quantity: number }> },
  ) {
    return this.posService.returnItems(organizationId, saleId, body.reason, body.items);
  }

  @Get(":saleId")
  @RequirePermissions("pos.sell")
  async get(@Param("organizationId") organizationId: string, @Param("saleId") saleId: string) {
    return this.posService.getSale(organizationId, saleId);
  }
}
