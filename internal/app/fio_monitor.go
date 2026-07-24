package app

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"fio-go/internal/executor"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// FioStatus 实时 FIO 状态
type FioStatus struct {
	Host      string  `json:"host"`
	JobName   string  `json:"jobName"`
	ReadIOPS  float64 `json:"readIOPS"`
	WriteIOPS float64 `json:"writeIOPS"`
	ReadBW    float64 `json:"readBW"`    // KB/s
	WriteBW   float64 `json:"writeBW"`   // KB/s
	ReadLat   float64 `json:"readLat"`   // usec
	WriteLat  float64 `json:"writeLat"`  // usec
	Runtime   int     `json:"runtime"`   // seconds
	ETA       int     `json:"eta"`       // seconds
	JobStatus string  `json:"jobStatus"` // running / done
}

type fioMonitor struct {
	taskID   string
	hosts    []executor.HostConfig
	cancel   context.CancelFunc
	stopOnce sync.Once
}

var (
	fioMonitors   = make(map[string]*fioMonitor)
	fioMonitorsMu sync.Mutex
)

// MonitorFioTask 启动 FIO 实时监控，通过 Wails 事件推送状态
func (a *App) MonitorFioTask(taskID string, hosts []executor.HostConfig) {
	fioMonitorsMu.Lock()
	// 停止之前的监控
	if old, ok := fioMonitors[taskID]; ok {
		old.cancel()
	}
	ctx, cancel := context.WithCancel(a.ctx)
	mon := &fioMonitor{taskID: taskID, hosts: hosts, cancel: cancel}
	fioMonitors[taskID] = mon
	fioMonitorsMu.Unlock()

	go func() {
		defer cancel()
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				allDone := true
				for _, host := range hosts {
					statuses := fetchFioStatus(taskID, host)
					for _, st := range statuses {
						eventName := fmt.Sprintf("fio:status:%s", taskID)
						runtime.EventsEmit(a.ctx, eventName, st)
						if st.JobStatus == "running" || st.JobStatus == "" {
							allDone = false
						}
					}
					if len(statuses) == 0 {
						allDone = false
					}
				}
				if allDone {
					// 所有主机所有 job 都已完成
					eventName := fmt.Sprintf("fio:status:%s", taskID)
					runtime.EventsEmit(a.ctx, eventName, map[string]string{"event": "done"})
					return
				}
			}
		}
	}()
}

// StopFioMonitor 停止 FIO 监控
func (a *App) StopFioMonitor(taskID string) {
	fioMonitorsMu.Lock()
	defer fioMonitorsMu.Unlock()
	if mon, ok := fioMonitors[taskID]; ok {
		mon.stopOnce.Do(func() { mon.cancel() })
		delete(fioMonitors, taskID)
	}
}

// fetchFioStatus 从远程主机获取 FIO 状态行并解析
func fetchFioStatus(taskID string, host executor.HostConfig) []FioStatus {
	client, err := executor.NewSSHClient(host)
	if err != nil {
		return nil
	}
	defer client.Close()

	_, dataDir, logsDir, pidFile := executor.BuildTaskPaths(taskID)

	// 检查进程是否仍在运行
	pidCheck := fmt.Sprintf(`if [ -f %[1]s ]; then pid="$(cat %[1]s)"; if ps -p "$pid" >/dev/null 2>&1; then echo "running"; else echo "stopped"; fi; else echo "stopped"; fi`, pidFile)
	out, _ := client.RunCommand(pidCheck)
	if strings.TrimSpace(out) != "running" {
		return nil
	}

	// 读取 fio_stdout.log 的最后 50 行，找最新状态行
	cmd := fmt.Sprintf("tail -50 %s/fio_stdout.log 2>/dev/null || true", logsDir)
	stdout, err := client.RunCommand(cmd)
	if err != nil || strings.TrimSpace(stdout) == "" {
		return nil
	}

	// 同时尝试读取 JSON 输出获取 job 名称
	jsonFilesCmd := fmt.Sprintf("ls %s/*.json 2>/dev/null || true", dataDir)
	jsonFiles, _ := client.RunCommand(jsonFilesCmd)

	var statuses []FioStatus
	lines := strings.Split(stdout, "\n")

	// 从后往前找最新的状态行（以 "Jobs:" 开头或包含 job 信息的行）
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		st := parseFioStatusLine(line)
		if st != nil {
			st.Host = fmt.Sprintf("%s@%s", host.User, host.Host)
			// 尝试从 JSON 文件名推断 job 名称
			if jsonFiles != "" {
				for _, jf := range strings.Split(jsonFiles, "\n") {
					jf = strings.TrimSpace(jf)
					if jf != "" {
						base := jf
						if idx := strings.LastIndex(jf, "/"); idx >= 0 {
							base = jf[idx+1:]
						}
						base = strings.TrimSuffix(base, ".json")
						if base != "" {
							st.JobName = base
							break
						}
					}
				}
			}
			statuses = append(statuses, *st)
			break // 只取最新的一条
		}
	}

	return statuses
}

