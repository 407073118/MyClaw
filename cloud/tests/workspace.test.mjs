import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

const requiredFiles = [
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "README.md",
  "apps/cloud-api/.env.example",
  "apps/cloud-api/package.json",
  "apps/cloud-api/src/app.module.ts",
  "apps/cloud-web/package.json",
  "apps/cloud-web/pages/index.vue",
  "packages/shared/package.json",
  "packages/shared/src/contracts/auth.ts",
  "infra/docker-compose.yml"
];

requiredFiles.forEach((file) => {
  assert.equal(existsSync(join(root, file)), true, `missing ${file}`);
});

const workspace = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
assert.match(workspace, /apps\/\*/);
assert.match(workspace, /packages\/\*/);

const rootPackageJson = readFileSync(join(root, "package.json"), "utf8");
assert.match(rootPackageJson, /"dev:db"/);
assert.match(rootPackageJson, /"setup:api"/);

console.log("cloud workspace scaffold verified");
