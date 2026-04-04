import type { InstallLogRequest } from "@myclaw-cloud/shared";
import { Body, Controller, Get, Post } from "@nestjs/common";
import { Headers } from "@nestjs/common";

import { AuthService } from "../../auth/services/auth.service";
import { InstallService } from "../services/install.service";

@Controller("api/install-logs")
export class InstallController {
  constructor(
    private readonly installService: InstallService,
    private readonly authService: AuthService
  ) {}

  @Post()
  async create(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: InstallLogRequest
  ) {
    const token = this.authService.extractBearerToken(authorization);
    const account = (await this.authService.resolveAccountFromAccessToken(token)) ?? "anonymous";
    return this.installService.log(account, body);
  }

  @Get()
  list() {
    return {
      items: this.installService.list()
    };
  }
}
