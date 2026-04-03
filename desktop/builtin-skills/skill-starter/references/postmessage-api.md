# postMessage 通信协议参考

## 宿主 -> HTML（接收消息）

### skill-data
首次加载时宿主发送的完整数据。

```javascript
{
  type: "skill-data",
  payload: {
    skillId: "skill-xxx",
    skillName: "我的技能",
    // ...你自定义的数据
  }
}
```

### skill-update
增量更新数据（结构同 skill-data）。

```javascript
{
  type: "skill-update",
  payload: { /* 更新后的数据 */ }
}
```

### skill-progress
进度通知，适用于长时间操作。

```javascript
{
  type: "skill-progress",
  current: 3,
  total: 10,
  message: "正在处理第 3 项..."
}
```

---

## HTML -> 宿主（发送消息）

### skill-callback
通用回调，通过 action 字段区分不同操作。

```javascript
window.parent.postMessage({
  type: "skill-callback",
  action: "navigate",        // 内置动作：页面导航
  data: { page: "view.html" }
}, "*");
```

### 内置 action

| action | 说明 | data |
|--------|------|------|
| `navigate` | 切换到同 Skill 下的另一个 HTML 页面 | `{ page: "xxx.html" }` |
| `refresh` | 请求宿主重新发送数据 | 无 |

### 自定义 action

你可以定义任意 action 名称，宿主会将回调事件透传给 AI 处理。

```javascript
window.parent.postMessage({
  type: "skill-callback",
  action: "submit-form",
  data: { name: "张三", email: "zhangsan@example.com" }
}, "*");
```
