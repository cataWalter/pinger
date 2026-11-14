import { BootScreen, DeviceVerificationScreen, SignInScreen } from './AuthScreens'
import { SettingsProvider } from './SettingsContext'
import { accentCssVariables } from './accent'
import { SYSTEM_THEME_NAME, themeCssVariables, themeModeForPreference } from './themes'
import { preferenceBoolean, preferenceString } from './appShared'
import { useShellState } from './useShellState'
import { useVolatileAIDraftState } from './volatileAIDrafts'
import { useAuthFormState } from './useAuthFormState'
import { useTimelineHistory } from './useTimelineHistory'
import { useInboxState } from './useInboxState'
import { useTimelineScroll } from './useTimelineScroll'
import { useMediaGalleryState } from './useMediaGalleryState'
import { useMessageSearch } from './useMessageSearch'
import { useLocalAIChats } from './useLocalAIChats'
import { useRoomActions } from './useRoomActions'
import { useSessionActions } from './useSessionActions'
import { useMessageDispatch } from './useMessageDispatch'
import { useComposerActions } from './useComposerActions'
import { useMessageReactions } from './useMessageReactions'
import { useAIRequests } from './useAIRequests'
import { useAccountWorkspace } from './useAccountWorkspace'
import { useNotificationDelivery } from './useNotificationDelivery'
import { useWorkspaceEffects } from './useWorkspaceEffects'
import { useMenuActions } from './useMenuActions'
import { useMessageAIActions } from './useMessageAIActions'
import { useComposerSnippets } from './useComposerSnippets'
import { useRoomChatExport } from './useRoomChatExport'
import { useApplicationKeys } from './useApplicationKeys'
import { useComposerKeys } from './useComposerKeys'
import type { AppState } from './appState'
import { AppSidebar } from './AppSidebar'
import { ConversationHeader } from './ConversationHeader'
import { ConversationWorkspace } from './ConversationWorkspace'
import { AppDialogs } from './AppDialogs'

function AppBody() {
  const part00 = useVolatileAIDraftState(useShellState())
  const part01 = useAuthFormState(part00)
  const part02 = useTimelineHistory(part01)
  const part03 = useInboxState(part02)
  const part04 = useTimelineScroll(part03)
  const part05 = useMediaGalleryState(part04)
  const part06 = useMessageSearch(part05)
  const part07 = useLocalAIChats(part06)
  const part08 = useRoomActions(part07)
  const part09 = useSessionActions(part08)
  const part10 = useMessageDispatch(part09)
  const part11 = useComposerActions(part10)
  const part12 = useMessageReactions(part11)
  const part13 = useAIRequests(part12)
  const part14 = useAccountWorkspace(part13)
  const part15 = useNotificationDelivery(part14)
  const part16 = useWorkspaceEffects(part15)
  const part17 = useMenuActions(part16)
  const part18 = useMessageAIActions(part17)
  const part19 = useComposerSnippets(part18)
  const part20 = useRoomChatExport(part19)
  const part21 = useApplicationKeys(part20)
  const part22 = useComposerKeys(part21)
  const { accentPalette, appZoom, busy, error, handleApplicationKeyDown, homeserver, mobilePane, password, preferences, recoveryKey, safeBubbleColor, setError, setHomeserver, setPassword, setRecoveryKey, setUsername, snapshot, submitLogin, submitVerification, systemPrefersDark, themeChoice, username } = part22

  if (!snapshot) return <BootScreen error={error} />

  if (!snapshot.loggedIn) {
    return (
      <SignInScreen
        homeserver={homeserver}
        setHomeserver={setHomeserver}
        username={username}
        setUsername={setUsername}
        password={password}
        setPassword={setPassword}
        error={error}
        setError={setError}
        busy={busy}
        onSubmit={submitLogin}
      />
    )
  }

  if (snapshot.needsVerification) {
    return (
      <DeviceVerificationScreen
        recoveryKey={recoveryKey}
        setRecoveryKey={setRecoveryKey}
        error={error}
        busy={busy}
        onSubmit={submitVerification}
      />
    )
  }

  const appState: AppState = { ...part22, snapshot }

  return (
    <main
      className="app-shell"
      onKeyDown={handleApplicationKeyDown}
      data-file-drop-target=""
      data-theme={themeChoice}
      data-ui="desktop"
      data-platform={/Mac|iPhone|iPad/.test(navigator.platform) ? 'macos' : 'other'}
      data-theme-mode={themeModeForPreference(preferenceString(preferences, 'appearance.theme', SYSTEM_THEME_NAME), systemPrefersDark)}
      data-mobile-pane={mobilePane}
      data-content-blur={preferenceBoolean(preferences, 'privacy.incognito')}
      data-message-animations={preferenceBoolean(preferences, 'appearance.message_animations', true)}
      data-font-size={preferenceString(preferences, 'appearance.font_size', 'Medium').toLowerCase()}
      data-wallpaper={preferenceString(preferences, 'appearance.chat_wallpaper', 'None').toLowerCase()}
      data-room-previews={preferenceBoolean(preferences, 'sidebar.show_previews', true)}
      data-unread-counts={preferenceBoolean(preferences, 'sidebar.show_unread_counts', true)}
      data-compact-chat-list={preferenceBoolean(preferences, 'sidebar.compact_chat_list')}
      data-pointer-cursor={preferenceBoolean(preferences, 'appearance.pointer_cursor', true)}
      data-balanced-text={preferenceBoolean(preferences, 'appearance.balanced_text')}
      style={{
        '--own-bubble': safeBubbleColor,
        '--app-zoom': `${appZoom}%`,
        ...accentCssVariables(accentPalette),
        ...themeCssVariables(themeChoice, accentPalette, safeBubbleColor),
      } as React.CSSProperties}
    >
      <AppSidebar app={appState} />
      <section className="conversation" aria-label="Conversation">
        <ConversationHeader app={appState} />
        <ConversationWorkspace app={appState} />
      </section>
      <AppDialogs app={appState} />
    </main>
  )
}

function App() {
  return (
    <SettingsProvider>
      <AppBody />
    </SettingsProvider>
  )
}

export default App
