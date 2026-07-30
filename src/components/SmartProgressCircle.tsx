/**
 * SmartProgressCircle — Premium animated circular progress indicator.
 * Colors transition smoothly: red → orange → green based on completion.
 * Displays centered time and animates live when value changes.
 */

import { useEffect, useRef, useState } from 'react'

interface SmartProgressCircleProps {
  /** Percentage 0-100 */
  value: number
  /** Today's logged hours to show in center */
  todayHours: number
  /** Size in pixels */
  size?: number
  /** Stroke width */
  strokeWidth?: number
  /** Whether to animate */
  animate?: boolean
  /** Label below the center value */
  label?: string
}

function getColor(value: number): string {
  if (value < 33) return '#dc2626' // red-600
  if (value < 66) return '#ea580c' // orange-600
  return '#16a34a' // green-600
}

export default function SmartProgressCircle({
  value,
  todayHours,
  size = 160,
  strokeWidth = 8,
  animate = true,
  label,
}: SmartProgressCircleProps) {
  const [animatedValue, setAnimatedValue] = useState(0)
  const [displayedHours, setDisplayedHours] = useState(0)
  const animationRef = useRef<number | null>(null)
  const startTimeRef = useRef<number | null>(null)

  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const clampedValue = Math.min(Math.max(value, 0), 100)

  // Animate the circle on mount and on value change
  useEffect(() => {
    if (!animate) {
      setAnimatedValue(clampedValue)
      setDisplayedHours(todayHours)
      return
    }

    const duration = 800
    const startValue = animatedValue
    const endValue = clampedValue
    const startHours = displayedHours
    const endHours = todayHours
    startTimeRef.current = null

    const step = (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp
      const elapsed = timestamp - startTimeRef.current
      const progress = Math.min(elapsed / duration, 1)
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)

      setAnimatedValue(startValue + (endValue - startValue) * eased)
      setDisplayedHours(startHours + (endHours - startHours) * eased)

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(step)
      }
    }

    if (animationRef.current) cancelAnimationFrame(animationRef.current)
    animationRef.current = requestAnimationFrame(step)

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedValue, todayHours, animate])

  const offset = circumference - (animatedValue / 100) * circumference
  const color = getColor(clampedValue)

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-border-color/60"
        />
        {/* Progress ring — with gradient glow */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="progress-glow"
          style={{
            transition: animate ? 'stroke-dashoffset 50ms linear, stroke 300ms ease' : undefined,
          }}
        />
      </svg>

      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-bold tabular-nums leading-none tracking-tight"
          style={{
            fontSize: size * 0.2,
            color: clampedValue < 33 ? '#dc2626' : clampedValue < 66 ? '#ea580c' : '#16a34a',
            transition: 'color 300ms ease',
          }}
        >
          {displayedHours.toFixed(1)}<span style={{ fontSize: size * 0.12, opacity: 0.6 }}>h</span>
        </span>
        {label && (
          <span className="text-[10px] text-text-secondary mt-0.5">{label}</span>
        )}
        <div className="flex items-center gap-0.5 mt-0.5">
          <div
            className="h-1 rounded-full"
            style={{
              width: size * 0.3,
              background: `linear-gradient(to right, #dc2626, #ea580c, #16a34a)`,
              boxShadow: `0 0 4px ${color}40`,
            }}
          />
          <span className="text-[9px] text-text-secondary tabular-nums font-medium ml-1">
            {Math.round(animatedValue)}%
          </span>
        </div>
      </div>
    </div>
  )
}
