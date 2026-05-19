<script setup lang="ts">
import type { CreateSkillInput, SkillCategory, SkillDetail, UpdateSkillInput } from "@myclaw-cloud/shared";
import { renderSafeMarkdown } from "~/utils/render-safe-markdown";

type SkillUploadMode = "folder" | "zip";

type SkillMarkdownMetadata = {
  description: string;
  name: string;
};

type SkillPackagePreview = SkillMarkdownMetadata & {
  entryFile: string;
  fileCount: number;
  id: string;
  readme: string;
  sourceName: string;
  summary: string;
  uploadMode: SkillUploadMode;
};

type ZipEntry = {
  compressedSize: number;
  compressionMethod: number;
  isDirectory: boolean;
  localHeaderOffset: number;
  name: string;
};

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;

const route = useRoute();
const { user: currentUser } = useCloudSession();

// ---------- 模式识别 ----------
const existingSkillId = computed(() => (route.query.id as string) || "");
const isEditMode = computed(() => !!existingSkillId.value);

// ---------- 上传状态 ----------
const zipInput = ref<HTMLInputElement | null>(null);
const folderInput = ref<HTMLInputElement | null>(null);
const isPending = ref(false);
const isParsing = ref(false);
const isLoading = ref(false);
const errorMsg = ref("");
const successMsg = ref("");
const selectedFiles = ref<File[]>([]);
const uploadMode = ref<SkillUploadMode | null>(null);
const skillPreview = ref<SkillPackagePreview | null>(null);
const existingSkill = ref<SkillDetail | null>(null);
const releaseVersion = ref("1.0.0");

const isReleaseVersionValid = computed(() => /^\d+\.\d+\.\d+$/.test(releaseVersion.value.trim()));
const canPublish = computed(() => Boolean(
  skillPreview.value
  && selectedFiles.value.length
  && !isParsing.value
  && isReleaseVersionValid.value
));
const renderedSkillMarkdown = computed(() => {
  const readme = skillPreview.value?.readme || "";
  return renderSafeMarkdown(stripSkillFrontmatter(readme));
});
const existingReleaseSummaries = computed(() => existingSkill.value?.releases ?? []);
const latestVersionLabel = computed(() => existingSkill.value?.latestVersion ? `v${existingSkill.value.latestVersion}` : "暂无版本");
const suggestedReleaseVersion = computed(() => resolveNextPatchVersion(existingSkill.value?.latestVersion));
const versionHintText = computed(() => {
  const current = existingSkill.value?.latestVersion || null;
  return current ? `已按最新版本 ${current} 递增，发布前可微调。` : "新 Skill 默认 1.0.0，发布前可微调。";
});

// ---------- 编辑模式下加载已有技能 ----------
watch(
  existingSkillId,
  async (id) => {
    if (!id) {
      existingSkill.value = null;
      return;
    }
    isLoading.value = true;
    errorMsg.value = "";
    try {
      console.info("[Skills 发布] 开始加载已有 Skill 信息", { id });
      existingSkill.value = await $fetch<SkillDetail>(`/api/skills/${id}`);
      console.info("[Skills 发布] 已加载已有 Skill 信息", { id, latestVersion: existingSkill.value.latestVersion });
    } catch (error: any) {
      console.error("[Skills 发布] 获取 Skill 信息失败", error);
      errorMsg.value = error?.data?.statusMessage || error?.message || "获取 Skill 信息失败。";
    } finally {
      isLoading.value = false;
    }
  },
  { immediate: true }
);

// 根据已有最新版本刷新默认发布版本，保留页面右侧确认区的可解释性。
watch(
  suggestedReleaseVersion,
  (version) => {
    console.info("[Skills 发布] 刷新默认发布版本", {
      latestVersion: existingSkill.value?.latestVersion ?? null,
      suggestedVersion: version
    });
    releaseVersion.value = version;
  },
  { immediate: true }
);

/** 打开 ZIP 文件选择器。 */
function openZipPicker() {
  console.info("[Skills 发布] 打开 ZIP 上传选择器");
  zipInput.value?.click();
}

/** 打开文件夹选择器。 */
function openFolderPicker() {
  console.info("[Skills 发布] 打开文件夹上传选择器");
  folderInput.value?.click();
}

/** 读取用户选择的 ZIP，并解析其中的 SKILL.md。 */
async function handleZipChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  await loadSkillPackage([file], "zip");
}

