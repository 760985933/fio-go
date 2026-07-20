package iperf

import (
	"fmt"
	"log"
	"strings"
	"sync"
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
}

func NewRealtimeManager() *RealtimeManager {
	return &RealtimeManager{
		sessions: make(map[string]StreamSession),
		clients:  make(map[string][]chan IperfInterval),
		running:  make(map[string]bool),
	}
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
