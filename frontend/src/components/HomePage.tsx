import { useState, useEffect } from 'react'
import * as App from '../wailsjs/go/app/App'

interface Props {
  onNavigateTo: (section: string) => void
}

interface StepDef {
  num: number
  title: string
  desc: string
  section: string
}

const STEPS: StepDef[] = [
  { num: 1, title: '配置参数', desc: '设置 FIO 测试的全局参数和测试任务，选择场景预设快速开始', section: 'script' },
  { num: 2, title: '添加主机', desc: '添加要测试的目标服务器，配置 SSH 连接信息', section: 'host' },
  { num: 3, title: '部署执行', desc: '将测试脚本部署到目标主机并执行性能测试', section: 'task' },
  { num: 4, title: '查看报告', desc: '分析测试结果，生成可视化报告并导出', section: 'analysis' },
]

export function HomePage({ onNavigateTo }: Props) {
  const [stats, setStats] = useState({ hosts: 0, scripts: 0, tasks: 0 })

  useEffect(() => {
    const load = async () => {
      try {
        const [hosts, scripts, tasks] = await Promise.all([
          App.GetHosts(),
          App.GetScripts(),
          App.GetExecutionTasks(),
        ])
        setStats({
          hosts: (hosts || []).length,
          scripts: (scripts || []).length,
          tasks: (tasks || []).length,
        })
      } catch { /* ignore */ }
    }
    load()
  }, [])

  const getStepStatus = (section: string): boolean => {
    if (section === 'script') return stats.scripts > 0
    if (section === 'host') return stats.hosts > 0
    if (section === 'task') return stats.tasks > 0
    return false
  }

  return (
    <div>
      <div className="welcome-card">
        <h2>FIO 性能测试工具</h2>
        <p>快速完成存储性能测试，支持分布式多节点并行测试</p>
      </div>

      <div className="step-grid">
        {STEPS.map(step => (
          <div key={step.num} className="step-card" onClick={() => onNavigateTo(step.section)}>
            <div className="step-card-top">
              <div className={`step-number ${getStepStatus(step.section) ? 'done' : ''}`}>
                {getStepStatus(step.section) ? '✓' : step.num}
              </div>
              <h3>{step.title}</h3>
            </div>
            <p>{step.desc}</p>
          </div>
        ))}
      </div>

      <div className="quick-stats">
        <div className="quick-stat-card">
          <div className="quick-stat-value">{stats.hosts}</div>
          <div className="quick-stat-label">已添加主机</div>
        </div>
        <div className="quick-stat-card">
          <div className="quick-stat-value">{stats.scripts}</div>
          <div className="quick-stat-label">保存的脚本</div>
        </div>
        <div className="quick-stat-card">
          <div className="quick-stat-value">{stats.tasks}</div>
          <div className="quick-stat-label">执行任务</div>
        </div>
      </div>
    </div>
  )
}
