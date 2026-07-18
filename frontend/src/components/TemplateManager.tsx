import { useState, useEffect } from 'react'
import { FioConfig } from '../types'
import { generateFioText } from '../utils/fioGenerator'
import { ensureConfig } from '../utils/config'
import * as App from '../wailsjs/go/app/App'

interface Props {
  config: FioConfig
  configName: string
  onConfigChange: (config: FioConfig) => void
  onConfigNameChange: (name: string) => void
  onAudit: (action: string, details: string) => void
}

interface Template {
  name: string
  scripts: string[]
  createdAt: string
}

export function TemplateManager({ config, configName, onConfigChange, onConfigNameChange, onAudit }: Props) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [savedScripts, setSavedScripts] = useState<string[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [selectedScripts, setSelectedScripts] = useState<string[]>([])
  const [previewScript, setPreviewScript] = useState<string | null>(null)
  const [previewConfig, setPreviewConfig] = useState<FioConfig | null>(null)

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    try {
      const scripts = await App.GetScripts()
      setSavedScripts(scripts || [])

      const loaded: Template[] = []
      for (const name of scripts || []) {
        const configJSON = await App.GetScriptConfig(name)
        if (configJSON) {
          try {
            const parsed = JSON.parse(configJSON)
            if (parsed._template) {
              loaded.push({
                name: parsed._template,
                scripts: parsed._templateScripts || [],
                createdAt: parsed._templateCreatedAt || new Date().toISOString(),
              })
            }
          } catch { /* ignore */ }
        }
      }
      setTemplates(loaded)
    } catch { /* ignore */ }
  }

  const openCreate = () => {
    setNewName('')
    setSelectedScripts([])
    setShowCreate(true)
  }

  const confirmCreate = async () => {
    const name = newName.trim()
    if (!name || selectedScripts.length === 0) return

    const template: Template = {
      name,
      scripts: selectedScripts,
      createdAt: new Date().toISOString(),
    }

    try {
      const configData = {
        _template: name,
        _templateScripts: selectedScripts,
        _templateCreatedAt: template.createdAt,
        global: config.global,
        jobs: config.jobs,
      }
      await App.SaveScriptConfig(`${name}.fio`, JSON.stringify(configData))
      await App.SaveScript(`${name}.fio`, generateFioText(config, true))
      onAudit('创建模板', `模板: ${name}, 关联脚本: ${selectedScripts.length}个`)
      setShowCreate(false)
      loadAll()
    } catch (err) {
      console.error('创建模板失败:', err)
    }
  }

  const toggleScript = (name: string) => {
    setSelectedScripts(prev => prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name])
  }

  const loadTemplate = async (template: Template) => {
    try {
      const configJSON = await App.GetScriptConfig(`${template.name}.fio`)
      if (configJSON) {
        const parsed = JSON.parse(configJSON)
        if (parsed.global && parsed.jobs) {
          onConfigChange(ensureConfig(parsed))
          onConfigNameChange(template.name)
          onAudit('加载模板', `模板: ${template.name}`)
        }
      }
    } catch { /* ignore */ }
  }

  const deleteTemplate = async (name: string) => {
    try {
      await App.DeleteScript(`${name}.fio`)
      await App.DeleteScriptConfig(`${name}.fio`)
      onAudit('删除模板', `模板: ${name}`)
      if (selectedTemplate?.name === name) setSelectedTemplate(null)
      loadAll()
    } catch (err) {
      console.error('删除模板失败:', err)
    }
  }

  const previewScriptConfig = async (scriptName: string) => {
    if (previewScript === scriptName) {
      setPreviewScript(null)
      setPreviewConfig(null)
      return
    }
    try {
      const configJSON = await App.GetScriptConfig(scriptName)
      if (configJSON) {
        const parsed = JSON.parse(configJSON)
        if (parsed.global && parsed.jobs) {
          setPreviewScript(scriptName)
          setPreviewConfig(parsed)
        }
      }
    } catch { /* ignore */ }
  }

  return (
    <div>
      <div className="manager-header">
        <h2>模板管理</h2>
      </div>

      {showCreate && (
        <div className="panel" style={{ border: '1px solid var(--primary)' }}>
          <h3 className="section-title">创建模板</h3>
          <div className="form-group">
            <label>模板名称</label>
            <input value={newName} placeholder="输入模板名称"
              onChange={(e) => setNewName(e.target.value)} />
          </div>
          <div className="form-group">
            <label>选择脚本条目 ({selectedScripts.length}/{savedScripts.length})</label>
            {savedScripts.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>暂无已保存的脚本，请先在脚本管理中保存</p>
            ) : (
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {savedScripts.map(s => (
                  <label key={s} className="toggle-label" style={{ padding: '3px 0' }}>
                    <input type="checkbox" checked={selectedScripts.includes(s)}
                      onChange={() => toggleScript(s)} />
                    {s}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={confirmCreate}
              disabled={!newName.trim() || selectedScripts.length === 0}>
              确认创建
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => setShowCreate(false)}>取消</button>
          </div>
        </div>
      )}

      {!showCreate && (
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="section-title" style={{ marginBottom: 0 }}>模板列表</h3>
            <button className="btn btn-primary btn-sm" onClick={openCreate}>添加模板</button>
          </div>
        </div>
      )}

      {templates.length > 0 && (
        <div className="panel">
          <h3 className="section-title">模板 ({templates.length})</h3>
          {templates.map((t) => (
            <div key={t.name} className="card" style={{ cursor: 'pointer' }}
              onClick={() => setSelectedTemplate(selectedTemplate?.name === t.name ? null : t)}>
              <div className="card-header">
                <span className="card-title">{t.name}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); loadTemplate(t) }}>加载</button>
                  <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); deleteTemplate(t.name) }}>删除</button>
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                关联脚本: {t.scripts.length}个 — {t.scripts.join(', ')}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedTemplate && (
        <div className="panel">
          <h3 className="section-title">模板详情: {selectedTemplate.name}</h3>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            创建时间: {new Date(selectedTemplate.createdAt).toLocaleString()}
          </div>

          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>关联脚本:</div>
          {selectedTemplate.scripts.map(s => (
            <div key={s} className="host-item" style={{ cursor: 'pointer', padding: '6px 10px' }}
              onClick={() => previewScriptConfig(s)}>
              <span style={{ flex: 1, fontSize: 12 }}>{s}</span>
              <span style={{ fontSize: 11, color: previewScript === s ? 'var(--primary)' : 'var(--text-muted)' }}>
                {previewScript === s ? '收起' : '预览'}
              </span>
            </div>
          ))}

          {previewScript && previewConfig && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>脚本配置: {previewScript}</div>
              <pre className="code-preview" style={{ maxHeight: 300 }}>
                {generateFioText(previewConfig, false)}
              </pre>
            </div>
          )}

          <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }}
            onClick={() => loadTemplate(selectedTemplate)}>
            应用到当前配置
          </button>
        </div>
      )}

      {templates.length === 0 && !showCreate && (
        <div className="panel">
          <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>
            暂无模板，点击"添加模板"创建一个吧
          </p>
        </div>
      )}
    </div>
  )
}
