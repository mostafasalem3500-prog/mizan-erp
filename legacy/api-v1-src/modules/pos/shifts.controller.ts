import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { ShiftsService } from "./shifts.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";
import { PermissionsGuard, RequirePermissions } from "../common/permissions.guard";
import { AuditAction, AuditInterceptor } from "../common/audit.interceptor";

@Controller("api/v1/organizations/:organizationId/pos/shifts")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Post("open")
  @RequirePermissions("pos.sell")
  @AuditAction("pos.shift.open")
  async open(
    @Param("organizationId") organizationId: string,
    @Body() body: { terminalId: string; cashierUserId: string; openingCash: number },
  ) {
    return this.shiftsService.openShift({ organizationId, ...body });
  }

  @Post(":shiftId/close")
  @RequirePermissions("pos.sell")
  @AuditAction("pos.shift.close")
  async close(
    @Param("organizationId") organizationId: string,
    @Param("shiftId") shiftId: string,
    @Body() body: { actualCash: number },
  ) {
    return this.shiftsService.closeShift({ organizationId, shiftId, actualCash: body.actualCash });
  }

  @Get(":shiftId")
  async get(@Param("organizationId") organizationId: string, @Param("shiftId") shiftId: string) {
    return this.shiftsService.getShift(organizationId, shiftId);
  }
}
