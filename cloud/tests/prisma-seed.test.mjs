import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

assert.equal(
  existsSync(join(root, "apps/cloud-api/prisma/seed.ts")),
  true,
  "missing apps/cloud-api/prisma/seed.ts"
);

const packageJson = readFileSync(join(root, "apps/cloud-api/package.json"), "utf8");
assert.match(packageJson, /"prisma:seed"/);

const seedSource = readFileSync(join(root, "apps/cloud-api/prisma/seed.ts"), "utf8");
assert.match(seedSource, /const MCP_SEED_ITEMS = \[/);
assert.match(seedSource, /prisma\.mcpServer\.upsert/);
assert.match(seedSource, /configJson:\s*release\.config/);

console.log("prisma seed scaffold verified");
