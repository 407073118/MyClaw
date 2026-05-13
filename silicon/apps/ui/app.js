const state = {
  dashboard: null,
  employeeFilter: "all",
};

const nodes = {
  runtimeRoot: document.querySelector("#runtimeRoot"),
  daemonStatus: document.querySelector("#daemonStatus"),
  tickCount: document.querySelector("#tickCount"),
  metricEmployees: document.querySelector("#metricEmployees"),
  metricRunning: document.querySelector("#metricRunning"),
  metricWaiting: document.querySelector("#metricWaiting"),
  metricBlocked: document.querySelector("#metricBlocked"),
  metricFailed: document.querySelector("#metricFailed"),
  employeeList: document.querySelector("#employeeList"),
  queueStream: document.querySelector("#queueStream"),
  actionRequired: document.querySelector("#actionRequired"),
  taskEmployeeSelect: document.querySelector("#taskEmployeeSelect"),
  inspector: document.querySelector("#inspector"),
  inspectorTitle: document.querySelector("#inspectorTitle"),
  inspectorBody: document.querySelector("#inspectorBody"),
};

document.querySelector("#refreshBtn").addEventListener("click", () => {
  console.info("用户触发 Workbench 手动刷新");
  void refreshDashboard();
});

document.querySelector("#daemonTickBtn").addEventListener("click", async () => {
  console.info("用户触发 daemon tick");
  await postJson("/api/daemon/tick", {});
  await refreshDashboard();
});

document.querySelector("#closeInspector").addEventListener("click", () => {
  console.info("用户关闭 Inspector");
  nodes.inspector.classList.remove("open");
});

document.querySelector("#employeeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  console.info("用户提交创建员工表单", Object.fromEntries(form.entries()));
  await postJson("/api/employees", Object.fromEntries(form.entries()));
  event.currentTarget.reset();
  await refreshDashboard();
});

document.querySelector("#taskForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const employeeId = String(form.get("employeeId") ?? "");
  const capability = String(form.get("capability") ?? "");
  const body = {
    taskId: String(form.get("taskId") ?? ""),
    title: String(form.get("title") ?? ""),
    instruction: String(form.get("instruction") ?? ""),
  };
  if (capability) {
    body.requestedCapability = capability;
  }
  console.info("用户提交创建任务表单", { employeeId, taskId: body.taskId, capability: capability || "artifact.write" });
  await postJson(`/api/employees/${encodeURIComponent(employeeId)}/tasks`, body);
  event.currentTarget.reset();
  await refreshDashboard();
});

document.querySelector("#employeeFilters").addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }
  state.employeeFilter = target.dataset.filter ?? "all";
  console.info("用户切换员工筛选条件", { filter: state.employeeFilter });
  document.querySelectorAll("#employeeFilters button").forEach((button) => button.classList.toggle("active", button === target));
  renderEmployees();
});

void refreshDashboard();

/** 刷新首页 dashboard，并在浏览器控制台写入中文运行日志。 */
async function refreshDashboard() {
  console.info("开始刷新 Silicon Workbench dashboard");
  state.dashboard = await getJson("/api/runtime/dashboard");
  renderDashboard();
  console.info("Silicon Workbench dashboard 已刷新", {
    employees: state.dashboard.summary.employees,
    blocked: state.dashboard.summary.blocked,
    failed: state.dashboard.summary.failed,
  });
}

