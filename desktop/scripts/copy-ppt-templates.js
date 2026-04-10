/**
 * 将 PPT 版式 HTML 模板复制到 dist/ 输出目录。
 *
 * tsc 只输出 .js / .d.ts 文件，HTML 模板需要额外复制，
 * 否则打包后的 Electron 应用无法通过文件系统加载模板。
 */
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "src", "main", "services", "ppt", "layouts");
const dest = path.join(__dirname, "..", "dist", "src", "main", "services", "ppt", "layouts");

if (!fs.existsSync(src)) {
  console.log("[copy-ppt-templates] 源目录不存在，跳过:", src);
  process.exit(0);
}

fs.mkdirSync(dest, { recursive: true });

const htmlFiles = fs.readdirSync(src).filter((f) => f.endsWith(".html"));

for (const file of htmlFiles) {
  fs.copyFileSync(path.join(src, file), path.join(dest, file));
}

console.log(`[copy-ppt-templates] 已复制 ${htmlFiles.length} 个 HTML 模板到 dist/`);
