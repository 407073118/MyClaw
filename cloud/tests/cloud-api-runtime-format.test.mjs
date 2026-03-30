import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

const apiPackage = JSON.parse(
  readFileSync(join(root, "apps/cloud-api/package.json"), "utf8")
);
const apiTsconfig = JSON.parse(
  readFileSync(join(root, "apps/cloud-api/tsconfig.json"), "utf8")
);

assert.notEqual(
  apiPackage.type,
  "module",
  "cloud-api must not run as a Node ESM package because Nest emits extensionless relative imports"
);
assert.equal(
  apiTsconfig.compilerOptions?.module,
  "CommonJS",
  "cloud-api must compile runtime code as CommonJS"
);
assert.equal(
  apiTsconfig.compilerOptions?.moduleResolution,
  "Node",
  "cloud-api must use Node module resolution for CommonJS runtime output"
);

console.log("cloud-api runtime format verified");
