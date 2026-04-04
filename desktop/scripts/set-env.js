/**
 * 构建前写入环境标识文件 config/_resolved.ts
 * 用法: node scripts/set-env.js [development|pre|production]
 *       或通过 APP_ENV 环境变量
 */
const fs = require("fs");
const path = require("path");

const allowed = ["development", "pre", "production"];
const envName = process.argv[2] || process.env.APP_ENV || "development";

if (!allowed.includes(envName)) {
  console.error(`[set-env] Invalid env: ${envName}. Allowed: ${allowed.join(", ")}`);
  process.exit(1);
}

const outFile = path.join(__dirname, "..", "config", "_resolved.ts");
const content = `// 由 scripts/set-env.js 自动生成，请勿手动编辑\nexport const RESOLVED_ENV = "${envName}" as const;\n`;

fs.writeFileSync(outFile, content, "utf-8");
console.log(`[set-env] wrote ${envName} → config/_resolved.ts`);
