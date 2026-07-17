import { useState, useEffect } from 'react'
import { AuditEntry } from '../types'
import * as App from '../wailsjs/go/app/App'

export function AuditLog() {
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadLogs() }, [])

  const loadLogs = async () => {
    setLoading(true)
    try {
      const result = await App.GetAuditLog()
      setLogs(result || [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  if (loading) {
    return <div className="loading-spinner"><div className="spinner"></div></div>
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, color: '#4f46e5' }}>审计日志 ({logs.length})</h3>
        <button className="btn btn-outline btn-sm" onClick={loadLogs}>刷新</button>
      </div>

      {logs.length === 0 ? (
        <div className="panel">
          <p style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', padding: 20 }}>暂无审计日志</p>
        </div>
      ) : (
        <div className="panel" style={{ padding: 0 }}>
          {logs.map((log, idx) => (
            <div key={idx} className="host-item" style={{ borderBottom: '1px solid #f3f4f6' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{log.action}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{log.details}</div>
              </div>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>{log.timestamp}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
