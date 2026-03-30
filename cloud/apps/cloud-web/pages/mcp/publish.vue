<script setup lang="ts">
import type { CreateMcpItemResponse, McpServerConfig } from "@myclaw-cloud/shared";

const router = useRouter();

const transportOptions = [
  { label: "stdio", value: "stdio" },
  { label: "SSE", value: "sse" },
  { label: "Streamable HTTP", value: "streamable-http" }
] as const;

const form = reactive({
  id: "",
  name: "",
  summary: "",
  description: "",
  version: "0.1.0",
  releaseNotes: "初始版本",
  transport: "stdio" as McpServerConfig["transport"],
  command: "npx",
  args: "[\"@playwright/mcp@latest\"]",
  env: "",
  url: "",
  headers: ""
});

const isPending = ref(false);
const errorMsg = ref("");
const selectedTransport = computed(() => form.transport);

/**
 * 中文说明：解析字符串数组 JSON，用于 stdio 命令参数。
 */
function parseStringArray(raw: string): string[] | undefined {
  const value = raw.trim();
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
      throw new Error("mcp_args_invalid");
    }
    return parsed;
  } catch (error) {
    console.error("[MCP 创建] 命令参数解析失败", { raw, error });
    throw new Error("命令参数必须是字符串数组 JSON。");
  }
}

/**
 * 中文说明：解析键值对象 JSON，用于 env 和 headers。
 */
function parseStringRecord(raw: string, fieldLabel: string): Record<string, string> | undefined {
  const value = raw.trim();
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !Object.values(parsed).every((entry) => typeof entry === "string")
    ) {
      throw new Error(`${fieldLabel}_invalid`);
    }
    return parsed as Record<string, string>;
  } catch (error) {
    console.error("[MCP 创建] 键值配置解析失败", { fieldLabel, raw, error });
    throw new Error(`${fieldLabel} 必须是 JSON 对象，且值必须为字符串。`);
  }
}

/**
 * 中文说明：根据表单构建 MCP config JSON。
 */
function buildConfig(): McpServerConfig {
  console.info("[MCP 创建] 开始构建 config", { transport: form.transport });

  if (form.transport === "stdio") {
    return {
      transport: "stdio",
      command: form.command.trim(),
      args: parseStringArray(form.args),
      env: parseStringRecord(form.env, "环境变量")
    };
  }

  return {
    transport: form.transport,
    url: form.url.trim(),
    headers: parseStringRecord(form.headers, "请求头")
  };
}

/**
 * 中文说明：提交 MCP 创建请求，并将 JSON config 一并发送到 cloud-api。
 */
async function handlePublish() {
  console.info("[MCP 创建] 开始提交 MCP 创建请求", {
    id: form.id,
    version: form.version,
    transport: form.transport
  });
  errorMsg.value = "";
  isPending.value = true;

  try {
    const result = await $fetch<CreateMcpItemResponse>("/api/mcp/items", {
      method: "POST",
      body: {
        id: form.id,
        name: form.name,
        summary: form.summary,
        description: form.description,
        version: form.version,
        releaseNotes: form.releaseNotes,
        config: buildConfig()
      }
    });

    console.info("[MCP 创建] MCP 创建成功，准备跳转管理页", {
      id: result.item.id,
      releaseId: result.release.id
    });
    await router.push("/mcp");
  } catch (error: any) {
    console.error("[MCP 创建] MCP 创建失败", error);
    errorMsg.value = error?.data?.statusMessage || error?.statusMessage || error?.message || "创建 MCP 失败。";
  } finally {
    console.info("[MCP 创建] 创建流程结束", { id: form.id, pending: false });
    isPending.value = false;
  }
}

useHead({
  title: "创建 MCP | MyClaw Cloud"
});
</script>

