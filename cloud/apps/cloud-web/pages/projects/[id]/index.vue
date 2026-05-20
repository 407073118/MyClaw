<script setup lang="ts">
import type {
  McpItemDetail,
  McpItemSummary,
  ProjectApiDirection,
  ProjectApiParameterInfo,
  ProjectApiProtocol,
  ProjectApiRequestBodyType,
  ProjectApiSource,
  ProjectDetail,
  ProjectRepositoryType,
  ProjectServiceInfo,
  ProjectStatus,
  ReplaceProjectConfigInput,
  SkillDetail,
  SkillSummary
} from "@myclaw-cloud/shared";

type ProjectRepositoryFormItem = {
  defaultBranch: string;
  description: string;
  enabled: boolean;
  gitUrl: string;
  name: string;
  repoType: ProjectRepositoryType;
};

type ProjectServiceFormItem = {
  baseUrl: string;
  description: string;
  enabled: boolean;
  name: string;
};

type ProjectApiFormItem = {
  description: string;
  direction: ProjectApiDirection;
  enabled: boolean;
  method: string;
  name: string;
  owner: string;
  path: string;
  protocol: ProjectApiProtocol;
  parametersText: string;
  requestBodyContentType: string;
  requestBodyExampleText: string;
  requestBodyType: ProjectApiRequestBodyType;
  requestSchemaText: string;
  responseSchemaText: string;
  serviceName: string;
  source: ProjectApiSource;
  tagsText: string;
};

type ProjectSkillFormItem = {
  alias: string;
  configText: string;
  enabled: boolean;
  skillId: string;
  skillReleaseId: string;
};

type ProjectMcpFormItem = {
  alias: string;
  configOverrideText: string;
  enabled: boolean;
  mcpReleaseId: string;
  mcpServerId: string;
  riskLevel: string;
};

type ProjectConfigAction = "service" | "repository" | "api" | "skill" | "mcp";
type ProjectConfigModalMode = "add" | "edit";

type ProjectConfigModalDraft = {
  api: ProjectApiFormItem;
  mcp: ProjectMcpFormItem;
  repository: ProjectRepositoryFormItem;
  service: ProjectServiceFormItem;
  skill: ProjectSkillFormItem;
};

const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "维护中",
  archived: "已归档"
};

const REPOSITORY_TYPE_OPTIONS: { label: string; value: ProjectRepositoryType }[] = [
  { value: "frontend", label: "前端" },
  { value: "backend", label: "后端" },
  { value: "service", label: "服务" },
  { value: "mobile", label: "移动端" },
  { value: "infra", label: "基础设施" },
  { value: "other", label: "其他" }
];

const API_DIRECTION_OPTIONS: { label: string; value: ProjectApiDirection }[] = [
  { value: "provided", label: "对外提供" },
  { value: "consumed", label: "对外消费" }
];

const API_METHOD_OPTIONS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

const API_BODY_TYPE_OPTIONS: { label: string; value: ProjectApiRequestBodyType }[] = [
  { value: "none", label: "无 Body" },
  { value: "json", label: "JSON" },
  { value: "form-data", label: "Form Data" },
  { value: "x-www-form-urlencoded", label: "x-www-form-urlencoded" },
  { value: "raw", label: "Raw" },
  { value: "binary", label: "Binary" },
  { value: "graphql", label: "GraphQL" }
];

const MCP_RISK_OPTIONS = [
  { value: "", label: "未标注" },
  { value: "low", label: "低风险" },
  { value: "medium", label: "中风险" },
  { value: "high", label: "高风险" }
] as const;

const route = useRoute();
const { user } = useCloudSession();
const projectId = computed(() => String(route.params.id ?? ""));
const detailError = ref("");
const savePending = ref(false);
const addModalError = ref("");
const activeAddModalAction = ref<ProjectConfigAction | null>(null);
const projectConfigModalMode = ref<ProjectConfigModalMode>("add");
const editingResourceId = ref<number | null>(null);
const skillDetailMap = reactive<Record<string, SkillDetail | null>>({});
const mcpDetailMap = reactive<Record<string, McpItemDetail | null>>({});
const skillDetailLoading = new Set<string>();
const mcpDetailLoading = new Set<string>();
const addModalDraft = reactive<ProjectConfigModalDraft>(createProjectConfigModalDraft());

const { data: selectedProject, pending, refresh } = await useAsyncData<ProjectDetail | null>(
  () => `project-detail:${projectId.value}`,
  async () => {
    if (!projectId.value) {
      console.warn("[项目详情] 路由参数缺少项目 ID");
      detailError.value = "项目 ID 缺失，请返回列表重试。";
      return null;
    }

    console.info("[项目详情] 开始加载项目详情", { projectId: projectId.value });
    try {
      const detail = await $fetch<ProjectDetail>(`/api/projects/${projectId.value}`);
      detailError.value = "";
      console.info("[项目详情] 项目详情加载成功", {
        projectId: detail.id,
        repositoryCount: detail.repositories.length,
        serviceCount: detail.services?.length ?? 0,
        apiCount: detail.apis.length,
        skillCount: detail.skills.length,
        mcpCount: detail.mcps.length
      });
      return detail;
    } catch (error: any) {
      detailError.value = error?.data?.statusMessage || error?.statusMessage || error?.message || "项目详情加载失败。";
      console.error("[项目详情] 项目详情加载失败", { projectId: projectId.value, error });
      return null;
    }
  },
  {
    default: () => null,
    watch: [projectId]
  }
);

const { data: skillsData } = await useFetch<{ skills: SkillSummary[] }>("/api/skills", {
  default: () => ({ skills: [] })
});

const { data: mcpData } = await useFetch<{ items: McpItemSummary[] }>("/api/mcp/items", {
  default: () => ({ items: [] })
});

const skillOptions = computed(() => skillsData.value.skills);
const mcpOptions = computed(() => mcpData.value.items);
const serviceOptions = computed<ProjectServiceInfo[]>(() => selectedProject.value?.services ?? []);
const configModalSubmitText = computed(() => (projectConfigModalMode.value === "edit" ? "保存修改" : "添加"));

const totalCapabilities = computed(() => {
  const project = selectedProject.value;
  const total = (project?.skills.length ?? 0) + (project?.mcps.length ?? 0);
  console.info("[项目详情] 计算项目能力挂载数量", { projectId: project?.id, total });
  return total;
});

useHead(() => ({
  title: selectedProject.value ? `${selectedProject.value.name} | 项目详情` : "项目详情 | MyClaw Cloud"
}));

/** 中文说明：创建项目配置弹窗草稿，确保详情页局部新增和编辑都有稳定默认值。 */
function createProjectConfigModalDraft(): ProjectConfigModalDraft {
  console.info("[项目详情] 创建项目配置弹窗草稿");
  return {
    api: createApiFormItem(),
    mcp: createMcpFormItem(),
    repository: createRepositoryFormItem(),
    service: createServiceFormItem(),
    skill: createSkillFormItem()
  };
}

/** 中文说明：创建服务端点表单项，支持从详情数据回填或新增空白项。 */
function createServiceFormItem(service?: ProjectDetail["services"][number]): ProjectServiceFormItem {
  console.info("[项目详情] 创建服务端点表单项", { hasService: Boolean(service), serviceName: service?.name });
  return {
    baseUrl: service?.baseUrl ?? "",
    description: service?.description ?? "",
    enabled: service?.enabled ?? true,
    name: service?.name ?? ""
  };
}

/** 中文说明：创建仓库表单项，供详情页弹窗维护单条仓库配置。 */
function createRepositoryFormItem(repository?: ProjectDetail["repositories"][number]): ProjectRepositoryFormItem {
  console.info("[项目详情] 创建仓库表单项", { hasRepository: Boolean(repository), repositoryName: repository?.name });
  return {
    defaultBranch: repository?.defaultBranch ?? "",
    description: repository?.description ?? "",
    enabled: repository?.enabled ?? true,
    gitUrl: repository?.gitUrl ?? "",
    name: repository?.name ?? "",
    repoType: repository?.repoType ?? "other"
  };
}

/** 中文说明：创建接口表单项，保留 Schema 和标签文本以便保存时不丢失既有配置。 */
function createApiFormItem(api?: ProjectDetail["apis"][number]): ProjectApiFormItem {
  console.info("[项目详情] 创建接口表单项", { hasApi: Boolean(api), apiName: api?.name });
  return {
    description: api?.description ?? "",
    direction: api?.direction ?? "provided",
    enabled: api?.enabled ?? true,
    method: api?.method ?? "GET",
    name: api?.name ?? "",
    owner: api?.owner ?? "",
    path: api?.path ?? "",
    protocol: api?.protocol ?? "http",
    parametersText: stringifyJson(api?.parametersJson),
    requestBodyContentType: api?.requestBodyContentType ?? "",
    requestBodyExampleText: stringifyJson(api?.requestBodyExampleJson),
    requestBodyType: api?.requestBodyType ?? "none",
    requestSchemaText: stringifyJson(api?.requestSchemaJson),
    responseSchemaText: stringifyJson(api?.responseSchemaJson),
    serviceName: api?.serviceName ?? "",
    source: api?.source ?? "manual",
    tagsText: stringifyTags(api?.tagsJson)
  };
}

