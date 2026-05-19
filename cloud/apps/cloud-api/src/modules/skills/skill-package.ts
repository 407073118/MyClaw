import { BadRequestException } from "@nestjs/common";
import { inflateRawSync } from "node:zlib";

export type UploadedSkillPackageFile = {
  buffer: Buffer;
  fieldname: string;
  mimetype?: string;
  originalname: string;
  size: number;
};

export type SkillPackageMetadata = {
  description: string;
  name: string;
};

export type PreparedSkillPackage = {
  entryFile: string;
  fileBytes: Buffer;
  fileName: string;
  metadata: SkillPackageMetadata;
  skillMarkdown: string;
};

type ZipEntry = {
  compressedSize: number;
  compressionMethod: number;
  isDirectory: boolean;
  localHeaderOffset: number;
  name: string;
  uncompressedSize: number;
};

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const UTF8_FLAG = 0x0800;

const crcTable = buildCrcTable();

/** 解析 SKILL.md 中的名称和描述，优先读取 frontmatter，缺失时回退到正文。 */
export function parseSkillMarkdownMetadata(markdown: string): SkillPackageMetadata {
  console.info("[skill-package] 开始解析 SKILL.md 元数据", { size: Buffer.byteLength(markdown) });
  const frontmatter = parseFrontmatter(markdown);
  const name = (frontmatter.name || readFirstHeading(markdown)).trim();
  const description = (frontmatter.description || frontmatter.summary || readFirstParagraph(markdown)).trim();

  if (!name) {
    console.warn("[skill-package] SKILL.md 缺少 name 字段");
    throw new BadRequestException("skill_manifest_name_required");
  }

  if (!description) {
    console.warn("[skill-package] SKILL.md 缺少 description 字段", { name });
    throw new BadRequestException("skill_manifest_description_required");
  }

  console.info("[skill-package] SKILL.md 元数据解析完成", { name, descriptionLength: description.length });
  return { name, description };
}

/** 准备上传的 Skill 包，支持原始 ZIP 或浏览器文件夹上传。 */
export function prepareSkillPackageUpload(files: UploadedSkillPackageFile[]): PreparedSkillPackage {
  console.info("[skill-package] 开始准备 Skill 上传包", { fileCount: files.length });
  if (!files.length) {
    console.warn("[skill-package] Skill 上传包为空");
    throw new BadRequestException("skill_package_required");
  }

  if (files.length === 1 && files[0]!.originalname.toLowerCase().endsWith(".zip")) {
    return prepareZipSkillPackage(files[0]!);
  }

  return prepareFolderSkillPackage(files);
}

/** 从 ZIP 文件中提取 SKILL.md，并保留原始 ZIP 作为发布工件。 */
function prepareZipSkillPackage(file: UploadedSkillPackageFile): PreparedSkillPackage {
  console.info("[skill-package] 开始解析 ZIP Skill 包", { fileName: file.originalname, size: file.size });
  const entries = readZipEntries(file.buffer);
  const skillEntry = findSkillMarkdownEntry(entries);
  const skillMarkdown = readZipEntryText(file.buffer, skillEntry);
  const metadata = parseSkillMarkdownMetadata(skillMarkdown);

  console.info("[skill-package] ZIP Skill 包解析完成", {
    entryFile: skillEntry.name,
    fileName: file.originalname,
    skillName: metadata.name
  });
  return {
    entryFile: skillEntry.name,
    fileBytes: file.buffer,
    fileName: sanitizeZipFileName(file.originalname, metadata.name),
    metadata,
    skillMarkdown
  };
}

