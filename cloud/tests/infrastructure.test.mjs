import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const requiredFiles = [
  "apps/cloud-api/prisma/schema.prisma",
  "apps/cloud-api/src/modules/database/database.module.ts",
  "apps/cloud-api/src/modules/database/services/database.service.ts",
  "apps/cloud-api/src/modules/auth/ports/internal-auth-provider.ts",
  "apps/cloud-api/src/modules/artifact/ports/artifact-storage.port.ts",
  "apps/cloud-api/src/modules/artifact/providers/fastdfs-artifact-storage.ts"
];

requiredFiles.forEach((file) => {
  assert.equal(existsSync(join(root, file)), true, `missing ${file}`);
});

const appModule = readFileSync(join(root, "apps/cloud-api/src/app.module.ts"), "utf8");
assert.match(appModule, /DatabaseModule/);

const prismaSchema = readFileSync(join(root, "apps/cloud-api/prisma/schema.prisma"), "utf8");
assert.match(prismaSchema, /model LoginSession/);
assert.match(prismaSchema, /model HubItem/);
assert.match(prismaSchema, /model HubRelease/);
assert.match(prismaSchema, /model InstallLog/);
assert.doesNotMatch(prismaSchema, /model McpItem/);
assert.doesNotMatch(prismaSchema, /model McpRelease/);

const internalAuthPort = readFileSync(
  join(root, "apps/cloud-api/src/modules/auth/ports/internal-auth-provider.ts"),
  "utf8"
);
assert.match(internalAuthPort, /interface InternalAuthProvider/);
assert.match(internalAuthPort, /validateCredentials/);

const artifactPort = readFileSync(
  join(root, "apps/cloud-api/src/modules/artifact/ports/artifact-storage.port.ts"),
  "utf8"
);
assert.match(artifactPort, /interface ArtifactStoragePort/);
assert.match(artifactPort, /createDownloadDescriptor/);

const dockerCompose = readFileSync(join(root, "infra/docker-compose.yml"), "utf8");
assert.match(dockerCompose, /MySQL/);
assert.match(dockerCompose, /mysql:8\.0/);
assert.match(dockerCompose, /3306:3306/);

console.log("cloud infrastructure scaffold verified");
