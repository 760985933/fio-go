import { useState, useEffect } from 'react'
import { FioConfig, FioJob, FioLogging, FioLoggingKey } from '../types'
import { generateFioText } from '../utils/fioGenerator'
import { ensureConfig, bsLabel } from '../utils/config'
import * as App from '../wailsjs/go/app/App'

interface Props {
  config: FioConfig
  configName: string
  onConfigChange: (config: FioConfig) => void
  onConfigNameChange: (name: string) => void
  onAudit: (action: string, details: string) => void
}

const RW_OPTIONS = ['read', 'write', 'readwrite', 'randread', 'randwrite', 'randrw']
const BS_PRESETS = [4, 8, 16, 32, 64, 128, 256, 512, 1024]

const SCENE_PRESETS: Record<string, Partial<FioJob>> = {
  '顺序读':     { bs: 128, rw: 'read',      iodepth: 32, numjobs: 1, direct: true, thread: true },
  '顺序写':     { bs: 128, rw: 'write',     iodepth: 32, numjobs: 1, direct: true, thread: true },
  '随机读':     { bs: 4,   rw: 'randread',   iodepth: 32, numjobs: 1, direct: true, thread: true },
  '随机写':     { bs: 4,   rw: 'randwrite',  iodepth: 32, numjobs: 1, direct: true, thread: true },
  '混合顺序':   { bs: 128, rw: 'readwrite',  iodepth: 32, numjobs: 1, rwmixread: 70, direct: true, thread: true },
  '混合随机4k': { bs: 4,   rw: 'randrw',     iodepth: 32, numjobs: 1, rwmixread: 70, direct: true, thread: true },
  '混合随机8k': { bs: 8,   rw: 'randrw',     iodepth: 64, numjobs: 1, rwmixread: 70, direct: true, thread: true },
  '数据库':     { bs: 8,   rw: 'randrw',     iodepth: 64, numjobs: 1, rwmixread: 70, direct: true, thread: true },
}

const DEFAULT_JOB: FioJob = { bs: 4, rw: 'read', iodepth: 32, numjobs: 1, direct: true, thread: true }

