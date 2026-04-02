import type { InstallLogRequest, InstallLogResponse } from "@myclaw-cloud/shared";
import { Inject, Injectable } from "@nestjs/common";

import { INSTALL_LOG_REPOSITORY, type InstallLogRepository } from "./install-log.repository";

@Injectable()
export class InstallService {
  constructor(
    @Inject(INSTALL_LOG_REPOSITORY)
    private readonly installLogRepository: InstallLogRepository
  ) {}

  async log(account: string, input: InstallLogRequest): Promise<InstallLogResponse> {
    await this.installLogRepository.create({
      account,
      ...input
    });

    return {
      ok: true
    };
  }

  async list(): Promise<InstallLogRequest[]> {
    const logs = await this.installLogRepository.list();
    return logs.map(({ account: _account, createdAt: _createdAt, id: _id, ...item }) => ({
      ...item,
      itemType: item.itemType as "skill" | "mcp"
    }));
  }
}
