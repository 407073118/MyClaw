/** 内部认证通过后返回的标准用户信息。 */
export type InternalAuthUser = {
  account: string;
  displayName: string;
  roles: string[];
};

/** 内部认证提供者接口，负责校验账号密码并返回用户身份。 */
export interface InternalAuthProvider {
  /** 校验账号密码，成功时返回用户信息。 */
  validateCredentials(account: string, password: string): Promise<InternalAuthUser | null>;
}

export const INTERNAL_AUTH_PROVIDER = Symbol("INTERNAL_AUTH_PROVIDER");