/** 读取用户选择的文件夹，并解析其中的 SKILL.md。 */
async function handleFolderChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  if (!files.length) return;
  await loadSkillPackage(files, "folder");
}

/** 统一解析上传包，生成页面预览和后续提交需要的文件列表。 */
async function loadSkillPackage(files: File[], mode: SkillUploadMode) {
  isParsing.value = true;
  errorMsg.value = "";
  successMsg.value = "";
  skillPreview.value = null;
  selectedFiles.value = [];
  uploadMode.value = null;
  console.info("[Skills 发布] 开始解析 Skill 上传包", { mode, fileCount: files.length });

  try {
    const extracted = mode === "zip"
      ? await extractSkillMarkdownFromZip(files[0]!)
      : await extractSkillMarkdownFromFolder(files);
    const metadata = parseSkillMarkdownMetadata(extracted.readme);
    const preview = buildSkillPackagePreview({
      entryFile: extracted.entryFile,
      fileCount: files.length,
      metadata,
      mode,
      readme: extracted.readme,
      sourceName: mode === "zip" ? files[0]!.name : readFolderSourceName(files)
    });

    selectedFiles.value = files;
    uploadMode.value = mode;
    skillPreview.value = preview;
    console.info("[Skills 发布] Skill 上传包解析完成", {
      id: preview.id,
      name: preview.name,
      entryFile: preview.entryFile,
      fileCount: preview.fileCount
    });
  } catch (error: any) {
    console.error("[Skills 发布] Skill 上传包解析失败", error);
    errorMsg.value = error?.message || "请上传包含 SKILL.md 的 Skill 包。";
  } finally {
    isParsing.value = false;
  }
}

/** 提交技能发布流程，元数据全部来自 SKILL.md。 */
async function handlePublish() {
  errorMsg.value = "";
  successMsg.value = "";

  if (!skillPreview.value || !uploadMode.value || !selectedFiles.value.length) {
    errorMsg.value = "请先上传包含 SKILL.md 的 Skill 包。";
    return;
  }
  releaseVersion.value = releaseVersion.value.trim();
  if (!isReleaseVersionValid.value) {
    errorMsg.value = "本次发布版本必须是 x.y.z 格式。";
    return;
  }

  isPending.value = true;
  const preview = skillPreview.value;
  const skillId = isEditMode.value ? existingSkillId.value : preview.id;
  const version = releaseVersion.value.trim();

  try {
    if (isEditMode.value) {
      console.info("[Skills 发布] 开始用 SKILL.md 元数据更新已有技能", { id: skillId, sourceName: preview.sourceName, version });
      await $fetch(`/api/skills/${skillId}`, {
        method: "PUT",
        body: buildUpdateBody(preview),
      });
    } else {
      console.info("[Skills 发布] 开始创建新技能", { id: preview.id, sourceName: preview.sourceName, version });
      const result = await $fetch<{ skill: { id: string } }>("/api/skills", {
        method: "POST",
        body: buildCreateBody(preview),
      });
      console.info("[Skills 发布] 新技能创建完成", { id: result.skill.id });
    }

    const formData = new FormData();
    formData.append("version", releaseVersion.value);
    formData.append("releaseNotes", buildReleaseNotes(preview));
    appendPackageFiles(formData, selectedFiles.value, uploadMode.value);

    console.info("[Skills 发布] 开始提交 Skill 发布包", {
      id: skillId,
      uploadMode: uploadMode.value,
      fileCount: selectedFiles.value.length,
      version
    });
    await $fetch(`/api/skills/${skillId}/releases`, {
      method: "POST",
      body: formData,
    });

    console.info("[Skills 发布] 技能发布成功，准备跳转详情页", { id: skillId, version });
    await navigateTo(`/skills/${skillId}`);
  } catch (error: any) {
    console.error("[Skills 发布] 技能发布失败", error);
    errorMsg.value = error?.data?.statusMessage || error?.statusMessage || error?.message || "发布技能失败。";
  } finally {
    isPending.value = false;
  }
}

/** 根据解析出的 Skill 元数据构建创建请求体。 */
function buildCreateBody(preview: SkillPackagePreview): CreateSkillInput {
  console.info("[Skills 发布] 构建 Skill 创建请求体", { id: preview.id, name: preview.name });
  return {
    id: preview.id,
    name: preview.name,
    summary: preview.summary,
    description: preview.description,
    category: "other" as SkillCategory,
    tags: [],
    author: readAuthorName(),
  };
}

