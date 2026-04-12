# 模型路线探测与选择设计

## 1. 设计目标

本设计要解决的不是“用户能不能填 Base URL 和 Model”，而是“用户在当前项目支持的执行路线里，如何稳妥地选到最合适的一条”。当前桌面端已经具备 `providerFamily`、`protocolTarget`、`experienceProfileId` 等运行时维度，但这些决策仍主要发生在主进程运行时，模型配置界面没有把“当前模型最终会走哪条路线”显式交给用户。

本次设计的目标是：

1. 让用户在 **选定模型后**，通过一次明确的“路线探测”获得推荐路线。
2. 让用户能在“项目当前支持且当前模型确实可用”的路线中手动选择。
3. 让“保存配置”具备兜底行为：如果用户未探测也未手选，则系统自动探测并设置最优路线。
4. 让推荐、手动覆盖、探测详情三者关系清晰，且符合当前 `ModelDetailPage` 的信息密度和视觉风格。

这里的“路线”明确指 **协议执行路线**，对应当前项目已支持的三条运行时路径：

- `openai-chat-compatible`
- `openai-responses`
- `anthropic-messages`

本设计不把 UI 抽象成“Family 配置器”，而是保持用户心智在“当前模型走哪条执行路线”。`providerFamily` 仍由底层运行时推断和消费，但不作为本次 UI 的第一表达对象。

---

## 2. 方案比较与推荐

本轮有三种可行方案。

### 方案 A：全自动推荐，无手动干预

优点是最省心，用户只要填完模型信息，保存时系统自动决定；缺点是对高级用户不透明，尤其在自建网关、兼容层代理或灰度切换场景下，用户无法表达“我知道这条也能走，但我就是想固定另一条”。

### 方案 B：纯手动路线下拉

优点是实现直观；缺点是用户需要先理解三种路线差异，还可能选到当前其实不可用的路线。这个方案对当前项目并不友好，因为我们已经有能力做探测，不利用这一步会把复杂度推给用户。

### 方案 C：探测优先，允许手动覆盖

这是推荐方案。用户必须先选模型，然后：

- 可以主动点击“探测路线”
- 系统返回推荐路线
- 下拉中只出现本次探测确认可用的路线
- 用户可以手动覆盖，并把这次选择保存为模型默认路线
- 如果用户没探测也没手动选，保存时自动补跑探测

这个方案兼顾了可解释性、可控性和当前项目的技术基础，也最符合你已经确认的交互约束。

---

## 3. 交互设计

### 3.1 放置位置

路线诊断区放在 [ModelDetailPage.tsx](/Users/zhangjianing/WebstormProjects/ai-project/MyClaw/desktop/src/renderer/pages/ModelDetailPage.tsx:320) 的“基础参数”区域内，具体位于“测试联通 / 获取模型列表”按钮旁边，形成同一组“连接与路线诊断”操作区。

不新开整页、不塞进高级设置，也不放到只读能力卡里。原因是：

- 用户完成模型 ID 输入后，天然会在这里做验证动作
- “联通测试”与“路线探测”在心智上都属于“确认当前配置到底能怎么跑”
- 保持现有页面结构，不破坏顶部表单流

### 3.2 基础流程

1. 用户选择供应商预设、填写 API Key、选择或输入模型 ID。
2. 在模型为空时，“探测路线”按钮禁用，并显示提示：`请先选择模型，再进行路线探测。`
3. 选定模型后，用户可以：
   - 点 `测试联通`
   - 点 `获取模型列表`
   - 点 `探测路线`
4. 路线探测完成后，界面展示：
   - `推荐路线` 标签
   - `路线下拉框`
   - `详情` 图标按钮
5. 用户手动修改下拉后，该选择视为当前模型的默认路线。
6. 点击保存时：
   - 如果用户已经手动选路，直接保存，不再重新探测
   - 如果用户没有已选路线，则自动触发探测，选中项目内置优先级下的最优路线后保存

### 3.3 页面文案

