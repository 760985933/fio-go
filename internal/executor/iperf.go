package executor

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

const baseIperfDir = "/tmp/iperf"

var iperfTaskKeySanitizer = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

func sanitizeIperfTaskKey(taskKey string) string {
	trimmed := strings.TrimSpace(taskKey)
	if trimmed == "" {
		return "default-iperf-task"
	}
	sanitized := iperfTaskKeySanitizer.ReplaceAllString(trimmed, "-")
	sanitized = strings.Trim(sanitized, "-.")
	if sanitized == "" {
		return "default-iperf-task"
	}
	return sanitized
}

func BuildIperfPaths(taskKey string) (string, string, string) {
	safeKey := sanitizeIperfTaskKey(taskKey)
	taskDir := filepath.Join(baseIperfDir, "tasks", safeKey)
	dataDir := filepath.Join(taskDir, "data")
	pidFile := filepath.Join(taskDir, "iperf.pid")
	return taskDir, dataDir, pidFile
}

func displayIperfHost(cfg HostConfig) string {
	normalized := normalizeHostConfig(cfg)
	return fmt.Sprintf("%s@%s:%d", normalized.User, normalized.Host, normalized.Port)
}

type IperfSession struct {
	client  *SSHClient
	session *ssh.Session
	stdout  io.Reader
	pid     string
	taskDir string
	host    string
}

func (s *IperfSession) ReadLine() (string, error) {
	scanner := bufio.NewScanner(s.stdout)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
	if scanner.Scan() {
		return scanner.Text(), nil
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	return "", io.EOF
}

func (s *IperfSession) Stop() error {
	if s.client == nil {
		return nil
	}
	if s.pid != "" {
		cmd := fmt.Sprintf("kill %s 2>/dev/null; rm -f %s/iperf.pid", s.pid, s.taskDir)
		s.client.RunCommand(cmd)
	}
	if s.session != nil {
		s.session.Close()
	}
	return nil
}

func (s *IperfSession) Close() {
	if s.session != nil {
		s.session.Close()
	}
	if s.client != nil {
		s.client.Close()
	}
}

func (s *IperfSession) Host() string {
	return s.host
}

func StartIperfServer(hostCfg HostConfig, port int, bindIP string) ExecutionResult {
	normalized := normalizeHostConfig(hostCfg)
	res := ExecutionResult{Host: displayIperfHost(hostCfg)}

	client, err := NewSSHClient(normalized)
	if err != nil {
		res.Error = err.Error()
		return res
	}
	defer client.Close()

	stopCmd := fmt.Sprintf("pkill -f '[i]perf3 -s -p %d' 2>/dev/null; sleep 0.5", port)
	client.RunCommand(stopCmd)

	bindFlag := ""
	if bindIP != "" {
		bindFlag = fmt.Sprintf(" -B %s", bindIP)
	}
	cmd := fmt.Sprintf("nohup iperf3 -s -p %d%s > /tmp/iperf_server_%d.log 2>&1 & echo $!", port, bindFlag, port)
	out, err := client.RunCommand(cmd)
	if err != nil {
		res.Error = fmt.Sprintf("failed to start iperf3 server: %v", err)
		return res
	}
	pid := strings.TrimSpace(out)
	if pid == "" {
		res.Error = fmt.Sprintf("iperf3 server may not have started")
		return res
	}

	time.Sleep(500 * time.Millisecond)
	checkCmd := fmt.Sprintf("ps -p %s >/dev/null 2>&1 && echo Running || echo NotRunning", pid)
	checkOut, _ := client.RunCommand(checkCmd)
	if strings.TrimSpace(checkOut) != "Running" {
		res.Error = fmt.Sprintf("iperf3 server process not running after start")
		return res
	}

	res.Msg = fmt.Sprintf("iperf3 server started on port %d (PID: %s)", port, pid)
	return res
}

func StopIperfServer(hostCfg HostConfig, port int) ExecutionResult {
	normalized := normalizeHostConfig(hostCfg)
	res := ExecutionResult{Host: displayIperfHost(hostCfg)}

	client, err := NewSSHClient(normalized)
	if err != nil {
		res.Error = err.Error()
		return res
	}
	defer client.Close()

	cmd := fmt.Sprintf("pkill -f '[i]perf3 -s -p %d' 2>/dev/null && echo Stopped || echo NotRunning", port)
	out, err := client.RunCommand(cmd)
	if err != nil {
		res.Error = err.Error()
		return res
	}
	res.Msg = strings.TrimSpace(out)
	return res
}

func RunIperfClient(hostCfg HostConfig, taskKey string, args []string) (*IperfSession, error) {
	normalized := normalizeHostConfig(hostCfg)
	client, err := NewSSHClient(normalized)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to %s: %v", displayIperfHost(hostCfg), err)
	}

	taskDir, dataDir, _ := BuildIperfPaths(taskKey)
	_, err = client.RunCommand(fmt.Sprintf("mkdir -p %s %s", taskDir, dataDir))
	if err != nil {
		client.Close()
		return nil, fmt.Errorf("failed to create dirs: %v", err)
	}

	argsStr := strings.Join(args, " ")
	logFile := filepath.Join(dataDir, "iperf_stdout.log")
	cmd := fmt.Sprintf(
		"cd %s && %s 2>&1 | tee %s",
		taskDir, argsStr, logFile,
	)

	session, err := client.Client.NewSession()
	if err != nil {
		client.Close()
		return nil, fmt.Errorf("failed to create SSH session: %v", err)
	}

	stdout, err := session.StdoutPipe()
	if err != nil {
		session.Close()
		client.Close()
		return nil, fmt.Errorf("failed to get stdout pipe: %v", err)
	}

	if err := session.Start(cmd); err != nil {
		session.Close()
		client.Close()
		return nil, fmt.Errorf("failed to start iperf3 client: %v", err)
	}

	return &IperfSession{
		client:  client,
		session: session,
		stdout:  stdout,
		pid:     "",
		taskDir: taskDir,
		host:    displayIperfHost(hostCfg),
	}, nil
}

