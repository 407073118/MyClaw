import type { ChatMessage, ModelProfile } from "@myclaw-desktop/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MYCLAW_MODEL_TOOLS,
  createOpenAiCompatibleReply,
  listAvailableModelIds,
  runModelConversation,
  testModelProfileConnectivity,
} from "./model-provider";

const openAiProfile: ModelProfile = {
  id: "model-openai",
  name: "Default",
  provider: "openai-compatible",
  baseUrl: "https://example.com/v1/",
  apiKey: "sk-test",
  model: "gpt-4.1-mini",
};

const anthropicProfile: ModelProfile = {
  id: "model-anthropic",
  name: "Claude",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com/v1",
  apiKey: "sk-ant-test",
  model: "claude-3-5-sonnet-latest",
};

const qwenProfile: ModelProfile = {
  id: "model-qwen",
  name: "Qwen",
  provider: "openai-compatible",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  apiKey: "sk-qwen-test",
  model: "qwen-max",
};

const minimaxProfile: ModelProfile = {
  id: "model-minimax",
  name: "MiniMax",
  provider: "openai-compatible",
  baseUrl: "https://api.minimaxi.com",
  baseUrlMode: "provider-root",
  apiKey: "sk-minimax-test",
  model: "MiniMax-M1",
};

const minimaxAnthropicProfile: ModelProfile = {
  id: "model-minimax-anthropic",
  name: "MiniMax Anthropic",
  provider: "anthropic",
  baseUrl: "https://api.minimaxi.com",
  baseUrlMode: "provider-root",
  apiKey: "sk-minimax-anthropic-test",
  model: "MiniMax-M2.7",
};

const presetRootOpenAiProfile: ModelProfile = {
  id: "model-openai-root",
  name: "OpenAI Root",
  provider: "openai-compatible",
  baseUrl: "https://api.openai.com",
  baseUrlMode: "provider-root",
  apiKey: "sk-openai-root",
  model: "gpt-4.1-mini",
};

const presetRootAnthropicProfile: ModelProfile = {
  id: "model-anthropic-root",
  name: "Anthropic Root",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com",
  baseUrlMode: "provider-root",
  apiKey: "sk-anthropic-root",
  model: "claude-3-5-sonnet-latest",
};

const messages: ChatMessage[] = [
  {
    id: "msg-user-1",
    role: "user",
    content: "hello",
    createdAt: "2026-03-13T00:00:00.000Z",
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createOpenAiCompatibleReply", () => {
  it("requests non-stream JSON completions and returns assistant content", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "你好，已收到。" } }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const result = await createOpenAiCompatibleReply({ profile: openAiProfile, messages });
    expect(result.content).toBe("你好，已收到。");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestInit = fetchSpy.mock.calls[0]?.[1];
    const body = JSON.parse(String(requestInit?.body)) as { stream?: boolean; tools?: unknown };
    expect(body.stream).toBe(false);
    expect(body.tools).toBeUndefined();
  });

  it("parses SSE responses with ping lines and delta chunks", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        [
          ": ping",
          'data: {"choices":[{"delta":{"content":"你"}}]}',
          'data: {"choices":[{"delta":{"content":"好"}}]}',
          "data: [DONE]",
        ].join("\n"),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      ),
    );

    const result = await createOpenAiCompatibleReply({ profile: openAiProfile, messages });
    expect(result.content).toBe("你好");
  });

  it("parses JSON responses where message.content is a text-part array", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: [{ type: "text", text: "你好，" }, { type: "text", text: "这是数组内容。" }],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const result = await createOpenAiCompatibleReply({ profile: openAiProfile, messages });
    expect(result.content).toBe("你好，这是数组内容。");
  });

  it("parses Responses-style output_text payloads", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          output_text: "这是 output_text 内容。",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const result = await createOpenAiCompatibleReply({ profile: openAiProfile, messages });
    expect(result.content).toBe("这是 output_text 内容。");
  });

  it("parses JSON responses where message.content is an object block", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: {
                  type: "text",
                  text: "Object block content.",
                },
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const result = await createOpenAiCompatibleReply({ profile: openAiProfile, messages });
    expect(result.content).toBe("Object block content.");
  });

  it("parses refusal text when content is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                refusal: "Request was refused.",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const result = await createOpenAiCompatibleReply({ profile: openAiProfile, messages });
    expect(result.content).toBe("Request was refused.");
  });

  it("merges custom request body fields into openai-compatible chat requests", async () => {
    const profile: ModelProfile = {
      ...openAiProfile,
      requestBody: {
        reasoning_effort: "high",
        enable_thinking: true,
      },
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "done" } }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await createOpenAiCompatibleReply({ profile, messages });

    const requestInit = fetchSpy.mock.calls[0]?.[1];
    const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
    expect(body.reasoning_effort).toBe("high");
    expect(body.enable_thinking).toBe(true);
  });

  it("extracts reasoning separately from assistant content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "最终答复",
                reasoning_content: "先扫描项目，再决定是否调用工具。",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const result = await createOpenAiCompatibleReply({ profile: openAiProfile, messages });
    expect(result.content).toBe("最终答复");
    expect(result.reasoning).toBe("先扫描项目，再决定是否调用工具。");
  });

  it("merges custom request body fields into connectivity checks", async () => {
    const profile: ModelProfile = {
      ...openAiProfile,
      requestBody: {
        reasoning_effort: "low",
      },
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await testModelProfileConnectivity({ profile });

    const requestInit = fetchSpy.mock.calls[0]?.[1];
    const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
    expect(body.reasoning_effort).toBe("low");
  });

  it("appends the provider default version path for provider-root OpenAI profiles", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await createOpenAiCompatibleReply({ profile: presetRootOpenAiProfile, messages });

    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe("https://api.openai.com/v1/chat/completions");
  });
});