/** 中文说明：解析新增接口的默认服务，单服务项目直接预选以减少重复选择。 */
function resolveDefaultServiceName(): string {
  const enabledServices = serviceOptions.value.filter((service) => service.enabled && service.name.trim());
  console.info("[项目详情] 解析新增接口默认服务", { enabledServiceCount: enabledServices.length });
  return enabledServices.length === 1 ? enabledServices[0].name : "";
}

/** 中文说明：创建 Skill 挂载表单项，支持空白新增和已有挂载回填。 */
function createSkillFormItem(skill?: ProjectDetail["skills"][number]): ProjectSkillFormItem {
  console.info("[项目详情] 创建 Skill 表单项", { hasSkill: Boolean(skill), skillId: skill?.skillId });
  return {
    alias: skill?.alias ?? "",
    configText: stringifyJson(skill?.configJson),
    enabled: skill?.enabled ?? true,
    skillId: skill?.skillId ?? "",
    skillReleaseId: skill?.skillReleaseId ?? ""
  };
}

/** 中文说明：创建 MCP 挂载表单项，支持空白新增和已有连接器回填。 */
function createMcpFormItem(mcp?: ProjectDetail["mcps"][number]): ProjectMcpFormItem {
  console.info("[项目详情] 创建 MCP 表单项", { hasMcp: Boolean(mcp), mcpServerId: mcp?.mcpServerId });
  return {
    alias: mcp?.alias ?? "",
    configOverrideText: stringifyJson(mcp?.configOverrideJson),
    enabled: mcp?.enabled ?? true,
    mcpReleaseId: mcp?.mcpReleaseId ?? "",
    mcpServerId: mcp?.mcpServerId ?? "",
    riskLevel: mcp?.riskLevel ?? ""
  };
}

/** 中文说明：重置指定类型的弹窗草稿，避免上一次未提交内容污染本次新增。 */
function resetProjectConfigModalDraft(action: ProjectConfigAction): void {
  console.info("[项目详情] 重置项目配置弹窗草稿", { action });
  if (action === "service") {
    addModalDraft.service = createServiceFormItem();
  } else if (action === "repository") {
    addModalDraft.repository = createRepositoryFormItem();
  } else if (action === "api") {
    addModalDraft.api = createApiFormItem();
  } else if (action === "skill") {
    addModalDraft.skill = createSkillFormItem();
  } else {
    addModalDraft.mcp = createMcpFormItem();
  }
}

/** 中文说明：打开详情页局部新增弹窗，不跳转到项目整体编辑页。 */
function openProjectConfigAddModal(action: ProjectConfigAction): void {
  console.info("[项目详情] 打开局部新增弹窗", { action, projectId: projectId.value });
  addModalError.value = "";
  projectConfigModalMode.value = "add";
  editingResourceId.value = null;
  resetProjectConfigModalDraft(action);
  activeAddModalAction.value = action;
}

/** 中文说明：打开详情页局部编辑弹窗，只维护当前资源模块的一条记录。 */
function openProjectConfigEditModal(action: ProjectConfigAction, resourceId: number): void {
  console.info("[项目详情] 打开局部编辑弹窗", { action, resourceId, projectId: projectId.value });
  addModalError.value = "";
  projectConfigModalMode.value = "edit";
  editingResourceId.value = resourceId;
  seedProjectConfigEditModalDraft(action, resourceId);
  if (action === "skill" && addModalDraft.skill.skillId) {
    console.info("[项目详情] 编辑 Skill 时预加载版本选项", { skillId: addModalDraft.skill.skillId });
    void ensureSkillDetail(addModalDraft.skill.skillId);
  }
  if (action === "mcp" && addModalDraft.mcp.mcpServerId) {
    console.info("[项目详情] 编辑 MCP 时预加载版本选项", { mcpServerId: addModalDraft.mcp.mcpServerId });
    void ensureMcpDetail(addModalDraft.mcp.mcpServerId);
  }
  activeAddModalAction.value = action;
}

/** 中文说明：关闭详情页局部配置弹窗，并清理临时错误和编辑目标。 */
function closeProjectConfigAddModal(): void {
  console.info("[项目详情] 关闭局部配置弹窗", {
    action: activeAddModalAction.value,
    mode: projectConfigModalMode.value,
    resourceId: editingResourceId.value
  });
  activeAddModalAction.value = null;
  addModalError.value = "";
  projectConfigModalMode.value = "add";
  editingResourceId.value = null;
}

/** 中文说明：将当前资源行回填到弹窗草稿，保证取消编辑不会污染详情列表。 */
function seedProjectConfigEditModalDraft(action: ProjectConfigAction, resourceId: number): void {
  const project = selectedProject.value;
  console.info("[项目详情] 回填局部编辑弹窗草稿", { action, resourceId, hasProject: Boolean(project) });
  if (!project) return;

  if (action === "service") {
    const item = project.services.find((entry) => entry.id === resourceId);
    if (item) addModalDraft.service = createServiceFormItem(item);
  } else if (action === "repository") {
    const item = project.repositories.find((entry) => entry.id === resourceId);
    if (item) addModalDraft.repository = createRepositoryFormItem(item);
  } else if (action === "api") {
    const item = project.apis.find((entry) => entry.id === resourceId);
    if (item) addModalDraft.api = createApiFormItem(item);
  } else if (action === "skill") {
    const item = project.skills.find((entry) => entry.id === resourceId);
    if (item) addModalDraft.skill = createSkillFormItem(item);
  } else {
    const item = project.mcps.find((entry) => entry.id === resourceId);
    if (item) addModalDraft.mcp = createMcpFormItem(item);
  }
}

/** 中文说明：确认详情页局部弹窗，保存成功后直接刷新详情页列表。 */
async function confirmProjectConfigModal(): Promise<void> {
  const action = activeAddModalAction.value;
  console.info("[项目详情] 确认局部配置弹窗", {
    action,
    mode: projectConfigModalMode.value,
    resourceId: editingResourceId.value
  });
  if (!action) {
    return;
  }

  try {
    normalizeProjectConfigModalDraft(action);
    await handleSaveProjectConfig();
  } catch (error: any) {
    addModalError.value = error?.message || "配置保存失败，请检查必填项。";
    console.error("[项目详情] 局部配置弹窗确认失败", { action, mode: projectConfigModalMode.value, error });
  }
}

/** 中文说明：保存项目配置局部变更，复用现有项目配置替换接口完成即时落库。 */
async function handleSaveProjectConfig(): Promise<void> {
  const action = activeAddModalAction.value;
  if (!projectId.value || !selectedProject.value || !action) {
    console.warn("[项目详情] 缺少保存局部配置所需上下文", { projectId: projectId.value, action });
    throw new Error("项目详情尚未加载，无法保存配置。");
  }

  console.info("[项目详情] 开始保存局部项目配置", {
    projectId: projectId.value,
    action,
    mode: projectConfigModalMode.value,
    resourceId: editingResourceId.value
  });
  savePending.value = true;
  addModalError.value = "";

  try {
    const saved = await $fetch<ProjectDetail>(`/api/projects/${projectId.value}/config`, {
      method: "PUT",
      body: buildReplaceProjectPayload()
    });
    selectedProject.value = saved;
    await refresh();
    closeProjectConfigAddModal();
    console.info("[项目详情] 局部项目配置保存成功", { projectId: projectId.value, action });
  } catch (error: any) {
    console.error("[项目详情] 局部项目配置保存失败", { projectId: projectId.value, action, error });
    throw new Error(error?.data?.statusMessage || error?.statusMessage || error?.message || "项目配置保存失败。");
  } finally {
    savePending.value = false;
    console.info("[项目详情] 局部项目配置保存流程结束", { projectId: projectId.value, action });
  }
}

/** 中文说明：按配置类型校验弹窗草稿，确保立即新增不会写入空核心字段。 */
function normalizeProjectConfigModalDraft(action: ProjectConfigAction): void {
  console.info("[项目详情] 校验局部配置弹窗草稿", { action });
  if (action === "service") {
    addModalDraft.service.name = requireText(addModalDraft.service.name, "服务名称");
    addModalDraft.service.baseUrl = requireText(addModalDraft.service.baseUrl, "服务 Base URL");
  } else if (action === "repository") {
    addModalDraft.repository.name = requireText(addModalDraft.repository.name, "仓库名称");
    addModalDraft.repository.gitUrl = requireText(addModalDraft.repository.gitUrl, "仓库地址");
  } else if (action === "api") {
    addModalDraft.api.name = requireText(addModalDraft.api.name, "接口名称");
    addModalDraft.api.path = requireText(addModalDraft.api.path, "接口路径");
    addModalDraft.api.method = requireText(addModalDraft.api.method, "HTTP 方法");
  } else if (action === "skill") {
    addModalDraft.skill.skillId = requireText(addModalDraft.skill.skillId, "Skill");
  } else {
    addModalDraft.mcp.mcpServerId = requireText(addModalDraft.mcp.mcpServerId, "MCP");
  }
}

/** 中文说明：构建项目配置替换请求体，只把当前弹窗变更合并到对应资源数组。 */
function buildReplaceProjectPayload(): ReplaceProjectConfigInput {
  const project = selectedProject.value;
  console.info("[项目详情] 构建局部保存请求体", { projectId: project?.id, action: activeAddModalAction.value });
  if (!project) {
    throw new Error("项目详情尚未加载。");
  }

  return {
    name: project.name,
    description: project.description,
    ownerAccount: project.ownerAccount,
    status: project.status,
    updatedBy: resolveOperatorAccount(project),
    services: buildServicePayload(project),
    repositories: buildRepositoryPayload(project),
    rongzhiLink: buildRongzhiPayload(project),
    apis: buildApiPayload(project),
    skills: buildSkillPayload(project),
    mcps: buildMcpPayload(project)
  };
}

