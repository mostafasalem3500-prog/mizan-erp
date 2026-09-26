import { ArgumentsHost } from "@nestjs/common";
import { DomainExceptionFilter } from "./domain-exception.filter";
import {
  UnbalancedEntryError,
  ClosedPeriodError,
  EntryAlreadyReversedError,
} from "../accounting/accounting-posting-engine";

function makeHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe("DomainExceptionFilter", () => {
  test("maps UnbalancedEntryError to 400", () => {
    const filter = new DomainExceptionFilter();
    const { host, status, json } = makeHost();

    // UnbalancedEntryError's constructor takes two Decimal-like values with .toString()
    const fakeDecimal = { toString: () => "10.0000" } as any;
    const error = new UnbalancedEntryError(fakeDecimal, fakeDecimal);

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400, error: "UnbalancedEntryError" }),
    );
  });

  test("maps ClosedPeriodError to 409", () => {
    const filter = new DomainExceptionFilter();
    const { host, status } = makeHost();

    filter.catch(new ClosedPeriodError("period-1", "CLOSED"), host);

    expect(status).toHaveBeenCalledWith(409);
  });

  test("maps EntryAlreadyReversedError to 409", () => {
    const filter = new DomainExceptionFilter();
    const { host, status } = makeHost();

    filter.catch(new EntryAlreadyReversedError("je-1"), host);

    expect(status).toHaveBeenCalledWith(409);
  });
});
