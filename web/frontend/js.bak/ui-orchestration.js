function renderOrchestrationTasks() {
  if (!el.availableTasksList || !el.orchestrationList) return;
  
  el.availableTasksList.innerHTML = "";
  
  const validTasks = executionState.tasks.filter(t => t.name && t.script && t.hosts.length > 0);
  
  if (validTasks.length === 0) {
    el.availableTasksList.innerHTML = '<div style="color:var(--muted); font-size:13px;">暂无可用的完整任务（需配置名称、脚本、主机）</div>';
  } else {
    validTasks.forEach(task => {
      const taskEl = document.createElement("div");
      taskEl.className = "orchestration-task-item";
      taskEl.textContent = task.name;
      taskEl.draggable = true;
      taskEl.dataset.taskId = task.id;
      
      taskEl.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("application/task-id", task.id);
        taskEl.style.opacity = "0.5";
      });
      
      taskEl.addEventListener("dragend", (e) => {
        taskEl.style.opacity = "1";
      });
      
      el.availableTasksList.appendChild(taskEl);
    });
  }

  // Clone node to remove old event listeners to prevent duplicate triggers
  const newOrchestrationList = el.orchestrationList.cloneNode(false);
  el.orchestrationList.parentNode.replaceChild(newOrchestrationList, el.orchestrationList);
  el.orchestrationList = newOrchestrationList;

  // Setup drop zone
  el.orchestrationList.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    el.orchestrationList.style.borderColor = "var(--primary)";
    el.orchestrationList.style.background = "#f0f8ff";
  });

  el.orchestrationList.addEventListener("dragleave", (e) => {
    el.orchestrationList.style.borderColor = "#ccc";
    el.orchestrationList.style.background = "#fff";
  });

  el.orchestrationList.addEventListener("drop", (e) => {
    e.preventDefault();
    el.orchestrationList.style.borderColor = "#ccc";
    el.orchestrationList.style.background = "#fff";
    
    // Calculate drop index based on mouse Y position
    const elements = [...el.orchestrationList.querySelectorAll('.orchestration-sequence-item')];
    let dropIndex = elements.length;
    for (let i = 0; i < elements.length; i++) {
      const box = elements[i].getBoundingClientRect();
      if (e.clientY < box.top + box.height / 2) {
        dropIndex = i;
        break;
      }
    }
    
    const newTaskId = e.dataTransfer.getData("application/task-id");
    const moveIndexStr = e.dataTransfer.getData("application/seq-index");
    
    if (newTaskId) {
      const task = validTasks.find(t => t.id === newTaskId);
      if (task) {
        orchestrationState.sequence.splice(dropIndex, 0, task.id);
        recordAuditLog("添加编排任务", `将任务 "${task.name}" 添加到编排序列中`);
      }
    } else if (moveIndexStr !== "") {
      const fromIdx = parseInt(moveIndexStr, 10);
      if (!isNaN(fromIdx) && fromIdx !== dropIndex) {
        const targetIdx = dropIndex > fromIdx ? dropIndex - 1 : dropIndex;
        const [movedTaskId] = orchestrationState.sequence.splice(fromIdx, 1);
        orchestrationState.sequence.splice(targetIdx, 0, movedTaskId);
        const task = validTasks.find(t => t.id === movedTaskId) || executionState.tasks.find(t => t.id === movedTaskId);
        recordAuditLog("调整编排顺序", `将任务 "${task ? task.name : movedTaskId}" 移动到序列位置 ${targetIdx + 1}`);
      }
    }
    
    renderOrchestrationSequence(validTasks);
    saveOrchestrationConfig();
  });
  
  renderOrchestrationSequence(validTasks);
}

function renderOrchestrationSequence(validTasks) {
  if (!el.orchestrationList) return;
  el.orchestrationList.innerHTML = "";
  
  if (orchestrationState.sequence.length === 0) {
    el.orchestrationList.innerHTML = '<div class="empty-placeholder" style="text-align: center; color: var(--muted); padding: 20px;">拖拽左侧任务到此处</div>';
    return;
  }
  
  orchestrationState.sequence.forEach((taskId, index) => {
    const task = validTasks.find(t => t.id === taskId) || executionState.tasks.find(t => t.id === taskId);
    if (!task) return;
    
    const itemEl = document.createElement("div");
    itemEl.className = "orchestration-sequence-item";
    itemEl.draggable = true; // Make item draggable for reordering
    
    itemEl.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("application/seq-index", index.toString());
      setTimeout(() => itemEl.style.opacity = "0.5", 0);
    });
    
    itemEl.addEventListener("dragend", (e) => {
      itemEl.style.opacity = "1";
    });
    
    const indexSpan = document.createElement("span");
    indexSpan.className = "seq-index";
    indexSpan.textContent = index + 1;
    
    const nameSpan = document.createElement("span");
    nameSpan.className = "seq-name";
    nameSpan.textContent = task.name;
    
    const removeBtn = document.createElement("button");
        removeBtn.className = "btn danger small";
        removeBtn.textContent = "移除";
        removeBtn.onclick = () => {
          if (orchestrationState.isRunning) {
            appendOrchestrationLog("编排正在运行，无法移除任务");
            return;
          }
          orchestrationState.sequence.splice(index, 1);
          recordAuditLog("移除编排任务", `从编排序列中移除了任务 "${task.name}"`);
          renderOrchestrationSequence(validTasks);
          saveOrchestrationConfig();
        };
    
    itemEl.appendChild(indexSpan);
    itemEl.appendChild(nameSpan);
    itemEl.appendChild(removeBtn);
    
    el.orchestrationList.appendChild(itemEl);
  });
}

