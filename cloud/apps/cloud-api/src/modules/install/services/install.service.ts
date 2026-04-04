import type { InstallLogRequest, InstallLogResponse } from "@myclaw-cloud/shared";
import { Inject, Injectable } from "@nestjs/common";

import { INSTALL_LOG_REPOSITORY, type InstallLogRepository } from "../ports/install-log.repository";

@Injectable()
export class InstallService {
  constructor(
    @Inject(INSTALL_LOG_REPOSITORY)
    private readonly installLogRepository: InstallLogRepository
  ) {}

  /** 记录一次安装行为并返回统一成功响应。 */
  async log(account: string, input: InstallLogRequest): Promise<InstallLogResponse> {
    await this.installLogRepository.create({
      account,
      ...input
    });

    return {
      ok: true
    };
  }

  /** 列出安装日志，并裁剪出前端需要的字段结构。 */
  async list(): Promise<InstallLogRequest[]> {
    const logs = await this.installLogRepository.list();
    return logs.map(({ account: _account, createdAt: _createdAt, id: _id, ...item }) => ({
      ...item,
      itemType: item.itemType as "skill" | "mcp"
    }));
  }
}
