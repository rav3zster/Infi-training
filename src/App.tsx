import { useState, createContext, useContext } from 'react'
import { ThemeProvider } from './context/ThemeContext'
import { ConfirmProvider } from './context/ConfirmContext'
import { AuthProvider } from './context/AuthContext'
import { SyncProvider } from './context/SyncContext'
import { TrainingProvider } from './context/TrainingContext'
import { TimerProvider } from './context/TimerContext'
import AdaptiveNavigation from './components/AdaptiveNavigation'
import { useResponsive } from './hooks/useResponsive'
import type { LayoutInfo } from './engine/layoutEngine'
import DashboardScreen from './screens/DashboardScreen'
import SyllabusScreen from './screens/SyllabusScreen'
import CalendarPlannerScreen from './screens/CalendarPlannerScreen'
import LogWorkScreen from './screens/LogWorkScreen'
import AnalyticsScreen from './screens/AnalyticsScreen'
import PresetsScreen from './screens/PresetsScreen'
import DiagnosticsScreen from './screens/DiagnosticsScreen'
export type Screen = 'dashboard' | 'syllabus' | 'planner' | 'logwork' | 'analytics' | 'presets'

// Context to share layout state without prop drilling
interface LayoutCtx extends LayoutInfo {}
const LayoutCtx = createContext<LayoutCtx | null>(null)
export function useLayout() {
  const ctx = useContext(LayoutCtx)
  if (!ctx) throw new Error('useLayout outside AppRouter')
  return ctx
}

function AppRouter() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('dashboard')
  const { layout } = useResponsive()

  // Hidden developer diagnostics route: ?diag=1 (never in the nav)
  const [showDiagnostics, setShowDiagnostics] = useState(
    () => new URLSearchParams(window.location.search).has('diag'),
  )

  if (showDiagnostics) {
    return <DiagnosticsScreen onExit={() => setShowDiagnostics(false)} />
  }

  // Content padding adapts to nav mode
  const contentPaddingLeft = layout.navMode === 'sidebar'
    ? `max(env(safe-area-inset-left, 0px), 240px)`  // sidebar width
    : layout.navMode === 'rail'
      ? `max(env(safe-area-inset-left, 0px), 80px)`  // rail width
      : `max(env(safe-area-inset-left, 0px), ${layout.contentPaddingX}px)`

  const contentPaddingRight = `max(env(safe-area-inset-right, 0px), ${layout.contentPaddingX}px)`

  return (
    <LayoutCtx.Provider value={layout}>
      <div
        className="min-h-screen bg-bg-primary transition-all duration-300"
        style={{
          paddingLeft: contentPaddingLeft,
          paddingRight: contentPaddingRight,
          paddingTop: `max(env(safe-area-inset-top, 0px), ${layout.contentPaddingY}px)`,
          paddingBottom: layout.needsNavSafePadding
            ? `max(env(safe-area-inset-bottom, 0px), 5rem)`
            : `max(env(safe-area-inset-bottom, 0px), ${layout.contentPaddingY}px)`,
        }}
      >
        <AdaptiveNavigation
          currentScreen={currentScreen}
          onNavigate={setCurrentScreen}
          navMode={layout.navMode}
        />

        <main
          className="mx-auto"
          style={{
            maxWidth: layout.maxContentWidth > 0 ? `${layout.maxContentWidth}px` : '100%',
          }}
        >
          {currentScreen === 'dashboard' && <DashboardScreen />}
          {currentScreen === 'syllabus' && <SyllabusScreen />}
          {currentScreen === 'planner' && <CalendarPlannerScreen />}
          {currentScreen === 'logwork' && <LogWorkScreen />}
          {currentScreen === 'analytics' && <AnalyticsScreen />}
          {currentScreen === 'presets' && <PresetsScreen />}
        </main>
      </div>
    </LayoutCtx.Provider>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
      <SyncProvider>
        <ConfirmProvider>
          <TrainingProvider>
            <TimerProvider>
              <AppRouter />
            </TimerProvider>
          </TrainingProvider>
        </ConfirmProvider>
      </SyncProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
