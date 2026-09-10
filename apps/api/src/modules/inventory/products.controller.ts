import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ProductsService, CreateProductInput } from "./products.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";

@Controller("api/v1/organizations/:organizationId/products")
@UseGuards(JwtAuthGuard, TenantGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  async create(
    @Param("organizationId") organizationId: string,
    @Body() body: Omit<CreateProductInput, "organizationId">,
  ) {
    return this.productsService.createProduct({ organizationId, ...body });
  }

  @Get()
  async list(@Param("organizationId") organizationId: string) {
    return this.productsService.listProducts(organizationId);
  }
}
