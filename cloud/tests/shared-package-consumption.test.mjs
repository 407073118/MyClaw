import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

const sharedPackage = JSON.parse(
  readFileSync(join(root, "packages/shared/package.json"), "utf8")
);
const apiPackage = JSON.parse(
  readFileSync(join(root, "apps/cloud-api/package.json"), "utf8")
);
const apiTsconfig = JSON.parse(
  readFileSync(join(root, "apps/cloud-api/tsconfig.json"), "utf8")
);

assert.equal(
  sharedPackage.scripts.build.includes("--noEmit"),
  false,
  "shared build must emit consumable artifacts"
);
assert.equal(
  sharedPackage.types,
  "./dist/index.d.ts",
  "shared package must expose built declaration entrypoint"
);
assert.equal(
  sharedPackage.exports?.["."]?.types,
  "./dist/index.d.ts",
  "shared package must export built declaration entrypoint"
);
assert.equal(
  apiPackage.scripts["sync:shared"],
  "pnpm --dir ../../packages/shared build",
  "cloud-api must provide a shared build sync script"
);
assert.equal(
  apiPackage.scripts.predev,
  "pnpm run sync:shared",
  "cloud-api dev must build shared artifacts before starting Nest watch mode"
);
assert.equal(
  apiTsconfig.compilerOptions?.paths?.["@myclaw-cloud/shared"]?.[0],
  "../../packages/shared/dist/index.d.ts",
  "cloud-api must resolve shared types from built artifacts instead of shared src"
);

console.log("shared package consumption verified");
