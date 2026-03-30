# Runtime Refactor Design

**日期：** 2026-03-27

## 背景

`desktop/apps/runtime` 已经出现明显的结构债：

- [`desktop/apps/runtime/src/server.ts`](/f:/MyClaw/desktop/apps/runtime/src/server.ts) 约 3076 行，混合了启动装配、HTTP 路由、payload 解析、审批续跑、会话流式输出、workflow 适配、模型工具编排。
- [`desktop/apps/runtime/src/store/runtime-state-store.ts`](/f:/MyClaw/desktop/apps/runtime/src/store/runtime-state-store.ts) 约 1477 行，混合了 SQLite runtime、schema、legacy 兼容、默认态装配、各领域表映射与 sanitizer。
- [`desktop/apps/runtime/src/services/model-provider.ts`](/f:/MyClaw/desktop/apps/runtime/src/services/model-provider.ts) 约 1459 行，混合了 provider 门面、类型契约、默认工具 schema、OpenAI-compatible、Anthropic、SSE 增量解析。
- 测试组织不统一：有的测试和源文件同目录，有的 server 集成测试直接堆在 `src/` 根部，导致阅读和并行改造成本都很高。

## 标准结构调研结论

先说结论：TypeScript / Vitest 并没有一个唯一强制的“标准目录”，但官方工具明确支持两种模式：

- Vitest 官方默认会匹配 `*.test.*` / `*.spec.*`，说明 colocated tests 是被官方支持的，不是天然错误。
- TypeScript 官方在 project references 示例里使用 `src` / `tests` 等分项目结构，说明把测试拆到独立目录同样是合理做法。

因此，本仓库现在真正的问题不是“测试和源码同目录”这件事本身，而是：

- 策略不一致；
- 超大文件没有按职责拆；
- 集成测试、契约测试、纯函数单测没有分层；
- 入口文件同时承担太多变化轴。

结合当前 `runtime` 的复杂度，推荐采用更明确的结构化方案：

- 源码严格按职责拆目录。
- 测试整体迁移到独立 `tests/` 树。
- 只在极少数纯工具模块里保留同目录测试作为过渡，不再新增这种模式。

参考：

- Vitest Config: https://vitest.dev/config/
- TypeScript Project References: https://www.typescriptlang.org/docs/handbook/project-references

## 目标

本次 refactor 目标不是“顺手美化”，而是把 `runtime` 改造成可持续维护、可并行开发、可局部测试的结构：

1. 把 1000+ 行的大文件拆成稳定门面 + 内部模块。
2. 保持现有 runtime API 契约不变，优先内部重构。
3. 把测试按 `unit / integration / contract` 分层。
4. 为多 agent 并行开发建立清晰写入边界。
5. 把编码风险单列为门禁，避免在中文注释和日志上继续扩散乱码。

## 可选方案

### 方案 A：只拆文件，不改目录

优点：

- 改动最小。
- 回归风险较低。

缺点：

- 只是把大文件拆成多个同层文件，边界依旧模糊。
- 未来继续膨胀的概率很高。
- 对多 agent 并行帮助有限。

结论：不推荐。

### 方案 B：按技术层拆目录

示例：

- `src/http/*`
- `src/store/*`
- `src/model/*`

优点：

- 比当前结构清晰。
- 容易从现状迁移。

缺点：

- `server.ts` 这种“跨层聚合器”仍然容易变胖。
- 业务域边界仍不够清楚。

结论：可做过渡，但不是最优。

### 方案 C：稳定门面 + 领域子目录 + 独立 tests

优点：

- 最适合当前 `runtime` 的复杂度。
- 便于并行改造。
- 能同时解决大文件、测试混乱、入口过胖三个问题。

缺点：

- 初期需要补一层门面与 barrel。
- 需要更明确的迁移顺序。

结论：推荐采用本方案。

## 推荐目录