function appendOrchestrationLog(msg) {
  if (!el.orchestrationLog) return;
  const time = new Date().toLocaleTimeString();
  el.orchestrationLog.textContent += `[${time}] ${msg}\n`;
  el.orchestrationLog.scrollTop = el.orchestrationLog.scrollHeight;
}

async function startOrchestration() {
  if (orchestrationState.isRunning) return;
  if (orchestrationState.sequence.length === 0) {
    alert("请先拖拽任务到编排列表");
    return;
  }
  
  const interval = parseInt(el.orchestrationInterval.value) || 0;
  
  orchestrationState.isRunning = true;
  orchestrationState.shouldStop = false;
  el.startOrchestrationBtn.style.display = "none";
  el.stopOrchestrationBtn.style.display = "inline-block";
  el.orchestrationInterval.disabled = true;
  
  appendOrchestrationLog(`开始编排执行，共 ${orchestrationState.sequence.length} 个任务，间隔 ${interval} 秒`);
  recordAuditLog("开始任务编排", `开始执行编排任务，共 ${orchestrationState.sequence.length} 个任务`);
  
  for (let i = 0; i < orchestrationState.sequence.length; i++) {
    if (orchestrationState.shouldStop) {
      appendOrchestrationLog("编排执行已被手动停止");
      break;
    }
    
    const taskId = orchestrationState.sequence[i];
    const task = executionState.tasks.find(t => t.id === taskId);
    if (!task) {
      appendOrchestrationLog(`任务ID ${taskId} 不存在，跳过`);
      continue;
    }
    
    appendOrchestrationLog(`[${i+1}/${orchestrationState.sequence.length}] 开始部署并执行任务: ${task.name}`);
    
    // Highlight current task in UI
    const items = el.orchestrationList.querySelectorAll(".orchestration-sequence-item");
    items.forEach((item, idx) => {
      item.style.background = idx === i ? "#e8f4f8" : "#fff";
      item.style.borderColor = idx === i ? "var(--primary)" : "var(--border)";
    });

    try {
      const requestTask = normalizeExecutionTaskForRequest(task);
      const deployRes = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deploy", task: requestTask }),
      });
      
      if (!deployRes.ok) {
        throw new Error(await deployRes.text());
      }
      appendOrchestrationLog(`任务 ${task.name} 部署请求成功，开始轮询状态...`);
      
      // 轮询状态，直到所有主机的 FIO 进程都不再 Running
      let isRunning = true;
      while (isRunning) {
        if (orchestrationState.shouldStop) break;
        
        await new Promise(r => setTimeout(r, 5000)); // 每 5 秒轮询一次
        
        const statusRes = await fetch("/api/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status", task: requestTask }),
        });
        
        if (!statusRes.ok) {
          appendOrchestrationLog(`检查任务状态失败: ${await statusRes.text()}`);
          continue;
        }
        
        const statusData = await statusRes.json();
        // statusData is array of {host, msg, error}
        // msg will contain "Running: true" or similar based on backend.
        // Look at backend to see exactly what status returns. Let's assume if any host returns "Running", it's still running.
        const anyRunning = statusData.results && statusData.results.some(res => res.msg && res.msg.includes("Running"));
        
        if (!anyRunning) {
          isRunning = false;
          appendOrchestrationLog(`任务 ${task.name} 在所有主机上执行完毕`);
        }
      }
      
    } catch (err) {
      appendOrchestrationLog(`执行任务 ${task.name} 发生异常: ${err.message}`);
      appendOrchestrationLog(`跳过当前任务，继续执行后续流程`);
    }
    
    if (i < orchestrationState.sequence.length - 1 && !orchestrationState.shouldStop) {
      appendOrchestrationLog(`等待 ${interval} 秒后执行下一个任务...`);
      await new Promise(r => setTimeout(r, interval * 1000));
    }
  }
  
  if (!orchestrationState.shouldStop) {
    appendOrchestrationLog("所有编排任务执行完成");
  }
  
  orchestrationState.isRunning = false;
  el.startOrchestrationBtn.style.display = "inline-block";
  el.stopOrchestrationBtn.style.display = "none";
  el.orchestrationInterval.disabled = false;
  
  // Remove highlighting
  const items = el.orchestrationList.querySelectorAll(".orchestration-sequence-item");
  items.forEach(item => {
    item.style.background = "#fff";
    item.style.borderColor = "var(--border)";
  });
}

function stopOrchestration() {
  if (!orchestrationState.isRunning) return;
  orchestrationState.shouldStop = true;
  appendOrchestrationLog("正在停止编排，等待当前轮询/延迟结束...");
  recordAuditLog("停止任务编排", "手动停止了任务编排执行");
  el.stopOrchestrationBtn.disabled = true;
  el.stopOrchestrationBtn.textContent = "停止中...";
  
  // Reset button state later in startOrchestration's finally block
  setTimeout(() => {
    el.stopOrchestrationBtn.disabled = false;
    el.stopOrchestrationBtn.textContent = "停止编排";
  }, 2000);
}
