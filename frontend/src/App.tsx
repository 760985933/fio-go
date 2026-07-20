import { useState, useCallback, useEffect } from 'react'
import { OrchestrationProgress, ExecutionTaskConfig } from './types'
import { Layout } from './components/Layout'
import { Sidebar, SidebarItem } from './components/Sidebar'
import { ScriptManager } from './components/ScriptManager'
import { HostManager } from './components/HostManager'
import { TaskManager } from './components/TaskManager'
import { AnalysisView } from './components/AnalysisView'
import { SystemSettings } from './components/SystemSettings'
import { ConfirmDialog } from './components/ConfirmDialog'
import { Modal } from './components/Modal'
import { useModal } from './hooks/useModal'
import * as WailsApp from './wailsjs/go/app/App'

const svgProps = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const IconSliders = <svg {...svgProps}><line x1="4" y1="3" x2="4" y2="13"/><line x1="8" y1="3" x2="8" y2="13"/><line x1="12" y1="3" x2="12" y2="13"/><circle cx="4" cy="6" r="1.5" fill="currentColor"/><circle cx="8" cy="10" r="1.5" fill="currentColor"/><circle cx="12" cy="5" r="1.5" fill="currentColor"/></svg>
const IconChart = <svg {...svgProps}><rect x="2" y="9" width="3" height="5" rx="0.5"/><rect x="6.5" y="5" width="3" height="9" rx="0.5"/><rect x="11" y="2" width="3" height="12" rx="0.5"/></svg>
const IconWrench = <svg {...svgProps}><path d="M9.5 2.5a3.5 3.5 0 0 0-5 5L2 10l-0.5 0.5 4 4L6 14l2.5-2.5a3.5 3.5 0 0 0 5-5z"/><path d="M5.5 6.5l5 5"/></svg>
const IconDoc = <svg {...svgProps}><path d="M4 2h5.5L12 4.5V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M9 2v3h3"/><line x1="6" y1="7" x2="10" y2="7"/><line x1="6" y1="9.5" x2="10" y2="9.5"/><line x1="6" y1="12" x2="8" y2="12"/></svg>
const IconServer = <svg {...svgProps}><rect x="2" y="2" width="12" height="4" rx="1"/><rect x="2" y="10" width="12" height="4" rx="1"/><circle cx="4.5" cy="4" r="0.75" fill="currentColor"/><circle cx="4.5" cy="12" r="0.75" fill="currentColor"/><line x1="8" y1="4" x2="12" y2="4"/><line x1="8" y1="12" x2="12" y2="12"/></svg>
const IconClipboard = <svg {...svgProps}><rect x="4" y="1.5" width="8" height="13" rx="1"/><line x1="6" y1="5" x2="10" y2="5"/><line x1="6" y1="8" x2="10" y2="8"/><line x1="6" y1="11" x2="8" y2="11"/></svg>
const IconRocket = <svg {...svgProps}><path d="M8 2C5 2 3 5 3 8c0 2 1 4 2.5 5.5L8 14l2.5-0.5C12 12 13 10 13 8c0-3-2-6-5-6z"/><circle cx="8" cy="7" r="1.5"/><path d="M3 8c-1 0-1.5 1-1.5 2L3 12"/><path d="M13 8c1 0 1.5 1 1.5 2L13 12"/></svg>

const MAIN_TABS = [
  { id: 'configure', label: '配置与执行', icon: IconSliders },
  { id: 'settings', label: '系统设置', icon: IconWrench },
]

const SIDEBAR_ITEMS: SidebarItem[] = [
  { id: 'script', icon: IconDoc, label: '配置模型' },
  { id: 'host', icon: IconServer, label: '主机管理' },
  { id: 'task', icon: IconClipboard, label: '任务管理' },
  { id: 'analysis', icon: IconChart, label: '分析报告' },
]

const SIDEBAR_ITEMS_TOOL: SidebarItem[] = [
  { id: 'orchestration', icon: IconRocket, label: '编排' },
]

