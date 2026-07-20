import { useState, useEffect } from 'react'
import { HostConfig } from '../../types'
import * as App from '../../wailsjs/go/app/App'

interface Props {
  onAudit: (action: string, details: string) => void
  onShowResults: (title: string, content: string, wide?: boolean) => Promise<void>
  active?: boolean
}

export function IperfServerManager({ onAudit, onShowResults, active }: Props) {
  const [hosts, setHosts] = useState<HostConfig[]>([])
  const [hostPorts, setHostPorts] = useState<Record<string, number>>({})
  const [serverStatus, setServerStatus] = useState<Record<string, boolean>>({})
  const [installStatus, setInstallStatus] = useState<Record<string, boolean | null>>({})
  useEffect(() => { if (active) loadHosts() }, [active])

  const getPort = (hostKey: string) => hostPorts[hostKey] || 5201

  const loadHosts = async () => {
    try {
      const list = await App.GetHosts()
      setHosts(list || [])
    } catch { /* ignore */ }
  }

  const checkServer = async (host: HostConfig) => {
    const port = getPort(host.host)
    try {
      const result = await App.CheckIperfServer(host, port)
      setServerStatus(prev => ({ ...prev, [host.host]: result.running }))
      return result
    } catch { return null }
  }

  const startServer = async (host: HostConfig) => {
    const port = getPort(host.host)
    try {
      const result = await App.StartIperfServer(host, port)
      if (result.error) {
        await onShowResults('启动失败', result.error)
        return
      }
      setServerStatus(prev => ({ ...prev, [host.host]: true }))
      onAudit('启动iperf3 server', `${host.host}:${port}`)
    } catch (err) {
      await onShowResults('启动失败', String(err))
    }
  }

  const stopServer = async (host: HostConfig) => {
    const port = getPort(host.host)
    try {
      const result = await App.StopIperfServer(host, port)
      setServerStatus(prev => ({ ...prev, [host.host]: false }))
      onAudit('停止iperf3 server', `${host.host}:${port}`)
    } catch (err) {
      await onShowResults('停止失败', String(err))
    }
  }

  const checkAll = async () => {
    for (const host of hosts) {
      await checkServer(host)
    }
  }

  const checkInstalled = async () => {
    if (hosts.length === 0) return
    try {
      const results = await App.CheckIperfInstalled(hosts)
      const status: Record<string, boolean | null> = {}
      results.forEach((r, i) => {
        status[hosts[i].host] = r.error ? false : true
      })
      setInstallStatus(status)
      onAudit('检查iperf3安装', `${hosts.length} 台主机`)
    } catch { /* ignore */ }
  }

  return (
    <div>
      <div className="manager-header">
        <h2>Server 管理</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-outline btn-sm" onClick={loadHosts}>刷新主机</button>
          <button className="btn btn-outline btn-sm" onClick={checkAll}>批量检查</button>
          <button className="btn btn-outline btn-sm" onClick={checkInstalled}>检查iperf3安装</button>
        </div>
      </div>

      <div style={{ background: '#fef3cd', border: '1px solid #ffc107', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#856404', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600 }}>⚠ 请确保所有主机安装 iperf3 ≥ 3.7</span>
        <span>（低于 3.7 版本不支持 <code style={{ background: '#fff3cd', padding: '1px 4px', borderRadius: 3 }}>--json-stream</code>，实时监控和测试执行将无法工作）</span>
      </div>

      <div className="panel">
        {hosts.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>请先在主机管理中添加主机</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px' }}>主机</th>
                <th style={{ padding: '8px 12px' }}>端口</th>
                <th style={{ padding: '8px 12px' }}>iperf3</th>
                <th style={{ padding: '8px 12px' }}>状态</th>
                <th style={{ padding: '8px 12px' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {hosts.map(host => {
                const isRunning = serverStatus[host.host]
                return (
                  <tr key={host.host} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 12px' }}>{host.user}@{host.host}:{host.port}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <input
                        type="number"
                        value={getPort(host.host)}
                        onChange={e => setHostPorts(prev => ({ ...prev, [host.host]: parseInt(e.target.value) || 5201 }))}
                        style={{ width: 70, fontSize: 13 }}
                      />
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      {installStatus[host.host] === undefined ? (
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>未检查</span>
                      ) : installStatus[host.host] ? (
                        <span style={{ color: '#22c55e' }}>已安装</span>
                      ) : (
                        <span style={{ color: '#ef4444' }}>未安装</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: isRunning ? '#22c55e' : '#9ca3af',
                        marginRight: 6,
                      }} />
                      {isRunning ? '运行中' : '未启动'}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-outline btn-sm" onClick={() => checkServer(host)}>检查</button>
                        {isRunning ? (
                          <button className="btn btn-danger btn-sm" onClick={() => stopServer(host)}>停止</button>
                        ) : (
                          <button className="btn btn-primary btn-sm" onClick={() => startServer(host)}>启动</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
