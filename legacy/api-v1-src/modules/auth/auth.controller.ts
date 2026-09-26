import { Body, Controller, NotFoundException, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";

@Controller("api/v1/auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  async login(@Body() body: { email: string; password: string; organizationId?: string }) {
    return this.authService.login(body.email, body.password, body.organizationId);
  }

  @Post("demo")
  async demo() {
    if (process.env.PUBLIC_DEMO_MODE !== "true") {
      throw new NotFoundException("Demo access is disabled");
    }
    return this.authService.loginDemo("owner@mizan-demo.sa");
  }
}
