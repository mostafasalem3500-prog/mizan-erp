import { Body, Controller, Get, Headers, Param, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { InventoryService, ReceiveStockInput, IssueStockInput } from "./inventory.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";
import { PermissionsGuard, RequirePermissions } from "../common/permissions.guard";
import { AuditAction, AuditInterceptor } from "../common/audit.interceptor";

@Controller("api/v1/organizations/:organizationId/inventory")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post("receipts")
  @RequirePermissions("settings.manage") // Phase 0 stand-in — a dedicated inventory.receive permission belongs in the real Permissions sheet
  @AuditAction("inventory.receive")
  async receive(
    @Param("organizationId") organizationId: string,
    @Body() body: Omit<ReceiveStockInput, "organizationId">,
    @Headers("idempotency-key") idempotencyKeyHeader?: string,
  ) {
    return this.inventoryService.receiveStock({
      ...body,
      organizationId,
      idempotencyKey: idempotencyKeyHeader ?? body.idempotencyKey,
    });
  }

  @Post("issues")
  @RequirePermissions("settings.manage")
  @AuditAction("inventory.issue")
  async issue(
    @Param("organizationId") organizationId: string,
    @Body() body: Omit<IssueStockInput, "organizationId">,
    @Headers("idempotency-key") idempotencyKeyHeader?: string,
  ) {
    return this.inventoryService.issueStock({
      ...body,
      organizationId,
      idempotencyKey: idempotencyKeyHeader ?? body.idempotencyKey,
    });
  }

  @Get("products/:productId/stock")
  async getStock(@Param("organizationId") organizationId: string, @Param("productId") productId: string) {
    return this.inventoryService.getStock(organizationId, productId);
  }
}
