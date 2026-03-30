<template>
  <section class="chat-shell">
    <section class="chat-main">
      <header class="chat-title-header">
        <div class="header-left">
          <div class="session-dropdown-container">
            <button class="session-dropdown-trigger" aria-haspopup="listbox">
              <h1 class="header-title">{{ session?.title ?? "暂无会话" }}</h1>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></svg>
            </button>

            <div class="session-dropdown-menu">
              <div class="dropdown-header">历史记录</div>
              <ul data-testid="session-list" class="session-list session-list-dropdown">
                <li v-for="item in workspace.sessions" :key="item.id">
                  <div :class="['session-row', { active: item.id === session?.id }]">
                    <button
                      :data-testid="`session-item-${item.id}`"
                      :class="['session-item', { active: item.id === session?.id }]"
                      @click="workspace.selectSession(item.id)"
                    >
                      <div class="session-info">
                        <strong>{{ item.title }}</strong>
                        <span>{{ previewMessage(item) }}</span>
                      </div>
                    </button>
                    <button
                      :data-testid="`session-delete-${item.id}`"
                      class="session-delete"
                      :disabled="isDeletingSession(item.id)"
                      @click="handleDeleteSession(item.id)"
                      title="删除会话"
                    >
                      <template v-if="isDeletingSession(item.id)">
                        <span class="loading-dots">...</span>
                      </template>
                      <svg v-else viewBox="0 0 24 24" width="14" height="14">
                        <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                      </svg>
                    </button>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div class="header-right">
          <button
            data-testid="new-chat-button"
            class="primary new-chat-btn"
            :disabled="creatingSession"
            @click="createSession"
            title="新建对话"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
            <span>新对话</span>
          </button>
        </div>
      </header>

      <section class="timeline-panel" ref="timelinePanelRef">
        <div class="timeline">
          <template v-for="(message, index) in groupedMessages" :key="message.id">
            <!-- Normal Message -->
            <div
              v-if="!message.isTechnicalGroup"
              :class="['message-row', `role-${message.role}`]"
            >
              <div class="message-avatar">
                <svg v-if="message.role === 'user'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <svg v-else-if="message.role === 'assistant'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"/></svg>
                <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 9l3 3-3 3m5 0h3M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/></svg>
              </div>
              
              <div class="message-body">
                <div class="message-header">{{ roleLabel(message.role) }}</div>
                
                <details
                  v-if="message.role === 'assistant' && message.reasoning"
                  :data-testid="`reasoning-${message.id}`"
                  class="message-details"
                >
                  <summary class="details-summary">
                    <div class="summary-inner">
                      <span class="pulse-dot active"></span>
                      <strong>思考过程</strong>
                    </div>
                  </summary>
                  <div class="details-content reasoning-content" v-html="renderMarkdown(message.reasoning)"></div>
                </details>

                <div v-if="message.content" class="message-content" v-html="renderMarkdown(message.content)"></div>
                
                <article v-if="message.uiSubmitResult" class="form-submission-summary">
                  <div class="summary-header">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>
                    <span>已提交表单</span>
                  </div>
                  <div class="summary-body">
                    <div v-for="(pair, idx) in message.uiSubmitResult.pairs.split('; ')" :key="idx" class="summary-pair">
                      <span class="pair-key">{{ pair.split('=')[0] }}:</span>
                      <span class="pair-val">{{ pair.split('=')[1] }}</span>
                    </div>
                  </div>
                </article>
                
                <article
                  v-if="shouldRenderInlineA2UiForm(message.ui)"
                  :data-testid="`ui-form-${message.id}`"
                  :class="['message-form', { 'form-submitted': submittedFormIds.includes(message.id) }]"
                >
                  <div class="message-form-header">
                     <svg class="form-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                     <div class="form-title-group">
                       <h3 class="message-form-title">{{ message.ui.title }}</h3>
                       <p v-if="message.ui.description" class="message-form-description">{{ message.ui.description }}</p>
                     </div>
                  </div>

                  <fieldset :disabled="submittedFormIds.includes(message.id) || sending" class="message-form-fieldset">
                    <div class="message-form-fields">
                      <label
                        v-for="field in message.ui.fields"
                        :key="`${message.id}-${field.name}`"
                        class="message-form-field"
                      >
                        <span>
                          {{ field.label }}
                          <em v-if="field.required" class="required-mark">*</em>
                        </span>

                        <select
                          v-if="field.input === 'select'"
                          :data-testid="`ui-field-${message.id}-${field.name}`"
                          :value="readFormFieldValue(message.id, field.name)"
                          @change="handleSelectFieldChange(message.id, field.name, $event)"
                        >
                          <option value="">请选择</option>
                          <option
                            v-for="option in field.options ?? []"
                            :key="`${message.id}-${field.name}-${option.value}`"
                            :value="option.value"
                          >
                            {{ option.label }}
                          </option>
                        </select>

                        <textarea
                          v-else-if="field.input === 'textarea'"
                          :data-testid="`ui-field-${message.id}-${field.name}`"
                          :placeholder="field.placeholder ?? ''"
                          :value="readFormFieldValue(message.id, field.name)"
                          rows="3"
                          @input="handleTextFieldInput(message.id, field.name, $event)"
                        />

                        <input
                          v-else
                          :data-testid="`ui-field-${message.id}-${field.name}`"
                          :placeholder="field.placeholder ?? ''"
                          :value="readFormFieldValue(message.id, field.name)"
                          @input="handleTextFieldInput(message.id, field.name, $event)"
                        />
                      </label>
                    </div>

                    <div v-if="formErrors[message.id]" class="form-inline-error">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      {{ formErrors[message.id] }}
                    </div>

                    <div class="message-form-footer">
                      <button
                        v-if="!submittedFormIds.includes(message.id)"
                        :data-testid="`ui-submit-${message.id}`"
                        class="primary form-submit-btn"
                        @click="submitA2UiForm(message)"
                      >
                        {{ sending ? '提交中...' : (message.ui.submitLabel ?? "提交表单") }}
                      </button>
                      <div v-else class="form-success-badge">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>
                        已提交
                      </div>
                    </div>
                  </fieldset>
                </article>
              </div>
            </div>

            <!-- Technical Chain Group -->
            <div v-else class="message-row role-tool">
              <div class="message-avatar">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 9l3 3-3 3m5 0h3M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/></svg>
              </div>
              <div
                class="message-body"
                :data-testid="`execution-chain-group-${(message as any).items[0]?.id ?? message.id}`"
              >
                <div class="message-header">工具与系统</div>
                <div class="execution-chain-summary">
                  <span class="pulse-dot active"></span>
                  <span>执行链路 ({{ (message as any).items.length }} 步)</span>
                </div>
                <ol class="execution-chain-list">
                  <li
                    v-for="item in (message as any).items"
                    :key="item.id"
                    :data-testid="`execution-chain-step-${item.id}`"
                    :class="['execution-chain-step', `execution-chain-step--${item.role}`]"
                  >
                    <span class="execution-chain-badge">{{ executionChainBadge(item) }}</span>
                    <div class="execution-chain-main">
                      <span v-if="item.role !== 'tool'" class="execution-chain-text">{{ executionChainSummary(item) }}</span>
                      <details v-else class="execution-chain-output">
                        <summary class="execution-chain-output-summary">{{ executionChainSummary(item) }}</summary>
                        <div class="execution-chain-output-body">
                          <ToolLogContent
                            :message-id="item.id"
                            :content="item.content"
                          />
                        </div>
                      </details>
                    </div>
                  </li>
                </ol>
              </div>
            </div>
          </template>

          <div v-if="isAwaitingModelResponse" class="message-row role-assistant">
            <div class="message-avatar pending-avatar">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"/></svg>
            </div>
            <div class="message-body">
              <div class="message-header">助手</div>
              <div class="typing-dots">
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>

          <div
            v-for="approval in sessionApprovalRequests"
            :key="approval.id"
            class="message-row role-system"
          >
            <div class="message-avatar">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#eab308" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
            </div>
            <div class="message-body">
              <div class="message-header">需要审批</div>
              <article class="approval-card" :data-testid="`approval-card-${approval.id}`">
                <h3>是否允许执行 {{ approval.label }}？</h3>
                <p>{{ approval.detail }}</p>
                <div v-if="isResolvingApproval(approval.id)" class="approval-loading">
                  <div class="typing-dots"><span></span><span></span><span></span></div>
                  <span>正在提交审批并继续执行...</span>
                </div>
                <div v-else class="approval-actions">
                  <button
                    data-testid="approval-action-deny"
                    class="secondary"
                    @click="handleApproval(approval.id, 'deny')"
                  >
                    拒绝
                  </button>
                  <button
                    data-testid="approval-action-allow-once"
                    class="secondary"
                    @click="handleApproval(approval.id, 'allow-once')"
                  >
                    允许一次
                  </button>
                  <button
                    data-testid="approval-action-allow-session"
                    class="secondary"
                    @click="handleApproval(approval.id, 'allow-session')"
                  >
                    允许本次运行
                  </button>
                  <button
                    data-testid="approval-action-always-allow-tool"
                    class="primary"
                    @click="handleApproval(approval.id, 'always-allow-tool')"
                  >
                    始终允许此工具
                  </button>
                </div>
              </article>
            </div>
          </div>
        </div>
      </section>

      <!-- Modal removed directly in favor of inline approval -->

      <footer class="composer-panel">
        <div class="composer-container">
          <textarea
            data-testid="composer-input"
            v-model="composerDraft"
            class="composer-input"
            :placeholder="sending ? '正在响应...' : '输入消息 (Enter 发送, Shift+Enter 换行)，或输入 / 获取快捷命令'"
            :disabled="sending"
            rows="1"
            @keydown.enter.exact.prevent="submitMessage"
          />
          <div class="composer-toolbar">
            <span class="composer-hints" v-if="!composerDraft">可用命令: /skill, /cmd, /read, /mcp</span>
            <span class="composer-hints" v-else></span>
            <button
              v-if="!sending"
              data-testid="composer-submit"
              class="primary icon-btn submit-btn"
              :disabled="!composerDraft.trim() || !session"
              @click="submitMessage"
              title="发送消息"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
              </svg>
            </button>
            <button
              v-else
              data-testid="composer-stop"
              class="primary icon-btn stop-btn"
              disabled
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </svg>
            </button>
          </div>
        </div>
      </footer>
    </section>
  </section>
