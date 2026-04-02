/**
 * cloud-api 生产打包脚本
 *
 * 两步走：
 *   1. tsc 编译 TS → dist/（处理 NestJS 装饰器元数据）
 *   2. esbuild 将 dist/ 打成单文件 bundle/main.js
 *
 * 用法：node scripts/bundle.mjs
 * 产物：bundle/main.js（~2-5MB，包含全部依赖）
 */
import { execSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// ── Step 1: tsc 编译（保留装饰器元数据） ──
console.log("[bundle] Step 1/3: tsc 编译...");
execSync("npx tsc -p tsconfig.build.json", { cwd: projectRoot, stdio: "inherit" });

// ── Step 2: esbuild 打包 ──
console.log("[bundle] Step 2/3: esbuild 打包...");

const bundleDir = resolve(projectRoot, "bundle");
if (existsSync(bundleDir)) {
  rmSync(bundleDir, { recursive: true });
}
mkdirSync(bundleDir, { recursive: true });

await esbuild.build({
  entryPoints: [resolve(projectRoot, "dist/main.js")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: resolve(bundleDir, "main.js"),
  // Prisma 有原生二进制引擎，不能打进 bundle
  // NestJS 可选依赖（动态 require，项目未使用）也排除
  external: [
    "@prisma/client",
    "class-transformer",
    "class-validator",
    "@nestjs/microservices",
    "@nestjs/microservices/microservices-module",
    "@nestjs/websockets",
    "@nestjs/websockets/socket-module",
    "@nestjs/platform-socket.io"
  ],
  // 忽略 NestJS 可选依赖的警告
  logOverride: {
    "require-resolve-not-external": "silent"
  },
  sourcemap: false,
  minify: false, // 保留可读性，方便排查问题
  // 处理 __dirname / __filename
  define: {
    "import.meta.url": "undefined"
  }
});

// ── Step 3: 拷贝 Prisma 引擎 ──
console.log("[bundle] Step 3/3: 拷贝 Prisma 引擎...");

// 通过 require.resolve 找到 pnpm 实际存放的 Prisma client 位置
import { createRequire } from "node:module";
const require = createRequire(resolve(projectRoot, "package.json"));

try {
  const prismaClientIndex = require.resolve("@prisma/client");
  const prismaClientPkg = dirname(prismaClientIndex);
  const dotPrismaClient = resolve(prismaClientPkg, "../../.prisma/client");

  // 跳过 Windows 引擎（.dll.node）；保留 Linux 引擎（.so.node）用于部署
  const skipPattern = /\.(dll\.node|dylib)(\.tmp\d*)?$/;
  // 跳过非 MySQL 的 WASM 引擎/编译器，以及 source map
  const skipWasmPattern = /query_(engine|compiler)_bg\.(postgresql|sqlite|cockroachdb|sqlserver|mongodb)\./;
  const skipMapPattern = /\.js\.map$|\.mjs\.map$/;

  function copyFiltered(src, dest) {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src)) {
      const srcPath = resolve(src, entry);
      const destPath = resolve(dest, entry);
      if (statSync(srcPath).isDirectory()) {
        copyFiltered(srcPath, destPath);
      } else if (!skipPattern.test(entry) && !skipWasmPattern.test(entry) && !skipMapPattern.test(entry)) {
        copyFileSync(srcPath, destPath);
      }
    }
  }

  if (existsSync(dotPrismaClient)) {
    copyFiltered(dotPrismaClient, resolve(bundleDir, "node_modules/.prisma/client"));
    console.log(`[bundle]   .prisma/client (JS only) ← ${dotPrismaClient}`);
  }

  copyFiltered(prismaClientPkg, resolve(bundleDir, "node_modules/@prisma/client"));
  console.log(`[bundle]   @prisma/client (JS only) ← ${prismaClientPkg}`);
} catch (e) {
  console.warn("[bundle] 未找到 @prisma/client，跳过 Prisma 引擎拷贝:", e.message);
}

console.log("[bundle] 完成！产物在 bundle/ 目录");
console.log("[bundle] 部署时只需要：");
console.log("[bundle]   bundle/main.js");
console.log("[bundle]   bundle/node_modules/.prisma/  (Prisma 引擎)");
console.log("[bundle]   .env");
