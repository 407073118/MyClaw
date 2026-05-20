-- ============================================================
-- 项目维护台新增表与字段中文注释
-- 执行方式: pnpm --dir cloud/apps/cloud-api exec prisma db execute --schema prisma/schema.prisma --file prisma/project-comments.sql
-- ============================================================

ALTER TABLE `project` COMMENT = '项目主表：Cloud 上维护 Agent 工作上下文的核心容器';
ALTER TABLE `project`
  MODIFY COLUMN `id` varchar(191) NOT NULL COMMENT '项目 ID，系统内部唯一标识',
  MODIFY COLUMN `code` varchar(80) NOT NULL COMMENT '项目编码，用于 URL、检索和外部引用',
  MODIFY COLUMN `name` varchar(255) NOT NULL COMMENT '项目名称，面向用户展示',
  MODIFY COLUMN `description` text NULL COMMENT '项目描述，说明项目业务范围',
  MODIFY COLUMN `owner_account` varchar(191) NOT NULL COMMENT '项目负责人账号',
  MODIFY COLUMN `status` varchar(40) NOT NULL DEFAULT 'active' COMMENT '项目状态：active=启用，archived=归档',
  MODIFY COLUMN `created_by` varchar(191) NOT NULL COMMENT '创建人账号',
  MODIFY COLUMN `updated_by` varchar(191) NULL COMMENT '最后更新人账号',
  MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  MODIFY COLUMN `updated_at` datetime(3) NOT NULL COMMENT '更新时间';

ALTER TABLE `project_service_endpoint` COMMENT = '项目服务端点表：一个项目可维护多个服务及其接口基础地址';
ALTER TABLE `project_service_endpoint`
  MODIFY COLUMN `id` varchar(191) NOT NULL COMMENT '服务端点 ID',
  MODIFY COLUMN `project_id` varchar(191) NOT NULL COMMENT '所属项目 ID',
  MODIFY COLUMN `name` varchar(120) NOT NULL COMMENT '服务名称，例如 user-service、order-service',
  MODIFY COLUMN `base_url` varchar(500) NOT NULL COMMENT '服务接口基础地址',
  MODIFY COLUMN `description` text NULL COMMENT '服务说明',
  MODIFY COLUMN `enabled` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  MODIFY COLUMN `sort_order` int NOT NULL DEFAULT 0 COMMENT '排序值',
  MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  MODIFY COLUMN `updated_at` datetime(3) NOT NULL COMMENT '更新时间';

ALTER TABLE `project_repository` COMMENT = '项目 Git 仓库表：支持前端、后端、多服务、多仓库项目';
ALTER TABLE `project_repository`
  MODIFY COLUMN `id` varchar(191) NOT NULL COMMENT '仓库绑定 ID',
  MODIFY COLUMN `project_id` varchar(191) NOT NULL COMMENT '所属项目 ID',
  MODIFY COLUMN `name` varchar(120) NOT NULL COMMENT '仓库名称，例如 frontend、backend、order-service',
  MODIFY COLUMN `git_url` varchar(500) NOT NULL COMMENT 'Git 仓库地址',
  MODIFY COLUMN `repo_type` varchar(40) NOT NULL DEFAULT 'service' COMMENT '仓库类型：frontend、backend、service、mobile、infra、other',
  MODIFY COLUMN `default_branch` varchar(100) NULL COMMENT '默认分支',
  MODIFY COLUMN `description` text NULL COMMENT '仓库说明',
  MODIFY COLUMN `enabled` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  MODIFY COLUMN `sort_order` int NOT NULL DEFAULT 0 COMMENT '排序值',
  MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  MODIFY COLUMN `updated_at` datetime(3) NOT NULL COMMENT '更新时间';

ALTER TABLE `project_rongzhi_link` COMMENT = '融智链项目绑定表：记录内部类 Jira 系统的项目代码';
ALTER TABLE `project_rongzhi_link`
  MODIFY COLUMN `project_id` varchar(191) NOT NULL COMMENT '所属项目 ID，一个项目暂时只绑定一个融智链项目',
  MODIFY COLUMN `project_code` varchar(120) NOT NULL COMMENT '融智链项目代码',
  MODIFY COLUMN `project_name` varchar(255) NULL COMMENT '融智链项目名称快照',
  MODIFY COLUMN `base_url` varchar(500) NULL COMMENT '融智链访问地址',
  MODIFY COLUMN `enabled` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  MODIFY COLUMN `last_health_status` varchar(40) NULL COMMENT '最近一次连通性检查状态',
  MODIFY COLUMN `last_checked_at` datetime(3) NULL COMMENT '最近一次检查时间',
  MODIFY COLUMN `updated_at` datetime(3) NOT NULL COMMENT '更新时间';

