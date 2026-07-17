package app

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"fio-go/internal/executor"
	"fio-go/internal/parser"
	"fio-go/internal/report"
)

// App 主应用结构，其导出方法将暴露给前端
type App struct {
	ctx context.Context
}

// 新建 App 实例
func NewApp() *App {
	return &App{}
}

// Startup 在应用启动时调用
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
}

// ========== 脚本管理 ==========

// GetScripts 获取所有 .fio 脚本文件列表
func (a *App) GetScripts() ([]string, error) {
	scriptsDir := "scripts"
	if err := os.MkdirAll(scriptsDir, 0755); err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(scriptsDir)
	if err != nil {
		return nil, err
	}

	var scripts []string
	for _, f := range entries {
		if !f.IsDir() && strings.HasSuffix(f.Name(), ".fio") {
			scripts = append(scripts, f.Name())
		}
	}
	return scripts, nil
}

// GetScriptContent 获取指定脚本的内容
func (a *App) GetScriptContent(name string) (string, error) {
	data, err := os.ReadFile(filepath.Join("scripts", name))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// SaveScript 保存脚本文件
func (a *App) SaveScript(name, content string) error {
	if !strings.HasSuffix(name, ".fio") {
		name += ".fio"
	}
	if err := os.MkdirAll("scripts", 0755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join("scripts", name), []byte(content), 0644)
}

// DeleteScript 删除脚本文件
func (a *App) DeleteScript(name string) error {
	return os.Remove(filepath.Join("scripts", name))
}

// ========== 执行任务管理 ==========

type ExecutionTaskConfig struct {
	ID     string                `json:"id"`
	Name   string                `json:"name"`
	Script string                `json:"script"`
	Hosts  []executor.HostConfig `json:"hosts"`
}

type ExecutionTasksPayload struct {
	Tasks []ExecutionTaskConfig `json:"tasks"`
}

func executionTasksFile() string {
	return filepath.Join("scripts", "execution_tasks.json")
}

func defaultExecutionTask() ExecutionTaskConfig {
	return ExecutionTaskConfig{
		ID:     "default-task",
		Name:   "默认执行任务",
		Script: "",
		Hosts: []executor.HostConfig{
			{Host: "127.0.0.1", Port: 22, User: "root"},
		},
	}
}

var taskNameSanitizer = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

func sanitizeTaskID(taskID string) string {
	safe := taskNameSanitizer.ReplaceAllString(strings.TrimSpace(taskID), "-")
	safe = strings.Trim(safe, "-.")
	if safe == "" {
		return "default-task"
	}
	return safe
}

func normalizeHostConfig(host executor.HostConfig) executor.HostConfig {
	host.Host = strings.TrimSpace(host.Host)
	if host.Port <= 0 {
		host.Port = 22
	}
	if strings.TrimSpace(host.User) == "" {
		host.User = "root"
	}
	return host
}

func normalizeExecutionTask(task ExecutionTaskConfig, idx int) ExecutionTaskConfig {
	task.ID = strings.TrimSpace(task.ID)
	if task.ID == "" {
		task.ID = fmt.Sprintf("task-%d", idx+1)
	}
	task.Name = strings.TrimSpace(task.Name)
	if task.Name == "" {
		task.Name = fmt.Sprintf("执行任务 %d", idx+1)
	}

	filteredHosts := make([]executor.HostConfig, 0, len(task.Hosts))
	for _, host := range task.Hosts {
		normalized := normalizeHostConfig(host)
		if normalized.Host == "" {
			continue
		}
		filteredHosts = append(filteredHosts, normalized)
	}
	task.Hosts = filteredHosts
	return task
}

// GetExecutionTasks 获取所有执行任务
func (a *App) GetExecutionTasks() ([]ExecutionTaskConfig, error) {
	data, err := os.ReadFile(executionTasksFile())
	if err != nil {
		if os.IsNotExist(err) {
			return []ExecutionTaskConfig{defaultExecutionTask()}, nil
		}
		return nil, err
	}

	var payload ExecutionTasksPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, err
	}

	if len(payload.Tasks) == 0 {
		return []ExecutionTaskConfig{defaultExecutionTask()}, nil
	}

	tasks := make([]ExecutionTaskConfig, 0, len(payload.Tasks))
	for idx, task := range payload.Tasks {
		tasks = append(tasks, normalizeExecutionTask(task, idx))
	}
	return tasks, nil
}

