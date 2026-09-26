import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { AgingService } from "./aging.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";
import { PermissionsGuard, RequirePermissions } from "../common/permissions.guard";

@Controller("api/v1/organizations/:organizationId/aging")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@RequirePermissions("reports.pnl.view")
export class AgingController {
  constructor(private readonly agingService: AgingService) {}

  @Get("receivable")
  async receivable(@Param("organizationId") organizationId: string) {
    return this.agingService.getReceivableAging(organizationId);
  }

  @Get("payable")
  async payable(@Param("organizationId") organizationId: string) {
    return this.agingService.getPayableAging(organizationId);
  }
}