ALTER TABLE `project_api` COMMENT = '项目接口表：维护项目暴露或依赖的接口清单';
ALTER TABLE `project_api`
  MODIFY COLUMN `id` varchar(191) NOT NULL COMMENT '接口 ID',
  MODIFY COLUMN `project_id` varchar(191) NOT NULL COMMENT '所属项目 ID',
  MODIFY COLUMN `name` varchar(255) NOT NULL COMMENT '接口名称',
  MODIFY COLUMN `service_name` varchar(120) NULL COMMENT '服务名称，例如 user-service、order-service',
  MODIFY COLUMN `direction` varchar(40) NOT NULL DEFAULT 'provided' COMMENT '接口方向：provided=本项目提供，consumed=本项目依赖',
  MODIFY COLUMN `protocol` varchar(40) NOT NULL DEFAULT 'http' COMMENT '协议类型：http、rpc、graphql、event、other',
  MODIFY COLUMN `method` varchar(20) NULL COMMENT 'HTTP 方法',
  MODIFY COLUMN `path` varchar(500) NULL COMMENT '接口路径',
  MODIFY COLUMN `description` text NULL COMMENT '接口描述',
  MODIFY COLUMN `source` varchar(40) NOT NULL DEFAULT 'manual' COMMENT '来源：manual、openapi、repo-scan、rongzhi',
  MODIFY COLUMN `owner` varchar(120) NULL COMMENT '接口负责人',
  MODIFY COLUMN `tags_json` json NULL COMMENT '标签 JSON',
  MODIFY COLUMN `parameters_json` json NULL COMMENT '请求参数 JSON，按 path、query、header、cookie 统一保存',
  MODIFY COLUMN `request_body_type` varchar(40) NOT NULL DEFAULT 'none' COMMENT '请求 Body 类型：none、json、form-data、x-www-form-urlencoded、raw、binary、graphql',
  MODIFY COLUMN `request_body_content_type` varchar(120) NULL COMMENT '请求 Body 的 Content-Type',
  MODIFY COLUMN `request_body_example_json` json NULL COMMENT '请求 Body 示例 JSON',
  MODIFY COLUMN `request_schema_json` json NULL COMMENT '请求结构 JSON',
  MODIFY COLUMN `response_schema_json` json NULL COMMENT '响应结构 JSON',
  MODIFY COLUMN `enabled` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  MODIFY COLUMN `updated_at` datetime(3) NOT NULL COMMENT '更新时间';

ALTER TABLE `project_skill_ref` COMMENT = '项目 Skill 挂载表：记录项目可用的技能';
ALTER TABLE `project_skill_ref`
  MODIFY COLUMN `id` varchar(191) NOT NULL COMMENT '挂载 ID',
  MODIFY COLUMN `project_id` varchar(191) NOT NULL COMMENT '所属项目 ID',
  MODIFY COLUMN `skill_id` varchar(191) NOT NULL COMMENT 'Skill ID，对应现有 skill 表',
  MODIFY COLUMN `skill_release_id` varchar(191) NULL COMMENT '锁定的 Skill release ID，可为空表示使用最新版本',
  MODIFY COLUMN `alias` varchar(120) NULL COMMENT '项目内显示名称',
  MODIFY COLUMN `enabled` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  MODIFY COLUMN `config_json` json NULL COMMENT '项目级 Skill 配置',
  MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  MODIFY COLUMN `updated_at` datetime(3) NOT NULL COMMENT '更新时间';

