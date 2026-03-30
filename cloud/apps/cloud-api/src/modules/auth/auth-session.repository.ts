export type AuthSessionRecord = {
  id: string;
  account: string;
  displayName: string;
  roles: string[];
  accessTokenHash: string;
  accessTokenExpiresAt: Date;
  refreshTokenHash: string;
  refreshTokenExpiresAt: Date;
  revokedAt?: Date | null;
};

export type CreateAuthSessionInput = {
  account: string;
  displayName: string;
  roles: string[];
  accessTokenHash: string;
  accessTokenExpiresAt: Date;
  refreshTokenHash: string;
  refreshTokenExpiresAt: Date;
};

export type UpdateAccessTokenByRefreshTokenHashInput = {
  refreshTokenHash: string;
  accessTokenHash: string;
  accessTokenExpiresAt: Date;
};

export interface AuthSessionRepository {
  create(input: CreateAuthSessionInput): Promise<AuthSessionRecord>;
  findActiveByAccessTokenHash(accessTokenHash: string): Promise<AuthSessionRecord | null>;
  findActiveByRefreshTokenHash(refreshTokenHash: string): Promise<AuthSessionRecord | null>;
  updateAccessTokenByRefreshTokenHash(input: UpdateAccessTokenByRefreshTokenHashInput): Promise<boolean>;
  revokeByRefreshTokenHash(refreshTokenHash: string): Promise<void>;
}

export const AUTH_SESSION_REPOSITORY = Symbol("AUTH_SESSION_REPOSITORY");
