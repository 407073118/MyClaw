import { describe, it, expect } from "vitest";
import {
  extractPaths,
  wslToWindows,
  windowsToWsl,
  fromFileUri,
} from "../shared/utils/path-extractor";

describe("extractPaths", () => {
  it("Windows 绝对路径（含中文）", () => {
    const paths = extractPaths("帮我读一下 F:\\面试录音\\百融测试工单交付流程.xlsx");
    expect(paths.some((p) => p.includes("面试录音"))).toBe(true);
  });

  it("引号内带空格的 Windows 路径", () => {
    const paths = extractPaths(`读取 "C:\\Users\\me\\My Documents\\notes.txt"`);
    expect(paths.some((p) => p.includes("My Documents"))).toBe(true);
  });

  it("POSIX 绝对路径", () => {
    const paths = extractPaths("check /home/user/data/report.json first");
    expect(paths.some((p) => p === "/home/user/data/report.json")).toBe(true);
  });

  it("WSL 路径同时登记 Windows 等价", () => {
    const paths = extractPaths("see /mnt/f/docs/x.md");
    expect(paths.some((p) => p.startsWith("/mnt/f/"))).toBe(true);
    expect(paths.some((p) => p.startsWith("F:"))).toBe(true);
  });

  it("file:// URI", () => {
    const paths = extractPaths("open file:///C:/temp/foo.log");
    expect(paths.some((p) => p.includes("C:") && p.includes("foo.log"))).toBe(true);
  });

  it("UNC 路径", () => {
    const paths = extractPaths("fetch from \\\\server\\share\\file.csv");
    expect(paths.some((p) => p.startsWith("\\\\"))).toBe(true);
  });

  it("不误扫 URL", () => {
    const paths = extractPaths("visit https://github.com/foo/bar");
    expect(paths).toHaveLength(0);
  });

  it("不误扫日期 2026/04/21", () => {
    const paths = extractPaths("meeting on 2026/04/21 at /home/u/notes.md");
    expect(paths).toContain("/home/u/notes.md");
    expect(paths.every((p) => !p.startsWith("/2026"))).toBe(true);
  });
});

describe("WSL↔Win 等价转换", () => {
  it("wslToWindows", () => {
    expect(wslToWindows("/mnt/f/foo/bar.txt")).toBe("F:\\foo\\bar.txt");
    expect(wslToWindows("/mnt/c")).toBe("C:\\");
    expect(wslToWindows("/home/u")).toBe(null);
  });

  it("windowsToWsl", () => {
    expect(windowsToWsl("F:\\foo\\bar.txt")).toBe("/mnt/f/foo/bar.txt");
    expect(windowsToWsl("C:\\")).toBe("/mnt/c");
    expect(windowsToWsl("/home/u")).toBe(null);
  });
});

describe("fromFileUri", () => {
  it("file:///C:/path → Windows", () => {
    expect(fromFileUri("file:///C:/Users/me/x.txt")).toBe("C:\\Users\\me\\x.txt");
  });
  it("file:///home/u → POSIX", () => {
    expect(fromFileUri("file:///home/u/x.txt")).toBe("/home/u/x.txt");
  });
});