</template>

<script setup lang="ts">
import { ToolRiskCategory } from "@myclaw-desktop/shared";
import type {
  A2UiForm,
  A2UiPayload,
  A2UiFormField,
  ApprovalDecision,
  ChatMessage,
  ChatSession,
  ExecutionIntent,
} from "@myclaw-desktop/shared";
import { marked } from "marked";
import { computed, ref, nextTick, watch, onMounted } from "vue";

import ToolLogContent from "@/components/ToolLogContent.vue";
import { useWorkspaceStore } from "@/stores/workspace";

// Configure marked for safe rendering
marked.setOptions({
  gfm: true,
  breaks: true,
});

function renderMarkdown(content: string) {
  if (!content) return "";
  try {
    return marked.parse(content);
  } catch (e) {
    return content;
  }
}

const workspace = useWorkspaceStore();
const composerDraft = ref("");
const sending = ref(false);
const creatingSession = ref(false);
const deletingSessionIds = ref<string[]>([]);
const resolvingApprovalIds = ref<string[]>([]);
const formDrafts = ref<Record<string, Record<string, string>>>({});
const timelinePanelRef = ref<HTMLElement | null>(null);
const submittedFormIds = ref<string[]>([]);
const formErrors = ref<Record<string, string>>({});

const session = computed(() => workspace.currentSession);
const parsedMessages = computed(() => {
  const s = session.value;
  if (!s) return [];
  
  return s.messages.map((msg) => {
    if (!msg || typeof msg.content !== "string") return msg;

    const a2uiSubmitMatch = msg.content.match(/^\[A2UI_FORM:([a-zA-Z0-9_-]+)\]\s*(.*)$/);
    if (a2uiSubmitMatch && msg.role === "user") {
       return {
         ...msg,
         content: "",
         uiSubmitResult: {
           id: a2uiSubmitMatch[1],
           pairs: a2uiSubmitMatch[2]
         }
       };
    }

    const a2uiMatch = msg.content.match(/```a2ui\s*([\s\S]*?)\s*```/);
    if (!a2uiMatch) return msg;

    try {
      const parsed = JSON.parse(a2uiMatch[1]);
      const replacedContent = msg.content.replace(a2uiMatch[0], "").trim();
      
      let finalUi = msg.ui;
      if (!finalUi && parsed.ui) {
         finalUi = { ...parsed.ui, id: parsed.ui.id || msg.id };
      }
      
      return {
        ...msg,
        content: replacedContent || parsed.text || "",
        ui: finalUi,
      };
    } catch (e) {
      return msg;
    }
  });
});

