/** 渲染实时桥接管理台 HTML，提供无需前端构建链的维护入口。 */
export function renderAdminConsolePage(): string {
  console.info("[admin-ui] 开始渲染实时桥接管理台页面");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>实时桥接控制台</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #020407;
      --panel: #0b1117;
      --panel-2: #0f1720;
      --text: #f8fafc;
      --muted: #94a3b8;
      --line: rgba(148, 163, 184, 0.18);
      --green: #00dc82;
      --green-strong: #00b86b;
      --green-soft: rgba(0, 220, 130, 0.16);
      --cyan: #38bdf8;
      --amber: #fbbf24;
      --red: #fb7185;
      --shadow: 0 24px 70px rgba(0, 0, 0, 0.38);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 18% 0%, rgba(0, 220, 130, 0.2), transparent 34rem),
        radial-gradient(circle at 85% 12%, rgba(56, 189, 248, 0.12), transparent 30rem),
        linear-gradient(180deg, #020407 0%, #07100d 42%, #020407 100%);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }

    button,
    input {
      font: inherit;
      letter-spacing: 0;
    }

    button {
      min-height: 40px;
      border: 0;
      border-radius: 8px;
      padding: 0 14px;
      background: linear-gradient(135deg, var(--green), #7cffc4);
      color: #03130c;
      font-weight: 750;
      cursor: pointer;
      box-shadow: 0 12px 28px rgba(0, 220, 130, 0.22);
      transition: transform 140ms ease, box-shadow 140ms ease, background 140ms ease;
    }

    button:hover {
      transform: translateY(-1px);
      box-shadow: 0 16px 34px rgba(0, 220, 130, 0.3);
    }

    button.secondary {
      border: 1px solid var(--line);
      background: rgba(15, 23, 32, 0.86);
      color: var(--text);
      box-shadow: none;
    }

    input {
      width: 100%;
      min-height: 42px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(2, 6, 11, 0.72);
      color: var(--text);
      outline: 0;
      padding: 0 12px;
    }

    input:focus {
      border-color: rgba(0, 220, 130, 0.82);
      box-shadow: 0 0 0 3px rgba(0, 220, 130, 0.16);
    }

    .shell {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
      padding: 28px 0 48px;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      padding: 12px 0 28px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 800;
    }

    .mark {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      background:
        linear-gradient(135deg, var(--green), #9fffd5);
      box-shadow: inset 0 -10px 16px rgba(3, 19, 12, 0.24), 0 10px 26px rgba(0, 220, 130, 0.28);
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 34px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 0 12px;
      background: rgba(11, 17, 23, 0.74);
      color: var(--muted);
      font-size: 13px;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--amber);
      box-shadow: 0 0 18px currentColor;
    }

    .dot.ok {
      background: var(--green);
    }

    .dot.bad {
      background: var(--red);
    }

    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
      gap: 24px;
      align-items: stretch;
      margin-bottom: 24px;
    }

    .hero-main,
    .console-card,
    .result-panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(11, 17, 23, 0.78);
      box-shadow: var(--shadow);
      backdrop-filter: blur(18px);
    }

    .hero-main {
      position: relative;
      overflow: hidden;
      min-height: 286px;
      padding: 34px;
    }

    .hero-main::after {
      content: "";
      position: absolute;
      inset: auto -12% -52% 20%;
      height: 220px;
      background: linear-gradient(90deg, transparent, rgba(0, 220, 130, 0.34), transparent);
      filter: blur(48px);
      transform: rotate(-6deg);
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 18px;
      color: var(--green);
      font-size: 13px;
      font-weight: 800;
      text-transform: uppercase;
    }

    h1 {
      position: relative;
      margin: 0;
      max-width: 760px;
      font-size: clamp(38px, 5vw, 72px);
      line-height: 0.96;
      letter-spacing: 0;
      z-index: 1;
    }

    .hero-copy {
      position: relative;
      max-width: 680px;
      margin: 18px 0 0;
      color: var(--muted);
      font-size: 16px;
      line-height: 1.7;
      z-index: 1;
    }

    .code-panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(2, 6, 11, 0.86);
      overflow: hidden;
    }

    .code-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 44px;
      padding: 0 14px;
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      font-size: 13px;
    }

    .window-dots {
      display: flex;
      gap: 6px;
    }

    .window-dots span {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--line);
    }

    .code-body {
      margin: 0;
      padding: 18px;
      color: #cbd5e1;
      font: 13px/1.8 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      white-space: pre-wrap;
    }

    .code-body b {
      color: var(--green);
      font-weight: 800;
    }

    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
      align-items: start;
    }

    .console-card {
      min-height: 252px;
      padding: 20px;
    }

    .wide {
      grid-column: 1 / -1;
    }

    .card-head {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      align-items: flex-start;
      margin-bottom: 18px;
    }

    h2 {
      margin: 0;
      font-size: 18px;
      line-height: 1.25;
    }

    .card-note {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }

    .form-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      margin-bottom: 14px;
    }

    .stack {
      display: grid;
      gap: 10px;
    }

    .result-panel {
      min-height: 132px;
      max-height: 340px;
      overflow: auto;
      padding: 14px;
      background: rgba(2, 6, 11, 0.58);
      box-shadow: none;
    }

    .empty {
      color: var(--muted);
      font-size: 13px;
    }

    .json {
      margin: 0;
      font: 12px/1.7 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      color: #dbeafe;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .kv-list {
      display: grid;
      gap: 10px;
    }

    .kv-row {
      display: grid;
      grid-template-columns: 118px minmax(0, 1fr);
      gap: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: rgba(15, 23, 32, 0.54);
    }

    .kv-label {
      color: var(--muted);
      font-size: 13px;
    }

    .kv-value {
      color: var(--text);
      font-size: 13px;
      font-weight: 750;
      word-break: break-word;
    }

    .timeline {
      display: grid;
      gap: 10px;
    }

    .timeline-item {
      display: grid;
      grid-template-columns: 132px minmax(0, 1fr);
      gap: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: rgba(15, 23, 32, 0.54);
    }

    .event-type {
      color: var(--green);
      font: 12px/1.4 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      word-break: break-word;
    }

    .event-message {
      margin: 0;
      color: var(--text);
      font-size: 13px;
      line-height: 1.5;
    }

    .event-time {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
    }

    .footer {
      margin-top: 18px;
      color: var(--muted);
      font-size: 12px;
      text-align: center;
    }

    @media (max-width: 900px) {
      .hero,
      .grid {
        grid-template-columns: 1fr;
      }

      .hero-main {
        min-height: auto;
        padding: 26px;
      }
    }

    @media (max-width: 560px) {
      .shell {
        width: min(100% - 20px, 1180px);
        padding-top: 18px;
      }

      .topbar {
        align-items: flex-start;
        flex-direction: column;
      }

      .form-row,
      .timeline-item,
      .kv-row {
        grid-template-columns: 1fr;
      }

      .card-head {
        align-items: stretch;
        flex-direction: column;
      }

      .card-head button {
        width: 100%;
      }

      h1 {
        font-size: 36px;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="mark" aria-hidden="true"></div>
        <span>实时桥接控制台</span>
      </div>
      <div class="status-pill" id="service-status"><span class="dot" id="service-dot"></span><span id="service-text">检查中</span></div>
    </header>

    <section class="hero">
      <div class="hero-main">
        <p class="eyebrow">MyClaw / 钉钉消息桥接</p>
        <h1>实时桥接控制台</h1>
        <p class="hero-copy">维护钉钉中转、桌面端在线连接、入站投递和出站回复链路的轻量控制台。</p>
      </div>

      <aside class="code-panel" aria-label="运行状态摘要">
        <div class="code-head">
          <span>桥接运行时</span>
          <div class="window-dots" aria-hidden="true"><span></span><span></span><span></span></div>
        </div>
        <pre class="code-body"><b>健康检查</b> 服务是否在线
<b>桌面长连接</b> 桌面端连接入口
<b>消息时间线</b> 查看入站到回发全过程
<b>在线设备</b> 查看用户当前桌面端
<b>发送人绑定</b> 查看钉钉员工号绑定</pre>
      </aside>
    </section>

    <section class="grid" aria-label="维护工具">
      <article class="console-card wide">
        <div class="card-head">
          <div>
            <h2>管理令牌</h2>
            <p class="card-note">请求管理接口时会写入内部管理令牌请求头。</p>
          </div>
          <button class="secondary" type="button" id="health-button">刷新健康状态</button>
        </div>
        <div class="form-row">
          <input id="admin-token" type="password" autocomplete="off" placeholder="请输入管理令牌">
          <button type="button" id="save-token">保存</button>
        </div>
        <div class="result-panel" id="token-result"><span class="empty">管理令牌只保存在当前浏览器。</span></div>
      </article>

      <article class="console-card">
        <div class="card-head">
          <div>
            <h2>消息时间线</h2>
            <p class="card-note">按审计事件顺序查看单条入站消息链路。</p>
          </div>
        </div>
        <div class="form-row">
          <input id="message-id" type="text" placeholder="消息编号，例如 message-1">
          <button type="button" id="timeline-button">查询</button>
        </div>
        <div class="result-panel" id="timeline-result"><span class="empty">输入消息编号后查询。</span></div>
      </article>

      <article class="console-card">
        <div class="card-head">
          <div>
            <h2>在线设备</h2>
            <p class="card-note">查看指定用户当前活跃的桌面端设备。</p>
          </div>
        </div>
        <div class="form-row">
          <input id="user-id" type="text" placeholder="用户编号，例如 user-1">
          <button type="button" id="device-button">查询</button>
        </div>
        <div class="result-panel" id="device-result"><span class="empty">输入用户编号后查询。</span></div>
      </article>

      <article class="console-card wide">
        <div class="card-head">
          <div>
            <h2>发送人绑定</h2>
            <p class="card-note">确认钉钉发送人员工号是否已经绑定到用户。</p>
          </div>
        </div>
        <div class="form-row">
          <input id="sender-staff-id" type="text" placeholder="发送人员工号，例如 staff-1">
          <button type="button" id="binding-button">查询</button>
        </div>
        <div class="result-panel" id="binding-result"><span class="empty">输入发送人员工号后查询。</span></div>
      </article>
    </section>

    <p class="footer">实时桥接控制台 · Nuxt 风格深色界面</p>
  </main>

  <script>
    const state = {
      tokenKey: "myclaw.realtimeBridge.adminToken"
    };

    /** 输出结构化调试日志，方便排查前端维护操作。 */
    function logUi(message, metadata) {
      console.info("[admin-ui] " + message, metadata || {});
    }

    /** 读取 DOM 元素，缺失时抛出明确错误。 */
    function getElement(id) {
      const element = document.getElementById(id);
      if (!element) {
        console.error("[admin-ui] 页面元素缺失", { id });
        throw new Error("missing element: " + id);
      }
      return element;
    }

    /** 读取当前管理令牌。 */
    function getToken() {
      const token = getElement("admin-token").value.trim();
      logUi("读取管理令牌完成", { hasToken: Boolean(token) });
      return token;
    }

    /** 渲染 JSON 结果面板。 */
    function renderJson(targetId, data) {
      const target = getElement(targetId);
      target.innerHTML = "<pre class=\\"json\\"></pre>";
      target.querySelector("pre").textContent = JSON.stringify(data, null, 2);
      logUi("JSON 结果渲染完成", { targetId });
    }

    /** 渲染中文键值摘要，避免维护人员直接阅读原始接口字段。 */
    function renderKeyValue(targetId, rows) {
      const target = getElement(targetId);
      target.innerHTML = "<div class=\\"kv-list\\"></div>";
      const list = target.querySelector(".kv-list");
      for (const row of rows) {
        const item = document.createElement("div");
        item.className = "kv-row";
        const label = document.createElement("div");
        label.className = "kv-label";
        label.textContent = row.label;
        const value = document.createElement("div");
        value.className = "kv-value";
        value.textContent = row.value || "-";
        item.append(label, value);
        list.append(item);
      }
      logUi("中文键值摘要渲染完成", { targetId, count: rows.length });
    }

    /** 渲染空状态或错误状态。 */
    function renderMessage(targetId, message, tone) {
      const target = getElement(targetId);
      target.innerHTML = "<span class=\\"empty\\"></span>";
      const empty = target.querySelector("span");
      empty.textContent = message;
      empty.style.color = tone === "error" ? "var(--red)" : "var(--muted)";
      logUi("提示信息渲染完成", { targetId, tone: tone || "muted" });
    }

    /** 统一请求后端接口，并携带可选管理令牌。 */
    async function requestJson(path, options) {
      const headers = { "Accept": "application/json" };
      if (options && options.admin) {
        const token = getToken();
        if (!token) {
          console.warn("[admin-ui] 缺少管理令牌，停止请求", { path });
          throw new Error("请先填写管理令牌");
        }
        headers["X-MyClaw-Admin-Token"] = token;
      }

      logUi("开始请求后端接口", { path, admin: Boolean(options && options.admin) });
      const response = await fetch(path, { headers });
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) {
        console.warn("[admin-ui] 后端接口返回失败", { path, status: response.status });
        throw new Error(data.message || "请求失败: " + response.status);
      }
      logUi("后端接口请求成功", { path, status: response.status });
      return data;
    }

    /** 刷新服务健康状态徽标。 */
    async function refreshHealth() {
      const dot = getElement("service-dot");
      const text = getElement("service-text");
      try {
        const data = await requestJson("/health");
        dot.className = "dot ok";
        text.textContent = "服务在线";
        renderMessage("token-result", "健康检查通过，桥接服务正在运行。");
      } catch (error) {
        dot.className = "dot bad";
        text.textContent = "服务离线";
        renderMessage("token-result", error.message, "error");
      }
    }

    /** 翻译审计事件类型，让时间线面板优先展示中文状态。 */
    function translateEventType(eventType) {
      const labels = {
        received: "已接收",
        routed: "已路由",
        delivered: "已投递",
        acked: "已确认",
        processing: "处理中",
        reply_created: "已生成回复",
        outbound_sent: "已回发",
        failed: "处理失败"
      };
      return labels[eventType] || eventType || "未知事件";
    }

    /** 查询消息链路时间线并渲染为列表。 */
    async function queryTimeline() {
      const messageId = getElement("message-id").value.trim();
      if (!messageId) {
        renderMessage("timeline-result", "请先输入消息编号。");
        return;
      }
      try {
        const data = await requestJson("/admin/messages/" + encodeURIComponent(messageId) + "/timeline", { admin: true });
        const target = getElement("timeline-result");
        const events = Array.isArray(data.events) ? data.events : [];
        if (events.length === 0) {
          renderMessage("timeline-result", "没有找到时间线事件。");
          return;
        }
        target.innerHTML = "<div class=\\"timeline\\"></div>";
        const timeline = target.querySelector(".timeline");
        for (const event of events) {
          const item = document.createElement("div");
          item.className = "timeline-item";
          const eventType = document.createElement("div");
          eventType.className = "event-type";
          eventType.textContent = translateEventType(event.eventType);
          const body = document.createElement("div");
          const message = document.createElement("p");
          message.className = "event-message";
          message.textContent = event.message || "";
          const time = document.createElement("div");
          time.className = "event-time";
          time.textContent = event.createdAt ? new Date(event.createdAt).toLocaleString() : "";
          body.append(message, time);
          item.append(eventType, body);
          timeline.append(item);
        }
        logUi("消息时间线渲染完成", { messageId, count: events.length });
      } catch (error) {
        renderMessage("timeline-result", error.message, "error");
      }
    }

    /** 查询用户在线设备。 */
    async function queryOnlineDevice() {
      const userId = getElement("user-id").value.trim();
      if (!userId) {
        renderMessage("device-result", "请先输入用户编号。");
        return;
      }
      try {
        const data = await requestJson("/admin/users/" + encodeURIComponent(userId) + "/online-device", { admin: true });
        renderKeyValue("device-result", [
          { label: "用户编号", value: data.userId || userId },
          { label: "桌面设备", value: data.desktopDeviceId || "暂无在线设备" }
        ]);
      } catch (error) {
        renderMessage("device-result", error.message, "error");
      }
    }

    /** 查询钉钉发送人绑定。 */
    async function querySenderBinding() {
      const senderStaffId = getElement("sender-staff-id").value.trim();
      if (!senderStaffId) {
        renderMessage("binding-result", "请先输入发送人员工号。");
        return;
      }
      try {
        const data = await requestJson("/admin/bindings/sender/" + encodeURIComponent(senderStaffId), { admin: true });
        if (!data) {
          renderMessage("binding-result", "没有找到发送人绑定。");
          return;
        }
        renderKeyValue("binding-result", [
          { label: "绑定状态", value: data.enabled === false ? "已禁用" : "已启用" },
          { label: "渠道", value: data.provider === "dingtalk" ? "钉钉" : data.provider },
          { label: "发送人员工号", value: data.senderStaffId || senderStaffId },
          { label: "用户编号", value: data.myclawUserId },
          { label: "显示名称", value: data.displayName || "-" }
        ]);
      } catch (error) {
        renderMessage("binding-result", error.message, "error");
      }
    }

    /** 初始化页面状态、绑定事件并自动检查健康状态。 */
    function bootConsole() {
      const savedToken = localStorage.getItem(state.tokenKey) || "";
      getElement("admin-token").value = savedToken;
      getElement("save-token").addEventListener("click", function () {
        localStorage.setItem(state.tokenKey, getToken());
        renderMessage("token-result", "管理令牌已保存到当前浏览器。");
      });
      getElement("health-button").addEventListener("click", refreshHealth);
      getElement("timeline-button").addEventListener("click", queryTimeline);
      getElement("device-button").addEventListener("click", queryOnlineDevice);
      getElement("binding-button").addEventListener("click", querySenderBinding);
      logUi("实时桥接管理台初始化完成", { hasSavedToken: Boolean(savedToken) });
      void refreshHealth();
    }

    bootConsole();
  </script>
</body>
</html>`;
}
