---
quick_id: 260508-ghf
description: B 层 typed composer + 频率友好化 + 编辑按钮（定时任务大改）
date: 2026-05-08
mode: quick
must_haves:
  truths:
    - "typecheck 全绿（修掉 preexisting WorkflowDefinitionSummary 未导出）"
    - "ComposerModal 进入 job 时先显 3 张 typed 卡（Prompt / Workflow / 员工），点击后才进入对应表单；可返回上一步换 type"
    - "ScheduleJobEditor 按 type 渲染不同字段：Prompt 显示提示词 textarea、Workflow 显示工作流下拉（state.workflows）、员工显示员工下拉（state.siliconPersons）+派发消息 textarea"
    - "频率字段全部走 FrequencyPicker（8 种预设 + 自定义 cron 兜底），不再让用户写 raw cron"
    - "FrequencyPicker 双向兼容：编辑模式从已存 ScheduleJob 反解回 preset；非标准 cron 兜底回 custom-cron"
    - "ScheduleJobListPage：用 formatFrequency 替换 Cron 文本展示，行内加 type chip（独立色），actions 加 ✏️ 编辑（非 type filter 顶部 chip 组）"
    - "编辑按钮打开 ScheduleJobEditor 预填，提交走 update；新建走 create；composer 关闭/切换 type 时表单状态正确重置"
  artifacts:
    - desktop/shared/contracts/workflow.ts
    - desktop/src/renderer/utils/frequency.ts
    - desktop/src/renderer/components/time/FrequencyPicker.tsx
    - desktop/src/renderer/components/time/ScheduleJobEditor.tsx
    - desktop/src/renderer/pages/TimeCenterPage.tsx
  key_links:
    - desktop/shared/contracts/time-orchestration.ts:53 # ScheduleJobExecutor
    - desktop/shared/contracts/workflow.ts:67           # WorkflowSummary（要 alias 出 WorkflowDefinitionSummary）
    - desktop/src/renderer/stores/workspace.ts:193      # workflows: WorkflowDefinitionSummary[]
    - desktop/src/renderer/pages/TimeCenterPage.tsx:1012 # ComposerModal
    - desktop/src/main/services/time-job-executor.ts    # 各 type 后端语义
---

# Quick 260508-ghf — Plan

## 目标
把"定时任务"做成桌面级可用：让非开发者能新建/编辑、按 type 分入口、按 type 在列表里被识别、频率有人话表达。

## Tasks

### Task 1 — 修 preexisting `WorkflowDefinitionSummary` 导出

**files:** `desktop/shared/contracts/workflow.ts`

**action:** 在 `WorkflowSummary` 定义后追加：
```ts
/** 与 WorkflowSummary 同形，向 renderer 工作区 store 暴露的列表项类型别名。 */
export type WorkflowDefinitionSummary = WorkflowSummary;
```
仅 alias，不改任何字段；解决 `desktop/src/renderer/stores/workspace.ts:31` 的 TS2724 报错。

**verify:** `cd desktop && pnpm run typecheck` 不再报 WorkflowDefinitionSummary。

---

### Task 2 — 新建 `desktop/src/renderer/utils/frequency.ts`

**files:** `desktop/src/renderer/utils/frequency.ts` (new)

**FrequencyValue 类型：**
```ts
export type FrequencyValue =
  | { kind: "once"; startsAt: string }                                       // datetime ISO
  | { kind: "every-day"; time: string }                                      // "HH:mm"
  | { kind: "weekdays"; time: string }                                       // 周一~五
  | { kind: "weekends"; time: string }                                       // 周六~日
  | { kind: "weekly"; weekdays: number[]; time: string }                     // 1=周一..7=周日（多选）
  | { kind: "monthly"; day: number; time: string }                           // 1..31
  | { kind: "interval-minutes"; minutes: number }                            // 5..1440
  | { kind: "interval-hours"; hours: number }                                // 1..24
  | { kind: "custom-cron"; expression: string };                             // 兜底
```

**导出三个工具：**