/** 中文说明：构建服务端点请求体数组，并在服务弹窗提交时追加或替换单条服务。 */
function buildServicePayload(project: ProjectDetail): ReplaceProjectConfigInput["services"] {
  const payload = project.services.map((item, index) => serviceToInput(item, index));
  console.info("[项目详情] 构建服务端点请求体", { serviceCount: payload.length, action: activeAddModalAction.value });
  if (activeAddModalAction.value === "service") {
    upsertPayloadItem(payload, serviceDraftToInput(addModalDraft.service, resolveDraftSortOrder(project, "service", payload.length)));
  }
  return payload;
}

/** 中文说明：构建仓库请求体数组，并在仓库弹窗提交时追加或替换单条仓库。 */
function buildRepositoryPayload(project: ProjectDetail): ReplaceProjectConfigInput["repositories"] {
  const payload = project.repositories.map((item, index) => repositoryToInput(item, index));
  console.info("[项目详情] 构建仓库请求体", { repositoryCount: payload.length, action: activeAddModalAction.value });
  if (activeAddModalAction.value === "repository") {
    upsertPayloadItem(payload, repositoryDraftToInput(addModalDraft.repository, resolveDraftSortOrder(project, "repository", payload.length)));
  }
  return payload;
}

/** 中文说明：构建融智链请求体，局部保存其它模块时保持现有绑定不变。 */
function buildRongzhiPayload(project: ProjectDetail): ReplaceProjectConfigInput["rongzhiLink"] {
  console.info("[项目详情] 构建融智链请求体", { hasRongzhiLink: Boolean(project.rongzhiLink) });
  if (!project.rongzhiLink) {
    return null;
  }

  return {
    projectCode: project.rongzhiLink.projectCode,
    projectName: project.rongzhiLink.projectName,
    baseUrl: project.rongzhiLink.baseUrl,
    enabled: project.rongzhiLink.enabled
  };
}

/** 中文说明：构建接口请求体数组，并在接口弹窗提交时追加或替换单条接口。 */
function buildApiPayload(project: ProjectDetail): ReplaceProjectConfigInput["apis"] {
  const payload = project.apis.map((item) => apiToInput(item));
  console.info("[项目详情] 构建接口请求体", { apiCount: payload.length, action: activeAddModalAction.value });
  if (activeAddModalAction.value === "api") {
    upsertPayloadItem(payload, apiDraftToInput(addModalDraft.api));
  }
  return payload;
}

/** 中文说明：构建 Skill 请求体数组，并在 Skill 弹窗提交时追加或替换单条挂载。 */
function buildSkillPayload(project: ProjectDetail): ReplaceProjectConfigInput["skills"] {
  const payload = project.skills.map((item) => skillToInput(item));
  console.info("[项目详情] 构建 Skill 请求体", { skillCount: payload.length, action: activeAddModalAction.value });
  if (activeAddModalAction.value === "skill") {
    upsertPayloadItem(payload, skillDraftToInput(addModalDraft.skill));
  }
  return payload;
}

/** 中文说明：构建 MCP 请求体数组，并在 MCP 弹窗提交时追加或替换单条挂载。 */
function buildMcpPayload(project: ProjectDetail): ReplaceProjectConfigInput["mcps"] {
  const payload = project.mcps.map((item) => mcpToInput(item));
  console.info("[项目详情] 构建 MCP 请求体", { mcpCount: payload.length, action: activeAddModalAction.value });
  if (activeAddModalAction.value === "mcp") {
    upsertPayloadItem(payload, mcpDraftToInput(addModalDraft.mcp));
  }
  return payload;
}

/** 中文说明：按当前编辑资源位置写回请求体数组，新增时追加到数组末尾。 */
function upsertPayloadItem<T>(payload: T[], item: T): void {
  const action = activeAddModalAction.value;
  const resourceId = editingResourceId.value;
  console.info("[项目详情] 合并局部配置请求项", { action, mode: projectConfigModalMode.value, resourceId });
  if (projectConfigModalMode.value !== "edit" || resourceId === null || !selectedProject.value || !action) {
    payload.push(item);
    return;
  }

  const sourceList = getProjectResourceList(selectedProject.value, action);
  const index = sourceList.findIndex((entry) => entry.id === resourceId);
  if (index >= 0) {
    payload[index] = item;
  } else {
    payload.push(item);
  }
}

/** 中文说明：按资源类型取得详情页原始数组，用于计算编辑项在请求体中的位置。 */
function getProjectResourceList(project: ProjectDetail, action: ProjectConfigAction): { id: number }[] {
  console.info("[项目详情] 获取项目资源数组", { action, projectId: project.id });
  if (action === "service") return project.services;
  if (action === "repository") return project.repositories;
  if (action === "api") return project.apis;
  if (action === "skill") return project.skills;
  return project.mcps;
}

/** 中文说明：解析弹窗草稿的排序位置，编辑时沿用原行位置，新增时追加到末尾。 */
function resolveDraftSortOrder(project: ProjectDetail, action: ProjectConfigAction, fallback: number): number {
  const resourceId = editingResourceId.value;
  console.info("[项目详情] 解析局部配置排序位置", { action, resourceId, fallback });
  if (projectConfigModalMode.value !== "edit" || resourceId === null) {
    return fallback;
  }

  const index = getProjectResourceList(project, action).findIndex((entry) => entry.id === resourceId);
  return index >= 0 ? index : fallback;
}

/** 中文说明：把服务详情转换成保存接口需要的结构。 */
function serviceToInput(item: ProjectDetail["services"][number], index: number): NonNullable<ReplaceProjectConfigInput["services"]>[number] {
  console.info("[项目详情] 转换服务详情为请求项", { serviceName: item.name, index });
  return {
    name: item.name,
    baseUrl: item.baseUrl,
    description: item.description,
    enabled: item.enabled,
    sortOrder: index
  };
}

/** 中文说明：把服务弹窗草稿转换成保存接口需要的结构。 */
function serviceDraftToInput(item: ProjectServiceFormItem, index: number): NonNullable<ReplaceProjectConfigInput["services"]>[number] {
  console.info("[项目详情] 转换服务草稿为请求项", { serviceName: item.name, index });
  return {
    name: requireText(item.name, "服务名称"),
    baseUrl: requireText(item.baseUrl, "服务 Base URL"),
    description: nullableText(item.description),
    enabled: item.enabled,
    sortOrder: index
  };
}

/** 中文说明：把仓库详情转换成保存接口需要的结构。 */
function repositoryToInput(item: ProjectDetail["repositories"][number], index: number): NonNullable<ReplaceProjectConfigInput["repositories"]>[number] {
  console.info("[项目详情] 转换仓库详情为请求项", { repositoryName: item.name, index });
  return {
    name: item.name,
    gitUrl: item.gitUrl,
    repoType: item.repoType,
    defaultBranch: item.defaultBranch,
    description: item.description,
    enabled: item.enabled,
    sortOrder: index
  };
}

/** 中文说明：把仓库弹窗草稿转换成保存接口需要的结构。 */
function repositoryDraftToInput(item: ProjectRepositoryFormItem, index: number): NonNullable<ReplaceProjectConfigInput["repositories"]>[number] {
  console.info("[项目详情] 转换仓库草稿为请求项", { repositoryName: item.name, index });
  return {
    name: requireText(item.name, "仓库名称"),
    gitUrl: requireText(item.gitUrl, "仓库地址"),
    repoType: item.repoType,
    defaultBranch: nullableText(item.defaultBranch),
    description: nullableText(item.description),
    enabled: item.enabled,
    sortOrder: index
  };
}

/** 中文说明：把接口详情转换成保存接口需要的结构。 */
function apiToInput(item: ProjectDetail["apis"][number]): NonNullable<ReplaceProjectConfigInput["apis"]>[number] {
  console.info("[项目详情] 转换接口详情为请求项", { apiName: item.name });
  return {
    name: item.name,
    serviceName: item.serviceName,
    direction: item.direction,
    protocol: item.protocol,
    method: item.method,
    path: item.path,
    description: item.description,
    source: item.source,
    owner: item.owner,
    tagsJson: item.tagsJson,
    parametersJson: item.parametersJson,
    requestBodyType: item.requestBodyType,
    requestBodyContentType: item.requestBodyContentType,
    requestBodyExampleJson: item.requestBodyExampleJson,
    requestSchemaJson: item.requestSchemaJson,
    responseSchemaJson: item.responseSchemaJson,
    enabled: item.enabled
  };
}

/** 中文说明：把接口弹窗草稿转换成保存接口需要的结构。 */
function apiDraftToInput(item: ProjectApiFormItem): NonNullable<ReplaceProjectConfigInput["apis"]>[number] {
  console.info("[项目详情] 转换接口草稿为请求项", { apiName: item.name });
  return {
    name: requireText(item.name, "接口名称"),
    serviceName: nullableText(item.serviceName),
    direction: item.direction,
    protocol: item.protocol,
    method: nullableText(item.method),
    path: nullableText(item.path),
    description: nullableText(item.description),
    source: item.source,
    owner: nullableText(item.owner),
    tagsJson: parseTags(item.tagsText),
    parametersJson: parseJsonArrayText(item.parametersText, "请求参数 JSON"),
    requestBodyType: item.requestBodyType,
    requestBodyContentType: nullableText(item.requestBodyContentType),
    requestBodyExampleJson: parseJsonAnyText(item.requestBodyExampleText, "请求 Body 示例 JSON"),
    requestSchemaJson: parseJsonObjectText(item.requestSchemaText, "请求 Schema JSON"),
    responseSchemaJson: parseJsonObjectText(item.responseSchemaText, "响应 Schema JSON"),
    enabled: item.enabled
  };
}

