import { useState, useCallback, useEffect } from 'react'
import { FioConfig, OrchestrationProgress } from './types'
import { Layout } from './components/Layout'
import { Sidebar, SidebarItem } from './components/Sidebar'
import { HomePage } from './components/HomePage'
import { ScriptManager } from './components/ScriptManager'
import { HostManager } from './components/HostManager'
import { TaskManager } from './components/TaskManager'
import { TemplateManager } from './components/TemplateManager'
import { AnalysisView } from './components/AnalysisView'
import { SystemSettings } from './components/SystemSettings'
import { Modal } from './components/Modal'
import { useModal } from './hooks/useModal'
import { generateFioText } from './utils/fioGenerator'
import * as WailsApp from './wailsjs/go/app/App'

const DEFAULT_CONFIG: FioConfig = {
  global: { filename: '/dev/vdb', runtime: 180, ramp_time: 30, ioengine: 'libaio' },
  logging: { enabled: true, log_avg_msec: 500, write_bw_log: true, write_lat_log: true, write_iops_log: true },
  jobs: [{ bs: 4, rw: 'read', iodepth: 32, numjobs: 1, direct: true, thread: true }],
}

const svgProps = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const IconHome = <svg {...svgProps}><path d="M2 8.5L8 3l6 5.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8.5z"/><path d="M6 14V9h4v5"/></svg>
const IconSliders = <svg {...svgProps}><line x1="4" y1="3" x2="4" y2="13"/><line x1="8" y1="3" x2="8" y2="13"/><line x1="12" y1="3" x2="12" y2="13"/><circle cx="4" cy="6" r="1.5" fill="currentColor"/><circle cx="8" cy="10" r="1.5" fill="currentColor"/><circle cx="12" cy="5" r="1.5" fill="currentColor"/></svg>
const IconChart = <svg {...svgProps}><rect x="2" y="9" width="3" height="5" rx="0.5"/><rect x="6.5" y="5" width="3" height="9" rx="0.5"/><rect x="11" y="2" width="3" height="12" rx="0.5"/></svg>
const IconWrench = <svg {...svgProps}><path d="M9.5 2.5a3.5 3.5 0 0 0-5 5L2 10l-0.5 0.5 4 4L6 14l2.5-2.5a3.5 3.5 0 0 0 5-5z"/><path d="M5.5 6.5l5 5"/></svg>
const IconDoc = <svg {...svgProps}><path d="M4 2h5.5L12 4.5V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M9 2v3h3"/><line x1="6" y1="7" x2="10" y2="7"/><line x1="6" y1="9.5" x2="10" y2="9.5"/><line x1="6" y1="12" x2="8" y2="12"/></svg>
const IconServer = <svg {...svgProps}><rect x="2" y="2" width="12" height="4" rx="1"/><rect x="2" y="10" width="12" height="4" rx="1"/><circle cx="4.5" cy="4" r="0.75" fill="currentColor"/><circle cx="4.5" cy="12" r="0.75" fill="currentColor"/><line x1="8" y1="4" x2="12" y2="4"/><line x1="8" y1="12" x2="12" y2="12"/></svg>
const IconClipboard = <svg {...svgProps}><rect x="4" y="1.5" width="8" height="13" rx="1"/><line x1="6" y1="5" x2="10" y2="5"/><line x1="6" y1="8" x2="10" y2="8"/><line x1="6" y1="11" x2="8" y2="11"/></svg>
const IconLayers = <svg {...svgProps}><polygon points="8,2 14,5.5 8,9 2,5.5"/><polyline points="2,8 8,11.5 14,8"/><polyline points="2,10.5 8,14 14,10.5"/></svg>
const IconRocket = <svg {...svgProps}><path d="M8 2C5 2 3 5 3 8c0 2 1 4 2.5 5.5L8 14l2.5-0.5C12 12 13 10 13 8c0-3-2-6-5-6z"/><circle cx="8" cy="7" r="1.5"/><path d="M3 8c-1 0-1.5 1-1.5 2L3 12"/><path d="M13 8c1 0 1.5 1 1.5 2L13 12"/></svg>

const MAIN_TABS = [
  { id: 'home', label: '首页', icon: IconHome },
  { id: 'configure', label: '配置与执行', icon: IconSliders },
  { id: 'analysis', label: '分析报告', icon: IconChart },
  { id: 'settings', label: '系统设置', icon: IconWrench },
]

const SIDEBAR_ITEMS: SidebarItem[] = [
  { id: 'script', icon: IconDoc, label: '脚本管理' },
  { id: 'host', icon: IconServer, label: '主机管理' },
  { id: 'task', icon: IconClipboard, label: '任务管理' },
  { id: 'template', icon: IconLayers, label: '模板管理' },
]

const SIDEBAR_ITEMS_TOOL: SidebarItem[] = [
  { id: 'orchestration', icon: IconRocket, label: '编排' },
]

