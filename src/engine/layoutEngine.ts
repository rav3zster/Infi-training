/**
 * Adaptive Layout Engine — Pure computation module.
 *
 * Converts viewport dimensions into reusable layout profiles.
 * Every screen consumes layout info from this engine.
 * No screen should contain its own responsive logic.
 *
 * Layout Profiles:
 *   compact     < 640px      Small phones
 *   comfortable  640–1023px  Phones landscape, foldables, small tablets
 *   expanded     1024–1439px Large tablets, small desktops
 *   ultra        ≥ 1440px    Large desktops, ChromeOS
 */

export type LayoutProfile = 'compact' | 'comfortable' | 'expanded' | 'ultra'
export type NavMode = 'bottom' | 'rail' | 'sidebar'
export type GridDensity = 'compact' | 'normal' | 'spacious'
export type Orientation = 'portrait' | 'landscape'

export interface LayoutInfo {
  /** Categorical profile name */
  profile: LayoutProfile
  /** Raw viewport width (px) */
  width: number
  /** Raw viewport height (px) */
  height: number
  /** Screen orientation */
  orientation: Orientation

  // ── Navigation ──
  navMode: NavMode

  // ── Grid ──
  /** Primary content columns */
  columns: number
  /** Additional sidebar/panels columns */
  detailColumns: number
  gridDensity: GridDensity

  // ── Sizing ──
  /** Max content width in px (0 = no clamp) */
  maxContentWidth: number
  /** Recommended card min-width (CSS value) */
  cardMinWidth: string
  /** Recommended card max-width (CSS value) */
  cardMaxWidth: string

  // ── Spacing (px) ──
  /** Gap between sections */
  sectionGap: number
  /** Gap between cards in a row */
  cardGap: number
  /** Horizontal content padding on each side */
  contentPaddingX: number
  /** Vertical content padding (top/bottom) */
  contentPaddingY: number
  /** Card inner padding */
  cardPadding: number
  /** Progress bar height in px */
  progressBarHeight: number

  // ── Typography (scale factor relative to 16px base) ──
  typographyScale: number
  /** Hero text rem */
  textHero: string
  /** H1 text rem */
  textH1: string
  /** Body text rem */
  textBody: string
  /** Small text rem */
  textSmall: string
  /** Data/value text rem */
  textData: string
  /** Tiny/caption text rem */
  textTiny: string

  // ── Icon scale (base = 1.0) ──
  iconScale: number

  // ── Safe area insets (px) — populated by hook from CSS env() ──
  safeAreaTop: number
  safeAreaBottom: number
  safeAreaLeft: number
  safeAreaRight: number

  // ── Derived booleans ──
  isCompact: boolean
  isComfortable: boolean
  isExpanded: boolean
  isUltra: boolean
  isPortrait: boolean
  isLandscape: boolean
  /** True for expanded or ultra */
  isWide: boolean
  /** True for comfortable or wider (i.e. not compact) */
  isSpacious: boolean
  /** Whether to show a nav-safe bottom padding */
  needsNavSafePadding: boolean
}

// ── Compute a layout profile from raw dimensions ──

