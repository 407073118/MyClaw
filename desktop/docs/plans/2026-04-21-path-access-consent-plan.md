# 桌面端工作区外路径访问 · 五层信任审批体系

**Plan ID**: 2026-04-21-path-access-consent
**Status**: draft, awaiting sign-off
**Scope**: desktop（main + preload + renderer），不动 cloud
**Estimated effort**: ~17h (3 个 commit 批次)

---

## 1 · 背景与触发事件

**触发案例** (2026-04-21 17:17)：
用户在聊天里请求 `F:\面试录音\百融测试工单交付流程.xlsx`。模型调 `fs.read` → 命中
`safeResolve` 的工作区越界检查 → 硬 throw `"路径越界：当前审批模式不允许访问工作区外部路径。"`
→ 模型自行编造"xlsx 二进制不支持"的错误理由 → 乱试 `fs.list path="."` 兜底 → 彻底失败。

**产品层问题**：
桌面助手跑在**用户自己的机器**上，沙箱是防模型误伤 / prompt injection / 作用域漂移，
**不是防用户**。当用户手打路径 = 明确 consent，系统仍硬拒是设计错位。

**架构层问题**：
`ApprovalMode` 已设计 4 档（含 `"prompt"`），`shouldRequestApproval` 签名里
已有 `isOutsideWorkspace` 参数，`ApprovalDecision` 已支持 `allow-once / allow-session`，
但**从未在外部路径场景接通**。本方案是把半成品补齐。

---

## 2 · 决策锁定

用户 2026-04-21 会议拍板：

| ID | 决策 | 值 | 含义 |
|---|---|---|---|
| D1 | T1 自动放行 | **A** | 用户本轮消息里提到的路径直接放行，零弹框 |
| D2 | T3 持久粒度 | **A** | 仅支持"目录"粒度持久化，不做单文件永久授权 |
| D3 | Shell 扫描深度 | **A** | 正则扫路径字面量（非 AST），覆盖 `[A-Z]:\\...` / `/...` / `\\\\...` |
| D4 | 审批超时 | **B** | 120s 无响应 = 自动拒绝（不放行，不挂死） |
| D5 | 二进制文件契约 | **A** | 检测 + 返回元数据，**同 Phase 实现 xlsx_extract** 等最常见抽取工具 |

---

## 3 · 现有设施盘点（不要重造）

### 3.1 契约层（`desktop/shared/contracts/approval.ts`）

**已有**：
- `ApprovalMode = "prompt" | "auto-read-only" | "auto-allow-all" | "unrestricted"` → 对应 T4/T3/T1/T0 分层默认
- `ApprovalDecision = "deny" | "allow-once" | "allow-session" | "always-allow-tool"` → 决策语义齐全
- `ApprovalRequestSource = "builtin-tool" | "mcp-tool" | "skill" | "shell-command" | "network-request"`
- `ApprovalRequest { id, sessionId, source, toolId, label, risk, detail, resumeConversation? }`
- `ApprovalPolicy { mode, autoApproveReadOnly, autoApproveSkills, alwaysAllowedTools }`
- `shouldRequestApproval({ policy, source, toolId, risk, isOutsideWorkspace })` **签名已含 `isOutsideWorkspace`，但调用方从未传入**
- `allowsExternalPaths(mode)`

**需要增量**：
- `ApprovalDecision` 加一档 `"allow-directory"`
- `ApprovalRequest` 加可选字段 `pathMeta: { path, userPath, operation, size?, isBinary? }`
- `ApprovalPolicy` 加可选字段 `pathGrants: { allowedDirs: string[], deniedPaths: string[] }`
- `ApprovalRequestSource` 加 `"external-path"` 以区别普通 builtin-tool

### 3.2 Executor 层（`desktop/src/main/services/builtin-tool-executor.ts`）

**已有**：
- `safeResolve(base, userPath, allowExternal)` L135 — 单点，抛 `Error`
- `resolvePathSafe(base, userPath)` L677 — **整个 executor 7 处 caller 全部走这个方法**（fs.read/write/list/search/find, ppt.outputPath, 1 处 util）
- `isOutsideWorkspace(base, targetPath)` L682 — 已暴露为 public
- `execute()` L657 — 已 try/catch 包住 `dispatch`
- `setAllowExternalPaths(allow)` L652 — 全局布尔开关

