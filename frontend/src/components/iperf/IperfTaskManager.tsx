import { useState, useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { IperfConfig, IperfTask, HostConfig } from '../../types'
import * as App from '../../wailsjs/go/app/App'
import { ConfirmDialog } from '../ConfirmDialog'

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
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmTask, setConfirmTask] = useState<IperfTask | null>(null)
  const [confirmType, setConfirmType] = useState<'delete' | 'cleanRemote'>('delete')
  const [progressOpen, setProgressOpen] = useState(false)
  const [progressTitle, setProgressTitle] = useState('')
  type StepStatus = 'pending' | 'running' | 'ok' | 'error'
  const [progressSteps, setProgressSteps] = useState<{ key: string; label: string; status: StepStatus; detail?: string }[]>([])

  const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
  const setStep = (key: string, status: StepStatus, detail?: string) => {
    setProgressSteps(prev => prev.map(s => s.key === key ? { ...s, status, detail: detail ?? s.detail } : s))
  }
  const setRunningStepError = (msg: string) => {
    setProgressSteps(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'error', detail: msg } : s))
  }

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

  // 定时探测任务运行状态：仅当存在"运行中"任务时才刷新，使测试在客户端服务结束后
  // 能自动从「停止」按钮过渡到执行后状态（completed/stopped），而无需手动刷新页面。
  const tasksRef = useRef<IperfTask[]>([])
  useEffect(() => { tasksRef.current = tasks }, [tasks])
  useEffect(() => {
    const id = window.setInterval(() => {
      if (tasksRef.current.some(t => t.status === 'running')) {
        loadData()
      }
    }, 3000)
    return () => clearInterval(id)
  }, [])

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
    // 端口与后端 RunIperfTest 保持一致：优先使用任务配置中的端口，未配置则默认 5201
    const port = task.config.port && task.config.port > 0 ? task.config.port : 5201
    const hosts = [task.serverHost, ...task.clientHosts]
    setExecuting(prev => ({ ...prev, [task.id]: true }))
    setProgressTitle(`执行任务：${task.name}`)
    setProgressSteps([
      { key: 'install', label: '检查 SSH 连接与 iperf3 安装', status: 'running' },
      { key: 'server', label: '启动并校验 iperf3 server 监听', status: 'pending' },
      { key: 'client', label: '启动客户端并确认连接', status: 'pending' },
    ])
    setProgressOpen(true)

    try {
      // 阶段1：所有主机的 SSH 连通性 + iperf3 是否安装
      const installRes = await App.CheckIperfInstalled(hosts)
      const bad = installRes.filter(r => r.error)
      if (bad.length > 0) {
        setStep('install', 'error', bad.map(b => `${b.host}: ${b.error}`).join('；'))
        setExecuting(prev => ({ ...prev, [task.id]: false }))
        loadData()
        return
      }
      setStep('install', 'ok', '所有主机 SSH 可达且已安装 iperf3')

      // 阶段2：确保 server 已启动并真正在监听
      setStep('server', 'running')
      let srv = await App.CheckIperfServer(task.serverHost, port)
      if (srv.error || !srv.running) {
        const start = await App.StartIperfServer(task.serverHost, port)
        if (start.error) {
          setStep('server', 'error', start.error)
          setExecuting(prev => ({ ...prev, [task.id]: false }))
          loadData()
          return
        }
        await sleep(800)
        srv = await App.CheckIperfServer(task.serverHost, port)
        if (!srv.running) {
          setStep('server', 'error', `server 启动后端口 ${port} 未在监听，请检查防火墙/端口占用`)
          setExecuting(prev => ({ ...prev, [task.id]: false }))
          loadData()
          return
        }
      }
      setStep('server', 'ok', `server 正常监听（端口 ${port}）`)

      // 阶段3：启动客户端并等待连接确认（RunIperfTest 内部会校验每个 client 是否真连上）
      setStep('client', 'running')
      await App.RunIperfTest(task.id)
      setStep('client', 'ok', '客户端已连接 server，测试进行中')
      setExecuting(prev => ({ ...prev, [task.id]: false }))
      loadData()
      onAudit('执行iperf3测试', task.name)
      setTimeout(() => setProgressOpen(false), 1500)
    } catch (err) {
      setRunningStepError(String(err))
      setExecuting(prev => ({ ...prev, [task.id]: false }))
      loadData()
    }
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

  const viewLog = async (task: IperfTask) => {
    try {
      const log = await App.GetIperfTaskLog(task.id)
      await onShowResults(`执行日志 - ${task.name}`, log && log.trim() ? log : '[无日志内容]', true)
      onAudit('查看iperf3执行日志', task.name)
    } catch (err) {
      await onShowResults('查看日志失败', String(err), true)
    }
  }

  const askDelete = (task: IperfTask) => {
    setConfirmTask(task)
    setConfirmType('delete')
    setConfirmOpen(true)
  }

  const cleanLocal = async (task: IperfTask) => {
    try {
      await App.CleanIperfLocal(task.id)
      onAudit('清理本地数据', task.name)
    } catch (err) {
      await onShowResults('清理失败', String(err))
    }
  }

  const askCleanRemote = (task: IperfTask) => {
    setConfirmTask(task)
    setConfirmType('cleanRemote')
    setConfirmOpen(true)
  }

  const confirmAction = async () => {
    const task = confirmTask
    setConfirmOpen(false)
    if (!task) return
    if (confirmType === 'delete') {
      try {
        await App.DeleteIperfTask(task.id)
        loadData()
        onAudit('删除iperf3任务', task.name)
      } catch { /* ignore */ }
    } else {
      try {
        await App.CleanIperfRemote(task.id)
        onAudit('清理远程数据', task.name)
      } catch (err) {
        await onShowResults('清理失败', String(err))
      }
    }
    setConfirmTask(null)
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

  // 状态标签（pill）样式：浅色底 + 同色文字/边框，按状态着色
  const statusTagStyle = (status: string): CSSProperties => {
    const color = statusColor(status)
    return {
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 600,
      lineHeight: 1.5,
      whiteSpace: 'nowrap',
      color,
      background: color + '1a',   // 约 10% 透明度底色
      border: `1px solid ${color}55`, // 约 33% 透明度边框
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
                <div className="checkbox-list">
                  {hosts.map(h => {
                    const isServer = h.host === formServerHost
                    const checked = formClientHosts.includes(h.host)
                    return (
                      <label
                        key={h.host}
                        className="toggle-label"
                        style={{
                          opacity: isServer ? 0.45 : 1,
                          cursor: isServer ? 'not-allowed' : 'pointer',
                          fontWeight: checked && !isServer ? 500 : 400,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isServer}
                          onChange={() => toggleClient(h.host)}
                        />
                        <span>{h.host}</span>
                        {isServer && (
                          <span style={{ flex: '0 0 auto', fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>(Server)</span>
                        )}
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
              <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{task.name}</span>
              <span style={statusTagStyle(task.status)}>{task.status}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {task.status !== 'running' && (
                  <button className="btn btn-primary btn-sm" onClick={() => runTask(task)} disabled={executing[task.id]}>
                    {executing[task.id] ? '启动中...' : (task.status === 'pending' ? '执行' : '重新执行')}
                  </button>
                )}
                {task.status === 'running' && (
                  <button className="btn btn-danger btn-sm" onClick={() => stopTask(task)}>停止</button>
                )}
                {task.status !== 'pending' && (
                  <button className="btn btn-outline btn-sm" onClick={() => viewLog(task)}>日志查看</button>
                )}
                {task.status !== 'running' && task.status !== 'pending' && (
                  <button className="btn btn-outline btn-sm" onClick={() => pullData(task)}>拉取数据</button>
                )}
                {task.status !== 'running' && task.status !== 'pending' && (
                  <>
                    <button className="btn btn-outline btn-sm" onClick={() => cleanLocal(task)}>清理本地</button>
                    <button className="btn btn-outline btn-sm" onClick={() => askCleanRemote(task)}>清理远程</button>
                  </>
                )}
                <button className="btn btn-danger btn-sm" onClick={() => askDelete(task)}>删除</button>
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 16 }}>
              <span>
                Server（测试IP）: {task.config.serverTestIP || task.serverHost.host}
                {task.config.serverTestIP && task.config.serverTestIP !== task.serverHost.host && (
                  <span style={{ color: 'var(--text-muted)' }}>（连接主机: {task.serverHost.host}）</span>
                )}
              </span>
              <span>Clients: {task.clientHosts.map(h => h.host).join(', ')}</span>
              <span>协议: {task.config.protocol.toUpperCase()}</span>
              <span>时长: {task.config.duration}s</span>
            </div>
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title={confirmType === 'delete' ? '删除任务' : '清理远程数据'}
        message={confirmType === 'delete'
          ? `确定删除任务 ${confirmTask?.name}？此操作不可恢复。`
          : '确定清理远程主机上的 iperf3 数据？'}
        confirmText={confirmType === 'delete' ? '删除' : '清理'}
        danger={confirmType === 'delete'}
        onConfirm={confirmAction}
        onCancel={() => { setConfirmOpen(false); setConfirmTask(null) }}
      />

      {progressOpen && (
        <div className="modal-overlay" style={{ cursor: 'default' }} onClick={e => e.stopPropagation()}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h3>{progressTitle}</h3>
            </div>
            <div className="modal-body">
              {progressSteps.map(s => {
                const icon = s.status === 'ok' ? '✓' : s.status === 'error' ? '✕' : s.status === 'running' ? '◌' : '○'
                const color = s.status === 'ok' ? 'var(--success)' : s.status === 'error' ? 'var(--danger)' : s.status === 'running' ? 'var(--primary)' : 'var(--text-muted)'
                return (
                  <div key={s.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ flexShrink: 0, width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color }}>{icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: s.status === 'error' ? 'var(--danger)' : s.status === 'ok' ? 'var(--success)' : 'var(--text)' }}>{s.label}</div>
                      {s.detail && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{s.detail}</div>}
                    </div>
                  </div>
                )
              })}
              {progressSteps.length > 0 && progressSteps.every(s => s.status === 'ok') && (
                <div style={{ marginTop: 12, fontSize: 13, color: 'var(--success)', fontWeight: 600 }}>
                  ✅ 执行成功，可切换到「实时监控」页面查看带宽 / 抖动
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setProgressOpen(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
