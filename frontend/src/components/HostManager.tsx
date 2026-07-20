import { useState, useEffect } from 'react'
import { HostConfig, HostRecord } from '../types'
import * as App from '../wailsjs/go/app/App'

interface Props {
  onAudit: (action: string, details: string) => void
  onShowResults: (title: string, content: string, wide?: boolean) => Promise<void>
}

export function HostManager({ onAudit, onShowResults }: Props) {
  const [hosts, setHosts] = useState<HostRecord[]>([])
  const [newHost, setNewHost] = useState<HostConfig>({ host: '', port: 22, user: 'root', password: '' })
  const [testing, setTesting] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingHost, setEditingHost] = useState<HostConfig>({ host: '', port: 22, user: 'root', password: '' })
  const [showNewPw, setShowNewPw] = useState(false)
  const [showEditPw, setShowEditPw] = useState(false)

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

  const startEdit = (h: HostRecord) => {
    setEditingId(h.id)
    setEditingHost({ host: h.host, port: h.port, user: h.user, password: h.password })
  }

  const cancelEdit = () => {
    setEditingId(null)
  }

  const saveEdit = async () => {
    if (editingId === null) return
    try {
      await App.UpdateHost(editingId, { ...editingHost })
      setEditingId(null)
      setHosts((await App.GetHosts()) || [])
      onAudit('修改主机', `主机: ${editingHost.host}`)
    } catch (err) {
      await onShowResults('修改失败', `错误: ${err}`)
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
    setTesting(host.id)
    try {
      const result = await App.CheckConnectivity(host)
      await onShowResults('连通性测试', `主机 ${host.host} ${result.ok ? '连接成功' : '连接失败'}:\n${result.msg}`)
      onAudit('测试连通性', `主机: ${host.host}`)
    } catch (err) {
      await onShowResults('测试失败', `主机 ${host.host} 错误: ${err}`)
    } finally {
      setTesting(null)
    }
  }

  const testAllConnectivity = async () => {
    setTesting(-1)
    const results: string[] = []
    for (const host of hosts) {
      try {
        const result = await App.CheckConnectivity(host)
        results.push(`${result.ok ? '✓' : '✗'} ${host.host}: ${result.msg}`)
      } catch (err) {
        results.push(`✗ ${host.host}: 错误 ${err}`)
      }
    }
    await onShowResults('批量连通性测试', results.join('\n'))
    onAudit('批量测试连通性', `测试 ${hosts.length} 台主机`)
    setTesting(null)
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
            <div style={{ position: 'relative' }}>
              <input type={showNewPw ? 'text' : 'password'} value={newHost.password} onChange={(e) => setNewHost({ ...newHost, password: e.target.value })}
                style={{ width: '100%', paddingRight: 28 }} />
              <button type="button" onClick={() => setShowNewPw(!showNewPw)}
                style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
                {showNewPw
                  ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-primary btn-sm" onClick={addHost}>添加</button>
          {hosts.length > 1 && (
            <button className="btn btn-outline btn-sm" onClick={testAllConnectivity} disabled={testing !== null}>
              {testing === -1 ? '测试中...' : '批量测试'}
            </button>
          )}
        </div>
      </div>

      {hosts.length > 0 && (
        <div className="panel">
          <h3 className="section-title">已添加主机 ({hosts.length})</h3>
          {hosts.map((h) => (
            <div key={h.id} className="host-item" style={{ flexWrap: 'wrap', gap: 8 }}>
              {editingId === h.id ? (
                <>
                  <input value={editingHost.host} onChange={e => setEditingHost({ ...editingHost, host: e.target.value })} style={{ width: 120, fontSize: 13 }} placeholder="主机 IP" />
                  <input type="number" value={editingHost.port} onChange={e => setEditingHost({ ...editingHost, port: parseInt(e.target.value) || 22 })} style={{ width: 60, fontSize: 13 }} placeholder="端口" />
                  <input value={editingHost.user} onChange={e => setEditingHost({ ...editingHost, user: e.target.value })} style={{ width: 80, fontSize: 13 }} placeholder="用户名" />
                  <div style={{ position: 'relative' }}>
                    <input type={showEditPw ? 'text' : 'password'} value={editingHost.password} onChange={e => setEditingHost({ ...editingHost, password: e.target.value })} style={{ width: 100, fontSize: 13, paddingRight: 22 }} placeholder="密码" />
                    <button type="button" onClick={() => setShowEditPw(!showEditPw)}
                      style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
                      {showEditPw
                        ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      }
                    </button>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={saveEdit}>保存</button>
                  <button className="btn btn-outline btn-sm" onClick={cancelEdit}>取消</button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontSize: 13 }}>
                    {h.user}@{h.host}:{h.port}
                  </span>
                  <button className="btn btn-outline btn-sm" onClick={() => testConnectivity(h)} disabled={testing !== null}>
                    {testing === h.id ? '测试中...' : '测试'}
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => startEdit(h)}>修改</button>
                  <button className="btn btn-danger btn-sm" onClick={() => removeHost(h.id)}>删除</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
