import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";
import { PermissionsGuard, RequirePermissions } from "../common/permissions.guard";
import { VatReportingService } from "./vat-reporting.service";

@Controller("api/v1/organizations/:organizationId/tax/vat")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@RequirePermissions("reports.pnl.view")
export class VatController {
  constructor(private readonly vatReporting: VatReportingService) {}

  @Get("periods/:periodId/summary")
  summary(@Param("organizationId") organizationId: string, @Param("periodId") periodId: string) {
    return this.vatReporting.getPeriodSummary(organizationId, periodId);
  }
}

