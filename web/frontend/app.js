/*
  FIO 配置生成器前端逻辑
  - 可视化编辑 Global 和 Jobs
  - 生成 .fio 配置文本并下载
  - 支持导入/导出 JSON
  - 本地持久化与预置模板
*/

/**
 :return:             {
                        "status": 0,
                        "msg": "",
                        "data": {}
                       }
*/
function wrapOk(data = {}, msg = "") {
  return { status: 0, msg, data };
}

/**
 :param msg:         错误信息
 :param data:        附带数据（可选）
 :return:            { "status": 1, "msg": msg, "data": data }
*/
function wrapErr(msg = "操作失败", data = {}) {
  return { status: 1, msg, data };
}

/**
 * @typedef {Object} GlobalOptions
 * @property {string} filename
 * @property {number} runtime
 * @property {number} ramp_time
 * @property {string} ioengine
 * @property {number} direct
 * @property {number} time_based
 * @property {number} norandommap
 * @property {number} randrepeat
 * @property {number} log_avg_msec
 * @property {number} group_reporting
 * @property {Record<string,string|number>} extras
 */

/**
 * @typedef {Object} JobOptions
 * @property {string} name
 * @property {string} bs
 * @property {string} rw
 * @property {number} rwmixread
 * @property {number} iodepth
 * @property {number} numjobs
 * @property {number} thread
 * @property {number} direct
 * @property {number} overwrite
 * @property {string} cpus_allowed_policy
 * @property {number} log_avg_msec
 * @property {string} write_bw_log
 * @property {string} write_lat_log
 * @property {string} write_iops_log
 * @property {Record<string,string|number>} extras
 */

/**
 * @typedef {Object} FioConfig
 * @property {GlobalOptions} global
 * @property {JobOptions[]} jobs
 */

/**
 :return:             默认配置对象
*/
function createDefaultConfig() {
  /** @type {FioConfig} */
  const cfg = {
    global: {
      filename: "/dev/vdb",
      runtime: 180,
      ramp_time: 10,
      ioengine: "libaio",
      direct: 1,
      time_based: 1,
      norandommap: 1,
      randrepeat: 0,
      log_avg_msec: 500,
      group_reporting: 1,
      extras: {},
    },
    jobs: [],
  };
  return cfg;
}


// 全局状态
const state = {
  /** @type {FioConfig} */ config: loadState() || createDefaultConfig(),
  /** 最近一次新添加任务的索引，用于默认展开 */
  justAddedIndex: null,
  /** 是否正在手动编辑预览 */
  isEditingFio: false,
};

// 页面切换逻辑
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    // 切换按钮状态
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');

    // 切换内容区域
    const targetId = e.target.getAttribute('data-target');
    document.querySelectorAll('.tab-content').forEach(c => {
      c.style.display = 'none';
      c.classList.remove('active');
    });
    document.getElementById(targetId).style.display = 'block';
    document.getElementById(targetId).classList.add('active');

    // 切换操作按钮显示
    if (targetId === 'config-tab') {
      document.getElementById('config-actions').style.display = 'flex';
    } else {
      document.getElementById('config-actions').style.display = 'none';
      if (targetId === 'execute-tab') {
        loadExecutionData();
      }
      if (targetId === 'analysis-tab') {
        loadAnalysisData();
      }
    }
  });
});

// FIO 任务执行相关逻辑
const executionState = {
  tasks: [],
  scripts: [],
  logs: {},
  saveTimer: null,
};

const analysisState = {
  tasks: [],
  selectedTaskId: "",
};

function createExecutionHost(host = "") {
  return {
    host,
    port: 22,
    user: "root",
    password: "",
  };
}

