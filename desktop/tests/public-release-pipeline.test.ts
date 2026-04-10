import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("桌面端公开发布链路", () => {
  test("GitHub Actions 工作流会构建安装包并上传到公开 release 仓库", () => {
    const workflowPath = resolve(
      __dirname,
      "..",
      "..",
      ".github",
      "workflows",
      "desktop-public-release.yml",
    );
    const workflow = readFileSync(workflowPath, "utf-8");

    expect(workflow).toContain("windows-latest");
    expect(workflow).toContain("PUBLIC_RELEASE_REPO: 407073118/MyClaw-desktop-releases");
    expect(workflow).toContain("PUBLIC_RELEASES_TOKEN");
    expect(workflow).toContain("desktop-v");
    expect(workflow).toContain("pnpm run dist:prod -- --publish never");
    expect(workflow).toContain("gh release upload");
  });

  test("公开发布说明文档覆盖前置条件、发版步骤、回滚和 GitLab 迁移说明", () => {
    const docPath = resolve(__dirname, "..", "docs", "releases", "public-release-runbook.md");
    const doc = readFileSync(docPath, "utf-8");

    expect(doc).toContain("PUBLIC_RELEASES_TOKEN");
    expect(doc).toContain("MyClaw-desktop-releases");
    expect(doc).toContain("desktop-v");
    expect(doc).toContain("Rollback");
    expect(doc).toContain("GitLab");
    expect(doc).toContain("latest.yml");
  });
});
