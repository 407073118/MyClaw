import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../../database/services/database.service";
import type {
  AuthSessionRecord,
  AuthSessionRepository,
  CreateAuthSessionInput,
  UpdateAccessTokenByRefreshTokenHashInput
} from "../ports/auth-session.repository";

@Injectable()
export class PrismaAuthSessionRepository implements AuthSessionRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async create(input: CreateAuthSessionInput) {
    const created = await this.databaseService.loginSession.create({
      data: {
        account: input.account,
        displayName: input.displayName,
        rolesJson: input.roles,
        accessTokenHash: input.accessTokenHash,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        refreshTokenHash: input.refreshTokenHash,
        refreshTokenExpiresAt: input.refreshTokenExpiresAt
      }
    });
    return this.toAuthSessionRecord(created);
  }

  async findActiveByAccessTokenHash(accessTokenHash: string) {
    const session = await this.databaseService.loginSession.findFirst({
      where: {
        accessTokenHash,
        revokedAt: null,
        accessTokenExpiresAt: {
          gt: new Date()
        }
      }
    });
    return session ? this.toAuthSessionRecord(session) : null;
  }

  async findActiveByRefreshTokenHash(refreshTokenHash: string) {
    const session = await this.databaseService.loginSession.findFirst({
      where: {
        refreshTokenHash,
        revokedAt: null,
        refreshTokenExpiresAt: {
          gt: new Date()
        }
      }
    });
    return session ? this.toAuthSessionRecord(session) : null;
  }

  async updateAccessTokenByRefreshTokenHash(input: UpdateAccessTokenByRefreshTokenHashInput) {
    const result = await this.databaseService.loginSession.updateMany({
      where: {
        refreshTokenHash: input.refreshTokenHash,
        revokedAt: null,
        refreshTokenExpiresAt: {
          gt: new Date()
        }
      },
      data: {
        accessTokenHash: input.accessTokenHash,
        accessTokenExpiresAt: input.accessTokenExpiresAt
      }
    });

    return result.count > 0;
  }

  async revokeByRefreshTokenHash(refreshTokenHash: string) {
    await this.databaseService.loginSession.updateMany({
      where: {
        refreshTokenHash,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });
  }

  private toAuthSessionRecord(raw: {
    id: string;
    account: string;
    displayName: string | null;
    rolesJson: unknown;
    accessTokenHash: string | null;
    accessTokenExpiresAt: Date | null;
    refreshTokenHash: string;
    refreshTokenExpiresAt: Date;
    revokedAt: Date | null;
  }): AuthSessionRecord {
    return {
      id: raw.id,
      account: raw.account,
      displayName: raw.displayName?.trim() || raw.account,
      roles: this.normalizeRoles(raw.rolesJson),
      accessTokenHash: raw.accessTokenHash ?? "",
      accessTokenExpiresAt: raw.accessTokenExpiresAt ?? new Date(0),
      refreshTokenHash: raw.refreshTokenHash,
      refreshTokenExpiresAt: raw.refreshTokenExpiresAt,
      revokedAt: raw.revokedAt
    };
  }

  private normalizeRoles(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return Array.from(
      new Set(
        value
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      )
    );
  }
}
