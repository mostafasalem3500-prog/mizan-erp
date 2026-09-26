import { NotFoundException } from "@nestjs/common";
import { AuthController } from "./auth.controller";

describe("AuthController — public demo mode", () => {
  const originalValue = process.env.PUBLIC_DEMO_MODE;

  afterEach(() => {
    if (originalValue === undefined) delete process.env.PUBLIC_DEMO_MODE;
    else process.env.PUBLIC_DEMO_MODE = originalValue;
  });

  test("does not expose passwordless access unless explicitly enabled", async () => {
    delete process.env.PUBLIC_DEMO_MODE;
    const authService = { loginDemo: jest.fn() };
    const controller = new AuthController(authService as any);

    await expect(controller.demo()).rejects.toThrow(NotFoundException);
    expect(authService.loginDemo).not.toHaveBeenCalled();
  });

  test("delegates to the fixed demo account when public demo mode is enabled", async () => {
    process.env.PUBLIC_DEMO_MODE = "true";
    const authService = { loginDemo: jest.fn().mockResolvedValue({ accessToken: "demo-token" }) };
    const controller = new AuthController(authService as any);

    await expect(controller.demo()).resolves.toEqual({ accessToken: "demo-token" });
    expect(authService.loginDemo).toHaveBeenCalledWith("owner@mizan-demo.sa");
  });
});
