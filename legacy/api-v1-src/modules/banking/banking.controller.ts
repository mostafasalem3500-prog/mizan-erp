import { Body, Controller, Param, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { BankingService, BankTransferInput } from "./banking.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";
import { PermissionsGuard, RequirePermissions } from "../common/permissions.guard";
import { AuditAction, AuditInterceptor } from "../common/audit.interceptor";

@Controller("api/v1/organizations/:organizationId/banking/transfers")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
export class BankingController {
  constructor(private readonly bankingService: BankingService) {}

  @Post()
  @RequirePermissions("bank.reconcile")
  @AuditAction("bank.transfer")
  async transfer(@Param("organizationId") organizationId: string, @Body() body: Omit<BankTransferInput, "organizationId">) {
    return this.bankingService.transfer({ organizationId, ...body });
  }
}
