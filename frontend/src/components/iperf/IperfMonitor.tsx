import { useState, useEffect, useRef, useCallback } from 'react'
import { IperfTask, IperfInterval } from '../../types'
import * as App from '../../wailsjs/go/app/App'
import { BandwidthChart } from './charts/BandwidthChart'
import { JitterChart } from './charts/JitterChart'
import { RetransmitChart } from './charts/RetransmitChart'
import { DashboardPanel } from './charts/DashboardPanel'
import { CPUMemoryChart } from './charts/CPUMemoryChart'

interface Props {
  onShowResults: (title: string, content: string, wide?: boolean) => Promise<void>
}

export function IperfMonitor({ onShowResults }: Props) {
  const [tasks, setTasks] = useState<IperfTask[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string>('')
  const [isMonitoring, setIsMonitoring] = useState(false)
  const [intervals, setIntervals] = useState<IperfInterval[]>([])
  const [currentTime, setCurrentTime] = useState(0)
  const pollRef = useRef<number | null>(null)
  const startTimeRef = useRef<number>(0)

  useEffect(() => { loadTasks() }, [])
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const loadTasks = async () => {
    try {
      const list = await App.GetIperfTasks()
      setTasks(list || [])
    } catch { /* ignore */ }
  }

  const startMonitor = useCallback(async (taskId: string) => {
    setSelectedTaskId(taskId)
    setIntervals([])
    setIsMonitoring(true)
    startTimeRef.current = Date.now()

    pollRef.current = window.setInterval(async () => {
      try {
        const running = await App.IsIperfMonitorRunning(taskId)
        if (!running) {
          stopMonitor()
          return
        }
        setCurrentTime((Date.now() - startTimeRef.current) / 1000)
      } catch { /* ignore */ }
    }, 1000)
  }, [])

  const stopMonitor = useCallback(async () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    setIsMonitoring(false)
  }, [])

  const simulateData = () => {
    const now = intervals.length * 1
    const newIntervals: IperfInterval[] = []
    for (let i = 0; i < 5; i++) {
      const t = now + i
      newIntervals.push({
        timestamp: t,
        streamID: 0,
        duration: 1,
        bytes: (800 + Math.random() * 200) * 1e6,
        bitsPerSecond: (800 + Math.random() * 200) * 1e6,
        jitterMs: Math.random() * 2,
        lostPackets: Math.random() > 0.95 ? Math.floor(Math.random() * 10) : 0,
        totalPackets: 1000 + Math.floor(Math.random() * 100),
        retransmits: Math.random() > 0.9 ? Math.floor(Math.random() * 5) : 0,
        cpuUser: 10 + Math.random() * 30,
        cpuSys: 5 + Math.random() * 15,
      })
    }
    setIntervals(prev => [...prev, ...newIntervals])
    setCurrentTime(t => t + 5)
  }

  const selectedTask = tasks.find(t => t.id === selectedTaskId)

  return (
    <div>
      <div className="manager-header">
        <h2>实时监控</h2>
        {isMonitoring && selectedTask && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#22c55e' }}>● 监控中</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{currentTime.toFixed(0)}s</span>
            <button className="btn btn-danger btn-sm" onClick={stopMonitor}>停止</button>
          </div>
        )}
      </div>

      <div style={{ background: '#fef3cd', border: '1px solid #ffc107', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#856404', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600 }}>⚠ 实时监控需要 iperf3 ≥ 3.7 版本</span>
        <span>（需支持 <code style={{ background: '#fff3cd', padding: '1px 4px', borderRadius: 3 }}>--json-stream</code> 参数）</span>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>选择任务</h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {tasks.filter(t => t.status === 'running' || t.status === 'completed').map(task => (
            <button key={task.id}
              className={`btn ${selectedTaskId === task.id ? 'btn-primary' : 'btn-outline'} btn-sm`}
              onClick={() => startMonitor(task.id)}>
              {task.name}
            </button>
          ))}
          {tasks.filter(t => t.status === 'running' || t.status === 'completed').length === 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>暂无运行中或已完成的任务</span>
          )}
          <button className="btn btn-outline btn-sm" onClick={simulateData} style={{ marginLeft: 'auto' }}>
            模拟数据 (Demo)
          </button>
        </div>
      </div>

      {selectedTaskId && (
        <>
          <DashboardPanel intervals={intervals} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="panel">
              <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>带宽 (Mbps)</h4>
              <BandwidthChart intervals={intervals} />
            </div>
            <div className="panel">
              <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>抖动 (ms)</h4>
              <JitterChart intervals={intervals} />
            </div>
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>重传数</h4>
            <RetransmitChart intervals={intervals} />
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>CPU 使用率</h4>
            <CPUMemoryChart intervals={intervals} />
          </div>
        </>
      )}

      {!selectedTaskId && (
        <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: 'var(--text-muted)' }}>
          选择一个任务开始实时监控
        </div>
      )}
    </div>
  )
}
