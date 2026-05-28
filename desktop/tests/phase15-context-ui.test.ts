/**
 * Phase 15: Context UI data logic tests
 *
 * 由于项目无 jsdom / @testing-library/react 测试基础设施，
 * 本文件测试 UI 层使用的数据转换和格式化逻辑。
 *
 * 测试内容：
 * - formatCapabilitySource returns correct Chinese labels
 * - formatTokenCount formats token numbers readably
 * - buildCapabilitySummary returns expected shape
 * - resolveModelCapability integrates correctly with UI data needs
 */

import { describe, it, expect } from "vitest";

import {
  formatCapabilitySource,
  formatTokenCount,
  buildCapabilitySummary,
  buildContextLimitWarningViewModel,
  type CapabilitySummary,
} from "../src/renderer/utils/context-ui-helpers";

import { resolveModelCapability } from "../src/main/services/model-capability-resolver";
import type { ModelProfile, ModelCapability } from "@shared/contracts";

// ---------------------------------------------------------------------------
// formatCapabilitySource
// ---------------------------------------------------------------------------

describe("formatCapabilitySource", () => {
  it("returns Chinese label for known sources", () => {
    expect(formatCapabilitySource("registry")).toBe("内置注册表");
    expect(formatCapabilitySource("manual-override")).toBe("手动覆盖");
    expect(formatCapabilitySource("provider-catalog")).toBe("服务商目录");
    expect(formatCapabilitySource("default")).toBe("默认值");
  });

  it("returns source string itself for unknown sources", () => {
    expect(formatCapabilitySource("unknown-source" as any)).toBe("unknown-source");
  });
});

// ---------------------------------------------------------------------------
// formatTokenCount
// ---------------------------------------------------------------------------

describe("formatTokenCount", () => {
  it("formats small numbers directly", () => {
    expect(formatTokenCount(1024)).toBe("1,024");
  });

  it("formats large numbers with K suffix", () => {
    expect(formatTokenCount(32768)).toBe("32K");
    expect(formatTokenCount(128000)).toBe("128K");
  });

  it("formats very large numbers with M suffix", () => {
    expect(formatTokenCount(1000000)).toBe("1M");
    expect(formatTokenCount(1047576)).toBe("1M");
  });

  it("handles undefined gracefully", () => {
    expect(formatTokenCount(undefined)).toBe("—");
  });

  it("handles zero", () => {
    expect(formatTokenCount(0)).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// buildCapabilitySummary
// ---------------------------------------------------------------------------

describe("buildCapabilitySummary", () => {
  it("builds summary from resolved capability", () => {
    const profile: ModelProfile = {
      id: "test",
      name: "Test Model",
      provider: "openai-compatible",
      baseUrl: "https://api.openai.com",
      apiKey: "test",
      model: "gpt-4o",
    };

    const resolved = resolveModelCapability(profile);
    const summary = buildCapabilitySummary(resolved.effective);

    expect(summary.contextWindow).toBeTruthy();
    expect(summary.maxInput).toBeTruthy();
    expect(summary.maxOutput).toBeTruthy();
    expect(summary.source).toBeTruthy();
    expect(summary.features).toBeDefined();
  });

  it("marks feature support correctly", () => {
    const capability: ModelCapability = {
      contextWindowTokens: 128000,
      maxInputTokens: 120000,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: false,
      source: "registry",
    };
    const summary = buildCapabilitySummary(capability);
    expect(summary.features.tools).toBe(true);
    expect(summary.features.streaming).toBe(true);
    expect(summary.features.vision).toBe(false);
  });

  it("handles minimal capability", () => {
    const capability: ModelCapability = { source: "default" };
    const summary = buildCapabilitySummary(capability);
    expect(summary.contextWindow).toBe("—");
    expect(summary.source).toBe("默认值");
  });
});

// ---------------------------------------------------------------------------
// Context limit warning
// ---------------------------------------------------------------------------

describe("buildContextLimitWarningViewModel", () => {
  it("builds explainable warning copy from compaction metadata", () => {
    const viewModel = buildContextLimitWarningViewModel({
      sessionId: "session-1",
      compactionCount: 3,
      removedCount: 12,
      maskedToolOutputCount: 4,
      compactionReason: "移除 12 条陈旧消息",
      checkpointId: "checkpoint-1",
      checkpointCreatedAt: "2026-05-23T00:00:00.000Z",
      checkpointPreview: "当前目标：实现 Context Compiler；下一步：接入 UI。",
    });

    expect(viewModel.primaryText).toContain("已压缩 3 次");
    expect(viewModel.detailItems).toEqual(expect.arrayContaining([
      "原因：移除 12 条陈旧消息",
      "已移除 12 条历史消息",
      "已折叠 4 条旧工具输出",
      "保留状态：checkpoint-1",
    ]));
    expect(viewModel.checkpointPreview).toContain("实现 Context Compiler");
  });
});
