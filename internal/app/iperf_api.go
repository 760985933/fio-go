package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"fio-go/internal/executor"
	"fio-go/internal/iperf"
)

var iperfRealtime = iperf.NewRealtimeManager()

func (a *App) SaveIperfConfig(config iperf.IperfConfig) error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	if config.ID == "" {
		config.ID = fmt.Sprintf("iperf-cfg-%d", time.Now().UnixNano())
	}
	if config.Name == "" {
		config.Name = config.ID
	}
	data, err := json.Marshal(config)
	if err != nil {
		return err
	}
	return dbSaveIperfConfig(a.db, config.ID, config.Name, string(data))
}

func (a *App) GetIperfConfigs() ([]iperf.IperfConfig, error) {
	if a.db == nil {
		return nil, fmt.Errorf("数据库未初始化")
	}
	ids, err := dbGetIperfConfigs(a.db)
	if err != nil {
		return nil, err
	}
	var configs []iperf.IperfConfig
	for _, id := range ids {
		name, configJSON, err := dbGetIperfConfig(a.db, id)
		if err != nil || configJSON == "" {
			continue
		}
		var cfg iperf.IperfConfig
		if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
			continue
		}
		cfg.Name = name
		configs = append(configs, cfg)
	}
	return configs, nil
}

func (a *App) GetIperfConfig(id string) (*iperf.IperfConfig, error) {
	if a.db == nil {
		return nil, fmt.Errorf("数据库未初始化")
	}
	name, configJSON, err := dbGetIperfConfig(a.db, id)
	if err != nil {
		return nil, err
	}
	if configJSON == "" {
		return nil, nil
	}
	var cfg iperf.IperfConfig
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return nil, err
	}
	cfg.Name = name
	return &cfg, nil
}

func (a *App) DeleteIperfConfig(id string) error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	return dbDeleteIperfConfig(a.db, id)
}

func (a *App) CreateIperfTask(task iperf.IperfTask) error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	if task.ID == "" {
		task.ID = fmt.Sprintf("iperf-task-%d", time.Now().UnixNano())
	}
	if task.CreatedAt == "" {
		task.CreatedAt = time.Now().Format(time.RFC3339)
	}
	if task.Status == "" {
		task.Status = "pending"
	}
	configJSON, _ := json.Marshal(task.Config)
	serverHostJSON, _ := json.Marshal(task.ServerHost)
	clientHostsJSON, _ := json.Marshal(task.ClientHosts)
	return dbSaveIperfTask(a.db, task.ID, task.Name, string(configJSON), string(serverHostJSON), string(clientHostsJSON), task.Status)
}

func (a *App) GetIperfTasks() ([]iperf.IperfTask, error) {
	if a.db == nil {
		return nil, fmt.Errorf("数据库未初始化")
	}
	ids, err := dbGetIperfTasks(a.db)
	if err != nil {
		return nil, err
	}
	var tasks []iperf.IperfTask
	for _, id := range ids {
		name, configJSON, serverHostJSON, clientHostsJSON, status, err := dbGetIperfTask(a.db, id)
		if err != nil {
			continue
		}
		var task iperf.IperfTask
		task.ID = id
		task.Name = name
		task.Status = status
		json.Unmarshal([]byte(configJSON), &task.Config)
		json.Unmarshal([]byte(serverHostJSON), &task.ServerHost)
		json.Unmarshal([]byte(clientHostsJSON), &task.ClientHosts)
		tasks = append(tasks, task)
	}
	return tasks, nil
}

func (a *App) DeleteIperfTask(id string) error {
	if a.db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	return dbDeleteIperfTask(a.db, id)
}

func (a *App) StartIperfServer(host executor.HostConfig, port int, bindIP string) executor.ExecutionResult {
	if port <= 0 {
		port = 5201
	}
	return executor.StartIperfServer(host, port, bindIP)
}

func (a *App) StopIperfServer(host executor.HostConfig, port int) executor.ExecutionResult {
	if port <= 0 {
		port = 5201
	}
	return executor.StopIperfServer(host, port)
}

func (a *App) CheckIperfServer(host executor.HostConfig, port int) executor.ExecutionResult {
	if port <= 0 {
		port = 5201
	}
	return executor.CheckIperfServerRunning(host, port)
}

