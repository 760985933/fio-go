import { useState, useEffect } from 'react'
import { HostConfig, HostRecord, ExecutionTaskConfig, CheckResult, ActionResult } from '../types'
import * as App from '../wailsjs/go/app/App'

interface Props {
  scriptName: string
  onScriptNameChange: (name: string) => void
  onAudit: (action: string, details: string) => void
  onShowResults: (title: string, content: string) => Promise<void>
}

export function ExecutionManager({ scriptName, onScriptNameChange, onAudit, onShowResults }: Props) {
  const [savedScripts, setSavedScripts] = useState<string[]>([])
  const [executionTasks, setExecutionTasks] = useState<ExecutionTaskConfig[]>([])
  const [hosts, setHosts] = useState<HostRecord[]>([])
  const [activeTab, setActiveTab] = useState<'hosts' | 'tasks'>('hosts')
  const [executing, setExecuting] = useState(false)
  const [currentTask, setCurrentTask] = useState<string>('')
  const [checkResults, setCheckResults] = useState<CheckResult[]>([])
  const [executionLogs, setExecutionLogs] = useState<string[]>([])

  // 新增 Host 表单
  const [newHost, setNewHost] = useState<HostConfig>({ host: '', port: 22, user: 'root', password: '' })

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      const [scripts, tasks, hostList] = await Promise.all([
        App.GetScripts(),
        App.GetExecutionTasks(),
        App.GetHosts(),
      ])
      setSavedScripts(scripts || [])
      setExecutionTasks(tasks || [])
      setHosts(hostList || [])
    } catch { /* ignore */ }
  }

  const addHost = async () => {
    if (!newHost.host.trim()) return
    try {
      await App.AddHost({ ...newHost })
      setNewHost({ host: '', port: 22, user: 'root', password: '' })
      const hostList = await App.GetHosts()
      setHosts(hostList || [])
      onAudit('添加主机', `主机: ${newHost.host}`)
    } catch (err) {
      await onShowResults('添加失败', `错误: ${err}`)
    }
  }

  const removeHost = async (id: number) => {
    try {
      await App.DeleteHost(id)
      const hostList = await App.GetHosts()
      setHosts(hostList || [])
      onAudit('删除主机', `ID: ${id}`)
    } catch (err) {
      await onShowResults('删除失败', `错误: ${err}`)
    }
  }

  const testConnectivity = async (host: HostConfig) => {
    const [ok, msg] = await App.CheckConnectivity(host)
    if (ok) {
      await onShowResults('连通性测试', `主机 ${host.host} 连接成功:\n${msg}`)
    } else {
      await onShowResults('连通性测试', `主机 ${host.host} 连接失败:\n${msg}`)
    }
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

  const addExecutionTask = () => {
    const task: ExecutionTaskConfig = {
      id: `task_${Date.now()}`,
      name: scriptName,
      script: scriptName,
      hosts: hosts.map(h => ({ host: h.host, port: h.port, user: h.user, password: h.password })),
    }
    setExecutionTasks([...executionTasks, task])
    App.SaveExecutionTasks([...executionTasks, task]).catch(() => {})
    onAudit('添加执行任务', `任务: ${task.id}`)
  }

  const removeTask = (idx: number) => {
    const newTasks = executionTasks.filter((_, i) => i !== idx)
    setExecutionTasks(newTasks)
    App.SaveExecutionTasks(newTasks).catch(() => {})
  }

  const preCheck = async (task: ExecutionTaskConfig) => {
    setCurrentTask(task.id)
    const results = await App.PreDeployCheck(task.id, task.hosts)
    setCheckResults(results)
    await onShowResults('预检查结果',
      results.map((r: CheckResult) => `${r.host}: ${r.running ? '⚠ 有运行中的FIO' : '✓ 空闲'}${r.residual ? ' | 有残留数据' : ''}${r.msg ? '\n  ' + r.msg : ''}`).join('\n\n')
    )
    setCurrentTask('')
  }

  const executeDeploy = async (task: ExecutionTaskConfig) => {
    setExecuting(true)
    setCurrentTask(task.id)
    onAudit('开始部署', `任务: ${task.id}`)

    try {
      // 1. Pre-check
      const checks = await App.PreDeployCheck(task.id, task.hosts)
      const hasRunning = checks.some((c: CheckResult) => c.running)
      if (hasRunning) {
        await onShowResults('预检查发现FIO运行中',
          checks.filter((c: CheckResult) => c.running).map((c: CheckResult) => `${c.host}: ${c.msg}`).join('\n') +
          '\n\n请先停止运行中的FIO或清理残留数据')
        return
      }

      // 2. Deploy
      const deployResults = await App.Deploy(task.id, task.script, task.hosts)
      onAudit('部署完成', `任务: ${task.id}`)

      // 3. Poll until all hosts finish
      let finished = false
      let pollCount = 0
      while (!finished && pollCount < 300) { // max 50 minutes
        await new Promise(resolve => setTimeout(resolve, 10000))
        pollCount++
        const statusResults = await App.CheckStatus(task.id, task.hosts)
        finished = true
        for (const r of statusResults) {
          if (r.running) {
            finished = false
            break
          }
        }
      }

      // 4. Pull results
      const pullResults = await App.PullData(task.id, task.hosts)
      onAudit('数据拉取完成', `任务: ${task.id}`)

      // 5. Get logs
      const log = await App.GetExecutionLog(task.id)
      setExecutionLogs(prev => [...prev, log])

      await onShowResults('执行完成',
        `部署结果:\n${deployResults.map((r: ActionResult) => `${r.host}: ${r.error ? '失败: ' + r.error : '成功'}`).join('\n')}\n\n` +
        `拉取结果:\n${pullResults.map((r: ActionResult) => `${r.host}: ${r.error ? '失败: ' + r.error : '成功'}`).join('\n')}`
      )
    } catch (err) {
      await onShowResults('执行异常', `错误: ${err}`)
    } finally {
      setExecuting(false)
      setCurrentTask('')
    }
  }

  const killTask = async (task: ExecutionTaskConfig) => {
    const results = await App.KillAll(task.id, task.hosts)
    onAudit('停止任务', `任务: ${task.id}`)
    await onShowResults('停止结果',
      results.map((r: ActionResult) => `${r.host}: ${r.error ? '失败: ' + r.error : '成功'}`).join('\n')
    )
  }

  const viewLogs = async (task: ExecutionTaskConfig) => {
    const log = await App.GetExecutionLog(task.id)
    await onShowResults(`执行日志 - ${task.id}`, log || '暂无日志')
  }

  const viewHostLogs = async (task: ExecutionTaskConfig) => {
    const results: string[] = []
    for (const host of task.hosts) {
      const log = await App.GetHostLog(task.id, `${host.user}@${host.host}:${host.port}`)
      results.push(`=== ${host.host} ===\n${log || '暂无日志'}`)
    }
    await onShowResults(`单机日志 - ${task.id}`, results.join('\n\n'))
  }

  const checkStatus = async (task: ExecutionTaskConfig) => {
    const results = await App.CheckStatus(task.id, task.hosts)
    await onShowResults('运行状态',
      results.map((r: ActionResult) => `${r.host}: ${r.msg || (r.error ? '错误: ' + r.error : '未知')}`).join('\n')
    )
  }

  const cleanLocal = async (task: ExecutionTaskConfig) => {
    await App.CleanLocal(task.id)
    onAudit('清理本地数据', `任务: ${task.id}`)
    await onShowResults('清理完成', `已清理本地任务数据: ${task.id}`)
  }

  const cleanRemote = async (task: ExecutionTaskConfig) => {
    const results = await App.CleanRemote(task.id, task.hosts)
    onAudit('清理远程数据', `任务: ${task.id}`)
    await onShowResults('清理远程结果',
      results.map((r: ActionResult) => `${r.host}: ${r.error ? '失败: ' + r.error : '成功'}`).join('\n')
    )
  }

  return (
    <div>
      <div className="tab-bar">
        <button className={`tab ${activeTab === 'hosts' ? 'active' : ''}`} onClick={() => setActiveTab('hosts')}>
          主机管理 ({hosts.length})
        </button>
        <button className={`tab ${activeTab === 'tasks' ? 'active' : ''}`} onClick={() => setActiveTab('tasks')}>
          执行任务 ({executionTasks.length})
        </button>
      </div>

      {activeTab === 'hosts' && (
        <div>
          <div className="panel">
            <h3 style={{ marginBottom: 12, fontSize: 14, color: '#4f46e5' }}>添加主机</h3>
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
                <button className="btn btn-outline btn-sm" onClick={testAllConnectivity}>批量测试连通性</button>
              )}
            </div>
          </div>

          {hosts.length > 0 && (
            <div className="panel" style={{ marginTop: 12 }}>
              <h3 style={{ marginBottom: 12, fontSize: 14, color: '#4f46e5' }}>已添加主机 ({hosts.length})</h3>
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
      )}

      {activeTab === 'tasks' && (
        <div>
          <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={scriptName} onChange={(e) => onScriptNameChange(e.target.value)}>
              {savedScripts.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="btn btn-primary btn-sm" onClick={addExecutionTask} disabled={hosts.length === 0}>
              添加任务
            </button>
          </div>

          {executionTasks.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: 13 }}>暂无执行任务</p>
          ) : (
            executionTasks.map((task, idx) => (
              <div key={task.id} className="card">
                <div className="card-header">
                  <span className="card-title">{task.name} ({task.hosts.length} 台主机)</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-outline btn-sm" onClick={() => preCheck(task)} disabled={executing}>
                      预检查
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={() => executeDeploy(task)} disabled={executing}>
                      {currentTask === task.id ? '执行中...' : '执行'}
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => checkStatus(task)} disabled={executing}>
                      状态
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => killTask(task)}>
                      停止
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => viewLogs(task)}>
                      日志
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => viewHostLogs(task)}>
                      单机日志
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => cleanLocal(task)}>
                      清理本地
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => cleanRemote(task)}>
                      清理远程
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => removeTask(idx)}>
                      删除
                    </button>
                  </div>
                </div>
                {checkResults.length > 0 && currentTask === task.id && (
                  <div style={{ marginTop: 8 }}>
                    {checkResults.map((r, ri) => (
                      <div key={ri} className={`status-line ${r.running ? 'status-warning' : 'status-ok'}`}>
                        {r.running ? '⚠' : '✓'} {r.host}: {r.msg}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}

          {executionLogs.length > 0 && (
            <div className="panel" style={{ marginTop: 12 }}>
              <h3 style={{ marginBottom: 8, fontSize: 14, color: '#4f46e5' }}>执行日志</h3>
              {executionLogs.map((log, idx) => (
                <pre key={idx} className="code-preview" style={{ maxHeight: 200 }}>{log}</pre>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