func CheckIperfInstalled(hosts []HostConfig) []ExecutionResult {
	var wg sync.WaitGroup
	results := make([]ExecutionResult, len(hosts))

	for i, host := range hosts {
		wg.Add(1)
		go func(idx int, hostCfg HostConfig) {
			defer wg.Done()
			res := ExecutionResult{Host: displayIperfHost(hostCfg)}

			client, err := NewSSHClient(hostCfg)
			if err != nil {
				res.Error = err.Error()
				results[idx] = res
				return
			}
			defer client.Close()

			out, err := client.RunCommand("iperf3 --version 2>/dev/null || echo MISSING")
			if err != nil {
				res.Error = err.Error()
				results[idx] = res
				return
			}
			res.Msg = strings.TrimSpace(out)
			// `|| echo MISSING` 会保证命令退出码为 0，因此必须通过输出判断是否真正安装
			if strings.Contains(strings.ToLower(res.Msg), "missing") {
				res.Error = "iperf3 未安装（命令不存在）"
			}
			results[idx] = res
		}(i, host)
	}

	wg.Wait()
	return results
}

func CheckIperfServerRunning(hostCfg HostConfig, port int) ExecutionResult {
	normalized := normalizeHostConfig(hostCfg)
	res := ExecutionResult{Host: displayIperfHost(hostCfg)}

	client, err := NewSSHClient(normalized)
	if err != nil {
		res.Error = err.Error()
		return res
	}
	defer client.Close()

	cmd := fmt.Sprintf("pgrep -f '[i]perf3 -s -p %d' >/dev/null 2>&1 && echo Running || echo NotRunning", port)
	out, _ := client.RunCommand(cmd)
	res.Msg = strings.TrimSpace(out)
	res.Running = res.Msg == "Running"
	return res
}

