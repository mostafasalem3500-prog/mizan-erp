import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AccountsService, CreateAccountInput } from "./accounts.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";
import { PermissionsGuard, RequirePermissions } from "../common/permissions.guard";

@Controller("api/v1/organizations/:organizationId/accounts")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  @RequirePermissions("settings.manage")
  async create(
    @Param("organizationId") organizationId: string,
    @Body() body: Omit<CreateAccountInput, "organizationId">,
  ) {
    return this.accountsService.createAccount({ organizationId, ...body });
  }

  @Get()
  async list(@Param("organizationId") organizationId: string) {
    return this.accountsService.listAccounts(organizationId);
  }
}
