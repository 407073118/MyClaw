# API 契约设计入口

## 1. 根层职责

根层只负责指出 API 契约位于哪里，以及变更这些契约时必须同步什么。

## 2. 契约入口

### 2.1 桌面端

- 桌面端共享契约入口：`desktop/packages/shared/src/index.ts`
- 相关消费者：
  - `desktop/apps/runtime`
  - `desktop/apps/desktop`

### 2.2 云端

- 云端共享契约入口：`cloud/packages/shared/src/index.ts`
- 相关消费者：
  - `cloud/apps/cloud-api`
  - `cloud/apps/cloud-web`

## 3. 契约变更规则

- 先改共享契约，再改实现。
- 修改字段、事件、接口响应时，必须同步文档、调用端与测试。
- 破坏性变更必须在对应工作区文档中明确记录。

