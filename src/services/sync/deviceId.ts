/**
 * deviceId — stable per-device identity for the Sync Engine.
 *
 * Every uploaded row is stamped with this id (LWW provenance: "which device
 * wrote this last"). Persisted in localStorage; generated once per browser /
 * device and never changes for the lifetime of that device's storage.
 */

const KEY = 'training-tracker-device-id'

export function getDeviceId(): string {
  if (typeof localStorage === 'undefined') return 'no-device'
  try {
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    return 'no-device'
  }
}
