package web

import (
	"archive/zip"
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"fio-go/internal/executor"
	"fio-go/internal/parser"
	"fio-go/internal/report"

	_ "modernc.org/sqlite"
)

//go:embed frontend/*
var frontendFS embed.FS

const (
	orchestrationConfigFile = "scripts/orchestration_config.json"
	auditLogFile            = "data/audit.log"
	defaultTaskName         = "默认执行任务"
	taskDataRoot            = "data/tasks"
	taskReportRoot          = "output/tasks"
)

type executionTaskConfig struct {
	ID      string                `json:"id"`
	Name    string                `json:"name"`
	Scripts []string              `json:"scripts"`
	Hosts   []executor.HostConfig `json:"hosts"`
}

type executionTasksPayload struct {
	Tasks []executionTaskConfig `json:"tasks"`
}

type executeRequest struct {
	Action string              `json:"action"`
	Task   executionTaskConfig `json:"task"`
}

type analysisTaskSummary struct {
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
}

func StartServer(port int) error {
	subFS, err := fs.Sub(frontendFS, "frontend")
	if err != nil {
		return fmt.Errorf("failed to create sub filesystem: %v", err)
	}

	mux := http.NewServeMux()

	// Serve static files
	mux.Handle("/", http.FileServer(http.FS(subFS)))

	// API endpoints for execution
	mux.HandleFunc("/api/scripts", handleScripts)
	mux.HandleFunc("/api/execution-tasks", handleExecutionTasks)
	mux.HandleFunc("/api/execution-task-log", handleExecutionTaskLog)
	mux.HandleFunc("/api/host-log", handleHostLog)
	mux.HandleFunc("/api/execute", handleExecute)
	mux.HandleFunc("/api/orchestration-config", handleOrchestrationConfig)
	mux.HandleFunc("/api/audit-log", handleAuditLog)
	mux.HandleFunc("/api/analysis/tasks", handleAnalysisTasks)
	mux.HandleFunc("/api/analysis/generate", handleAnalysisGenerate)
	mux.HandleFunc("/api/analysis/report", handleAnalysisReport)
	mux.HandleFunc("/api/analysis/assets", handleAnalysisAsset)
	mux.HandleFunc("/api/analysis/download", handleAnalysisDownload)

	addr := fmt.Sprintf(":%d", port)
	log.Printf("[INFO] Starting GUI server at http://localhost%s\n", addr)
	return http.ListenAndServe(addr, mux)
}

