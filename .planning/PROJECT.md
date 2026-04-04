# MyClaw

## What This Is

MyClaw 是一个企业级 AI 工作平台，包含企业内部统一管理能力的 `cloud` 端，以及面向员工个人工作的 `desktop` 桌面端。当前系统已经具备 Skills、MCP 等基础能力，这一阶段的重点不是扩展新产品线，而是在既有能力上把桌面助手打磨得更强，让模型更会理解用户、更会调用工具、更能连接企业内部系统数据来完成真实工作任务。

## Core Value

让企业员工在个人桌面端获得一个真正会理解工作语境、会使用工具、会调动企业内部数据来完成任务的 AI 助手。

## Requirements

### Validated

- ✓ 企业内部统一管理 Skills 能力 — existing
- ✓ 企业内部统一管理 MCP 能力 — existing
- ✓ 提供桌面端个人助手运行环境（macOS / Windows）— existing
- ✓ 员工可以在桌面端使用个人与企业提供的能力资源 — existing
- ✓ 存在 cloud 与 desktop 双端协同架构 — existing

### Active

- [ ] 优化 desktop 侧模型使用体验，让模型更稳定地完成复杂任务
- [ ] 强化模型工具使用能力，让模型更会选择、组合并执行可用工具
- [ ] 提升模型对不同长度、不同质量用户输入的需求理解能力
- [ ] 让模型能够结合用户职业角色与工作语境给出更贴合的协助
- [ ] 强化 desktop 与企业内部系统的公共数据连接能力，减少数据孤岛

### Out of Scope

- 新增大型产品线（如全量 workflow、硅基员工、企业知识库完整产品化）— 当前阶段优先优化既有 desktop 能力，不把扩张范围作为主线
- 以新增功能数量作为本阶段核心目标 — 当前更关注已有能力的任务完成质量、工具使用质量与理解质量
- 仅围绕本地孤立数据构建助手能力 — 项目明确要求逐步打通企业内部公共数据

## Context

这是一个 brownfield 项目，仓库已经形成 `desktop/` 与 `cloud/` 的双工作区结构，并已完成基础的 Skills、MCP 与桌面运行能力建设。项目面向全公司员工，不是单一团队的局部工具，因此优化方向必须兼顾通用性、企业治理要求和跨系统数据连接能力。

当前你不希望优先开发新功能，而是优先优化已有桌面端能力，尤其是模型在任务执行中的表现。你明确提出，理想状态下模型不仅要“回答得更好”，还要更会用工具解决问题、更能从用户输入中提炼真实需求，并能站在用户职业角色和工作场景的角度思考问题。

项目还有一个长期明确方向：逐步打破企业内部数据孤岛。desktop 本地承载个人侧体验与本地数据，但部分关键公共信息（例如新员工信息及其他指定系统中的企业公共数据）存在于企业内部系统中，后续助手能力必须能安全、可控地连接这些系统数据。

## Constraints

- **Project Stage**: Brownfield optimization first — 项目已有基础功能与既有架构，当前重点是优化而不是大规模新增产品线
- **Platform**: Desktop-first employee assistant — 当前主战场是 `desktop`，需要直接提升员工端使用体验
- **Architecture**: Cloud + desktop split — 企业统一能力与治理在 `cloud`，个人使用与任务执行体验在 `desktop`
- **Users**: Company-wide audience — 面向全公司员工，不能只按单一岗位或试验性工具来设计
- **Data Connectivity**: Must connect internal systems data — 必须考虑企业公共数据的跨系统流通与连接，目标是减少数据孤岛
- **Optimization Goal**: Improve model task performance over feature count — 本阶段优先提升模型完成任务、使用工具、理解需求的能力，而不是堆叠新功能数量

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 当前阶段以 desktop 优化为主 | 用户最直接感受到价值的位置在员工个人工作台 | — Pending |
| 当前阶段不以新增大型功能线为优先 | 现有能力已具备基础，先提升完成任务质量更有杠杆 | — Pending |
| 将 Skills / MCP 视为已验证基础能力 | 这些能力已在项目中实现，是后续优化的起点而不是假设 | — Pending |
| 将“更会完成任务、更会用工具、更会理解用户”作为核心优化目标 | 这是当前项目最重要的产品价值判断 | — Pending |
| 将企业内部公共数据连接视为中长期关键方向 | 项目目标之一是打破数据孤岛，增强企业内数据流通 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? -> Move to Out of Scope with reason
2. Requirements validated? -> Move to Validated with phase reference
3. New requirements emerged? -> Add to Active
4. Decisions to log? -> Add to Key Decisions
5. "What This Is" still accurate? -> Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check - still the right priority?
3. Audit Out of Scope - reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-04 after initialization*
