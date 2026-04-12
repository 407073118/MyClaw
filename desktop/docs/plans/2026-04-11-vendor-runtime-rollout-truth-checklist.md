# Vendor Runtime Rollout Truth Checklist

> **用途:** 这份清单只记录 2026-04-11 代码复核后的当前仓库真相，用来纠偏设计稿、阶段总结和后续开发顺序。

---

## 1. 已落地且已验证

- `vendorFamily` / `vendor policy registry` 已落地，并有合同测试保护。
  - 参考：`desktop/src/main/services/model-runtime/vendor-policy-registry.ts`
  - 测试：`desktop/tests/model-runtime/contracts/vendor-policy-contracts.test.ts`
- `vendor runtime policy`、`turn execution plan`、`fallbackChain`、`recommendedProtocolTarget` 已落地，并有单测保护。
  - 参考：`desktop/src/main/services/model-runtime/vendor-runtime-policy-resolver.ts`
  - 测试：`desktop/tests/model-runtime/unit/vendor-runtime-policy-resolver.test.ts`
  - 测试：`desktop/tests/model-runtime/unit/turn-execution-plan-resolver.test.ts`
- `execution-gateway -> protocol driver -> transport` 的统一执行骨架已落地。
  - 参考：`desktop/src/main/services/model-runtime/execution-gateway.ts`
  - 测试：`desktop/tests/model-runtime/integration/execution-gateway.test.ts`
- 模型路线探测、推荐路线、保存后的 route badge 已落地，并覆盖 OpenAI、Anthropic、Qwen、Kimi、Custom 等场景。
  - 测试：`desktop/tests/model-route-probe-ipc.test.ts`
  - 测试：`desktop/tests/model-detail-route-probe.test.ts`
  - 测试：`desktop/tests/models-page-route-badge.test.ts`
  - 测试：`desktop/tests/settings-page-route-badge.test.ts`
- provider capability probers 已落地并有测试，不再是纯设计稿。
  - 测试：`desktop/tests/phase11-provider-capability-probers.test.ts`

## 2. 已落地但实现较浅

- 除 `br-minimax` 外，多数 `provider-adapters/*` 仍只是 `openAiCompatibleAdapter` 的别名。
- `OpenAI Responses` 和 `Anthropic Messages` 已有原生 driver，但默认灰度仍然偏保守。
- `Qwen`、`Kimi`、`Volcengine Ark`、公网 `MiniMax` 已有 vendor policy / protocol matrix / route probe 候选，但执行层仍偏兼容链路。
- UI 已能探测和显示路线，但 rich catalog 元数据没有完整进入 renderer 侧产品表达。
- scorecard / telemetry 已经有骨架，但当前主要还是按 `providerFamily` 看结果，不足以支撑 `vendor + protocol` 的放量复盘。

## 3. 尚未完成或未真正接入执行面

- `vendor + protocol` rollout gate 尚未真正成为主执行门控；当前网关主要仍消费 `providerFamily` gate。
- `Kimi anthropic-first` 仍偏策略层语义，缺少真正打实的 transport / execution integration。
- 公网 `MiniMax` 与 `BR MiniMax` 的语义仍未完全收敛清楚。
- `Ark`、`Qwen` 的多协议能力还没有形成足够深的 vendor-specific adapter 行为。
- `2026-04-10-openai-native-support-design.md` 中提出的 `wireApi`、`openai-models.json`、`store=false`、`previous_response_id`、native capability override 等增强项尚未按当前架构落地。

## 4. 文档与测试漂移

- `.planning/phases/10-provider-adapters-for-minimax-first-reasoning-runtime/10-03-SUMMARY.md` 把 `phase10-model-settings.test.ts` 记成已创建，但当前仓库中不存在该文件。
- `.planning/phases/10-provider-adapters-for-minimax-first-reasoning-runtime/10-03-SUMMARY.md` 将 “Phase 10 已整体完成” 作为当前结论，已不适合作为现状说明。
- `.planning/phases/10-provider-adapters-for-minimax-first-reasoning-runtime/10-VALIDATION.md` 中的 `phase10-minimax-adapter.test.ts`、`phase10-message-replay.test.ts`、`phase10-model-settings.test.ts`、`phase9-provider-reasoning-mapper.test.ts` 当前仓库均不存在。
- `desktop/docs/plans/2026-04-11-vendor-runtime-tier-upgrade-implementation-plan.md` 仍可作为历史实施草案使用，但不能直接当作“尚未执行”的空白计划；其中多项基础骨架已在代码中存在。

## 5. 后续开发顺序

1. 先纠正文档和测试真相，停止继续引用不存在的验证资产。
2. 再把 `vendor + protocol` rollout 真正接入执行路径。
3. 再补 `Qwen / Kimi / Ark / 公网 MiniMax` 的 adapter 与 transport 深度。
4. 然后补 `OpenAI / Anthropic` 原生执行增强项。
5. 最后再扩 UI、catalog 和 scorecard 的真实运行时可观测性。
