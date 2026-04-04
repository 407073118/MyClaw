import type { AuthLoginRequest } from "@myclaw-cloud/shared";
import { Body, Controller, Get, Headers, Post } from "@nestjs/common";

import { AuthService } from "../services/auth.service";

@Controller("api/auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  login(@Body() body: AuthLoginRequest) {
    return this.authService.login(body);
  }

  @Post("refresh")
  refresh(@Body() body: { refreshToken: string }) {
    return this.authService.refresh(body.refreshToken);
  }

  @Get("me")
  me(@Headers("authorization") authorization?: string) {
    return this.authService.me(this.authService.extractBearerToken(authorization));
  }

  @Post("introspect")
  introspect(
    @Headers("authorization") authorization?: string,
    @Body() body?: { accessToken?: string }
  ) {
    const token = body?.accessToken?.trim() || this.authService.extractBearerToken(authorization);
    return this.authService.introspect(token);
  }

  @Post("logout")
  logout(@Body() body: { refreshToken: string }) {
    return this.authService.logout(body.refreshToken);
  }
}
