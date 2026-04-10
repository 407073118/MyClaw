# MyClaw Desktop Bug Fix Tracker

> 审计时间: 2026-04-09 | 共计 15 个问题 | 已修复 13 个 | 跳过 2 个 | 按严重度排序修复
>
> 验证结果: TypeScript 编译 0 错误 | 测试从 51 失败降至 15 失败 (36 个测试修复)

## 修复进度

| # | 严重度 | 问题 | 文件 | 状态 |
|---|--------|------|------|------|
| 01 | CRITICAL | `trackSave()` 从未调用，优雅退出形同虚设 | `ipc/silicon-persons.ts` + 3 files | DONE |
| 02 | CRITICAL | MiniMax 适配器丢弃多模态(array)内容 | `provider-adapters/minimax.ts` | DONE |
| 03 | CRITICAL | `onToolCallDelta` 回调已定义但未接线 | `model-client.ts`, `model-sse-parser.ts` | DONE |
| 04 | HIGH | 乱码文本 `绀轰緥锛?` | `builtin-tool-executor.ts:357` | DONE |
| 05 | HIGH | MCP 工具名称碰撞无去重检测 | `tool-schemas.ts` | DONE |
| 06 | HIGH | Session 元数据与消息分两次写文件非原子 | `state-persistence.ts` | DONE |
| 07 | HIGH | 硅基员工内存先改磁盘后写，失败不回滚 | `ipc/silicon-persons.ts` | DONE |
| 08 | HIGH | HubPage useEffect 依赖数组不完整 | `pages/HubPage.tsx` | DONE |
| 09 | HIGH | "employee-package" 术语迁移未完成 | 多文件 | SKIP (API 契约) |
| 10 | MEDIUM | HubPage 详情加载异常被静默吞掉 | `pages/HubPage.tsx` | DONE |
| 11 | MEDIUM | 非 exec_command 工具无超时保护 | `builtin-tool-executor.ts` | DONE |
| 12 | MEDIUM | 工具输出截断阈值不一致(8000 vs 2000) | `sessions.ts`, `context-compactor.ts` | SKIP (设计如此) |
| 13 | MEDIUM | AppShell 工作流 Stream 闭包过期 | `layouts/AppShell.tsx` | DONE |
| 14 | MEDIUM | MiniMax URL 子串匹配过于宽松 | `model-client.ts` | DONE |
| 15 | LOW | `state-persistence.ts` 变量 shadowed | `state-persistence.ts` | DONE |

---

## 修复记录

### BUG-01: `trackSave()` 从未调用
- **状态**: PENDING
- **根因**: `index.ts:26` 定义了 `trackSave()` 用于追踪异步保存，`before-quit` 事件会等待 `pendingSaves`。但 `silicon-persons.ts` 的 `saveSiliconPerson()` 使用 `.catch()` fire-and-forget，没有注册到 `pendingSaves` 中。
- **方案**: 在 `silicon-persons.ts` 中 import `trackSave`，包裹所有 `saveSiliconPerson()` 调用。
- **影响下游**: 修复后 BUG-07（内存/磁盘一致性）仍需单独处理，因为 trackSave 只解决退出时等待，不解决写失败回滚。
- **修复范围**: `silicon-persons.ts`(2处)、`cloud.ts`(2处)、`sessions.ts`(1处)、`workflows.ts`(9处)，共 14 处 fire-and-forget save 全部包裹 `trackSave()`。
- **状态**: DONE

---

### BUG-02: MiniMax 适配器丢弃多模态内容
- **状态**: PENDING
- **根因**: `minimax.ts:30` 中 `typeof message.content === "string" ? message.content : null`，当 content 是 array（图片+文本）时变 null。
- **方案**: 增加 array content 的处理：提取文本部分拼接，同时保留原始结构传递给 API。
- **修复**: 在 `materializeMiniMaxReplayMessage` 中新增 `Array.isArray` 分支，从多模态数组中提取 `type: "text"` 的部分拼接为字符串。assistant 重放场景下图片无法嵌入 `<think>` 格式，退化为纯文本重放。
- **状态**: DONE

---

### BUG-03: onToolCallDelta 回调已定义但未接线
- **状态**: PENDING
- **根因**: `model-client.ts:58` 定义了 `onToolCallDelta` 回调，但 `consumeSseStream()` 调用时未传入该回调。
- **方案**: 将 `onToolCallDelta` 传入 SSE parser，在工具调用增量到达时触发回调。
- **修复**: 
  1. `model-sse-parser.ts`: `applySseChunk` 和 `consumeSseStream` 增加 `onToolCallDelta` 参数
  2. `applySseChunk` 内工具调用 arguments 增量处触发 `onToolCallDelta`
  3. `model-client.ts`: 从 `options` 解构 `onToolCallDelta` 并传入 `consumeSseStream`
- **状态**: DONE

---

### BUG-04: 乱码文本
- **状态**: PENDING
- **根因**: `builtin-tool-executor.ts:357` 编码损坏的中文 `绀轰緥锛?`
- **修复**: 替换为正确中文 `示例：`
- **状态**: DONE

---

### BUG-05: MCP 工具名称碰撞无去重
- **状态**: PENDING
- **根因**: `tool-schemas.ts` 中 MCP 工具 ID 经 `replace(/[^a-zA-Z0-9_-]/g, "_")` 净化后可能碰撞，Skill 有去重但 MCP 没有。
- **修复**: 参照 Skill 去重模式，添加 `usedMcpNames` Set + 后缀递增去重逻辑。
- **状态**: DONE

---

### BUG-06: Session 元数据与消息非原子写入
- **状态**: PENDING
- **根因**: `state-persistence.ts` 先写 `session.json` 再写 `messages.json`，两次独立 atomicWrite。中间崩溃会导致元数据更新但消息未更新。
- **修复**: 调换写入顺序，先写 `messages.json` 再写 `session.json`。`session.json` 作为"提交标记"——未写完则保留上一版本，加载时不会出错。
- **状态**: DONE

---

### BUG-07: 硅基员工内存先改磁盘后写，失败不回滚
- **状态**: PENDING
- **根因**: `silicon-persons.ts` 中先 push/更新内存，然后 async 写盘。写盘失败时内存已改但磁盘没变。
- **方案**: 改 fire-and-forget 为 await，写盘失败时回滚内存并向前端抛错。
- **修复**: create 失败时 splice 移除；update 失败时恢复 `current` 快照。移除了不再需要的 `trackSave` import。
- **影响**: BUG-01 中对 silicon-persons.ts 的 trackSave 包裹现已被 await 替代，不影响其他文件。
- **状态**: DONE

---