<template>
  <main class="nuxt-publish-web-page">
    <div class="publish-container-nx">
      <div class="publish-header-nx">
        <NuxtLink class="back-link-nx" to="/mcp">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          返回 MCP
        </NuxtLink>
        <div class="title-area">
          <h2>创建 <span class="dim">MCP</span></h2>
          <p class="subtitle">将 MCP 连接配置以结构化 JSON 形式发布到平台仓库。</p>
        </div>
      </div>

      <form class="desktop-form-layout" @submit.prevent="handlePublish">
        <div class="layout-main form-card-nx glass-card-nx">
          <section class="inner-section">
            <header class="section-head">
              <h3>基础信息</h3>
              <p>填写 MCP 在管理台和 Hub 中展示的核心信息。</p>
            </header>

            <div class="form-group mb-xl">
              <label>MCP 名称</label>
              <input v-model="form.name" type="text" placeholder="例如：Playwright MCP" required />
            </div>

            <div class="form-group mb-xl">
              <label>简短摘要</label>
              <input v-model="form.summary" type="text" placeholder="用于 MCP 列表的一句话摘要" required />
            </div>

            <div class="form-group">
              <label>详细说明</label>
              <textarea v-model="form.description" rows="5" placeholder="说明这个 MCP 的用途、连接方式和适用场景..." required></textarea>
            </div>
          </section>

          <section class="inner-section">
            <header class="section-head">
              <h3>连接配置</h3>
              <p>Playwright MCP 推荐使用 `stdio`，远程 MCP 可切换到 SSE 或 Streamable HTTP。</p>
            </header>

            <div class="form-group mb-xl">
              <label>传输方式</label>
              <div class="transport-grid-nx">
                <button
                  v-for="option in transportOptions"
                  :key="option.value"
                  type="button"
                  class="transport-pill-nx"
                  :class="{ active: selectedTransport === option.value }"
                  @click="form.transport = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>

            <template v-if="selectedTransport === 'stdio'">
              <div class="form-group mb-xl">
                <label>启动命令</label>
                <input v-model="form.command" type="text" placeholder="npx" required />
              </div>

              <div class="form-group mb-xl">
                <label>命令参数</label>
                <textarea
                  v-model="form.args"
                  rows="4"
                  class="mono-font"
                  placeholder='["@playwright/mcp@latest"]'
                ></textarea>
              </div>

              <div class="form-group">
                <label>环境变量</label>
                <textarea
                  v-model="form.env"
                  rows="4"
                  class="mono-font"
                  placeholder='{"PLAYWRIGHT_HEADLESS":"true"}'
                ></textarea>
              </div>
            </template>

            <template v-else>
              <div class="form-group mb-xl">
                <label>远程地址</label>
                <input v-model="form.url" type="url" placeholder="https://mcp.example.com/sse" required />
              </div>

              <div class="form-group">
                <label>请求头</label>
                <textarea
                  v-model="form.headers"
                  rows="4"
                  class="mono-font"
                  placeholder='{"Authorization":"Bearer token"}'
                ></textarea>
              </div>
            </template>
          </section>
        </div>

        <aside class="layout-sidebar form-card-nx glass-card-nx">
          <section class="inner-section">
            <header class="section-head">
              <h3>发布信息</h3>
            </header>

            <div class="form-group mb-lg">
              <label>MCP ID</label>
              <input v-model="form.id" type="text" placeholder="playwright" required />
            </div>

            <div class="row-inputs mb-lg">
              <div class="form-group flex-1">
                <label>版本</label>
                <input v-model="form.version" type="text" placeholder="1.0.0" required />
              </div>
            </div>

            <div class="form-group">
              <label>发布说明</label>
              <textarea v-model="form.releaseNotes" rows="4" placeholder="说明这个版本的更新内容" required></textarea>
            </div>
          </section>

          <section class="inner-section">
            <header class="section-head">
              <h3>Playwright 示例</h3>
              <p>浏览器自动化 MCP 的常见 stdio 配置如下。</p>
            </header>

            <pre class="example-code"><code>{
  "transport": "stdio",
  "command": "npx",
  "args": ["@playwright/mcp@latest"]
}</code></pre>
          </section>

          <div v-if="errorMsg" class="status-msg error">
            {{ errorMsg }}
          </div>

          <div class="publish-actions-flat">
            <button type="submit" class="submit-btn-nx" :disabled="isPending">
              <span v-if="isPending" class="spinner"></span>
              {{ isPending ? "正在创建..." : "创建 MCP" }}
            </button>
          </div>
        </aside>
      </form>
    </div>
  </main>
</template>

<style scoped>
.nuxt-publish-web-page { position: relative; min-height: calc(100vh - 64px); background: var(--bg-main); width: 100%; padding-bottom: 80px; }
.publish-container-nx { max-width: 1440px; margin: 0 auto; padding: 40px; }

