import type { ReactNode } from 'react'
import { Crosshair } from 'lucide-react'
import type { Player } from '../../shared/types'

export function Stat({
  label,
  value,
  detail,
  icon,
  accent = '',
}: {
  label: string
  value: string
  detail: string
  icon: ReactNode
  accent?: string
}) {
  return (
    <div className={`stat-card ${accent}`}>
      <div className="stat-label">
        {label}
        <span>{icon}</span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-detail">{detail}</div>
    </div>
  )
}
export function JobBadge({ player }: { player: Player }) {
  return <span className={`job-badge ${player.role}`}>{player.job}</span>
}
export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <Crosshair size={27} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  )
}
