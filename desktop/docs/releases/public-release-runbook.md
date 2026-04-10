# Desktop Public Release Runbook

## Goal

This document defines the desktop release flow for MyClaw. The source code stays in the private main repository, while Windows installers and auto-update metadata are published to the public repository `407073118/MyClaw-desktop-releases`.

## Release Topology

- The private source repository owns development, testing, packaging, and GitHub Actions triggers.
- The public repository `MyClaw-desktop-releases` stores release assets only. It should not contain business source code.
- The desktop updater reads installers and `latest.yml` from the public GitHub Releases page.
- User data is stored outside the installation directory, so reinstalling or auto-updating should not overwrite existing sessions, settings, models, or skills.

## Public Repository Contract

The public release repository must stay aligned with the desktop client:

- Repository URL: `https://github.com/407073118/MyClaw-desktop-releases`
- Visibility: `Public`
- GitHub Releases must stay enabled
- Every release must include:
  - `MyClaw Setup x.y.z.exe`
  - `latest.yml`
  - the matching `.blockmap`

If the release repository changes later, update these files together:

- `desktop/config/env.production.ts`
- `desktop/package.json`
- `.github/workflows/desktop-public-release.yml`

## Prerequisites

Before publishing, confirm all of the following:

1. GitHub Actions is enabled in the private source repository.
2. The repository secret `PUBLIC_RELEASES_TOKEN` exists.
3. `PUBLIC_RELEASES_TOKEN` can write releases and assets to `MyClaw-desktop-releases`.
4. `desktop/package.json` already contains the version you want to ship.
5. You have either prepared release notes or you are fine with the workflow's default notes template.

Recommended token setup:

- Fine-grained PAT with `Contents: Read and write` on `MyClaw-desktop-releases`
- Classic PAT with `repo` scope if fine-grained tokens are not available yet

## Workflow Entry Points

Workflow file:

- `.github/workflows/desktop-public-release.yml`

Supported triggers:

1. `workflow_dispatch`
2. Git tag push matching `desktop-v*`

The Git tag must match `desktop/package.json`. Example:

- package version `0.1.0` -> tag `desktop-v0.1.0`
- package version `0.2.0-beta.1` -> tag `desktop-v0.2.0-beta.1`

Prerelease handling:

- A semver prerelease version such as `0.2.0-beta.1` is published as a prerelease automatically.
- A manual workflow run can also force `prerelease=true`.

## Recommended Release Steps

### 1. Verify Locally

Run these commands from `desktop/` before you ship:

```powershell
pnpm typecheck
pnpm exec vitest run tests/app-updater-service.test.ts tests/update-ipc.test.ts tests/settings-page-update.test.ts tests/platform-config.test.ts tests/public-release-pipeline.test.ts
```

If you also want to verify packaging locally:

```powershell
pnpm run dist:prod -- --publish never
```

### 2. Bump The Version

Update the `version` field in `desktop/package.json`. Do not push a release tag without updating the package version, because the workflow validates that both values match exactly.

### 3. Trigger The Release

Preferred path:

```powershell
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

Fallback path:

- Open GitHub Actions
- Run `Desktop Public Release`
- Optionally paste release notes

### 4. What The Workflow Does

The workflow performs these steps on `windows-latest`:

1. Installs pnpm and Node.js 22
2. Installs `desktop/` dependencies
3. Runs `pnpm typecheck`
4. Runs the updater regression tests
5. Runs `pnpm run dist:prod -- --publish never`
6. Collects `.exe`, `latest.yml`, and `.blockmap` from `desktop/release`
7. Creates or updates the matching release in `MyClaw-desktop-releases`
8. Uploads all release assets with `gh release upload --clobber`

## Post Release Checklist

After every release:

1. Open `https://github.com/407073118/MyClaw-desktop-releases/releases`
2. Confirm the expected release tag exists
3. Confirm the release contains the installer, `latest.yml`, and `.blockmap`
4. On an installed MyClaw client, open Settings and click the update check action
5. Verify that detection, download progress, and restart-to-install all work
6. Verify the manual download page still works as a fallback

## Manual Fallback

If GitHub Actions is unavailable or the automatic update flow is temporarily broken:

1. Run `pnpm run dist:prod -- --publish never`
2. Open `desktop/release/`
3. Upload the `.exe`, `latest.yml`, and `.blockmap` to the public release manually
4. Share the release page URL with users so they can install over the existing app

Because the app stores user data outside the install directory, reinstalling should not delete existing data. Users should still close the application before running the installer.

## Rollback

If a release is bad:

1. Remove the bad assets from the public release, or change the release state so clients stop consuming it
2. Re-publish the previous stable `.exe`, `latest.yml`, and `.blockmap`
3. Fix the issue in the private source repository
4. Publish a new `desktop-vx.y.z` release after verification passes

If the installer is healthy but auto-update is temporarily broken, keep the release available and rely on the manual download page as the user-facing fallback.

## FAQ

### Why keep the source repository private?

Because the current goal is to expose release assets without exposing source code. The split between a private source repository and a public release repository satisfies that requirement cleanly.

### Why is `latest.yml` required?

`electron-updater` uses `latest.yml` to detect the latest version, locate the installer, and validate the update metadata. Uploading only the installer is not enough for in-app updates.

### Why keep manual downloads if auto-update exists?

Auto-update is the best experience, but it should not be the only upgrade path. A public release page lets users recover from token mistakes, download failures, and network restrictions.

## GitLab Migration Guidance

If the project later moves to an internal GitLab instance, do not bind desktop clients directly to private GitLab release assets unless you also build a safe token distribution story.

The safer path is:

1. Keep building from the private source repository
2. Publish installers and metadata to a stable internal download endpoint or artifact store
3. Point the desktop updater at that stable endpoint instead of a private GitLab API

This preserves the current architecture: private source code, independent update feed, and minimal renderer or IPC changes.
