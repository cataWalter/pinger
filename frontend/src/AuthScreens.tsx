import type { FormEvent } from 'react'
import { ArrowDown, Check, ChevronDown, CircleAlert, Download, LockKeyhole, MessageCircleMore, ShieldCheck } from 'lucide-react'
import { AppService } from '../bindings/mychat/desktop'
import { describeError } from './appShared'

function AuthSide() {
  return (
    <div className="auth-side" aria-hidden="true">
      <img className="auth-side-mark" src="/pinger.svg" alt="" />
      <div className="auth-side-grid" />
      <div className="auth-side-bottom"><span>PINGER</span><span>01 / 01</span></div>
    </div>
  )
}

export function BootScreen({ error }: { error: string }) {
  return (
    <main className="boot-screen">
      <div className="boot-mark"><MessageCircleMore size={20} /></div>
      <span>Pinger</span>
      {error && <p role="alert">{error}</p>}
    </main>
  )
}

type SignInScreenProps = {
  homeserver: string
  setHomeserver: (value: string) => void
  username: string
  setUsername: (value: string) => void
  password: string
  setPassword: (value: string) => void
  error: string
  setError: (value: string) => void
  busy: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function SignInScreen({ homeserver, setHomeserver, username, setUsername, password, setPassword, error, setError, busy, onSubmit }: SignInScreenProps) {
  return (
    <main className="auth-screen auth-screen-signin">
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-brand">
          <img className="brand-glyph" src="/pinger.svg" alt="" />
          <span>Pinger</span>
        </div>
        <div className="auth-heading">
          <span className="eyebrow">MATRIX ACCOUNT</span>
          <h1 id="auth-title">Sign in</h1>
          <p>Use your homeserver credentials to continue.</p>
        </div>
        <form className="auth-form" onSubmit={onSubmit}>
          <div className="auth-homeserver">
            <label htmlFor="login-homeserver"><span>Homeserver</span></label>
            <button className="auth-helper-button auth-homeserver-shortcut" type="button" disabled={busy} onClick={() => setHomeserver('https://matrix.beeper.com/')}><Check size={13} />Use Beeper Homeserver</button>
            <input id="login-homeserver" value={homeserver} onChange={(event) => setHomeserver(event.target.value)} type="url" autoComplete="url" spellCheck={false} autoCorrect="off" autoCapitalize="off" required />
          </div>
          <label>
            <span>Username</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoCorrect="off" required />
          </label>
          <label>
            <span>Password</span>
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required />
          </label>
          {error && <div className="form-error" role="alert"><CircleAlert size={16} />{error}</div>}
          <button className="primary-button auth-submit" type="submit" disabled={busy}>
            {busy ? 'Connecting…' : 'Continue'}
            {!busy && <ArrowDown className="button-arrow" size={17} />}
          </button>
        </form>
        <details className="beeper-onboarding">
          <summary><span>Using Beeper with Pinger?</span><ChevronDown size={16} /></summary>
          <ol>
            <li><strong>Register on Beeper</strong><p>Create your account in the official Beeper app, then link your chats, such as WhatsApp, Telegram or Signal.</p></li>
            <li><strong>Set a Matrix password</strong><p>Set a password in Beeper account settings or use the password-reset flow for your Beeper account. Email sign-in codes are not a Matrix password.</p></li>
            <li><strong>Sign in here</strong><p>Use <code>https://matrix.beeper.com/</code>, your full user ID such as <code>@your_user:beeper.com</code>, and your Matrix password.</p></li>
          </ol>
          <button className="auth-helper-button" type="button" disabled={busy} onClick={() => {
            setError('')
            void AppService.OpenExternalURL('https://www.beeper.com/download').catch((openError) => setError(describeError(openError)))
          }}><Download size={15} />Download official Beeper app</button>
        </details>
        <div className="auth-footnote"><LockKeyhole size={14} /><span>Session and encryption keys stay on this device.</span></div>
      </section>
      <AuthSide />
    </main>
  )
}

type DeviceVerificationScreenProps = {
  recoveryKey: string
  setRecoveryKey: (value: string) => void
  error: string
  busy: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function DeviceVerificationScreen({ recoveryKey, setRecoveryKey, error, busy, onSubmit }: DeviceVerificationScreenProps) {
  return (
    <main className="auth-screen">
      <section className="auth-panel" aria-labelledby="verify-title">
        <div className="auth-brand">
          <img className="brand-glyph" src="/pinger.svg" alt="" />
          <span>Pinger</span>
        </div>
        <div className="auth-heading">
          <span className="eyebrow">ENCRYPTION SETUP</span>
          <h1 id="verify-title">Verify this device</h1>
          <p>Enter your recovery key or security passphrase.</p>
        </div>
        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            <span>Recovery key or passphrase</span>
            <input value={recoveryKey} onChange={(event) => setRecoveryKey(event.target.value)} type="password" autoComplete="off" required />
          </label>
          {error && <div className="form-error" role="alert"><CircleAlert size={16} />{error}</div>}
          <button className="primary-button auth-submit" type="submit" disabled={busy}>
            {busy ? 'Verifying…' : 'Verify device'}
            {!busy && <ShieldCheck size={17} />}
          </button>
        </form>
        <div className="auth-footnote"><LockKeyhole size={14} /><span>Your key is used locally to verify encryption.</span></div>
      </section>
      <AuthSide />
    </main>
  )
}
