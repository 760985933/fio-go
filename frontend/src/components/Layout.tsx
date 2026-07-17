import { ReactNode } from 'react'

interface Tab {
  id: string
  label: string
  icon: string
}

interface Props {
  tabs: Tab[]
  activeTab: string
  onTabChange: (id: string) => void
  headerActions?: ReactNode
  children: ReactNode
}

export function Layout({ tabs, activeTab, onTabChange, headerActions, children }: Props) {
  return (
    <div className="layout">
      <header className="header">
        <div className="header-left">
          <svg className="header-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="appGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: '#667eea' }} />
                <stop offset="100%" style={{ stopColor: '#764ba2' }} />
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="6" fill="url(#appGrad)" />
            <g fill="white">
              <circle cx="8" cy="8" r="2" />
              <circle cx="24" cy="8" r="2" />
              <circle cx="8" cy="24" r="2" />
              <circle cx="24" cy="24" r="2" />
              <circle cx="16" cy="16" r="2.5" />
              <line x1="8" y1="8" x2="16" y2="16" stroke="white" strokeWidth="1.5" />
              <line x1="24" y1="8" x2="16" y2="16" stroke="white" strokeWidth="1.5" />
              <line x1="8" y1="24" x2="16" y2="16" stroke="white" strokeWidth="1.5" />
              <line x1="24" y1="24" x2="16" y2="16" stroke="white" strokeWidth="1.5" />
            </g>
          </svg>
          <h1>FIO 测试工具 <span className="app-version">v1.0.3</span></h1>
        </div>
        {headerActions && <div className="header-actions">{headerActions}</div>}
      </header>

      <div className="tab-bar">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      <main className="content-area">
        {children}
      </main>
    </div>
  )
}
