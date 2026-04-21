---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 08-document-ir-document-read/08-08-PLAN.md
last_updated: "2026-04-21T14:55:56.025Z"
last_activity: 2026-04-21
progress:
  total_phases: 8
  completed_phases: 0
  total_plans: 9
  completed_plans: 8
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-04)

**Core value:** 让企业员工在个人桌面端获得一个真正会理解工作语境、会使用工具、会调动企业内部数据来完成任务的 AI 助手。
**Current focus:** Phase 08 — document-ir-document-read

## Current Position

Phase: 08 (document-ir-document-read) — EXECUTING
Plan: 8 of 9
Status: Ready to execute
Last activity: 2026-04-21

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

### Pending Todos

None yet.

### Roadmap Evolution

- Phase 7 added: 个人助手 Soul / Identity / System Message 基础层
- Phase 8 added: 统一文档理解能力（Document IR + document.read 门面）

### Blockers/Concerns

- 需要在 Phase 4 规划前确认首批企业连接器优先级，按业务价值、鉴权可行性和数据语义排序。
- 需要明确 desktop 到 cloud 的身份透传与平台代理 token 边界。
- 需要在 Phase 5 规划前收敛首批值得做 A2UI 的 create/update 流程范围。

## Session Continuity

Last session: 2026-04-21T14:55:56.009Z
Stopped at: Completed 08-document-ir-document-read/08-08-PLAN.md
Resume file: None
