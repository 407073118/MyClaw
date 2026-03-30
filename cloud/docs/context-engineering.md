# Cloud Context

## 读取顺序

1. `../AGENTS.md`
2. `../README.md`
3. `./project-overview.md`
4. 目标子目录 `AGENTS.md`
5. 再看源码

## 最小上下文

- 改 API：先看 `apps/cloud-api`
- 改 Web：先看 `apps/cloud-web`
- 改契约：先看 `packages/shared`，再看消费方

## 不要做的事

- 不要默认同时读 API 和 Web 全量代码
- 不要把 `infra` 或日志文件当业务上下文
- 不要越过 shared 直接改接口语义

