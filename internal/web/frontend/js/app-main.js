import { createNewConfig, downloadSelectedAnalysisPackage, fetchExecutionScripts, fetchSavedConfigs, generateAnalysisReportForSelectedTask, loadAnalysisData, loadAuditLog, loadExecutionData, loadOrchestrationConfig, openSelectedAnalysisReport, recordAuditLog, saveOrchestrationConfig, scheduleExecutionTasksSave, triggerAutoSave } from './api.js';
import { el } from './dom.js';
import { addJob, exportJson, importJsonFile, refreshPreview, renderAll } from './ui-fio.js';
import { executionState, saveState, state } from './state.js';
import { generateFio } from './fio-generator.js';
import { downloadTextFile } from './utils.js';
import { appendLog, createExecutionTask, renderExecutionTasks } from './ui-execution.js';
import { renderOrchestrationTasks, startOrchestration, stopOrchestration } from './ui-orchestration.js';

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
      if (targetId === 'audit-tab') {
        loadAuditLog();
      }
    }
  });
});

/** 绑定头部与全局事件 */
export function bindHeaderEvents() {
  el.addJobBtn.onclick = () => addJob();
  el.exportJsonBtn.onclick = () => exportJson(state.config);
  el.importJsonBtn.onclick = () => el.jsonFileInput.click();
  el.downloadFioBtn.onclick = () => {
    const r = generateFio(state.config);
    if (r.status === 0) {
      recordAuditLog("下载 FIO 配置", `下载了当前的 FIO 配置内容`);
      downloadTextFile("fio_config.fio", r.data.text);
    }
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
            recordAuditLog("手动编辑配置", `手动编辑并保存了 FIO 配置文件 "${name}"`);
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
      recordAuditLog("新增执行任务", "添加了一个新的空白执行任务");
      renderExecutionTasks();
      scheduleExecutionTasksSave();
    };
  }
  if (el.clearLogBtn) {
    el.clearLogBtn.onclick = () => {
      el.executionLog.textContent = "";
    };
  }
  if (el.clearOrchestrationLogBtn) {
    el.clearOrchestrationLogBtn.onclick = () => {
      el.orchestrationLog.textContent = "";
    };
  }

  if (el.orchestrationInterval) {
    el.orchestrationInterval.addEventListener("change", () => {
      saveOrchestrationConfig();
    });
  }

  // Bind orchestration sub-tab events
  const executeSubTabs = document.querySelectorAll("#execute-tab .sub-tab");
  executeSubTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      executeSubTabs.forEach(t => {
        t.classList.remove("active");
        t.style.fontWeight = "normal";
        t.style.borderBottom = "none";
        t.style.color = "var(--muted)";
      });
      tab.classList.add("active");
      tab.style.fontWeight = "500";
      tab.style.borderBottom = "2px solid var(--primary)";
      tab.style.color = "var(--primary)";

      const targetId = tab.getAttribute("data-target");
      if (targetId === "execute-tasks-subtab") {
        el.executeTasksSubtab.style.display = "block";
        el.executeOrchestrationSubtab.style.display = "none";
      } else {
        el.executeTasksSubtab.style.display = "none";
        el.executeOrchestrationSubtab.style.display = "block";
        renderOrchestrationTasks();
      }
    });
  });

  if (el.startOrchestrationBtn) {
    el.startOrchestrationBtn.onclick = () => startOrchestration();
  }
  if (el.stopOrchestrationBtn) {
    el.stopOrchestrationBtn.onclick = () => stopOrchestration();
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
  if (el.refreshAuditLogBtn) {
    el.refreshAuditLogBtn.onclick = () => loadAuditLog();
  }
}

/** 初始化入口 */
export function init() {
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
  loadExecutionData().then(() => {
    loadOrchestrationConfig().then(() => {
      renderOrchestrationTasks();
    });
  });
  loadAnalysisData();
}

// 启动
init();
