import { useEffect, useState } from 'react'

export type ConnectionProblem = 'browser-offline' | 'server-unreachable'

// Shorter sync failures recover before this delay, so they never show a notice.
const serverUnreachableDelayMs = 5_000

export function useConnectionProblem(syncOffline: boolean): ConnectionProblem | null {
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine !== false)
  const [serverUnreachable, setServerUnreachable] = useState(false)

  useEffect(() => {
    const updateBrowserOnline = () => setBrowserOnline(navigator.onLine !== false)
    window.addEventListener('online', updateBrowserOnline)
    window.addEventListener('offline', updateBrowserOnline)
    return () => {
      window.removeEventListener('online', updateBrowserOnline)
      window.removeEventListener('offline', updateBrowserOnline)
    }
  }, [])

  useEffect(() => {
    if (!syncOffline) return
    const timer = window.setTimeout(() => setServerUnreachable(true), serverUnreachableDelayMs)
    return () => {
      window.clearTimeout(timer)
      setServerUnreachable(false)
    }
  }, [syncOffline])

  if (!browserOnline) return 'browser-offline'
  return syncOffline && serverUnreachable ? 'server-unreachable' : null
}
