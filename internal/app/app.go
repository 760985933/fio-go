package app

import (
	"archive/zip"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"fio-go/internal/executor"
	"fio-go/internal/models"
	"fio-go/internal/parser"
	"fio-go/internal/report"
)

// App 主应用结构，其导出方法将暴露给前端
type App struct {
	ctx context.Context
	db  *sql.DB
}

// 新建 App 实例
func NewApp() *App {
	return &App{}
}

// Startup 在应用启动时调用
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
	db, err := openDB()
	if err != nil {
		return
	}
	if err := initDB(db); err != nil {
		db.Close()
		return
	}
	a.db = db
}

// Shutdown 在应用关闭时调用
func (a *App) Shutdown(ctx context.Context) {
	if a.db != nil {
		a.db.Close()
	}
}

// ========== 脚本管理 ==========

// sanitizeScriptName 清洗脚本名，防止路径遍历攻击
func sanitizeScriptName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("脚本名称不能为空")
	}
	// 禁止包含 .. 或 . 的任何路径段
	for _, part := range strings.Split(name, string(os.PathSeparator)) {
		if part == ".." || part == "." {
			return "", fmt.Errorf("非法的脚本名称: %s", name)
		}
	}
	// 再检查正斜杠和反斜杠
	if strings.Contains(name, "/") || strings.Contains(name, "\\") {
		return "", fmt.Errorf("非法的脚本名称: %s", name)
	}
	return name, nil
}

// GetScripts 获取所有配置模型名称（从数据库）
func (a *App) GetScripts() ([]string, error) {
	if a.db == nil {
		return nil, fmt.Errorf("数据库未初始化")
	}
	return dbGetAllScriptNames(a.db)
}

// GetScriptContent 获取指定脚本的内容
func (a *App) GetScriptContent(name string) (string, error) {
	safeName, err := sanitizeScriptName(name)
	if err != nil {
		return "", err
	}
	if !strings.HasSuffix(safeName, ".fio") {
		safeName += ".fio"
	}
	data, err := os.ReadFile(filepath.Join("scripts", safeName))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// SaveScript 保存脚本文件
func (a *App) SaveScript(name, content string) error {
	safeName, err := sanitizeScriptName(name)
	if err != nil {
		return err
	}
	if !strings.HasSuffix(safeName, ".fio") {
		safeName += ".fio"
	}
	if err := os.MkdirAll("scripts", 0755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join("scripts", safeName), []byte(content), 0644)
}

// DeleteScript 删除脚本文件
func (a *App) DeleteScript(name string) error {
	safeName, err := sanitizeScriptName(name)
	if err != nil {
		return err
	}
	if !strings.HasSuffix(safeName, ".fio") {
		safeName += ".fio"
	}
	return os.Remove(filepath.Join("scripts", safeName))
}

// SaveScriptConfig 保存脚本的结构化配置到 SQLite
func (a *App) SaveScriptConfig(scriptName, configJSON string) error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	return dbSaveScriptConfig(a.db, scriptName, configJSON)
}

// GetScriptConfig 从 SQLite 获取脚本的结构化配置
func (a *App) GetScriptConfig(scriptName string) (string, error) {
	if a.db == nil {
		return "", fmt.Errorf("数据库未初始化")
	}
	return dbGetScriptConfig(a.db, scriptName)
}

// DeleteScriptConfig 删除脚本的结构化配置
func (a *App) DeleteScriptConfig(scriptName string) error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	return dbDeleteScriptConfig(a.db, scriptName)
}

// ========== FIO 配置类型 ==========

type FioJob struct {
	Bs           int    `json:"bs"`
	Rw           string `json:"rw"`
	Rwmixread    int    `json:"rwmixread"`
	Iodepth      int    `json:"iodepth"`
	Numjobs      int    `json:"numjobs"`
	Direct       bool   `json:"direct"`
	Thread       bool   `json:"thread"`
	Fsync        int    `json:"fsync"`
	IodepthBatch int    `json:"iodepth_batch"`
	RateIops     int    `json:"rate_iops"`
}