ALTER TABLE `project_mcp_ref` COMMENT = '项目 MCP 挂载表：记录项目可用的 MCP 服务';
ALTER TABLE `project_mcp_ref`
  MODIFY COLUMN `id` varchar(191) NOT NULL COMMENT '挂载 ID',
  MODIFY COLUMN `project_id` varchar(191) NOT NULL COMMENT '所属项目 ID',
  MODIFY COLUMN `mcp_server_id` varchar(191) NOT NULL COMMENT 'MCP Server ID，对应现有 mcp_server 表',
  MODIFY COLUMN `mcp_release_id` varchar(191) NULL COMMENT '锁定的 MCP release ID，可为空表示使用最新版本',
  MODIFY COLUMN `alias` varchar(120) NULL COMMENT '项目内别名',
  MODIFY COLUMN `risk_level` varchar(40) NULL COMMENT '风险等级快照：read、write、exec、network',
  MODIFY COLUMN `enabled` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  MODIFY COLUMN `config_override_json` json NULL COMMENT '项目级 MCP 覆盖配置',
  MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  MODIFY COLUMN `updated_at` datetime(3) NOT NULL COMMENT '更新时间';

ALTER TABLE `project_workflow_ref` COMMENT = '项目工作流挂载表：预留字段，第一期不做业务闭环';
ALTER TABLE `project_workflow_ref`
  MODIFY COLUMN `id` varchar(191) NOT NULL COMMENT '挂载 ID',
  MODIFY COLUMN `project_id` varchar(191) NOT NULL COMMENT '所属项目 ID',
  MODIFY COLUMN `workflow_id` varchar(191) NOT NULL COMMENT '工作流 ID，先存外部引用',
  MODIFY COLUMN `workflow_name` varchar(255) NULL COMMENT '工作流名称快照',
  MODIFY COLUMN `enabled` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否启用，第一期默认 false',
  MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  MODIFY COLUMN `updated_at` datetime(3) NOT NULL COMMENT '更新时间';

ALTER TABLE `project_silicon_person_ref` COMMENT = '项目硅基员工挂载表：预留字段，第一期不做业务闭环';
ALTER TABLE `project_silicon_person_ref`
  MODIFY COLUMN `id` varchar(191) NOT NULL COMMENT '挂载 ID',
  MODIFY COLUMN `project_id` varchar(191) NOT NULL COMMENT '所属项目 ID',
  MODIFY COLUMN `silicon_person_id` varchar(191) NOT NULL COMMENT '硅基员工 ID，先存外部引用',
  MODIFY COLUMN `role_name` varchar(120) NULL COMMENT '员工角色名称，例如研发助手、发布助手',
  MODIFY COLUMN `enabled` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否启用，第一期默认 false',
  MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  MODIFY COLUMN `updated_at` datetime(3) NOT NULL COMMENT '更新时间';

ALTER TABLE `project_config_snapshot` COMMENT = '项目配置快照表：用于记录项目配置版本，支持简单回退';
ALTER TABLE `project_config_snapshot`
  MODIFY COLUMN `id` varchar(191) NOT NULL COMMENT '快照 ID',
  MODIFY COLUMN `project_id` varchar(191) NOT NULL COMMENT '所属项目 ID',
  MODIFY COLUMN `version` int NOT NULL COMMENT '快照版本号，项目内递增',
  MODIFY COLUMN `snapshot_json` json NOT NULL COMMENT '完整项目配置快照 JSON',
  MODIFY COLUMN `description` text NULL COMMENT '快照说明',
  MODIFY COLUMN `created_by` varchar(191) NOT NULL COMMENT '创建人账号',
  MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间';

ALTER TABLE `project_change_log` COMMENT = '项目变更日志表：记录谁在什么时候改了什么';
ALTER TABLE `project_change_log`
  MODIFY COLUMN `id` varchar(191) NOT NULL COMMENT '日志 ID',
  MODIFY COLUMN `project_id` varchar(191) NOT NULL COMMENT '所属项目 ID',
  MODIFY COLUMN `action` varchar(80) NOT NULL COMMENT '变更类型，例如 repository.create、skill.enable、api.update',
  MODIFY COLUMN `target_type` varchar(80) NOT NULL COMMENT '变更对象类型',
  MODIFY COLUMN `target_id` varchar(191) NULL COMMENT '变更对象 ID',
  MODIFY COLUMN `before_json` json NULL COMMENT '变更前 JSON',
  MODIFY COLUMN `after_json` json NULL COMMENT '变更后 JSON',
  MODIFY COLUMN `operator_account` varchar(191) NOT NULL COMMENT '操作人账号',
  MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间';
