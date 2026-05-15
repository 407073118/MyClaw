import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("installer config", () => {
  test("rejects data directories that overlap the install directory", () => {
    const installerScriptPath = resolve(__dirname, "..", "build", "installer.nsh");
    const installerScript = readFileSync(installerScriptPath, "utf-8");

    expect(installerScript).toContain("Function ValidateDataDirAgainstInstallDir");
    expect(installerScript.match(/Call ValidateDataDirAgainstInstallDir/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(installerScript).not.toContain("${GetFullPathName}");
    expect(installerScript).toContain('GetFullPathName $0 "$INSTDIR"');
    expect(installerScript).toContain('GetFullPathName $1 "$DataDirValue"');
  });

  test("keeps the existing data directory during manual reinstall", () => {
    const installerScriptPath = resolve(__dirname, "..", "build", "installer.nsh");
    const installerScript = readFileSync(installerScriptPath, "utf-8");

    expect(installerScript).toContain("Var HasExistingDataDirConfig");
    expect(installerScript).toContain('StrCpy $HasExistingDataDirConfig "1"');
    expect(installerScript).toContain("检测到已有 MyClaw 数据目录");
    expect(installerScript).toContain("保留这个目录可以继续使用原有技能、会话、模型和设置");
    expect(installerScript).toContain('EnableWindow $DataDirInput 0');
    expect(installerScript).toContain('EnableWindow $DataDirBrowseButton 0');
  });
});