/** 从文件夹上传中提取 SKILL.md，并打包成 ZIP 作为发布工件。 */
function prepareFolderSkillPackage(files: UploadedSkillPackageFile[]): PreparedSkillPackage {
  console.info("[skill-package] 开始解析文件夹 Skill 包", { fileCount: files.length });
  const normalizedFiles = files.map((file) => ({
    ...file,
    archivePath: assertSafeArchivePath(file.originalname)
  }));
  const skillFile = findSkillMarkdownEntry(normalizedFiles.map((file) => ({
    compressedSize: file.buffer.length,
    compressionMethod: 0,
    isDirectory: false,
    localHeaderOffset: 0,
    name: file.archivePath,
    uncompressedSize: file.buffer.length
  })));
  const sourceFile = normalizedFiles.find((file) => file.archivePath === skillFile.name);
  if (!sourceFile) {
    console.warn("[skill-package] 文件夹上传缺少可读取的 SKILL.md", { entryFile: skillFile.name });
    throw new BadRequestException("skill_manifest_missing");
  }

  const skillMarkdown = sourceFile.buffer.toString("utf8");
  const metadata = parseSkillMarkdownMetadata(skillMarkdown);
  const fileName = `${buildArchiveBaseName(skillFile.name, metadata.name)}.zip`;
  const fileBytes = createStoredZip(normalizedFiles.map((file) => ({
    content: file.buffer,
    name: file.archivePath
  })));

  console.info("[skill-package] 文件夹 Skill 包解析并打包完成", {
    entryFile: skillFile.name,
    fileName,
    skillName: metadata.name,
    zippedSize: fileBytes.length
  });
  return {
    entryFile: skillFile.name,
    fileBytes,
    fileName,
    metadata,
    skillMarkdown
  };
}

/** 读取 ZIP 中央目录，返回所有文件条目。 */
function readZipEntries(buffer: Buffer): ZipEntry[] {
  console.info("[skill-package] 开始读取 ZIP 中央目录", { size: buffer.length });
  const endOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(endOffset + 16);

  if (centralDirectoryOffset + centralDirectorySize > buffer.length) {
    console.warn("[skill-package] ZIP 中央目录越界", { centralDirectoryOffset, centralDirectorySize });
    throw new BadRequestException("skill_zip_invalid");
  }

  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      console.warn("[skill-package] ZIP 中央目录头异常", { index, offset });
      throw new BadRequestException("skill_zip_invalid");
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nameBytes = buffer.subarray(offset + 46, offset + 46 + fileNameLength);
    const name = normalizeArchivePath(nameBytes.toString(flags & UTF8_FLAG ? "utf8" : "utf8"));

    entries.push({
      compressedSize,
      compressionMethod,
      isDirectory: name.endsWith("/"),
      localHeaderOffset,
      name,
      uncompressedSize
    });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  console.info("[skill-package] ZIP 中央目录读取完成", { entryCount: entries.length });
  return entries;
}

/** 定位 ZIP 结尾目录记录。 */
function findEndOfCentralDirectory(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }

  console.warn("[skill-package] ZIP 缺少结尾目录记录");
  throw new BadRequestException("skill_zip_invalid");
}

/** 在条目列表中选择最接近根目录的 SKILL.md。 */
function findSkillMarkdownEntry<T extends { isDirectory?: boolean; name: string }>(entries: T[]): T {
  const candidates = entries
    .filter((entry) => !entry.isDirectory && entry.name.split("/").at(-1)?.toLowerCase() === "skill.md")
    .sort((left, right) => left.name.split("/").length - right.name.split("/").length);

  if (!candidates.length) {
    console.warn("[skill-package] Skill 包中未找到 SKILL.md");
    throw new BadRequestException("skill_manifest_missing");
  }

  console.info("[skill-package] 已定位 Skill 入口文件", { entryFile: candidates[0]!.name });
  return candidates[0]!;
}

/** 从 ZIP 条目读取文本内容，支持 store 和 deflate。 */
function readZipEntryText(buffer: Buffer, entry: ZipEntry): string {
  console.info("[skill-package] 开始读取 ZIP 条目内容", {
    entryFile: entry.name,
    compressionMethod: entry.compressionMethod,
    compressedSize: entry.compressedSize
  });
  const localOffset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(localOffset) !== ZIP_LOCAL_FILE_HEADER) {
    console.warn("[skill-package] ZIP 本地文件头异常", { entryFile: entry.name, localOffset });
    throw new BadRequestException("skill_zip_invalid");
  }

  const fileNameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) {
    console.warn("[skill-package] ZIP 条目内容越界", { entryFile: entry.name, dataStart, dataEnd });
    throw new BadRequestException("skill_zip_invalid");
  }

  const compressed = buffer.subarray(dataStart, dataEnd);
  if (entry.compressionMethod === 0) {
    return compressed.toString("utf8");
  }
  if (entry.compressionMethod === 8) {
    return inflateRawSync(compressed).toString("utf8");
  }

  console.warn("[skill-package] ZIP 使用了暂不支持的压缩方法", {
    entryFile: entry.name,
    compressionMethod: entry.compressionMethod
  });
  throw new BadRequestException("skill_zip_unsupported_compression");
}