// SaveExecutionTasks 保存执行任务配置
func (a *App) SaveExecutionTasks(tasks []ExecutionTaskConfig) error {
	if err := os.MkdirAll("scripts", 0755); err != nil {
		return err
	}

	normalizedTasks := make([]ExecutionTaskConfig, 0, len(tasks))
	for idx, task := range tasks {
		normalizedTasks = append(normalizedTasks, normalizeExecutionTask(task, idx))
	}

	data, err := json.MarshalIndent(ExecutionTasksPayload{Tasks: normalizedTasks}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(executionTasksFile(), data, 0600)
}

// ========== 执行操作 ==========

type CheckResult struct {
	Host     string `json:"host"`
	Running  bool   `json:"running"`
	Residual bool   `json:"residual"`
	Msg      string `json:"msg"`
}

type ActionResult struct {
	Host  string `json:"host"`
	Error string `json:"error,omitempty"`
	Msg   string `json:"msg"`
}

// CheckConnectivity 检查主机连通性
func (a *App) CheckConnectivity(host executor.HostConfig) (bool, string) {
	client, err := executor.NewSSHClient(host)
	if err != nil {
		return false, err.Error()
	}
	defer client.Close()

	_, err = client.RunCommand("true")
	if err != nil {
		return false, err.Error()
	}
	return true, "连接成功"
}

// PreDeployCheck 部署前检查
func (a *App) PreDeployCheck(taskID string, hosts []executor.HostConfig) ([]CheckResult, error) {
	statusResults := executor.CheckStatus(taskID, hosts)
	residualResults := executor.CheckResidualData(taskID, hosts)

	var checkResults []CheckResult
	for i, host := range hosts {
		hostStr := fmt.Sprintf("%s@%s:%d", host.User, host.Host, host.Port)
		running := false
		msg := ""
		if i < len(statusResults) {
			msg = statusResults[i].Msg
			if strings.Contains(msg, "Running") {
				running = true
			}
		}
		residual := false
		if i < len(residualResults) && residualResults[i].Msg == "Exists" {
			residual = true
		}
		checkResults = append(checkResults, CheckResult{
			Host:     hostStr,
			Running:  running,
			Residual: residual,
			Msg:      msg,
		})
	}
	return checkResults, nil
}

// Deploy 部署并运行 FIO
func (a *App) Deploy(taskID, scriptName string, hosts []executor.HostConfig) ([]ActionResult, error) {
	content, err := os.ReadFile(filepath.Join("scripts", scriptName))
	if err != nil {
		return nil, fmt.Errorf("读取脚本失败: %v", err)
	}

	results := executor.DeployAndRun(taskID, hosts, scriptName, content)
	return toActionResults(results), nil
}

// CheckStatus 检查 FIO 运行状态
func (a *App) CheckStatus(taskID string, hosts []executor.HostConfig) ([]ActionResult, error) {
	results := executor.CheckStatus(taskID, hosts)
	return toActionResults(results), nil
}

// KillAll 停止所有 FIO 进程
func (a *App) KillAll(taskID string, hosts []executor.HostConfig) ([]ActionResult, error) {
	results := executor.KillAll(taskID, hosts)
	return toActionResults(results), nil
}

// PullData 拉取远程数据
func (a *App) PullData(taskID string, hosts []executor.HostConfig) ([]ActionResult, error) {
	rawDir := filepath.Join("data", "tasks", sanitizeTaskID(taskID), "raw")
	os.MkdirAll(rawDir, 0755)

	results := executor.PullData(taskID, hosts, rawDir)
	return toActionResults(results), nil
}

// CleanLocal 清理本地数据
func (a *App) CleanLocal(taskID string) error {
	baseDir := filepath.Join("data", "tasks", sanitizeTaskID(taskID))
	reportDir := filepath.Join("output", "tasks", sanitizeTaskID(taskID))

	os.RemoveAll(baseDir)
	os.RemoveAll(reportDir)
	os.MkdirAll(baseDir, 0755)
	return nil
}

// CleanRemote 清理远程数据
func (a *App) CleanRemote(taskID string, hosts []executor.HostConfig) ([]ActionResult, error) {
	results := executor.CleanRemote(taskID, hosts)
	return toActionResults(results), nil
}

func toActionResults(results []executor.ExecutionResult) []ActionResult {
	actionResults := make([]ActionResult, 0, len(results))
	for _, r := range results {
		ar := ActionResult{Host: r.Host, Msg: r.Msg}
		if r.Error != nil {
			ar.Error = r.Error.Error()
		}
		actionResults = append(actionResults, ar)
	}
	return actionResults
}

// ========== 分析报告 ==========

type AnalysisSummary struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Script        string `json:"script"`
	HasData       bool   `json:"hasData"`
	HasReport     bool   `json:"hasReport"`
	LogAvailable  bool   `json:"logAvailable"`
	DataDir       string `json:"dataDir"`
	ReportDir     string `json:"reportDir"`
	ReportHTMLURL string `json:"reportHtmlUrl"`
	DownloadURL   string `json:"downloadUrl"`
}

