import { useState, useEffect, useRef } from 'react'
import { ExecutionTaskConfig } from '../types'
import * as App from '../wailsjs/go/app/App'
import { EventsOn, EventsOffAll } from '../wailsjs/runtime/runtime'

interface FioStatus {
  host: string
  jobName: string
  readIOPS: number
  writeIOPS: number
  readBW: number
  writeBW: number
  readLat: number
  writeLat: number
  runtime: number
  eta: number
  jobStatus: string
  event?: string
}

interface Toast {
  id: number
  msg: string
  type: 'info' | 'success' | 'error' | 'warn'
}

let toastId = 0

export function FioMonitor() {
  const [tasks, setTasks] = useState<ExecutionTaskConfig[]>([])
  const [selectedTask, setSelectedTask] = useState<ExecutionTaskConfig | null>(null)
  const [isMonitoring, setIsMonitoring] = useState(false)
  const [statuses, setStatuses] = useState<FioStatus[]>([])
  const [history, setHistory] = useState<Map<string, FioStatus[]>>(new Map())
  const [detailHost, setDetailHost] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const eventRef = useRef<string | null>(null)
  const monitorTaskIdRef = useRef<string | null>(null)

  const addToast = (msg: string, type: Toast['type'] = 'info') => {
    const id = ++toastId
    setToasts(prev => [...prev, { id, msg, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }

  useEffect(() => {
    loadTasks()
    return () => { EventsOffAll(); fireStop() }
  }, [])

  const fireStop = () => {
    const tid = monitorTaskIdRef.current
    monitorTaskIdRef.current = null
    if (tid) { App.StopFioMonitor(tid).catch(() => {}) }
  }

  const loadTasks = async () => {
    try {
      const list = await App.GetExecutionTasks()
      setTasks(list || [])
    } catch { /* ignore */ }
  }

  const startMonitor = (task: ExecutionTaskConfig) => {
    EventsOffAll()
    fireStop()
    setSelectedTask(task)
    setStatuses([])
    setHistory(new Map())
    setDetailHost(null)

    const eventName = `fio:status:${task.id}`
    monitorTaskIdRef.current = task.id

    EventsOn(eventName, (payload: any) => {
      if (payload && (payload.event === 'done' || payload.event === 'timeout')) {
        eventRef.current = null
        monitorTaskIdRef.current = null
        EventsOffAll()
        setIsMonitoring(false)
        addToast(payload.event === 'timeout' ? '监控超时：所有主机均未返回 FIO 数据' : 'FIO 任务已完成', payload.event === 'timeout' ? 'error' : 'success')
        return
      }
      const st = payload as FioStatus
      if (st && st.host) {
        setStatuses(prev => {
          const next = prev.filter(s => s.host !== st.host)
          next.push(st)
          return next
        })
        setHistory(prev => {
          const next = new Map(prev)
          const arr = next.get(st.host) || []
          arr.push(st)
          if (arr.length > 300) arr.shift()
          next.set(st.host, arr)
          return next
        })
      }
    })
    eventRef.current = eventName
    setIsMonitoring(true)
    addToast('正在启动监控...', 'info')

    setTimeout(() => {
      App.MonitorFioTask(task.id, task.hosts || [])
        .then(() => addToast('监控已启动', 'success'))
        .catch((err: any) => {
          EventsOffAll()
          eventRef.current = null
          monitorTaskIdRef.current = null
          setIsMonitoring(false)
          addToast('启动失败: ' + (err?.message || String(err)), 'error')
        })
    }, 50)
  }

  const stopMonitor = () => {
    EventsOffAll()
    const tid = monitorTaskIdRef.current
    monitorTaskIdRef.current = null
    setIsMonitoring(false)
    setStatuses([])
    setHistory(new Map())
    addToast('监控已停止', 'warn')
    if (tid) { setTimeout(() => App.StopFioMonitor(tid).catch(() => {}), 0) }
  }

  const goBack = () => {
    stopMonitor()
    setSelectedTask(null)
    setDetailHost(null)
  }

  const toastColor = (type: Toast['type']) => {
    switch (type) {
      case 'success': return { bg: '#dcfce7', color: '#16a34a', border: '#86efac' }
      case 'error': return { bg: '#fef2f2', color: '#dc2626', border: '#fca5a5' }
      case 'warn': return { bg: '#fefce8', color: '#a16207', border: '#fde047' }
      default: return { bg: '#eff6ff', color: '#2563eb', border: '#93c5fd' }
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        position: 'fixed', top: 16, right: 16, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360
      }}>
        {toasts.map(t => {
          const c = toastColor(t.type)
          return (
            <div key={t.id} style={{
              background: c.bg, color: c.color, border: `1px solid ${c.border}`,
              borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 500,
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              animation: 'toastIn 0.2s ease-out'
            }}>
              {t.type === 'success' && '✓ '}
              {t.type === 'error' && '✗ '}
              {t.type === 'warn' && '⚠ '}
              {t.type === 'info' && '● '}
              {t.msg}
            </div>
          )
        })}
      </div>

      <div className="manager-header">
        <h2>FIO 实时监控</h2>
        {isMonitoring && (
          <span style={{ fontSize: 13, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: '#22c55e',
              animation: 'pulse 1.5s ease-in-out infinite'
            }} />
            监控中
          </span>
        )}
      </div>

      {!selectedTask && (
        <div className="panel">
          <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>选择任务开始监控</h4>
          {tasks.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>暂无任务，请先在任务管理中创建</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tasks.map(task => (
                <div key={task.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 14px', borderRadius: 8, border: '1px solid #e8e8ed',
                  background: '#fafafa'
                }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1d1d1f' }}>{task.name}</div>
                    <div style={{ fontSize: 12, color: '#86868b', marginTop: 2 }}>
                      {task.scripts?.join(', ')} · {task.hosts?.length || 0} 台主机
                    </div>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); setSelectedTask(task) }}>
                    {isMonitoring && monitorTaskIdRef.current === task.id ? '查看' : '监控'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedTask && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <button className="btn btn-outline btn-sm" onClick={goBack}>← 返回</button>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{selectedTask.name}</span>
            <span style={{ fontSize: 12, color: '#86868b' }}>{selectedTask.hosts?.length || 0} 台主机</span>
            <div style={{ flex: 1 }} />
            {isMonitoring ? (
              <button className="btn btn-danger btn-sm" onClick={stopMonitor}>停止监控</button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={() => startMonitor(selectedTask)}>开始监控</button>
            )}
          </div>

          {statuses.length > 0 && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                <StatCard label="总读 IOPS" value={formatIOPS(statuses.reduce((s, st) => s + st.readIOPS, 0))} color="#3b82f6" />
                <StatCard label="总写 IOPS" value={formatIOPS(statuses.reduce((s, st) => s + st.writeIOPS, 0))} color="#f59e0b" />
                <StatCard label="总读带宽" value={formatBW(statuses.reduce((s, st) => s + st.readBW, 0))} color="#6366f1" />
                <StatCard label="总写带宽" value={formatBW(statuses.reduce((s, st) => s + st.writeBW, 0))} color="#ec4899" />
              </div>

              <div className="panel" style={{ marginBottom: 12 }}>
                <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>整体 IOPS 趋势</h4>
                <FioChart history={history} type="iops" />
              </div>
              <div className="panel" style={{ marginBottom: 12 }}>
                <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>整体带宽趋势 (KB/s)</h4>
                <FioChart history={history} type="bw" />
              </div>

              <div className="panel" style={{ marginBottom: 12 }}>
                <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>主机状态</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {statuses.map(st => {
                    const isDetail = detailHost === st.host
                    return (
                      <div key={st.host}
                        style={{
                          padding: '10px 14px', borderRadius: 8, border: `1px solid ${isDetail ? '#3b82f6' : '#e8e8ed'}`,
                          background: isDetail ? '#eff6ff' : '#fff', cursor: 'pointer', transition: 'all 0.15s'
                        }}
                        onClick={() => setDetailHost(isDetail ? null : st.host)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#1d1d1f' }}>{st.host}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{
                              fontSize: 11, padding: '2px 8px', borderRadius: 4,
                              background: st.jobStatus === 'done' ? '#dcfce7' : '#fef3c7',
                              color: st.jobStatus === 'done' ? '#16a34a' : '#92400e'
                            }}>
                              {st.jobStatus === 'done' ? '已完成' : '运行中'}
                            </span>
                            <span style={{ fontSize: 11, color: '#86868b' }}>
                              {isDetail ? '收起' : '详情'}
                            </span>
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                          <MetricItem label="读 IOPS" value={formatIOPS(st.readIOPS)} />
                          <MetricItem label="写 IOPS" value={formatIOPS(st.writeIOPS)} />
                          <MetricItem label="读带宽" value={formatBW(st.readBW)} />
                          <MetricItem label="写带宽" value={formatBW(st.writeBW)} />
                        </div>
                        {isDetail && viewingHistory(st.host) && viewingHistory(st.host)!.length > 0 && (
                          <div style={{ marginTop: 12, borderTop: '1px solid #e8e8ed', paddingTop: 12 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                              <div>
                                <div style={{ fontSize: 12, color: '#86868b', marginBottom: 6 }}>IOPS 趋势</div>
                                <FioChart history={new Map([[st.host, viewingHistory(st.host)!]])} type="iops" />
                              </div>
                              <div>
                                <div style={{ fontSize: 12, color: '#86868b', marginBottom: 6 }}>带宽趋势 (KB/s)</div>
                                <FioChart history={new Map([[st.host, viewingHistory(st.host)!]])} type="bw" />
                              </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 12 }}>
                              <MetricItem label="读延迟" value={formatLat(st.readLat)} />
                              <MetricItem label="写延迟" value={formatLat(st.writeLat)} />
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}

          {isMonitoring && statuses.length === 0 && (
            <div className="panel" style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              正在连接主机获取 FIO 状态...（12秒无数据将自动停止）
            </div>
          )}

          {!isMonitoring && statuses.length === 0 && selectedTask && (
            <div className="panel" style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              点击「开始监控」启动
            </div>
          )}
        </>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes toastIn {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  )

  function viewingHistory(host: string) { return history.get(host) }
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 10, padding: '14px 16px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #e8e8ed'
    }}>
      <div style={{ fontSize: 11, color: '#86868b', marginBottom: 4, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: '#86868b', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#1d1d1f', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}

function FioChart({ history, type }: { history: Map<string, FioStatus[]>; type: 'iops' | 'bw' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * 2
    canvas.height = rect.height * 2
    ctx.scale(2, 2)

    const W = rect.width
    const H = rect.height
    const pad = { top: 20, right: 20, bottom: 30, left: 60 }

    ctx.clearRect(0, 0, W, H)

    let maxVal = 0
    const allSeries: { color: string; data: number[] }[] = []
    const colors = ['#3b82f6', '#f59e0b', '#6366f1', '#ec4899', '#22c55e']
    let idx = 0
    history.forEach((arr) => {
      const data = arr.map(st => type === 'iops' ? st.readIOPS + st.writeIOPS : st.readBW + st.writeBW)
      data.forEach(v => { if (v > maxVal) maxVal = v })
      allSeries.push({ color: colors[idx % colors.length], data })
      idx++
    })

    if (maxVal === 0) maxVal = 1

    ctx.strokeStyle = '#e8e8ed'
    ctx.lineWidth = 0.5
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (H - pad.top - pad.bottom) * (1 - i / 4)
      ctx.beginPath()
      ctx.moveTo(pad.left, y)
      ctx.lineTo(W - pad.right, y)
      ctx.stroke()

      ctx.fillStyle = '#86868b'
      ctx.font = '10px -apple-system, sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(formatShortNum(maxVal * i / 4), pad.left - 6, y + 3)
    }

    allSeries.forEach(({ color, data }) => {
      if (data.length < 2) return
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.beginPath()
      const xStep = (W - pad.left - pad.right) / (data.length - 1)
      data.forEach((v, i) => {
        const x = pad.left + i * xStep
        const y = pad.top + (H - pad.top - pad.bottom) * (1 - v / maxVal)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
    })
  }, [history, type])

  return (
    <canvas ref={canvasRef} style={{ width: '100%', height: 200 }} />
  )
}

function formatIOPS(v: number): string {
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M'
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K'
  return v.toFixed(0)
}

function formatBW(v: number): string {
  if (v >= 1024 * 1024) return (v / (1024 * 1024)).toFixed(1) + ' GB/s'
  if (v >= 1024) return (v / 1024).toFixed(1) + ' MB/s'
  return v.toFixed(0) + ' KB/s'
}

function formatLat(v: number): string {
  if (v >= 1000) return (v / 1000).toFixed(2) + ' ms'
  return v.toFixed(1) + ' us'
}

function formatShortNum(v: number): string {
  if (v >= 1000000) return (v / 1000000).toFixed(0) + 'M'
  if (v >= 1000) return (v / 1000).toFixed(0) + 'K'
  return v.toFixed(0)
}
