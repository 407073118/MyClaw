import { PrismaClient } from "@prisma/client";

import { HUB_SEED_ITEMS } from "../src/modules/hub/hub-seed-data";

const prisma = new PrismaClient();

async function main() {
  for (const item of HUB_SEED_ITEMS) {
    await prisma.hubItem.upsert({
      where: { id: item.id },
      update: {
        type: item.type,
        name: item.name,
        summary: item.summary,
        description: item.description,
        latestVersion: item.latestVersion
      },
      create: {
        id: item.id,
        type: item.type,
        name: item.name,
        summary: item.summary,
        description: item.description,
        latestVersion: item.latestVersion
      }
    });

    for (const release of item.releases) {
      await prisma.hubRelease.upsert({
        where: { id: release.id },
        update: {
          itemId: item.id,
          version: release.version,
          releaseNotes: release.releaseNotes,
          manifestJson: buildManifest(item, release.version),
          artifactFileName: `${release.id}.zip`,
          artifactFileSize: 0,
          artifactStoragePath: `seed://${release.id}.zip`,
          artifactDownloadUrl: `/api/artifacts/download/${release.id}`,
          artifactDownloadExpires: 300,
        },
        create: {
          id: release.id,
          itemId: item.id,
          version: release.version,
          releaseNotes: release.releaseNotes,
          manifestJson: buildManifest(item, release.version),
          artifactFileName: `${release.id}.zip`,
          artifactFileSize: 0,
          artifactStoragePath: `seed://${release.id}.zip`,
          artifactDownloadUrl: `/api/artifacts/download/${release.id}`,
          artifactDownloadExpires: 300,
        }
      });
    }
  }
}

function buildManifest(item: (typeof HUB_SEED_ITEMS)[number], version: string) {
  if (item.type === "skill") {
    return {
      kind: "skill",
      name: item.name,
      version,
      description: item.description,
      entry: "SKILL.md"
    };
  }

  return {
    kind: "mcp",
    name: item.name,
    version,
    description: item.description,
    config: {
      transport: "stdio",
      command: "npx",
      args: ["@modelcontextprotocol/server-filesystem", "."]
    }
  };
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
