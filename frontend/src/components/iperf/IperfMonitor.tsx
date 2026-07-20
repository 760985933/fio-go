import { useState, useEffect, useRef, useCallback } from 'react'
import { IperfTask, IperfInterval } from '../../types'
import * as App from '../../wailsjs/go/app/App'
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime'
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
  const eventRef = useRef<string | null>(null)
  const startTimeRef = useRef<number>(0)

  useEffect(() => { loadTasks() }, [])
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (eventRef.current) EventsOff(eventRef.current)
    }
  }, [])

  const loadTasks = async () => {
    try {
      const list = await App.GetIperfTasks()
      setTasks(list || [])
    } catch { /* ignore */ }
  }

  const startMonitor = useCallback(async (taskId: string) => {
    // 切换任务前先清理上一次的轮询与事件订阅
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (eventRef.current) { EventsOff(eventRef.current); eventRef.current = null }

    setSelectedTaskId(taskId)
    setIntervals([])
    startTimeRef.current = Date.now()

    // 订阅该任务的实时区间数据事件（iperf3 一边跑一边推送）
    const eventName = `iperf:interval:${taskId}`
    const handler = (payload: any) => {
      try {
        const raw = Array.isArray(payload) ? payload[0] : payload
        const iv: IperfInterval = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (iv && typeof iv.bitsPerSecond === 'number') {
          setIntervals(prev => [...prev, iv].slice(-600))
        }
      } catch {
        // 忽略非法格式的 payload，避免 JSON.parse 抛出未捕获异常导致组件崩溃
      }
    }
    EventsOn(eventName, handler)
    eventRef.current = eventName

    // 依据任务真实状态决定是否常驻"监控中"
    let status = ''
    try { status = await App.CheckIperfTestStatus(taskId) } catch { /* ignore */ }

    if (status === 'running') {
      setIsMonitoring(true)
      pollRef.current = window.setInterval(async () => {
        try {
          setCurrentTime((Date.now() - startTimeRef.current) / 1000)
          // 实时回源：直接读取实时落盘的 JSONL（emitAndPersist 边跑边写），
          // 与「日志查看」同源，避免单纯依赖 Wails 事件时偶发丢数据导致监控空白。
          try {
            const hist = await App.GetIperfIntervals(taskId)
            if (hist && hist.length > 0) setIntervals(hist)
          } catch { /* ignore */ }
          const st = await App.CheckIperfTestStatus(taskId)
          if (st !== 'running') {
            // 测试已结束（完成/停止/出错），停止轮询但保留已采集的曲线
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
            setIsMonitoring(false)
          }
        } catch { /* ignore */ }
      }, 1000)
    } else {
      setIsMonitoring(false)
      // 已结束的任务：加载落盘的区间数据回放，曲线不会空白
      try {
        const hist = await App.GetIperfIntervals(taskId)
        if (hist && hist.length > 0) setIntervals(hist)
      } catch { /* ignore */ }
    }
  }, [])

  const stopMonitor = useCallback(async () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (eventRef.current) { EventsOff(eventRef.current); eventRef.current = null }
    setIsMonitoring(false)
    if (selectedTaskId) {
      try { await App.StopIperfTest(selectedTaskId) } catch { /* ignore */ }
    }
  }, [selectedTaskId])

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
