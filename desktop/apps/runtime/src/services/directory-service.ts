import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

function isPathInsideRoot(root: string, target: string): boolean {
  const normalizedRoot = normalizeSeparators(resolve(root)).toLowerCase();
  const normalizedTarget = normalizeSeparators(resolve(target)).toLowerCase();
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
}

function ensurePathInsideRoot(root: string, target: string): void {
  if (!isPathInsideRoot(root, target)) {
    throw new Error("路径越界：仅允许访问工作区目录内文件。");
  }
}

export class DirectoryService {
  constructor(private readonly workspaceRoot: string) {}

  /** 返回运行时允许访问的工作区根目录。 */
  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  /** 根据会话附加目录计算当前文件操作的根目录。 */
  getAttachedDirectory(attachedDirectory: string | null, allowUnrestricted = false): string {
    const root = attachedDirectory ? resolve(attachedDirectory) : resolve(this.workspaceRoot);
    if (!allowUnrestricted) {
      ensurePathInsideRoot(this.workspaceRoot, root);
    }
    return root;
  }

  /** 将用户输入路径解析为受根目录约束的绝对路径。 */
  resolvePath(targetPath: string, attachedDirectory: string | null = null, allowUnrestricted = false): string {
    const base = this.getAttachedDirectory(attachedDirectory, allowUnrestricted);
    const resolved = resolve(base, targetPath);
    if (!allowUnrestricted) {
      ensurePathInsideRoot(base, resolved);
    }
    return resolved;
  }

  /** 检查路径是否位于工作区内（不抛出异常）。 */
  isPathInsideWorkspace(targetPath: string, attachedDirectory: string | null = null): boolean {
    try {
      const base = this.getAttachedDirectory(attachedDirectory);
      const resolved = resolve(base, targetPath);
      return isPathInsideRoot(base, resolved);
    } catch {
      return false;
    }
  }

  /** 解析绝对路径，无工作区限制（仅用于用户已授权的外部路径访问）。 */
  resolveUnrestricted(targetPath: string): string {
    return resolve(targetPath);
  }

  /** 读取文本文件，并在超长时做安全截断。 */
  async readTextFile(
    targetPath: string,
    attachedDirectory: string | null = null,
    maxChars = 12000,
    allowUnrestricted = false,
  ): Promise<string> {
    const resolved = this.resolvePath(targetPath, attachedDirectory, allowUnrestricted);
    const content = await readFile(resolved, "utf8");
    if (content.length <= maxChars) {
      return content;
    }

    return `${content.slice(0, maxChars)}\n\n...（内容已截断）`;
  }