**需要增量**：
- `safeResolve` 抛 **类型化错误** `PathOutOfWorkspaceError`（带 resolved/userPath）
- `resolvePathSafe` 改为 async，走策略检查
- `_allowExternalPaths` 全局布尔 **保留**作 unrestricted mode 快速路径，但新增 per-call override
- `execute()` 外层捕 `PathOutOfWorkspaceError` → 策略决策 → 必要时发起审批 → 结果写回 per-call override 重试一次

### 3.3 Session 层（`desktop/src/main/ipc/sessions.ts`）

**已有**：
- L2458 `toolExecutor.setAllowExternalPaths(allowsExternalPaths(ctx.state.getApprovals().mode))` — 每 run 一次
- L2542 `computerHarness.requestApproval` — **参考实现**：创建 `ApprovalRequest` → `setApprovalRequests` → 广播 `session:stream ApprovalRequested` → await Promise → 用户响应后 resolve
- `pendingApprovals: Map<id, { resolve, reject }>` — Promise 管理
- `releasePendingApprovalsForRun` — 清理未决

**需要增量**：
- 注入 `pathApprovalCallback` 到 `toolExecutor`，形状同 `computerHarness.requestApproval`
- 新一种 `ApprovalRequest.source = "external-path"` 的创建与清理

### 3.4 Renderer 层

**已有**：
- `ChatPage.tsx:1819` 内联渲染 `sessionApprovalRequests.map` 为 `message-row role-system` 卡片
- `workspace.approvalRequests` Zustand store
- `workspace.addApprovalRequest` 接收 `approval.requested` 事件追加

**需要增量**：
- 卡片渲染分支：`approval.source === "external-path"` 走路径专用视图
- 5 个决策按钮：`仅此次 / 本会话 / 本目录（始终）/ 拒绝 / 此路径永不`
- Batch 模式：同时多条 `external-path` 审批 → 合并卡片（按 ancestor dir 去重）

---

## 4 · 五层信任模型（核心算法）

### 4.1 PathAccessPolicy 判定

```
check(canonicalPath, op, session, userMessage):
  # T0 工作区内
  if isInsideBase(session.workspaceRoot, canonicalPath):
    return { tier: 0, decision: "allow", needsPrompt: false }

  # T1 用户本轮消息里提到的路径
  userReferenced = extractPathsFromMessage(userMessage)
  if canonicalPath in userReferenced or anyAncestorIn(canonicalPath, userReferenced):
    return { tier: 1, decision: "allow", needsPrompt: false, audit: true }

  # T5 明确拒绝（先于放行类查询，防绕过）
  if canonicalPath in session.deniedPaths or anyAncestorIn(canonicalPath, policy.pathGrants.deniedPaths):
    return { tier: 5, decision: "deny", reason: "user_denied" }

  # T3 持久授权目录
  if anyAncestorIn(canonicalPath, policy.pathGrants.allowedDirs):
    return { tier: 3, decision: "allow", needsPrompt: false, audit: true }

  # T2 会话级授权
  if canonicalPath in session.allowedPaths or anyAncestorIn(canonicalPath, session.allowedDirs):
    # 写操作即使 T2 allowed for read，仍要 T4 再确认
    if op in ["write", "delete"] and (canonicalPath, op) not in session.writeAllowed:
      return { tier: 4, decision: "prompt", reason: "write_reconfirm" }
    return { tier: 2, decision: "allow", needsPrompt: false, audit: true }

  # T4 首次外部，需审批
  return { tier: 4, decision: "prompt", reason: "first_external" }
```

### 4.2 用户消息路径抽取正则

覆盖：
- Windows 绝对：`[A-Z]:\\[^\s"'<>|]*`（含中文 / 空格 if 在引号内，后续增强）
- POSIX 绝对：`/(?:[^/\s"']+/)*[^/\s"']+`
- UNC：`\\\\[^\\]+\\[^\\]+(?:\\[^\\]*)*`
- WSL↔Win 等价：`/mnt/[a-z]/...` ↔ `[A-Z]:\\...` 双向匹配
- file:// URI：`file:///[A-Z]:/...` 或 `file:///home/...`

