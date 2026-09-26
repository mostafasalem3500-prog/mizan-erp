import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { ExpensesService, RecordExpenseInput } from "./expenses.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";
import { PermissionsGuard, RequirePermissions } from "../common/permissions.guard";
import { AuditAction, AuditInterceptor } from "../common/audit.interceptor";

@Controller("api/v1/organizations/:organizationId/expenses")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  @RequirePermissions("journal.post")
  @AuditAction("expense.post")
  async create(@Param("organizationId") organizationId: string, @Body() body: Omit<RecordExpenseInput, "organizationId">) {
    return this.expensesService.recordExpense({ organizationId, ...body });
  }

  @Get(":expenseId")
  async get(@Param("organizationId") organizationId: string, @Param("expenseId") expenseId: string) {
    return this.expensesService.getExpense(organizationId, expenseId);
  }
}