/** 中文说明：把 Skill 详情转换成保存接口需要的结构。 */
function skillToInput(item: ProjectDetail["skills"][number]): NonNullable<ReplaceProjectConfigInput["skills"]>[number] {
  console.info("[项目详情] 转换 Skill 详情为请求项", { skillId: item.skillId });
  return {
    skillId: item.skillId,
    skillReleaseId: item.skillReleaseId,
    alias: item.alias,
    configJson: item.configJson,
    enabled: item.enabled
  };
}

/** 中文说明：把 Skill 弹窗草稿转换成保存接口需要的结构。 */
function skillDraftToInput(item: ProjectSkillFormItem): NonNullable<ReplaceProjectConfigInput["skills"]>[number] {
  console.info("[项目详情] 转换 Skill 草稿为请求项", { skillId: item.skillId });
  return {
    skillId: requireText(item.skillId, "Skill"),
    skillReleaseId: nullableText(item.skillReleaseId),
    alias: nullableText(item.alias),
    configJson: parseJsonObjectText(item.configText, "Skill 配置 JSON"),
    enabled: item.enabled
  };
}

/** 中文说明：把 MCP 详情转换成保存接口需要的结构。 */
function mcpToInput(item: ProjectDetail["mcps"][number]): NonNullable<ReplaceProjectConfigInput["mcps"]>[number] {
  console.info("[项目详情] 转换 MCP 详情为请求项", { mcpServerId: item.mcpServerId });
  return {
    mcpServerId: item.mcpServerId,
    mcpReleaseId: item.mcpReleaseId,
    alias: item.alias,
    riskLevel: item.riskLevel,
    configOverrideJson: item.configOverrideJson,
    enabled: item.enabled
  };
}

/** 中文说明：把 MCP 弹窗草稿转换成保存接口需要的结构。 */
function mcpDraftToInput(item: ProjectMcpFormItem): NonNullable<ReplaceProjectConfigInput["mcps"]>[number] {
  console.info("[项目详情] 转换 MCP 草稿为请求项", { mcpServerId: item.mcpServerId });
  return {
    mcpServerId: requireText(item.mcpServerId, "MCP"),
    mcpReleaseId: nullableText(item.mcpReleaseId),
    alias: nullableText(item.alias),
    riskLevel: nullableText(item.riskLevel),
    configOverrideJson: parseJsonObjectText(item.configOverrideText, "MCP 覆盖配置 JSON"),
    enabled: item.enabled
  };
}

/** 中文说明：显示可空文本，避免空字段在详情页呈现为难以理解的空白。 */
function displayNullable(value: string | null | undefined, fallback = "未配置"): string {
  console.info("[项目详情] 格式化可空文本", { hasValue: Boolean(value), fallback });
  const trimmed = value?.trim();
  return trimmed || fallback;
}

/** 中文说明：按接口服务名称查找服务 Base URL，帮助详情页展示完整调用上下文。 */
function displayServiceBaseUrl(serviceName: string | null | undefined): string {
  console.info("[项目详情] 查找接口服务 Base URL", { serviceName });
  const service = selectedProject.value?.services.find((item) => item.name === serviceName);
  return displayNullable(service?.baseUrl);
}

/** 中文说明：格式化接口请求配置摘要，突出 Header、Query、Path 和 Body 是否已维护。 */
function formatApiRequestConfig(api: ProjectDetail["apis"][number]): string {
  const parameters = Array.isArray(api.parametersJson) ? api.parametersJson : [];
  const enabledParameters = parameters.filter((item) => item.enabled !== false);
  const groups = ["header", "query", "path", "cookie"]
    .map((location) => {
      const count = enabledParameters.filter((item) => item.in === location).length;
      return count > 0 ? `${location} ${count}` : "";
    })
    .filter(Boolean);
  const bodyType = api.requestBodyType && api.requestBodyType !== "none" ? `Body ${api.requestBodyType}` : "";
  const summary = [...groups, bodyType].filter(Boolean).join(" · ");
  console.info("[项目详情] 格式化接口请求配置摘要", { apiName: api.name, summary });
  return summary || "未配置请求参数";
}

/** 中文说明：格式化 JSON 预览，保证接口、Skill 和 MCP 配置在详情页可读。 */
function formatJsonPreview(value: unknown): string {
  console.info("[项目详情] 格式化 JSON 预览", { hasValue: value !== null && value !== undefined });
  if (value === null || value === undefined) {
    return "未配置";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    console.error("[项目详情] JSON 预览格式化失败", { error });
    return "配置无法预览";
  }
}

/** 中文说明：将日期字符串格式化为中文日期，供创建时间等短日期字段展示。 */
function formatDate(dateStr: string): string {
  console.info("[项目详情] 格式化日期", { dateStr });
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return "未知";
  }
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

/** 中文说明：将日期字符串格式化为中文日期时间，供最后更新时间展示。 */
function formatDateTime(dateStr: string): string {
  console.info("[项目详情] 格式化日期时间", { dateStr });
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return "未知";
  }
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/** 中文说明：处理 Skill 选择变化，并按需加载对应版本选项。 */
function handleSkillSelectionChange(item: ProjectSkillFormItem): void {
  console.info("[项目详情] Skill 选择发生变化", { skillId: item.skillId });
  item.skillReleaseId = "";
  if (item.skillId) {
    void ensureSkillDetail(item.skillId);
  }
}

/** 中文说明：处理 MCP 选择变化，并按需加载对应版本选项。 */
function handleMcpSelectionChange(item: ProjectMcpFormItem): void {
  console.info("[项目详情] MCP 选择发生变化", { mcpServerId: item.mcpServerId });
  item.mcpReleaseId = "";
  if (item.mcpServerId) {
    void ensureMcpDetail(item.mcpServerId);
  }
}

/** 中文说明：按需加载 Skill 详情，供局部弹窗展示可绑定版本。 */
async function ensureSkillDetail(skillId: string): Promise<void> {
  if (!skillId || skillDetailMap[skillId] !== undefined || skillDetailLoading.has(skillId)) {
    return;
  }

  console.info("[项目详情] 开始加载 Skill 详情", { skillId });
  skillDetailLoading.add(skillId);
  try {
    skillDetailMap[skillId] = await $fetch<SkillDetail>(`/api/skills/${skillId}`);
    console.info("[项目详情] Skill 详情加载成功", { skillId, releaseCount: skillDetailMap[skillId]?.releases.length ?? 0 });
  } catch (error) {
    console.error("[项目详情] Skill 详情加载失败", { skillId, error });
    skillDetailMap[skillId] = null;
  } finally {
    skillDetailLoading.delete(skillId);
  }
}

/** 中文说明：按需加载 MCP 详情，供局部弹窗展示可绑定版本。 */
async function ensureMcpDetail(mcpServerId: string): Promise<void> {
  if (!mcpServerId || mcpDetailMap[mcpServerId] !== undefined || mcpDetailLoading.has(mcpServerId)) {
    return;
  }

  console.info("[项目详情] 开始加载 MCP 详情", { mcpServerId });
  mcpDetailLoading.add(mcpServerId);
  try {
    mcpDetailMap[mcpServerId] = await $fetch<McpItemDetail>(`/api/mcp/items/${mcpServerId}`);
    console.info("[项目详情] MCP 详情加载成功", { mcpServerId, releaseCount: mcpDetailMap[mcpServerId]?.releases.length ?? 0 });
  } catch (error) {
    console.error("[项目详情] MCP 详情加载失败", { mcpServerId, error });
    mcpDetailMap[mcpServerId] = null;
  } finally {
    mcpDetailLoading.delete(mcpServerId);
  }
}

/** 中文说明：按 Skill ID 获取版本选项，供局部弹窗下拉框使用。 */
function getSkillReleaseOptions(skillId: string) {
  console.info("[项目详情] 获取 Skill 版本选项", { skillId });
  return skillId ? (skillDetailMap[skillId]?.releases ?? []) : [];
}

/** 中文说明：按 MCP ID 获取版本选项，供局部弹窗下拉框使用。 */
function getMcpReleaseOptions(mcpServerId: string) {
  console.info("[项目详情] 获取 MCP 版本选项", { mcpServerId });
  return mcpServerId ? (mcpDetailMap[mcpServerId]?.releases ?? []) : [];
}

/** 中文说明：把文本解析为对象 JSON，拒绝数组和字符串化伪 JSON。 */
function parseJsonObjectText(raw: string, label: string): Record<string, unknown> | null {
  const value = raw.trim();
  console.info("[项目详情] 解析 JSON 文本", { label, hasValue: Boolean(value) });
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.warn("[项目详情] JSON 文本不是对象结构", { label });
      throw new Error(`${label} 必须是 JSON 对象。`);
    }
    return parsed as Record<string, unknown>;
  } catch (error: any) {
    console.error("[项目详情] JSON 文本解析失败", { label, error });
    throw new Error(error?.message || `${label} 解析失败。`);
  }
}

