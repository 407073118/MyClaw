/**
 * 基于源 PNG 生成带圆角的应用图标。
 * 输出产物：build/icon.png（512）、build/icon.ico（多尺寸）、build/icons/*.png
 * 依赖：sharp（可使用全局安装或项目本地安装）
 */

import sharp from "sharp";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BUILD = join(ROOT, "build");
const ICONS_DIR = join(BUILD, "icons");
const DEFAULT_SOURCE_IMAGE = join(BUILD, "source-icon.png");

// 各平台需要的图标尺寸
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
// ICO 格式最大支持到 256x256
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * 解析图标源文件路径。
 * 优先级：命令行参数 > 环境变量 > build/source-icon.png。
 */
export function resolveSourceImagePath({
  argv = process.argv,
  env = process.env,
  fallbackExists = existsSync,
} = {}) {
  const cliSource = argv[2]?.trim();
  if (cliSource) {
    return cliSource;
  }

  const envSource = env.MYCLAW_ICON_SOURCE?.trim();
  if (envSource) {
    return envSource;
  }

  if (fallbackExists(DEFAULT_SOURCE_IMAGE)) {
    return DEFAULT_SOURCE_IMAGE;
  }

  return null;
}

mkdirSync(ICONS_DIR, { recursive: true });

/**
 * 为指定尺寸生成圆角遮罩 SVG。
 * 半径约为尺寸的 17.5%，视觉上接近 macOS 风格的圆角矩形。
 */
function roundedMask(size, radiusPct = 0.175) {
  const r = Math.round(size * radiusPct);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
       <rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="white"/>
     </svg>`
  );
}

/**
 * 将源图缩放到目标尺寸，并应用圆角处理。
 */
async function makeRoundedIcon(srcBuffer, size) {
  const resized = await sharp(srcBuffer)
    .resize(size, size, { fit: "cover" })
    .png()
    .toBuffer();

  const mask = await sharp(roundedMask(size))
    .resize(size, size)
    .png()
    .toBuffer();

  return sharp(resized)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

// ── ICO 文件格式辅助方法 ────────────────────────────────────────────────────

function createICO(pngBuffers) {
  // ICO 头部：6 字节
  const numImages = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * numImages;
  let dataOffset = headerSize + dirSize;

  const parts = [];

  // 文件头
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);         // 保留字段
  header.writeUInt16LE(1, 2);         // 类型：1 表示 ICO
  header.writeUInt16LE(numImages, 4); // 图像数量
  parts.push(header);

  // 目录项
  const entries = [];
  for (const { width, buffer } of pngBuffers) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(width >= 256 ? 0 : width, 0);    // 宽度（0 表示 256）
    entry.writeUInt8(width >= 256 ? 0 : width, 1);    // 高度（0 表示 256）
    entry.writeUInt8(0, 2);                             // 调色板信息
    entry.writeUInt8(0, 3);                             // 保留字段
    entry.writeUInt16LE(1, 4);                          // 色平面数
    entry.writeUInt16LE(32, 6);                         // 每像素位数
    entry.writeUInt32LE(buffer.length, 8);              // 图像数据大小
    entry.writeUInt32LE(dataOffset, 12);                // 图像数据偏移量
    entries.push(entry);
    dataOffset += buffer.length;
  }
  parts.push(...entries);

  // 图像数据
  for (const { buffer } of pngBuffers) {
    parts.push(buffer);
  }

  return Buffer.concat(parts);
}

// ── 主流程 ───────────────────────────────────────────────────────────────────

async function main() {
  const sourceImage = resolveSourceImagePath();
  if (!sourceImage) {
    throw new Error("未找到图标源文件。请传入命令行参数，或设置 MYCLAW_ICON_SOURCE，或放置 build/source-icon.png。");
  }

  console.log(`源图路径：${sourceImage}`);
  const srcBuffer = readFileSync(sourceImage);

  // 生成所有尺寸的圆角图标
  const results = [];
  for (const size of SIZES) {
    const buf = await makeRoundedIcon(srcBuffer, size);
    results.push({ size, buffer: buf });
    const outPath = join(ICONS_DIR, `${size}x${size}.png`);
    writeFileSync(outPath, buf);
    console.log(`  已生成 ${size}x${size}.png`);
  }

  // 主图标 icon.png（512x512）
  const icon512 = results.find((r) => r.size === 512);
  writeFileSync(join(BUILD, "icon.png"), icon512.buffer);
  console.log("  已生成 build/icon.png（512x512）");

  // 生成 Windows 使用的 ICO 文件
  const icoImages = ICO_SIZES.map((size) => {
    const r = results.find((x) => x.size === size);
    return { width: size, buffer: r.buffer };
  });
  const icoBuffer = createICO(icoImages);
  writeFileSync(join(BUILD, "icon.ico"), icoBuffer);
  console.log("  已生成 build/icon.ico");

  // 渲染层 HTML 使用的 favicon
  const favicon32 = results.find((r) => r.size === 32);
  writeFileSync(join(ROOT, "src", "renderer", "favicon.png"), favicon32.buffer);
  console.log("  已生成 src/renderer/favicon.png");

  console.log("\n完成：所有圆角图标均已生成。");
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  main().catch((err) => {
    console.error("生成图标失败：", err);
    process.exit(1);
  });
}
