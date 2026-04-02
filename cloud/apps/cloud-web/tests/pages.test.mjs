import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

const app = readFileSync(join(root, "app.vue"), "utf8");
const home = readFileSync(join(root, "pages/index.vue"), "utf8");
const login = readFileSync(join(root, "pages/login.vue"), "utf8");
const hub = readFileSync(join(root, "pages/hub.vue"), "utf8");
const skills = readFileSync(join(root, "pages/skills/index.vue"), "utf8");
const skillDetail = readFileSync(join(root, "pages/skills/[id].vue"), "utf8");
const mcp = readFileSync(join(root, "pages/mcp/index.vue"), "utf8");
const mcpPublishPage = readFileSync(join(root, "pages/mcp/publish.vue"), "utf8");
const consolePage = readFileSync(join(root, "pages/console.vue"), "utf8");
const treeNode = readFileSync(join(root, "components/SkillTreeNode.vue"), "utf8");
const authMiddleware = readFileSync(join(root, "middleware/platform-auth.global.ts"), "utf8");
const layout = readFileSync(join(root, "layouts/default.vue"), "utf8");
const session = readFileSync(join(root, "composables/useCloudSession.ts"), "utf8");
const cloudApi = readFileSync(join(root, "server/utils/cloud-api.ts"), "utf8");
const css = readFileSync(join(root, "assets/css/main.css"), "utf8");

assert.ok(existsSync(join(root, "layouts/default.vue")));
assert.ok(existsSync(join(root, "assets/css/main.css")));
assert.ok(existsSync(join(root, "middleware/platform-auth.global.ts")));
assert.ok(existsSync(join(root, "pages/console.vue")));
assert.ok(existsSync(join(root, "pages/skills/index.vue")));
assert.ok(existsSync(join(root, "pages/skills/[id].vue")));
assert.ok(existsSync(join(root, "pages/skills/publish.vue")));
assert.ok(existsSync(join(root, "pages/mcp/index.vue")));
assert.ok(existsSync(join(root, "pages/mcp/publish.vue")));
assert.ok(!existsSync(join(root, "pages/mcp.vue")));
assert.ok(existsSync(join(root, "components/SkillTreeNode.vue")));
assert.ok(existsSync(join(root, "server/api/skills.get.ts")));
assert.ok(existsSync(join(root, "server/api/skills.post.ts")));
assert.ok(existsSync(join(root, "server/api/skills/[id].get.ts")));
assert.ok(existsSync(join(root, "server/api/skills/[id]/releases.post.ts")));
assert.ok(existsSync(join(root, "server/api/skills/[id].put.ts")));
assert.ok(existsSync(join(root, "server/api/mcp/items.get.ts")));
assert.ok(existsSync(join(root, "server/api/mcp/items/[id].get.ts")));
assert.ok(existsSync(join(root, "server/api/mcp/items.post.ts")));
assert.ok(existsSync(join(root, "server/api/mcp/items/[id]/releases.post.ts")));
assert.ok(existsSync(join(root, "server/api/mcp/releases/[releaseId]/manifest.get.ts")));
assert.ok(existsSync(join(root, "server/api/hub/items.get.ts")));
assert.ok(existsSync(join(root, "server/api/hub/items/[id].get.ts")));
assert.ok(!existsSync(join(root, "server/api/hub/items/[id]/skill-releases.post.ts")));
assert.ok(existsSync(join(root, "server/api/hub/items/[id]/employee-releases.post.ts")));
assert.ok(existsSync(join(root, "server/api/hub/items/[id]/workflow-releases.post.ts")));
assert.ok(!existsSync(join(root, "server/api/hub/items/skills.post.ts")));
assert.ok(existsSync(join(root, "server/api/hub/releases/[releaseId]/manifest.get.ts")));
assert.ok(existsSync(join(root, "server/api/hub/releases/[releaseId]/download-token.get.ts")));
assert.ok(existsSync(join(root, "server/api/auth/login.post.ts")));
assert.ok(existsSync(join(root, "server/api/auth/introspect.post.ts")));

