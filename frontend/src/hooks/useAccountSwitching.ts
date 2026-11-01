import { AppService } from '../../bindings/mychat/desktop'
import type { Snapshot } from '../../bindings/mychat/desktop/models.js'
import { describeError } from '../appShared'

type AccountSwitchingOptions = {
  activeAccountID: string
  blocked: boolean
  resetAccountWorkspace: (state: Snapshot) => void
  showRoom: (roomID: string) => void
  setBusy: (busy: boolean) => void
  setAccountError: (error: string) => void
  setAccountManagerOpen: (open: boolean) => void
}

export function useAccountSwitching({
  activeAccountID,
  blocked,
  resetAccountWorkspace,
  showRoom,
  setBusy,
  setAccountError,
  setAccountManagerOpen,
}: AccountSwitchingOptions) {
  return async function switchAccount(accountID: string, roomID = '') {
    if (blocked) return
    if (accountID === activeAccountID) {
      setAccountManagerOpen(false)
      if (roomID) showRoom(roomID)
      return
    }
    setBusy(true)
    setAccountError('')
    try {
      const state = await AppService.SwitchAccount(accountID)
      resetAccountWorkspace(state)
      if (roomID) showRoom(roomID)
      setAccountManagerOpen(false)
    } catch (switchError) {
      setAccountError(describeError(switchError))
    } finally {
      setBusy(false)
    }
  }
}