抽取后**逐个 realpath**，与 `canonicalPath` 做 canonical 比较（防 symlink 绕过）。

### 4.3 审批 prompt 流（复用 `requestApproval` pattern）

```
async requestPathApproval(ctx, session, path, op, toolId):
  approvalId = uuid()
  req = {
    id, sessionId, source: "external-path", toolId,
    risk: op === "read" ? "medium" : "high",
    label: `${op} ${path}`,
    detail: `工具 ${toolId} 尝试访问工作区外路径：${path}`,
    pathMeta: { path: canonicalPath, userPath: rawUserPath, operation: op, size?, isBinary? },
  }
  ctx.state.setApprovalRequests([...existing, req])
  broadcast("approval.requested", { approvalRequest: req })

  decision = await Promise.race([
    awaitUserResponse(approvalId),       # 从 pendingApprovals
    timeout(120_000),                     # D4: 超时拒绝
  ])

  cleanup(approvalId)

  switch decision.kind:
    case "allow-once":       return { approved: true, persist: "none" }
    case "allow-session":    session.allowedPaths.add(canonicalPath); return { approved: true }
    case "allow-directory":  session.allowedDirs.add(dirname(canonicalPath)); persistIfUserChose; return { approved: true }
    case "deny":             return { approved: false }
    case "deny-persistent":  policy.pathGrants.deniedPaths.add(canonicalPath); return { approved: false }
    case "timeout":          return { approved: false, reason: "timeout" }
```

### 4.4 execute() 外层包装

```
async execute(toolId, label, workingDir, options):
  cwd = resolve(workingDir)
  perCallOverride = { allowExternal: false }  # 默认禁

  try:
    return await dispatch(toolId, label, cwd, options, perCallOverride)
  catch err:
    if err instanceof PathOutOfWorkspaceError and !this._attemptedApprovalFor[err.resolved]:
      this._attemptedApprovalFor[err.resolved] = true   # 防 loop
      decision = await this.pathPolicy.checkOrPrompt(err.resolved, inferOp(toolId), session, userMessage)
      if decision.approved:
        perCallOverride.allowExternal = true
        try:
          return await dispatch(toolId, label, cwd, options, perCallOverride)
        finally:
          delete this._attemptedApprovalFor[err.resolved]
      else:
        return { success: false, output: "", error: formatDenialError(decision, err) }
    return { success: false, output: "", error: err.message }
```

> **并发安全**: `perCallOverride` 是局部对象，不是共享状态。多个并行 `execute()` 互不干扰。
> `_attemptedApprovalFor` 防止同一路径的审批 loop（若用户批准后 dispatch 再抛同样错）。

---

## 5 · 16 阶段详细计划

### Batch 1 · 基础设施（Phase 1-6，~8h，一个 commit）

#### Phase 1 — 类型化错误 & per-call 上下文（1h）

- **改** `desktop/src/main/services/builtin-tool-executor.ts`
  - 新 `class PathOutOfWorkspaceError extends Error { resolved: string; userPath: string; toolId?: string; }`
  - `safeResolve(base, userPath, allowExternal = false)` 抛 `PathOutOfWorkspaceError`
  - 新增 `resolvePathSafeWithOverride(base, userPath, perCallAllow)` 兼容路径
  - 保留 `_allowExternalPaths` 作 unrestricted 快速路径

- **验收**：
  - `safeResolve` 抛的是 `instanceof PathOutOfWorkspaceError`
  - `tsc --noEmit` 干净
  - 现有行为在 unrestricted mode 不变

#### Phase 2 — `PathAccessPolicy` 服务（1.5h）

- **建** `desktop/src/main/services/path-access-policy.ts`
  - 类 `PathAccessPolicy`：持有 persistent `pathGrants`、session scope 状态
  - 方法 `check(canonicalPath, op, ctx): PathAccessDecision`
  - 方法 `recordDecision(canonicalPath, decision)` 更新 session 状态
  - 方法 `persist(dir, decision)` 更新 persistent 状态
  - 纯函数 `isInsidePath(ancestor, child)` 帮助 ancestor 检测
  - 单元测试：所有 5 tier 路径

