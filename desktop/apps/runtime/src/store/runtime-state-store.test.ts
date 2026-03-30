import { homedir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolRiskCategory } from "@myclaw-desktop/shared";

import { resolveRuntimeLayout } from "../services/runtime-layout";
import type { MemoryRecord } from "./memory-store";
import type { PendingWorkItem } from "./pending-work-store";
import {
  loadRuntimeState,
  resolveRuntimeStateFilePath,
  saveRuntimeState,
  type RuntimeState,
} from "./runtime-state-store";
import type { LocalEmployeeSummary } from "@myclaw-desktop/shared";
import type { WorkflowDefinitionSummary } from "@myclaw-desktop/shared";
import { resolveWorkflowLibraryRoots } from "./workflow-library-root-store";
import type initSqlJsType from "sql.js";

describe("runtime state store", () => {
  let tempDir: string | undefined;
  let stateFilePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-runtime-store-"));
    stateFilePath = join(tempDir, "runtime-state.db");
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("stores runtime state in the user-scoped hidden directory by default", () => {
    expect(resolveRuntimeStateFilePath()).toBe(join(homedir(), ".myClaw", "runtime", "state.db"));
  });

  it("uses the provided override path when specified", () => {
    expect(resolveRuntimeStateFilePath("D:/custom/runtime-state.db")).toBe("D:/custom/runtime-state.db");
  });

  it("derives a local runtime layout for employee and workflow assets", () => {
    const layout = resolveRuntimeLayout(stateFilePath);

    expect(layout.rootDir).toBe(tempDir);
    expect(layout.runtimeDir).toBe(tempDir);
    expect(layout.stateFilePath).toBe(stateFilePath);
    expect(layout.runtimeStateFilePath).toBe(stateFilePath);
    expect(layout.employeesDir).toBe(join(tempDir!, "employees"));
    expect(layout.skillsDir).toBe(join(tempDir!, "skills"));
    expect(layout.sessionsDir).toBe(join(tempDir!, "sessions"));
    expect(layout.workflowsDir).toBe(join(tempDir!, "workflows"));
    expect(layout.workflowRootsDir).toBe(join(tempDir!, "workflows", "roots"));
    expect(layout.workflowRunsDir).toBe(join(tempDir!, "workflows", "runs"));
    expect(layout.employeePackagesDir).toBe(join(tempDir!, "employee-packages"));
    expect(layout.memoryDir).toBe(join(tempDir!, "memory"));
    expect(layout.pendingWorkDir).toBe(join(tempDir!, "pending-work"));
    expect(layout.runsDir).toBe(join(tempDir!, "runs"));
    expect(layout.publishDraftsDir).toBe(join(tempDir!, "publish-drafts"));
    expect(layout.logsDir).toBe(join(tempDir!, "logs"));
    expect(layout.cacheDir).toBe(join(tempDir!, "cache"));
  });

  it("persists runtime state in a SQLite database file", async () => {
    const employees: LocalEmployeeSummary[] = [
      {
        id: "employee-a",
        name: "Onboarding Assistant",
        description: "Guides setup and follow-up.",
        status: "active",
        source: "personal",
        workflowIds: ["workflow-a"],
        updatedAt: "2026-03-23T00:00:00.000Z",
      },
    ];
    const workflows: WorkflowDefinitionSummary[] = [
      {
        id: "workflow-a",
        name: "Onboarding Workflow",
        description: "Covers setup and completion checks.",
        status: "draft",
        source: "personal",
        updatedAt: "2026-03-23T00:00:00.000Z",
        version: 1,
        nodeCount: 2,
        edgeCount: 1,
        libraryRootId: "personal",
      },
    ];
    const memoryRecords: MemoryRecord[] = [
      {
        id: "memory-a",
        employeeId: "employee-a",
        kind: "episodic-summary",
        subject: "First run summary",
        content: "The employee learned the workspace startup order.",
        updatedAt: "2026-03-23T00:00:00.000Z",
      },
    ];
    const pendingWorkItems: PendingWorkItem[] = [
      {
        id: "pending-a",
        employeeId: "employee-a",
        workflowId: "workflow-a",
        title: "Check onboarding follow-up",
        status: "waiting",
        dueAt: "2026-03-24T00:00:00.000Z",
        expiresAt: null,
        attemptCount: 0,
        maxAttempts: 3,
        resumePolicy: {
          kind: "time",
          value: "2026-03-24T00:00:00.000Z",
        },
        updatedAt: "2026-03-23T00:00:00.000Z",
      },
    ];

    const inputState: RuntimeState = {
      defaultModelProfileId: "model-a",
      models: [
        {
          id: "model-a",
          name: "Model A",
          provider: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
          model: "gpt-4.1-mini",
          requestBody: {
            reasoning_effort: "medium",
            enable_thinking: true,
          },
        },
      ],
      sessions: [
        {
          id: "session-a",
          title: "Session A",
          modelProfileId: "model-a",
          attachedDirectory: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          messages: [
            {
              id: "msg-a",
              role: "assistant",
              content: "hello",
              reasoning: "inspect project layout first",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
      approvals: {
        mode: "prompt",
        autoApproveReadOnly: true,
        autoApproveSkills: true,
        alwaysAllowedTools: ["fs.read_file"],
      },
      mcpServerConfigs: [
        {
          id: "mcp-filesystem",
          name: "Filesystem MCP",
          source: "manual",
          transport: "stdio",
          command: "npx",
          args: ["@modelcontextprotocol/server-filesystem", "."],
          enabled: true,
        },
        {
          id: "mcp-docs-http",
          name: "Docs MCP",
          source: "cursor",
          transport: "http",
          url: "http://127.0.0.1:8123/mcp",
          headers: {
            Authorization: "Bearer test-token",
          },
          enabled: false,
        },
      ],
      mcpToolPreferences: [
        {
          toolId: "mcp-filesystem:read_file",
          serverId: "mcp-filesystem",
          enabled: true,
          exposedToModel: false,
          approvalModeOverride: "inherit",
          updatedAt: "2026-01-01T00:00:02.000Z",
        },
      ],
      builtinToolPreferences: [
        {
          toolId: "fs.read",
          enabled: true,
          exposedToModel: true,
          approvalModeOverride: "inherit",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          toolId: "exec.command",
          enabled: true,
          exposedToModel: false,
          approvalModeOverride: "always-ask",
          updatedAt: "2026-01-01T00:00:01.000Z",
        },
      ],
      approvalRequests: [],
      employees,
      workflows,
      workflowLibraryRoots: resolveWorkflowLibraryRoots(undefined, resolveRuntimeLayout(stateFilePath)),
      memoryRecords,
      pendingWorkItems,
    };

    await saveRuntimeState(inputState, stateFilePath);
    const fileHeader = readFileSync(stateFilePath, { encoding: "utf8" }).slice(0, 16);
    const loadedState = await loadRuntimeState(stateFilePath);

    expect(fileHeader).toBe("SQLite format 3\0");
    expect(loadedState).toEqual({
      ...inputState,
      mcpServerConfigs: inputState.mcpServerConfigs,
      mcpToolPreferences: [...inputState.mcpToolPreferences].sort((left, right) => left.toolId.localeCompare(right.toolId)),
      builtinToolPreferences: [...inputState.builtinToolPreferences].sort((left, right) =>
        left.toolId.localeCompare(right.toolId),
      ),
    });
    expect(loadedState.workflowLibraryRoots ?? []).toHaveLength(1);
    expect((loadedState.workflowLibraryRoots ?? [])[0]?.id).toBe("personal");
    expect(loadedState.mcpServerConfigs[0]).not.toHaveProperty("health");
    expect(loadedState.mcpServerConfigs[0]).not.toHaveProperty("tools");

    const initSqlJsAsm = (await import("sql.js/dist/sql-asm.js")).default as typeof initSqlJsType;
    const sql = await initSqlJsAsm();
    const db = new sql.Database(readFileSync(stateFilePath));
    const workflowColumns = db.exec("PRAGMA table_info(workflows)")[0]?.values?.map((row) => String(row[1])) ?? [];
    const workflowRows = db.exec("SELECT * FROM workflows");
    db.close();

    expect(workflowColumns).toEqual([
      "position",
      "id",
      "name",
      "description",
      "status",
      "source",
      "updated_at",
      "version",
      "node_count",
      "edge_count",
      "library_root_id",
    ]);
    expect(workflowColumns).not.toContain("nodes");
    expect(workflowColumns).not.toContain("edges");
    expect(workflowRows[0]?.columns).toEqual(workflowColumns);
    expect((workflowRows[0]?.values?.[0] ?? [])).toHaveLength(workflowColumns.length);
  });

  it("persists approval request arguments for resumable execution context", async () => {
    const inputState: RuntimeState = {
      defaultModelProfileId: "model-a",
      models: [
        {
          id: "model-a",
          name: "Model A",
          provider: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
          model: "gpt-4.1-mini",
        },
      ],
      sessions: [],
      approvals: {
        mode: "prompt",
        autoApproveReadOnly: true,
        autoApproveSkills: true,
        alwaysAllowedTools: [],
      },
      mcpServerConfigs: [],
      mcpToolPreferences: [],
      builtinToolPreferences: [],
      approvalRequests: [
        {
          id: "approval-a",
          sessionId: "session-a",
          source: "builtin-tool",
          toolId: "exec.command",
          label: "python scripts/init_workspace.py",
          risk: ToolRiskCategory.Exec,
          detail: "Run skill setup command",
          resumeConversation: true,
          arguments: {
            cwd: "C:/Users/test/.myClaw/skills/br-interview-workspace",
          },
        },
      ],
      employees: [],
      workflows: [],
      workflowLibraryRoots: resolveWorkflowLibraryRoots(undefined, resolveRuntimeLayout(stateFilePath)),
      memoryRecords: [],
      pendingWorkItems: [],
    };

    await saveRuntimeState(inputState, stateFilePath);
    const loadedState = await loadRuntimeState(stateFilePath);

    expect(loadedState.approvalRequests[0]?.arguments).toEqual({
      cwd: "C:/Users/test/.myClaw/skills/br-interview-workspace",
    });
  });

  it("backfills empty employee, workflow, memory, and pending work collections on first load", async () => {
    const loadedState = await loadRuntimeState(stateFilePath);

    expect(loadedState.employees).toEqual([]);
    expect(loadedState.workflows).toEqual([]);
    expect(loadedState.workflowLibraryRoots ?? []).toHaveLength(1);
    expect((loadedState.workflowLibraryRoots ?? [])[0]?.id).toBe("personal");
    expect(loadedState.memoryRecords).toEqual([]);
    expect(loadedState.pendingWorkItems).toEqual([]);
  });

  it("normalizes legacy workflow summaries and missing root metadata during save/load", async () => {
    const legacyState = {
      defaultModelProfileId: "model-a",
      models: [
        {
          id: "model-a",
          name: "Model A",
          provider: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
          model: "gpt-4.1-mini",
        },
      ],
      sessions: [],
      approvals: {
        mode: "prompt",
        autoApproveReadOnly: true,
        autoApproveSkills: true,
        alwaysAllowedTools: [],
      },
      mcpServerConfigs: [],
      mcpToolPreferences: [],
      builtinToolPreferences: [],
      approvalRequests: [],
      employees: [],
      workflows: [
        {
          id: "workflow-legacy",
          name: "Legacy Workflow",
          description: "Legacy summary without graph stats.",
          status: "draft",
          source: "personal",
          updatedAt: "2026-03-24T00:00:00.000Z",
        },
      ],
      workflowLibraryRoots: undefined,
      memoryRecords: [],
      pendingWorkItems: [],
    } as unknown as RuntimeState;

    await saveRuntimeState(legacyState, stateFilePath);
    const loaded = await loadRuntimeState(stateFilePath);

    expect(loaded.workflowLibraryRoots ?? []).toHaveLength(1);
    expect((loaded.workflowLibraryRoots ?? [])[0]?.id).toBe("personal");
    expect(loaded.workflows[0]?.version).toBe(1);
    expect(loaded.workflows[0]?.nodeCount).toBe(0);
    expect(loaded.workflows[0]?.edgeCount).toBe(0);
    expect(loaded.workflows[0]?.libraryRootId).toBe("personal");
  });

  it("rejects runtime state load when workflow root kind in SQLite is invalid", async () => {
    const state: RuntimeState = {
      defaultModelProfileId: "model-a",
      models: [
        {
          id: "model-a",
          name: "Model A",
          provider: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
          model: "gpt-4.1-mini",
        },
      ],
      sessions: [],
      approvals: {
        mode: "prompt",
        autoApproveReadOnly: true,
        autoApproveSkills: true,
        alwaysAllowedTools: [],
      },
      mcpServerConfigs: [],
      mcpToolPreferences: [],
      builtinToolPreferences: [],
      approvalRequests: [],
      employees: [],
      workflows: [],
      workflowLibraryRoots: resolveWorkflowLibraryRoots(undefined, resolveRuntimeLayout(stateFilePath)),
      memoryRecords: [],
      pendingWorkItems: [],
    };

    await saveRuntimeState(state, stateFilePath);
    const initSqlJsAsm = (await import("sql.js/dist/sql-asm.js")).default as typeof initSqlJsType;
    const sql = await initSqlJsAsm();
    const db = new sql.Database(readFileSync(stateFilePath));
    db.run("UPDATE workflow_library_roots SET kind = ? WHERE id = ?", ["invalid-kind", "personal"]);
    writeFileSync(stateFilePath, Buffer.from(db.export()));
    db.close();

    await expect(loadRuntimeState(stateFilePath)).rejects.toThrow(/invalid workflow library root kind/i);
  });

  it("stores workflow_library_roots table with required shape", async () => {
    const inputState: RuntimeState = {
      defaultModelProfileId: "model-a",
      models: [
        {
          id: "model-a",
          name: "Model A",
          provider: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
          model: "gpt-4.1-mini",
        },
      ],
      sessions: [],
      approvals: {
        mode: "prompt",
        autoApproveReadOnly: true,
        autoApproveSkills: true,
        alwaysAllowedTools: [],
      },
      mcpServerConfigs: [],
      mcpToolPreferences: [],
      builtinToolPreferences: [],
      approvalRequests: [],
      employees: [],
      workflows: [],
      workflowLibraryRoots: resolveWorkflowLibraryRoots(
        [
          {
            id: "mounted-a",
            name: "Mounted A",
            path: "D:/external-workflows/mounted-a",
            writable: true,
            kind: "mounted",
            createdAt: "2026-03-24T00:00:00.000Z",
            updatedAt: "2026-03-24T00:00:00.000Z",
          },
        ],
        resolveRuntimeLayout(stateFilePath),
      ),
      memoryRecords: [],
      pendingWorkItems: [],
    };

    await saveRuntimeState(inputState, stateFilePath);
    const initSqlJsAsm = (await import("sql.js/dist/sql-asm.js")).default as typeof initSqlJsType;
    const sql = await initSqlJsAsm();
    const db = new sql.Database(readFileSync(stateFilePath));
    const rootColumns =
      db.exec("PRAGMA table_info(workflow_library_roots)")[0]?.values?.map((row) => String(row[1])) ?? [];
    db.close();

    expect(rootColumns).toEqual([
      "position",
      "id",
      "name",
      "path",
      "writable",
      "kind",
      "created_at",
      "updated_at",
    ]);
  });
});
