import { useState, useEffect } from 'react'
import { IperfConfig, IperfTask, HostConfig } from '../../types'
import * as App from '../../wailsjs/go/app/App'

interface Props {
  onAudit: (action: string, details: string) => void
  onShowResults: (title: string, content: string, wide?: boolean) => Promise<void>
}

export function IperfTaskManager({ onAudit, onShowResults }: Props) {
  const [tasks, setTasks] = useState<IperfTask[]>([])
  const [configs, setConfigs] = useState<IperfConfig[]>([])
  const [hosts, setHosts] = useState<HostConfig[]>([])
  const [executing, setExecuting] = useState<Record<string, boolean>>({})
  const [showCreate, setShowCreate] = useState(false)
  const [formName, setFormName] = useState('')
  const [formConfigId, setFormConfigId] = useState('')
  const [formServerHost, setFormServerHost] = useState('')
  const [formClientHosts, setFormClientHosts] = useState<string[]>([])

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      const [t, c, h] = await Promise.all([
        App.GetIperfTasks(),
        App.GetIperfConfigs(),
        App.GetHosts(),
      ])
      setTasks(t || [])
      setConfigs(c || [])
      setHosts(h || [])
    } catch { /* ignore */ }
  }

  const openCreate = () => {
    setFormName('')
    setFormConfigId('')
    setFormServerHost('')
    setFormClientHosts([])
    setShowCreate(true)
  }

  const handleServerChange = (host: string) => {
    setFormServerHost(host)
    setFormClientHosts(prev => prev.filter(h => h !== host))
  }

  const toggleClient = (host: string) => {
    setFormClientHosts(prev =>
      prev.includes(host) ? prev.filter(h => h !== host) : [...prev, host]
    )
  }

  const createTask = async () => {
    if (!formConfigId || !formServerHost || formClientHosts.length === 0) {
      await onShowResults('创建失败', '请选择配置、Server主机和Client主机')
      return
    }
    const config = configs.find(c => c.id === formConfigId)
    const serverHost = hosts.find(h => h.host === formServerHost)
    const clientHosts = hosts.filter(h => formClientHosts.includes(h.host))
    if (!config || !serverHost) return

    const task: IperfTask = {
      id: `iperf-task-${Date.now()}`,
      name: formName || `${config.name} - ${serverHost.host}`,
      config,
      serverHost,
      clientHosts,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }

    try {
      await App.CreateIperfTask(task)
      loadData()
      setShowCreate(false)
      onAudit('创建iperf3任务', task.name)
    } catch (err) {
      await onShowResults('创建失败', String(err))
    }
  }

  const runTask = async (task: IperfTask) => {
    setExecuting(prev => ({ ...prev, [task.id]: true }))
    try {
      await App.RunIperfTest(task.id)
      loadData()
      onAudit('执行iperf3测试', task.name)
    } catch (err) {
      await onShowResults('执行失败', String(err))
    }
    setExecuting(prev => ({ ...prev, [task.id]: false }))
  }

  const stopTask = async (task: IperfTask) => {
    try {
      await App.StopIperfTest(task.id)
      loadData()
      onAudit('停止iperf3测试', task.name)
    } catch (err) {
      await onShowResults('停止失败', String(err))
    }
  }

  const pullData = async (task: IperfTask) => {
    try {
      await App.PullIperfData(task.id)
      loadData()
      onAudit('拉取iperf3数据', task.name)
    } catch (err) {
      await onShowResults('拉取失败', String(err))
    }
  }

  const deleteTask = async (task: IperfTask) => {
    if (!confirm(`确定删除任务 ${task.name}？`)) return
    try {
      await App.DeleteIperfTask(task.id)
      loadData()
      onAudit('删除iperf3任务', task.name)
    } catch { /* ignore */ }
  }

  const cleanLocal = async (task: IperfTask) => {
    try {
      await App.CleanIperfLocal(task.id)
      onAudit('清理本地数据', task.name)
    } catch (err) {
      await onShowResults('清理失败', String(err))
    }
  }

  const cleanRemote = async (task: IperfTask) => {
    if (!confirm(`确定清理远程主机上的 iperf3 数据？`)) return
    try {
      await App.CleanIperfRemote(task.id)
      onAudit('清理远程数据', task.name)
    } catch (err) {
      await onShowResults('清理失败', String(err))
    }
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'running': return '#22c55e'
      case 'completed': return '#3b82f6'
      case 'error': return '#ef4444'
      case 'stopped': return '#f59e0b'
      default: return '#9ca3af'
    }
  }

  return (
    <div>
      <div className="manager-header">
        <h2>任务执行</h2>
        <button className="btn btn-primary btn-sm" onClick={openCreate}>新建任务</button>
      </div>

      <div style={{ background: '#fef3cd', border: '1px solid #ffc107', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#856404', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600 }}>⚠ iperf3 ≥ 3.7</span>
        <span>测试执行与实时监控依赖 <code style={{ background: '#fff3cd', padding: '1px 4px', borderRadius: 3 }}>--json-stream</code>，请确保主机已安装 iperf3 3.7 或更高版本</span>
      </div>

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>新建 iperf3 任务</h3>
              <button className="modal-close" onClick={() => setShowCreate(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>任务名称</label>
                <input value={formName} placeholder="可选，留空自动生成" onChange={e => setFormName(e.target.value)} />
              </div>
              <div className="form-group">
                <label>测试配置</label>
                <select value={formConfigId} onChange={e => setFormConfigId(e.target.value)}>
                  <option value="">请选择</option>
                  {configs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Server 主机</label>
                <select value={formServerHost} onChange={e => handleServerChange(e.target.value)}>
                  <option value="">请选择</option>
                  {hosts.map(h => <option key={h.host} value={h.host}>{h.host}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Client 主机<span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>（不能与 Server 相同）</span></label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {hosts.map(h => {
                    const isServer = h.host === formServerHost
                    const checked = formClientHosts.includes(h.host)
                    return (
                      <label key={h.host} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, opacity: isServer ? 0.4 : 1, cursor: isServer ? 'not-allowed' : 'pointer' }}>
                        <input type="checkbox" checked={checked} disabled={isServer}
                          onChange={() => toggleClient(h.host)} />
                        {h.host}
                        {isServer && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(Server)</span>}
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowCreate(false)}>取消</button>
              <button className="btn btn-primary" onClick={createTask}
                disabled={!formConfigId || !formServerHost || formClientHosts.length === 0}>
                创建任务
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="panel">
        <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>任务列表 ({tasks.length})</h4>
        {tasks.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>暂无任务</p>
        ) : tasks.map(task => (
          <div key={task.id} className="host-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: statusColor(task.status),
              }} />
              <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{task.name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{task.status}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {task.status === 'pending' && (
                  <button className="btn btn-primary btn-sm" onClick={() => runTask(task)} disabled={executing[task.id]}>
                    {executing[task.id] ? '启动中...' : '执行'}
                  </button>
                )}
                {task.status === 'running' && (
                  <button className="btn btn-danger btn-sm" onClick={() => stopTask(task)}>停止</button>
                )}
                {task.status !== 'running' && task.status !== 'pending' && (
                  <button className="btn btn-outline btn-sm" onClick={() => pullData(task)}>拉取数据</button>
                )}
                {task.status !== 'running' && task.status !== 'pending' && (
                  <>
                    <button className="btn btn-outline btn-sm" onClick={() => cleanLocal(task)}>清理本地</button>
                    <button className="btn btn-outline btn-sm" onClick={() => cleanRemote(task)}>清理远程</button>
                  </>
                )}
                <button className="btn btn-danger btn-sm" onClick={() => deleteTask(task)}>删除</button>
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 16 }}>
              <span>Server: {task.serverHost.host}</span>
              <span>Clients: {task.clientHosts.map(h => h.host).join(', ')}</span>
              <span>协议: {task.config.protocol.toUpperCase()}</span>
              <span>时长: {task.config.duration}s</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
