-- ============================================================
-- MySQL 表/字段中文注释
-- 执行: mysql -u root -p123456 -h 192.168.162.82 --default-character-set=utf8mb4 myclaw_cloud < prisma/comments.sql
-- ============================================================

-- ─── login_session 登录会话 ───
ALTER TABLE `login_session` COMMENT = '登录会话';
ALTER TABLE `login_session`
  MODIFY COLUMN `id`                        varchar(191) NOT NULL COMMENT '会话ID',
  MODIFY COLUMN `account`                   varchar(191) NOT NULL COMMENT '登录账号',
  MODIFY COLUMN `display_name`              varchar(255) NULL COMMENT '显示名称',
  MODIFY COLUMN `roles_json`                json NULL COMMENT '角色列表(JSON)',
  MODIFY COLUMN `access_token_hash`         varchar(255) NULL COMMENT '访问令牌哈希',
  MODIFY COLUMN `access_token_expires_at`   datetime(3) NULL COMMENT '访问令牌过期时间',
  MODIFY COLUMN `refresh_token_hash`        varchar(255) NOT NULL COMMENT '刷新令牌哈希',
  MODIFY COLUMN `refresh_token_expires_at`  datetime(3) NOT NULL COMMENT '刷新令牌过期时间',
  MODIFY COLUMN `revoked_at`                datetime(3) NULL COMMENT '吊销时间',
  MODIFY COLUMN `created_at`                datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  MODIFY COLUMN `updated_at`                datetime(3) NOT NULL COMMENT '更新时间';

