import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("desktop branding", () => {
  it("uses MyClaw naming for desktop binary and visible app branding", () => {
    const workspacePackagePath = resolve(__dirname, "../../../../../package.json");
    const desktopPackagePath = resolve(__dirname, "../../../package.json");
    const runtimePackagePath = resolve(__dirname, "../../../../../apps/runtime/package.json");
    const sharedPackagePath = resolve(__dirname, "../../../../../packages/shared/package.json");
    const tauriConfigPath = resolve(__dirname, "../../../src-tauri/tauri.conf.json");
    const cargoTomlPath = resolve(__dirname, "../../../src-tauri/Cargo.toml");
    const runtimeSupervisorPath = resolve(__dirname, "../../../src-tauri/src/runtime_supervisor.rs");
    const bundledSidecarPath = resolve(__dirname, "../../../src-tauri/binaries/myclaw-runtime-x86_64-pc-windows-msvc.exe");
    const appShellPath = resolve(__dirname, "../../layouts/AppShell.vue");
    const indexHtmlPath = resolve(__dirname, "../../../index.html");

    const workspacePackage = JSON.parse(readFileSync(workspacePackagePath, "utf8")) as { name: string };
    const desktopPackage = JSON.parse(readFileSync(desktopPackagePath, "utf8")) as {
      name: string;
      dependencies: Record<string, string>;
    };
    const runtimePackage = JSON.parse(readFileSync(runtimePackagePath, "utf8")) as {
      name: string;
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    const sharedPackage = JSON.parse(readFileSync(sharedPackagePath, "utf8")) as { name: string };
    const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8")) as {
      productName: string;
      identifier: string;
      bundle: {
        resources: string[];
        windows?: {
          webviewInstallMode?: {
            type: string;
          };
        };
      };
      app: {
        windows: Array<{ title: string }>;
      };
    };
    const cargoToml = readFileSync(cargoTomlPath, "utf8");
    const runtimeSupervisor = readFileSync(runtimeSupervisorPath, "utf8");
    const appShell = readFileSync(appShellPath, "utf8");
    const indexHtml = readFileSync(indexHtmlPath, "utf8");

    expect(workspacePackage.name).toBe("myclaw-desktop-workspace");
    expect(desktopPackage.name).toBe("@myclaw-desktop/desktop");
    expect(desktopPackage.dependencies).toHaveProperty("@myclaw-desktop/shared", "workspace:*");
    expect(runtimePackage.name).toBe("@myclaw-desktop/runtime");
    expect(runtimePackage.dependencies).toHaveProperty("@myclaw-desktop/shared", "workspace:*");
    expect(runtimePackage.scripts["build:sidecar:win"]).toContain("myclaw-runtime-x86_64-pc-windows-msvc.exe");
    expect(sharedPackage.name).toBe("@myclaw-desktop/shared");
    expect(cargoToml).toContain('name = "MyClaw_desktop"');
    expect(tauriConfig.productName).toBe("MyClaw");
    expect(tauriConfig.identifier).toBe("com.example.myclawdesktop");
    expect(tauriConfig.app.windows[0]?.title).toBe("MyClaw");
    expect(tauriConfig.bundle.resources).toContain("binaries/myclaw-runtime-x86_64-pc-windows-msvc.exe");
    expect(tauriConfig.bundle.windows?.webviewInstallMode?.type).toBe("offlineInstaller");
    expect(existsSync(bundledSidecarPath)).toBe(true);
    expect(runtimeSupervisor).toContain('pub const RUNTIME_BINARY_PREFIX: &str = "myclaw-runtime";');
    expect(runtimeSupervisor).toContain('format!("myclaw-runtime-supervisor-{ts}")');
    expect(runtimeSupervisor).toContain('let desktop_exe = exe_dir.join("MyClaw_desktop.exe");');
    expect(runtimeSupervisor).toContain('let runtime_sidecar = resources_dir.join("myclaw-runtime-x86_64-pc-windows-msvc.exe");');
    expect(appShell).toContain("<h2>MyClaw</h2>");
    expect(appShell).toContain('label: "广场"');
    expect(indexHtml).toContain("<title>MyClaw</title>");
    expect(JSON.stringify(workspacePackage)).not.toContain("OpenClaw");
    expect(JSON.stringify(workspacePackage)).not.toContain("openclaw");
    expect(JSON.stringify(desktopPackage)).not.toContain("OpenClaw");
    expect(JSON.stringify(desktopPackage)).not.toContain("openclaw");
    expect(JSON.stringify(runtimePackage)).not.toContain("OpenClaw");
    expect(JSON.stringify(runtimePackage)).not.toContain("openclaw");
    expect(JSON.stringify(sharedPackage)).not.toContain("OpenClaw");
    expect(JSON.stringify(sharedPackage)).not.toContain("openclaw");
    expect(JSON.stringify(tauriConfig)).not.toContain("OpenClaw");
    expect(JSON.stringify(tauriConfig)).not.toContain("openclaw");
    expect(cargoToml).not.toContain("OpenClaw");
    expect(cargoToml).not.toContain("openclaw");
    expect(runtimeSupervisor).not.toContain("OpenClaw");
    expect(runtimeSupervisor).not.toContain("openclaw");
    expect(runtimeSupervisor).not.toContain("OPENCLAW_");
    expect(appShell).not.toContain("OpenClaw");
    expect(appShell).not.toContain("openclaw");
    expect(indexHtml).not.toContain("OpenClaw");
    expect(indexHtml).not.toContain("openclaw");
  });
});
