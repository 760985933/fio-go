import { useState } from 'react'
import { FioConfig, FioJob } from '../types'
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
  '数据库':     { bs: 8,   rw: 'randrw',     iodepth: 64, numjobs: 1, rwmixread: 70, direct: true, thread: true },
}

const DEFAULT_JOB: FioJob = { bs: 4, rw: 'read', iodepth: 32, numjobs: 1, direct: true, thread: true }

export function ScriptManager({ config, configName, onConfigChange, onConfigNameChange, onAudit }: Props) {
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [editJob, setEditJob] = useState<FioJob>({ ...DEFAULT_JOB })
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const cfg = ensureConfig(config)

  const updateGlobal = (key: string, value: any) => {
    onConfigChange({ ...cfg, global: { ...cfg.global, [key]: value } })
  }

  const updateEditJob = (updates: Partial<FioJob>) => {
    setEditJob(prev => ({ ...prev, ...updates }))
  }

  const resetForm = () => {
    setEditIdx(null)
    setEditJob({ ...DEFAULT_JOB })
    setShowAdvanced(false)
  }

  const addJob = () => {
    const newJobs = [...cfg.jobs, { ...editJob }]
    onConfigChange({ ...cfg, jobs: newJobs })
    setEditIdx(newJobs.length - 1)
  }

  const saveEditedJob = () => {
    if (editIdx === null || editIdx < 0 || editIdx >= cfg.jobs.length) return
    const newJobs = [...cfg.jobs]
    newJobs[editIdx] = { ...editJob }
    onConfigChange({ ...cfg, jobs: newJobs })
  }

  const deleteJob = (idx: number) => {
    onConfigChange({ ...cfg, jobs: cfg.jobs.filter((_, i) => i !== idx) })
    if (editIdx === idx) resetForm()
    else if (editIdx !== null && editIdx > idx) setEditIdx(editIdx - 1)
  }

  const duplicateJob = (idx: number) => {
    const newJobs = [...cfg.jobs]
    newJobs.splice(idx + 1, 0, { ...cfg.jobs[idx] })
    onConfigChange({ ...cfg, jobs: newJobs })
    selectJob(idx + 1)
  }

  const selectJob = (idx: number) => {
    setEditIdx(idx)
    setEditJob({ ...cfg.jobs[idx] })
    setShowAdvanced(false)
  }

  const applyPreset = (preset: Partial<FioJob>) => {
    setEditJob(prev => ({ ...prev, ...preset }))
  }

  const saveConfig = async (name: string) => {
    setSaveStatus('saving')
    try {
      const text = generateFioText(cfg, true)
      await App.SaveScript(name, text)
      await App.SaveScriptConfig(name, JSON.stringify(cfg))
      setSaveStatus('saved')
      onAudit('保存配置', `配置: ${name}`)
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }

  const saveAsNewConfig = async () => {
    const newName = window.prompt('请输入新配置名称：')
    if (!newName || !newName.trim()) return
    onConfigNameChange(newName.trim())
    await saveConfig(newName.trim())
  }

  const isEditing = editIdx !== null && editIdx >= 0 && editIdx < cfg.jobs.length

  return (
    <div>
      <div className="two-col">
        {/* 左栏：条目列表 */}
        <div className="col-left">
          <div className="panel">
            <h3 className="section-title">配置条目 ({cfg.jobs.length})</h3>
            {cfg.jobs.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>在右侧编辑后点击「添加条目」</p>
            ) : (
              cfg.jobs.map((job, idx) => (
                <div key={idx} className="card" style={{ marginBottom: 6, cursor: 'pointer', borderColor: editIdx === idx ? 'var(--primary)' : undefined }}
                  onClick={() => selectJob(idx)}>
                  <div className="card-header" style={{ marginBottom: 0 }}>
                    <span className="card-title">#{idx + 1} {bsLabel(job.bs)} / {job.rw} / Q{job.iodepth}</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); duplicateJob(idx) }}>复制</button>
                      <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); deleteJob(idx) }}>删除</button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 右栏：编辑器 */}
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

          {/* 配置编辑 */}
          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 className="section-title" style={{ marginBottom: 0 }}>编辑配置</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn btn-primary btn-sm" onClick={() => saveConfig(configName)}>
                  {saveStatus === 'saving' ? '保存中...' : saveStatus === 'saved' ? '已保存 ✓' : '保存配置'}
                </button>
                <button className="btn btn-outline btn-sm" onClick={saveAsNewConfig}>新增配置</button>
                {saveStatus === 'saved' && <span style={{ fontSize: 12, color: 'var(--success)' }}>已保存</span>}
                {saveStatus === 'error' && <span style={{ fontSize: 12, color: 'var(--danger)' }}>保存失败</span>}
              </div>
            </div>

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
            </div>

            <hr style={{ margin: '12px 0', border: 'none', borderTop: '1px solid var(--border)' }} />

            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>块大小 (KB)</label>
              <div className="preset-group">
                {BS_PRESETS.map(bs => (
                  <button key={bs} className={`btn btn-sm ${editJob.bs === bs ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => updateEditJob({ bs })}>
                    {bsLabel(bs)}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>读写类型</label>
                <select value={editJob.rw} onChange={(e) => updateEditJob({ rw: e.target.value })}>
                  {RW_OPTIONS.map(rw => <option key={rw} value={rw}>{rw}</option>)}
                </select>
              </div>
              {(editJob.rw === 'readwrite' || editJob.rw === 'randrw') && (
                <div className="form-group">
                  <label>读占比 (%)</label>
                  <input type="number" min={0} max={100} value={editJob.rwmixread ?? 50}
                    onChange={(e) => updateEditJob({ rwmixread: parseInt(e.target.value) || 50 })} />
                </div>
              )}
              <div className="form-group">
                <label>队列深度</label>
                <input type="number" value={editJob.iodepth}
                  onChange={(e) => updateEditJob({ iodepth: parseInt(e.target.value) || 1 })} />
              </div>
              <div className="form-group">
                <label>并发数</label>
                <input type="number" value={editJob.numjobs}
                  onChange={(e) => updateEditJob({ numjobs: parseInt(e.target.value) || 1 })} />
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <button className="btn btn-outline btn-sm"
                onClick={() => setShowAdvanced(!showAdvanced)}>
                {showAdvanced ? '收起高级选项' : '高级选项'}
              </button>
              {showAdvanced && (
                <div style={{ marginTop: 8 }}>
                  <div className="form-row">
                    <div className="form-group">
                      <label>IO 引擎</label>
                      <select value={cfg.global.ioengine} onChange={(e) => updateGlobal('ioengine', e.target.value)}>
                        <option value="libaio">libaio</option>
                        <option value="io_uring">io_uring</option>
                        <option value="posixaio">posixaio</option>
                        <option value="sync">sync</option>
                      </select>
                    </div>
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
                  <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                    <label className="toggle-label">
                      <input type="checkbox" checked={editJob.direct}
                        onChange={(e) => updateEditJob({ direct: e.target.checked })} />
                      Direct I/O
                    </label>
                    <label className="toggle-label">
                      <input type="checkbox" checked={editJob.thread}
                        onChange={(e) => updateEditJob({ thread: e.target.checked })} />
                      Thread 模式
                    </label>
                  </div>
                  <div className="form-row" style={{ marginTop: 8 }}>
                    <div className="form-group">
                      <label>fsync</label>
                      <input type="number" value={editJob.fsync ?? 0} placeholder="0=关闭"
                        onChange={(e) => updateEditJob({ fsync: parseInt(e.target.value) || 0 })} />
                    </div>
                    <div className="form-group">
                      <label>batch</label>
                      <input type="number" value={editJob.iodepth_batch ?? 0} placeholder="0=自动"
                        onChange={(e) => updateEditJob({ iodepth_batch: parseInt(e.target.value) || 0 })} />
                    </div>
                    <div className="form-group">
                      <label>限速 (IOPS)</label>
                      <input type="number" value={editJob.rate_iops ?? 0} placeholder="0=不限"
                        onChange={(e) => updateEditJob({ rate_iops: parseInt(e.target.value) || 0 })} />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              {isEditing ? (
                <>
                  <button className="btn btn-primary btn-sm" onClick={saveEditedJob}>保存配置</button>
                  <button className="btn btn-outline btn-sm" onClick={resetForm}>取消编辑</button>
                </>
              ) : (
                <button className="btn btn-primary btn-sm" onClick={addJob}>添加条目</button>
              )}
            </div>
          </div>


        </div>
      </div>
    </div>
  )
}
