import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const requiredFiles = [
  "apps/cloud-api/prisma/schema.prisma",
  "apps/cloud-api/src/modules/database/database.module.ts",
  "apps/cloud-api/src/modules/database/database.service.ts",
  "apps/cloud-api/src/modules/auth/internal-auth-provider.ts",
  "apps/cloud-api/src/modules/artifact/artifact-storage.port.ts",
  "apps/cloud-api/src/modules/artifact/fastdfs-artifact-storage.ts"
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

const internalAuthPort = readFileSync(
  join(root, "apps/cloud-api/src/modules/auth/internal-auth-provider.ts"),
  "utf8"
);
assert.match(internalAuthPort, /interface InternalAuthProvider/);
assert.match(internalAuthPort, /validateCredentials/);

const artifactPort = readFileSync(
  join(root, "apps/cloud-api/src/modules/artifact/artifact-storage.port.ts"),
  "utf8"
);
assert.match(artifactPort, /interface ArtifactStoragePort/);
assert.match(artifactPort, /createDownloadDescriptor/);

const dockerCompose = readFileSync(join(root, "infra/docker-compose.yml"), "utf8");
assert.match(dockerCompose, /postgres:16/);
assert.match(dockerCompose, /5432:5432/);

console.log("cloud infrastructure scaffold verified");
