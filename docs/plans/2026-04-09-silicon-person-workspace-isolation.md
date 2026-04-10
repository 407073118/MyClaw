# 硅基员工工作空间独立化设计

## 核心理念

每个硅基员工是一个**完全独立的 agent 实例**，拥有自己的 skills、MCP 服务、sessions，
就像主助手拥有完整的 `myClaw/` 工作空间一样。

## 当前问题

| 资源 | 当前设计 | 问题 |
|------|---------|------|
| Skills | 全局 `myClaw/skills/`，person 通过 `skillIds[]` 引用 | 引用未在执行时过滤，所有 session 看到全部 skills |
| MCP | 全局 `myClaw/mcp-servers.json`，person 通过 `mcpServerIds[]` 引用 | 只有一个 McpServerManager，所有 session 看到全部 MCP 工具 |
| Sessions | 全局 `myClaw/sessions/`，通过 `siliconPersonId` 字段关联 | 混在一起，无物理隔离 |
| 执行路径 | `sessions.ts:1585` 取全局 skills，`sessions.ts:1588` 取全局 MCP tools | **完全没有 per-person 过滤** |

## 目标目录结构

```
myClaw/
├── skills/                          # 主助手的 skills
├── sessions/                        # 主助手的 sessions
├── mcp-servers.json                 # 主助手的 MCP 配置
├── models/                          # 全局共享（模型是基础设施）
├── settings.json                    # 全局设置
├── silicon-persons/
│   └── <person-id>/
│       ├── person.json              # 员工元数据
│       ├── runtime.db               # 运行时数据库（已有）
│       ├── skills/                  # 员工自己的 skills（可从 hub 独立下载）
│       ├── sessions/                # 员工自己的 sessions
│       │   └── <session-id>/
│       │       ├── session.json
│       │       └── messages.json
│       └── mcp-servers.json         # 员工自己的 MCP 配置
```

## 设计变更

### 1. 路径基础设施

在 `directory-service.ts` 中新增：

```typescript
export type SiliconPersonPaths = {
  /** 员工数据根目录：<myClawDir>/silicon-persons/<id> */
  personDir: string;
  /** 员工技能目录 */
  skillsDir: string;
  /** 员工会话目录 */
  sessionsDir: string;
  /** 员工 MCP 配置路径 */
  mcpConfigFile: string;
};

export function deriveSiliconPersonPaths(
  paths: MyClawPaths,
  personId: string,
): SiliconPersonPaths;
```

### 2. 员工工作空间运行时

新增 `silicon-person-workspace.ts`：

```typescript
export type SiliconPersonWorkspace = {
  personId: string;
  paths: SiliconPersonPaths;
  skills: SkillDefinition[];
  mcpManager: McpServerManager;
};

/** 懒加载：按需创建，缓存在 Map 中 */
const workspaces = new Map<string, SiliconPersonWorkspace>();

export function getOrCreateWorkspace(
  ctx: RuntimeContext,
  personId: string,
): SiliconPersonWorkspace;

export function refreshWorkspaceSkills(
  workspace: SiliconPersonWorkspace,
): SkillDefinition[];

export function shutdownWorkspace(personId: string): Promise<void>;
```

### 3. 契约变更 (`silicon-person.ts`)

```diff
export type SiliconPerson = {
  id: string;
  name: string;
  ...
- skillIds?: string[];
- mcpServerIds?: string[];
  ...
};
```

不再需要 ID 引用 —— 员工的资源由其目录内容天然决定。

### 4. MCP 管理

`McpServerManager` 构造函数已经接受目录路径参数：
```typescript
constructor(myClawDir: string) {
  this.configFilePath = join(myClawDir, "mcp-servers.json");
}
```

每个员工的工作空间用 `personDir` 创建自己的 McpServerManager 即可，无需改构造函数。

### 5. Hub 下载流程

`cloud:import-skill` 需要新增可选的 `siliconPersonId` 参数：
- 有 personId → 下载到员工的 `skills/` 目录
- 无 personId → 下载到主助手的全局 `skills/` 目录

`cloud:import-mcp` 同理。

### 6. 执行路径改造

`sessions.ts` 中发送消息时的工具解析：

```diff
- const enabledSkills = ctx.state.skills.filter(s => s.enabled && !s.disableModelInvocation);
- const mcpTools = ctx.services.mcpManager?.getAllTools() ?? [];

+ // 判断是否硅基员工 session
+ const workspace = session.siliconPersonId
+   ? getOrCreateWorkspace(ctx, session.siliconPersonId)
+   : null;
+
+ const enabledSkills = workspace
+   ? workspace.skills.filter(s => s.enabled && !s.disableModelInvocation)
+   : ctx.state.skills.filter(s => s.enabled && !s.disableModelInvocation);
+
+ const mcpTools = workspace
+   ? workspace.mcpManager.getAllTools()
+   : ctx.services.mcpManager?.getAllTools() ?? [];
```

### 7. Session 存储改造

硅基员工的 session 存储路径：
- 原：`myClaw/sessions/<sessionId>/`（全局混放）
- 新：`myClaw/silicon-persons/<personId>/sessions/<sessionId>/`

主助手的 session 保持不变。

### 8. 员工创建流程

```
silicon-person:create
  → 创建 person 目录
  → 创建 skills/ 子目录
  → 创建 sessions/ 子目录
  → seedBuiltinSkills(personPaths.skillsDir)  // 初始化内置技能
  → 创建空 mcp-servers.json: []
  → 保存 person.json
```

### 9. 全局保持不变的部分

| 资源 | 为什么全局 |
|------|----------|
| `models/` | 模型配置是基础设施，所有员工共享 |
| `settings.json` | 全局应用设置（审批策略、个人提示词等） |
| `workflows/` | 工作流定义全局，但运行时可按 workflowIds 绑定 |

## 实施顺序

1. **Phase 1**: 路径基础设施 + 目录创建
2. **Phase 2**: 员工工作空间运行时（skills + MCP 独立加载）
3. **Phase 3**: 执行路径改造（per-person 工具解析）
4. **Phase 4**: Session 存储迁移
5. **Phase 5**: Hub 下载路由（skill/MCP 安装到指定员工）
6. **Phase 6**: 契约清理 + UI 适配
7. **Phase 7**: 存量数据迁移
