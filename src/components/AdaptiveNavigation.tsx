/**
 * AdaptiveNavigation — Responsive navigation component.
 * Consumes nav mode from the Layout Engine context.
 *   compact/comfortable(<768) → bottom nav pill
 *   comfortable(≥768)         → vertical rail
 *   expanded/ultra            → persistent sidebar with full labels
 */

import { useState } from 'react'
import { LayoutDashboard, BookOpen, Clock, Settings, BarChart3, ChevronLeft, Menu } from 'lucide-react'

import type { NavMode } from '../engine/layoutEngine'
import type { Screen } from '../App'

interface NavItem {
  id: Screen
  label: string
  icon: typeof LayoutDashboard
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'syllabus', label: 'Syllabus', icon: BookOpen },
  { id: 'logwork', label: 'Log Work', icon: Clock },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'presets', label: 'Presets', icon: Settings },
]

interface AdaptiveNavigationProps {
  currentScreen: Screen
  onNavigate: (screen: Screen) => void
  navMode: NavMode
}

export default function AdaptiveNavigation({ currentScreen, onNavigate, navMode }: AdaptiveNavigationProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // ── Bottom Nav (compact, comfortable-landscape) ──
  if (navMode === 'bottom') {
    return (
      <nav
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50
          flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-1.5
          rounded-2xl border border-border-color 
          bg-bg-card/85 backdrop-blur-xl 
          shadow-[0_4px_24px_rgba(0,0,0,0.10)] 
          dark:shadow-[0_4px_32px_rgba(0,0,0,0.5)]
          select-none max-w-[95vw] sm:max-w-lg
          transition-all duration-200"
      >
        {navItems.map(item => {
          const Icon = item.icon
          const isActive = currentScreen === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`
                relative flex items-center justify-center sm:gap-1.5 px-2 sm:px-3 py-2 rounded-xl
                text-[10px] sm:text-xs font-medium
                transition-all duration-200 ease-out
                cursor-pointer min-w-[44px] sm:min-w-0
                ${isActive
                  ? 'bg-text-primary text-bg-primary shadow-sm scale-105'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-primary/50'
                }
              `}
              aria-label={item.label}
            >
              <Icon size={16} strokeWidth={isActive ? 2.5 : 1.5} />
              <span className="hidden sm:inline">{item.label}</span>
            </button>
          )
        })}
      </nav>
    )
  }

  // ── Rail (comfortable ≥768) ──
  if (navMode === 'rail') {
    return (
      <nav
        className="fixed left-4 top-1/2 -translate-y-1/2 z-50
          flex flex-col items-center gap-2 py-4 px-2
          rounded-2xl border border-border-color
          bg-bg-card/85 backdrop-blur-xl
          shadow-[0_4px_24px_rgba(0,0,0,0.10)]
          dark:shadow-[0_4px_32px_rgba(0,0,0,0.5)]
          select-none transition-all duration-200"
      >
        {navItems.map(item => {
          const Icon = item.icon
          const isActive = currentScreen === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`
                flex flex-col items-center gap-0.5 px-2 py-2 rounded-xl
                text-[9px] font-medium leading-tight
                transition-all duration-200 ease-out
                cursor-pointer w-14
                ${isActive
                  ? 'bg-text-primary text-bg-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-primary/50'
                }
              `}
              aria-label={item.label}
            >
              <Icon size={18} strokeWidth={isActive ? 2.5 : 1.5} />
              <span className="truncate w-full text-center">{item.label}</span>
            </button>
          )
        })}
      </nav>
    )
  }

  // ── Sidebar (expanded/ultra) ──
  return (
    <>
      {sidebarCollapsed && (
        <button
          type="button"
          onClick={() => setSidebarCollapsed(false)}
          className="fixed left-3 top-4 z-50 w-10 h-10 rounded-xl
            border border-border-color bg-bg-card/85 backdrop-blur-xl
            flex items-center justify-center
            text-text-secondary hover:text-text-primary
            transition-all duration-200 cursor-pointer"
          aria-label="Expand sidebar"
        >
          <Menu size={18} />
        </button>
      )}

      <aside
        className={`
          fixed left-0 top-0 bottom-0 z-40
          border-r border-border-color
          bg-bg-card/90 backdrop-blur-xl
          flex flex-col
          transition-all duration-300 ease-out
          ${sidebarCollapsed ? 'w-0 -translate-x-full overflow-hidden' : 'w-[220px] lg:w-[260px]'}
        `}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-5 h-16 border-b border-border-color" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
          <span className="text-sm font-semibold text-text-primary">Training Engine</span>
          <button
            type="button"
            onClick={() => setSidebarCollapsed(true)}
            className="w-7 h-7 rounded-lg flex items-center justify-center
              text-text-secondary hover:text-text-primary hover:bg-bg-primary/50
              transition-all duration-150 cursor-pointer"
            aria-label="Collapse sidebar"
          >
            <ChevronLeft size={14} />
          </button>
        </div>

        {/* Nav items */}
        <div className="flex-1 flex flex-col gap-1 px-3 py-4 overflow-y-auto">
          {navItems.map(item => {
            const Icon = item.icon
            const isActive = currentScreen === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-xl
                  text-sm font-medium
                  transition-all duration-200 ease-out
                  cursor-pointer text-left
                  ${isActive
                    ? 'bg-text-primary text-bg-primary shadow-sm'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-primary/50'
                  }
                `}
                aria-label={item.label}
              >
                <Icon size={18} strokeWidth={isActive ? 2.5 : 1.5} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>

        {/* Sidebar footer */}
        <div className="px-5 py-3 border-t border-border-color">
          <p className="text-[10px] text-text-secondary">Adaptive Study Load Engine</p>
          <p className="text-[9px] text-text-secondary">v3.0 · Infosys Prep</p>
        </div>
      </aside>
    </>
  )
}
