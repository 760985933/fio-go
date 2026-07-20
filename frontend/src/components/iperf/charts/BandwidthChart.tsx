import { useMemo } from 'react'
import { IperfInterval } from '../../../types'

interface Props {
  intervals: IperfInterval[]
}

export function BandwidthChart({ intervals }: Props) {
  const canvasRef = useMemo(() => ({ current: null as HTMLCanvasElement | null }), [])

  const data = useMemo(() => {
    if (intervals.length === 0) return []
    return intervals.map(iv => ({
      x: iv.timestamp,
      y: iv.bitsPerSecond / 1e6,
    }))
  }, [intervals])

  const maxBW = useMemo(() => {
    if (data.length === 0) return 100
    return Math.max(...data.map(d => d.y)) * 1.2
  }, [data])

  if (intervals.length === 0) {
    return <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>等待数据...</div>
  }

  const width = 600
  const height = 200
  const padding = { top: 10, right: 20, bottom: 30, left: 60 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom

  const xMin = data[0].x
  const xMax = data[data.length - 1].x || xMin + 1
  const xScale = (v: number) => padding.left + ((v - xMin) / (xMax - xMin || 1)) * plotW
  const yScale = (v: number) => padding.top + plotH - (v / maxBW) * plotH

  const pathD = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(d.x)} ${yScale(d.y)}`).join(' ')

  const yTicks = 5
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => (maxBW / yTicks) * i)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 200 }}>
      {yTickValues.map((v, i) => (
        <g key={i}>
          <line x1={padding.left} y1={yScale(v)} x2={width - padding.right} y2={yScale(v)} stroke="#e5e7eb" strokeWidth={1} />
          <text x={padding.left - 8} y={yScale(v) + 4} textAnchor="end" fontSize={10} fill="#6b7280">
            {v.toFixed(0)}
          </text>
        </g>
      ))}
      <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth={2} />
      {data.length > 0 && (
        <circle cx={xScale(data[data.length - 1].x)} cy={yScale(data[data.length - 1].y)} r={4} fill="#3b82f6" />
      )}
      <text x={width / 2} y={height - 2} textAnchor="middle" fontSize={10} fill="#6b7280">时间 (s)</text>
      <text x={8} y={height / 2} textAnchor="middle" fontSize={10} fill="#6b7280" transform={`rotate(-90, 8, ${height / 2})`}>Mbps</text>
    </svg>
  )
}