  /** 写入文本文件，必要时自动创建父目录。 */
  async writeTextFile(
    targetPath: string,
    content: string,
    attachedDirectory: string | null = null,
  ): Promise<void> {
    const resolved = this.resolvePath(targetPath, attachedDirectory);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, "utf8");
  }

  /** 在受根目录约束的范围内移动文件或目录，并按需创建目标父目录。 */
  async movePath(
    sourcePath: string,
    destinationPath: string,
    attachedDirectory: string | null = null,
  ): Promise<void> {
    const sourceResolved = this.resolvePath(sourcePath, attachedDirectory);
    const destinationResolved = this.resolvePath(destinationPath, attachedDirectory);
    await mkdir(dirname(destinationResolved), { recursive: true });
    await rename(sourceResolved, destinationResolved);
  }

  /** 删除受根目录约束的文件或目录。 */
  async deletePath(targetPath: string, attachedDirectory: string | null = null): Promise<void> {
    const resolved = this.resolvePath(targetPath, attachedDirectory);
    await rm(resolved, { recursive: true, force: true });
  }

  /** 列出目录项，并以稳定顺序返回。 */
  async listDirectory(targetPath = ".", attachedDirectory: string | null = null, allowUnrestricted = false): Promise<string[]> {
    const resolved = this.resolvePath(targetPath, attachedDirectory, allowUnrestricted);
    const entries = await readdir(resolved, { withFileTypes: true });
    return entries
      .map((entry) => `${entry.isDirectory() ? "dir" : "file"} ${entry.name}`)
      .sort((a, b) => a.localeCompare(b));
  }

  /** 返回文件或目录的基础元信息。 */
  async statPath(targetPath: string, attachedDirectory: string | null = null, allowUnrestricted = false): Promise<string> {
    const resolved = this.resolvePath(targetPath, attachedDirectory, allowUnrestricted);
    const metadata = await stat(resolved);
    const type = metadata.isDirectory() ? "dir" : "file";

    return [
      `path ${targetPath}`,
      `type ${type}`,
      `size ${metadata.size}`,
      `mtime ${metadata.mtime.toISOString()}`,
    ].join("\n");
  }

  /** 按 glob 模式查找文件路径，返回匹配的相对路径列表。 */
  async findFiles(
    pattern: string,
    targetPath = ".",
    attachedDirectory: string | null = null,
    maxResults = 200,
    allowUnrestricted = false,
  ): Promise<string[]> {
    const base = this.resolvePath(targetPath, attachedDirectory, allowUnrestricted);
    const root = this.getAttachedDirectory(attachedDirectory, allowUnrestricted);
    const matches: string[] = [];

    const parts = pattern.replace(/\\/g, "/").split("/").filter(Boolean);

    const matchSegment = (segment: string, patternPart: string): boolean => {
      const regex = new RegExp(
        "^" +
          patternPart
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*")
            .replace(/\?/g, ".") +
          "$",
      );
      return regex.test(segment);
    };

    const matchPath = (relPath: string): boolean => {
      const segments = relPath.replace(/\\/g, "/").split("/");
      if (pattern.includes("**")) {
        const regex = new RegExp(
          "^" +
            pattern
              .replace(/\\/g, "/")
              .replace(/[.+^${}()|[\]\\]/g, "\\$&")
              .replace(/\*\*/g, "<<GLOBSTAR>>")
              .replace(/\*/g, "[^/]*")
              .replace(/\?/g, "[^/]")
              .replace(/<<GLOBSTAR>>/g, ".*") +
            "$",
        );
        return regex.test(relPath.replace(/\\/g, "/"));
      }
      if (parts.length !== segments.length) {
        return parts.length === 1 && matchSegment(segments[segments.length - 1], parts[0]);
      }
      return parts.every((part, i) => matchSegment(segments[i], part));
    };

    const visit = async (currentPath: string): Promise<void> => {
      if (matches.length >= maxResults) return;
      const entries = await readdir(currentPath, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (matches.length >= maxResults) break;
        const fullPath = join(currentPath, entry.name);
        const relPath = normalizeSeparators(relative(root, fullPath));
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".git") continue;
          await visit(fullPath);
        } else if (matchPath(relPath)) {
          matches.push(relPath);
        }
      }
    };

    await visit(base);
    return matches;
  }

  /** 在指定目录树内搜索文本内容，返回命中的相对路径与行号。 */
  async searchText(
    pattern: string,
    targetPath = ".",
    attachedDirectory: string | null = null,
    maxResults = 100,
    allowUnrestricted = false,
  ): Promise<string[]> {
    const base = this.resolvePath(targetPath, attachedDirectory, allowUnrestricted);
    const root = this.getAttachedDirectory(attachedDirectory, allowUnrestricted);
    const matches: string[] = [];

    const visit = async (currentPath: string): Promise<void> => {
      if (matches.length >= maxResults) {
        return;
      }

      const metadata = await stat(currentPath);
      if (metadata.isDirectory()) {
        const entries = await readdir(currentPath, { withFileTypes: true });
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
          await visit(resolve(currentPath, entry.name));
          if (matches.length >= maxResults) {
            break;
          }
        }
        return;
      }

      const content = await readFile(currentPath, "utf8");
      const lines = content.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (matches.length >= maxResults) {
          return;
        }
        if (line.includes(pattern)) {
          const relativePath = normalizeSeparators(relative(root, currentPath));
          matches.push(`${relativePath}:${index + 1}: ${line.trim()}`);
        }
      });
    };

    await visit(base);
    return matches;
  }
}
