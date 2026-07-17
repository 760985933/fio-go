import { useState, useEffect } from 'react'
import * as App from '../wailsjs/go/app/App'

interface Props {
  onShowResults: (title: string, content: string) => Promise<void>
}

export function OrchestrationManager({ onShowResults }: Props) {
  const [taskIds, setTaskIds] = useState<string[]>([])
  const [interval, setInterval_] = useState(10)
  const [tasks, setTasks] = useState<{ id: string; name: string }[]>([])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      const [config, executionTasks] = await Promise.all([
        App.GetOrchestrationConfig(),
        App.GetExecutionTasks(),
      ])
      setTaskIds(config.sequence || [])
      setInterval_(config.interval || 10)
      setTasks(executionTasks.map((t: any) => ({ id: t.id, name: t.name })))
    } catch { /* ignore */ }
  }

  const saveConfig = async () => {
    setSaveStatus('saving')
    try {
      await App.SaveOrchestrationConfig({ sequence: taskIds, interval })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch {
      setSaveStatus('error')
    }
  }

  const addTask = (taskId: string) => {
    if (!taskIds.includes(taskId)) {
      setTaskIds([...taskIds, taskId])
    }
  }

  const removeTask = (taskId: string) => {
    setTaskIds(taskIds.filter(id => id !== taskId))
  }

  const moveTask = (fromIdx: number, toIdx: number) => {
    const newIds = [...taskIds]
    const [moved] = newIds.splice(fromIdx, 1)
    newIds.splice(toIdx, 0, moved)
    setTaskIds(newIds)
  }

  const handleDragStart = (idx: number) => { setDragIdx(idx) }
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    if (dragIdx !== null && dragIdx !== idx) {
      moveTask(dragIdx, idx)
      setDragIdx(idx)
    }
  }
  const handleDragEnd = () => { setDragIdx(null) }

  const getTaskName = (id: string) => tasks.find(t => t.id === id)?.name || id

  return (
    <div>
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, color: '#4f46e5' }}>执行顺序编排</h3>
          <button className="btn btn-primary btn-sm" onClick={saveConfig}>
            {saveStatus === 'saving' ? '保存中...' : saveStatus === 'saved' ? '已保存 ✓' : '保存配置'}
          </button>
        </div>

        <div className="form-row" style={{ marginBottom: 16 }}>
          <div className="form-group">
            <label>任务间间隔 (秒)</label>
            <input type="number" value={interval} onChange={(e) => setInterval_(parseInt(e.target.value) || 0)} />
          </div>
        </div>

        {/* 已选任务 (可拖拽排序) */}
        <h4 style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
          执行顺序 ({taskIds.length} 个任务)
        </h4>
        {taskIds.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: 12 }}>从下方添加任务到执行队列</p>
        ) : (
          taskIds.map((id, idx) => (
            <div
              key={id}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className="host-item"
              style={{
                cursor: 'grab',
                background: dragIdx === idx ? '#f0f0ff' : '#fff',
                border: dragIdx === idx ? '2px solid #4f46e5' : '1px solid #e5e7eb',
              }}
            >
              <span style={{ fontSize: 14, marginRight: 8, color: '#9ca3af' }}>⠿</span>
              <span style={{ fontSize: 14, marginRight: 8, color: '#4f46e5', fontWeight: 600 }}>{idx + 1}</span>
              <span style={{ flex: 1, fontSize: 13 }}>{getTaskName(id)}</span>
              <button className="btn btn-danger btn-sm" onClick={() => removeTask(id)}>移除</button>
            </div>
          ))
        )}
      </div>

      {/* 可添加的任务 */}
      {tasks.length > 0 && (
        <div className="panel" style={{ marginTop: 12 }}>
          <h4 style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>可添加的任务</h4>
          {tasks.map(t => (
            <div key={t.id} className="host-item">
              <span style={{ flex: 1, fontSize: 13 }}>{t.name}</span>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => addTask(t.id)}
                disabled={taskIds.includes(t.id)}
              >
                {taskIds.includes(t.id) ? '已添加' : '添加'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