1. `frequencyToScheduleInput(value: FrequencyValue, timezone: string): { scheduleKind, startsAt?, intervalMinutes?, cronExpression? }`
   - once → `{ scheduleKind: "once", startsAt }`
   - every-day `HH:mm` → `{ scheduleKind: "cron", cronExpression: "M H * * *" }`
   - weekdays → `"M H * * 1-5"`
   - weekends → `"M H * * 0,6"`
   - weekly weekdays=[1,3,5] time="09:00" → `"0 9 * * 1,3,5"`（按升序排）
   - monthly day=15 time="09:00" → `"0 9 15 * *"`
   - interval-minutes → `{ scheduleKind: "interval", intervalMinutes }`
   - interval-hours h → `{ scheduleKind: "interval", intervalMinutes: h*60 }`
   - custom-cron → `{ scheduleKind: "cron", cronExpression }`

2. `parseFrequency(job: ScheduleJob): FrequencyValue`
   - `once` + `startsAt` → once
   - `interval` + `intervalMinutes` 整除 60 且 ≤ 24h → interval-hours，否则 interval-minutes
   - `cron`：用 6 个 regex 依序尝试匹配 every-day/weekdays/weekends/weekly/monthly，全失败 → custom-cron
     - everyday: `^(\d{1,2}) (\d{1,2}) \* \* \*$` → time `HH:mm`
     - weekdays: `^(\d{1,2}) (\d{1,2}) \* \* 1-5$`
     - weekends: `^(\d{1,2}) (\d{1,2}) \* \* (?:0,6|6,0|0|6,7|6,0)$`（保险点放宽两种写法，主用 `0,6`）
     - weekly：`^(\d{1,2}) (\d{1,2}) \* \* ([\d,]+)$` 其中 day list 1-7
     - monthly：`^(\d{1,2}) (\d{1,2}) (\d{1,2}) \* \*$`

3. `formatFrequency(value: FrequencyValue): string` — 中文人话
   - once → `2026-05-08 11:06`（按 timezone 取，调用方传，避免本地时区跳）。**实际上 once 的 ISO 是 UTC，格式化要时区**——为简化，不在 utility 内做 timezone 转换，由调用方传 already-formatted；改签名为：
     - `formatFrequency(value: FrequencyValue, opts: { formatDateTime: (iso: string) => string }): string`
   - every-day "09:00" → `每天 09:00`
   - weekdays "09:00" → `工作日 09:00`
   - weekends "09:00" → `周末 09:00`
   - weekly weekdays=[1,3,5] time="09:00" → `每周一三五 09:00`
   - monthly day=15 time="09:00" → `每月 15 号 09:00`
   - interval-minutes 30 → `每 30 分钟`
   - interval-hours 4 → `每 4 小时`
   - custom-cron → `Cron: ${expression}`

4. `formatJobFrequency(job: ScheduleJob, formatDateTime): string` —— 包装：`formatFrequency(parseFrequency(job), { formatDateTime })`

**Edge cases：**
- 输入 frequency 时 weekday 数组为空：fallback 到 `every-day`
- interval-minutes < 5 → clamp 5；> 1440 → clamp 1440
- monthly day < 1 → 1；> 31 → 31

**verify:** typecheck 通过；用一组样本 cron 手测往返 `parse → format → frequencyToScheduleInput → cronExpression` 与原始一致。

---

### Task 3 — 新建 `desktop/src/renderer/components/time/FrequencyPicker.tsx`

**files:** `desktop/src/renderer/components/time/FrequencyPicker.tsx` (new)

**Props：**
```ts
type Props = {
  value: FrequencyValue;
  onChange: (next: FrequencyValue) => void;
  timezone: string;
};
```

**UI 结构（受控）：**
```
[ 频率 ]
   ○ 一次性 ○ 每天 ○ 工作日 ○ 周末 ○ 每周指定 ○ 每月 ○ 每 N 分钟 ○ 每 N 小时 ○ 自定义
   
   ─ 详情区（按选中 kind 切换） ─
   一次性     [datetime-local picker]
   每天       [time picker HH:mm]
   工作日     [time picker]
   周末       [time picker]
   每周指定   [□一 □二 □三 □四 □五 □六 □日] [time picker]
   每月       [日期 1-31 select] [time picker]
   每 N 分钟  [number 5-1440 step 5]
   每 N 小时  [number 1-24]
   自定义     [text input cron]
   
   预览：[formatFrequency(value)]
```

