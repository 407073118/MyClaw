import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** MCP 种子数据 */
const MCP_SEED_ITEMS = [
  {
    id: "mcp-filesystem-managed",
    name: "Filesystem MCP",
    summary: "Managed filesystem connector",
    description: "Injects a managed MCP connector for local filesystem tooling.",
    latestVersion: "1.0.0",
    releases: [
      {
        id: "release-mcp-filesystem-managed-1.0.0",
        version: "1.0.0",
        releaseNotes: "Initial release",
        config: {
          transport: "stdio" as const,
          command: "npx",
          args: ["@modelcontextprotocol/server-filesystem", "."]
        }
      }
    ]
  }
];

async function main() {
  // 灌入 MCP 种子数据
  for (const item of MCP_SEED_ITEMS) {
    await prisma.mcpServer.upsert({
      where: { id: item.id },
      update: {
        name: item.name,
        summary: item.summary,
        description: item.description,
        latestVersion: item.latestVersion
      },
      create: {
        id: item.id,
        name: item.name,
        summary: item.summary,
        description: item.description,
        latestVersion: item.latestVersion,
        latestReleaseId: item.releases[0]?.id ?? null
      }
    });

    for (const release of item.releases) {
      await prisma.mcpServerRelease.upsert({
        where: { id: release.id },
        update: {
          serverId: item.id,
          version: release.version,
          releaseNotes: release.releaseNotes,
          configJson: release.config
        },
        create: {
          id: release.id,
          serverId: item.id,
          version: release.version,
          releaseNotes: release.releaseNotes,
          configJson: release.config
        }
      });
    }
  }
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