const groupedMessages = computed(() => {
  const messages = parsedMessages.value;
  const result: any[] = [];
  let currentGroup: any = null;

  for (const message of messages) {
    const isTechnical = message.role === "system" || message.role === "tool";

    if (isTechnical) {
      if (!currentGroup) {
        currentGroup = {
          id: "group-" + message.id,
          role: "technical",
          isTechnicalGroup: true,
          items: [],
        };
        result.push(currentGroup);
      }
      currentGroup.items.push(message);
    } else {
      currentGroup = null;
      result.push({
        ...message,
        isTechnicalGroup: false,
      });
    }
  }

  return result;
});

const sessionApprovalRequests = computed(() => {
  const s = session.value;
  if (!s || workspace.approvals?.mode !== "prompt") {
    return [];
  }

  return workspace.approvalRequests.filter((item) => item.sessionId === s.id);
});

const isAwaitingModelResponse = computed(() => {
  if (!sending.value) return false;
  const msgs = session.value?.messages;
  if (!msgs || msgs.length === 0) return true;
  const lastMsg = msgs[msgs.length - 1];
  if (lastMsg.role === "assistant") {
    return !lastMsg.content?.trim() && !lastMsg.reasoning?.trim();
  }
  return lastMsg.role === "user" || lastMsg.role === "system";
});

