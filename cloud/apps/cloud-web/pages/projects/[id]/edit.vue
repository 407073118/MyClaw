<script setup lang="ts">
import type {
  McpItemDetail,
  McpItemSummary,
  ProjectApiDirection,
  ProjectApiProtocol,
  ProjectApiSource,
  ProjectDetail,
  ProjectRepositoryType,
  ProjectStatus,
  ReplaceProjectConfigInput,
  SkillDetail,
  SkillSummary
} from "@myclaw-cloud/shared";

type ProjectRepositoryFormItem = {
  formKey: string;
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
  formKey: string;
  name: string;
};

type ProjectApiFormItem = {
  formKey: string;
  description: string;
  direction: ProjectApiDirection;
  enabled: boolean;
  method: string;
  name: string;
  owner: string;
  path: string;
  protocol: ProjectApiProtocol;
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
  formKey: string;
  skillId: string;
  skillReleaseId: string;
};

type ProjectMcpFormItem = {
  alias: string;
  configOverrideText: string;
  enabled: boolean;
  formKey: string;
  mcpReleaseId: string;
  mcpServerId: string;
  riskLevel: string;
};

type ProjectFormState = {
  apis: ProjectApiFormItem[];
  code: string;
  description: string;
  mcps: ProjectMcpFormItem[];
  name: string;
  ownerAccount: string;
  repositories: ProjectRepositoryFormItem[];
  rongzhiBaseUrl: string;
  rongzhiEnabled: boolean;
  rongzhiProjectCode: string;
  rongzhiProjectName: string;
  services: ProjectServiceFormItem[];
  skills: ProjectSkillFormItem[];
  status: ProjectStatus;
};

type ProjectConfigAddAction = "service" | "repository" | "api" | "skill" | "mcp";
type ProjectConfigModalMode = "add" | "edit";

type ProjectConfigAddModalDraft = {
  api: ProjectApiFormItem;
  mcp: ProjectMcpFormItem;
  repository: ProjectRepositoryFormItem;
  service: ProjectServiceFormItem;
  skill: ProjectSkillFormItem;
};

const PROJECT_CONFIG_ADD_ANCHORS: Record<ProjectConfigAddAction, string> = {
  service: "services",
  repository: "repositories",
  api: "apis",
  skill: "skills",
  mcp: "mcps"
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

const API_PROTOCOL_OPTIONS: { label: string; value: ProjectApiProtocol }[] = [
  { value: "http", label: "HTTP" },
  { value: "rpc", label: "RPC" },
  { value: "graphql", label: "GraphQL" },
  { value: "event", label: "事件" },
  { value: "other", label: "其他" }
];

const API_SOURCE_OPTIONS: { label: string; value: ProjectApiSource }[] = [
  { value: "manual", label: "手工维护" },
  { value: "openapi", label: "OpenAPI 导入" },
  { value: "repo-scan", label: "仓库扫描" },
  { value: "rongzhi", label: "融智同步" }
];

const API_METHOD_OPTIONS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "维护中",
  archived: "已归档"
};

const MCP_RISK_OPTIONS = [
  { value: "", label: "未标注" },
  { value: "low", label: "低风险" },
  { value: "medium", label: "中风险" },
  { value: "high", label: "高风险" }
] as const;

const route = useRoute();
const { user } = useCloudSession();

const savePending = ref(false);
const formError = ref("");
const formSuccess = ref("");
const detailError = ref("");
const consumedAddActionKey = ref("");
const activeAddModalAction = ref<ProjectConfigAddAction | null>(null);
const addModalError = ref("");
const projectConfigModalMode = ref<ProjectConfigModalMode>("add");
const editingConfigFormKey = ref("");

const projectId = computed(() => String(route.params.id ?? ""));
const skillDetailMap = reactive<Record<string, SkillDetail | null>>({});
const mcpDetailMap = reactive<Record<string, McpItemDetail | null>>({});
const skillDetailLoading = new Set<string>();
const mcpDetailLoading = new Set<string>();
let formKeySeed = 0;

const projectForm = reactive<ProjectFormState>(createEmptyProjectForm());
const addModalDraft = reactive<ProjectConfigAddModalDraft>(createProjectConfigAddModalDraft());

const configModalSubmitText = computed(() => (projectConfigModalMode.value === "edit" ? "保存修改" : "添加"));