export function ScriptManager({ config, configName, onConfigChange, onConfigNameChange, onAudit }: Props) {
  const [expandedJob, setExpandedJob] = useState<number | null>(0)
  const [savedScripts, setSavedScripts] = useState<string[]>([])
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [showLogging, setShowLogging] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState<Record<number, boolean>>({})

  const cfg = ensureConfig(config)
  const log = cfg.logging

  useEffect(() => { loadScripts() }, [])

  const loadScripts = async () => {
    try { setSavedScripts((await App.GetScripts()) || []) } catch { /* ignore */ }
  }

  const updateGlobal = (key: string, value: any) => {
    onConfigChange({ ...cfg, global: { ...cfg.global, [key]: value } })
  }

  const updateLogging = <K extends FioLoggingKey>(key: K, value: FioLogging[K]) => {
    onConfigChange({ ...cfg, logging: { ...log, [key]: value } })
  }

  const addJob = () => {
    onConfigChange({ ...cfg, jobs: [...cfg.jobs, { ...DEFAULT_JOB }] })
    setExpandedJob(cfg.jobs.length)
  }

  const updateJob = (idx: number, updates: Partial<FioJob>) => {
    const newJobs = [...cfg.jobs]
    newJobs[idx] = { ...newJobs[idx], ...updates }
    onConfigChange({ ...cfg, jobs: newJobs })
  }

  const deleteJob = (idx: number) => {
    onConfigChange({ ...cfg, jobs: cfg.jobs.filter((_, i) => i !== idx) })
    if (expandedJob === idx) setExpandedJob(null)
  }

  const duplicateJob = (idx: number) => {
    const newJobs = [...cfg.jobs]
    newJobs.splice(idx + 1, 0, { ...cfg.jobs[idx] })
    onConfigChange({ ...cfg, jobs: newJobs })
    setExpandedJob(idx + 1)
  }

  const applyPreset = (preset: Partial<FioJob>) => {
    onConfigChange({ ...cfg, jobs: [...cfg.jobs, { ...DEFAULT_JOB, ...preset }] })
    setExpandedJob(cfg.jobs.length)
  }

  const saveToServer = async () => {
    setSaveStatus('saving')
    try {
      const text = generateFioText(cfg, true)
      await App.SaveScript(configName, text)
      await App.SaveScriptConfig(configName, JSON.stringify(cfg))
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
      const configJSON = await App.GetScriptConfig(name)
      if (configJSON) {
        const parsed = JSON.parse(configJSON)
        if (parsed.global && parsed.jobs) {
          onConfigChange(ensureConfig(parsed))
          onConfigNameChange(name.replace('.fio', ''))
          onAudit('加载配置', `配置: ${name}`)
          return
        }
      }
      const content = await App.GetScriptContent(name)
      const jsonMatch = content.match(/# FIO_CONFIG_JSON: ({.*})/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1])
        if (parsed.global && parsed.jobs) {
          onConfigChange(ensureConfig(parsed))
          onConfigNameChange(name.replace('.fio', ''))
          onAudit('加载配置', `配置: ${name}`)
          return
        }
      }
      onConfigNameChange(name.replace('.fio', ''))
      onAudit('加载配置 (文本)', `配置: ${name}`)
    } catch (err) {
      console.error('加载配置失败:', err)
    }
  }

  const deleteFromServer = async (name: string) => {
    try {
      await App.DeleteScript(name)
      await App.DeleteScriptConfig(name)
      onAudit('删除配置', `配置: ${name}`)
      loadScripts()
    } catch (err) {
      console.error('删除配置失败:', err)
    }
  }

  return (
    <div>
      <div className="manager-header">
        <h2>脚本管理</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={loadScripts}>刷新</button>
          <button className="btn btn-primary btn-sm" onClick={saveToServer}>
            {saveStatus === 'saving' ? '保存中...' : saveStatus === 'saved' ? '已保存 ✓' : '保存配置'}
          </button>
        </div>
      </div>

      <div className="two-col">
        {/* 左栏：脚本列表 + 配置条目 */}
        <div className="col-left">
          {/* 脚本列表 */}
          <div className="panel">
            <h3 className="section-title">保存的脚本</h3>
            {savedScripts.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>暂无保存的脚本</p>
            ) : (
              <div style={{ maxHeight: 120, overflowY: 'auto' }}>
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

          {/* 配置条目 */}
          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 className="section-title" style={{ marginBottom: 0 }}>配置条目 ({cfg.jobs.length})</h3>
              <button className="btn btn-primary btn-sm" onClick={addJob}>+ 添加条目</button>
            </div>

            {cfg.jobs.map((job, idx) => (
              <div key={idx} className="card" style={{ marginBottom: 12 }}>
                <div className="card-header" style={{ cursor: 'pointer', marginBottom: 0 }}
                  onClick={() => setExpandedJob(expandedJob === idx ? null : idx)}>
                  <span className="card-title">
                    {expandedJob === idx ? '▼' : '▶'} #{idx + 1} {bsLabel(job.bs)} / {job.rw} / Q{job.iodepth}
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); duplicateJob(idx) }}>复制</button>
                    <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); deleteJob(idx) }}>删除</button>
                  </div>
                </div>
                {expandedJob === idx && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ marginBottom: 8 }}>
                      <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>块大小 (KB)</label>
                      <div className="preset-group">
                        {BS_PRESETS.map(bs => (
                          <button key={bs} className={`btn btn-sm ${job.bs === bs ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => updateJob(idx, { bs })}>
                            {bsLabel(bs)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label>读写类型</label>
                        <select value={job.rw} onChange={(e) => updateJob(idx, { rw: e.target.value })}>
                          {RW_OPTIONS.map(rw => <option key={rw} value={rw}>{rw}</option>)}
                        </select>
                      </div>
                      {(job.rw === 'readwrite' || job.rw === 'randrw') && (
                        <div className="form-group">
                          <label>读占比 (%)</label>
                          <input type="number" min={0} max={100} value={job.rwmixread ?? 50}
                            onChange={(e) => updateJob(idx, { rwmixread: parseInt(e.target.value) || 50 })} />
                        </div>
                      )}
                      <div className="form-group">
                        <label>队列深度</label>
                        <input type="number" value={job.iodepth}
                          onChange={(e) => updateJob(idx, { iodepth: parseInt(e.target.value) || 1 })} />
                      </div>
                      <div className="form-group">
                        <label>并发数</label>
                        <input type="number" value={job.numjobs}
                          onChange={(e) => updateJob(idx, { numjobs: parseInt(e.target.value) || 1 })} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                      <label className="toggle-label">
                        <input type="checkbox" checked={job.direct}
                          onChange={(e) => updateJob(idx, { direct: e.target.checked })} />
                        Direct I/O
                      </label>
                      <label className="toggle-label">
                        <input type="checkbox" checked={job.thread}
                          onChange={(e) => updateJob(idx, { thread: e.target.checked })} />
                        Thread 模式
                      </label>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <button className="btn btn-outline btn-sm"
                        onClick={() => setShowAdvanced({ ...showAdvanced, [idx]: !showAdvanced[idx] })}>
                        {showAdvanced[idx] ? '收起高级' : '高级选项'}
                      </button>
                      {showAdvanced[idx] && (
                        <div className="form-row" style={{ marginTop: 8 }}>
                          <div className="form-group">
                            <label>fsync</label>
                            <input type="number" value={job.fsync ?? 0} placeholder="0=关闭"
                              onChange={(e) => updateJob(idx, { fsync: parseInt(e.target.value) || 0 })} />
                          </div>
                          <div className="form-group">
                            <label>batch</label>
                            <input type="number" value={job.iodepth_batch ?? 0} placeholder="0=自动"
                              onChange={(e) => updateJob(idx, { iodepth_batch: parseInt(e.target.value) || 0 })} />
                          </div>
                          <div className="form-group">
                            <label>限速 (IOPS)</label>
                            <input type="number" value={job.rate_iops ?? 0} placeholder="0=不限"
                              onChange={(e) => updateJob(idx, { rate_iops: parseInt(e.target.value) || 0 })} />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {cfg.jobs.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>点击「添加条目」或使用场景预设</p>
            )}
          </div>
        </div>

        {/* 右栏：场景预设 + 全局配置 + 日志 */}
        <div className="col-right">
          {/* 场景预设 */}
          <div className="panel">
            <h3 className="section-title">场景预设</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(SCENE_PRESETS).map(([name, preset]) => (
                <button key={name} className="btn btn-outline btn-sm" onClick={() => applyPreset(preset)}>
                  {name}
                </button>
              ))}
            </div>
          </div>

          {/* 全局配置 */}
          <div className="panel">
            <h3 className="section-title">全局配置</h3>
            <div className="form-group">
              <label>配置名称</label>
              <input value={configName} onChange={(e) => onConfigNameChange(e.target.value)} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>文件路径</label>
                <input value={cfg.global.filename} onChange={(e) => updateGlobal('filename', e.target.value)} />
              </div>
              <div className="form-group">
                <label>运行时间 (秒)</label>
                <input type="number" value={cfg.global.runtime} onChange={(e) => updateGlobal('runtime', parseInt(e.target.value) || 0)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>预热时间 (秒)</label>
                <input type="number" value={cfg.global.ramp_time} onChange={(e) => updateGlobal('ramp_time', parseInt(e.target.value) || 0)} />
              </div>
              <div className="form-group">
                <label>IO 引擎</label>
                <select value={cfg.global.ioengine} onChange={(e) => updateGlobal('ioengine', e.target.value)}>
                  <option value="libaio">libaio</option>
                  <option value="io_uring">io_uring</option>
                  <option value="posixaio">posixaio</option>
                  <option value="sync">sync</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>测试大小 (可选)</label>
                <input value={cfg.global.size || ''} placeholder="留空=自动"
                  onChange={(e) => updateGlobal('size', e.target.value || undefined)} />
              </div>
              <div className="form-group">
                <label>工作目录 (可选)</label>
                <input value={cfg.global.directory || ''} placeholder="留空=默认"
                  onChange={(e) => updateGlobal('directory', e.target.value || undefined)} />
              </div>
            </div>
          </div>

          {/* 日志配置 */}
          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showLogging ? 12 : 0 }}>
              <h3 className="section-title" style={{ marginBottom: 0 }}>日志配置</h3>
              <button className="btn btn-outline btn-sm" onClick={() => setShowLogging(!showLogging)}>
                {showLogging ? '收起' : '展开'}
              </button>
            </div>
            {showLogging && (
              <>
                <label className="toggle-label" style={{ marginBottom: 8 }}>
                  <input type="checkbox" checked={log.enabled}
                    onChange={(e) => updateLogging('enabled', e.target.checked)} />
                  启用日志
                </label>
                {log.enabled && (
                  <>
                    <div className="form-row">
                      <div className="form-group">
                        <label>采样间隔 (ms)</label>
                        <input type="number" value={log.log_avg_msec}
                          onChange={(e) => updateLogging('log_avg_msec', parseInt(e.target.value) || 500)} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 16 }}>
                      <label className="toggle-label">
                        <input type="checkbox" checked={log.write_bw_log}
                          onChange={(e) => updateLogging('write_bw_log', e.target.checked)} />
                        带宽日志
                      </label>
                      <label className="toggle-label">
                        <input type="checkbox" checked={log.write_lat_log}
                          onChange={(e) => updateLogging('write_lat_log', e.target.checked)} />
                        延迟日志
                      </label>
                      <label className="toggle-label">
                        <input type="checkbox" checked={log.write_iops_log}
                          onChange={(e) => updateLogging('write_iops_log', e.target.checked)} />
                        IOPS 日志
                      </label>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
