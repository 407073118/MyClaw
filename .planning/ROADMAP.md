# Roadmap: MyClaw

## Overview

本路线图聚焦既有 `desktop` 助手的 brownfield 优化，而不是扩展新产品线。phase 顺序按研究建议推进：先补运行时可观测性与评测基线，再收紧工具契约与策略边界，然后提升上下文理解，之后接入受治理的企业只读数据，最后才进入结构化 action surface 和更高级的 planner 能力。

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [ ] **Phase 1: Runtime Seams, Ledger & Eval Baseline** - 先让每次任务运行可追踪、可审计、可回放比较。
- [ ] **Phase 2: Tool Policy & Safe Execution** - 收紧工具暴露、审批与结构化契约，先把执行边界做对。
- [ ] **Phase 3: Context Pipeline & Role-Aware Understanding** - 用结构化上下文与意图路由提升理解质量与连续性。
- [ ] **Phase 4: Governed Enterprise Read Connectors** - 通过受控连接把高价值企业公共数据以只读方式接入 desktop。
- [ ] **Phase 5: Structured Action Surfaces** - 在已建立审批与治理基础上，引入受控企业写操作与结构化任务界面。
- [ ] **Phase 6: Advanced Planner Optimization** - 仅在前置能力稳定后，为复杂任务加入更强的规划、恢复与长时运行能力。

## Phase Details

### Phase 1: Runtime Seams, Ledger & Eval Baseline
**Goal**: 员工与管理员都可以看清一次任务是如何运行、为何成功或失败，并且团队能用统一基线衡量优化是否真的提升完成质量。
**Depends on**: Nothing (first phase)
**Requirements**: ASST-03, ASST-04, TOOL-02, GOV-02, GOV-03, GOV-04
**Success Criteria** (what must be TRUE):
  1. 员工可以在 desktop 中看到任务当前处于思考、调用工具、等待审批、完成或失败中的哪一种状态。
  2. 员工可以查看本次任务实际调用了哪些工具、每个工具的主要结果，以及任务为何成功或失败。
  3. 企业管理员可以按运行记录审计任务执行、工具调用、审批结果和关键执行轨迹。
  4. 团队可以回放同一批基准任务，并用统一指标比较不同优化前后的任务完成质量、工具选择质量和回答质量。
**Plans**: TBD
**UI hint**: yes

### Phase 2: Tool Policy & Safe Execution
**Goal**: 助手每次执行只拿到当前任务真正需要且被允许的能力，所有高风险操作都在清晰策略和审批边界内运行。
**Depends on**: Phase 1
**Requirements**: TOOL-01, TOOL-03, TOOL-04, GOV-01
**Success Criteria** (what must be TRUE):
  1. 对同一项任务，助手只能看到与当前任务相关且被允许的模型、工具、Skills、MCP 与企业连接能力集合。
  2. 对企业或本地数据有写入风险的操作，员工必须先看到审批、预览或显式确认后才能执行。
  3. 工具调用参数与结果会被结构化校验，错误会以明确的校验失败暴露出来，而不是静默错用工具或误读结果。
  4. 企业管理员可以统一管理 desktop 可用的模型、工具、Skills、MCP 与企业连接能力，而不需要逐端手工散落配置。
**Plans**: TBD

### Phase 3: Context Pipeline & Role-Aware Understanding
**Goal**: 助手能够先编译结构化上下文，再按角色、团队、项目和任务语境理解需求、提出必要澄清并持续保持同一任务上下文。
**Depends on**: Phase 2
**Requirements**: ASST-01, ASST-02, CTX-01, CTX-02, CTX-03, CTX-04
**Success Criteria** (what must be TRUE):
  1. 员工即使只输入自然、简短或不完整的需求，助手也能正确理解意图，或主动提出最少但关键的澄清问题。
  2. 在同一任务会话中，助手可以保持连续、一致的上下文理解，而不是每轮都要求员工重复背景。
  3. 助手可以结合员工角色、团队、项目和当前任务上下文来调整回答与执行策略，而不是给出角色无关的通用输出。
  4. 助手在执行前会清晰区分本地个人上下文与企业公共上下文，避免混淆数据边界和权限边界。
**Plans**: TBD

### Phase 4: Governed Enterprise Read Connectors
**Goal**: 员工可以在 desktop 中安全使用已授权的企业公共数据完成任务，且所有企业数据访问都走受治理的只读连接路径。
**Depends on**: Phase 3
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04
**Success Criteria** (what must be TRUE):
  1. 员工可以在 desktop 中访问已授权的企业公共数据，并把这些数据直接用于当前任务完成。
  2. 企业数据相关回答会保留来源依据、引用或可追溯线索，并遵守现有权限边界。
  3. 首批企业系统接入优先提供只读检索与查询能力，而不是直接开放写操作。
  4. desktop 对企业内部系统的数据访问全部经过受控连接与策略边界，而不是绕过治理层直连内部系统。
**Plans**: TBD

### Phase 5: Structured Action Surfaces
**Goal**: 对少量高价值企业写操作，引入审批优先、可追踪、可恢复的结构化任务界面，而不是继续依赖脆弱的纯文本执行。
**Depends on**: Phase 4
**Requirements**: ACTN-01, ACTN-02
**Success Criteria** (what must be TRUE):
  1. 员工可以通过结构化任务界面安全地发起选定企业系统写操作，而不是在长文本中手填复杂字段。
  2. 每一次企业写操作都能展示审批状态、执行预览和最终执行轨迹，员工可以清楚知道系统将要改什么以及实际改了什么。
  3. 企业写操作在重试、补偿和恢复场景下具备可预期行为，不会因重复提交造成不可控副作用。
**Plans**: TBD
**UI hint**: yes

### Phase 6: Advanced Planner Optimization
**Goal**: 对确实需要多步规划或长时运行的复杂任务，提供更强的规划、恢复和检查点能力，同时避免把重型编排引入所有普通对话。
**Depends on**: Phase 5
**Requirements**: PLAN-01, PLAN-02
**Success Criteria** (what must be TRUE):
  1. 助手可以针对复杂任务执行更强的多步规划与恢复策略，在中间步骤失败后继续推进或给出明确恢复路径。
  2. 对需要长时运行或检查点的任务，助手可以暂停、恢复并延续任务状态，而不是每次都从头开始。
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Runtime Seams, Ledger & Eval Baseline | 0/TBD | Not started | - |
| 2. Tool Policy & Safe Execution | 0/TBD | Not started | - |
| 3. Context Pipeline & Role-Aware Understanding | 0/TBD | Not started | - |
| 4. Governed Enterprise Read Connectors | 0/TBD | Not started | - |
| 5. Structured Action Surfaces | 0/TBD | Not started | - |
| 6. Advanced Planner Optimization | 0/TBD | Not started | - |