type FioLogging struct {
	Enabled       bool `json:"enabled"`
	LogAvgMsec    int  `json:"log_avg_msec"`
	WriteBwLog    bool `json:"write_bw_log"`
	WriteLatLog   bool `json:"write_lat_log"`
	WriteIopsLog  bool `json:"write_iops_log"`
}

type FioConfig struct {
	Global struct {
		Filename  string `json:"filename"`
		Runtime   int    `json:"runtime"`
		RampTime  int    `json:"ramp_time"`
		Ioengine  string `json:"ioengine"`
		Size      string `json:"size"`
		Directory string `json:"directory"`
	} `json:"global"`
	Logging *FioLogging `json:"logging"`
	Jobs    []FioJob    `json:"jobs"`
}

func buildJobName(idx int, job FioJob) string {
	return fmt.Sprintf("sec%d_%dk_%s_iodepth%d", idx, job.Bs, job.Rw, job.Iodepth)
}

func generateFioText(cfg *FioConfig) string {
	var lines []string

	lines = append(lines, "[global]")
	lines = append(lines, fmt.Sprintf("filename=%s", cfg.Global.Filename))
	lines = append(lines, fmt.Sprintf("runtime=%d", cfg.Global.Runtime))
	lines = append(lines, fmt.Sprintf("ramp_time=%d", cfg.Global.RampTime))
	lines = append(lines, fmt.Sprintf("ioengine=%s", cfg.Global.Ioengine))
	if cfg.Global.Size != "" {
		lines = append(lines, fmt.Sprintf("size=%s", cfg.Global.Size))
	}
	if cfg.Global.Directory != "" {
		lines = append(lines, fmt.Sprintf("directory=%s", cfg.Global.Directory))
	}
	lines = append(lines, "time_based=1")
	lines = append(lines, "")

	for idx, job := range cfg.Jobs {
		jobName := buildJobName(idx, job)
		lines = append(lines, fmt.Sprintf("[%s]", jobName))
		lines = append(lines, fmt.Sprintf("bs=%dk", job.Bs))
		lines = append(lines, fmt.Sprintf("rw=%s", job.Rw))
		if (job.Rw == "readwrite" || job.Rw == "randrw") && job.Rwmixread > 0 {
			lines = append(lines, fmt.Sprintf("rwmixread=%d", job.Rwmixread))
		}
		lines = append(lines, fmt.Sprintf("iodepth=%d", job.Iodepth))
		lines = append(lines, fmt.Sprintf("numjobs=%d", job.Numjobs))
		if job.Direct {
			lines = append(lines, "direct=1")
		}
		if job.Thread {
			lines = append(lines, "thread=1")
		}
		if job.Fsync > 0 {
			lines = append(lines, fmt.Sprintf("fsync=%d", job.Fsync))
		}
		if job.IodepthBatch > 0 {
			lines = append(lines, fmt.Sprintf("iodepth_batch=%d", job.IodepthBatch))
		}
		if job.RateIops > 0 {
			lines = append(lines, fmt.Sprintf("rate_iops=%d", job.RateIops))
		}
		lines = append(lines, "overwrite=1")
		lines = append(lines, "norandommap=1")
		lines = append(lines, "randrepeat=0")
		if cfg.Logging != nil && cfg.Logging.Enabled {
			lines = append(lines, fmt.Sprintf("log_avg_msec=%d", cfg.Logging.LogAvgMsec))
			if cfg.Logging.WriteBwLog {
				lines = append(lines, fmt.Sprintf("write_bw_log=%s", jobName))
			}
			if cfg.Logging.WriteLatLog {
				lines = append(lines, fmt.Sprintf("write_lat_log=%s", jobName))
			}
			if cfg.Logging.WriteIopsLog {
				lines = append(lines, fmt.Sprintf("write_iops_log=%s", jobName))
			}
		}
		lines = append(lines, "")
	}

	return strings.Join(lines, "\n")
}

// ========== 执行任务管理 ==========

type ExecutionTaskConfig struct {
	ID         string                `json:"id"`
	Name       string                `json:"name"`
	Scripts    []string              `json:"scripts"`
	Hosts      []executor.HostConfig `json:"hosts"`
	StartedAt  string                `json:"startedAt,omitempty"`
	FinishedAt string                `json:"finishedAt,omitempty"`
}