九个 radio chip 用 `.frequency-picker__chip` 类，单行排开（必要时 wrap）。详情区紧贴 chips，使用 `--bg-surface` 浅底卡。

**实现细节：**
- 状态由 props.value 完全受控；切换 kind 时构造 sane default 后 onChange：
  - `once` 默认 `startsAt: now+1h`
  - `every-day/weekdays/weekends` 默认 `time: "09:00"`
  - `weekly` 默认 `weekdays: [1], time: "09:00"`
  - `monthly` 默认 `day: 1, time: "09:00"`
  - `interval-minutes` 默认 `minutes: 30`
  - `interval-hours` 默认 `hours: 4`
  - `custom-cron` 默认 `expression: "0 9 * * 1-5"`
- `<input type="time">` 接 `value.time`；`<input type="datetime-local">` 接 once.startsAt（local time，submit 时调用方 localDateTimeToUtcIso）
- weekly weekday 多选用 `<button role="checkbox" aria-checked="...">` 7 个圆点 chip
- 预览区调用 `formatFrequency(value, { formatDateTime: (iso) => formatLocalDateTime(iso, timezone) })`，formatLocalDateTime 简单 Intl 实现

**verify:** typecheck；手测每种 kind 切换 + 修改字段 onChange 触发；预览文案随状态更新。

---

### Task 4 — 重构 `ScheduleJobEditor.tsx` —— typed forms + initialJob 编辑模式

**files:** `desktop/src/renderer/components/time/ScheduleJobEditor.tsx`

**新 Props：**
```ts
type ScheduleJobEditorSubmitInput = {
  // 不再有 scheduleKind/startsAt/intervalMinutes/cronExpression 字段
  title: string;
  description?: string;
  timezone: string;
  frequency: FrequencyValue;                                // 由 picker 提供
  executor: ScheduleJobExecutor;                            // 由父组件 ComposerModal 选定后传入，editor 内不再切换
  executorTargetId?: string;                                // workflow / silicon_person 时存 ID；prompt 时 undefined
  promptContent?: string;                                   // assistant_prompt 时存 prompt 内容（替代 description 兼职）
  // 后端兼容：workflow 编辑时不需要 prompt；silicon_person 把 message 也走 description
};

type Props = {
  timezone: string;
  executor: ScheduleJobExecutor;                             // 必填，决定字段 layout
  initialJob?: ScheduleJob;                                  // 编辑模式
  workflows: { id: string; name: string }[];                 // 父组件从 store 拉
  siliconPersons: { id: string; name: string }[];
  ownerScope?: TimeOwnerScope;
  ownerId?: string;
  onSave: (input: ScheduleJobEditorSubmitInput, mode: "create" | "update") => void | Promise<void>;
  onCancel?: () => void;                                     // 返回上一步切换 type
};
```

**字段布局（按 executor 分支）：**
```
通用：
  [标题]
  [频率 — FrequencyPicker]
  [备注（description; 仅 workflow / prompt 类备注）]
  [取消] [保存]

executor=assistant_prompt：
  通用 + ↓
  [提示词 textarea rows=6]   ← 提交时把 promptContent 写入 description（现后端从 description 取 prompt）

executor=workflow：
  通用 + ↓
  [选择工作流 select]   ← workflows[].id/name；初始为 initialJob.executorTargetId

executor=silicon_person：
  通用 + ↓
  [选择员工 select]
  [派发消息 textarea rows=4]   ← 同样写到 description（后端 silicon_person 也从 description 取）
```

**frequency 初始化：**
- `initialJob` 存在 → `parseFrequency(initialJob)`
- 否则按 executor 默认：prompt = every-day 09:00, workflow = every-day 09:00, silicon_person = every-day 09:00

