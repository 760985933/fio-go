package executor

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

const baseFioDir = "/tmp/fio"

type ExecutionResult struct {
	Host  string
	Error error
	Msg   string
}

var taskKeySanitizer = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

func sanitizeTaskKey(taskKey string) string {
	trimmed := strings.TrimSpace(taskKey)
	if trimmed == "" {
		return "default-task"
	}
	sanitized := taskKeySanitizer.ReplaceAllString(trimmed, "-")
	sanitized = strings.Trim(sanitized, "-.")
	if sanitized == "" {
		return "default-task"
	}
	return sanitized
}

func BuildTaskPaths(taskKey string) (string, string, string, string) {
	safeTaskKey := sanitizeTaskKey(taskKey)
	taskDir := filepath.Join(baseFioDir, "tasks", safeTaskKey)
	dataDir := filepath.Join(taskDir, "data")
	logsDir := filepath.Join(dataDir, "logs")
	pidFile := filepath.Join(taskDir, "fio.pid")
	return taskDir, dataDir, logsDir, pidFile
}

func displayHost(cfg HostConfig) string {
	normalized := normalizeHostConfig(cfg)
	return fmt.Sprintf("%s@%s:%d", normalized.User, normalized.Host, normalized.Port)
}

func sanitizeLocalName(value string) string {
	safeValue := taskKeySanitizer.ReplaceAllString(strings.TrimSpace(value), "_")
	safeValue = strings.Trim(safeValue, "_.")
	if safeValue == "" {
		return "default"
	}
	return safeValue
}

func downloadRemoteDir(client *SSHClient, remoteDir string, localDir string) (int, error) {
	if err := os.MkdirAll(localDir, 0755); err != nil {
		return 0, err
	}

	entries, err := client.SFTP.ReadDir(remoteDir)
	if err != nil {
		return 0, err
	}

	downloadCount := 0
	for _, entry := range entries {
		remotePath := filepath.Join(remoteDir, entry.Name())
		localPath := filepath.Join(localDir, entry.Name())

		if entry.IsDir() {
			nestedCount, nestedErr := downloadRemoteDir(client, remotePath, localPath)
			if nestedErr != nil {
				continue
			}
			downloadCount += nestedCount
			continue
		}

		remoteFile, openErr := client.SFTP.Open(remotePath)
		if openErr != nil {
			continue
		}

		localFile, createErr := os.Create(localPath)
		if createErr != nil {
			remoteFile.Close()
			continue
		}

		_, copyErr := io.Copy(localFile, remoteFile)
		localFile.Close()
		remoteFile.Close()

		if copyErr == nil {
			downloadCount++
		}
	}

	return downloadCount, nil
}

// DeployAndRun deploys the FIO script to the given hosts and starts it
func DeployAndRun(taskKey string, hosts []HostConfig, scriptName string, scriptContent []byte) []ExecutionResult {
	var wg sync.WaitGroup
	results := make([]ExecutionResult, len(hosts))

	for i, host := range hosts {
		wg.Add(1)
		go func(idx int, hostCfg HostConfig) {
			defer wg.Done()
			res := ExecutionResult{Host: displayHost(hostCfg)}

			client, err := NewSSHClient(hostCfg)
			if err != nil {
				res.Error = err
				results[idx] = res
				return
			}
			defer client.Close()

			taskDir, dataDir, logsDir, pidFile := BuildTaskPaths(taskKey)

			// 1. Create directories
			_, err = client.RunCommand(fmt.Sprintf("mkdir -p %s %s %s", taskDir, dataDir, logsDir))
			if err != nil {
				res.Error = fmt.Errorf("failed to create dirs: %v", err)
				results[idx] = res
				return
			}

			// 2. Upload script
			remoteScriptPath := filepath.Join(taskDir, scriptName)
			f, err := client.SFTP.Create(remoteScriptPath)
			if err != nil {
				res.Error = fmt.Errorf("failed to create remote script file: %v", err)
				results[idx] = res
				return
			}
			_, err = f.Write(scriptContent)
			f.Close()
			if err != nil {
				res.Error = fmt.Errorf("failed to write script content: %v", err)
				results[idx] = res
				return
			}

			// 3. Create system.txt (mimicking fio.sh)
			sysInfoCmd := fmt.Sprintf("uname -a > %s/system.txt && lscpu >> %s/system.txt", dataDir, dataDir)
			client.RunCommand(sysInfoCmd)

			// 4. Run FIO asynchronously
			jsonOut := filepath.Join(dataDir, fmt.Sprintf("%s.json", scriptName))
			fioCmd := fmt.Sprintf(
				"cd %s && nohup fio %s --output-format=json+ --output=%s > %s/fio_stdout.log 2>&1 & echo $! > %s",
				taskDir,
				remoteScriptPath,
				jsonOut,
				logsDir,
				pidFile,
			)
			_, err = client.RunCommand(fioCmd)
			if err != nil {
				res.Error = fmt.Errorf("failed to start fio: %v", err)
				results[idx] = res
				return
			}

			res.Msg = "Deployed and started successfully"
			results[idx] = res
		}(i, host)
	}

	wg.Wait()
	return results
}