/** 中文说明：把文本解析为 JSON 数组，供接口请求参数配置保存。 */
function parseJsonArrayText(raw: string, label: string): ProjectApiParameterInfo[] | null {
  const value = raw.trim();
  console.info("[项目详情] 解析 JSON 数组文本", { label, hasValue: Boolean(value) });
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      console.warn("[项目详情] JSON 文本不是数组结构", { label });
      throw new Error(`${label} 必须是 JSON 数组。`);
    }
    return parsed as ProjectApiParameterInfo[];
  } catch (error: any) {
    console.error("[项目详情] JSON 数组文本解析失败", { label, error });
    throw new Error(error?.message || `${label} 解析失败。`);
  }
}

/** 中文说明：把文本解析为任意 JSON 值，供接口 Body 示例保存。 */
function parseJsonAnyText(raw: string, label: string): unknown {
  const value = raw.trim();
  console.info("[项目详情] 解析任意 JSON 文本", { label, hasValue: Boolean(value) });
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch (error: any) {
    console.error("[项目详情] 任意 JSON 文本解析失败", { label, error });
    throw new Error(error?.message || `${label} 解析失败。`);
  }
}

/** 中文说明：把标签文本拆成字符串数组，支持逗号和换行输入。 */
function parseTags(raw: string): string[] | null {
  const value = raw.trim();
  console.info("[项目详情] 解析接口标签", { hasValue: Boolean(value) });
  if (!value) {
    return null;
  }

  return Array.from(
    new Set(
      value
        .split(/[\n,，]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

/** 中文说明：把 JSON 值格式化为多行文本，供局部编辑弹窗回填使用。 */
function stringifyJson(value: unknown): string {
  console.info("[项目详情] 回填 JSON 文本", { hasValue: value !== null && value !== undefined });
  if (value === null || value === undefined) {
    return "";
  }
  return JSON.stringify(value, null, 2);
}

/** 中文说明：把标签数组或未知值序列化为可编辑的标签文本。 */
function stringifyTags(value: unknown): string {
  console.info("[项目详情] 回填标签文本", { hasValue: Boolean(value) });
  if (!Array.isArray(value)) {
    return "";
  }
  return value.filter((item): item is string => typeof item === "string").join(", ");
}

/** 中文说明：执行必填文本校验，避免空字符串进入项目配置。 */
function requireText(value: string | null | undefined, label: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    console.warn("[项目详情] 必填文本校验失败", { label });
    throw new Error(`${label}不能为空。`);
  }
  return trimmed;
}

/** 中文说明：裁剪可空文本，并把空字符串统一转成 null。 */
function nullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  console.info("[项目详情] 处理可空文本", { hasValue: Boolean(trimmed) });
  return trimmed ? trimmed : null;
}

/** 中文说明：解析当前操作人账号，确保局部配置变更写入审计字段。 */
function resolveOperatorAccount(project: ProjectDetail): string {
  const account = user.value?.account?.trim() || project.ownerAccount.trim() || "cloud-admin";
  console.info("[项目详情] 解析当前操作人", { account });
  return account;
}
</script>

<template>
  <main class="project-detail-page">
    <div class="detail-container">
      <div class="nav-bar">
        <NuxtLink class="back-link" to="/projects">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
          返回项目列表
        </NuxtLink>
      </div>

      <div v-if="pending" class="state-container">
        <div class="pulse-loader-nx"></div>
        <p>正在加载项目详情...</p>
      </div>

      <template v-else-if="selectedProject">
        <header class="hero-section glass-card-nx">
          <div class="hero-main">
            <div class="hero-title-block">
              <span class="project-code">{{ selectedProject.code }}</span>
              <h1>{{ selectedProject.name }}</h1>
              <p class="hero-description">{{ selectedProject.description || "暂无项目说明。" }}</p>
            </div>

            <div class="hero-actions">
              <span class="status-pill" :class="selectedProject.status">{{ STATUS_LABELS[selectedProject.status] }}</span>
              <NuxtLink class="action-btn-primary" :to="`/projects/${projectId}/edit`">编辑项目</NuxtLink>
            </div>
          </div>

          <div class="hero-meta-grid">
            <div class="meta-box">
              <span class="meta-label">负责人</span>
              <span class="meta-value">{{ selectedProject.ownerAccount }}</span>
            </div>
            <div class="meta-box">
              <span class="meta-label">代码仓库</span>
              <span class="meta-value">{{ selectedProject.repositories.length }}</span>
            </div>
            <div class="meta-box">
              <span class="meta-label">服务端点</span>
              <span class="meta-value">{{ (selectedProject.services ?? []).length }}</span>
            </div>
            <div class="meta-box">
              <span class="meta-label">接口</span>
              <span class="meta-value">{{ selectedProject.apis.length }}</span>
            </div>
            <div class="meta-box">
              <span class="meta-label">Skills + MCP</span>
              <span class="meta-value">{{ totalCapabilities }}</span>
            </div>
            <div class="meta-box">
              <span class="meta-label">创建时间</span>
              <span class="meta-value">{{ formatDate(selectedProject.createdAt) }}</span>
            </div>
            <div class="meta-box">
              <span class="meta-label">最后更新</span>
              <span class="meta-value">{{ formatDateTime(selectedProject.updatedAt) }}</span>
            </div>
          </div>
        </header>

        <article class="project-detail-panel">
          <section class="detail-section">
            <div class="section-header">
              <div>
                <h2>代码仓库</h2>
                <p>按仓库独立维护仓库类型、默认分支和启用状态。</p>
              </div>
              <div class="section-actions">
                <span class="section-count">{{ selectedProject.repositories.length }} 个仓库</span>
                <button type="button" class="section-add-link" @click="openProjectConfigAddModal('repository')">+ 新增仓库</button>
              </div>
            </div>

            <div v-if="selectedProject.repositories.length" class="resource-table resource-table--repositories">
              <div class="resource-row resource-row--head">
                <span>仓库名称</span>
                <span>类型 / 分支</span>
                <span>仓库地址</span>
                <span>状态</span>
                <span class="sr-only">操作</span>
              </div>
              <div v-for="repository in selectedProject.repositories" :key="repository.id" class="resource-row">
                <div class="resource-primary">
                  <strong>{{ repository.name }}</strong>
                  <small>{{ repository.description || "暂无仓库说明。" }}</small>
                </div>
                <span>{{ repository.repoType }} · {{ displayNullable(repository.defaultBranch) }}</span>
                <span class="resource-url">{{ repository.gitUrl }}</span>
                <span class="mini-pill" :class="{ disabled: !repository.enabled }">{{ repository.enabled ? "启用" : "停用" }}</span>
                <div class="resource-actions">
                  <button type="button" class="icon-action" :aria-label="`编辑仓库 ${repository.name}`" title="编辑" @click="openProjectConfigEditModal('repository', repository.id)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <div v-else class="empty-hint empty-hint-action">
              <span>还没有配置代码仓库。</span>
              <button type="button" class="section-add-link" @click="openProjectConfigAddModal('repository')">添加仓库</button>
            </div>
          </section>

          <section class="detail-section">
            <div class="section-header">
              <div>
                <h2>服务端点</h2>
                <p>一个项目可以维护多个服务 Base URL，接口通过服务选择获得完整调用地址。</p>
              </div>
              <div class="section-actions">
                <span class="section-count">{{ (selectedProject.services ?? []).length }} 个服务</span>
                <button type="button" class="section-add-link" @click="openProjectConfigAddModal('service')">+ 新增服务</button>
              </div>
            </div>

            <div v-if="(selectedProject.services ?? []).length" class="resource-table resource-table--services">
              <div class="resource-row resource-row--head">
                <span>服务名称</span>
                <span>Base URL</span>
                <span>状态</span>
                <span>说明</span>
                <span class="sr-only">操作</span>
              </div>
              <div v-for="service in selectedProject.services ?? []" :key="service.id" class="resource-row">
                <div class="resource-primary">
                  <strong>{{ service.name }}</strong>
                </div>
                <span class="resource-url">{{ service.baseUrl }}</span>
                <span class="mini-pill" :class="{ disabled: !service.enabled }">{{ service.enabled ? "启用" : "停用" }}</span>
                <span class="resource-muted">{{ service.description || "暂无服务说明。" }}</span>
                <div class="resource-actions">
                  <button type="button" class="icon-action" :aria-label="`编辑服务 ${service.name}`" title="编辑" @click="openProjectConfigEditModal('service', service.id)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <div v-else class="empty-hint empty-hint-action">
              <span>还没有维护服务端点。</span>
              <button type="button" class="section-add-link" @click="openProjectConfigAddModal('service')">添加服务</button>
            </div>
          </section>

          <section class="detail-section">
            <div class="section-header">
              <div>
                <h2>融智链项目</h2>
                <p>项目与内部需求、缺陷或研发协作系统的绑定信息。</p>
              </div>
            </div>

            <div v-if="selectedProject.rongzhiLink" class="detail-card single-card">
              <div class="detail-card-head">
                <h3>{{ selectedProject.rongzhiLink.projectCode }}</h3>
                <span class="mini-pill" :class="{ disabled: !selectedProject.rongzhiLink.enabled }">
                  {{ selectedProject.rongzhiLink.enabled ? "启用" : "停用" }}
                </span>
              </div>
              <dl class="detail-meta-list">
                <div>
                  <dt>项目名称</dt>
                  <dd>{{ displayNullable(selectedProject.rongzhiLink.projectName) }}</dd>
                </div>
                <div>
                  <dt>健康状态</dt>
                  <dd>{{ displayNullable(selectedProject.rongzhiLink.lastHealthStatus) }}</dd>
                </div>
                <div class="wide">
                  <dt>访问地址</dt>
                  <dd>{{ displayNullable(selectedProject.rongzhiLink.baseUrl) }}</dd>
                </div>
              </dl>
            </div>
            <p v-else class="empty-hint">还没有绑定融智链项目。</p>
          </section>

          <section class="detail-section">
            <div class="section-header">
              <div>
                <h2>接口</h2>
                <p>项目 API 使用独立表维护，不混入项目主表，便于后续导入 OpenAPI 或仓库扫描结果。</p>
              </div>
              <div class="section-actions">
                <span class="section-count">{{ selectedProject.apis.length }} 个接口</span>
                <button type="button" class="section-add-link" @click="openProjectConfigAddModal('api')">+ 新增接口</button>
              </div>
            </div>

            <div v-if="selectedProject.apis.length" class="resource-table resource-table--apis">
              <div class="resource-row resource-row--head">
                <span>接口</span>
                <span>方法 / 路径</span>
                <span>服务</span>
                <span>请求配置</span>
                <span>状态</span>
                <span class="sr-only">操作</span>
              </div>
              <div v-for="api in selectedProject.apis" :key="api.id" class="resource-row">
                <div class="resource-primary">
                  <strong>{{ api.name }}</strong>
                  <small>{{ api.description || "暂无接口说明。" }}</small>
                </div>
                <span class="resource-url">{{ displayNullable(api.method, "GET") }} {{ displayNullable(api.path) }}</span>
                <span>{{ displayNullable(api.serviceName) }}</span>
                <span class="resource-muted">{{ formatApiRequestConfig(api) }}</span>
                <span class="mini-pill" :class="{ disabled: !api.enabled }">{{ api.enabled ? "启用" : "停用" }}</span>
                <div class="resource-actions">
                  <button type="button" class="icon-action" :aria-label="`编辑接口 ${api.name}`" title="编辑" @click="openProjectConfigEditModal('api', api.id)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <div v-else class="empty-hint empty-hint-action">
              <span>还没有配置项目接口。</span>
              <button type="button" class="section-add-link" @click="openProjectConfigAddModal('api')">添加接口</button>
            </div>
          </section>

          <section class="detail-section">
            <div class="section-header">
              <div>
                <h2>Skills</h2>
                <p>项目 Skill 关联表只保存项目内启用关系、版本锁定和覆盖配置，与普通 Skills 目录分离。</p>
              </div>
              <div class="section-actions">
                <span class="section-count">{{ selectedProject.skills.length }} 个 Skill</span>
                <button type="button" class="section-add-link" @click="openProjectConfigAddModal('skill')">+ 新增 Skill</button>
              </div>
            </div>

            <div v-if="selectedProject.skills.length" class="resource-table resource-table--skills">
              <div class="resource-row resource-row--head">
                <span>Skill</span>
                <span>版本</span>
                <span>配置 JSON</span>
                <span>状态</span>
                <span class="sr-only">操作</span>
              </div>
              <div v-for="skill in selectedProject.skills" :key="skill.id" class="resource-row">
                <div class="resource-primary">
                  <strong>{{ skill.alias || skill.skillId }}</strong>
                  <small>{{ skill.skillId }}</small>
                </div>
                <span>{{ displayNullable(skill.skillReleaseId, "跟随最新版本") }}</span>
                <span class="resource-muted">{{ skill.configJson ? "已覆盖 JSON" : "默认配置" }}</span>
                <span class="mini-pill" :class="{ disabled: !skill.enabled }">{{ skill.enabled ? "启用" : "停用" }}</span>
                <div class="resource-actions">
                  <button type="button" class="icon-action" :aria-label="`编辑 Skill ${skill.alias || skill.skillId}`" title="编辑" @click="openProjectConfigEditModal('skill', skill.id)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <div v-else class="empty-hint empty-hint-action">
              <span>还没有挂载项目 Skill。</span>
              <button type="button" class="section-add-link" @click="openProjectConfigAddModal('skill')">添加 Skill</button>
            </div>
          </section>

          <section class="detail-section">
            <div class="section-header">
              <div>
                <h2>MCP</h2>
                <p>项目 MCP 关联表只保存项目内连接器启用关系、版本锁定、风险等级和覆盖配置。</p>
              </div>
              <div class="section-actions">
                <span class="section-count">{{ selectedProject.mcps.length }} 个 MCP</span>
                <button type="button" class="section-add-link" @click="openProjectConfigAddModal('mcp')">+ 新增 MCP</button>
              </div>
            </div>

            <div v-if="selectedProject.mcps.length" class="resource-table resource-table--mcps">
              <div class="resource-row resource-row--head">
                <span>MCP</span>
                <span>版本</span>
                <span>风险</span>
                <span>覆盖配置 JSON</span>
                <span>状态</span>
                <span class="sr-only">操作</span>
              </div>
              <div v-for="mcp in selectedProject.mcps" :key="mcp.id" class="resource-row">
                <div class="resource-primary">
                  <strong>{{ mcp.alias || mcp.mcpServerId }}</strong>
                  <small>{{ mcp.mcpServerId }}</small>
                </div>
                <span>{{ displayNullable(mcp.mcpReleaseId, "跟随最新版本") }}</span>
                <span>{{ displayNullable(mcp.riskLevel) }}</span>
                <span class="resource-muted">{{ mcp.configOverrideJson ? "已覆盖 JSON" : "默认配置" }}</span>
                <span class="mini-pill" :class="{ disabled: !mcp.enabled }">{{ mcp.enabled ? "启用" : "停用" }}</span>
                <div class="resource-actions">
                  <button type="button" class="icon-action" :aria-label="`编辑 MCP ${mcp.alias || mcp.mcpServerId}`" title="编辑" @click="openProjectConfigEditModal('mcp', mcp.id)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <div v-else class="empty-hint empty-hint-action">
              <span>还没有挂载项目 MCP。</span>
              <button type="button" class="section-add-link" @click="openProjectConfigAddModal('mcp')">添加 MCP</button>
            </div>
          </section>

          <section class="detail-section">
            <div class="section-header">
              <div>
                <h2>工作流 / 硅基员工</h2>
                <p>当前先保留维护位，后续在项目域内继续扩展。</p>
              </div>
            </div>
            <div class="placeholder-box">
              <strong>预留维护位</strong>
              <p>本阶段先完成项目的仓库、接口、Skill 和 MCP 闭环，工作流与硅基员工引用继续保留在项目详情页。</p>
            </div>
          </section>
        </article>
      </template>

      <div v-else class="empty-state glass-card-nx">
        <p>{{ detailError || "没有找到对应项目。" }}</p>
        <NuxtLink to="/projects" class="action-btn-secondary">返回项目列表</NuxtLink>
      </div>

      <Teleport to="body">
        <div v-if="activeAddModalAction" class="modal-overlay">
          <div class="editor-modal glass-card-nx" role="dialog" aria-modal="true" aria-labelledby="project-config-add-modal-title">
            <header class="modal-header">
              <div>
                <p class="eyebrow">项目配置</p>
                <h3 id="project-config-add-modal-title">
                  {{
                    `${projectConfigModalMode === "edit" ? "编辑" : "新增"}${
                      activeAddModalAction === "service"
                        ? "服务端点"
                        : activeAddModalAction === "repository"
                          ? "仓库"
                          : activeAddModalAction === "api"
                            ? "接口"
                            : activeAddModalAction === "skill"
                              ? " Skill"
                              : " MCP"
                    }`
                  }}
                </h3>
              </div>
              <button type="button" class="close-btn" aria-label="关闭" @click="closeProjectConfigAddModal">&times;</button>
            </header>

            <div class="modal-form">
              <template v-if="activeAddModalAction === 'service'">
                <p class="form-hint">服务端点用于给接口选择 Base URL，确认后会立即保存并刷新当前服务列表。</p>
                <div class="form-grid two-columns">
                  <div class="form-group">
                    <label>服务名称</label>
                    <input v-model="addModalDraft.service.name" type="text" placeholder="例如：order-service" />
                  </div>
                  <div class="form-group">
                    <label>Base URL</label>
                    <input v-model="addModalDraft.service.baseUrl" type="url" placeholder="https://api.example.com/orders" />
                  </div>
                  <div class="form-group wide">
                    <label>服务说明</label>
                    <textarea v-model="addModalDraft.service.description" rows="3" placeholder="说明这个服务负责的接口范围"></textarea>
                  </div>
                  <label class="toggle-row wide">
                    <input v-model="addModalDraft.service.enabled" type="checkbox" />
                    <span>{{ addModalDraft.service.enabled ? "启用服务" : "停用服务" }}</span>
                  </label>
                </div>
              </template>

              <template v-else-if="activeAddModalAction === 'repository'">
                <div class="form-grid two-columns">
                  <div class="form-group">
                    <label>仓库名称</label>
                    <input v-model="addModalDraft.repository.name" type="text" placeholder="frontend" />
                  </div>
                  <div class="form-group">
                    <label>仓库类型</label>
                    <select v-model="addModalDraft.repository.repoType">
                      <option v-for="option in REPOSITORY_TYPE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>默认分支</label>
                    <input v-model="addModalDraft.repository.defaultBranch" type="text" placeholder="main" />
                  </div>
                  <div class="form-group">
                    <label>仓库地址</label>
                    <input v-model="addModalDraft.repository.gitUrl" type="url" placeholder="https://git.example.com/group/repo.git" />
                  </div>
                  <div class="form-group wide">
                    <label>仓库说明</label>
                    <textarea v-model="addModalDraft.repository.description" rows="3"></textarea>
                  </div>
                  <label class="toggle-row wide">
                    <input v-model="addModalDraft.repository.enabled" type="checkbox" />
                    <span>{{ addModalDraft.repository.enabled ? "启用仓库" : "停用仓库" }}</span>
                  </label>
                </div>
              </template>

              <template v-else-if="activeAddModalAction === 'api'">
                <p class="form-hint">接口属于当前项目。确认后会立即保存并回到接口摘要行。</p>
                <div class="form-grid two-columns">
                  <div class="form-group">
                    <label>接口名称</label>
                    <input v-model="addModalDraft.api.name" type="text" placeholder="查询订单" />
                  </div>
                  <div class="form-group">
                    <label>服务</label>
                    <select v-model="addModalDraft.api.serviceName">
                      <option value="">未选择服务</option>
                      <option v-for="service in serviceOptions" :key="service.id" :value="service.name">
                        {{ service.name }} · {{ service.baseUrl }}
                      </option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>HTTP 方法</label>
                    <select v-model="addModalDraft.api.method">
                      <option v-for="method in API_METHOD_OPTIONS" :key="method" :value="method">{{ method }}</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>方向</label>
                    <select v-model="addModalDraft.api.direction">
                      <option v-for="option in API_DIRECTION_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
                    </select>
                  </div>
                  <div class="form-group wide">
                    <label>路径</label>
                    <input v-model="addModalDraft.api.path" type="text" placeholder="/api/orders/:id" />
                  </div>
                  <div class="form-group">
                    <label>Body 类型</label>
                    <select v-model="addModalDraft.api.requestBodyType">
                      <option v-for="option in API_BODY_TYPE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Content-Type</label>
                    <input v-model="addModalDraft.api.requestBodyContentType" type="text" placeholder="application/json" />
                  </div>
                  <div class="form-group wide">
                    <label>请求参数 JSON</label>
                    <textarea
                      v-model="addModalDraft.api.parametersText"
                      rows="6"
                      placeholder='[{"name":"Authorization","in":"header","required":true,"type":"string"},{"name":"page","in":"query","required":false,"type":"number"}]'
                    ></textarea>
                  </div>
                  <div class="form-group wide">
                    <label>Body 示例 JSON</label>
                    <textarea v-model="addModalDraft.api.requestBodyExampleText" rows="5" placeholder='{"keyword":"订单号"}'></textarea>
                  </div>
                  <div class="form-group wide">
                    <label>接口说明</label>
                    <textarea v-model="addModalDraft.api.description" rows="3"></textarea>
                  </div>
                  <label class="toggle-row wide">
                    <input v-model="addModalDraft.api.enabled" type="checkbox" />
                    <span>{{ addModalDraft.api.enabled ? "启用接口" : "停用接口" }}</span>
                  </label>
                </div>
              </template>

              <template v-else-if="activeAddModalAction === 'skill'">
                <div class="form-grid two-columns">
                  <div class="form-group">
                    <label>Skill</label>
                    <select v-model="addModalDraft.skill.skillId" @change="handleSkillSelectionChange(addModalDraft.skill)">
                      <option value="">请选择 Skill</option>
                      <option v-for="option in skillOptions" :key="option.id" :value="option.id">{{ option.name }}</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>版本</label>
                    <select v-model="addModalDraft.skill.skillReleaseId" :disabled="!addModalDraft.skill.skillId">
                      <option value="">自动跟随最新版本</option>
                      <option v-for="release in getSkillReleaseOptions(addModalDraft.skill.skillId)" :key="release.id" :value="release.id">
                        v{{ release.version }}
                      </option>
                    </select>
                  </div>
                  <div class="form-group wide">
                    <label>别名</label>
                    <input v-model="addModalDraft.skill.alias" type="text" placeholder="例如：订单分析助手" />
                  </div>
                  <label class="toggle-row wide">
                    <input v-model="addModalDraft.skill.enabled" type="checkbox" />
                    <span>{{ addModalDraft.skill.enabled ? "启用 Skill" : "停用 Skill" }}</span>
                  </label>
                </div>
              </template>

              <template v-else>
                <div class="form-grid two-columns">
                  <div class="form-group">
                    <label>MCP</label>
                    <select v-model="addModalDraft.mcp.mcpServerId" @change="handleMcpSelectionChange(addModalDraft.mcp)">
                      <option value="">请选择 MCP</option>
                      <option v-for="option in mcpOptions" :key="option.id" :value="option.id">{{ option.name }}</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>版本</label>
                    <select v-model="addModalDraft.mcp.mcpReleaseId" :disabled="!addModalDraft.mcp.mcpServerId">
                      <option value="">自动跟随最新版本</option>
                      <option v-for="release in getMcpReleaseOptions(addModalDraft.mcp.mcpServerId)" :key="release.id" :value="release.id">
                        v{{ release.version }}
                      </option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>风险级别</label>
                    <select v-model="addModalDraft.mcp.riskLevel">
                      <option v-for="option in MCP_RISK_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>别名</label>
                    <input v-model="addModalDraft.mcp.alias" type="text" placeholder="例如：项目知识库 MCP" />
                  </div>
                  <label class="toggle-row wide">
                    <input v-model="addModalDraft.mcp.enabled" type="checkbox" />
                    <span>{{ addModalDraft.mcp.enabled ? "启用 MCP" : "停用 MCP" }}</span>
                  </label>
                </div>
              </template>

              <p v-if="addModalError" class="status-msg error">{{ addModalError }}</p>

              <div class="modal-actions">
                <button type="button" class="action-btn-secondary" @click="closeProjectConfigAddModal">取消</button>
                <button type="button" class="action-btn-primary" :disabled="savePending" @click="confirmProjectConfigModal">
                  {{ savePending ? "正在保存..." : configModalSubmitText }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Teleport>
    </div>
  </main>
</template>

<style scoped>
.project-detail-page {
  position: relative;
  min-height: calc(100vh - 64px);
  width: 100%;
  background: var(--bg-main);
}

.detail-container {
  position: relative;
  z-index: 10;
  max-width: 1320px;
  margin: 0 auto;
  padding: 40px;
}

.glass-card-nx {
  background: var(--bg-main);
  border: 1px solid var(--border-muted);
  border-radius: 8px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.08);
}

.nav-bar {
  margin-bottom: 24px;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--border-main);
  background: var(--bg-input);
  color: var(--text-dim);
  text-decoration: none;
  font-size: 0.85rem;
  font-weight: 800;
  transition: 0.2s;
}

.back-link:hover {
  color: var(--text-main);
  border-color: rgba(var(--nuxt-green-rgb), 0.35);
}

.back-link svg {
  width: 16px;
  height: 16px;
}

.hero-section {
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin-bottom: 28px;
}

.hero-main {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: flex-start;
}

.hero-title-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.project-code {
  display: inline-flex;
  width: fit-content;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid rgba(var(--nuxt-green-rgb), 0.22);
  background: rgba(var(--nuxt-green-rgb), 0.08);
  color: var(--nuxt-green);
  font-size: 0.74rem;
  font-weight: 900;
  text-transform: uppercase;
}

.hero-title-block h1 {
  margin: 0;
  font-size: 1.85rem;
  font-weight: 950;
  color: var(--text-main);
  letter-spacing: 0;
}

.hero-description {
  margin: 0;
  max-width: 780px;
  color: var(--text-muted);
  font-size: 0.95rem;
  line-height: 1.7;
}

.hero-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-end;
}

