import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, X } from 'lucide-react'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** Render the confirm button with destructive styling */
  danger?: boolean
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

const ConfirmContext = createContext<ConfirmContextType | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolverRef = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>(resolve => {
      resolverRef.current = resolve
      setOptions(opts)
    })
  }, [])

  const close = useCallback((value: boolean) => {
    resolverRef.current?.(value)
    resolverRef.current = null
    setOptions(null)
  }, [])

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}

      {options && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-label={options.title}
          onClick={() => close(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border-color bg-bg-card shadow-2xl animate-scale-in"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 p-4 sm:p-5">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0
                ${options.danger ? 'bg-red-500/10' : 'bg-text-primary/10'}`}>
                <AlertTriangle size={16} className={options.danger ? 'text-red-500' : 'text-text-primary'} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="r-text-small font-semibold text-text-primary">{options.title}</h3>
                  <button
                    type="button"
                    onClick={() => close(false)}
                    className="w-6 h-6 rounded flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-primary transition-colors cursor-pointer flex-shrink-0"
                    aria-label="Close"
                  >
                    <X size={14} />
                  </button>
                </div>
                <p className="r-text-small text-text-secondary mt-1.5 leading-relaxed">{options.message}</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 pb-4 sm:px-5 sm:pb-5">
              <button
                type="button"
                onClick={() => close(false)}
                className="px-3.5 py-2 r-text-small font-medium rounded-lg border border-border-color text-text-secondary hover:text-text-primary hover:border-text-secondary transition-all duration-150 cursor-pointer"
              >
                {options.cancelLabel ?? 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => close(true)}
                className={`px-3.5 py-2 r-text-small font-medium rounded-lg transition-all duration-150 cursor-pointer
                  ${options.danger
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-text-primary text-bg-primary hover:opacity-80'}`}
              >
                {options.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmContextType['confirm'] {
  const context = useContext(ConfirmContext)
  if (!context) throw new Error('useConfirm must be used within a ConfirmProvider')
  return context.confirm
}