**提交逻辑：**
1. 拼 `frequencyToScheduleInput(frequency)` 得到 `{ scheduleKind, startsAt?, intervalMinutes?, cronExpression? }`
2. mode = `initialJob ? "update" : "create"`
3. 调 `onSave({ ...通用, ...频率字段, executor, executorTargetId, description, promptContent or message }, mode)`

editor 内部不再 switch executor 之间，因为 ComposerModal 已经在前一步选 type。editor 上方放一个小 chip 显示当前 type + 「← 换类型」按钮，点击触发 `onCancel`。

**ESLint 注：** 删掉旧的 setExecutor / setScheduleKind / setStartValue / setIntervalValue / setCronValue 状态，全替换为 `frequency` 一个状态。

**verify:** typecheck；3 种 executor 各自表单字段对得上；初始化模式（create vs update）切换正确。

---

### Task 5 — `TimeCenterPage.tsx` 接通 typed composer + 列表强化

**files:** `desktop/src/renderer/pages/TimeCenterPage.tsx`

#### 5.1 ComposerModal 改造（Prompt / Workflow / 员工 入口卡）

新增子组件 `ScheduleJobTypePicker({ onPick })`：
```
[ 创建定时任务 — 选择类型 ]

  ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐
  │  💬 Prompt 任务   │ │  ⚙️ Workflow 任务 │ │  👤 调用员工任务 │
  │                    │ │                    │ │                    │
  │ 让模型按时回答 / 总│ │ 到点跑工作流（自   │ │ 到点向员工派发消息  │
  │ 结，输出 Markdown  │ │ 动发布 / 检查 / 提  │ │（让员工接收并按其  │
  │                    │ │ 醒等）             │ │ 角色处理）         │
  └────────────────────┘ └────────────────────┘ └────────────────────┘
```

每张卡片是 `.job-type-card`：圆角 var(--radius-lg)，glass-border，padding 18px，hover 提升。

`ComposerModal` 内对 `activeComposer === "job"` 分两态：
- 顶层 state `chosenJobType: ScheduleJobExecutor | null`，默认 null
- chosenJobType=null → 渲染 ScheduleJobTypePicker
- 否则 → 渲染 ScheduleJobEditor with executor=chosenJobType + onCancel=() => setChosenJobType(null)
- 关闭 modal 时重置 chosenJobType

#### 5.2 编辑模式入口

`ScheduleJobListPage` 加 prop `onEdit: (job) => void`，actions 加 ✏️ 按钮：
```tsx
<ActionIconButton title="编辑" onClick={() => onEdit(job)}>
  <IconEdit />
</ActionIconButton>
```

`TimeCenterPage` 顶层加 state：
```ts
const [editingJob, setEditingJob] = useState<ScheduleJob | null>(null);
```

handleEditScheduleJob(job) → setEditingJob(job) + setActiveComposer("job") + 同时 setChosenJobType(job.executor)（绕过 type picker）。

ComposerModal 接受新 prop `editingJob` 与 `onSaveJob` 处理 update：
- editingJob 存在时跳过 type picker，直接渲染 editor with initialJob=editingJob
- 关闭时重置 editingJob

handleSaveJob(input, mode):
```ts
if (mode === "update" && editingJob) {
  await workspace.updateScheduleJob({ ...editingJob, ...input, executor: editingJob.executor, ...frequency });
  setFeedback(`已更新定时任务：${input.title}`);
} else {
  await workspace.createScheduleJob({...});
}
setActiveComposer(null); setEditingJob(null); setChosenJobType(null);
```

#### 5.3 列表行 type chip + 频率人话

在 `ScheduleJobListPage` 的行 info-col 改造：
```tsx
<div className="job-row__info-col">
  <div className="job-row__title-line">
    <strong>{job.title}</strong>
    <span className={`job-type-chip job-type-chip--${job.executor}`}>{formatExecutorLabel(job.executor)}</span>
  </div>
  <span>{buildJobOwnerLabel(job, siliconPersonNameById)} · {formatJobFrequency(job, (iso) => formatDateTime(iso, timezone))}</span>
</div>
```

