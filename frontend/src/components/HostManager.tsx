import { useState, useEffect } from 'react'
import { HostConfig, HostRecord } from '../types'
import * as App from '../wailsjs/go/app/App'

interface Props {
  onAudit: (action: string, details: string) => void
  onShowResults: (title: string, content: string) => Promise<void>
}

export function HostManager({ onAudit, onShowResults }: Props) {
  const [hosts, setHosts] = useState<HostRecord[]>([])
  const [newHost, setNewHost] = useState<HostConfig>({ host: '', port: 22, user: 'root', password: '' })

  useEffect(() => { loadHosts() }, [])

  const loadHosts = async () => {
    try { setHosts((await App.GetHosts()) || []) } catch { /* ignore */ }
  }

  const addHost = async () => {
    if (!newHost.host.trim()) return
    try {
      await App.AddHost({ ...newHost })
      setNewHost({ host: '', port: 22, user: 'root', password: '' })
      setHosts((await App.GetHosts()) || [])
      onAudit('添加主机', `主机: ${newHost.host}`)
    } catch (err) {
      await onShowResults('添加失败', `错误: ${err}`)
    }
  }

  const removeHost = async (id: number) => {
    try {
      await App.DeleteHost(id)
      setHosts((await App.GetHosts()) || [])
      onAudit('删除主机', `ID: ${id}`)
    } catch (err) {
      await onShowResults('删除失败', `错误: ${err}`)
    }
  }

  const testConnectivity = async (host: HostRecord) => {
    const [ok, msg] = await App.CheckConnectivity(host)
    await onShowResults('连通性测试', `主机 ${host.host} ${ok ? '连接成功' : '连接失败'}:\n${msg}`)
    onAudit('测试连通性', `主机: ${host.host}`)
  }

  const testAllConnectivity = async () => {
    const results: string[] = []
    for (const host of hosts) {
      const [ok, msg] = await App.CheckConnectivity(host)
      results.push(`${ok ? '✓' : '✗'} ${host.host}: ${msg}`)
    }
    await onShowResults('批量连通性测试', results.join('\n'))
    onAudit('批量测试连通性', `测试 ${hosts.length} 台主机`)
  }

  return (
    <div>
      <div className="manager-header">
        <h2>主机管理</h2>
      </div>

      <div className="panel">
        <h3 className="section-title">添加主机</h3>
        <div className="form-row">
          <div className="form-group">
            <label>主机 IP</label>
            <input value={newHost.host} onChange={(e) => setNewHost({ ...newHost, host: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') addHost() }} />
          </div>
          <div className="form-group">
            <label>SSH 端口</label>
            <input type="number" value={newHost.port} onChange={(e) => setNewHost({ ...newHost, port: parseInt(e.target.value) || 22 })} />
          </div>
          <div className="form-group">
            <label>用户名</label>
            <input value={newHost.user} onChange={(e) => setNewHost({ ...newHost, user: e.target.value })} />
          </div>
          <div className="form-group">
            <label>密码</label>
            <input type="password" value={newHost.password} onChange={(e) => setNewHost({ ...newHost, password: e.target.value })} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={addHost}>添加</button>
          {hosts.length > 1 && (
            <button className="btn btn-outline btn-sm" onClick={testAllConnectivity}>批量测试</button>
          )}
        </div>
      </div>

      {hosts.length > 0 && (
        <div className="panel">
          <h3 className="section-title">已添加主机 ({hosts.length})</h3>
          {hosts.map((h) => (
            <div key={h.id} className="host-item">
              <span style={{ flex: 1, fontSize: 13 }}>
                {h.user}@{h.host}:{h.port}
              </span>
              <button className="btn btn-outline btn-sm" onClick={() => testConnectivity(h)}>测试</button>
              <button className="btn btn-danger btn-sm" onClick={() => removeHost(h.id)}>删除</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