.publish-header-nx { margin-bottom: 40px; display: flex; flex-direction: column; gap: 16px; }
.back-link-nx { display: inline-flex; align-items: center; gap: 8px; color: var(--text-dim); text-decoration: none; font-weight: 800; font-size: 0.85rem; transition: 0.2s; align-self: flex-start; padding: 6px 12px; background: rgba(255,255,255,0.03); border-radius: 8px; }
.back-link-nx:hover { color: var(--text-main); background: rgba(255,255,255,0.08); }
.back-link-nx svg { width: 16px; height: 16px; }
.title-area h2 { font-size: 2rem; font-weight: 900; color: var(--text-main); letter-spacing: -0.02em; margin: 0 0 4px; }
.title-area .dim { color: var(--text-dim); }
.subtitle { color: var(--text-muted); font-size: 1rem; margin: 0; }

.desktop-form-layout { display: grid; grid-template-columns: 1fr 400px; gap: 32px; align-items: start; }
@media (max-width: 1024px) { .desktop-form-layout { grid-template-columns: 1fr; } }

.layout-main { display: flex; flex-direction: column; gap: 32px; }
.layout-sidebar { display: flex; flex-direction: column; gap: 32px; position: sticky; top: 40px; }

.form-card-nx { padding: 32px; border-radius: 20px; background: var(--bg-main); border: 1px solid var(--border-muted); box-shadow: 0 10px 40px rgba(0,0,0,0.1); }
.section-head { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.05); }
.section-head h3 { margin: 0 0 6px; font-size: 1.25rem; font-weight: 900; color: var(--text-main); }
.section-head p { margin: 0; font-size: 0.9rem; color: var(--text-muted); }

.form-group { display: flex; flex-direction: column; gap: 10px; }
.mb-lg { margin-bottom: 20px; }
.mb-xl { margin-bottom: 28px; }
.row-inputs { display: flex; gap: 16px; }
.flex-1 { flex: 1; }

.form-group label { font-size: 0.8rem; font-weight: 900; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: space-between; }
.form-group input, .form-group textarea { width: 100%; padding: 14px 18px; background: var(--bg-input); border: 1px solid var(--border-main); border-radius: 12px; color: var(--text-main); font-family: inherit; font-size: 0.95rem; transition: 0.2s; box-sizing: border-box; }
.form-group input:focus, .form-group textarea:focus { outline: none; border-color: var(--nuxt-green); box-shadow: 0 0 0 3px rgba(var(--nuxt-green-rgb), 0.1); background: rgba(var(--nuxt-green-rgb), 0.02); }
.mono-font { font-family: "SFMono-Regular", "Fira Code", monospace !important; font-size: 0.85rem !important; line-height: 1.6; }

.transport-grid-nx { display: flex; flex-wrap: wrap; gap: 12px; }
.transport-pill-nx { height: 40px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--border-main); background: var(--bg-input); color: var(--text-dim); font-weight: 800; cursor: pointer; transition: 0.2s; }
.transport-pill-nx.active { border-color: rgba(var(--nuxt-green-rgb), 0.35); background: rgba(var(--nuxt-green-rgb), 0.1); color: var(--nuxt-green); }

.example-code { margin: 0; padding: 16px; border-radius: 14px; background: rgba(0, 0, 0, 0.2); border: 1px solid var(--border-main); overflow-x: auto; color: var(--text-main); }

.status-msg { padding: 16px; border-radius: 12px; font-size: 0.875rem; font-weight: 700; display: flex; align-items: center; gap: 8px; margin-top: -16px; }
.status-msg.error { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444; }

.publish-actions-flat { padding: 0; margin-top: -8px; }
.submit-btn-nx { width: 100%; height: 52px; background: var(--nuxt-green); color: var(--btn-text); border: none; border-radius: 12px; font-weight: 900; font-size: 1.05rem; cursor: pointer; transition: 0.3s; display: flex; align-items: center; justify-content: center; gap: 12px; box-shadow: 0 4px 15px rgba(var(--nuxt-green-rgb), 0.2); letter-spacing: 0.02em; }
.submit-btn-nx:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(var(--nuxt-green-rgb), 0.4); }
.submit-btn-nx:disabled { opacity: 0.5; filter: grayscale(1); cursor: not-allowed; box-shadow: none; transform: none; }
.spinner { width: 18px; height: 18px; border: 3px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
