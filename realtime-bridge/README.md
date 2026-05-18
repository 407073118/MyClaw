# MyClaw Realtime Bridge

Realtime Bridge 负责把钉钉中转服务收到的企业消息投递到在线 Desktop，并把 Desktop 本地 session 回复回发给钉钉中转服务。服务侧只保存路由、投递、审计和出站状态；Desktop 端不保存钉钉应用密钥。

## 环境变量

- `DATABASE_URL`: MySQL 连接串，例如 `mysql://user:pass@localhost:3306/myclaw_realtime_bridge`。
- `REDIS_URL`: Redis 连接串，默认 `redis://localhost:6379`。
- `DINGTALK_RELAY_HMAC_SECRET`: 钉钉中转入站和出站签名密钥。
- `DINGTALK_RELAY_BASE_URL`: 钉钉中转回发地址，例如 `http://localhost:5100`。
- `REALTIME_BRIDGE_DESKTOP_TOKEN`: Desktop WebSocket 建连 Token，服务端必须配置；Desktop 使用同值作为连接参数。
- `MYCLAW_ADMIN_TOKEN`: 内部排障接口 Token，服务端必须配置。
- `PORT`: HTTP 和 WebSocket 服务端口，默认由启动脚本或 Nest 配置决定。

## 本地 MySQL/Redis

1. 启动 MySQL，创建库 `myclaw_realtime_bridge`。
2. 设置 `DATABASE_URL`。
3. 执行 `pnpm --dir realtime-bridge prisma validate` 确认 schema 可用。
4. 启动 Redis，或设置 `REDIS_URL` 指向已有实例。
5. 启动服务：`pnpm --dir realtime-bridge dev`。

## 钉钉中转载荷

入站接口：

```http
POST /v1/ingress/dingtalk/message
X-MyClaw-Timestamp: <milliseconds>
X-MyClaw-Nonce: <uuid>
X-MyClaw-Signature: <hmac-sha256>
```

示例 JSON：

```json
{
  "provider": "dingtalk",
  "externalMessageId": "msg-1",
  "senderStaffId": "staff-1",
  "externalConversationId": "cid-1",
  "conversationType": "direct",
  "content": { "type": "text", "text": "测试消息" },
  "traceId": "trace-1"
}
```

签名基串为 `{timestamp}.{nonce}.{sha256(body)}`，使用 `DINGTALK_RELAY_HMAC_SECRET` 做 HMAC-SHA256。

本地模拟：

```powershell
pnpm --dir realtime-bridge tsx scripts/mock-dingtalk-relay.ts --senderStaffId staff-1 --text "测试消息"
```

## Desktop WebSocket 协议

Desktop 连接：

```text
ws://localhost:4300/v1/desktop/ws?token=<REALTIME_BRIDGE_DESKTOP_TOKEN>
```

Desktop 上行：

- `desktop.hello`: `{ userId, deviceId, connectionId? }`
- `desktop.heartbeat`: `{ deviceId, sentAt }`
- `desktop.ack`: `{ messageId, deliveryId }`
- `desktop.processing_started`: `{ messageId, deliveryId }`
- `desktop.reply_created`: `{ messageId, deliveryId, content }`
- `desktop.processing_failed`: `{ messageId, deliveryId, reason }`

Bridge 下行：

- `bridge.message.received`: 包含 `messageId`、`deliveryId`、`content`、`localSessionKey` 和路由字段。

本地 Desktop 模拟：

```powershell
pnpm --dir realtime-bridge tsx scripts/mock-desktop-client.ts --connectionToken desktop-token --userId user-1 --deviceId device-1
```

## 管理排障

消息时间线：

```powershell
curl -H "X-MyClaw-Admin-Token: <MYCLAW_ADMIN_TOKEN>" http://localhost:4300/admin/messages/<messageId>/timeline
```

在线设备：

```powershell
curl -H "X-MyClaw-Admin-Token: <MYCLAW_ADMIN_TOKEN>" http://localhost:4300/admin/users/<userId>/online-device
```

发送人绑定：

```powershell
curl -H "X-MyClaw-Admin-Token: <MYCLAW_ADMIN_TOKEN>" http://localhost:4300/admin/bindings/sender/<senderStaffId>
```

## 压测

模拟 500 条 Desktop 长连接并持续 60 秒：

```powershell
pnpm --dir realtime-bridge tsx scripts/loadtest-ws.ts --connectionToken desktop-token --connections 500 --duration 60
```

压测脚本会输出成功打开连接数、关闭数、错误数和发送消息数。压测前请确认 Redis、系统文件句柄和服务端口容量足够。
