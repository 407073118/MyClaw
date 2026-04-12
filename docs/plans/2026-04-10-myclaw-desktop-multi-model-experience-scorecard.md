# MyClaw Desktop 多模型体验 Scorecard 与 Rollout Gate

## Family Rollout Order

1. generic-openai-compatible
2. qwen-dashscope
3. openai-native
4. anthropic-native
5. br-minimax
6. volcengine-ark

## Required Metrics

- completionRate
- toolSuccessRate
- fallbackRate
- p95Latency
- contextStabilityRate

## Rollout Gate Rules

- completionRate >= 99%
- toolSuccessRate 不低于基线
- fallbackRate 不高于基线
- p95Latency 不高于基线 15%
- contextStabilityRate 不低于基线

## Hidden Flags

使用 `MYCLAW_ROLLOUT_<FAMILY>` 控制各 family 的灰度开关，例如：

- `MYCLAW_ROLLOUT_OPENAI_NATIVE=1`
- `MYCLAW_ROLLOUT_ANTHROPIC_NATIVE=1`

## Evidence Sources

- `myClaw/turn-outcomes/*.json`
- `myClaw/turn-telemetry.jsonl`
