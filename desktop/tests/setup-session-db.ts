/**
 * Vitest setup：确保每个测试文件运行后关闭 SessionDatabase 单例，
 * 防止 Windows 文件锁导致 temp 目录清理失败。
 */
import { afterEach } from "vitest";
import { resetSessionDatabase } from "../src/main/services/state-persistence";

afterEach(() => {
  resetSessionDatabase();
});
