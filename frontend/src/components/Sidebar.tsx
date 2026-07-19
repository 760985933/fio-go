import { ReactNode } from 'react'

export interface SidebarItem {
  id: string
  icon: ReactNode
  label: string
}

interface Props {
  items: SidebarItem[]
  dividerAfter?: string
  activeItem: string
  onSelect: (id: string) => void
  children: ReactNode
}

export function Sidebar({ items, dividerAfter, activeItem, onSelect, children }: Props) {
  return (
    <>
      <nav className="sidebar">
        <div className="sidebar-label">管理</div>
        {items.map(item => (
          <div key={item.id}>
            <button
              className={`sidebar-item ${activeItem === item.id ? 'active' : ''}`}
              onClick={() => onSelect(item.id)}
            >
              <span className="sidebar-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
            {dividerAfter === item.id && (
              <>
                <div className="sidebar-divider" />
                <div className="sidebar-label">工具</div>
              </>
            )}
          </div>
        ))}
      </nav>
      <div className="content-area">
        {children}
      </div>
    </>
  )
}