function App() {
  const [activeTab, setActiveTab] = useState('home')
  const [sidebarItem, setSidebarItem] = useState('script')
  const [config, setConfig] = useState<FioConfig>(DEFAULT_CONFIG)
  const [configName, setConfigName] = useState('fio_test')
  const { modal, close, confirm, showInfo, showConfirm, showResults } = useModal()

  const handleAudit = useCallback(async (action: string, details: string) => {
    try { await WailsApp.AddAuditLog(action, details) } catch { /* ignore */ }
  }, [])

  const handleExportConfig = useCallback(async () => {
    const text = generateFioText(config, true)
    const ok = await showConfirm(`导出配置 "${configName}"?`, '确认导出当前FIO配置到服务器')
    if (ok) {
      try {
        await WailsApp.SaveScript(configName, text)
        await handleAudit('导出配置', `配置: ${configName}`)
        await showInfo('导出成功', `配置已保存为 ${configName}.fio`)
      } catch (err) {
        await showInfo('导出失败', `错误: ${err}`)
      }
    }
  }, [config, configName, showConfirm, showInfo, handleAudit])

  const handleNavigateTo = useCallback((section: string) => {
    setActiveTab('configure')
    setSidebarItem(section)
  }, [])

  const allSidebarItems = [...SIDEBAR_ITEMS, ...SIDEBAR_ITEMS_TOOL]

  return (
    <Layout
      tabs={MAIN_TABS}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      headerActions={
        <button className="btn btn-outline btn-sm" onClick={handleExportConfig}>导出配置</button>
      }
    >
      {activeTab === 'home' && (
        <HomePage onNavigateTo={handleNavigateTo} />
      )}

      {activeTab === 'configure' && (
        <Sidebar
          items={allSidebarItems}
          dividerAfter="template"
          activeItem={sidebarItem}
          onSelect={setSidebarItem}
        >
          {sidebarItem === 'script' && (
            <ScriptManager
              config={config}
              configName={configName}
              onConfigChange={setConfig}
              onConfigNameChange={setConfigName}
              onAudit={handleAudit}
            />
          )}
          {sidebarItem === 'host' && (
            <HostManager
              onAudit={handleAudit}
              onShowResults={showResults}
            />
          )}
          {sidebarItem === 'task' && (
            <TaskManager
              onAudit={handleAudit}
              onShowResults={showResults}
            />
          )}
          {sidebarItem === 'template' && (
            <TemplateManager
              config={config}
              configName={configName}
              onConfigChange={setConfig}
              onConfigNameChange={setConfigName}
              onAudit={handleAudit}
            />
          )}
          {sidebarItem === 'orchestration' && (
            <OrchestrationManager onShowResults={showResults} />
          )}
        </Sidebar>
      )}

      {activeTab === 'analysis' && (
        <AnalysisView onAudit={handleAudit} onShowResults={showResults} />
      )}

      {activeTab === 'settings' && (
        <SystemSettings />
      )}

      <Modal
        open={modal.open}
        title={modal.title}
        content={modal.content}
        type={modal.type}
        onClose={close}
        onConfirm={confirm}
      />
    </Layout>
  )
}

function OrchestrationManager({ onShowResults }: { onShowResults: (title: string, content: string) => Promise<void> }) {
  const [taskIds, setTaskIds] = useState<string[]>([])
  const [interval, setInterval_] = useState(10)
  const [tasks, setTasks] = useState<{ id: string; name: string }[]>([])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [executing, setExecuting] = useState(false)
  const [progress, setProgress] = useState<OrchestrationProgress[]>([])
  const [currentStep, setCurrentStep] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const [config, executionTasks] = await Promise.all([
          WailsApp.GetOrchestrationConfig(),
          WailsApp.GetExecutionTasks(),
        ])
        setTaskIds(config.sequence || [])
        setInterval_(config.interval || 10)
        setTasks(executionTasks.map((t: any) => ({ id: t.id, name: t.name })))
      } catch { /* ignore */ }
    }
    load()
  }, [])

  const saveConfig = async () => {
    setSaveStatus('saving')
    try {
      await WailsApp.SaveOrchestrationConfig({ sequence: taskIds, interval })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch {
      setSaveStatus('error')
    }
  }

  const executeOrchestration = async () => {
    if (taskIds.length === 0) return
    setExecuting(true)
    setProgress([])
    setCurrentStep('初始化编排...')

    try {
      const result = await WailsApp.ExecuteOrchestration(taskIds, interval)
      setProgress(result || [])

      const lastStep = result?.[result.length - 1]
      setCurrentStep(lastStep ? `${lastStep.taskName} - ${lastStep.step} ${lastStep.status}` : '完成')

      await onShowResults('编排执行完成',
        (result || []).map((p: any) =>
          `[${p.current}/${p.total}] ${p.taskName} | ${p.step}: ${p.status}${p.error ? ' - ' + p.error : ''}`
        ).join('\n')
      )
    } catch (err) {
      await onShowResults('编排执行异常', `错误: ${err}`)
    } finally {
      setExecuting(false)
      setCurrentStep('')
    }
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={saveConfig} disabled={executing}>
            {saveStatus === 'saving' ? '保存中...' : saveStatus === 'saved' ? '已保存 ✓' : '保存配置'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={executeOrchestration}
            disabled={executing || taskIds.length === 0}>
            {executing ? `执行中... ${currentStep}` : '执行编排'}
          </button>
        </div>
      </div>

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
          taskIds.map((id, idx) => (
            <div key={id} draggable={!executing}
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className="host-item"
              style={{
                cursor: executing ? 'not-allowed' : 'grab',
                background: dragIdx === idx ? '#f0f0ff' : undefined,
                border: dragIdx === idx ? '2px solid var(--primary)' : undefined,
                opacity: executing ? 0.6 : 1,
              }}>
              <span style={{ fontSize: 14, marginRight: 8, color: 'var(--text-muted)' }}>⠿</span>
              <span style={{ fontSize: 14, marginRight: 8, color: 'var(--primary)', fontWeight: 600 }}>{idx + 1}</span>
              <span style={{ flex: 1, fontSize: 13 }}>{getTaskName(id)}</span>
              <button className="btn btn-danger btn-sm" onClick={() => removeTask(id)} disabled={executing}>移除</button>
            </div>
          ))
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
