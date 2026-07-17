import { useState, useCallback } from 'react'
import { FioConfig } from './types'
import { FioConfigEditor } from './components/FioConfigEditor'
import { ExecutionManager } from './components/ExecutionManager'
import { AnalysisManager } from './components/AnalysisManager'
import { OrchestrationManager } from './components/OrchestrationManager'
import { AuditLog } from './components/AuditLog'
import { Modal } from './components/Modal'
import { useModal } from './hooks/useModal'
import { generateFioText } from './utils/fioGenerator'
import * as WailsApp from './wailsjs/go/app/App'

const DEFAULT_CONFIG: FioConfig = {
  global: { filename: '/dev/vdb', runtime: 180, ramp_time: 30, ioengine: 'libaio' },
  logging: { enabled: true, log_avg_msec: 500, write_bw_log: true, write_lat_log: true, write_iops_log: true },
  jobs: [{ bs: 4, rw: 'read', iodepth: 32, numjobs: 1, direct: true, thread: true }],
}

const TABS = [
  { id: 'editor', label: '配置编辑', icon: '⚙️' },
  { id: 'execution', label: '执行管理', icon: '▶️' },
  { id: 'analysis', label: '分析报告', icon: '📊' },
  { id: 'orchestration', label: '编排', icon: '📋' },
  { id: 'audit', label: '审计', icon: '📝' },
]

function App() {
  const [activeTab, setActiveTab] = useState('editor')
  const [config, setConfig] = useState<FioConfig>(DEFAULT_CONFIG)
  const [configName, setConfigName] = useState('fio_test')
  const { modal, close, confirm, showInfo, showConfirm, showPrompt, showResults } = useModal()

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

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <svg className="header-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="appGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: '#667eea' }} />
                <stop offset="100%" style={{ stopColor: '#764ba2' }} />
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="6" fill="url(#appGrad)" />
            <g fill="white">
              <circle cx="8" cy="8" r="2" />
              <circle cx="24" cy="8" r="2" />
              <circle cx="8" cy="24" r="2" />
              <circle cx="24" cy="24" r="2" />
              <circle cx="16" cy="16" r="2.5" />
              <line x1="8" y1="8" x2="16" y2="16" stroke="white" strokeWidth="1.5" />
              <line x1="24" y1="8" x2="16" y2="16" stroke="white" strokeWidth="1.5" />
              <line x1="8" y1="24" x2="16" y2="16" stroke="white" strokeWidth="1.5" />
              <line x1="24" y1="24" x2="16" y2="16" stroke="white" strokeWidth="1.5" />
            </g>
          </svg>
          <h1>FIO 测试工具 <span className="app-version">v1.0.3</span></h1>
        </div>
        <div className="header-actions">
          <button className="btn btn-outline btn-sm" onClick={handleExportConfig}>导出配置</button>
        </div>
      </header>

      <div className="tab-bar">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      <main className="content">
        {activeTab === 'editor' && (
          <FioConfigEditor
            config={config}
            configName={configName}
            onConfigChange={setConfig}
            onConfigNameChange={setConfigName}
            onAudit={handleAudit}
          />
        )}
        {activeTab === 'execution' && (
          <ExecutionManager
            scriptName={configName}
            onScriptNameChange={setConfigName}
            onAudit={handleAudit}
            onShowResults={showResults}
          />
        )}
        {activeTab === 'analysis' && (
          <AnalysisManager onAudit={handleAudit} onShowResults={showResults} />
        )}
        {activeTab === 'orchestration' && (
          <OrchestrationManager onShowResults={showResults} />
        )}
        {activeTab === 'audit' && <AuditLog />}
      </main>

      <Modal
        open={modal.open}
        title={modal.title}
        content={modal.content}
        type={modal.type}
        onClose={close}
        onConfirm={confirm}
      />
    </div>
  )
}

export default App