/** 渲染 dashboard 顶层状态，保证状态条、指标和三栏列表同步更新。 */
function renderDashboard() {
  console.info("开始渲染 Silicon Workbench dashboard");
  const dashboard = state.dashboard;
  nodes.runtimeRoot.textContent = dashboard.runtimeRoot;
  nodes.daemonStatus.textContent = statusLabel(dashboard.daemon.status);
  nodes.daemonStatus.className = `status-dot ${safeClassName(dashboard.daemon.status)}`;
  nodes.tickCount.textContent = String(dashboard.daemon.tickCount);
  nodes.metricEmployees.textContent = String(dashboard.summary.employees);
  nodes.metricRunning.textContent = String(dashboard.summary.running);
  nodes.metricWaiting.textContent = String(dashboard.summary.waitingApproval);
  nodes.metricBlocked.textContent = String(dashboard.summary.blocked);
  nodes.metricFailed.textContent = String(dashboard.summary.failed);
  renderEmployeeOptions();
  renderEmployees();
  renderQueueStream();
  renderActionRequired();
  console.info("Silicon Workbench dashboard 已渲染");
}

/** 渲染创建任务表单中的员工选项，避免用户手填员工 ID。 */
function renderEmployeeOptions() {
  console.info("开始渲染员工下拉选项");
  const employees = state.dashboard.employees;
  nodes.taskEmployeeSelect.innerHTML = employees
    .map((employee) => `<option value="${escapeHtml(employee.employeeId)}">${escapeHtml(employee.displayName)} (${escapeHtml(employee.employeeId)})</option>`)
    .join("");
  console.info("员工下拉选项已渲染", { count: employees.length });
}

/** 按当前筛选条件渲染员工列表。 */
function renderEmployees() {
  console.info("开始渲染员工列表", { filter: state.employeeFilter });
  const employees = state.dashboard.employees.filter((employee) => {
    if (state.employeeFilter === "all") {
      return true;
    }
    if (state.employeeFilter === "waiting") {
      return employee.waitingApprovals > 0 || employee.status === "waiting_approval";
    }
    if (state.employeeFilter === "blocked") {
      return employee.blockedTasks > 0;
    }
    if (state.employeeFilter === "failed") {
      return employee.failedTasks > 0 || employee.status === "failed" || employee.status === "unreadable";
    }
    return employee.status === state.employeeFilter;
  });
  nodes.employeeList.innerHTML = employees.length
    ? employees.map(renderEmployeeRow).join("")
    : `<div class="empty">暂无员工，先从上方创建一个员工。</div>`;
  nodes.employeeList.querySelectorAll("[data-employee-id]").forEach((row) => {
    row.addEventListener("click", () => {
      void openEmployeeInspector(row.dataset.employeeId);
    });
  });
  console.info("员工列表已渲染", { count: employees.length });
}

/** 渲染单个员工行，突出当前任务、最后心跳和状态。 */
function renderEmployeeRow(employee) {
  console.info("开始渲染员工行", { employeeId: employee.employeeId, status: employee.status });
  return `
    <div class="row" data-employee-id="${escapeHtml(employee.employeeId)}">
      <div>
        <div class="title-line">${escapeHtml(employee.displayName)}</div>
        <div class="meta-line mono">${escapeHtml(employee.employeeId)} / beat ${escapeHtml(employee.lastBeatAt ?? "-")}</div>
        <div class="meta-line">${escapeHtml(employee.currentTaskId ?? "空闲")}</div>
      </div>
      <span class="badge ${safeClassName(employee.status)}">${escapeHtml(statusLabel(employee.status))}</span>
    </div>
  `;
}

/** 渲染任务和审批混合队列，作为 Workbench 的运行流主视图。 */
function renderQueueStream() {
  console.info("开始渲染队列流");
  const items = state.dashboard.queueStream;
  nodes.queueStream.innerHTML = items.length
    ? items.map((item) => `
      <div class="stream-item" data-kind="${escapeHtml(item.kind)}" data-employee-id="${escapeHtml(item.employeeId)}" data-id="${escapeHtml(item.id)}">
        <div class="title-line">${escapeHtml(item.title)}</div>
        <div class="meta-line">${escapeHtml(kindLabel(item.kind))} / ${escapeHtml(item.employeeId)} / <span class="badge ${safeClassName(item.status)}">${escapeHtml(statusLabel(item.status))}</span></div>
        ${item.blocker ? `<div class="meta-line">${escapeHtml(item.blocker)}</div>` : ""}
      </div>
    `).join("")
    : `<div class="empty">暂无队列项目。创建任务后会在这里看到运行流。</div>`;
  console.info("队列流已渲染", { count: items.length });
}

