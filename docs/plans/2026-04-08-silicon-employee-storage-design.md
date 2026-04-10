# 硅基员工存储设计

**Date:** 2026-04-08  
**Scope:** `silicon-persons/` 本地存储结构、`person.json` / `runtime.db` 边界、复制 / 导出 / 备份 / 迁移原则  
**Status:** Design baseline

## 背景

`硅基员工` 的核心目标不是把所有状态都压成一份巨大的 JSON，而是把“可复制、可导出、可长期演进的员工人格”与“运行时历史、会话、任务、审批、状态统计”清晰拆开。这里的主实体是 `SiliconPerson`，它代表一个可以被复制、导出、备份和迁移的独立员工单元。

旧的 `employees` 模块当前是伪代码态，不需要兼容旧数据，也不需要在存储层保留历史包袱。新的设计可以直接重写，优先保证边界清晰、目录可读、后续扩展成本低。

## 目标

1. 建立“每个硅基员工一个文件夹”的本地存储模型，兼顾文件夹级可复制性和数据库级检索能力。
2. 明确 `person.json` 只承载长期、可复制、可导出的稳定数据，不放运行态。
3. 明确 `runtime.db` 承载运行与历史数据，支撑消息检索、索引、未读、状态统计、审批列表和后续扩展。
4. 为复制、导出、备份、迁移提供统一原则，避免未来把运行态误塞回静态配置文件。

## 非目标

1. 本设计不追求兼容旧 `employees` 数据。
2. 本设计不把所有信息都塞进单一 JSON 文件。
3. 本设计不定义云同步协议，只定义本地目录和本地数据边界。

## 总体结构

建议的存储目录如下：

```text
silicon-persons/
  <personId>/
    person.json
    runtime.db
    assets/
```

其中：

- `<personId>` 是稳定的员工目录标识，通常与主实体 `SiliconPerson.id` 对齐。
- `person.json` 是员工“人格快照”。
- `runtime.db` 是员工“运行历史库”。
- `assets/` 用于头像、附件、模板资源、可复制素材等文件型内容。

这个结构的关键价值在于：文件夹天然是一个可搬运、可复制、可打包的单位，但内部又不是靠单个 JSON 承载全部变化。

## `person.json` 边界

`person.json` 只放长期稳定、可复制、可导出的内容。它应当被理解为“这个员工是谁、默认怎么工作、初始绑定了什么能力”的快照，而不是运行日志。

### 建议包含字段

- `id`
- `name`
- `displayName`
- `baseIdentity`
- `rolePersona`
- `approvalMode`
- `modelBindingSnapshot`
- `skills`
- `workflows`
- `featureFlags`
- `schemaVersion`
- `version`
- `createdAt`
- `updatedAt`

### 建议不包含字段

- 当前会话列表
- 消息历史
- 任务执行过程
- 未读状态
- 审批上下文
- 运行态缓存
- 任何只对当前设备、当前进程有效的临时数据

### 示例结构

```json
{
  "id": "sp_001",
  "name": "Sora",
  "displayName": "硅基员工 Sora",
  "baseIdentity": {
    "origin": "human_defined",
    "summary": "擅长产品协作与知识整理"
  },
  "rolePersona": {
    "role": "assistant",
    "tone": "clear, concise, proactive"
  },
  "approvalMode": "inherit",
  "modelBindingSnapshot": {
    "source": "current_config",
    "provider": "openai-compatible",
    "model": "gpt-5.1",
    "effort": "medium"
  },
  "skills": ["research", "writing"],
  "workflows": ["daily-review", "task-triage"],
  "featureFlags": {
    "planningEnabled": true,
    "delegationEnabled": false
  },
  "schemaVersion": 1,
  "version": 3,
  "createdAt": "2026-04-08T00:00:00.000Z",
  "updatedAt": "2026-04-08T00:00:00.000Z"
}
```

这里的重点不是字段多，而是边界稳：任何“会随着一次对话、一轮审批、一次任务执行而变化”的内容，都不应进入 `person.json`。

## `runtime.db` 边界

`runtime.db` 负责所有运行态与历史态数据。建议使用 SQLite 作为本地数据库，因为它在单文件部署、事务一致性、索引检索和后续扩展之间有很好的平衡。

### `runtime.db` 主要职责

- 存储会话、消息、任务和调度记录
- 存储审批队列和审批上下文
- 存储未读状态、处理进度和统计摘要
- 存储运行中产生的 artifacts、键值状态和临时索引
- 支撑按员工维度的历史回溯和检索

