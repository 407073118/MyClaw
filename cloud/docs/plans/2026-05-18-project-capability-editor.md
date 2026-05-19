# Project Capability Editor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 `projects` 详情页中的接口、Skills、MCP 配置从“多行文本伪表单”升级为真正可编辑、可校验、可保存、可回显的结构化项目配置。

**Architecture:** 保持现有 `projects` 主契约和项目聚合结构不大改，优先补齐 `cloud-api` 的引用校验与 JSON 规范化，再把 `cloud-web` 的项目详情页改造成结构化编辑器，直接消费现有 `skills` 与 `mcp` 列表接口。这样可以最小化后端扩散，同时让项目配置真正具备可用性。

**Tech Stack:** NestJS, Prisma, Nuxt 4, Vue 3, Vitest

---

### Task 1: 补齐 projects 后端校验

**Files:**
- Modify: `F:/MyClaw/cloud/apps/cloud-api/src/modules/projects/services/projects.service.ts`
- Modify: `F:/MyClaw/cloud/apps/cloud-api/src/modules/projects/tests/projects.service.test.ts`

**Step 1: 写失败测试**

- 为 `skills` / `mcps` 引用不存在、release 不匹配、JSON 字段传字符串等场景新增失败用例。
- 断言错误码明确，例如：
  - `project_skill_not_found`
  - `project_skill_release_not_found`
  - `project_skill_release_mismatch`
  - `project_mcp_not_found`
  - `project_mcp_release_not_found`
  - `project_mcp_release_mismatch`
  - `project_api_request_schema_invalid`
  - `project_api_response_schema_invalid`
  - `project_skill_config_invalid`
  - `project_mcp_config_override_invalid`

**Step 2: 运行测试确认失败**

Run: `pnpm --dir apps/cloud-api test -- projects.service.test.ts`

Expected: 新增用例失败，提示当前服务层缺少引用校验或 JSON 校验。

**Step 3: 写最小实现**

- 在 `ProjectsService` 中注入数据库访问能力。
- 新增 `validateSkillRefs` / `validateMcpRefs` / `normalizeProjectJsonObject` 等方法。
- 在 `createProject` / `replaceProjectConfig` 保存前执行校验。
- 保持现有项目聚合形状不变，只增强可用性约束。

**Step 4: 运行测试确认通过**

Run: `pnpm --dir apps/cloud-api test -- projects.service.test.ts`

Expected: `projects.service.test.ts` 全绿。

### Task 2: 改造 projects 详情页为结构化编辑器

**Files:**
- Modify: `F:/MyClaw/cloud/apps/cloud-web/pages/projects/[id].vue`
- Modify: `F:/MyClaw/cloud/apps/cloud-web/tests/pages.test.mjs`

**Step 1: 写失败测试**

- 在 `pages.test.mjs` 中新增断言，要求项目详情页：
  - 不再出现 `repositoriesText` / `apisText` / `skillsText` / `mcpsText`
  - 存在结构化数组编辑状态
  - 存在 Skills / MCP 列表加载逻辑
  - 存在新增、删除能力项的方法
  - 保留 `/api/projects/${id}/config` 的保存链路

**Step 2: 运行测试确认失败**

Run: `pnpm --dir apps/cloud-web test`

Expected: 新断言失败，表明页面还在使用文本拼接方案。

**Step 3: 写最小实现**

- 把项目详情页表单状态改成结构化数组：
  - `repositories`
  - `apis`
  - `skills`
  - `mcps`
- 仓库、接口、Skill、MCP 各自使用独立字段和增删按钮。
- Skill / MCP 通过现有接口拉取候选项：
  - `/api/skills`
  - `/api/skills/:id`
  - `/api/mcp/items`
  - `/api/mcp/items/:id`
- API、Skill 配置、MCP 覆盖配置使用独立 JSON 文本域，而不是把整条记录串成一行。
- 保存前在前端把 JSON 文本解析为对象，并给出中文错误提示。

**Step 4: 运行测试确认通过**

Run: `pnpm --dir apps/cloud-web test`

Expected: `pages.test.mjs` 全绿。

### Task 3: 回归验证

**Files:**
- Verify only

**Step 1: 运行 API 全量测试**

Run: `pnpm --dir apps/cloud-api test`

Expected: API 测试通过，无新增回归。

**Step 2: 运行 Web 页面检查**

Run: `pnpm --dir apps/cloud-web test`

Expected: 页面静态校验通过。

**Step 3: 运行 workspace 关键验证**

Run: `pnpm --dir packages/shared test`

Expected: shared 契约检查通过。
