import { useState, useEffect } from 'react'
import { FioConfig } from '../types'
import { generateFioText } from '../utils/fioGenerator'
import { ensureConfig } from '../utils/config'
import * as App from '../wailsjs/go/app/App'

interface Props {
  name: string
  onClose: () => void
}

export function PreviewModal({ name, onClose }: Props) {
  const [config, setConfig] = useState<FioConfig | null>(null)

  useEffect(() => {
    App.GetScriptConfig(name).then(json => {
      if (json) {
        try { setConfig(ensureConfig(JSON.parse(json))) } catch { /* ignore */ }
      }
    })
  }, [name])

  if (!config) return null

  const taskKey = `task_${Date.now()}`
  const scriptName = `${name}.fio`
  const taskDir = `/tmp/fio/tasks/${taskKey}`
  const remoteScriptPath = `${taskDir}/${scriptName}`
  const jsonOut = `${taskDir}/data/${scriptName}.json`
  const logsDir = `${taskDir}/data/logs`
  const pidFile = `${taskDir}/fio.pid`

  const fioText = generateFioText(config, true)

  const fioCmd = [
    `cd ${taskDir} && nohup fio ${remoteScriptPath} \\`,
    `  --output-format=json+ \\`,
    `  --output=${jsonOut} \\`,
    `  > ${logsDir}/fio_stdout.log 2>&1 \\`,
    `  & echo $! > ${pidFile}`,
  ].join('\n')

  const fullPreview = [
    `# 1. 创建远程目录`,
    `mkdir -p ${taskDir} ${taskDir}/data ${logsDir}`,
    ``,
    `# 2. 上传 .fio 脚本到 ${remoteScriptPath}`,
    `# (SFTP upload: ${scriptName})`,
    ``,
    `# 3. 执行 FIO 测试`,
    fioCmd,
    ``,
    `# --- .fio 脚本内容 ---`,
    fioText,
  ].join('\n')

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e => e.stopPropagation())} style={{ maxWidth: 640, width: '90vw' }}>
        <div className="modal-header">
          <h3>预览 - {name}</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <pre style={{ fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: 'var(--bg-secondary)', padding: 12, borderRadius: 6, margin: 0, maxHeight: 400, overflow: 'auto' }}>{fullPreview}</pre>
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={() => { navigator.clipboard.writeText(fullPreview).catch(() => alert('复制失败')); onClose() }}>复制并关闭</button>
        </div>
      </div>
    </div>
  )
}