/** 根据解析出的 Skill 元数据构建更新请求体。 */
function buildUpdateBody(preview: SkillPackagePreview): UpdateSkillInput {
  console.info("[Skills 发布] 构建 Skill 更新请求体", { id: existingSkillId.value, name: preview.name });
  return {
    name: preview.name,
    summary: preview.summary,
    description: preview.description,
    category: existingSkill.value?.category || "other",
    tags: existingSkill.value?.tags || [],
    author: readAuthorName() || existingSkill.value?.author || undefined,
  };
}

/** 把 ZIP 或文件夹文件写入 FormData，文件夹保留浏览器提供的相对路径。 */
function appendPackageFiles(formData: FormData, files: File[], mode: SkillUploadMode) {
  console.info("[Skills 发布] 写入 Skill 上传文件到 FormData", { mode, fileCount: files.length });
  if (mode === "zip") {
    formData.append("file", files[0]!);
    return;
  }

  for (const file of files) {
    formData.append("files", file, readRelativeFilePath(file));
  }
}

/** 生成隐藏的发布说明，避免用户手填无意义字段。 */
function buildReleaseNotes(preview: SkillPackagePreview): string {
  const action = isEditMode.value ? "更新" : "发布";
  const notes = `从 SKILL.md ${action} ${preview.name}`;
  console.info("[Skills 发布] 自动生成发布说明", { notes });
  return notes;
}

/** 生成页面预览对象。 */
function buildSkillPackagePreview(input: {
  entryFile: string;
  fileCount: number;
  metadata: SkillMarkdownMetadata;
  mode: SkillUploadMode;
  readme: string;
  sourceName: string;
}): SkillPackagePreview {
  console.info("[Skills 发布] 构建 Skill 包预览", {
    name: input.metadata.name,
    entryFile: input.entryFile,
    mode: input.mode
  });
  return {
    description: input.metadata.description,
    entryFile: input.entryFile,
    fileCount: input.fileCount,
    id: slugifySkillId(input.metadata.name, input.readme),
    name: input.metadata.name,
    readme: input.readme,
    sourceName: input.sourceName,
    summary: buildSummary(input.metadata.description),
    uploadMode: input.mode,
  };
}

/** 从 SKILL.md frontmatter 或正文中解析名称和描述。 */
function parseSkillMarkdownMetadata(markdown: string): SkillMarkdownMetadata {
  console.info("[Skills 发布] 解析 Skill 元数据", { size: markdown.length });
  const frontmatter = parseFrontmatter(markdown);
  const name = (frontmatter.name || readFirstHeading(markdown)).trim();
  const description = (frontmatter.description || frontmatter.summary || readFirstParagraph(markdown)).trim();

  if (!name) {
    throw new Error("SKILL.md 必须包含 name。");
  }
  if (!description) {
    throw new Error("SKILL.md 必须包含 description。");
  }

  return { description, name };
}

/** 去掉 SKILL.md 顶部元数据块，让预览区按正文 Markdown 展示。 */
function stripSkillFrontmatter(markdown: string): string {
  const stripped = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---/, "").trim();
  console.info("[Skills 发布] 生成 Markdown 正文预览", { sourceSize: markdown.length, previewSize: stripped.length });
  return stripped || markdown;
}

/** 根据已有最新版本推导下一个 patch 版本，新 Skill 从 1.0.0 开始。 */
function resolveNextPatchVersion(currentVersion?: string | null): string {
  const normalized = currentVersion?.trim().replace(/^v/i, "") ?? "";
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    console.info("[Skills 发布] 未找到有效已有版本，使用初始版本", { currentVersion, nextVersion: "1.0.0" });
    return "1.0.0";
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const nextVersion = `${major}.${minor}.${patch + 1}`;
  console.info("[Skills 发布] 已根据已有版本递增 patch", { currentVersion, nextVersion });
  return nextVersion;
}

