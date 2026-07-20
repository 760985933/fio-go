import { useState, useEffect } from 'react'
import { IperfAnalysisSummary } from '../../types'
import * as App from '../../wailsjs/go/app/App'

interface Props {
  onAudit: (action: string, details: string) => void
  onShowResults: (title: string, content: string, wide?: boolean) => Promise<void>
}

export function IperfAnalysisView({ onAudit, onShowResults }: Props) {
  const [tasks, setTasks] = useState<IperfAnalysisSummary[]>([])
  const [previewHTML, setPreviewHTML] = useState<string>('')
  const [selectedTaskId, setSelectedTaskId] = useState<string>('')

  useEffect(() => { loadTasks() }, [])

  const loadTasks = async () => {
    try {
      const list = await App.GetIperfAnalysisTasks()
      setTasks(list || [])
    } catch { /* ignore */ }
  }

  const pullAndAnalyze = async (task: IperfAnalysisSummary) => {
    try {
      await App.PullIperfData(task.taskId)
      await App.GenerateIperfReport(task.taskId)
      loadTasks()
      onAudit('拉取并分析iperf3数据', task.taskName)
    } catch (err) {
      await onShowResults('分析失败', String(err))
    }
  }

  const generateReport = async (task: IperfAnalysisSummary) => {
    try {
      await App.GenerateIperfReport(task.taskId)
      loadTasks()
      onAudit('生成iperf3报告', task.taskName)
    } catch (err) {
      await onShowResults('生成失败', String(err))
    }
  }

  const previewReport = async (taskId: string) => {
    try {
      const html = await App.GetIperfReportHTML(taskId)
      setPreviewHTML(html)
      setSelectedTaskId(taskId)
    } catch (err) {
      await onShowResults('预览失败', String(err))
    }
  }

  const closePreview = () => {
    setPreviewHTML('')
    setSelectedTaskId('')
  }

  if (previewHTML) {
    return (
      <div>
        <div className="manager-header">
          <h2>报告预览</h2>
          <button className="btn btn-outline btn-sm" onClick={closePreview}>关闭预览</button>
        </div>
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <iframe
            srcDoc={previewHTML}
            style={{ width: '100%', height: 'calc(100vh - 180px)', border: 'none' }}
            title="iperf3 report"
          />
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="manager-header">
        <h2>结果分析</h2>
        <button className="btn btn-outline btn-sm" onClick={loadTasks}>刷新</button>
      </div>

      <div className="panel">
        {tasks.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>暂无测试任务</p>
        ) : tasks.map(task => (
          <div key={task.taskId} className="host-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: task.hasReport ? '#22c55e' : task.hasData ? '#3b82f6' : '#9ca3af',
              }} />
              <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{task.taskName}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {!task.hasData && (
                  <button className="btn btn-primary btn-sm" onClick={() => pullAndAnalyze(task)}>拉取并分析</button>
                )}
                {task.hasData && !task.hasReport && (
                  <button className="btn btn-primary btn-sm" onClick={() => generateReport(task)}>生成报告</button>
                )}
                {task.hasReport && (
                  <button className="btn btn-outline btn-sm" onClick={() => previewReport(task.taskId)}>预览报告</button>
                )}
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 16 }}>
              <span>Server: {task.serverHost}</span>
              <span>Clients: {task.clientCount}</span>
              <span>状态: {task.status}</span>
              {task.hasData && <span style={{ color: '#22c55e' }}>✓ 有数据</span>}
              {task.hasReport && <span style={{ color: '#22c55e' }}>✓ 有报告</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