- **验收**：
  - policy.check 对 T0-T5 各路径返回正确 tier + decision
  - 持久 denied 严格先于 allowed 判定
  - 写操作在 T2 read-allowed 路径上仍返回 `"prompt"`

#### Phase 3 — 用户消息路径抽取（1.5h）

- **建** `desktop/shared/utils/path-extractor.ts`
  - `extractPaths(text: string): string[]`
  - 正则集合（如 4.2 节）
  - NFC 归一化
  - WSL↔Win 双向映射
  - `async canonicalize(paths: string[]): string[]`（调 realpath）
- 单元测试 30+ case（中文 / 空格 / URL-encoded / WSL / UNC / 引号内带空格）

- **验收**：
  - `"F:\面试录音\x.xlsx"` / `"/mnt/f/面试录音/x.xlsx"` 都能抽出同一 canonical path
  - 抽取不匹配任意字符串（避免把 `git log` / `npm install` 误判）

#### Phase 4 — 跨厂商路径归一化（2h）

- **建** `desktop/src/main/services/path-normalizer.ts`
  - `normalizeToolPath(rawArg: string, vendor?: string): string`
  - 处理：JSON-unescape → URL-decode → NFC → WSL↔Win → realpath
  - 厂商 hint 可选（如 qwen 常省略盘符，补全当前 workspace 盘符）
- 单元测试，覆盖每个已知厂商的路径输出样例

- **验收**：
  - 13 厂商 × 5 路径样式 = 65 个 fixture 全 pass
  - 对未知厂商 fallback 到通用归一化

#### Phase 5 — Tool ID / 参数别名归一化（0.5h）

- **改** `desktop/src/main/services/tool-schemas.ts`（或建新文件）
  - 函数 `normalizeToolId(raw: string): string`
    - `read_file | readFile | file.read | read` → `fs.read`
    - `write_file | writeFile | file.write` → `fs.write`
    - `list_dir | listDir | ls | dir` → `fs.list`
    - …
  - 函数 `normalizePathArgKey(args: Record, toolId: string): Record`
    - fs.* 的 `file / filepath / target / query` 归一到 `path`

- **验收**：Qwen / DeepSeek 样例工具调用能命中归一后的 canonical toolId

#### Phase 6 — Policy ↔ Approval 流集成（2h）

- **改** `desktop/shared/contracts/approval.ts`
  - `ApprovalDecision` 加 `"allow-directory"`
  - `ApprovalRequestSource` 加 `"external-path"`
  - `ApprovalRequest` 加可选 `pathMeta: { path, userPath, operation, size?, isBinary? }`
  - `ApprovalPolicy` 加可选 `pathGrants: { allowedDirs: string[], deniedPaths: string[] }`

- **改** `desktop/src/main/ipc/sessions.ts`
  - 构造 `pathPolicy = new PathAccessPolicy(ctx.state.getApprovals().pathGrants ?? {})`
  - 构造 `pathApprovalCallback`（形似现有 computerHarness.requestApproval）
  - 注入到 `toolExecutor`（新 setter `setPathApprovalCallback`）
  - 每轮开始前调 `pathPolicy.setTurnUserMessage(input.content)`

- **改** `desktop/src/main/services/builtin-tool-executor.ts`
  - `execute()` 外层补 `PathOutOfWorkspaceError` 捕获分支（算法 4.4）
  - 新 setter `setPathApprovalCallback`
  - `dispatch` 签名加 `perCallOverride` 参数，`resolvePathSafe` 重载

- **验收**：
  - 触发外部路径 → 发 `approval.requested` 事件 → 模拟用户响应 → 重试成功
  - 拒绝时返回 `E_PATH_DENIED_SESSION` 错误码

**→ 第 1 批提交**：`feat(desktop): path-access consent foundation (Phase 1-6)`
- ~800 行，涵盖契约 + 2 个新服务 + 3 个归一化器 + executor 接线
- **此时尚无 UI**，仅后端逻辑；renderer 审批卡片还是老样子，会把新 `external-path` 类型当 fallback 渲染

### Batch 2 · UI / 持久化 / 模型契约（Phase 7-10，~6.5h，一个 commit）

#### Phase 7 — 渲染端审批卡片（3h）

