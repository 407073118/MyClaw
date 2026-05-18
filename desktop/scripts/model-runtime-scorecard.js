#!/usr/bin/env node

/**
 * 读取 MyClaw turn-outcomes / turn-telemetry，输出 provider family scorecard 报告。
 *
 * 用法：
 *   node scripts/model-runtime-scorecard.js --myclaw-dir /path/to/myclaw [--output report.json]
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PROVIDER_FAMILY_ROLLOUT_ORDER = [
  "generic-openai-compatible",
  "qwen-dashscope",
  "openai-native",
  "anthropic-native",
  "br-minimax",
  "volcengine-ark",
];

/**
 * 汇总 outcome 中的缓存命中率，按输入 token 加权。
 */
function calculateCacheHitRate(outcomes) {
  const totals = outcomes.reduce((acc, outcome) => {
    const usage = outcome.usage ?? {};
    acc.promptTokens += usage.promptTokens ?? 0;
    acc.cacheHitTokens += usage.cacheHitInputTokens ?? usage.cacheReadInputTokens ?? usage.cachedInputTokens ?? 0;
    return acc;
  }, { promptTokens: 0, cacheHitTokens: 0 });
  return totals.promptTokens > 0 ? totals.cacheHitTokens / totals.promptTokens : 0;
}

/**
 * 汇总 provider 缓存写入率，用于识别只写不读的路线。
 */
function calculateCacheWriteRate(outcomes) {
  const totals = outcomes.reduce((acc, outcome) => {
    const usage = outcome.usage ?? {};
    acc.promptTokens += usage.promptTokens ?? 0;
    acc.cacheWriteTokens += usage.cacheWriteInputTokens ?? 0;
    return acc;
  }, { promptTokens: 0, cacheWriteTokens: 0 });
  return totals.promptTokens > 0 ? totals.cacheWriteTokens / totals.promptTokens : 0;
}

/**
 * 使用缓存感知公式计算路线分数，和桌面端运行时保持一致。
 */
function scoreProviderRoute(input) {
  return (input.successRate * 0.4)
    + (input.cacheHitRate * 0.3)
    + (input.latencyScore * 0.15)
    + (input.estimatedCostScore * 0.15);
}

/**
 * 解析 CLI 参数，保持脚本可在 CI 与本地验证场景复用。
 */
function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token || !token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value && !value.startsWith("--")) {
      args[key] = value;
      index += 1;
    } else {
      args[key] = "true";
    }
  }
  return args;
}

/**
 * 读取 outcome 目录中的 JSON 文件。
 */
function loadTurnOutcomes(myClawDir) {
  const outcomesDir = path.join(myClawDir, "turn-outcomes");
  if (!fs.existsSync(outcomesDir)) {
    return [];
  }

  return fs.readdirSync(outcomesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const filePath = path.join(outcomesDir, file);
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    });
}

/**
 * 读取 telemetry 行数，辅助验证 outcome / telemetry 是否同步落盘。
 */
function loadTelemetryCount(myClawDir) {
  const telemetryPath = path.join(myClawDir, "turn-telemetry.jsonl");
  if (!fs.existsSync(telemetryPath)) {
    return 0;
  }

  return fs.readFileSync(telemetryPath, "utf-8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .length;
}

/**
 * 解析默认数据根目录，保持与桌面端 directory-service 的目录语义一致。
 */
function resolveDefaultDataRoot() {
  const configuredRoot = process.env.MYCLAW_DATA_ROOT?.trim();
  if (configuredRoot) {
    return path.resolve(configuredRoot);
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "MyClaw");
  }

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "MyClaw");
  }

  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "MyClaw");
}

/**
 * 解析 scorecard 读取目录；未显式指定时回退到默认 MyClaw 数据目录。
 */
function resolveMyClawDir(args) {
  const explicitDir = args["myclaw-dir"]?.trim() || process.env.MYCLAW_DIR?.trim();
  if (explicitDir) {
    return path.resolve(explicitDir);
  }

  return path.join(resolveDefaultDataRoot(), "myClaw");
}

/**
 * 按 provider family 聚合 scorecard 指标。
 */