function App() {
  const [activeTab, setActiveTab] = useState('configure')
  const [sidebarItem, setSidebarItem] = useState('script')
  const { modal, close, confirm, showInfo, showConfirm, showResults } = useModal()
  const [mountedSidebar, setMountedSidebar] = useState<Record<string, boolean>>({ script: true })
  const [mountedTabs, setMountedTabs] = useState<Record<string, boolean>>({ configure: true })

  const handleAudit = useCallback(async (action: string, details: string) => {
    try { await WailsApp.AddAuditLog(action, details) } catch { /* ignore */ }
  }, [])

  const [stats, setStats] = useState({ hosts: 0, scripts: 0, tasks: 0 })

  useEffect(() => {
    const load = async () => {
      try {
        const [hosts, scripts, tasks] = await Promise.all([
          WailsApp.GetHosts(),
          WailsApp.GetScripts(),
          WailsApp.GetExecutionTasks(),
        ])
        setStats({
          hosts: (hosts || []).length,
          scripts: (scripts || []).length,
          tasks: (tasks || []).length,
        })
      } catch { /* ignore */ }
    }
    load()
  }, [sidebarItem, activeTab])

  const allSidebarItems = [...SIDEBAR_ITEMS, ...SIDEBAR_ITEMS_TOOL]

  const selectSidebar = (id: string) => {
    setMountedSidebar(prev => ({ ...prev, [id]: true }))
    setSidebarItem(id)
  }

  const selectTab = (id: string) => {
    setMountedTabs(prev => ({ ...prev, [id]: true }))
    setActiveTab(id)
  }

  const stepItems = [
    { label: '配置模型', count: stats.scripts, section: 'script' },
    { label: '主机管理', count: stats.hosts, section: 'host' },
    { label: '任务管理', count: stats.tasks, section: 'task' },
    { label: '分析报告', count: 0, section: 'analysis' },
  ]

  const currentStepIdx = stepItems.findIndex(s => s.section === sidebarItem)

  const configureSidebar = (
    <Sidebar
      items={allSidebarItems}
      dividerAfter="analysis"
      activeItem={sidebarItem}
      onSelect={selectSidebar}
    >
      <div className="step-bar">
        {stepItems.map((step, idx) => {
          const done = step.section === 'script' ? stats.scripts > 0
            : step.section === 'host' ? stats.hosts > 0
            : step.section === 'task' ? stats.tasks > 0
            : false
          const active = idx === currentStepIdx
          return (
            <div key={step.section} className={`step-bar-item ${active ? 'active' : ''} ${done ? 'done' : ''}`}
              onClick={() => selectSidebar(step.section)}>
              <div className={`step-bar-dot ${done ? 'done' : ''} ${active ? 'active' : ''}`}>
                {done ? '✓' : idx + 1}
              </div>
              <span className="step-bar-label">{step.label}</span>
              {idx < stepItems.length - 1 && <div className={`step-bar-line ${idx < currentStepIdx ? 'done' : ''}`} />}
            </div>
          )
        })}
      </div>

      <div style={{ display: sidebarItem === 'script' ? 'block' : 'none' }}>
        {mountedSidebar.script && <ScriptManager onAudit={handleAudit} />}
      </div>
      <div style={{ display: sidebarItem === 'host' ? 'block' : 'none' }}>
        {mountedSidebar.host && <HostManager onAudit={handleAudit} onShowResults={showResults} />}
      </div>
      <div style={{ display: sidebarItem === 'task' ? 'block' : 'none' }}>
        {mountedSidebar.task && <TaskManager onAudit={handleAudit} onShowResults={showResults} />}
      </div>
      <div style={{ display: sidebarItem === 'analysis' ? 'block' : 'none' }}>
        {mountedSidebar.analysis && <AnalysisView onAudit={handleAudit} onShowResults={showResults} />}
      </div>
      <div style={{ display: sidebarItem === 'orchestration' ? 'block' : 'none' }}>
        {mountedSidebar.orchestration && <OrchestrationManager onShowResults={showResults} />}
      </div>
    </Sidebar>
  )

  return (
    <>
      <Layout
        tabs={MAIN_TABS}
        activeTab={activeTab}
        onTabChange={selectTab}
        headerActions={null}
        sidebar={activeTab === 'configure' ? configureSidebar : undefined}
      >
        <div style={{ display: activeTab === 'settings' ? 'block' : 'none' }}>
          {mountedTabs.settings && <SystemSettings />}
        </div>
      </Layout>

      <Modal
        open={modal.open}
        title={modal.title}
        content={modal.content}
        type={modal.type}
        wide={modal.wide}
        onClose={close}
        onConfirm={confirm}
      />
    </>
  )
}

