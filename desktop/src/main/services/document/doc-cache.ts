import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DocumentIR } from "@shared/contracts";
import { createLogger } from "../logger";

const log = createLogger("doc-cache");

/** LRU 默认上限 — CONTEXT.md §4 约定为 500MB。 */
export const DEFAULT_CACHE_MAX_BYTES = 500 * 1024 * 1024;

/** 单个缓存条目的元信息 — 由 enforceLru 用 lastAccess 做 LRU 判定。 */
export type DocCacheMeta = {
  sha256: string;
  cachedAt: string; // ISO8601
  lastAccess: string; // ISO8601
  hits: number;
  bytes: number; // 条目目录（ir.json + media/ + meta.json）的累计字节数
};

export type DocCacheOptions = {
  /** 根目录；缓存实际条目落在 <rootDir>/docCache/<sha>/ 下。 */
  rootDir: string;
  /** LRU 字节上限；默认 500MB。 */
  maxBytes?: number;
};

export type DocCache = {
  getRoot(): string;
  entryDir(sha256: string): string;
  mediaDir(sha256: string): string;
  getOrBuild(
    sha256: string,
    builder: (mediaDir: string) => Promise<DocumentIR>,
  ): Promise<DocumentIR>;
  clear(): Promise<void>;
  enforceLru(): Promise<void>;
};

/** 计算 buffer 的 sha256 十六进制摘要（小写）。 */
export function sha256OfBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** 判断错误是否属于 ENOENT（缺失视为 miss）。 */
function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * 递归统计目录字节数；缺失目录返回 0，只供缓存 meta 汇总使用。
 * 不使用 `fs.stat.size` 对目录本身 —— 目录 entry 的 size 在不同平台并不稳定。
 */
async function recursiveSize(dir: string): Promise<number> {
  let total = 0;
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isEnoent(err)) return 0;
    throw err;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await recursiveSize(full);
    } else if (entry.isFile()) {
      try {
        const s = await stat(full);
        total += s.size;
      } catch (err) {
        if (!isEnoent(err)) throw err;
      }
    }
  }
  return total;
}

/** 尝试读取 meta.json；解析失败/缺失返回 null（上层作 miss 处理）。 */
async function readMeta(metaPath: string): Promise<DocCacheMeta | null> {
  try {
    const raw = await readFile(metaPath, "utf-8");
    const parsed = JSON.parse(raw) as DocCacheMeta;
    if (typeof parsed?.sha256 !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 尝试读取并解析 ir.json；解析失败返回 null，由上层视作 miss 并重建。 */
async function readIr(irPath: string): Promise<DocumentIR | null> {
  try {
    const raw = await readFile(irPath, "utf-8");
    return JSON.parse(raw) as DocumentIR;
  } catch {
    return null;
  }
}

/**
 * 工厂：将 rootDir 与 maxBytes 闭包住，避免上层每次都显式传配置。
 * 所有磁盘路径都派生自 <rootDir>/docCache/<sha>/。
 */
export function createDocCache(opts: DocCacheOptions): DocCache {
  const root = join(opts.rootDir, "docCache");
  const maxBytes = opts.maxBytes ?? DEFAULT_CACHE_MAX_BYTES;

  const entryDir = (sha: string): string => join(root, sha);
  const mediaDir = (sha: string): string => join(entryDir(sha), "media");
  const irPath = (sha: string): string => join(entryDir(sha), "ir.json");
  const metaPath = (sha: string): string => join(entryDir(sha), "meta.json");

  async function writeMeta(sha: string, meta: DocCacheMeta): Promise<void> {
    await writeFile(metaPath(sha), JSON.stringify(meta, null, 2), "utf-8");
  }

  async function enforceLru(): Promise<void> {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (err) {
      if (isEnoent(err)) return;
      throw err;
    }

    const metas: Array<{ sha: string; meta: DocCacheMeta }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = await readMeta(metaPath(entry.name));
      if (!meta) continue;
      metas.push({ sha: entry.name, meta });
    }

    const total = metas.reduce((acc, m) => acc + m.meta.bytes, 0);
    if (total <= maxBytes) return;

    // 按 lastAccess 升序，先淘汰最久未用。
    metas.sort(
      (a, b) =>
        new Date(a.meta.lastAccess).getTime() - new Date(b.meta.lastAccess).getTime(),
    );

    let remaining = total;
    for (const { sha, meta } of metas) {
      if (remaining <= maxBytes) break;
      try {
        await rm(entryDir(sha), { recursive: true, force: true });
        remaining -= meta.bytes;
        log.info("LRU evicted entry", {
          sha256: sha,
          bytes: meta.bytes,
          lastAccess: meta.lastAccess,
        });
      } catch (err) {
        log.warn("LRU eviction failed", {
          sha256: sha,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  async function getOrBuild(
    sha: string,
    builder: (mediaDir: string) => Promise<DocumentIR>,
  ): Promise<DocumentIR> {
    // 1) 先尝试 hit：ir.json + meta.json 都存在且合法。
    const existingIr = await readIr(irPath(sha));
    if (existingIr) {
      const existingMeta = await readMeta(metaPath(sha));
      if (existingMeta) {
        const nextMeta: DocCacheMeta = {
          ...existingMeta,
          hits: existingMeta.hits + 1,
          lastAccess: new Date().toISOString(),
        };
        try {
          await writeMeta(sha, nextMeta);
        } catch (err) {
          log.warn("failed to update meta on hit", {
            sha256: sha,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        log.info("hit", { sha256: sha, hits: nextMeta.hits });
        return existingIr;
      }
      // meta 坏了但 ir 还在 —— 当 miss 处理，重建覆盖。
      log.warn("ir present but meta missing/corrupt; rebuilding", { sha256: sha });
    }

    // 2) miss：确保目录存在，调用 builder 生成 IR。
    const dir = entryDir(sha);
    const media = mediaDir(sha);
    await mkdir(media, { recursive: true });

    const ir = await builder(media);

    await writeFile(irPath(sha), JSON.stringify(ir, null, 2), "utf-8");
    const bytes = await recursiveSize(dir);
    const now = new Date().toISOString();
    const meta: DocCacheMeta = {
      sha256: sha,
      cachedAt: now,
      lastAccess: now,
      hits: 0,
      bytes,
    };
    await writeMeta(sha, meta);
    log.info("miss -> built", { sha256: sha, bytes });

    // 3) 尽力执行 LRU；失败只记日志不抛，避免干扰正常读路径。
    try {
      await enforceLru();
    } catch (err) {
      log.warn("enforceLru after build failed", {
        sha256: sha,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return ir;
  }

  async function clear(): Promise<void> {
    await rm(root, { recursive: true, force: true });
  }

  return {
    getRoot: () => root,
    entryDir,
    mediaDir,
    getOrBuild,
    clear,
    enforceLru,
  };
}