assert.match(app, /NuxtLayout/);

assert.match(home, /navigateTo/);
assert.match(home, /\/login/);
assert.match(home, /replace:\s*true/);

assert.match(authMiddleware, /defineNuxtRouteMiddleware/);
assert.match(authMiddleware, /\/login/);
assert.match(authMiddleware, /\/hub/);
assert.match(authMiddleware, /\/console/);
assert.match(authMiddleware, /clearSession/);

assert.match(layout, /useCloudSession/);
assert.match(layout, /MyClaw Cloud/);
assert.match(layout, /to:\s*"\/skills"/);
assert.match(layout, /to:\s*"\/mcp"/);
assert.match(layout, /handleLogout/);
assert.match(layout, /theme-toggle/);
assert.match(layout, /user-chip-nx/);

assert.match(session, /useCookie/);
assert.match(session, /myclaw-cloud-session/);
assert.match(session, /isSessionValid/);
assert.match(session, /sessionExpiresAt/);
assert.match(session, /window\.addEventListener/);

assert.match(cloudApi, /getCookie/);
assert.match(cloudApi, /myclaw-cloud-session/);
assert.match(cloudApi, /Bearer/);

assert.match(login, /redirect/);
assert.match(login, /navigateTo/);
assert.match(login, /\/api\/auth\/login/);
assert.match(login, /handleLogin/);
assert.match(login, /redirectTarget/);
assert.match(login, /MyClaw Cloud/);
assert.match(login, /showPassword/);
assert.match(login, /login-shell/);
assert.match(login, /login-hero/);
assert.match(login, /@media\s*\(max-width:\s*900px\)/);
assert.match(login, /overflow:\s*hidden/);
assert.match(login, /position:\s*fixed/);
assert.match(login, /minmax\(360px,\s*460px\)/);
assert.doesNotMatch(login, /hero-grid/);
assert.doesNotMatch(login, /hero-note/);

