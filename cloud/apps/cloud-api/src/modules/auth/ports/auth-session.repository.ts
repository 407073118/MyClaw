/** 认证会话的标准持久化记录。 */
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

/** 创建认证会话时使用的输入结构。 */
export type CreateAuthSessionInput = {
  account: string;
  displayName: string;
  roles: string[];
  accessTokenHash: string;
  accessTokenExpiresAt: Date;
  refreshTokenHash: string;
  refreshTokenExpiresAt: Date;
};

/** 通过刷新令牌哈希更新访问令牌时使用的输入结构。 */
export type UpdateAccessTokenByRefreshTokenHashInput = {
  refreshTokenHash: string;
  accessTokenHash: string;
  accessTokenExpiresAt: Date;
};

/** 认证会话仓储接口，负责会话写入、查询、续期与注销。 */
export interface AuthSessionRepository {
  /** 创建一条新的认证会话。 */
  create(input: CreateAuthSessionInput): Promise<AuthSessionRecord>;

  /** 通过访问令牌哈希查找仍处于有效期内的会话。 */
  findActiveByAccessTokenHash(accessTokenHash: string): Promise<AuthSessionRecord | null>;

  /** 通过刷新令牌哈希查找仍处于有效期内的会话。 */
  findActiveByRefreshTokenHash(refreshTokenHash: string): Promise<AuthSessionRecord | null>;

  /** 基于刷新令牌哈希更新访问令牌信息。 */
  updateAccessTokenByRefreshTokenHash(input: UpdateAccessTokenByRefreshTokenHashInput): Promise<boolean>;

  /** 基于刷新令牌哈希吊销对应会话。 */
  revokeByRefreshTokenHash(refreshTokenHash: string): Promise<void>;
}

export const AUTH_SESSION_REPOSITORY = Symbol("AUTH_SESSION_REPOSITORY");
