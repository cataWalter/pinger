import { useEffect } from 'react'
import { BootScreen, DeviceVerificationScreen, SignInScreen } from './AuthScreens'
import { SettingsProvider } from './SettingsContext'
import { accentCssVariables } from './accent'
import { SYSTEM_THEME_NAME, themeCssVariables, themeModeForPreference } from './themes'
import { preferenceBoolean, preferenceString } from './appShared'
import { useSidebarWidth } from './sidebarWidth'
import { useAppStateChain } from './appStateChain'
import type { AppState } from './appState'
import { AppSidebar } from './AppSidebar'
import { ConversationHeader } from './ConversationHeader'
import { ConversationWorkspace } from './ConversationWorkspace'
import { AppDialogs } from './AppDialogs'

function AppBody() {
  const appChain = useAppStateChain()
  const { accentPalette, appZoom, busy, error, handleApplicationKeyDown, homeserver, mobilePane, password, preferences, recoveryKey, safeBubbleColor, setError, setHomeserver, setPassword, setRecoveryKey, setUsername, snapshot, submitLogin, submitVerification, systemPrefersDark, themeChoice, username } = appChain

  const lowSpecMode = preferenceBoolean(snapshot?.preferences ?? {}, 'appearance.low_spec_mode')
  useEffect(() => {
    document.documentElement.dataset.lowSpec = String(lowSpecMode)
  }, [lowSpecMode])

  const [sidebarWidth, setSidebarWidth] = useSidebarWidth()

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

  const appState: AppState = { ...appChain, snapshot }

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
        '--sidebar-width': sidebarWidth === null ? undefined : `${sidebarWidth}px`,
        ...accentCssVariables(accentPalette),
        ...themeCssVariables(themeChoice, accentPalette, safeBubbleColor),
      } as React.CSSProperties}
    >
      <AppSidebar
        app={appState}
        sidebarWidth={sidebarWidth}
        sidebarZoom={appZoom / 100}
        onSidebarWidthChange={setSidebarWidth}
      />
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