func openWebDB() (*sql.DB, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	dbDir := filepath.Join(home, ".fio-gui")
	if err := os.MkdirAll(dbDir, 0700); err != nil {
		return nil, err
	}
	dbPath := filepath.Join(dbDir, "hosts.db")
	db, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := initWebDB(db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func initWebDB(db *sql.DB) error {
	for _, stmt := range []string{
		`CREATE TABLE IF NOT EXISTS hosts (
			id       INTEGER PRIMARY KEY AUTOINCREMENT,
			host     TEXT NOT NULL,
			port     INTEGER NOT NULL DEFAULT 22,
			user     TEXT NOT NULL DEFAULT 'root',
			password TEXT NOT NULL DEFAULT '',
			UNIQUE(host, port, user)
		)`,
		`CREATE TABLE IF NOT EXISTS script_configs (
			script_name TEXT PRIMARY KEY,
			config      TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS execution_tasks (
			id   INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			data TEXT NOT NULL
		)`,
	} {
		if _, err := db.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
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

func normalizeExecutionTask(task executionTaskConfig, idx int) executionTaskConfig {
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

var taskNameSanitizer = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

func sanitizeTaskID(taskID string) string {
	safeTaskID := taskNameSanitizer.ReplaceAllString(strings.TrimSpace(taskID), "-")
	safeTaskID = strings.Trim(safeTaskID, "-.")
	if safeTaskID == "" {
		return "default-task"
	}
	return safeTaskID
}

func taskBaseDir(taskID string) string {
	return filepath.Join(taskDataRoot, sanitizeTaskID(taskID))
}

func taskRawDataDir(taskID string) string {
	return filepath.Join(taskBaseDir(taskID), "raw")
}

func taskExecutionLogPath(taskID string) string {
	return filepath.Join(taskBaseDir(taskID), "execution.log")
}

func taskReportDir(taskID string) string {
	return filepath.Join(taskReportRoot, sanitizeTaskID(taskID))
}

func taskReportHTMLPath(taskID string) string {
	return filepath.Join(taskReportDir(taskID), "fio_report.html")
}

func taskReportExcelPath(taskID string) string {
	return filepath.Join(taskReportDir(taskID), "fio_summary.xlsx")
}

func taskReportAssetPath(taskID string, name string) string {
	return filepath.Join(taskReportDir(taskID), filepath.Base(name))
}

func appendTaskExecutionLog(task executionTaskConfig, message string) error {
	logPath := taskExecutionLogPath(task.ID)
	if err := os.MkdirAll(filepath.Dir(logPath), 0755); err != nil {
		return err
	}

	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return err
	}
	defer f.Close()

	entry := fmt.Sprintf("[%s] %s\n", time.Now().Format("2006-01-02 15:04:05"), strings.TrimSpace(message))
	_, err = f.WriteString(entry)
	return err
}

func readTaskExecutionLog(taskID string) (string, error) {
	content, err := os.ReadFile(taskExecutionLogPath(taskID))
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	return string(content), nil
}

func dirHasFiles(dir string) bool {
	found := false
	filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() {
			return nil
		}
		found = true
		return fs.SkipAll
	})
	return found
}

func findExecutionTaskByID(taskID string) (executionTaskConfig, error) {
	tasks, err := readExecutionTasks()
	if err != nil {
		return executionTaskConfig{}, err
	}
	safeTaskID := sanitizeTaskID(taskID)
	for idx, task := range tasks {
		normalized := normalizeExecutionTask(task, idx)
		if sanitizeTaskID(normalized.ID) == safeTaskID {
			return normalized, nil
		}
	}
	return executionTaskConfig{}, fmt.Errorf("task %q not found", taskID)
}

func buildAnalysisTaskSummaries() ([]analysisTaskSummary, error) {
	tasks, err := readExecutionTasks()
	if err != nil {
		return nil, err
	}

	summaries := make([]analysisTaskSummary, 0, len(tasks))
	for idx, task := range tasks {
		task = normalizeExecutionTask(task, idx)
		summary := analysisTaskSummary{
			ID:            task.ID,
			Name:          task.Name,
			Scripts:       task.Scripts,
			HasData:       dirHasFiles(taskRawDataDir(task.ID)),
			HasReport:     dirHasFiles(taskReportDir(task.ID)),
			LogAvailable:  false,
			DataDir:       taskRawDataDir(task.ID),
			ReportDir:     taskReportDir(task.ID),
			ReportHTMLURL: "/api/analysis/report?taskId=" + task.ID,
			DownloadURL:   "/api/analysis/download?taskId=" + task.ID,
		}
		if _, err := os.Stat(taskExecutionLogPath(task.ID)); err == nil {
			summary.LogAvailable = true
		}
		if _, err := os.Stat(taskReportHTMLPath(task.ID)); err == nil {
			summary.HasReport = true
		}
		summaries = append(summaries, summary)
	}
	return summaries, nil
}

func createZipFromDir(sourceDir string, writer io.Writer) error {
	zipWriter := zip.NewWriter(writer)
	defer zipWriter.Close()

	return filepath.Walk(sourceDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}

		relPath, err := filepath.Rel(sourceDir, path)
		if err != nil {
			return err
		}

		zipFile, err := zipWriter.Create(filepath.ToSlash(relPath))
		if err != nil {
			return err
		}

		srcFile, err := os.Open(path)
		if err != nil {
			return err
		}
		_, err = io.Copy(zipFile, srcFile)
		srcFile.Close()
		return err
	})
}