function scrollToBottom(behavior: ScrollBehavior = "smooth") {
  nextTick(() => {
    const el = timelinePanelRef.value;
    if (el) {
      if (typeof el.scrollTo === "function") {
        el.scrollTo({
          top: el.scrollHeight,
          behavior,
        });
      } else {
        el.scrollTop = el.scrollHeight;
      }
      // Safety jump for session switches if complex components take a moment to render
      if (behavior === "auto") {
        setTimeout(() => {
          if (el) el.scrollTop = el.scrollHeight;
        }, 80);
      }
    }
  });
}

// Watch for session switches (immediate jump) or content updates (smooth scroll)
watch(
  () => ({
    sessionId: workspace.activeSessionId,
    messageCount: parsedMessages.value.length,
    lastContent: session.value?.messages.at(-1)?.content,
    lastReasoning: session.value?.messages.at(-1)?.reasoning,
  }),
  (next, prev) => {
    const isSessionSwitch = next.sessionId !== prev?.sessionId;
    scrollToBottom(isSessionSwitch ? "auto" : "smooth");
  },
  { immediate: true }
);

onMounted(() => {
  scrollToBottom("auto");
});

function roleLabel(role: string) {
  return (
    {
      user: "用户",
      assistant: "助手",
      system: "系统",
      tool: "工具",
    }[role] ?? role
  );
}

const EXECUTION_CHAIN_BADGES: Record<string, string> = {
  MODEL: "模型",
  TOOL_CALL: "调用",
  SKILL: "技能",
  STATUS: "状态",
  RESULT: "结果",
};

/** 解析结构化链路日志前缀，便于界面把模型、技能和状态分开展示。 */
function parseExecutionChainContent(content: string): { tag: string | null; detail: string } {
  const trimmed = content.trim();
  const matched = trimmed.match(/^\[([A-Z_]+)\]\s*(.*)$/);
  if (!matched) {
    return {
      tag: null,
      detail: trimmed,
    };
  }

  return {
    tag: matched[1] ?? null,
    detail: (matched[2] ?? "").trim(),
  };
}

/** 返回链路步骤的标签文案，未结构化的消息继续按原角色显示。 */
function executionChainBadge(message: ChatMessage) {
  if (message.role === "tool") {
    return "输出";
  }

  const parsed = parseExecutionChainContent(message.content);
  if (!parsed.tag) {
    return roleLabel(message.role);
  }

  return EXECUTION_CHAIN_BADGES[parsed.tag] ?? parsed.tag;
}

/** 为链路步骤生成可读摘要，工具输出优先取第一行做预览。 */
function executionChainSummary(message: ChatMessage) {
  if (message.role === "tool") {
    const preview = message.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return preview ?? "查看工具输出";
  }

  const parsed = parseExecutionChainContent(message.content);
  return parsed.detail || message.content;
}

function previewMessage(item: ChatSession) {
  return item.messages.at(-1)?.content ?? "暂无消息";
}

async function createSession() {
  creatingSession.value = true;
  try {
    await workspace.createSession();
  } catch (error) {
    reportChatError(error);
  } finally {
    creatingSession.value = false;
  }
}

function isDeletingSession(sessionId: string) {
  return deletingSessionIds.value.includes(sessionId);
}

async function handleDeleteSession(sessionId: string) {
  if (isDeletingSession(sessionId)) {
    return;
  }

  if (!window.confirm("删除这条对话记录？")) {
    return;
  }

  deletingSessionIds.value = [...deletingSessionIds.value, sessionId];

  try {
    await workspace.deleteSession(sessionId);
  } catch (error) {
    reportChatError(error);
  } finally {
    deletingSessionIds.value = deletingSessionIds.value.filter((item) => item !== sessionId);
  }
}

async function submitMessage() {
  const draft = composerDraft.value.trim();
  if (!draft || !session.value) {
    return;
  }

  composerDraft.value = "";

  sendMessageToRuntime(draft);
}

async function sendMessageToRuntime(draft: string): Promise<boolean> {
  sending.value = true;
  try {
    const intent = parseExecutionIntentCommand(draft);

    if (intent) {
      await workspace.requestExecutionIntent(intent);
    } else {
      await workspace.sendMessage(draft);
    }

    return true;
  } catch (error) {
    reportChatError(error);

    return false;
  } finally {
    sending.value = false;
  }
}

function reportChatError(error: any) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  if (session.value) {
    workspace.pushAssistantMessage(
      session.value.id,
      `> [!CAUTION]\n> **发生错误**\n> ${errorMessage}`
    );
    // Ensure the message is visible immediately
    scrollToBottom("smooth");
  }
}

