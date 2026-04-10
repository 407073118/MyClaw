# 工具调用策略优化方案

> 日期：2026-04-09
> 范围：desktop 端
> 前置依赖：task-feature-optimization-design.md（已实施 Phase 1-3）
> 状态：方案设计

---

## 一、问题定义

当前系统有两个独立的维度：

- **Task 系统**（已优化）：模型用 `task_create/update` 拆解用户需求、追踪执行进度 — 管"做什么"
- **工具调用策略**（本方案）：模型如何高效地使用工具来完成每个 task — 管"怎么做"

当前工具调用策略的问题：

| # | 问题 | 现状 |
|---|------|------|
| S1 | 模型不知道可以并行调用工具 | 系统提示词从未提及，模型默认一次一个 |
| S2 | 模型不知道可以迭代循环调用 | 后端支持 200 轮循环，但模型搜一次就答 |
| S3 | effort 级别不影响工具使用深度 | low/medium/high 只改了 guidelines 措辞 |
| S4 | PARALLEL_LIMIT 太保守 | 5 个并发，桌面应用完全可以更高 |

实际表现：用户问"最近 AI 新闻"，模型串行搜索 3 次，每次等一轮，搜完第一个就尝试回答。应该一次并行 3-5 个搜索，结果不够再搜一轮。

---

## 二、核心设计

### 2.1 设计原则

1. **Task 和工具策略是正交的**：Task 拆解"做什么"，工具策略指导"每个 task 里怎么高效用工具"
2. **effort 级别控制工具策略的深度**：不是改措辞，而是完全不同的工具使用方法论
3. **模型自分类**：不在系统侧做请求分类，让模型根据请求类型自适应策略
4. **渐进式提示词**：提示词本身是分阶段的工作流，每一步的产出驱动下一步

### 2.2 提示词架构

在 `buildSystemPrompt` 中，Tools 段落之后、Guidelines 段落之前，新增 `# Tool Strategy` 段落。按 effort 分级输出不同内容：

```
buildSystemPrompt 结构：
  # Identity & Context
  # Task Planning          ← 已优化（管"做什么"）
  # Tools                  ← 已有（工具列表）
  # Tool Strategy          ← 【新增】（管"怎么做"）
  # Skills
  # Guidelines
```

### 2.3 三级工具策略

---

#### LOW effort — 最小工具使用

```
# Tool Strategy
- You can call multiple independent tools in a single response — no need to call them one by one.
- Keep tool usage minimal. One search or file read is usually sufficient.
- Answer directly when you already know the answer.
```

**设计意图**：只告知并行能力，不强制。快问快答。

---

#### MEDIUM effort — 高效并行 + 基本迭代

```
# Tool Strategy

## Parallel Calling
You can call MULTIPLE tools in a single response. When operations are independent, issue them all at once.

Examples:
- Need 3 files? → 3× fs_read in one response (parallel)
- Need to search 2 topics? → 2× web_search in one response (parallel)
- Need git status + file content? → Both in one response (parallel)

BAD: web_search → wait for result → another web_search → wait → ... (sequential, slow)
GOOD: web_search + web_search + web_search in one response (parallel, fast)

## Iterative Gathering
After receiving tool results, assess whether you have enough information:
- If yes → proceed to answer or next task
- If gaps remain → call more tools to fill them

For research questions, expect 1-2 rounds of tool calls before answering.
```

**设计意图**：建立并行意识 + 基本迭代习惯。用具体的 GOOD/BAD 示例让模型理解。

---

#### HIGH effort — 深度研究循环

```
# Tool Strategy (Deep Research Mode)

## Aggressive Parallel Calling
Call up to 10 tools in a single response. NEVER call independent tools one by one.

For information research, plan 3-5 different search queries and issue them ALL at once:
- Vary keywords and angles to maximize coverage
- Mix languages (Chinese + English) for broader sources
- Use specific terms alongside general queries

For code investigation, batch-read all related files in one response:
- Source files, type definitions, tests, configs — read them all at once
- Then read upstream/downstream dependencies in the next round

## Iterative Research Loop (MANDATORY)
One round of tool calls is NEVER enough for deep thinking. Follow this cycle:

  Round 1 — Broad gathering
    Issue multiple parallel tool calls to cover different angles.
    (e.g., 5 web_searches with different queries, or 8 fs_reads for all related files)

  Assess — Review what you received
    What did you learn? What's still unclear? What needs deeper investigation?

  Round 2 — Targeted deep-dive
    Based on gaps identified, issue focused tool calls:
    - http_fetch to read full articles from promising search results
    - fs_read for dependency files that turned out to be relevant
    - Additional web_search with refined queries

  Assess — Is information sufficient?
    Can you give a comprehensive, verified answer? Are there contradictions to resolve?

  Round 3+ — Fill remaining gaps
    Continue gathering until you can answer with confidence.
    There is no round limit — keep going until the information is sufficient.

## Verification
- Cross-reference key facts across multiple sources
- If search results contradict each other, investigate further
- For code changes, read back modified files to verify correctness

## What NOT to Over-Research
Even in deep mode, skip deep research for:
- Direct factual Q&A you already know ("what is a closure?")
- Greetings and clarification questions
- Requests where the user explicitly wants a quick answer
```

