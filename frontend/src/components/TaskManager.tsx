import { useState, useEffect } from 'react'
import { HostRecord, ExecutionTaskConfig, CheckResult, ActionResult } from '../types'
import * as App from '../wailsjs/go/app/App'

interface Props {
  onAudit: (action: string, details: string) => void
  onShowResults: (title: string, content: string) => Promise<void>
}

export function TaskManager({ onAudit, onShowResults }: Props) {
  const [savedScripts, setSavedScripts] = useState<string[]>([])
  const [executionTasks, setExecutionTasks] = useState<ExecutionTaskConfig[]>([])
  const [hosts, setHosts] = useState<HostRecord[]>([])
  const [executing, setExecuting] = useState(false)
  const [currentTask, setCurrentTask] = useState<string>('')
  const [checkResults, setCheckResults] = useState<CheckResult[]>([])
  const [loadingAction, setLoadingAction] = useState<string>('')

  const [showCreate, setShowCreate] = useState(false)
  const [newTaskName, setNewTaskName] = useState('')
  const [newTaskScripts, setNewTaskScripts] = useState<string[]>([])
  const [newTaskHostIds, setNewTaskHostIds] = useState<number[]>([])

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    let scripts: string[] = []
    let tasks: ExecutionTaskConfig[] = []
    let hostList: HostRecord[] = []
    try { scripts = (await App.GetScripts()) || [] } catch { /* ignore */ }
    try { tasks = (await App.GetExecutionTasks()) || [] } catch { /* ignore */ }
    try { hostList = (await App.GetHosts()) || [] } catch { /* ignore */ }
    setSavedScripts(scripts)
    setExecutionTasks(tasks)
    setHosts(hostList)
    return hostList
  }

  const openCreate = async () => {
    const freshHosts = await loadData()
    setNewTaskName('')
    setNewTaskScripts([])
    setNewTaskHostIds(freshHosts.map((h: any) => h.id))
    setShowCreate(true)
  }

  const confirmCreate = () => {
    if (newTaskScripts.length === 0) return
    const selectedHosts = hosts.filter(h => newTaskHostIds.includes(h.id))
    if (selectedHosts.length === 0) return

    const name = newTaskName.trim() || newTaskScripts.join('+')
    const task: ExecutionTaskConfig = {
      id: `task_${Date.now()}`,
      name,
      scripts: newTaskScripts,
      hosts: selectedHosts.map(h => ({ host: h.host, port: h.port, user: h.user, password: h.password })),
    }
    const newTasks = [...executionTasks, task]
    setExecutionTasks(newTasks)
    App.SaveExecutionTasks(newTasks).catch(() => {})
    onAudit('添加执行任务', `任务: ${name}, 脚本: ${newTaskScripts.length}个, 主机: ${selectedHosts.length}台`)
    setShowCreate(false)
  }

  const toggleScript = (name: string) => {
    setNewTaskScripts(prev => prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name])
  }

  const toggleHost = (id: number) => {
    setNewTaskHostIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
  }

  const removeTask = async (idx: number) => {
    const task = executionTasks[idx]
    const key = `remove:${task.id}`
    try {
      setLoadingAction(key)
      const newTasks = executionTasks.filter((_, i) => i !== idx)
      setExecutionTasks(newTasks)
      await App.SaveExecutionTasks(newTasks)
    } finally {
      setLoadingAction('')
    }
  }

  const preCheck = async (task: ExecutionTaskConfig) => {
    const key = `preCheck:${task.id}`
    try {
      setLoadingAction(key)
      setCurrentTask(task.id)
      const results = await App.PreDeployCheck(task.id, task.hosts)
      setCheckResults(results)
      await onShowResults('预检查结果',
        results.map((r: CheckResult) => `${r.host}: ${r.running ? '⚠ 有运行中的FIO' : r.msg.startsWith('连接失败') ? '✗ 连接失败' : '✓ 空闲'}${r.residual ? ' | 有残留数据' : ''}${r.msg ? '\n  ' + r.msg : ''}`).join('\n\n')
      )
    } catch (err) {
      await onShowResults('预检查失败', `错误: ${err}`)
    } finally {
      setCurrentTask('')
      setLoadingAction('')
    }
  }

  const executeDeploy = async (task: ExecutionTaskConfig) => {
    const key = `deploy:${task.id}`
    setExecuting(true)
    setLoadingAction(key)
    setCurrentTask(task.id)
    onAudit('开始部署', `任务: ${task.id}`)

    try {
      const checks = await App.PreDeployCheck(task.id, task.hosts)
      if (checks.some((c: CheckResult) => c.running)) {
        await onShowResults('预检查发现FIO运行中',
          checks.filter((c: CheckResult) => c.running).map((c: CheckResult) => `${c.host}: ${c.msg}`).join('\n') +
          '\n\n请先停止运行中的FIO或清理残留数据')
        return
      }

      await App.DeployMulti(task.id, task.scripts, task.hosts)
      onAudit('部署完成', `任务: ${task.id}`)

      let finished = false
      let pollCount = 0
      while (!finished && pollCount < 300) {
        await new Promise(resolve => setTimeout(resolve, 10000))
        pollCount++
        const statusResults = await App.CheckStatus(task.id, task.hosts)
        finished = statusResults.every((r: ActionResult) => !r.running)
      }

      const pullResults = await App.PullData(task.id, task.hosts)
      onAudit('数据拉取完成', `任务: ${task.id}`)

      await onShowResults('执行完成',
        `拉取结果:\n${pullResults.map((r: ActionResult) => `${r.host}: ${r.error ? '失败: ' + r.error : '成功'}`).join('\n')}`
      )
    } catch (err) {
      await onShowResults('执行异常', `错误: ${err}`)
    } finally {
      setExecuting(false)
      setLoadingAction('')
      setCurrentTask('')
    }
  }

  const killTask = async (task: ExecutionTaskConfig) => {
    const key = `kill:${task.id}`
    try {
      setLoadingAction(key)
      const results = await App.KillAll(task.id, task.hosts)
      onAudit('停止任务', `任务: ${task.id}`)
      await onShowResults('停止结果',
        results.map((r: ActionResult) => `${r.host}: ${r.error ? '失败: ' + r.error : '成功'}`).join('\n')
      )
    } catch (err) {
      await onShowResults('停止失败', `错误: ${err}`)
    } finally {
      setCheckResults([])
      setLoadingAction('')
    }
  }

  const viewLogs = async (task: ExecutionTaskConfig) => {
    const key = `logs:${task.id}`
    try {
      setLoadingAction(key)
      const log = await App.GetExecutionLog(task.id)
      await onShowResults(`执行日志 - ${task.id}`, log || '暂无日志')
    } catch (err) {
      await onShowResults('日志加载失败', `错误: ${err}`)
    } finally {
      setLoadingAction('')
    }
  }

  const viewHostLogs = async (task: ExecutionTaskConfig) => {
    const key = `hostLogs:${task.id}`
    try {
      setLoadingAction(key)
      const results: string[] = []
      for (const host of task.hosts) {
        const log = await App.GetHostLog(task.id, `${host.user}@${host.host}:${host.port}`)
        results.push(`=== ${host.host} ===\n${log || '暂无日志'}`)
      }
      await onShowResults(`单机日志 - ${task.id}`, results.join('\n\n'))
    } catch (err) {
      await onShowResults('日志加载失败', `错误: ${err}`)
    } finally {
      setLoadingAction('')
    }
  }

  const checkStatus = async (task: ExecutionTaskConfig) => {
    const key = `status:${task.id}`
    try {
      setLoadingAction(key)
      const results = await App.CheckStatus(task.id, task.hosts)
      await onShowResults('运行状态',
        results.map((r: ActionResult) => `${r.host}: ${r.msg || (r.error ? '错误: ' + r.error : '未知')}`).join('\n')
      )
    } catch (err) {
      await onShowResults('状态查询失败', `错误: ${err}`)
    } finally {
      setLoadingAction('')
    }
  }

  const cleanLocal = async (task: ExecutionTaskConfig) => {
    const key = `cleanLocal:${task.id}`
    try {
      setLoadingAction(key)
      await App.CleanLocal(task.id)
      onAudit('清理本地数据', `任务: ${task.id}`)
      await onShowResults('清理完成', `已清理本地任务数据: ${task.id}`)
    } catch (err) {
      await onShowResults('清理失败', `错误: ${err}`)
    } finally {
      setLoadingAction('')
    }
  }

  const cleanRemote = async (task: ExecutionTaskConfig) => {
    const key = `cleanRemote:${task.id}`
    try {
      setLoadingAction(key)
      const results = await App.CleanRemote(task.id, task.hosts)
      onAudit('清理远程数据', `任务: ${task.id}`)
      await onShowResults('清理远程结果',
        results.map((r: ActionResult) => `${r.host}: ${r.error ? '失败: ' + r.error : '成功'}`).join('\n')
      )
    } catch (err) {
      await onShowResults('清理失败', `错误: ${err}`)
    } finally {
      setLoadingAction('')
    }
  }

  return (
    <div>
      <div className="manager-header">
        <h2>任务管理</h2>
      </div>

      {/* 创建任务弹窗 */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>创建任务</h3>
              <button className="modal-close" onClick={() => setShowCreate(false)}>&times;</button>
            </div>
            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              <div className="form-group">
                <label>任务名称</label>
                <input value={newTaskName} placeholder="可选"
                  onChange={(e) => setNewTaskName(e.target.value)} />
              </div>
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ margin: 0 }}>选择脚本 ({newTaskScripts.length}/{savedScripts.length})</label>
                  {savedScripts.length > 0 && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-outline btn-sm" style={{ fontSize: 11, padding: '2px 6px' }}
                        onClick={() => setNewTaskScripts(savedScripts)}>全选</button>
                      <button className="btn btn-outline btn-sm" style={{ fontSize: 11, padding: '2px 6px' }}
                        onClick={() => setNewTaskScripts([])}>全不选</button>
                    </div>
                  )}
                </div>
                {savedScripts.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>暂无脚本，请先在配置模型中保存</p>
                ) : (
                  <div className="checkbox-list" style={{ border: '1px solid #ccc', borderRadius: 8, maxHeight: 200, overflowY: 'auto' }}>
                    {savedScripts.map(s => (
                      <label key={s} className="toggle-label" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 14px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #eee' }}>
                        <input type="checkbox" checked={newTaskScripts.includes(s)}
                          onChange={() => toggleScript(s)} style={{ flexShrink: 0, marginLeft: 2 }} />
                        <span>{s}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ margin: 0 }}>选择主机 ({newTaskHostIds.length}/{hosts.length})</label>
                  {hosts.length > 0 && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-outline btn-sm" style={{ fontSize: 11, padding: '2px 6px' }}
                        onClick={() => setNewTaskHostIds(hosts.map(h => h.id))}>全选</button>
                      <button className="btn btn-outline btn-sm" style={{ fontSize: 11, padding: '2px 6px' }}
                        onClick={() => setNewTaskHostIds([])}>全不选</button>
                    </div>
                  )}
                </div>
                {hosts.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>暂无主机，请先在主机管理中添加</p>
                ) : (
                  <div className="checkbox-list" style={{ border: '1px solid #ccc', borderRadius: 8, maxHeight: 200, overflowY: 'auto' }}>
                    {hosts.map(h => (
                      <label key={h.id} className="toggle-label" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 14px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #eee' }}>
                        <input type="checkbox" checked={newTaskHostIds.includes(h.id)}
                          onChange={() => toggleHost(h.id)} style={{ flexShrink: 0, marginLeft: 2 }} />
                        <span>{h.user}@{h.host}:{h.port}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowCreate(false)}>取消</button>
              <button className="btn btn-primary" onClick={confirmCreate}
                disabled={newTaskScripts.length === 0 || newTaskHostIds.length === 0}>
                确认创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 添加任务按钮 */}
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="section-title" style={{ marginBottom: 0 }}>创建任务</h3>
          <button className="btn btn-primary btn-sm" onClick={openCreate}>添加任务</button>
        </div>
        {(hosts.length === 0 || savedScripts.length === 0) && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            {hosts.length === 0 && '请先在主机管理中添加主机'}
            {hosts.length > 0 && savedScripts.length === 0 && '请先在脚本管理中保存脚本'}
          </p>
        )}
      </div>

      {executionTasks.length > 0 && (
        <div className="panel">
          <h3 className="section-title">执行任务 ({executionTasks.length})</h3>
          {executionTasks.map((task, idx) => (
            <div key={task.id} className="card">
              <div className="card-header">
                <span className="card-title">{task.name} ({(task.scripts || []).length} 脚本, {(task.hosts || []).length} 主机)</span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {(() => {
                    const busy = executing || !!loadingAction
                    const pfx = (action: string) => `${action}:${task.id}`
                    return (
                      <>
                        <button className="btn btn-outline btn-sm" onClick={() => preCheck(task)} disabled={busy}>
                          {loadingAction === pfx('preCheck') ? '检查中...' : '预检查'}
                        </button>
                        <button className="btn btn-primary btn-sm" onClick={() => executeDeploy(task)} disabled={busy}>
                          {loadingAction === pfx('deploy') ? '执行中...' : '执行'}
                        </button>
                        <button className="btn btn-outline btn-sm" onClick={() => checkStatus(task)} disabled={busy}>
                          {loadingAction === pfx('status') ? '查询中...' : '状态'}
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => killTask(task)} disabled={busy}>
                          {loadingAction === pfx('kill') ? '停止中...' : '停止'}
                        </button>
                        <button className="btn btn-outline btn-sm" onClick={() => viewLogs(task)} disabled={busy}>
                          {loadingAction === pfx('logs') ? '加载中...' : '日志'}
                        </button>
                        <button className="btn btn-outline btn-sm" onClick={() => viewHostLogs(task)} disabled={busy}>
                          {loadingAction === pfx('hostLogs') ? '加载中...' : '单机日志'}
                        </button>
                        <button className="btn btn-outline btn-sm" onClick={() => cleanLocal(task)} disabled={busy}>
                          {loadingAction === pfx('cleanLocal') ? '清理中...' : '清理本地'}
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => cleanRemote(task)} disabled={busy}>
                          {loadingAction === pfx('cleanRemote') ? '清理中...' : '清理远程'}
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => removeTask(idx)} disabled={busy}>删除</button>
                      </>
                    )
                  })()}
                </div>
              </div>
              {checkResults.length > 0 && currentTask === task.id && (
                <div style={{ marginTop: 8 }}>
                  {checkResults.map((r, ri) => (
                    <div key={ri} className={`status-line ${r.running || r.msg.startsWith('连接失败') ? 'status-warning' : 'status-ok'}`}>
                      {r.running ? '⚠' : r.msg.startsWith('连接失败') ? '✗' : '✓'} {r.host}: {r.msg}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
