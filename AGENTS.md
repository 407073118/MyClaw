# AGENTS.md

本文件是仓库根层的机器入口。根层只负责三件事：声明硬规则、给出阅读顺序、把 Agent 导航到正确的文档与子项目。

## 作用范围

- 默认作用于整个仓库。
- 如果子目录存在更深层的 `AGENTS.md`，则以更深层文件为准。

## 先读什么

1. 先读本文件，确认全仓库硬规则。
2. 再读：
   - `docs/agents/context-engineering.md`
   - `docs/agents/harness-rules.md`
   按任务类型决定继续看哪些文档。
3. 涉及仓库结构与业务边界时，读：
   - `docs/architecture/overview.md`
   - `docs/architecture/domain-boundaries.md`
   - `docs/architecture/layering-constraints.md`
4. 涉及流程与交付时，读：
   - `docs/processes/code-review-checklist.md`
   - `docs/processes/release-process.md`
   - `docs/processes/incident-response.md`
5. 进入 `desktop/` 或 `cloud/` 后，优先切到对应目录下最近一层 `AGENTS.md`，不要停留在根层做深度实现。

## 基本原则

- 只做与当前任务相关的最小改动。
- 优先复用现有架构与约定，不随意重构。
- 不引入隐式行为和不透明逻辑。
- 如果目标文件本身存在编码异常，先确认再大范围修改。

## 编码规范（硬性要求）

- 所有文本、代码、配置、文档文件必须使用 `UTF-8` 保存。
- 禁止使用 `ANSI`、`GBK`、`GB2312` 或混合编码。
- 保持文件原有换行风格，非必要不要批量改行尾。
- 严禁提交中文乱码。
- 所有方法必须写中文注释。
- 方法需要包含中文日志，日志必须全面。

## 中文编辑安全规则

编辑包含中文的文件时，必须遵循：

1. 修改前先读取目标行并确认可读。
2. 仅修改必要行，避免整文件重写。
3. 修改后重新打开文件，人工检查中文是否正常。
4. 发现任何乱码，必须先修复再结束任务。

## 乱码门禁（必须执行）

在声称任务完成前，对本次修改文件执行乱码检查。

常见异常包括：

- replacement character
- 典型乱码前缀
- HTML 标记残缺

推荐快速检查命令：

```powershell
$pattern = ([string][char]0xFFFD) + "|" + ([string][char]0x951F) + "|" + ([string][char]0x00C3) + "|" + ([string][char]0x00D0) + "|\\?/h[1-6]>"
rg -n $pattern apps packages docs *.md
```

## 代码修改规则

- 小改动不要重写整文件。
- 非必要不改动无关注释。
- 除非明确要求，不修改既有 API、字段名与语义。
- 如果改了协议或契约，必须同步更新类型、runtime、UI、测试。

## 结构化 UI 规则（A2UI）

- 表单类交互优先使用结构化 UI，而不是纯文本伪表单。
- 不要让用户在长文本中手填复杂字段。
- 扩展结构化协议时保持向后兼容。

## Subagents 约定

- 开发前先识别是否可以按目录或子系统拆分并行。
- 多个 Agent 并行时，必须为每个 Agent 指定明确写入范围。
- 合并前由主 Agent 统一复核文档链接、编码、乱码门禁和验证结果。




