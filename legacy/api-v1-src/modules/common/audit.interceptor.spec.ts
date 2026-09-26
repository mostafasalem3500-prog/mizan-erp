import { ExecutionContext, CallHandler } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { of, throwError, firstValueFrom } from "rxjs";
import { AuditInterceptor, AuditSink } from "./audit.interceptor";

function makeContext(action: string | undefined, user: any, body: any = {}) {
  const request = { user, body, originalUrl: "/api/v1/accounting/journal-entries/123/reverse" };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
    __action: action,
  } as unknown as ExecutionContext;
}

function makeReflector(action: string | undefined) {
  return { getAllAndOverride: () => action } as unknown as Reflector;
}

describe("AuditInterceptor (spec band 104)", () => {
  test("does nothing for handlers with no @AuditAction", async () => {
    const sink: AuditSink = { record: jest.fn() };
    const interceptor = new AuditInterceptor(makeReflector(undefined), sink);
    const handler: CallHandler = { handle: () => of("ok") };

    await firstValueFrom(interceptor.intercept(makeContext(undefined, { userId: "u1" }), handler));
    expect(sink.record).not.toHaveBeenCalled();
  });

  test("records a success entry with actor and tenant context for an audited action", async () => {
    const sink: AuditSink = { record: jest.fn().mockResolvedValue(undefined) };
    const interceptor = new AuditInterceptor(makeReflector("journal.reverse"), sink);
    const handler: CallHandler = { handle: () => of({ id: "je-1" }) };
    const user = { userId: "u1", organizationId: "org-1", roleId: "role-1" };

    await firstValueFrom(interceptor.intercept(makeContext("journal.reverse", user), handler));

    expect(sink.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "journal.reverse",
        userId: "u1",
        organizationId: "org-1",
        outcome: "success",
      }),
    );
  });

  test("records an error entry (not just successes) when the handler throws", async () => {
    const sink: AuditSink = { record: jest.fn().mockResolvedValue(undefined) };
    const interceptor = new AuditInterceptor(makeReflector("journal.reverse"), sink);
    const handler: CallHandler = { handle: () => throwError(() => new Error("period closed")) };
    const user = { userId: "u1", organizationId: "org-1", roleId: "role-1" };

    await expect(
      firstValueFrom(interceptor.intercept(makeContext("journal.reverse", user), handler)),
    ).rejects.toThrow("period closed");

    expect(sink.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "error", errorMessage: "period closed" }),
    );
  });
});
