import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";

export const AUDIT_ACTION_KEY = "audit_action";
export const AUDIT_SINK = "AuditSink";

/** Decorator: `@AuditAction("journal.reverse")` marks a handler as one that must be audit-logged. */
export const AuditAction = (action: string) => SetMetadata(AUDIT_ACTION_KEY, action);

export interface AuditLogEntry {
  action: string;
  userId?: string;
  organizationId?: string;
  branchId?: string;
  entityPath: string;
  requestBody: unknown;
  timestamp: string;
  outcome: "success" | "error";
  errorMessage?: string;
}

/**
 * Writes one AuditLogEntry per request for any handler decorated with
 * @AuditAction. Spec band 104 calls out posting, reversal, return,
 * discount, price override, template changes, ZATCA, permissions, period
 * closing, and cash movement as the actions that MUST be logged — apply
 * @AuditAction to those handlers specifically rather than globally, since
 * logging every read would bury the entries that matter.
 *
 * The sink is injected so this interceptor is unit-testable. Production
 * writes to PostgreSQL `audit_logs`; local isolated tests can keep using
 * the lightweight sink without changing request behavior.
 */
export interface AuditSink {
  record(entry: AuditLogEntry): Promise<void>;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUDIT_SINK) private readonly sink: AuditSink,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const action = this.reflector.getAllAndOverride<string>(AUDIT_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!action) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const base: Omit<AuditLogEntry, "outcome" | "errorMessage"> = {
      action,
      userId: request.user?.userId,
      organizationId: request.user?.organizationId,
      branchId: request.user?.branchId,
      entityPath: request.originalUrl ?? request.url,
      requestBody: request.body,
      timestamp: new Date().toISOString(),
    };

    return next.handle().pipe(
      tap({
        next: () => {
          void this.sink.record({ ...base, outcome: "success" });
        },
        error: (err: Error) => {
          void this.sink.record({ ...base, outcome: "error", errorMessage: err.message });
        },
      }),
    );
  }
}