### 建议核心表

```text
person_runtime
sessions
messages
tasks
schedules
approvals
artifacts
kv_state
```

### 表职责建议

- `person_runtime`：记录该员工的本地运行版本、最后活跃时间、初始化状态、迁移标记等。
- `sessions`：会话主表，保存会话生命周期、归属员工、状态、摘要和统计信息。
- `messages`：消息明细表，支持全文检索、角色分类、引用关系和排序。
- `tasks`：任务表，承载任务状态、优先级、来源会话、结果摘要。
- `schedules`：周期性或延迟执行项，用于定时任务与回调。
- `approvals`：审批记录表，保存审批请求、审批决策、关联上下文和过期信息。
- `artifacts`：附件、生成物和引用资源索引。
- `kv_state`：轻量键值态，适合少量运行标志、游标和兼容性标识。

### 为什么 SQLite 更合适

SQLite 的优势不只是“本地简单”，而是它刚好满足硅基员工的几个关键需求：

- 消息检索更容易做索引，不必在大 JSON 里扫描
- 未读数、状态统计、最近活跃项可以直接查询
- 审批列表、任务列表、会话列表天然适合表结构
- 后续增加全文索引、归档策略、统计字段时，不必破坏 `person.json`
- 数据仍然可以跟随文件夹整体复制，保留“员工目录即实体”的直觉

## 复制、导出、备份

### 复制原则

复制语义采用“人格模板复制”，也就是复制 `person.json` 和 `assets/`，并初始化一个空的 `runtime.db`。

复制时必须重置或重新生成：

- 标识
- 创建时间
- 更新时间
- 运行态缓存
- 历史会话
- 历史消息
- 历史任务
- 未读状态
- 审批上下文
- 任何当前执行中的 runtime 记录

复制的目标不是“克隆一份完整历史”，而是“基于一个人格模板生成一个新的独立员工”。

### 导出原则

导出应优先支持两类形态：

1. `person.json` + `assets/` 的人格导出
2. 包含 `runtime.db` 的完整本地备份导出

前者适合复用和分享员工人格，后者适合故障恢复和完整迁移。

### 备份原则

备份建议以文件夹为单位，但要区分两种备份目标：

- 轻量备份：保留 `person.json` 和 `assets/`
- 完整备份：包含 `runtime.db`

这样可以同时满足“恢复一个员工人格”和“恢复整个工作现场”两种需求。

## 迁移原则

迁移时保持以下规则：

- `person.json` 作为稳定契约，优先做向后兼容
- `runtime.db` 作为运行库，允许更频繁的 schema 演进
- 迁移时先确保 `person.json` 可读，再处理数据库升级
- 若版本不一致，优先通过 `schemaVersion` 和 `version` 做渐进升级

对本地存储来说，`person.json` 更像产品级契约，`runtime.db` 更像内部运行实现。两者升级节奏不应强绑在一起。

## 为什么不用纯 JSON

纯 JSON 的问题不在于“不能读”，而在于它不适合持续运行的复杂状态。

### 主要问题

- 会话和消息一多，文件会迅速膨胀
- 索引、检索、统计和去重都变得笨重
- 任何小更新都可能导致整份文件重写
- 审批、未读、状态聚合这类查询会越来越不自然
- 运行态和长期配置混在一起，复制、导出、恢复都会变复杂

### 选择混合方案的原因

混合方案保留了 JSON 的可读性和文件夹级可复制性，也保留了数据库的查询和事务优势。对 `硅基员工` 来说，这是比“全 JSON”或“全数据库”都更平衡的方案。

## 统一约束

1. `person.json` 只承载长期、可复制、可导出的员工人格信息。
2. `runtime.db` 承载运行、历史、索引和统计信息。
3. `assets/` 只放文件型资源，不放运行时临时数据。
4. `personId` 对应一个独立目录，一个目录对应一个 `SiliconPerson`。
5. 复制时默认重建 runtime，不复制历史。

## 需要主线程确认的点

1. `personId` 的最终命名规则是否需要区分展示名与稳定 ID。
2. `person.json` 中 `skills`、`workflows` 是否需要进一步拆成可扩展对象结构。
3. `runtime.db` 的初始 schema 是否要预留全文索引和审计日志表。
4. 是否需要在导出格式里显式区分“人格包”和“完整备份包”。
