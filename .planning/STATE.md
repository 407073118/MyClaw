---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 08-document-ir-document-read/08-09-PLAN.md (Phase 08 complete — all 9 plans done)
last_updated: "2026-05-06T08:30:00.000Z"
last_activity: 2026-05-06
progress:
  total_phases: 8
  completed_phases: 1
  total_plans: 9
  completed_plans: 9
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-04)

**Core value:** 让企业员工在个人桌面端获得一个真正会理解工作语境、会使用工具、会调动企业内部数据来完成任务的 AI 助手。
**Current focus:** Phase 08 — document-ir-document-read

## Current Position

Phase: 08
Plan: Not started
Status: Ready to execute
Last activity: 2026-05-06 - Completed quick task 260506-mq5: 修复硅基员工 SiliconRail 徽章不更新的 bug，并改用单点视觉提示替代数字计数

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: 0 min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: none yet
- Trend: Not enough data

| Phase 08 P02 | 8 | 1 tasks | 2 files |
| Phase 08-document-ir-document-read P01 | 8 | 2 tasks | 7 files |
| Phase 08-document-ir-document-read P03 | 13 | 2 tasks | 7 files |
| Phase 08-document-ir-document-read P04 | 8 | 2 tasks | 5 files |
| Phase 08-document-ir-document-read P05 | 17 | 3 tasks | 7 files |
| Phase 08-document-ir-document-read P06 | 13 | 1 tasks | 7 files |
| Phase 08-document-ir-document-read P07 | 19 | 1 tasks | 5 files |
| Phase 08-document-ir-document-read P08 | 7 | 2 tasks | 7 files |
| Phase 08-document-ir-document-read P09 | 7 | 2 tasks | 4 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Phase 1]: 先补运行时 seams、执行台账和评测基线，再讨论更强自治与规划。
- [Phase 2]: 工具能力扩张必须晚于工具契约、审批边界和统一策略收口。
- [Phase 4]: 企业数据连接采用 read-first 路线，desktop 通过受治理连接访问企业系统。
- [Phase 08]: Doc cache 用工厂函数 + 闭包而非模块级单例，保持模块可脱离 Electron 独立单测；LRU 以 meta.lastAccess 字符串时间驱动，避免 fs mtime 被无关文件操作干扰。
- [Phase 08-document-ir-document-read]: DocumentIR uses a 12-kind discriminated union (heading/paragraph/list/table/image/code/quote/slide/sheet/comment/footnote/pageBreak); renderer uses exhaustive switch with never-type guard
- [Phase 08-document-ir-document-read]: IR->Markdown renderer is pure (no node:*/electron imports); includeImages refs/inline both emit media: URL placeholder — data-uri inlining is caller's responsibility
- [Phase 08-document-ir-document-read]: document.read facade accepts already-resolved absolute path; PathAccessPolicy reuse stays at executor dispatch boundary rather than inside the facade, keeping permission logic in one place
- [Phase 08-document-ir-document-read]: inferBuiltinToolSchemaGroup maps document_* and legacy xlsx_extract into the 'fs' group; avoids extending BuiltinToolSchemaGroup and fixes a pre-existing xlsx_extract visibility gap
- [Phase 08-document-ir-document-read]: setDocCacheRoot is a lazy-factory setter (mirrors setPathPolicy / setPathAudit); resolveDocCache throws [E_DOC_CACHE_NOT_INITIALIZED] with wiring-site hint if called before injection
- [Phase 08-document-ir-document-read]: xlsx parsers register lazily at dispatch entry via idempotent getParser guard; keeps test replacements safe and avoids startup dep load
- [Phase 08-document-ir-document-read]: Legacy xlsx.extract body preserved byte-for-byte; only a 3-line deprecation comment added, traceable to tests/document-xlsx-extract-alias.test.ts
- [Phase 08-document-ir-document-read]: jszip declared as explicit top-level dep in desktop/package.json, not left as a mammoth transitive — pnpm's isolated node_modules layout requires top-level for require('jszip') resolution; 08-07 pptx reuses this dep
- [Phase 08-document-ir-document-read]: docx pre-scans comments.xml/footnotes.xml for DOCTYPE + 16MiB cap BEFORE calling mammoth.convertToHtml — mammoth uses xmldom internally and would raise 'entity not found' that masks our [E_DOC_XXE_BLOCKED] / [E_DOC_ZIP_ENTRY_TOO_LARGE] codes
- [Phase 08-document-ir-document-read]: docx media extraction uses sha256(bytes)-content-addressed dedup: identical image bytes → single on-disk file under mediaDir, N ImageNodes referencing via MediaRef.id; 16MiB cap also applies to media entries
- [Phase 08-document-ir-document-read]: pdfjs-dist pinned at v3.11.174 (last CJS-friendly release); v4+ is ESM-only and breaks the plan's legacy/build/pdf.js require path
- [Phase 08-document-ir-document-read]: pdf-parser uses await import() instead of require() so Vitest's vi.mock can intercept; production lazy-load semantics preserved
- [Phase 08-document-ir-document-read]: PDF security quartet (isEvalSupported/disableStream/disableAutoFetch/disableFontFace) all off; scanned pages emit Chinese marker (扫描页：未抽取到文字) rather than silent empty output
- [Phase 08-document-ir-document-read]: pptx parser reuses jszip declared by 08-05 at the desktop/ top level; package.json untouched this plan
- [Phase 08-document-ir-document-read]: pptx SlideNode.notes stays undefined when notesSlide<N>.xml is absent (or empty) — not an empty array — to distinguish 'no notes' from 'notes file present but empty'
- [Phase 08-document-ir-document-read]: pptx slide ordering derived from numeric N in ppt/slides/slideN.xml path (not presentation.xml rels); matches PowerPoint/Keynote/LibreOffice canonical emit order
- [Phase 08-document-ir-document-read]: Test 7 no-side-channel assertion uses source-level regex scan + runtime fetch spy; vi.spyOn on node:child_process fails under Vitest 3 ESM (non-configurable module namespace)
- [Phase 08-document-ir-document-read]: md/txt/csv parsers land with zero new deps (marked already pinned ^17.0.5); CSV uses hand-rolled RFC4180 char-level parser with manual delimiter char-count (not regex) to avoid '|' metachar foot-gun
- [Phase 08-document-ir-document-read]: Wave 3 parser set complete (9 formats: xlsx/xls/xlsm/docx/pdf/pptx/md/txt/csv); all DocumentFormat variants now have registered parsers
- [Phase 08-document-ir-document-read]: BOM stripping added to mdParser too (not just txtParser) — Windows Notepad saves .md with UTF-8 BOM by default, would silently pollute outline entries
- [Phase 08-document-ir-document-read]: fs_read hard-rejects office/pdf/pptx with [E_DOC_USE_DOCUMENT_READ] + paste-ready JSON template (mode=stats baseline); .doc gets dedicated [E_DOC_LEGACY_DOC_UNSUPPORTED] save-as-docx hint; csv stays readable with soft tip, md pass-through unchanged
- [Phase 08-document-ir-document-read]: Skill execution guidance leads with node-based structured tools (document.read / xlsx_extract / exec_command); py -3 demoted to last-resort bullet but buildWindowsPythonFallbackCommand preserved intact
- [Phase 08-document-ir-document-read]: tool-schemas fs_read + xlsx_extract descriptions steer to document_read; document_read description carries all 4 mode examples (stats/outline/read-with-locator/search) as numbered JSON fragments

