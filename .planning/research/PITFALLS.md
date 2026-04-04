# Domain Pitfalls

**Domain:** 企业内部 AI 助手平台（brownfield desktop assistant 优化）
**Researched:** 2026-04-04
**Overall confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: 先放大自治，再补评测与可观测
**What goes wrong:** 团队先调 prompt、加 agent loop、加工具和连接器，再事后补评测、trace 与告警，结果是“看起来更聪明”，但复杂任务成功率、工具成功率和回归情况都不可证明。  
**Why it happens:** 既有产品已经在线，团队容易靠零散聊天记录和个别 demo 判断改进有效，而不是先定义任务基线。  
**Consequences:** 回归无法及时发现；同一问题在不同用户、不同角色、不同工具组合下反复出现；后续所有自治优化都失去可信度。  
**Warning signs:**  
- 每次改 prompt 或工具描述后，只看主观体验，不跑固定任务集。  
- 没有按工具、任务类型、用户角色拆分的成功率、失败率、重试率。  
- 线上只看到最终回答，看不到中间工具选择、参数、错误、耗时。  
- 当前仓库已出现这类信号：未发现统一错误追踪；`desktop` 中多处失败被吞成空对象或空列表。  
**Prevention:**  
- 先建“任务金集”与“失败样本集”，覆盖短输入、长输入、模糊输入、跨系统任务、写操作审批任务。  
- 对每次会话记录结构化 trace：用户意图分类、选中工具、参数、返回码、重试、最终结果。  
- 建立最小回归门禁：上线前至少跑固定离线评测 + 若干真实 transcript 回放。  
- 工具层和连接层的错误必须显式上报，不能在 preload/store 层归一成“空结果”。  
**Which phase should address it:** Phase 1 - 评测与可观测基线。先做，否则后续 phase 的收益都不可验证。  
**Confidence:** HIGH

### Pitfall 2: 把“更自主”误做成“更多 agent / 更长循环 / 更复杂编排”
**What goes wrong:** 为了追求自治，过早把一个原本可由单 agent + 明确 workflow 解决的问题，拆成 planner / executor / reviewer / router 等多 agent 体系。  
**Why it happens:** 团队把“多 agent”当成熟度象征，而不是把它当有代价的架构选择。  
**Consequences:** 延迟、成本、状态同步复杂度、调试复杂度一起上升；问题从“模型答不好”变成“分布式系统不好查”。  
**Warning signs:**  
- 角色分工一开始就映射成多个 agent，而不是先用单 agent 验证。  
- agent 之间手工串联 prompt 与上下文，缺少明确 workflow 或状态机。  
- 多个 agent 反复加载相似上下文和相同工具集。  
- 团队解释失败时，越来越多归因于“handoff”“路由”“状态丢失”。  
**Prevention:**  
- 默认从单 agent + 明确 workflow 开始，只在跨安全边界、跨团队边界、职责隔离明确要求时再拆分。  
- 先证明单 agent 在现有工具和上下文治理下达不到目标，再引入多 agent。  
- 若必须拆分，先定义状态交换协议、失败恢复、审批边界和 tracing，再上生产。  
**Which phase should address it:** Phase 2 - 自治策略收敛与执行模型设计。  
**Confidence:** HIGH

