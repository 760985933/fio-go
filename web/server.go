package web

import (
	"archive/zip"
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

	"fio-go/executor"
	"fio-go/parser"
	"fio-go/report"
)

//go:embed frontend/*
var frontendFS embed.FS

const (
	executionTasksFile = "scripts/execution_tasks.json"
	defaultTaskName    = "默认执行任务"
	taskDataRoot       = "data/tasks"
	taskReportRoot     = "output/tasks"
)

type executionTaskConfig struct {
	ID     string                `json:"id"`
	Name   string                `json:"name"`
	Script string                `json:"script"`
	Hosts  []executor.HostConfig `json:"hosts"`
}

type executionTasksPayload struct {
	Tasks []executionTaskConfig `json:"tasks"`
}

type executeRequest struct {
	Action string              `json:"action"`
	Task   executionTaskConfig `json:"task"`
}

type analysisTaskSummary struct {
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
	mux.HandleFunc("/api/execute", handleExecute)
	mux.HandleFunc("/api/analysis/tasks", handleAnalysisTasks)
	mux.HandleFunc("/api/analysis/generate", handleAnalysisGenerate)
	mux.HandleFunc("/api/analysis/report", handleAnalysisReport)
	mux.HandleFunc("/api/analysis/assets", handleAnalysisAsset)
	mux.HandleFunc("/api/analysis/download", handleAnalysisDownload)

	addr := fmt.Sprintf(":%d", port)
	log.Printf("[INFO] Starting GUI server at http://localhost%s\n", addr)
	return http.ListenAndServe(addr, mux)
}

func defaultExecutionTask() executionTaskConfig {
	return executionTaskConfig{
		ID:     "default-task",
		Name:   defaultTaskName,
		Script: "",
		Hosts: []executor.HostConfig{
			{
				Host: "127.0.0.1",
				Port: 22,
				User: "root",
			},
		},
	}
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
			Script:        task.Script,
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
	content, err := os.ReadFile(executionTasksFile)
	if err != nil {
		if !os.IsNotExist(err) {
			return nil, err
		}

		// Initial default task
		return []executionTaskConfig{defaultExecutionTask()}, nil
	}

	var payload executionTasksPayload
	err = json.Unmarshal(content, &payload)
	if err != nil {
		return nil, err
	}

	if len(payload.Tasks) == 0 {
		return []executionTaskConfig{defaultExecutionTask()}, nil
	}

	tasks := make([]executionTaskConfig, 0, len(payload.Tasks))
	for idx, task := range payload.Tasks {
		normalized := normalizeExecutionTask(task, idx)
		tasks = append(tasks, normalized)
	}
	return tasks, nil
}

func writeExecutionTasks(tasks []executionTaskConfig) error {
	if err := os.MkdirAll("scripts", 0755); err != nil {
		return err
	}

	normalizedTasks := make([]executionTaskConfig, 0, len(tasks))
	for idx, task := range tasks {
		normalized := normalizeExecutionTask(task, idx)
		normalizedTasks = append(normalizedTasks, normalized)
	}

	data, err := json.MarshalIndent(executionTasksPayload{Tasks: normalizedTasks}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(executionTasksFile, data, 0600)
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
		if len(payload.Tasks) == 0 {
			payload.Tasks = []executionTaskConfig{defaultExecutionTask()}
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

	appendTaskExecutionLog(task, fmt.Sprintf("开始执行动作: %s, 脚本: %s, 主机数: %d", req.Action, task.Script, len(task.Hosts)))

	var results []executor.ExecutionResult
	switch req.Action {
	case "deploy":
		if task.Script == "" {
			http.Error(w, "task script is required", http.StatusBadRequest)
			return
		}

		// 检查是否有正在运行的任务
		statusResults := executor.CheckStatus(task.ID, task.Hosts)
		var busyHosts []string
		for _, res := range statusResults {
			if strings.Contains(res.Msg, "Running") {
				busyHosts = append(busyHosts, res.Host)
			}
		}

		if len(busyHosts) > 0 {
			msg := fmt.Sprintf("以下主机已有该任务正在执行，请先停止任务后再重新部署：\n%s", strings.Join(busyHosts, "\n"))
			appendTaskExecutionLog(task, "部署终止: "+msg)
			http.Error(w, msg, http.StatusConflict)
			return
		}

		content, err := os.ReadFile(filepath.Join("scripts", task.Script))
		if err != nil {
			http.Error(w, "Failed to read script: "+err.Error(), http.StatusBadRequest)
			return
		}
		results = executor.DeployAndRun(task.ID, task.Hosts, task.Script, content)
	case "status":
		results = executor.CheckStatus(task.ID, task.Hosts)
	case "killall":
		results = executor.KillAll(task.ID, task.Hosts)
	case "pull":
		rawDir := taskRawDataDir(task.ID)
		os.MkdirAll(rawDir, 0755)
		results = executor.PullData(task.ID, task.Hosts, rawDir)
	default:
		http.Error(w, "Unknown action", http.StatusBadRequest)
		return
	}

	var output strings.Builder
	output.WriteString(fmt.Sprintf("任务[%s] 脚本[%s]\n", task.Name, task.Script))
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

	// 如果是 status, pull, killall 或 deploy，返回 JSON 格式以便前端渲染表格
	if req.Action == "status" || req.Action == "pull" || req.Action == "killall" || req.Action == "deploy" {
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