func (a *App) CheckIperfInstalled(hosts []executor.HostConfig) []executor.ExecutionResult {
	return executor.CheckIperfInstalled(hosts)
}

func (a *App) RunIperfTest(taskID string) error {
	tasks, err := a.GetIperfTasks()
	if err != nil {
		return err
	}
	var task *iperf.IperfTask
	for i := range tasks {
		if tasks[i].ID == taskID {
			task = &tasks[i]
			break
		}
	}
	if task == nil {
		return fmt.Errorf("任务 %s 不存在", taskID)
	}
	if len(task.ClientHosts) == 0 {
		return fmt.Errorf("任务 %s 无可用客户端主机", taskID)
	}

	args := []string{"iperf3", "-c", task.Config.ServerTestIP}
	if task.Config.ServerTestIP == "" {
		args[2] = task.ServerHost.Host
	}
	if task.Config.Protocol == "udp" {
		args = append(args, "-u")
	}
	if task.Config.Bandwidth != "" && task.Config.Bandwidth != "0" {
		args = append(args, "-b", task.Config.Bandwidth)
	}
	if task.Config.Duration > 0 {
		args = append(args, "-t", fmt.Sprintf("%d", task.Config.Duration))
	}
	if task.Config.Parallel > 1 {
		args = append(args, "-P", fmt.Sprintf("%d", task.Config.Parallel))
	}
	if task.Config.BlockSize != "" {
		args = append(args, "-l", task.Config.BlockSize)
	}
	if task.Config.WindowSize != "" {
		args = append(args, "-w", task.Config.WindowSize)
	}
	if task.Config.Reverse {
		args = append(args, "-R")
	}
	if task.Config.Bidir {
		args = append(args, "--bidir")
	}
	args = append(args, "--json-stream")

	if task.Config.ExtraFlags != "" {
		for _, flag := range splitArgs(task.Config.ExtraFlags) {
			if flag != "" {
				args = append(args, flag)
			}
		}
	}

	dbUpdateIperfTaskStatus(a.db, taskID, "running")

	var startErr error
	for i, host := range task.ClientHosts {
		session, err := executor.RunIperfClient(host, taskID, args)
		if err != nil {
			startErr = fmt.Errorf("客户端 %s 启动失败: %v", host.Host, err)
			continue
		}
		iperfRealtime.StartStreamAt(taskID, i, session)
	}

	if startErr != nil {
		iperfRealtime.StopStream(taskID)
		dbUpdateIperfTaskStatus(a.db, taskID, "error")
		return startErr
	}

	go func() {
		time.Sleep(time.Duration(task.Config.Duration+5) * time.Second)
		iperfRealtime.StopStream(taskID)
		dbUpdateIperfTaskStatus(a.db, taskID, "completed")
	}()

	return nil
}

func (a *App) StopIperfTest(taskID string) error {
	iperfRealtime.StopStream(taskID)
	hosts := make([]executor.HostConfig, 0)
	tasks, err := a.GetIperfTasks()
	if err == nil {
		for _, t := range tasks {
			if t.ID == taskID {
				hosts = t.ClientHosts
				break
			}
		}
	}
	if len(hosts) > 0 {
		executor.KillIperfClient(taskID, hosts)
	}
	dbUpdateIperfTaskStatus(a.db, taskID, "stopped")
	return nil
}

func (a *App) CheckIperfTestStatus(taskID string) string {
	tasks, err := a.GetIperfTasks()
	if err != nil {
		return "unknown"
	}
	for _, t := range tasks {
		if t.ID == taskID {
			return t.Status
		}
	}
	return "unknown"
}

func (a *App) IsIperfMonitorRunning(taskID string) bool {
	return iperfRealtime.IsRunning(taskID)
}

func (a *App) PullIperfData(taskID string) error {
	tasks, err := a.GetIperfTasks()
	if err != nil {
		return err
	}
	var task *iperf.IperfTask
	for i := range tasks {
		if tasks[i].ID == taskID {
			task = &tasks[i]
			break
		}
	}
	if task == nil {
		return fmt.Errorf("任务 %s 不存在", taskID)
	}

	rawDir := iperfTaskRawDataDir(taskID)
	if err := os.MkdirAll(rawDir, 0755); err != nil {
		return fmt.Errorf("创建数据目录失败: %v", err)
	}

	results := executor.PullIperfData(taskID, task.ClientHosts, rawDir)
	for _, r := range results {
		if r.Error != nil {
			return r.Error
		}
	}
	return nil
}

