import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ReportingService } from "./reporting.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";
import { PermissionsGuard, RequirePermissions } from "../common/permissions.guard";

@Controller("api/v1/organizations/:organizationId/reports")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@RequirePermissions("reports.pnl.view")
export class ReportingController {
  constructor(private readonly reportingService: ReportingService) {}

  @Get("periods/:periodId/general-ledger")
  async generalLedger(
    @Param("organizationId") organizationId: string,
    @Param("periodId") periodId: string,
    @Query("accountId") accountId: string,
  ) {
    return this.reportingService.getGeneralLedger(organizationId, periodId, accountId);
  }

  @Get("periods/:periodId/profit-and-loss")
  async profitAndLoss(@Param("organizationId") organizationId: string, @Param("periodId") periodId: string) {
    return this.reportingService.getProfitAndLoss(organizationId, periodId);
  }

  @Get("periods/:periodId/balance-sheet")
  async balanceSheet(@Param("organizationId") organizationId: string, @Param("periodId") periodId: string) {
    return this.reportingService.getBalanceSheet(organizationId, periodId);
  }

  @Get("periods/:periodId/cash-flow")
  async cashFlow(@Param("organizationId") organizationId: string, @Param("periodId") periodId: string) {
    return this.reportingService.getCashFlowStatement(organizationId, periodId);
  }
}