### Pitfall 3: 工具面暴露过大，契约却仍然松散
**What goes wrong:** 平台把大量工具、连接器、伪完成流程一次性暴露给模型，但工具命名重叠、描述模糊、参数约束弱、错误语义不清。模型于是频繁选错工具、填错参数、重复调用，或被“假成功”误导。  
**Why it happens:** 团队把“工具数量更多”误当成“能力更强”，忽略了 agent 先要会选、会配、会停。  
**Consequences:** 工具调用成功率低；无效重试增多；模型对工具失去信心后退回纯文本回答；用户误以为系统“能连但不好用”。  
**Warning signs:**  
- 工具名和描述没有写清“什么时候用 / 什么时候不要用”。  
- 同类工具边界重叠，例如多个查询工具都像“search”或“get data”。  
- 参数大量使用自由文本，缺少 enum、schema 或必填校验。  
- 当前仓库已有对应信号：workflow IPC 和 publish draft 仍有 stub；preload 会把失败吞成 `null`、`[]` 或空对象。  
- 工具调用日志中经常出现无效参数、错误路由、重复调用。  
**Prevention:**  
- 做工具目录治理：按领域分 namespace，减少同义工具并存。  
- 每个工具描述都写成动作导向，明确“Use this when...”与禁用场景；参数补齐说明、枚举和示例。  
- 每次请求只暴露当前允许子集，不把全量工具都塞进上下文。  
- 输出侧强校验；输入侧做 schema 验证；失败返回 typed error，而不是 silent fallback。  
- 不把 stub 功能伪装成可用能力，未完成路径要么隐藏，要么显式标记 preview/unsupported。  
**Which phase should address it:** Phase 3 - 工具目录治理与契约硬化。  
**Confidence:** HIGH

### Pitfall 4: 把上下文工程做成“大提示词拼接”，而不是上下文管线
**What goes wrong:** 团队把角色信息、系统规则、企业知识、历史对话、用户输入、工具回显全部粗暴拼在一个 prompt 里，指望模型自己分层理解。上下文一长，质量反而下降。  
**Why it happens:** “上下文更多”很容易被误解成“效果更好”，尤其在 brownfield 项目里，团队常通过不断追加指令去补漏洞。  
**Consequences:** 用户角色识别不稳；长输入任务掉点严重；模型忽略最新信息或把旧约束当新约束；跨文档回答缺少依据。  
**Warning signs:**  
- System prompt 持续膨胀，谁都不敢删。  
- 加了更多背景后，复杂任务反而更不稳定。  
- 用户职业角色、部门、权限、工作语境只作为散文描述存在，没有结构化字段。  
- 回答看似全面，但无法指出依据来自哪个系统、哪段内容、哪个时间点。  
**Prevention:**  
- 把上下文拆成明确层次：系统规则、用户画像、任务状态、企业知识、工具状态、审批状态。  
- 长文档放前面，查询和具体指令放后面；多文档和元数据用结构化标签包裹。  
- 对高噪声知识任务采用“先引用、再回答”的 grounding 策略。  
- 用户职业角色、组织信息、权限边界、近期任务上下文必须结构化，而不是只写进 prompt 散文。  
- 建 compaction / summary / retrieval 策略，避免无限堆历史。  
**Which phase should address it:** Phase 4 - 上下文管线、用户画像与 grounding 机制。  
**Confidence:** HIGH

### Pitfall 5: 连接企业内部系统时，不区分静态知识、实时查询和写操作
**What goes wrong:** 团队把所有企业数据都当成一个“能接上就行”的连接问题，要么全丢进检索索引，要么全做 MCP/API 直连。结果静态制度、实时状态、事务写入混在一起，正确性和治理都失真。  
**Why it happens:** 在 brownfield 环境里，连接器建设常由平台侧统一推进，容易按接入便利性而不是按数据语义做方案。  
**Consequences:** 本应查实时系统的问题却回答成陈旧索引；本应用检索的制度说明却被频繁打实时接口；读写权限边界含混，审计也难落。  
**Warning signs:**  
- 团队无法明确回答“这个领域应该走 search、API，还是两者结合”。  
- 同一用户问题在不同时间得到相互冲突的答案，但没人知道是索引旧了还是接口变了。  
- 所有内部系统接入都走同一种技术路径，没有领域分类矩阵。  
- 当前项目目标已明确要减少数据孤岛，但还没有形成按数据域划分的检索/操作策略。  
**Prevention:**  
- 为每个数据域写 retrieval decision record：权威源、更新频率、访问方式、是否允许写、审计要求。  
- 静态政策/说明/知识默认走检索；实时状态与事务动作默认走 MCP/API；需要时再做混合。  
- 优先复用带身份、审计、治理能力的现成检索或连接能力；只有治理不满足时才做自定义连接。  
- 在产品与工程层明确区分“回答问题”和“代表用户执行动作”两类能力。  
**Which phase should address it:** Phase 5 - 企业数据接入策略与领域分层。  
**Confidence:** HIGH