.action-btn-primary,
.action-btn-secondary {
  min-height: 40px;
  padding: 0 18px;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 850;
  cursor: pointer;
  transition: 0.2s;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.action-btn-primary:disabled,
.action-btn-secondary:disabled {
  cursor: not-allowed;
  opacity: 0.62;
  transform: none;
}

.action-btn-primary {
  border: none;
  background: var(--nuxt-green);
  color: var(--btn-text);
}

.action-btn-primary:hover,
.action-btn-secondary:hover {
  transform: translateY(-1px);
}

.action-btn-secondary {
  border: 1px solid var(--border-main);
  background: var(--bg-input);
  color: var(--text-main);
}

.status-pill,
.mini-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid rgba(var(--nuxt-green-rgb), 0.22);
  background: rgba(var(--nuxt-green-rgb), 0.08);
  color: var(--nuxt-green);
  font-size: 0.75rem;
  font-weight: 850;
  white-space: nowrap;
}

.status-pill.archived,
.mini-pill.disabled {
  color: var(--text-dim);
  background: var(--bg-input);
  border-color: var(--border-main);
}

.hero-meta-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 14px;
}

.meta-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border-radius: 8px;
  border: 1px solid var(--border-main);
  background: var(--bg-input);
}

.meta-label {
  font-size: 0.75rem;
  font-weight: 850;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0;
}