**设计意图**：
- "Aggressive" 并行：不是"可以"并行，而是"必须"并行
- 迭代循环作为 MANDATORY 流程：不是建议，是要求
- 给出具体的轮次模式（Broad → Assess → Deep-dive → Assess → Fill gaps）
- 有明确的退出条件（信息充分）和例外（简单问答）

---

### 2.4 运行时改动：PARALLEL_LIMIT

```
当前: const PARALLEL_LIMIT = 5;
改为: const PARALLEL_LIMIT = 10;
```

理由：
- 桌面应用，不共享资源
- `web_search` / `http_fetch` 是网络 IO，10 并发无压力
- `fs_read` / `fs_search` 是本地 IO，SSD 轻松处理
- 模型返回 10 个只读工具调用时，5 个一批要跑两批（两轮 I/O wait），10 一批只需一轮

同时把 `web_search` 和 `http_fetch` 加入 `READ_ONLY_TOOLS`（当前它们不在里面，会走串行路径）：

```typescript
// 当前
const READ_ONLY_TOOLS = new Set([
  "fs.read", "fs.list", "fs.search", "fs.find",
  "git.status", "git.diff", "git.log", "task.list", "task.get",
]);

// 改为
const READ_ONLY_TOOLS = new Set([
  "fs.read", "fs.list", "fs.search", "fs.find",
  "git.status", "git.diff", "git.log", "task.list", "task.get",
  "web.search", "http.fetch",  // 网络只读操作，可安全并行
]);
```

**这是关键改动**：当前 `web_search` 和 `http_fetch` 被归类为非只读（因为它们在 `TOOL_RISK_CATEGORIES` 里是 `Network` 级别），走串行路径。但它们本质上是只读操作（不修改任何状态），完全可以并行执行。不并行的话，模型即使一次返回 5 个 `web_search`，也是一个一个串行等，提示词怎么引导都没用。

---

## 三、完整工作流示例

### 示例 1：信息检索（"帮我看看最近 AI 行业有什么大事"）

**medium effort:**
```
模型: task_create("搜索近期 AI 行业动态")
      task_update(id, "in_progress")
      web_search("2026年4月 AI行业新闻") + web_search("AI latest news April 2026")  ← 2个并行
模型: [审视结果] 信息够了，整理回答
      task_update(id, "completed")
```

**high effort:**
```
模型: task_create("广泛搜索 AI 行业最新动态")
      task_create("深入了解重点事件")  
      task_create("汇总整理成结构化报告")

      task_update(task1, "in_progress")
      web_search("2026年4月 AI行业重大新闻")
      web_search("AI industry news April 2026")
      web_search("GPT-6 Claude 最新发布")
      web_search("国内AI大模型进展 2026年4月")
      web_search("AI startup funding 2026")           ← 5个并行
      
模型: [审视] GPT-6 代号"土豆"、Claude 4.6 发布、DeepSeek V4 进展... 需要深入
      task_update(task1, "completed")
      task_update(task2, "in_progress")
      http_fetch("GPT-6详细报道URL")
      http_fetch("Claude 4.6 changelog URL")
      web_search("DeepSeek V4 华为芯片 详情")          ← 3个并行
      
模型: [审视] 信息充分了
      task_update(task2, "completed")
      task_update(task3, "in_progress")
      [输出结构化报告]
      task_update(task3, "completed")
```

### 示例 2：代码任务（"这个登录接口有 bug，帮我查一下"）

**high effort:**
```
模型: task_create("阅读登录相关代码")
      task_create("定位 bug 根因")
      task_create("修复并验证")

      task_update(task1, "in_progress")
      fs_read("src/auth/login.ts")
      fs_read("src/auth/session.ts")
      fs_read("src/auth/types.ts")
      fs_search("login.*error")
      fs_read("tests/auth.test.ts")                   ← 5个并行

模型: [审视] session 校验逻辑可疑，看看上游调用
      fs_read("src/middleware/auth-middleware.ts")
      fs_read("src/routes/api.ts")                     ← 2个并行
      task_update(task1, "completed")

模型: task_update(task2, "in_progress")
      [分析 bug 根因]
      task_update(task2, "completed")
      
模型: task_update(task3, "in_progress")
      fs_edit(...)
      [修复代码]
      fs_read("src/auth/login.ts")  ← 验证修改结果
      task_update(task3, "completed")
```