/** 渲染需要人工处理的事项，优先暴露审批、阻塞和健康问题。 */
function renderActionRequired() {
  console.info("开始渲染待处理事项");
  const items = state.dashboard.actionRequired;
  nodes.actionRequired.innerHTML = items.length
    ? items.map((item) => `
      <div class="action-item">
        <div class="title-line">${escapeHtml(item.title)}</div>
        <div class="meta-line">${escapeHtml(kindLabel(item.kind))} / ${escapeHtml(item.employeeId ?? "-")}</div>
        <div class="meta-line">${escapeHtml(item.message)}</div>
      </div>
    `).join("")
    : `<div class="empty">当前没有需要处理的审批、阻塞或健康问题。</div>`;
  console.info("待处理事项已渲染", { count: items.length });
}

/** 打开员工 Inspector，并把运行证据拆成概览、任务和审批三个区块。 */
async function openEmployeeInspector(employeeId) {
  console.info("开始打开员工 Inspector", { employeeId });
  const detail = await getJson(`/api/employees/${encodeURIComponent(employeeId)}`);
  nodes.inspectorTitle.textContent = detail.profile.displayName;
  nodes.inspectorBody.innerHTML = `
    <section class="inspector-section">
      <div class="inspector-section-title">运行概览</div>
      ${kv("员工 ID", detail.profile.employeeId)}
      ${kv("状态", statusLabel(detail.profile.status))}
      ${kv("当前任务", detail.profile.currentTaskId ?? "-")}
      ${kv("当前 Run", detail.profile.currentRunId ?? "-")}
      ${kv("心跳次数", String(detail.heartbeat.tickCount))}
      ${kv("阻塞任务", String(detail.counts.blockedTasks))}
      ${kv("待审批", String(detail.counts.waitingApprovals))}
    </section>
    <section class="inspector-section">
      <div class="inspector-section-title">任务</div>
      ${renderTaskActions(detail) || `<div class="empty">该员工暂无任务。</div>`}
    </section>
    <section class="inspector-section">
      <div class="inspector-section-title">审批</div>
      ${renderApprovalActions(detail) || `<div class="empty">该员工暂无待处理审批。</div>`}
    </section>
  `;
  nodes.inspector.classList.add("open");
  bindInspectorActions(employeeId);
  console.info("员工 Inspector 已打开", { employeeId });
}

/** 渲染员工任务操作行，输出按钮连接到 artifact/review 预览。 */
function renderTaskActions(detail) {
  console.info("开始渲染员工任务操作", { employeeId: detail.profile.employeeId, count: detail.tasks.length });
  return detail.tasks.map((task) => `
    <div class="kv">
      <span>${escapeHtml(task.id)}</span>
      <span>
        <span class="badge ${safeClassName(task.status)}">${escapeHtml(statusLabel(task.status))}</span>
        ${task.runId ? `<button class="tool-button" data-output-task="${escapeHtml(task.id)}">产物</button>` : ""}
      </span>
    </div>
  `).join("");
}

/** 渲染审批操作，保留 approve 和 deny 两条显式人工决策路径。 */
function renderApprovalActions(detail) {
  const approvals = detail.approvals.filter((approval) => approval.status === "requested");
  console.info("开始渲染员工审批操作", { employeeId: detail.profile.employeeId, count: approvals.length });
  return approvals.map((approval) => `
    <div class="kv">
      <span>${escapeHtml(approval.id)}</span>
      <span>
        <button class="tool-button primary" data-approve="${escapeHtml(approval.id)}">批准</button>
        <button class="tool-button" data-deny="${escapeHtml(approval.id)}">拒绝</button>
      </span>
    </div>
  `).join("");
}