.meta-value {
  font-size: 0.96rem;
  font-weight: 900;
  color: var(--text-main);
  word-break: break-word;
}

.project-detail-panel {
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.section-header h2 {
  margin: 0;
  color: var(--text-main);
  font-size: 1.08rem;
  font-weight: 900;
}

.section-header p {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 0.88rem;
  line-height: 1.6;
}

.section-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(var(--nuxt-green-rgb), 0.08);
  color: var(--nuxt-green);
  font-size: 0.8rem;
  font-weight: 850;
  white-space: nowrap;
}

.section-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.section-add-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid rgba(var(--nuxt-green-rgb), 0.24);
  background: var(--bg-input);
  color: var(--nuxt-green);
  font-size: 0.8rem;
  font-weight: 850;
  line-height: 1;
  text-decoration: none;
  white-space: nowrap;
  transition: 0.2s;
  cursor: pointer;
  font-family: inherit;
}

.section-add-link:hover {
  transform: translateY(-1px);
  border-color: rgba(var(--nuxt-green-rgb), 0.44);
  background: rgba(var(--nuxt-green-rgb), 0.08);
}

.resource-table {
  display: grid;
  overflow: hidden;
  border: 1px solid var(--border-main);
  border-radius: 8px;
  background: var(--bg-input);
}