func generateTaskReport(task executionTaskConfig) error {
	dataDir := taskRawDataDir(task.ID)
	if !dirHasFiles(dataDir) {
		return fmt.Errorf("task %q has no pulled data", task.Name)
	}

	reportDir := taskReportDir(task.ID)
	if err := os.MkdirAll(reportDir, 0755); err != nil {
		return err
	}

	analysisResult, err := parser.AnalyzeJSONFiles(dataDir)
	if err != nil {
		return err
	}

	groupedRows, err := report.GenerateExcel(analysisResult, taskReportExcelPath(task.ID))
	if err != nil {
		return err
	}

	chartGroups := parser.BuildChartGroups(dataDir)
	err = report.GenerateHTML(chartGroups, analysisResult.SystemTexts, groupedRows, taskReportHTMLPath(task.ID))
	if err != nil {
		return err
	}

	return downloadEcharts(taskReportAssetPath(task.ID, "echarts.min.js"))
}

func downloadEcharts(destPath string) error {
	if _, err := os.Stat(destPath); err == nil {
		return nil
	}

	resp, err := http.Get("https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js")
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	err = os.MkdirAll(filepath.Dir(destPath), 0755)
	if err != nil {
		return err
	}

	out, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}

func readExecutionTasks() ([]executionTaskConfig, error) {
	db, err := openWebDB()
	if err != nil {
		return nil, err
	}
	defer db.Close()

	var data string
	err = db.QueryRow(`SELECT data FROM execution_tasks WHERE name = ?`, "_all_").Scan(&data)
	if err == sql.ErrNoRows {
		return []executionTaskConfig{}, nil
	}
	if err != nil {
		return nil, err
	}
	var tasks []executionTaskConfig
	if err := json.Unmarshal([]byte(data), &tasks); err != nil {
		return nil, err
	}
	for idx := range tasks {
		tasks[idx] = normalizeExecutionTask(tasks[idx], idx)
	}
	return tasks, nil
}

func writeExecutionTasks(tasks []executionTaskConfig) error {
	db, err := openWebDB()
	if err != nil {
		return err
	}
	defer db.Close()

	normalizedTasks := make([]executionTaskConfig, 0, len(tasks))
	for idx, task := range tasks {
		normalizedTasks = append(normalizedTasks, normalizeExecutionTask(task, idx))
	}
	data, err := json.Marshal(normalizedTasks)
	if err != nil {
		return err
	}
	_, err = db.Exec(`DELETE FROM execution_tasks`)
	if err != nil {
		return err
	}
	_, err = db.Exec(`INSERT INTO execution_tasks (name, data) VALUES (?, ?)`, "_all_", string(data))
	return err
}

func handleExecutionTasks(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		tasks, err := readExecutionTasks()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(executionTasksPayload{Tasks: tasks})
	case http.MethodPost:
		var payload executionTasksPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := writeExecutionTasks(payload.Tasks); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusOK)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleExecutionTaskLog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	taskID := r.URL.Query().Get("taskId")
	if strings.TrimSpace(taskID) == "" {
		http.Error(w, "taskId is required", http.StatusBadRequest)
		return
	}

	content, err := readTaskExecutionLog(taskID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write([]byte(content))
}