// parseFioStatusLine 解析 FIO 状态输出行
// 格式: Jobs: 1 (f=1): [read][100.0%][r=123MiB/s][r=31.5k][io=123MiB,bs=4096-4096,io_eng=psync,dbench=1]
func parseFioStatusLine(line string) *FioStatus {
	if !strings.Contains(line, "Jobs:") && !strings.Contains(line, "f=") {
		return nil
	}

	st := &FioStatus{JobStatus: "running"}

	// 解析百分比 → 判断是否完成
	if idx := strings.Index(line, "]["); idx > 0 {
		pctStr := line[idx-6 : idx] // e.g. "100.0%"
		pctStr = strings.TrimPrefix(pctStr, "[")
		pctStr = strings.TrimSuffix(pctStr, "%")
		if pct, err := strconv.ParseFloat(pctStr, 64); err == nil {
			if pct >= 100.0 {
				st.JobStatus = "done"
			}
		}
	}

	// 解析读写速度 r=123MiB/s w=456KiB/s
	for _, part := range strings.Split(line, "][") {
		part = strings.Trim(part, "[]")
		if strings.HasPrefix(part, "r=") {
			val := strings.TrimPrefix(part, "r=")
			st.ReadBW = parseBWSpeed(val)
		} else if strings.HasPrefix(part, "w=") {
			val := strings.TrimPrefix(part, "w=")
			st.WriteBW = parseBWSpeed(val)
		}
	}

	// 解析 IOPS: r=31.5k w=12.3k
	for _, part := range strings.Split(line, "][") {
		part = strings.Trim(part, "[]")
		if strings.HasPrefix(part, "r=") && !strings.Contains(part, "MiB") && !strings.Contains(part, "KiB") && !strings.Contains(part, "GiB") && !strings.Contains(part, "B/s") {
			val := strings.TrimPrefix(part, "r=")
			st.ReadIOPS = parseIOPS(val)
		} else if strings.HasPrefix(part, "w=") && !strings.Contains(part, "MiB") && !strings.Contains(part, "KiB") && !strings.Contains(part, "GiB") && !strings.Contains(part, "B/s") {
			val := strings.TrimPrefix(part, "w=")
			st.WriteIOPS = parseIOPS(val)
		}
	}

	// 解析延迟:  lat (msec)=1.23/5.67/10.0
	for _, part := range strings.Split(line, ",") {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, "io_eng=") || strings.HasPrefix(part, "bs=") || strings.HasPrefix(part, "dbench=") {
			continue
		}
	}

	return st
}

// parseBWSpeed 解析带宽字符串如 "123MiB/s", "456KiB/s", "1.2GiB/s"
func parseBWSpeed(s string) float64 {
	s = strings.TrimSpace(s)
	multiplier := 1.0
	if strings.HasSuffix(s, "GiB/s") {
		multiplier = 1024 * 1024
		s = strings.TrimSuffix(s, "GiB/s")
	} else if strings.HasSuffix(s, "MiB/s") {
		multiplier = 1024
		s = strings.TrimSuffix(s, "MiB/s")
	} else if strings.HasSuffix(s, "KiB/s") {
		multiplier = 1
		s = strings.TrimSuffix(s, "KiB/s")
	} else if strings.HasSuffix(s, "B/s") {
		multiplier = 0.001
		s = strings.TrimSuffix(s, "B/s")
	}
	val, _ := strconv.ParseFloat(s, 64)
	return val * multiplier
}

// parseIOPS 解析 IOPS 字符串如 "31.5k", "1234", "1.2M"
func parseIOPS(s string) float64 {
	s = strings.TrimSpace(s)
	multiplier := 1.0
	if strings.HasSuffix(s, "M") {
		multiplier = 1000000
		s = strings.TrimSuffix(s, "M")
	} else if strings.HasSuffix(s, "k") {
		multiplier = 1000
		s = strings.TrimSuffix(s, "k")
	}
	val, _ := strconv.ParseFloat(s, 64)
	return val * multiplier
}
