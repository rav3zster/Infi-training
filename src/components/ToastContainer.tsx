/**
 * ToastContainer — Premium toast notification overlay.
 * Slides in from the top, auto-dismisses after 3 seconds.
 * Success = green, Info = dark, Warning = orange.
 */

import { useTraining } from '../context/TrainingContext'
import { CheckCircle2, Info, AlertTriangle, X } from 'lucide-react'

export default function ToastContainer() {
  const { toasts, dismissToast } = useTraining()

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((toast, i) => {
        const isSuccess = toast.type === 'success'
        const isWarning = toast.type === 'warning'
        const isInfo = toast.type === 'info'

        return (
          <div
            key={toast.id}
            className={`
              pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl
              shadow-[0_4px_20px_rgba(0,0,0,0.10)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.4)]
              backdrop-blur-xl border
              animate-slide-in-right
              ${isSuccess
                ? 'bg-white dark:bg-gray-900 border-green-200 dark:border-green-800'
                : isWarning
                  ? 'bg-white dark:bg-gray-900 border-orange-200 dark:border-orange-800'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800'
              }
            `}
            style={{ animationDelay: `${i * 80}ms` }}
          >
            {/* Icon */}
            <div className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center
              ${isSuccess ? 'bg-green-500/10 text-green-600 dark:text-green-400' : ''}
              ${isWarning ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400' : ''}
              ${isInfo ? 'bg-gray-500/10 text-gray-600 dark:text-gray-400' : ''}
            `}>
              {isSuccess && <CheckCircle2 size={14} />}
              {isWarning && <AlertTriangle size={14} />}
              {isInfo && <Info size={14} />}
            </div>

            {/* Message */}
            <p className="text-xs font-medium text-gray-900 dark:text-gray-100 flex-1">
              {toast.message}
            </p>

            {/* Dismiss */}
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center
                text-gray-400 hover:text-gray-600 dark:hover:text-gray-300
                hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
