import { useMemo } from 'react'
import { IperfInterval } from '../../../types'
import { formatBandwidth } from '../../../utils/iperfGenerator'

interface Props {
  intervals: IperfInterval[]
}

export function DashboardPanel({ intervals }: Props) {
  const stats = useMemo(() => {
    if (intervals.length === 0) {
      return {
        currentBW: 0,
        avgBW: 0,
        maxBW: 0,
        totalRetransmits: 0,
        totalBytes: 0,
        avgJitter: 0,
        duration: 0,
      }
    }

    const bws = intervals.map(iv => iv.bitsPerSecond)
    const jitters = intervals.filter(iv => iv.jitterMs > 0).map(iv => iv.jitterMs)
    const totalRetransmits = intervals.reduce((sum, iv) => sum + iv.retransmits, 0)
    const totalBytes = intervals.reduce((sum, iv) => sum + iv.bytes, 0)

    return {
      currentBW: bws[bws.length - 1] || 0,
      avgBW: bws.reduce((a, b) => a + b, 0) / bws.length,
      maxBW: Math.max(...bws),
      totalRetransmits,
      totalBytes,
      avgJitter: jitters.length > 0 ? jitters.reduce((a, b) => a + b, 0) / jitters.length : 0,
      duration: intervals[intervals.length - 1]?.timestamp || 0,
    }
  }, [intervals])

  const cards = [
    { label: '当前带宽', value: formatBandwidth(stats.currentBW), color: '#3b82f6' },
    { label: '平均带宽', value: formatBandwidth(stats.avgBW), color: '#22c55e' },
    { label: '峰值带宽', value: formatBandwidth(stats.maxBW), color: '#8b5cf6' },
    { label: '总重传数', value: String(stats.totalRetransmits), color: stats.totalRetransmits > 0 ? '#ef4444' : '#22c55e' },
    { label: '平均抖动', value: `${stats.avgJitter.toFixed(3)} ms`, color: '#f59e0b' },
    { label: '传输总量', value: `${(stats.totalBytes / 1e9).toFixed(2)} GB`, color: '#6366f1' },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 16 }}>
      {cards.map(card => (
        <div key={card.label} className="panel" style={{ padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{card.label}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: card.color }}>{card.value}</div>
        </div>
      ))}
    </div>
  )
}