const { data: selectedProject, pending, refresh } = await useAsyncData<ProjectDetail | null>(
  () => `project-edit:${projectId.value}`,
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

const totalCapabilities = computed(() => {
  const project = selectedProject.value;
  return (project?.skills.length ?? 0) + (project?.mcps.length ?? 0);
});

watch(
  () => selectedProject.value,
  (project) => {
    console.info("[项目详情] 收到项目详情刷新结果", { hasProject: Boolean(project) });
    if (project) {
      syncProjectForm(project);
    }
  },
  { immediate: true }
);

onMounted(() => {
  console.info("[项目详情] 页面挂载后检查路由新增动作", { add: route.query.add });
  consumeAddActionFromRoute();
});

watch(
  () => [route.query.add, selectedProject.value?.id],
  () => {
    console.info("[项目详情] 路由新增动作或项目详情发生变化", {
      add: route.query.add,
      projectId: selectedProject.value?.id
    });
    consumeAddActionFromRoute();
  }
);

watch(
  () => projectForm.skills.map((item) => item.skillId).join("|"),
  () => {
    console.info("[项目详情] 开始预热 Skill 版本选项", { skillCount: projectForm.skills.length });
    projectForm.skills.forEach((item) => {
      if (item.skillId) {
        void ensureSkillDetail(item.skillId);
      }
    });
  },
  { immediate: true }
);

watch(
  () => projectForm.mcps.map((item) => item.mcpServerId).join("|"),
  () => {
    console.info("[项目详情] 开始预热 MCP 版本选项", { mcpCount: projectForm.mcps.length });
    projectForm.mcps.forEach((item) => {
      if (item.mcpServerId) {
        void ensureMcpDetail(item.mcpServerId);
      }
    });
  },
  { immediate: true }
);

useHead(() => ({
  title: selectedProject.value ? `${selectedProject.value.name} | 项目维护` : "项目维护 | MyClaw Cloud"
}));

/** 中文说明：创建空项目编辑表单，保证编辑页在详情加载前也有稳定默认结构。 */
function createEmptyProjectForm(): ProjectFormState {
  console.info("[项目详情] 创建空项目编辑表单");
  return {
    apis: [],
    code: "",
    description: "",
    mcps: [],
    name: "",
    ownerAccount: user.value?.account ?? "",
    repositories: [],
    rongzhiBaseUrl: "",
    rongzhiEnabled: false,
    rongzhiProjectCode: "",
    rongzhiProjectName: "",
    services: [],
    skills: [],
    status: "active"
  };
}

/** 中文说明：把后端项目详情同步到结构化编辑表单，避免新增卡片缺少基础数组。 */
function syncProjectForm(project: ProjectDetail): void {
  console.info("[项目详情] 同步项目详情到编辑表单", {
    projectId: project.id,
    repositoryCount: project.repositories.length,
    serviceCount: project.services?.length ?? 0,
    apiCount: project.apis.length,
    skillCount: project.skills.length,
    mcpCount: project.mcps.length
  });
  Object.assign(projectForm, {
    apis: project.apis.map((api) => createApiFormItem(api)),
    code: project.code,
    description: project.description ?? "",
    mcps: project.mcps.map((mcp) => createMcpFormItem(mcp)),
    name: project.name,
    ownerAccount: project.ownerAccount,
    repositories: project.repositories.map((repository) => createRepositoryFormItem(repository)),
    rongzhiBaseUrl: project.rongzhiLink?.baseUrl ?? "",
    rongzhiEnabled: project.rongzhiLink?.enabled ?? false,
    rongzhiProjectCode: project.rongzhiLink?.projectCode ?? "",
    rongzhiProjectName: project.rongzhiLink?.projectName ?? "",
    services: (project.services ?? []).map((service) => createServiceFormItem(service)),
    skills: project.skills.map((skill) => createSkillFormItem(skill)),
    status: project.status
  });
}

/** 中文说明：创建项目服务端点表单项，接口新增时会从这里选择所属服务。 */
function createServiceFormItem(service?: ProjectDetail["services"][number]): ProjectServiceFormItem {
  console.info("[项目详情] 创建服务端点表单项", { hasService: Boolean(service), serviceName: service?.name });
  return {
    baseUrl: service?.baseUrl ?? "",
    description: service?.description ?? "",
    enabled: service?.enabled ?? true,
    formKey: `service-${++formKeySeed}`,
    name: service?.name ?? ""
  };
}

/** 中文说明：创建仓库表单项，支持从详情数据回填或新增空白卡片。 */
function createRepositoryFormItem(repository?: ProjectDetail["repositories"][number]): ProjectRepositoryFormItem {
  console.info("[项目详情] 创建仓库表单项", { hasRepository: Boolean(repository) });
  return {
    formKey: `repository-${++formKeySeed}`,
    defaultBranch: repository?.defaultBranch ?? "",
    description: repository?.description ?? "",
    enabled: repository?.enabled ?? true,
    gitUrl: repository?.gitUrl ?? "",
    name: repository?.name ?? "",
    repoType: repository?.repoType ?? "other"
  };
}

/** 中文说明：创建接口表单项，支持详情回填和详情页快捷新增。 */
function createApiFormItem(api?: ProjectDetail["apis"][number]): ProjectApiFormItem {
  console.info("[项目详情] 创建接口表单项", { hasApi: Boolean(api) });
  return {
    formKey: `api-${++formKeySeed}`,
    description: api?.description ?? "",
    direction: api?.direction ?? "provided",
    enabled: api?.enabled ?? true,
    method: api?.method ?? "GET",
    name: api?.name ?? "",
    owner: api?.owner ?? "",
    path: api?.path ?? "",
    protocol: api?.protocol ?? "http",
    requestSchemaText: stringifyJson(api?.requestSchemaJson),
    responseSchemaText: stringifyJson(api?.responseSchemaJson),
    serviceName: api?.serviceName ?? resolveDefaultServiceName(),
    source: api?.source ?? "manual",
    tagsText: stringifyTags(api?.tagsJson)
  };
}

/** 中文说明：解析新增接口的默认服务，单服务项目直接预选，多服务项目留给用户显式选择。 */
function resolveDefaultServiceName(): string {
  const enabledServices = projectForm.services.filter((service) => service.enabled && service.name.trim());
  console.info("[项目详情] 解析新增接口默认服务", { enabledServiceCount: enabledServices.length });
  return enabledServices.length === 1 ? enabledServices[0].name : "";
}

/** 中文说明：创建项目配置新增弹窗草稿，保证每次打开弹窗都有干净的结构。 */
function createProjectConfigAddModalDraft(): ProjectConfigAddModalDraft {
  console.info("[项目详情] 创建项目配置新增弹窗草稿");
  return {
    api: createApiFormItem(),
    mcp: createMcpFormItem(),
    repository: createRepositoryFormItem(),
    service: createServiceFormItem(),
    skill: createSkillFormItem()
  };
}

/** 中文说明：创建 Skill 挂载表单项，支持空白新增和已有配置回填。 */
function createSkillFormItem(skill?: ProjectDetail["skills"][number]): ProjectSkillFormItem {
  console.info("[项目详情] 创建 Skill 表单项", { hasSkill: Boolean(skill), skillId: skill?.skillId });
  return {
    alias: skill?.alias ?? "",
    configText: stringifyJson(skill?.configJson),
    enabled: skill?.enabled ?? true,
    formKey: `skill-${++formKeySeed}`,
    skillId: skill?.skillId ?? "",
    skillReleaseId: skill?.skillReleaseId ?? ""
  };
}

/** 中文说明：创建 MCP 挂载表单项，支持空白新增和已有配置回填。 */
function createMcpFormItem(mcp?: ProjectDetail["mcps"][number]): ProjectMcpFormItem {
  console.info("[项目详情] 创建 MCP 表单项", { hasMcp: Boolean(mcp), mcpServerId: mcp?.mcpServerId });
  return {
    alias: mcp?.alias ?? "",
    configOverrideText: stringifyJson(mcp?.configOverrideJson),
    enabled: mcp?.enabled ?? true,
    formKey: `mcp-${++formKeySeed}`,
    mcpReleaseId: mcp?.mcpReleaseId ?? "",
    mcpServerId: mcp?.mcpServerId ?? "",
    riskLevel: mcp?.riskLevel ?? ""
  };
}

/** 中文说明：校验路由中的新增动作，避免未知参数误触发表单变更。 */
function isProjectConfigAddAction(value: string): value is ProjectConfigAddAction {
  console.info("[项目详情] 校验路由新增动作", { value });
  return value === "service" || value === "repository" || value === "api" || value === "skill" || value === "mcp";
}

/** 中文说明：消费详情页传入的新增动作，并在编辑器中打开对应配置弹窗。 */
function consumeAddActionFromRoute(): void {
  const rawAddAction = Array.isArray(route.query.add) ? route.query.add[0] : route.query.add;
  console.info("[项目详情] 准备消费路由新增动作", { rawAddAction, hasProject: Boolean(selectedProject.value) });

  if (!rawAddAction || typeof rawAddAction !== "string") {
    return;
  }

  if (!isProjectConfigAddAction(rawAddAction)) {
    console.warn("[项目详情] 忽略未知路由新增动作", { rawAddAction });
    return;
  }

  if (!selectedProject.value) {
    console.info("[项目详情] 项目详情尚未加载，延后消费路由新增动作", { rawAddAction });
    return;
  }

  const actionKey = `${projectId.value}:${rawAddAction}`;
  if (consumedAddActionKey.value === actionKey) {
    console.info("[项目详情] 路由新增动作已经消费过，跳过重复追加", { actionKey });
    return;
  }

  consumedAddActionKey.value = actionKey;
  openProjectConfigAddModal(rawAddAction);
  void cleanupProjectConfigAddRoute();
}

/** 中文说明：跳转并聚焦刚刚新增的项目配置区块，减少详情页到编辑页的寻找成本。 */
async function scrollToProjectConfigSection(action: ProjectConfigAddAction): Promise<void> {
  console.info("[项目详情] 准备滚动到配置区块", { action });
  if (!import.meta.client) {
    return;
  }

  await nextTick();
  const anchor = PROJECT_CONFIG_ADD_ANCHORS[action];
  const target = document.getElementById(anchor);
  if (!target) {
    console.warn("[项目详情] 未找到配置区块锚点，跳过路由 hash 替换", { action, anchor });
    return;
  }

  target.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
  const query = { ...route.query };
  delete query.add;
  console.info("[项目详情] 配置区块已出现，准备清理新增参数并保留手动滚动位置", { action, anchor });
  await navigateTo({ path: route.path, query }, { replace: true });
}

/** 中文说明：清理路由新增参数，避免刷新页面时重复弹出新增配置弹窗。 */
async function cleanupProjectConfigAddRoute(): Promise<void> {
  console.info("[项目详情] 准备清理路由新增参数", { add: route.query.add });
  const query = { ...route.query };
  delete query.add;
  await navigateTo({ path: route.path, query }, { replace: true });
}

/** 中文说明：新增服务端点配置行，供接口按服务选择基础地址。 */
function addService(service = createServiceFormItem()): void {
  console.info("[项目详情] 新增服务端点配置行", { serviceName: service.name });
  projectForm.services.push(service);
}

/** 中文说明：删除指定服务端点配置行，同时保留接口中已有服务名供用户自行调整。 */
function removeService(formKey: string): void {
  console.info("[项目详情] 删除服务端点配置行", { formKey });
  projectForm.services = projectForm.services.filter((item) => item.formKey !== formKey);
}

/** 中文说明：新增仓库配置行，供项目维护台逐项维护仓库元数据。 */
function addRepository(repository = createRepositoryFormItem()): void {
  console.info("[项目详情] 新增仓库配置行", { repositoryName: repository.name });
  projectForm.repositories.push(repository);
}

/** 中文说明：删除指定仓库配置行，避免用户误删其它项。 */
function removeRepository(formKey: string): void {
  console.info("[项目详情] 删除仓库配置行", { formKey });
  projectForm.repositories = projectForm.repositories.filter((item) => item.formKey !== formKey);
}

/** 中文说明：新增接口配置行，供项目维护台逐条维护接口契约。 */
function addApi(api = createApiFormItem()): void {
  console.info("[项目详情] 新增接口配置行", { apiName: api.name, serviceName: api.serviceName });
  projectForm.apis.push(api);
}

/** 中文说明：删除指定接口配置行，保持接口清单结构化。 */
function removeApi(formKey: string): void {
  console.info("[项目详情] 删除接口配置行", { formKey });
  projectForm.apis = projectForm.apis.filter((item) => item.formKey !== formKey);
}

/** 中文说明：新增 Skill 挂载配置行，供项目逐项绑定能力包。 */
function addSkillRef(skill = createSkillFormItem()): void {
  console.info("[项目详情] 新增 Skill 配置行", { skillId: skill.skillId });
  projectForm.skills.push(skill);
}

/** 中文说明：删除指定 Skill 挂载配置行。 */
function removeSkillRef(formKey: string): void {
  console.info("[项目详情] 删除 Skill 配置行", { formKey });
  projectForm.skills = projectForm.skills.filter((item) => item.formKey !== formKey);
}

/** 中文说明：新增 MCP 挂载配置行，供项目逐项绑定工具连接器。 */
function addMcpRef(mcp = createMcpFormItem()): void {
  console.info("[项目详情] 新增 MCP 配置行", { mcpServerId: mcp.mcpServerId });
  projectForm.mcps.push(mcp);
}

/** 中文说明：删除指定 MCP 挂载配置行。 */
function removeMcpRef(formKey: string): void {
  console.info("[项目详情] 删除 MCP 配置行", { formKey });
  projectForm.mcps = projectForm.mcps.filter((item) => item.formKey !== formKey);
}

/** 中文说明：重置新增配置弹窗草稿，确保用户不会看到上一次未提交内容。 */
function resetProjectConfigAddModalDraft(action: ProjectConfigAddAction): void {
  console.info("[项目详情] 重置新增配置弹窗草稿", { action });
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

/** 中文说明：打开项目配置新增弹窗，按配置类型展示最小必要字段。 */
function openProjectConfigAddModal(action: ProjectConfigAddAction): void {
  console.info("[项目详情] 打开项目配置新增弹窗", { action });
  addModalError.value = "";
  projectConfigModalMode.value = "add";
  editingConfigFormKey.value = "";
  resetProjectConfigAddModalDraft(action);
  activeAddModalAction.value = action;
}

/** 中文说明：打开项目配置编辑弹窗，把当前行复制为临时草稿，取消时不污染行数据。 */
function openProjectConfigEditModal(action: ProjectConfigAddAction, formKey: string): void {
  console.info("[项目详情] 打开项目配置编辑弹窗", { action, formKey });
  addModalError.value = "";
  projectConfigModalMode.value = "edit";
  editingConfigFormKey.value = formKey;
  seedProjectConfigEditModalDraft(action, formKey);
  activeAddModalAction.value = action;
}

/** 中文说明：关闭项目配置新增弹窗，并清理弹窗内错误提示。 */
function closeProjectConfigAddModal(): void {
  console.info("[项目详情] 关闭项目配置弹窗", {
    action: activeAddModalAction.value,
    mode: projectConfigModalMode.value,
    formKey: editingConfigFormKey.value
  });
  activeAddModalAction.value = null;
  addModalError.value = "";
  projectConfigModalMode.value = "add";
  editingConfigFormKey.value = "";
}

/** 中文说明：确认项目配置弹窗，新增时追加行，编辑时把草稿回写到目标行。 */
async function confirmProjectConfigAddModal(): Promise<void> {
  const action = activeAddModalAction.value;
  console.info("[项目详情] 确认项目配置弹窗", {
    action,
    mode: projectConfigModalMode.value,
    formKey: editingConfigFormKey.value
  });
  if (!action) {
    return;
  }

  try {
    if (projectConfigModalMode.value === "edit") {
      applyProjectConfigEditModalDraft(action, editingConfigFormKey.value);
    } else {
      appendProjectConfigAddModalDraft(action);
    }
    closeProjectConfigAddModal();
    await scrollToProjectConfigSection(action);
  } catch (error: any) {
    addModalError.value = error?.message || "配置保存失败，请检查必填项。";
    console.error("[项目详情] 项目配置弹窗确认失败", { action, mode: projectConfigModalMode.value, error });
  }
}

/** 中文说明：按配置类型校验弹窗草稿，确保新增和编辑共用同一套必填规则。 */
function normalizeProjectConfigModalDraft(action: ProjectConfigAddAction): void {
  console.info("[项目详情] 校验项目配置弹窗草稿", { action });
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

/** 中文说明：追加项目配置新增弹窗草稿，并做弹窗级必填校验。 */
function appendProjectConfigAddModalDraft(action: ProjectConfigAddAction): void {
  console.info("[项目详情] 追加新增配置草稿", { action });
  normalizeProjectConfigModalDraft(action);
  if (action === "service") {
    addService({ ...addModalDraft.service, formKey: `service-${++formKeySeed}` });
  } else if (action === "repository") {
    addRepository({ ...addModalDraft.repository, formKey: `repository-${++formKeySeed}` });
  } else if (action === "api") {
    addApi({ ...addModalDraft.api, formKey: `api-${++formKeySeed}` });
  } else if (action === "skill") {
    addSkillRef({ ...addModalDraft.skill, formKey: `skill-${++formKeySeed}` });
  } else {
    addMcpRef({ ...addModalDraft.mcp, formKey: `mcp-${++formKeySeed}` });
  }
}

/** 中文说明：把指定配置行复制到弹窗草稿，保证编辑取消时能丢弃临时改动。 */
function seedProjectConfigEditModalDraft(action: ProjectConfigAddAction, formKey: string): void {
  console.info("[项目详情] 回填项目配置编辑弹窗草稿", { action, formKey });
  if (action === "service") {
    const item = projectForm.services.find((entry) => entry.formKey === formKey);
    if (item) addModalDraft.service = { ...item };
  } else if (action === "repository") {
    const item = projectForm.repositories.find((entry) => entry.formKey === formKey);
    if (item) addModalDraft.repository = { ...item };
  } else if (action === "api") {
    const item = projectForm.apis.find((entry) => entry.formKey === formKey);
    if (item) addModalDraft.api = { ...item };
  } else if (action === "skill") {
    const item = projectForm.skills.find((entry) => entry.formKey === formKey);
    if (item) addModalDraft.skill = { ...item };
  } else {
    const item = projectForm.mcps.find((entry) => entry.formKey === formKey);
    if (item) addModalDraft.mcp = { ...item };
  }
}

/** 中文说明：把弹窗草稿回写到目标配置行，保持保存前的页面状态仍是紧凑行。 */
function applyProjectConfigEditModalDraft(action: ProjectConfigAddAction, formKey: string): void {
  console.info("[项目详情] 应用项目配置编辑弹窗草稿", { action, formKey });
  normalizeProjectConfigModalDraft(action);
  if (action === "service") {
    const item = projectForm.services.find((entry) => entry.formKey === formKey);
    if (item) Object.assign(item, { ...addModalDraft.service, formKey });
  } else if (action === "repository") {
    const item = projectForm.repositories.find((entry) => entry.formKey === formKey);
    if (item) Object.assign(item, { ...addModalDraft.repository, formKey });
  } else if (action === "api") {
    const item = projectForm.apis.find((entry) => entry.formKey === formKey);
    if (item) Object.assign(item, { ...addModalDraft.api, formKey });
  } else if (action === "skill") {
    const item = projectForm.skills.find((entry) => entry.formKey === formKey);
    if (item) Object.assign(item, { ...addModalDraft.skill, formKey });
  } else {
    const item = projectForm.mcps.find((entry) => entry.formKey === formKey);
    if (item) Object.assign(item, { ...addModalDraft.mcp, formKey });
  }
}

/** 中文说明：删除项目前弹出确认，避免行级删除误触造成配置丢失。 */
function confirmProjectConfigDelete(action: ProjectConfigAddAction, formKey: string, label: string): void {
  console.info("[项目详情] 准备删除项目配置行", { action, formKey, label });
  const confirmed = typeof window === "undefined" || window.confirm(`确认删除“${label || "未命名配置"}”吗？`);
  if (!confirmed) {
    console.info("[项目详情] 取消删除项目配置行", { action, formKey });
    return;
  }

  if (action === "service") {
    removeService(formKey);
  } else if (action === "repository") {
    removeRepository(formKey);
  } else if (action === "api") {
    removeApi(formKey);
  } else if (action === "skill") {
    removeSkillRef(formKey);
  } else {
    removeMcpRef(formKey);
  }
}

/** 中文说明：处理 Skill 选择变化，并清理不再匹配的版本选择。 */
function handleSkillSelectionChange(item: ProjectSkillFormItem): void {
  console.info("[项目详情] Skill 选择发生变化", { skillId: item.skillId });
  item.skillReleaseId = "";
  if (item.skillId) {
    void ensureSkillDetail(item.skillId);
  }
}

/** 中文说明：处理 MCP 选择变化，并清理不再匹配的版本选择。 */
function handleMcpSelectionChange(item: ProjectMcpFormItem): void {
  console.info("[项目详情] MCP 选择发生变化", { mcpServerId: item.mcpServerId });
  item.mcpReleaseId = "";
  if (item.mcpServerId) {
    void ensureMcpDetail(item.mcpServerId);
  }
}

/** 中文说明：按需加载 Skill 详情，用于版本选择和展示。 */
async function ensureSkillDetail(skillId: string): Promise<void> {
  if (!skillId || skillDetailMap[skillId] !== undefined || skillDetailLoading.has(skillId)) {
    return;
  }

  console.info("[项目详情] 开始加载 Skill 详情", { skillId });
  skillDetailLoading.add(skillId);
  try {
    skillDetailMap[skillId] = await $fetch<SkillDetail>(`/api/skills/${skillId}`);
    console.info("[项目详情] Skill 详情加载成功", {
      skillId,
      releaseCount: skillDetailMap[skillId]?.releases.length ?? 0
    });
  } catch (error) {
    console.error("[项目详情] Skill 详情加载失败", { skillId, error });
    skillDetailMap[skillId] = null;
  } finally {
    skillDetailLoading.delete(skillId);
  }
}

/** 中文说明：按需加载 MCP 详情，用于版本选择和展示。 */
async function ensureMcpDetail(mcpServerId: string): Promise<void> {
  if (!mcpServerId || mcpDetailMap[mcpServerId] !== undefined || mcpDetailLoading.has(mcpServerId)) {
    return;
  }

  console.info("[项目详情] 开始加载 MCP 详情", { mcpServerId });
  mcpDetailLoading.add(mcpServerId);
  try {
    mcpDetailMap[mcpServerId] = await $fetch<McpItemDetail>(`/api/mcp/items/${mcpServerId}`);
    console.info("[项目详情] MCP 详情加载成功", {
      mcpServerId,
      releaseCount: mcpDetailMap[mcpServerId]?.releases.length ?? 0
    });
  } catch (error) {
    console.error("[项目详情] MCP 详情加载失败", { mcpServerId, error });
    mcpDetailMap[mcpServerId] = null;
  } finally {
    mcpDetailLoading.delete(mcpServerId);
  }
}

/** 中文说明：提交项目编辑表单，并把结构化卡片数据转换为后端契约。 */
async function handleSaveProject(): Promise<void> {
  if (!projectId.value) {
    console.warn("[项目详情] 缺少项目 ID，无法提交保存");
    formError.value = "缺少项目 ID，无法保存。";
    return;
  }

  console.info("[项目详情] 开始保存项目配置", { projectId: projectId.value });
  savePending.value = true;
  formError.value = "";
  formSuccess.value = "";

  try {
    await $fetch<ProjectDetail>(`/api/projects/${projectId.value}/config`, {
      method: "PUT",
      body: buildReplaceProjectPayload()
    });
    await refresh();
    formSuccess.value = "项目配置已保存。";
    console.info("[项目详情] 项目配置保存成功", { projectId: projectId.value });
  } catch (error: any) {
    formError.value = error?.data?.statusMessage || error?.statusMessage || error?.message || "项目配置保存失败。";
    console.error("[项目详情] 项目配置保存失败", { projectId: projectId.value, error });
  } finally {
    savePending.value = false;
    console.info("[项目详情] 项目配置保存流程结束", { projectId: projectId.value });
  }
}

/** 中文说明：构建项目替换配置请求体，并统一执行前端校验。 */
function buildReplaceProjectPayload(): ReplaceProjectConfigInput {
  console.info("[项目详情] 开始构建项目保存请求体", { projectId: projectId.value });
  return {
    name: requireText(projectForm.name, "项目名称"),
    description: nullableText(projectForm.description),
    ownerAccount: requireText(projectForm.ownerAccount, "负责人"),
    status: projectForm.status,
    updatedBy: resolveOperatorAccount(),
    services: buildServicePayload(),
    repositories: buildRepositoryPayload(),
    rongzhiLink: buildRongzhiPayload(),
    apis: buildApiPayload(),
    skills: buildSkillPayload(),
    mcps: buildMcpPayload()
  };
}

/** 中文说明：构建服务端点请求体数组，接口会通过服务名称选择基础地址。 */
function buildServicePayload(): ReplaceProjectConfigInput["services"] {
  console.info("[项目详情] 开始构建服务端点请求体", { serviceCount: projectForm.services.length });
  return projectForm.services.map((item, index) => ({
    name: requireText(item.name, "服务名称"),
    baseUrl: requireText(item.baseUrl, "服务 Base URL"),
    description: nullableText(item.description),
    enabled: item.enabled,
    sortOrder: index
  }));
}

/** 中文说明：构建仓库请求体数组，保证每个仓库都可单独维护。 */
function buildRepositoryPayload(): ReplaceProjectConfigInput["repositories"] {
  console.info("[项目详情] 开始构建仓库请求体", { repositoryCount: projectForm.repositories.length });
  return projectForm.repositories.map((item, index) => ({
    name: requireText(item.name, "仓库名称"),
    gitUrl: requireText(item.gitUrl, "仓库地址"),
    repoType: item.repoType,
    defaultBranch: nullableText(item.defaultBranch),
    description: nullableText(item.description),
    enabled: item.enabled,
    sortOrder: index
  }));
}

/** 中文说明：构建融智链请求体，确保项目代码和地址按显式字段保存。 */
function buildRongzhiPayload(): ReplaceProjectConfigInput["rongzhiLink"] {
  console.info("[项目详情] 开始构建融智链请求体", {
    enabled: projectForm.rongzhiEnabled,
    projectCode: projectForm.rongzhiProjectCode
  });
  const hasValue = Boolean(
    projectForm.rongzhiProjectCode.trim() ||
    projectForm.rongzhiProjectName.trim() ||
    projectForm.rongzhiBaseUrl.trim()
  );

  if (!hasValue) {
    return null;
  }

  return {
    projectCode: requireText(projectForm.rongzhiProjectCode, "融智项目代码"),
    projectName: nullableText(projectForm.rongzhiProjectName),
    baseUrl: nullableText(projectForm.rongzhiBaseUrl),
    enabled: projectForm.rongzhiEnabled
  };
}

/** 中文说明：构建接口请求体数组，并把标签与 Schema 文本转成结构化 JSON。 */
function buildApiPayload(): ReplaceProjectConfigInput["apis"] {
  console.info("[项目详情] 开始构建接口请求体", { apiCount: projectForm.apis.length });
  return projectForm.apis.map((item) => ({
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
    requestSchemaJson: parseJsonObjectText(item.requestSchemaText, "请求 Schema JSON"),
    responseSchemaJson: parseJsonObjectText(item.responseSchemaText, "响应 Schema JSON"),
    enabled: item.enabled
  }));
}

/** 中文说明：构建 Skill 请求体数组，保证每条挂载可单独指定版本和覆盖配置。 */
function buildSkillPayload(): ReplaceProjectConfigInput["skills"] {
  console.info("[项目详情] 开始构建 Skill 请求体", { skillCount: projectForm.skills.length });
  return projectForm.skills.map((item) => ({
    skillId: requireText(item.skillId, "Skill"),
    skillReleaseId: nullableText(item.skillReleaseId),
    alias: nullableText(item.alias),
    configJson: parseJsonObjectText(item.configText, "Skill 配置 JSON"),
    enabled: item.enabled
  }));
}

/** 中文说明：构建 MCP 请求体数组，保证每条挂载可单独指定版本、风险和覆盖配置。 */
function buildMcpPayload(): ReplaceProjectConfigInput["mcps"] {
  console.info("[项目详情] 开始构建 MCP 请求体", { mcpCount: projectForm.mcps.length });
  return projectForm.mcps.map((item) => ({
    mcpServerId: requireText(item.mcpServerId, "MCP"),
    mcpReleaseId: nullableText(item.mcpReleaseId),
    alias: nullableText(item.alias),
    riskLevel: nullableText(item.riskLevel),
    configOverrideJson: parseJsonObjectText(item.configOverrideText, "MCP 覆盖配置 JSON"),
    enabled: item.enabled
  }));
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

/** 中文说明：把 JSON 值格式化为多行文本，供编辑器回填使用。 */
function stringifyJson(value: unknown): string {
  console.info("[项目详情] 回填 JSON 文本", { hasValue: value !== null && value !== undefined });
  if (!value || typeof value !== "object") {
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

/** 中文说明：解析当前操作人账号，确保配置变更能写入审计字段。 */
function resolveOperatorAccount(): string {
  const account = user.value?.account?.trim() || projectForm.ownerAccount.trim() || "cloud-admin";
  console.info("[项目详情] 解析当前操作人", { account });
  return account;
}

/** 中文说明：按 Skill ID 获取版本选项，供表单下拉框直接使用。 */
function getSkillReleaseOptions(skillId: string) {
  console.info("[项目详情] 获取 Skill 版本选项", { skillId });
  return skillId ? (skillDetailMap[skillId]?.releases ?? []) : [];
}

/** 中文说明：按 MCP ID 获取版本选项，供表单下拉框直接使用。 */
function getMcpReleaseOptions(mcpServerId: string) {
  console.info("[项目详情] 获取 MCP 版本选项", { mcpServerId });
  return mcpServerId ? (mcpDetailMap[mcpServerId]?.releases ?? []) : [];
}

/** 中文说明：把日期格式化为包含时间的中文文案。 */
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
</script>


<template>
  <main class="project-detail-page project-edit-page">
    <div class="detail-container">
      <div class="nav-bar">
        <NuxtLink class="back-link" :to="`/projects/${projectId}`">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
          返回项目详情
        </NuxtLink>
      </div>

      <div v-if="pending" class="state-container">
        <div class="pulse-loader-nx"></div>
        <p>正在加载项目编辑器...</p>
      </div>

      <template v-else-if="selectedProject">
        <header class="hero-section glass-card-nx editor-page-header">
          <div class="hero-main">
            <div class="hero-title-block">
              <span class="project-code">{{ selectedProject.code }}</span>
              <h1>编辑项目</h1>
              <p class="hero-description">独立维护仓库、接口、项目 Skills 和项目 MCP 配置。</p>
            </div>

            <div class="hero-actions">
              <span class="status-pill" :class="selectedProject.status">{{ STATUS_LABELS[selectedProject.status] }}</span>
              <NuxtLink class="action-btn-secondary" :to="`/projects/${projectId}`">查看详情</NuxtLink>
            </div>
          </div>

          <div class="hero-meta-grid">
            <div class="meta-box">
              <span class="meta-label">项目名称</span>
              <span class="meta-value">{{ selectedProject.name }}</span>
            </div>
            <div class="meta-box">
              <span class="meta-label">负责人</span>
              <span class="meta-value">{{ selectedProject.ownerAccount }}</span>
            </div>
            <div class="meta-box">
              <span class="meta-label">代码仓库</span>
              <span class="meta-value">{{ selectedProject.repositories.length }}</span>
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
              <span class="meta-label">最后更新</span>
              <span class="meta-value">{{ formatDateTime(selectedProject.updatedAt) }}</span>
            </div>
          </div>
        </header>

        <article class="project-editor-panel glass-card-nx">
          <form class="editor-form" @submit.prevent="handleSaveProject">
            <section class="editor-section">
              <div class="section-toolbar">
                <div>
                  <h3>基础信息</h3>
                  <p>项目基础信息保留在详情页维护，代码只读。</p>
                </div>
              </div>

              <div class="form-grid two-columns">
                <div class="form-group">
                  <label>项目代码</label>
                  <input v-model="projectForm.code" type="text" disabled />
                </div>
                <div class="form-group">
                  <label>负责人</label>
                  <input v-model="projectForm.ownerAccount" type="text" required />
                </div>
                <div class="form-group">
                  <label>项目名称</label>
                  <input v-model="projectForm.name" type="text" required />
                </div>
                <div class="form-group">
                  <label>状态</label>
                  <select v-model="projectForm.status">
                    <option value="active">维护中</option>
                    <option value="archived">已归档</option>
                  </select>
                </div>
                <div class="form-group wide">
                  <label>项目说明</label>
                  <textarea v-model="projectForm.description" rows="3"></textarea>
                </div>
              </div>
            </section>

            <section id="services" class="editor-section">
              <div class="section-toolbar">
                <div>
                  <h3>服务端点</h3>
                  <p>一个项目可以维护多个服务 Base URL，新增接口时从这里选择所属服务。</p>
                </div>
                <button type="button" class="action-btn-secondary" @click="openProjectConfigAddModal('service')">新增服务</button>
              </div>

              <div v-if="projectForm.services.length" class="config-table config-table--services">
                <div class="config-row config-row--head">
                  <span>服务名称</span>
                  <span>Base URL</span>
                  <span>状态</span>
                  <span>说明</span>
                  <span class="sr-only">操作</span>
                </div>
                <div v-for="service in projectForm.services" :key="service.formKey" class="config-row">
                  <div class="config-primary">
                    <strong>{{ service.name || "未命名服务" }}</strong>
                  </div>
                  <span class="config-url">{{ service.baseUrl || "未配置 Base URL" }}</span>
                  <label class="row-toggle">
                    <input v-model="service.enabled" type="checkbox" :aria-label="`切换服务 ${service.name || '未命名服务'} 状态`" />
                    <span>{{ service.enabled ? "启用" : "停用" }}</span>
                  </label>
                  <span class="config-muted">{{ service.description || "暂无说明" }}</span>
                  <div class="config-row-actions">
                    <button
                      type="button"
                      class="icon-action"
                      :aria-label="`编辑服务 ${service.name || '未命名服务'}`"
                      title="编辑"
                      @click="openProjectConfigEditModal('service', service.formKey)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="icon-action danger"
                      :aria-label="`删除服务 ${service.name || '未命名服务'}`"
                      title="删除"
                      @click="confirmProjectConfigDelete('service', service.formKey, service.name)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M19 6l-1 14H6L5 6" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              <p v-else class="empty-hint">还没有服务端点。新增接口前建议先维护服务 Base URL。</p>
            </section>

            <section id="repositories" class="editor-section">
              <div class="section-toolbar">
                <div>
                  <h3>代码仓库</h3>
                  <p>仓库保存后以一行摘要呈现，详细字段进入编辑弹窗维护。</p>
                </div>
                <button type="button" class="action-btn-secondary" @click="openProjectConfigAddModal('repository')">新增仓库</button>
              </div>

              <div v-if="projectForm.repositories.length" class="config-table config-table--repositories">
                <div class="config-row config-row--head">
                  <span>仓库名称</span>
                  <span>类型 / 分支</span>
                  <span>地址</span>
                  <span>状态</span>
                  <span class="sr-only">操作</span>
                </div>
                <div v-for="repository in projectForm.repositories" :key="repository.formKey" class="config-row">
                  <div class="config-primary">
                    <strong>{{ repository.name || "未命名仓库" }}</strong>
                    <small>{{ repository.description || "暂无说明" }}</small>
                  </div>
                  <span>{{ repository.repoType }} · {{ repository.defaultBranch || "未配置分支" }}</span>
                  <span class="config-url">{{ repository.gitUrl || "未配置仓库地址" }}</span>
                  <label class="row-toggle">
                    <input v-model="repository.enabled" type="checkbox" :aria-label="`切换仓库 ${repository.name || '未命名仓库'} 状态`" />
                    <span>{{ repository.enabled ? "启用" : "停用" }}</span>
                  </label>
                  <div class="config-row-actions">
                    <button
                      type="button"
                      class="icon-action"
                      :aria-label="`编辑仓库 ${repository.name || '未命名仓库'}`"
                      title="编辑"
                      @click="openProjectConfigEditModal('repository', repository.formKey)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="icon-action danger"
                      :aria-label="`删除仓库 ${repository.name || '未命名仓库'}`"
                      title="删除"
                      @click="confirmProjectConfigDelete('repository', repository.formKey, repository.name)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M19 6l-1 14H6L5 6" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              <p v-else class="empty-hint">还没有仓库项，点击右上角新增。</p>
            </section>

            <section id="rongzhi" class="editor-section">
              <div class="section-toolbar">
                <div>
                  <h3>融智链项目</h3>
                  <p>这里单独维护项目映射，不再混在其它大文本字段里。</p>
                </div>
                <label class="inline-switch accent-switch">
                  <input v-model="projectForm.rongzhiEnabled" type="checkbox" />
                  <span>{{ projectForm.rongzhiEnabled ? "启用同步" : "暂停同步" }}</span>
                </label>
              </div>

              <div class="form-grid three-columns">
                <div class="form-group">
                  <label>融智项目代码</label>
                  <input v-model="projectForm.rongzhiProjectCode" type="text" placeholder="RZ-001" />
                </div>
                <div class="form-group">
                  <label>融智项目名称</label>
                  <input v-model="projectForm.rongzhiProjectName" type="text" />
                </div>
                <div class="form-group">
                  <label>融智地址</label>
                  <input v-model="projectForm.rongzhiBaseUrl" type="url" placeholder="https://rongzhi.example.com/project/1" />
                </div>
              </div>
            </section>

            <section id="apis" class="editor-section">
              <div class="section-toolbar">
                <div>
                  <h3>接口</h3>
                  <p>接口保存后以方法、路径、服务和状态摘要呈现，Schema 进入编辑弹窗维护。</p>
                </div>
                <button type="button" class="action-btn-secondary" @click="openProjectConfigAddModal('api')">新增接口</button>
              </div>

              <div v-if="projectForm.apis.length" class="config-table config-table--apis">
                <div class="config-row config-row--head">
                  <span>接口</span>
                  <span>方法 / 路径</span>
                  <span>服务</span>
                  <span>标签</span>
                  <span>状态</span>
                  <span class="sr-only">操作</span>
                </div>
                <div v-for="api in projectForm.apis" :key="api.formKey" class="config-row">
                  <div class="config-primary">
                    <strong>{{ api.name || "未命名接口" }}</strong>
                    <small>{{ api.description || "暂无说明" }}</small>
                  </div>
                  <span class="config-url">{{ api.method || "GET" }} {{ api.path || "未配置路径" }}</span>
                  <span>{{ api.serviceName || "未选择服务" }}</span>
                  <span class="config-muted">{{ api.tagsText || "无标签" }}</span>
                  <label class="row-toggle">
                    <input v-model="api.enabled" type="checkbox" :aria-label="`切换接口 ${api.name || '未命名接口'} 状态`" />
                    <span>{{ api.enabled ? "启用" : "停用" }}</span>
                  </label>
                  <div class="config-row-actions">
                    <button
                      type="button"
                      class="icon-action"
                      :aria-label="`编辑接口 ${api.name || '未命名接口'}`"
                      title="编辑"
                      @click="openProjectConfigEditModal('api', api.formKey)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="icon-action danger"
                      :aria-label="`删除接口 ${api.name || '未命名接口'}`"
                      title="删除"
                      @click="confirmProjectConfigDelete('api', api.formKey, api.name)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M19 6l-1 14H6L5 6" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              <p v-else class="empty-hint">还没有接口项，点击右上角新增。</p>
            </section>

            <section id="skills" class="editor-section">
              <div class="section-toolbar">
                <div>
                  <h3>Skills</h3>
                  <p>Skill 挂载保存后只展示名称、版本和覆盖状态，详细配置进入编辑弹窗。</p>
                </div>
                <button type="button" class="action-btn-secondary" @click="openProjectConfigAddModal('skill')">新增 Skill</button>
              </div>

              <div v-if="projectForm.skills.length" class="config-table config-table--skills">
                <div class="config-row config-row--head">
                  <span>Skill</span>
                  <span>版本</span>
                  <span>覆盖配置</span>
                  <span>状态</span>
                  <span class="sr-only">操作</span>
                </div>
                <div v-for="skill in projectForm.skills" :key="skill.formKey" class="config-row">
                  <div class="config-primary">
                    <strong>{{ skill.alias || skill.skillId || "未选择 Skill" }}</strong>
                    <small>{{ skill.skillId || "未绑定能力包" }}</small>
                  </div>
                  <span>{{ skill.skillReleaseId || "跟随最新版本" }}</span>
                  <span class="config-muted">{{ skill.configText ? "已覆盖" : "默认配置" }}</span>
                  <label class="row-toggle">
                    <input v-model="skill.enabled" type="checkbox" :aria-label="`切换 Skill ${skill.alias || skill.skillId || '未选择 Skill'} 状态`" />
                    <span>{{ skill.enabled ? "启用" : "停用" }}</span>
                  </label>
                  <div class="config-row-actions">
                    <button
                      type="button"
                      class="icon-action"
                      :aria-label="`编辑 Skill ${skill.alias || skill.skillId || '未选择 Skill'}`"
                      title="编辑"
                      @click="openProjectConfigEditModal('skill', skill.formKey)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="icon-action danger"
                      :aria-label="`删除 Skill ${skill.alias || skill.skillId || '未选择 Skill'}`"
                      title="删除"
                      @click="confirmProjectConfigDelete('skill', skill.formKey, skill.alias || skill.skillId)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M19 6l-1 14H6L5 6" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              <p v-else class="empty-hint">还没有 Skill 挂载，点击右上角新增。</p>
            </section>

            <section id="mcps" class="editor-section">
              <div class="section-toolbar">
                <div>
                  <h3>MCP</h3>
                  <p>MCP 挂载保存后只展示连接器、版本、风险和覆盖状态，详细配置进入编辑弹窗。</p>
                </div>
                <button type="button" class="action-btn-secondary" @click="openProjectConfigAddModal('mcp')">新增 MCP</button>
              </div>

              <div v-if="projectForm.mcps.length" class="config-table config-table--mcps">
                <div class="config-row config-row--head">
                  <span>MCP</span>
                  <span>版本</span>
                  <span>风险</span>
                  <span>覆盖配置</span>
                  <span>状态</span>
                  <span class="sr-only">操作</span>
                </div>
                <div v-for="mcp in projectForm.mcps" :key="mcp.formKey" class="config-row">
                  <div class="config-primary">
                    <strong>{{ mcp.alias || mcp.mcpServerId || "未选择 MCP" }}</strong>
                    <small>{{ mcp.mcpServerId || "未绑定连接器" }}</small>
                  </div>
                  <span>{{ mcp.mcpReleaseId || "跟随最新版本" }}</span>
                  <span>{{ mcp.riskLevel || "未标注" }}</span>
                  <span class="config-muted">{{ mcp.configOverrideText ? "已覆盖" : "默认配置" }}</span>
                  <label class="row-toggle">
                    <input v-model="mcp.enabled" type="checkbox" :aria-label="`切换 MCP ${mcp.alias || mcp.mcpServerId || '未选择 MCP'} 状态`" />
                    <span>{{ mcp.enabled ? "启用" : "停用" }}</span>
                  </label>
                  <div class="config-row-actions">
                    <button
                      type="button"
                      class="icon-action"
                      :aria-label="`编辑 MCP ${mcp.alias || mcp.mcpServerId || '未选择 MCP'}`"
                      title="编辑"
                      @click="openProjectConfigEditModal('mcp', mcp.formKey)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="icon-action danger"
                      :aria-label="`删除 MCP ${mcp.alias || mcp.mcpServerId || '未选择 MCP'}`"
                      title="删除"
                      @click="confirmProjectConfigDelete('mcp', mcp.formKey, mcp.alias || mcp.mcpServerId)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M19 6l-1 14H6L5 6" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              <p v-else class="empty-hint">还没有 MCP 挂载，点击右上角新增。</p>
            </section>

            <p v-if="formSuccess" class="status-msg success">{{ formSuccess }}</p>
            <p v-if="formError" class="status-msg error">{{ formError }}</p>

            <div class="editor-actions">
              <NuxtLink class="ghost-btn" :to="`/projects/${projectId}`">返回详情</NuxtLink>
              <button type="submit" class="action-btn-primary" :disabled="savePending">
                {{ savePending ? "正在保存..." : "保存项目配置" }}
              </button>
            </div>
          </form>
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
                <p class="form-hint">服务端点用于给接口选择 Base URL。一个项目可以维护多个服务。</p>
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
                  <div class="form-group wide">
                    <label>仓库地址</label>
                    <input v-model="addModalDraft.repository.gitUrl" type="url" placeholder="https://git.example.com/group/repo.git" />
                  </div>
                </div>
              </template>

              <template v-else-if="activeAddModalAction === 'api'">
                <p class="form-hint">接口属于当前项目。这里选择服务端点、方法和路径，详细 Schema 在本弹窗里维护，确认后回到接口行。</p>
                <div class="form-grid two-columns">
                  <div class="form-group">
                    <label>接口名称</label>
                    <input v-model="addModalDraft.api.name" type="text" placeholder="查询订单" />
                  </div>
                  <div class="form-group">
                    <label>服务</label>
                    <select v-model="addModalDraft.api.serviceName">
                      <option value="">未选择服务</option>
                      <option v-for="service in projectForm.services" :key="service.formKey" :value="service.name">
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
                  <div class="form-group wide">
                    <label>接口说明</label>
                    <textarea v-model="addModalDraft.api.description" rows="3"></textarea>
                  </div>
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
                </div>
              </template>

              <p v-if="addModalError" class="status-msg error">{{ addModalError }}</p>

              <div class="modal-actions">
                <button type="button" class="ghost-btn" @click="closeProjectConfigAddModal">取消</button>
                <button type="button" class="action-btn-primary" @click="confirmProjectConfigAddModal">{{ configModalSubmitText }}</button>
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
  padding: 32px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin-bottom: 24px;
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
  font-size: 2.2rem;
  font-weight: 950;
  color: var(--text-main);
  letter-spacing: 0;
}

.hero-description {
  margin: 0;
  max-width: 780px;
  color: var(--text-muted);
  font-size: 1rem;
  line-height: 1.7;
}

.hero-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-end;
}

.action-btn-primary,
.action-btn-secondary,
.ghost-btn {
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

.action-btn-primary {
  border: none;
  background: var(--nuxt-green);
  color: var(--btn-text);
}

.action-btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.08);
}

.action-btn-primary:disabled {
  opacity: 0.6;
  cursor: wait;
}

.action-btn-secondary,
.ghost-btn {
  border: 1px solid var(--border-main);
  background: var(--bg-input);
  color: var(--text-main);
}

.action-btn-secondary:hover,
.ghost-btn:hover {
  transform: translateY(-1px);
}

.ghost-btn.danger {
  color: #ef4444;
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
  padding: 16px;
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
  font-size: 1rem;
  font-weight: 900;
  color: var(--text-main);
}

.project-detail-panel {
  padding: 28px;
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

.section-header h2,
.section-toolbar h3 {
  margin: 0;
  color: var(--text-main);
  font-size: 1.08rem;
  font-weight: 900;
}

.section-header p,
.section-toolbar p {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 0.88rem;
  line-height: 1.6;
}

.section-count {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(var(--nuxt-green-rgb), 0.08);
  color: var(--nuxt-green);
  font-size: 0.8rem;
  font-weight: 850;
}

.detail-card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.detail-card,
.placeholder-box,
.editor-card {
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

.detail-card-head,
.card-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.detail-card-head h3,
.card-toolbar strong {
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

.two-column-layout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.column-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
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

.project-editor-panel {
  width: min(1180px, 100%);
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 28px;
}

.editor-page-title {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 22px;
}

.eyebrow {
  margin: 0 0 8px;
  color: var(--text-dim);
  font-size: 0.76rem;
  font-weight: 850;
  letter-spacing: 0;
  text-transform: uppercase;
}

.editor-page-title h2 {
  margin: 0;
  color: var(--text-main);
  font-size: 1.45rem;
  font-weight: 950;
}

.editor-form {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.editor-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  scroll-margin-top: 96px;
}

.section-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.editor-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.config-table {
  display: grid;
  width: 100%;
  overflow: hidden;
  border: 1px solid var(--border-main);
  border-radius: 8px;
  background: var(--bg-input);
}

.config-row {
  display: grid;
  align-items: center;
  gap: 12px;
  min-height: 54px;
  padding: 10px 14px;
  border-top: 1px solid var(--border-muted);
  color: var(--text-main);
  font-size: 0.86rem;
}

.config-row:first-child {
  border-top: none;
}

.config-row--head {
  min-height: 40px;
  background: rgba(var(--nuxt-green-rgb), 0.06);
  color: var(--text-dim);
  font-size: 0.72rem;
  font-weight: 900;
  text-transform: uppercase;
}

.config-table--services .config-row {
  grid-template-columns: minmax(140px, 1fr) minmax(220px, 1.4fr) 96px minmax(180px, 1fr) 88px;
}

.config-table--repositories .config-row {
  grid-template-columns: minmax(160px, 1.1fr) minmax(130px, 0.8fr) minmax(240px, 1.5fr) 96px 88px;
}

.config-table--apis .config-row {
  grid-template-columns: minmax(160px, 1fr) minmax(220px, 1.4fr) minmax(130px, 0.8fr) minmax(120px, 0.8fr) 96px 88px;
}

.config-table--skills .config-row {
  grid-template-columns: minmax(180px, 1.2fr) minmax(150px, 0.9fr) minmax(120px, 0.8fr) 96px 88px;
}

.config-table--mcps .config-row {
  grid-template-columns: minmax(180px, 1.2fr) minmax(150px, 0.8fr) minmax(90px, 0.6fr) minmax(120px, 0.8fr) 96px 88px;
}

.config-primary {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.config-primary strong,
.config-primary small,
.config-url,
.config-muted {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.config-primary strong {
  color: var(--text-main);
  font-weight: 900;
}

.config-primary small,
.config-muted {
  color: var(--text-muted);
  font-size: 0.78rem;
}

.config-url {
  font-family: "Fira Code", "SFMono-Regular", monospace;
  color: var(--text-main);
  font-size: 0.8rem;
}

.row-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: fit-content;
  min-width: 74px;
  min-height: 32px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border-main);
  background: var(--bg-main);
  color: var(--text-main);
  font-size: 0.78rem;
  font-weight: 850;
}

.row-toggle input {
  accent-color: var(--nuxt-green);
}

.config-row-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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
  cursor: pointer;
  transition: 0.2s;
}

.icon-action:hover {
  transform: translateY(-1px);
  border-color: rgba(var(--nuxt-green-rgb), 0.38);
  color: var(--text-main);
}

.icon-action.danger {
  color: #ef4444;
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

.editor-card {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.inline-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--border-main);
  background: var(--bg-main);
  color: var(--text-main);
  font-size: 0.8rem;
  font-weight: 800;
}

.accent-switch {
  background: rgba(var(--nuxt-green-rgb), 0.08);
}

.inline-switch input {
  accent-color: var(--nuxt-green);
}

.form-grid {
  display: grid;
  gap: 14px;
}

.form-grid.two-columns {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.form-grid.three-columns {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group.wide {
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

.form-group input:disabled {
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

.mono-font {
  font-family: "Fira Code", "SFMono-Regular", monospace;
  font-size: 0.84rem;
}

.status-msg {
  margin: 0;
  padding: 12px 14px;
  border-radius: 8px;
  font-size: 0.88rem;
  font-weight: 800;
}

.status-msg.success {
  background: rgba(var(--nuxt-green-rgb), 0.12);
  color: var(--nuxt-green);
}

.status-msg.error {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 4px;
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
  .hero-meta-grid,
  .form-grid.three-columns {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .detail-container {
    padding: 24px 16px;
  }

  .hero-main,
  .section-header,
  .section-toolbar,
  .card-toolbar,
  .editor-page-title {
    flex-direction: column;
  }

  .hero-actions {
    align-items: flex-start;
  }

  .hero-meta-grid,
  .detail-card-grid,
  .two-column-layout,
  .form-grid.two-columns,
  .form-grid.three-columns,
  .detail-meta-list {
    grid-template-columns: 1fr;
  }

  .project-editor-panel {
    padding: 20px;
  }

  .editor-actions {
    flex-direction: column-reverse;
  }

  .config-row,
  .config-table--services .config-row,
  .config-table--repositories .config-row,
  .config-table--apis .config-row,
  .config-table--skills .config-row,
  .config-table--mcps .config-row {
    grid-template-columns: 1fr auto;
  }

  .config-row--head {
    display: none;
  }

  .config-row {
    align-items: flex-start;
    padding: 14px;
  }

  .config-row > :not(.config-row-actions) {
    grid-column: 1 / -1;
  }

  .config-row-actions {
    grid-column: 2;
    grid-row: 1;
  }

  .modal-actions {
    flex-direction: column-reverse;
  }

  .editor-modal {
    padding: 20px;
  }

  .action-btn-primary,
  .action-btn-secondary,
  .ghost-btn {
    width: 100%;
  }
}
</style>