/** 绑定 Inspector 内的审批和产物按钮，所有动作完成后刷新当前视图。 */
function bindInspectorActions(employeeId) {
  console.info("开始绑定 Inspector 操作", { employeeId });
  nodes.inspectorBody.querySelectorAll("[data-approve]").forEach((button) => {
    button.addEventListener("click", async () => {
      console.info("开始批准员工审批", { employeeId, approvalId: button.dataset.approve });
      await postJson(`/api/employees/${encodeURIComponent(employeeId)}/approvals/${encodeURIComponent(button.dataset.approve)}/approve`, {});
      await refreshDashboard();
      await openEmployeeInspector(employeeId);
      console.info("员工审批已批准", { employeeId, approvalId: button.dataset.approve });
    });
  });
  nodes.inspectorBody.querySelectorAll("[data-deny]").forEach((button) => {
    button.addEventListener("click", async () => {
      console.info("开始拒绝员工审批", { employeeId, approvalId: button.dataset.deny });
      await postJson(`/api/employees/${encodeURIComponent(employeeId)}/approvals/${encodeURIComponent(button.dataset.deny)}/deny`, {});
      await refreshDashboard();
      await openEmployeeInspector(employeeId);
      console.info("员工审批已拒绝", { employeeId, approvalId: button.dataset.deny });
    });
  });
  nodes.inspectorBody.querySelectorAll("[data-output-task]").forEach((button) => {
    button.addEventListener("click", async () => {
      console.info("开始读取任务产物", { employeeId, taskId: button.dataset.outputTask });
      const output = await getJson(`/api/employees/${encodeURIComponent(employeeId)}/tasks/${encodeURIComponent(button.dataset.outputTask)}/output`);
      nodes.inspectorTitle.textContent = `${output.taskId} 产物`;
      nodes.inspectorBody.innerHTML = `<pre>${escapeHtml(output.artifact.content || output.review.content || "暂无产物")}</pre>`;
      console.info("任务产物已读取", { employeeId, taskId: button.dataset.outputTask });
    });
  });
  console.info("Inspector 操作已绑定", { employeeId });
}

/** 渲染 Inspector 键值行，统一处理空值和 HTML 转义。 */
function kv(label, value) {
  console.info("开始渲染 Inspector 键值行", { label });
  return `<div class="kv"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
}

/** 请求 JSON API，失败时把服务端错误传递给调用方。 */
async function getJson(url) {
  console.info("开始请求 JSON API", { url });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  console.info("JSON API 请求成功", { url });
  return response.json();
}

/** 提交 JSON API，所有 UI 写操作都通过该入口统一发送。 */
async function postJson(url, body) {
  console.info("开始提交 JSON API", { url });
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  console.info("JSON API 提交成功", { url });
  return response.json();
}

/** 转义 HTML，避免 runtime 记录内容破坏 Workbench DOM。 */
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** 过滤 CSS class 名称，避免状态码破坏样式选择器。 */
function safeClassName(value) {
  console.info("开始过滤 CSS class 名称", { value });
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** 将内部状态码转成用户可扫描的中文标签。 */
function statusLabel(status) {
  console.info("开始转换状态标签", { status });
  const labels = {
    running: "运行中",
    waiting_approval: "待审批",
    requested: "待审批",
    blocked: "已阻塞",
    failed: "失败",
    error: "错误",
    succeeded: "成功",
    approved: "已批准",
    denied: "已拒绝",
    passed: "通过",
    stopped: "已停止",
    unreadable: "不可读",
    idle: "空闲",
    queued: "排队中",
    simulated: "模拟",
  };
  return labels[status] ?? status;
}

/** 将对象类型转成中文，统一队列和操作列表里的命名。 */
function kindLabel(kind) {
  console.info("开始转换对象类型标签", { kind });
  const labels = {
    task: "任务",
    approval: "审批",
    run: "Run",
    doctor: "Doctor",
    schedule: "计划",
  };
  return labels[kind] ?? kind;
}