func taskRawDataDir(taskID string) string {
	return filepath.Join("data", "tasks", sanitizeTaskID(taskID), "raw")
}

func taskReportDir(taskID string) string {
	return filepath.Join("output", "tasks", sanitizeTaskID(taskID))
}

func taskReportHTMLPath(taskID string) string {
	return filepath.Join(taskReportDir(taskID), "fio_report.html")
}

func taskReportExcelPath(taskID string) string {
	return filepath.Join(taskReportDir(taskID), "fio_summary.xlsx")
}

func dirHasFiles(dir string) bool {
	found := false
	filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() {
			return nil
		}
		found = true
		return filepath.SkipDir
	})
	return found
}

// GetAnalysisTasks 获取分析任务列表
func (a *App) GetAnalysisTasks() ([]AnalysisSummary, error) {
	tasks, err := a.GetExecutionTasks()
	if err != nil {
		return nil, err
	}

	summaries := make([]AnalysisSummary, 0, len(tasks))
	for idx, task := range tasks {
		task = normalizeExecutionTask(task, idx)
		summary := AnalysisSummary{
			ID:            task.ID,
			Name:          task.Name,
			Script:        task.Script,
			HasData:       dirHasFiles(taskRawDataDir(task.ID)),
			HasReport:     false,
			LogAvailable:  false,
			DataDir:       taskRawDataDir(task.ID),
			ReportDir:     taskReportDir(task.ID),
			ReportHTMLURL: taskReportHTMLPath(task.ID),
			DownloadURL:   taskReportDir(task.ID),
		}
		if _, err := os.Stat(filepath.Join(taskReportDir(task.ID), "execution.log")); err == nil {
			summary.LogAvailable = true
		}
		if _, err := os.Stat(taskReportHTMLPath(task.ID)); err == nil {
			summary.HasReport = true
		}
		summaries = append(summaries, summary)
	}
	return summaries, nil
}

// GenerateReport 生成分析报告
func (a *App) GenerateReport(taskID string) (string, error) {
	dataDir := taskRawDataDir(taskID)
	if !dirHasFiles(dataDir) {
		return "", fmt.Errorf("任务 %q 没有已拉取的数据", taskID)
	}

	reportDir := taskReportDir(taskID)
	if err := os.MkdirAll(reportDir, 0755); err != nil {
		return "", err
	}

	analysisResult, err := parser.AnalyzeJSONFiles(dataDir)
	if err != nil {
		return "", err
	}

	groupedRows, err := report.GenerateExcel(analysisResult, taskReportExcelPath(taskID))
	if err != nil {
		return "", err
	}

	chartGroups := parser.BuildChartGroups(dataDir)
	err = report.GenerateHTML(chartGroups, analysisResult.SystemTexts, groupedRows, taskReportHTMLPath(taskID))
	if err != nil {
		return "", err
	}

	return taskReportDir(taskID), nil
}

