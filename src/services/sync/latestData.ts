import type { TrainingData } from '../../types'

/**
 * Module-level pointer to the freshest in-memory TrainingData.
 *
 * TrainingContext keeps this in sync via an effect; the Sync Engine uses it
 * as the merge base so remote downloads are applied ON TOP of the user's
 * latest unsaved changes — never over a stale DB snapshot (the debounced
 * persist may lag 800ms behind the UI).
 */
export const latestTrainingData: { current: TrainingData | null } = { current: null }