type ExecutionTasksPayload struct {
	Tasks []ExecutionTaskConfig `json:"tasks"`
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
	if task.Scripts == nil {
		task.Scripts = []string{}
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
	tasks, err := dbGetExecutionTasks(a.db)
	if err != nil {
		return nil, err
	}
	for idx := range tasks {
		tasks[idx] = normalizeExecutionTask(tasks[idx], idx)
	}
	return tasks, nil
}

// SaveExecutionTasks 保存执行任务配置
func (a *App) SaveExecutionTasks(tasks []ExecutionTaskConfig) error {
	normalizedTasks := make([]ExecutionTaskConfig, 0, len(tasks))
	for idx, task := range tasks {
		normalizedTasks = append(normalizedTasks, normalizeExecutionTask(task, idx))
	}
	return dbSaveExecutionTasks(a.db, normalizedTasks)
}

// SetTaskStarted 记录任务开始时间
func (a *App) SetTaskStarted(taskID string) error {
	return dbUpdateTaskTimestamp(a.db, taskID, "startedAt", time.Now().Format(time.RFC3339))
}

// SetTaskFinished 记录任务完成时间
func (a *App) SetTaskFinished(taskID string) error {
	return dbUpdateTaskTimestamp(a.db, taskID, "finishedAt", time.Now().Format(time.RFC3339))
}

// ========== 执行操作 ==========

type CheckResult struct {
	Host     string `json:"host"`
	Running  bool   `json:"running"`
	Residual bool   `json:"residual"`
	Msg      string `json:"msg"`
}

type ActionResult struct {
	Host    string `json:"host"`
	Error   string `json:"error,omitempty"`
	Msg     string `json:"msg"`
	Running bool   `json:"running"`
}

// ConnectivityResult 连通性测试结果
type ConnectivityResult struct {
	OK  bool   `json:"ok"`
	Msg string `json:"msg"`
}

// CheckConnectivity 检查主机连通性
func (a *App) CheckConnectivity(host executor.HostConfig) ConnectivityResult {
	client, err := executor.NewSSHClient(host)
	if err != nil {
		return ConnectivityResult{OK: false, Msg: err.Error()}
	}
	defer client.Close()

	_, err = client.RunCommand("true")
	if err != nil {
		return ConnectivityResult{OK: false, Msg: err.Error()}
	}
	return ConnectivityResult{OK: true, Msg: "连接成功"}
}

// ========== 主机管理 (SQLite 持久化) ==========

// AddHost 添加主机到数据库
func (a *App) AddHost(host executor.HostConfig) (int64, error) {
	if a.db == nil {
		return 0, fmt.Errorf("数据库未初始化")
	}
	host.Port = normalizedPort(host.Port)
	return dbAddHost(a.db, host)
}

// GetHosts 获取所有持久化主机
func (a *App) GetHosts() ([]HostRecord, error) {
	if a.db == nil {
		return nil, fmt.Errorf("数据库未初始化")
	}
	return dbGetHosts(a.db)
}

// DeleteHost 删除指定主机
func (a *App) DeleteHost(id int) error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	return dbDeleteHost(a.db, id)
}

// UpdateHost 更新主机信息
func (a *App) UpdateHost(id int, host executor.HostConfig) error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	host.Port = normalizedPort(host.Port)
	return dbUpdateHost(a.db, id, host)
}

func normalizedPort(port int) int {
	if port <= 0 {
		return 22
	}
	return port
}