/** 从 ZIP 中提取 SKILL.md，支持 store 和 deflate 两种常见压缩方式。 */
async function extractSkillMarkdownFromZip(file: File): Promise<{ entryFile: string; readme: string }> {
  console.info("[Skills 发布] 开始解析 ZIP 中的 SKILL.md", { fileName: file.name, size: file.size });
  if (!file.name.toLowerCase().endsWith(".zip")) {
    throw new Error("请上传 ZIP 文件或选择文件夹。");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = readZipEntries(bytes);
  const skillEntry = findSkillEntry(entries);
  const readme = await readZipEntryText(bytes, skillEntry);
  console.info("[Skills 发布] 已从 ZIP 读取 SKILL.md", { entryFile: skillEntry.name, size: readme.length });
  return {
    entryFile: skillEntry.name,
    readme,
  };
}

/** 从文件夹文件列表中提取 SKILL.md。 */
async function extractSkillMarkdownFromFolder(files: File[]): Promise<{ entryFile: string; readme: string }> {
  console.info("[Skills 发布] 开始解析文件夹中的 SKILL.md", { fileCount: files.length });
  const entries = files.map((file) => ({
    file,
    name: normalizeArchivePath(readRelativeFilePath(file)),
  }));
  const skillEntry = findSkillEntry(entries);
  const readme = await skillEntry.file.text();
  console.info("[Skills 发布] 已从文件夹读取 SKILL.md", { entryFile: skillEntry.name, size: readme.length });
  return {
    entryFile: skillEntry.name,
    readme,
  };
}

/** 读取 ZIP 中央目录条目。 */
function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  console.info("[Skills 发布] 开始读取 ZIP 中央目录", { size: bytes.byteLength });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralDirectorySize = view.getUint32(endOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(endOffset + 16, true);

  if (centralDirectoryOffset + centralDirectorySize > bytes.byteLength) {
    throw new Error("ZIP 结构异常，无法读取目录。");
  }

  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      throw new Error("ZIP 结构异常，中央目录损坏。");
    }

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameBytes = bytes.slice(offset + 46, offset + 46 + fileNameLength);
    const name = normalizeArchivePath(new TextDecoder("utf-8").decode(nameBytes));

    entries.push({
      compressedSize,
      compressionMethod,
      isDirectory: name.endsWith("/"),
      localHeaderOffset,
      name,
    });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

/** 定位 ZIP 结尾目录记录。 */
function findEndOfCentralDirectory(view: DataView): number {
  const minOffset = Math.max(0, view.byteLength - 0xffff - 22);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }
  throw new Error("ZIP 结构异常，缺少结尾目录。");
}

/** 从候选条目中选择最接近根目录的 SKILL.md。 */
function findSkillEntry<T extends { isDirectory?: boolean; name: string }>(entries: T[]): T {
  const candidates = entries
    .filter((entry) => !entry.isDirectory && entry.name.split("/").at(-1)?.toLowerCase() === "skill.md")
    .sort((left, right) => left.name.split("/").length - right.name.split("/").length);

  if (!candidates.length) {
    throw new Error("请上传包含 SKILL.md 的 Skill 包。");
  }

  return candidates[0]!;
}

/** 读取 ZIP 条目文本内容。 */
async function readZipEntryText(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const localOffset = entry.localHeaderOffset;
  if (view.getUint32(localOffset, true) !== ZIP_LOCAL_FILE_HEADER) {
    throw new Error("ZIP 结构异常，文件头损坏。");
  }

  const fileNameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const dataStart = localOffset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  const compressed = bytes.slice(dataStart, dataEnd);

  if (entry.compressionMethod === 0) {
    return new TextDecoder("utf-8").decode(compressed);
  }
  if (entry.compressionMethod === 8) {
    const stream = new Blob([compressed]).stream().pipeThrough(new (globalThis as any).DecompressionStream("deflate-raw"));
    return await new Response(stream).text();
  }

  throw new Error("暂不支持这个 ZIP 的压缩方式，请改为选择文件夹上传。");
}

/** 解析 SKILL.md frontmatter 的简单 key-value 内容。 */
function parseFrontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const result: Record<string, string> = {};
  const lines = match[1]!.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const pair = lines[index]!.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
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

/** 读取正文里的第一个 Markdown 一级标题。 */
function readFirstHeading(markdown: string): string {
  return markdown.match(/^#\s+(.+)$/m)?.[1] ?? "";
}

/** 读取正文里的第一段普通文本。 */
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

/** 去掉 YAML 标量的包裹引号。 */
function trimYamlScalar(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).trim();
  }
  return value;
}

/** 生成列表页摘要，避免把长描述塞进摘要字段。 */
function buildSummary(description: string): string {
  const compact = description.replace(/\s+/g, " ").trim();
  return compact.length > 140 ? `${compact.slice(0, 137)}...` : compact;
}

