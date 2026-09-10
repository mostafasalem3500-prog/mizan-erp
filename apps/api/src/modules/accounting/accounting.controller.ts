import { Body, Controller, Get, Headers, Param, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { AccountingPostingEngine, PostingRequest } from "./accounting-posting-engine";
import { AccountingQueryService } from "./accounting-query.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { TenantGuard } from "../common/tenant.guard";
import { PermissionsGuard, RequirePermissions } from "../common/permissions.guard";
import { AuditAction, AuditInterceptor } from "../common/audit.interceptor";

/**
 * Every route here sits behind JwtAuthGuard + TenantGuard, matching
 * docs/ARCHITECTURE.md §8. Individual routes add @RequirePermissions on
 * top per spec band 102, and @AuditAction on the mutating ones per band 104.
 */
@Controller("api/v1/organizations/:organizationId/accounting")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
export class AccountingController {
  constructor(
    private readonly postingEngine: AccountingPostingEngine,
    private readonly queryService: AccountingQueryService,
  ) {}

  @Post("journal-entries")
  @RequirePermissions("journal.create", "journal.post")
  @AuditAction("journal.post")
  async postJournalEntry(
    @Body() body: Omit<PostingRequest, "organizationId">,
    @Param("organizationId") organizationId: string,
    @Headers("idempotency-key") idempotencyKeyHeader?: string,
  ) {
    // Header takes precedence over a body field of the same name — this is
    // the conventional place a retrying HTTP client sends it (spec band 91).
    return this.postingEngine.post({
      ...body,
      organizationId,
      idempotencyKey: idempotencyKeyHeader ?? body.idempotencyKey,
    });
  }

  @Post("journal-entries/:journalEntryId/reverse")
  @RequirePermissions("journal.reverse")
  @AuditAction("journal.reverse")
  async reverseJournalEntry(
    @Param("journalEntryId") journalEntryId: string,
    @Body("reason") reason: string,
  ) {
    return this.postingEngine.reverse(journalEntryId, reason);
  }

  @Get("periods/:periodId/trial-balance")
  @RequirePermissions("reports.pnl.view")
  async getTrialBalance(
    @Param("organizationId") organizationId: string,
    @Param("periodId") periodId: string,
  ) {
    return this.queryService.getTrialBalance(organizationId, periodId);
  }
}