// PreDeployCheck 部署前检查
func (a *App) PreDeployCheck(taskID string, hosts []executor.HostConfig) ([]CheckResult, error) {
	statusResults := executor.CheckStatus(taskID, hosts)
	residualResults := executor.CheckResidualData(taskID, hosts)
	fioResults := executor.CheckFioInstalled(hosts)

	var checkResults []CheckResult
	for i, host := range hosts {
		hostStr := fmt.Sprintf("%s@%s:%d", host.User, host.Host, host.Port)
		running := false
		msg := ""
		if i < len(statusResults) {
		if statusResults[i].Error != "" {
			msg = "连接失败: " + statusResults[i].Error
			} else {
				msg = statusResults[i].Msg
				running = statusResults[i].Running
			}
		}
		residual := false
		if i < len(residualResults) {
		if residualResults[i].Error != "" {
			if msg == "" {
				msg = "连接失败: " + residualResults[i].Error
				}
			} else if strings.Contains(residualResults[i].Msg, "Exists") {
				residual = true
			}
		}
		// fio installed check
		if i < len(fioResults) {
		if fioResults[i].Error != "" {
			if msg == "" || strings.HasPrefix(msg, "空闲") {
				msg = "FIO检查失败: " + fioResults[i].Error
			} else {
				msg += " | FIO检查失败: " + fioResults[i].Error
			}
			} else if fioResults[i].Msg == "MISSING" {
				if msg == "" || strings.HasPrefix(msg, "空闲") {
					msg = "未安装FIO"
				} else {
					msg += " | 未安装FIO"
				}
			} else {
				if msg == "" || msg == "空闲" {
					msg = fioResults[i].Msg
				} else {
					msg += " | " + fioResults[i].Msg
				}
			}
		}
		if msg == "" {
			msg = "空闲"
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

// Deploy 部署并运行 FIO（单脚本版本，从DB读取配置）
func (a *App) Deploy(taskID, scriptName string, hosts []executor.HostConfig) ([]ActionResult, error) {
	configJSON, err := dbGetScriptConfig(a.db, scriptName)
	if err != nil {
		return nil, fmt.Errorf("获取配置 %s 失败: %v", scriptName, err)
	}
	if configJSON == "" {
		return nil, fmt.Errorf("配置 %s 内容为空", scriptName)
	}
	var cfg FioConfig
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return nil, fmt.Errorf("解析配置 %s 失败: %v", scriptName, err)
	}
	fioText := generateFioText(&cfg)
	results := executor.DeployAndRun(taskID, hosts, scriptName+".fio", []byte(fioText))
	return toActionResults(results), nil
}

// DeployMulti 部署多个脚本到所有主机
func (a *App) DeployMulti(taskID string, scripts []string, hosts []executor.HostConfig) ([]ActionResult, error) {
	var allResults []ActionResult
	for _, scriptName := range scripts {
		configJSON, err := dbGetScriptConfig(a.db, scriptName)
		if err != nil {
			allResults = append(allResults, ActionResult{Host: "all", Error: fmt.Sprintf("获取配置 %s 失败: %v", scriptName, err)})
			continue
		}
		if configJSON == "" {
			allResults = append(allResults, ActionResult{Host: "all", Error: fmt.Sprintf("配置 %s 内容为空", scriptName)})
			continue
		}
		var cfg FioConfig
		if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
			allResults = append(allResults, ActionResult{Host: "all", Error: fmt.Sprintf("解析配置 %s 失败: %v", scriptName, err)})
			continue
		}
		fioText := generateFioText(&cfg)
		results := executor.DeployAndRun(taskID, hosts, scriptName+".fio", []byte(fioText))
		allResults = append(allResults, toActionResults(results)...)
	}
	return allResults, nil
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
	rawDir := taskRawDataDir(taskID)
	if err := os.MkdirAll(rawDir, 0755); err != nil {
		return nil, fmt.Errorf("创建数据目录失败: %v", err)
	}

	results := executor.PullData(taskID, hosts, rawDir)
	return toActionResults(results), nil
}

// PullTaskData 根据任务ID自动查找主机并拉取数据
func (a *App) PullTaskData(taskID string) ([]ActionResult, error) {
	tasks, err := a.GetExecutionTasks()
	if err != nil {
		return nil, err
	}
	for _, t := range tasks {
		if t.ID == taskID {
			return a.PullData(taskID, t.Hosts)
		}
	}
	return nil, fmt.Errorf("任务不存在: %s", taskID)
}

// CleanLocal 清理本地数据
func (a *App) CleanLocal(taskID string) error {
	baseDir := filepath.Join(dataBaseDir(), "data", "tasks", sanitizeTaskID(taskID))
	reportDir := filepath.Join(dataBaseDir(), "output", "tasks", sanitizeTaskID(taskID))

	var errs []string
	if err := os.RemoveAll(baseDir); err != nil {
		errs = append(errs, fmt.Sprintf("清理数据目录失败: %v", err))
	}
	if err := os.RemoveAll(reportDir); err != nil {
		errs = append(errs, fmt.Sprintf("清理报告目录失败: %v", err))
	}
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		errs = append(errs, fmt.Sprintf("重建数据目录失败: %v", err))
	}
	if len(errs) > 0 {
		return fmt.Errorf("%s", strings.Join(errs, "; "))
	}
	return nil
}

