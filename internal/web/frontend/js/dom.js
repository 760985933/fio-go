// 选择器缓存
export const el = {
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
  refreshScriptsBtn: document.getElementById("refreshScriptsBtn"),
  executionLog: document.getElementById("executionLog"),
  clearLogBtn: document.getElementById("clearLogBtn"),
  
  // 编排执行
  executeTasksSubtab: document.getElementById("execute-tasks-subtab"),
  executeOrchestrationSubtab: document.getElementById("execute-orchestration-subtab"),
  orchestrationInterval: document.getElementById("orchestrationInterval"),
  startOrchestrationBtn: document.getElementById("startOrchestrationBtn"),
  stopOrchestrationBtn: document.getElementById("stopOrchestrationBtn"),
  availableTasksList: document.getElementById("availableTasksList"),
  orchestrationList: document.getElementById("orchestrationList"),
  orchestrationLog: document.getElementById("orchestrationLog"),
  clearOrchestrationLogBtn: document.getElementById("clearOrchestrationLogBtn"),
  analysisTaskList: document.getElementById("analysisTaskList"),
  refreshAnalysisTasksBtn: document.getElementById("refreshAnalysisTasksBtn"),
  generateAnalysisBtn: document.getElementById("generateAnalysisBtn"),
  openAnalysisReportBtn: document.getElementById("openAnalysisReportBtn"),
  downloadAnalysisBtn: document.getElementById("downloadAnalysisBtn"),
  analysisReportFrame: document.getElementById("analysisReportFrame"),
  analysisTitle: document.getElementById("analysisTitle"),
  analysisStatusText: document.getElementById("analysisStatusText"),
  
  // Audit Log
  auditLogTableBody: document.getElementById("auditLogTableBody"),
  refreshAuditLogBtn: document.getElementById("refreshAuditLogBtn"),

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
  
  // Host Log Modal
  hostLogModal: document.getElementById("hostLogModal"),
  hostLogModalTitle: document.getElementById("hostLogModalTitle"),
  hostLogViewer: document.getElementById("hostLogViewer"),
  hostLogAutoRefresh: document.getElementById("hostLogAutoRefresh"),
  hostLogCloseBtn: document.getElementById("hostLogCloseBtn"),

  // Confirm Modal
  confirmModal: document.getElementById("confirmModal"),
  confirmModalTitle: document.getElementById("confirmModalTitle"),
  confirmModalBody: document.getElementById("confirmModalBody"),
  confirmModalOkBtn: document.getElementById("confirmModalOkBtn"),
  confirmModalCancelBtn: document.getElementById("confirmModalCancelBtn"),
};