/** 根据 Skill 名称生成稳定 ID，中文等无法转写时退回内容哈希。 */
function slugifySkillId(name: string, content: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug) return slug;
  return `skill-${hashString(content)}`;
}

/** 计算短哈希，用作非拉丁名称的 ID 后缀。 */
function hashString(content: string): string {
  let hash = 0;
  for (let index = 0; index < content.length; index += 1) {
    hash = (Math.imul(31, hash) + content.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

/** 读取当前登录用户名称。 */
function readAuthorName(): string | undefined {
  return currentUser.value?.displayName || currentUser.value?.account || undefined;
}

/** 读取浏览器文件夹上传时的相对路径。 */
function readRelativeFilePath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

/** 推导文件夹来源名称。 */
function readFolderSourceName(files: File[]): string {
  const firstPath = readRelativeFilePath(files[0]!);
  return normalizeArchivePath(firstPath).split("/")[0] || "选择的文件夹";
}

/** 规范化压缩包路径，统一斜杠和多余空段。 */
function normalizeArchivePath(rawPath: string): string {
  return rawPath.replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter(Boolean).join("/");
}

useHead({
  title: computed(() => (isEditMode.value ? "发布新版本 | MyClaw Cloud" : "发布 Skill | MyClaw Cloud")),
});
</script>

<template>
  <main class="nuxt-publish-web-page">
    <div class="publish-container-nx">
      <div class="publish-header-nx">
        <NuxtLink class="back-link-nx" to="/skills">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          返回 Skills
        </NuxtLink>
        <div class="title-area">
          <template v-if="isEditMode && existingSkill">
            <h2>发布新版本 <span class="dim">{{ existingSkill.name }}</span></h2>
            <p class="subtitle">上传 zip 或文件夹，Cloud 会从 SKILL.md 读取名称和描述。</p>
          </template>
          <template v-else-if="isEditMode && isLoading">
            <h2>加载中...</h2>
            <p class="subtitle">正在获取 Skill 信息。</p>
          </template>
          <template v-else>
            <h2>发布 <span class="dim">Skill</span></h2>
            <p class="subtitle">上传 zip 或文件夹，Cloud 会从 SKILL.md 读取名称和描述。</p>
          </template>
        </div>
      </div>

      <div v-if="isLoading" class="loading-state">
        <span class="spinner large"></span>
        <p>正在加载 Skill 信息...</p>
      </div>

      <form v-else class="desktop-form-layout" @submit.prevent="handlePublish">
        <section class="layout-main form-card-nx glass-card-nx">
          <header class="section-head">
            <h3>上传 Skill 包</h3>
            <p>支持 zip 或文件夹；必须包含 SKILL.md。</p>
          </header>

          <input ref="zipInput" class="hidden-file-input" type="file" accept=".zip" @change="handleZipChange" />
          <input ref="folderInput" class="hidden-file-input" type="file" webkitdirectory multiple @change="handleFolderChange" />

          <div class="upload-choice-grid">
            <button type="button" class="upload-choice" @click="openZipPicker">
              <span class="choice-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M10 12h4"/><path d="M10 16h4"/></svg>
              </span>
              <strong>选择 ZIP</strong>
              <span>上传已打包的 Skill。</span>
            </button>
            <button type="button" class="upload-choice" @click="openFolderPicker">
              <span class="choice-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 012-2h5l2 2h7a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M8 13h8"/></svg>
              </span>
              <strong>选择文件夹</strong>
              <span>直接选择 Skill 目录。</span>
            </button>
          </div>

          <div v-if="isParsing" class="inline-state">
            <span class="spinner"></span>
            正在解析 Skill 元数据...
          </div>

          <div v-if="skillPreview" class="preview-panel">
            <div class="preview-header">
              <div>
                <span class="eyebrow">解析 Skill 元数据</span>
                <h3>{{ skillPreview.name }}</h3>
              </div>
              <span class="source-pill">{{ skillPreview.uploadMode === "zip" ? "ZIP" : "文件夹" }}</span>
            </div>

            <div class="metadata-grid">
              <div>
                <span>Skill ID</span>
                <strong>@myclaw/{{ isEditMode ? existingSkillId : skillPreview.id }}</strong>
              </div>
              <div>
                <span>入口文件</span>
                <strong>{{ skillPreview.entryFile }}</strong>
              </div>
              <div>
                <span>来源</span>
                <strong>{{ skillPreview.sourceName }}</strong>
              </div>
              <div>
                <span>文件数</span>
                <strong>{{ skillPreview.fileCount }}</strong>
              </div>
            </div>

            <div class="description-box">
              <span>描述</span>
              <p>{{ skillPreview.description }}</p>
            </div>

            <div class="markdown-preview-box">
              <div class="markdown-preview-head">
                <span>Markdown 预览</span>
                <code>{{ skillPreview.entryFile }}</code>
              </div>
              <div class="markdown-preview-content" v-html="renderedSkillMarkdown"></div>
            </div>
          </div>
        </section>

        <aside class="layout-sidebar form-card-nx glass-card-nx">
          <section class="inner-section">
            <header class="section-head compact">
              <h3>发布确认</h3>
            </header>

            <div v-if="isEditMode && existingSkill" class="existing-skill-card">
              <span>已有 Skill</span>
              <strong>{{ existingSkill.name }}</strong>
              <p>@myclaw/{{ existingSkill.id }} · 当前最新 {{ latestVersionLabel }}</p>
            </div>

            <div v-if="isEditMode && existingSkill" class="version-history-card">
              <div class="version-history-head">
                <span>已有版本</span>
                <strong>{{ existingReleaseSummaries.length }}</strong>
              </div>
              <div v-if="existingReleaseSummaries.length" class="version-list">
                <div v-for="release in existingReleaseSummaries.slice(0, 4)" :key="release.id" class="version-row">
                  <span class="version-chip">v{{ release.version }}</span>
                  <time>{{ new Date(release.createdAt).toLocaleDateString("zh-CN") }}</time>
                </div>
              </div>
              <p v-else>这个 Skill 还没有发布过版本。</p>
            </div>

            <div class="version-input-card">
              <label for="release-version-input">本次发布版本</label>
              <input
                id="release-version-input"
                v-model="releaseVersion"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                placeholder="1.0.0"
              />
              <p :class="{ invalid: releaseVersion && !isReleaseVersionValid }">{{ versionHintText }}</p>
              <small v-if="releaseVersion && !isReleaseVersionValid">请输入 x.y.z 格式，例如 1.0.1。</small>
            </div>

            <div class="meta-change-hint">
              {{ isEditMode ? "已带出当前 Skill 信息，并预填下一个 patch 版本。" : "新 Skill 默认首发版本为 1.0.0。" }}
            </div>

            <div v-if="skillPreview" class="publish-summary">
              <div>
                <span>名称</span>
                <strong>{{ skillPreview.name }}</strong>
              </div>
              <div>
                <span>描述</span>
                <p>{{ skillPreview.summary }}</p>
              </div>
            </div>
            <div v-else class="empty-preview">
              请先上传包含 SKILL.md 的 Skill 包。
            </div>
          </section>

          <div v-if="errorMsg" class="status-msg error">
            {{ errorMsg }}
          </div>

          <div v-if="successMsg" class="status-msg success">
            {{ successMsg }}
          </div>

          <div class="publish-actions-flat">
            <button type="submit" class="submit-btn-nx" :disabled="isPending || !canPublish">
              <span v-if="isPending" class="spinner"></span>
              {{ isPending ? "正在发布..." : (isEditMode ? "发布新版本" : "发布到仓库") }}
            </button>
          </div>
        </aside>
      </form>
    </div>
  </main>
</template>

<style scoped>
.nuxt-publish-web-page { position: relative; min-height: calc(100vh - 64px); background: var(--bg-main); width: 100%; padding-bottom: 80px; }
.publish-container-nx { max-width: 1240px; margin: 0 auto; padding: 40px; }

.publish-header-nx { margin-bottom: 32px; display: flex; flex-direction: column; gap: 16px; }
.back-link-nx { display: inline-flex; align-items: center; gap: 8px; color: var(--text-dim); text-decoration: none; font-weight: 800; font-size: 0.85rem; transition: 0.2s; align-self: flex-start; padding: 6px 12px; background: rgba(255,255,255,0.03); border-radius: 8px; }
.back-link-nx:hover { color: var(--text-main); background: rgba(255,255,255,0.08); }
.back-link-nx svg { width: 16px; height: 16px; }
.title-area h2 { font-size: 2rem; font-weight: 900; color: var(--text-main); letter-spacing: 0; margin: 0 0 4px; }
.title-area .dim { color: var(--text-dim); }
.subtitle { color: var(--text-muted); font-size: 1rem; margin: 0; }

.loading-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 80px 0; color: var(--text-muted); font-size: 1rem; }

.desktop-form-layout { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 28px; align-items: start; }
@media (max-width: 1024px) { .desktop-form-layout { grid-template-columns: 1fr; } }

.layout-main { display: flex; flex-direction: column; gap: 24px; }
.layout-sidebar { display: flex; flex-direction: column; gap: 24px; position: sticky; top: 40px; }

.form-card-nx { padding: 28px; border-radius: 16px; background: var(--bg-main); border: 1px solid var(--border-muted); box-shadow: 0 10px 40px rgba(0,0,0,0.1); }
.section-head { margin-bottom: 22px; padding-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.05); }
.section-head.compact { margin-bottom: 16px; }
.section-head h3 { margin: 0 0 6px; font-size: 1.2rem; font-weight: 900; color: var(--text-main); }
.section-head p { margin: 0; font-size: 0.9rem; color: var(--text-muted); }
.inner-section { display: flex; flex-direction: column; gap: 18px; }

.hidden-file-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.upload-choice-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.upload-choice { min-height: 148px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 10px; padding: 22px; border: 1px dashed var(--border-main); border-radius: 14px; background: rgba(255,255,255,0.02); color: var(--text-main); cursor: pointer; text-align: left; transition: 0.2s; }
.upload-choice:hover { border-color: var(--nuxt-green); background: rgba(var(--nuxt-green-rgb), 0.06); transform: translateY(-1px); }
.upload-choice strong { font-size: 1rem; font-weight: 900; }
.upload-choice span:last-child { color: var(--text-muted); font-size: 0.88rem; }
.choice-icon { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; background: rgba(var(--nuxt-green-rgb), 0.1); color: var(--nuxt-green); }
.choice-icon svg { width: 22px; height: 22px; }

.inline-state { display: flex; align-items: center; gap: 10px; color: var(--text-muted); font-weight: 800; }
.preview-panel { display: flex; flex-direction: column; gap: 18px; padding-top: 6px; }
.preview-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.preview-header h3 { margin: 4px 0 0; color: var(--text-main); font-size: 1.5rem; font-weight: 900; letter-spacing: 0; }
.eyebrow { color: var(--nuxt-green); font-size: 0.76rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.04em; }
.source-pill { padding: 6px 10px; border-radius: 999px; background: rgba(var(--nuxt-green-rgb), 0.1); color: var(--nuxt-green); font-size: 0.78rem; font-weight: 900; }

.metadata-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.metadata-grid div, .description-box, .publish-summary div { border: 1px solid var(--border-muted); border-radius: 12px; padding: 14px; background: rgba(255,255,255,0.02); min-width: 0; }
.metadata-grid span, .description-box span, .publish-summary span { display: block; margin-bottom: 6px; color: var(--text-muted); font-size: 0.76rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.04em; }
.metadata-grid strong, .publish-summary strong { color: var(--text-main); font-size: 0.92rem; word-break: break-word; }
.description-box p, .publish-summary p { margin: 0; color: var(--text-dim); line-height: 1.6; font-size: 0.92rem; }

.markdown-preview-box { border: 1px solid var(--border-muted); border-radius: 12px; overflow: hidden; background: rgba(255,255,255,0.025); }
.markdown-preview-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--border-muted); color: var(--text-dim); font-size: 0.82rem; font-weight: 900; }
.markdown-preview-head code { color: var(--text-muted); font-size: 0.78rem; word-break: break-word; text-align: right; }
.markdown-preview-content { max-height: 460px; overflow: auto; padding: 18px 20px; color: var(--text-main); line-height: 1.7; font-size: 0.95rem; word-wrap: break-word; overflow-wrap: break-word; }
.markdown-preview-content :deep(h1) { font-size: 1.45rem; font-weight: 900; margin: 4px 0 14px; color: var(--text-main); border-bottom: 1px solid var(--border-main); padding-bottom: 8px; }
.markdown-preview-content :deep(h2) { font-size: 1.18rem; font-weight: 850; margin: 20px 0 10px; color: var(--text-main); }
.markdown-preview-content :deep(h3) { font-size: 1.04rem; font-weight: 800; margin: 16px 0 8px; color: var(--text-main); }
.markdown-preview-content :deep(p) { margin: 8px 0; color: var(--text-muted); }
.markdown-preview-content :deep(strong) { color: var(--text-main); font-weight: 800; }
.markdown-preview-content :deep(code) { background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; font-family: "Fira Code", monospace; font-size: 0.88em; color: var(--nuxt-green); }
.markdown-preview-content :deep(pre) { background: rgba(0,0,0,0.22); border: 1px solid var(--border-main); border-radius: 10px; padding: 14px 16px; overflow-x: auto; margin: 12px 0; }
.markdown-preview-content :deep(pre code) { background: none; padding: 0; color: var(--text-main); font-size: 0.88rem; line-height: 1.6; }
.markdown-preview-content :deep(ul), .markdown-preview-content :deep(ol) { padding-left: 22px; margin: 8px 0; }
.markdown-preview-content :deep(li) { margin: 4px 0; color: var(--text-muted); }