建议文案风格贴近当前页面，不用工程术语轰炸用户：

- 按钮：`探测路线`
- 推荐标签：`推荐路线：OpenAI Responses`
- 下拉标题：`执行路线`
- 自动探测保存提示：`已完成路线探测，已为当前模型设置最佳路线：OpenAI Responses`
- 失败提示：`未探测到当前模型可用的执行路线，请检查接口、鉴权或服务兼容性。`

---

## 4. 详情面板设计

详情图标使用轻量按钮，风格上复用当前页面的小型次按钮或图标按钮，不引入新的视觉体系。点击后打开一个轻量 popover 或小型侧浮层，展示“本次探测结果”，而不是弹出一个重型全屏对话框。

详情内容建议按路线列表展示，每条路线包含：

- 路线名称
- 状态：`可用 / 不可用 / 未参与本次探测`
- 是否被推荐
- 延迟（如果有）
- 失败原因（如果失败）
- 能力提示，例如：
  - `原生 Responses 事件流`
  - `支持 Anthropic tool_use`
  - `兼容模式，工具编译较保守`

推荐展示形式：

```text
OpenAI Responses      可用   推荐   182ms
  原生 reasoning / function call 事件流

Anthropic Messages    不可用
  当前 endpoint 未返回兼容消息流

OpenAI Compatible     可用   240ms
  兼容模式，可作为回退路线
```

这里不把详情做成原始日志面板，而是用户读得懂的“诊断摘要”。详细技术字段仍留给日志和开发态工具。

---

## 5. 数据模型与状态设计

### 5.1 持久化字段

当前 [ModelProfile](/Users/zhangjianing/WebstormProjects/ai-project/MyClaw/desktop/shared/contracts/model.ts:168) 已有 `protocolTarget?`，本设计建议继续把它作为“用户最终保存的默认路线”。

也就是说：

- `protocolTarget`：当前模型配置保存下来的最终路线
- 不新增第二个“selectedRoute”字段，避免语义重复

这符合当前运行时结构，因为 `resolveFamilyPolicy()` 已经能够消费 `protocolTarget`。

### 5.2 非持久化状态

探测结果建议先保留为 **renderer 临时状态**，而不是完整写进 `ModelProfile`。理由：

- 探测结果天然依赖当前表单态，尤其是尚未保存的 `apiKey / model / headers / requestBody`
- 完整持久化 probe report 会让 profile 膨胀，并引入“旧探测结果是否过期”的同步问题
- 当前页面重新打开时，只需展示“已保存路线”，如果用户要更新推荐，重新点一次探测即可

因此新增的前端状态建议是：

- `routeProbeResult: RouteProbeResult | null`
- `selectedRoute: ProtocolTarget | null`
- `routeSelectionSource: "manual" | "probe-recommended" | "auto-probe-on-save" | null`
- `isProbingRoutes: boolean`

其中 `selectedRoute` 最终会写回 `profile.protocolTarget`。

### 5.3 探测结果结构

建议新增共享类型：

```ts
type RouteProbeEntry = {
  protocolTarget: ProtocolTarget;
  ok: boolean;
  latencyMs?: number;
  reason?: string | null;
  notes?: string[];
};

type RouteProbeResult = {
  recommendedProtocolTarget: ProtocolTarget | null;
  availableProtocolTargets: ProtocolTarget[];
  entries: RouteProbeEntry[];
  testedAt: string;
};
```

---

## 6. 探测逻辑

### 6.1 候选路线范围

下拉里只显示当前探测确认可用的路线，但探测本身检查的是“当前项目支持的路线”。候选集合保持固定：

- `openai-responses`
- `anthropic-messages`
- `openai-chat-compatible`

实际探测时可根据当前 provider preset 做轻度裁剪，但不改变核心规则。例如：

- `Anthropic` 预设可优先探测 `anthropic-messages`
- `OpenAI / Qwen / Moonshot / MiniMax / Custom(openai-compatible)` 预设优先探测 `openai-responses` 和 `openai-chat-compatible`

