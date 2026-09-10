import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { StatementsService } from "./statements.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";

@Controller("api/v1/organizations/:organizationId/statements")
@UseGuards(JwtAuthGuard, TenantGuard)
export class StatementsController {
  constructor(private readonly statementsService: StatementsService) {}

  @Get("customer/:customerId")
  async customerStatement(@Param("organizationId") organizationId: string, @Param("customerId") customerId: string) {
    return this.statementsService.getCustomerStatement(organizationId, customerId);
  }

  @Get("supplier/:supplierId")
  async supplierStatement(@Param("organizationId") organizationId: string, @Param("supplierId") supplierId: string) {
    return this.statementsService.getSupplierStatement(organizationId, supplierId);
  }
}
