import { useState } from 'react'
import { WifiOff } from 'lucide-react'
import type { ConnectionProblem } from './useConnectionProblem'
import { useExitTransition } from './hooks/useExitTransition'

const problemMessages: Record<ConnectionProblem, string> = {
  'browser-offline': 'No internet connection. Pinger will reconnect automatically.',
  'server-unreachable': "Can't reach the Matrix server. Retrying…",
}

export function ConnectionStatusBanner({ problem }: { problem: ConnectionProblem | null }) {
  // Keep the most recent problem so the banner still has text while it fades out.
  const [lastProblem, setLastProblem] = useState(problem)
  if (problem && problem !== lastProblem) setLastProblem(problem)
  const exit = useExitTransition(problem !== null)
  const shown = problem ?? lastProblem
  if (!exit.mounted || !shown) return null
  return (
    <div className="connection-banner" role="status" data-closing={exit.closing ? 'true' : undefined}>
      <WifiOff size={15} aria-hidden="true" />
      <span>{problemMessages[shown]}</span>
    </div>
  )
}

