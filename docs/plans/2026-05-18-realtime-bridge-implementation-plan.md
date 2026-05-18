# Realtime Bridge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone TypeScript/NestJS `realtime-bridge` service that routes messages from the existing DingTalk relay to each user's primary MyClaw Desktop and returns Desktop Agent replies to DingTalk.

**Architecture:** `realtime-bridge` is a new root-level backend workspace, separate from `cloud/` and `desktop/`. It receives normalized DingTalk messages from the existing relay, persists message state in MySQL, tracks online Desktop connections in Redis, routes by `senderStaffId`, and talks to Desktop over WSS. Desktop integration is a main-process client that reuses the existing `session:send-message` execution path instead of creating a second Agent runtime.

**Tech Stack:** TypeScript, NestJS, Prisma, MySQL, Redis, raw `ws`, Vitest, Supertest, Electron main process `ws` client.

---

## 全局执行规则

- 实施前先确认当前工作树；不要提交已有的 Desktop 未提交改动，除非本计划任务明确修改对应文件。
- 所有新增文本、代码、配置和文档使用 UTF-8。
- 所有方法必须有中文注释；方法内关键路径必须有中文日志，覆盖成功、失败、重试、降级和安全拒绝。
- 每个任务按 TDD 执行：先写失败测试，再写最小实现，再跑测试。
- 每个任务独立提交，提交前运行本任务测试和乱码门禁。
- 计划涉及协议变更时，同步更新 `realtime-bridge/src/contracts/*` 与 `desktop/shared/contracts/realtime-bridge.ts`。

推荐乱码门禁：

```powershell
$pattern = ([string][char]0xFFFD) + "|" + ([string][char]0x951F) + "|" + ([string][char]0x00C3) + "|" + ([string][char]0x00D0) + "|\\?/h[1-6]>"
rg -n $pattern realtime-bridge desktop/shared/contracts desktop/src/main/services desktop/src/main/ipc docs/plans
```

## Task 1: 创建 realtime-bridge 项目骨架

**Files:**
- Create: `realtime-bridge/AGENTS.md`
- Create: `realtime-bridge/package.json`
- Create: `realtime-bridge/tsconfig.json`
- Create: `realtime-bridge/vitest.config.ts`
- Create: `realtime-bridge/src/main.ts`
- Create: `realtime-bridge/src/app.module.ts`
- Create: `realtime-bridge/src/modules/health/health.controller.ts`
- Create: `realtime-bridge/src/modules/health/health.module.ts`
- Create: `realtime-bridge/tests/health/health.controller.test.ts`

**Step 1: Write the failing test**

Create `realtime-bridge/tests/health/health.controller.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { HealthController } from "../../src/modules/health/health.controller";

describe("HealthController", () => {
  it("returns service status", () => {
    const controller = new HealthController();
    expect(controller.getHealth()).toEqual({
      ok: true,
      service: "realtime-bridge",
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
pnpm --dir realtime-bridge test tests/health/health.controller.test.ts
```

Expected: FAIL because package and controller do not exist.

**Step 3: Write minimal implementation**

Create `realtime-bridge/package.json`:

```json
{
  "name": "myclaw-realtime-bridge",
  "private": true,
  "version": "0.1.0",
  "packageManager": "pnpm@9.11.0",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "prisma:generate": "prisma generate",
    "prisma:push": "prisma db push"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.1",
    "@nestjs/core": "^11.0.1",
    "@nestjs/platform-express": "^11.0.1",
    "@prisma/client": "^6.5.0",
    "ioredis": "^5.4.2",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.2",
    "ws": "^8.20.0",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/node": "^22.13.10",
    "@types/ws": "^8.5.13",
    "prisma": "^6.5.0",
    "supertest": "^7.0.0",
    "tsx": "^4.20.5",
    "typescript": "^5.8.2",
    "vitest": "^3.0.8"
  }
}
```

Create `realtime-bridge/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "strict": true,
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "skipLibCheck": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

Create `realtime-bridge/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

Create `realtime-bridge/src/modules/health/health.controller.ts`:

```ts
import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  /** 返回服务健康状态，供负载均衡与部署探针检查。 */
  @Get()
  getHealth(): { ok: boolean; service: string } {
    console.info("[health] 返回 realtime-bridge 健康状态");
    return { ok: true, service: "realtime-bridge" };
  }
}
```