// CheckStatus checks if FIO is still running on the hosts
func CheckStatus(taskKey string, hosts []HostConfig) []ExecutionResult {
	var wg sync.WaitGroup
	results := make([]ExecutionResult, len(hosts))

	for i, host := range hosts {
		wg.Add(1)
		go func(idx int, hostCfg HostConfig) {
			defer wg.Done()
			res := ExecutionResult{Host: displayHost(hostCfg)}

			client, err := NewSSHClient(hostCfg)
			if err != nil {
				res.Error = err
				results[idx] = res
				return
			}
			defer client.Close()

			_, _, _, pidFile := BuildTaskPaths(taskKey)
			cmd := fmt.Sprintf(`if [ -f %[1]s ]; then pid="$(cat %[1]s)"; if ps -p "$pid" >/dev/null 2>&1; then echo "Running (PID: $pid)"; else echo "Not running (Stale PID: $pid)"; fi; else echo "Not running"; fi`, pidFile)
			out, _ := client.RunCommand(cmd)
			res.Msg = strings.TrimSpace(out)
			if res.Msg == "" {
				res.Msg = "Not running"
			}
			results[idx] = res
		}(i, host)
	}

	wg.Wait()
	return results
}

// KillAll kills FIO processes on the hosts
func KillAll(taskKey string, hosts []HostConfig) []ExecutionResult {
	var wg sync.WaitGroup
	results := make([]ExecutionResult, len(hosts))

	for i, host := range hosts {
		wg.Add(1)
		go func(idx int, hostCfg HostConfig) {
			defer wg.Done()
			res := ExecutionResult{Host: displayHost(hostCfg)}

			client, err := NewSSHClient(hostCfg)
			if err != nil {
				res.Error = err
				results[idx] = res
				return
			}
			defer client.Close()

			_, _, _, pidFile := BuildTaskPaths(taskKey)
			cmd := fmt.Sprintf(`if [ -f %[1]s ]; then pid="$(cat %[1]s)"; if kill -0 "$pid" 2>/dev/null; then kill "$pid" && rm -f %[1]s && echo "Killed successfully"; else rm -f %[1]s && echo "Not running"; fi; else echo "Not running"; fi`, pidFile)
			out, _ := client.RunCommand(cmd)
			res.Msg = strings.TrimSpace(out)
			if res.Msg == "" {
				res.Msg = "Not running"
			}
			results[idx] = res
		}(i, host)
	}

	wg.Wait()
	return results
}

// CheckResidualData checks if the task directory exists on remote hosts
func CheckResidualData(taskKey string, hosts []HostConfig) []ExecutionResult {
	var wg sync.WaitGroup
	results := make([]ExecutionResult, len(hosts))

	for i, host := range hosts {
		wg.Add(1)
		go func(idx int, hostCfg HostConfig) {
			defer wg.Done()
			res := ExecutionResult{Host: displayHost(hostCfg)}

			client, err := NewSSHClient(hostCfg)
			if err != nil {
				res.Error = err
				results[idx] = res
				return
			}
			defer client.Close()

			taskDir, _, _, _ := BuildTaskPaths(taskKey)
			cmd := fmt.Sprintf("if [ -d %s ]; then echo 'Exists'; else echo 'Not exists'; fi", taskDir)
			out, _ := client.RunCommand(cmd)
			res.Msg = strings.TrimSpace(out)
			results[idx] = res
		}(i, host)
	}

	wg.Wait()
	return results
}

// CleanRemote cleans up the task directory on remote hosts
func CleanRemote(taskKey string, hosts []HostConfig) []ExecutionResult {
	var wg sync.WaitGroup
	results := make([]ExecutionResult, len(hosts))

	for i, host := range hosts {
		wg.Add(1)
		go func(idx int, hostCfg HostConfig) {
			defer wg.Done()
			res := ExecutionResult{Host: displayHost(hostCfg)}

			client, err := NewSSHClient(hostCfg)
			if err != nil {
				res.Error = err
				results[idx] = res
				return
			}
			defer client.Close()

			taskDir, _, _, _ := BuildTaskPaths(taskKey)
			cmd := fmt.Sprintf("rm -rf %s && echo 'Remote task directory cleaned'", taskDir)
			out, _ := client.RunCommand(cmd)
			res.Msg = strings.TrimSpace(out)
			results[idx] = res
		}(i, host)
	}

	wg.Wait()
	return results
}

// PullData downloads the data from remote hosts to a local directory
func PullData(taskKey string, hosts []HostConfig, localBaseDir string) []ExecutionResult {
	var wg sync.WaitGroup
	results := make([]ExecutionResult, len(hosts))

	for i, host := range hosts {
		wg.Add(1)
		go func(idx int, hostCfg HostConfig) {
			defer wg.Done()
			res := ExecutionResult{Host: displayHost(hostCfg)}

			client, err := NewSSHClient(hostCfg)
			if err != nil {
				res.Error = err
				results[idx] = res
				return
			}
			defer client.Close()

			_, dataDir, _, _ := BuildTaskPaths(taskKey)

			hostDir := filepath.Join(localBaseDir, sanitizeLocalName(res.Host))
			if mkErr := os.MkdirAll(hostDir, 0755); mkErr != nil {
				res.Error = fmt.Errorf("failed to create local dir: %v", mkErr)
				results[idx] = res
				return
			}

			downloadCount, err := downloadRemoteDir(client, dataDir, hostDir)
			if err != nil {
				res.Error = fmt.Errorf("failed to read remote data dir: %v", err)
				results[idx] = res
				return
			}

			res.Msg = fmt.Sprintf("Downloaded %d files", downloadCount)
			results[idx] = res
		}(i, host)
	}

	wg.Wait()
	return results
}
