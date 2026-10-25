import { WifiOff } from 'lucide-react'
import type { ConnectionProblem } from './useConnectionProblem'

const problemMessages: Record<ConnectionProblem, string> = {
  'browser-offline': 'No internet connection. Pinger will reconnect automatically.',
  'server-unreachable': "Can't reach the Matrix server. Retrying…",
}

export function ConnectionStatusBanner({ problem }: { problem: ConnectionProblem | null }) {
  if (!problem) return null
  return (
    <div className="connection-banner" role="status">
      <WifiOff size={15} aria-hidden="true" />
      <span>{problemMessages[problem]}</span>
    </div>
  )
}