Create `realtime-bridge/src/modules/health/health.module.ts`:

```ts
import { Module } from "@nestjs/common";

import { HealthController } from "./health.controller";

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
```

Create `realtime-bridge/src/app.module.ts`:

```ts
import { Module } from "@nestjs/common";

import { HealthModule } from "./modules/health/health.module";

@Module({
  imports: [HealthModule],
})
export class AppModule {}
```

Create `realtime-bridge/src/main.ts`:

```ts
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";

/** 启动 realtime-bridge HTTP 服务，后续 WebSocket 会挂载到同一 HTTP Server。 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 4300);
  await app.listen(port);
  console.info("[bootstrap] realtime-bridge 已启动", { port });
}

void bootstrap().catch((error) => {
  console.error("[bootstrap] realtime-bridge 启动失败", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
```

Create `realtime-bridge/AGENTS.md` with local rules: UTF-8 only, Chinese comments/logs for methods, TDD, no direct Desktop code imports.

**Step 4: Run test and build**

Run:

```powershell
pnpm --dir realtime-bridge install
pnpm --dir realtime-bridge test tests/health/health.controller.test.ts
pnpm --dir realtime-bridge build
```

Expected: PASS and build exits 0.

**Step 5: Commit**

```powershell
git add realtime-bridge
git commit -m "feat(realtime-bridge): 初始化实时桥接服务"
```

## Task 2: 定义共享消息协议与运行时常量

**Files:**
- Create: `realtime-bridge/src/contracts/bridge-events.ts`
- Create: `realtime-bridge/src/contracts/channel-message.ts`
- Create: `realtime-bridge/src/contracts/status.ts`
- Test: `realtime-bridge/tests/contracts/bridge-events.test.ts`

**Step 1: Write the failing test**

Create tests that assert status arrays contain exact values and `buildLocalSessionKey()` creates stable keys:

```ts
import { describe, expect, it } from "vitest";

import { buildLocalSessionKey, INBOUND_MESSAGE_STATUS_VALUES } from "../../src/contracts/status";

describe("realtime bridge contracts", () => {
  it("keeps inbound message statuses stable", () => {
    expect(INBOUND_MESSAGE_STATUS_VALUES).toEqual([
      "received",
      "routed",
      "queued",
      "delivered",
      "processing",
      "completed",
      "failed",
      "expired",
    ]);
  });

  it("builds stable direct and group session keys", () => {
    expect(buildLocalSessionKey({
      provider: "dingtalk",
      conversationType: "direct",
      externalConversationId: "cid-1",
      myclawUserId: "user-1",
    })).toBe("dingtalk:direct:cid-1:user:user-1");

    expect(buildLocalSessionKey({
      provider: "dingtalk",
      conversationType: "group",
      externalConversationId: "gid-1",
      myclawUserId: "user-1",
    })).toBe("dingtalk:group:gid-1:user:user-1");
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
pnpm --dir realtime-bridge test tests/contracts/bridge-events.test.ts
```

Expected: FAIL because contracts do not exist.

**Step 3: Implement contracts**

Define:

- `BridgeInboundMessage`
- `DesktopAckMessage`
- `DesktopReplyCreated`
- `DesktopProcessingFailed`
- `InboundMessageStatus`
- `DeliveryAttemptStatus`
- `OutboundMessageStatus`
- `buildLocalSessionKey()`

`buildLocalSessionKey()` must only accept `provider: "dingtalk"` for first version and `conversationType: "direct" | "group"`.

**Step 4: Run test**

```powershell
pnpm --dir realtime-bridge test tests/contracts/bridge-events.test.ts
pnpm --dir realtime-bridge build
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add realtime-bridge/src/contracts realtime-bridge/tests/contracts
git commit -m "feat(realtime-bridge): 定义桥接消息协议"
```

## Task 3: 建立 Prisma 数据模型与数据库服务

**Files:**
- Create: `realtime-bridge/prisma/schema.prisma`
- Create: `realtime-bridge/src/infra/prisma/prisma.service.ts`
- Create: `realtime-bridge/src/infra/prisma/prisma.module.ts`
- Test: `realtime-bridge/tests/prisma/schema-shape.test.ts`

**Step 1: Write the failing schema-shape test**