- **改** `desktop/src/renderer/pages/ChatPage.tsx` L1819 附近
  - 增加 `approval.source === "external-path"` 分支
  - 卡片设计：路径 + 操作图标 + 文件大小（若已知）+ 二进制 badge
  - 按钮组：`仅此次 / 本会话 / 本目录（始终）/ 拒绝 / 此路径永不`
  - 键盘：Enter = 仅此次，Esc = 拒绝，1-5 数字键
  - 复用已有按钮样式（glass-pill，遵循 ui-style-guide.md）

- **新 component** `desktop/src/renderer/components/approval/ExternalPathApprovalCard.tsx`
  - 单条模式
  - Batch 模式：多条 `external-path` 同时挂起 → 合并显示 "模型想访问 N 个文件" + 展开列表

- **Batch + ancestor dedup 算法**：
  - 同一 session 所有 pending `external-path` 审批
  - 按 `dirname(canonicalPath)` 分组
  - 单目录下 ≥2 文件 → 显示 "允许目录 X" 一键放行组
  - 跨目录 → 单项展示

- **验收**：
  - 手动触发外部路径 → 卡片正确渲染
  - 5 个按钮每个都正确发送对应 IPC 响应
  - 键盘快捷键工作
  - 一次 5 个外部路径 → 合并成 1 张卡片

#### Phase 8 — 持久化 & 设置页（1.5h）

- **改** `desktop/src/main/services/state-persistence.ts`
  - `ApprovalPolicy.pathGrants` 进 persist
- **改** `desktop/src/renderer/pages/SettingsPage.tsx`
  - 新 Tab "路径授权"
  - 显示 `allowedDirs[]`、`deniedPaths[]` 列表
  - 单条撤销、批量清空
  - 手动添加/拒绝目录（输入框 + 验证）
- IPC：`approvals.updatePathGrants(next: PathGrants)`

- **验收**：
  - 重启后 persistent 授权保留
  - 设置页撤销后下次访问重新弹框

#### Phase 9 — 审计日志（1h）

- **建** `desktop/src/main/services/path-access-audit.ts`
  - JSONL 格式：`{ ts, sessionId, userId?, vendor?, toolId, path, operation, tier, decision, granted }`
  - 文件位置：`{userData}/audit/path-access-YYYY-MM-DD.jsonl`
  - 日滚动，保留 30 天
- 每次 policy.check 返回 decision 后调用 audit.record

- **验收**：T1 auto-allow / T4 approved / T4 denied 都有记录；审计文件按日滚动

#### Phase 10 — 模型可读错误契约（1h）

- **改** `desktop/src/main/services/builtin-tool-executor.ts`
  - 函数 `formatDenialError(decision, err): string`
  - 按场景返回结构化消息：
    - `E_PATH_DENIED_SESSION`: "外部路径访问被用户拒绝：`<path>`。不要重试、不要尝试替代路径；如需访问请先向用户确认。"
    - `E_PATH_DENIED_PERSISTENT`: "外部路径在永久拒绝列表：`<path>`。请让用户在设置 → 路径授权中解除后再试。"
    - `E_PATH_APPROVAL_TIMEOUT`: "外部路径审批超时（120s）。请向用户确认是否授权。"
    - `E_PATH_DENIED_BY_POLICY`: "路径 `<path>` 在工作区外。若需访问请让用户在消息中明示此路径，或在设置中永久授权此目录。"
- 各错误消息前缀含 error code，便于未来结构化

- **验收**：模型（GPT/Claude/DeepSeek）在拒绝后**不再重试同路径**（抽样对话）

**→ 第 2 批提交**：`feat(desktop): path-access UI card + persistence + audit + model error contract (Phase 7-10)`

### Batch 3 · 硬化 / 扩展 / 测试（Phase 11-16，~9h，一个 commit）

#### Phase 11 — 跨工具 shell 路径扫描（1.5h）

- **改** `desktop/src/main/services/builtin-tool-executor.ts` `exec.command` 分支
  - 在 `safeResolve` 之外，对 `command` 字符串跑路径扫正则
  - 提取所有路径字面量 → 逐个 `pathPolicy.check`
  - 发现 T4/T5 → 先弹审批（batch 一次性）或拒绝 → 再决定是否执行

