import { memo, useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw, X } from 'lucide-react'
import { Events } from '@wailsio/runtime'
import { AppService } from '../bindings/mychat/desktop'
import { describeError } from './appShared'

export type AIProviderHealthEvent = {
  status: 'healthy' | 'degraded' | 'cooldown'
  provider: string
  endpoint: string
  error?: string
  failureCount: number
  cooldownUntil?: number
}

export const AIStatusBanner = memo(function AIStatusBanner() {
  const [health, setHealth] = useState<AIProviderHealthEvent | null>(null)
  const [dismissedError, setDismissedError] = useState('')
  const [retrying, setRetrying] = useState(false)

  useEffect(() => Events.On('ai:provider_status', (event: { data: unknown }) => {
    const payload = event.data as AIProviderHealthEvent | undefined
    if (!payload) return
    if (payload.status === 'healthy') {
      setHealth(null)
      setDismissedError('')
      return
    }
    setHealth(payload)
  }), [])

  if (!health || (dismissedError && dismissedError === (health.error || health.endpoint))) {
    return null
  }

  async function retry() {
    setRetrying(true)
    try {
      await AppService.TestAIEndpoint()
      setHealth(null)
      setDismissedError('')
    } catch (retryError) {
      setHealth((current) => current ? { ...current, error: describeError(retryError) } : current)
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="connection-banner ai-health-banner" role="status">
      <AlertTriangle size={15} aria-hidden="true" />
      <span>
        {health.status === 'cooldown'
          ? 'AI endpoint unreachable; pausing requests briefly.'
          : 'AI endpoint connection degraded.'}
      </span>
      <button type="button" className="ai-health-banner-action" disabled={retrying} onClick={() => void retry()} aria-label="Retry AI connection" title={health.error || health.endpoint}>
        <RefreshCw size={13} aria-hidden="true" />
      </button>
      <button type="button" className="ai-health-banner-action" onClick={() => setDismissedError(health.error || health.endpoint)} aria-label="Dismiss AI warning">
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  )
})