describe("runModelConversation", () => {
  it("loops OpenAI tool calls and returns final assistant text", async () => {
    const toolHandler = vi.fn().mockResolvedValue({
      content: "README.md content",
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call-1",
                      type: "function",
                      function: {
                        name: "fs_read_file",
                        arguments: JSON.stringify({ path: "README.md" }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "文件已读取完成。" } }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

    const result = await runModelConversation({
      profile: openAiProfile,
      messages,
      onToolCall: toolHandler,
    });

    expect(result.content).toBe("文件已读取完成。");
    expect(toolHandler).toHaveBeenCalledTimes(1);
    expect(toolHandler).toHaveBeenCalledWith({
      id: "call-1",
      name: "fs_read_file",
      input: { path: "README.md" },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as { tools?: unknown[] };
    expect(Array.isArray(firstBody.tools)).toBe(true);
    expect(firstBody.tools?.length).toBeGreaterThan(0);

    const secondBody = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body)) as {
      messages: Array<Record<string, unknown>>;
    };
    const hasToolMessage = secondBody.messages.some(
      (message) => message.role === "tool" && message.tool_call_id === "call-1",
    );
    expect(hasToolMessage).toBe(true);

    const assistantToolCallMessage = secondBody.messages.find(
      (message) => message.role === "assistant" && Array.isArray(message.tool_calls),
    );
    expect(assistantToolCallMessage?.content).toBe("");
  });

  it("streams OpenAI reasoning and tool-call deltas before the final answer", async () => {
    const toolHandler = vi.fn().mockResolvedValue({
      content: "README.md content",
    });
    const seenDeltas: Array<{ content?: string; reasoning?: string }> = [];

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          [
            'data: {"choices":[{"delta":{"reasoning_content":"先读文件。"}}]}',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"fs_read_file","arguments":"{\\"path\\":\\"REA"}}]}}]}',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"DME.md\\"}"}}]}}]}',
            'data: {"choices":[{"finish_reason":"tool_calls"}]}',
            "data: [DONE]",
          ].join("\n"),
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          [
            'data: {"choices":[{"delta":{"content":"已"}}]}',
            'data: {"choices":[{"delta":{"content":"完成。"}}]}',
            'data: {"choices":[{"finish_reason":"stop"}]}',
            "data: [DONE]",
          ].join("\n"),
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      );

    const result = await runModelConversation({
      profile: openAiProfile,
      messages,
      onToolCall: toolHandler,
      onAssistantDelta: async (delta) => {
        seenDeltas.push(delta);
      },
    });

    expect(result.reasoning).toBe("先读文件。");
    expect(result.content).toBe("已完成。");
    expect(toolHandler).toHaveBeenCalledWith({
      id: "call-1",
      name: "fs_read_file",
      input: { path: "README.md" },
    });
    expect(seenDeltas).toEqual([
      { reasoning: "先读文件。" },
      { content: "已" },
      { content: "完成。" },
    ]);

    const firstBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as { stream?: boolean };
    const secondBody = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body)) as { stream?: boolean };
    expect(firstBody.stream).toBe(true);
    expect(secondBody.stream).toBe(true);
  });

  it("disables streaming for Qwen tool-calling rounds", async () => {
    const toolHandler = vi.fn().mockResolvedValue({
      content: "README.md content",
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "",
                  tool_calls: [
                    {
                      id: "call-1",
                      type: "function",
                      function: {
                        name: "fs_read_file",
                        arguments: JSON.stringify({ path: "README.md" }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Qwen tool call completed." } }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

    const result = await runModelConversation({
      profile: qwenProfile,
      messages,
      onToolCall: toolHandler,
    });

    expect(result.content).toBe("Qwen tool call completed.");
    const firstBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as {
      stream?: boolean;
      tool_choice?: unknown;
    };
    const secondBody = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body)) as {
      stream?: boolean;
    };
    expect(firstBody.stream).toBe(false);
    expect(secondBody.stream).toBe(false);
    expect(firstBody.tool_choice).toBeUndefined();
  });

  it("preserves MiniMax reasoning details across streamed tool-calling rounds", async () => {
    const toolHandler = vi.fn().mockResolvedValue({
      content: "README.md content",
    });
    const seenDeltas: Array<{ content?: string; reasoning?: string }> = [];

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          [
            'data: {"choices":[{"delta":{"reasoning_details":[{"type":"text","text":"先规划"}]}}]}',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"fs_read_file","arguments":"{\\"path\\":\\"README.md\\"}"}}]}}]}',
            'data: {"choices":[{"finish_reason":"tool_calls"}]}',
            "data: [DONE]",
          ].join("\n"),
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "MiniMax tool call completed." } }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

    const result = await runModelConversation({
      profile: minimaxProfile,
      messages,
      onToolCall: toolHandler,
      onAssistantDelta: async (delta) => {
        seenDeltas.push(delta);
      },
    });

    expect(result.content).toBe("MiniMax tool call completed.");
    expect(result.reasoning).toBe("先规划");
    expect(seenDeltas).toEqual([
      { reasoning: "先规划" },
      { content: "MiniMax tool call completed." },
    ]);

    const secondBody = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body)) as {
      messages: Array<Record<string, unknown>>;
    };
    const assistantToolMessage = secondBody.messages.find(
      (message) => message.role === "assistant" && Array.isArray(message.tool_calls),
    );
    expect(assistantToolMessage?.content).toBe("");
    expect(assistantToolMessage?.reasoning_details).toEqual([
      {
        type: "text",
        text: "先规划",
      },
    ]);
  });

  it("loops Anthropic tool_use/tool_result and returns final text", async () => {
    const toolHandler = vi.fn().mockResolvedValue({
      content: "dir src\nfile README.md",
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "msg_1",
            type: "message",
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "fs_list_files",
                input: { path: "." },
              },
            ],
            stop_reason: "tool_use",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "msg_2",
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "目录已列出。" }],
            stop_reason: "end_turn",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

    const result = await runModelConversation({
      profile: anthropicProfile,
      messages,
      onToolCall: toolHandler,
    });

    expect(result.content).toBe("目录已列出。");
    expect(toolHandler).toHaveBeenCalledTimes(1);
    expect(toolHandler).toHaveBeenCalledWith({
      id: "toolu_1",
      name: "fs_list_files",
      input: { path: "." },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe("https://api.anthropic.com/v1/messages");

    const firstBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as {
      tool_choice?: { type?: string };
    };
    expect(firstBody.tool_choice).toEqual({ type: "auto" });

    const secondBody = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const hasToolResult = secondBody.messages.some((message) => {
      if (message.role !== "user" || !Array.isArray(message.content)) {
        return false;
      }

      return message.content.some((block) => {
        if (!block || typeof block !== "object") {
          return false;
        }
        const candidate = block as { type?: string; tool_use_id?: string };
        return candidate.type === "tool_result" && candidate.tool_use_id === "toolu_1";
      });
    });

    expect(hasToolResult).toBe(true);
  });

  it("streams Anthropic thinking and tool_use deltas before the final answer", async () => {
    const toolHandler = vi.fn().mockResolvedValue({
      content: "dir src\nfile README.md",
    });
    const seenDeltas: Array<{ content?: string; reasoning?: string }> = [];

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          [
            "event: message_start",
            'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[]}}',
            "",
            "event: content_block_start",
            'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
            "",
            "event: content_block_delta",
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"先看目录。"}}',
            "",
            "event: content_block_stop",
            'data: {"type":"content_block_stop","index":0}',
            "",
            "event: content_block_start",
            'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"fs_list_files","input":{}}}',
            "",
            "event: content_block_delta",
            'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\".\\"}"}}',
            "",
            "event: message_delta",
            'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
            "",
          ].join("\n"),
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          [
            "event: message_start",
            'data: {"type":"message_start","message":{"id":"msg_2","type":"message","role":"assistant","content":[]}}',
            "",
            "event: content_block_start",
            'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
            "",
            "event: content_block_delta",
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"目录已列出。"}}',
            "",
            "event: message_delta",
            'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
            "",
          ].join("\n"),
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      );

    const result = await runModelConversation({
      profile: anthropicProfile,
      messages,
      onToolCall: toolHandler,
      onAssistantDelta: async (delta) => {
        seenDeltas.push(delta);
      },
    });

    expect(result.reasoning).toBe("先看目录。");
    expect(result.content).toBe("目录已列出。");
    expect(toolHandler).toHaveBeenCalledWith({
      id: "toolu_1",
      name: "fs_list_files",
      input: { path: "." },
    });
    expect(seenDeltas).toEqual([
      { reasoning: "先看目录。" },
      { content: "目录已列出。" },
    ]);

    const firstBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as { stream?: boolean };
    const secondBody = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body)) as { stream?: boolean };
    expect(firstBody.stream).toBe(true);
    expect(secondBody.stream).toBe(true);
  });

  it("merges custom request body fields into anthropic requests", async () => {
    const profile: ModelProfile = {
      ...anthropicProfile,
      requestBody: {
        thinking: {
          type: "enabled",
          budget_tokens: 1024,
        },
      },
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_2",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "done" }],
          stop_reason: "end_turn",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await runModelConversation({
      profile,
      messages,
      onToolCall: vi.fn(),
    });

    const requestInit = fetchSpy.mock.calls[0]?.[1];
    const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
    expect(body.thinking).toEqual({
      type: "enabled",
      budget_tokens: 1024,
    });
  });

  it("appends the provider default version path for provider-root Anthropic profiles", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_2",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "done" }],
          stop_reason: "end_turn",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await runModelConversation({
      profile: presetRootAnthropicProfile,
      messages,
      onToolCall: vi.fn(),
    });

    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe("https://api.anthropic.com/v1/messages");
  });

  it("routes MiniMax anthropic provider roots to the official /anthropic/messages endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_2",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "done" }],
          stop_reason: "end_turn",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await runModelConversation({
      profile: minimaxAnthropicProfile,
      messages,
      onToolCall: vi.fn(),
    });

    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe("https://api.minimaxi.com/anthropic/messages");
  });

  it("lists available model ids from OpenAI-compatible providers using the resolved endpoint root", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: "gpt-4.1-mini" },
            { id: "gpt-4.1" },
            { id: "gpt-4.1-mini" },
            { id: "" },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const result = await listAvailableModelIds({ profile: presetRootOpenAiProfile });

    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe("https://api.openai.com/v1/models");
    expect(result.modelIds).toEqual(["gpt-4.1", "gpt-4.1-mini"]);
  });

  it("lists available model ids from MiniMax anthropic roots using the official /anthropic/models endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "MiniMax-M1" }, { id: "MiniMax-M2.7" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const result = await listAvailableModelIds({ profile: minimaxAnthropicProfile });

    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe("https://api.minimaxi.com/anthropic/models");
    expect(result.modelIds).toEqual(["MiniMax-M1", "MiniMax-M2.7"]);
  });

  it("keeps manual custom base urls unchanged when listing available model ids", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "custom-model" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const result = await listAvailableModelIds({
      profile: {
        id: "model-custom-manual",
        name: "Custom Manual",
        provider: "openai-compatible",
        baseUrl: "https://gateway.example.com/openai/v42",
        baseUrlMode: "manual",
        apiKey: "sk-custom",
        model: "",
      },
    });

    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe("https://gateway.example.com/openai/v42/models");
    expect(result.modelIds).toEqual(["custom-model"]);
  });

  it("uses caller supplied tool definitions when provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "custom tools ok" } }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const result = await runModelConversation({
      profile: openAiProfile,
      messages,
      tools: [
        {
          name: "git_status",
          description: "Inspect git status.",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      ],
      onToolCall: vi.fn(),
    });

    expect(result.content).toBe("custom tools ok");
    const requestInit = fetchSpy.mock.calls[0]?.[1];
    const body = JSON.parse(String(requestInit?.body)) as {
      tools?: Array<{ function?: { name?: string } }>;
    };
    expect(body.tools).toHaveLength(1);
    expect(body.tools?.[0]?.function?.name).toBe("git_status");
  });

  it("exposes only builtin tools by default", () => {
    const toolNames = MYCLAW_MODEL_TOOLS.map((tool) => tool.name);
    expect(toolNames).toContain("fs_read_file");
    expect(toolNames).toContain("fs_write_file");
    expect(toolNames).toContain("fs_list_files");
    expect(toolNames).toContain("shell_command");
    expect(toolNames).toContain("run_skill");
    expect(toolNames).toContain("network_request");
  });
});
