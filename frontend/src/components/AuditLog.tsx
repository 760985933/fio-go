interface AuditEntry {
  action: string
  details: string
  timestamp: string
}

interface Props {
  entries: AuditEntry[]
}

export function AuditLog({ entries }: Props) {
  const formatTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleString('zh-CN')
    } catch {
      return ts
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, color: '#4f46e5' }}>审计日志 ({entries.length})</h3>
      </div>

      {entries.length === 0 && (
        <div className="empty-state">
          <p>暂无审计日志</p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th style={{ width: 180 }}>时间</th>
                <th style={{ width: 120 }}>操作</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, idx) => (
                <tr key={idx}>
                  <td>{formatTime(entry.timestamp)}</td>
                  <td><span className="status-badge success">{entry.action}</span></td>
                  <td>{entry.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