---

## 三-B、补充发现：Skills 和 MCP 工具的策略缺失

排查完整工具清单后，发现两个重要遗漏：

### 发现 1：MCP 工具在系统提示词中完全不可见

`buildSystemPrompt` 没有接收 `mcpTools` 参数。MCP 工具只作为 function schema 传给模型，但 prompt 里**没有任何解释**。

模型面对一个叫 `mcp__jira__search_issues` 的工具，只能靠 function schema 里的 description 猜测用途。没有上下文告诉它：
- 这些 `mcp__` 前缀的工具代表**企业内部系统的连接**
- 它们是访问公司数据的重要途径（数据库、项目管理、文档系统等）
- 在需要企业内部信息时应该**优先使用** MCP 工具，而不是去 web_search

**建议**：`buildSystemPrompt` 接收 `mcpTools` 参数，在 Tools 段落中增加 MCP 工具分组说明：

```
## Connected Services (MCP)
You have access to the following enterprise tools via MCP servers.
These connect to internal company systems — use them when you need corporate data.

- mcp__jira__search_issues — Search Jira issues
- mcp__confluence__get_page — Read Confluence pages
- ...

When the user asks about internal projects, tasks, or company data,
prefer these MCP tools over web_search.
```

### 发现 2：Skills 提示词只教"读取指令"，没教"何时该主动触发"

当前 Skills 段落的逻辑是：
1. 列出所有 skill 名称和描述
2. 告诉模型"如果 skill 匹配请求，调用 skill_invoke__* 读取指令"
3. 模型读到 SKILL.md 后按指令操作

**问题**：在深度思考模式下，模型应该更主动地探索 skills：
- 先看看有没有 skill 能帮助解决当前 task
- 一个复杂任务可能需要组合多个 skill
- Skill 输出可以和其他工具结果组合

**建议**：在 high effort 的 Tool Strategy 中加一条规则：

```
## Skill Awareness
Before starting complex tasks, review available skills — a skill may already
encapsulate the workflow you need. Skills can be combined with other tools
in the same task (e.g., invoke a code-review skill, then use its output
to guide your fs_edit calls).
```

### 发现 3：浏览器工具在 web 研究中未被引导

当前 prompt 里浏览器工具的描述是面向"自动化操作"的（click, type, select），但在**深度研究**场景下，浏览器可以用于：
- `browser_open` + `browser_snapshot` 来读取 JS 渲染的页面（`http_fetch` 只能拿到 HTML）
- 绕过某些 `http_fetch` 拿不到内容的网站（反爬、SPA 应用）

**建议**：在 high effort Tool Strategy 中加入：

```
## Web Research Escalation
For information gathering, prefer this escalation order:
1. web_search — Fast, returns summarized results
2. http_fetch — Read full page content from promising URLs
3. browser_open + browser_snapshot — For pages that http_fetch can't render
   (JS-heavy sites, SPAs, pages behind simple interactions)
```

---

## 四、完整改动清单

| 文件 | 改动 | 复杂度 |
|------|------|--------|
| `sessions.ts` buildSystemPrompt 签名 | 增加 `mcpTools` 参数 | 低 |
| `sessions.ts` buildSystemPrompt 内容 | Tools 段后新增 Tool Strategy 段落（按 effort 分级） | 中 |
| `sessions.ts` buildSystemPrompt 内容 | 新增 MCP 工具分组说明段落 | 低 |
| `sessions.ts` buildSystemPrompt 调用处 | 传入 `mcpTools` | 低 |
| `sessions.ts` 常量区 | `PARALLEL_LIMIT` 5 → 10 | 低 |
| `sessions.ts` 常量区 | `READ_ONLY_TOOLS` 添加 `web.search`、`http.fetch` | 低 |

总共 1 个文件，6 处改动。

---

## 五、验证标准

- [ ] medium effort 下，模型对搜索类请求能一次发出 2-3 个并行 web_search
- [ ] high effort 下，模型能一次发出 5+ 个并行工具调用
- [ ] high effort 下，模型搜索后能主动发起第二轮深入搜索（迭代循环）
- [ ] web_search 和 http_fetch 实际走并行执行路径（不再串行）
- [ ] low effort 下，模型行为不变，依然快问快答
- [ ] 简单问答不触发过度搜索
- [ ] 有 MCP 工具连接时，模型在提示词中能看到 MCP 工具的分组说明
- [ ] 企业数据查询场景下，模型优先使用 MCP 工具而非 web_search
- [ ] high effort 下，模型在开始复杂任务前会检查可用 skills
