import { el } from './dom.js';
import { analysisState } from './state.js';

export function renderAnalysisTasks() {
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

export function updateAnalysisPreview() {
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
