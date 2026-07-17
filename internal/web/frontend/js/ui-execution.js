import { executionState } from './state.js';
import { el } from './dom.js';
import { fetchExecutionTaskLog, loadAnalysisData, recordAuditLog, scheduleExecutionTasksSave } from './api.js';
import { showConfirmModal, showHostLogModal, showResultsModal } from './utils.js';
import { renderOrchestrationTasks } from './ui-orchestration.js';

export function createExecutionHost(host = "") {
  return {
    host,
    port: 22,
    user: "root",
    password: "",
  };
}

export function createExecutionTask(partial = {}) {
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

export function setExecutionTaskStatus(text = "", type = "") {
  if (!el.executionTaskStatus) return;
  el.executionTaskStatus.textContent = text;
  el.executionTaskStatus.className = `save-status${type ? ` ${type}` : ""}`;
}

export function appendLog(msg) {
  if (!el.executionLog) return;
  const time = new Date().toLocaleTimeString();
  el.executionLog.textContent += `[${time}] ${msg}\n`;
  el.executionLog.scrollTop = el.executionLog.scrollHeight;
}

export function normalizeExecutionTaskForRequest(task) {
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

export function appendTaskLocalLog(taskId, message) {
  const time = new Date().toLocaleTimeString();
  const existing = executionState.logs[taskId] || "";
  executionState.logs[taskId] = `${existing}${existing ? "\n" : ""}[${time}] ${message}`;
}

export function buildScriptSelect(selectedScript) {
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

export function renderExecutionTasks() {
  if (!el.executionTasksContainer) return;
  el.executionTasksContainer.innerHTML = "";

  if (executionState.tasks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "execution-empty";
    empty.textContent = "暂无执行任务，请先新增任务。";
    el.executionTasksContainer.appendChild(empty);
  } else {
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
      { action: "clean_local", text: "清理服务器端", className: "btn" },
      { action: "clean_remote", text: "清理目标主机", className: "btn" },
    ];

    actionConfigs.forEach(config => {
      const button = document.createElement("button");
      button.className = config.className;
      button.textContent = config.text;
      button.onclick = async () => {
        if (config.action === "clean_local") {
          const content = `
            <div style="margin-bottom: 15px; color: var(--muted);">确定要清理任务 <strong>${task.name}</strong> 在服务器端的历史数据吗？</div>
            <ul style="padding-left: 20px; font-size: 14px; line-height: 1.6;">
              <li><strong>原始数据：</strong>data/tasks/${task.id}/*</li>
              <li><strong>分析报告：</strong>reports/${task.id}/*</li>
              <li><strong>执行日志：</strong>本地任务执行记录</li>
            </ul>
          `;
          if (!await showConfirmModal("确认清理服务器端数据", content)) return;
        }

        if (config.action === "clean_remote") {
          const hostsHtml = task.hosts.map(h => `<tr><td>${h.user}@${h.host}:${h.port}</td><td>/tmp/fio-go/tasks/${task.id}</td></tr>`).join("");
          const content = `
            <div style="margin-bottom: 15px; color: var(--muted);">确定要清理任务 <strong>${task.name}</strong> 在以下目标主机上的工作目录吗？</div>
            <table class="results-table">
              <thead><tr><th>主机</th><th>清理路径</th></tr></thead>
              <tbody>${hostsHtml}</tbody>
            </table>
          `;
          if (!await showConfirmModal("确认清理目标主机数据", content)) return;
        }

        if (config.action === "pull") {
          try {
            const checkRes = await fetch("/api/execute", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "pre_deploy_check", task: task }),
            });
            if (checkRes.ok) {
              const checkData = await checkRes.json();
              const results = checkData.results || [];
              const runningHosts = results.filter(r => r.running);
              const noDataHosts = results.filter(r => !r.residual);

              if (noDataHosts.length === results.length) {
                const content = `<div style="color: var(--muted);">任务 <strong>${task.name}</strong> 在所有目标主机上均未发现历史数据，请先执行“部署并执行”。</div>`;
                await showConfirmModal("无法采集数据", content, false);
                return;
              }

              if (runningHosts.length > 0) {
                const hostsTable = runningHosts.map(h => `<tr><td>${h.host}</td><td style="color:var(--warning)">正在运行</td></tr>`).join("");
                const content = `
                  <div style="margin-bottom: 15px; color: var(--muted);">任务 <strong>${task.name}</strong> 仍在以下主机上运行：</div>
                  <table class="results-table">
                    <thead><tr><th>主机</th><th>状态</th></tr></thead>
                    <tbody>${hostsTable}</tbody>
                  </table>
                  <div style="margin-top: 15px; font-weight: bold; color: var(--warning);">任务尚未结束，此时收集的数据可能不完整，是否继续收集？</div>
                `;
                if (!await showConfirmModal("采集预检 - 任务运行中", content, false)) return;
              }
            }
          } catch (e) {
            console.error("Pre-pull check failed", e);
          }
        }

        if (config.action === "killall") {
          try {
            const checkRes = await fetch("/api/execute", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "pre_deploy_check", task: task }),
            });
            if (checkRes.ok) {
              const checkData = await checkRes.json();
              const runningHosts = (checkData.results || []).filter(r => r.running);

              if (runningHosts.length === 0) {
                const content = `<div style="color: var(--muted);">任务 <strong>${task.name}</strong> 在所有配置的主机上均未发现运行中的进程。</div>`;
                await showConfirmModal("无需终止", content, false);
                return;
              }

              const hostsTable = runningHosts.map(h => `<tr><td>${h.host}</td><td style="color:var(--danger)">${h.msg}</td></tr>`).join("");
              const content = `
                <div style="margin-bottom: 15px; color: var(--muted);">发现任务 <strong>${task.name}</strong> 正在以下主机上运行：</div>
                <table class="results-table">
                  <thead><tr><th>主机</th><th>当前状态</th></tr></thead>
                  <tbody>${hostsTable}</tbody>
                </table>
                <div style="margin-top: 15px; font-weight: bold; color: var(--danger);">确定要强制终止这些进程吗？</div>
              `;
              if (!await showConfirmModal("确认终止运行中的任务", content, true)) return;
            }
          } catch (e) {
            console.error("Pre-kill check failed", e);
          }
        }

        if (config.action === "deploy") {
          // 1. 前置检查：运行状态和残留数据
          try {
            const checkRes = await fetch("/api/execute", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "pre_deploy_check", task: task }),
            });
            if (checkRes.ok) {
              const checkData = await checkRes.json();
              const results = checkData.results || [];
              const runningHosts = results.filter(r => r.running);
              const residualHosts = results.filter(r => r.residual && !r.running);

              if (runningHosts.length > 0) {
                const hostsTable = runningHosts.map(h => `<tr><td>${h.host}</td><td style="color:var(--danger)">正在运行</td></tr>`).join("");
                const content = `
                  <div style="margin-bottom: 15px; color: var(--muted);">任务 <strong>${task.name}</strong> 正在以下主机上执行：</div>
                  <table class="results-table">
                    <thead><tr><th>主机</th><th>状态</th></tr></thead>
                    <tbody>${hostsTable}</tbody>
                  </table>
                  <div style="margin-top: 15px; font-weight: bold; color: var(--danger);">请先终止正在运行的任务，再尝试重新部署。</div>
                `;
                await showConfirmModal("部署拦截 - 任务运行中", content, true);
                return;
              }

              if (residualHosts.length > 0) {
                const hostsTable = residualHosts.map(h => `<tr><td>${h.host}</td><td style="color:var(--warning)">发现历史数据</td></tr>`).join("");
                const content = `
                  <div style="margin-bottom: 15px; color: var(--muted);">发现任务 <strong>${task.name}</strong> 在以下主机上已有历史数据（可能来自之前的执行）：</div>
                  <table class="results-table">
                    <thead><tr><th>主机</th><th>状态</th></tr></thead>
                    <tbody>${hostsTable}</tbody>
                  </table>
                  <div style="margin-top: 15px; font-weight: bold; color: var(--warning);">重新部署将清除远端残留并重新开始，是否继续？</div>
                `;
                if (!await showConfirmModal("部署预检 - 发现残留数据", content, false)) return;
              }
            }
          } catch (e) {
            console.error("Pre-deploy check failed", e);
            // 预检失败通常不阻塞部署，但记录日志
          }

          button.disabled = true;
          const originalText = button.textContent;
          let seconds = 5;
          button.textContent = `${originalText} (${seconds}s)`;
          
          const timer = setInterval(() => {
            seconds--;
            if (seconds > 0) {
              button.textContent = `${originalText} (${seconds}s)`;
            } else {
              clearInterval(timer);
              button.disabled = false;
              button.textContent = originalText;
            }
          }, 1000);
        }
        await runExecutionAction(config.action, task);
      };
      actionGroup.appendChild(button);
    });

    const deleteTaskBtn = document.createElement("button");
    deleteTaskBtn.className = "btn";
    deleteTaskBtn.textContent = "删除任务";
    deleteTaskBtn.onclick = () => {
      if (!confirm(`确定要删除任务 "${task.name || "未命名任务"}" 吗？此操作将清除本地任务配置。`)) {
        return;
      }
      recordAuditLog("删除执行任务", `删除了执行任务 "${task.name || "未命名任务"}"`);
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
      recordAuditLog("添加主机", `为任务 "${task.name || "未命名任务"}" 添加了新主机配置`);
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

      // 状态小圆点
      const statusDot = document.createElement("span");
      statusDot.className = `status-dot dot-${hostCfg.status || "gray"}`;
      statusDot.title = hostCfg.statusMsg || "未测试连接";

      const hostInput = document.createElement("input");
      hostInput.placeholder = "主机/IP";
      hostInput.value = hostCfg.host || "";
      hostInput.oninput = (event) => {
        hostCfg.host = event.target.value;
        hostCfg.status = "gray"; // 修改后重置状态
        statusDot.className = "status-dot dot-gray";
        scheduleExecutionTasksSave();
      };

      const portInput = document.createElement("input");
      portInput.type = "number";
      portInput.placeholder = "端口";
      portInput.value = String(hostCfg.port || 22);
      portInput.oninput = (event) => {
        hostCfg.port = Number(event.target.value) || 22;
        hostCfg.status = "gray";
        statusDot.className = "status-dot dot-gray";
        scheduleExecutionTasksSave();
      };

      const userInput = document.createElement("input");
      userInput.placeholder = "用户名";
      userInput.value = hostCfg.user || "root";
      userInput.oninput = (event) => {
        hostCfg.user = event.target.value;
        hostCfg.status = "gray";
        statusDot.className = "status-dot dot-gray";
        scheduleExecutionTasksSave();
      };

      const passwordInput = document.createElement("input");
      passwordInput.type = "password";
      passwordInput.placeholder = "密码（可选）";
      passwordInput.value = hostCfg.password || "";
      passwordInput.oninput = (event) => {
        hostCfg.password = event.target.value;
        hostCfg.status = "gray";
        statusDot.className = "status-dot dot-gray";
        scheduleExecutionTasksSave();
      };

      const removeBtn = document.createElement("button");
      removeBtn.className = "btn danger small";
      removeBtn.textContent = "删除";
      removeBtn.onclick = () => {
        recordAuditLog("删除主机", `从任务 "${task.name || "未命名任务"}" 中删除了主机配置 ${hostCfg.host || "未命名主机"}`);
        task.hosts.splice(hostIndex, 1);
        renderExecutionTasks();
        scheduleExecutionTasksSave();
      };

      const viewLogBtn = document.createElement("button");
      viewLogBtn.className = "btn small";
      viewLogBtn.textContent = "实时日志";
      viewLogBtn.onclick = () => {
        showHostLogModal(task.id, `${hostCfg.user}@${hostCfg.host}:${hostCfg.port}`);
      };

      const testConnBtn = document.createElement("button");
      testConnBtn.className = "btn success small";
      testConnBtn.textContent = "测试连接";
      testConnBtn.onclick = async () => {
        testConnBtn.disabled = true;
        testConnBtn.textContent = "测试中...";
        statusDot.className = "status-dot dot-gray";
        
        try {
          const res = await fetch("/api/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "check_connectivity",
              task: { id: task.id, hosts: [hostCfg] }
            }),
          });
          const data = await res.json();
          if (data.success) {
            hostCfg.status = "green";
            hostCfg.statusMsg = "连接成功";
            recordAuditLog("测试连接", `任务 "${task.name || "未命名任务"}" 中的主机 ${hostCfg.host || "未命名主机"} 连接测试成功`);
          } else {
            hostCfg.status = "red";
            hostCfg.statusMsg = `连接失败: ${data.error || "未知错误"}`;
            recordAuditLog("测试连接", `任务 "${task.name || "未命名任务"}" 中的主机 ${hostCfg.host || "未命名主机"} 连接测试失败`);
          }
        } catch (err) {
          hostCfg.status = "red";
          hostCfg.statusMsg = `请求失败: ${err.message}`;
          recordAuditLog("测试连接", `任务 "${task.name || "未命名任务"}" 中的主机 ${hostCfg.host || "未命名主机"} 连接测试发生异常`);
        } finally {
          testConnBtn.disabled = false;
          testConnBtn.textContent = "测试连接";
          statusDot.className = `status-dot dot-${hostCfg.status}`;
          statusDot.title = hostCfg.statusMsg;
          scheduleExecutionTasksSave();
        }
      };

      hostRow.appendChild(statusDot);
      hostRow.appendChild(hostInput);
      hostRow.appendChild(portInput);
      hostRow.appendChild(userInput);
      hostRow.appendChild(passwordInput);
      hostRow.appendChild(testConnBtn);
      hostRow.appendChild(viewLogBtn);
      hostRow.appendChild(removeBtn);
      hostList.appendChild(hostRow);
    });

    const taskLogWrap = document.createElement("div");
    taskLogWrap.className = "execution-task-log";

    const taskLogHeader = document.createElement("div");
    taskLogHeader.className = "log-header";

    const logTitleContainer = document.createElement("div");
    logTitleContainer.style.display = "flex";
    logTitleContainer.style.alignItems = "center";
    logTitleContainer.style.gap = "15px";

    const taskLogTitle = document.createElement("h4");
    taskLogTitle.textContent = "任务日志";

    const autoRefreshLabel = document.createElement("label");
    autoRefreshLabel.style.display = "flex";
    autoRefreshLabel.style.alignItems = "center";
    autoRefreshLabel.style.gap = "6px";
    autoRefreshLabel.style.fontSize = "13px";
    autoRefreshLabel.style.color = "var(--muted)";
    autoRefreshLabel.style.cursor = "pointer";

    const autoRefreshCheckbox = document.createElement("input");
    autoRefreshCheckbox.type = "checkbox";
    autoRefreshCheckbox.checked = !!executionState.refreshTimers[task.id];
    autoRefreshCheckbox.onchange = (e) => {
      if (e.target.checked) {
        executionState.refreshTimers[task.id] = setInterval(async () => {
          try {
            await fetchExecutionTaskLog(task.id);
            // 只更新当前卡片的日志显示，不重新渲染整个列表
            taskLogViewer.textContent = executionState.logs[task.id] || "暂无任务日志";
            taskLogViewer.scrollTop = taskLogViewer.scrollHeight;
          } catch (err) {
            console.error(`Auto refresh failed for ${task.id}:`, err);
          }
        }, 5000);
      } else {
        clearInterval(executionState.refreshTimers[task.id]);
        delete executionState.refreshTimers[task.id];
      }
    };

    autoRefreshLabel.appendChild(autoRefreshCheckbox);
    autoRefreshLabel.appendChild(document.createTextNode("自动刷新 (5s)"));

    logTitleContainer.appendChild(taskLogTitle);
    logTitleContainer.appendChild(autoRefreshLabel);

    const refreshLogBtn = document.createElement("button");
    refreshLogBtn.className = "btn small";
    refreshLogBtn.textContent = "刷新日志";
    refreshLogBtn.onclick = async () => {
      try {
        await fetchExecutionTaskLog(task.id);
        taskLogViewer.textContent = executionState.logs[task.id] || "暂无任务日志";
        taskLogViewer.scrollTop = taskLogViewer.scrollHeight;
      } catch (err) {
        appendLog(`刷新 ${task.name} 日志失败: ${err.message}`);
      }
    };

    taskLogHeader.appendChild(logTitleContainer);
    taskLogHeader.appendChild(refreshLogBtn);

    const taskLogViewer = document.createElement("pre");
    taskLogViewer.textContent = executionState.logs[task.id] || "暂无任务日志";
    taskLogViewer.scrollTop = taskLogViewer.scrollHeight;

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
  
  // Update orchestration available tasks list
  if (typeof renderOrchestrationTasks === "function") {
    renderOrchestrationTasks();
  }
}

export async function runExecutionAction(action, task) {
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
    
    if (action === "status" || action === "pull" || action === "killall" || action === "deploy" || action === "clean_local" || action === "clean_remote") {
      const data = await res.json();
      showResultsModal(data);
      const actionNames = { "status": "状态检查", "pull": "数据收集", "killall": "终止任务", "deploy": "部署并执行", "clean_local": "清理服务器端", "clean_remote": "清理目标主机" };
      appendLog(`任务 "${requestTask.name}" ${actionNames[action] || action}完成`);
      recordAuditLog(actionNames[action] || action, `对任务 "${requestTask.name}" 执行了操作: ${actionNames[action] || action}`);
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
