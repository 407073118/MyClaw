# 架构总览

## 1. 仓库定位

根仓库不直接承载单一业务运行时，它负责聚合 `desktop/` 与 `cloud/` 两个工作区，并统一维护跨工作区的规范、文档目录和 Agent 入口。

## 2. 一级结构

### 2.1 `desktop/`

- 主产品工作区。
- 包含：
  - `apps/desktop`：桌面 UI 与 Tauri 壳。
  - `apps/runtime`：本地 runtime、审批、工作流、工具执行。
  - `packages/shared`：桌面端共享契约。

### 2.2 `cloud/`

- 云端工作区。
- 包含：
  - `apps/cloud-api`：认证、Hub、工件、安装留痕 API。
  - `apps/cloud-web`：管理台。
  - `packages/shared`：云端共享契约。
  - `infra`：基础设施编排。
  - `tests`：workspace 级检查。

### 2.3 `docs/`

- 只放根层治理文档，不替代各工作区内部文档。
- 采用标准化目录：
  - `architecture/`
  - `product/`
  - `design/`
  - `processes/`
  - `agents/`

## 3. 根层职责

根层负责：

- 提供机器入口与人类入口。
- 定义跨工作区硬规则。
- 给出架构、流程、上下文索引。
- 指导 Agent 进入正确工作区而不是在根层盲改。

根层不负责：

- 描述某个工作区全部实现细节。
- 承载某个子项目的局部开发说明。
- 替代 `desktop/` 或 `cloud/` 自己的 `AGENTS.md` 与 docs。

