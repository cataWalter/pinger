import { type Verification } from '../bindings/mychat/desktop/models.js'

export function sameVerificationState(current: Verification | null, next: Verification | null) {
  if (current === next) return true
  if (!current || !next) return false
  const currentEmojis = current.emojis ?? []
  const nextEmojis = next.emojis ?? []
  const currentDecimals = current.decimals ?? []
  const nextDecimals = next.decimals ?? []
  return current.transactionId === next.transactionId
    && current.userId === next.userId
    && current.deviceId === next.deviceId
    && current.incoming === next.incoming
    && current.phase === next.phase
    && current.reason === next.reason
    && currentEmojis.length === nextEmojis.length
    && currentEmojis.every((emoji, index) => emoji.emoji === nextEmojis[index].emoji && emoji.description === nextEmojis[index].description)
    && currentDecimals.length === nextDecimals.length
    && currentDecimals.every((value, index) => value === nextDecimals[index])
}

export function base64ToBytes(encoded: string): Uint8Array<ArrayBuffer> {
  const binary = atob(encoded)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}