### Pitfall 6: 误以为“信任内部系统/连接器”就足够安全，忽略跨系统 prompt injection
**What goes wrong:** 平台把邮件、IM、工单、网页、知识库、内部系统都接进来后，默认认为“内部内容可信”或“连接器是自己写的就安全”。实际上任一可写入源都可能把恶意指令带进 agent，再借别的高权限工具完成数据外泄或错误操作。  
**Why it happens:** 企业项目往往先考虑认证和网络边界，低估了内容层攻击会跨工具传播。  
**Consequences:** 敏感数据被跨系统带出；只读任务被诱导成写操作；模型在不同连接器之间形成意外的数据桥。  
**Warning signs:**  
- 邮件、工单、网页正文、知识文档直接进入模型可执行上下文，没有信任分级。  
- 工具参数里包含与业务无关的大段会话摘要、用户隐私字段或额外上下文。  
- 写操作审批只确认“要不要执行”，不确认“将写出什么内容”。  
- 设计上默认“只要信任 MCP 作者就可以接入”。  
**Prevention:**  
- 建立内容信任分层：用户输入、内部协作内容、外部网页、第三方连接器内容分别标记。  
- 高敏工具与可外发工具默认隔离，不允许任意组合。  
- 所有写操作都要展示目标系统、目标对象、即将发送的关键字段，并支持用户拒绝。  
- 连接器最小暴露参数，避免把整段对话和隐私字段无差别转给工具。  
- 对来自不可信内容的指令做降权或剥离，禁止其直接驱动高权限动作。  
**Which phase should address it:** Phase 6 - 连接器安全、提示注入防护与审批边界。  
**Confidence:** HIGH

### Pitfall 7: 权限模型还是“平台管理员视角”，不是“用户/任务最小权限”
**What goes wrong:** 为了快接系统，团队常使用共享服务账号、长期 token、粗粒度读写权限，把“平台能调通”误当成“用户可安全使用”。  
**Why it happens:** 内部系统接入初期，平台团队最容易拿到的是管理员级凭证，而不是细粒度的用户身份透传。  
**Consequences:** 一旦模型选错工具或被注入攻击，影响范围过大；审计无法明确到“是谁通过哪个工具做了什么”；用户对平台不再信任。  
**Warning signs:**  
- 一个 token 同时覆盖多个系统或多个高敏动作。  
- 读和写共用同一凭证或同一工具。  
- 本地或浏览器侧长期保存高价值 token。  
- 审计日志只能看到“assistant 调用了接口”，看不到具体用户、会话、审批链。  
**Prevention:**  
- 每个工具调用都要求鉴权，优先做用户身份透传；确需平台代理时，也要按工具和动作拆最小权限。  
- token 短生命周期、支持轮换，客户端安全存储，禁止在日志中落敏感凭证。  
- RBAC 按“用户-工具-动作-数据域”四元组设计，不按系统整体授权。  
- 高风险动作采用二次确认或双通道审批。  
- 审计最少记录到：用户、会话、工具、参数摘要、目标系统、结果。  
**Which phase should address it:** Phase 6 - 连接器安全、身份透传与审计。  
**Confidence:** HIGH

