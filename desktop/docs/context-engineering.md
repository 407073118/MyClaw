# Desktop Context

## 读取顺序

1. `../AGENTS.md`
2. `./project-overview.md`
3. 目标子目录 `AGENTS.md`
4. 再看具体源码

## 最小上下文

- 改 UI：只看 `apps/desktop` 相关目录
- 改 runtime：只看 `apps/runtime`
- 改契约：先看 `packages/shared`，再看消费方

## 不要做的事

- 不要一开始扫完整个 `desktop/`
- 不要同时并改同一份契约文件
- 不要把 UI 逻辑塞进 `shared`

