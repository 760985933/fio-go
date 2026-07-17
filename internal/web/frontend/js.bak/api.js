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

async function saveOrchestrationConfig() {
  const payload = {
    sequence: orchestrationState.sequence,
    interval: parseInt(el.orchestrationInterval.value) || 10
  };
  try {
    const res = await fetch("/api/orchestration-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
  } catch (err) {
    console.error("保存编排配置失败:", err);
  }
}

async function loadOrchestrationConfig() {
  try {
    const res = await fetch("/api/orchestration-config");
    if (!res.ok) {
      if (res.status !== 404) throw new Error(await res.text());
      return; // Not found is fine, use defaults
    }
    const data = await res.json();
    if (data.sequence && Array.isArray(data.sequence)) {
      orchestrationState.sequence = data.sequence;
    }
    if (data.interval !== undefined) {
      orchestrationState.interval = data.interval;
      if (el.orchestrationInterval) {
        el.orchestrationInterval.value = data.interval;
      }
    }
  } catch (err) {
    console.error("加载编排配置失败:", err);
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
    recordAuditLog("生成分析报告", `为任务 "${task.name}" 生成了性能分析报告`);
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
        if (isManual) {
          fetchSavedConfigs(); // 手动保存后刷新列表
          recordAuditLog("保存配置", `手动保存了 FIO 配置文件 "${name}"`);
        } else {
          // 只记录一次自动保存，避免频繁记录
          if (!state.lastAutoSaveLog || (Date.now() - state.lastAutoSaveLog > 60000)) { // 1分钟限制
            recordAuditLog("自动保存", `自动保存了 FIO 配置文件 "${name}"`);
            state.lastAutoSaveLog = Date.now();
          }
        }
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
    recordAuditLog("删除配置", `删除了 FIO 配置文件 "${filename}"`);
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
    
    recordAuditLog("重命名配置", `将配置文件 "${oldName}" 重命名为 "${finalNewName}"`);
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
  recordAuditLog("新建配置", `创建了新的 FIO 配置文件 "${finalFilename}"`);
  saveState(state.config);
  renderAll();
  refreshPreview(state.config);
  alert(`已重置为新配置: ${finalFilename}`);
}

// ---------- Audit Log ----------

async function recordAuditLog(action, details) {
  try {
    const payload = { action, details };
    await fetch("/api/audit-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error("Failed to record audit log:", err);
  }
}

async function loadAuditLog() {
  if (!el.auditLogTableBody) return;
  
  el.auditLogTableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: var(--muted);">加载中...</td></tr>';
  
  try {
    const res = await fetch("/api/audit-log");
    if (!res.ok) throw new Error(await res.text());
    
    const logs = await res.json();
    el.auditLogTableBody.innerHTML = "";
    
    if (!logs || logs.length === 0) {
      el.auditLogTableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: var(--muted);">暂无审计日志</td></tr>';
      return;
    }
    
    // Show newest first
    logs.reverse().forEach(log => {
      const tr = document.createElement("tr");
      
      const timeTd = document.createElement("td");
      const date = new Date(log.timestamp);
      timeTd.textContent = date.toLocaleString();
      
      const actionTd = document.createElement("td");
      const actionSpan = document.createElement("span");
      actionSpan.className = "status-badge success";
      actionSpan.textContent = log.action;
      actionTd.appendChild(actionSpan);
      
      const detailsTd = document.createElement("td");
      detailsTd.textContent = log.details;
      
      tr.appendChild(timeTd);
      tr.appendChild(actionTd);
      tr.appendChild(detailsTd);
      
      el.auditLogTableBody.appendChild(tr);
    });
  } catch (err) {
    el.auditLogTableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 20px; color: var(--danger);">加载失败: ${err.message}</td></tr>`;
  }
}