`formatExecutorLabel`:
- assistant_prompt → "Prompt"
- workflow → "Workflow"
- silicon_person → "员工"

CSS chip 三色（独立色，不再做色条）：
```css
.job-type-chip {
  display: inline-flex; height: 18px; padding: 0 7px; align-items: center;
  border-radius: 999px; font-size: 10px; font-weight: 700; letter-spacing: 0.04em;
}
.job-type-chip--assistant_prompt { background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.32); }
.job-type-chip--workflow { background: rgba(245, 158, 11, 0.14); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.32); }
.job-type-chip--silicon_person { background: rgba(16, 163, 127, 0.14); color: #2dd4bf; border: 1px solid rgba(16, 163, 127, 0.32); }
```

#### 5.4 顶部 type filter（chip 组）

ScheduleJobListPage header 下加：
```tsx
<div className="job-type-filter">
  {(["all", "assistant_prompt", "workflow", "silicon_person"] as const).map((value) => (
    <button
      key={value}
      type="button"
      className={typeFilter === value ? "job-type-filter__chip is-active" : "job-type-filter__chip"}
      onClick={() => setTypeFilter(value)}
    >{value === "all" ? "全部" : formatExecutorLabel(value)}</button>
  ))}
</div>
```

```ts
const [typeFilter, setTypeFilter] = useState<"all" | ScheduleJobExecutor>("all");
const filteredJobs = useMemo(
  () => typeFilter === "all" ? jobs : jobs.filter((job) => job.executor === typeFilter),
  [jobs, typeFilter],
);
```

filter chip CSS：
```css
.job-type-filter { display: flex; gap: 6px; padding: 0 24px 12px; border-bottom: 1px solid rgba(255,255,255,0.04); }
.job-type-filter__chip { padding: 4px 12px; border: 1px solid var(--glass-border); border-radius: 999px; background: transparent; color: var(--text-muted); font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s ease; }
.job-type-filter__chip:hover { color: var(--text-secondary); border-color: var(--glass-border-hover); }
.job-type-filter__chip.is-active { color: var(--text-primary); border-color: var(--glass-border-strong); background: var(--bg-surface-hover); }
```

#### 5.5 IconEdit 新组件

```tsx
function IconEdit() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M3 17.25V21h3.75l11-11.04-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0L15.13 5.13l3.75 3.75 1.83-1.84z"/>
    </svg>
  );
}
```

**verify:** typecheck；
- 点 + 按钮 → 看到 3 张 type 卡 → 点 Prompt 卡 → 进入 ScheduleJobEditor 仅显示 Prompt 字段 + FrequencyPicker
- 选「每天 09:00」/「每周一三五 09:00」/「每 30 分钟」分别保存 → 列表行显示对应中文频率
- 点已有任务 ✏️ → 弹出编辑器预填 title / prompt / 频率正确反解 → 改个时刻保存 → 列表行立即刷新
- 顶部 chip 组切换 → 列表只显示对应 type
- 关闭 modal 后再点 + → 又回到 type picker（不会记住上次选的 type）

**done:** 见 must_haves。

---

## Files
- `desktop/shared/contracts/workflow.ts` — +1 line（alias）
- `desktop/src/renderer/utils/frequency.ts` — new ~180 lines
- `desktop/src/renderer/components/time/FrequencyPicker.tsx` — new ~200 lines
- `desktop/src/renderer/components/time/ScheduleJobEditor.tsx` — 重写约 220 lines
- `desktop/src/renderer/pages/TimeCenterPage.tsx` — +约 250 lines（含 CSS）

## Out of scope
- 列表按 type 分组排序（仅做 filter，不做分组）
- 频率"自定义 cron"的语法校验（除空字符串外不校验，让后端调度器报错）
- workflow 任务的额外参数 / silicon_person 任务的目标 session 等高级字段
- 编辑/删除时的二次确认弹层
- 工作日多选与"每周指定"合并（保留两个独立 preset 因为常用度差异大）