### 6.2 推荐策略

你已经明确要求“最优路线按项目内置优先级选”，所以推荐逻辑不走评分系统，而走固定排序：

1. `openai-responses`
2. `anthropic-messages`
3. `openai-chat-compatible`

在探测返回的 `availableProtocolTargets` 中，按这个顺序取第一个作为推荐路线。

### 6.3 保存逻辑

保存时走如下分支：

- `用户已手动选路`：直接保存 `protocolTarget = selectedRoute`
- `用户未手动选路，但已有成功 probe`：保存推荐路线
- `用户既没手动选，也没 probe`：自动调用一次 probe，取推荐路线后保存
- `自动 probe 失败`：中断保存，保留当前页面并显示错误

这会让“保存配置”具备很强的兜底性，同时不违背用户的显式选择。

---

## 7. 后端与 IPC 设计

建议新增一个与现有 `testModelByConfig` 类似的能力：

- `model:probe-routes-by-config`

它接收当前表单态配置，返回 `RouteProbeResult`。这样设计有两个优点：

1. 不要求用户先保存模型再探测
2. 与当前 [ipc/models.ts](/Users/zhangjianing/WebstormProjects/ai-project/MyClaw/desktop/src/main/ipc/models.ts:1) 的“按配置即时测试”模式一致

探测实现上不需要发明新 runtime，总体可复用当前项目已经具备的三条协议驱动：

- `openai-responses-driver`
- `anthropic-messages-driver`
- `openai-chat-compatible-driver`

但探测不是完整对话执行，只需要：

- 发送一个极小请求
- 判断是否能成功建立正确协议响应
- 记录延迟、错误和少量能力备注

返回数据只服务配置页，不直接写 session runtime。

---

## 8. UI 风格约束

这个功能必须贴合当前项目风格，不做一块“像后台监控面板”的新皮肤。

建议遵循：

- 页面布局仍用当前 `ModelDetailPage` 的 `form-section / field / field-inline`
- 路线结果卡复用现有“能力卡”风格，视觉上接近 `.capability-card`
- 状态使用当前绿色/黄色/红色语义，不额外引入新色
- 主动作仍使用当前页的次按钮风格，不出现突兀的实心大按钮
- 详情按钮用小图标，不抢主流程焦点

也就是说，它应看起来像“模型配置页原生就该有的一部分”，而不是一个后来塞进去的实验功能。

---

## 9. 测试方案

至少需要覆盖四层：

1. **Renderer 交互测试**
   - 没选模型时探测按钮禁用
   - 探测成功后展示推荐路线和可选路线下拉
   - 手动选路后保存不再自动探测
   - 未选路直接保存时自动探测并回填

2. **IPC / 主进程测试**
   - `model:probe-routes-by-config` 能按候选路线返回结构化结果
   - 推荐路线遵守固定优先级
   - 探测失败时能返回稳定错误信息

3. **运行时契约测试**
   - `protocolTarget` 保存后能被当前 turn execution 计划正确消费
   - 手动保存路线不会被推断逻辑静默覆盖

4. **回归测试**
   - 现有 `test connectivity`、`fetch model catalog`、`save model profile` 不被破坏

---

## 10. 最终建议

推荐把这个需求实现成一个“路线诊断区”，而不是“高级设置项”或“独立诊断页”。原因很简单：它既是配置的一部分，也是验证的一部分。对用户来说，最自然的流程就是：

`选模型 → 测试/探测 → 看推荐 → 必要时改一下 → 保存`

这条路径比“先保存，再去别处看运行时到底走哪条路”清晰得多，也更符合当前项目从配置页直接驱动运行时的设计风格。

如果后续要继续扩展，这个设计还能自然承接：

- Route stale 标记
- 更细的能力说明
- 不同 preset 的默认候选集
- 探测日志与开发者诊断模式

但第一阶段不需要一次做满。先把“探测、推荐、可选、保存兜底”这四件事做稳，就已经能明显改善当前多模型配置体验。
