import type { ModelProfile } from "@myclaw-desktop/shared";

import { parseJsonRecord, parseStringMap, selectRows } from "../runtime-state-shared-parsers";
import type { SqlDatabase } from "../runtime-state-types";

/** 写入默认模型配置主键。 */
export function writeDefaultModelProfileIdToDatabase(
  db: SqlDatabase,
  defaultModelProfileId: string | null,
): void {
  db.run("INSERT INTO app_state(key, value) VALUES(?, ?)", [
    "default_model_profile_id",
    defaultModelProfileId ?? "",
  ]);
}

/** 写入模型配置列表。 */
export function writeModelProfilesToDatabase(db: SqlDatabase, models: ModelProfile[]): void {
  models.forEach((model, index) => {
    db.run(
      `
        INSERT INTO model_profiles(
          position,
          id,
          name,
          provider,
          base_url,
          api_key,
          model,
          headers_json,
          request_body_json
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        index,
        model.id,
        model.name,
        model.provider,
        model.baseUrl,
        model.apiKey,
        model.model,
        model.headers ? JSON.stringify(model.headers) : null,
        model.requestBody ? JSON.stringify(model.requestBody) : null,
      ],
    );
  });
}

/** 读取默认模型配置主键。 */
export function readDefaultModelProfileIdFromDatabase(db: SqlDatabase): string | null {
  const row = selectRows(
    db,
    "SELECT value FROM app_state WHERE key = 'default_model_profile_id' LIMIT 1",
  )[0];

  return typeof row?.value === "string" && row.value.length > 0 ? row.value : null;
}

/** 读取模型配置列表。 */
export function readModelProfilesFromDatabase(db: SqlDatabase): ModelProfile[] {
  return selectRows(
    db,
    `
      SELECT
        id,
        name,
        provider,
        base_url,
        api_key,
        model,
        headers_json,
        request_body_json
      FROM model_profiles
      ORDER BY position ASC
    `,
  ).map((row) => {
    const headers = parseStringMap(row.headers_json);
    const requestBody = parseJsonRecord(row.request_body_json);
    const profile: ModelProfile = {
      id: String(row.id ?? ""),
      name: String(row.name ?? ""),
      provider: String(row.provider ?? "") as ModelProfile["provider"],
      baseUrl: String(row.base_url ?? ""),
      apiKey: String(row.api_key ?? ""),
      model: String(row.model ?? ""),
    };

    if (headers) {
      profile.headers = headers;
    }
    if (requestBody) {
      profile.requestBody = requestBody;
    }

    return profile;
  });
}
