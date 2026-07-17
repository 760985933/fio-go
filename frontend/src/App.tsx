import { useState, useEffect, useCallback } from 'react'
import { FioConfig, FioJob, ExecutionTaskConfig, HostConfig, ActionResult, AnalysisSummary } from './types'
import { generateFioText } from './utils/fioGenerator'
import { FioConfigEditor } from './components/FioConfigEditor'
import { ExecutionManager } from './components/ExecutionManager'
import { AnalysisManager } from './components/AnalysisManager'
import { AuditLog } from './components/AuditLog'

// Wails 绑定占位符 - 实际部署时由 wailsjs 生成
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const goBindings: any = null

type TabType = 'config' | 'execution' | 'analysis' | 'audit'

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('config')
  const [config, setConfig] = useState<FioConfig>({
    global: {
      filename: '/dev/vdb',
      runtime: 180,
      ramp_time: 30,
      ioengine: 'libaio',
    },
    jobs: [
      { bs: 4, rw: 'read', iodepth: 32, numjobs: 1 },
    ],
  })
  const [configName, setConfigName] = useState<string>(() => {
    return localStorage.getItem('fio_config_name') || 'default'
  })
  const [executionTasks, setExecutionTasks] = useState<ExecutionTaskConfig[]>([])
  const [analysisTasks, setAnalysisTasks] = useState<AnalysisSummary[]>([])
  const [auditEntries, setAuditEntries] = useState<any[]>([])

  // 加载保存的配置
  useEffect(() => {
    const saved = localStorage.getItem('fio_config_state')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        setConfig(parsed)
      } catch { /* ignore */ }
    }
  }, [])

  // 保存配置到 localStorage
  useEffect(() => {
    localStorage.setItem('fio_config_state', JSON.stringify(config))
    localStorage.setItem('fio_config_name', configName)
  }, [config, configName])

  // 加载执行任务
  useEffect(() => {
    loadExecutionTasks()
  }, [])

  const loadExecutionTasks = async () => {
    if (goBindings) {
      try {
        const tasks = await goBindings.GetExecutionTasks()
        setExecutionTasks(tasks)
      } catch { /* ignore */ }
    }
  }

  const loadAnalysisTasks = async () => {
    if (goBindings) {
      try {
        const tasks = await goBindings.GetAnalysisTasks()
        setAnalysisTasks(tasks)
      } catch { /* ignore */ }
    }
  }

  const loadAuditLog = async () => {
    if (goBindings) {
      try {
        const entries = await goBindings.GetAuditLog()
        setAuditEntries(entries)
      } catch { /* ignore */ }
    }
  }

  const addAuditEntry = async (action: string, details: string) => {
    const entry = {
      action,
      details,
      timestamp: new Date().toISOString(),
    }
    setAuditEntries(prev => [entry, ...prev])
    if (goBindings) {
      try {
        await goBindings.AddAuditLog(entry)
      } catch { /* ignore */ }
    }
  }

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    if (tab === 'analysis') loadAnalysisTasks()
    if (tab === 'audit') loadAuditLog()
  }

  const handleExportJson = () => {
    const json = JSON.stringify(config, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${configName}.json`
    a.click()
    URL.revokeObjectURL(url)
    addAuditEntry('导出配置', `配置: ${configName}`)
  }

  const handleImportJson = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target?.result as string)
          if (parsed.global && parsed.jobs) {
            setConfig(parsed)
            addAuditEntry('导入配置', `文件: ${file.name}`)
          }
        } catch {
          alert('JSON 格式错误')
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  const handleDownloadFio = () => {
    const text = generateFioText(config, true)
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${configName}.fio`
    a.click()
    URL.revokeObjectURL(url)
    addAuditEntry('下载 FIO 脚本', `配置: ${configName}`)
  }

  return (
    <div className="app">
      <header className="header">
        <h1>FIO 性能测试工具</h1>
        <div className="header-actions">
          <button className="btn btn-outline btn-sm" onClick={handleExportJson}>导出 JSON</button>
          <button className="btn btn-outline btn-sm" onClick={handleImportJson}>导入 JSON</button>
          <button className="btn btn-primary btn-sm" onClick={handleDownloadFio}>下载 FIO</button>
        </div>
      </header>

      <nav className="tabs">
        <button
          className={`tab-btn ${activeTab === 'config' ? 'active' : ''}`}
          onClick={() => handleTabChange('config')}
        >
          FIO 配置
        </button>
        <button
          className={`tab-btn ${activeTab === 'execution' ? 'active' : ''}`}
          onClick={() => handleTabChange('execution')}
        >
          任务执行
        </button>
        <button
          className={`tab-btn ${activeTab === 'analysis' ? 'active' : ''}`}
          onClick={() => handleTabChange('analysis')}
        >
          分析报告
        </button>
        <button
          className={`tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => handleTabChange('audit')}
        >
          审计日志
        </button>
      </nav>

      <main>
        {activeTab === 'config' && (
          <FioConfigEditor
            config={config}
            configName={configName}
            onConfigChange={setConfig}
            onConfigNameChange={setConfigName}
          />
        )}
        {activeTab === 'execution' && (
          <ExecutionManager
            tasks={executionTasks}
            onTasksChange={setExecutionTasks}
            config={config}
            configName={configName}
            onAudit={addAuditEntry}
          />
        )}
        {activeTab === 'analysis' && (
          <AnalysisManager
            tasks={analysisTasks}
            onRefresh={loadAnalysisTasks}
          />
        )}
        {activeTab === 'audit' && (
          <AuditLog entries={auditEntries} />
        )}
      </main>
    </div>
  )
}

export default App
