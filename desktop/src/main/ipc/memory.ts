import { ipcMain } from "electron";

import type {
  AddMemoryRootInput,
  CreateMemoryMemoInput,
  MemoryContextPackRequest,
  MemorySearchRequest,
} from "@shared/contracts";
import type { RuntimeContext } from "../services/runtime-context";

/** 获取记忆库服务，缺失时抛出明确错误，避免 IPC 静默返回空数据。 */
function getMemoryVault(ctx: RuntimeContext) {
  const service = ctx.services.memoryVault;
  if (!service) {
    throw new Error("memory vault service is unavailable");
  }
  return service;
}

/** 注册记忆库 IPC 通道，renderer 只能通过这些结构化接口访问本地文件记忆。 */
export function registerMemoryHandlers(ctx: RuntimeContext): void {
  ipcMain.handle("memory:list-roots", async () => {
    console.info("[memory-ipc] 列出记忆根目录");
    return { items: getMemoryVault(ctx).listRoots() };
  });

  ipcMain.handle("memory:add-root", async (_event, input: AddMemoryRootInput) => {
    console.info("[memory-ipc] 添加记忆根目录", { path: input.path, mode: input.mode });
    const item = await getMemoryVault(ctx).addRoot(input);
    return { item };
  });

  ipcMain.handle("memory:remove-root", async (_event, rootId: string) => {
    console.info("[memory-ipc] 移除记忆根目录", { rootId });
    return await getMemoryVault(ctx).removeRoot(rootId);
  });

  ipcMain.handle("memory:rescan-root", async (_event, rootId: string) => {
    console.info("[memory-ipc] 重扫记忆根目录", { rootId });
    return { status: await getMemoryVault(ctx).rescanRoot(rootId) };
  });

  ipcMain.handle("memory:create-memo", async (_event, input: CreateMemoryMemoInput) => {
    console.info("[memory-ipc] 创建记忆备忘录", { rootId: input.rootId, title: input.title });
    const item = await getMemoryVault(ctx).createMemo(input);
    return { item };
  });

  ipcMain.handle("memory:search", async (_event, input: MemorySearchRequest) => {
    console.info("[memory-ipc] 搜索记忆库", { query: input.query, limit: input.limit });
    return await getMemoryVault(ctx).search(input);
  });

  ipcMain.handle("memory:get-context-pack", async (_event, input: MemoryContextPackRequest) => {
    console.info("[memory-ipc] 生成记忆上下文证据包", { query: input.query, limit: input.limit });
    return await getMemoryVault(ctx).getContextPack(input);
  });

  ipcMain.handle("memory:list-candidates", async () => {
    console.info("[memory-ipc] 列出候选记忆");
    return { items: await getMemoryVault(ctx).listCandidates() };
  });

  ipcMain.handle("memory:approve-candidate", async (_event, candidateId: string) => {
    console.info("[memory-ipc] 审批候选记忆", { candidateId });
    return { item: await getMemoryVault(ctx).approveCandidate(candidateId) };
  });

  ipcMain.handle("memory:reject-candidate", async (_event, candidateId: string) => {
    console.info("[memory-ipc] 拒绝候选记忆", { candidateId });
    return { item: await getMemoryVault(ctx).rejectCandidate(candidateId) };
  });
}