/** 单字段交互保持普通会话，多字段收集才渲染 A2UI 表单。 */
function shouldRenderInlineA2UiForm(payload: A2UiPayload | null | undefined): payload is A2UiForm {
  return payload?.kind === "form" && Array.isArray(payload.fields) && payload.fields.length >= 2;
}

function readFormFieldValue(messageId: string, fieldName: string): string {
  return formDrafts.value[messageId]?.[fieldName] ?? "";
}

function writeFormFieldValue(messageId: string, fieldName: string, value: string) {
  const currentDraft = formDrafts.value[messageId] ?? {};
  formDrafts.value[messageId] = {
    ...currentDraft,
    [fieldName]: value,
  };
}

function handleTextFieldInput(messageId: string, fieldName: string, event: Event) {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement | null;
  writeFormFieldValue(messageId, fieldName, target?.value ?? "");
}

function handleSelectFieldChange(messageId: string, fieldName: string, event: Event) {
  const target = event.target as HTMLSelectElement | null;
  writeFormFieldValue(messageId, fieldName, target?.value ?? "");
}

function findMissingRequiredField(messageId: string, form: A2UiForm): A2UiFormField | null {
  for (const field of form.fields) {
    if (!field.required) {
      continue;
    }

    if (!readFormFieldValue(messageId, field.name).trim()) {
      return field;
    }
  }

  return null;
}

function createFormSubmissionPayload(messageId: string, form: A2UiForm): string {
  const pairs = form.fields.map((field) => `${field.name}=${readFormFieldValue(messageId, field.name).trim()}`);
  return `[A2UI_FORM:${form.id}] ${pairs.join("; ")}`;
}

async function submitA2UiForm(message: ChatMessage) {
  if (!shouldRenderInlineA2UiForm(message.ui)) {
    return;
  }

  const missingField = findMissingRequiredField(message.id, message.ui);
  if (missingField) {
    formErrors.value[message.id] = `必填项不能为空：${missingField.label}`;
    return;
  }
  
  formErrors.value[message.id] = "";

  const payload = createFormSubmissionPayload(message.id, message.ui);
  const sent = await sendMessageToRuntime(payload);

  if (sent) {
    submittedFormIds.value.push(message.id);
    const { [message.id]: _removed, ...rest } = formDrafts.value;
    formDrafts.value = rest;
  }
}

function isResolvingApproval(approvalId: string) {
  return resolvingApprovalIds.value.includes(approvalId);
}

async function handleApproval(approvalId: string, decision: ApprovalDecision) {
  if (isResolvingApproval(approvalId)) {
    return;
  }

  resolvingApprovalIds.value = [...resolvingApprovalIds.value, approvalId];

  try {
    await workspace.resolveApproval(approvalId, decision);
  } catch (error) {
    reportChatError(error);
  } finally {
    resolvingApprovalIds.value = resolvingApprovalIds.value.filter((item) => item !== approvalId);
  }
}

function parseExecutionIntentCommand(input: string): ExecutionIntent | null {
  if (!input.startsWith("/")) {
    return null;
  }

  const [command] = input.split(/\s+/, 1);
  const payload = input.slice(command.length).trim();
  if (!payload) {
    return null;
  }

  switch (command) {
    case "/skill":
      return {
        source: "skill",
        toolId: `skill.${normalizeIntentId(payload)}`,
        label: payload,
        risk: ToolRiskCategory.Exec,
        detail: `Skills 准备执行 ${payload}。`,
      };
    case "/cmd":
      return {
        source: "shell-command",
        toolId: "shell.command",
        label: payload,
        risk: ToolRiskCategory.Exec,
        detail: `准备执行命令：${payload}`,
      };
    case "/read":
      return {
        source: "mcp-tool",
        toolId: "fs.read_file",
        label: payload,
        risk: ToolRiskCategory.Read,
        detail: `准备读取文件：${payload}`,
      };
    case "/network":
      return {
        source: "network-request",
        toolId: "network.request",
        label: payload,
        risk: ToolRiskCategory.Network,
        detail: `准备访问外部网络：${payload}`,
      };
    case "/mcp": {
      const [serverId, toolName, ...rest] = payload.split(/\s+/);
      if (!serverId || !toolName) {
        return null;
      }

      const rawArgs = rest.join(" ").trim();
      const target = rawArgs || toolName;
      const argumentsPayload = parseMcpArguments(toolName, rawArgs);
      return {
        source: "mcp-tool",
        toolId: `${serverId}:${toolName}`,
        label: toolName,
        risk: inferMcpRisk(toolName),
        serverId,
        toolName,
        arguments: argumentsPayload,
        detail: `MCP 准备执行 ${toolName} ${target}`.trim(),
      };
    }
    default:
      return null;
  }
}

