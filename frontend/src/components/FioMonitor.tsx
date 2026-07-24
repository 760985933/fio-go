import { useState, useEffect, useRef, useCallback } from 'react'
import { ExecutionTaskConfig } from '../types'
import * as App from '../wailsjs/go/app/App'
import { EventsOn, EventsOff } from '../wailsjs/runtime/runtime'

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

export function FioMonitor() {
  const [tasks, setTasks] = useState<ExecutionTaskConfig[]>([])
  const [selectedTask, setSelectedTask] = useState<ExecutionTaskConfig | null>(null)
  const [isMonitoring, setIsMonitoring] = useState(false)
  const [statuses, setStatuses] = useState<FioStatus[]>([])
  const [history, setHistory] = useState<Map<string, FioStatus[]>>(new Map())
  const [detailHost, setDetailHost] = useState<string | null>(null)
  const eventRef = useRef<string | null>(null)

  useEffect(() => {
    loadTasks()
    return () => { if (eventRef.current) EventsOff(eventRef.current) }
  }, [])

  const loadTasks = async () => {
    try {
      const list = await App.GetExecutionTasks()
      setTasks(list || [])
    } catch { /* ignore */ }
  }

  const startMonitor = useCallback(async (task: ExecutionTaskConfig) => {
    if (eventRef.current) { EventsOff(eventRef.current); eventRef.current = null }

    setSelectedTask(task)
    setStatuses([])
    setHistory(new Map())
    setDetailHost(null)

    const eventName = `fio:status:${task.id}`

    EventsOn(eventName, (payload: any) => {
      if (payload && payload.event === 'done') {
        setIsMonitoring(false)
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

    try {
      await App.MonitorFioTask(task.id, task.hosts || [])
      setIsMonitoring(true)
    } catch (err: any) {
      alert(err.message || String(err))
    }
  }, [])

  const stopMonitor = useCallback(async () => {
    if (eventRef.current) { EventsOff(eventRef.current); eventRef.current = null }
    setIsMonitoring(false)
    if (selectedTask) {
      try { await App.StopFioMonitor(selectedTask.id) } catch { /* ignore */ }
    }
  }, [selectedTask])

  const viewingHistory = detailHost ? history.get(detailHost) : null

  return (
    <div>
      <div className="manager-header">
        <h2>FIO 实时监控</h2>
        {isMonitoring && selectedTask && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#22c55e' }}>● 监控中</span>
            <button className="btn btn-danger btn-sm" onClick={stopMonitor}>停止监控</button>
          </div>
        )}
      </div>

      {/* 任务列表 */}
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
                  background: '#fafafa', cursor: 'pointer', transition: 'border-color 0.15s'
                }}
                  onClick={() => startMonitor(task)}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#3b82f6')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#e8e8ed')}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1d1d1f' }}>{task.name}</div>
                    <div style={{ fontSize: 12, color: '#86868b', marginTop: 2 }}>
                      {task.scripts?.join(', ')} · {task.hosts?.length || 0} 台主机
                    </div>
                  </div>
                  <button className="btn btn-primary btn-sm">监控</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 监控详情 */}
      {selectedTask && (
        <>
          {/* 顶部：任务信息 + 返回 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <button className="btn btn-outline btn-sm" onClick={() => { stopMonitor(); setSelectedTask(null); setDetailHost(null); setStatuses([]); setHistory(new Map()) }}>
              ← 返回任务列表
            </button>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{selectedTask.name}</span>
            <span style={{ fontSize: 12, color: '#86868b' }}>
              {selectedTask.hosts?.length || 0} 台主机
            </span>
          </div>

          {/* 总览 */}
          {statuses.length > 0 && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                <StatCard label="总读 IOPS" value={formatIOPS(statuses.reduce((s, st) => s + st.readIOPS, 0))} color="#3b82f6" />
                <StatCard label="总写 IOPS" value={formatIOPS(statuses.reduce((s, st) => s + st.writeIOPS, 0))} color="#f59e0b" />
                <StatCard label="总读带宽" value={formatBW(statuses.reduce((s, st) => s + st.readBW, 0))} color="#6366f1" />
                <StatCard label="总写带宽" value={formatBW(statuses.reduce((s, st) => s + st.writeBW, 0))} color="#ec4899" />
              </div>

              {/* 整体趋势图 */}
              <div className="panel" style={{ marginBottom: 12 }}>
                <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>整体 IOPS 趋势</h4>
                <FioChart history={history} type="iops" />
              </div>
              <div className="panel" style={{ marginBottom: 12 }}>
                <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>整体带宽趋势 (KB/s)</h4>
                <FioChart history={history} type="bw" />
              </div>

              {/* 主机列表 */}
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

                        {/* 展开的主机详情图 */}
                        {isDetail && viewingHistory && viewingHistory.length > 0 && (
                          <div style={{ marginTop: 12, borderTop: '1px solid #e8e8ed', paddingTop: 12 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                              <div>
                                <div style={{ fontSize: 12, color: '#86868b', marginBottom: 6 }}>IOPS 趋势</div>
                                <FioChart history={new Map([[st.host, viewingHistory]])} type="iops" />
                              </div>
                              <div>
                                <div style={{ fontSize: 12, color: '#86868b', marginBottom: 6 }}>带宽趋势 (KB/s)</div>
                                <FioChart history={new Map([[st.host, viewingHistory]])} type="bw" />
                              </div>
                            </div>
                            {/* 延迟数据 */}
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

          {/* 等待数据 */}
          {isMonitoring && statuses.length === 0 && (
            <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, color: 'var(--text-muted)' }}>
              <div className="spinner" style={{ marginRight: 8 }} /> 等待 FIO 状态数据...
            </div>
          )}
        </>
      )}
    </div>
  )
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
