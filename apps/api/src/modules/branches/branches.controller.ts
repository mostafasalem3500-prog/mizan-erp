import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { BranchesService } from "./branches.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";
import { PermissionsGuard, RequirePermissions } from "../common/permissions.guard";

@Controller("api/v1/organizations/:organizationId/branches")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Post()
  @RequirePermissions("settings.manage")
  async create(
    @Param("organizationId") organizationId: string,
    @Body() body: { code: string; name: string; address?: string },
  ) {
    return this.branchesService.createBranch({ organizationId, ...body });
  }

  @Get()
  async list(@Param("organizationId") organizationId: string) {
    return this.branchesService.listBranches(organizationId);
  }
}
