import { Gauge } from 'lucide-react'

/**
 * SplashScreen — shown while TrainingProvider boots the local database and
 * hydrates the session (open → migrate → hydrate → first render). Hard-capped
 * by the boot path's fallbacks, so it can never hang the app.
 */
export default function SplashScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-bg-primary">
      <div className="relative">
        <div className="absolute -inset-3 rounded-2xl border border-border-color animate-pulse" />
        <div className="w-16 h-16 rounded-2xl bg-text-primary flex items-center justify-center">
          <Gauge size={32} className="text-bg-primary" />
        </div>
      </div>
      <div className="text-center space-y-1">
        <p className="r-text-h1 font-semibold text-text-primary">Training Engine</p>
        <p className="r-text-tiny text-text-secondary animate-pulse">Restoring your session…</p>
      </div>
    </div>
  )
}