function normalizeIntentId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseMcpArguments(toolName: string, rawArgs: string): Record<string, unknown> {
  if (!rawArgs) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawArgs) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall back to a lightweight string-based mapping.
  }

  const normalized = toolName.trim().toLowerCase();
  if (normalized.includes("write") && rawArgs.includes("::")) {
    const [path, ...rest] = rawArgs.split("::");
    return {
      path: path.trim(),
      content: rest.join("::"),
    };
  }

  if (
    normalized.includes("read") ||
    normalized.includes("list") ||
    normalized.includes("find") ||
    normalized.includes("search")
  ) {
    return {
      path: rawArgs,
    };
  }

  return {
    input: rawArgs,
  };
}

function inferMcpRisk(label: string): ToolRiskCategory {
  const normalized = label.trim().toLowerCase();
  if (
    normalized.includes("read") ||
    normalized.includes("list") ||
    normalized.includes("search") ||
    normalized.includes("find") ||
    normalized.includes("get")
  ) {
    return ToolRiskCategory.Read;
  }

  return ToolRiskCategory.Write;
}
</script>

<style scoped>
.chat-shell {
  display: flex;
  flex: 1;
  height: 100%;
  min-height: 0;
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
  min-width: 0;
  position: relative;
}

.chat-title-header {
  padding: 20px 32px;
  border-bottom: 1px solid var(--glass-border);
  background: var(--bg-base);
  z-index: 30; /* Higher z-index for dropdown */
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-left {
  display: flex;
  align-items: center;
}

.session-dropdown-container {
  position: relative;
}

.session-dropdown-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 8px 12px;
  margin-left: -12px;
  border-radius: var(--radius-md);
  color: var(--text-primary);
  transition: background 0.2s;
}

.session-dropdown-trigger:hover,
.session-dropdown-container:focus-within .session-dropdown-trigger {
  background: var(--glass-reflection);
}

.header-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 300px;
}

.session-dropdown-menu {
  position: absolute;
  top: calc(100% + 8px);
  left: -12px;
  width: 320px;
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
  opacity: 0;
  visibility: hidden;
  transform: translateY(-8px);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  flex-direction: column;
  max-height: 60vh;
}

.session-dropdown-container:hover .session-dropdown-menu,
.session-dropdown-container:focus-within .session-dropdown-menu {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}

.dropdown-header {
  padding: 16px;
  border-bottom: 1px solid var(--glass-border);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.new-chat-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
}

.session-list-dropdown {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  margin: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 12px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
}

.session-item:hover {
  background: var(--glass-reflection);
}

.session-item.active {
  background: var(--glass-reflection);
  border-color: var(--glass-border);
}

.session-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.session-info strong {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-info span {
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-row {
  display: flex;
  align-items: stretch;
  gap: 4px;
}

.session-delete {
  width: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition: all 0.2s ease;
}

.session-row:hover .session-delete,
.session-row .session-delete:focus-within {
  opacity: 1;
}

.session-delete:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.timeline-panel {
  flex: 1;
  overflow-y: auto;
  padding: 32px;
}

.timeline {
  display: flex;
  flex-direction: column;
  gap: 32px;
  max-width: 800px;
  margin: 0 auto;
}

/* Timeline Message Redesign */
.message-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  width: 100%;
}

.message-avatar {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  color: var(--text-primary);
}

.role-assistant .message-avatar {
  background: var(--glass-reflection);
  border-color: var(--glass-border);
  color: var(--accent-cyan);
}

.role-user {
  flex-direction: row-reverse;
}

.role-user .message-body {
  align-items: flex-end;
}

.role-user .message-header {
  margin-right: 4px;
}

.role-user .message-content {
  background: var(--bg-card);
  padding: 12px 18px;
  border-radius: var(--radius-lg) var(--radius-lg) 4px var(--radius-lg);
  border: 1px solid var(--glass-border);
  max-width: 90%;
}

.role-user .message-content :deep(p:last-child) {
  margin-bottom: 0;
}

.role-user .message-avatar {
  background: var(--text-primary);
  color: var(--bg-base);
}

.pending-avatar {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .5; }
}

