import { useState, useEffect } from 'react'
import { HostRecord, ExecutionTaskConfig, CheckResult, ActionResult } from '../types'
import * as App from '../wailsjs/go/app/App'

interface Props {
  scriptName: string
  onAudit: (action: string, details: string) => void
  onShowResults: (title: string, content: string) => Promise<void>
}

export function TaskManager({ scriptName, onAudit, onShowResults }: Props) {
  const [savedScripts, setSavedScripts] = useState<string[]>([])
  const [executionTasks, setExecutionTasks] = useState<ExecutionTaskConfig[]>([])
  const [hosts, setHosts] = useState<HostRecord[]>([])
  const [selectedScript, setSelectedScript] = useState(scriptName)
  const [executing, setExecuting] = useState(false)
  const [currentTask, setCurrentTask] = useState<string>('')
  const [checkResults, setCheckResults] = useState<CheckResult[]>([])
  const [executionLogs, setExecutionLogs] = useState<string[]>([])

  useEffect(() => { loadData() }, [])

  useEffect(() => { setSelectedScript(scriptName) }, [scriptName])

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

  const addExecutionTask = () => {
    const task: ExecutionTaskConfig = {
      id: `task_${Date.now()}`,
      name: selectedScript,
      script: selectedScript,
      hosts: hosts.map(h => ({ host: h.host, port: h.port, user: h.user, password: h.password })),
    }
    const newTasks = [...executionTasks, task]
    setExecutionTasks(newTasks)
    App.SaveExecutionTasks(newTasks).catch(() => {})
    onAudit('添加执行任务', `任务: ${task.id}`)
  }

  const removeTask = (idx: number) => {
    const newTasks = executionTasks.filter((_, i) => i !== idx)
    setExecutionTasks(newTasks)
    App.SaveExecutionTasks(newTasks).catch(() => {})
  }

  const preCheck = async (task: ExecutionTaskConfig) => {
    try {
      setCurrentTask(task.id)
      const results = await App.PreDeployCheck(task.id, task.hosts)
      setCheckResults(results)
      await onShowResults('预检查结果',
        results.map((r: CheckResult) => `${r.host}: ${r.running ? '⚠ 有运行中的FIO' : '✓ 空闲'}${r.residual ? ' | 有残留数据' : ''}${r.msg ? '\n  ' + r.msg : ''}`).join('\n\n')
      )
      setCurrentTask('')
    } catch (err) {
      await onShowResults('预检查失败', `错误: ${err}`)
      setCurrentTask('')
    }
  }

  const executeDeploy = async (task: ExecutionTaskConfig) => {
    setExecuting(true)
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

      await App.Deploy(task.id, task.script, task.hosts)
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

      const log = await App.GetExecutionLog(task.id)
      setExecutionLogs(prev => [...prev, log])

      await onShowResults('执行完成',
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
    try {
      const results = await App.KillAll(task.id, task.hosts)
      onAudit('停止任务', `任务: ${task.id}`)
      await onShowResults('停止结果',
        results.map((r: ActionResult) => `${r.host}: ${r.error ? '失败: ' + r.error : '成功'}`).join('\n')
      )
    } catch (err) {
      await onShowResults('停止失败', `错误: ${err}`)
    } finally {
      setCheckResults([])
    }
  }

  const viewLogs = async (task: ExecutionTaskConfig) => {
    try {
      const log = await App.GetExecutionLog(task.id)
      await onShowResults(`执行日志 - ${task.id}`, log || '暂无日志')
    } catch (err) {
      await onShowResults('日志加载失败', `错误: ${err}`)
    }
  }

  const viewHostLogs = async (task: ExecutionTaskConfig) => {
    try {
      const results: string[] = []
      for (const host of task.hosts) {
        const log = await App.GetHostLog(task.id, `${host.user}@${host.host}:${host.port}`)
        results.push(`=== ${host.host} ===\n${log || '暂无日志'}`)
      }
      await onShowResults(`单机日志 - ${task.id}`, results.join('\n\n'))
    } catch (err) {
      await onShowResults('日志加载失败', `错误: ${err}`)
    }
  }

  const checkStatus = async (task: ExecutionTaskConfig) => {
    try {
      const results = await App.CheckStatus(task.id, task.hosts)
      await onShowResults('运行状态',
        results.map((r: ActionResult) => `${r.host}: ${r.msg || (r.error ? '错误: ' + r.error : '未知')}`).join('\n')
      )
    } catch (err) {
      await onShowResults('状态查询失败', `错误: ${err}`)
    }
  }

  const cleanLocal = async (task: ExecutionTaskConfig) => {
    try {
      await App.CleanLocal(task.id)
      onAudit('清理本地数据', `任务: ${task.id}`)
      await onShowResults('清理完成', `已清理本地任务数据: ${task.id}`)
    } catch (err) {
      await onShowResults('清理失败', `错误: ${err}`)
    }
  }

  const cleanRemote = async (task: ExecutionTaskConfig) => {
    try {
      const results = await App.CleanRemote(task.id, task.hosts)
      onAudit('清理远程数据', `任务: ${task.id}`)
      await onShowResults('清理远程结果',
        results.map((r: ActionResult) => `${r.host}: ${r.error ? '失败: ' + r.error : '成功'}`).join('\n')
      )
    } catch (err) {
      await onShowResults('清理失败', `错误: ${err}`)
    }
  }

  return (
    <div>
      <div className="manager-header">
        <h2>任务管理</h2>
      </div>

      <div className="panel">
        <h3 className="section-title">创建任务</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={selectedScript} onChange={(e) => setSelectedScript(e.target.value)}>
            {savedScripts.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" onClick={addExecutionTask} disabled={hosts.length === 0}>
            添加任务
          </button>
        </div>
        {hosts.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>请先在主机管理中添加主机</p>
        )}
      </div>

      {executionTasks.length > 0 && (
        <div className="panel">
          <h3 className="section-title">执行任务 ({executionTasks.length})</h3>
          {executionTasks.map((task, idx) => (
            <div key={task.id} className="card">
              <div className="card-header">
                <span className="card-title">{task.name} ({task.hosts.length} 台主机)</span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => preCheck(task)} disabled={executing}>预检查</button>
                  <button className="btn btn-primary btn-sm" onClick={() => executeDeploy(task)} disabled={executing}>
                    {currentTask === task.id ? '执行中...' : '执行'}
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => checkStatus(task)} disabled={executing}>状态</button>
                  <button className="btn btn-danger btn-sm" onClick={() => killTask(task)}>停止</button>
                  <button className="btn btn-outline btn-sm" onClick={() => viewLogs(task)}>日志</button>
                  <button className="btn btn-outline btn-sm" onClick={() => viewHostLogs(task)}>单机日志</button>
                  <button className="btn btn-outline btn-sm" onClick={() => cleanLocal(task)}>清理本地</button>
                  <button className="btn btn-danger btn-sm" onClick={() => cleanRemote(task)}>清理远程</button>
                  <button className="btn btn-danger btn-sm" onClick={() => removeTask(idx)}>删除</button>
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
          ))}
        </div>
      )}

      {executionLogs.length > 0 && (
        <div className="panel">
          <h3 className="section-title">执行日志</h3>
          {executionLogs.map((log, idx) => (
            <pre key={idx} className="code-preview" style={{ maxHeight: 200 }}>{log}</pre>
          ))}
        </div>
      )}
    </div>
  )
}
