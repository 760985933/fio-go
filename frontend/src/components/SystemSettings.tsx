import { useState, useEffect } from 'react'
import { AuditEntry } from '../types'
import * as App from '../wailsjs/go/app/App'

export function SystemSettings() {
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadLogs() }, [])

  const loadLogs = async () => {
    setLoading(true)
    try { setLogs((await App.GetAuditLog()) || []) } catch { /* ignore */ }
    setLoading(false)
  }

  return (
    <div>
      <div className="manager-header">
        <h2>系统设置</h2>
      </div>

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 className="section-title" style={{ marginBottom: 0 }}>审计日志 ({logs.length})</h3>
          <button className="btn btn-outline btn-sm" onClick={loadLogs}>刷新</button>
        </div>

        {loading ? (
          <div className="loading-spinner"><div className="spinner"></div></div>
        ) : logs.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>暂无审计日志</p>
        ) : (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {logs.map((log, idx) => (
              <div key={idx} className="host-item" style={{ borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{log.action}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{log.details}</div>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(log.timestamp).toLocaleString('sv-SE', { hour12: false }).replace('T', ' ')}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h3 className="section-title">关于</h3>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 2 }}>
          <p><strong>FIO 性能测试工具</strong> v1.0.3</p>
          <p>© 2026 nettopo.com</p>
          <p>License: AGPLv3</p>
        </div>
      </div>
    </div>
  )
}
