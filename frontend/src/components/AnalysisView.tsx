import { useState, useEffect, useRef } from 'react'
import { AnalysisSummary } from '../types'
import { ConfirmDialog } from './ConfirmDialog'
import * as App from '../wailsjs/go/app/App'

interface Props {
  onAudit: (action: string, details: string) => void
  onShowResults: (title: string, content: string, wide?: boolean) => Promise<void>
}

export function AnalysisView({ onAudit, onShowResults }: Props) {
  const [tasks, setTasks] = useState<AnalysisSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedReport, setSelectedReport] = useState<string | null>(null)
  const [reportHtml, setReportHtml] = useState('')
  const [generating, setGenerating] = useState<string | null>(null)
  const [pulling, setPulling] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AnalysisSummary | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => { loadTasks() }, [])

  const loadTasks = async () => {
    setLoading(true)
    try { setTasks((await App.GetAnalysisTasks()) || []) } catch { /* ignore */ }
    setLoading(false)
  }

  const generateReport = async (taskId: string) => {
    setGenerating(taskId)
    try {
      await App.GenerateReport(taskId)
      onAudit('生成报告', `任务: ${taskId}`)
      await loadTasks()
    } catch (err) {
      await onShowResults('报告生成失败', `错误: ${err}`)
    }
    setGenerating(null)
  }

  const pullData = async (taskId: string) => {
    setPulling(taskId)
    try {
      const results = await App.PullTaskData(taskId)
      const errors = results.filter((r: any) => r.error)
      if (errors.length === results.length) {
        await onShowResults('数据拉取失败', results.map((r: any) => `${r.host}: ${r.error}`).join('\n'))
        setPulling(null)
        return
      }
      onAudit('拉取源端数据', `任务: ${taskId}`)
      await loadTasks()

      setPulling(null)
      setGenerating(taskId)
      try {
        await App.GenerateReport(taskId)
        onAudit('自动生成报告', `任务: ${taskId}`)
        await loadTasks()
      } catch (err) {
        await onShowResults('报告生成失败', `数据拉取成功，但报告生成失败: ${err}`)
      }
      setGenerating(null)
    } catch (err) {
      await onShowResults('数据拉取失败', `错误: ${err}`)
    }
    setPulling(null)
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
      await App.RevealFile(zipPath)
      onAudit('下载报告', `任务: ${taskId}`)
    } catch (err) {
      await onShowResults('下载失败', `错误: ${err}`)
    }
  }

  const viewLog = async (taskId: string) => {
    try {
      const log = await App.GetExecutionLog(taskId)
      await onShowResults(`执行日志 - ${taskId}`, log || '暂无日志', true)
    } catch (err) {
      await onShowResults('日志加载失败', `错误: ${err}`)
    }
  }

  const exportPdf = () => {
    try {
      const iframe = iframeRef.current
      if (!iframe || !iframe.contentWindow) return
      iframe.contentWindow.print()
    } catch (err) {
      onShowResults('导出失败', `无法触发打印: ${err}`)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const id = deleteTarget.id
    const name = deleteTarget.name
    try {
      await App.DeleteExecutionTask(id)
      onAudit('删除任务', `任务: ${name} (${id})`)
      await loadTasks()
    } catch (err) {
      await onShowResults('删除失败', `错误: ${err}`)
    }
    setDeleteTarget(null)
  }

  if (loading) {
    return <div className="loading-spinner"><div className="spinner"></div></div>
  }

  if (selectedReport && reportHtml) {
      return (
      <div>
        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button className="btn btn-outline" onClick={() => { setSelectedReport(null); setReportHtml('') }}>← 返回列表</button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>任务: {selectedReport}</span>
            <button className="btn btn-primary btn-sm" onClick={exportPdf}>导出 PDF</button>
          </div>
        </div>
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <iframe
            ref={iframeRef}
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
      <div className="manager-header">
        <h2>分析报告</h2>
        <button className="btn btn-outline btn-sm" onClick={loadTasks}>刷新</button>
      </div>

      {tasks.length === 0 ? (
        <div className="panel">
          <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 40 }}>
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
                {task.hasData ? (
                  <button className="btn btn-primary btn-sm" onClick={() => pullData(task.id)}
                    disabled={pulling === task.id || generating === task.id}>
                    {pulling === task.id ? '拉取中...' : generating === task.id ? '分析中...' : '重新拉取'}
                  </button>
                ) : (
                  <button className="btn btn-primary btn-sm" onClick={() => pullData(task.id)}
                    disabled={pulling === task.id || generating === task.id}>
                    {pulling === task.id ? '拉取中...' : generating === task.id ? '分析中...' : '拉取并分析'}
                  </button>
                )}
                {task.hasData && !task.hasReport && (
                  <button className="btn btn-primary btn-sm" onClick={() => generateReport(task.id)}
                    disabled={generating === task.id}>
                    {generating === task.id ? '生成中...' : '生成报告'}
                  </button>
                )}
                {task.hasReport && (
                  <button className="btn btn-outline btn-sm" onClick={() => previewReport(task.id)}>预览报告</button>
                )}
                {task.hasData && task.hasReport && (
                  <button className="btn btn-primary btn-sm" onClick={() => generateReport(task.id)}
                    disabled={generating === task.id}>
                    {generating === task.id ? '分析中...' : '重新分析'}
                  </button>
                )}
                {task.hasReport && (
                  <button className="btn btn-primary btn-sm" onClick={() => downloadReport(task.id)}>下载报告</button>
                )}
                {task.logAvailable && (
                  <button className="btn btn-outline btn-sm" onClick={() => viewLog(task.id)}>查看日志</button>
                )}
                <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(task)}>删除</button>
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <span>脚本: {(task.scripts || []).join(', ')}</span>
              <span>数据: {task.hasData ? '✓' : '✗'}</span>
              <span>报告: {task.hasReport ? '✓' : '未生成'}</span>
              <span>日志: {task.logAvailable ? '✓' : '✗'}</span>
            </div>
            {(task.startedAt || task.finishedAt) && (
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {task.startedAt && <span>开始: {new Date(task.startedAt).toLocaleString('sv-SE', { hour12: false })}</span>}
                {task.finishedAt && <span>完成: {new Date(task.finishedAt).toLocaleString('sv-SE', { hour12: false })}</span>}
                {task.startedAt && task.finishedAt && (
                  <span>耗时: {Math.round((new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime()) / 1000)}s</span>
                )}
              </div>
            )}
          </div>
        ))
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除任务"
        message={deleteTarget ? `确认删除任务「${deleteTarget.name}」？此操作将清除任务配置、本地数据和时间戳，不可恢复。` : ''}
        confirmText="删除"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