- 样例命中：
  - `cat F:\foo\bar.txt` → 扫到 `F:\foo\bar.txt`
  - `cp /mnt/f/x.csv ./out/` → 扫到源路径
  - `git -C /other/repo log` → 扫到 `/other/repo`
- 明确放行模式：命令本身不涉及文件系统（`echo`、`date`、`ping`）则跳过扫描

#### Phase 12 — 二进制文件 + xlsx 抽取（2h）

- **改** `desktop/src/main/services/builtin-tool-executor.ts` `fs.read`
  - 读前：`file-type` 或 magic-bytes 侦测
  - 若为已知二进制（xlsx/xls/docx/pdf/png/jpg/mp3 …）→ 不读内容，返回元数据 `{type: "binary", mime, size, hint: "use xlsx_extract for this file"}`
  - size > 10MB text → 截断 + 提示 `fs_read_range` 扩展

- **新工具** `xlsx.extract`（在 `builtin-tool-executor.ts` 加 case）
  - 依赖：`xlsx` npm 包（readonly，开源）
  - 输入：path + optional sheet name / range
  - 输出：表格 markdown 或 CSV
- **新工具** `pdf.extract`（用 `pdf-parse` 或 `pdfjs-dist`）— 这一版可选

- tool-schemas.ts 相应注册

#### Phase 13 — 厂商矩阵测试（3h）

- **新** `desktop/tests/path-consent-vendor-matrix.test.ts`
  - 每个厂商 fixture（Anthropic / OpenAI-responses / OpenAI-chat / DeepSeek / Qwen / Kimi / Ark / gpt-5.4）
  - 每 fixture 传 5 种路径样式（干净 / 错误转义 / URL-encoded / WSL / 相对）
  - 断言：policy.check 结果一致；approval 事件格式一致；错误消息一致
- **新** `desktop/tests/path-consent-policy.test.ts` — PathAccessPolicy 纯单元测试（T0-T5 边界）
- **新** `desktop/tests/path-extractor.test.ts` — 30+ fixture

#### Phase 14 — 并发 & Symlink（1h）

- **并发**：tool-loop 同时发 N 个外部路径调用 → 每个独立跑 policy.check → 同一 canonicalPath 共享同一 approval（dedup pending map）→ 首个决策广播给所有等待者
- **Symlink**：`realpath` 在 Phase 4 已接；加测试用例 `workspace/link -> /etc/passwd` 应按 `/etc/passwd` 走 T4

#### Phase 15 — Planner 集成（1h）

- 回顾本日早些提交 `e4de938` 的 planner guard
- Approval request 进行中 → planner 状态**不变**（既不算 completed，也不算 blocked）
- Approval 超时/拒绝 → 归因到当前 task，调 `markPlanTaskBlocked`（需带 `blocker: "外部路径审批被拒"`）
- Approval 通过 → 无需特别处理，正常 tool loop 继续

#### Phase 16 — Thinking-mode replay 集成（1.5h）

- 关键保证：**同一 canonical path 在一次 session 内，用户决策只请求一次**
- 实现：`PathAccessPolicy` 的 session 级缓存 `pathDecisions: Map<canonicalPath, Decision>`
- 模型 replay（Anthropic thinking / OpenAI reasoning / DeepSeek reasoning_content）触发同一路径的同一操作 → 命中缓存，不再发 approval request
- 新测试：模拟 DeepSeek-R1 的 replay 场景 × 外部路径

**→ 第 3 批提交**：`feat(desktop): harden path-access consent — shell scan / binary handling / vendor matrix / replay (Phase 11-16)`

---

## 6 · 厂商 × Tier × Op 测试矩阵（Phase 13 详化）

