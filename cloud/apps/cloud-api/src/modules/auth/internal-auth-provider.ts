export type InternalAuthUser = {
  account: string;
  displayName: string;
  roles: string[];
};

export interface InternalAuthProvider {
  validateCredentials(account: string, password: string): Promise<InternalAuthUser | null>;
}

export const INTERNAL_AUTH_PROVIDER = Symbol("INTERNAL_AUTH_PROVIDER");
