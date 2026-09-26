import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CustomersService, CreateCustomerInput } from "./customers.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";

@Controller("api/v1/organizations/:organizationId/customers")
@UseGuards(JwtAuthGuard, TenantGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  async create(
    @Param("organizationId") organizationId: string,
    @Body() body: Omit<CreateCustomerInput, "organizationId">,
  ) {
    return this.customersService.createCustomer({ organizationId, ...body });
  }

  @Get()
  async list(@Param("organizationId") organizationId: string) {
    return this.customersService.listCustomers(organizationId);
  }
}