| Vendor | Tier | Op | Expected |
|---|---|---|---|
| Anthropic 4.x | T0 workspace | read | allow silent |
| Anthropic 4.x | T1 user-mentioned | read | allow silent + audit |
| Anthropic 4.x | T4 new | read | prompt → await |
| Anthropic 4.x | T4 new | write | prompt → await (high risk) |
| Anthropic 4.x | T5 denied | read | deny with E_PATH_DENIED_SESSION |
| OpenAI GPT-5 (responses) | 同上全部 | 同上 | 同 Anthropic |
| OpenAI GPT-4o (chat) | 同上全部 | 同上 | 同 Anthropic |
| DeepSeek V3/R1 | 同上 + **replay T1** | read | replay 命中 cache，不再弹 |
| Qwen | 同上 + **参数别名 query/file** | read | normalizeToolPath 后走 policy |
| Kimi | 同上 | read | 同 Anthropic |
| Ark / MiniMax | 同上 | read | 同 Anthropic |
| gpt-5.4 @ cdn.arche-tech | 同上（本次事故厂商） | read / write / exec | 特别验证 |

---

## 7 · 提交边界 & 回滚

| 批次 | Commit 主题 | 行数估计 | 独立可用？ |
|---|---|---|---|
| 1 | `feat: path-access consent foundation (P1-6)` | ~800 | ❌ UI 未接，但不会 regression |
| 2 | `feat: UI + persistence + audit + model errors (P7-10)` | ~600 | ✅ 完整功能，可上线 |
| 3 | `feat: harden — shell scan + binary + vendor tests (P11-16)` | ~700 | ✅ 硬化 |

**回滚策略**：
- 每批都是独立 commit，可 revert 任一批不影响其他批
- Batch 1 回滚 → 退化到旧硬拒行为，用户体验倒退但无 data loss
- Batch 2 回滚（保留 Batch 1）→ 后端有策略但 UI 退化，用户看到通用审批卡片
- Batch 3 回滚（保留 1+2）→ 缺 shell 扫描 / 二进制 / vendor 矩阵测试，不影响黄金路径

**每批提交前硬验收**：
- `cd desktop && npx tsc --noEmit -p tsconfig.main.json` 零错
- `cd desktop && npx tsc --noEmit -p tsconfig.renderer.json` 零错
- `pnpm test` 通过（或仅新加测试影响已有，需 review）
- 手动复现用户原用例（xlsx 读取）走黄金路径成功

---

## 8 · 显式 out of scope（下一版）

- **企业管理端下发策略**（cloud → desktop 同步 deny list）—— 契约留口，本次不实现
- **基于内容的敏感信息检测**（读到 API key / credit card 自动标记）
- **MCP tool 路径参数扫描**—— 本次只覆盖 builtin tools，MCP 调用的路径参数不走本策略（因为 MCP 自己是独立进程，路径由 MCP server 处理）
- **Symlink 动态权限**（运行时 link 指向变化的追踪）
- **SiliconPerson 专用策略**（auto_approve 模式下是否豁免路径审批？留一个 TODO 在 code comment 里）
- **跨会话记忆**（"上周允许过的路径本周自动允许 N 小时"）
- **pdf / docx / 音视频** 抽取工具—— Phase 12 只做 xlsx，其它作为 backlog

---

## 9 · 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 现有 `ApprovalRequest` 契约扩展破坏序列化 | 低 | 审批持久化失败 | `pathMeta` 设为可选字段，旧数据兼容 |
| 路径抽取正则误判（`npm install` 被判为路径） | 中 | 用户困惑 | 测试集包含 reject case，正则收紧 |
| 审批卡片合并逻辑在 React 中引入 race | 中 | 重复渲染或丢事件 | Zustand store 单写入点，Immer diff |
| Symlink cycle 导致 realpath 无限 | 低 | hang | Node realpath 自身有上限；额外套超时 |
| 中文路径 NFC 不一致导致 cache miss | 中 | 重复弹框 | Phase 4 测试覆盖；所有比较先 NFC |
| qwen 路由 bug 透到 tool args | 未知 | 策略可能看到畸形路径 | Phase 13 矩阵测试会暴露；真有问题另修 |
| 模型无视 denial 硬重试 | 中 | 体验差 | 10-phase error code + session 内禁同路径重试白名单 |

---

## 10 · 签收前清单

- [ ] 用户复核 D1-D5 决策无异议
- [ ] 用户同意 3 批次提交节奏
- [ ] 用户确认可以在本地开跑（不需要先切分支/worktree）
- [ ] 用户了解 Batch 1 只是后端，UI 要 Batch 2 才能真正看到卡片
- [ ] 签字开工
