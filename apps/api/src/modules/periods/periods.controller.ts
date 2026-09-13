import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { PeriodsService } from "./periods.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";
import { PermissionsGuard, RequirePermissions } from "../common/permissions.guard";
import { AuditAction, AuditInterceptor } from "../common/audit.interceptor";

@Controller("api/v1/organizations/:organizationId/periods")
@UseGuards(JwtAuthGuard, TenantGuard)
@UseInterceptors(AuditInterceptor)
export class PeriodsController {
  constructor(private readonly periodsService: PeriodsService) {}

  @Get()
  async list(@Param("organizationId") organizationId: string) {
    return this.periodsService.listPeriods(organizationId);
  }

  /** Sprint 31 — closes the "only one period ever exists" gap. */
  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions("settings.manage")
  async create(@Param("organizationId") organizationId: string, @Body() body: { startDate: string; endDate: string }) {
    return this.periodsService.createPeriod({ organizationId, startDate: body.startDate, endDate: body.endDate });
  }

  @Post(":periodId/soft-close")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("journal.post", "reports.pnl.view")
  @AuditAction("period.soft_close")
  async softClose(@Param("organizationId") organizationId: string, @Param("periodId") periodId: string) {
    return this.periodsService.softClosePeriod(organizationId, periodId);
  }

  @Post(":periodId/reopen")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("journal.post")
  @AuditAction("period.reopen")
  async reopen(@Param("organizationId") organizationId: string, @Param("periodId") periodId: string) {
    return this.periodsService.reopenPeriod(organizationId, periodId);
  }

  @Post(":periodId/close")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("journal.post", "reports.pnl.view")
  @AuditAction("period.close")
  async close(@Param("organizationId") organizationId: string, @Param("periodId") periodId: string) {
    return this.periodsService.closePeriod(organizationId, periodId);
  }
}
