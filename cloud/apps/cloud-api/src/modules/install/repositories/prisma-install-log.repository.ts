import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../../database/services/database.service";
import type { CreateInstallLogInput, InstallLogRepository } from "../ports/install-log.repository";

@Injectable()
export class PrismaInstallLogRepository implements InstallLogRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async create(input: CreateInstallLogInput) {
    const record = await this.databaseService.installLog.create({
      data: input
    });

    return {
      ...record,
      action: record.action as CreateInstallLogInput["action"],
      status: record.status as CreateInstallLogInput["status"],
      errorMessage: record.errorMessage ?? undefined
    };
  }

  async list() {
    const records = await this.databaseService.installLog.findMany({
      orderBy: {
        createdAt: "desc"
      }
    });

    return records.map((record) => ({
      ...record,
      action: record.action as CreateInstallLogInput["action"],
      status: record.status as CreateInstallLogInput["status"],
      errorMessage: record.errorMessage ?? undefined
    }));
  }
}