export function computeLayout(
  width: number,
  height: number,
  safeAreaTop = 0,
  safeAreaBottom = 0,
  safeAreaLeft = 0,
  safeAreaRight = 0,
): LayoutInfo {
  const orientation: Orientation = width > height ? 'landscape' : 'portrait'
  const profile = getProfile(width)

  // ── Profile-based values ──
  const isCompact = profile === 'compact'
  const isComfortable = profile === 'comfortable'
  const isExpanded = profile === 'expanded'
  const isUltra = profile === 'ultra'
  const isWide = isExpanded || isUltra
  const isSpacious = !isCompact
  const isLandscape = orientation === 'landscape'
  const isPortrait = orientation === 'portrait'

  let navMode: NavMode
  let columns: number
  let detailColumns: number
  let gridDensity: GridDensity
  let maxContentWidth: number
  let sectionGap: number
  let cardGap: number
  let contentPaddingX: number
  let contentPaddingY: number
  let cardPadding: number
  let progressBarHeight: number
  let typographyScale: number
  let iconScale: number
  let needsNavSafePadding: boolean

  switch (profile) {
    case 'compact':
      navMode = 'bottom'
      columns = 1
      detailColumns = 0
      gridDensity = 'compact'
      maxContentWidth = 0 // full width available
      sectionGap = 16
      cardGap = 8
      contentPaddingX = 16
      contentPaddingY = 24
      cardPadding = 16
      progressBarHeight = 4
      typographyScale = 0.875
      iconScale = 0.85
      needsNavSafePadding = true
      break

    case 'comfortable':
      navMode = width < 768 ? 'bottom' : 'rail'
      columns = width >= 768 ? 2 : 1
      detailColumns = 0
      gridDensity = 'normal'
      maxContentWidth = 0
      sectionGap = 20
      cardGap = 12
      contentPaddingX = 24
      contentPaddingY = 32
      cardPadding = 20
      progressBarHeight = 6
      typographyScale = 1.0
      iconScale = 1.0
      needsNavSafePadding = navMode === 'bottom'
      break

    case 'expanded':
      navMode = 'rail'
      columns = 2
      detailColumns = 1
      gridDensity = 'normal'
      maxContentWidth = 1200
      sectionGap = 24
      cardGap = 16
      contentPaddingX = 32
      contentPaddingY = 40
      cardPadding = 24
      progressBarHeight = 8
      typographyScale = 1.0
      iconScale = 1.0
      needsNavSafePadding = false
      break

    case 'ultra':
      navMode = 'sidebar'
      columns = 3
      detailColumns = 2
      gridDensity = 'spacious'
      maxContentWidth = 1440
      sectionGap = 28
      cardGap = 20
      contentPaddingX = 40
      contentPaddingY = 48
      cardPadding = 28
      progressBarHeight = 8
      typographyScale = 1.125
      iconScale = 1.1
      needsNavSafePadding = false
      break
  }

  // In landscape on compact, allow 2 columns
  if (profile === 'compact' && isLandscape) {
    columns = 2
  }

  const textBase = `${(typographyScale * 1).toFixed(4)}rem`

  return {
    profile,
    width,
    height,
    orientation,

    navMode,
    columns,
    detailColumns,
    gridDensity,

    maxContentWidth,
    cardMinWidth: columns > 1 ? `${Math.round(240 * typographyScale)}px` : 'auto',
    cardMaxWidth: columns > 1 ? `${Math.round(500 * typographyScale)}px` : 'none',

    sectionGap,
    cardGap,
    contentPaddingX,
    contentPaddingY,
    cardPadding,
    progressBarHeight,

    typographyScale,
    textHero: `${(typographyScale * 1.75).toFixed(4)}rem`,
    textH1: `${(typographyScale * 1.25).toFixed(4)}rem`,
    textBody: `${(typographyScale * 0.875).toFixed(4)}rem`,
    textSmall: `${(typographyScale * 0.75).toFixed(4)}rem`,
    textData: `${(typographyScale * 1.5).toFixed(4)}rem`,
    textTiny: `${(typographyScale * 0.625).toFixed(4)}rem`,

    iconScale,
    safeAreaTop,
    safeAreaBottom,
    safeAreaLeft,
    safeAreaRight,

    isCompact,
    isComfortable,
    isExpanded,
    isUltra,
    isPortrait,
    isLandscape,
    isWide,
    isSpacious,
    needsNavSafePadding,
  }
}

function getProfile(width: number): LayoutProfile {
  if (width < 640) return 'compact'
  if (width < 1024) return 'comfortable'
  if (width < 1440) return 'expanded'
  return 'ultra'
}

/** Derive CSS grid template columns from the layout profile */
export function gridTemplate(layout: LayoutInfo): string {
  return `repeat(${layout.columns}, 1fr)`
}

/** Get the CSS gap value for card grids */
export function gridGap(layout: LayoutInfo): string {
  return `${layout.cardGap}px`
}

/** Get the CSS content-padding value */
export function contentPaddingCSS(layout: LayoutInfo): string {
  return `max(env(safe-area-inset-left, 0px), ${layout.contentPaddingX}px) max(env(safe-area-inset-right, 0px), ${layout.contentPaddingY}px)`
}

/** Get the CSS max-width for content containers */
export function maxContentWidthCSS(layout: LayoutInfo): string {
  return layout.maxContentWidth > 0 ? `${layout.maxContentWidth}px` : '100%'
}
