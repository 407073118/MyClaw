import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.MYCLAW_DATA_ROOT;
    delete process.env.PORTABLE_EXECUTABLE_DIR;

    installRoot = mkdtempSync(join(tmpdir(), "myclaw-install-"));
    userDataRoot = mkdtempSync(join(tmpdir(), "myclaw-userdata-"));
    overrideRoot = mkdtempSync(join(tmpdir(), "myclaw-override-"));
    installerSelectedRoot = mkdtempSync(join(tmpdir(), "myclaw-selected-"));

    electronAppMock.isPackaged = true;
    electronAppMock.getPath.mockImplementation((name: string) => {
      if (name === "userData") return userDataRoot;
      if (name === "exe") return join(installRoot, "MyClaw.exe");
      throw new Error(`Unhandled mocked Electron path request: ${name}`);
    });
  });

  afterEach(() => {
    for (const dir of [installRoot, userDataRoot, overrideRoot, installerSelectedRoot]) {
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
});