Use `fs.readFileSync()` to assert the schema contains required models and indexes:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Prisma schema", () => {
  it("declares realtime bridge core models", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    for (const model of [
      "ChannelBot",
      "ChannelAccount",
      "ChannelConversation",
      "ChannelBinding",
      "DesktopDevice",
      "InboundMessage",
      "DeliveryAttempt",
      "OutboundMessage",
      "AuditLog",
    ]) {
      expect(schema).toContain(`model ${model}`);
    }
    expect(schema).toContain("@@unique([provider, externalMessageId])");
    expect(schema).toContain("@@index([status, createdAt])");
  });
});
```

**Step 2: Run test to verify it fails**

```powershell
pnpm --dir realtime-bridge test tests/prisma/schema-shape.test.ts
```

Expected: FAIL because `schema.prisma` does not exist.

**Step 3: Implement schema**

Create MySQL schema with `String @db.VarChar(191)` IDs and JSON payload fields. Include these tables:

- `channel_bot`
- `channel_account`
- `channel_conversation`
- `channel_binding`
- `desktop_device`
- `inbound_message`
- `delivery_attempt`
- `outbound_message`
- `audit_log`

Use `createdAt @default(now())` and `updatedAt @updatedAt` on mutable tables. Store raw relay payload in `rawPayloadJson Json`.

**Step 4: Add Prisma service**

`PrismaService` should connect on module init and disconnect on destroy, with Chinese logs.

**Step 5: Run validation**

```powershell
pnpm --dir realtime-bridge prisma validate
pnpm --dir realtime-bridge test tests/prisma/schema-shape.test.ts
pnpm --dir realtime-bridge build
```

Expected: all PASS.

**Step 6: Commit**

```powershell
git add realtime-bridge/prisma realtime-bridge/src/infra/prisma realtime-bridge/tests/prisma
git commit -m "feat(realtime-bridge): 建立消息状态数据模型"
```

## Task 4: 实现 HMAC 安全校验与 Ingress 入站接口

**Files:**
- Create: `realtime-bridge/src/common/crypto/hmac-signature.ts`
- Create: `realtime-bridge/src/modules/ingress/dto/dingtalk-relay-message.dto.ts`
- Create: `realtime-bridge/src/modules/ingress/ingress.controller.ts`
- Create: `realtime-bridge/src/modules/ingress/ingress.service.ts`
- Create: `realtime-bridge/src/modules/ingress/ingress.module.ts`
- Modify: `realtime-bridge/src/app.module.ts`
- Test: `realtime-bridge/tests/ingress/hmac-signature.test.ts`
- Test: `realtime-bridge/tests/ingress/ingress.controller.test.ts`

**Step 1: Write failing HMAC tests**

Test valid signature, stale timestamp, reused nonce, and body tampering.

**Step 2: Write failing controller tests**

Use Supertest with a mocked `IngressService`. Verify:

- valid payload returns `{ ok: true, messageId }`
- missing signature returns 401
- invalid body returns 400

**Step 3: Implement minimal HMAC verifier**

Signature base string:

```text
{timestamp}.{nonce}.{sha256(body)}
```

Use `crypto.createHmac("sha256", secret).update(base).digest("hex")`. Use timing-safe comparison.

**Step 4: Implement DTO validation**

First version payload must require:

- `provider: "dingtalk"`
- `externalMessageId`
- `senderStaffId`
- `externalConversationId`
- `conversationType: "direct" | "group"`
- `content.type`
- `traceId`

Optional:

- `senderNick`
- `conversationTitle`
- `sessionWebhook`
- `raw`

**Step 5: Implement controller and service**

Controller receives `POST /v1/ingress/dingtalk/message`. Service creates or dedupes `InboundMessage` with status `received`.

**Step 6: Run tests**

```powershell
pnpm --dir realtime-bridge test tests/ingress/hmac-signature.test.ts tests/ingress/ingress.controller.test.ts
pnpm --dir realtime-bridge build
```

Expected: PASS.

**Step 7: Commit**

```powershell
git add realtime-bridge/src/common/crypto realtime-bridge/src/modules/ingress realtime-bridge/src/app.module.ts realtime-bridge/tests/ingress
git commit -m "feat(realtime-bridge): 接收入站钉钉中转消息"
```

## Task 5: 实现 Redis 在线状态与 Desktop WebSocket 网关

**Files:**
- Create: `realtime-bridge/src/infra/redis/redis.service.ts`
- Create: `realtime-bridge/src/infra/redis/redis.module.ts`
- Create: `realtime-bridge/src/modules/desktop-ws/desktop-connection.registry.ts`
- Create: `realtime-bridge/src/modules/desktop-ws/desktop-ws.gateway.ts`
- Create: `realtime-bridge/src/modules/desktop-ws/desktop-ws.module.ts`
- Modify: `realtime-bridge/src/app.module.ts`
- Test: `realtime-bridge/tests/desktop-ws/desktop-connection.registry.test.ts`

**Step 1: Write failing registry tests**

Test:

- `register()` marks device online.
- `disconnect()` removes connection.
- one user can have only one active device.
- registering a new connection for same device replaces old connection.

**Step 2: Implement Redis service**

Wrap `ioredis`. Methods:

- `setDeviceOnline(deviceId, userId, connectionId, ttlSeconds)`
- `refreshDeviceOnline(deviceId, ttlSeconds)`
- `getOnlineDevice(deviceId)`
- `removeDevice(deviceId)`

All methods include Chinese comments and logs.

**Step 3: Implement WebSocket gateway using raw `ws`**

Attach raw `WebSocketServer` to HTTP server in module init. Accept path `/v1/desktop/ws`.

Handle messages:

- `desktop.hello`
- `desktop.heartbeat`
- `desktop.ack`
- `desktop.reply_created`
- `desktop.processing_failed`

**Step 4: Run tests**

```powershell
pnpm --dir realtime-bridge test tests/desktop-ws/desktop-connection.registry.test.ts
pnpm --dir realtime-bridge build
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add realtime-bridge/src/infra/redis realtime-bridge/src/modules/desktop-ws realtime-bridge/src/app.module.ts realtime-bridge/tests/desktop-ws
git commit -m "feat(realtime-bridge): 管理桌面端长连接"
```

## Task 6: 实现 senderStaffId 路由与绑定查询

**Files:**
- Create: `realtime-bridge/src/modules/routing/routing.service.ts`
- Create: `realtime-bridge/src/modules/routing/routing.module.ts`
- Create: `realtime-bridge/src/modules/conversation/conversation.service.ts`
- Create: `realtime-bridge/src/modules/conversation/conversation.module.ts`
- Modify: `realtime-bridge/src/app.module.ts`
- Test: `realtime-bridge/tests/routing/routing.service.test.ts`

**Step 1: Write failing routing tests**

Test priority:

```text
显式群/会话绑定 > senderStaffId 用户绑定 > unbound
```

Cases:

- direct chat finds `channel_account`.
- group chat with explicit binding overrides sender.
- group chat without binding routes by sender.
- unbound sender returns `unbound_sender`.
- disabled user or disabled binding returns route failure.

**Step 2: Implement routing result type**

Return:

```ts
type RouteResult =
  | { ok: true; myclawUserId: string; desktopDeviceId: string; localSessionKey: string; routeSource: "conversation-binding" | "sender-binding" }
  | { ok: false; reason: "unbound_sender" | "disabled_sender" | "device_offline" | "binding_disabled" };