func (a *App) GenerateIperfReport(taskID string) error {
	rawDir := iperfTaskRawDataDir(taskID)
	reportDir := iperfTaskReportDir(taskID)
	if err := os.MkdirAll(reportDir, 0755); err != nil {
		return fmt.Errorf("创建报告目录失败: %v", err)
	}

	entries, err := os.ReadDir(rawDir)
	if err != nil {
		return fmt.Errorf("读取数据目录失败: %v", err)
	}

	var hosts []string
	seen := make(map[string]bool)
	for _, entry := range entries {
		if entry.IsDir() && !seen[entry.Name()] {
			hosts = append(hosts, entry.Name())
			seen[entry.Name()] = true
		}
	}

	results := iperf.CollectAndSortResults(rawDir, hosts)
	if len(results) == 0 {
		return fmt.Errorf("未找到测试数据")
	}

	htmlPath := filepath.Join(reportDir, "iperf_report.html")
	return iperf.GenerateIperfHTML(results, htmlPath)
}

func (a *App) GetIperfReportHTML(taskID string) (string, error) {
	htmlPath := filepath.Join(iperfTaskReportDir(taskID), "iperf_report.html")
	data, err := os.ReadFile(htmlPath)
	if err != nil {
		return "", fmt.Errorf("报告文件不存在，请先生成报告")
	}
	return string(data), nil
}

func (a *App) GetIperfAnalysisTasks() ([]iperf.IperfAnalysisSummary, error) {
	tasks, err := a.GetIperfTasks()
	if err != nil {
		return nil, err
	}
	var summaries []iperf.IperfAnalysisSummary
	for _, t := range tasks {
		summary := iperf.IperfAnalysisSummary{
			TaskID:      t.ID,
			TaskName:    t.Name,
			ServerHost:  t.ServerHost.Host,
			ClientCount: len(t.ClientHosts),
			Status:      t.Status,
			CreatedAt:   t.CreatedAt,
		}
		rawDir := iperfTaskRawDataDir(t.ID)
		if _, err := os.Stat(rawDir); err == nil {
			summary.HasData = true
		}
		reportPath := filepath.Join(iperfTaskReportDir(t.ID), "iperf_report.html")
		if _, err := os.Stat(reportPath); err == nil {
			summary.HasReport = true
		}
		summaries = append(summaries, summary)
	}
	return summaries, nil
}

func (a *App) CleanIperfLocal(taskID string) error {
	dir := iperfTaskRawDataDir(taskID)
	os.RemoveAll(dir)
	reportDir := iperfTaskReportDir(taskID)
	os.RemoveAll(reportDir)
	return nil
}

func (a *App) CleanIperfRemote(taskID string) error {
	tasks, err := a.GetIperfTasks()
	if err != nil {
		return err
	}
	for _, t := range tasks {
		if t.ID == taskID {
			results := executor.CleanIperfRemote(taskID, t.ClientHosts)
			for _, r := range results {
				if r.Error != nil {
					return r.Error
				}
			}
			return nil
		}
	}
	return fmt.Errorf("任务 %s 不存在", taskID)
}

func iperfTaskRawDataDir(taskID string) string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".nettopo_test", "data", "iperf-tasks", taskID, "raw")
}

func iperfTaskReportDir(taskID string) string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".nettopo_test", "output", "iperf-tasks", taskID)
}

func splitArgs(s string) []string {
	var args []string
	current := ""
	inQuote := false
	quoteChar := byte(0)
	for i := 0; i < len(s); i++ {
		c := s[i]
		if inQuote {
			if c == quoteChar {
				inQuote = false
			} else {
				current += string(c)
			}
		} else if c == '"' || c == '\'' {
			inQuote = true
			quoteChar = c
		} else if c == ' ' || c == '\t' {
			if current != "" {
				args = append(args, current)
				current = ""
			}
		} else {
			current += string(c)
		}
	}
	if current != "" {
		args = append(args, current)
	}
	return args
}