// GetReportHTML 获取报告 HTML 内容
func (a *App) GetReportHTML(taskID string) (string, error) {
	data, err := os.ReadFile(taskReportHTMLPath(taskID))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// ========== 编排 ==========

type OrchestrationConfig struct {
	Sequence []string `json:"sequence"`
	Interval int      `json:"interval"`
}

func orchestrationConfigFile() string {
	return filepath.Join("scripts", "orchestration_config.json")
}

// GetOrchestrationConfig 获取编排配置
func (a *App) GetOrchestrationConfig() (OrchestrationConfig, error) {
	data, err := os.ReadFile(orchestrationConfigFile())
	if err != nil {
		if os.IsNotExist(err) {
			return OrchestrationConfig{Sequence: []string{}, Interval: 30}, nil
		}
		return OrchestrationConfig{}, err
	}
	var config OrchestrationConfig
	err = json.Unmarshal(data, &config)
	return config, err
}

// SaveOrchestrationConfig 保存编排配置
func (a *App) SaveOrchestrationConfig(config OrchestrationConfig) error {
	if err := os.MkdirAll("scripts", 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(orchestrationConfigFile(), data, 0644)
}

// ========== 审计日志 ==========

type AuditEntry struct {
	Action    string `json:"action"`
	Details   string `json:"details"`
	Timestamp string `json:"timestamp"`
}

func auditLogFile() string {
	return filepath.Join("data", "audit.log")
}

// GetAuditLog 获取审计日志
func (a *App) GetAuditLog() ([]AuditEntry, error) {
	data, err := os.ReadFile(auditLogFile())
	if err != nil {
		if os.IsNotExist(err) {
			return []AuditEntry{}, nil
		}
		return nil, err
	}

	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	var entries []AuditEntry
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var entry AuditEntry
		if err := json.Unmarshal([]byte(line), &entry); err == nil {
			entries = append(entries, entry)
		}
	}
	return entries, nil
}

// AddAuditLog 添加审计日志条目
func (a *App) AddAuditLog(action, details string) error {
	if err := os.MkdirAll("data", 0755); err != nil {
		return err
	}

	entry := AuditEntry{
		Action:    action,
		Details:   details,
		Timestamp: time.Now().Format(time.RFC3339),
	}

	data, err := json.Marshal(entry)
	if err != nil {
		return err
	}

	f, err := os.OpenFile(auditLogFile(), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = f.Write(append(data, '\n'))
	return err
}

// ========== 执行日志 ==========

func taskExecutionLogPath(taskID string) string {
	return filepath.Join("data", "tasks", sanitizeTaskID(taskID), "execution.log")
}

// GetExecutionLog 获取任务执行日志
func (a *App) GetExecutionLog(taskID string) (string, error) {
	data, err := os.ReadFile(taskExecutionLogPath(taskID))
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	return string(data), nil
}

// GetHostLog 获取远程主机日志
func (a *App) GetHostLog(taskID, hostStr string) (string, error) {
	tasks, err := a.GetExecutionTasks()
	if err != nil {
		return "", err
	}

	safeTaskID := sanitizeTaskID(taskID)
	for _, task := range tasks {
		if sanitizeTaskID(task.ID) != safeTaskID {
			continue
		}
		for _, h := range task.Hosts {
			hStr := fmt.Sprintf("%s@%s:%d", h.User, h.Host, h.Port)
			if hStr != hostStr {
				continue
			}
			client, err := executor.NewSSHClient(h)
			if err != nil {
				return "", fmt.Errorf("连接失败: %v", err)
			}
			defer client.Close()

			_, _, logsDir, _ := executor.BuildTaskPaths(taskID)
			logFile := filepath.Join(logsDir, "fio_stdout.log")
			cmd := fmt.Sprintf("tail -n 20 %s 2>/dev/null || echo '暂无日志'", logFile)
			out, _ := client.RunCommand(cmd)
			return strings.TrimSpace(out), nil
		}
	}
	return "", fmt.Errorf("未找到主机 %s", hostStr)
}