// DeleteExecutionTask 删除执行任务（从DB移除任务配置、清理本地文件、清理时间戳）
func (a *App) DeleteExecutionTask(taskID string) error {
	tasks, err := a.GetExecutionTasks()
	if err != nil {
		return err
	}
	newTasks := make([]ExecutionTaskConfig, 0, len(tasks))
	for _, t := range tasks {
		if t.ID != taskID {
			newTasks = append(newTasks, t)
		}
	}
	if err := dbSaveExecutionTasks(a.db, newTasks); err != nil {
		return err
	}
	if err := dbDeleteTaskTimestamp(a.db, taskID); err != nil {
		return fmt.Errorf("删除任务时间戳失败: %v", err)
	}
	if err := a.CleanLocal(taskID); err != nil {
		return fmt.Errorf("清理本地数据失败: %v", err)
	}
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
		ar := ActionResult{Host: r.Host, Msg: r.Msg, Running: r.Running}
	if r.Error != "" {
		ar.Error = r.Error
		}
		actionResults = append(actionResults, ar)
	}
	return actionResults
}

func hasAnyError(results []ActionResult) bool {
	for _, r := range results {
		if r.Error != "" {
			return true
		}
	}
	return false
}

func resultsErrorSummary(results []ActionResult) string {
	var errs []string
	for _, r := range results {
		if r.Error != "" {
			errs = append(errs, fmt.Sprintf("%s: %s", r.Host, r.Error))
		}
	}
	return strings.Join(errs, "; ")
}

// ========== 分析报告 ==========

type AnalysisSummary struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Scripts       []string `json:"scripts"`
	HasData       bool     `json:"hasData"`
	HasReport     bool     `json:"hasReport"`
	LogAvailable  bool     `json:"logAvailable"`
	DataDir       string   `json:"dataDir"`
	ReportDir     string   `json:"reportDir"`
	ReportHTMLURL string   `json:"reportHtmlUrl"`
	DownloadURL   string   `json:"downloadUrl"`
	StartedAt     string   `json:"startedAt,omitempty"`
	FinishedAt    string   `json:"finishedAt,omitempty"`
}

func dataBaseDir() string {
	return models.DataBaseDir()
}

func openFolder(path string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", path).Start()
	case "windows":
		return exec.Command("explorer", path).Start()
	default:
		return exec.Command("xdg-open", path).Start()
	}
}

func taskRawDataDir(taskID string) string {
	return filepath.Join(dataBaseDir(), "data", "tasks", sanitizeTaskID(taskID), "raw")
}

