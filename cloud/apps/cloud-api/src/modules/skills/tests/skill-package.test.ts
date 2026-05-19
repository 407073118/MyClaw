import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { parseSkillMarkdownMetadata, prepareSkillPackageUpload } from "../skill-package";

type ZipEntryInput = {
  name: string;
  content: string;
};

function createStoredZip(entries: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = Buffer.from(entry.content, "utf8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

describe("skill package helpers", () => {
  it("parses skill name and description from SKILL.md frontmatter", () => {
    const metadata = parseSkillMarkdownMetadata(`---
name: filesystem-skill
description: Manage filesystem tasks safely.
---

# Filesystem Skill
`);

    expect(metadata).toEqual({
      name: "filesystem-skill",
      description: "Manage filesystem tasks safely.",
    });
  });

  it("extracts SKILL.md from an uploaded zip package", () => {
    const skillMarkdown = `---
name: filesystem-skill
description: Manage filesystem tasks safely.
---
`;
    const zip = createStoredZip([
      { name: "filesystem-skill/SKILL.md", content: skillMarkdown },
      { name: "filesystem-skill/scripts/run.js", content: "console.log('run');" },
    ]);

    const prepared = prepareSkillPackageUpload([
      {
        buffer: zip,
        fieldname: "file",
        originalname: "filesystem-skill.zip",
        size: zip.length,
      },
    ]);

    expect(prepared.entryFile).toBe("filesystem-skill/SKILL.md");
    expect(prepared.fileName).toBe("filesystem-skill.zip");
    expect(prepared.skillMarkdown).toBe(skillMarkdown);
    expect(prepared.metadata.name).toBe("filesystem-skill");
  });

  it("zips an uploaded folder and extracts its SKILL.md metadata", () => {
    const skillMarkdown = `---
name: folder-skill
description: Publish a folder as a skill.
---
`;

    const prepared = prepareSkillPackageUpload([
      {
        buffer: Buffer.from(skillMarkdown),
        fieldname: "files",
        originalname: "folder-skill/SKILL.md",
        size: Buffer.byteLength(skillMarkdown),
      },
      {
        buffer: Buffer.from("export {};"),
        fieldname: "files",
        originalname: "folder-skill/scripts/index.ts",
        size: Buffer.byteLength("export {};"),
      },
    ]);

    expect(prepared.entryFile).toBe("folder-skill/SKILL.md");
    expect(prepared.fileName).toBe("folder-skill.zip");
    expect(prepared.fileBytes.subarray(0, 4).toString("binary")).toBe("PK\u0003\u0004");
    expect(prepared.metadata.description).toBe("Publish a folder as a skill.");
  });

  it("rejects packages without SKILL.md", () => {
    const zip = createStoredZip([{ name: "notes.md", content: "# Missing" }]);

    expect(() =>
      prepareSkillPackageUpload([
        {
          buffer: zip,
          fieldname: "file",
          originalname: "missing.zip",
          size: zip.length,
        },
      ]),
    ).toThrow(BadRequestException);
  });
});
