# Vendor Runtime Follow-up Rollout Readiness

> **用途:** 记录截至当前代码状态的 follow-up 放量准备度，区分“已经能跑”“已经补强”“仍然偏浅”“暂不建议放量”的边界。

---

## 1. 当前放量结论

- `generic-openai-compatible`
  - 状态：稳定基线
  - 说明：仍是默认兼容基线，适合作为所有增强路径的最后回退。
- `OpenAI Responses`
  - 状态：可灰度
  - 已具备：native driver、usage 细粒度字段、`store=false`、`previous_response_id`、OpenAI 原生能力目录、route probe
  - 风险：`session` 与 `workflow` 路径都已有 dedicated integration 回归；仍缺更高层的 cache/continuity 策略与真实环境 smoke
- `Anthropic Messages`
  - 状态：可灰度
  - 已具备：native driver、thinking budget、protocol-aware endpoint/header
  - 风险：仍缺更深的 cache/continuity 策略
- `Qwen`
  - 状态：beta
  - 已具备：vendor policy、route probe、多协议候选、保守 adapter patch
  - 风险：仍以兼容链路为主，未完成更深的 protocol-specific transport/response 优化
- `Kimi`
  - 状态：beta
  - 已具备：anthropic-first 选择、protocol-aware endpoint/header、兼容增强 adapter
  - 风险：仍缺更高层的 server-state / replay 连续性验证
- `Volcengine Ark`
  - 状态：beta
  - 已具备：responses-first 路由、Ark 专属 adapter patch、route probe
  - 风险：仍缺更深的 response normalization 与 protocol-specific 执行细化
- `MiniMax public`
  - 状态：beta
  - 已具备：vendor family 语义独立于 `br-private`、兼容增强 adapter、messages-route endpoint
  - 风险：与官方推荐链路相比仍偏兼容实现
- `BR MiniMax`
  - 状态：稳定
  - 已具备：受管 profile、专用 adapter、probe、thinking/replay/fallback、golden transcript
  - 注意：这条链路优先保证稳定，不应为统一化而破坏

## 2. 建议的手工 smoke 检查

- OpenAI
  - 新建 `OpenAI` profile，打开 `useServerState`
  - 连续两轮 canonical 执行，确认第二轮请求体出现 `previous_response_id`
- Anthropic
  - 新建 `Anthropic` profile
  - 确认 `anthropic-messages` 探测、执行、thinking budget 路径一致
- Qwen
  - 使用 `Qwen` preset
  - 确认 route probe 同时展示 `responses / messages / compatible`
- Kimi
  - 使用 `Moonshot/Kimi` preset
  - 确认 route probe 推荐 `Anthropic Messages`，且执行端走 `/v1/messages`
- Ark
  - 使用 `Volcengine Ark` profile
  - 确认 `responses` 为推荐路线，兼容路线仍可回退
- MiniMax public
  - 使用公网 `MiniMax` profile
  - 确认不会被识别成 `br-private`
- BR MiniMax
  - 复跑 `br-minimax-model-client` 和 `phase1-golden-transcripts`
  - 确认 `<think>` replay、`reasoning_split`/兼容回退保持原行为

## 3. 当前仍未完成的点

- `OpenAI/Anthropic` 还没有完整的更高层 continuity/cache 策略
- `rich catalog` 原始目录数据已进入 `ModelDetailPage` 预览，且可在保存时回写 `discoveredCapabilities`；`ModelsPage / SettingsPage` 已具备能力来源透出，`protocolSelectionSource` / `savedProtocolPreferences` 也会在保存时落盘，但仍未形成统一的全局 catalog cache/目录视图
- `Qwen / Kimi / Ark / MiniMax public` 仍需更深的 protocol-specific transport/response 优化
- 最终的 rollout checklist 还没有和真实环境 smoke 结果联动

## 4. 下一轮建议顺序

1. 进一步决定是否引入全局 catalog cache，或继续沿用 profile + detail-page preview 方案
2. 深化 `Qwen / Kimi / Ark / MiniMax public` 的 response normalization 与 protocol-specific transport 行为
3. 为 `OpenAI / Anthropic` 继续补更高层 continuity/cache 策略
4. 在真实环境 smoke 通过后，再更新最终 rollout checklist
