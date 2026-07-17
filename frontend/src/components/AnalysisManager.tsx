import { AnalysisSummary } from '../types'

interface Props {
  tasks: AnalysisSummary[]
  onRefresh: () => void
}

export function AnalysisManager({ tasks, onRefresh }: Props) {
  const handleGenerate = async (taskId: string) => {
    // TODO: 调用 Wails 绑定
    // await goBindings.GenerateReport(taskId)
    onRefresh()
  }

  const handleViewReport = (task: AnalysisSummary) => {
    if (task.reportHtmlUrl) {
      // TODO: 在 Wails 中打开报告
      window.open(task.reportHtmlUrl, '_blank')
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, color: '#4f46e5' }}>分析任务 ({tasks.length})</h3>
        <button className="btn btn-outline btn-sm" onClick={onRefresh}>刷新</button>
      </div>

      {tasks.length === 0 && (
        <div className="empty-state">
          <p>暂无分析任务</p>
          <p style={{ fontSize: 12, marginTop: 8 }}>请先在"任务执行"中拉取数据</p>
        </div>
      )}

      {tasks.map((task) => (
        <div key={task.id} className="card">
          <div className="card-header">
            <div>
              <span className="card-title">{task.name}</span>
              <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 8 }}>{task.script}</span>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {task.hasData && !task.hasReport && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => handleGenerate(task.id)}
                >
                  生成报告
                </button>
              )}
              {task.hasReport && (
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => handleViewReport(task)}
                >
                  查看报告
                </button>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#6b7280' }}>
            <span>数据: <span className={`status-badge ${task.hasData ? 'success' : 'warning'}`}>{task.hasData ? '已拉取' : '未拉取'}</span></span>
            <span>报告: <span className={`status-badge ${task.hasReport ? 'success' : 'warning'}`}>{task.hasReport ? '已生成' : '未生成'}</span></span>
            <span>日志: <span className={`status-badge ${task.logAvailable ? 'success' : 'warning'}`}>{task.logAvailable ? '可用' : '不可用'}</span></span>
          </div>
        </div>
      ))}
    </div>
  )
}
