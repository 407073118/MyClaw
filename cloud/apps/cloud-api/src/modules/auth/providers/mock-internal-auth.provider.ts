import { Injectable, Logger } from "@nestjs/common";

import type { InternalAuthProvider, InternalAuthUser } from "../ports/internal-auth-provider";

@Injectable()
export class MockInternalAuthProvider implements InternalAuthProvider {
  private readonly logger = new Logger(MockInternalAuthProvider.name);

  /** 校验 mock 模式登录凭据，并为内置管理员账号应用固定密码规则。 */
  async validateCredentials(account: string, password: string): Promise<InternalAuthUser | null> {
    const normalizedAccount = account.trim();
    const normalizedPassword = password.trim();
    this.logger.log(`开始校验 mock 登录账号, account=${normalizedAccount || "empty"}`);

    if (!normalizedAccount || !normalizedPassword) {
      this.logger.warn("mock 登录缺少账号或密码，直接拒绝。");
      return null;
    }

    if (normalizedAccount === "admin") {
      if (normalizedPassword !== "123456") {
        this.logger.warn("mock 管理员账号密码错误，拒绝登录。");
        return null;
      }

      this.logger.log("mock 管理员账号登录成功。");
      return {
        account: "admin",
        displayName: "管理员",
        roles: ["admin", "user"]
      };
    }

    this.logger.log(`mock 普通账号登录成功, account=${normalizedAccount}`);
    return {
      account: normalizedAccount,
      displayName: normalizedAccount,
      roles: ["user"]
    };
  }
}
