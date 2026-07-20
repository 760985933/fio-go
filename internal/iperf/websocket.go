package iperf

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type StreamSession interface {
	ReadLine() (string, error)
	Stop() error
	Close()
	Host() string
}

type RealtimeManager struct {
	sessions map[string]StreamSession
	clients  map[string][]chan IperfInterval
	mu       sync.RWMutex
	running  map[string]bool
	ctx      context.Context
}

func NewRealtimeManager() *RealtimeManager {
	return &RealtimeManager{
		sessions: make(map[string]StreamSession),
		clients:  make(map[string][]chan IperfInterval),
		running:  make(map[string]bool),
	}
}

// SetContext 设置 Wails 运行时上下文，用于把实时区间数据推送到前端监控页。
func (m *RealtimeManager) SetContext(ctx context.Context) {
	m.mu.Lock()
	m.ctx = ctx
	m.mu.Unlock()
}

// IntervalDataFile 返回某任务实时区间数据的落盘路径（JSONL，每行一个 IperfInterval）。
// 既用于任务结束后回放查看，也作为实时监控的数据来源。
func IntervalDataFile(taskID string) string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".nettopo_test", "output", "iperf-tasks", taskID, "intervals.jsonl")
}

func SessionKey(taskId string, idx int) string {
	return fmt.Sprintf("%s:%d", taskId, idx)
}

func (m *RealtimeManager) Subscribe(taskId string) chan IperfInterval {
	m.mu.Lock()
	defer m.mu.Unlock()

	ch := make(chan IperfInterval, 100)
	m.clients[taskId] = append(m.clients[taskId], ch)
	return ch
}

func (m *RealtimeManager) Unsubscribe(taskId string, ch chan IperfInterval) {
	m.mu.Lock()
	defer m.mu.Unlock()

	clients := m.clients[taskId]
	for i, c := range clients {
		if c == ch {
			close(ch)
			m.clients[taskId] = append(clients[:i], clients[i+1:]...)
			break
		}
	}
}

func (m *RealtimeManager) StartStream(taskId string, session StreamSession) {
	m.StartStreamAt(taskId, 0, session)
}

func (m *RealtimeManager) StartStreamAt(taskId string, idx int, session StreamSession) {
	m.startStreamWithKey(SessionKey(taskId, idx), taskId, session)
}

func (m *RealtimeManager) startStreamWithKey(key, taskId string, session StreamSession) {
	m.mu.Lock()
	m.sessions[key] = session
	m.running[taskId] = true
	m.mu.Unlock()

	go func() {
		defer func() {
			m.mu.Lock()
			delete(m.sessions, key)
			remaining := false
			for k := range m.sessions {
				if k == taskId || strings.HasPrefix(k, taskId+":") {
					remaining = true
					break
				}
			}
			if !remaining {
				m.running[taskId] = false
			}
			m.mu.Unlock()
		}()

		for {
			m.mu.RLock()
			running := m.running[taskId]
			m.mu.RUnlock()
			if !running {
				break
			}

			line, err := session.ReadLine()
			if err != nil {
				if err.Error() == "EOF" {
					log.Printf("iperf stream %s (%s): EOF reached", taskId, session.Host())
				} else {
					log.Printf("iperf stream %s (%s) read error: %v", taskId, session.Host(), err)
				}
				break
			}

			intervals, err := ParseIntervalLine(line)
			if err != nil || len(intervals) == 0 {
				continue
			}

			m.emitAndPersist(taskId, intervals)

			m.mu.RLock()
			clients := make([]chan IperfInterval, len(m.clients[taskId]))
			copy(clients, m.clients[taskId])
			m.mu.RUnlock()

			for _, interval := range intervals {
				for _, ch := range clients {
					select {
					case ch <- interval:
					default:
						select {
						case <-ch:
							ch <- interval
						default:
						}
					}
				}
			}
		}
	}()
}

func (m *RealtimeManager) StopStream(taskId string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	for key, session := range m.sessions {
		if key == taskId || strings.HasPrefix(key, taskId+":") {
			session.Stop()
			delete(m.sessions, key)
		}
	}
	m.running[taskId] = false
}

func (m *RealtimeManager) IsRunning(taskId string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.running[taskId]
}

func (m *RealtimeManager) GetClientCount(taskId string) int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.clients[taskId])
}

// emitAndPersist 将解析出的区间数据：
//  1. 通过 Wails 事件推送给前端实时监控页（事件名 iperf:interval:<taskID>）；
//  2. 追加写入本地 JSONL 文件，供任务结束后回放查看。
func (m *RealtimeManager) emitAndPersist(taskId string, intervals []IperfInterval) {
	if len(intervals) == 0 {
		return
	}

	// 1) 推送前端事件
	m.mu.RLock()
	ctx := m.ctx
	m.mu.RUnlock()
	if ctx != nil {
		for _, iv := range intervals {
			runtime.EventsEmit(ctx, "iperf:interval:"+taskId, iv)
		}
	}

	// 2) 落盘持久化
	path := IntervalDataFile(taskId)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err == nil {
		if f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644); err == nil {
			for _, iv := range intervals {
				if data, err := json.Marshal(iv); err == nil {
					if _, err := f.Write(append(data, '\n')); err != nil {
						log.Printf("写入区间数据失败: %v", err)
					}
				}
			}
			f.Close()
		}
	}
}
