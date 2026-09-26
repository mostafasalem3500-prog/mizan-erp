import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from "@nestjs/common";
import type { Response } from "express";
import {
  UnbalancedEntryError,
  ClosedPeriodError,
  EntryAlreadyReversedError,
} from "../accounting/accounting-posting-engine";

/**
 * accounting-posting-engine.ts deliberately throws plain Error subclasses
 * rather than importing NestJS's HttpException — see its file header: it's
 * meant to stay framework-light and unit-testable on its own. That means
 * Nest's default behavior turns an uncaught UnbalancedEntryError into a
 * generic 500, which is wrong (discovered via the live smoke test in
 * docs/MVP_ROADMAP.md Sprint 3 — a client-supplied unbalanced entry is a
 * 400, not a server fault). This filter is the seam that translates
 * domain errors to HTTP status without pulling NestJS into the domain
 * layer.
 */
@Catch(UnbalancedEntryError, ClosedPeriodError, EntryAlreadyReversedError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: Error, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    const status =
      exception instanceof UnbalancedEntryError
        ? HttpStatus.BAD_REQUEST
        : HttpStatus.CONFLICT; // ClosedPeriodError, EntryAlreadyReversedError — both "can't do that right now"

    response.status(status).json({
      statusCode: status,
      error: exception.constructor.name,
      message: exception.message,
    });
  }
}
