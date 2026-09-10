import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { SuppliersService, CreateSupplierInput } from "./suppliers.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";

@Controller("api/v1/organizations/:organizationId/suppliers")
@UseGuards(JwtAuthGuard, TenantGuard)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  async create(
    @Param("organizationId") organizationId: string,
    @Body() body: Omit<CreateSupplierInput, "organizationId">,
  ) {
    return this.suppliersService.createSupplier({ organizationId, ...body });
  }

  @Get()
  async list(@Param("organizationId") organizationId: string) {
    return this.suppliersService.listSuppliers(organizationId);
  }
}