func KillIperfClient(taskKey string, hosts []HostConfig) []ExecutionResult {
	var wg sync.WaitGroup
	results := make([]ExecutionResult, len(hosts))

	for i, host := range hosts {
		wg.Add(1)
		go func(idx int, hostCfg HostConfig) {
			defer wg.Done()
			res := ExecutionResult{Host: displayIperfHost(hostCfg)}

			client, err := NewSSHClient(hostCfg)
			if err != nil {
				res.Error = err.Error()
				results[idx] = res
				return
			}
			defer client.Close()

			_, _, pidFile := BuildIperfPaths(taskKey)
			cmd := fmt.Sprintf(`if [ -f %[1]s ]; then pid="$(cat %[1]s)"; if kill -0 "$pid" 2>/dev/null; then kill "$pid" && rm -f %[1]s && echo "Killed successfully"; else rm -f %[1]s && echo "Not running"; fi; else echo "Not running"; fi`, pidFile)
			out, _ := client.RunCommand(cmd)
			res.Msg = strings.TrimSpace(out)
			results[idx] = res
		}(i, host)
	}

	wg.Wait()
	return results
}

func PullIperfData(taskKey string, hosts []HostConfig, localBaseDir string) []ExecutionResult {
	var wg sync.WaitGroup
	results := make([]ExecutionResult, len(hosts))

	for i, host := range hosts {
		wg.Add(1)
		go func(idx int, hostCfg HostConfig) {
			defer wg.Done()
			res := ExecutionResult{Host: displayIperfHost(hostCfg)}

			client, err := NewSSHClient(hostCfg)
			if err != nil {
				res.Error = err.Error()
				results[idx] = res
				return
			}
			defer client.Close()

			_, dataDir, _ := BuildIperfPaths(taskKey)
			hostDir := filepath.Join(localBaseDir, sanitizeLocalName(res.Host))
			dataLocal := filepath.Join(hostDir, "data")
			if mkErr := os.MkdirAll(dataLocal, 0755); mkErr != nil {
				res.Error = fmt.Sprintf("failed to create local dir: %v", mkErr)
				results[idx] = res
				return
			}

			dataCount, dataErr := downloadRemoteDir(client, dataDir, dataLocal)
			if dataErr != nil {
				res.Error = fmt.Sprintf("failed to read remote data dir: %v", dataErr)
				results[idx] = res
				return
			}

			res.Msg = fmt.Sprintf("Downloaded %d files", dataCount)
			results[idx] = res
		}(i, host)
	}

	wg.Wait()
	return results
}

func CheckIperfStatus(taskKey string, hosts []HostConfig) []ExecutionResult {
	var wg sync.WaitGroup
	results := make([]ExecutionResult, len(hosts))

	for i, host := range hosts {
		wg.Add(1)
		go func(idx int, hostCfg HostConfig) {
			defer wg.Done()
			res := ExecutionResult{Host: displayIperfHost(hostCfg)}

			client, err := NewSSHClient(hostCfg)
			if err != nil {
				res.Error = err.Error()
				results[idx] = res
				return
			}
			defer client.Close()

			_, _, pidFile := BuildIperfPaths(taskKey)
			cmd := fmt.Sprintf(`if [ -f %[1]s ]; then pid="$(cat %[1]s)"; if ps -p "$pid" >/dev/null 2>&1; then echo "Running (PID: $pid)"; else echo "Not running (Stale PID: $pid)"; fi; else echo "Not running"; fi`, pidFile)
			out, _ := client.RunCommand(cmd)
			res.Msg = strings.TrimSpace(out)
			if res.Msg == "" {
				res.Msg = "Not running"
			}
			res.Running = strings.HasPrefix(res.Msg, "Running")
			results[idx] = res
		}(i, host)
	}

	wg.Wait()
	return results
}

func CleanIperfRemote(taskKey string, hosts []HostConfig) []ExecutionResult {
	var wg sync.WaitGroup
	results := make([]ExecutionResult, len(hosts))

	for i, host := range hosts {
		wg.Add(1)
		go func(idx int, hostCfg HostConfig) {
			defer wg.Done()
			res := ExecutionResult{Host: displayIperfHost(hostCfg)}

			client, err := NewSSHClient(hostCfg)
			if err != nil {
				res.Error = err.Error()
				results[idx] = res
				return
			}
			defer client.Close()

			taskDir, _, _ := BuildIperfPaths(taskKey)
			cmd := fmt.Sprintf("rm -rf %s && echo 'Remote task directory cleaned'", taskDir)
			out, _ := client.RunCommand(cmd)
			res.Msg = strings.TrimSpace(out)
			results[idx] = res
		}(i, host)
	}

	wg.Wait()
	return results
}