### Pending Todos

None yet.

### Roadmap Evolution

- Phase 7 added: 个人助手 Soul / Identity / System Message 基础层
- Phase 8 added: 统一文档理解能力（Document IR + document.read 门面）

### Blockers/Concerns

- 需要在 Phase 4 规划前确认首批企业连接器优先级，按业务价值、鉴权可行性和数据语义排序。
- 需要明确 desktop 到 cloud 的身份透传与平台代理 token 边界。
- 需要在 Phase 5 规划前收敛首批值得做 A2UI 的 create/update 流程范围。

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260506-foh | 挂载 HubModule 到 cloud-api app.module.ts，并补全 hub item icon 端点，修复 cloud-web /hub 页面与 skills 详情下载链路 | 2026-05-06 | dac598c | [260506-foh-hubmodule-cloud-api-app-module-ts-hub-it](./quick/260506-foh-hubmodule-cloud-api-app-module-ts-hub-it/) |
| 260506-gdn | 收敛 desktop main 进程里的 .catch(() => {}) 错误吞噬，改为 logger.warn，保留容错不抛出但失败不再静默 | 2026-05-06 | a9e4cd6 | [260506-gdn-desktop-main-catch-logger-warn](./quick/260506-gdn-desktop-main-catch-logger-warn/) |
| 260506-ldw | 修复硅基员工对话 [模型调用失败] fetch failed：从 UI 到 fetch 全链路 6 层契约补齐（创建/会话/客户端断言/transport cause 透传/启动期回填/UI 强约束） | 2026-05-06 | 7f1d879 | [260506-ldw-fix-silicon-person-fetch-failed-enforce-](./quick/260506-ldw-fix-silicon-person-fetch-failed-enforce-/) |
| 260506-m4g | ChatPage UI 微调：投递痕迹卡片移入消息流并 5s 自动消失，用户消息整行 row-reverse 气泡靠右区分用户/AI | 2026-05-06 | 40ff367 | [260506-m4g-chatpage-ui-dispatch-trace-inline-user](./quick/260506-m4g-chatpage-ui-dispatch-trace-inline-user/) |
| 260506-mq5 | 修复硅基员工 SiliconRail 徽章不更新的 bug，并改用单点视觉提示替代数字计数 | 2026-05-06 | 92492dc | [260506-mq5-siliconrail-bug](./quick/260506-mq5-siliconrail-bug/) |

## Session Continuity

Last session: 2026-04-21T15:08:57.154Z
Stopped at: Completed 08-document-ir-document-read/08-09-PLAN.md (Phase 08 complete — all 9 plans done)
Resume file: None