```text
desktop/apps/runtime/
  src/
    index.ts
    server/
      index.ts
      create-runtime-app.ts
      runtime-context.ts
      http/
        router.ts
        session-stream.ts
        payloads/
          common.ts
          approvals.ts
          employees.ts
          workflows.ts
          mcp.ts
          model-profiles.ts
      chat/
        conversation-service.ts
        model-tools.ts
        tool-intent.ts
      workflows/
        runtime-adapter.ts
      routes/
        bootstrap.ts
        cloud-hub.ts
        skills.ts
        packages.ts
        employees.ts
        workflow-runs.ts
        workflows.ts
        pending-work.ts
        mcp.ts
        model-profiles.ts
        tools.ts
        sessions.ts
        approvals.ts
    services/
      model-provider/
        index.ts
        types.ts
        shared/
          http.ts
          text.ts
        openai-compatible/
          flavor.ts
          messages.ts
          parser.ts
          sse.ts
          client.ts
          conversation.ts
        anthropic/
          messages.ts
          parser.ts
          sse.ts
          client.ts
          conversation.ts
      ...
    store/
      runtime-state-store.ts
      runtime-state/
        sqlite.ts
        schema.ts
        bootstrap.ts
        legacy.ts
        codecs/
          sessions.ts
          approvals.ts
          mcp.ts
          workflows.ts
          workflow-roots.ts
          memory.ts
          pending-work.ts
        shared/
          parsing.ts
  tests/
    unit/
      server/
      services/
      store/
    integration/
      server/
      services/
      store/
    contract/
      runtime-api/
```

## 分层原则

### 1. `src/index.ts`

- 只保留进程启动。
- 不再直接承载业务逻辑。

### 2. `src/server/*`

- `server/index.ts` 或 `create-runtime-app.ts` 只负责装配。
- `runtime-context.ts` 集中托管共享依赖和持久化提交接口。
- `routes/*` 每个文件只负责一个 API 域。
- `http/payloads/*` 只放 request 解析和输入校验。

### 3. `src/services/model-provider/*`

- `index.ts` 保持当前外部门面。
- 厂商差异留在各自子目录。
- 公共类型独立，避免 `builtin-tool-registry.ts` 继续反向依赖实现文件。

### 4. `src/store/runtime-state/*`

- `runtime-state-store.ts` 退化为 facade。
- `schema/sqlite/legacy/bootstrap` 四类能力拆开。
- 各领域表映射拆成 codec。

### 5. `tests/*`

- `unit/` 只测纯函数或单模块行为。
- `integration/` 测 runtime 内部组合行为，例如 server 路由、state 持久化 round-trip。
- `contract/` 测 runtime 对 UI 的公开契约，例如 bootstrap、sessions、approvals、streaming。

## 核心设计决策

### 决策 1：保外部契约，先改内部结构

第一阶段不改这些导出门面：

- `src/server.ts` 对外的 `createRuntimeApp`
- `src/store/runtime-state-store.ts` 对外的 `load/save/exists/path`
- `src/services/model-provider.ts` 对外的 `runModelConversation/testModelProfileConnectivity`

这能让 `desktop/apps/desktop` 和 runtime 现有测试先不受影响。

### 决策 2：测试迁移到独立目录

虽然 Vitest 支持 colocated tests，但对当前仓库不再推荐继续混放，原因是：

- `runtime` 里已经有大量 integration 级测试，不再适合和源文件平铺。
- 多 agent 并行时，源码目录和测试目录分离更容易控写入范围。
- server / store / provider 的重构会牵动大量测试，独立 `tests/` 更清晰。

### 决策 3：先抽“纯函数和协议层”，后抽“共享状态和路由”

优先抽离：

- payload parsing
- type guards
- schema / sqlite helpers
- provider parser / sse helpers

后处理：

- `sessions + approvals + continueModelConversation`
- `persistState()` 汇合点
- `runtime-context` 的共享闭包状态

这是因为后者耦合最强，不适合一开始并行大拆。

## 多 Agent 并行方案

可以并行，但必须先做一个很小的 Phase 0 来建边界。

### Phase 0：主 Agent 先做

主 Agent 负责：

- 建立新目录骨架。
- 加 `vitest.config.ts`。
- 定义 `tests/` 目录约定。
- 把 `server.ts` / `runtime-state-store.ts` / `model-provider.ts` 的门面边界固定下来。
- 建立 `runtime-context.ts` 和 facade barrel。

只有这个阶段做完，后面多个 agent 才不会互相踩文件。

### Phase 1：可以并行的 4 条 lane

Lane A：`server` 拆分