.message-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message-header {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.message-content {
  line-height: 1.7;
  font-size: 14px;
  color: var(--text-primary);
}

.message-content :deep(p) {
  margin: 0 0 16px;
}

.message-content :deep(p):last-child {
  margin-bottom: 0;
}

.message-content :deep(ul),
.message-content :deep(ol) {
  margin: 0 0 16px;
  padding-left: 24px;
}

.message-content :deep(li) {
  margin-bottom: 6px;
}

.message-content :deep(code) {
  background: var(--glass-reflection);
  padding: 3px 6px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.85em;
  color: var(--accent-cyan);
}

.message-content :deep(pre) {
  background: var(--bg-sidebar);
  padding: 16px;
  border-radius: var(--radius-lg);
  overflow-x: auto;
  margin: 16px 0;
  border: 1px solid var(--glass-border);
}

.message-content :deep(pre code) {
  background: transparent;
  padding: 0;
  color: inherit;
}

.message-content :deep(h1),
.message-content :deep(h2),
.message-content :deep(h3) {
  margin: 24px 0 12px;
  color: var(--text-primary);
  font-weight: 600;
}

.message-content :deep(blockquote) {
  border-left: 4px solid var(--accent-cyan);
  margin: 16px 0;
  padding-left: 16px;
  color: var(--text-secondary);
  background: var(--glass-reflection);
  padding-top: 8px;
  padding-bottom: 8px;
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
}

/* Details Panel (Reasoning & Chains) */
.message-details {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  overflow: hidden;
  margin-bottom: 12px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.message-details:not([open]):hover {
  background: var(--glass-reflection);
  border-color: var(--glass-border);
}

.message-details[open] {
  background: var(--bg-card);
  border-color: var(--glass-border);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
}

.details-summary {
  padding: 10px 16px;
  cursor: pointer;
  list-style: none; /* Hide default arrow in modern browsers */
  user-select: none;
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: color 0.2s;
}

.details-summary:hover {
  color: var(--text-primary);
}

.details-summary::-webkit-details-marker {
  display: none;
}

.summary-inner {
  display: flex;
  align-items: center;
  gap: 8px;
}

.details-summary::after {
  content: "";
  display: block;
  width: 14px;
  height: 14px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-size: contain;
  background-repeat: no-repeat;
  transition: transform 0.3s ease;
}

.message-details[open] .details-summary::after {
  transform: rotate(180deg);
}

.details-content {
  padding: 16px;
  border-top: 1px solid var(--glass-border);
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  background: rgba(0, 0, 0, 0.1);
}

.execution-chain-summary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  color: var(--text-secondary);
  font-size: 12px;
}

.execution-chain-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.execution-chain-step {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.02);
}

.execution-chain-step--tool {
  background: rgba(45, 212, 191, 0.04);
}

.execution-chain-badge {
  min-width: 44px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--glass-reflection);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  text-align: center;
  flex-shrink: 0;
}

.execution-chain-main {
  min-width: 0;
  flex: 1;
}

.execution-chain-text {
  display: block;
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

.execution-chain-output {
  width: 100%;
}

.execution-chain-output-summary {
  cursor: pointer;
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

.execution-chain-output-body {
  margin-top: 10px;
}

.approval-card {
  display: grid;
  gap: 12px;
  padding: 20px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--glass-border);
  background: var(--bg-card);
  margin-top: 8px;
}

.approval-card h3 {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
}

.approval-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}

.message-form {
  margin-top: 16px;
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  transition: all 0.3s ease;
}

.message-form-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.03);
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.form-icon {
  color: var(--accent-cyan);
  margin-top: 2px;
  flex-shrink: 0;
}

.form-title-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.message-form-title { font-size: 15px; font-weight: 600; margin: 0; color: var(--text-primary); }
.message-form-description { color: var(--text-secondary); font-size: 13px; margin: 0; line-height: 1.5; }

.message-form-fieldset {
  padding: 20px;
  border: none;
  margin: 0;
  transition: opacity 0.3s ease;
}

.message-form-fieldset:disabled {
  opacity: 0.6;
}

.message-form-fields { display: flex; flex-direction: column; gap: 16px; }
.message-form-field { display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
.message-form-field input,
.message-form-field textarea,
.message-form-field select {
  width: 100%; padding: 12px; border: 1px solid var(--glass-border);
  border-radius: var(--radius-md); background: var(--bg-base);
  color: var(--text-primary); font-size: 14px;
  transition: all 0.2s ease;
}
.message-form-field input:focus,
.message-form-field textarea:focus,
.message-form-field select:focus {
  border-color: var(--accent-cyan);
  box-shadow: 0 0 0 2px rgba(45, 212, 191, 0.15);
  outline: none;
}

.form-inline-error {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #ef4444;
  font-size: 13px;
  background: rgba(239, 68, 68, 0.1);
  padding: 10px 14px;
  border-radius: var(--radius-md);
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.message-form-footer {
  margin-top: 24px;
  display: flex;
  justify-content: flex-end;
}

.form-submit-btn {
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 12px 16px;
}

.form-success-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 12px 16px;
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  border-radius: var(--radius-md);
  border: 1px solid rgba(16, 185, 129, 0.2);
  font-size: 14px;
  font-weight: 500;
}

.composer-panel {
  padding: 24px;
  background: linear-gradient(transparent, var(--bg-base) 15%);
  position: sticky;
  bottom: 0;
}

.composer-container {
  max-width: 800px;
  margin: 0 auto;
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  transition: border-color 0.2s;
}

.composer-container:focus-within {
  border-color: var(--text-muted);
}

.composer-input {
  width: 100%;
  padding: 16px 16px 12px;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.6;
  resize: none;
  outline: none;
  min-height: 60px;
}

.composer-input::placeholder {
  color: var(--text-muted);
}

.composer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 16px 16px;
}

