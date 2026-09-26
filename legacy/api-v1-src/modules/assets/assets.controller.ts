import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { AssetsService, AcquireAssetInput } from "./assets.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";
import { PermissionsGuard, RequirePermissions } from "../common/permissions.guard";
import { AuditAction, AuditInterceptor } from "../common/audit.interceptor";

@Controller("api/v1/organizations/:organizationId/assets")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post()
  @RequirePermissions("journal.post")
  @AuditAction("asset.acquire")
  async acquire(@Param("organizationId") organizationId: string, @Body() body: Omit<AcquireAssetInput, "organizationId">) {
    return this.assetsService.acquireAsset({ organizationId, ...body });
  }

  @Post(":assetId/depreciate")
  @RequirePermissions("journal.post")
  @AuditAction("asset.depreciate")
  async depreciate(
    @Param("organizationId") organizationId: string,
    @Param("assetId") assetId: string,
    @Body() body: { periodId: string; amount?: number },
  ) {
    return this.assetsService.depreciateAsset({ organizationId, assetId, ...body });
  }

  @Get(":assetId")
  async get(@Param("organizationId") organizationId: string, @Param("assetId") assetId: string) {
    return this.assetsService.getAsset(organizationId, assetId);
  }
}
