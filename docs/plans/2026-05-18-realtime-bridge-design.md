# Realtime Bridge 设计方案

## 背景

MyClaw 目前已经有 `desktop/` 和 `cloud/` 两个主要工作区：Desktop 负责本地 Agent runtime、会话、Skills、MCP、工具执行和审批；Cloud 负责认证、Hub、工件和安装留痕。现在要补齐的是企业 IM 到个人 Desktop Agent 的实时入口。

目标场景不是“每个用户配置一个钉钉机器人”，而是企业内只有一个统一钉钉机器人。每个员工都可以和这个机器人单聊，或在群里 @ 这个机器人；系统根据钉钉消息里的发送人和会话信息，把消息路由到对应 MyClaw 用户的主 Desktop，由本地 Agent 执行，再把结果回到钉钉原会话。

本方案新增独立后端服务 `realtime-bridge`，位于现有钉钉消息中转服务和 MyClaw Desktop 之间。它不直接承接钉钉官方公网回调，也不运行模型和工具，而是负责消息标准化、用户路由、Desktop 长连接、投递状态、ACK、重试、离线队列和审计排障。

参考资料：

- [钉钉接收消息类型](https://opensource.dingtalk.com/developerpedia/docs/learn/bot/message)
- [钉钉 Stream 协议](https://opensource.dingtalk.com/developerpedia/docs/learn/stream/protocol/)
- [OpenClaw Channels](https://openclawdoc.com/docs/channels/overview/)
- [OpenClaw use cases](https://openclaw.rocks/blog/openclaw-use-cases)

## 目标

1. 支持企业内一个统一钉钉机器人服务多名 MyClaw 用户。
2. 支持钉钉单聊按 `senderStaffId` 路由到对应用户主 Desktop。
3. 支持钉钉群聊通过 @机器人、`/ai`、回复机器人消息触发。
4. 支持群聊默认按发送人路由，并允许群或会话级显式绑定覆盖。
5. 支持每个 MyClaw 用户一台主 Desktop 在线执行。
6. 支持文本消息从钉钉进入 Desktop Agent，再回到钉钉的完整闭环。
7. 支持消息幂等、投递 ACK、执行状态、回发状态、失败排障和基础审计。
8. 支持 500 人内测规模，按多实例部署方式设计。

## 非目标

- 不重新实现钉钉官方回调、Stream 连接和公网接入；这部分继续由现有钉钉中转服务负责。
- 不在 `realtime-bridge` 中运行 LLM、MCP 工具或本地文件操作。
- 不做完整 IM 产品，不做聊天 UI。
- 第一版不做多组织或多租户隔离。
- 第一版不做多 Desktop 协同；每个用户只保留一台主 Desktop。
- 第一版不完整支持图片、文件和卡片执行；可以入库 metadata 并提示暂不支持。

## 总体架构

```text
钉钉
  -> 现有钉钉消息中转服务
  -> realtime-bridge
  -> Desktop WebSocket 长连接
  -> Desktop session / Agent runtime
  -> realtime-bridge
  -> 钉钉消息中转服务
  -> 钉钉
```

`realtime-bridge` 是第三个独立工作区。它可以复用 Cloud 的登录态和用户体系，但不合并进 `cloud-api`。Cloud 继续管理账号、Hub 和未来配置入口；Desktop 继续管理本地 Agent runtime、会话、工具、MCP 和审批。

## 模块拆分

```text
realtime-bridge/
  package.json
  tsconfig.json
  prisma/
    schema.prisma
  src/
    main.ts
    app.module.ts
    modules/
      ingress/
      desktop-ws/
      routing/
      conversation/
      delivery/
      outbound/
      audit/
      health/
    contracts/
      bridge-events.ts
      channel-message.ts
    infra/
      redis/
      prisma/
    common/
      logger/
      crypto/
      errors/
      guards/
  tests/
    unit/
    integration/
```

模块职责：

| 模块 | 职责 |
|---|---|
| `ingress` | 接收钉钉中转服务推送，校验 HMAC，幂等去重，标准化 payload，写入 `inbound_message`。 |
| `desktop-ws` | 管理 Desktop WSS 连接、`hello`、心跳、ACK、reply、断线清理。 |
| `routing` | 根据 `senderStaffId`、`conversationId`、群/会话绑定找到 MyClaw 用户和主 Desktop。 |
| `conversation` | 维护钉钉外部会话与 Desktop 本地 `localSessionKey` 的关系。 |
| `delivery` | 投递消息到 Desktop，维护 ACK、超时、重试和离线队列。 |
| `outbound` | 接收 Desktop 回复，调用钉钉中转服务回发原会话。 |
| `audit` | 记录消息进入、路由、投递、执行、回发、失败和人工处理日志。 |
| `health` | 健康检查、依赖检查和基础指标输出。 |

## 数据模型

第一版使用 MySQL + Redis。MySQL 存长期事实，Redis 存在线状态、幂等短缓存和投递队列。

核心表：

```text
channel_bot
channel_account
channel_conversation
channel_binding
desktop_device
inbound_message
delivery_attempt
outbound_message
audit_log
```

`channel_bot` 记录企业统一钉钉机器人配置，不按用户拆分。

`channel_account` 记录钉钉成员到 MyClaw 用户的绑定。核心字段包括 `provider`、`senderStaffId`、`unionId`、`myclawUserId`、`enabled`。

`channel_conversation` 记录外部会话。核心字段包括 `provider`、`externalConversationId`、`conversationType`、`title`、`lastMessageAt`。

`channel_binding` 记录路由覆盖规则。它可以表达“某个群固定交给某个用户”或“某个会话固定交给某个硅基员工”。默认没有绑定时按 `senderStaffId` 路由。

`desktop_device` 记录用户主 Desktop。第一版每个用户只允许一台 `active` 设备，新设备上线时可以挤下旧设备或把旧设备置为 `inactive`。

`inbound_message` 记录入站消息事实和状态，唯一键建议为 `provider + externalMessageId`，缺少外部 ID 时使用 payload hash。

`delivery_attempt` 记录每一次投递 Desktop 的尝试，包括 `deviceId`、`wsConnectionId`、`sentAt`、`ackedAt`、`timeoutAt` 和失败原因。

`outbound_message` 记录 Desktop 回复和钉钉回发状态。

`audit_log` 记录全链路审计事件。

建议索引：

```text
inbound_message(provider, external_message_id)
inbound_message(status, created_at)
channel_account(provider, sender_staff_id)
channel_conversation(provider, external_conversation_id)
channel_binding(provider, external_conversation_id)
delivery_attempt(inbound_message_id)
outbound_message(inbound_message_id)
```

Redis key：

```text
online:device:{deviceId}
online:user:{userId}
ws:connection:{connectionId}
route:device:{deviceId}
dedupe:message:{key}
queue:delivery
```

## 路由规则

正式模型是“企业统一钉钉机器人，多用户按发送人路由”。

默认链路：

```text
DingTalk senderStaffId
  -> channel_account
  -> myclawUserId
  -> desktop_device(active)
  -> Desktop WSS
```

群聊路由优先级：

```text
群/会话显式绑定 > senderStaffId 用户绑定 > 未绑定提示
```

单聊行为：

- 用户与统一机器人单聊。
- bridge 使用 `senderStaffId` 找到 MyClaw 用户。
- 消息进入该用户主 Desktop。
- 同一个外部单聊会话映射到稳定的 `localSessionKey`。

群聊触发规则：

- @机器人 + 指令。
- `/ai` 指令。
- 回复机器人上一条消息。

群聊默认按发送人路由。即同一个群里，不同员工 @ 机器人，会分别进入各自 Desktop Agent。群聊显式绑定可覆盖默认行为，例如把某个群固定交给一个负责人或一个团队 Agent。

本地 session key 建议：

```text
dingtalk:direct:{externalConversationId}:user:{myclawUserId}
dingtalk:group:{externalConversationId}:user:{myclawUserId}
dingtalk:group:{externalConversationId}:owner:{ownerUserId}
```

## 消息协议

Desktop 主进程主动连接 bridge：

```text
desktop.hello
desktop.heartbeat
desktop.ack
desktop.processing_started
desktop.reply_created
desktop.processing_failed
desktop.error
```

bridge 推送给 Desktop：

```text
bridge.welcome
bridge.message.received
bridge.message.cancelled
bridge.reconnect_required
bridge.config.updated
```

核心入站消息：

```ts
export type BridgeInboundMessage = {
  type: "bridge.message.received";
  deliveryId: string;
  messageId: string;
  provider: "dingtalk";
  conversation: {
    id: string;
    type: "direct" | "group";
    title?: string;
  };
  sender: {
    senderStaffId: string;
    senderNick?: string;
    mappedUserId?: string;
  };
  content: {
    type: "text" | "image" | "file" | "unknown";
    text?: string;
    raw?: unknown;
  };
  routing: {
    myclawUserId: string;
    desktopDeviceId: string;
    localSessionKey: string;
  };
  traceId: string;
  createdAt: string;
};
```

Desktop 回包：

```ts
export type DesktopReplyCreated = {
  type: "desktop.reply_created";
  deliveryId: string;
  messageId: string;
  traceId: string;
  content: {
    type: "text";
    text: string;
  };
  localSessionId: string;
  createdAt: string;
};
```

## ACK 与状态机

ACK 分三层，不能混在一起。

第一层是 Ingress ACK。钉钉中转服务推送消息后，bridge 完成签名校验、幂等检查、落库后立即返回成功，不等待 Desktop 和模型。

第二层是 Delivery ACK。bridge 推送 `bridge.message.received` 后，Desktop 在 5-10 秒内回 `desktop.ack`。超时则写入失败投递记录并进入重试或离线策略。

第三层是 Processing Result。Desktop 开始执行后回 `desktop.processing_started`，成功后回 `desktop.reply_created`，失败后回 `desktop.processing_failed`。

`inbound_message.status` 建议：

```text
received
routed
queued
delivered
processing
completed
failed
expired
```

重试策略：

```text
投递 Desktop：最多 3 次，间隔 2s / 5s / 15s
回发钉钉：最多 3 次，间隔 1s / 5s / 30s
Desktop 执行：不由 bridge 自动重试，避免重复执行本地工具
```

离线策略：

- 主 Desktop 在线：立即投递。
- 主 Desktop 不在线：消息入库，状态 `queued`。
- 排队超过 3 分钟：回钉钉提示桌面端不在线或消息已排队。
- 排队超过 30 分钟：状态改为 `expired`。
- Desktop 重连后：拉取未过期 queued 消息。

同一个 `localSessionKey` 默认同一时间只执行一条消息。后续消息排队，避免同一会话并发导致上下文乱序。

## 安全与鉴权

钉钉中转服务调用 bridge 使用 HMAC 签名：

```text
X-MyClaw-Relay-Id
X-MyClaw-Timestamp
X-MyClaw-Nonce
X-MyClaw-Signature
```

签名内容包含 body hash、时间戳和 nonce。时间窗口建议 5 分钟，nonce 存 Redis 防重放。

Desktop 连接 bridge 使用短期 connection token：

```text
Desktop 登录 Cloud
Desktop 请求 bridge connection token
Desktop 用 token 建立 WSS
bridge 校验 token，绑定 userId/deviceId
```

connection token 只用于建立连接，有效期建议 10 分钟。断线重连时重新换 token。

钉钉用户绑定必须显式完成。第一版支持三种方式：

- 管理员导入 `senderStaffId -> myclawUserId`。
- 用户在 Desktop 中输入或扫码绑定码。
- 用户在钉钉里发送 `/bind code` 完成绑定。

基础开关：

```text
user.enabled
device.enabled
channel_account.enabled
channel_binding.enabled
allow_group_message
allow_direct_message
```

bridge 不能绕过 Desktop 现有审批系统。文件、命令、MCP、浏览器等高风险操作仍然由 Desktop runtime 和 ApprovalPolicy 控制。

## Desktop 接入

Desktop 新增主进程服务：

```text
desktop/src/main/services/realtime-bridge-client.ts
desktop/shared/contracts/realtime-bridge.ts
desktop/src/main/ipc/realtime-bridge.ts
```

`RealtimeBridgeClient` 职责：

- 读取 Cloud 登录状态。
- 获取 bridge connection token。
- 建立 WSS 长连接。
- 发送 `desktop.hello` 注册用户和设备。
- 维护心跳和自动重连。
- 收到 `bridge.message.received` 后 ACK。
- 根据 `localSessionKey` 找到或创建本地 session。
- 调用现有 session 主链路执行。
- 执行完成后发送 `desktop.reply_created`。
- 执行失败后发送 `desktop.processing_failed`。

Desktop 不新增第二套 Agent runtime，必须复用当前 `session:send-message` 主链路。当前 Desktop 已有可复用入口 `invokeRegisteredSessionSendMessage`，后续由 `RealtimeBridgeClient` 调用。

远程消息进入模型前可以包装为：

```text
来自钉钉群「{conversationTitle}」的消息，发送人：{senderNick}
用户消息：
{text}
```

同时保留 channel metadata：

```ts
export type RealtimeChannelContext = {
  provider: "dingtalk";
  deliveryId: string;
  externalMessageId: string;
  externalConversationId: string;
  conversationType: "direct" | "group";
  senderStaffId: string;
  senderNick?: string;
  traceId: string;
};
```

第一版可以把 `localSessionKey -> localSessionId` 存在 Desktop 本地映射文件。bridge 不强依赖 Desktop 本地 session ID，因为用户重装或清数据后本地 session ID 可能变化。

## 容量与部署

500 人内测规模可由 NestJS + MySQL + Redis 承载。bridge 不运行模型，不执行工具，只管理连接和消息状态。

建议生产形态：

```text
Nginx / LB
  -> realtime-bridge x 2
  -> Redis
  -> MySQL
  -> 钉钉中转服务
```

容量目标：

- 500 个 Desktop 长连接。
- 常规 20 QPS 入站消息。
- 突发 100 QPS 入站消息。
- `bridge -> Desktop` P95 投递延迟小于 500ms，不含模型执行时间。

多实例路由：

```text
deviceId -> bridgeInstanceId
connectionId -> deviceId
bridgeInstanceId -> pub/sub channel
```

500 人阶段 Redis Pub/Sub 足够；如果需要可靠消费记录，可升级到 Redis Stream。

## 观测与内测运营

第一版必须把排障能力当作产品能力建设。所有日志带：

```text
traceId
messageId
deliveryId
externalConversationId
senderStaffId
myclawUserId
deviceId
localSessionKey
```

核心指标：

```text
bridge_ws_online_devices
bridge_ingress_messages_total
bridge_delivery_ack_latency_ms
bridge_delivery_success_rate
bridge_processing_duration_ms
bridge_outbound_success_rate
bridge_message_status_count
bridge_ws_reconnect_total
bridge_dead_letter_total
```

第一版可以不做完整管理前端，但要有后端查询接口或 CLI：

- 查某条钉钉消息的 timeline。
- 查某个用户是否在线。
- 查某个 `senderStaffId` 绑定到了谁。
- 查某个群是否有显式绑定。
- 重放一条未完成消息。
- 手动把消息标记为 `expired`。
- 查看失败 TopN。

建议提供：

```text
GET /admin/messages/:messageId/timeline
```

返回：

```text
received -> routed -> delivered -> acked -> processing -> reply_created -> outbound_sent
```

## 测试与压测

测试分层：

```text
unit：路由规则、签名校验、幂等 key、状态机转换
integration：Ingress -> DB -> Redis -> WS -> Desktop mock
contract：钉钉中转 payload、bridge event、Desktop reply 协议
e2e：真实 Desktop + 测试钉钉群 + 测试中转服务
```

压测场景：

- 500 个 WebSocket 长连接空闲心跳。
- 500 个连接同时重连。
- 100 QPS 入站消息。
- 单用户同一会话连续 20 条消息，验证执行锁和排队。
- 钉钉中转服务失败，验证 outbound 重试。
- Desktop 离线 10 分钟后上线，验证 queued 消息拉取。
- 重复推送同一消息，验证不会重复执行 Agent。

## 里程碑

```text
第 1 周：项目骨架、Prisma/MySQL、Redis、HMAC ingress、基础表
第 2 周：Desktop WSS、设备注册、心跳、在线状态、断线重连
第 3 周：senderStaffId 用户绑定、单聊/群聊路由、消息投递 ACK
第 4 周：Desktop 接入现有 session:send-message，打通完整回复闭环
第 5 周：离线队列、重试、幂等、执行锁、失败回执
第 6 周：日志、监控、压测、内测运营工具、灰度配置
```

现实周期判断：

- 4 周可以打通小范围内测闭环。
- 6 周可以做到较稳的内测版本。
- 后续再补飞书、文件、图片、卡片、Cloud 管理台、多设备协同和多组织隔离。

## 待确认问题

1. 钉钉中转服务传给 bridge 的标准化 payload 是否已包含 `senderStaffId`、`conversationId`、`conversationType`、`msgId`、`sessionWebhook`。
2. `senderStaffId -> myclawUserId` 第一版采用管理员导入，还是用户 `/bind code` 自助绑定。
3. 群聊显式绑定第一版是否需要支持绑定到硅基员工，还是只绑定到 MyClaw 用户。
4. Desktop 离线超过 3 分钟后，钉钉侧提示文案是否由 bridge 固定，还是由钉钉中转服务统一渲染。
5. bridge connection token 由 Cloud API 发行，还是由 realtime-bridge 调用 Cloud 校验登录态后自行发行。