func taskReportDir(taskID string) string {
	return filepath.Join(dataBaseDir(), "output", "tasks", sanitizeTaskID(taskID))
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
			Scripts:       task.Scripts,
			HasData:       dirHasFiles(taskRawDataDir(task.ID)),
			HasReport:     false,
			LogAvailable:  false,
			DataDir:       taskRawDataDir(task.ID),
			ReportDir:     taskReportDir(task.ID),
			ReportHTMLURL: taskReportHTMLPath(task.ID),
			DownloadURL:   taskReportDir(task.ID),
			StartedAt:     task.StartedAt,
			FinishedAt:    task.FinishedAt,
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

	// Look up task timestamps
	var startedAt, finishedAt string
	if tasks, err := a.GetExecutionTasks(); err == nil {
		for _, t := range tasks {
			if t.ID == taskID {
				startedAt = t.StartedAt
				finishedAt = t.FinishedAt
				break
			}
		}
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
	err = report.GenerateHTML(chartGroups, analysisResult.SystemTexts, groupedRows, taskReportHTMLPath(taskID), startedAt, finishedAt)
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

// GetOrchestrationConfig 获取编排配置
func (a *App) GetOrchestrationConfig() (OrchestrationConfig, error) {
	data, err := dbGetKV(a.db, "orchestration_config")
	if err != nil {
		return OrchestrationConfig{}, err
	}
	if data == "" {
		return OrchestrationConfig{Sequence: []string{}, Interval: 30}, nil
	}
	var config OrchestrationConfig
	err = json.Unmarshal([]byte(data), &config)
	return config, err
}

// SaveOrchestrationConfig 保存编排配置
func (a *App) SaveOrchestrationConfig(config OrchestrationConfig) error {
	data, err := json.Marshal(config)
	if err != nil {
		return err
	}
	return dbSetKV(a.db, "orchestration_config", string(data))
}

// ========== 审计日志 ==========

type AuditEntry struct {
	Action    string `json:"action"`
	Details   string `json:"details"`
	Timestamp string `json:"timestamp"`
}

// GetAuditLog 获取审计日志
func (a *App) GetAuditLog() ([]AuditEntry, error) {
	return dbGetAuditLogs(a.db)
}

// AddAuditLog 添加审计日志条目
func (a *App) AddAuditLog(action, details string) error {
	return dbAddAuditLog(a.db, action, details, time.Now().Format(time.RFC3339))
}

// GetDataDir 返回应用数据存储目录
func (a *App) GetDataDir() string {
	return dataBaseDir()
}

// OpenDataDir 在文件管理器中打开数据目录
func (a *App) OpenDataDir() error {
	dir := dataBaseDir()
	os.MkdirAll(dir, 0755)
	return openFolder(dir)
}

// OpenFile 用系统默认方式打开文件
func (a *App) OpenFile(path string) error {
	return openFile(path)
}

// RevealFile 在文件管理器中选中文件
func (a *App) RevealFile(path string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", "-R", path).Start()
	case "windows":
		return exec.Command("explorer", "/select,"+path).Start()
	default:
		return exec.Command("xdg-open", filepath.Dir(path)).Start()
	}
}

func openFile(path string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", path).Start()
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", path).Start()
	default:
		return exec.Command("xdg-open", path).Start()
	}
}

// ========== 执行日志 ==========