-- ─── install_log 安装/下载日志 ───
ALTER TABLE `install_log` COMMENT = '安装/下载日志';
ALTER TABLE `install_log`
  MODIFY COLUMN `id`            varchar(191) NOT NULL COMMENT '日志ID',
  MODIFY COLUMN `account`       varchar(191) NOT NULL COMMENT '操作账号',
  MODIFY COLUMN `item_type`     varchar(20)  NOT NULL COMMENT '条目类型(skill/mcp)',
  MODIFY COLUMN `item_id`       varchar(191) NOT NULL COMMENT '条目ID(skill.id 或 mcp_server.id)',
  MODIFY COLUMN `release_id`    varchar(191) NOT NULL COMMENT '版本ID',
  MODIFY COLUMN `action`        varchar(50)  NOT NULL COMMENT '操作类型(install/uninstall)',
  MODIFY COLUMN `status`        varchar(50)  NOT NULL COMMENT '状态(success/fail)',
  MODIFY COLUMN `error_message` text NULL COMMENT '错误信息',
  MODIFY COLUMN `created_at`    datetime(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间';

-- ─── mcp_server MCP服务 ───
ALTER TABLE `mcp_server` COMMENT = 'MCP服务注册表';
ALTER TABLE `mcp_server`
  MODIFY COLUMN `id`                varchar(191) NOT NULL COMMENT '服务ID',
  MODIFY COLUMN `name`              varchar(255) NOT NULL COMMENT '服务名称',
  MODIFY COLUMN `summary`           text NOT NULL COMMENT '简介',
  MODIFY COLUMN `description`       text NOT NULL COMMENT '详细描述',
  MODIFY COLUMN `icon`              varchar(500) NOT NULL DEFAULT '' COMMENT '图标URL',
  MODIFY COLUMN `author`            varchar(100) NOT NULL DEFAULT '' COMMENT '作者',
  MODIFY COLUMN `download_count`    int NOT NULL DEFAULT 0 COMMENT '下载次数',
  MODIFY COLUMN `latest_version`    varchar(50) NULL COMMENT '最新版本号',
  MODIFY COLUMN `latest_release_id` varchar(191) NULL COMMENT '最新版本ID',
  MODIFY COLUMN `created_at`        datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  MODIFY COLUMN `updated_at`        datetime(3) NOT NULL COMMENT '更新时间';

-- ─── mcp_server_release MCP服务版本 ───
ALTER TABLE `mcp_server_release` COMMENT = 'MCP服务版本发布记录';
ALTER TABLE `mcp_server_release`
  MODIFY COLUMN `id`            varchar(191) NOT NULL COMMENT '版本ID',
  MODIFY COLUMN `server_id`     varchar(191) NOT NULL COMMENT '所属MCP服务ID',
  MODIFY COLUMN `version`       varchar(50)  NOT NULL COMMENT '版本号',
  MODIFY COLUMN `release_notes` text NOT NULL COMMENT '发布说明',
  MODIFY COLUMN `config_json`   json NOT NULL COMMENT '连接配置(transport/command/url等)',
  MODIFY COLUMN `created_at`    datetime(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  MODIFY COLUMN `updated_at`    datetime(3)  NOT NULL COMMENT '更新时间';

-- ─── skill 技能 ───
ALTER TABLE `skill` COMMENT = '技能商店';
ALTER TABLE `skill`
  MODIFY COLUMN `id`                varchar(191) NOT NULL COMMENT '技能ID',
  MODIFY COLUMN `name`              varchar(255) NOT NULL COMMENT '技能名称',
  MODIFY COLUMN `summary`           text NOT NULL COMMENT '简介',
  MODIFY COLUMN `description`       text NOT NULL COMMENT '详细描述',
  MODIFY COLUMN `icon`              varchar(500) NOT NULL DEFAULT '' COMMENT '图标URL',
  MODIFY COLUMN `category`          varchar(50)  NOT NULL DEFAULT 'other' COMMENT '分类(other/productivity/dev-tools等)',
  MODIFY COLUMN `tags`              json NOT NULL COMMENT '标签列表(JSON数组)',
  MODIFY COLUMN `author`            varchar(100) NOT NULL DEFAULT '' COMMENT '作者',
  MODIFY COLUMN `download_count`    int NOT NULL DEFAULT 0 COMMENT '下载次数',
  MODIFY COLUMN `latest_version`    varchar(50) NULL COMMENT '最新版本号',
  MODIFY COLUMN `latest_release_id` varchar(191) NULL COMMENT '最新版本ID',
  MODIFY COLUMN `created_at`        datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  MODIFY COLUMN `updated_at`        datetime(3) NOT NULL COMMENT '更新时间';

-- ─── skill_release 技能版本 ───
ALTER TABLE `skill_release` COMMENT = '技能版本发布记录';
ALTER TABLE `skill_release`
  MODIFY COLUMN `id`                        varchar(191) NOT NULL COMMENT '版本ID',
  MODIFY COLUMN `skill_id`                  varchar(191) NOT NULL COMMENT '所属技能ID',
  MODIFY COLUMN `version`                   varchar(50)  NOT NULL COMMENT '版本号',
  MODIFY COLUMN `release_notes`             text NOT NULL COMMENT '发布说明',
  MODIFY COLUMN `manifest_json`             json NOT NULL COMMENT '清单配置(JSON)',
  MODIFY COLUMN `artifact_file_name`        varchar(255) NOT NULL DEFAULT '' COMMENT '产物文件名',
  MODIFY COLUMN `artifact_file_size`        int NOT NULL DEFAULT 0 COMMENT '产物文件大小(字节)',
  MODIFY COLUMN `artifact_storage_path`     varchar(500) NOT NULL DEFAULT '' COMMENT '产物存储路径',
  MODIFY COLUMN `artifact_download_url`     varchar(500) NOT NULL DEFAULT '' COMMENT '产物下载地址',
  MODIFY COLUMN `artifact_download_expires` int NOT NULL DEFAULT 0 COMMENT '下载链接有效期(秒)',
  MODIFY COLUMN `created_at`                datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  MODIFY COLUMN `updated_at`                datetime(3) NOT NULL COMMENT '更新时间';
