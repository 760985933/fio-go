import { useState, useEffect } from 'react'
import { FioConfig, FioJob } from '../types'
import { generateFioText } from '../utils/fioGenerator'
import * as App from '../wailsjs/go/app/App'

interface Props {
  config: FioConfig
  configName: string
  onConfigChange: (config: FioConfig) => void
  onConfigNameChange: (name: string) => void
  onAudit: (action: string, details: string) => void
}

const RW_OPTIONS = ['read', 'write', 'readwrite', 'randread', 'randwrite', 'randrw']

export function FioConfigEditor({ config, configName, onConfigChange, onConfigNameChange, onAudit }: Props) {
  const [expandedJob, setExpandedJob] = useState<number | null>(0)
  const [savedScripts, setSavedScripts] = useState<string[]>([])
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  useEffect(() => { loadScripts() }, [])

  const loadScripts = async () => {
    try {
      const scripts = await App.GetScripts()
      setSavedScripts(scripts || [])
    } catch { /* ignore */ }
  }

  const updateGlobal = (key: string, value: any) => {
    onConfigChange({
      ...config,
      global: { ...config.global, [key]: value },
    })
  }

  const addJob = () => {
    const newJob: FioJob = { bs: 4, rw: 'read', iodepth: 32, numjobs: 1 }
    onConfigChange({ ...config, jobs: [...config.jobs, newJob] })
    setExpandedJob(config.jobs.length)
  }

  const updateJob = (idx: number, updates: Partial<FioJob>) => {
    const newJobs = [...config.jobs]
    newJobs[idx] = { ...newJobs[idx], ...updates }
    onConfigChange({ ...config, jobs: newJobs })
  }

  const deleteJob = (idx: number) => {
    onConfigChange({ ...config, jobs: config.jobs.filter((_, i) => i !== idx) })
    if (expandedJob === idx) setExpandedJob(null)
  }

  const duplicateJob = (idx: number) => {
    const newJobs = [...config.jobs]
    newJobs.splice(idx + 1, 0, { ...config.jobs[idx] })
    onConfigChange({ ...config, jobs: newJobs })
    setExpandedJob(idx + 1)
  }

  const saveToServer = async () => {
    setSaveStatus('saving')
    try {
      const text = generateFioText(config, true)
      await App.SaveScript(configName, text)
      setSaveStatus('saved')
      onAudit('保存配置', `配置: ${configName}`)
      loadScripts()
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }

  const loadFromServer = async (name: string) => {
    try {
      const content = await App.GetScriptContent(name)
      // Try to extract JSON from comment
      const jsonMatch = content.match(/# FIO_CONFIG_JSON: ({.*})/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1])
        if (parsed.global && parsed.jobs) {
          onConfigChange(parsed)
          onConfigNameChange(name.replace('.fio', ''))
          onAudit('加载配置', `配置: ${name}`)
          return
        }
      }
      // Parse INI format as fallback
      onConfigNameChange(name.replace('.fio', ''))
      onAudit('加载配置 (文本)', `配置: ${name}`)
    } catch (err) {
      console.error('加载配置失败:', err)
    }
  }

  const deleteFromServer = async (name: string) => {
    try {
      await App.DeleteScript(name)
      onAudit('删除配置', `配置: ${name}`)
      loadScripts()
    } catch (err) {
      console.error('删除配置失败:', err)
    }
  }

  const previewText = generateFioText(config, true)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      {/* 左侧：脚本管理 */}
      <div>
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, color: '#4f46e5' }}>保存的脚本</h3>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-outline btn-sm" onClick={loadScripts}>刷新</button>
              <button className="btn btn-primary btn-sm" onClick={saveToServer}>
                {saveStatus === 'saving' ? '保存中...' : saveStatus === 'saved' ? '已保存 ✓' : '保存到服务器'}
              </button>
            </div>
          </div>
          {savedScripts.length === 0 ? (
            <p style={{ fontSize: 12, color: '#9ca3af' }}>暂无保存的脚本</p>
          ) : (
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {savedScripts.map(name => (
                <div key={name} className="host-item">
                  <span style={{ flex: 1, fontSize: 13 }}>{name}</span>
                  <button className="btn btn-outline btn-sm" onClick={() => loadFromServer(name)}>加载</button>
                  <button className="btn btn-danger btn-sm" onClick={() => deleteFromServer(name)}>删除</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 全局配置 */}
        <div className="panel" style={{ marginTop: 12 }}>
          <h3 style={{ marginBottom: 12, fontSize: 14, color: '#4f46e5' }}>全局配置</h3>
          <div className="form-group">
            <label>配置名称</label>
            <input value={configName} onChange={(e) => onConfigNameChange(e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>文件路径</label>
              <input value={config.global.filename} onChange={(e) => updateGlobal('filename', e.target.value)} />
            </div>
            <div className="form-group">
              <label>运行时间 (秒)</label>
              <input type="number" value={config.global.runtime} onChange={(e) => updateGlobal('runtime', parseInt(e.target.value) || 0)} />
            </div>
            <div className="form-group">
              <label>预热时间 (秒)</label>
              <input type="number" value={config.global.ramp_time} onChange={(e) => updateGlobal('ramp_time', parseInt(e.target.value) || 0)} />
            </div>
            <div className="form-group">
              <label>IO 引擎</label>
              <select value={config.global.ioengine} onChange={(e) => updateGlobal('ioengine', e.target.value)}>
                <option value="libaio">libaio</option>
                <option value="io_uring">io_uring</option>
                <option value="posixaio">posixaio</option>
                <option value="sync">sync</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* 右侧：任务列表 */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, color: '#4f46e5' }}>测试任务 ({config.jobs.length})</h3>
          <button className="btn btn-primary btn-sm" onClick={addJob}>+ 添加任务</button>
        </div>

        {config.jobs.map((job, idx) => (
          <div key={idx} className="card">
            <div className="card-header" style={{ cursor: 'pointer' }} onClick={() => setExpandedJob(expandedJob === idx ? null : idx)}>
              <span className="card-title">
                {expandedJob === idx ? '▼' : '▶'} 任务 {idx + 1}: {job.bs}k / {job.rw} / iodepth {job.iodepth}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); duplicateJob(idx) }}>复制</button>
                <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); deleteJob(idx) }}>删除</button>
              </div>
            </div>
            {expandedJob === idx && (
              <div className="form-row" style={{ marginTop: 12 }}>
                <div className="form-group">
                  <label>块大小 (KB)</label>
                  <input type="number" value={job.bs} onChange={(e) => updateJob(idx, { bs: parseInt(e.target.value) || 1 })} />
                </div>
                <div className="form-group">
                  <label>读写类型</label>
                  <select value={job.rw} onChange={(e) => updateJob(idx, { rw: e.target.value })}>
                    {RW_OPTIONS.map(rw => <option key={rw} value={rw}>{rw}</option>)}
                  </select>
                </div>
                {(job.rw === 'readwrite' || job.rw === 'randrw') && (
                  <div className="form-group">
                    <label>读占比</label>
                    <input type="number" min={0} max={100} value={job.rwmixread ?? 50} onChange={(e) => updateJob(idx, { rwmixread: parseInt(e.target.value) || 50 })} />
                  </div>
                )}
                <div className="form-group">
                  <label>队列深度</label>
                  <input type="number" value={job.iodepth} onChange={(e) => updateJob(idx, { iodepth: parseInt(e.target.value) || 1 })} />
                </div>
                <div className="form-group">
                  <label>并发数</label>
                  <input type="number" value={job.numjobs} onChange={(e) => updateJob(idx, { numjobs: parseInt(e.target.value) || 1 })} />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 底部：预览 */}
      <div className="panel" style={{ gridColumn: '1 / -1' }}>
        <h3 style={{ marginBottom: 12, fontSize: 14, color: '#4f46e5' }}>FIO 配置预览</h3>
        <pre className="code-preview">{previewText}</pre>
      </div>
    </div>
  )
}
