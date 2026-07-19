import { useState, useEffect, useCallback } from 'react'
import { FioConfig, FioJob } from '../types'
import { ensureConfig, bsLabel } from '../utils/config'
import * as App from '../wailsjs/go/app/App'

interface Props {
  onAudit: (action: string, details: string) => void
}

const DEFAULT_CONFIG: FioConfig = {
  global: { filename: '/dev/vdb', runtime: 180, ramp_time: 30, ioengine: 'libaio' },
  logging: { enabled: true, log_avg_msec: 500, write_bw_log: true, write_lat_log: true, write_iops_log: true },
  jobs: [{ bs: 4, rw: 'read', iodepth: 32, numjobs: 1, direct: true, thread: true }],
}

const DEFAULT_JOB: FioJob = { bs: 4, rw: 'read', iodepth: 32, numjobs: 1, direct: true, thread: true }
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

function autoName(cfg: FioConfig, job: FioJob): string {
  const fn = cfg.global.filename || ''
  const base = fn.split('/').pop()?.split('.')[0] || 'config'
  return `fio_${base}_${job.bs || 4}k_${job.rw || 'read'}`
}

export function ScriptManager({ onAudit }: Props) {
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [cfg, setCfg] = useState<FioConfig>({ ...DEFAULT_CONFIG, jobs: DEFAULT_CONFIG.jobs.map(j => ({ ...j })) })
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [editJob, setEditJob] = useState<FioJob>({ ...DEFAULT_JOB })
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDesc, setCreateDesc] = useState('')
  const [createError, setCreateError] = useState('')
  const [showJobJson, setShowJobJson] = useState<number | null>(null)

  const loadModels = useCallback(async () => {
    try {
      const list = await App.GetScripts()
      setModels(list || [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadModels() }, [loadModels])

  const loadConfig = async (name: string) => {
    try {
      const json = await App.GetScriptConfig(name)
      if (json) {
        const parsed = JSON.parse(json) as FioConfig
        const ensured = ensureConfig(parsed)
        setCfg(ensured)
      } else {
        setCfg({ ...DEFAULT_CONFIG, jobs: [] })
      }
      setSelectedModel(name)
      setEditIdx(null)
      setEditJob({ ...DEFAULT_JOB })
      setShowAdvanced(false)
    } catch {
      setSelectedModel(name)
      setCfg({ ...DEFAULT_CONFIG, jobs: [] })
      setEditIdx(null)
      setEditJob({ ...DEFAULT_JOB })
      setShowAdvanced(false)
    }
  }

  const saveConfig = async (name: string, config: FioConfig) => {
    setSaveStatus('saving')
    await App.SaveScriptConfig(name, JSON.stringify(config))
    setSaveStatus('saved')
    onAudit('保存配置', `配置: ${name}`)
    setTimeout(() => setSaveStatus('idle'), 2000)
  }

  const openCreateDialog = () => {
    setCreateName('')
    setCreateDesc('')
    setCreateError('')
    setShowCreate(true)
  }

  const doCreateModel = async () => {
    const name = createName.trim() || autoName(DEFAULT_CONFIG, DEFAULT_JOB)
    const newCfg = { ...DEFAULT_CONFIG, description: createDesc.trim() || undefined, jobs: [] }
    try {
      await saveConfig(name, newCfg)
      await loadModels()
      await loadConfig(name)
      setShowCreate(false)
    } catch (e: any) {
      setSaveStatus('error')
      setCreateError(String(e?.message || e))
      setTimeout(() => setSaveStatus('idle'), 5000)
    }
  }

  const deleteModel = async (name: string) => {
    try {
      await App.DeleteScriptConfig(name)
      if (selectedModel === name) {
        setSelectedModel(null)
        setCfg({ ...DEFAULT_CONFIG, jobs: DEFAULT_CONFIG.jobs.map(j => ({ ...j })) })
        setEditIdx(null)
        setEditJob({ ...DEFAULT_JOB })
      }
      await loadModels()
    } catch { /* ignore */ }
  }

  const isEditing = editIdx !== null && editIdx >= 0 && editIdx < cfg.jobs.length
  const canAdd = selectedModel !== null

  const updateGlobal = (key: string, value: any) => {
    setCfg(prev => ({ ...prev, global: { ...prev.global, [key]: value } }))
  }

  const updateEditJob = (updates: Partial<FioJob>) => {
    setEditJob(prev => ({ ...prev, ...updates }))
  }

  const resetForm = () => {
    setEditIdx(null)
    setEditJob({ ...DEFAULT_JOB })
    setShowAdvanced(false)
  }

  const addJob = async () => {
    if (!canAdd || !selectedModel) return
    const newJobs = [...cfg.jobs, { ...editJob }]
    const newCfg = { ...cfg, jobs: newJobs }
    setCfg(newCfg)
    setEditIdx(newJobs.length - 1)
    try { await saveConfig(selectedModel, newCfg) } catch { setSaveStatus('error'); setTimeout(() => setSaveStatus('idle'), 3000) }
  }

  const saveEditedJob = async () => {
    if (editIdx === null || editIdx < 0 || editIdx >= cfg.jobs.length || !selectedModel) return
    const newJobs = [...cfg.jobs]
    newJobs[editIdx] = { ...editJob }
    const newCfg = { ...cfg, jobs: newJobs }
    setCfg(newCfg)
    try { await saveConfig(selectedModel, newCfg) } catch { setSaveStatus('error'); setTimeout(() => setSaveStatus('idle'), 3000) }
  }

  const deleteJob = async (idx: number) => {
    if (!selectedModel) return
    const newJobs = cfg.jobs.filter((_, i) => i !== idx)
    const newCfg = { ...cfg, jobs: newJobs }
    setCfg(newCfg)
    if (editIdx === idx) resetForm()
    else if (editIdx !== null && editIdx > idx) setEditIdx(editIdx - 1)
    try { await saveConfig(selectedModel, newCfg) } catch { setSaveStatus('error'); setTimeout(() => setSaveStatus('idle'), 3000) }
  }

  const duplicateJob = async (idx: number) => {
    if (!selectedModel) return
    const newJobs = [...cfg.jobs]
    newJobs.splice(idx + 1, 0, { ...cfg.jobs[idx] })
    const newCfg = { ...cfg, jobs: newJobs }
    setCfg(newCfg)
    setEditIdx(idx + 1)
    setEditJob({ ...cfg.jobs[idx] })
    setShowAdvanced(false)
    try { await saveConfig(selectedModel, newCfg) } catch { setSaveStatus('error'); setTimeout(() => setSaveStatus('idle'), 3000) }
  }

  const selectJob = (idx: number) => {
    setEditIdx(idx)
    setEditJob({ ...cfg.jobs[idx] })
    setShowAdvanced(false)
  }

  const applyPreset = (preset: Partial<FioJob>) => {
    setEditJob(prev => ({ ...prev, ...preset }))
  }

  return (
    <div>
      <div className="two-col">
        {/* 左栏 */}
        <div className="col-left">
          {/* 上栏：配置模型列表 */}
          <div className="panel" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 className="section-title" style={{ marginBottom: 0 }}>配置模型</h3>
              <button className="btn btn-primary btn-sm" onClick={openCreateDialog}>新建配置模型</button>
            </div>
            {models.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>暂无配置模型，请新建</p>
            ) : (
              models.map(name => (
                <div key={name} className="card" style={{ marginBottom: 6, cursor: 'pointer', borderColor: selectedModel === name ? 'var(--primary)' : undefined }}
                  onClick={() => loadConfig(name)}>
                  <div className="card-header" style={{ marginBottom: 0 }}>
                    <span className="card-title">{name}</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); deleteModel(name) }}>删除</button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 下栏：选中模型下的参数列表 */}
          {selectedModel && (
            <div className="panel">
              <h3 className="section-title">模型参数 ({cfg.jobs.length})</h3>
              {cfg.jobs.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>在右侧编辑后点击「添加模型」</p>
              ) : (
                cfg.jobs.map((job, idx) => (
                  <div key={idx} className="card" style={{ marginBottom: 6, cursor: 'pointer', borderColor: editIdx === idx ? 'var(--primary)' : undefined, padding: '10px 12px' }}
                    onClick={() => selectJob(idx)}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 22, height: 22, borderRadius: '50%', background: editIdx === idx ? 'var(--primary)' : 'var(--bg-secondary)', color: editIdx === idx ? '#fff' : 'var(--text-secondary)', fontSize: 12, fontWeight: 600, lineHeight: '22px', textAlign: 'center' }}>{idx + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                          <span style={{ fontSize: 12, padding: '1px 8px', borderRadius: 4, background: 'var(--bg-secondary)', whiteSpace: 'nowrap' }}><span style={{ color: 'var(--text-muted)' }}>rw</span> <b style={{ color: 'var(--text)' }}>{job.rw}</b></span>
                          <span style={{ fontSize: 12, padding: '1px 8px', borderRadius: 4, background: 'var(--bg-secondary)', whiteSpace: 'nowrap' }}><span style={{ color: 'var(--text-muted)' }}>bs</span> <b style={{ color: 'var(--text)' }}>{bsLabel(job.bs)}</b></span>
                          <span style={{ fontSize: 12, padding: '1px 8px', borderRadius: 4, background: 'var(--bg-secondary)', whiteSpace: 'nowrap' }}><span style={{ color: 'var(--text-muted)' }}>numjobs</span> <b style={{ color: 'var(--text)' }}>{job.numjobs}</b></span>
                          <span style={{ fontSize: 12, padding: '1px 8px', borderRadius: 4, background: 'var(--bg-secondary)', whiteSpace: 'nowrap' }}><span style={{ color: 'var(--text-muted)' }}>iodepth</span> <b style={{ color: 'var(--text)' }}>{job.iodepth}</b></span>
                          {job.rwmixread != null && <span style={{ fontSize: 12, padding: '1px 8px', borderRadius: 4, background: 'var(--bg-secondary)', whiteSpace: 'nowrap' }}><span style={{ color: 'var(--text-muted)' }}>rwmixread</span> <b style={{ color: 'var(--text)' }}>{job.rwmixread}%</b></span>}
                          {job.fsync != null && <span style={{ fontSize: 12, padding: '1px 8px', borderRadius: 4, background: 'var(--bg-secondary)', whiteSpace: 'nowrap' }}><span style={{ color: 'var(--text-muted)' }}>fsync</span> <b style={{ color: 'var(--text)' }}>{job.fsync}</b></span>}
                          {job.rate_iops ? <span style={{ fontSize: 12, padding: '1px 8px', borderRadius: 4, background: 'var(--bg-secondary)', whiteSpace: 'nowrap' }}><span style={{ color: 'var(--text-muted)' }}>rate_iops</span> <b style={{ color: 'var(--text)' }}>{job.rate_iops}</b></span> : null}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {cfg.global.filename || '无文件'} · {cfg.global.runtime}s · ioengine: {cfg.global.ioengine}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                        <button className="btn btn-outline btn-sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={(e) => { e.stopPropagation(); setShowJobJson(idx) }}>JSON</button>
                        <button className="btn btn-outline btn-sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={(e) => { e.stopPropagation(); duplicateJob(idx) }}>复制</button>
                        <button className="btn btn-danger btn-sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={(e) => { e.stopPropagation(); deleteJob(idx) }}>删除</button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* 右栏：编辑器 */}
        <div className="col-right">
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

          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 className="section-title" style={{ marginBottom: 0 }}>
                {isEditing ? (
                  <span><span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: '50%', background: 'var(--primary)', color: '#fff', fontSize: 11, fontWeight: 600, marginRight: 6 }}>{editIdx! + 1}</span>编辑模型参数</span>
                ) : selectedModel ? `添加模型 - ${selectedModel}` : '编辑配置'}
              </h3>
              {saveStatus === 'saved' && <span style={{ fontSize: 12, color: 'var(--success)' }}>已保存</span>}
              {saveStatus === 'error' && <span style={{ fontSize: 12, color: 'var(--danger)' }}>保存失败</span>}
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
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <div className="preset-group">
                  {BS_PRESETS.map(bs => (
                    <button key={bs} className={`btn btn-sm ${editJob.bs === bs ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => updateEditJob({ bs })}>
                      {bsLabel(bs)}
                    </button>
                  ))}
                </div>
                <input type="number" value={editJob.bs} min={1}
                  onChange={(e) => updateEditJob({ bs: parseInt(e.target.value) || 4 })}
                  style={{ width: 80 }} />
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
                  <input type="number" min={0} max={100} value={editJob.rwmixread ?? 70}
                    onChange={(e) => updateEditJob({ rwmixread: parseInt(e.target.value) || 70 })} />
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
                  <button className="btn btn-primary btn-sm" onClick={saveEditedJob}>更新参数</button>
                  <button className="btn btn-outline btn-sm" onClick={resetForm}>取消编辑</button>
                </>
              ) : (
                <button className="btn btn-primary btn-sm" onClick={addJob} disabled={!canAdd}
                  style={{ opacity: canAdd ? 1 : 0.5, cursor: canAdd ? 'pointer' : 'not-allowed' }}>
                  添加模型
                </button>
              )}
            </div>
            {!canAdd && (
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>请先在左侧选中一个配置模型</p>
            )}
          </div>
        </div>
      </div>

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>新建配置模型</h3>
              <button className="modal-close" onClick={() => setShowCreate(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>配置名称</label>
                <input value={createName} onChange={(e) => setCreateName(e.target.value)}
                  placeholder={`例如: ${autoName(DEFAULT_CONFIG, DEFAULT_JOB)}`} />
              </div>
              <div className="form-group">
                <label>描述信息</label>
                <textarea value={createDesc} onChange={(e) => setCreateDesc(e.target.value)}
                  placeholder="可选，描述该模型的用途" rows={3}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }}></textarea>
              </div>
            </div>
            <div className="modal-footer">
              {createError && <span style={{ fontSize: 12, color: 'var(--danger)', marginRight: 'auto' }}>{createError}</span>}
              <button className="btn btn-outline" onClick={() => setShowCreate(false)}>取消</button>
              <button className="btn btn-primary" onClick={doCreateModel} disabled={saveStatus === 'saving'}>
                {saveStatus === 'saving' ? '保存中...' : '确定'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showJobJson !== null && (
        <div className="modal-overlay" onClick={() => setShowJobJson(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>参数 #{showJobJson + 1} JSON</h3>
              <button className="modal-close" onClick={() => setShowJobJson(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <pre style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: 'var(--bg-secondary)', padding: 12, borderRadius: 6, margin: 0 }}>{JSON.stringify(cfg.jobs[showJobJson], null, 2)}</pre>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => { navigator.clipboard.writeText(JSON.stringify(cfg.jobs[showJobJson], null, 2)).catch(() => alert('复制失败')); setShowJobJson(null) }}>复制并关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
