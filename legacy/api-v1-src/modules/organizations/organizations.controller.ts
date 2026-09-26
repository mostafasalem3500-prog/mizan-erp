import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { OrganizationsService, CreateOrganizationInput, OrganizationRow } from "./organizations.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";
import { PermissionsGuard, RequirePermissions } from "../common/permissions.guard";

@Controller("api/v1/organizations")
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  /**
   * Public bootstrap endpoint — creates a brand-new tenant + its Owner in
   * one call. Deliberately NOT behind JwtAuthGuard (there is no token yet;
   * this is how the very first user of a new organization comes to exist).
   */
  @Post()
  async create(@Body() body: CreateOrganizationInput) {
    return this.organizationsService.createOrganization(body);
  }

  @Get(":organizationId")
  @UseGuards(JwtAuthGuard, TenantGuard)
  async get(@Param("organizationId") organizationId: string) {
    return this.organizationsService.getOrganization(organizationId);
  }

  /** Sprint 29 — lets an organization opt into requiring an open shift for every POS sale. */
  @Patch(":organizationId/settings")
  @UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
  @RequirePermissions("settings.manage")
  async updateSettings(
    @Param("organizationId") organizationId: string,
    @Body() body: Partial<Omit<OrganizationRow, "id">>,
  ) {
    return this.organizationsService.updateSettings(organizationId, body);
  }
}