```

**Step 3: Implement conversation upsert**

Create/update `ChannelConversation` using incoming `externalConversationId` and title.

**Step 4: Run tests**

```powershell
pnpm --dir realtime-bridge test tests/routing/routing.service.test.ts
pnpm --dir realtime-bridge build
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add realtime-bridge/src/modules/routing realtime-bridge/src/modules/conversation realtime-bridge/src/app.module.ts realtime-bridge/tests/routing
git commit -m "feat(realtime-bridge): 按钉钉发送人路由消息"
```

## Task 7: 实现投递状态机、ACK、重试和离线队列

**Files:**
- Create: `realtime-bridge/src/modules/delivery/delivery.service.ts`
- Create: `realtime-bridge/src/modules/delivery/delivery.module.ts`
- Create: `realtime-bridge/src/modules/delivery/local-session-lock.service.ts`
- Modify: `realtime-bridge/src/modules/ingress/ingress.service.ts`
- Modify: `realtime-bridge/src/modules/desktop-ws/desktop-ws.gateway.ts`
- Modify: `realtime-bridge/src/app.module.ts`
- Test: `realtime-bridge/tests/delivery/delivery.service.test.ts`
- Test: `realtime-bridge/tests/delivery/local-session-lock.service.test.ts`

**Step 1: Write failing state machine tests**

Test:

- received -> routed -> delivered on successful WSS send.
- delivered -> processing after `desktop.processing_started`.
- processing -> completed after outbound success.
- offline route becomes queued.
- ACK timeout records failed delivery attempt.
- duplicate `deliveryId` ACK is idempotent.

**Step 2: Implement local session lock**

`localSessionKey` has one running delivery. Later deliveries queue until the running one completes or expires.

**Step 3: Implement delivery service**

Delivery service should:

- create `DeliveryAttempt`
- send `bridge.message.received` through `DesktopConnectionRegistry`
- wait for ACK within 5-10 seconds
- retry 2s / 5s / 15s
- leave `queued` when device offline

**Step 4: Wire ingress to route + delivery**

After persisting inbound message, call routing and delivery asynchronously. Ingress HTTP response remains fast.

**Step 5: Run tests**

```powershell
pnpm --dir realtime-bridge test tests/delivery/delivery.service.test.ts tests/delivery/local-session-lock.service.test.ts
pnpm --dir realtime-bridge build
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add realtime-bridge/src/modules/delivery realtime-bridge/src/modules/ingress realtime-bridge/src/modules/desktop-ws realtime-bridge/src/app.module.ts realtime-bridge/tests/delivery
git commit -m "feat(realtime-bridge): 增加消息投递状态机"
```

## Task 8: 实现 Outbound 回发与失败重试

**Files:**
- Create: `realtime-bridge/src/modules/outbound/dingtalk-relay.client.ts`
- Create: `realtime-bridge/src/modules/outbound/outbound.service.ts`
- Create: `realtime-bridge/src/modules/outbound/outbound.module.ts`
- Modify: `realtime-bridge/src/modules/desktop-ws/desktop-ws.gateway.ts`
- Modify: `realtime-bridge/src/modules/delivery/delivery.service.ts`
- Modify: `realtime-bridge/src/app.module.ts`
- Test: `realtime-bridge/tests/outbound/outbound.service.test.ts`

**Step 1: Write failing outbound tests**

Test:

- `desktop.reply_created` creates outbound message.
- successful relay response marks outbound `sent` and inbound `completed`.
- relay failure retries 1s / 5s / 30s.
- final failure marks outbound `failed` and inbound `failed`.

**Step 2: Implement relay client**

Call existing DingTalk relay endpoint, not DingTalk official API. Use environment:

```text
DINGTALK_RELAY_BASE_URL
DINGTALK_RELAY_HMAC_SECRET
```

Sign outbound calls with HMAC similarly to ingress.

**Step 3: Implement outbound service**

Persist `OutboundMessage` and status transitions. Never expose stack traces to DingTalk.

**Step 4: Run tests**

```powershell
pnpm --dir realtime-bridge test tests/outbound/outbound.service.test.ts
pnpm --dir realtime-bridge build
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add realtime-bridge/src/modules/outbound realtime-bridge/src/modules/desktop-ws realtime-bridge/src/modules/delivery realtime-bridge/src/app.module.ts realtime-bridge/tests/outbound
git commit -m "feat(realtime-bridge): 回发桌面端回复到钉钉"
```

## Task 9: 实现审计日志与管理查询接口

**Files:**
- Create: `realtime-bridge/src/modules/audit/audit.service.ts`
- Create: `realtime-bridge/src/modules/audit/audit.module.ts`
- Create: `realtime-bridge/src/modules/admin/admin.controller.ts`
- Create: `realtime-bridge/src/modules/admin/admin.service.ts`
- Create: `realtime-bridge/src/modules/admin/admin.module.ts`
- Modify: `realtime-bridge/src/app.module.ts`
- Test: `realtime-bridge/tests/admin/message-timeline.test.ts`

**Step 1: Write failing timeline test**

Seed audit events and assert:

```text
received -> routed -> delivered -> acked -> processing -> reply_created -> outbound_sent
```

**Step 2: Implement AuditService**

Method examples:

- `recordIngressReceived()`
- `recordRouteResolved()`
- `recordDeliveryAcked()`
- `recordProcessingStarted()`
- `recordReplyCreated()`
- `recordOutboundSent()`
- `recordFailure()`

Each method has Chinese comment and structured Chinese log.

**Step 3: Implement admin endpoint**

```text
GET /admin/messages/:messageId/timeline
GET /admin/users/:userId/online-device
GET /admin/bindings/sender/:senderStaffId
```

Protect with an internal admin token header for first version:

```text
X-MyClaw-Admin-Token
```

**Step 4: Run tests**

```powershell
pnpm --dir realtime-bridge test tests/admin/message-timeline.test.ts
pnpm --dir realtime-bridge build
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add realtime-bridge/src/modules/audit realtime-bridge/src/modules/admin realtime-bridge/src/app.module.ts realtime-bridge/tests/admin
git commit -m "feat(realtime-bridge): 增加消息链路排障接口"
```

## Task 10: Desktop 共享契约与桥接客户端骨架

**Files:**
- Create: `desktop/shared/contracts/realtime-bridge.ts`
- Modify: `desktop/shared/contracts/index.ts`
- Create: `desktop/src/main/services/realtime-bridge-client.ts`
- Create: `desktop/src/main/ipc/realtime-bridge.ts`
- Modify: `desktop/src/main/ipc/index.ts`
- Test: `desktop/tests/realtime-bridge-contract.test.ts`
- Test: `desktop/tests/realtime-bridge-client.test.ts`

**Step 1: Write failing contract test**

Assert Desktop contract exports event type constants and `BridgeInboundMessage`.

**Step 2: Write failing client test**

Mock `WebSocket` and assert:

- client sends `desktop.hello` after open.
- client sends `desktop.heartbeat`.
- client ACKs `bridge.message.received`.
- duplicate `deliveryId` is ignored after ACK.

**Step 3: Implement Desktop contract**

Keep it aligned with `realtime-bridge/src/contracts/bridge-events.ts`. Do not import service internals across workspaces.

**Step 4: Implement client skeleton**

Client methods:

- `connect()`
- `disconnect()`
- `handleBridgeMessage()`
- `sendAck()`
- `sendReplyCreated()`
- `sendProcessingFailed()`

Use `ws` dependency already present in Desktop.

**Step 5: Register IPC controls**

IPC endpoints:

```text
realtime-bridge:get-status
realtime-bridge:connect
realtime-bridge:disconnect
```

**Step 6: Run tests**

```powershell
pnpm --dir desktop test desktop/tests/realtime-bridge-contract.test.ts desktop/tests/realtime-bridge-client.test.ts
pnpm --dir desktop typecheck
```

Expected: PASS.

**Step 7: Commit**

```powershell
git add desktop/shared/contracts/realtime-bridge.ts desktop/shared/contracts/index.ts desktop/src/main/services/realtime-bridge-client.ts desktop/src/main/ipc/realtime-bridge.ts desktop/src/main/ipc/index.ts desktop/tests/realtime-bridge-contract.test.ts desktop/tests/realtime-bridge-client.test.ts
git commit -m "feat(desktop): 增加实时桥接客户端骨架"
```

## Task 11: Desktop 接入本地 session 执行链路

**Files:**
- Modify: `desktop/src/main/services/realtime-bridge-client.ts`
- Create: `desktop/src/main/services/realtime-channel-session-store.ts`
- Modify: `desktop/src/main/ipc/sessions.ts` if a narrow helper export is required
- Test: `desktop/tests/realtime-bridge-session-execution.test.ts`

**Step 1: Write failing execution test**

Mock:

- incoming `BridgeInboundMessage`
- local session mapping store
- `invokeRegisteredSessionSendMessage`
- outbound WebSocket send

Assert:

- no mapping creates a channel session mapping.
- existing mapping reuses session.
- assistant final text sends `desktop.reply_created`.
- thrown execution error sends `desktop.processing_failed`.

**Step 2: Implement session mapping store**

Store mapping under the user data directory, for example:

```text
<myClawDir>/realtime-channel-sessions.json
```

Mapping:

```ts
type RealtimeChannelSessionMapping = {
  localSessionKey: string;
  localSessionId: string;
  provider: "dingtalk";
  externalConversationId: string;
  conversationType: "direct" | "group";
  updatedAt: string;
};
```

**Step 3: Reuse existing send-message bridge**

Call `invokeRegisteredSessionSendMessage(sessionId, { content })`.

Do not create a second model or tool runtime.

**Step 4: Add per-session execution lock**

`localSessionKey -> running | queued`. Default Desktop concurrency: max 2 different sessions running at once; same session serial.

**Step 5: Run tests**

```powershell
pnpm --dir desktop test desktop/tests/realtime-bridge-session-execution.test.ts desktop/tests/realtime-bridge-client.test.ts
pnpm --dir desktop typecheck
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add desktop/src/main/services/realtime-bridge-client.ts desktop/src/main/services/realtime-channel-session-store.ts desktop/src/main/ipc/sessions.ts desktop/tests/realtime-bridge-session-execution.test.ts
git commit -m "feat(desktop): 将企业消息接入本地会话执行"
```

## Task 12: 端到端联调脚本、压测脚本与运维文档

**Files:**
- Create: `realtime-bridge/scripts/mock-dingtalk-relay.ts`
- Create: `realtime-bridge/scripts/mock-desktop-client.ts`
- Create: `realtime-bridge/scripts/loadtest-ws.ts`
- Create: `realtime-bridge/README.md`
- Modify: `docs/plans/2026-05-18-realtime-bridge-design.md` only if the implementation changes the approved design
- Test: `realtime-bridge/tests/e2e/mock-relay-to-desktop.test.ts`

**Step 1: Write failing e2e test**

Start app in test mode, connect mock Desktop, send mock DingTalk relay message, assert mock Desktop receives `bridge.message.received`, replies, and admin timeline shows completed chain.

**Step 2: Implement mock scripts**

Scripts:

```powershell
pnpm --dir realtime-bridge tsx scripts/mock-desktop-client.ts
pnpm --dir realtime-bridge tsx scripts/mock-dingtalk-relay.ts --senderStaffId staff-1 --text "测试消息"
pnpm --dir realtime-bridge tsx scripts/loadtest-ws.ts --connections 500 --duration 60
```

**Step 3: Write README**

Include:

- environment variables
- local MySQL/Redis setup
- relay payload example
- Desktop WSS protocol
- admin timeline usage
- 500 connection load test command

**Step 4: Run all relevant tests**

```powershell
pnpm --dir realtime-bridge test
pnpm --dir realtime-bridge build
pnpm --dir desktop test desktop/tests/realtime-bridge-contract.test.ts desktop/tests/realtime-bridge-client.test.ts desktop/tests/realtime-bridge-session-execution.test.ts
pnpm --dir desktop typecheck
```

Expected: PASS.

**Step 5: Run乱码门禁**

```powershell
$pattern = ([string][char]0xFFFD) + "|" + ([string][char]0x951F) + "|" + ([string][char]0x00C3) + "|" + ([string][char]0x00D0) + "|\\?/h[1-6]>"
rg -n $pattern realtime-bridge desktop/shared/contracts desktop/src/main/services desktop/src/main/ipc docs/plans
```

Expected: no output.

**Step 6: Commit**

```powershell
git add realtime-bridge/scripts realtime-bridge/README.md realtime-bridge/tests/e2e docs/plans/2026-05-18-realtime-bridge-design.md
git commit -m "test(realtime-bridge): 增加端到端联调与压测脚本"
```

## Final Verification

After all tasks are complete, run:

```powershell
pnpm --dir realtime-bridge test
pnpm --dir realtime-bridge build
pnpm --dir desktop typecheck
pnpm --dir desktop test desktop/tests/realtime-bridge-contract.test.ts desktop/tests/realtime-bridge-client.test.ts desktop/tests/realtime-bridge-session-execution.test.ts
$pattern = ([string][char]0xFFFD) + "|" + ([string][char]0x951F) + "|" + ([string][char]0x00C3) + "|" + ([string][char]0x00D0) + "|\\?/h[1-6]>"
rg -n $pattern realtime-bridge desktop/shared/contracts desktop/src/main/services desktop/src/main/ipc docs/plans
git status --short
```

Expected:

- all tests pass
- all builds/typechecks pass
-乱码门禁无输出
- only intentional files are modified or committed

## Handoff Notes

- Use `@test-driven-development` before implementing each task.
- Use `@systematic-debugging` if any test or runtime behavior is surprising.
- Use `@verification-before-completion` before claiming the implementation is complete.
- Do not route enterprise messages directly into renderer state. Always enter through Desktop main process and reuse the session execution path.
- Do not store DingTalk app secrets in Desktop. Desktop only uses bridge connection token.
