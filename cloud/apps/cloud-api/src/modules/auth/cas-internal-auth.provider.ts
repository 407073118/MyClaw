import {
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";

import type { InternalAuthProvider, InternalAuthUser } from "./internal-auth-provider";

type CasValidateResponse = {
  code?: unknown;
  message?: unknown;
  result?: unknown;
  resultType?: unknown;
  rawResult?: unknown;
  parsedResult?: unknown;
};

@Injectable()
export class CasInternalAuthProvider implements InternalAuthProvider {
  private readonly logger = new Logger(CasInternalAuthProvider.name);

  async validateCredentials(account: string, password: string): Promise<InternalAuthUser | null> {
    const username = account.trim();
    const rawPassword = password.trim();
    if (!username || !rawPassword) {
      return null;
    }

    const validateUrl = this.getValidateUrl();
    if (!validateUrl) {
      this.logger.warn("CAS validate URL is not configured.");
      throw new ServiceUnavailableException("cas_validate_url_not_configured");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.getTimeoutMs());

    try {
      const formBody = new URLSearchParams({
        username,
        password: rawPassword
      });
      const response = await fetch(validateUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: formBody.toString(),
        signal: controller.signal
      });

      if (!response.ok) {
        this.logger.warn(`CAS validate endpoint responded with status=${response.status}.`);
        throw new ServiceUnavailableException("cas_validate_http_error");
      }

      const payload = (await response.json()) as CasValidateResponse;
      if (!this.isSuccessCode(payload.code)) {
        if (this.isInvalidCredentialsError(payload)) {
          throw new UnauthorizedException("cas_account_or_password_invalid");
        }

        this.logger.warn(`CAS rejected login request, code=${String(payload.code ?? "unknown")}.`);
        throw new UnauthorizedException("cas_validate_rejected");
      }

      const parsedResult = this.resolveParsedResult(payload);
      const resolvedAccount =
        this.pickString(parsedResult, ["username", "userName", "account", "loginName"]) ?? username;
      const displayName =
        this.pickString(parsedResult, ["displayName", "name", "nickName", "realName"]) ?? resolvedAccount;
      const roles = this.extractRoles(parsedResult);

      if (!this.matchesRequiredRoles(roles)) {
        this.logger.warn(`User role does not satisfy required roles, account=${resolvedAccount}.`);
        throw new ForbiddenException("cas_role_not_allowed");
      }

      return {
        account: resolvedAccount,
        displayName,
        roles
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Failed to call CAS validate endpoint: ${error instanceof Error ? error.message : "unknown_error"}`
      );
      throw new ServiceUnavailableException("cas_validate_request_failed");
    } finally {
      clearTimeout(timeout);
    }
  }

  private getValidateUrl(): string | null {
    const explicitUrl =
      process.env.CAS_VALIDATE_USER_URL?.trim() ||
      process.env.INTERNAL_AUTH_VALIDATE_URL?.trim();
    if (explicitUrl) {
      return explicitUrl;
    }

    const baseUrl = process.env.INTERNAL_AUTH_BASE_URL?.trim();
    if (!baseUrl) {
      return null;
    }

    const path = process.env.INTERNAL_AUTH_VALIDATE_PATH?.trim() || "/api/cas/validateUser";
    return new URL(path, baseUrl).toString();
  }

  private getTimeoutMs(): number {
    const value = Number(process.env.INTERNAL_AUTH_TIMEOUT_MS);
    if (!Number.isFinite(value) || value <= 0) {
      return 5000;
    }
    return value;
  }

  private parseResult(value: unknown): Record<string, unknown> {
    if (!value) {
      return {};
    }

    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    }

    if (typeof value === "object") {
      return value as Record<string, unknown>;
    }

    return {};
  }

  private resolveParsedResult(payload: CasValidateResponse): Record<string, unknown> {
    const candidates = [payload.result, payload.parsedResult, payload.rawResult];
    for (const candidate of candidates) {
      const parsed = this.parseResult(candidate);
      if (Object.keys(parsed).length > 0) {
        return parsed;
      }
    }

    return {};
  }

  private isSuccessCode(code: unknown): boolean {
    const normalized = String(code ?? "").trim();
    return normalized === "00" || normalized === "0";
  }

  private isInvalidCredentialsError(payload: CasValidateResponse): boolean {
    const code = String(payload.code ?? "").trim();
    if (code === "7001") {
      return true;
    }

    const message = typeof payload.message === "string" ? payload.message.trim() : "";
    return /用户名或密码错误|账号或密码错误|invalid password|invalid credentials/i.test(message);
  }
  private pickString(source: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }

    return null;
  }

  private extractRoles(source: Record<string, unknown>): string[] {
    const rolesValue = source.roles ?? source.roleCodes ?? source.roleCode;
    if (!rolesValue) {
      return [];
    }

    if (Array.isArray(rolesValue)) {
      return Array.from(
        new Set(
          rolesValue
            .filter((role): role is string => typeof role === "string")
            .map((role) => role.trim())
            .filter((role) => role.length > 0)
        )
      );
    }

    if (typeof rolesValue === "string") {
      return Array.from(
        new Set(
          rolesValue
            .split(/[;,]/)
            .map((role) => role.trim())
            .filter((role) => role.length > 0)
        )
      );
    }

    return [];
  }

  private matchesRequiredRoles(roles: string[]): boolean {
    const required = (process.env.INTERNAL_AUTH_REQUIRED_ROLES ?? "")
      .split(",")
      .map((role) => role.trim())
      .filter((role) => role.length > 0);
    if (!required.length) {
      return true;
    }

    return required.some((role) => roles.includes(role));
  }
}
