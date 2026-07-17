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
  config: FioConfig
  createdAt: string
}

export function TemplateManager({ config, configName, onConfigChange, onConfigNameChange, onAudit }: Props) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [newName, setNewName] = useState('')

  useEffect(() => { loadTemplates() }, [])

  const loadTemplates = async () => {
    try {
      const scripts = await App.GetScripts()
      const loaded: Template[] = []
      for (const name of scripts || []) {
        const configJSON = await App.GetScriptConfig(name)
        if (configJSON) {
          const parsed = JSON.parse(configJSON)
          if (parsed.global && parsed.jobs) {
            loaded.push({
              name: name.replace('.fio', ''),
              config: parsed,
              createdAt: new Date().toISOString(),
            })
          }
        }
      }
      setTemplates(loaded)
    } catch { /* ignore */ }
  }

  const saveAsTemplate = async () => {
    const name = newName.trim() || `${configName}_template_${Date.now()}`
    try {
      await App.SaveScriptConfig(`${name}.fio`, JSON.stringify(config))
      await App.SaveScript(`${name}.fio`, generateFioText(config, true))
      onAudit('保存模板', `模板: ${name}`)
      setNewName('')
      loadTemplates()
    } catch (err) {
      console.error('保存模板失败:', err)
    }
  }

  const loadTemplate = (template: Template) => {
    onConfigChange(ensureConfig(template.config))
    onConfigNameChange(template.name)
    onAudit('加载模板', `模板: ${template.name}`)
  }

  const deleteTemplate = async (name: string) => {
    try {
      await App.DeleteScript(`${name}.fio`)
      await App.DeleteScriptConfig(`${name}.fio`)
      onAudit('删除模板', `模板: ${name}`)
      if (selectedTemplate?.name === name) setSelectedTemplate(null)
      loadTemplates()
    } catch (err) {
      console.error('删除模板失败:', err)
    }
  }

  return (
    <div>
      <div className="manager-header">
        <h2>模板管理</h2>
      </div>

      <div className="panel">
        <h3 className="section-title">从当前配置创建模板</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={newName} placeholder={`模板名称 (默认: ${configName})`}
            onChange={(e) => setNewName(e.target.value)} style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm" onClick={saveAsTemplate}>保存为模板</button>
        </div>
      </div>

      {templates.length > 0 && (
        <div className="panel">
          <h3 className="section-title">模板列表 ({templates.length})</h3>
          {templates.map((t) => (
            <div key={t.name} className="host-item" style={{ cursor: 'pointer' }}
              onClick={() => setSelectedTemplate(selectedTemplate?.name === t.name ? null : t)}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: selectedTemplate?.name === t.name ? 600 : 400 }}>
                {t.name}
              </span>
              <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); loadTemplate(t) }}>加载</button>
              <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); deleteTemplate(t.name) }}>删除</button>
            </div>
          ))}
        </div>
      )}

      {selectedTemplate && (
        <div className="panel">
          <h3 className="section-title">模板详情: {selectedTemplate.name}</h3>
          <pre className="code-preview">{generateFioText(selectedTemplate.config, false)}</pre>
          <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }}
            onClick={() => loadTemplate(selectedTemplate)}>
            应用到当前配置
          </button>
        </div>
      )}

      {templates.length === 0 && (
        <div className="panel">
          <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>
            暂无模板，从当前配置创建一个吧
          </p>
        </div>
      )}
    </div>
  )
}
