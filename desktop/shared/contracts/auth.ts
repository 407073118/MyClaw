export type AuthUser = {
  account: string;
  displayName: string;
  roles: string[];
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
