# MyClaw Cloud

云端服务，包含 API 后端和 Web 管理台。

## 项目结构

```
cloud/
├── apps/
│   ├── cloud-api/            # NestJS 后端
│   │   ├── src/modules/      # 业务模块（auth, hub, skills, mcp, install, artifact）
│   │   ├── prisma/           # 数据库 schema
│   │   ├── scripts/bundle.mjs  # API 打包脚本
│   │   └── bundle/           # 打包产物（git 忽略）
│   └── cloud-web/            # Nuxt 前端管理台
│       ├── pages/            # 页面（login, console, skills）
│       ├── server/api/       # BFF 层
│       └── .output/          # 构建产物（git 忽略）
├── packages/shared/          # 共享契约（类型、接口定义）
├── infra/docker-compose.yml  # 本地 MySQL（可选）
└── scripts/pack-deploy.sh    # 部署打包脚本
```

## 本地开发

前置条件：Node.js 20+、pnpm 9+

```bash
pnpm install

# 初始化数据库（首次）
pnpm setup:api

# 启动（分别在两个终端）
pnpm dev:api    # http://localhost:43210
pnpm dev:web    # http://localhost:43211
```

环境变量：复制 `apps/cloud-api/.env.example` 为 `.env` 并修改。

## 构建

```bash
# API 打包（esbuild 单文件 + Prisma Linux 引擎）
cd apps/cloud-api
node scripts/bundle.mjs
# 产物：bundle/main.js + bundle/node_modules/（Prisma 引擎）

# Web 构建
cd apps/cloud-web
pnpm build
# 产物：.output/
```

## 部署打包

```bash
# 在项目根目录执行，生成 myclaw-cloud-deploy.tar.gz
bash scripts/pack-deploy.sh
```

压缩包内容：

```
myclaw-cloud/
├── cloud-api/       # main.js + Prisma 引擎 + .env
├── cloud-web/       # .output/ + .env
├── setup.sh         # 首次部署（装 PM2、启动）
├── restart.sh       # 重启/更新
└── stop.sh          # 停止服务
```

## 服务器部署

```bash
# 上传解压
scp myclaw-cloud-deploy.tar.gz root@服务器:/opt/
cd /opt && tar -xzf myclaw-cloud-deploy.tar.gz
cd myclaw-cloud

# 首次
bash setup.sh

# 更新（重新打包上传后）
bash restart.sh

# 停止
bash stop.sh
```

端口：API `43210`、Web `43211`

常用命令：`pm2 list`、`pm2 logs`、`pm2 logs cloud-api --lines 50`

## 测试

```bash
pnpm test                              # 全量
pnpm --dir apps/cloud-api test         # API
pnpm --dir apps/cloud-web test         # Web
```

## 子项目文档

- `apps/cloud-api/AGENTS.md`
- `apps/cloud-web/AGENTS.md`
- `packages/shared/AGENTS.md`
- `docs/project-overview.md`
