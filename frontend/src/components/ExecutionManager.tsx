import { useState } from 'react'
import { ExecutionTaskConfig, HostConfig, ActionResult, FioConfig } from '../types'
import { generateFioText } from '../utils/fioGenerator'

interface Props {
  tasks: ExecutionTaskConfig[]
  onTasksChange: (tasks: ExecutionTaskConfig[]) => void
  config: FioConfig
  configName: string
  onAudit: (action: string, details: string) => void
}

export function ExecutionManager({ tasks, onTasksChange, config, configName, onAudit }: Props) {
  const [expandedTask, setExpandedTask] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, ActionResult[]>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [logs, setLogs] = useState<Record<string, string>>({})

  const addTask = () => {
    const newTask: ExecutionTaskConfig = {
      id: `task-${Date.now()}`,
      name: `任务 ${tasks.length + 1}`,
      script: '',
      hosts: [{ host: '127.0.0.1', port: 22, user: 'root', password: '' }],
    }
    onTasksChange([...tasks, newTask])
  }

  const updateTask = (idx: number, updates: Partial<ExecutionTaskConfig>) => {
    const newTasks = [...tasks]
    newTasks[idx] = { ...newTasks[idx], ...updates }
    onTasksChange(newTasks)
  }

  const deleteTask = (idx: number) => {
    onTasksChange(tasks.filter((_, i) => i !== idx))
  }

  const addHost = (taskIdx: number) => {
    const newHost: HostConfig = { host: '', port: 22, user: 'root', password: '' }
    updateTask(taskIdx, {
      hosts: [...tasks[taskIdx].hosts, newHost],
    })
  }

  const updateHost = (taskIdx: number, hostIdx: number, updates: Partial<HostConfig>) => {
    const newHosts = [...tasks[taskIdx].hosts]
    newHosts[hostIdx] = { ...newHosts[hostIdx], ...updates }
    updateTask(taskIdx, { hosts: newHosts })
  }

  const removeHost = (taskIdx: number, hostIdx: number) => {
    updateTask(taskIdx, {
      hosts: tasks[taskIdx].hosts.filter((_, i) => i !== hostIdx),
    })
  }

  const executeAction = async (task: ExecutionTaskConfig, action: string) => {
    setLoading(prev => ({ ...prev, [task.id]: true }))
    try {
      // TODO: 调用 Wails 绑定
      // const result = await goBindings.Execute({ action, task })
      // 模拟结果
      const mockResults: ActionResult[] = task.hosts.map(h => ({
        host: `${h.user}@${h.host}:${h.port}`,
        error: '',
        msg: `操作 ${action} 已提交`,
      }))
      setResults(prev => ({ ...prev, [task.id]: mockResults }))
      onAudit(action, `任务: ${task.name}`)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(prev => ({ ...prev, [task.id]: false }))
    }
  }

  const handleSaveScript = (task: ExecutionTaskConfig) => {
    const text = generateFioText(config, true)
    // TODO: 调用 Wails 绑定保存脚本
    onAudit('保存脚本', `任务: ${task.name}, 配置: ${configName}`)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, color: '#4f46e5' }}>执行任务 ({tasks.length})</h3>
        <button className="btn btn-primary btn-sm" onClick={addTask}>+ 添加任务</button>
      </div>

      {tasks.length === 0 && (
        <div className="empty-state">
          <p>暂无执行任务</p>
          <p style={{ fontSize: 12, marginTop: 8 }}>点击上方按钮添加新任务</p>
        </div>
      )}

      {tasks.map((task, taskIdx) => (
        <div key={task.id} className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{ cursor: 'pointer' }}
                onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
              >
                {expandedTask === task.id ? '▼' : '▶'}
              </span>
              <input
                value={task.name}
                onChange={(e) => updateTask(taskIdx, { name: e.target.value })}
                style={{ border: 'none', fontWeight: 600, fontSize: 14, width: 200 }}
              />
            </div>
            <button className="btn btn-danger btn-sm" onClick={() => deleteTask(taskIdx)}>删除</button>
          </div>

          {expandedTask === task.id && (
            <div>
              {/* Hosts */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>主机列表</span>
                  <button className="btn btn-outline btn-sm" onClick={() => addHost(taskIdx)}>+ 添加主机</button>
                </div>
                {task.hosts.map((host, hostIdx) => (
                  <div key={hostIdx} className="host-item">
                    <div className="host-dot" />
                    <input
                      placeholder="IP"
                      value={host.host}
                      onChange={(e) => updateHost(taskIdx, hostIdx, { host: e.target.value })}
                      style={{ width: 140 }}
                    />
                    <input
                      placeholder="端口"
                      type="number"
                      value={host.port}
                      onChange={(e) => updateHost(taskIdx, hostIdx, { port: parseInt(e.target.value) || 22 })}
                      style={{ width: 60 }}
                    />
                    <input
                      placeholder="用户"
                      value={host.user}
                      onChange={(e) => updateHost(taskIdx, hostIdx, { user: e.target.value })}
                      style={{ width: 80 }}
                    />
                    <input
                      placeholder="密码 (可选)"
                      type="password"
                      value={host.password}
                      onChange={(e) => updateHost(taskIdx, hostIdx, { password: e.target.value })}
                      style={{ width: 100 }}
                    />
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => removeHost(taskIdx, hostIdx)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="actions-grid">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={loading[task.id]}
                  onClick={() => executeAction(task, 'deploy')}
                >
                  {loading[task.id] ? '执行中...' : '部署并运行'}
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  disabled={loading[task.id]}
                  onClick={() => executeAction(task, 'status')}
                >
                  查看状态
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  disabled={loading[task.id]}
                  onClick={() => executeAction(task, 'pull')}
                >
                  拉取数据
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  disabled={loading[task.id]}
                  onClick={() => executeAction(task, 'killall')}
                >
                  停止任务
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  disabled={loading[task.id]}
                  onClick={() => executeAction(task, 'clean_local')}
                >
                  清理本地
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  disabled={loading[task.id]}
                  onClick={() => executeAction(task, 'clean_remote')}
                >
                  清理远程
                </button>
              </div>

              {/* Results */}
              {results[task.id] && results[task.id].length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <span style={{ fontSize: 12, color: '#6b7280', marginBottom: 4, display: 'block' }}>执行结果</span>
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th>主机</th>
                          <th>状态</th>
                          <th>消息</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results[task.id].map((r, i) => (
                          <tr key={i}>
                            <td>{r.host}</td>
                            <td>
                              <span className={`status-badge ${r.error ? 'error' : 'success'}`}>
                                {r.error ? '失败' : '成功'}
                              </span>
                            </td>
                            <td>{r.error || r.msg}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