/** 创建不压缩的 ZIP，用于把浏览器文件夹上传转成统一工件。 */
function createStoredZip(entries: Array<{ content: Buffer; name: string }>): Buffer {
  console.info("[skill-package] 开始创建文件夹 ZIP 工件", { entryCount: entries.length });
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = entry.content;
    const checksum = crc32(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(ZIP_LOCAL_FILE_HEADER, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(UTF8_FLAG, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_HEADER, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  const zip = Buffer.concat([...localParts, centralDirectory, end]);
  console.info("[skill-package] 文件夹 ZIP 工件创建完成", { size: zip.length });
  return zip;
}

/** 解析 YAML 风格 frontmatter 的简单 key-value 内容。 */
function parseFrontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return {};
  }

  const result: Record<string, string> = {};
  const lines = match[1]!.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;
    const key = pair[1]!.trim().toLowerCase();
    const value = pair[2]!.trim();
    if (value === "|" || value === ">") {
      const nested: string[] = [];
      while (lines[index + 1]?.match(/^\s+/)) {
        index += 1;
        nested.push(lines[index]!.trim());
      }
      result[key] = nested.join(value === ">" ? " " : "\n").trim();
    } else {
      result[key] = trimYamlScalar(value);
    }
  }

  return result;
}

/** 读取正文里的第一个 Markdown 一级标题作为名称回退值。 */
function readFirstHeading(markdown: string): string {
  return markdown.match(/^#\s+(.+)$/m)?.[1] ?? "";
}

/** 读取正文里的第一段普通文本作为描述回退值。 */
function readFirstParagraph(markdown: string): string {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---/, "");
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("```")) {
      return trimmed;
    }
  }
  return "";
}

/** 去除 YAML 标量的包裹引号。 */
function trimYamlScalar(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).trim();
  }
  return value;
}

/** 规范化压缩包路径，统一分隔符并去除头部斜杠。 */
function normalizeArchivePath(rawPath: string): string {
  return rawPath.replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter(Boolean).join("/");
}

/** 校验压缩包路径安全，避免写入越界路径。 */
function assertSafeArchivePath(rawPath: string): string {
  const normalized = normalizeArchivePath(rawPath);
  if (!normalized || normalized.split("/").includes("..") || /^[a-z]:/i.test(normalized)) {
    console.warn("[skill-package] 拒绝不安全的 Skill 包路径", { rawPath, normalized });
    throw new BadRequestException("skill_package_path_invalid");
  }
  return normalized;
}

/** 根据入口路径和 Skill 名称生成文件夹 ZIP 文件名。 */
function buildArchiveBaseName(entryFile: string, skillName: string): string {
  const segments = entryFile.split("/");
  const baseName = segments.length > 1 ? segments[0]! : skillName;
  return slugifyFileName(baseName || skillName || "skill-package");
}

/** 确保上传 ZIP 文件名合法，不合法时使用 Skill 名称生成。 */
function sanitizeZipFileName(fileName: string, skillName: string): string {
  const normalized = normalizeArchivePath(fileName).split("/").at(-1) || "";
  if (normalized.toLowerCase().endsWith(".zip") && !normalized.includes("..")) {
    return normalized;
  }
  return `${slugifyFileName(skillName || "skill-package")}.zip`;
}

/** 将显示名称转换为适合作为 zip 文件名的短横线格式。 */
function slugifyFileName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "skill-package";
}

/** 计算 CRC32，保证文件夹转 ZIP 后可被标准解压器校验。 */
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 构建 CRC32 查表，加快文件夹打包时的校验值计算。 */
function buildCrcTable(): number[] {
  const table: number[] = [];
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}