func taskExecutionLogPath(taskID string) string {
	return filepath.Join(dataBaseDir(), "data", "tasks", sanitizeTaskID(taskID), "execution.log")
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

// AppendExecutionLog 追加执行日志
func (a *App) AppendExecutionLog(taskID, message string) error {
	logPath := taskExecutionLogPath(taskID)
	os.MkdirAll(filepath.Dir(logPath), 0755)
	line := fmt.Sprintf("[%s] %s\n", time.Now().Format("2006-01-02 15:04:05"), message)
	f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.WriteString(line)
	return err
}

// ClearExecutionLog 清空执行日志
func (a *App) ClearExecutionLog(taskID string) error {
	return os.Remove(taskExecutionLogPath(taskID))
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

// ========== 编排执行 ==========

// OrchestrationProgress 编排执行进度
type OrchestrationProgress struct {
	TaskID    string        `json:"taskId"`
	TaskName  string        `json:"taskName"`
	Step      string        `json:"step"`
	Status    string        `json:"status"`
	Error     string        `json:"error,omitempty"`
	Results   []ActionResult `json:"results,omitempty"`
	Current   int           `json:"current"`
	Total     int           `json:"total"`
}

// ExecuteOrchestration 按顺序执行编排任务
func (a *App) ExecuteOrchestration(taskIDs []string, interval int) ([]OrchestrationProgress, error) {
	if len(taskIDs) == 0 {
		return nil, fmt.Errorf("编排序列为空")
	}

	allTasks, err := a.GetExecutionTasks()
	if err != nil {
		return nil, err
	}

	taskMap := make(map[string]ExecutionTaskConfig)
	for _, t := range allTasks {
		taskMap[t.ID] = t
	}

	var progress []OrchestrationProgress
	total := len(taskIDs)

	for i, taskID := range taskIDs {
		task, ok := taskMap[taskID]
		if !ok {
			progress = append(progress, OrchestrationProgress{
				TaskID:  taskID,
				Status:  "error",
				Error:   fmt.Sprintf("未找到任务 %s", taskID),
				Current: i + 1,
				Total:   total,
			})
			continue
		}

		safeID := sanitizeTaskID(taskID)

		// Step 0: Pre-check
		progress = append(progress, OrchestrationProgress{
			TaskID:   safeID,
			TaskName: task.Name,
			Step:     "precheck",
			Status:   "running",
			Current:  i + 1,
			Total:    total,
		})

		checkResults, checkErr := a.PreDeployCheck(taskID, task.Hosts)
		if checkErr != nil {
			progress = append(progress, OrchestrationProgress{
				TaskID:   safeID,
				TaskName: task.Name,
				Step:     "precheck",
				Status:   "error",
				Error:    checkErr.Error(),
				Current:  i + 1,
				Total:    total,
			})
			continue
		}
		hasRunning := false
		var checkErrHosts []string
		for _, cr := range checkResults {
			if cr.Running {
				hasRunning = true
				checkErrHosts = append(checkErrHosts, fmt.Sprintf("%s: %s", cr.Host, cr.Msg))
			}
		}
		if hasRunning {
			progress = append(progress, OrchestrationProgress{
				TaskID:   safeID,
				TaskName: task.Name,
				Step:     "precheck",
				Status:   "error",
				Error:    fmt.Sprintf("主机有FIO运行中: %s", strings.Join(checkErrHosts, "; ")),
				Current:  i + 1,
				Total:    total,
			})
			continue
		}
		progress = append(progress, OrchestrationProgress{
			TaskID:   safeID,
			TaskName: task.Name,
			Step:     "precheck",
			Status:   "completed",
			Current:  i + 1,
			Total:    total,
		})

		// Step 1: Deploy
		progress = append(progress, OrchestrationProgress{
			TaskID:   safeID,
			TaskName: task.Name,
			Step:     "deploy",
			Status:   "running",
			Current:  i + 1,
			Total:    total,
		})

		deployResults, err := a.DeployMulti(taskID, task.Scripts, task.Hosts)
		if err != nil {
			progress = append(progress, OrchestrationProgress{
				TaskID:   safeID,
				TaskName: task.Name,
				Step:     "deploy",
				Status:   "error",
				Error:    err.Error(),
				Current:  i + 1,
				Total:    total,
			})
			continue
		}
		deployStatus := "completed"
		deployErr := ""
		if hasAnyError(deployResults) {
			deployStatus = "error"
			deployErr = resultsErrorSummary(deployResults)
		}
		progress = append(progress, OrchestrationProgress{
			TaskID:   safeID,
			TaskName: task.Name,
			Step:     "deploy",
			Status:   deployStatus,
			Error:    deployErr,
			Results:  deployResults,
			Current:  i + 1,
			Total:    total,
		})
		if deployStatus == "error" {
			continue
		}

		// Step 2: Poll until all hosts finish
		progress = append(progress, OrchestrationProgress{
			TaskID:   safeID,
			TaskName: task.Name,
			Step:     "running",
			Status:   "running",
			Current:  i + 1,
			Total:    total,
		})

		finished := false
		statusErr := false
		for !finished {
			time.Sleep(10 * time.Second)
			statusResults, err := a.CheckStatus(taskID, task.Hosts)
			if err != nil {
				progress = append(progress, OrchestrationProgress{
					TaskID:   safeID,
					TaskName: task.Name,
					Step:     "running",
					Status:   "error",
					Error:    err.Error(),
					Current:  i + 1,
					Total:    total,
				})
				statusErr = true
				break
			}
			if hasAnyError(statusResults) {
				progress = append(progress, OrchestrationProgress{
					TaskID:   safeID,
					TaskName: task.Name,
					Step:     "running",
					Status:   "error",
					Error:    resultsErrorSummary(statusResults),
					Current:  i + 1,
					Total:    total,
				})
				statusErr = true
				break
			}
			finished = true
			for _, r := range statusResults {
				if r.Running {
					finished = false
					break
				}
			}
		}

		if statusErr {
			continue
		}

		progress = append(progress, OrchestrationProgress{
			TaskID:   safeID,
			TaskName: task.Name,
			Step:     "running",
			Status:   "completed",
			Current:  i + 1,
			Total:    total,
		})

		// Step 3: Pull data
		progress = append(progress, OrchestrationProgress{
			TaskID:   safeID,
			TaskName: task.Name,
			Step:     "pull",
			Status:   "running",
			Current:  i + 1,
			Total:    total,
		})

		pullResults, err := a.PullData(taskID, task.Hosts)
		if err != nil {
			progress = append(progress, OrchestrationProgress{
				TaskID:   safeID,
				TaskName: task.Name,
				Step:     "pull",
				Status:   "error",
				Error:    err.Error(),
				Current:  i + 1,
				Total:    total,
			})
		} else {
			pullStatus := "completed"
			pullErr := ""
			if hasAnyError(pullResults) {
				pullStatus = "error"
				pullErr = resultsErrorSummary(pullResults)
			}
			progress = append(progress, OrchestrationProgress{
				TaskID:   safeID,
				TaskName: task.Name,
				Step:     "pull",
				Status:   pullStatus,
				Error:    pullErr,
				Results:  pullResults,
				Current:  i + 1,
				Total:    total,
			})
		}

		// Step 4: Wait interval (except for last task)
		if i < total-1 && interval > 0 {
			progress = append(progress, OrchestrationProgress{
				TaskID:   safeID,
				TaskName: task.Name,
				Step:     "wait",
				Status:   "running",
				Current:  i + 1,
				Total:    total,
			})
			time.Sleep(time.Duration(interval) * time.Second)
			progress = append(progress, OrchestrationProgress{
				TaskID:   safeID,
				TaskName: task.Name,
				Step:     "wait",
				Status:   "completed",
				Current:  i + 1,
				Total:    total,
			})
		}
	}

	return progress, nil
}

// ========== 报告下载 ==========

// CreateReportZIP 创建报告 ZIP 文件，返回文件路径
func (a *App) CreateReportZIP(taskID string) (string, error) {
	reportDir := taskReportDir(taskID)
	if _, err := os.Stat(reportDir); os.IsNotExist(err) {
		return "", fmt.Errorf("报告目录不存在: %s", reportDir)
	}

	// Look up task name for ZIP filename
	taskName := taskID
	tasks, err := a.GetExecutionTasks()
	if err == nil {
		for _, t := range tasks {
			if t.ID == taskID && t.Name != "" {
				taskName = sanitizeTaskID(t.Name)
				break
			}
		}
	}
	zipName := taskName + "_" + taskID + ".zip"
	zipPath := filepath.Join(filepath.Dir(reportDir), zipName)

	zipFile, err := os.Create(zipPath)
	if err != nil {
		return "", err
	}
	defer zipFile.Close()

	w := zip.NewWriter(zipFile)
	defer w.Close()

	err = filepath.Walk(reportDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		relPath, err := filepath.Rel(reportDir, path)
		if err != nil {
			return err
		}
		f, err := w.Create(relPath)
		if err != nil {
			return err
		}
		src, err := os.Open(path)
		if err != nil {
			return err
		}
		defer src.Close()
		_, err = io.Copy(f, src)
		return err
	})
	if err != nil {
		os.Remove(zipPath)
		return "", err
	}

	return zipPath, nil
}

// GetReportHTMLWithEcharts 获取报告 HTML 内容（内联 echarts）
func (a *App) GetReportHTMLWithEcharts(taskID string) (string, error) {
	data, err := os.ReadFile(taskReportHTMLPath(taskID))
	if err != nil {
		return "", err
	}

	html := string(data)
	reportDir := taskReportDir(taskID)
	echartsPath := filepath.Join(reportDir, "echarts.min.js")

	if _, err := os.Stat(echartsPath); err == nil {
		echartsData, err := os.ReadFile(echartsPath)
		if err == nil {
			b64 := base64.StdEncoding.EncodeToString(echartsData)
			html = strings.Replace(html, `<script src="echarts.min.js"></script>`,
				fmt.Sprintf("<script>%s</script>", string(echartsData)), 1)
			html = strings.Replace(html, `src="echarts.min.js"`,
				fmt.Sprintf("src=\"data:text/javascript;base64,%s\"", b64), -1)
		}
	}

	return html, nil
}