function createExecutionTask(partial = {}) {
  const hosts = Array.isArray(partial.hosts) && partial.hosts.length > 0
    ? partial.hosts.map(hostCfg => ({
        host: hostCfg.host || "",
        port: Number(hostCfg.port) || 22,
        user: hostCfg.user || "root",
        password: hostCfg.password || "",
      }))
    : [createExecutionHost()];

  return {
    id: partial.id || `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name: partial.name || `执行任务 ${executionState.tasks.length + 1}`,
    script: partial.script || "",
    hosts,
  };
}

function setExecutionTaskStatus(text = "", type = "") {
  if (!el.executionTaskStatus) return;
  el.executionTaskStatus.textContent = text;
  el.executionTaskStatus.className = `save-status${type ? ` ${type}` : ""}`;
}

function appendLog(msg) {
  if (!el.executionLog) return;
  const time = new Date().toLocaleTimeString();
  el.executionLog.textContent += `[${time}] ${msg}\n`;
  el.executionLog.scrollTop = el.executionLog.scrollHeight;
}

function normalizeExecutionTaskForRequest(task) {
  return {
    id: task.id,
    name: task.name.trim() || "未命名任务",
    script: task.script,
    hosts: (task.hosts || [])
      .map(hostCfg => ({
        host: (hostCfg.host || "").trim(),
        port: Number(hostCfg.port) || 22,
        user: (hostCfg.user || "").trim() || "root",
        password: hostCfg.password || "",
      }))
      .filter(hostCfg => hostCfg.host),
  };
}

async function fetchExecutionScripts() {
  const res = await fetch("/api/scripts");
  if (!res.ok) throw new Error(await res.text());
  executionState.scripts = await res.json();
}

async function fetchExecutionTasks() {
  const res = await fetch("/api/execution-tasks");
  if (!res.ok) throw new Error(await res.text());
  const payload = await res.json();
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  executionState.tasks = tasks.length > 0 ? tasks.map(task => createExecutionTask(task)) : [createExecutionTask()];
}

async function fetchExecutionTaskLog(taskId) {
  const res = await fetch(`/api/execution-task-log?taskId=${encodeURIComponent(taskId)}`);
  if (!res.ok) throw new Error(await res.text());
  executionState.logs[taskId] = await res.text();
}

async function fetchAllExecutionTaskLogs() {
  await Promise.all(executionState.tasks.map(async (task) => {
    try {
      await fetchExecutionTaskLog(task.id);
    } catch (err) {
      executionState.logs[task.id] = `加载日志失败: ${err.message}`;
    }
  }));
}

async function loadExecutionData() {
  try {
    await Promise.all([fetchExecutionScripts(), fetchExecutionTasks()]);
    await fetchAllExecutionTaskLogs();
    renderExecutionTasks();
  } catch (err) {
    appendLog("加载执行任务失败: " + err.message);
  }
}

async function saveExecutionTasks(isSilent = true) {
  setExecutionTaskStatus("保存中...", "saving");
  const payload = {
    tasks: executionState.tasks.map(task => normalizeExecutionTaskForRequest(task)),
  };
  try {
    const res = await fetch("/api/execution-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    setExecutionTaskStatus("已保存", "success");
    if (!isSilent) appendLog("执行任务配置已保存");
  } catch (err) {
    setExecutionTaskStatus("保存失败", "error");
    appendLog("保存执行任务失败: " + err.message);
  }
}

function scheduleExecutionTasksSave() {
  if (executionState.saveTimer) clearTimeout(executionState.saveTimer);
  executionState.saveTimer = setTimeout(() => {
    saveExecutionTasks(true);
  }, 500);
}

function appendTaskLocalLog(taskId, message) {
  const time = new Date().toLocaleTimeString();
  const existing = executionState.logs[taskId] || "";
  executionState.logs[taskId] = `${existing}${existing ? "\n" : ""}[${time}] ${message}`;
}

function buildScriptSelect(selectedScript) {
  const select = document.createElement("select");
  select.className = "input-field";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = executionState.scripts.length > 0 ? "请选择脚本" : "暂无可用脚本";
  select.appendChild(placeholder);

  executionState.scripts.forEach(scriptName => {
    const option = document.createElement("option");
    option.value = scriptName;
    option.textContent = scriptName;
    if (scriptName === selectedScript) option.selected = true;
    select.appendChild(option);
  });

  return select;
}

function renderExecutionTasks() {
  if (!el.executionTasksContainer) return;
  el.executionTasksContainer.innerHTML = "";

  if (executionState.tasks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "execution-empty";
    empty.textContent = "暂无执行任务，请先新增任务。";
    el.executionTasksContainer.appendChild(empty);
    return;
  }

  executionState.tasks.forEach((task, taskIndex) => {
    const card = document.createElement("div");
    card.className = "execution-task-card";

    const topbar = document.createElement("div");
    topbar.className = "task-topbar";

    const taskNameInput = document.createElement("input");
    taskNameInput.className = "task-name-input";
    taskNameInput.value = task.name;
    taskNameInput.placeholder = `执行任务 ${taskIndex + 1}`;
    taskNameInput.oninput = (event) => {
      task.name = event.target.value;
      scheduleExecutionTasksSave();
    };

    const actionGroup = document.createElement("div");
    actionGroup.className = "task-actions";

    const actionConfigs = [
      { action: "deploy", text: "部署并执行", className: "btn primary" },
      { action: "status", text: "检查状态", className: "btn" },
      { action: "pull", text: "收集数据", className: "btn success" },
      { action: "killall", text: "终止任务", className: "btn danger" },
    ];

    actionConfigs.forEach(config => {
      const button = document.createElement("button");
      button.className = config.className;
      button.textContent = config.text;
      button.onclick = () => runExecutionAction(config.action, task);
      actionGroup.appendChild(button);
    });

    const deleteTaskBtn = document.createElement("button");
    deleteTaskBtn.className = "btn";
    deleteTaskBtn.textContent = "删除任务";
    deleteTaskBtn.onclick = () => {
      if (!confirm(`确定要删除任务 "${task.name || "未命名任务"}" 吗？此操作将清除本地任务配置。`)) {
        return;
      }
      delete executionState.logs[task.id];
      executionState.tasks.splice(taskIndex, 1);
      if (executionState.tasks.length === 0) {
        executionState.tasks.push(createExecutionTask());
      }
      renderExecutionTasks();
      scheduleExecutionTasksSave();
    };
    actionGroup.appendChild(deleteTaskBtn);

    topbar.appendChild(taskNameInput);
    topbar.appendChild(actionGroup);

    const taskGrid = document.createElement("div");
    taskGrid.className = "task-grid";

    const scriptWrap = document.createElement("div");
    scriptWrap.className = "form-item";
    const scriptLabel = document.createElement("label");
    scriptLabel.textContent = "FIO 脚本";
    const scriptSelect = buildScriptSelect(task.script);
    scriptSelect.onchange = (event) => {
      task.script = event.target.value;
      scheduleExecutionTasksSave();
    };
    scriptWrap.appendChild(scriptLabel);
    scriptWrap.appendChild(scriptSelect);

    const hintWrap = document.createElement("div");
    hintWrap.className = "form-item";
    const hintLabel = document.createElement("label");
    hintLabel.textContent = "说明";
    const hintText = document.createElement("div");
    hintText.style.fontSize = "13px";
    hintText.style.color = "var(--muted)";
    hintText.textContent = "每个任务会把脚本下发到自己的远端目录，并使用独立的 PID 文件进行状态检查。";
    hintWrap.appendChild(hintLabel);
    hintWrap.appendChild(hintText);

    taskGrid.appendChild(scriptWrap);
    taskGrid.appendChild(hintWrap);

    const hostsHeader = document.createElement("div");
    hostsHeader.className = "task-hosts-header";
    const hostsTitle = document.createElement("h3");
    hostsTitle.textContent = "主机列表";
    hostsTitle.style.margin = "0";
    hostsTitle.style.fontSize = "15px";
    const addHostBtn = document.createElement("button");
    addHostBtn.className = "btn small";
    addHostBtn.textContent = "添加主机";
    addHostBtn.onclick = () => {
      task.hosts.push(createExecutionHost());
      renderExecutionTasks();
      scheduleExecutionTasksSave();
    };
    hostsHeader.appendChild(hostsTitle);
    hostsHeader.appendChild(addHostBtn);

    const hostList = document.createElement("div");
    hostList.className = "execution-host-list";

    task.hosts.forEach((hostCfg, hostIndex) => {
      const hostRow = document.createElement("div");
      hostRow.className = "execution-host-row";

      const hostInput = document.createElement("input");
      hostInput.placeholder = "主机/IP";
      hostInput.value = hostCfg.host || "";
      hostInput.oninput = (event) => {
        hostCfg.host = event.target.value;
        scheduleExecutionTasksSave();
      };

      const portInput = document.createElement("input");
      portInput.type = "number";
      portInput.placeholder = "端口";
      portInput.value = String(hostCfg.port || 22);
      portInput.oninput = (event) => {
        hostCfg.port = Number(event.target.value) || 22;
        scheduleExecutionTasksSave();
      };

      const userInput = document.createElement("input");
      userInput.placeholder = "用户名";
      userInput.value = hostCfg.user || "root";
      userInput.oninput = (event) => {
        hostCfg.user = event.target.value;
        scheduleExecutionTasksSave();
      };

      const passwordInput = document.createElement("input");
      passwordInput.type = "password";
      passwordInput.placeholder = "密码（可选）";
      passwordInput.value = hostCfg.password || "";
      passwordInput.oninput = (event) => {
        hostCfg.password = event.target.value;
        scheduleExecutionTasksSave();
      };

      const removeBtn = document.createElement("button");
      removeBtn.className = "btn danger small";
      removeBtn.textContent = "删除";
      removeBtn.onclick = () => {
        task.hosts.splice(hostIndex, 1);
        renderExecutionTasks();
        scheduleExecutionTasksSave();
      };

      hostRow.appendChild(hostInput);
      hostRow.appendChild(portInput);
      hostRow.appendChild(userInput);
      hostRow.appendChild(passwordInput);
      hostRow.appendChild(removeBtn);
      hostList.appendChild(hostRow);
    });

    const taskLogWrap = document.createElement("div");
    taskLogWrap.className = "execution-task-log";

    const taskLogHeader = document.createElement("div");
    taskLogHeader.className = "log-header";

    const taskLogTitle = document.createElement("h4");
    taskLogTitle.textContent = "任务日志";

    const refreshLogBtn = document.createElement("button");
    refreshLogBtn.className = "btn small";
    refreshLogBtn.textContent = "刷新日志";
    refreshLogBtn.onclick = async () => {
      try {
        await fetchExecutionTaskLog(task.id);
        renderExecutionTasks();
      } catch (err) {
        appendLog(`刷新 ${task.name} 日志失败: ${err.message}`);
      }
    };

    taskLogHeader.appendChild(taskLogTitle);
    taskLogHeader.appendChild(refreshLogBtn);

    const taskLogViewer = document.createElement("pre");
    taskLogViewer.textContent = executionState.logs[task.id] || "暂无任务日志";

    taskLogWrap.appendChild(taskLogHeader);
    taskLogWrap.appendChild(taskLogViewer);

    card.appendChild(topbar);
    card.appendChild(taskGrid);
    card.appendChild(hostsHeader);
    card.appendChild(hostList);
    card.appendChild(taskLogWrap);
    el.executionTasksContainer.appendChild(card);
  });
}

function showResultsModal(data) {
  const { taskName, action, results, rawDir } = data;
  const actionNames = {
    "status": "状态检查",
    "pull": "数据收集",
    "killall": "终止任务"
  };
  const actionName = actionNames[action] || action;
  
  el.resultsModalTitle.textContent = `任务 "${taskName}" ${actionName}结果`;
  el.resultsTableBody.innerHTML = "";
  
  results.forEach(res => {
    const tr = document.createElement("tr");
    
    const hostTd = document.createElement("td");
    hostTd.textContent = res.host;
    tr.appendChild(hostTd);
    
    const msgTd = document.createElement("td");
    if (res.error) {
      msgTd.textContent = res.error;
      msgTd.className = "status-error";
    } else {
      msgTd.textContent = res.msg;
      if (res.msg.includes("successfully") || res.msg.includes("Running") || res.msg.includes("files")) {
        msgTd.className = "status-success";
      }
    }
    tr.appendChild(msgTd);
    el.resultsTableBody.appendChild(tr);
  });
  
  el.resultsModalFooter.textContent = action === "pull" ? `任务数据本地目录: ${rawDir}` : "";
  
  el.resultsModal.style.display = "flex";
  el.resultsModalCloseBtn.onclick = () => {
    el.resultsModal.style.display = "none";
  };
}

async function runExecutionAction(action, task) {
  const requestTask = normalizeExecutionTaskForRequest(task);
  if (requestTask.hosts.length === 0) {
    appendLog(`任务 ${requestTask.name} 缺少主机配置`);
    return;
  }
  if (action === "deploy" && !requestTask.script) {
    appendLog(`任务 ${requestTask.name} 未选择 FIO 脚本`);
    return;
  }

  appendLog(`开始执行 ${requestTask.name} -> ${action}`);
  appendTaskLocalLog(task.id, `开始执行动作: ${action}`);
  renderExecutionTasks();
  try {
    const res = await fetch("/api/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, task: requestTask }),
    });
    
    if (res.status === 409) {
      const errorMsg = await res.text();
      alert(errorMsg);
      throw new Error("任务冲突");
    }

    if (!res.ok) {
      const errorMsg = await res.text();
      throw new Error(errorMsg);
    }
    
    if (action === "status" || action === "pull" || action === "killall") {
      const data = await res.json();
      showResultsModal(data);
      const actionNames = { "status": "状态检查", "pull": "数据收集", "killall": "终止任务" };
      appendLog(`任务 "${requestTask.name}" ${actionNames[action] || action}完成`);
    } else {
      const result = await res.text();
      appendLog(result.trim());
    }
    await fetchExecutionTaskLog(task.id);
    await loadAnalysisData(false);
    renderExecutionTasks();
  } catch (err) {
    appendLog(`任务 ${requestTask.name} 执行失败: ${err.message}`);
    appendTaskLocalLog(task.id, `执行失败: ${err.message}`);
    renderExecutionTasks();
  }
}

async function runAllExecutionTasks() {
  for (const task of executionState.tasks) {
    const requestTask = normalizeExecutionTaskForRequest(task);
    if (!requestTask.script || requestTask.hosts.length === 0) {
      appendLog(`跳过 ${requestTask.name || "未命名任务"}，因为脚本或主机配置不完整`);
      continue;
    }
    await runExecutionAction("deploy", task);
  }
}

async function fetchAnalysisTasks() {
  const res = await fetch("/api/analysis/tasks");
  if (!res.ok) throw new Error(await res.text());
  const payload = await res.json();
  analysisState.tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  if (!analysisState.selectedTaskId && analysisState.tasks.length > 0) {
    analysisState.selectedTaskId = analysisState.tasks[0].id;
  }
  if (analysisState.selectedTaskId && !analysisState.tasks.some(task => task.id === analysisState.selectedTaskId)) {
    analysisState.selectedTaskId = analysisState.tasks[0]?.id || "";
  }
}

function renderAnalysisTasks() {
  if (!el.analysisTaskList) return;
  el.analysisTaskList.innerHTML = "";

  if (analysisState.tasks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "analysis-empty";
    empty.textContent = "暂无可分析任务，请先在执行页完成拉数。";
    el.analysisTaskList.appendChild(empty);
    updateAnalysisPreview();
    return;
  }

  analysisState.tasks.forEach((task) => {
    const card = document.createElement("div");
    card.className = `analysis-task-card${task.id === analysisState.selectedTaskId ? " active" : ""}`;
    card.onclick = () => {
      analysisState.selectedTaskId = task.id;
      renderAnalysisTasks();
      updateAnalysisPreview();
    };

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = task.name;

    const meta = document.createElement("div");
    meta.className = "meta";
    const lines = [
      `脚本: ${task.script || "未设置"}`,
      `原始数据: ${task.hasData ? "已拉回" : "未拉回"}`,
      `分析报告: ${task.hasReport ? "已生成" : "未生成"}`,
      `执行日志: ${task.logAvailable ? "已持久化" : "暂无"}`,
    ];
    lines.forEach((line) => {
      const row = document.createElement("div");
      row.textContent = line;
      meta.appendChild(row);
    });

    card.appendChild(name);
    card.appendChild(meta);
    el.analysisTaskList.appendChild(card);
  });

  updateAnalysisPreview();
}

function updateAnalysisPreview() {
  const task = analysisState.tasks.find(item => item.id === analysisState.selectedTaskId);
  if (!task) {
    el.analysisTitle.textContent = "分析预览";
    el.analysisStatusText.textContent = "请选择左侧任务";
    el.generateAnalysisBtn.disabled = true;
    el.openAnalysisReportBtn.disabled = true;
    el.downloadAnalysisBtn.disabled = true;
    el.analysisReportFrame.src = "about:blank";
    return;
  }

  el.analysisTitle.textContent = `${task.name} 分析预览`;
  el.analysisStatusText.textContent = `${task.hasData ? "已拉回原始数据" : "未拉回原始数据"} · ${task.hasReport ? "已生成分析报告" : "尚未生成分析报告"}`;
  el.generateAnalysisBtn.disabled = !task.hasData;
  el.openAnalysisReportBtn.disabled = !task.hasReport;
  el.downloadAnalysisBtn.disabled = !task.hasReport;
  el.analysisReportFrame.src = task.hasReport ? task.reportHtmlUrl : "about:blank";
}

async function loadAnalysisData(shouldRender = true) {
  try {
    await fetchAnalysisTasks();
    if (shouldRender) {
      renderAnalysisTasks();
    } else {
      updateAnalysisPreview();
    }
  } catch (err) {
    if (el.analysisStatusText) {
      el.analysisStatusText.textContent = `加载分析任务失败: ${err.message}`;
    }
  }
}

async function generateAnalysisReportForSelectedTask() {
  const task = analysisState.tasks.find(item => item.id === analysisState.selectedTaskId);
  if (!task) return;
  try {
    el.analysisStatusText.textContent = `正在生成 ${task.name} 的分析报告...`;
    const res = await fetch("/api/analysis/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id }),
    });
    if (!res.ok) throw new Error(await res.text());
    await loadAnalysisData();
    try {
      await fetchExecutionTaskLog(task.id);
      renderExecutionTasks();
    } catch (err) {
      appendLog(`刷新 ${task.name} 日志失败: ${err.message}`);
    }
    appendLog(`${task.name} 分析报告已生成`);
  } catch (err) {
    el.analysisStatusText.textContent = `生成分析失败: ${err.message}`;
  }
}

function openSelectedAnalysisReport() {
  const task = analysisState.tasks.find(item => item.id === analysisState.selectedTaskId);
  if (!task || !task.hasReport) return;
  window.open(task.reportHtmlUrl, "_blank");
}

function downloadSelectedAnalysisPackage() {
  const task = analysisState.tasks.find(item => item.id === analysisState.selectedTaskId);
  if (!task || !task.hasReport) return;
  window.location.href = task.downloadUrl;
}


// 选择器缓存
const el = {
  addJobBtn: document.getElementById("addJobBtn"),
  exportJsonBtn: document.getElementById("exportJsonBtn"),
  importJsonBtn: document.getElementById("importJsonBtn"),
  downloadFioBtn: document.getElementById("downloadFioBtn"),
  refreshPreviewBtn: document.getElementById("refreshPreviewBtn"),
  jsonFileInput: document.getElementById("jsonFileInput"),
  jobsContainer: document.getElementById("jobsContainer"),
  fioPreview: document.getElementById("fioPreview"),
  configFilename: document.getElementById("configFilename"),
  saveStatus: document.getElementById("saveStatus"),
  refreshConfigsBtn: document.getElementById("refreshConfigsBtn"),
  savedConfigsList: document.getElementById("savedConfigsList"),
  newConfigBtn: document.getElementById("newConfigBtn"),
  currentFilenameDisplay: document.getElementById("currentFilenameDisplay"),
  executionTasksContainer: document.getElementById("executionTasksContainer"),
  executionTaskStatus: document.getElementById("executionTaskStatus"),
  addExecutionTaskBtn: document.getElementById("addExecutionTaskBtn"),
  runAllTasksBtn: document.getElementById("runAllTasksBtn"),
  refreshScriptsBtn: document.getElementById("refreshScriptsBtn"),
  executionLog: document.getElementById("executionLog"),
  clearLogBtn: document.getElementById("clearLogBtn"),
  analysisTaskList: document.getElementById("analysisTaskList"),
  refreshAnalysisTasksBtn: document.getElementById("refreshAnalysisTasksBtn"),
  generateAnalysisBtn: document.getElementById("generateAnalysisBtn"),
  openAnalysisReportBtn: document.getElementById("openAnalysisReportBtn"),
  downloadAnalysisBtn: document.getElementById("downloadAnalysisBtn"),
  analysisReportFrame: document.getElementById("analysisReportFrame"),
  analysisTitle: document.getElementById("analysisTitle"),
  analysisStatusText: document.getElementById("analysisStatusText"),
  customPromptModal: document.getElementById("customPromptModal"),
  modalTitle: document.getElementById("modalTitle"),
  modalInput: document.getElementById("modalInput"),
  modalConfirmBtn: document.getElementById("modalConfirmBtn"),
  modalCancelBtn: document.getElementById("modalCancelBtn"),
  
  // Results Modal
  resultsModal: document.getElementById("resultsModal"),
  resultsModalTitle: document.getElementById("resultsModalTitle"),
  resultsTableBody: document.getElementById("resultsTableBody"),
  resultsModalFooter: document.getElementById("resultsModalFooter"),
  resultsModalCloseBtn: document.getElementById("resultsModalCloseBtn"),
};

let autoSaveTimer = null;

/**
 * 自定义 Prompt 弹窗
 */
function showCustomPrompt(title, defaultValue = "") {
  return new Promise((resolve) => {
    el.modalTitle.textContent = title;
    el.modalInput.value = defaultValue;
    el.customPromptModal.style.display = "flex";
    el.modalInput.focus();

    const cleanup = () => {
      el.customPromptModal.style.display = "none";
      el.modalConfirmBtn.onclick = null;
      el.modalCancelBtn.onclick = null;
      window.removeEventListener("keydown", handleKeydown);
    };

    const handleKeydown = (e) => {
      if (e.key === "Enter") el.modalConfirmBtn.click();
      if (e.key === "Escape") el.modalCancelBtn.click();
    };

    el.modalConfirmBtn.onclick = () => {
      const val = el.modalInput.value.trim();
      cleanup();
      resolve(val || null);
    };

    el.modalCancelBtn.onclick = () => {
      cleanup();
      resolve(null);
    };

    window.addEventListener("keydown", handleKeydown);
  });
}

async function saveToServer(isManual = false) {
  const r = generateFio(state.config, true); // 保存到服务器时包含 JSON，以便后续精确加载
  if (r.status === 0) {
    const name = el.configFilename.value.trim() || "custom.fio";
    
    if (el.saveStatus) {
      el.saveStatus.textContent = "保存中...";
      el.saveStatus.className = "save-status saving";
    }

    try {
      const res = await fetch('/api/scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, content: r.data.text })
      });
      if (res.ok) {
        if (el.saveStatus) {
          el.saveStatus.textContent = "已保存";
          el.saveStatus.className = "save-status success";
          setTimeout(() => {
            if (el.saveStatus.textContent.includes("保存")) el.saveStatus.textContent = "";
          }, 3000);
        }
        if (isManual) fetchSavedConfigs(); // 手动保存后刷新列表
      } else {
        if (el.saveStatus) {
          el.saveStatus.textContent = "保存失败";
          el.saveStatus.className = "save-status error";
        }
        if (isManual) alert("保存失败: " + await res.text());
      }
    } catch (e) {
      if (el.saveStatus) {
        el.saveStatus.textContent = "保存异常";
        el.saveStatus.className = "save-status error";
      }
      if (isManual) alert("保存失败: " + e.message);
    }
  }
}

function triggerAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    saveToServer(false);
  }, 1000);
}

async function fetchSavedConfigs() {
  if (!el.savedConfigsList) return;
  try {
    const res = await fetch('/api/scripts');
    if (!res.ok) throw new Error(await res.text());
    const scripts = await res.json();
    
    el.savedConfigsList.innerHTML = '';
    if (!scripts || scripts.length === 0) {
      el.savedConfigsList.innerHTML = '<div style="color: var(--muted); font-size: 13px; text-align: center; padding: 10px;">暂无保存的配置</div>';
      return;
    }

    scripts.forEach(script => {
      const item = document.createElement('div');
      item.className = 'saved-config-item';
      
      const nameSpan = document.createElement('span');
      nameSpan.className = 'config-name';
      nameSpan.textContent = script;
      
      const actions = document.createElement('div');
      actions.className = 'config-actions';
      
      const loadBtn = document.createElement('button');
      loadBtn.className = 'btn small';
      loadBtn.textContent = '加载编辑';
      loadBtn.onclick = () => loadConfigFromServer(script);

      const renameBtn = document.createElement('button');
      renameBtn.className = 'btn small';
      renameBtn.textContent = '重命名';
      renameBtn.onclick = () => renameConfigOnServer(script);
      
      const delBtn = document.createElement('button');
      delBtn.className = 'btn danger small';
      delBtn.textContent = '删除';
      delBtn.onclick = () => deleteConfigFromServer(script);
      
      actions.appendChild(loadBtn);
      actions.appendChild(renameBtn);
      actions.appendChild(delBtn);
      
      item.appendChild(nameSpan);
      item.appendChild(actions);
      el.savedConfigsList.appendChild(item);
    });
  } catch (err) {
    el.savedConfigsList.innerHTML = `<div style="color: var(--danger); font-size: 13px;">加载失败: ${err.message}</div>`;
  }
}

async function loadConfigFromServer(filename) {
  try {
    const res = await fetch(`/api/scripts?name=${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error(await res.text());
    const text = await res.text();
    
    let configObj = null;
    const jsonMatch = text.match(/# FIO_CONFIG_JSON:\s*(\{.*\})/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        configObj = JSON.parse(jsonMatch[1]);
      } catch (e) {
        console.warn("Failed to parse embedded JSON", e);
      }
    }
    
    // Fallback parser for scripts without embedded JSON
    if (!configObj) {
      configObj = { global: {}, jobs: [] };
      const lines = text.split('\n');
      let currentSection = null;
      let currentJob = null;
      
      for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith('#') || line.startsWith(';')) continue;
        
        const sectionMatch = line.match(/^\[(.*)\]$/);
        if (sectionMatch) {
          const sectionName = sectionMatch[1];
          if (sectionName === 'global') {
            currentSection = 'global';
          } else {
            currentSection = 'job';
            currentJob = {};
            configObj.jobs.push(currentJob);
          }
          continue;
        }
        
        if (currentSection) {
          const kvMatch = line.match(/^([^=]+)=(.*)$/);
          if (kvMatch) {
            const k = kvMatch[1].trim();
            const v = kvMatch[2].trim();
            if (currentSection === 'global') {
              configObj.global[k] = v;
            } else if (currentJob) {
              // try to parse bs
              if (k === 'bs') {
                currentJob.bs = v;
                const bs_num = parseBsToNumber(v);
                if (!isNaN(bs_num)) currentJob.bs_k = bs_num;
              } else if (k === 'rwmixread' || k === 'iodepth' || k === 'numjobs') {
                currentJob[k] = Number(v);
              } else {
                currentJob[k] = v;
              }
            }
          }
        }
      }
    }
    
    if (configObj) {
      state.config = configObj;
      el.configFilename.value = filename;
      if (el.currentFilenameDisplay) el.currentFilenameDisplay.textContent = filename;
      localStorage.setItem("fio_config_filename", filename);
      saveState(state.config);
      renderAll();
      refreshPreview(state.config);
      alert(`已成功加载配置: ${filename}`);
    } else {
      alert(`配置 ${filename} 不包含可视化编辑数据，无法加载。`);
    }
  } catch (err) {
    alert(`加载配置失败: ${err.message}`);
  }
}