assert.match(hub, /\/api\/hub\/items/);
assert.match(hub, /\/api\/hub\/releases\/\$\{releaseId\}\/download-token/);
assert.match(hub, /handleDownloadRelease/);
assert.match(hub, /selectedItemId/);
assert.match(hub, /云端资源总览/);
assert.match(hub, /统一查看 MCP、员工包和工作流包/);
assert.match(hub, /搜索 Hub 资源/);
assert.match(hub, /全部/);
assert.match(hub, /员工包/);
assert.match(hub, /工作流包/);
assert.match(hub, /正在加载资源列表/);
assert.match(hub, /正在加载详情/);
assert.match(hub, /下载失败，请稍后重试。/);
assert.match(hub, /选择左侧资源查看详细信息。/);
assert.match(hub, /下载/);
assert.doesNotMatch(hub, /type === "skill"/);
assert.doesNotMatch(hub, /['"]skill['"]/);
assert.doesNotMatch(hub, /route\.query\.create/);
assert.doesNotMatch(hub, /openCreateSkillPanel/);

assert.match(skills, /\/api\/skills/);
assert.match(skills, /NuxtLink/);
assert.doesNotMatch(skills, /\/api\/hub\//);
assert.match(skills, /\/skills\/publish/);
assert.doesNotMatch(skills, /local skills/i);
assert.match(skills, /搜索 Skills/);
assert.match(skills, /发布 Skill/);
assert.match(skills, /个 Skills/);
assert.match(skills, /正在加载 Skills 列表/);
assert.match(skills, /没有找到匹配的 Skills/);

assert.match(skillDetail, /route\.params\.id/);
assert.match(skillDetail, /\/api\/skills\/\$\{skillId\.value\}/);
assert.doesNotMatch(skillDetail, /buildSkillTree/);
assert.doesNotMatch(skillDetail, /selectedFile/);
assert.doesNotMatch(skillDetail, /Browse local/i);

const publishPage = readFileSync(join(root, "pages/skills/publish.vue"), "utf8");
const skillsPost = readFileSync(join(root, "server/api/skills.post.ts"), "utf8");

assert.match(publishPage, /\/api\/skills/);
assert.match(publishPage, /handlePublish/);
assert.doesNotMatch(publishPage, /\/api\/hub\//);
assert.match(publishPage, /FormData/);
assert.match(publishPage, /type="file"/);
assert.match(publishPage, /accept="\.zip"/);
assert.match(publishPage, /返回 Skills/);
assert.match(publishPage, /发布 Skill/);
assert.match(publishPage, /基础信息/);
assert.match(publishPage, /文档与说明/);
assert.match(publishPage, /配置项/);
assert.match(publishPage, /上传产物包/);
assert.match(publishPage, /请先选择 ZIP 包后再发布/);
assert.match(publishPage, /发布 Skill 失败/);

assert.match(skillsPost, /proxyCloudApi/);
assert.doesNotMatch(skillsPost, /mkdirSync/);
assert.doesNotMatch(skillsPost, /writeFileSync/);

assert.match(treeNode, /tree-node/);
assert.match(treeNode, /node\.type === "file"/);
assert.match(treeNode, /emit\("select"/);

assert.match(mcp, /\/api\/mcp\/items/);
assert.doesNotMatch(mcp, /\/api\/hub\/items/);
assert.match(mcp, /selectedConnectorId/);
assert.match(mcp, /selectedManifest/);
assert.match(mcp, /transportOptions/);
assert.match(mcp, /selectedTransport/);
assert.match(mcp, /MCP 管理/);
assert.match(mcp, /创建 MCP/);
assert.match(mcp, /正在加载 MCP 列表/);
assert.match(mcp, /连接器/);
assert.match(mcp, /发布新版本/);
assert.match(mcp, /连接配置清单/);
assert.match(mcp, /stdio/);
assert.match(mcp, /streamable-http/);
assert.match(mcp, /请选择左侧 MCP 查看配置/);
assert.doesNotMatch(mcp, /Register New MCP/);
assert.doesNotMatch(mcp, /accept="\.zip"/);

assert.match(mcpPublishPage, /\/api\/mcp\/items/);
assert.match(mcpPublishPage, /CreateMcpItemResponse/);
assert.match(mcpPublishPage, /返回 MCP/);
assert.match(mcpPublishPage, /创建 MCP/);
assert.match(mcpPublishPage, /基础信息/);
assert.match(mcpPublishPage, /连接配置/);
assert.match(mcpPublishPage, /传输方式/);
assert.match(mcpPublishPage, /启动命令/);
assert.match(mcpPublishPage, /命令参数/);
assert.match(mcpPublishPage, /远程地址/);
assert.match(mcpPublishPage, /创建 MCP 失败/);
assert.doesNotMatch(mcpPublishPage, /accept="\.zip"/);
assert.doesNotMatch(mcpPublishPage, /FormData/);
assert.doesNotMatch(mcpPublishPage, /请先选择 ZIP 包后再创建/);

const mcpPost = readFileSync(join(root, "server/api/mcp/items.post.ts"), "utf8");
const mcpReleasePost = readFileSync(join(root, "server/api/mcp/items/[id]/releases.post.ts"), "utf8");
assert.match(mcpPost, /readBody/);
assert.doesNotMatch(mcpPost, /readFormData/);
assert.match(mcpReleasePost, /readBody/);
assert.doesNotMatch(mcpReleasePost, /readFormData/);

assert.match(consolePage, /navigateTo/);
assert.match(consolePage, /\/hub/);
assert.match(consolePage, /replace:\s*true/);

assert.match(css, /skill-tree/);
assert.match(css, /file-viewer/);
assert.match(css, /auth-shell/);
assert.match(css, /user-chip/);

console.log("cloud-web pages verified");
