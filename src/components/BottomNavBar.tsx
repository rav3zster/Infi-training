import { LayoutDashboard, BookOpen, Clock, Settings, BarChart3 } from 'lucide-react'

export type Screen = 'dashboard' | 'syllabus' | 'logwork' | 'analytics' | 'presets'

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

interface BottomNavBarProps {
  currentScreen: Screen
  onNavigate: (screen: Screen) => void
}

export default function BottomNavBar({ currentScreen, onNavigate }: BottomNavBarProps) {
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
              ${
                isActive
                  ? 'bg-text-primary text-bg-primary shadow-sm scale-105'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-primary/50'
              }
            `}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon size={16} strokeWidth={isActive ? 2.5 : 1.5} />
            <span className="hidden sm:inline">{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