function OrchestrationManager({ onShowResults }: { onShowResults: (title: string, content: string, wide?: boolean) => Promise<void> }) {
  const [taskIds, setTaskIds] = useState<string[]>([])
  const [interval, setInterval_] = useState(10)
  const [tasks, setTasks] = useState<ExecutionTaskConfig[]>([])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [executing, setExecuting] = useState(false)
  const [progress, setProgress] = useState<OrchestrationProgress[]>([])
  const [currentStep, setCurrentStep] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const invalidIds = taskIds.filter(id => !tasks.some(t => t.id === id))

  useEffect(() => {
    const load = async () => {
      try {
        const [config, executionTasks] = await Promise.all([
          WailsApp.GetOrchestrationConfig(),
          WailsApp.GetExecutionTasks(),
        ])
        const rawIds = config.sequence || []
        setInterval_(config.interval || 10)
        setTasks(executionTasks)
        const valid = rawIds.filter((id: string) => executionTasks.some(t => t.id === id))
        setTaskIds(valid)
        if (valid.length !== rawIds.length) {
          WailsApp.SaveOrchestrationConfig({ sequence: valid, interval: config.interval || 10 }).catch(() => {})
        }
      } catch { /* ignore */ }
      setLoaded(true)
    }
    load()
  }, [])

  useEffect(() => {
    if (!loaded) return
    const timer = setTimeout(() => {
      WailsApp.SaveOrchestrationConfig({ sequence: taskIds, interval }).catch((err) => {
        console.error('编排配置自动保存失败:', err)
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [taskIds, interval, loaded])

  const executeOrchestration = async () => {
    if (taskIds.length === 0) return
    setExecuting(true)
    setProgress([])
    const allProgress: OrchestrationProgress[] = []

    const addProgress = (p: OrchestrationProgress) => {
      allProgress.push(p)
      setProgress([...allProgress])
    }

    const showError = async (title: string, msg: string) => {
      await onShowResults(title, msg)
    }

    const total = taskIds.length

    for (let i = 0; i < taskIds.length; i++) {
      const taskId = taskIds[i]

      // Re-fetch latest tasks to detect deletions during execution
      let latestTasks: ExecutionTaskConfig[]
      try {
        latestTasks = await WailsApp.GetExecutionTasks()
        setTasks(latestTasks)
      } catch {
        latestTasks = tasks
      }
      const task = latestTasks.find(t => t.id === taskId)
      const taskName = task?.name || taskId
      const safeId = taskId

      if (!task) {
        addProgress({ taskId: safeId, taskName, step: 'skip', status: 'error', error: '任务已被删除', current: i + 1, total })
        await showError(`[${i+1}/${total}] ${taskName} 跳过`, '该任务已被删除，无法执行')
        continue
      }

      if (!task.hosts || task.hosts.length === 0) {
        addProgress({ taskId: safeId, taskName, step: 'skip', status: 'error', error: '任务没有配置主机', current: i + 1, total })
        await showError(`[${i+1}/${total}] ${taskName} 跳过`, '该任务没有配置主机，无法执行')
        continue
      }

      if (!task.scripts || task.scripts.length === 0) {
        addProgress({ taskId: safeId, taskName, step: 'skip', status: 'error', error: '任务没有配置脚本', current: i + 1, total })
        await showError(`[${i+1}/${total}] ${taskName} 跳过`, '该任务没有配置脚本，无法执行')
        continue
      }

      setCurrentStep(`${taskName} - 预检查...`)

      // Step 0: Pre-check
      addProgress({ taskId: safeId, taskName, step: 'precheck', status: 'running', current: i + 1, total })
      let checkResults: any[]
      try {
        checkResults = await WailsApp.PreDeployCheck(taskId, task?.hosts || [])
      } catch (err) {
        addProgress({ taskId: safeId, taskName, step: 'precheck', status: 'error', error: String(err), current: i + 1, total })
        await showError(`[${i+1}/${total}] ${taskName} 预检查失败`, `错误: ${err}`)
        continue
      }
      const hasRunning = checkResults.some((r: any) => r.running)
      if (hasRunning) {
        const runningHosts = checkResults.filter((r: any) => r.running).map((r: any) => `${r.host}: ${r.msg}`).join('\n')
        addProgress({ taskId: safeId, taskName, step: 'precheck', status: 'error', error: `主机有FIO运行中: ${runningHosts}`, current: i + 1, total })
        await showError(`[${i+1}/${total}] ${taskName} 预检查失败`, `主机有FIO运行中:\n${runningHosts}`)
        continue
      }
      addProgress({ taskId: safeId, taskName, step: 'precheck', status: 'completed', current: i + 1, total })

      // Record task start time
      try { await WailsApp.SetTaskStarted(taskId) } catch { /* ignore */ }

      // Step 1: Deploy
      setCurrentStep(`${taskName} - 部署中...`)
      addProgress({ taskId: safeId, taskName, step: 'deploy', status: 'running', current: i + 1, total })
      let deployResults: any[]
      try {
        deployResults = await WailsApp.DeployMulti(taskId, task?.scripts || [], task?.hosts || [])
      } catch (err) {
        addProgress({ taskId: safeId, taskName, step: 'deploy', status: 'error', error: String(err), current: i + 1, total })
        await showError(`[${i+1}/${total}] ${taskName} 部署失败`, `错误: ${err}`)
        continue
      }
      const deployErrors = deployResults.filter((r: any) => r.error)
      if (deployErrors.length > 0) {
        const errMsg = deployErrors.map((r: any) => `${r.host}: ${r.error}`).join('\n')
        addProgress({ taskId: safeId, taskName, step: 'deploy', status: 'error', error: errMsg, results: deployResults, current: i + 1, total })
        await showError(`[${i+1}/${total}] ${taskName} 部署失败`, errMsg)
        continue
      }
      addProgress({ taskId: safeId, taskName, step: 'deploy', status: 'completed', results: deployResults, current: i + 1, total })

      // Step 2: Poll until all hosts finish
      setCurrentStep(`${taskName} - 运行中...`)
      addProgress({ taskId: safeId, taskName, step: 'running', status: 'running', current: i + 1, total })
      let pollFinished = false
      while (!pollFinished) {
        await new Promise(resolve => setTimeout(resolve, 10000))
        let statusResults: any[]
        try {
          statusResults = await WailsApp.CheckStatus(taskId, task?.hosts || [])
        } catch (err) {
          addProgress({ taskId: safeId, taskName, step: 'running', status: 'error', error: String(err), current: i + 1, total })
          await showError(`[${i+1}/${total}] ${taskName} 状态检查失败`, `错误: ${err}`)
          pollFinished = true
          continue
        }
        const statusErrors = statusResults.filter((r: any) => r.error)
        if (statusErrors.length > 0) {
          const errMsg = statusErrors.map((r: any) => `${r.host}: ${r.error}`).join('\n')
          addProgress({ taskId: safeId, taskName, step: 'running', status: 'error', error: errMsg, current: i + 1, total })
          await showError(`[${i+1}/${total}] ${taskName} 状态检查失败`, errMsg)
          pollFinished = true
          continue
        }
        pollFinished = statusResults.every((r: any) => !r.running)
      }
      if (allProgress[allProgress.length - 1]?.status === 'error') continue
      addProgress({ taskId: safeId, taskName, step: 'running', status: 'completed', current: i + 1, total })

      // Step 3: Pull data
      setCurrentStep(`${taskName} - 拉取数据...`)
      addProgress({ taskId: safeId, taskName, step: 'pull', status: 'running', current: i + 1, total })
      let pullResults: any[]
      try {
        pullResults = await WailsApp.PullData(taskId, task?.hosts || [])
      } catch (err) {
        addProgress({ taskId: safeId, taskName, step: 'pull', status: 'error', error: String(err), current: i + 1, total })
        await showError(`[${i+1}/${total}] ${taskName} 数据拉取失败`, `错误: ${err}`)
        continue
      }
      const pullErrors = pullResults.filter((r: any) => r.error)
      if (pullErrors.length > 0) {
        const errMsg = pullErrors.map((r: any) => `${r.host}: ${r.error}`).join('\n')
        addProgress({ taskId: safeId, taskName, step: 'pull', status: 'error', error: errMsg, results: pullResults, current: i + 1, total })
        await showError(`[${i+1}/${total}] ${taskName} 数据拉取失败`, errMsg)
        continue
      }
      addProgress({ taskId: safeId, taskName, step: 'pull', status: 'completed', results: pullResults, current: i + 1, total })

      // Record task finish time
      try { await WailsApp.SetTaskFinished(taskId) } catch { /* ignore */ }

      // Step 4: Wait interval (except last task)
      if (i < total - 1 && interval > 0) {
        setCurrentStep(`${taskName} - 等待 ${interval} 秒...`)
        addProgress({ taskId: safeId, taskName, step: 'wait', status: 'running', current: i + 1, total })
        await new Promise(resolve => setTimeout(resolve, interval * 1000))
        addProgress({ taskId: safeId, taskName, step: 'wait', status: 'completed', current: i + 1, total })
      }
    }

    setCurrentStep('编排完成')
    await onShowResults('编排执行完成',
      allProgress.map((p: any) =>
        `[${p.current}/${p.total}] ${p.taskName} | ${p.step}: ${p.status}${p.error ? ' - ' + p.error : ''}`
      ).join('\n')
    )
    setExecuting(false)
    setCurrentStep('')
  }

  const addTask = (taskId: string) => {
    if (!taskIds.includes(taskId)) {
      setTaskIds([...taskIds, taskId])
    }
  }

  const removeTask = (taskId: string) => {
    setTaskIds(taskIds.filter(id => id !== taskId))
  }

  const moveTask = (fromIdx: number, toIdx: number) => {
    const newIds = [...taskIds]
    const [moved] = newIds.splice(fromIdx, 1)
    newIds.splice(toIdx, 0, moved)
    setTaskIds(newIds)
  }

  const handleDragStart = (idx: number) => { setDragIdx(idx) }
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    if (dragIdx !== null && dragIdx !== idx) {
      moveTask(dragIdx, idx)
      setDragIdx(idx)
    }
  }
  const handleDragEnd = () => { setDragIdx(null) }

  const getTaskName = (id: string) => tasks.find(t => t.id === id)?.name || id

  return (
    <div>
      <div className="manager-header">
        <h2>执行编排</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setShowConfirm(true)}
          disabled={executing || taskIds.length === 0 || invalidIds.length > 0}>
          {executing ? `执行中... ${currentStep}` : '执行编排'}
        </button>
      </div>

      {invalidIds.length > 0 && (
        <div style={{ background: '#fef3cd', border: '1px solid #ffc107', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: '#856404' }}>
          以下任务已被删除，请移除后才能执行编排：
          {invalidIds.map(id => (
            <div key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
              <span style={{ textDecoration: 'line-through', color: '#dc3545' }}>{id}</span>
              <button className="btn btn-danger btn-sm" onClick={() => removeTask(id)} disabled={executing}>移除</button>
            </div>
          ))}
        </div>
      )}

      {showConfirm && (
        <ConfirmDialog
          open={showConfirm}
          title="确认执行编排"
          message="编排执行期间请勿关闭应用，关闭会导致任务中断。确认开始执行？"
          confirmText="开始执行"
          onConfirm={() => { setShowConfirm(false); executeOrchestration() }}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      <div className="panel">
        <div className="form-group">
          <label>任务间间隔 (秒)</label>
          <input type="number" value={interval} onChange={(e) => setInterval_(parseInt(e.target.value) || 0)} disabled={executing} />
        </div>

        {progress.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>执行进度</h4>
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {progress.map((p, idx) => (
                <div key={idx} className={`status-line ${p.status === 'error' ? 'status-warning' : p.status === 'running' ? '' : 'status-ok'}`}
                  style={{ fontSize: 12 }}>
                  [{p.current}/{p.total}] {p.taskName} | {p.step}: {p.status}
                  {p.error && ` - ${p.error}`}
                </div>
              ))}
            </div>
          </div>
        )}

        <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
          执行顺序 ({taskIds.length} 个任务)
        </h4>
        {taskIds.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>从下方添加任务到执行队列</p>
        ) : (
          taskIds.map((id, idx) => {
            const isValid = tasks.some(t => t.id === id)
            return (
            <div key={id} draggable={!executing && isValid}
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className="host-item"
              style={{
                cursor: executing || !isValid ? 'not-allowed' : 'grab',
                background: dragIdx === idx ? '#f0f0ff' : isValid ? undefined : '#fff5f5',
                border: dragIdx === idx ? '2px solid var(--primary)' : isValid ? undefined : '1px solid #f5c6cb',
                opacity: executing ? 0.6 : 1,
              }}>
              <span style={{ fontSize: 14, marginRight: 8, color: 'var(--text-muted)' }}>⠿</span>
              <span style={{ fontSize: 14, marginRight: 8, color: isValid ? 'var(--primary)' : '#dc3545', fontWeight: 600 }}>{idx + 1}</span>
              <span style={{ flex: 1, fontSize: 13, textDecoration: isValid ? undefined : 'line-through', color: isValid ? undefined : '#dc3545' }}>{getTaskName(id)}</span>
              {!isValid && <span style={{ fontSize: 11, color: '#dc3545', marginRight: 8 }}>已删除</span>}
              <button className="btn btn-danger btn-sm" onClick={() => removeTask(id)} disabled={executing}>移除</button>
            </div>
            )
          })
        )}
      </div>

      {tasks.length > 0 && (
        <div className="panel">
          <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>可添加的任务</h4>
          {tasks.map(t => (
            <div key={t.id} className="host-item">
              <span style={{ flex: 1, fontSize: 13 }}>{t.name}</span>
              <button className="btn btn-outline btn-sm" onClick={() => addTask(t.id)}
                disabled={taskIds.includes(t.id) || executing}>
                {taskIds.includes(t.id) ? '已添加' : '添加'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default App