.meta-change-hint { font-size: 0.86rem; line-height: 1.55; color: var(--nuxt-green); background: rgba(var(--nuxt-green-rgb), 0.08); border: 1px solid rgba(var(--nuxt-green-rgb), 0.15); border-radius: 10px; padding: 12px 14px; font-weight: 800; }
.existing-skill-card, .version-history-card, .version-input-card { border: 1px solid var(--border-muted); border-radius: 12px; padding: 14px; background: rgba(255,255,255,0.02); }
.existing-skill-card span, .version-history-head span, .version-input-card label { display: block; margin-bottom: 8px; color: var(--text-muted); font-size: 0.76rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.04em; }
.existing-skill-card strong { display: block; color: var(--text-main); font-size: 1rem; font-weight: 900; word-break: break-word; }
.existing-skill-card p, .version-history-card p, .version-input-card p { margin: 6px 0 0; color: var(--text-dim); font-size: 0.86rem; line-height: 1.55; }
.version-history-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.version-history-head strong { color: var(--text-main); font-size: 0.9rem; }
.version-list { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.version-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--text-muted); font-size: 0.84rem; }
.version-chip { display: inline-flex; align-items: center; min-height: 24px; padding: 2px 8px; border-radius: 999px; background: rgba(var(--nuxt-green-rgb), 0.1); color: var(--nuxt-green); font-size: 0.78rem; font-weight: 900; }
.version-input-card input { width: 100%; height: 44px; border: 1px solid var(--border-main); border-radius: 10px; padding: 0 12px; background: rgba(0,0,0,0.12); color: var(--text-main); font-size: 0.96rem; font-weight: 850; outline: none; box-sizing: border-box; }
.version-input-card input:focus { border-color: var(--nuxt-green); box-shadow: 0 0 0 3px rgba(var(--nuxt-green-rgb), 0.12); }
.version-input-card p.invalid, .version-input-card small { color: #ef4444; }
.version-input-card small { display: block; margin-top: 6px; font-size: 0.78rem; font-weight: 800; }
.publish-summary { display: flex; flex-direction: column; gap: 12px; }
.empty-preview { border: 1px dashed var(--border-muted); border-radius: 12px; padding: 18px; color: var(--text-muted); font-size: 0.9rem; font-weight: 800; }

.status-msg { padding: 14px; border-radius: 12px; font-size: 0.875rem; font-weight: 700; display: flex; align-items: center; gap: 8px; }
.status-msg.error { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444; }
.status-msg.success { background: rgba(var(--nuxt-green-rgb), 0.1); border: 1px solid rgba(var(--nuxt-green-rgb), 0.2); color: var(--nuxt-green); }

.publish-actions-flat { padding: 0; }
.submit-btn-nx { width: 100%; min-height: 52px; background: var(--nuxt-green); color: var(--btn-text); border: none; border-radius: 12px; font-weight: 900; font-size: 1.02rem; cursor: pointer; transition: 0.3s; display: flex; align-items: center; justify-content: center; gap: 12px; box-shadow: 0 4px 15px rgba(var(--nuxt-green-rgb), 0.2); letter-spacing: 0; }
.submit-btn-nx:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(var(--nuxt-green-rgb), 0.4); }
.submit-btn-nx:disabled { opacity: 0.5; filter: grayscale(1); cursor: not-allowed; box-shadow: none; transform: none; }
.spinner { width: 18px; height: 18px; border: 3px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 1s linear infinite; }
.spinner.large { width: 32px; height: 32px; border-width: 4px; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 720px) {
  .publish-container-nx { padding: 24px; }
  .upload-choice-grid, .metadata-grid { grid-template-columns: 1fr; }
  .form-card-nx { padding: 22px; }
}
</style>
