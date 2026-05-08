import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const electronAppMock = {
  isPackaged: false,
  getPath: vi.fn<(name: string) => string>(),
  setPath: vi.fn(),
};

vi.mock("electron", () => ({
  app: electronAppMock,
}));

describe("directory service path resolution", () => {
  let installRoot = "";
  let userDataRoot = "";
  let overrideRoot = "";
  let installerSelectedRoot = "";
  let worktreeBase = "";
  let originalCwd = "";

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.MYCLAW_DATA_ROOT;
    delete process.env.PORTABLE_EXECUTABLE_DIR;

    originalCwd = process.cwd();

    installRoot = mkdtempSync(join(tmpdir(), "myclaw-install-"));
    userDataRoot = mkdtempSync(join(tmpdir(), "myclaw-userdata-"));
    overrideRoot = mkdtempSync(join(tmpdir(), "myclaw-override-"));
    installerSelectedRoot = mkdtempSync(join(tmpdir(), "myclaw-selected-"));
    worktreeBase = mkdtempSync(join(tmpdir(), "myclaw-worktree-"));

    electronAppMock.isPackaged = true;
    electronAppMock.getPath.mockImplementation((name: string) => {
      if (name === "userData") return userDataRoot;
      if (name === "exe") return join(installRoot, "MyClaw.exe");
      throw new Error(`Unhandled mocked Electron path request: ${name}`);
    });
  });

  afterEach(() => {
    if (originalCwd && existsSync(originalCwd)) {
      process.chdir(originalCwd);
    }
    for (const dir of [installRoot, userDataRoot, overrideRoot, installerSelectedRoot, worktreeBase]) {
      if (dir && existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("uses the default userData root for packaged installed builds", async () => {
    const { initializeDirectories, redirectUserData } = await import("../src/main/services/directory-service");

    redirectUserData();
    const paths = await initializeDirectories();

    expect(electronAppMock.setPath).not.toHaveBeenCalled();
    expect(paths.rootDir).toBe(userDataRoot);
    expect(paths.myClawDir).toBe(join(userDataRoot, "myClaw"));
    expect(existsSync(paths.modelsDir)).toBe(true);
  });

  it("redirects userData only when an explicit portable data root is provided", async () => {
    process.env.MYCLAW_DATA_ROOT = overrideRoot;

    const { initializeDirectories, redirectUserData } = await import("../src/main/services/directory-service");

    redirectUserData();
    const paths = await initializeDirectories();

    expect(electronAppMock.setPath).toHaveBeenCalledWith("userData", join(overrideRoot, "electron"));
    expect(paths.rootDir).toBe(overrideRoot);
    expect(paths.sessionsDir).toBe(join(overrideRoot, "myClaw", "sessions"));
    expect(existsSync(paths.skillsDir)).toBe(true);
  });

  it("uses the installer-selected data root from the sidecar config for packaged builds", async () => {
    writeFileSync(join(installRoot, "myclaw-data-root.txt"), installerSelectedRoot, "utf8");

    const { initializeDirectories, redirectUserData } = await import("../src/main/services/directory-service");

    redirectUserData();
    const paths = await initializeDirectories();

    expect(electronAppMock.setPath).toHaveBeenCalledWith("userData", join(installerSelectedRoot, "electron"));
    expect(paths.rootDir).toBe(installerSelectedRoot);
    expect(paths.modelsDir).toBe(join(installerSelectedRoot, "myClaw", "models"));
    expect(existsSync(paths.myClawDir)).toBe(true);
  });

  it("ignores installer-selected data roots that match the install directory", async () => {
    writeFileSync(join(installRoot, "myclaw-data-root.txt"), installRoot, "utf8");

    const { initializeDirectories, redirectUserData } = await import("../src/main/services/directory-service");

    redirectUserData();
    const paths = await initializeDirectories();

    expect(electronAppMock.setPath).not.toHaveBeenCalled();
    expect(paths.rootDir).toBe(userDataRoot);
    expect(paths.myClawDir).toBe(join(userDataRoot, "myClaw"));
  });

  it("ignores installer-selected data roots nested under the install directory", async () => {
    const nestedDataRoot = join(installRoot, "data");
    writeFileSync(join(installRoot, "myclaw-data-root.txt"), nestedDataRoot, "utf8");

    const { initializeDirectories, redirectUserData } = await import("../src/main/services/directory-service");

    redirectUserData();
    const paths = await initializeDirectories();

    expect(electronAppMock.setPath).not.toHaveBeenCalled();
    expect(paths.rootDir).toBe(userDataRoot);
    expect(paths.cacheDir).toBe(join(userDataRoot, "myClaw", "cache"));
  });

  it("auto-redirects to <worktree-root>/.userdata when cwd lives under .worktrees in dev mode", async () => {
    electronAppMock.isPackaged = false;
    const worktreeRoot = join(worktreeBase, ".worktrees", "feature-branch");
    const desktopDir = join(worktreeRoot, "desktop");
    mkdirSync(desktopDir, { recursive: true });
    process.chdir(desktopDir);

    const { initializeDirectories, redirectUserData } = await import("../src/main/services/directory-service");

    redirectUserData();
    const paths = await initializeDirectories();

    const expectedRoot = join(worktreeRoot, ".userdata");
    expect(electronAppMock.setPath).toHaveBeenCalledWith("userData", join(expectedRoot, "electron"));
    expect(paths.rootDir).toBe(expectedRoot);
    expect(paths.myClawDir).toBe(join(expectedRoot, "myClaw"));
    expect(existsSync(paths.skillsDir)).toBe(true);
  });

  it("prefers MYCLAW_DATA_ROOT over worktree auto-detection when both apply", async () => {
    electronAppMock.isPackaged = false;
    process.env.MYCLAW_DATA_ROOT = overrideRoot;
    const desktopDir = join(worktreeBase, ".worktrees", "feature-branch", "desktop");
    mkdirSync(desktopDir, { recursive: true });
    process.chdir(desktopDir);

    const { initializeDirectories, redirectUserData } = await import("../src/main/services/directory-service");

    redirectUserData();
    const paths = await initializeDirectories();

    expect(electronAppMock.setPath).toHaveBeenCalledWith("userData", join(overrideRoot, "electron"));
    expect(paths.rootDir).toBe(overrideRoot);
  });

  it("skips worktree auto-detection in packaged builds even when path looks like a worktree", async () => {
    electronAppMock.isPackaged = true;
    const desktopDir = join(worktreeBase, ".worktrees", "feature-branch", "desktop");
    mkdirSync(desktopDir, { recursive: true });
    process.chdir(desktopDir);

    const { initializeDirectories, redirectUserData } = await import("../src/main/services/directory-service");

    redirectUserData();
    const paths = await initializeDirectories();

    expect(electronAppMock.setPath).not.toHaveBeenCalled();
    expect(paths.rootDir).toBe(userDataRoot);
    expect(paths.myClawDir).toBe(join(userDataRoot, "myClaw"));
  });

  it("falls back to default userData when dev cwd has no .worktrees segment", async () => {
    electronAppMock.isPackaged = false;
    const plainDir = join(worktreeBase, "regular-checkout", "desktop");
    mkdirSync(plainDir, { recursive: true });
    process.chdir(plainDir);

    const { initializeDirectories, redirectUserData } = await import("../src/main/services/directory-service");

    redirectUserData();
    const paths = await initializeDirectories();

    expect(electronAppMock.setPath).not.toHaveBeenCalled();
    expect(paths.rootDir).toBe(userDataRoot);
  });
});
