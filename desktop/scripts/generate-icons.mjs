/**
 * Generate rounded-corner app icons from source PNG.
 * Produces: build/icon.png (512), build/icon.ico (multi-size), build/icons/*.png
 * Requires: sharp (available globally or locally)
 */

import sharp from "sharp";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BUILD = join(ROOT, "build");
const ICONS_DIR = join(BUILD, "icons");
const SRC_IMAGE = process.argv[2] || "C:\\Users\\jianing.zhang1\\Downloads\\MyClaw图标.png";

// Icon sizes needed for various platforms
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
// ICO format supports up to 256x256
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

mkdirSync(ICONS_DIR, { recursive: true });

/**
 * Create a rounded-corner mask SVG for a given size.
 * radius ~17.5% of size gives a nice macOS-like rounded rect.
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
 * Resize source to target size with rounded corners.
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

// ── ICO file format helpers ──────────────────────────────────────────────────

function createICO(pngBuffers) {
  // ICO header: 6 bytes
  const numImages = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * numImages;
  let dataOffset = headerSize + dirSize;

  const parts = [];

  // Header
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);         // reserved
  header.writeUInt16LE(1, 2);         // type: 1 = ICO
  header.writeUInt16LE(numImages, 4); // number of images
  parts.push(header);

  // Directory entries
  const entries = [];
  for (const { width, buffer } of pngBuffers) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(width >= 256 ? 0 : width, 0);    // width (0 = 256)
    entry.writeUInt8(width >= 256 ? 0 : width, 1);    // height (0 = 256)
    entry.writeUInt8(0, 2);                             // color palette
    entry.writeUInt8(0, 3);                             // reserved
    entry.writeUInt16LE(1, 4);                          // color planes
    entry.writeUInt16LE(32, 6);                         // bits per pixel
    entry.writeUInt32LE(buffer.length, 8);              // image data size
    entry.writeUInt32LE(dataOffset, 12);                // offset to data
    entries.push(entry);
    dataOffset += buffer.length;
  }
  parts.push(...entries);

  // Image data
  for (const { buffer } of pngBuffers) {
    parts.push(buffer);
  }

  return Buffer.concat(parts);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Source: ${SRC_IMAGE}`);
  const srcBuffer = readFileSync(SRC_IMAGE);

  // Generate all sizes with rounded corners
  const results = [];
  for (const size of SIZES) {
    const buf = await makeRoundedIcon(srcBuffer, size);
    results.push({ size, buffer: buf });
    const outPath = join(ICONS_DIR, `${size}x${size}.png`);
    writeFileSync(outPath, buf);
    console.log(`  Generated ${size}x${size}.png`);
  }

  // Main icon.png (512x512)
  const icon512 = results.find((r) => r.size === 512);
  writeFileSync(join(BUILD, "icon.png"), icon512.buffer);
  console.log("  Generated build/icon.png (512x512)");

  // Generate ICO (Windows)
  const icoImages = ICO_SIZES.map((size) => {
    const r = results.find((x) => x.size === size);
    return { width: size, buffer: r.buffer };
  });
  const icoBuffer = createICO(icoImages);
  writeFileSync(join(BUILD, "icon.ico"), icoBuffer);
  console.log("  Generated build/icon.ico");

  // Favicon for renderer HTML
  const favicon32 = results.find((r) => r.size === 32);
  writeFileSync(join(ROOT, "src", "renderer", "favicon.png"), favicon32.buffer);
  console.log("  Generated src/renderer/favicon.png");

  console.log("\nDone! All icons generated with rounded corners.");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