.composer-hints {
  font-size: 12px;
  color: var(--text-muted);
}

.composer-toolbar .submit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 10px;
  background: var(--text-primary);
  color: var(--bg-base);
  border: none;
  box-shadow: 0 4px 12px rgba(255, 255, 255, 0.1);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.composer-toolbar .submit-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(255, 255, 255, 0.15);
  opacity: 1;
}

.composer-toolbar .submit-btn:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 2px 4px rgba(255, 255, 255, 0.1);
}

.composer-toolbar .submit-btn:disabled {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-muted);
  box-shadow: none;
  border: 1px solid var(--glass-border);
  opacity: 1;
  cursor: not-allowed;
  transform: none;
}

.composer-toolbar .stop-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 10px;
  background: var(--text-primary);
  color: var(--bg-base);
  border: none;
  cursor: not-allowed;
  animation: stop-pulse 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes stop-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.composer-toolbar .submit-btn svg {
  transform: translateX(-1px);
}

.primary, .secondary {
  padding: 8px 16px;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--glass-border);
  transition: all 0.2s ease;
}

.primary {
  background: var(--text-primary);
  color: var(--bg-base);
  border-color: var(--text-primary);
}

.primary:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
}

.secondary {
  background: transparent;
  color: var(--text-primary);
}

.secondary:hover:not(:disabled) {
  background: var(--glass-reflection);
}

.primary:disabled, .secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.pulse-dot {
  width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted);
}
.pulse-dot.active {
  background: var(--accent-cyan);
  box-shadow: 0 0 8px var(--accent-cyan);
}

.typing-dots { display: inline-flex; gap: 6px; padding: 12px 0; }
.typing-dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); animation: typing-bounce 1.4s infinite ease-in-out; }
.typing-dots span:nth-child(1) { animation-delay: -0.32s; }
.typing-dots span:nth-child(2) { animation-delay: -0.16s; }
@keyframes typing-bounce { 0%, 80%, 100% { transform: scale(0); opacity: 0.3; } 40% { transform: scale(1); opacity: 1; } }


.approval-loading {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
}

.primary:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
}

.secondary {
  background: transparent;
  color: var(--text-primary);
}

.secondary:hover:not(:disabled) {
  background: var(--glass-reflection);
}

.primary:disabled, .secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.pulse-dot {
  width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted);
}
.pulse-dot.active {
  background: var(--accent-cyan);
  box-shadow: 0 0 8px var(--accent-cyan);
}

.typing-dots { display: inline-flex; gap: 6px; padding: 12px 0; }
.typing-dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); animation: typing-bounce 1.4s infinite ease-in-out; }
.typing-dots span:nth-child(1) { animation-delay: -0.32s; }
.typing-dots span:nth-child(2) { animation-delay: -0.16s; }
@keyframes typing-bounce { 0%, 80%, 100% { transform: scale(0); opacity: 0.3; } 40% { transform: scale(1); opacity: 1; } }


.approval-modal-backdrop {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  padding: 24px; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(8px); z-index: 20;
}
.approval-modal-card {
  width: min(560px, 100%); display: grid; gap: 16px; padding: 32px;
  border-radius: var(--radius-lg); border: 1px solid var(--glass-border);
  background: var(--bg-card); box-shadow: 0 24px 80px rgba(0, 0, 0, 0.4);
}
.approval-modal-card h2 { margin: 0; color: var(--text-primary); font-size: 20px; line-height: 1.3; }
.approval-modal-card p { margin: 0; color: var(--text-secondary); line-height: 1.6; }

.form-submission-summary {
  background: var(--bg-card);
  border: 1px solid rgba(16, 185, 129, 0.2);
  border-radius: var(--radius-lg);
  overflow: hidden;
  max-width: 90%;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  margin-top: 4px;
}

.role-user .form-submission-summary {
  border-radius: var(--radius-lg) var(--radius-lg) 4px var(--radius-lg);
  border-color: rgba(16, 185, 129, 0.3);
}

.summary-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid rgba(16, 185, 129, 0.1);
}

.summary-body {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.summary-pair {
  display: flex;
  font-size: 13px;
  line-height: 1.5;
}

.pair-key {
  color: var(--text-secondary);
  width: 90px;
  flex-shrink: 0;
}

.pair-val {
  color: var(--text-primary);
  font-weight: 500;
  word-break: break-all;
}
</style>
