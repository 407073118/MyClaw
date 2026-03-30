# Agent Context Engineering

## 1. 目标

本文件定义 Agent 在根仓库应该如何获取上下文，避免一上来扫描全仓库，导致噪声过高、边界失真。

## 2. 标准阅读顺序

### 2.1 第一步：机器入口

- 先读根 `AGENTS.md`
- 再读 `docs/agents/harness-rules.md`

### 2.2 第二步：识别任务类型

- 架构边界问题：
  - `docs/architecture/overview.md`
  - `docs/architecture/domain-boundaries.md`
  - `docs/architecture/layering-constraints.md`
- 产品/计划问题：
  - `docs/product/product-backlog.md`
  - `docs/product/feature-plans/*`
- 设计问题：
  - `docs/design/database-schema.md`
  - `docs/design/api-contracts.md`
  - `docs/design/ui-flows/*`
- 流程问题：
  - `docs/processes/*`

### 2.3 第三步：进入具体工作区

- 任务落在 `desktop/` 时，切到 `desktop/AGENTS.md`
- 任务落在 `cloud/` 时，切到 `cloud/AGENTS.md`

## 3. 最小上下文原则

- 先读入口，再读边界，再读局部实现。
- 不因为“怕漏掉信息”就把整个仓库全读一遍。
- 根层文档只帮助判断落点，不替代局部规范。

## 4. 渐进式披露原则

- `AGENTS.md`：机器入口
- `docs/architecture/*`：稳定边界
- `docs/product/*`：目标与计划
- `docs/design/*`：设计细节入口
- `docs/processes/*`：协作流程
- 工作区 `AGENTS.md`：局部实施规范

## 5. Subagents 建议

- 可以按 `desktop/` 与 `cloud/` 并行拆分。
- 可以按文档治理与代码实现并行拆分。
- 不能让多个 Agent 同时改同一契约文件或同一入口文件。


