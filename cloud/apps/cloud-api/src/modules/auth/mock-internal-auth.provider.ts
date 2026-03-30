import { Injectable } from "@nestjs/common";

import type { InternalAuthProvider, InternalAuthUser } from "./internal-auth-provider";

@Injectable()
export class MockInternalAuthProvider implements InternalAuthProvider {
  async validateCredentials(account: string, password: string): Promise<InternalAuthUser | null> {
    if (!account.trim() || !password.trim()) {
      return null;
    }

    return {
      account: account.trim(),
      displayName: account.trim(),
      roles: ["user"]
    };
  }
}
