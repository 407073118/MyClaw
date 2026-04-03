/**
 * 统一环境配置入口
 *
 * 构建前由 scripts/set-env.js 写入 _resolved.ts，决定当前环境。
 * 运行时 process.env.APP_ENV 可覆盖（方便调试）。
 *
 * 支持: development | pre | production
 *
 * 用法:
 *   import { appEnv } from "../../config";
 *   console.log(appEnv.CLOUD_API_BASE);
 */

import type { AppEnvConfig } from "./types";
import { env as development } from "./env.development";
import { env as pre } from "./env.pre";
import { env as production } from "./env.production";
import { RESOLVED_ENV } from "./_resolved";

type EnvName = "development" | "pre" | "production";

const envMap: Record<EnvName, AppEnvConfig> = {
  development,
  pre,
  production,
};

function resolveEnvName(): EnvName {
  // 运行时环境变量优先（调试用），否则用构建时写入的值
  const raw = process.env.APP_ENV ?? RESOLVED_ENV;
  if (raw in envMap) return raw as EnvName;
  return "development";
}

export const APP_ENV_NAME = resolveEnvName();
export const appEnv = envMap[APP_ENV_NAME];