### Pitfall 8: 用“空结果”掩盖真实失败，导致模型和用户一起被误导
**What goes wrong:** 连接失败、权限失败、参数失败、超时失败被统一吞成 `null`、空数组、默认对象或占位成功响应。模型会把它当成“没有数据”或“工具成功但无结果”，继续错误推理。  
**Why it happens:** 现有桌面应用为了避免 UI 崩溃，常在 preload、store 或 IPC 层做 catch-and-continue。  
**Consequences:** 错误被伪装成业务事实；模型持续做错误后续动作；用户更难分清“系统没查到”还是“系统查失败”。  
**Warning signs:**  
- UI 常见“暂无数据”，但实际是接口异常或权限异常。  
- 模型在失败后不自知，继续基于空结果生成确定性回答。  
- 当前仓库已有明显信号：preload 对 contract-bearing 方法存在 blanket fallback；多个 IPC 路径仍返回 placeholder/stub payload。  
**Prevention:**  
- 定义统一错误分类：认证失败、权限失败、参数失败、超时、依赖不可用、部分成功。  
- 错误必须回传给模型和 UI，让模型决定重试、降级还是请求用户澄清。  
- 对读操作与写操作分别设计 retry 策略和幂等键。  
- 占位流程不进入正式工具面；失败和“确实无数据”必须是不同 contract。  
**Which phase should address it:** Phase 3 - 工具契约硬化；并在 Phase 7 - 运行时可靠性中补足端到端恢复策略。  
**Confidence:** HIGH

## Moderate Pitfalls

### Pitfall 1: 把浏览器/桌面自动化直接接入生产动作，却没有隔离执行环境
**What goes wrong:** 团队把 browser/computer-use 能力当成“万能补洞器”，直接用于高价值流程，但缺少隔离浏览器、隔离会话或人工复核。  
**Warning signs:**  
- 自动化工具和普通查询工具混在同一层审批里。  
- 同一浏览器上下文承载多个用户或多个任务。  
- 自动化动作失败后继续重试，却没有显式回滚或人工接管。  
**Prevention:**  
- 自动化执行放在隔离浏览器或隔离 VM。  
- 高影响动作保留人工确认。  
- 为 UI 自动化单独建超时、截屏、回放和终止机制。  
**Which phase should address it:** Phase 7 - 执行沙箱、浏览器隔离与高风险动作控制。  
**Confidence:** HIGH

### Pitfall 2: 现有运行时集中化过度，导致自治能力一扩就相互干扰
**What goes wrong:** 聊天循环、工具编排、审批、浏览器生命周期、事件广播都堆在一个主进程或少量超大模块里，初期能跑，后期一加自治和并发就互相污染。  
**Warning signs:**  
- 一个长任务会拖慢其他会话。  
- 工具取消、浏览器断开、审批等待互相影响。  
- 大文件承担过多职责，改动一个点容易牵动整条执行链。  
- 当前仓库已有强烈信号：`desktop` 主进程里会话 orchestration、tool orchestration 和 browser lifecycle 明显集中。  
**Prevention:**  
- 会话执行、工具执行、浏览器自动化、事件广播分成独立服务或 worker。  
- 做 per-session resource budget、排队与 backpressure。  
- 自动化能力按任务或会话隔离浏览器实例。  
**Which phase should address it:** Phase 7 - 运行时隔离、调度与可靠性改造。  
**Confidence:** MEDIUM

### Pitfall 3: 把“理解用户”只做成 prompt 修辞，不接入真实职业语境
**What goes wrong:** 平台声称“更懂用户”，但实现上只是加几句“你要站在用户角度思考”的提示，没有岗位、部门、权限、常用系统、任务模板等真实上下文。  
**Warning signs:**  
- 同一问题对不同岗位返回内容几乎相同。  
- 模型建议用户去做其无权限或无职责的操作。  
- 用户角色变化只体现在 UI，不进入模型上下文或工具权限。  
**Prevention:**  
- 建立结构化职业画像与任务画像，并进入上下文与工具 gating。  
- 评测时按岗位分层看结果，而不是只看总体平均。  
**Which phase should address it:** Phase 4 - 用户画像与上下文管线。  
**Confidence:** HIGH

## Minor Pitfalls

