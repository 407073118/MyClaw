import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("installer config", () => {
  test("rejects data directories that overlap the install directory", () => {
    const installerScriptPath = resolve(__dirname, "..", "build", "installer.nsh");
    const installerScript = readFileSync(installerScriptPath, "utf-8");

    expect(installerScript).toContain("Function ValidateDataDirAgainstInstallDir");
    expect(installerScript.match(/Call ValidateDataDirAgainstInstallDir/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
