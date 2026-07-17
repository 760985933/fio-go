import { useState, useEffect } from 'react'
import { AnalysisSummary } from '../types'
import * as App from '../wailsjs/go/app/App'

interface Props {
  onAudit: (action: string, details: string) => void
  onShowResults: (title: string, content: string) => Promise<void>
}

export function AnalysisManager({ onAudit, onShowResults }: Props) {
  const [tasks, setTasks] = useState<AnalysisSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedReport, setSelectedReport] = useState<string | null>(null)
  const [reportHtml, setReportHtml] = useState<string>('')
  const [generating, setGenerating] = useState<string | null>(null)

  useEffect(() => { loadTasks() }, [])

  const loadTasks = async () => {
    setLoading(true)
    try {
      const result = await App.GetAnalysisTasks()
      setTasks(result || [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  const generateReport = async (taskId: string) => {
    setGenerating(taskId)
    try {
      const reportPath = await App.GenerateReport(taskId)
      onAudit('生成报告', `任务: ${taskId}, 路径: ${reportPath}`)
      await loadTasks()
    } catch (err) {
      await onShowResults('报告生成失败', `错误: ${err}`)
    }
    setGenerating(null)
  }

  const previewReport = async (taskId: string) => {
    try {
      const html = await App.GetReportHTMLWithEcharts(taskId)
      setReportHtml(html)
      setSelectedReport(taskId)
    } catch (err) {
      await onShowResults('报告预览失败', `错误: ${err}`)
    }
  }

  const downloadReport = async (taskId: string) => {
    try {
      const zipPath = await App.CreateReportZIP(taskId)
      onAudit('下载报告', `任务: ${taskId}, 路径: ${zipPath}`)
      await onShowResults('下载完成', `报告已打包到:\n${zipPath}`)
    } catch (err) {
      await onShowResults('下载失败', `错误: ${err}`)
    }
  }

  const viewLog = async (taskId: string) => {
    try {
      const log = await App.GetExecutionLog(taskId)
      await onShowResults(`执行日志 - ${taskId}`, log || '暂无日志')
    } catch (err) {
      await onShowResults('日志加载失败', `错误: ${err}`)
    }
  }

  const closePreview = () => {
    setSelectedReport(null)
    setReportHtml('')
  }

  if (loading) {
    return <div className="loading-spinner"><div className="spinner"></div></div>
  }

  if (selectedReport && reportHtml) {
    return (
      <div>
        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button className="btn btn-outline" onClick={closePreview}>← 返回列表</button>
          <span style={{ fontSize: 13, color: '#6b7280' }}>任务: {selectedReport}</span>
        </div>
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <iframe
            srcDoc={reportHtml}
            style={{ width: '100%', height: 'calc(100vh - 200px)', border: 'none' }}
            title="报告预览"
          />
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, color: '#4f46e5' }}>分析任务 ({tasks.length})</h3>
        <button className="btn btn-outline btn-sm" onClick={loadTasks}>刷新</button>
      </div>

      {tasks.length === 0 ? (
        <div className="panel">
          <p style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', padding: 20 }}>
            暂无分析任务，请先执行测试
          </p>
        </div>
      ) : (
        tasks.map(task => (
          <div key={task.id} className="card">
            <div className="card-header">
              <span className="card-title">
                {task.name}
                {task.hasData && <span className="status-dot status-ok" style={{ marginLeft: 8 }}></span>}
                {!task.hasData && <span className="status-dot status-error" style={{ marginLeft: 8 }}></span>}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {!task.hasReport && task.hasData && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => generateReport(task.id)}
                    disabled={generating === task.id}
                  >
                    {generating === task.id ? '生成中...' : '生成报告'}
                  </button>
                )}
                {task.hasReport && (
                  <button className="btn btn-outline btn-sm" onClick={() => previewReport(task.id)}>
                    预览报告
                  </button>
                )}
                {task.hasReport && (
                  <button className="btn btn-primary btn-sm" onClick={() => downloadReport(task.id)}>
                    下载报告
                  </button>
                )}
                {task.logAvailable && (
                  <button className="btn btn-outline btn-sm" onClick={() => viewLog(task.id)}>
                    查看日志
                  </button>
                )}
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280', display: 'flex', gap: 16 }}>
              <span>脚本: {task.script}</span>
              <span>数据: {task.hasData ? '✓' : '✗'}</span>
              <span>报告: {task.hasReport ? '✓' : '未生成'}</span>
              <span>日志: {task.logAvailable ? '✓' : '✗'}</span>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
