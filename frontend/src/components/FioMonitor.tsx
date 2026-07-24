import { useState, useEffect, useRef, useCallback } from 'react'
import { HostConfig } from '../types'
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
  const [hosts, setHosts] = useState<HostConfig[]>([])
  const [selectedHosts, setSelectedHosts] = useState<HostConfig[]>([])
  const [taskName, setTaskName] = useState('')
  const [isMonitoring, setIsMonitoring] = useState(false)
  const [statuses, setStatuses] = useState<FioStatus[]>([])
  const [history, setHistory] = useState<Map<string, FioStatus[]>>(new Map())
  const [error, setError] = useState('')
  const eventRef = useRef<string | null>(null)

  useEffect(() => {
    loadHosts()
    return () => { if (eventRef.current) EventsOff(eventRef.current) }
  }, [])

  const loadHosts = async () => {
    try {
      const list = await App.GetHosts()
      setHosts(list || [])
    } catch { /* ignore */ }
  }

  const toggleHost = (h: HostConfig) => {
    setSelectedHosts(prev => {
      const exists = prev.some(x => x.host === h.host && x.port === h.port)
      if (exists) return prev.filter(x => !(x.host === h.host && x.port === h.port))
      return [...prev, h]
    })
  }

  const selectAll = () => setSelectedHosts([...hosts])
  const clearAll = () => setSelectedHosts([])

  const startMonitor = useCallback(async () => {
    if (selectedHosts.length === 0) {
      setError('请至少选择一台主机')
      return
    }
    if (!taskName.trim()) {
      setError('请输入任务名称')
      return
    }
    setError('')

    const taskId = taskName.trim()
    const eventName = `fio:status:${taskId}`

    if (eventRef.current) EventsOff(eventRef.current)

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
      await App.MonitorFioTask(taskId, selectedHosts)
      setIsMonitoring(true)
      setStatuses([])
      setHistory(new Map())
    } catch (err: any) {
      setError(err.message || String(err))
    }
  }, [selectedHosts, taskName])

  const stopMonitor = useCallback(async () => {
    if (eventRef.current) { EventsOff(eventRef.current); eventRef.current = null }
    setIsMonitoring(false)
    try { await App.StopFioMonitor(taskName.trim()) } catch { /* ignore */ }
  }, [taskName])

  return (
    <div>
      <div className="manager-header">
        <h2>FIO 实时监控</h2>
        {isMonitoring && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#22c55e' }}>● 监控中</span>
            <button className="btn btn-danger btn-sm" onClick={stopMonitor}>停止监控</button>
          </div>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>监控配置</h4>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>任务标识</label>
          <input type="text" value={taskName} onChange={e => setTaskName(e.target.value)}
            placeholder="远程主机上的 FIO 任务目录名"
            disabled={isMonitoring}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d2d2d7', fontSize: 13 }} />
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 500 }}>选择主机 ({selectedHosts.length}/{hosts.length})</label>
            {hosts.length > 0 && (
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-outline btn-sm" style={{ fontSize: 11, padding: '2px 6px' }}
                  onClick={selectAll}>全选</button>
                <button className="btn btn-outline btn-sm" style={{ fontSize: 11, padding: '2px 6px' }}
                  onClick={clearAll}>全不选</button>
              </div>
            )}
          </div>
          {hosts.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>暂无主机，请先在主机管理中添加</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {hosts.map(h => {
                const selected = selectedHosts.some(x => x.host === h.host && x.port === h.port)
                return (
                  <button key={`${h.host}:${h.port}`}
                    className={`btn ${selected ? 'btn-primary' : 'btn-outline'} btn-sm`}
                    onClick={() => toggleHost(h)}
                    disabled={isMonitoring}
                    style={{ fontSize: 12 }}>
                    {h.host}:{h.port}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        {error && <p style={{ color: '#dc2626', fontSize: 12, marginTop: 8 }}>{error}</p>}
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-primary"
            onClick={isMonitoring ? stopMonitor : startMonitor}
            disabled={!isMonitoring && selectedHosts.length === 0}>
            {isMonitoring ? '停止监控' : '开始监控'}
          </button>
        </div>
      </div>

      {statuses.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            <StatCard label="总读 IOPS" value={formatIOPS(statuses.reduce((s, st) => s + st.readIOPS, 0))} color="#3b82f6" />
            <StatCard label="总写 IOPS" value={formatIOPS(statuses.reduce((s, st) => s + st.writeIOPS, 0))} color="#f59e0b" />
            <StatCard label="总读带宽" value={formatBW(statuses.reduce((s, st) => s + st.readBW, 0))} color="#6366f1" />
            <StatCard label="总写带宽" value={formatBW(statuses.reduce((s, st) => s + st.writeBW, 0))} color="#ec4899" />
          </div>

          {statuses.map(st => (
            <div key={st.host} className="panel" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h4 style={{ fontSize: 13, fontWeight: 600, color: '#1d1d1f' }}>{st.host}</h4>
                <span style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 4,
                  background: st.jobStatus === 'done' ? '#dcfce7' : '#fef3c7',
                  color: st.jobStatus === 'done' ? '#16a34a' : '#92400e'
                }}>
                  {st.jobStatus === 'done' ? '已完成' : '运行中'}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                <MetricItem label="读 IOPS" value={formatIOPS(st.readIOPS)} />
                <MetricItem label="写 IOPS" value={formatIOPS(st.writeIOPS)} />
                <MetricItem label="读带宽" value={formatBW(st.readBW)} />
                <MetricItem label="写带宽" value={formatBW(st.writeBW)} />
              </div>
            </div>
          ))}

          <div className="panel" style={{ marginBottom: 12 }}>
            <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>IOPS 趋势</h4>
            <FioChart history={history} type="iops" />
          </div>

          <div className="panel" style={{ marginBottom: 12 }}>
            <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>带宽趋势 (KB/s)</h4>
            <FioChart history={history} type="bw" />
          </div>
        </>
      )}

      {isMonitoring && statuses.length === 0 && (
        <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, color: 'var(--text-muted)' }}>
          <div className="spinner" style={{ marginRight: 8 }} /> 等待 FIO 状态数据...
        </div>
      )}

      {!isMonitoring && statuses.length === 0 && (
        <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: 'var(--text-muted)' }}>
          输入任务标识并选择主机，点击「开始监控」
        </div>
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

function formatShortNum(v: number): string {
  if (v >= 1000000) return (v / 1000000).toFixed(0) + 'M'
  if (v >= 1000) return (v / 1000).toFixed(0) + 'K'
  return v.toFixed(0)
}