async function deleteConfigFromServer(filename) {
  if (!confirm(`确定要删除配置文件 "${filename}" 吗？`)) return;
  try {
    const res = await fetch(`/api/scripts?name=${encodeURIComponent(filename)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
    alert(`已删除配置文件: ${filename}`);
    fetchSavedConfigs();
  } catch (err) {
    alert(`删除失败: ${err.message}`);
  }
}

async function renameConfigOnServer(oldName) {
  const newName = await showCustomPrompt("请输入新的文件名:", oldName);
  if (!newName || newName === oldName) return;
  
  const finalNewName = newName.endsWith(".fio") ? newName : newName + ".fio";
  
  try {
    // 1. 加载旧文件内容
    const getRes = await fetch(`/api/scripts?name=${encodeURIComponent(oldName)}`);
    if (!getRes.ok) throw new Error("无法读取原文件内容");
    const content = await getRes.text();
    
    // 2. 以新文件名保存内容
    const postRes = await fetch('/api/scripts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: finalNewName, content: content })
    });
    if (!postRes.ok) throw new Error("无法保存新文件");
    
    // 3. 删除旧文件
    const delRes = await fetch(`/api/scripts?name=${encodeURIComponent(oldName)}`, { method: 'DELETE' });
    if (!delRes.ok) throw new Error("保存成功但无法删除旧文件");
    
    alert(`重命名成功: ${oldName} -> ${finalNewName}`);
    
    // 如果当前正在编辑的是被重命名的文件，更新输入框
    if (el.configFilename.value === oldName) {
      el.configFilename.value = finalNewName;
      if (el.currentFilenameDisplay) el.currentFilenameDisplay.textContent = finalNewName;
      localStorage.setItem("fio_config_filename", finalNewName);
    }
    
    fetchSavedConfigs();
  } catch (err) {
    alert(`重命名失败: ${err.message}`);
  }
}

async function createNewConfig() {
  const name = await showCustomPrompt("请输入新配置文件的名称:", "new_config.fio");
  if (name === null) return; // 用户取消

  const finalName = name.trim() || "new_config.fio";
  const finalFilename = finalName.endsWith(".fio") ? finalName : finalName + ".fio";

  state.config = {
    global: {
      runtime: 180,
      ramp_time: 10,
      filename: "/dev/vdb"
    },
    jobs: []
  };
  el.configFilename.value = finalFilename;
  if (el.currentFilenameDisplay) el.currentFilenameDisplay.textContent = finalFilename;
  localStorage.setItem("fio_config_filename", finalFilename);
  saveState(state.config);
  renderAll();
  refreshPreview(state.config);
  alert(`已重置为新配置: ${finalFilename}`);
}

/**
 :param key:         键名
 :param value:       键值
 :return:            安全键名（移除非法字符，只允许[a-zA-Z0-9_]+）
*/
function sanitizeKey(key, value) {
  const safe = String(key || "").replace(/[^a-zA-Z0-9_]/g, "");
  return safe;
}

/**
 :return:             从localStorage加载配置
*/
function loadState() {
  try {
    const s = localStorage.getItem("fio_config_state");
    if (!s) return null;
    const obj = JSON.parse(s);
    if (obj && obj.global && Array.isArray(obj.jobs)) return obj;
    return null;
  } catch (e) {
    console.warn("loadState error", e);
    return null;
  }
}

/**
 :param cfg:         要持久化的配置对象
 :return:            {status,msg,data}
*/
function saveState(cfg) {
  try {
    localStorage.setItem("fio_config_state", JSON.stringify(cfg));
    triggerAutoSave();
    return wrapOk({}, "saved");
  } catch (e) {
    return wrapErr("无法保存到本地存储", { error: String(e) });
  }
}

/**
 :param cfg:         FioConfig 配置对象
 :param includeJson: 是否在末尾附加 JSON 注释
 :return:            {status,msg,data:{ text: string }}
*/
function generateFio(cfg, includeJson = false) {
  try {
    const lines = [];
    lines.push("[global]");
    const g = cfg.global || {};
    // 按需求：global 仅输出固定项
    const globalOrder = [
      "runtime",
      "ramp_time",
      "filename",
    ];
    for (const key of globalOrder) {
      if (g[key] !== undefined && g[key] !== null && g[key] !== "") {
        lines.push(`${key}=${g[key]}`);
      } else if (key === "runtime") {
        lines.push("runtime=180");
      } else if (key === "ramp_time") {
        lines.push("ramp_time=10");
      }
    }
    // 其余 global 默认项不在 [global] 输出，改为在每个 job 中补充

    (cfg.jobs || []).forEach((job, idx) => {
      lines.push("");
      const jobName = buildJobName(idx, job);
      lines.push(`[${jobName}]`);
      const order = [
        // 按要求仅输出核心字段，bs单位固定为k
        "bs",
        "rw",
        "rwmixread",
        "iodepth",
        "numjobs",
      ];
      // bs按k单位输出
      const bsValue = getBsText(job);
      lines.push(`bs=${bsValue}`);
      // 其他核心字段
      if (job.rw) lines.push(`rw=${job.rw}`);
      // 仅在混合读写场景输出 rwmixread（rw/readwrite/randrw）
      if ((job.rw === "rw" || job.rw === "readwrite" || job.rw === "randrw") && job.rwmixread !== undefined && job.rwmixread !== null) {
        lines.push(`rwmixread=${job.rwmixread}`);
      }
      if (job.iodepth !== undefined && job.iodepth !== null) lines.push(`iodepth=${job.iodepth}`);
      if (job.numjobs !== undefined && job.numjobs !== null) lines.push(`numjobs=${job.numjobs}`);

      // 补充默认内容（来自 xpxv.fio 14-26 行）：在 job 级别输出
      lines.push("thread=1");
      lines.push("direct=1");
      lines.push("overwrite=1");
      lines.push("ioengine=libaio");
      lines.push("time_based=1");
      lines.push("norandommap=1");
      lines.push("randrepeat=0");
      lines.push("log_avg_msec=500");
      lines.push("stonewall=1");
      lines.push("group_reporting=1");
      lines.push("cpus_allowed_policy=split");

      // 自动生成日志路径
      const logs = buildLogPaths(idx, job);
      lines.push(`write_bw_log=${logs.bw}`);
      lines.push(`write_lat_log=${logs.lat}`);
      lines.push(`write_iops_log=${logs.iops}`);
    });
    
    if (includeJson) {
      lines.push("");
      lines.push("# FIO_CONFIG_JSON: " + JSON.stringify(cfg));
    }
    return wrapOk({ text: lines.join("\n") });
  } catch (e) {
    return wrapErr("生成配置失败", { error: String(e) });
  }
}

/**
 :param filename:    下载文件名
 :param content:     文本内容
 :return:            {status,msg,data}
*/
function downloadTextFile(filename, content) {
  try {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return wrapOk();
  } catch (e) {
    return wrapErr("下载失败", { error: String(e) });
  }
}

/**
 :param cfg:         FioConfig 配置对象
 :return:            {status,msg,data}
*/
function refreshPreview(cfg) {
  if (state.isEditingFio) return;
  const r = generateFio(cfg);
  if (r.status === 0) {
    el.fioPreview.textContent = r.data.text;
    return r;
  } else {
    el.fioPreview.textContent = `错误: ${r.msg}\n` + (r.data?.error || "");
    return r;
  }
}

/**
 :param cfg:         FioConfig
 :return:            {status,msg,data}
*/
function exportJson(cfg) {
  try {
    const text = JSON.stringify(cfg, null, 2);
    return downloadTextFile("fio_config.json", text);
  } catch (e) {
    return wrapErr("导出JSON失败", { error: String(e) });
  }
}

/**
 :param file:        File 对象
 :return:            Promise<{status,msg,data}>
*/
async function importJsonFile(file) {
  try {
    const text = await file.text();
    const obj = JSON.parse(text);
    if (!obj || !obj.global || !Array.isArray(obj.jobs)) {
      return wrapErr("JSON结构无效，请检查global/jobs字段");
    }
    // 兼容旧结构：如果存在字符串bs，尝试解析为bs_k
    obj.jobs = (obj.jobs || []).map((j) => {
      if (j.bs_k === undefined) {
        const n = parseBsToNumber(j.bs);
        if (Number.isFinite(n)) j.bs_k = n;
      }
      return j;
    });
    state.config = obj;
    // 导入后重置文件名，防止覆盖现有文件
    const newName = "imported_" + file.name.replace(/\.[^/.]+$/, "") + ".fio";
    el.configFilename.value = newName;
    if (el.currentFilenameDisplay) el.currentFilenameDisplay.textContent = newName;
    localStorage.setItem("fio_config_filename", newName);
    saveState(state.config);
    renderAll();
    refreshPreview(state.config);
    return wrapOk({}, "imported");
  } catch (e) {
    return wrapErr("导入JSON失败", { error: String(e) });
  }
}

/**
 :param idx:         任务索引
 :return:            删除操作结果
*/
function deleteJob(idx) {
  state.config.jobs.splice(idx, 1);
  saveState(state.config);
  renderAll();
  refreshPreview(state.config);
  return wrapOk();
}

/**
 :param idx:         任务索引
 :return:            复制操作结果
*/
function duplicateJob(idx) {
  const j = state.config.jobs[idx];
  const copy = JSON.parse(JSON.stringify(j));
  copy.name = `${j.name || "job"}_copy`;
  state.config.jobs.splice(idx + 1, 0, copy);
  saveState(state.config);
  renderAll();
  refreshPreview(state.config);
  return wrapOk();
}

/**
 :return:            添加一个新任务
*/
function addJob() {
  const newIdx = state.config.jobs.length;
  state.config.jobs.push({
    name: `job_${state.config.jobs.length}`,
    bs_k: 4,
    rw: "randread",
    rwmixread: 70,
    iodepth: 64,
    numjobs: 2,
    extras: {},
  });
  state.justAddedIndex = newIdx;
  saveState(state.config);
  renderAll();
  refreshPreview(state.config);
  return wrapOk();
}

/**
 :param container:   容器元素
 :param list:        键值对列表Record<string,string|number>
 :param onChange:    (key, value, i) => void
 :return:            创建KV编辑器
*/
function renderKVEditor(container, list, onChange) {
  container.innerHTML = "";
  const entries = Object.entries(list || {});
  entries.forEach(([k, v], i) => {
    const row = document.createElement("div");
    row.className = "kv-item";
    const keyInput = document.createElement("input");
    keyInput.placeholder = "键";
    keyInput.value = String(k);
    const valInput = document.createElement("input");
    valInput.placeholder = "值";
    valInput.value = String(v);
    const delBtn = document.createElement("button");
    delBtn.className = "btn danger small";
    delBtn.textContent = "删除";
    delBtn.onclick = () => {
      delete list[k];
      onChange("__delete__", null, i);
    };
    keyInput.oninput = () => onChange(keyInput.value, valInput.value, i);
    valInput.oninput = () => onChange(keyInput.value, valInput.value, i);
    row.appendChild(keyInput);
    row.appendChild(valInput);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
}

/** 渲染全局设置表单 */
// 全局可视化配置已移除；相关渲染与事件函数删除，逻辑保留在默认模板与 FIO 文本生成中。

/** 渲染所有Job卡片 */
function renderJobs() {
  el.jobsContainer.innerHTML = "";
  state.config.jobs.forEach((job, idx) => {
    const card = document.createElement("div");
    card.className = "job-card";
    const details = document.createElement("details");
    details.className = "job-details";
    const summary = document.createElement("summary");
    const summaryWrap = document.createElement("div"); summaryWrap.className = "job-summary";
    const summaryTitle = document.createElement("div"); summaryTitle.className = "job-summary-title"; summaryTitle.textContent = buildJobName(idx, job);
    const summaryMeta = document.createElement("div"); summaryMeta.className = "job-actions";
    const metaText = document.createElement("span"); metaText.textContent = `${getBsText(job)}, ${job.rw || "rw"}, iodepth=${job.iodepth ?? ""}, numjobs=${job.numjobs ?? ""}`;
    const dupBtn = document.createElement("button"); dupBtn.className = "btn small"; dupBtn.textContent = "复制"; dupBtn.onclick = (e) => { e.preventDefault(); duplicateJob(idx); };
    const delBtn = document.createElement("button"); delBtn.className = "btn danger small"; delBtn.textContent = "删除"; delBtn.onclick = (e) => { e.preventDefault(); deleteJob(idx); };
    summaryMeta.appendChild(metaText); summaryMeta.appendChild(dupBtn); summaryMeta.appendChild(delBtn);
    summaryWrap.appendChild(summaryTitle); summaryWrap.appendChild(summaryMeta);
    summary.appendChild(summaryWrap);
    details.appendChild(summary);

    const grid = document.createElement("div"); grid.className = "job-grid";
    const addField = (label, value, oninput, type = "text", options) => {
      const wrap = document.createElement("div"); wrap.className = "form-item";
      const lab = document.createElement("label"); lab.textContent = label;
      if (options && Array.isArray(options)) {
        const sel = document.createElement("select"); options.forEach((opt) => { const o = document.createElement("option"); o.value = opt; o.textContent = opt; sel.appendChild(o); });
        sel.value = value ?? options[0]; sel.oninput = oninput.bind(sel);
        wrap.appendChild(lab); wrap.appendChild(sel);
      } else {
        const inp = document.createElement("input"); inp.type = type; inp.value = value ?? ""; inp.oninput = oninput.bind(inp);
        wrap.appendChild(lab); wrap.appendChild(inp);
      }
      grid.appendChild(wrap);
      return wrap;
    };

    // 名称字段移除：名称由配置自动生成并显示在折叠标题中
    // bs（单位固定k，仅填写数字）
    addField("bs（单位:k）", job.bs_k, function () { job.bs_k = Number(this.value); saveState(state.config); summaryTitle.textContent = buildJobName(idx, job); refreshPreview(state.config); }, "number");
    // rw
    let mixWrap = null;
    addField("rw", job.rw, function () {
      job.rw = this.value;
      // 切换 rwmixread 可见性：仅在 rw=rw/readwrite/randrw 时显示
      const needMix = (job.rw === "rw" || job.rw === "readwrite" || job.rw === "randrw");
      if (mixWrap) mixWrap.style.display = needMix ? "" : "none";
      saveState(state.config);
      summaryTitle.textContent = buildJobName(idx, job);
      refreshPreview(state.config);
    }, "text", ["read","write","readwrite","randread","randwrite","randrw"]);
    // rwmixread（仅在顺序混合读写时显示）
    mixWrap = addField("rwmixread", job.rwmixread, function () { job.rwmixread = Number(this.value); saveState(state.config); refreshPreview(state.config); }, "number");
    mixWrap.style.display = (job.rw === "rw" || job.rw === "readwrite" || job.rw === "randrw") ? "" : "none";
    // iodepth
    addField("iodepth", job.iodepth, function () { job.iodepth = Number(this.value); saveState(state.config); summaryTitle.textContent = buildJobName(idx, job); refreshPreview(state.config); }, "number");
    // numjobs
    addField("numjobs", job.numjobs, function () { job.numjobs = Number(this.value); saveState(state.config); refreshPreview(state.config); }, "number");

    details.appendChild(grid);
    card.appendChild(details);
    el.jobsContainer.appendChild(card);

    // 新添加的任务默认展开
    if (state.justAddedIndex === idx) {
      details.open = true;
    }
  });
  // 重置标志
  state.justAddedIndex = null;
}

/** 渲染整个页面 */
function renderAll() {
  renderJobs();
}

/** 绑定头部与全局事件 */
function bindHeaderEvents() {
  el.addJobBtn.onclick = () => addJob();
  el.exportJsonBtn.onclick = () => exportJson(state.config);
  el.importJsonBtn.onclick = () => el.jsonFileInput.click();
  el.downloadFioBtn.onclick = () => {
    const r = generateFio(state.config);
    if (r.status === 0) downloadTextFile("fio_config.fio", r.data.text);
  };
  if (el.refreshConfigsBtn) {
    el.refreshConfigsBtn.onclick = () => fetchSavedConfigs();
  }
  if (el.newConfigBtn) {
    el.newConfigBtn.onclick = () => createNewConfig();
  }
  el.configFilename.oninput = () => {
    localStorage.setItem("fio_config_filename", el.configFilename.value);
    triggerAutoSave();
  };
  el.refreshPreviewBtn.onclick = () => refreshPreview(state.config);

  if (el.fioPreview) {
    el.fioPreview.ondblclick = () => {
      if (state.isEditingFio) return;
      state.isEditingFio = true;
      const text = el.fioPreview.textContent;
      const textarea = document.createElement("textarea");
      textarea.className = "code code-edit";
      textarea.value = text;
      
      const parent = el.fioPreview.parentNode;
      parent.replaceChild(textarea, el.fioPreview);
      textarea.focus();

      textarea.onblur = async () => {
        const newText = textarea.value;
        state.isEditingFio = false;
        
        // 保存到服务器
        const name = el.configFilename.value.trim() || "custom.fio";
        try {
          if (el.saveStatus) {
            el.saveStatus.textContent = "保存中...";
            el.saveStatus.className = "save-status saving";
          }
          const res = await fetch('/api/scripts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name, content: newText })
          });
          if (res.ok) {
            if (el.saveStatus) {
              el.saveStatus.textContent = "保存成功";
              el.saveStatus.className = "save-status success";
              setTimeout(() => {
                if (el.saveStatus.textContent === "保存成功") el.saveStatus.textContent = "";
              }, 3000);
            }
            
            // 尝试同步 JSON 状态 (如果包含 JSON 注释)
            const match = newText.match(/# FIO_CONFIG_JSON: (.*)$/m);
            if (match) {
              try {
                const cfg = JSON.parse(match[1]);
                state.config = cfg;
                saveState(state.config);
                renderAll();
              } catch (e) {
                console.warn("无法从手动编辑同步 JSON", e);
              }
            }
          } else {
            alert("保存失败: " + await res.text());
          }
        } catch (e) {
          alert("保存异常: " + e.message);
        }

        // 切换回 pre
        el.fioPreview.textContent = newText;
        parent.replaceChild(el.fioPreview, textarea);
      };
    };
  }

  el.jsonFileInput.onchange = async (ev) => {
    const f = ev.target.files[0];
    if (f) await importJsonFile(f);
    el.jsonFileInput.value = ""; // 清空，以便重复导入
  };
  if (el.refreshScriptsBtn) {
    el.refreshScriptsBtn.onclick = async () => {
      try {
        await fetchExecutionScripts();
        renderExecutionTasks();
        appendLog("脚本列表已刷新");
      } catch (err) {
        appendLog("刷新脚本列表失败: " + err.message);
      }
    };
  }
  if (el.addExecutionTaskBtn) {
    el.addExecutionTaskBtn.onclick = () => {
      executionState.tasks.push(createExecutionTask());
      renderExecutionTasks();
      scheduleExecutionTasksSave();
    };
  }
  if (el.runAllTasksBtn) {
    el.runAllTasksBtn.onclick = () => runAllExecutionTasks();
  }
  if (el.clearLogBtn) {
    el.clearLogBtn.onclick = () => {
      el.executionLog.textContent = "";
    };
  }
  if (el.refreshAnalysisTasksBtn) {
    el.refreshAnalysisTasksBtn.onclick = () => loadAnalysisData();
  }
  if (el.generateAnalysisBtn) {
    el.generateAnalysisBtn.onclick = () => generateAnalysisReportForSelectedTask();
  }
  if (el.openAnalysisReportBtn) {
    el.openAnalysisReportBtn.onclick = () => openSelectedAnalysisReport();
  }
  if (el.downloadAnalysisBtn) {
    el.downloadAnalysisBtn.onclick = () => downloadSelectedAnalysisPackage();
  }
}

/** 初始化入口 */
function init() {
  const savedFilename = localStorage.getItem("fio_config_filename");
  if (savedFilename) {
    el.configFilename.value = savedFilename;
    if (el.currentFilenameDisplay) el.currentFilenameDisplay.textContent = savedFilename;
  }
  
  // Close modal when clicking overlay
  window.onclick = (event) => {
    if (event.target === el.resultsModal) {
      el.resultsModal.style.display = "none";
    }
    if (event.target === el.customPromptModal) {
      el.customPromptModal.style.display = "none";
    }
  };

  bindHeaderEvents();
  renderAll();
  refreshPreview(state.config);
  fetchSavedConfigs();
  loadExecutionData();
  loadAnalysisData();
}

// 启动
init();

/**
 :param job:        JobOptions
 :return:           返回如"256k"的文本
*/
function getBsText(job) {
  if (job && Number.isFinite(job.bs_k)) return `${job.bs_k}k`;
  if (job && job.bs) {
    const n = parseBsToNumber(job.bs);
    if (Number.isFinite(n)) return `${n}k`;
    // 原始字符串兜底
    return String(job.bs);
  }
  return "";
}

/**
 :param bs:        可能是"256"或"256k"等
 :return:          解析出数字部分
*/
function parseBsToNumber(bs) {
  if (bs === undefined || bs === null) return NaN;
  const m = String(bs).match(/^(\d+)/);
  return m ? Number(m[1]) : NaN;
}

/**
 :param idx:       任务顺序索引（从0开始）
 :param job:       JobOptions
 :return:          { bw, lat, iops } 三个日志路径
*/
function buildLogPaths(idx, job) {
  const base = "/tmp/fio/data/logs";
  const bsText = getBsText(job);
  const rwText = job.rw || "rw";
  const iodepthText = `iodepth${job.iodepth ?? ""}`;
  const prefix = `${base}/${idx}_${bsText}_${rwText}_${iodepthText}`;
  return {
    bw: `${prefix}_bw.log`,
    lat: `${prefix}_lat.log`,
    iops: `${prefix}_iops.log`,
  };
}

/**
 :param idx:       任务序号（从0开始）
 :param job:       JobOptions
 :return:          名称格式如：sec0_256k_read_iodepth32
*/
function buildJobName(idx, job) {
  const bsText = getBsText(job) || "";
  const rwText = job?.rw || "";
  const iodepthText = (job && job.iodepth !== undefined && job.iodepth !== null) ? `iodepth${job.iodepth}` : "iodepth";
  // 组装名称
  const parts = [`sec${idx}`, bsText, rwText, iodepthText].filter(Boolean);
  return parts.join("_");
}
