#!/usr/bin/env node

import { runSiliconCli, type SiliconCliResult } from "./main.js";

const consoleLogger = {
  info: (message: string, metadata?: Record<string, unknown>) => {
    if (process.env.SILICON_DEBUG === "1") {
      console.error(JSON.stringify({ level: "info", message, metadata }));
    }
  },
  warn: (message: string, metadata?: Record<string, unknown>) => {
    console.error(JSON.stringify({ level: "warn", message, metadata }));
  },
};

/** 执行命令行入口，并把结构化 CLI 结果转换为标准输出和退出码。 */
async function main(): Promise<void> {
  const result = await runSiliconCli(process.argv.slice(2), { logger: consoleLogger });
  writeCliResult(result);
  process.exitCode = result.exitCode;
}

/** 写出 CLI 执行结果，保持 stdout 和 stderr 分离。 */
function writeCliResult(result: SiliconCliResult): void {
  if (result.stdout) {
    console.log(result.stdout);
  }
  if (result.stderr) {
    console.error(result.stderr);
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
