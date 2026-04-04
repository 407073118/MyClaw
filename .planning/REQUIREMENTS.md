# Requirements: MyClaw

**Defined:** 2026-04-04
**Core Value:** 让企业员工在个人桌面端获得一个真正会理解工作语境、会使用工具、会调动企业内部数据来完成任务的 AI 助手。

## v1 Requirements

### Assistant Quality

- [ ] **ASST-01**: 员工可以用自然、简短或不完整的语言描述工作需求，助手能够正确理解意图或主动发起澄清
- [ ] **ASST-02**: 员工在同一任务会话中可以获得连续、一致的上下文理解，而不是每轮都需要重复背景
- [ ] **ASST-03**: 员工可以看到任务当前处于思考、调用工具、等待审批、完成或失败中的哪一种状态
- [ ] **ASST-04**: 员工在任务失败时可以获得可理解的失败原因和下一步建议，而不是静默失败或空结果

### Tool Use

- [ ] **TOOL-01**: 助手在一次任务中只能看到与当前任务相关且被允许的工具集合，避免无关工具干扰选择
- [ ] **TOOL-02**: 员工可以看到助手实际调用了哪些工具、每个工具的主要结果，以及任务为何成功或失败
- [ ] **TOOL-03**: 对企业或本地数据有写入风险的工具操作必须经过审批、预览或显式确认后才能执行
- [ ] **TOOL-04**: 工具调用参数和结果必须结构化校验，避免因弱契约导致选错工具、参数错误或结果误读

### Context Understanding

- [ ] **CTX-01**: 助手可以结合员工角色、团队、项目和当前任务上下文来调整回答与执行策略
- [ ] **CTX-02**: 助手可以在任务开始前编译结构化上下文，而不是把所有信息拼成一个无限增长的大提示词
- [ ] **CTX-03**: 当上下文不足以安全执行任务时，助手必须提出最少但关键的澄清问题
- [ ] **CTX-04**: 助手必须清晰区分本地个人上下文与企业公共上下文，避免混淆数据边界

### Enterprise Data

- [ ] **DATA-01**: 员工可以在 desktop 中访问已授权的企业公共数据，并将其用于任务完成
- [ ] **DATA-02**: 企业数据回答必须保留来源依据、引用或可追溯线索，并遵守现有权限边界
- [ ] **DATA-03**: 企业系统接入必须优先支持只读检索与查询场景，再逐步扩展到受控写操作
- [ ] **DATA-04**: desktop 不直接绕过治理层访问企业内部系统，而是通过受控连接与策略边界完成能力调用

### Governance And Evaluation

- [ ] **GOV-01**: 企业管理员可以统一管理 desktop 可用的模型、工具、Skills、MCP 与企业连接能力
- [ ] **GOV-02**: 企业管理员可以审计任务运行、工具调用、审批结果和关键执行轨迹
- [ ] **GOV-03**: 团队可以对任务完成质量、工具选择质量和回答质量建立可回放、可比较的评测基线
- [ ] **GOV-04**: 任何提升模型“更会做事”的优化都必须能通过指标、回放或评测证明，而不是仅靠主观感觉

## v2 Requirements

### Enterprise Actions

- **ACTN-01**: 员工可以通过结构化任务界面安全地发起企业系统写操作
- **ACTN-02**: 企业写操作支持幂等、补偿和重试策略

### Advanced Orchestration

- **PLAN-01**: 助手可以针对复杂任务执行更强的多步规划与恢复策略
- **PLAN-02**: 助手可以在长时运行或检查点场景中使用更高级的编排机制

### Expansion

- **EXPD-01**: 企业可以扩展更多公共数据连接器与知识源
- **EXPD-02**: workflow、硅基员工与知识库形成成熟产品化能力

## Out of Scope

| Feature | Reason |
|---------|--------|
| 大规模新增独立产品线 | 当前阶段目标是优化既有 desktop 助手能力，而不是扩张产品边界 |
| 无审批的高风险自动写操作 | 企业环境下信任和治理优先，不能用“更自主”替代控制边界 |
| 无边界的全局企业记忆 | 容易造成权限泄漏、上下文污染与数据边界失真 |
| 仅靠增加工具数量提升能力 | 当前真正缺的是任务完成质量、工具选择质量与上下文质量 |
| 把未成熟 workflow / publish / enterprise action 能力直接产品化 | 需要先补执行契约、审计、审批与稳定性基础 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ASST-01 | Phase 3 | Pending |
| ASST-02 | Phase 3 | Pending |
| ASST-03 | Phase 1 | Pending |
| ASST-04 | Phase 1 | Pending |
| TOOL-01 | Phase 2 | Pending |
| TOOL-02 | Phase 1 | Pending |
| TOOL-03 | Phase 2 | Pending |
| TOOL-04 | Phase 2 | Pending |
| CTX-01 | Phase 3 | Pending |
| CTX-02 | Phase 3 | Pending |
| CTX-03 | Phase 3 | Pending |
| CTX-04 | Phase 3 | Pending |
| DATA-01 | Phase 4 | Pending |
| DATA-02 | Phase 4 | Pending |
| DATA-03 | Phase 4 | Pending |
| DATA-04 | Phase 4 | Pending |
| GOV-01 | Phase 2 | Pending |
| GOV-02 | Phase 1 | Pending |
| GOV-03 | Phase 1 | Pending |
| GOV-04 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-04*
*Last updated: 2026-04-04 after roadmap creation*