### Pitfall 1: 连接决策不留书面记录，导致后续治理与排障越来越靠口口相传
**What goes wrong:** 哪些数据域走检索、哪些走 API、哪些允许写、哪些必须审批，没有形成文档化 decision record。  
**Prevention:** 在每个数据域接入时同步记录权威源、权限模型、审计要求、失败降级策略。  
**Which phase should address it:** Phase 5 - 企业数据接入策略；作为每个连接器 phase 的交付物强制产出。  
**Confidence:** HIGH

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Phase 1 - 评测与可观测基线 | 先做能力增强，后补测量 | 先定义金集、trace、工具成功率和回归门禁，再改 prompt/tool |
| Phase 2 - 自治策略收敛 | 过早拆多 agent、过长 loop | 先跑单 agent baseline，仅在安全/组织边界明确时拆分 |
| Phase 3 - 工具目录治理与契约硬化 | 工具暴露过大、stub 伪装完成、错误被吞 | 做工具目录、allowed subset、typed error、隐藏未完成路径 |
| Phase 4 - 上下文管线与用户画像 | 大 prompt 拼接、角色信息不结构化 | 拆上下文层次、结构化角色字段、grounding 与 compaction |
| Phase 5 - 企业数据接入策略 | 不区分检索、实时查询、写操作 | 为每个数据域写 retrieval decision record，并按语义选方案 |
| Phase 6 - 连接器安全与审批 | 忽略 prompt injection、权限过大、审计缺失 | 最小权限、用户身份透传、写操作审批、内容信任分层 |
| Phase 7 - 运行时隔离与可靠性 | 主进程集中化、自动化环境不隔离 | 分离 worker、会话资源配额、隔离浏览器/VM、完善恢复策略 |

## Sources

- `.planning/PROJECT.md` - 项目目标、范围与 brownfield 约束。`HIGH`
- `.planning/codebase/CONCERNS.md` - 当前代码库中的 stub、silent fallback、主进程集中化与测试缺口。`HIGH`
- `.planning/codebase/INTEGRATIONS.md` - 当前外部系统、认证、MCP、模型和存储接入面。`HIGH`
- OpenAI, “Using GPT-5.4” (developers.openai.com/api/docs/guides/latest-model) - `tool_search`、`allowed_tools`、自定义工具约束、computer use 隔离与人工确认建议。`HIGH`
- OpenAI, “ChatGPT Developer mode” (developers.openai.com/api/docs/guides/developer-mode) - 工具描述需写清使用场景、边界和参数说明。`HIGH`
- OpenAI, “MCP and Connectors” (developers.openai.com/api/docs/mcp) - prompt injection、写操作确认、仅连接可信服务器等风险说明。`HIGH`
- Anthropic, “Writing effective tools for AI agents” (anthropic.com/engineering/writing-tools-for-agents) - 工具度量、描述优化、减少工具面与自然任务切分。`HIGH`
- Anthropic, “Prompting best practices / Long context prompting” (platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices#long-context-prompting) - 长上下文结构化、文档排序、引用式 grounding。`HIGH`
- Microsoft Learn, “Choosing Between Building a Single-Agent System or Multi-Agent System” (learn.microsoft.com/en-us/azure/cloud-adoption-framework/ai-agents/single-agent-multiple-agents) - 默认先验证单 agent，只有明确边界时才拆多 agent。`HIGH`
- Microsoft Learn, “Data architecture for AI agents” (learn.microsoft.com/en-us/azure/cloud-adoption-framework/ai-agents/data-architecture-plan, updated 2026-03-10) - 检索/实时动作分层、治理优先、MCP 身份与审计要求。`HIGH`
- Model Context Protocol, “Tools” (modelcontextprotocol.io/specification/2025-06-18/server/tools) - human in the loop、工具暴露透明度与确认要求。`HIGH`
- Model Context Protocol, “Authorization” (modelcontextprotocol.io/specification/2025-03-26/basic/authorization) - OAuth 2.1、PKCE、token rotation 与有限生命周期要求。`HIGH`