- 写入范围：
  - `src/server/**`
  - `tests/integration/server/**`
- 不可改：
  - `src/store/**`
  - `src/services/model-provider/**`

Lane B：`runtime-state` 拆分

- 写入范围：
  - `src/store/runtime-state/**`
  - `src/store/runtime-state-store.ts`
  - `tests/unit/store/**`
  - `tests/integration/store/**`
- 不可改：
  - `src/server/**`
  - `src/services/model-provider/**`

Lane C：`model-provider` 拆分

- 写入范围：
  - `src/services/model-provider/**`
  - `tests/unit/services/model-provider/**`
  - `tests/integration/services/model-provider/**`
- 不可改：
  - `src/server/**`
  - `src/store/**`

Lane D：测试迁移与配置

- 写入范围：
  - `vitest.config.ts`
  - `tests/**`
- 不可改：
  - 核心实现文件逻辑

### Phase 2：主 Agent 收口

主 Agent 统一处理：

- barrel/export 调整
- import 路径收敛
- 交叉测试修复
- 契约回归验证
- 乱码门禁检查

## 迁移顺序

### 阶段 1：建立稳定门面

- `server.ts` 先变薄，但导出不变。
- `runtime-state-store.ts` 先变薄，但导出不变。
- `model-provider.ts` 先变薄，但导出不变。

### 阶段 2：抽纯模块

- `payloads/*`
- `runtime-state/schema/sqlite/shared`
- `model-provider/shared/*`
- `openai-compatible/*`
- `anthropic/*`

### 阶段 3：抽领域模块

- `routes/*`
- `runtime-state/codecs/*`
- `server/workflows/*`
- `server/chat/*`

### 阶段 4：迁移测试

- `server.*.test.ts` 移到 `tests/integration/server/*`
- `runtime-state-store.test.ts` 拆成 facade / schema / legacy / codec 多层测试
- `model-provider.test.ts` 拆成 facade / openai / anthropic / parser / sse 多层测试

### 阶段 5：清理与验证

- 删除空壳旧实现
- 去掉无用 re-export
- 检查编码与乱码
- 运行全部验证

## 风险与门禁

### 风险 1：共享状态导致假拆分

如果只是把代码剪到新文件，但继续直接捕获 `createRuntimeApp` 内部的大量 `let` 状态，结构不会真正改善。

处理方式：

- 先引入 `runtime-context.ts`
- 统一通过 context 访问共享状态与 side effects

### 风险 2：`persistState()` 漏调

这是当前 runtime 的关键副作用汇合点。

处理方式：

- 抽成 context method
- 所有写操作 route 必须显式调用
- 保留 integration test 覆盖

### 风险 3：model-provider 厂商特例丢失

Qwen、MiniMax、Anthropic SSE 的细节都属于行为契约，不是“内部实现细节”。

处理方式：

- 先拆测试，再拆实现
- provider facade 保持稳定

### 风险 4：中文编码继续损坏

当前多个 runtime 文件已经出现中文乱码痕迹，这不是 refactor 过程中可以忽略的小问题。

处理方式：

- 所有涉及中文的文件先读再改
- 改后复读
- 最后执行乱码门禁扫描

## 验证要求

至少执行：

```powershell
pnpm --dir desktop/packages/shared build
pnpm --dir desktop/apps/runtime test
pnpm --dir desktop/apps/runtime build
pnpm --dir desktop/apps/desktop test
pnpm --dir desktop/apps/desktop build
```

乱码门禁：

```powershell
$pattern = ([string][char]0xFFFD) + "|" + ([string][char]0x951F) + "|" + ([string][char]0x00C3) + "|" + ([string][char]0x00D0) + "|\\?/h[1-6]>"
rg -n $pattern desktop/apps/runtime docs *.md
```

## 推荐执行结论

建议立刻开始，但不要“一次性大爆破”，而是按下面方式推进：

1. 主 Agent 先建立 facade + 目录骨架 + tests 目录。
2. 之后 3 个 agent 并行拆 `server`、`runtime-state`、`model-provider`。
3. 最后由主 Agent 统一收口测试、契约和乱码检查。

这次重构是值得做的，而且现在就该做；再拖下去，`runtime` 的开发速度只会继续下降。
