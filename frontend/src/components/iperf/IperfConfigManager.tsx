import { useState, useEffect } from 'react'
import { IperfConfig } from '../../types'
import * as App from '../../wailsjs/go/app/App'

interface Props {
  onAudit: (action: string, details: string) => void
}

const DEFAULT_CONFIG: IperfConfig = {
  id: '',
  name: '',
  protocol: 'tcp',
  bandwidth: '0',
  duration: 30,
  parallel: 1,
  blockSize: '',
  windowSize: '',
  reverse: false,
  bidir: false,
  extraFlags: '',
}

export function IperfConfigManager({ onAudit }: Props) {
  const [configs, setConfigs] = useState<IperfConfig[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [editing, setEditing] = useState<IperfConfig>({ ...DEFAULT_CONFIG })
  const [dirty, setDirty] = useState(false)

  useEffect(() => { loadConfigs() }, [])

  const loadConfigs = async () => {
    try {
      const list = await App.GetIperfConfigs()
      setConfigs(list || [])
    } catch { /* ignore */ }
  }

  const createNew = () => {
    const id = `iperf-cfg-${Date.now()}`
    const cfg: IperfConfig = { ...DEFAULT_CONFIG, id, name: '新配置' }
    setEditing(cfg)
    setSelectedId(id)
    setDirty(true)
  }

  const selectConfig = (cfg: IperfConfig) => {
    setSelectedId(cfg.id)
    setEditing({ ...cfg })
    setDirty(false)
  }

  const deleteConfig = async (id: string) => {
    if (!confirm('确定删除此配置？')) return
    try {
      await App.DeleteIperfConfig(id)
      if (selectedId === id) {
        setSelectedId('')
        setEditing({ ...DEFAULT_CONFIG })
      }
      loadConfigs()
      onAudit('删除iperf3配置', id)
    } catch { /* ignore */ }
  }

  const saveConfig = async () => {
    if (configs.some(c => c.name === editing.name && c.id !== editing.id)) {
      alert('配置名称已存在，请使用其他名称')
      return
    }
    try {
      await App.SaveIperfConfig(editing)
      setDirty(false)
      loadConfigs()
      onAudit('保存iperf3配置', editing.name)
    } catch { /* ignore */ }
  }

  const updateField = <K extends keyof IperfConfig>(key: K, value: IperfConfig[K]) => {
    setEditing(prev => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  return (
    <div style={{ display: 'flex', height: '100%', gap: 16 }}>
      <div style={{ width: 240, flexShrink: 0 }}>
        <div className="manager-header">
          <h2>测试配置</h2>
          <button className="btn btn-primary btn-sm" onClick={createNew}>新建</button>
        </div>
        <div className="panel" style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
          {configs.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 12, padding: 12 }}>暂无配置</p>
          ) : configs.map(cfg => (
            <div key={cfg.id}
              className={`host-item ${selectedId === cfg.id ? 'active' : ''}`}
              style={{ cursor: 'pointer' }}
              onClick={() => selectConfig(cfg)}>
              <span style={{ flex: 1, fontSize: 13 }}>{cfg.name}</span>
              <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); deleteConfig(cfg.id) }}>删除</button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {editing.id ? (
          <div className="panel">
            <div className="form-group">
              <label>配置名称</label>
              <input value={editing.name} onChange={e => updateField('name', e.target.value)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label>协议</label>
                <select value={editing.protocol} onChange={e => updateField('protocol', e.target.value as 'tcp' | 'udp')}>
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                </select>
              </div>
              <div className="form-group">
                <label>测试时长 (秒)</label>
                <input type="number" value={editing.duration} onChange={e => updateField('duration', parseInt(e.target.value) || 30)} />
              </div>
              <div className="form-group">
                <label>带宽限制</label>
                <input value={editing.bandwidth} placeholder="0 = 无限制" onChange={e => updateField('bandwidth', e.target.value)} />
              </div>
              <div className="form-group">
                <label>并发流数 (-P)</label>
                <input type="number" value={editing.parallel} min={1} onChange={e => updateField('parallel', parseInt(e.target.value) || 1)} />
              </div>
              <div className="form-group">
                <label>块大小 (-l)</label>
                <input value={editing.blockSize} placeholder="默认" onChange={e => updateField('blockSize', e.target.value)} />
              </div>
              <div className="form-group">
                <label>窗口大小 (-w)</label>
                <input value={editing.windowSize} placeholder="默认" onChange={e => updateField('windowSize', e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={editing.reverse} onChange={e => updateField('reverse', e.target.checked)} />
                反向测试 (-R)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={editing.bidir} onChange={e => updateField('bidir', e.target.checked)} />
                双向测试 (--bidir)
              </label>
            </div>
            <div className="form-group" style={{ marginTop: 12 }}>
              <label>附加参数</label>
              <input value={editing.extraFlags} placeholder="例如: --connect-timeout 10" onChange={e => updateField('extraFlags', e.target.value)} />
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={saveConfig} disabled={!dirty}>保存</button>
              {dirty && <span style={{ fontSize: 12, color: 'var(--warning)', alignSelf: 'center' }}>有未保存的更改</span>}
            </div>
          </div>
        ) : (
          <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, color: 'var(--text-muted)' }}>
            选择或创建一个配置
          </div>
        )}
      </div>
    </div>
  )
}