func handleScripts(w http.ResponseWriter, r *http.Request) {
	os.MkdirAll("scripts", 0755)
	switch r.Method {
	case http.MethodGet:
		name := r.URL.Query().Get("name")
		if name != "" {
			// Read specific script content
			content, err := os.ReadFile(filepath.Join("scripts", name))
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Write(content)
			return
		}

		files, err := os.ReadDir("scripts")
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		var scripts []string
		for _, f := range files {
			if !f.IsDir() && strings.HasSuffix(f.Name(), ".fio") {
				scripts = append(scripts, f.Name())
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(scripts)
	case http.MethodPost:
		var req struct {
			Name    string `json:"name"`
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if !strings.HasSuffix(req.Name, ".fio") {
			req.Name += ".fio"
		}
		err := os.WriteFile(filepath.Join("scripts", req.Name), []byte(req.Content), 0644)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	case http.MethodDelete:
		name := r.URL.Query().Get("name")
		if name == "" {
			http.Error(w, "name is required", http.StatusBadRequest)
			return
		}
		err := os.Remove(filepath.Join("scripts", name))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleHostLog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	taskID := r.URL.Query().Get("taskId")
	hostStr := r.URL.Query().Get("host")
	if taskID == "" || hostStr == "" {
		http.Error(w, "taskId and host are required", http.StatusBadRequest)
		return
	}

	task, err := findExecutionTaskByID(taskID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	var targetHost *executor.HostConfig
	for _, h := range task.Hosts {
		if fmt.Sprintf("%s@%s:%d", h.User, h.Host, h.Port) == hostStr {
			targetHost = &h
			break
		}
	}

	if targetHost == nil {
		http.Error(w, "Host not found in task", http.StatusNotFound)
		return
	}

	client, err := executor.NewSSHClient(*targetHost)
	if err != nil {
		http.Error(w, "Failed to connect: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer client.Close()

	// Get FIO log from remote host
	// Using a simple tail command to get the last few lines
	_, _, logsDir, _ := executor.BuildTaskPaths(taskID)
	logFile := filepath.Join(logsDir, "fio_stdout.log")

	// Read last 20 lines
	cmd := fmt.Sprintf("tail -n 20 %s 2>/dev/null || echo '暂无日志或文件未生成'", logFile)
	out, _ := client.RunCommand(cmd)

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write([]byte(out))
}

func handleExecute(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req executeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	task := normalizeExecutionTask(req.Task, 0)
	if task.ID == "" {
		task.ID = "runtime-task"
	}
	if len(task.Hosts) == 0 {
		http.Error(w, "task hosts are required", http.StatusBadRequest)
		return
	}

	appendTaskExecutionLog(task, fmt.Sprintf("开始执行动作: %s, 脚本: %v, 主机数: %d", req.Action, task.Scripts, len(task.Hosts)))

	var results []executor.ExecutionResult
	switch req.Action {
	case "check_connectivity":
		host := req.Task.Hosts[0] // 假设前端只发一个过来
		client, err := executor.NewSSHClient(host)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"success": false,
				"error":   err.Error(),
			})
			return
		}
		defer client.Close()
		_, err = client.RunCommand("true")
		success := err == nil
		w.Header().Set("Content-Type", "application/json")
		resp := map[string]any{"success": success}
		if err != nil {
			resp["error"] = err.Error()
		}
		json.NewEncoder(w).Encode(resp)
		return
	case "pre_deploy_check":
		statusResults := executor.CheckStatus(task.ID, task.Hosts)
		residualResults := executor.CheckResidualData(task.ID, task.Hosts)

		type checkResult struct {
			Host     string `json:"host"`
			Running  bool   `json:"running"`
			Residual bool   `json:"residual"`
			Msg      string `json:"msg"`
		}
		var checkResults []checkResult
		for i, host := range task.Hosts {
			hostStr := fmt.Sprintf("%s@%s:%d", host.User, host.Host, host.Port)
			running := false
			msg := ""
			if i < len(statusResults) {
				msg = statusResults[i].Msg
				running = statusResults[i].Running
			}
			residual := false
			if i < len(residualResults) && residualResults[i].Msg == "Exists" {
				residual = true
			}
			checkResults = append(checkResults, checkResult{
				Host:     hostStr,
				Running:  running,
				Residual: residual,
				Msg:      msg,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"results": checkResults,
		})
		return
	case "deploy":
		if len(task.Scripts) == 0 {
			http.Error(w, "task scripts are required", http.StatusBadRequest)
			return
		}

		// 检查是否有正在运行的任务
		statusResults := executor.CheckStatus(task.ID, task.Hosts)
		var busyHosts []string
		for _, res := range statusResults {
			if res.Running {
				busyHosts = append(busyHosts, res.Host)
			}
		}

		if len(busyHosts) > 0 {
			msg := fmt.Sprintf("以下主机已有该任务正在执行，请先停止任务后再重新部署：\n%s", strings.Join(busyHosts, "\n"))
			appendTaskExecutionLog(task, "部署终止: "+msg)
			http.Error(w, msg, http.StatusConflict)
			return
		}

		for _, scriptName := range task.Scripts {
			content, err := os.ReadFile(filepath.Join("scripts", scriptName))
			if err != nil {
				results = append(results, executor.ExecutionResult{
					Host:  "all",
					Error: fmt.Errorf("读取脚本 %s 失败: %v", scriptName, err),
				})
				continue
			}
			results = append(results, executor.DeployAndRun(task.ID, task.Hosts, scriptName, content)...)
		}
	case "status":
		results = executor.CheckStatus(task.ID, task.Hosts)
	case "killall":
		results = executor.KillAll(task.ID, task.Hosts)
	case "pull":
		rawDir := taskRawDataDir(task.ID)
		os.MkdirAll(rawDir, 0755)
		results = executor.PullData(task.ID, task.Hosts, rawDir)
	case "clean_local":
		baseDir := taskBaseDir(task.ID)
		reportDir := taskReportDir(task.ID)

		err1 := os.RemoveAll(baseDir)
		err2 := os.RemoveAll(reportDir)

		if err1 != nil || err2 != nil {
			msg := fmt.Sprintf("清理本地失败: %v, %v", err1, err2)
			appendTaskExecutionLog(task, msg)
			http.Error(w, msg, http.StatusInternalServerError)
			return
		}

		// 重新创建目录以便记录日志
		os.MkdirAll(baseDir, 0755)
		appendTaskExecutionLog(task, "已清理本地历史数据和分析报告")

		// 构造虚拟结果以便前端表格展示
		results = make([]executor.ExecutionResult, 0, len(task.Hosts))
		for _, host := range task.Hosts {
			results = append(results, executor.ExecutionResult{
				Host: fmt.Sprintf("%s@%s:%d", host.User, host.Host, host.Port),
				Msg:  "服务器端历史数据已清理",
			})
		}
	case "clean_remote":
		appendTaskExecutionLog(task, "开始清理远程主机数据...")
		results = executor.CleanRemote(task.ID, task.Hosts)
		appendTaskExecutionLog(task, "远程主机数据清理完成")
	default:
		http.Error(w, "Unknown action", http.StatusBadRequest)
		return
	}

	var output strings.Builder
	output.WriteString(fmt.Sprintf("任务[%s] 脚本[%v]\n", task.Name, task.Scripts))
	for _, res := range results {
		if res.Error != nil {
			output.WriteString(fmt.Sprintf("[%s] Error: %v\n", res.Host, res.Error))
		} else {
			output.WriteString(fmt.Sprintf("[%s] %s\n", res.Host, res.Msg))
		}
	}
	if req.Action == "pull" {
		output.WriteString(fmt.Sprintf("任务数据目录: %s\n", taskRawDataDir(task.ID)))
	}
	appendTaskExecutionLog(task, output.String())

	// 如果是 status, pull, killall, deploy, clean_local 或 clean_remote，返回 JSON 格式以便前端渲染表格
	if req.Action == "status" || req.Action == "pull" || req.Action == "killall" || req.Action == "deploy" || req.Action == "clean_local" || req.Action == "clean_remote" {
		type resultJSON struct {
			Host  string `json:"host"`
			Error string `json:"error,omitempty"`
			Msg   string `json:"msg"`
		}
		var resultsList []resultJSON
		for _, res := range results {
			r := resultJSON{Host: res.Host, Msg: res.Msg}
			if res.Error != nil {
				r.Error = res.Error.Error()
			}
			resultsList = append(resultsList, r)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"taskName": task.Name,
			"action":   req.Action,
			"results":  resultsList,
			"rawDir":   taskRawDataDir(task.ID),
		})
		return
	}

	w.Write([]byte(output.String()))
}

func handleAnalysisTasks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	summaries, err := buildAnalysisTaskSummaries()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"tasks": summaries})
}

func handleAnalysisGenerate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		TaskID string `json:"taskId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.TaskID) == "" {
		http.Error(w, "taskId is required", http.StatusBadRequest)
		return
	}

	task, err := findExecutionTaskByID(req.TaskID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	if err := generateTaskReport(task); err != nil {
		appendTaskExecutionLog(task, "生成分析报告失败: "+err.Error())
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	appendTaskExecutionLog(task, "分析报告已生成: "+taskReportDir(task.ID))
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"taskId":        task.ID,
		"reportDir":     taskReportDir(task.ID),
		"reportHtmlUrl": "/api/analysis/report?taskId=" + task.ID,
		"downloadUrl":   "/api/analysis/download?taskId=" + task.ID,
	})
}

func handleAnalysisReport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	taskID := r.URL.Query().Get("taskId")
	if strings.TrimSpace(taskID) == "" {
		http.Error(w, "taskId is required", http.StatusBadRequest)
		return
	}

	content, err := os.ReadFile(taskReportHTMLPath(taskID))
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	htmlContent := strings.ReplaceAll(string(content), `src="echarts.min.js"`, fmt.Sprintf(`src="/api/analysis/assets?taskId=%s&name=echarts.min.js"`, taskID))
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(htmlContent))
}

func handleAnalysisAsset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	taskID := r.URL.Query().Get("taskId")
	name := filepath.Base(r.URL.Query().Get("name"))
	if strings.TrimSpace(taskID) == "" || strings.TrimSpace(name) == "" {
		http.Error(w, "taskId and name are required", http.StatusBadRequest)
		return
	}

	http.ServeFile(w, r, taskReportAssetPath(taskID, name))
}

func handleAnalysisDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	taskID := r.URL.Query().Get("taskId")
	if strings.TrimSpace(taskID) == "" {
		http.Error(w, "taskId is required", http.StatusBadRequest)
		return
	}

	reportDir := taskReportDir(taskID)
	if !dirHasFiles(reportDir) {
		http.Error(w, "report not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s-analysis.zip"`, sanitizeTaskID(taskID)))
	if err := createZipFromDir(reportDir, w); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func handleOrchestrationConfig(w http.ResponseWriter, r *http.Request) {
	os.MkdirAll("scripts", 0755)

	switch r.Method {
	case http.MethodGet:
		content, err := os.ReadFile(orchestrationConfigFile)
		if err != nil {
			if os.IsNotExist(err) {
				http.Error(w, "Not found", http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(content)

	case http.MethodPost:
		var req map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		data, err := json.MarshalIndent(req, "", "  ")
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		if err := os.WriteFile(orchestrationConfigFile, data, 0644); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleAuditLog(w http.ResponseWriter, r *http.Request) {
	os.MkdirAll("data", 0755)

	switch r.Method {
	case http.MethodGet:
		content, err := os.ReadFile(auditLogFile)
		if err != nil {
			if os.IsNotExist(err) {
				// Return empty array if file doesn't exist
				w.Header().Set("Content-Type", "application/json")
				w.Write([]byte("[]"))
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// The file contains newline-separated JSON objects
		lines := strings.Split(strings.TrimSpace(string(content)), "\n")
		var logs []json.RawMessage
		for _, line := range lines {
			if strings.TrimSpace(line) != "" {
				logs = append(logs, json.RawMessage(line))
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(logs)

	case http.MethodPost:
		var logEntry struct {
			Action    string `json:"action"`
			Details   string `json:"details"`
			Timestamp string `json:"timestamp"`
		}

		if err := json.NewDecoder(r.Body).Decode(&logEntry); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if logEntry.Timestamp == "" {
			logEntry.Timestamp = time.Now().Format(time.RFC3339)
		}

		logData, err := json.Marshal(logEntry)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		f, err := os.OpenFile(auditLogFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer f.Close()

		if _, err := f.Write(append(logData, '\n')); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
