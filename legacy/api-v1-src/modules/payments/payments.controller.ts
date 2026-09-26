import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { PaymentsService, RecordCustomerPaymentInput, RecordSupplierPaymentInput } from "./payments.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";
import { PermissionsGuard, RequirePermissions } from "../common/permissions.guard";
import { AuditAction, AuditInterceptor } from "../common/audit.interceptor";

@Controller("api/v1/organizations/:organizationId/payments")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post("customer")
  @RequirePermissions("journal.post")
  @AuditAction("payment.customer")
  async customerPayment(@Param("organizationId") organizationId: string, @Body() body: Omit<RecordCustomerPaymentInput, "organizationId">) {
    return this.paymentsService.recordCustomerPayment({ organizationId, ...body });
  }

  @Post("supplier")
  @RequirePermissions("journal.post")
  @AuditAction("payment.supplier")
  async supplierPayment(@Param("organizationId") organizationId: string, @Body() body: Omit<RecordSupplierPaymentInput, "organizationId">) {
    return this.paymentsService.recordSupplierPayment({ organizationId, ...body });
  }

  @Get("customer/:customerId")
  async listCustomerPayments(@Param("organizationId") organizationId: string, @Param("customerId") customerId: string) {
    return this.paymentsService.listCustomerPayments(organizationId, customerId);
  }

  @Get("supplier/:supplierId")
  async listSupplierPayments(@Param("organizationId") organizationId: string, @Param("supplierId") supplierId: string) {
    return this.paymentsService.listSupplierPayments(organizationId, supplierId);
  }
}
