export type AuthUser = {
  account: string;
  displayName: string;
  roles: string[];
  /** 用户本地上传的个人头像 data URL；为空时由客户端显示离线默认头像。 */
  avatarDataUrl?: string | null;
};

export type AuthLoginRequest = {
  account: string;
  username?: string;
  password: string;
};

export type AuthLoginResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
};

export type AuthRefreshResponse = {
  accessToken: string;
  expiresIn: number;
};

export type AuthMeResponse = AuthUser;

export type AuthIntrospectResponse = {
  active: boolean;
  expiresAt?: string;
  user?: AuthUser;
};
