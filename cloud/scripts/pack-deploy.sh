#!/bin/bash
# ============================================================
# MyClaw Cloud 部署打包脚本
#
# 用法（在 cloud/ 目录下执行）：
#   bash scripts/pack-deploy.sh
#
# 产物：
#   myclaw-cloud-deploy.tar.gz  （直接传到服务器）
#
# 服务器上：
#   tar -xzf myclaw-cloud-deploy.tar.gz
#   cd myclaw-cloud
#   bash setup.sh        ← 首次部署
#   bash restart.sh      ← 后续更新
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STAGE_DIR="$ROOT_DIR/.deploy-stage/myclaw-cloud"

echo "=== MyClaw Cloud 部署打包 ==="

# ── 清理 ──
rm -rf "$ROOT_DIR/.deploy-stage"
mkdir -p "$STAGE_DIR"

# ── 1. cloud-api bundle ──
echo "[1/4] 拷贝 cloud-api bundle..."
mkdir -p "$STAGE_DIR/cloud-api"
cp -r "$ROOT_DIR/apps/cloud-api/bundle/"* "$STAGE_DIR/cloud-api/"
cp "$ROOT_DIR/apps/cloud-api/prisma/schema.prisma" "$STAGE_DIR/cloud-api/"

# ── 2. cloud-web 产物 ──
echo "[2/4] 拷贝 cloud-web .output..."
mkdir -p "$STAGE_DIR/cloud-web"
cp -r "$ROOT_DIR/apps/cloud-web/.output" "$STAGE_DIR/cloud-web/"

# ── 3. 环境变量模板 ──
echo "[3/4] 生成环境变量模板..."

cat > "$STAGE_DIR/cloud-api/.env" << 'ENVEOF'
PORT=43210

JWT_ACCESS_SECRET=replace-me-with-random-string
JWT_REFRESH_SECRET=replace-me-with-random-string-too

DB_HOST=192.168.162.82
DB_PORT=3306
DB_NAME=myclaw_cloud
DB_USER=root
DB_PASSWORD=123456
DATABASE_URL=mysql://root:123456@192.168.162.82:3306/myclaw_cloud

FASTDFS_BASE_URL=http://cs-pre.100credit.cn
FASTDFS_PROJECT_CODE=BrTest
FASTDFS_TOKEN=BrTest20210526
FASTDFS_UPLOAD_PATH=/api/file/uploadSingle
FASTDFS_DOWNLOAD_PATH=/api/file/download
FASTDFS_TIMEOUT_MS=30000

INTERNAL_AUTH_BASE_URL=http://127.0.0.1:9000
INTERNAL_AUTH_TIMEOUT_MS=5000
INTERNAL_AUTH_MODE=mock
ENVEOF

cat > "$STAGE_DIR/cloud-web/.env" << 'ENVEOF'
PORT=43211
HOST=0.0.0.0
NUXT_CLOUD_API_BASE=http://127.0.0.1:43210
ENVEOF

# ── 4. 启动/管理脚本 ──
echo "[4/4] 生成管理脚本..."

# ---- setup.sh（首次部署） ----
cat > "$STAGE_DIR/setup.sh" << 'SETUPEOF'
#!/bin/bash
set -e
echo "=== MyClaw Cloud 首次部署 ==="

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "错误：未安装 Node.js，请先安装 Node.js 20+"
    echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -"
    echo "  sudo apt install -y nodejs"
    exit 1
fi
echo "Node.js: $(node -v)"

# 安装 PM2
if ! command -v pm2 &> /dev/null; then
    echo "安装 PM2..."
    npm install -g pm2
fi

# 启动服务
echo "启动服务..."
bash restart.sh

# 设置开机自启
pm2 save
pm2 startup 2>/dev/null || echo "请手动执行上面输出的 sudo 命令来设置开机自启"

echo ""
echo "=== 部署完成 ==="
echo "cloud-api: http://127.0.0.1:43210"
echo "cloud-web: http://127.0.0.1:43211"
echo ""
echo "查看日志: pm2 logs"
echo "查看状态: pm2 list"
SETUPEOF
chmod +x "$STAGE_DIR/setup.sh"

# ---- restart.sh（重启/更新） ----
cat > "$STAGE_DIR/restart.sh" << 'RESTARTEOF'
#!/bin/bash
set -e
DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== 重启 MyClaw Cloud ==="

# 停止旧进程（忽略不存在的错误）
pm2 delete cloud-api 2>/dev/null || true
pm2 delete cloud-web 2>/dev/null || true

# 启动 cloud-api（用 env 子 shell 隔离环境变量）
env $(grep -v '^#' "$DEPLOY_DIR/cloud-api/.env" | grep '=' | xargs) \
  pm2 start "$DEPLOY_DIR/cloud-api/main.js" \
  --name cloud-api \
  --cwd "$DEPLOY_DIR/cloud-api"

# 启动 cloud-web
env $(grep -v '^#' "$DEPLOY_DIR/cloud-web/.env" | grep '=' | xargs) \
  pm2 start "$DEPLOY_DIR/cloud-web/.output/server/index.mjs" \
  --name cloud-web \
  --cwd "$DEPLOY_DIR/cloud-web"

pm2 save

echo ""
pm2 list
echo ""
echo "查看日志: pm2 logs"
RESTARTEOF
chmod +x "$STAGE_DIR/restart.sh"

# ---- stop.sh ----
cat > "$STAGE_DIR/stop.sh" << 'STOPEOF'
#!/bin/bash
pm2 delete cloud-api 2>/dev/null || true
pm2 delete cloud-web 2>/dev/null || true
echo "已停止所有服务"
STOPEOF
chmod +x "$STAGE_DIR/stop.sh"

# ── 打包 ──
echo ""
echo "打包中..."
cd "$ROOT_DIR/.deploy-stage"
tar -czf "$ROOT_DIR/myclaw-cloud-deploy.tar.gz" myclaw-cloud/

# ── 清理 ──
rm -rf "$ROOT_DIR/.deploy-stage"

# ── 完成 ──
SIZE=$(du -h "$ROOT_DIR/myclaw-cloud-deploy.tar.gz" | cut -f1)
echo ""
echo "========================================="
echo " 打包完成！"
echo " 文件：myclaw-cloud-deploy.tar.gz ($SIZE)"
echo "========================================="
echo ""
echo " 部署步骤："
echo "   1. 上传到服务器：scp myclaw-cloud-deploy.tar.gz user@服务器:/opt/"
echo "   2. 解压：cd /opt && tar -xzf myclaw-cloud-deploy.tar.gz"
echo "   3. 首次部署：cd myclaw-cloud && bash setup.sh"
echo "   4. 后续更新：cd myclaw-cloud && bash restart.sh"
echo ""