.resource-row {
  display: grid;
  align-items: center;
  gap: 12px;
  min-height: 54px;
  padding: 10px 14px;
  border-top: 1px solid var(--border-muted);
  color: var(--text-main);
  font-size: 0.86rem;
}

.resource-row:first-child {
  border-top: none;
}

.resource-row--head {
  min-height: 40px;
  background: rgba(var(--nuxt-green-rgb), 0.06);
  color: var(--text-dim);
  font-size: 0.72rem;
  font-weight: 900;
  text-transform: uppercase;
}

.resource-table--repositories .resource-row {
  grid-template-columns: minmax(160px, 1.1fr) minmax(130px, 0.8fr) minmax(260px, 1.5fr) 84px 48px;
}

.resource-table--services .resource-row {
  grid-template-columns: minmax(150px, 1fr) minmax(260px, 1.5fr) 84px minmax(180px, 1fr) 48px;
}

.resource-table--apis .resource-row {
  grid-template-columns: minmax(160px, 1fr) minmax(220px, 1.4fr) minmax(130px, 0.8fr) minmax(120px, 0.8fr) 84px 48px;
}

.resource-table--skills .resource-row {
  grid-template-columns: minmax(180px, 1.2fr) minmax(150px, 0.9fr) minmax(120px, 0.8fr) 84px 48px;
}

.resource-table--mcps .resource-row {
  grid-template-columns: minmax(180px, 1.2fr) minmax(150px, 0.8fr) minmax(90px, 0.6fr) minmax(120px, 0.8fr) 84px 48px;
}

.resource-primary {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.resource-primary strong,
.resource-primary small,
.resource-url,
.resource-muted {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resource-primary strong {
  color: var(--text-main);
  font-weight: 900;
}

.resource-primary small,
.resource-muted {
  color: var(--text-muted);
  font-size: 0.78rem;
}

.resource-url {
  font-family: "Fira Code", "SFMono-Regular", monospace;
  font-size: 0.8rem;
}

.resource-actions {
  display: flex;
  justify-content: flex-end;
}

.icon-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid var(--border-main);
  background: var(--bg-main);
  color: var(--text-dim);
  transition: 0.2s;
  cursor: pointer;
}

.icon-action:hover {
  transform: translateY(-1px);
  border-color: rgba(var(--nuxt-green-rgb), 0.38);
  color: var(--text-main);
}

.icon-action svg {
  width: 15px;
  height: 15px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.detail-card,
.placeholder-box {
  border: 1px solid var(--border-main);
  border-radius: 8px;
  background: var(--bg-input);
}

.detail-card {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.detail-card.compact {
  padding: 16px;
}

.single-card {
  width: 100%;
}

.detail-card-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.detail-card-head h3 {
  margin: 0;
  color: var(--text-main);
  font-size: 0.98rem;
  font-weight: 900;
}

.detail-muted {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.88rem;
  line-height: 1.6;
}

.detail-meta-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin: 0;
}

.detail-meta-list div {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-meta-list .wide {
  grid-column: 1 / -1;
}

.detail-meta-list dt {
  font-size: 0.74rem;
  font-weight: 850;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0;
}

.detail-meta-list dd {
  margin: 0;
  color: var(--text-main);
  font-size: 0.9rem;
  line-height: 1.6;
  word-break: break-word;
}

.json-preview {
  margin: 0;
  padding: 12px 14px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.78);
  color: #dbeafe;
  font-family: "Fira Code", "SFMono-Regular", monospace;
  font-size: 0.8rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.empty-hint {
  margin: 0;
  padding: 16px 18px;
  border-radius: 8px;
  border: 1px dashed var(--border-main);
  color: var(--text-dim);
  font-size: 0.88rem;
}

.empty-hint-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.stack-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.placeholder-box {
  padding: 20px;
}

.placeholder-box strong {
  display: block;
  margin-bottom: 8px;
  color: var(--text-main);
  font-size: 1rem;
}

.placeholder-box p {
  margin: 0;
  color: var(--text-muted);
  line-height: 1.7;
}

.state-container,
.empty-state {
  padding: 120px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  text-align: center;
  color: var(--text-dim);
}

.pulse-loader-nx {
  width: 44px;
  height: 44px;
  border: 4px solid var(--border-muted);
  border-top-color: var(--nuxt-green);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.form-grid {
  display: grid;
  gap: 14px;
}

.form-grid.two-columns {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group.wide,
.toggle-row.wide {
  grid-column: 1 / -1;
}

.form-group label {
  color: var(--text-dim);
  font-size: 0.74rem;
  font-weight: 850;
  text-transform: uppercase;
  letter-spacing: 0;
}

.form-group input,
.form-group select,
.form-group textarea {
  width: 100%;
  border: 1px solid var(--border-main);
  border-radius: 8px;
  background: var(--bg-main);
  color: var(--text-main);
  padding: 12px 14px;
  font-family: inherit;
  box-sizing: border-box;
}

.form-group input,
.form-group select {
  min-height: 44px;
}

.form-group textarea {
  resize: vertical;
  line-height: 1.6;
}

.form-group input:disabled,
.form-group select:disabled {
  cursor: not-allowed;
  opacity: 0.68;
}

.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus {
  outline: none;
  border-color: rgba(var(--nuxt-green-rgb), 0.7);
  box-shadow: 0 0 0 3px rgba(var(--nuxt-green-rgb), 0.12);
}

.toggle-row {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  color: var(--text-main);
  font-size: 0.86rem;
  font-weight: 800;
}

.toggle-row input {
  width: 16px;
  height: 16px;
  accent-color: var(--nuxt-green);
}

.status-msg {
  margin: 0;
  padding: 12px 14px;
  border-radius: 8px;
  font-size: 0.88rem;
  font-weight: 800;
}

.status-msg.error {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(8px);
}

.editor-modal {
  width: min(780px, 100%);
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 26px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 18px;
}

.modal-header h3 {
  margin: 0;
  color: var(--text-main);
  font-size: 1.24rem;
  font-weight: 950;
}

.close-btn {
  width: 36px;
  height: 36px;
  border: 1px solid var(--border-main);
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text-dim);
  cursor: pointer;
  font-size: 1.3rem;
  line-height: 1;
}

.close-btn:hover {
  color: var(--text-main);
  border-color: rgba(var(--nuxt-green-rgb), 0.35);
}

.modal-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-hint {
  margin: 0;
  padding: 12px 14px;
  border: 1px solid rgba(var(--nuxt-green-rgb), 0.18);
  border-radius: 8px;
  background: rgba(var(--nuxt-green-rgb), 0.07);
  color: var(--text-muted);
  font-size: 0.88rem;
  line-height: 1.6;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 4px;
}

@media (max-width: 1180px) {
  .hero-meta-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .detail-container {
    padding: 24px 16px;
  }

  .hero-main,
  .section-header,
  .detail-card-head {
    flex-direction: column;
  }

  .section-actions,
  .empty-hint-action {
    align-items: stretch;
    width: 100%;
  }

  .hero-actions {
    align-items: flex-start;
  }

  .hero-meta-grid,
  .detail-meta-list {
    grid-template-columns: 1fr;
  }

  .resource-row,
  .resource-table--repositories .resource-row,
  .resource-table--services .resource-row,
  .resource-table--apis .resource-row,
  .resource-table--skills .resource-row,
  .resource-table--mcps .resource-row {
    grid-template-columns: 1fr auto;
  }

  .resource-row--head {
    display: none;
  }

  .resource-row {
    align-items: flex-start;
    padding: 14px;
  }

  .resource-row > :not(.resource-actions) {
    grid-column: 1 / -1;
  }

  .resource-actions {
    grid-column: 2;
    grid-row: 1;
  }

  .action-btn-primary,
  .action-btn-secondary,
  .section-add-link {
    width: 100%;
  }

  .form-grid.two-columns {
    grid-template-columns: 1fr;
  }

  .modal-overlay {
    align-items: stretch;
    padding: 12px;
  }

  .editor-modal {
    max-height: calc(100vh - 24px);
    padding: 20px;
  }

  .modal-actions {
    flex-direction: column-reverse;
  }
}
</style>
