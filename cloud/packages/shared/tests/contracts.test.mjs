import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

const indexSource = readFileSync(join(root, "src/index.ts"), "utf8");
const source = readFileSync(join(root, "src/contracts/hub.ts"), "utf8");
const skillsContractPath = join(root, "src/contracts/skills.ts");
const mcpContractPath = join(root, "src/contracts/mcp.ts");

assert.ok(existsSync(skillsContractPath));
assert.ok(existsSync(mcpContractPath));
assert.match(indexSource, /contracts\/skills/);
assert.match(indexSource, /contracts\/mcp/);

const skillsSource = readFileSync(skillsContractPath, "utf8");
const mcpSource = readFileSync(mcpContractPath, "utf8");
assert.match(skillsSource, /export type SkillSummary/);
assert.match(skillsSource, /export type SkillDetail/);
assert.match(skillsSource, /export type CreateSkillInput/);
assert.match(skillsSource, /export type PublishSkillReleaseResponse/);
assert.match(skillsSource, /artifact:/);
assert.match(mcpSource, /export type McpItemSummary/);
assert.match(mcpSource, /export type McpItemDetail/);
assert.match(mcpSource, /export type CreateMcpItemInput/);
assert.match(mcpSource, /export type McpReleaseUploadResponse/);

assert.doesNotMatch(source, /"skill"/);
assert.match(source, /"mcp"/);
assert.match(source, /"employee-package"/);
assert.match(source, /"workflow-package"/);
assert.doesNotMatch(source, /SkillReleaseUploadResponse/);
assert.doesNotMatch(source, /CreateSkillItemInput/);
assert.doesNotMatch(source, /CreateSkillReleaseResponse/);
assert.match(source, /artifact:/);
assert.match(source, /HubManifest/);

console.log("shared contracts verified");