function buildScorecards(outcomes) {
  const families = [...new Set(outcomes.map((outcome) => outcome.providerFamily))];
  return families.map((providerFamily) => {
    const familyOutcomes = outcomes.filter((outcome) => outcome.providerFamily === providerFamily);
    const totalTurns = familyOutcomes.length;
    const successCount = familyOutcomes.filter((outcome) => outcome.success).length;
    const totalToolCalls = familyOutcomes.reduce((sum, outcome) => sum + (outcome.toolCallCount ?? 0), 0);
    const successfulToolCalls = familyOutcomes.reduce((sum, outcome) => sum + (outcome.toolSuccessCount ?? 0), 0);
    const fallbackCount = familyOutcomes.filter((outcome) => (outcome.fallbackEvents?.length ?? 0) > 0 || Boolean(outcome.fallbackReason)).length;
    const stableCount = familyOutcomes.filter((outcome) => outcome.contextStability !== false).length;
    const sortedLatency = familyOutcomes.map((outcome) => outcome.latencyMs).sort((left, right) => left - right);
    const p95Index = totalTurns === 0 ? 0 : Math.max(0, Math.ceil(sortedLatency.length * 0.95) - 1);
    const p95Latency = sortedLatency[p95Index] ?? 0;

    return {
      providerFamily,
      sampleSize: totalTurns,
      completionRate: totalTurns === 0 ? 0 : successCount / totalTurns,
      toolSuccessRate: totalToolCalls > 0 ? successfulToolCalls / totalToolCalls : 1,
      fallbackRate: totalTurns === 0 ? 0 : fallbackCount / totalTurns,
      p95Latency,
      contextStabilityRate: totalTurns === 0 ? 0 : stableCount / totalTurns,
      cacheHitRate: calculateCacheHitRate(familyOutcomes),
      cacheWriteRate: calculateCacheWriteRate(familyOutcomes),
    };
  }).sort((left, right) => {
    return PROVIDER_FAMILY_ROLLOUT_ORDER.indexOf(left.providerFamily)
      - PROVIDER_FAMILY_ROLLOUT_ORDER.indexOf(right.providerFamily);
  });
}

/**
 * 按 vendor family + protocolTarget 聚合更细粒度的 scorecard 指标。
 */
function buildVendorProtocolScorecards(outcomes) {
  const keys = [...new Set(outcomes.map((outcome) => `${outcome.vendorFamily ?? outcome.providerFamily}:${outcome.protocolTarget}`))];
  return keys.map((key) => {
    const [vendorFamily, protocolTarget] = key.split(":");
    const scopedOutcomes = outcomes.filter((outcome) => `${outcome.vendorFamily ?? outcome.providerFamily}:${outcome.protocolTarget}` === key);
    const totalTurns = scopedOutcomes.length;
    const successCount = scopedOutcomes.filter((outcome) => outcome.success).length;
    const totalToolCalls = scopedOutcomes.reduce((sum, outcome) => sum + (outcome.toolCallCount ?? 0), 0);
    const successfulToolCalls = scopedOutcomes.reduce((sum, outcome) => sum + (outcome.toolSuccessCount ?? 0), 0);
    const fallbackCount = scopedOutcomes.filter((outcome) => (outcome.fallbackEvents?.length ?? 0) > 0 || Boolean(outcome.fallbackReason)).length;
    const stableCount = scopedOutcomes.filter((outcome) => outcome.contextStability !== false).length;
    const sortedLatency = scopedOutcomes.map((outcome) => outcome.latencyMs).sort((left, right) => left - right);
    const p95Index = totalTurns === 0 ? 0 : Math.max(0, Math.ceil(sortedLatency.length * 0.95) - 1);
    const p95Latency = sortedLatency[p95Index] ?? 0;
    const cacheHitRate = calculateCacheHitRate(scopedOutcomes);
    const completionRate = totalTurns === 0 ? 0 : successCount / totalTurns;
    const latencyScore = p95Latency > 0 ? Math.max(0, 1 - (p95Latency / 120000)) : 0;

    return {
      vendorFamily,
      protocolTarget,
      sampleSize: totalTurns,
      completionRate,
      toolSuccessRate: totalToolCalls > 0 ? successfulToolCalls / totalToolCalls : 1,
      fallbackRate: totalTurns === 0 ? 0 : fallbackCount / totalTurns,
      p95Latency,
      contextStabilityRate: totalTurns === 0 ? 0 : stableCount / totalTurns,
      cacheHitRate,
      cacheWriteRate: calculateCacheWriteRate(scopedOutcomes),
      routeScore: totalTurns < 3 ? undefined : scoreProviderRoute({
        successRate: completionRate,
        cacheHitRate,
        latencyScore,
        estimatedCostScore: cacheHitRate,
      }),
    };
  }).sort((left, right) => {
    const vendorOrder = String(left.vendorFamily).localeCompare(String(right.vendorFamily));
    if (vendorOrder !== 0) {
      return vendorOrder;
    }
    return String(left.protocolTarget).localeCompare(String(right.protocolTarget));
  });
}

/**
 * 主执行入口：输出 JSON 报告，并在需要时写入文件。
 */
function main() {
  const args = parseArgs(process.argv.slice(2));
  const myClawDir = resolveMyClawDir(args);

  const outcomes = loadTurnOutcomes(myClawDir);
  const report = {
    generatedAt: new Date().toISOString(),
    myClawDir,
    outcomeCount: outcomes.length,
    telemetryCount: loadTelemetryCount(myClawDir),
    scorecards: buildScorecards(outcomes),
    vendorProtocolScorecards: buildVendorProtocolScorecards(outcomes),
  };

  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
    console.info("[model-runtime-scorecard] 已写入 scorecard 报告", {
      output: args.output,
      outcomeCount: report.outcomeCount,
      telemetryCount: report.telemetryCount,
    });
  }

  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  loadTurnOutcomes,
  loadTelemetryCount,
  calculateCacheHitRate,
  calculateCacheWriteRate,
  scoreProviderRoute,
  resolveDefaultDataRoot,
  resolveMyClawDir,
  buildScorecards,
  buildVendorProtocolScorecards,
  main,
};
