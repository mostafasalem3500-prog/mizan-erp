import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { PeriodsService } from "./periods.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";
import { PermissionsGuard, RequirePermissions } from "../common/permissions.guard";

@Controller("api/v1/organizations/:organizationId/periods")
@UseGuards(JwtAuthGuard, TenantGuard)
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
}
