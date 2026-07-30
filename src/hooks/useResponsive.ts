/**
 * useResponsive — Viewport-aware hook powered by the Adaptive Layout Engine.
 *
 * Primary interface: `layout` (LayoutInfo) with typed profiles, columns,
 * spacing, typography scale, nav mode, and safe-area insets.
 *
 * Every screen should use `layout.isCompact|isComfortable|isExpanded|isUltra`
 * and `layout.columns` instead of ad-hoc width checks.
 *
 * Legacy boolean flags (isMobile, isTablet, isDesktop) preserved for
 * backward compatibility during migration.
 */

import { useState, useEffect, useCallback } from 'react'
import { computeLayout, type LayoutInfo, type LayoutProfile, type NavMode, type Orientation } from '../engine/layoutEngine'

export type { LayoutProfile, NavMode, Orientation, LayoutInfo } from '../engine/layoutEngine'

export interface ResponsiveState {
  /** The primary interface — use this */
  layout: LayoutInfo
  /** Legacy: derived profile name */
  profile: LayoutProfile
  /** Legacy: nav mode */
  navMode: NavMode
  /** Legacy: orientation */
  orientation: Orientation
  /** Legacy: raw width */
  width: number
  /** Legacy: raw height */
  height: number
  /** Legacy: compact check (width < 640) */
  isCompact: boolean
  /** Legacy: mobile (width < 768) */
  isMobile: boolean
  /** Legacy: tablet (768-1023) */
  isTablet: boolean
  /** Legacy: desktop (>= 1024) */
  isDesktop: boolean
  /** Legacy: landscape */
  isLandscape: boolean
  /** Legacy: portrait */
  isPortrait: boolean
}

export function useResponsive(): ResponsiveState {
  const [state, setState] = useState<ResponsiveState>(() => {
    if (typeof window === 'undefined') {
      const fallbackLayout = computeLayout(375, 812)
      return {
        layout: fallbackLayout,
        profile: fallbackLayout.profile,
        navMode: fallbackLayout.navMode,
        orientation: fallbackLayout.orientation,
        width: 375,
        height: 812,
        isCompact: true,
        isMobile: true,
        isTablet: false,
        isDesktop: false,
        isLandscape: false,
        isPortrait: true,
      }
    }

    const w = window.innerWidth
    const h = window.innerHeight
    const layout = computeLayout(w, h)

    return {
      layout,
      profile: layout.profile,
      navMode: layout.navMode,
      orientation: layout.orientation,
      width: w,
      height: h,
      isCompact: layout.isCompact,
      isMobile: w < 768,
      isTablet: w >= 768 && w < 1024,
      isDesktop: w >= 1024,
      isLandscape: layout.isLandscape,
      isPortrait: layout.isPortrait,
    }
  })

  const handleResize = useCallback(() => {
    const w = window.innerWidth
    const h = window.innerHeight
    const layout = computeLayout(w, h)

    setState({
      layout,
      profile: layout.profile,
      navMode: layout.navMode,
      orientation: layout.orientation,
      width: w,
      height: h,
      isCompact: layout.isCompact,
      isMobile: w < 768,
      isTablet: w >= 768 && w < 1024,
      isDesktop: w >= 1024,
      isLandscape: layout.isLandscape,
      isPortrait: layout.isPortrait,
    })
  }, [])

  useEffect(() => {
    window.addEventListener('resize', handleResize)
    window.addEventListener('orientationchange', () => {
      setTimeout(handleResize, 150)
    })
    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', handleResize)
    }
  }, [handleResize])

  return state
}
