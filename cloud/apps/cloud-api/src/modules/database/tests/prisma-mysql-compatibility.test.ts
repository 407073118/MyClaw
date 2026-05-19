import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("prisma mysql compatibility", () => {
  it("does not assign default values to TEXT columns", () => {
    const schemaPath = resolve(__dirname, "../../../../prisma/schema.prisma");
    const schema = readFileSync(schemaPath, "utf-8");

    expect(schema).not.toContain('@default("") @db.Text');
  });

  it("uses numeric auto increment ids for project domain tables", () => {
    const schemaPath = resolve(__dirname, "../../../../prisma/schema.prisma");
    const schema = readFileSync(schemaPath, "utf-8");

    expect(schema).toMatch(/model Project\s*{[\s\S]*?id Int @id @default\(autoincrement\(\)\)/);
    expect(schema).toMatch(/model ProjectRepository\s*{[\s\S]*?id Int @id @default\(autoincrement\(\)\)/);
    expect(schema).toMatch(/model ProjectSkillRef\s*{[\s\S]*?id Int @id @default\(autoincrement\(\)\)/);
    expect(schema).toMatch(/model ProjectMcpRef\s*{[\s\S]*?id Int @id @default\(autoincrement\(\)\)/);
    expect(schema).toMatch(/model ProjectApi\s*{[\s\S]*?projectId Int @map\("project_id"\)/);
    expect(schema).toMatch(/model ProjectApi\s*{[\s\S]*?parametersJson Json\? @map\("parameters_json"\)/);
    expect(schema).toMatch(/model ProjectApi\s*{[\s\S]*?requestBodyType String @default\("none"\) @map\("request_body_type"\)/);
    expect(schema).toMatch(/model ProjectApi\s*{[\s\S]*?requestBodyContentType String\? @map\("request_body_content_type"\)/);
    expect(schema).toMatch(/model ProjectApi\s*{[\s\S]*?requestBodyExampleJson Json\? @map\("request_body_example_json"\)/);
  });
});
