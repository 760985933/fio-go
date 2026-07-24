import { useState, useEffect } from 'react'
import { AnalysisSummary } from '../types'
import * as App from '../wailsjs/go/app/App'

interface GroupedRow {
  BS: string
  Jobname: string
  RW: string
  IODepth: number
  Numjobs: number
  ReadIOPS: number
  WriteIOPS: number
  ReadBWMB: number
  WriteBWMB: number
  ReadLatMS: number
  WriteLatMS: number
}

interface TaskResult {
  taskId: string
  taskName: string
  groupedRows: GroupedRow[]
  error?: string
}

interface Props {
  onShowResults: (title: string, content: string, wide?: boolean) => Promise<void>
}

export function TaskCompareView({ onShowResults }: Props) {
  const [tasks, setTasks] = useState<AnalysisSummary[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [results, setResults] = useState<TaskResult[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingTasks, setLoadingTasks] = useState(true)

  useEffect(() => { loadTasks() }, [])

  const loadTasks = async () => {
    setLoadingTasks(true)
    try {
      const all = (await App.GetAnalysisTasks()) || []
      setTasks(all.filter(t => t.hasData))
    } catch { /* ignore */ }
    setLoadingTasks(false)
  }

  const toggleTask = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
  }

  const selectAll = () => {
    const dataIds = tasks.filter(t => t.hasData).map(t => t.id)
    setSelectedIds(dataIds)
  }

  const clearAll = () => setSelectedIds([])

  const doCompare = async () => {
    if (selectedIds.length < 2) {
      await onShowResults('提示', '请至少选择 2 个有数据的任务')
      return
    }
    setLoading(true)
    try {
      const res = await App.CompareTaskMetrics(selectedIds)
      setResults(res)
    } catch (err: any) {
      await onShowResults('对比失败', `错误: ${err.message || err}`)
    }
    setLoading(false)
  }

  const buildComparisonTable = () => {
    if (results.length < 2) return null

    const allRows = new Map<string, Map<string, GroupedRow[]>>()
    for (const r of results) {
      for (const row of (r.groupedRows || [])) {
        const key = `${row.BS}|${row.RW}|${row.IODepth}`
        if (!allRows.has(key)) allRows.set(key, new Map())
        allRows.get(key)!.set(r.taskId, [row])
      }
    }

    const sortedKeys = Array.from(allRows.keys()).sort((a, b) => {
      const [bsA, rwA, depthA] = a.split('|')
      const [bsB, rwB, depthB] = b.split('|')
      const toBytes = (s: string) => {
        s = s.toLowerCase()
        if (s.endsWith('k')) return parseInt(s) * 1024
        if (s.endsWith('m')) return parseInt(s) * 1024 * 1024
        return parseInt(s) || 0
      }
      const diff = toBytes(bsA) - toBytes(bsB)
      if (diff !== 0) return diff
      if (rwA !== rwB) return rwA.localeCompare(rwB)
      return parseInt(depthA) - parseInt(depthB)
    })

    const fmtIOPS = (v: number) => v > 0 ? (v / 1000).toFixed(2) : '-'
    const fmtLat = (v: number) => v > 0 ? (v * 1000).toFixed(1) : '-'

    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={thStyle}>BS</th>
              <th style={thStyle}>读写</th>
              <th style={thStyle}>深度</th>
              {results.map(r => (
                <th key={r.taskId} style={{ ...thStyle, textAlign: 'center' }} colSpan={4}>
                  {r.taskName || r.taskId}
                </th>
              ))}
            </tr>
            <tr>
              <th style={thStyle}></th>
              <th style={thStyle}></th>
              <th style={thStyle}></th>
              {results.map(r => (
                <>
                  <th style={thSubStyle}>读IOPS(K)</th>
                  <th style={thSubStyle}>写IOPS(K)</th>
                  <th style={thSubStyle}>读延迟(us)</th>
                  <th style={thSubStyle}>写延迟(us)</th>
                </>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedKeys.map(key => {
              const [bs, rw, depth] = key.split('|')
              const rowsByTask = allRows.get(key)!
              return (
                <tr key={key}>
                  <td style={tdStyle}>{bs}</td>
                  <td style={tdStyle}>{rw}</td>
                  <td style={tdStyle}>{depth}</td>
                  {results.map(r => {
                    const rows = rowsByTask.get(r.taskId)
                    if (!rows || rows.length === 0) {
                      return (
                        <>
                          <td style={tdStyle}>-</td>
                          <td style={tdStyle}>-</td>
                          <td style={tdStyle}>-</td>
                          <td style={tdStyle}>-</td>
                        </>
                      )
                    }
                    const row = rows[0]
                    return (
                      <>
                        <td style={tdStyle}>{fmtIOPS(row.ReadIOPS)}</td>
                        <td style={tdStyle}>{fmtIOPS(row.WriteIOPS)}</td>
                        <td style={tdStyle}>{fmtLat(row.ReadLatMS)}</td>
                        <td style={tdStyle}>{fmtLat(row.WriteLatMS)}</td>
                      </>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  if (loadingTasks) {
    return <div className="loading-spinner"><div className="spinner" /></div>
  }

  return (
    <div>
      <div className="manager-header">
        <h2>多任务对比分析</h2>
        <button className="btn btn-outline btn-sm" onClick={loadTasks}>刷新</button>
      </div>

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 className="section-title" style={{ margin: 0 }}>选择任务 ({selectedIds.length})</h3>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn btn-outline btn-sm" onClick={selectAll}>全选</button>
            <button className="btn btn-outline btn-sm" onClick={clearAll}>清空</button>
            <button className="btn btn-primary btn-sm" onClick={doCompare}
              disabled={loading || selectedIds.length < 2}>
              {loading ? '分析中...' : '开始对比'}
            </button>
          </div>
        </div>

        {tasks.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
            暂无有数据的任务，请先在分析报告中拉取数据
          </p>
        ) : (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, maxHeight: 320, overflowY: 'auto' }}>
            {tasks.map(task => (
              <label key={task.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                cursor: 'pointer', borderBottom: '1px solid #f3f4f6',
                background: selectedIds.includes(task.id) ? '#eff6ff' : 'transparent'
              }}>
                <input type="checkbox"
                  checked={selectedIds.includes(task.id)}
                  onChange={() => toggleTask(task.id)}
                  style={{ flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#1f2937' }}>
                    {task.name}
                    {task.hasReport && <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 6 }}>有报告</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                    {task.id} · {task.scripts?.join(', ') || '未知脚本'}
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {results.length > 0 && (
        <div className="panel" style={{ marginTop: 12 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>对比结果</h3>
          {results.filter(r => r.error).map(r => (
            <p key={r.taskId} style={{ fontSize: 12, color: '#ef4444', marginBottom: 4 }}>
              {r.taskName || r.taskId}: {r.error}
            </p>
          ))}
          {buildComparisonTable()}
        </div>
      )}
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '8px 10px', borderBottom: '2px solid #d1d5db', fontWeight: 600,
  fontSize: 12, color: '#374151', background: '#f8f9fa', textAlign: 'left'
}
const thSubStyle: React.CSSProperties = {
  padding: '4px 8px', borderBottom: '2px solid #d1d5db', fontWeight: 500,
  fontSize: 11, color: '#6b7280', background: '#f8f9fa', textAlign: 'center'
}
const tdStyle: React.CSSProperties = {
  padding: '6px 10px', borderBottom: '1px solid #e5e7eb', fontSize: 12, color: '#1f2937', textAlign: 'center'
}
